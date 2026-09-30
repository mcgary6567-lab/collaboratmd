/**
 * Provider compensation worksheet: what each provider earns for a period
 * under the plan the practice set, from the collections on their claims and
 * their work RVUs. A worksheet for the practice to check against each
 * employment agreement, not payroll.
 *
 *  - collections: a percentage of what was collected on the provider's claims
 *  - wrvu: an amount per work RVU
 *  - base_bonus_collections: a base, plus a percentage of collections above a threshold
 *  - base_bonus_wrvu: a base, plus an amount per work RVU above a threshold
 *
 * Collections are payments posted in the period on the provider's claims
 * (insurance and patient), less refunds and recoupments. Work RVUs come from
 * the Medicare fee schedule file for visits in the period (Productivity).
 */
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { productivity } from "./productivity";

const { compPlans, providers, auditLog } = schema;

export const PLAN_KINDS: Record<string, string> = {
  collections: "Percentage of collections",
  wrvu: "Amount per work RVU",
  base_bonus_collections: "Base, plus a percentage of collections above a threshold",
  base_bonus_wrvu: "Base, plus an amount per work RVU above a threshold",
};

export type PlanInput = { providerId: string; kind: string; baseCents: number; collectionsPct: number | null; perRvuCents: number | null; threshold: number | null; effectiveFrom: string; notes?: string };

export async function savePlan(db: Db, practiceId: string, input: PlanInput, userId?: string) {
  const [prov] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, input.providerId), eq(providers.practiceId, practiceId))).limit(1);
  if (!prov) throw new Error("Provider not found");
  if (!PLAN_KINDS[input.kind]) throw new Error("Choose how the provider is paid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error("Enter the date the plan starts");
  const usesPct = input.kind === "collections" || input.kind === "base_bonus_collections";
  if (usesPct && (input.collectionsPct === null || !(input.collectionsPct > 0 && input.collectionsPct <= 100))) throw new Error("Enter the percentage of collections");
  if (!usesPct && (input.perRvuCents === null || !(input.perRvuCents > 0))) throw new Error("Enter the amount per work RVU");
  if (input.kind.startsWith("base_bonus") && (input.threshold === null || input.threshold < 0 || !(input.baseCents >= 0))) throw new Error("Enter the base and the threshold");
  const [row] = await db.insert(compPlans).values({
    practiceId, providerId: input.providerId, kind: input.kind, baseCents: input.baseCents || 0, collectionsPct: usesPct ? input.collectionsPct : null,
    perRvuCents: usesPct ? null : input.perRvuCents, threshold: input.kind.startsWith("base_bonus") ? input.threshold : null, effectiveFrom: input.effectiveFrom, notes: input.notes?.trim().slice(0, 500) || null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "comp_plan_saved", entity: "provider", entityId: input.providerId, details: { kind: input.kind } });
  return row;
}

/** The pay a plan gives for the period's collections and work RVUs. */
export function payFor(plan: { kind: string; baseCents: number; collectionsPct: number | null; perRvuCents: number | null; threshold: number | null }, collectionsCents: number, wrvu: number) {
  const pct = (plan.collectionsPct ?? 0) / 100;
  const per = plan.perRvuCents ?? 0;
  switch (plan.kind) {
    case "collections": return Math.round(collectionsCents * pct);
    case "wrvu": return Math.round(wrvu * per);
    case "base_bonus_collections": return plan.baseCents + Math.round(Math.max(0, collectionsCents - (plan.threshold ?? 0) * 100) * pct);
    case "base_bonus_wrvu": return plan.baseCents + Math.round(Math.max(0, wrvu - (plan.threshold ?? 0)) * per);
    default: return 0;
  }
}

export async function compensation(db: Db, practiceId: string, from: string, to: string) {
  const [prod, { rows: coll }, plans, provs] = await Promise.all([
    productivity(db, practiceId, from, to),
    db.execute<{ provider_id: string; cents: string }>(sql`
      SELECT e.provider_id, (COALESCE(sum(le.amount_cents) FILTER (WHERE le.type IN ('insurance_payment', 'patient_payment')), 0)
        - COALESCE(sum(le.amount_cents) FILTER (WHERE le.type IN ('reversal', 'refund')), 0))::text AS cents
      FROM ledger_entries le JOIN claims c ON c.id = le.claim_id JOIN encounters e ON e.id = c.encounter_id
      WHERE le.practice_id = ${practiceId} AND le.posted_at::date BETWEEN ${from} AND ${to}
      GROUP BY e.provider_id`),
    db.select().from(compPlans).where(and(eq(compPlans.practiceId, practiceId), lte(compPlans.effectiveFrom, to))).orderBy(desc(compPlans.effectiveFrom), desc(compPlans.createdAt)),
    db.select().from(providers).where(eq(providers.practiceId, practiceId)),
  ]);
  const collections = new Map(coll.map((r) => [r.provider_id, Number(r.cents)]));
  const wrvus = new Map(prod.providers.map((p) => [p.id, p.wrvu]));
  return provs.map((p) => {
    const plan = plans.find((x) => x.providerId === p.id) ?? null;
    const c = collections.get(p.id) ?? 0;
    const w = wrvus.get(p.id) ?? 0;
    return { providerId: p.id, provider: `${p.firstName} ${p.lastName}`, credential: p.credential, collectionsCents: c, wrvu: w, plan, payCents: plan ? payFor(plan, c, w) : null };
  }).filter((r) => r.plan || r.collectionsCents || r.wrvu);
}
