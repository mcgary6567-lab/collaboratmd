import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { goLivePlan } from "./go-live";

describe("go-live checklist", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  const step = async (label: string) => (await goLivePlan(t.db, t.practiceId)).flatMap((p) => p.steps).find((s) => s.label === label)!;

  it("reads each step from the practice's own data, in four phases", async () => {
    const plan = await goLivePlan(t.db, t.practiceId);
    expect(plan.map((p) => p.title)).toEqual(["1. Set up the practice", "2. Connect and check the services", "3. First claims", "4. Before real patient data (confirm yourself)"]);
    expect(plan.every((p) => p.steps.length >= 3 && p.steps.every((s) => s.label && s.detail))).toBe(true);
    // What only people can confirm is never ticked by the software.
    expect(plan[3].steps.every((s) => !s.done)).toBe(true);
  });

  it("ticks the doctor and acknowledgment steps once they happen", async () => {
    await t.db.delete(schema.integrationChecks).where(eq(schema.integrationChecks.practiceId, t.practiceId));
    expect((await step("Integration doctor run")).detail).toBe("Not run yet");
    await t.db.insert(schema.integrationChecks).values({ practiceId: t.practiceId, checkId: "stedi.key", status: "fail", detail: "Key rejected" });
    expect(await step("Integration doctor run")).toMatchObject({ done: false, detail: "1 failing: stedi.key" });
    expect(await step("Clearinghouse key accepted")).toMatchObject({ done: false, detail: "Key rejected" });
    await t.db.insert(schema.integrationChecks).values({ practiceId: t.practiceId, checkId: "stedi.key", status: "pass", detail: "Key accepted", ranAt: new Date(Date.now() + 1000) });
    expect(await step("Integration doctor run")).toMatchObject({ done: true, detail: "Nothing failing" });
    expect((await step("Clearinghouse key accepted")).done).toBe(true);

    const before = await step("Acknowledgment received");
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    await t.db.insert(schema.claimAcknowledgments).values({ claimId: claim.id, kind: "999", accepted: true });
    const after = await step("Acknowledgment received");
    expect(after.done).toBe(true);
    expect(after.detail).toMatch(/\d+ acknowledgments, \d+ accepted/);
    expect(before.detail === after.detail).toBe(false);
  });
});
