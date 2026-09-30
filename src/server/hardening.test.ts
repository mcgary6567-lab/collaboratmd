import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { ALL_PAGES } from "@/lib/nav";
import { settingsFor } from "@/lib/settings-sections";
import { guideFor } from "@/content/help";
import { exportPlan, practiceExport } from "./practice-export";
import { deletePracticeData } from "./offboarding";
import { createAbn, recordAbnChoice } from "./abn";
import { createRecordsRequest, markRecordsSent } from "./records-requests";
import { createNsaDispute, startNegotiation } from "./nsa-disputes";
import { agreeRefundDemand, createRefundDemand } from "./refund-demands";
import { recordAppealDecision, appealLevelsFor } from "./appeal-levels";
import { applySlidingFees, recordSlidingFee, saveGuidelines, saveTiers } from "./sliding-fee";
import { shouldBlock, warningOutcomes } from "./warning-outcomes";
import { rulesSetup } from "./setup-rules";

/** Tables that hold no practice's data: national code sets, platform operations, the migration log. */
const NOT_PRACTICE_DATA = new Set([
  "_migrations", "anesthesia_base_units", "auth_throttle", "code_set_loads", "contact_messages", "coverage_policy_codes", "cpt_codes", "error_events",
  "hcc_mappings", "hcpcs_codes", "heartbeats", "icd10_codes", "medicare_telehealth_codes", "mpfs_localities", "mpfs_rvus", "mpfs_years",
  "ncci_mue", "ncci_ptp", "ops_alerts", "ordering_referring", "restore_tests", "saml_requests", "therapy_thresholds",
]);

describe("practice data coverage", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("exports every table that can hold a practice's data, including ones reached through a grandparent", async () => {
    const plan = await exportPlan(t.db);
    const inPlan = new Set(plan.sources.map((s) => s.table));
    const { rows } = await t.db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const uncovered = rows.map((r) => r.table_name).filter((n) => !inPlan.has(n) && !NOT_PRACTICE_DATA.has(n));
    // A new table must reach a practice (a practice_id, or a parent that has one), or be added to the list above on purpose.
    expect(uncovered).toEqual([]);
    expect(inPlan.has("eligibility_checks")).toBe(true); // check -> insurance -> patient -> practice
  });

  it("puts only this practice's eligibility checks in its export", async () => {
    const [other] = await t.db.insert(schema.practices).values({ name: "Elsewhere", taxId: "33-3333333", npi: "3333333335", address1: "3 Oak", city: "Austin", state: "TX", zip: "78701" }).returning();
    const [payer] = await t.db.insert(schema.payers).values({ practiceId: other.id, name: "Other payer", payerId: "OTH01" }).returning();
    const [p] = await t.db.insert(schema.patients).values({ practiceId: other.id, mrn: "O-1", firstName: "Other", lastName: "Practice", dob: "1970-01-01", sex: "F" }).returning();
    const [ins] = await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: payer.id, memberId: "OTHER-MEMBER", relationship: "self" }).returning();
    await t.db.insert(schema.eligibilityChecks).values({ patientInsuranceId: ins.id, status: "active", planName: "NOT-THIS-PRACTICE" });
    const chunks: Uint8Array[] = [];
    for await (const c of practiceExport(t.db, t.practiceId)) chunks.push(c);
    const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
    const checks = strFromU8(files["tables/eligibility_checks.csv"]);
    expect(checks).not.toContain("NOT-THIS-PRACTICE");
    const mine = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM eligibility_checks ec JOIN patient_insurances pi ON pi.id = ec.patient_insurance_id JOIN patients pt ON pt.id = pi.patient_id WHERE pt.practice_id = ${t.practiceId}`);
    expect(checks.trim().split("\r\n").length - 1).toBe(Number(mine.rows[0].n));

    // Closing that practice deletes its rows everywhere, the new tables included.
    const [claimless] = await t.db.insert(schema.recordsRequests).values({ practiceId: other.id, kind: "adr", receivedOn: "2026-09-01", dueOn: "2026-10-16" }).returning();
    await t.db.insert(schema.careProgramConsents).values({ practiceId: other.id, patientId: p.id, program: "ccm", consentedOn: "2026-09-01" });
    await t.db.insert(schema.povertyGuidelines).values({ practiceId: other.id, year: 2026, baseCents: 1_500_000, perPersonCents: 500_000 });
    expect(claimless.id).toBeTruthy();
    await deletePracticeData(t.db, other.id);
    const plan = await exportPlan(t.db);
    // practice_deletions keeps one line saying the deletion happened, on purpose.
    for (const s of plan.sources.filter((x) => x.filter === "practice" && x.table !== "practice_deletions")) {
      const { rows } = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${s.table}"`)} WHERE practice_id = ${other.id}`);
      expect(`${s.table}: ${rows[0].n}`).toBe(`${s.table}: 0`);
    }
    const left = await t.db.select().from(schema.eligibilityChecks).where(eq(schema.eligibilityChecks.patientInsuranceId, ins.id));
    expect(left).toEqual([]);
  });
});

describe("another practice's records are refused", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let otherId: string;
  let theirs: { abn: string; request: string; dispute: string; demand: string; level: string };
  beforeAll(async () => {
    t = await testDb();
    const [other] = await t.db.insert(schema.practices).values({ name: "Other", taxId: "44-4444444", npi: "4444444445", address1: "4 Pine", city: "Austin", state: "TX", zip: "78701" }).returning();
    otherId = other.id;
    // Records that belong to the seeded practice.
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    const abn = await createAbn(t.db, t.practiceId, { patientId: claim.patientId, serviceDate: "2026-09-01", services: [{ code: "82947", description: "Blood sugar test", estimatedCents: 2500 }], reason: "Once a year" });
    const request = await createRecordsRequest(t.db, t.practiceId, { kind: "adr", claimControlNumber: claim.controlNumber, receivedOn: "2026-09-01" });
    const dispute = await createNsaDispute(t.db, t.practiceId, { claimControlNumber: claim.controlNumber, initialResponseOn: "2026-09-01" });
    const demand = await createRefundDemand(t.db, t.practiceId, { claimControlNumber: claim.controlNumber, amountCents: 1_000, receivedOn: "2026-09-01" });
    const [denial] = await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: claim.id, category: "coding", carc: "16", amountCents: 1_000 }).returning();
    const [level] = await appealLevelsFor(t.db, t.practiceId, denial.id);
    theirs = { abn: abn.id, request: request.id, dispute: dispute.id, demand: demand.id, level: level.id };
  });
  afterAll(async () => { await t?.close(); });

  it("does not let one practice act on another's ABNs, requests, disputes, demands or appeals", async () => {
    await expect(recordAbnChoice(t.db, otherId, theirs.abn, 1, "2026-09-01")).rejects.toThrow(/not found/i);
    await expect(markRecordsSent(t.db, otherId, theirs.request, { sentOn: "2026-09-02", sentVia: "fax" })).rejects.toThrow(/not found/i);
    await expect(startNegotiation(t.db, otherId, theirs.dispute, "2026-09-02")).rejects.toThrow(/not found/i);
    await expect(agreeRefundDemand(t.db, otherId, theirs.demand)).rejects.toThrow(/not found/i);
    await expect(recordAppealDecision(t.db, otherId, theirs.level, "upheld", "2026-09-02")).rejects.toThrow(/not found/i);
    // Nothing changed for the owner.
    const [abn] = await t.db.select().from(schema.abns).where(eq(schema.abns.id, theirs.abn));
    expect(abn.option).toBeNull();
  });

  it("records verified income without posting a discount when asked not to", async () => {
    await saveGuidelines(t.db, t.practiceId, { year: 2026, baseCents: 1_500_000, perPersonCents: 500_000 });
    await saveTiers(t.db, t.practiceId, [{ maxPercent: 200, discountPercent: 50 }]);
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: claim.patientId, claimId: claim.id, type: "transfer_to_patient", amountCents: 4_000, note: "PR" });
    const r = await recordSlidingFee(t.db, t.practiceId, claim.patientId, { householdSize: 1, annualIncomeCents: 2_000_000, proof: "Pay stubs", verifiedOn: new Date().toISOString().slice(0, 10) }, undefined, { apply: false });
    expect(r).toMatchObject({ discountPercent: 50, posted: 0 });
    const discounts = await t.db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.patientId, claim.patientId), eq(schema.ledgerEntries.type, "discount"), sql`${schema.ledgerEntries.note} LIKE 'Sliding fee%'`));
    expect(discounts).toEqual([]);
    // The nightly run posts it.
    await applySlidingFees(t.db, t.practiceId);
    const after = await t.db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.patientId, claim.patientId), eq(schema.ledgerEntries.type, "discount"), sql`${schema.ledgerEntries.note} LIKE 'Sliding fee%'`));
    expect(after.length).toBeGreaterThan(0);
  });
});

describe("in-app help and setup", () => {
  it("has a guide of its own for every menu and settings page", () => {
    const hrefs = [...new Set([...ALL_PAGES.map((p) => p.href), ...settingsFor("admin").flatMap((s) => s.links.map((l) => l.href))])];
    const missing = hrefs.filter((h) => {
      const g = guideFor(h);
      return !g || (h.startsWith("/settings/") && g.title === "Settings");
    });
    expect(missing).toEqual([]);
  });

  it("suggests blocking a warning only with enough claims and a clearly higher denial rate", () => {
    expect(shouldBlock(20, 10, 0.1)).toBe(true);
    expect(shouldBlock(5, 5, 0.1)).toBe(false); // too few
    expect(shouldBlock(20, 5, 0.1)).toBe(false); // 25%
    expect(shouldBlock(20, 8, 0.25)).toBe(false); // 40%, but under twice the baseline
  });

  it("lists yearly files and practice settings with what each unlocks", async () => {
    const t = await testDb();
    try {
      const items = await rulesSetup(t.db, t.practiceId, new Date("2026-09-29T12:00:00Z"));
      const byKey = new Map(items.map((i) => [i.key, i]));
      expect(byKey.get("icd")?.title).toBe("ICD-10-CM for fiscal year 2026");
      expect((await rulesSetup(t.db, t.practiceId, new Date("2026-10-02T12:00:00Z"))).find((i) => i.key === "icd")?.title).toBe("ICD-10-CM for fiscal year 2027");
      expect(byKey.get("locality")?.done).toBe(false);
      await t.db.update(schema.practices).set({ medicareCarrier: "09102", medicareLocality: "04" }).where(eq(schema.practices.id, t.practiceId));
      expect((await rulesSetup(t.db, t.practiceId)).find((i) => i.key === "locality")?.done).toBe(true);
      expect(items.every((i) => i.unlocks.length > 10 && i.href.startsWith("/"))).toBe(true);
      const w = await warningOutcomes(t.db, t.practiceId, "2020-01-01", "2030-12-31");
      expect(w.claims).toBeGreaterThan(0);
    } finally {
      await t.close();
    }
  });
});
