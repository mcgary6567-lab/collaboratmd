import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { accountNames, closePeriod, closes, journalCsv, journalLines, periodTotals } from "./accounting";
import { createInvoice, invoiceFee, saveAgreement, setInvoiceStatus } from "./client-billing";
import { applyRules, productivity, saveRule, slaSummary } from "./work-rules";
import { assignableUsers } from "./work";

describe("journal entries", () => {
  const names = { arInsurance: "AR Ins", arPatient: "AR Pt", revenue: "Revenue", contractual: "Contractual", writeOff: "Write-offs", badDebt: "Bad debt", discounts: "Discounts", cash: "Cash" };

  it("posts each ledger type as a balanced debit and credit", () => {
    const lines = journalLines({ charge: 100_000, insurance_payment: 60_000, adjustment: 25_000, transfer_to_patient: 15_000, patient_payment: 10_000, refund: 500, reversal: -200 }, names);
    const debit = lines.reduce((a, l) => a + l.debitCents, 0);
    expect(debit).toBe(lines.reduce((a, l) => a + l.creditCents, 0));
    expect(lines.find((l) => l.memo === "Charges billed" && l.debitCents)).toMatchObject({ account: "AR Ins", debitCents: 100_000 });
    expect(lines.find((l) => l.memo === "Patient payments" && l.creditCents)).toMatchObject({ account: "AR Pt" });
    // A negative total posts the other way round.
    expect(lines.find((l) => l.memo.startsWith("Payer recoup") && l.debitCents)).toMatchObject({ account: "Cash", debitCents: 200 });
  });

  it("writes debit/credit columns, or one signed amount column", () => {
    const lines = journalLines({ charge: 12_345 }, names);
    const std = journalCsv(lines, "2030-01", "Acme, PC", "standard").split("\n");
    expect(std[0]).toBe("Journal No,Date,Account,Debit,Credit,Memo");
    expect(std[1]).toBe('CMD-2030-01,2030-01-31,AR Ins,123.45,,"Acme, PC billing activity 2030-01: Charges billed"');
    const signed = journalCsv(lines, "2030-01", "Acme", "signed").split("\n");
    expect(signed[0]).toBe("Narration,Date,Description,Account,Amount");
    expect(signed.slice(1, 3).map((r) => r.split(",").at(-1))).toEqual(["123.45", "-123.45"]);
  });
});

describe("close, invoicing and work rules against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patientId: string;
  beforeAll(async () => {
    t = await testDb();
    [{ id: patientId }] = await t.db.select({ id: schema.patients.id }).from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    const at = (d: string) => new Date(`${d}T15:00:00Z`);
    await t.db.insert(schema.ledgerEntries).values([
      { practiceId: t.practiceId, patientId, type: "insurance_payment", amountCents: 500_000, postedAt: at("2030-01-10") },
      { practiceId: t.practiceId, patientId, type: "reversal", amountCents: 20_000, postedAt: at("2030-01-12") },
      { practiceId: t.practiceId, patientId, type: "patient_payment", amountCents: 30_000, postedAt: at("2030-01-20") },
      { practiceId: t.practiceId, patientId, type: "insurance_payment", amountCents: 99_999, postedAt: at("2030-02-01") },
    ]);
  });
  afterAll(async () => { await t?.close(); });

  it("closes a month and shows what was posted into it afterwards", async () => {
    await expect(closePeriod(t.db, t.practiceId, "2030-01", t.userId, new Date("2030-01-15"))).rejects.toThrow(/once it has ended/);
    expect(await closePeriod(t.db, t.practiceId, "2030-01", t.userId, new Date("2030-02-02"))).toEqual({ insurance_payment: 500_000, reversal: 20_000, patient_payment: 30_000 });
    expect((await closes(t.db, t.practiceId)).find((c) => c.period === "2030-01")?.changes).toEqual([]);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId, type: "patient_payment", amountCents: 1_000, postedAt: new Date("2030-01-31T10:00:00Z") });
    expect((await closes(t.db, t.practiceId)).find((c) => c.period === "2030-01")?.changes).toEqual([{ type: "patient_payment", closed: 30_000, now: 31_000 }]);
    expect((await accountNames(t.db, t.practiceId)).cash).toBe("Undeposited Funds");
    expect(await periodTotals(t.db, t.practiceId, "2030-02")).toEqual({ insurance_payment: 99_999 });
  });

  it("invoices a client on net collections with a minimum, once per month", async () => {
    expect(invoiceFee(100_000, 50_000, 650, 0, true)).toEqual({ baseCents: 150_000, feeCents: 9_750 });
    expect(invoiceFee(100_000, 50_000, 650, 0, false)).toEqual({ baseCents: 100_000, feeCents: 6_500 });
    expect(invoiceFee(1_000, 0, 650, 25_000, true).feeCents).toBe(25_000);
    await expect(createInvoice(t.db, t.practiceId, "2030-01", t.userId, new Date("2030-02-05"))).rejects.toThrow(/agreement/);
    await expect(saveAgreement(t.db, t.practiceId, { issuerName: "Acme Billing", issuerAddress: "", ratePct: 80, minimumCents: 0, includePatient: true, termsDays: 30 })).rejects.toThrow(/percent/);
    await saveAgreement(t.db, t.practiceId, { issuerName: "Acme Billing", issuerAddress: "1 Main St", ratePct: 6.5, minimumCents: 0, includePatient: true, termsDays: 30 }, t.userId);

    const inv = await createInvoice(t.db, t.practiceId, "2030-01", t.userId, new Date("2030-02-05"));
    // (500,000 - 20,000) insurance + 31,000 patient = 511,000 x 6.5%
    expect(inv).toMatchObject({ insuranceCents: 480_000, patientCents: 31_000, baseCents: 511_000, feeCents: 33_215, status: "draft", dueDate: "2030-03-07", number: "203001-001" });
    await expect(createInvoice(t.db, t.practiceId, "2030-01", t.userId, new Date("2030-02-05"))).rejects.toThrow(/already invoiced/);
    await expect(setInvoiceStatus(t.db, t.practiceId, inv.id, "paid")).rejects.toThrow(/cannot be marked paid/);
    await setInvoiceStatus(t.db, t.practiceId, inv.id, "void", t.userId);
    const again = await createInvoice(t.db, t.practiceId, "2030-01", t.userId, new Date("2030-02-05"));
    expect(again.number).toBe("203001-002");
    await setInvoiceStatus(t.db, t.practiceId, again.id, "sent");
    await setInvoiceStatus(t.db, t.practiceId, again.id, "paid");
  });

  it("hands out open denials round-robin with a due date, once", async () => {
    const people = (await assignableUsers(t.db, t.practiceId)).slice(0, 2);
    await expect(saveRule(t.db, t.practiceId, { name: "x", kind: "denials", conditions: {}, assigneeIds: [], slaDays: 5, priority: "normal" })).rejects.toThrow(/at least one person/);
    const rule = await saveRule(t.db, t.practiceId, { name: "All denials", kind: "denials", conditions: {}, assigneeIds: people.map((p) => p.id), slaDays: 3, priority: "high" }, t.userId);
    const open = await t.db.select().from(schema.denials).where(and(eq(schema.denials.practiceId, t.practiceId), eq(schema.denials.status, "open")));
    const now = new Date("2030-03-01T12:00:00Z");
    const first = await applyRules(t.db, t.practiceId, { now });
    expect(first["All denials"]).toBe(open.length);
    const made = await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.practiceId, t.practiceId), isNotNull(schema.tasks.ruleId)));
    expect(made).toHaveLength(open.length);
    expect(made.every((m) => m.dueDate === "2030-03-04" && m.priority === "high" && m.entityType === "denial")).toBe(true);
    if (people.length === 2 && open.length >= 2) {
      const counts = people.map((p) => made.filter((m) => m.assigneeId === p.id).length);
      expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(1);
    }
    expect((await applyRules(t.db, t.practiceId, { now }))["All denials"]).toBe(0);

    await t.db.update(schema.tasks).set({ status: "done", completedAt: new Date("2030-03-02T12:00:00Z") }).where(eq(schema.tasks.id, made[0].id));
    const sla = (await slaSummary(t.db, t.practiceId, new Date("2030-03-10T12:00:00Z"))).find((r) => r.ruleId === rule.id)!;
    expect(sla).toMatchObject({ open: open.length - 1, overdue: open.length - 1, done30: 1, onTimePct: 1 });
    const who = (await productivity(t.db, t.practiceId, new Date("2030-03-10T12:00:00Z"))).find((p) => p.userId === made[0].assigneeId)!;
    expect(who.done30).toBe(1);
    expect(who.avgDays).toBeCloseTo(new Date("2030-03-02T12:00:00Z").getTime() / 86_400_000 - made[0].createdAt.getTime() / 86_400_000, 1);
  });
});
