import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clearConfigCache, disconnectIntegration, listIntegrations, practiceConfig, saveIntegration, testIntegration } from "./integrations";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";

const STRIPE_KEY = "sk_test_" + "a".repeat(24);
const WHSEC = "whsec_" + "b".repeat(24);
const TWILIO_SID = "AC" + "c".repeat(32);
const TWILIO_TOKEN = "d".repeat(32);

type Call = { url: string; headers: Record<string, string> };
function stubHttp(status: number, body: unknown, calls: Call[] = []) {
  return async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
}

describe("practice integrations against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let other: string;

  beforeAll(async () => {
    t = await testDb();
    const [p] = await t.db.insert(schema.practices).values({ name: "Other Practice", taxId: "12-3456789", npi: "1234567893", address1: "1 Main", city: "Austin", state: "TX", zip: "78701" }).returning();
    other = p.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearConfigCache();
  });
  afterAll(async () => { await t?.close(); });

  it("falls back to environment variables until the practice connects its own", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_envkey_1234567890");
    const cfg = await practiceConfig(t.db, t.practiceId);
    expect(cfg.resend?.apiKey).toBe("re_envkey_1234567890");
    expect(cfg.sources.resend).toBe("environment");
    expect(cfg.sources.stripe).toBe("off");
  });

  it("rejects keys that are obviously wrong and asks for what is missing", async () => {
    await expect(saveIntegration(t.db, t.practiceId, "stripe", { enabled: true, settings: {}, secrets: { secretKey: "pk_live_abc" } })).rejects.toThrow(/starts with sk_live_/);
    await expect(saveIntegration(t.db, t.practiceId, "twilio", { enabled: true, settings: { accountSid: TWILIO_SID }, secrets: { authToken: TWILIO_TOKEN } })).rejects.toThrow(/sending number/);
    await expect(saveIntegration(t.db, t.practiceId, "twilio", { enabled: true, settings: { accountSid: TWILIO_SID, from: "555-0100" }, secrets: { authToken: TWILIO_TOKEN } })).rejects.toThrow(/\+15125550123/);
  });

  it("stores secrets encrypted, shows only the last four, and uses them for this practice only", async () => {
    await saveIntegration(t.db, t.practiceId, "stripe", { enabled: true, settings: {}, secrets: { secretKey: STRIPE_KEY, webhookSecret: WHSEC } }, t.userId);
    const [row] = await t.db.select().from(schema.practiceIntegrations).where(eq(schema.practiceIntegrations.practiceId, t.practiceId));
    expect(row.secrets).not.toContain(STRIPE_KEY);
    expect(row.secrets).not.toContain(WHSEC);
    expect(row.secretHints).toEqual({ secretKey: "••••aaaa", webhookSecret: "••••bbbb" });

    const cfg = await practiceConfig(t.db, t.practiceId);
    expect(cfg.stripe).toEqual({ secretKey: STRIPE_KEY, webhookSecret: WHSEC });
    expect(cfg.sources.stripe).toBe("practice");
    expect((await practiceConfig(t.db, other)).stripe).toBeNull();

    const listed = await listIntegrations(t.db, t.practiceId);
    expect(JSON.stringify(listed)).not.toContain(STRIPE_KEY);
    expect(listed.find((l) => l.provider === "stripe")?.connected).toBe(true);
  });

  it("keeps a stored secret when the field is left blank, and switching off turns the service off", async () => {
    await saveIntegration(t.db, t.practiceId, "twilio", { enabled: true, settings: { accountSid: TWILIO_SID, from: "+15125550100" }, secrets: { authToken: TWILIO_TOKEN } });
    await saveIntegration(t.db, t.practiceId, "twilio", { enabled: true, settings: { accountSid: TWILIO_SID, from: "+15125550199" }, secrets: { authToken: "" } });
    expect((await practiceConfig(t.db, t.practiceId)).twilio).toEqual({ accountSid: TWILIO_SID, authToken: TWILIO_TOKEN, from: "+15125550199" });

    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACenv");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "env");
    vi.stubEnv("TWILIO_FROM", "+15125550000");
    await saveIntegration(t.db, t.practiceId, "twilio", { enabled: false, settings: { accountSid: TWILIO_SID, from: "+15125550199" }, secrets: {} });
    const off = await practiceConfig(t.db, t.practiceId);
    expect(off.twilio).toBeNull(); // switched off here even though the environment has keys
    expect(off.sources.twilio).toBe("off");

    await disconnectIntegration(t.db, t.practiceId, "twilio");
    expect((await practiceConfig(t.db, t.practiceId)).sources.twilio).toBe("environment");
  });

  it("tests each service with one read-only request and records the result", async () => {
    const calls: Call[] = [];
    let r = await testIntegration(t.db, t.practiceId, "stripe", t.userId, stubHttp(200, { livemode: false }, calls));
    expect(r).toEqual({ ok: true, message: "Connected to Stripe in test mode." });
    expect(calls[0]).toMatchObject({ url: "https://api.stripe.com/v1/balance", headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
    r = await testIntegration(t.db, t.practiceId, "stripe", t.userId, stubHttp(401, { error: { message: "Invalid API Key provided" } }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Invalid API Key/);
    const [row] = await t.db.select().from(schema.practiceIntegrations).where(eq(schema.practiceIntegrations.provider, "stripe"));
    expect(row).toMatchObject({ lastTestOk: false });

    await saveIntegration(t.db, t.practiceId, "stedi", { enabled: true, settings: {}, secrets: { apiKey: "stedi-test-key-123" } });
    const stediCalls: Call[] = [];
    r = await testIntegration(t.db, t.practiceId, "stedi", undefined, stubHttp(200, { items: [] }, stediCalls));
    expect(r.ok).toBe(true);
    expect(stediCalls[0]).toMatchObject({ url: "https://payers.us.stedi.com/2024-04-01/payers", headers: { Authorization: "stedi-test-key-123" } });
    expect((await testIntegration(t.db, t.practiceId, "stedi", undefined, stubHttp(401, {}))).message).toMatch(/rejected/);

    await saveIntegration(t.db, t.practiceId, "resend", { enabled: true, settings: { from: "Billing <billing@example.org>" }, secrets: { apiKey: "re_abcdefghijkl" } });
    r = await testIntegration(t.db, t.practiceId, "resend", undefined, stubHttp(200, { data: [{ name: "example.org", status: "verified" }] }));
    expect(r.ok).toBe(true);
    r = await testIntegration(t.db, t.practiceId, "resend", undefined, stubHttp(200, { data: [{ name: "other.org", status: "verified" }] }));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/example.org is not a domain/) });

    expect((await testIntegration(t.db, other, "twilio")).message).toMatch(/not connected/);
  });

  it("routes a practice to Stedi only when it has a key", async () => {
    const cfg = await practiceConfig(t.db, t.practiceId);
    expect(getClearinghouse(cfg.stedi?.apiKey).constructor.name).toBe("StediClearinghouse");
    expect(getClearinghouse((await practiceConfig(t.db, other)).stedi?.apiKey).constructor.name).toBe("MockClearinghouse");
  });
});
