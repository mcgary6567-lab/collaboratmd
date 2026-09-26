import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { completeSignup, readSignup, startSignup } from "./signup";
import { handlePlatformEvent, reportClaimUsage, standing, startSubscriptionCheckout, syncSeats } from "./subscription";
import { submitClaim } from "./claims";

const ORIGIN = "https://app.test";

function mailbox() {
  const sent: { to: string; subject: string; text: string }[] = [];
  return { sent, send: async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }); return true; } };
}
const tokenFrom = (text: string) => decodeURIComponent(text.match(/token=([^\s]+)/)![1]);

describe("self-serve signup", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("validates, emails a link, and creates the practice and administrator once", async () => {
    const m = mailbox();
    const input = { name: "Dana Ortiz", email: "Dana@NewClinic.test", practiceName: "New Clinic", password: "correct horse battery", plan: "professional" };
    await expect(startSignup(t.db, { ...input, password: "short" }, ORIGIN, m)).rejects.toThrow(/12 characters/);
    await expect(startSignup(t.db, { ...input, email: "nope" }, ORIGIN, m)).rejects.toThrow(/valid work email/);
    const now = new Date("2026-09-26T12:00:00Z");
    await startSignup(t.db, input, ORIGIN, { ...m, now });
    expect(m.sent[0]).toMatchObject({ to: "dana@newclinic.test" });
    expect(m.sent[0].text).toContain(`${ORIGIN}/signup/verify?token=`);
    const token = tokenFrom(m.sent[0].text);
    const [row] = await t.db.select().from(schema.signups).where(eq(schema.signups.email, "dana@newclinic.test"));
    expect(row.tokenHash).not.toBe(token);
    expect(await bcrypt.compare(input.password, row.passwordHash)).toBe(true);

    expect(await readSignup(t.db, token, new Date(now.getTime() + 25 * 3_600_000))).toBeNull();
    const done = await completeSignup(t.db, token, now);
    const [practice] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, done.practiceId));
    expect(practice).toMatchObject({ name: "New Clinic", selfServe: true, plan: "professional", subscriptionStatus: "trialing" });
    expect(practice.trialEndsAt!.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, done.userId));
    expect(user).toMatchObject({ role: "admin", email: "dana@newclinic.test", practiceId: practice.id });
    await expect(completeSignup(t.db, token, now)).rejects.toThrow(/expired or was already used/);
  });

  it("does not reveal an existing account and limits links per address", async () => {
    const m = mailbox();
    const [existing] = await t.db.select().from(schema.users).limit(1);
    await startSignup(t.db, { name: "X", email: existing.email, practiceName: "Dup", password: "correct horse battery" }, ORIGIN, m);
    expect(m.sent[0].subject).toBe("You already have a CollaboratMD account");
    expect(m.sent[0].text).not.toContain("token=");
    const m2 = mailbox();
    for (let i = 0; i < 5; i++) await startSignup(t.db, { name: "Y", email: "flood@example.test", practiceName: "Flood", password: "correct horse battery" }, ORIGIN, m2);
    expect(m2.sent).toHaveLength(3);
  });

  it("stops claims after the trial for self-serve practices only, and settles subscriptions from Stripe", async () => {
    const now = new Date("2026-09-26T12:00:00Z");
    const base = { selfServe: true, subscriptionStatus: "trialing", plan: "essentials", stripeSubscriptionId: null };
    expect(standing({ ...base, trialEndsAt: new Date(now.getTime() + 3 * 86_400_000) }, now)).toMatchObject({ blocked: false, trialDaysLeft: 3 });
    expect(standing({ ...base, trialEndsAt: new Date(now.getTime() - 1000) }, now)).toMatchObject({ blocked: true, status: "trial_ended" });
    expect(standing({ ...base, selfServe: false, trialEndsAt: null }, now).blocked).toBe(false);
    expect(standing({ ...base, stripeSubscriptionId: "sub_1", subscriptionStatus: "past_due", trialEndsAt: null }, now).blocked).toBe(false);
    expect(standing({ ...base, stripeSubscriptionId: "sub_1", subscriptionStatus: "canceled", trialEndsAt: null }, now).blocked).toBe(true);

    // A practice whose trial ended cannot send a claim.
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    await t.db.update(schema.practices).set({ selfServe: true, subscriptionStatus: "trialing", trialEndsAt: new Date(Date.now() - 1000) }).where(eq(schema.practices.id, t.practiceId));
    await expect(submitClaim(t.db, claim.id)).rejects.toThrow(/free trial has ended/);

    // Checkout needs a price from the deployment, and sends seats = active providers.
    const calls: Record<string, unknown>[] = [];
    const stripe = {
      createSubscriptionCheckout: async (p: Record<string, unknown>) => { calls.push(p); return { id: "cs_1", url: "https://checkout.stripe.test/cs_1" }; },
      createPortalSession: async () => ({ id: "bps_1", url: "https://billing.stripe.test" }),
      updateSubscriptionItemQuantity: async (id: string, q: number) => { calls.push({ id, q }); return { id, quantity: q }; },
      createMeterEvent: async (p: Record<string, unknown>) => { calls.push(p); return { identifier: String(p.identifier) }; },
    };
    await expect(startSubscriptionCheckout(t.db, t.practiceId, { plan: "essentials", cycle: "monthly", origin: ORIGIN, email: "a@b.test" }, { stripe })).rejects.toThrow(/not available/);
    vi.stubEnv("PLATFORM_PRICE_ESSENTIALS", "price_ess_m");
    vi.stubEnv("PLATFORM_PRICE_CLAIMS", "price_claims");
    expect(await startSubscriptionCheckout(t.db, t.practiceId, { plan: "essentials", cycle: "monthly", origin: ORIGIN, email: "a@b.test" }, { stripe })).toBe("https://checkout.stripe.test/cs_1");
    const providers = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId));
    expect(calls[0]).toMatchObject({ price: "price_ess_m", quantity: providers.filter((p) => p.active).length, meteredPrice: "price_claims", reference: t.practiceId });

    await handlePlatformEvent(t.db, { id: "evt_1", type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: t.practiceId, customer: "cus_1", subscription: "sub_1", metadata: { practice_id: t.practiceId, plan: "essentials" } } } } as never);
    await handlePlatformEvent(t.db, { id: "evt_2", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active", customer: "cus_1", metadata: { practice_id: t.practiceId }, items: { data: [{ id: "si_seat", quantity: 1, current_period_end: 1_800_000_000, price: { id: "price_ess_m", recurring: { usage_type: "licensed" } } }, { id: "si_claims", price: { id: "price_claims", recurring: { usage_type: "metered" } } }] } } } } as never);
    const [p] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, t.practiceId));
    expect(p).toMatchObject({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", stripeSubscriptionItemId: "si_seat", subscriptionStatus: "active", plan: "essentials", seats: 1 });
    expect(standing(p).blocked).toBe(false);

    // Seats follow providers; claims sent since the last report are metered once.
    vi.stubEnv("PLATFORM_CLAIM_METER_EVENT", "claims_sent");
    calls.length = 0;
    expect(await syncSeats(t.db, { stripe })).toBe(providers.filter((x) => x.active).length === 1 ? 0 : 1);
    await t.db.update(schema.claims).set({ submittedAt: new Date(Date.now() - 1000) }).where(eq(schema.claims.id, claim.id));
    await t.db.update(schema.practices).set({ claimsReportedThrough: new Date(Date.now() - 60_000) }).where(eq(schema.practices.id, t.practiceId));
    expect(await reportClaimUsage(t.db, { stripe })).toBeGreaterThanOrEqual(1);
    expect(await reportClaimUsage(t.db, { stripe })).toBe(0);
    expect(calls.find((c) => c.eventName === "claims_sent")).toMatchObject({ customer: "cus_1" });

    await handlePlatformEvent(t.db, { id: "evt_3", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled", customer: "cus_1", metadata: { practice_id: t.practiceId } } } } as never);
    const [after] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, t.practiceId));
    expect(standing(after)).toMatchObject({ blocked: true, status: "canceled" });
  });
});
