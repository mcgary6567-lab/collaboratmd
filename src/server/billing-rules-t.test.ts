import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { createEncounterWithClaim } from "./encounters";
import { loadClaimBundle, scrubBundle } from "./claims";
import { buildClaimEdi } from "./claim-edi";
import { generateStatementBatch } from "./billing";
import { addReferral, referralFor, referralsRunningOut } from "./referrals-in";
import { applySubstitute, saveArrangement, substituteFindings } from "./substitutes";
import { certifyPlan, disciplineOfLine, planOfCareFindings, plansNeedingAction, recertify, savePlan } from "./therapy-plans";
import { superbillFor } from "./superbill";
import { otherCoverageDue, otherCoverageList, recordOtherCoverage } from "./other-coverage";
import { cardExpiresOn, expiringCards, sendCardUpdateLink } from "./card-expiry";
import { createPortalLink, handleStripeEvent, startCardUpdate } from "./portal";
import { interpreterReport, logInterpreter, t1013Units } from "./interpreters";
import { cycleLabel, cycleOfDay, cycleOfName } from "@/lib/billing/statement-cycles";

describe("pure parts", () => {
  it("splits patients and the month into statement cycles", () => {
    expect(["Adams", "Diaz", "Evans", "Kim", "Lee", "Rossi", "Smith", "Zhou", "  o'brien", "123"].map((n) => cycleOfName(n, 4))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 2, 3]);
    expect(["Adams", "Kim", "Lee", "Zhou"].map((n) => cycleOfName(n, 2))).toEqual([0, 0, 1, 1]);
    expect(cycleOfName("Zhou", 1)).toBe(0);
    expect([1, 7, 8, 14, 15, 21, 22, 28, 31].map((d) => cycleOfDay(d, 4))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3]);
    expect([1, 14, 15, 31].map((d) => cycleOfDay(d, 2))).toEqual([0, 0, 1, 1]);
    expect(cycleOfDay(20, 3)).toBe(0); // anything but 2 or 4 is one batch
    expect(cycleLabel(2, 4)).toBe("last names L–R");
  });

  it("knows card expiry, T1013 units, therapy modifiers and when to ask about other insurance", () => {
    expect(cardExpiresOn(2, 2028)).toBe("2028-02-29");
    expect(cardExpiresOn(12, 2026)).toBe("2026-12-31");
    expect([1, 15, 16, 40, 60].map(t1013Units)).toEqual([1, 1, 2, 3, 4]);
    expect([disciplineOfLine(["gp"]), disciplineOfLine(["GO", "KX"]), disciplineOfLine(["GN"]), disciplineOfLine(["25"])]).toEqual(["pt", "ot", "slp", null]);
    expect(otherCoverageDue(null, "2026-09-30")).toBe(true);
    expect(otherCoverageDue("2026-01-15", "2026-09-30")).toBe(false);
    expect(otherCoverageDue("2025-09-29", "2026-09-30")).toBe(true);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let commercial: typeof schema.payers.$inferSelect;
  let medicare: typeof schema.payers.$inferSelect;
  let medicaid: typeof schema.payers.$inferSelect;
  const today = new Date().toISOString().slice(0, 10);
  const newPatient = async (mrn: string, payer = commercial, extra: Partial<typeof schema.patients.$inferInsert> = {}) => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn, firstName: "Dana", lastName: `Test${mrn.replace(/\W/g, "")}`, dob: "1960-02-02", sex: "F", ...extra }).returning();
    await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: payer.id, memberId: `${mrn.replace(/\W/g, "")}M`, relationship: "self" });
    return p;
  };
  const visit = (patientId: string, dateOfService: string, lines: { cpt: string; modifiers?: string[]; chargeCents?: number }[] = [{ cpt: "99213" }]) =>
    createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, dateOfService, placeOfService: "11", diagnoses: ["E11.9"], lines: lines.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers ?? [], units: 1, chargeCents: l.chargeCents ?? 12_000, dxPointers: [1] })) });
  const rules = async (claimId: string) => {
    const b = await loadClaimBundle(t.db, claimId);
    return (await scrubBundle(t.db, b!)).findings.map((f) => f.rule);
  };

  beforeAll(async () => {
    t = await testDb();
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    const payer = async (type: string) => (await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, type))).limit(1))[0];
    [commercial, medicare, medicaid] = await Promise.all([payer("commercial"), payer("medicare"), payer("medicaid")]);
  });
  afterAll(async () => { await t?.close(); });

  it("puts an HMO referral number on the claim and counts the visits it allows", async () => {
    const [hmo] = await t.db.insert(schema.payers).values({ practiceId: t.practiceId, name: "Sunshine HMO", payerId: "HMO01", type: "commercial", requiresReferral: true }).returning();
    const p = await newPatient("REF-1", hmo);
    const { claim: first } = await visit(p.id, "2026-08-03");
    expect(await rules(first.id)).toContain("REFERRAL_MISSING");
    await expect(addReferral(t.db, t.practiceId, { patientId: p.id, payerId: hmo.id, referralNumber: "R-9", startsOn: "2026-08-10", endsOn: "2026-08-01" })).rejects.toThrow(/dates/);
    await addReferral(t.db, t.practiceId, { patientId: p.id, payerId: hmo.id, referralNumber: "R-7731", referringName: "Dr. Primary", referringNpi: "1234567893", visitsAllowed: 1, startsOn: "2026-08-01", endsOn: "2026-10-31" }, t.userId);
    const bundle = await loadClaimBundle(t.db, first.id);
    expect(bundle?.referralNumber).toBe("R-7731");
    expect(await rules(first.id)).not.toContain("REFERRAL_MISSING");
    const edi = buildClaimEdi(bundle!, { now: new Date("2026-08-05T12:00:00Z"), authorizationNumber: null, attachments: [] });
    expect(edi).toContain("REF*9F*R-7731~");
    // The one visit is used by the first claim; a second visit is not covered.
    const { claim: second } = await visit(p.id, "2026-08-20");
    expect(await referralFor(t.db, { patientId: p.id, payerId: hmo.id, dateOfService: "2026-08-20" })).toBeNull();
    expect(await rules(second.id)).toContain("REFERRAL_MISSING");
    expect((await referralsRunningOut(t.db, t.practiceId, 14, new Date("2026-09-01T12:00:00Z"))).find((r) => r.r.referralNumber === "R-7731")?.left).toBe(-1);
    // A plan that does not require referrals is never flagged.
    const q = await newPatient("REF-2");
    expect(await rules((await visit(q.id, "2026-08-03")).claim.id)).not.toContain("REFERRAL_MISSING");
  });

  it("bills a locum tenens visit under the absent physician with Q6, inside Medicare's 60 days", async () => {
    await expect(saveArrangement(t.db, t.practiceId, { absentProviderId: providerId, kind: "locum", substituteName: "Dr. Fill", substituteNpi: "123", startsOn: "2026-07-01", endsOn: "2026-08-30" })).rejects.toThrow(/NPI/);
    const saved = await saveArrangement(t.db, t.practiceId, { absentProviderId: providerId, kind: "locum", substituteName: "Dr. Fill In", substituteNpi: "1972648301", startsOn: "2026-07-01", endsOn: "2026-09-15" }, t.userId);
    expect(saved.overMedicareLimit).toBe(true);
    const p = await newPatient("LOC-1", medicare);
    const { claim, encounter } = await visit(p.id, "2026-07-20", [{ cpt: "99213" }, { cpt: "36415" }]);
    await applySubstitute(t.db, t.practiceId, claim.id, saved.arrangement.id, t.userId);
    const lines = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, encounter.id));
    expect(lines.every((l) => l.modifiers.includes("Q6"))).toBe(true);
    expect((await rules(claim.id)).filter((r) => r.startsWith("SUBSTITUTE"))).toEqual([]);
    // Day 62 of the absence: Medicare needs the substitute's own enrollment.
    const late = await visit(p.id, "2026-08-31");
    await expect(applySubstitute(t.db, t.practiceId, late.claim.id, saved.arrangement.id)).rejects.toThrow(/60 continuous days/);
    // Q6 typed by hand with no arrangement linked is flagged; removing it strips the modifier.
    expect((await substituteFindings(t.db, { providerId, substituteId: null, payerType: "medicare", dateOfService: "2026-07-20", lines: [{ lineNumber: 1, modifiers: ["Q6"] }] })).map((f) => f.rule)).toEqual(["SUBSTITUTE_RECORD"]);
    await applySubstitute(t.db, t.practiceId, claim.id, null);
    const after = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, encounter.id));
    expect(after.some((l) => l.modifiers.includes("Q6"))).toBe(false);
  });

  it("checks Medicare therapy against a certified plan of care", async () => {
    const p = await newPatient("POC-1", medicare);
    const check = (dos: string) => planOfCareFindings(t.db, { patientId: p.id, payerType: "medicare", dateOfService: dos, lines: [{ lineNumber: 1, modifiers: ["GP"] }] }).then((f) => f.map((x) => x.rule));
    expect(await check("2026-07-10")).toEqual(["THERAPY_PLAN"]);
    expect(await planOfCareFindings(t.db, { patientId: p.id, payerType: "commercial", dateOfService: "2026-07-10", lines: [{ lineNumber: 1, modifiers: ["GP"] }] })).toEqual([]);
    await expect(savePlan(t.db, t.practiceId, { patientId: p.id, discipline: "pt", startsOn: "2026-07-01", endsOn: "2026-10-15" })).rejects.toThrow(/90 days/);
    await expect(savePlan(t.db, t.practiceId, { patientId: p.id, discipline: "pt", startsOn: "2026-07-01", endsOn: "2026-09-28", certifiedOn: "2026-08-15", certifierName: "Dr. Ortho" })).rejects.toThrow(/reason/);
    const plan = await savePlan(t.db, t.practiceId, { patientId: p.id, discipline: "pt", startsOn: "2026-07-01", endsOn: "2026-09-28" }, t.userId);
    expect(await check("2026-07-20")).toEqual([]); // still inside the 30 days to sign
    expect(await check("2026-08-10")).toEqual(["THERAPY_CERTIFICATION"]);
    expect((await plansNeedingAction(t.db, t.practiceId, 14, new Date("2026-08-10T12:00:00Z"))).find((x) => x.plan.id === plan.id)).toMatchObject({ uncertified: true, certificationLate: true });
    await certifyPlan(t.db, t.practiceId, plan.id, { certifiedOn: "2026-08-12", certifierName: "Dr. Ortho", certifierNpi: "1497758544", delayReason: "Physician out of office" }, t.userId);
    expect(await check("2026-08-20")).toEqual([]);
    const after = await planOfCareFindings(t.db, { patientId: p.id, payerType: "medicare", dateOfService: "2026-10-05", lines: [{ lineNumber: 1, modifiers: ["GP"] }] });
    expect(after[0].message).toMatch(/ended 2026-09-28/);
    const next = await recertify(t.db, t.practiceId, plan.id, "2026-12-26");
    expect(next.startsOn).toBe("2026-09-29");
    // An occupational therapy line needs its own plan.
    expect((await planOfCareFindings(t.db, { patientId: p.id, payerType: "medicare", dateOfService: "2026-08-20", lines: [{ lineNumber: 2, modifiers: ["GO"] }] })).map((f) => f.rule)).toEqual(["THERAPY_PLAN"]);
  });

  it("prints a superbill with codes, diagnoses, NPI, tax ID and what was paid", async () => {
    const p = await newPatient("SB-1");
    const { claim, encounter } = await visit(p.id, "2026-09-02", [{ cpt: "99214", chargeCents: 18_000 }, { cpt: "36415", chargeCents: 1_500 }]);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: p.id, claimId: claim.id, type: "patient_payment", amountCents: 5_000 });
    const sb = await superbillFor(t.db, t.practiceId, encounter.id);
    expect(sb?.items.map((i) => [i.cpt, i.chargeCents])).toEqual([["99214", 18_000], ["36415", 1_500]]);
    expect(sb?.totalCents).toBe(19_500);
    expect(sb?.paidCents).toBe(5_000);
    expect(sb?.diagnoses[0]).toMatchObject({ pointer: "A", code: "E11.9" });
    expect(sb?.practice.taxId).toBeTruthy();
    expect(sb?.prov.npi).toMatch(/^\d{10}$/);
    expect(await superbillFor(t.db, "00000000-0000-0000-0000-000000000000", encounter.id)).toBeNull();
  });

  it("asks about other insurance once a year and lists who said yes", async () => {
    const p = await newPatient("COB-1");
    await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: p.id, providerId, startsAt: new Date(Date.now() + 3 * 86_400_000), endsAt: new Date(Date.now() + 3 * 86_400_000 + 1_800_000) });
    expect((await otherCoverageList(t.db, t.practiceId)).due.map((d) => d.id)).toContain(p.id);
    await recordOtherCoverage(t.db, t.practiceId, p.id, { answer: "yes", detail: "Spouse's Aetna plan", via: "staff" }, t.userId);
    const after = await otherCoverageList(t.db, t.practiceId);
    expect(after.due.map((d) => d.id)).not.toContain(p.id);
    expect(after.said.find((s) => s.id === p.id)?.detail).toBe("Spouse's Aetna plan");
    await recordOtherCoverage(t.db, t.practiceId, p.id, { answer: "no", detail: "ignored", via: "checkin" });
    const [row] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, p.id));
    expect([row.otherCoverage, row.otherCoverageDetail, row.otherCoverageCheckedOn]).toEqual([false, null, today]);
  });

  it("finds expiring cards, sends the link, and replaces the card keeping its authorization", async () => {
    const p = await newPatient("CARD-1");
    const [old] = await t.db.insert(schema.savedCards).values({ practiceId: t.practiceId, patientId: p.id, providerCustomer: "cus_1", providerMethod: "pm_old", brand: "visa", last4: "4242", expMonth: 10, expYear: 2026, balanceMaxCents: 20_000, balanceAuthorizedAt: new Date("2026-01-05T00:00:00Z") }).returning();
    const q = await newPatient("CARD-2");
    await t.db.insert(schema.savedCards).values({ practiceId: t.practiceId, patientId: q.id, providerCustomer: "cus_2", providerMethod: "pm_2", last4: "1111", expMonth: 12, expYear: 2027, balanceMaxCents: 20_000 });
    const now = new Date("2026-09-30T12:00:00Z");
    const list = await expiringCards(t.db, t.practiceId, 45, now);
    expect(list.map((c) => c.card.id)).toEqual([old.id]);
    expect(list[0]).toMatchObject({ expiresOn: "2026-10-31", uses: ["balances after insurance"], expired: false });
    const sent = await sendCardUpdateLink(t.db, t.practiceId, old.id, { origin: "https://example.test", userId: t.userId });
    expect(sent.sms).toBe("skipped"); // texting and email are not set up in tests

    const link = await createPortalLink(t.db, t.practiceId, p.id);
    let setup: Record<string, unknown> | null = null;
    const r = await startCardUpdate(t.db, link.link.id, { origin: "https://example.test", token: link.token }, { createSetupCheckout: async (x) => { setup = x; return { id: "cs_setup", url: "https://checkout.example/setup" }; } });
    expect(r.url).toBe("https://checkout.example/setup");
    expect(setup).toMatchObject({ customer: "cus_1", metadata: { card_update: "1", saved_card_id: old.id } });

    const client = {
      getSetupIntent: async () => ({ id: "seti_1", status: "succeeded", payment_method: "pm_new", customer: "cus_1" }),
      getPaymentMethod: async () => ({ id: "pm_new", card: { brand: "mastercard", last4: "5555", exp_month: 8, exp_year: 2030 } }),
      getPaymentIntent: async () => { throw new Error("not used"); },
    };
    const event = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_setup", mode: "setup", setup_intent: "seti_1", metadata: { card_update: "1", practice_id: t.practiceId, patient_id: p.id, saved_card_id: old.id } } } };
    expect(await handleStripeEvent(t.db, event as never, client, t.practiceId)).toEqual({ handled: true, duplicate: false });
    expect(await handleStripeEvent(t.db, event as never, client, t.practiceId)).toEqual({ handled: true, duplicate: true });
    const active = await t.db.select().from(schema.savedCards).where(and(eq(schema.savedCards.patientId, p.id), isNull(schema.savedCards.removedAt)));
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ last4: "5555", expYear: 2030, balanceMaxCents: 20_000, providerCustomer: "cus_1" });
    await expect(handleStripeEvent(t.db, event as never, client, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/another practice/);
  });

  it("logs interpreters and counts Medicaid T1013 units", async () => {
    const p = await newPatient("INT-1", medicaid);
    await expect(logInterpreter(t.db, t.practiceId, { patientId: p.id, servedOn: "2026-09-10", mode: "phone", minutes: 20 })).rejects.toThrow(/language/);
    await logInterpreter(t.db, t.practiceId, { patientId: p.id, servedOn: "2026-09-10", language: "Haitian Creole", mode: "phone", vendor: "LanguageLine", minutes: 40, costCents: 4_000 }, t.userId);
    await logInterpreter(t.db, t.practiceId, { patientId: p.id, servedOn: "2026-09-12", mode: "in_person", minutes: 0, declined: true, notes: "Used her adult son" });
    const [row] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, p.id));
    expect(row.interpreterLanguage).toBe("Haitian Creole");
    const r = await interpreterReport(t.db, t.practiceId, "2026-09-01", "2026-09-30");
    expect(r.byLanguage).toEqual([{ key: "Haitian Creole", sessions: 1, minutes: 40, costCents: 4_000 }]);
    expect(r.declined).toBe(1);
    expect(r.medicaidUnits).toBe(3);
  });

  it("bills only the statement cycle whose part of the month it is", async () => {
    const adams = await newPatient("CYC-1", commercial, { lastName: "Adams" });
    const zhou = await newPatient("CYC-2", commercial, { lastName: "Zhou" });
    for (const p of [adams, zhou]) {
      const { claim } = await visit(p.id, "2026-08-01");
      await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: p.id, claimId: claim.id, type: "transfer_to_patient", amountCents: 7_500 });
    }
    const early = new Date("2026-10-05T16:00:00Z"); // the 5th: the first half of the month, A–K
    const r = await generateStatementBatch(t.db, t.practiceId, { minBalanceCents: 7_000, cycles: 2, now: early });
    expect(r.cycle).toBe(0);
    const billed = async (id: string) => (await t.db.select().from(schema.statements).where(eq(schema.statements.patientId, id))).length;
    expect(await billed(adams.id)).toBe(1);
    expect(await billed(zhou.id)).toBe(0);
    const late = await generateStatementBatch(t.db, t.practiceId, { minBalanceCents: 7_000, cycles: 2, now: new Date("2026-10-20T16:00:00Z") });
    expect(late.cycle).toBe(1);
    expect(await billed(zhou.id)).toBe(1);
  });
});
