import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { recordUsage } from "./usage";
import { dismissTip, featureTips, TIPS } from "./tips";

describe("feature suggestions", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("suggests nothing when no usage has been recorded", async () => {
    await t.db.update(schema.practices).set({ createdAt: new Date("2026-08-01T00:00:00Z") }).where(eq(schema.practices.id, t.practiceId));
    expect(await featureTips(t.db, t.practiceId, new Date("2026-10-15T12:00:00Z"))).toEqual([]);
  });

  it("suggests unused screens to an established practice, and forgets dismissed ones", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    await recordUsage(t.db, t.practiceId, "/claims", now);
    await t.db.update(schema.practices).set({ createdAt: new Date("2026-10-10T00:00:00Z") }).where(eq(schema.practices.id, t.practiceId));
    expect(await featureTips(t.db, t.practiceId, now)).toEqual([]); // live for five days: the setup guide leads

    await t.db.update(schema.practices).set({ createdAt: new Date("2026-08-01T00:00:00Z") }).where(eq(schema.practices.id, t.practiceId));
    expect((await featureTips(t.db, t.practiceId, now)).map((x) => x.key)).toEqual(TIPS.slice(0, 3).map((x) => x.key));

    await recordUsage(t.db, t.practiceId, "/claims/follow-up", now);
    await dismissTip(t.db, t.practiceId, "denials/agent", t.userId);
    const keys = (await featureTips(t.db, t.practiceId, now)).map((x) => x.key);
    expect(keys).not.toContain("claims/follow-up");
    expect(keys).not.toContain("denials/agent");
    expect(keys).toHaveLength(3);
    await expect(dismissTip(t.db, t.practiceId, "../etc", t.userId)).rejects.toThrow(/Unknown/);
  });
});
