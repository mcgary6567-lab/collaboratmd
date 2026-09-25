import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { build276, build277, nextStep, parse276, parse277 } from "@/lib/edi/x276";
import { tokenize } from "@/lib/edi/x12";
import { createEncounterWithClaim } from "./encounters";
import { submitClaim } from "./claims";
import { checkClaimStatus, followUpList, runFollowUp } from "./followup";

const inquiry = {
  senderId: "COLLABORATMD", receiverId: "60054", now: new Date("2026-09-24T12:00:00Z"), control: "9",
  payer: { name: "Aetna", payerId: "60054" }, billingProvider: { name: "Summit", npi: "1234567893" },
  subscriber: { lastName: "Doe", firstName: "Jane", memberId: "W1", dob: "1980-01-01", sex: "F" },
  claim: { controlNumber: "CMD000777", payerClaimNumber: "PCN1", chargeCents: 15_000, serviceFrom: "2026-08-01", serviceTo: "2026-08-01" },
};

describe("276/277 claim status", () => {
  it("builds a 276 with the claim's identifiers and reads it back", () => {
    const raw = build276(inquiry);
    const segs = tokenize(raw).segments.map((s) => s.join("*"));
    expect(segs).toContain("ST*276*0001*005010X212");
    expect(segs).toContain("TRN*1*CMD000777");
    expect(segs).toContain("REF*1K*PCN1");
    expect(segs).toContain("AMT*T3*150.00");
    expect(segs).toContain("DTP*472*RD8*20260801-20260801");
    expect(parse276(raw)).toMatchObject({ controlNumber: "CMD000777", payerClaimNumber: "PCN1", chargeCents: 15_000, memberId: "W1" });
  });

  it("reads a 277 answer and maps it to a next step", () => {
    const raw = build277({ senderId: "P", receiverId: "C", now: new Date(), control: "1", inquiry: parse276(build276(inquiry)), status: { category: "F1", statusCode: "65", paidCents: 9_000, paidDate: "2026-09-20", checkNumber: "EFT9" } });
    const [st] = parse277(raw);
    expect(st).toMatchObject({ controlNumber: "CMD000777", category: "F1", statusCode: "65", paidCents: 9_000, paidDate: "2026-09-20", checkNumber: "EFT9", payerClaimNumber: "PCN1" });
    expect(st.message).toBe("Finalized/Payment: Claim/line has been paid");
    expect(nextStep(st).action).toBe("post_era");
    expect(nextStep({ category: "P1" }).action).toBe("wait");
    expect(nextStep({ category: "F2" }).action).toBe("work_denial");
    expect(nextStep({ category: "P3" }).action).toBe("send_info");
    expect(nextStep({ category: "E0" }).action).toBe("fix_and_resubmit");
  });
});

describe("unpaid claim follow-up against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let claimId: string;

  beforeAll(async () => {
    t = await testDb();
    const [row] = await t.db
      .select({ patient: schema.patients, ins: schema.patientInsurances })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true)))
      .limit(1);
    await t.db.update(schema.patientInsurances).set({ memberId: "FU1000A" }).where(eq(schema.patientInsurances.id, row.ins.id));
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, {
      patientId: row.patient.id, providerId: provider.id, dateOfService: new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10),
      placeOfService: "11", diagnoses: ["I10"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 13_500, dxPointers: [1] }],
    });
    await submitClaim(t.db, claim.id);
    // Pretend it went out six weeks ago.
    await t.db.update(schema.claims).set({ submittedAt: new Date(Date.now() - 42 * 86_400_000) }).where(eq(schema.claims.id, claim.id));
    claimId = claim.id;
  });
  afterAll(async () => { await t?.close(); });

  it("lists the old unpaid claim, asks the payer, and records the answer", async () => {
    const before = await followUpList(t.db, t.practiceId);
    expect(before.find((r) => r.claim.id === claimId)).toMatchObject({ last: null });
    expect(before.find((r) => r.claim.id === claimId)!.ageDays).toBeGreaterThanOrEqual(41);

    const check = await checkClaimStatus(t.db, claimId);
    expect(check.request276).toContain("TRN*1*");
    expect(check.response277).toContain("STC*");
    expect(["wait", "post_era", "send_info", "work_denial"]).toContain(check.nextAction);
    expect(check.message).toBeTruthy();
  });

  it("does not ask again within a week", async () => {
    const r = await runFollowUp(t.db, t.practiceId);
    expect(r.checked).toBe(0);
  });
});
