import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { formEncode, verifyWebhook } from "@/lib/stripe";
import { createPaymentPlan, patientBalanceCents } from "./billing";
import { chargeAutopay, createPortalLink, handleStripeEvent, openPortal, portalData, reportInsurance, startPortalPayment, verifyPortalDob } from "./portal";
import { messagePatient, toE164 } from "./messaging";

describe("Stripe helpers", () => {
  it("form-encodes nested parameters the way Stripe expects", () => {
    expect(formEncode({ mode: "payment", line_items: [{ quantity: 1, price_data: { unit_amount: 500 } }], metadata: { a: "b c" } })).toEqual([
      "mode=payment", "line_items%5B0%5D%5Bquantity%5D=1", "line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500", "metadata%5Ba%5D=b%20c",
    ]);
  });

  it("verifies a signed webhook and rejects a forged, altered or stale one", () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
    const t = 1_790_000_000;
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    expect(verifyWebhook(body, `t=${t},v1=${sig}`, "whsec_test", t * 1000).id).toBe("evt_1");
    expect(() => verifyWebhook(body, `t=${t},v1=${sig}`, "whsec_other", t * 1000)).toThrow(/does not match/);
    expect(() => verifyWebhook(body.replace("evt_1", "evt_2"), `t=${t},v1=${sig}`, "whsec_test", t * 1000)).toThrow(/does not match/);
    expect(() => verifyWebhook(body, `t=${t},v1=${sig}`, "whsec_test", (t + 600) * 1000)).toThrow(/tolerance/);
    expect(() => verifyWebhook(body, null, "whsec_test")).toThrow(/Missing/);
  });
});

describe("patient portal and online payments against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patient: typeof schema.patients.$inferSelect;
  let token: string;
  let linkId: string;

  beforeAll(async () => {
    t = await testDb();
    [patient] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    // Give the patient a balance to pay.
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "transfer_to_patient", amountCents: 30_000, note: "test balance" });
  });
  afterAll(async () => { await t?.close(); });

  it("verifies the date of birth before showing the account", async () => {
    const created = await createPortalLink(t.db, t.practiceId, patient.id, t.userId);
    token = created.token;
    expect(created.link.tokenHash).not.toContain(token);
    expect((await verifyPortalDob(t.db, token, "1901-01-01")).ok).toBe(false);
    const v = await verifyPortalDob(t.db, token, patient.dob);
    expect(v.ok).toBe(true);
    linkId = (v as { linkId: string }).linkId;
    const d = await portalData(t.db, linkId);
    expect(d?.balance).toBe(await patientBalanceCents(t.db, patient.id));
    expect(d!.balance).toBeGreaterThan(20_000); // the seeded patient may already carry a small credit
  });

  it("starts a Stripe Checkout, then posts the payment exactly once when the webhook confirms it", async () => {
    const calls: unknown[] = [];
    const client = { createCheckout: async (p: unknown) => { calls.push(p); return { id: "cs_test_1", url: "https://checkout.stripe.com/c/cs_test_1" }; } };
    await expect(startPortalPayment(t.db, linkId, { amountCents: 50, origin: "http://x", token }, client)).rejects.toThrow(/at least \$1/);
    await expect(startPortalPayment(t.db, linkId, { amountCents: 99_999_999, origin: "http://x", token }, client)).rejects.toThrow(/more than you owe/);
    const r = await startPortalPayment(t.db, linkId, { amountCents: 12_500, origin: "https://site.test", token }, client);
    expect(r.url).toContain("checkout.stripe.com");
    expect(calls[0]).toMatchObject({ amountCents: 12_500, cancelUrl: `https://site.test/portal/${token}`, saveCard: false, idempotencyKey: `portal-${r.paymentId}` });

    const before = await patientBalanceCents(t.db, patient.id);
    const event = { id: "evt_x", type: "checkout.session.completed", data: { object: { id: "cs_test_1", payment_status: "paid", metadata: { autopay: "0" } } } };
    const noStripe = { getPaymentIntent: async () => { throw new Error("unused"); }, getPaymentMethod: async () => { throw new Error("unused"); } };
    expect(await handleStripeEvent(t.db, event, noStripe)).toEqual({ handled: true, duplicate: false });
    expect(await handleStripeEvent(t.db, event, noStripe)).toEqual({ handled: true, duplicate: true });
    expect(await patientBalanceCents(t.db, patient.id)).toBe(before - 12_500);
    const payments = await t.db.select().from(schema.onlinePayments).where(eq(schema.onlinePayments.id, r.paymentId));
    expect(payments[0]).toMatchObject({ status: "paid" });
    expect(payments[0].ledgerEntryId).toBeTruthy();
  });

  it("saves the card for a plan's autopay, then charges due installments", async () => {
    const balance = await patientBalanceCents(t.db, patient.id);
    const plan = await createPaymentPlan(t.db, t.practiceId, patient.id, { totalCents: balance, installmentCount: 3, frequency: "monthly", startDate: "2020-01-01" }, t.userId);
    const client = { createCheckout: async () => ({ id: "cs_test_2", url: "https://checkout.stripe.com/c/2" }) };
    const r = await startPortalPayment(t.db, linkId, { amountCents: 1_000, planId: plan.id, autopay: true, origin: "https://site.test", token }, client);
    await handleStripeEvent(t.db, { id: "evt_y", type: "checkout.session.completed", data: { object: { id: "cs_test_2", payment_status: "paid", payment_intent: "pi_1", customer: "cus_1", metadata: { autopay: "1" } } } }, {
      getPaymentIntent: async () => ({ id: "pi_1", status: "succeeded", payment_method: "pm_1", customer: "cus_1" }),
      getPaymentMethod: async () => ({ id: "pm_1", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }),
    });
    const [card] = await t.db.select().from(schema.savedCards).where(eq(schema.savedCards.patientId, patient.id));
    expect(card).toMatchObject({ providerCustomer: "cus_1", providerMethod: "pm_1", last4: "4242", autopayPlanId: plan.id });
    expect(r.paymentId).toBeTruthy();

    const charges: { amountCents: number; idempotencyKey: string }[] = [];
    const res = await chargeAutopay(t.db, t.practiceId, { chargeSaved: async (p) => { charges.push(p); return { id: "pi_auto", status: "succeeded" }; } }, "2020-03-15");
    expect(res).toEqual({ charged: 1, failed: 0 });
    expect(charges[0].idempotencyKey).toBe(`autopay-${plan.id}-2020-03-15`);
    expect(charges[0].amountCents).toBeGreaterThan(0);
    // Nothing more is due, so a second run charges nothing.
    expect(await chargeAutopay(t.db, t.practiceId, { chargeSaved: async () => { throw new Error("should not charge"); } }, "2020-03-15")).toEqual({ charged: 0, failed: 0 });
  });

  it("turns a reported insurance change into a task for the front desk", async () => {
    await reportInsurance(t.db, linkId, { payerName: "Oscar Health", memberId: "OS123" });
    const [task] = await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.entityType, "patient"), eq(schema.tasks.entityId, patient.id)));
    expect(task).toMatchObject({ priority: "high" });
    expect(task.note).toContain("OS123");
  });

  it("retires the old link when a new one is sent", async () => {
    await createPortalLink(t.db, t.practiceId, patient.id);
    expect((await openPortal(t.db, token)).state).toBe("invalid");
  });
});

describe("patient messaging rules", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("normalizes US numbers and refuses others", () => {
    expect(toE164("(214) 555-0101")).toBe("+12145550101");
    expect(toE164("1-214-555-0101")).toBe("+12145550101");
    expect(toE164("555-0101")).toBeNull();
  });

  it("texts only with consent, honors reminder opt-out, and logs every attempt", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test"; process.env.TWILIO_AUTH_TOKEN = "tok"; process.env.TWILIO_FROM = "+15550000000"; process.env.RESEND_API_KEY = "re_test";
    try {
      const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
      const sent: string[] = [];
      const deps = { sms: async (to: string) => { sent.push(`sms:${to}`); return { ok: true, detail: "ok" }; }, email: async (to: string) => { sent.push(`email:${to}`); return true; } };
      const base = { id: p.id, practiceId: t.practiceId, firstName: "Pat", phone: "214-555-0101", email: "pat@example.com", remindersOptOut: false };

      let r = await messagePatient(t.db, { ...base, smsConsentAt: null }, { kind: "pay_link", sms: "hi", email: { subject: "s", text: "t" } }, deps);
      expect(r).toMatchObject({ sms: "skipped", email: "sent" });
      r = await messagePatient(t.db, { ...base, smsConsentAt: new Date() }, { kind: "pay_link", sms: "hi" }, deps);
      expect(r.sms).toBe("sent");
      r = await messagePatient(t.db, { ...base, smsConsentAt: new Date(), remindersOptOut: true }, { kind: "appointment_reminder", reminder: true, sms: "hi" }, deps);
      expect(r).toMatchObject({ sms: "skipped", email: "skipped", reason: "Patient opted out of reminders" });
      expect(sent).toEqual(["email:pat@example.com", "sms:+12145550101"]);
      const log = await t.db.select().from(schema.messageLog).where(eq(schema.messageLog.patientId, p.id));
      expect(log.map((l) => `${l.channel}:${l.status}`).sort()).toEqual(["email:sent", "sms:sent"]);
    } finally {
      delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM; delete process.env.RESEND_API_KEY;
    }
  });
});
