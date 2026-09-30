import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { createEncounterWithClaim } from "./encounters";
import { loadClaimBundle, scrubBundle, writeOffClaim } from "./claims";
import { findDuplicates, mergePatients } from "./patient-merge";
import { searchPatients } from "./lists";
import { patientBalanceCents, generateStatement } from "./billing";
import { arRollforward, closePeriod } from "./accounting";
import { answerQuery, askProvider, queryFindings } from "./coding-queries";
import { saveThreshold, therapyFindings, therapyToDate } from "./therapy-threshold";
import { inferCategory, writeOffAnalysis } from "./write-offs";
import { fieldFromAaa, fieldFromAck, fieldFromCarc, registrationQuality } from "./registration";
import { openInjuryCase, recordReduction, settleInjuryCase } from "./injury-cases";
import { collectionCandidates } from "./collections";
import { auditDetail, createAudit, scoreItem } from "./coding-audits";

describe("pure parts", () => {
  it("sorts write-offs by why, as recorded or from the denial and note", () => {
    expect(inferCategory("authorization", "coding", null)).toBe("authorization");
    expect(inferCategory(null, "timely_filing", "Written off")).toBe("timely_filing");
    expect(inferCategory(null, null, "Charge removed: claim voided by CMD9")).toBe("void");
    expect(inferCategory(null, null, "Small balance")).toBe("small_balance");
    expect(inferCategory(null, "cob", null)).toBe("eligibility");
    expect(inferCategory(null, null, "misc")).toBe("other");
  });

  it("traces rejections and denials to the registration field", () => {
    expect([fieldFromAck("A7:164:IL"), fieldFromAck("A3:33:IL"), fieldFromAck("A7:21:QC"), fieldFromAck("A7:562:85")]).toEqual(["member_id", "member_id", "patient", null]);
    expect([fieldFromAaa("Invalid/missing subscriber/insured ID (AAA 72)"), fieldFromAaa("x (AAA 73)"), fieldFromAaa("x (AAA 71)"), fieldFromAaa("x (AAA 42)")]).toEqual(["member_id", "name", "dob", null]);
    expect([fieldFromCarc("31"), fieldFromCarc("27"), fieldFromCarc("109"), fieldFromCarc("45")]).toEqual(["identity", "coverage", "payer", null]);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let commercial: typeof schema.payers.$inferSelect;
  let medicare: typeof schema.payers.$inferSelect;
  const newPatient = async (mrn: string, payer = commercial, extra: Partial<typeof schema.patients.$inferInsert> = {}) => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn, firstName: "Dana", lastName: `Test${mrn.replace(/\W/g, "")}`, dob: "1960-02-02", sex: "F", ...extra }).returning();
    const [ins] = await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: payer.id, memberId: `${mrn.replace(/\W/g, "")}M`, relationship: "self", createdBy: t.userId, source: "staff" }).returning();
    return { patient: p, ins };
  };
  const visit = (patientId: string, dateOfService: string, lines: { cpt: string; modifiers?: string[]; units?: number; chargeCents?: number }[] = [{ cpt: "99213" }]) =>
    createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, dateOfService, placeOfService: "11", diagnoses: ["E11.9"], lines: lines.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers ?? [], units: l.units ?? 1, chargeCents: l.chargeCents ?? 12_000, dxPointers: [1] })) });

  beforeAll(async () => {
    t = await testDb();
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    [commercial] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
    [medicare] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "medicare"))).limit(1);
  });
  afterAll(async () => { await t?.close(); });

  it("finds duplicate patients and merges one into the other, money and all", async () => {
    const a = await newPatient("DUP-A", commercial, { lastName: "Rivera", firstName: "Lucia", dob: "1975-05-05" });
    const b = await newPatient("DUP-B", commercial, { lastName: "rivera", firstName: "LUCIA", dob: "1975-05-05", phone: "(407) 555-0199" });
    await t.db.insert(schema.ledgerEntries).values([
      { practiceId: t.practiceId, patientId: a.patient.id, type: "transfer_to_patient", amountCents: 3_000 },
      { practiceId: t.practiceId, patientId: b.patient.id, type: "transfer_to_patient", amountCents: 2_000 },
    ]);
    await visit(b.patient.id, "2026-08-01");
    await t.db.insert(schema.careProgramConsents).values([
      { practiceId: t.practiceId, patientId: a.patient.id, program: "ccm", consentedOn: "2026-01-01" },
      { practiceId: t.practiceId, patientId: b.patient.id, program: "ccm", consentedOn: "2026-02-01" },
    ]);
    const pair = (await findDuplicates(t.db, t.practiceId)).find((d) => [d.a.id, d.b.id].includes(a.patient.id) && [d.a.id, d.b.id].includes(b.patient.id));
    expect(pair?.reasons).toContain("Same name and date of birth");
    // Moving money between patients is still refused outside a merge.
    await expect(t.db.update(schema.ledgerEntries).set({ patientId: a.patient.id }).where(eq(schema.ledgerEntries.patientId, b.patient.id))).rejects.toThrow();

    const r = await mergePatients(t.db, t.practiceId, a.patient.id, b.patient.id, t.userId);
    expect(r.moved["ledger_entries.patient_id"]).toBe(2); // the balance moved to patient, and the visit's charge
    expect(r.moved["claims.patient_id"]).toBe(1);
    expect(await patientBalanceCents(t.db, a.patient.id)).toBe(5_000);
    const [kept] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, a.patient.id));
    expect(kept.phone).toBe("(407) 555-0199");
    expect((await t.db.select().from(schema.careProgramConsents).where(eq(schema.careProgramConsents.patientId, a.patient.id))).length).toBe(1);
    const found = await searchPatients(t.db, t.practiceId, { q: "Rivera", offset: 0, limit: 10 });
    expect(found.rows.map((p) => p.id)).toEqual([a.patient.id]);
    // Running it again finishes nothing more and does no harm; merging into the merged record is refused.
    expect((await mergePatients(t.db, t.practiceId, a.patient.id, b.patient.id)).moved).toEqual({});
    await expect(mergePatients(t.db, t.practiceId, b.patient.id, a.patient.id)).rejects.toThrow(/merged/);
  });

  it("gives an A/R rollforward that reconciles, and locks a closed month", async () => {
    const { patient } = await newPatient("ROLL-1");
    const at = (d: string) => new Date(`${d}T15:00:00Z`);
    await t.db.insert(schema.ledgerEntries).values([
      { practiceId: t.practiceId, patientId: patient.id, type: "charge", amountCents: 50_000, postedAt: at("2031-03-02") },
      { practiceId: t.practiceId, patientId: patient.id, type: "insurance_payment", amountCents: 30_000, postedAt: at("2031-04-05") },
      { practiceId: t.practiceId, patientId: patient.id, type: "adjustment", amountCents: 10_000, postedAt: at("2031-04-05") },
      { practiceId: t.practiceId, patientId: patient.id, type: "transfer_to_patient", amountCents: 10_000, postedAt: at("2031-04-05") },
      { practiceId: t.practiceId, patientId: patient.id, type: "patient_payment", amountCents: 4_000, postedAt: at("2031-04-20") },
    ]);
    const before = await arRollforward(t.db, t.practiceId, "2031-03");
    const r = await arRollforward(t.db, t.practiceId, "2031-04");
    expect(r.reconciles).toBe(true);
    expect({ ins: r.closing.insurance - r.opening.insurance, pat: r.closing.patient - r.opening.patient }).toEqual({ ins: -50_000, pat: 6_000 });
    expect(r.opening).toEqual(before.closing);
    await closePeriod(t.db, t.practiceId, "2031-04", t.userId, new Date("2031-05-02"));
    // Only the closed month is locked: before and after it still take entries.
    await expect(t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "patient_payment", amountCents: 100, postedAt: at("2031-04-30") })).rejects.toThrow();
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "patient_payment", amountCents: 100, postedAt: at("2031-05-03") });
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "patient_payment", amountCents: 100, postedAt: at("2031-03-31") });
  });

  it("holds a claim while a question to the provider is open", async () => {
    const { patient } = await newPatient("QRY-1");
    const { claim, encounter } = await visit(patient.id, "2026-08-10", [{ cpt: "99215" }]);
    const q = await askProvider(t.db, t.practiceId, { encounterId: encounter.id, topic: "level", question: "The note supports moderate decision making; which supports 99215?" });
    expect((await queryFindings(t.db, encounter.id)).map((f) => `${f.rule}:${f.severity}`)).toEqual(["CODING_QUERY:error"]);
    const findings = (await scrubBundle(t.db, (await loadClaimBundle(t.db, claim.id))!)).findings;
    expect(findings.some((f) => f.rule === "CODING_QUERY")).toBe(true);
    const [other] = await t.db.insert(schema.practices).values({ name: "Else", taxId: "66-6666666", npi: "6666666665", address1: "6 Ash", city: "Austin", state: "TX", zip: "78701" }).returning();
    await expect(answerQuery(t.db, other.id, q.id, "Time was 45 minutes")).rejects.toThrow(/not found/);
    await answerQuery(t.db, t.practiceId, q.id, "Total time 45 minutes, documented in an addendum");
    expect(await queryFindings(t.db, encounter.id)).toEqual([]);
  });

  it("flags Medicare therapy over the year's threshold without KX", async () => {
    const { patient } = await newPatient("KX-1", medicare);
    const lines = (mods: string[], units = 4) => [{ lineNumber: 1, cpt: "97110", modifiers: mods, units, chargeCents: 10_000 }];
    const rules = (f: { rule: string; severity: string }[]) => f.map((x) => `${x.rule}:${x.severity}`);
    const { encounter: now } = await visit(patient.id, "2026-09-10", lines(["GP"]));
    const check = (mods: string[], units = 4) => therapyFindings(t.db, { patientId: patient.id, encounterId: now.id, payerType: "medicare", dateOfService: "2026-09-10", lines: lines(mods, units) });
    await visit(patient.id, "2026-03-01", [{ cpt: "97110", modifiers: ["GP"], units: 4, chargeCents: 10_000 }]);
    await visit(patient.id, "2026-04-01", [{ cpt: "97530", modifiers: ["GP"], units: 3, chargeCents: 12_000 }]);
    // No threshold entered for the year: nothing is checked.
    expect(await check(["GP"])).toEqual([]);
    await saveThreshold(t.db, { year: 2026, kxCents: 100_000, reviewCents: 160_000 }, "test");
    expect(await therapyToDate(t.db, patient.id, 2026, now.id)).toEqual({ pt_slp: 76_000, ot: 0 });
    // 76,000 before and 40,000 on this visit: over 100,000 without KX.
    expect(rules(await check(["GP"]))).toEqual(["THERAPY_KX:warning"]);
    expect(await check(["GP", "KX"])).toEqual([]);
    // Over the review amount too.
    expect(rules(await check(["GP", "KX"], 10))).toEqual(["THERAPY_REVIEW:warning"]);
    // Occupational therapy counts on its own; other payers are not checked.
    expect(await check(["GO"])).toEqual([]);
    expect(await therapyFindings(t.db, { patientId: patient.id, encounterId: now.id, payerType: "commercial", dateOfService: "2026-09-10", lines: lines(["GP"]) })).toEqual([]);
  });

  it("records why a balance is written off and sorts avoidable from contractual", async () => {
    const { patient } = await newPatient("WO-1");
    const { claim } = await visit(patient.id, "2026-07-01", [{ cpt: "99213", chargeCents: 20_000 }]);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, claimId: claim.id, type: "adjustment", amountCents: 5_000, groupCode: "CO", reasonCode: "45" });
    await expect(writeOffClaim(t.db, claim.id, "x", t.userId, "because")).rejects.toThrow(/why/);
    await writeOffClaim(t.db, claim.id, "Filed after the payer's limit", t.userId, "timely_filing");
    const [entry] = await t.db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.claimId, claim.id), eq(schema.ledgerEntries.type, "write_off")));
    expect(entry).toMatchObject({ writeOffCategory: "timely_filing" });
    const today = new Date().toISOString().slice(0, 10);
    const a = await writeOffAnalysis(t.db, t.practiceId, "2020-01-01", today);
    expect(a.byCategory.find((c) => c.key === "timely_filing")?.cents).toBeGreaterThanOrEqual(entry.amountCents);
    expect(a.byKind.find((k) => k.key === "avoidable")!.cents).toBeGreaterThanOrEqual(entry.amountCents);
    expect(a.byKind.find((k) => k.key === "contractual")!.cents).toBeGreaterThanOrEqual(5_000);
  });

  it("traces rejections, refused coverage checks and denials to registration and to who entered the policy", async () => {
    const { patient, ins } = await newPatient("REG-1");
    const { claim } = await visit(patient.id, "2026-09-01");
    await t.db.update(schema.claims).set({ patientInsuranceId: ins.id }).where(eq(schema.claims.id, claim.id));
    await t.db.insert(schema.claimAcknowledgments).values({ claimId: claim.id, kind: "277CA", accepted: false, code: "A7:164:IL", message: "Member number" });
    await t.db.insert(schema.eligibilityChecks).values({ patientInsuranceId: ins.id, status: "inactive", message: "Invalid/missing subscriber/insured ID (AAA 72)" });
    await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: claim.id, category: "eligibility", carc: "31", amountCents: 12_000 });
    const today = new Date().toISOString().slice(0, 10);
    const r = await registrationQuality(t.db, t.practiceId, "2026-01-01", today);
    const mine = r.issues.filter((i) => i.patientId === patient.id);
    expect(mine.map((i) => `${i.kind}:${i.field}`).sort()).toEqual(["coverage_check:member_id", "denial:identity", "rejection:member_id"]);
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    expect(new Set(mine.map((i) => i.enteredBy))).toEqual(new Set([user.name]));
  });

  it("holds a personal injury balance from billing until the case settles", async () => {
    const { patient } = await newPatient("PI-1");
    const { claim } = await visit(patient.id, "2026-08-20", [{ cpt: "99214", chargeCents: 80_000 }]);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, claimId: claim.id, type: "transfer_to_patient", amountCents: 80_000 });
    const c = await openInjuryCase(t.db, t.practiceId, { patientId: patient.id, attorney: "Jordan Lee", firm: "Lee Injury Law", lienSignedOn: "2026-09-01" });
    await expect(generateStatement(t.db, t.practiceId, patient.id)).rejects.toThrow(/personal injury/);
    expect((await collectionCandidates(t.db, t.practiceId)).some((x) => x.patientId === patient.id)).toBe(false);
    await expect(recordReduction(t.db, t.practiceId, c.id, { agreedCents: 90_000 })).rejects.toThrow(/more than the balance/);
    await recordReduction(t.db, t.practiceId, c.id, { requestedCents: 30_000, agreedCents: 20_000 });
    const r = await settleInjuryCase(t.db, t.practiceId, c.id, { settledOn: "2026-09-20", paidCents: 55_000, method: "Check 1042" });
    expect(r.balanceCents).toBe(5_000);
    // Normal billing resumes for what is left.
    await expect(generateStatement(t.db, t.practiceId, patient.id)).resolves.toBeTruthy();
  });

  it("samples each provider's claims for a coding audit and scores accuracy", async () => {
    const { patient } = await newPatient("AUD-1");
    for (const d of ["2026-06-01", "2026-06-02", "2026-06-03"]) {
      const { claim } = await visit(patient.id, d);
      await t.db.update(schema.claims).set({ submittedAt: new Date(`${d}T12:00:00Z`) }).where(eq(schema.claims.id, claim.id));
    }
    const { audit, claims } = await createAudit(t.db, t.practiceId, { name: "June check", fromDate: "2026-06-01", toDate: "2026-06-30", perProvider: 2 });
    expect(claims).toBeLessThanOrEqual(2 * (await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId))).length);
    const d = await auditDetail(t.db, t.practiceId, audit.id);
    expect(d.items.filter((i) => i.provider_id === providerId).length).toBe(2);
    const [first, second] = d.items.filter((i) => i.provider_id === providerId);
    await expect(scoreItem(t.db, t.practiceId, first.id!, { result: "error" })).rejects.toThrow(/what the error/);
    await scoreItem(t.db, t.practiceId, first.id!, { result: "error", finding: "level_high", billedCode: "99214", correctCode: "99213" });
    await scoreItem(t.db, t.practiceId, second.id!, { result: "correct" });
    const p = (await auditDetail(t.db, t.practiceId, audit.id)).providers.find((x) => x.reviewed === 2)!;
    expect(p).toMatchObject({ errors: 1, accuracy: 0.5, belowTarget: true, findings: { level_high: 1 } });
  });
});
