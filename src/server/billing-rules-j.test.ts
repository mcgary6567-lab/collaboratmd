import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { normalizeNdc } from "@/lib/codes/ndc";
import { buildEdi835, parseEdi835 } from "@/lib/edi/x835";
import { buildEdi837I, type Edi837IInput } from "@/lib/edi/x837i";
import { validateStructure } from "@/lib/edi/x999";
import { scrubClaim, type ScrubClaim } from "@/lib/scrub/rules";
import { scrubInstitutional } from "@/lib/scrub/institutional";
import { getClaimFinancials, loadClaimBundle } from "./claims";
import { buildClaimEdi } from "./claim-edi";
import { ndcColumns } from "./encounters";
import { matchTakeback, postProviderAdjustments } from "./plb";
import { checkTomorrowsCoverage } from "./automation";
import { clockDay, practiceNow } from "./practice-time";
import { appealLevelsFor, recordAppealDecision } from "./appeal-levels";
import { abnFindings, abnModifiers, createAbn, parseAbnServices, recordAbnChoice } from "./abn";
import { overpaymentClocks, overpaymentDeadlineAlerts, setOverpaymentIdentified } from "./recovery";
import { codeSetFindings, importCodeSet, parseTelehealthList } from "./code-sets";
import { pcsProcedures } from "./institutional";

const scrub = (over: Partial<ScrubClaim> = {}): ScrubClaim => ({
  patient: { firstName: "Maria", lastName: "Garcia", dob: "1950-04-12", sex: "F", address1: "1 Main St", zip: "32801" },
  insurance: { memberId: "1EG4TE5MK73", payerId: "00590", relationship: "self" },
  provider: { npi: "1234567893", taxonomy: "207Q00000X" },
  practice: { npi: "1234567893", taxId: "12-3456789" },
  encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9"] },
  lines: [{ lineNumber: 1, cpt: "99214", modifiers: [], units: 1, chargeCents: 19500, dxPointers: [1] }],
  payer: { timelyFilingDays: 365, type: "commercial" },
  today: new Date("2026-09-21T00:00:00Z"),
  ...over,
});
const rules = (c: ScrubClaim) => scrubClaim(c).map((f) => `${f.rule}:${f.severity}`);

describe("NDC on drug lines", () => {
  it("turns each printed layout into the 11-digit form", () => {
    expect(normalizeNdc("1234-5678-90")).toBe("01234567890");
    expect(normalizeNdc("12345-678-90")).toBe("12345067890");
    expect(normalizeNdc("12345-6789-0")).toBe("12345678900");
    expect(normalizeNdc("12345678901")).toBe("12345678901");
    expect(normalizeNdc("1234567890")).toBeNull(); // 10 digits without dashes: which segment is short is unknowable
    expect(() => ndcColumns({ ndc: "12-34" })).toThrow(/not an NDC/);
    expect(ndcColumns({ ndc: "12345-678-90" })).toEqual({ ndc: "12345067890", ndcUnit: "UN", ndcQuantity: 1 });
  });

  it("asks for the NDC on a J-code, harder for Medicaid", () => {
    const j = [{ lineNumber: 1, cpt: "J1100", modifiers: [], units: 1, chargeCents: 2500, dxPointers: [1] }];
    expect(rules(scrub({ lines: j }))).toContain("NDC:warning");
    expect(rules(scrub({ lines: j, payer: { timelyFilingDays: 365, type: "medicaid" } }))).toContain("NDC:error");
    expect(rules(scrub({ lines: [{ ...j[0], ndc: "12345678901", ndcUnit: "ML", ndcQuantity: 2 }] }))).not.toContain("NDC:warning");
    expect(rules(scrub({ lines: [{ ...j[0], ndc: "12345678901", ndcUnit: "XX", ndcQuantity: 2 }] }))).toContain("NDC:error");
  });
});

describe("telehealth", () => {
  it("checks place of service against the modifiers", () => {
    const tele = (mods: string[], type = "commercial", pos = "10") => rules(scrub({ encounter: { dateOfService: "2026-09-01", placeOfService: pos, diagnoses: ["E11.9"] }, lines: [{ lineNumber: 1, cpt: "99214", modifiers: mods, units: 1, chargeCents: 19500, dxPointers: [1] }], payer: { timelyFilingDays: 365, type } }));
    expect(tele([])).toContain("TELEHEALTH_MODIFIER:warning");
    expect(tele(["95"])).not.toContain("TELEHEALTH_MODIFIER:warning");
    expect(tele([], "medicare")).not.toContain("TELEHEALTH_MODIFIER:warning"); // Medicare takes POS 02/10 alone
    expect(tele(["95", "93"])).toContain("TELEHEALTH_MODIFIER:error");
    expect(tele(["GT"], "medicare")).toContain("TELEHEALTH_GT:warning");
  });

  it("reads CMS's telehealth list and warns on Medicare lines not on it", async () => {
    const csv = "List of Medicare Telehealth Services for CY 2026\nHCPCS,Short Descriptor,Status,Can Audio-only Interaction Meet the Requirements?\n99214,Office visit est,Permanent,Yes\n90837,Psychotherapy 60 min,Permanent,Yes\n97110,Therapeutic exercise,Provisional,No\nbad,row,,\n";
    const p = parseTelehealthList(csv);
    expect(p.rows).toEqual([{ code: "99214", status: "Permanent; audio-only allowed" }, { code: "90837", status: "Permanent; audio-only allowed" }, { code: "97110", status: "Provisional" }]);
    const t = await testDb({ seed: false });
    try {
      const base = { payerType: "medicare", dateOfService: "2026-09-01", diagnoses: [], placeOfService: "10" };
      // No list for the year: nothing fires.
      expect(await codeSetFindings(t.db, { ...base, lines: [{ lineNumber: 1, cpt: "11111", modifiers: [], units: 1 }] })).toEqual([]);
      await expect(importCodeSet(t.db, "telehealth", csv, "CY2026 list", "test")).rejects.toThrow(/year/);
      await importCodeSet(t.db, "telehealth", csv, "CY2026 list", "test", 2026);
      const f = await codeSetFindings(t.db, { ...base, lines: [{ lineNumber: 1, cpt: "99214", modifiers: [], units: 1 }, { lineNumber: 2, cpt: "11111", modifiers: [], units: 1 }, { lineNumber: 3, cpt: "97110", modifiers: ["93"], units: 1 }] });
      expect(f.map((x) => x.field)).toEqual(["lines.2.cpt", "lines.3.cpt"]);
      expect(f[1].message).toMatch(/audio only/);
      // In person, or another payer: not checked.
      expect(await codeSetFindings(t.db, { ...base, placeOfService: "11", lines: [{ lineNumber: 1, cpt: "11111", modifiers: [], units: 1 }] })).toEqual([]);
      expect(await codeSetFindings(t.db, { ...base, payerType: "commercial", lines: [{ lineNumber: 1, cpt: "11111", modifiers: [], units: 1 }] })).toEqual([]);
    } finally {
      await t.close();
    }
  });
});

describe("ICD-10-PCS on the 837I", () => {
  const input = (procedures: { code: string; date: string }[]): Edi837IInput => ({
    controlNumber: "CMD000777", interchangeControl: "123456789", senderId: "COLLABORATMD", receiverId: "00430", now: new Date("2026-09-25T10:00:00Z"),
    billingProvider: { name: "Summit Health", phone: "407-555-0100", npi: "1234567893", taxId: "74-1234567", address1: "1 Main", city: "Austin", state: "TX", zip: "78701" },
    attending: { lastName: "Reyes", firstName: "Hannah", npi: "1234567893", taxonomy: "207R00000X" },
    payer: { name: "Medicare Part A", payerId: "00430", type: "medicare" },
    subscriber: { lastName: "Nguyen", firstName: "Linh", memberId: "1EG4TE5MK73", dob: "1950-04-05", sex: "F", relationship: "self" },
    claim: { totalCents: 1_000_00, frequencyCode: "1", diagnoses: ["K80.20"], institutional: { typeOfBill: "0111", statementFrom: "2026-09-10", statementTo: "2026-09-14", admissionDate: "2026-09-10", admissionType: "1", admissionSource: "7", patientStatus: "01", procedures } },
    lines: [{ revenueCode: "0120", chargeCents: 1_000_00, units: 1, dateOfService: "2026-09-10" }],
  });

  it("sends the principal procedure as BBR and the rest as BBQ, twelve to a segment", () => {
    const others = Array.from({ length: 13 }, (_, k) => ({ code: `0DB${String.fromCharCode(65 + k)}4ZZ`.replace("I", "J").replace("O", "P"), date: "2026-09-12" }));
    const edi = buildEdi837I(input([{ code: "0FT44ZZ", date: "2026-09-11" }, ...others]));
    expect(validateStructure(edi)).toEqual([]);
    expect(edi).toContain("HI*BBR:0FT44ZZ:D8:20260911~");
    const bbq = edi.split("~").filter((s) => s.trim().startsWith("HI*BBQ"));
    expect(bbq.map((s) => s.split("*").length - 1)).toEqual([12, 1]);
    expect(buildEdi837I(input([]))).not.toContain("BBR");
  });

  it("checks the codes and dates, before and after the claim is made", () => {
    const base = { billingNpi: "1234567893", attendingNpi: "1234567893", memberId: "M1", payerId: "00430", diagnoses: ["K80.20"], today: "2026-09-25", lines: [{ lineNumber: 1, revenueCode: "0120", hcpcs: "", units: 1, chargeCents: 100 }] };
    const inst = input([]).claim.institutional;
    const rulesFor = (procedures: { code: string; date: string }[], tob = "0111") => scrubInstitutional({ ...base, institutional: { ...inst, typeOfBill: tob, procedures } }).map((f) => f.rule);
    expect(rulesFor([{ code: "0FT44ZZ", date: "2026-09-11" }])).not.toContain("PCS_FORMAT");
    expect(rulesFor([{ code: "0FT4IZZ", date: "2026-09-11" }])).toContain("PCS_FORMAT"); // I is never used
    expect(rulesFor([{ code: "0FT44ZZ", date: "2026-09-20" }])).toContain("PCS_DATE");
    expect(rulesFor([{ code: "0FT44ZZ", date: "2026-09-11" }], "0131")).toContain("PCS_OUTPATIENT");
    expect(pcsProcedures([{ code: "0ft4.4zz", date: "2026-09-11" }, { code: "", date: "" }])).toEqual([{ code: "0FT44ZZ", date: "2026-09-11" }]);
    expect(pcsProcedures([])).toBeNull();
    expect(() => pcsProcedures([{ code: "99213", date: "2026-09-11" }])).toThrow(/not an ICD-10-PCS code/);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let claim: typeof schema.claims.$inferSelect;
  let medicare: typeof schema.payers.$inferSelect;
  beforeAll(async () => {
    t = await testDb();
    [claim] = await t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.claimType, "professional"))).limit(1);
    [medicare] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "medicare"))).limit(1);
    await t.db.update(schema.claims).set({ payerId: medicare.id }).where(eq(schema.claims.id, claim.id));
  });
  afterAll(async () => { await t?.close(); });

  it("puts the NDC on the 837P as LIN and CTP", async () => {
    const [line] = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, claim.encounterId)).limit(1);
    await t.db.update(schema.charges).set({ cpt: "J1100", ndc: "00409123401", ndcUnit: "ML", ndcQuantity: 2 }).where(eq(schema.charges.id, line.id));
    const edi = buildClaimEdi((await loadClaimBundle(t.db, claim.id))!, { now: new Date("2026-09-25T10:00:00Z"), authorizationNumber: null, attachments: [] });
    expect(edi).toMatch(/SV1\*HC:J1100[^~]*~\s*DTP\*472\*D8\*\d{8}~\s*LIN\*\*N4\*00409123401~\s*CTP\*\*\*\*2\*ML~/);
    expect(validateStructure(edi)).toEqual([]);
  });

  it("posts a payer's takeback (PLB WO) to the claim it names, and keeps interest with the check", async () => {
    const other = { ...claim };
    const raw = buildEdi835({ payerName: "Medicare", payerId: "00430", checkNumber: "EFT777", paymentDate: new Date("2026-09-20T12:00:00Z"), claims: [] })
      .replace("SE*", `PLB*1234567893*20261231*WO:${other.controlNumber}*50.00*L6*-2.50*WO:NOPE123*10.00~\nSE*`);
    const parsed = parseEdi835(raw);
    expect(parsed.providerAdjustments).toEqual([
      { reason: "WO", reference: other.controlNumber, amountCents: 5000 },
      { reason: "L6", reference: "", amountCents: -250 },
      { reason: "WO", reference: "NOPE123", amountCents: 1000 },
    ]);
    const [remit] = await t.db.insert(schema.remittances).values({ practiceId: t.practiceId, payerName: "Medicare", checkNumber: "EFT777", amountCents: 0, paymentDate: "2026-09-20", raw835: raw }).returning();
    const before = await getClaimFinancials(t.db, claim.id);
    const r = await postProviderAdjustments(t.db, remit, parsed, t.userId);
    expect(r).toEqual({ takenBackCents: 5000, interestCents: 250, unmatched: 1, other: 0 });
    expect((await getClaimFinancials(t.db, claim.id)).insuranceBalanceCents).toBe(before.insuranceBalanceCents + 5000);
    const [note] = await t.db.select().from(schema.notifications).where(eq(schema.notifications.dedupeKey, `plb-${remit.id}`));
    expect(note.kind).toBe("plb_unmatched");

    const [unmatched] = await t.db.select().from(schema.remittanceAdjustments).where(and(eq(schema.remittanceAdjustments.remittanceId, remit.id), eq(schema.remittanceAdjustments.reference, "NOPE123")));
    await expect(matchTakeback(t.db, t.practiceId, unmatched.id, "NOT-A-CLAIM", t.userId)).rejects.toThrow(/No claim/);
    await matchTakeback(t.db, t.practiceId, unmatched.id, claim.controlNumber, t.userId);
    await expect(matchTakeback(t.db, t.practiceId, unmatched.id, claim.controlNumber, t.userId)).rejects.toThrow(/already/);
    expect((await getClaimFinancials(t.db, claim.id)).insuranceBalanceCents).toBe(before.insuranceBalanceCents + 6000);
  });

  it("checks tomorrow's coverage and names who needs attention", async () => {
    const tomorrow = new Date(clockDay(await practiceNow(t.db, t.practiceId, new Date())).getTime() + 86_400_000);
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: "UNINS-1", firstName: "Nora", lastName: "Uninsured", dob: "1990-01-01", sex: "F" }).returning();
    const at = new Date(tomorrow.getTime() + 15 * 3_600_000);
    await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: p.id, providerId: provider.id, startsAt: at, endsAt: new Date(at.getTime() + 1_800_000) });
    const r = await checkTomorrowsCoverage(t.db, t.practiceId);
    expect(r.noInsurance).toBeGreaterThanOrEqual(1);
    const [note] = await t.db.select().from(schema.notifications).where(and(eq(schema.notifications.practiceId, t.practiceId), eq(schema.notifications.kind, "coverage_tomorrow")));
    expect(note.body).toContain("Uninsured, Nora");
    expect(note.href).toBe(`/scheduling?date=${tomorrow.toISOString().slice(0, 10)}`);
  });

  it("walks a Medicare denial up the appeal levels with each deadline", async () => {
    const [denial] = await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: claim.id, category: "medical_necessity", carc: "50", amountCents: 12_000, appealDeadline: "2026-12-01" }).returning();
    const [first] = await appealLevelsFor(t.db, t.practiceId, denial.id);
    expect(first).toMatchObject({ level: 1, dueOn: "2026-12-01" });
    expect(first.name).toMatch(/Redetermination/);
    await expect(recordAppealDecision(t.db, t.practiceId, first.id, "upheld", "2999-01-01")).rejects.toThrow(/date/);
    const { next } = await recordAppealDecision(t.db, t.practiceId, first.id, "upheld", "2026-09-20", t.userId);
    expect(next).toMatchObject({ level: 2, dueOn: "2027-03-19" }); // 180 days for a QIC reconsideration
    const [d] = await t.db.select().from(schema.denials).where(eq(schema.denials.id, denial.id));
    expect(d).toMatchObject({ status: "in_progress", appealDeadline: "2027-03-19" });
    await expect(recordAppealDecision(t.db, t.practiceId, first.id, "overturned", "2026-09-21")).rejects.toThrow(/already/);
    await recordAppealDecision(t.db, t.practiceId, next!.id, "overturned", "2026-09-25", t.userId);
    expect((await t.db.select().from(schema.denials).where(eq(schema.denials.id, denial.id)))[0].status).toBe("resolved");
    expect(await appealLevelsFor(t.db, t.practiceId, denial.id)).toHaveLength(2);
  });

  it("records an ABN and keeps GA and the claim consistent with it", async () => {
    expect(parseAbnServices("82947, Blood sugar test, 25.00\n80061, Lipid panel, $40")).toEqual([
      { code: "82947", description: "Blood sugar test", estimatedCents: 2500 },
      { code: "80061", description: "Lipid panel", estimatedCents: 4000 },
    ]);
    expect(() => parseAbnServices("82947")).toThrow(/describe/);
    const patientId = claim.patientId;
    const lines = [{ lineNumber: 1, cpt: "82947", modifiers: ["GA"] }, { lineNumber: 2, cpt: "80061", modifiers: [] }];
    const c = { patientId, payerType: "medicare", dateOfService: "2026-09-10", lines };
    expect((await abnFindings(t.db, c)).map((f) => f.rule)).toEqual(["ABN_MISSING"]);

    const abn = await createAbn(t.db, t.practiceId, { patientId, serviceDate: "2026-09-10", services: parseAbnServices("82947, Blood sugar test, 25\n80061, Lipid panel, 40"), reason: "Medicare pays for this test only once a year" }, t.userId);
    await recordAbnChoice(t.db, t.practiceId, abn.id, 1, "2026-09-10", t.userId);
    expect((await abnFindings(t.db, c)).map((f) => `${f.rule}:${f.field}`)).toEqual(["ABN_GA:lines.2.modifiers"]);
    expect(await abnModifiers(t.db, patientId, "2026-09-10", [{ cpt: "82947", modifiers: ["GZ"] }, { cpt: "99213", modifiers: [] }])).toEqual([["GA"], []]);
    expect(await abnFindings(t.db, { ...c, payerType: "commercial" })).toEqual([]);
    // Signed after the service: it does not cover it.
    expect((await abnFindings(t.db, { ...c, dateOfService: "2026-09-09" })).map((f) => f.rule)).toEqual(["ABN_MISSING"]);

    await recordAbnChoice(t.db, t.practiceId, abn.id, 2, "2026-09-10", t.userId);
    expect((await abnFindings(t.db, c)).map((f) => f.rule)).toEqual(["ABN_OPTION_2", "ABN_OPTION_2"]);
    await expect(recordAbnChoice(t.db, t.practiceId, abn.id, 4, "2026-09-10")).rejects.toThrow(/option/);
  });

  it("starts the 60-day clock on a Medicare overpayment and warns before it runs out", async () => {
    const fin = await getClaimFinancials(t.db, claim.id);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: claim.patientId, claimId: claim.id, type: "insurance_payment", amountCents: fin.insuranceBalanceCents + 4_000, note: "paid twice" });
    const today = new Date().toISOString().slice(0, 10);
    const [clock] = (await overpaymentClocks(t.db, t.practiceId)).filter((c) => c.claimId === claim.id);
    expect(clock).toMatchObject({ overpaidCents: 4_000, identifiedOn: today, daysLeft: 60 });

    const fiftyDaysAgo = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
    await expect(setOverpaymentIdentified(t.db, t.practiceId, claim.id, "2999-01-01", t.userId)).rejects.toThrow(/future/);
    await setOverpaymentIdentified(t.db, t.practiceId, claim.id, fiftyDaysAgo, t.userId);
    const r = await overpaymentDeadlineAlerts(t.db, t.practiceId);
    expect(r.dueSoon).toBeGreaterThanOrEqual(1);
    const notes = await t.db.select().from(schema.notifications).where(and(eq(schema.notifications.practiceId, t.practiceId), eq(schema.notifications.kind, "overpayment_60day")));
    expect(notes.some((n) => n.title.includes(claim.controlNumber))).toBe(true);
    const [audit] = await t.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, claim.id), eq(schema.auditLog.action, "overpayment_identified_date")));
    expect(audit.details).toMatchObject({ from: today, to: fiftyDaysAgo });

    // Returned: the clock stops, and a later overpayment starts a new one.
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: claim.patientId, claimId: claim.id, type: "reversal", amountCents: 4_000, note: "refunded" });
    expect((await overpaymentClocks(t.db, t.practiceId)).some((c) => c.claimId === claim.id)).toBe(false);
    expect(await t.db.select().from(schema.overpaymentIdentifications).where(eq(schema.overpaymentIdentifications.claimId, claim.id))).toEqual([]);
  });
});
