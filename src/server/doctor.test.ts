import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clearConfigCache } from "./integrations";
import { latestChecks, runDoctor, type DoctorHttp } from "./doctor";

describe("integration doctor", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => { vi.unstubAllEnvs(); clearConfigCache(); });

  it("skips what is not connected, and checks our own claim files", async () => {
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    await t.db.update(schema.claims).set({ edi837: "ISA*00*broken~", submittedAt: new Date() }).where(eq(schema.claims.id, claim.id));
    const http: DoctorHttp = async () => { throw new Error("no network in this test"); };
    const r = await runDoctor(t.db, t.practiceId, { http });
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by["stedi.key"].status).toBe("skip");
    expect(by["stripe.write"].status).toBe("skip");
    expect(by["claims.selfcheck"]).toMatchObject({ status: "fail" });
    expect(by["claims.selfcheck"].detail).toContain(claim.controlNumber);
    expect((await latestChecks(t.db, t.practiceId)).get("claims.selfcheck")?.status).toBe("fail");
  });

  it("creates and cancels a payment only with a Stripe test key, and renders a Lob letter only with a test key", async () => {
    const calls: string[] = [];
    const http: DoctorHttp = async (url, init) => {
      calls.push(`${init.method} ${url.split("?")[0]}`);
      const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
      if (url.includes("/v1/balance")) return ok({ livemode: false });
      if (url.endsWith("/v1/payment_intents")) return ok({ id: "pi_doc" });
      if (url.includes("/cancel")) return ok({ id: "pi_doc", status: "canceled" });
      if (url.includes("/terminal/readers")) return ok({ data: [{ status: "online" }, { status: "offline" }] });
      if (url.includes("api.lob.com/v1/addresses")) return ok({ data: [] });
      if (url.includes("api.lob.com/v1/letters")) return ok({ id: "ltr_doc" });
      return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    };
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefghijklmnop");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_abcdefghijklmnop");
    vi.stubEnv("LOB_API_KEY", "test_abcdefghijklmnop");
    const r = Object.fromEntries((await runDoctor(t.db, t.practiceId, { http })).map((x) => [x.id, x]));
    expect(r["stripe.write"]).toMatchObject({ status: "pass", detail: "Created and cancelled pi_doc" });
    expect(r["stripe.terminal"]).toMatchObject({ status: "pass", detail: "1 of 2 readers online" });
    expect(r["lob.render"]).toMatchObject({ status: "pass" });
    expect(calls).toContain("POST https://api.stripe.com/v1/payment_intents/pi_doc/cancel");

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abcdefghijklmnop");
    vi.stubEnv("LOB_API_KEY", "live_abcdefghijklmnop");
    clearConfigCache();
    calls.length = 0;
    const live = Object.fromEntries((await runDoctor(t.db, t.practiceId, { http })).map((x) => [x.id, x]));
    expect(live["stripe.write"].status).toBe("skip");
    expect(live["lob.render"].status).toBe("skip");
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
});
