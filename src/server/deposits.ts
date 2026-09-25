/**
 * Bank deposit reconciliation: the bank's CSV export is imported, and each
 * deposit is matched to the ERA (835) whose payment it is, by the EFT trace
 * or check number in the deposit's description, or by an exact amount within
 * a few days when only one ERA fits. Whatever cannot be matched with
 * confidence is left for a person, along with ERAs no deposit has shown up for.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { parseCsv } from "@/lib/import/csv";
import { normalizeDate } from "@/lib/import/patients";

const { bankDeposits, remittances, auditLog } = schema;

export type DepositRow = { date: string; amountCents: number; description: string };

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]+/g, " ").trim();

export function parseAmount(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.includes("-");
  const n = Number(s.replace(/[()$,\s-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

/** Reads a bank export: a date, a description and either one amount column or separate credit and debit columns. Keeps credits only. */
export function parseBankCsv(text: string): { rows: DepositRow[]; skipped: number; error?: string } {
  const t = parseCsv(text, 20_000);
  const h = t.headers.map(norm);
  const find = (...names: string[]) => {
    for (const n of names) {
      const i = h.findIndex((x) => x === n);
      if (i >= 0) return i;
    }
    for (const n of names) {
      const i = h.findIndex((x) => x.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const dateCol = find("posting date", "posted date", "date", "transaction date");
  const descCol = find("description", "memo", "details", "payee", "name", "narrative");
  const creditCol = find("credit", "deposit", "deposits");
  const amountCol = creditCol >= 0 ? creditCol : find("amount");
  if (dateCol < 0 || amountCol < 0) return { rows: [], skipped: t.rows.length, error: "Could not find a date column and an amount or credit column in the file." };
  const rows: DepositRow[] = [];
  let skipped = 0;
  for (const r of t.rows) {
    const date = normalizeDate(r[dateCol] ?? "");
    const amountCents = parseAmount(r[amountCol] ?? "");
    if (!date || amountCents === null || amountCents <= 0) {
      skipped++;
      continue;
    }
    rows.push({ date, amountCents, description: (descCol >= 0 ? r[descCol] : "").trim().slice(0, 500) || "(no description)" });
  }
  return { rows, skipped };
}

/** Imports deposits; a row already imported (same date, amount, description and position among its twins) is skipped. */
export async function importDeposits(db: Db, practiceId: string, text: string, userId?: string) {
  const parsed = parseBankCsv(text);
  if (parsed.error) throw new Error(parsed.error);
  const seen = new Map<string, number>();
  let added = 0;
  for (const r of parsed.rows) {
    const base = `${r.date}|${r.amountCents}|${r.description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const inserted = await db
      .insert(bankDeposits)
      .values({ practiceId, depositDate: r.date, amountCents: r.amountCents, description: r.description, fingerprint: `${base}#${n}` })
      .onConflictDoNothing()
      .returning();
    added += inserted.length;
  }
  const matched = await autoMatch(db, practiceId);
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "bank_deposits_imported", entity: "bank_deposit", entityId: null, details: { added, matched, skipped: parsed.skipped } });
  return { added, duplicates: parsed.rows.length - added, skipped: parsed.skipped, matched };
}

const digits = (s: string) => s.replace(/[^0-9a-z]/gi, "").toUpperCase();
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** ERAs not yet tied to any deposit. */
async function openRemittances(db: Db, practiceId: string) {
  return db
    .select()
    .from(remittances)
    .where(and(eq(remittances.practiceId, practiceId), sql`NOT EXISTS (SELECT 1 FROM bank_deposits b WHERE b.remittance_id = ${remittances.id} AND b.status = 'matched')`))
    .orderBy(asc(remittances.paymentDate));
}

export async function autoMatch(db: Db, practiceId: string) {
  const deposits = await db.select().from(bankDeposits).where(and(eq(bankDeposits.practiceId, practiceId), eq(bankDeposits.status, "unmatched"))).orderBy(asc(bankDeposits.depositDate));
  let open = await openRemittances(db, practiceId);
  let matched = 0;
  for (const d of deposits) {
    const desc = digits(d.description);
    let pick: (typeof open)[number] | undefined;
    let reason = "";
    // 1. The EFT trace or check number appears in the bank's description.
    const byTrace = open.filter((r) => digits(r.checkNumber).length >= 4 && desc.includes(digits(r.checkNumber)));
    const traceAndAmount = byTrace.filter((r) => r.amountCents === d.amountCents);
    if (traceAndAmount.length === 1) {
      pick = traceAndAmount[0];
      reason = `Trace number ${pick.checkNumber} and amount match`;
    } else {
      // 2. Exactly one ERA for the same amount, paid from 5 days before to 3 days after the deposit date.
      const byAmount = open.filter((r) => r.amountCents === d.amountCents && dayDiff(d.depositDate, r.paymentDate) >= -3 && dayDiff(d.depositDate, r.paymentDate) <= 5);
      if (byAmount.length === 1) {
        pick = byAmount[0];
        const days = dayDiff(d.depositDate, pick.paymentDate);
        reason = `Only ERA for this amount (${pick.payerName}, paid ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days >= 0 ? "before" : "after"} the deposit)`;
      }
    }
    if (!pick) continue;
    await db.update(bankDeposits).set({ status: "matched", remittanceId: pick.id, matchReason: reason }).where(eq(bankDeposits.id, d.id));
    open = open.filter((r) => r.id !== pick!.id);
    matched++;
  }
  return matched;
}

async function ownDeposit(db: Db, practiceId: string, depositId: string) {
  const [d] = await db.select().from(bankDeposits).where(and(eq(bankDeposits.id, depositId), eq(bankDeposits.practiceId, practiceId))).limit(1);
  if (!d) throw new Error("Deposit not found");
  return d;
}

export async function matchDeposit(db: Db, practiceId: string, depositId: string, remittanceId: string, userId?: string) {
  const d = await ownDeposit(db, practiceId, depositId);
  const [r] = await db.select().from(remittances).where(and(eq(remittances.id, remittanceId), eq(remittances.practiceId, practiceId))).limit(1);
  if (!r) throw new Error("ERA not found");
  const [taken] = await db.select({ id: bankDeposits.id }).from(bankDeposits).where(and(eq(bankDeposits.remittanceId, remittanceId), eq(bankDeposits.status, "matched"))).limit(1);
  if (taken && taken.id !== depositId) throw new Error("That ERA is already matched to another deposit");
  const diff = d.amountCents - r.amountCents;
  await db.update(bankDeposits).set({ status: "matched", remittanceId, matchReason: diff === 0 ? "Matched by hand" : `Matched by hand; deposit differs from the ERA by ${(diff / 100).toFixed(2)}` }).where(eq(bankDeposits.id, depositId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "bank_deposit_matched", entity: "bank_deposit", entityId: depositId, details: { remittanceId } });
}

export async function setDepositStatus(db: Db, practiceId: string, depositId: string, status: "unmatched" | "ignored", userId?: string) {
  await ownDeposit(db, practiceId, depositId);
  await db.update(bankDeposits).set({ status, remittanceId: null, matchReason: status === "ignored" ? "Not an insurance payment" : null }).where(eq(bankDeposits.id, depositId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: `bank_deposit_${status}`, entity: "bank_deposit", entityId: depositId });
}

export async function depositsOverview(db: Db, practiceId: string) {
  const [deposits, open] = await Promise.all([
    db
      .select({ deposit: bankDeposits, remittance: remittances })
      .from(bankDeposits)
      .leftJoin(remittances, eq(remittances.id, bankDeposits.remittanceId))
      .where(eq(bankDeposits.practiceId, practiceId))
      .orderBy(desc(bankDeposits.depositDate))
      .limit(300),
    openRemittances(db, practiceId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const counts = { matched: 0, unmatched: 0, ignored: 0 };
  for (const d of deposits) counts[d.deposit.status as keyof typeof counts]++;
  return {
    deposits,
    openRemittances: open,
    /** Paid more than 7 days ago by the ERA, and no deposit for it yet. */
    missing: open.filter((r) => dayDiff(today, r.paymentDate) > 7),
    counts,
  };
}

/** For the manual-match picker: ERAs with the same amount first, then the rest by date. */
export function candidatesFor(deposit: { amountCents: number; depositDate: string }, open: { id: string; amountCents: number; paymentDate: string; payerName: string; checkNumber: string }[]) {
  return [...open].sort((a, b) => Number(b.amountCents === deposit.amountCents) - Number(a.amountCents === deposit.amountCents) || Math.abs(dayDiff(deposit.depositDate, a.paymentDate)) - Math.abs(dayDiff(deposit.depositDate, b.paymentDate))).slice(0, 25);
}
