import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { patientBalanceCents } from "./billing";
import { getClaimFinancials } from "./claims";
import {
  approveRefund, cancelRefund, creditBalances, disputeData, disputeLetterText, dismissMissedCharge, issueRefund, markDisputed, missedCharges, recordRecovery, requestRefund,
} from "./recovery";

describe("revenue recovery", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let claim: typeof schema.claims.$inferSelect;
  beforeAll(async () => {
    t = await testDb();
    [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
  });
  afterAll(async () => { await t?.close(); });

  it("finds seen-but-unbilled visits and charges with no claim, and dismissals need a reason", async () => {
    const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.id, claim.encounterId));
    const starts = new Date("2031-03-02T15:00:00Z");
    const now = new Date("2031-03-05T12:00:00Z");
    const [appt] = await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: claim.patientId, providerId: enc.providerId, startsAt: starts, endsAt: new Date(starts.getTime() + 1_800_000), status: "completed" }).returning();
    const [noShow] = await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: claim.patientId, providerId: enc.providerId, startsAt: new Date("2031-03-03T15:00:00Z"), endsAt: new Date("2031-03-03T15:30:00Z"), status: "no_show" }).returning();
    const [orphan] = await t.db.insert(schema.encounters).values({ practiceId: t.practiceId, patientId: claim.patientId, providerId: enc.providerId, dateOfService: "2031-03-01", diagnoses: ["I10"], createdAt: new Date("2031-03-01T18:00:00Z") }).returning();
    await t.db.insert(schema.charges).values({ encounterId: orphan.id, lineNumber: 1, cpt: "99213", chargeCents: 15_000, units: 1 });

    let found = await missedCharges(t.db, t.practiceId, now);
    expect(found.find((m) => m.id === appt.id)).toMatchObject({ kind: "appointment", date: "2031-03-02" });
    expect(found.some((m) => m.id === noShow.id)).toBe(false);
    expect(found.find((m) => m.id === orphan.id)).toMatchObject({ kind: "encounter", estimateCents: 15_000 });

    await expect(dismissMissedCharge(t.db, t.practiceId, appt.id, "  ")).rejects.toThrow(/why/);
    await dismissMissedCharge(t.db, t.practiceId, appt.id, "Post-op visit inside the global period", t.userId);
    found = await missedCharges(t.db, t.practiceId, now);
    expect(found.some((m) => m.id === appt.id)).toBe(false);

    // A visit whose charges were entered on the same day without linking the appointment is not missed.
    const [linked] = await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: claim.patientId, providerId: enc.providerId, startsAt: new Date("2031-03-01T15:00:00Z"), endsAt: new Date("2031-03-01T15:30:00Z"), status: "checked_in" }).returning();
    expect((await missedCharges(t.db, t.practiceId, now)).some((m) => m.id === linked.id)).toBe(false);
  });

  it("writes one dispute letter per payer and tracks what it recovered", async () => {
    const [u] = await t.db.insert(schema.underpayments).values({ practiceId: t.practiceId, claimId: claim.id, payerId: claim.payerId, expectedAllowedCents: 12_000, actualAllowedCents: 9_500, varianceCents: 2_500 }).returning();
    const d = await disputeData(t.db, t.practiceId, claim.payerId);
    expect(d.claims.map((c) => c.underpaymentId)).toContain(u.id);
    const letter = disputeLetterText(d, new Date("2026-09-25T12:00:00Z"));
    expect(letter).toContain(`Claim ${claim.controlNumber}`);
    expect(letter).toContain("underpaid $25.00");
    expect(letter).toContain("September 25, 2026");
    await expect(disputeData(t.db, "00000000-0000-0000-0000-000000000000", claim.payerId)).rejects.toThrow(/not found/);

    expect(await markDisputed(t.db, t.practiceId, [u.id], t.userId)).toBe(1);
    expect(await markDisputed(t.db, t.practiceId, [u.id], t.userId)).toBe(0); // already appealed
    let [row] = await t.db.select().from(schema.underpayments).where(eq(schema.underpayments.id, u.id));
    expect(row.status).toBe("appealed");
    expect(row.disputedAt).toBeInstanceOf(Date);

    await expect(recordRecovery(t.db, t.practiceId, u.id, -5)).rejects.toThrow(/amount/);
    await recordRecovery(t.db, t.practiceId, u.id, 2_500, t.userId);
    [row] = await t.db.select().from(schema.underpayments).where(eq(schema.underpayments.id, u.id));
    expect(row).toMatchObject({ status: "recovered", recoveredCents: 2_500 });
  });

  it("refunds a patient credit through request, approval and issue, posting it to the ledger", async () => {
    const before = await patientBalanceCents(t.db, claim.patientId);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: claim.patientId, type: "patient_payment", amountCents: before + 5_000, note: "overpaid at the desk" });
    const credit = (await creditBalances(t.db, t.practiceId)).patients.find((p) => p.patientId === claim.patientId)!;
    expect(credit.creditCents).toBe(5_000);

    await expect(requestRefund(t.db, t.practiceId, { payee: "patient", patientId: claim.patientId, amountCents: 6_000, reason: "Paid twice" })).rejects.toThrow(/Only \$50\.00/);
    const r = await requestRefund(t.db, t.practiceId, { payee: "patient", patientId: claim.patientId, amountCents: 5_000, reason: "Paid twice" }, t.userId);
    await expect(requestRefund(t.db, t.practiceId, { payee: "patient", patientId: claim.patientId, amountCents: 100, reason: "Again" })).rejects.toThrow(/Only \$0\.00/);
    await expect(issueRefund(t.db, t.practiceId, r.id, { method: "check", reference: "1001" })).rejects.toThrow(/Approve/);

    await approveRefund(t.db, t.practiceId, r.id, t.userId);
    await expect(issueRefund(t.db, t.practiceId, r.id, { method: "check", reference: " " })).rejects.toThrow(/check number/);
    await issueRefund(t.db, t.practiceId, r.id, { method: "check", reference: "1001" }, t.userId);
    await expect(cancelRefund(t.db, t.practiceId, r.id)).rejects.toThrow(/cannot be cancelled/);

    const [issued] = await t.db.select().from(schema.refunds).where(eq(schema.refunds.id, r.id));
    expect(issued.status).toBe("issued");
    const [entry] = await t.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.id, issued.ledgerEntryId!));
    expect(entry).toMatchObject({ type: "refund", amountCents: 5_000 });
    expect(await patientBalanceCents(t.db, claim.patientId)).toBe(0);
    expect((await creditBalances(t.db, t.practiceId)).patients.some((p) => p.patientId === claim.patientId)).toBe(false);
  });

  it("refunds an insurance overpayment as a reversal on the claim", async () => {
    const fin = await getClaimFinancials(t.db, claim.id);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: claim.patientId, claimId: claim.id, type: "insurance_payment", amountCents: fin.insuranceBalanceCents + 3_000, note: "duplicate payment" });
    const over = (await creditBalances(t.db, t.practiceId)).claims.find((c) => c.claimId === claim.id)!;
    expect(over.overpaidCents).toBe(3_000);

    const r = await requestRefund(t.db, t.practiceId, { payee: "payer", claimId: claim.id, amountCents: 3_000, reason: "Duplicate payment" }, t.userId);
    expect(r.payerId).toBe(claim.payerId);
    await approveRefund(t.db, t.practiceId, r.id, t.userId);
    await issueRefund(t.db, t.practiceId, r.id, { method: "check", reference: "1002" }, t.userId);
    expect((await getClaimFinancials(t.db, claim.id)).insuranceBalanceCents).toBe(0);
    expect((await creditBalances(t.db, t.practiceId)).claims.some((c) => c.claimId === claim.id)).toBe(false);

    const [again] = await t.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.practiceId, t.practiceId), eq(schema.auditLog.action, "refund_issued")));
    expect(again).toBeTruthy();
  });
});
