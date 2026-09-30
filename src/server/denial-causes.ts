/**
 * Denial root causes: what actually went wrong, and whose process prevents it
 * next time. Every denial starts with a cause inferred from its category and
 * reason code, which staff can correct; the report shows how much of the
 * denied money was preventable, by owner, cause and month.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { denials, auditLog } = schema;
type Row = Record<string, string | null>;

export const OWNERS: Record<string, string> = {
  front_desk: "Front desk and registration",
  coding: "Coding",
  clinical: "Clinical documentation",
  billing: "Billing",
  payer: "Payer (not preventable)",
};

export const ROOT_CAUSES: Record<string, { label: string; owner: keyof typeof OWNERS; preventable: boolean }> = {
  registration: { label: "Wrong member ID, name or date of birth", owner: "front_desk", preventable: true },
  eligibility: { label: "Coverage not checked or not active", owner: "front_desk", preventable: true },
  authorization: { label: "No prior authorization or referral", owner: "front_desk", preventable: true },
  cob: { label: "Wrong payer or billing order", owner: "front_desk", preventable: true },
  coding: { label: "Coding error (code, modifier, units, diagnosis)", owner: "coding", preventable: true },
  documentation: { label: "Documentation missing or insufficient", owner: "clinical", preventable: true },
  medical_necessity: { label: "Medical necessity not supported", owner: "clinical", preventable: true },
  timely_filing: { label: "Filed late", owner: "billing", preventable: true },
  duplicate: { label: "Duplicate claim", owner: "billing", preventable: true },
  billing_error: { label: "Other billing error (missing information, wrong provider)", owner: "billing", preventable: true },
  benefit_limit: { label: "Not covered or benefit limit reached", owner: "payer", preventable: false },
  payer_error: { label: "Payer processing error", owner: "payer", preventable: false },
};

/** A first guess from the denial's category and reason code; staff correct it where it is wrong. */
export function inferRootCause(category: string, carc: string): string {
  if (["31", "140"].includes(carc)) return "registration";
  if (["96", "204", "119", "35"].includes(carc)) return "benefit_limit";
  if (["16", "B7"].includes(carc) && category !== "coding") return "billing_error";
  const byCategory: Record<string, string> = { eligibility: "eligibility", authorization: "authorization", coding: "coding", timely_filing: "timely_filing", duplicate: "duplicate", medical_necessity: "medical_necessity", cob: "cob" };
  return byCategory[category] ?? "billing_error";
}

export async function setRootCause(db: Db, practiceId: string, denialId: string, cause: string, userId?: string) {
  const c = ROOT_CAUSES[cause];
  if (!c) throw new Error("Choose the root cause");
  const [row] = await db.update(denials).set({ rootCause: cause, rootOwner: c.owner }).where(and(eq(denials.id, denialId), eq(denials.practiceId, practiceId))).returning();
  if (!row) throw new Error("Denial not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "denial_root_cause", entity: "denial", entityId: denialId, details: { cause } });
}

export async function rootCauseReport(db: Db, practiceId: string, from: string, to: string) {
  const { rows } = await db.execute<Row>(sql`
    SELECT d.id, d.claim_id, d.category, d.carc, d.amount_cents::text AS cents, d.root_cause, d.created_at::date::text AS on_date, to_char(d.created_at, 'YYYY-MM') AS month,
      c.control_number, py.name AS payer
    FROM denials d JOIN claims c ON c.id = d.claim_id JOIN payers py ON py.id = c.payer_id
    WHERE d.practice_id = ${practiceId} AND d.created_at::date BETWEEN ${from} AND ${to}
    ORDER BY d.created_at DESC`);
  const items = rows.map((r) => {
    const cause = r.root_cause && ROOT_CAUSES[r.root_cause] ? r.root_cause : inferRootCause(r.category!, r.carc!);
    return { id: r.id!, claimId: r.claim_id!, controlNumber: r.control_number!, payer: r.payer!, carc: r.carc!, cents: Number(r.cents), on: r.on_date!, month: r.month!, cause, inferred: !r.root_cause, ...ROOT_CAUSES[cause] };
  });
  const sum = <K extends string>(key: (i: (typeof items)[number]) => K) => {
    const m = new Map<K, { count: number; cents: number }>();
    for (const i of items) { const t = m.get(key(i)) ?? { count: 0, cents: 0 }; t.count++; t.cents += i.cents; m.set(key(i), t); }
    return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.cents - a.cents);
  };
  const total = items.reduce((a, i) => a + i.cents, 0);
  const preventable = items.filter((i) => i.preventable).reduce((a, i) => a + i.cents, 0);
  const months = new Map<string, { total: number; preventable: number }>();
  for (const i of items) { const m = months.get(i.month) ?? { total: 0, preventable: 0 }; m.total += i.cents; if (i.preventable) m.preventable += i.cents; months.set(i.month, m); }
  return {
    items, total, preventable, preventableShare: total ? preventable / total : 0,
    byOwner: sum((i) => i.owner), byCause: sum((i) => i.cause),
    byMonth: [...months].map(([month, v]) => ({ month, ...v, share: v.total ? v.preventable / v.total : 0 })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
