import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { extendTrial, practiceOverview } from "./operator";

describe("operator console", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("summarizes practices and extends a self-serve trial", async () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const [trial] = await t.db.insert(schema.practices).values({ name: "Trial Co", taxId: "", npi: "", address1: "", city: "", state: "", zip: "", selfServe: true, subscriptionStatus: "trialing", trialEndsAt: new Date(now.getTime() - 86_400_000) }).returning();
    await t.db.insert(schema.practices).values({ name: "Paying Co", taxId: "", npi: "", address1: "", city: "", state: "", zip: "", selfServe: true, subscriptionStatus: "active", stripeSubscriptionId: "sub_1", plan: "professional", seats: 3 });
    const { rows, totals } = await practiceOverview(t.db, now);
    expect(rows.find((r) => r.name === "Trial Co")).toMatchObject({ status: "trial_ended", blocked: true });
    expect(rows.find((r) => r.name === "Paying Co")).toMatchObject({ status: "active", monthlyCents: 3 * 149 * 100 });
    expect(totals).toMatchObject({ paying: 1, blocked: 1, monthlyCents: 44_700 });
    const demo = rows.find((r) => r.id === t.practiceId)!;
    expect(demo.selfServe).toBe(false);
    expect(demo.providers).toBeGreaterThan(0);

    await expect(extendTrial(t.db, t.practiceId, 14, "ops@test")).rejects.toThrow(/self-serve/);
    const until = await extendTrial(t.db, trial.id, 14, "ops@test", now);
    expect(until.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    const [p] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, trial.id));
    expect(p.subscriptionStatus).toBe("trialing");
    expect((await practiceOverview(t.db, now)).rows.find((r) => r.name === "Trial Co")?.blocked).toBe(false);
  });
});
