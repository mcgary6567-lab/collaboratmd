import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { appSecret } from "@/lib/app-secret";
import { seal, unseal } from "@/lib/seal";
import { resealAll } from "./reseal";

describe("the database refuses to rewrite posted money", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("blocks changing or deleting an entry, and allows re-linking it to a corrected claim", async () => {
    const [entry] = await t.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.practiceId, t.practiceId)).limit(1);
    await expect(t.db.update(schema.ledgerEntries).set({ amountCents: entry.amountCents + 1 }).where(eq(schema.ledgerEntries.id, entry.id))).rejects.toThrow();
    await expect(t.db.delete(schema.ledgerEntries).where(eq(schema.ledgerEntries.id, entry.id))).rejects.toThrow();
    await t.db.update(schema.ledgerEntries).set({ chargeId: null }).where(eq(schema.ledgerEntries.id, entry.id));
    const [after] = await t.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.id, entry.id));
    expect(after.amountCents).toBe(entry.amountCents);
  });

  it("moves stored secrets from the AUTH_SECRET key to a key ring, and reads both", async () => {
    const legacy = seal("sk_test_legacy", appSecret());
    expect(legacy.startsWith("v1.")).toBe(true);
    const [row] = await t.db.select().from(schema.practiceIntegrations).limit(1);
    const id = row?.id ?? (await t.db.insert(schema.practiceIntegrations).values({ practiceId: t.practiceId, provider: "stripe", secrets: legacy }).returning())[0].id;
    await t.db.update(schema.practiceIntegrations).set({ secrets: legacy }).where(eq(schema.practiceIntegrations.id, id));

    await expect(resealAll(t.db)).rejects.toThrow(/SEAL_KEYS/);
    vi.stubEnv("SEAL_KEYS", `k2=${Buffer.alloc(32, 7).toString("base64")},k1=${Buffer.alloc(32, 3).toString("base64")}`);
    const r = await resealAll(t.db);
    expect(r.resealed).toBeGreaterThanOrEqual(1);
    const [moved] = await t.db.select().from(schema.practiceIntegrations).where(eq(schema.practiceIntegrations.id, id));
    expect(moved.secrets!.startsWith("v2.k2.")).toBe(true);
    expect(unseal(moved.secrets!, new TextEncoder().encode("a different AUTH_SECRET"))).toBe("sk_test_legacy");
    expect((await resealAll(t.db)).resealed).toBe(0);

    vi.stubEnv("SEAL_KEYS", `k3=${Buffer.alloc(32, 9).toString("base64")}`);
    expect(() => unseal(moved.secrets!, appSecret())).toThrow(/k2, which is not in SEAL_KEYS/);
    vi.stubEnv("SEAL_KEYS", "k1=short");
    expect(() => seal("x", appSecret())).toThrow(/32 bytes/);
  });
});
