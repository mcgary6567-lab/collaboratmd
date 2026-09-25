/**
 * Accounting: the month's ledger as a general-ledger journal entry, for
 * QuickBooks, Xero or any accounting system, and month-end close.
 *
 * Each ledger entry type maps to one balanced debit and credit. Receivables
 * are split between insurance and patients: charges go to insurance A/R,
 * transfers to patient responsibility move them to patient A/R, and each
 * payment or adjustment comes off the side it belongs to.
 *
 * Closing a month stores its totals. The ledger is never edited, but entries
 * posted later can still be dated into a closed month (an ERA imported late),
 * so the close page compares the stored totals with the ledger as it is now
 * and shows any difference instead of hiding it.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { accountingSettings, periodCloses, auditLog } = schema;

export const ACCOUNTS: Record<string, { label: string; default: string }> = {
  arInsurance: { label: "Accounts receivable, insurance", default: "Accounts Receivable - Insurance" },
  arPatient: { label: "Accounts receivable, patients", default: "Accounts Receivable - Patient" },
  revenue: { label: "Patient service revenue", default: "Patient Service Revenue" },
  contractual: { label: "Contractual allowances (contra-revenue)", default: "Contractual Allowances" },
  writeOff: { label: "Write-offs", default: "Write-offs" },
  badDebt: { label: "Bad debt", default: "Bad Debt Expense" },
  discounts: { label: "Patient discounts", default: "Patient Discounts" },
  cash: { label: "Cash or undeposited funds", default: "Undeposited Funds" },
};
type AccountKey = keyof typeof ACCOUNTS;

/** Ledger type → debit account, credit account. */
const POSTING: Record<string, [AccountKey, AccountKey, string]> = {
  charge: ["arInsurance", "revenue", "Charges billed"],
  transfer_to_patient: ["arPatient", "arInsurance", "Moved to patient responsibility"],
  insurance_payment: ["cash", "arInsurance", "Insurance payments"],
  patient_payment: ["cash", "arPatient", "Patient payments"],
  adjustment: ["contractual", "arInsurance", "Contractual adjustments"],
  write_off: ["writeOff", "arInsurance", "Write-offs"],
  discount: ["discounts", "arPatient", "Patient discounts"],
  bad_debt: ["badDebt", "arPatient", "Sent to collections (bad debt)"],
  refund: ["arPatient", "cash", "Refunds to patients"],
  reversal: ["arInsurance", "cash", "Payer recoupments and refunds"],
};

export async function accountNames(db: Db, practiceId: string): Promise<Record<AccountKey, string>> {
  const [row] = await db.select().from(accountingSettings).where(eq(accountingSettings.practiceId, practiceId)).limit(1);
  return Object.fromEntries(Object.entries(ACCOUNTS).map(([k, a]) => [k, row?.accounts[k]?.trim() || a.default])) as Record<AccountKey, string>;
}

export async function saveAccountNames(db: Db, practiceId: string, names: Record<string, string>) {
  const accounts = Object.fromEntries(Object.keys(ACCOUNTS).map((k) => [k, (names[k] ?? "").trim().slice(0, 100)]).filter(([, v]) => v));
  await db.insert(accountingSettings).values({ practiceId, accounts }).onConflictDoUpdate({ target: accountingSettings.practiceId, set: { accounts, updatedAt: new Date() } });
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
export function periodBounds(period: string) {
  if (!PERIOD.test(period)) throw new Error("Choose a month");
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** Cents by ledger type for the month, by posting date. */
export async function periodTotals(db: Db, practiceId: string, period: string): Promise<Record<string, number>> {
  const { start, end } = periodBounds(period);
  const { rows } = await db.execute<{ type: string; cents: string }>(sql`
    SELECT type, sum(amount_cents)::text AS cents FROM ledger_entries
    WHERE practice_id = ${practiceId} AND posted_at >= ${start} AND posted_at < ${end}
    GROUP BY type`);
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.cents)]));
}

export type JournalLine = { account: string; debitCents: number; creditCents: number; memo: string };

export function journalLines(totals: Record<string, number>, names: Record<AccountKey, string>): JournalLine[] {
  const lines: JournalLine[] = [];
  for (const [type, [dr, cr, memo]] of Object.entries(POSTING)) {
    const c = totals[type] ?? 0;
    if (!c) continue;
    // A negative total (rare: more reversals than entries) posts the other way round.
    const [d, k] = c > 0 ? [dr, cr] : [cr, dr];
    lines.push({ account: names[d], debitCents: Math.abs(c), creditCents: 0, memo });
    lines.push({ account: names[k], debitCents: 0, creditCents: Math.abs(c), memo });
  }
  return lines;
}

const money = (c: number) => (c / 100).toFixed(2);
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The journal as CSV. "standard" has separate debit and credit columns, which
 * most journal importers (QuickBooks among them) can map; "signed" has one
 * amount column, positive for debits and negative for credits, the way Xero's
 * manual journal import takes it (with account codes as the account names).
 * Either way the columns are mapped when importing.
 */
export function journalCsv(lines: JournalLine[], period: string, practiceName: string, format: "standard" | "signed") {
  const { end } = periodBounds(period);
  const date = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);
  const no = `CMD-${period}`;
  const narration = `${practiceName} billing activity ${period}`;
  const rows = format === "standard"
    ? [["Journal No", "Date", "Account", "Debit", "Credit", "Memo"], ...lines.map((l) => [no, date, l.account, l.debitCents ? money(l.debitCents) : "", l.creditCents ? money(l.creditCents) : "", `${narration}: ${l.memo}`])]
    : [["Narration", "Date", "Description", "Account", "Amount"], ...lines.map((l) => [narration, date, l.memo, l.account, money(l.debitCents - l.creditCents)])];
  return rows.map((r) => r.map((v) => cell(String(v))).join(",")).join("\n") + "\n";
}

/* ------------------------------ Month-end close ------------------------------ */

export async function closePeriod(db: Db, practiceId: string, period: string, userId?: string, now = new Date()) {
  const { end } = periodBounds(period);
  if (end > now) throw new Error("A month can be closed once it has ended");
  const totals = await periodTotals(db, practiceId, period);
  await db.insert(periodCloses).values({ practiceId, period, totals, closedBy: userId ?? null }).onConflictDoUpdate({ target: [periodCloses.practiceId, periodCloses.period], set: { totals, closedBy: userId ?? null, closedAt: new Date() } });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "period_closed", entity: "practice", entityId: practiceId, details: { period } });
  return totals;
}

export async function reopenPeriod(db: Db, practiceId: string, period: string, userId?: string) {
  await db.delete(periodCloses).where(and(eq(periodCloses.practiceId, practiceId), eq(periodCloses.period, period)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "period_reopened", entity: "practice", entityId: practiceId, details: { period } });
}

/** Closed months with what has changed in them since (entries dated into the month after it closed). */
export async function closes(db: Db, practiceId: string) {
  const rows = await db.select().from(periodCloses).where(eq(periodCloses.practiceId, practiceId)).orderBy(desc(periodCloses.period)).limit(24);
  return Promise.all(rows.map(async (r) => {
    const now = await periodTotals(db, practiceId, r.period);
    const types = new Set([...Object.keys(r.totals), ...Object.keys(now)]);
    const changes = [...types].map((t) => ({ type: t, closed: r.totals[t] ?? 0, now: now[t] ?? 0 })).filter((c) => c.closed !== c.now);
    return { ...r, changes };
  }));
}
