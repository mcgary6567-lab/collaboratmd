import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { createEncounterWithClaim } from "./encounters";
import { agentQueue, approveItem, dismissItem, priorityFor, runDenialAgent } from "./denial-agent";
import { createAppointment } from "./encounters";
import { createCheckinLink, loadCheckin, verifyDob } from "./checkin";
import { startCheckinCopay } from "./portal";
import { sendPayLinks } from "./automation";

describe("denial agent, copay at check-in and text-to-pay against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patient: typeof schema.patients.$inferSelect;
  let provider: typeof schema.providers.$inferSelect;
  let other: string;

  async function deniedClaim(category: string, carc: string, dos: string, claimStatus = "denied") {
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, {
      patientId: patient.id, providerId: provider.id, dateOfService: dos, placeOfService: "11", diagnoses: ["I10"],
      lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 12_000, dxPointers: [1] }],
    });
    await t.db.update(schema.claims).set({ status: claimStatus }).where(eq(schema.claims.id, claim.id));
    if (claimStatus !== "paid") {
      await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: claim.id, category, carc, amountCents: 12_000, appealDeadline: "2026-12-01", explanation: `Test ${category} denial` });
    }
    return claim;
  }

  beforeAll(async () => {
    t = await testDb();
    [patient] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const [p] = await t.db.insert(schema.practices).values({ name: "Other", taxId: "11-1111111", npi: "1234567893", address1: "1", city: "A", state: "TX", zip: "78701" }).returning();
    other = p.id;
    // Only the denials made below are open, so the test knows the whole queue.
    await t.db.update(schema.denials).set({ status: "resolved" }).where(eq(schema.denials.practiceId, t.practiceId));
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await t?.close();
  });

  it("ranks bigger and more urgent denials first", () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    expect(priorityFor(10_000, soon)).toBeGreaterThan(priorityFor(10_000, later));
    expect(priorityFor(500_000, later)).toBeGreaterThan(priorityFor(10_000, later));
  });

  it("prepares the right work for each kind of denial, once", async () => {
    const coding = await deniedClaim("coding", "4", "2026-08-01");
    await deniedClaim("duplicate", "18", "2026-08-02", "paid"); // the visit was paid on this claim
    const dup = await deniedClaim("duplicate", "18", "2026-08-02");
    const auth = await deniedClaim("authorization", "197", "2026-08-03");
    const elig = await deniedClaim("eligibility", "27", "2026-08-04");

    const r = await runDenialAgent(t.db, t.practiceId, { userId: t.userId });
    expect(r.prepared).toBe(4);
    const queue = await agentQueue(t.db, t.practiceId);
    const byClaim = (id: string) => queue.find((q) => q.claim.id === id)!.item;
    expect(byClaim(coding.id).action).toBe("correct_claim");
    expect(byClaim(dup.id).action).toBe("write_off");
    expect(byClaim(dup.id).reasons.join(" ")).toMatch(/already paid/);
    expect(byClaim(auth.id)).toMatchObject({ action: "appeal" });
    expect(byClaim(auth.id).letterId).toBeTruthy();
    const [check] = await t.db.select().from(schema.eligibilityChecks).orderBy(desc(schema.eligibilityChecks.checkedAt)).limit(1);
    expect(byClaim(elig.id).action).toBe(check.status === "active" ? "appeal" : "update_insurance");

    const [d] = await t.db.select().from(schema.denials).where(eq(schema.denials.claimId, auth.id));
    expect(d.status).toBe("in_progress");
    expect((await runDenialAgent(t.db, t.practiceId)).prepared).toBe(0); // nothing new
    expect(await agentQueue(t.db, other)).toEqual([]);
  });

  it("carries out an approval, and a dismissal puts the denial back", async () => {
    const queue = await agentQueue(t.db, t.practiceId);
    const correct = queue.find((q) => q.item.action === "correct_claim")!;
    const r = await approveItem(t.db, t.practiceId, correct.item.id, t.userId);
    expect(r.resultClaimId).toBeTruthy();
    const [replacement] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, r.resultClaimId!));
    expect(replacement.originalClaimId).toBe(correct.claim.id);
    await expect(approveItem(t.db, t.practiceId, correct.item.id)).rejects.toThrow(/Already approved/);

    const writeOff = queue.find((q) => q.item.action === "write_off")!;
    await approveItem(t.db, t.practiceId, writeOff.item.id, t.userId);
    const [wo] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, writeOff.claim.id));
    expect(wo.status).toBe("closed");

    const appeal = queue.find((q) => q.item.action === "appeal")!;
    await expect(approveItem(t.db, other, appeal.item.id)).rejects.toThrow(/not found/);
    await dismissItem(t.db, t.practiceId, appeal.item.id, t.userId);
    const [back] = await t.db.select().from(schema.denials).where(eq(schema.denials.id, appeal.denial.id));
    expect(back.status).toBe("open");
    expect((await agentQueue(t.db, t.practiceId, "dismissed")).length).toBe(1);
  });

  it("starts a copay checkout from a verified check-in and records it as pending", async () => {
    await t.db.update(schema.patientInsurances).set({ copayCents: 3000 }).where(eq(schema.patientInsurances.patientId, patient.id));
    const appt = await createAppointment(t.db, t.practiceId, { patientId: patient.id, providerId: provider.id, startsAt: new Date(Date.now() + 26 * 3_600_000), minutes: 20, type: "office_visit" });
    const { token, link } = await createCheckinLink(t.db, t.practiceId, appt.id);
    expect((await verifyDob(t.db, token, patient.dob)).ok).toBe(true);
    const calls: { amountCents: number; successUrl: string }[] = [];
    const client = { createCheckout: async (p: { amountCents: number; successUrl: string }) => { calls.push(p); return { id: "cs_copay_1", url: "https://checkout.stripe.com/c/cs_copay_1" }; } };
    // The copay shown at check-in prefers a verified eligibility answer over the one on file.
    const expected = (await loadCheckin(t.db, link.id))!.copayCents!;
    expect(expected).toBeGreaterThan(0);
    const r = await startCheckinCopay(t.db, link.id, { origin: "https://site.test", token }, client as never);
    expect(r.url).toMatch(/checkout\.stripe\.com/);
    expect(calls[0]).toMatchObject({ amountCents: expected, successUrl: `https://site.test/check-in/${token}?paid=1` });
    const [pay] = await t.db.select().from(schema.onlinePayments).where(eq(schema.onlinePayments.id, r.paymentId));
    expect(pay).toMatchObject({ source: "checkin", status: "pending", amountCents: expected, providerRef: "cs_copay_1" });
    await expect(startCheckinCopay(t.db, link.id, { origin: "https://site.test", token })).rejects.toThrow(/not available/); // no Stripe connected
  });

  it("sends pay links to patients who owe, skipping recent recipients, plans and opt-outs", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key_123");
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).to);
      return { ok: true, status: 200, text: async () => "{}" };
    });
    await t.db.update(schema.patients).set({ email: "owes@example.com", remindersOptOut: false }).where(eq(schema.patients.id, patient.id));
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "transfer_to_patient", amountCents: 999_999, note: "test balance" });
    await t.db.update(schema.paymentPlans).set({ status: "cancelled" }).where(eq(schema.paymentPlans.patientId, patient.id));
    const first = await sendPayLinks(t.db, t.practiceId, "https://site.test", { minCents: 900_000 });
    expect(first.sent).toBe(1);
    expect(sent).toContain("owes@example.com");
    const again = await sendPayLinks(t.db, t.practiceId, "https://site.test", { minCents: 900_000 });
    expect(again).toMatchObject({ sent: 0, excluded: 1 }); // messaged this week
    const [log] = await t.db.select().from(schema.messageLog).where(and(eq(schema.messageLog.patientId, patient.id), eq(schema.messageLog.kind, "pay_link")));
    expect(log.status).toBe("sent");
  });
});
