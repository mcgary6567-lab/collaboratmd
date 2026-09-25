import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { patientBalanceCents } from "./billing";
import { closeCollection, collectionCandidates, placeWithAgency, sendFinalNotice } from "./collections";
import { computeFinancials } from "./claims";
import { headlineKpis } from "./analytics";

describe("collections against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patient: typeof schema.patients.$inferSelect;
  let start: number;

  beforeAll(async () => {
    t = await testDb();
    [patient] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    await t.db.update(schema.paymentPlans).set({ status: "cancelled" }).where(eq(schema.paymentPlans.patientId, patient.id));
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "transfer_to_patient", amountCents: 40_000, note: "test balance" });
    const stmt = (n: string, date: string) => ({ practiceId: t.practiceId, patientId: patient.id, statementNumber: n, statementDate: date, dueDate: date, chargesCents: 0, insurancePaidCents: 0, adjustmentsCents: 0, patientPaidCents: 0, amountDueCents: 40_000, detail: { visits: [], unappliedPaymentsCents: 0, discountsCents: 0 }, status: "sent" });
    await t.db.insert(schema.statements).values([stmt("COLL-1", "2026-05-01"), stmt("COLL-2", "2026-06-01")]);
    start = await patientBalanceCents(t.db, patient.id);
  });
  afterAll(async () => { await t?.close(); });

  it("finds accounts past two statements and 60 days, not on a plan", async () => {
    const c = await collectionCandidates(t.db, t.practiceId, new Date("2026-09-24T12:00:00Z"));
    expect(c.find((x) => x.patientId === patient.id)).toMatchObject({ statementCount: expect.any(Number), balanceCents: start });
  });

  it("sends a final notice, waits the notice period, then writes the balance off to the agency", async () => {
    const sent: string[] = [];
    const now = new Date("2026-09-01T12:00:00Z");
    await t.db.update(schema.patients).set({ email: "pat@example.test" }).where(eq(schema.patients.id, patient.id));
    process.env.RESEND_API_KEY = "test";
    const { collection, delivery } = await sendFinalNotice(t.db, t.practiceId, patient.id, {
      userId: t.userId, origin: "https://app.example", now,
      deps: { email: async (_to, subject, text) => { sent.push(`${subject}\n${text}`); return true; } },
    });
    delete process.env.RESEND_API_KEY;
    expect(delivery?.email).toBe("sent");
    expect(sent[0]).toMatch(/Final notice/);
    expect(sent[0]).toMatch(/https:\/\/app\.example\/portal\//);
    await expect(sendFinalNotice(t.db, t.practiceId, patient.id)).rejects.toThrow(/already in collections/);
    expect((await collectionCandidates(t.db, t.practiceId)).some((x) => x.patientId === patient.id)).toBe(false);

    await expect(placeWithAgency(t.db, t.practiceId, collection.id, "Acme Recovery", { now: new Date("2026-09-05T12:00:00Z") })).rejects.toThrow(/until 2026-09-11/);
    await expect(placeWithAgency(t.db, t.practiceId, collection.id, "  ", { now: new Date("2026-09-12T12:00:00Z") })).rejects.toThrow(/Name the/);
    const placed = await placeWithAgency(t.db, t.practiceId, collection.id, "Acme Recovery", { userId: t.userId, now: new Date("2026-09-12T12:00:00Z") });
    expect(placed).toMatchObject({ stage: "agency", amountCents: start });
    expect(await patientBalanceCents(t.db, patient.id)).toBe(0);
    const k = await headlineKpis(t.db, t.practiceId);
    expect(Number.isFinite(k.patientArCents ?? 0)).toBe(true);
  });

  it("posts what the agency recovers and reinstates the rest on recall", async () => {
    const [c] = await t.db.select().from(schema.patientCollections).where(and(eq(schema.patientCollections.patientId, patient.id), eq(schema.patientCollections.stage, "agency")));
    await expect(closeCollection(t.db, t.practiceId, c.id, "recalled", start + 1)).rejects.toThrow(/More than/);
    await expect(closeCollection(t.db, "00000000-0000-0000-0000-000000000000", c.id, "recalled", 0)).rejects.toThrow(/not found/);
    await closeCollection(t.db, t.practiceId, c.id, "recalled", 10_000, { userId: t.userId });
    expect(await patientBalanceCents(t.db, patient.id)).toBe(start - 10_000);
    const entries = await t.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.patientId, patient.id));
    expect(entries.filter((e) => e.type === "bad_debt").reduce((a, e) => a + e.amountCents, 0)).toBe(0);
    await expect(closeCollection(t.db, t.practiceId, c.id, "settled", 0)).rejects.toThrow(/already closed/);
  });

  it("settling leaves the unrecovered rest written off", async () => {
    const { collection } = await sendFinalNotice(t.db, t.practiceId, patient.id, { now: new Date("2026-01-01T00:00:00Z") });
    const bal = await patientBalanceCents(t.db, patient.id);
    await placeWithAgency(t.db, t.practiceId, collection.id, "Acme Recovery");
    await closeCollection(t.db, t.practiceId, collection.id, "settled", 5_000);
    expect(await patientBalanceCents(t.db, patient.id)).toBe(0);
    const paid = await t.db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.patientId, patient.id), eq(schema.ledgerEntries.note, "Collected by Acme Recovery")));
    expect(paid.reduce((a, e) => a + e.amountCents, 0)).toBe(15_000);
    expect(bal).toBeGreaterThan(0);
  });

  it("claim financials treat bad debt like a discount", () => {
    expect(computeFinancials([{ type: "transfer_to_patient", amountCents: 100 }, { type: "bad_debt", amountCents: 60 }]).patientBalanceCents).toBe(40);
  });
});
