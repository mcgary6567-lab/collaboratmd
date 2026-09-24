import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { tokenize } from "@/lib/edi/x12";
import { createAppointment } from "./encounters";
import { latestChecks, runEligibility, verifySchedule } from "./patients";

describe("eligibility over X12 270/271", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let insured: { patientId: string; insId: string }[];
  let providerId: string;
  // A day far from the seeded schedule, so only this test's appointments are on it.
  const day = new Date("2027-03-10T12:00:00");

  beforeAll(async () => {
    t = await testDb();
    const rows = await t.db
      .select({ patientId: schema.patients.id, insId: schema.patientInsurances.id })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true), eq(schema.patientInsurances.rank, 1)))
      .limit(3);
    insured = rows;
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = provider.id;
  });
  afterAll(async () => { await t?.close(); });

  it("stores the 270 sent and the 271 received, with benefits for the service date", async () => {
    const { insId } = insured[0];
    await t.db.update(schema.patientInsurances).set({ memberId: "QZ5551234A" }).where(eq(schema.patientInsurances.id, insId));
    const check = await runEligibility(t.db, insId, "2027-03-10");
    expect(check.status).toBe("active");
    expect(check.serviceDate).toBe("2027-03-10");
    const sent = tokenize(check.request270!).segments.map((s) => s.join("*"));
    expect(sent.find((s) => s.startsWith("NM1*IL"))).toMatch(/\*MI\*QZ5551234A$/);
    expect(sent).toContain("DTP*291*D8*20270310");
    expect(check.response271).toContain(`TRN*2*${check.traceNumber}`);
    for (const v of [check.copayCents, check.deductibleCents, check.deductibleRemainingCents, check.oopMaxCents, check.oopRemainingCents]) {
      expect(Number.isInteger(v)).toBe(true);
    }
    expect([10, 20, 30]).toContain(check.coinsurancePct);
  });

  it("records a payer's AAA rejection with its reason", async () => {
    const { insId } = insured[1];
    await t.db.update(schema.patientInsurances).set({ memberId: "QZ5559999X" }).where(eq(schema.patientInsurances.id, insId));
    const check = await runEligibility(t.db, insId, "2027-03-10");
    expect(check).toMatchObject({ status: "inactive", message: "Invalid/missing subscriber/insured ID (AAA 72)", planName: null, copayCents: null });
    expect(check.response271).toContain("AAA*N**72*C");
  });

  it("verifies a day's schedule once per patient, reports problems and skips patients already verified", async () => {
    const [a, b, c] = insured;
    for (const [p, hour] of [[a, 9], [a, 14], [b, 10], [c, 11]] as const) {
      await createAppointment(t.db, t.practiceId, { patientId: p.patientId, providerId, startsAt: new Date(`2027-03-10T${String(hour).padStart(2, "0")}:00:00`), minutes: 20, type: "office_visit" });
    }
    await t.db.update(schema.patientInsurances).set({ active: false }).where(eq(schema.patientInsurances.patientId, c.patientId));

    const first = await verifySchedule(t.db, t.practiceId, day);
    // a was checked for this date by the first test, so it is skipped; b is rejected; c has no insurance.
    expect(first).toMatchObject({ checked: 1, active: 0, inactive: 1, errors: 0, noInsurance: 1, skipped: 1 });
    expect(first.problems.map((p) => p.message)).toEqual([
      "Invalid/missing subscriber/insured ID (AAA 72)",
      "No active insurance on file: collect it at check-in or treat as self-pay",
    ]);

    const forced = await verifySchedule(t.db, t.practiceId, day, true);
    expect(forced).toMatchObject({ checked: 2, active: 1, inactive: 1, skipped: 0 });

    const latest = await latestChecks(t.db, [a.insId, b.insId]);
    expect(latest.get(a.insId)?.status).toBe("active");
    expect(latest.get(b.insId)?.status).toBe("inactive");
  });
});
