/**
 * Write-off analysis: every dollar taken off A/R without being collected,
 * sorted by why. Contractual adjustments are the payer's contract working as
 * agreed; avoidable write-offs (timely filing, no authorization, eligibility,
 * coding, medical necessity) are money lost to a process the practice
 * controls; policy write-offs (small balances, courtesy, discounts) are
 * choices; bad debt went to collections.
 *
 * A write-off records its reason from migration 0063 on. Earlier ones are
 * sorted by the claim's last denial, or by what the note says.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { KIND_LABELS, WRITE_OFF_CATEGORIES } from "@/lib/billing/write-off-categories";

type Row = Record<string, string | null>;

export { WRITE_OFF_CATEGORIES, KIND_LABELS };
type Kind = keyof typeof KIND_LABELS;

/** A write-off's category: as recorded, or inferred from the claim's last denial and the note. */
export function inferCategory(recorded: string | null, denialCategory: string | null, note: string | null): string {
  if (recorded && WRITE_OFF_CATEGORIES[recorded]) return recorded;
  const n = (note ?? "").toLowerCase();
  if (n.startsWith("charge removed")) return "void";
  if (n.startsWith("duplicate")) return "duplicate";
  if (/timely/.test(n)) return "timely_filing";
  if (/auth/.test(n)) return "authorization";
  if (/small balance/.test(n)) return "small_balance";
  if (/courtesy|admin/.test(n)) return "courtesy";
  const byDenial: Record<string, string> = { timely_filing: "timely_filing", authorization: "authorization", eligibility: "eligibility", cob: "eligibility", coding: "coding", medical_necessity: "medical_necessity", duplicate: "duplicate" };
  return (denialCategory && byDenial[denialCategory]) || "other";
}

export async function writeOffAnalysis(db: Db, practiceId: string, from: string, to: string) {
  const { rows } = await db.execute<Row>(sql`
    SELECT le.type, le.amount_cents::text AS cents, le.write_off_category, le.note, le.posted_at::date::text AS on_date, to_char(le.posted_at, 'YYYY-MM') AS month,
      py.name AS payer, u.name AS who,
      (SELECT d.category FROM denials d WHERE d.claim_id = le.claim_id ORDER BY d.created_at DESC LIMIT 1) AS denial_category
    FROM ledger_entries le
    LEFT JOIN claims c ON c.id = le.claim_id LEFT JOIN payers py ON py.id = c.payer_id LEFT JOIN users u ON u.id = le.posted_by
    WHERE le.practice_id = ${practiceId} AND le.type IN ('adjustment', 'write_off', 'discount', 'bad_debt')
      AND le.posted_at::date BETWEEN ${from} AND ${to}`);
  const byKind = new Map<Kind, number>();
  const byCategory = new Map<string, number>();
  const byPayer = new Map<string, number>();
  const byPerson = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const add = <K>(m: Map<K, number>, k: K, c: number) => m.set(k, (m.get(k) ?? 0) + c);
  for (const r of rows) {
    const cents = Number(r.cents);
    let kind: Kind;
    if (r.type === "adjustment") kind = "contractual";
    else if (r.type === "bad_debt") kind = "collections";
    else if (r.type === "discount") kind = "policy";
    else {
      const cat = inferCategory(r.write_off_category, r.denial_category, r.note);
      kind = WRITE_OFF_CATEGORIES[cat].kind;
      add(byCategory, cat, cents);
      if (kind === "avoidable") {
        add(byPayer, r.payer ?? "No claim", cents);
        add(byPerson, r.who ?? "Automatic", cents);
        add(byMonth, r.month!, cents);
      }
    }
    add(byKind, kind, cents);
  }
  const list = <K extends string>(m: Map<K, number>) => [...m].map(([key, cents]) => ({ key, cents })).sort((a, b) => b.cents - a.cents);
  return {
    byKind: (Object.keys(KIND_LABELS) as Kind[]).map((k) => ({ key: k, label: KIND_LABELS[k], cents: byKind.get(k) ?? 0 })),
    byCategory: list(byCategory).map((c) => ({ ...c, label: WRITE_OFF_CATEGORIES[c.key].label, kind: WRITE_OFF_CATEGORIES[c.key].kind })),
    avoidableByPayer: list(byPayer),
    avoidableByPerson: list(byPerson),
    avoidableByMonth: [...byMonth].map(([month, cents]) => ({ month, cents })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
