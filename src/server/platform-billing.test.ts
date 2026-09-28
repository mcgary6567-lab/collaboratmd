import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { handlePlatformEvent, listInvoices } from "./subscription";
import { sendLifecycleEmails } from "./lifecycle";
import { questionnaireCsv, QUESTIONNAIRE } from "@/content/security-questionnaire";
import { lastRestoreTest, recordRestoreTest } from "./restore-tests";

const DAY = 86_400_000;

describe("subscription invoices and failed payments", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("keeps each invoice, and tells administrators in the app when a payment fails", async () => {
    const [p] = await t.db.insert(schema.practices).values({ name: "Paying Clinic", taxId: "", npi: "", address1: "", city: "", state: "", zip: "", selfServe: true, subscriptionStatus: "active", stripeCustomerId: "cus_inv", stripeSubscriptionId: "sub_inv" }).returning();
    const invoice = (type: string, status: string) => ({ id: "evt", type, data: { object: { id: "in_1", customer: "cus_inv", number: "CMD-0001", status, amount_due: 29900, amount_paid: status === "paid" ? 29900 : 0, hosted_invoice_url: "https://invoice.stripe.com/i/x", created: 1790000000, period_start: 1787400000, period_end: 1790000000 } } }) as never;
    expect(await handlePlatformEvent(t.db, invoice("invoice.finalized", "open"))).toEqual({ handled: true });
    expect(await handlePlatformEvent(t.db, invoice("invoice.payment_failed", "open"))).toEqual({ handled: true });
    expect(await handlePlatformEvent(t.db, invoice("invoice.payment_failed", "open"))).toEqual({ handled: true });
    const alerts = await t.db.select().from(schema.notifications).where(and(eq(schema.notifications.practiceId, p.id), eq(schema.notifications.kind, "subscription_payment_failed")));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toMatch(/\$299\.00/);
    await handlePlatformEvent(t.db, invoice("invoice.paid", "paid"));
    const [row] = await listInvoices(t.db, p.id);
    expect(row).toMatchObject({ number: "CMD-0001", status: "paid", amountPaidCents: 29900 });
    // An invoice for a customer we do not know is ignored.
    expect(await handlePlatformEvent(t.db, { id: "e", type: "invoice.paid", data: { object: { id: "in_2", customer: "cus_other" } } } as never)).toEqual({ handled: false });
  });

  it("sends a last reminder two days before claims pause", async () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const [p] = await t.db.insert(schema.practices).values({ name: "Late Clinic", taxId: "", npi: "", address1: "", city: "", state: "", zip: "", selfServe: true, subscriptionStatus: "past_due", stripeSubscriptionId: "sub_late", pastDueSince: new Date(now.getTime() - 6 * DAY), billingEmail: "owner@late.test", timeZone: "America/Chicago" }).returning();
    const sent: string[] = [];
    await sendLifecycleEmails(t.db, "https://app.test", async (to, subject, text) => { if (to === "owner@late.test") sent.push(`${subject} | ${text}`); return true; }, now);
    expect(sent.map((s) => s.split(" | ")[0])).toEqual(["A CollaboratMD payment failed", "Claims pause in 2 days: CollaboratMD payment still failing"]);
    expect(sent[1]).toMatch(/On Oct 11, 2026 claims stop/);
    expect(p.id).toBeTruthy();
  });
});

describe("security evidence", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("records restore tests and puts the latest in the questionnaire", async () => {
    expect(await lastRestoreTest(t.db)).toBeNull();
    await expect(recordRestoreTest(t.db, { testedAt: "2099-01-01T00:00", target: "x", result: "passed" }, "ops@test")).rejects.toThrow(/when/);
    await recordRestoreTest(t.db, { testedAt: "2026-09-03T14:00", target: "Production as of 1 hour earlier", minutes: 22, result: "passed" }, "ops@test");
    expect(await lastRestoreTest(t.db)).toMatchObject({ result: "passed", minutes: 22 });
    const csv = questionnaireCsv("2026-09-03, passed");
    expect(csv.split("\r\n")).toHaveLength(QUESTIONNAIRE.length + 1);
    expect(csv).toContain("Most recent: 2026-09-03, passed.");
    expect(new Set(QUESTIONNAIRE.map((q) => q.id)).size).toBe(QUESTIONNAIRE.length);
    // It never claims an audit or a test that has not happened.
    expect(QUESTIONNAIRE.find((q) => q.id === "GOV-3")?.answer).toMatch(/^Not yet/);
    expect(QUESTIONNAIRE.find((q) => q.id === "GOV-4")?.answer).toMatch(/^Not yet/);
  });
});
