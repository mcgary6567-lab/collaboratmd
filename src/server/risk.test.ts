import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { claimRisk, riskForClaims, scoreRisk, smoothedRate } from "./risk";

const base = { payerName: "Acme Health", history: [], eligibilityVerified: true, duplicateOf: null, daysToFilingDeadline: 200, hasAuthNumber: false, scrubWarnings: 0 };

describe("scoreRisk", () => {
  it("is low with nothing against the claim", () => {
    expect(scoreRisk(base)).toEqual({ score: 0, level: "low", reasons: [] });
  });

  it("does not trust tiny samples", () => {
    expect(scoreRisk({ ...base, history: [{ kind: "cpt", code: "99214", n: 1, denied: 1, topCategory: "coding" }] }).score).toBe(0);
    expect(smoothedRate(0, 0)).toBeCloseTo(0.1);
  });

  it("explains each point and adds up to high for a bad claim", () => {
    const r = scoreRisk({ ...base, history: [{ kind: "cpt", code: "97110", n: 10, denied: 6, topCategory: "authorization" }], eligibilityVerified: false, daysToFilingDeadline: 5 });
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/denied 6 of 10 claims with procedure 97110.*authorization/);
    expect(r.reasons.join(" ")).toMatch(/no authorization number/);
    expect(r.reasons.join(" ")).toMatch(/not verified/);
    expect(r.reasons.join(" ")).toMatch(/5 days remain/);
    expect(scoreRisk({ ...base, daysToFilingDeadline: -3 }).reasons[0]).toMatch(/passed 3 days ago/);
    expect(scoreRisk({ ...base, duplicateOf: "C-1" }).reasons[0]).toMatch(/duplicate/);
  });
});

describe("riskForClaims against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let claim: typeof schema.claims.$inferSelect;

  beforeAll(async () => {
    t = await testDb();
    [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    await t.db.update(schema.claims).set({ status: "ready", authorizationNumber: null }).where(eq(schema.claims.id, claim.id));
    const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.id, claim.encounterId));
    // Eight past claims to the same payer for a code, six denied for authorization.
    for (let i = 0; i < 8; i++) {
      const [e] = await t.db.insert(schema.encounters).values({ practiceId: t.practiceId, patientId: claim.patientId, providerId: enc.providerId, dateOfService: `2026-0${1 + (i % 6)}-1${i}`, diagnoses: ["M54.50"] }).returning();
      await t.db.insert(schema.charges).values({ encounterId: e.id, lineNumber: 1, cpt: "RISK1", chargeCents: 10_000 });
      const [c] = await t.db.insert(schema.claims).values({ practiceId: t.practiceId, encounterId: e.id, patientId: claim.patientId, payerId: claim.payerId, patientInsuranceId: claim.patientInsuranceId, controlNumber: `RISKTEST${i}`, totalCents: 10_000, status: i < 6 ? "denied" : "paid" }).returning();
      if (i < 6) await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: c.id, category: "authorization", carc: "197", amountCents: 10_000 });
    }
    const lines = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, claim.encounterId));
    await t.db.insert(schema.charges).values({ encounterId: claim.encounterId, lineNumber: lines.length + 1, cpt: "RISK1", chargeCents: 10_000 });
  });
  afterAll(async () => { await t?.close(); });

  it("finds the payer's history for the claim's codes and flags the missing auth", async () => {
    const r = await claimRisk(t.db, t.practiceId, claim.id);
    expect(r).not.toBeNull();
    expect(r!.reasons.join(" ")).toMatch(/denied 6 of 8 claims with procedure RISK1 in the last 12 months, mostly for authorization/);
    expect(r!.reasons.join(" ")).toMatch(/no authorization number/);
    expect(r!.level).toBe("high");
  });

  it("returns nothing for another practice's claims", async () => {
    expect((await riskForClaims(t.db, "00000000-0000-0000-0000-000000000000", [claim.id])).size).toBe(0);
  });
});
