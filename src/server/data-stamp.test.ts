import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { memo } from "@/lib/memo";
import { dataStamp } from "./data-stamp";

describe("data stamp", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("changes when money is posted, so cached figures are recomputed at once", async () => {
    const before = await dataStamp(t.db, t.practiceId);
    expect(before).not.toBe("");
    expect(await dataStamp(t.db, t.practiceId)).toBe(before);

    let computed = 0;
    const figure = async () => { computed++; return computed; };
    expect(await memo(`test:${t.practiceId}:${before}`, 60_000, figure)).toBe(1);
    expect(await memo(`test:${t.practiceId}:${before}`, 60_000, figure)).toBe(1);

    const [row] = await t.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.practiceId, t.practiceId)).limit(1);
    const { id: _id, ...copy } = row;
    await t.db.insert(schema.ledgerEntries).values({ ...copy, amountCents: 100, postedAt: new Date(Date.now() + 60_000) });
    const after = await dataStamp(t.db, t.practiceId);
    expect(after).not.toBe(before);
    expect(await memo(`test:${t.practiceId}:${after}`, 60_000, figure)).toBe(2);
  });

  it("is empty-safe for a practice with nothing yet", async () => {
    expect(await dataStamp(t.db, "00000000-0000-4000-8000-000000000000")).toBe("");
  });
});
