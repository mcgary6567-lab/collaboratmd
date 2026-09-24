import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDb } from "./db";

let t: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => { t = await testDb(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe("test database harness", () => {
  it("migrates and seeds a working practice", async () => {
    const r = await t.db.execute<{ n: string }>(sql`SELECT count(*)::int AS n FROM claims WHERE practice_id = ${t.practiceId}`);
    expect(Number(r.rows[0].n)).toBeGreaterThan(0);
  });
});
