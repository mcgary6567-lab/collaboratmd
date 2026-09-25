/**
 * Payer rules learned from the practice's own denials. When a payer keeps
 * denying the same procedure for the same reason, propose the payer edit that
 * would have caught it, with the evidence, for a person to adopt or dismiss.
 *
 * What the rule should say comes from what the payer has paid: the
 * diagnoses on its paid claims for that code, the modifiers on its paid
 * lines, the most units it has paid. Nothing is adopted automatically.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createPayerEdit } from "./payer-edits";

const { payerEdits, ruleSuggestionDismissals, auditLog } = schema;

/** Denial reason (CARC) to the kind of edit that prevents it. */
const CARC_TO_KIND: Record<string, "auth_required" | "dx_required" | "modifier_required" | "max_units" | "not_covered"> = {
  "197": "auth_required", "15": "auth_required", "198": "auth_required",
  "11": "dx_required", "50": "dx_required", "167": "dx_required",
  "4": "modifier_required",
  "151": "max_units", "119": "max_units", "273": "max_units",
  "96": "not_covered", "204": "not_covered",
};

const MIN_DENIALS = 3;
const WINDOW_DAYS = 180;

export type RuleSuggestion = {
  key: string;
  payerId: string;
  payerName: string;
  cpt: string;
  kind: keyof typeof KIND_LABEL;
  params: { modifiers?: string[]; dxPrefixes?: string[]; maxUnits?: number };
  denials: number;
  deniedCents: number;
  carcs: string[];
  evidence: string;
};

export const KIND_LABEL = {
  auth_required: "Require prior authorization",
  dx_required: "Require a qualifying diagnosis",
  modifier_required: "Require a modifier",
  max_units: "Limit units",
  not_covered: "Mark as not covered",
} as const;

type Row = Record<string, string | null>;

export async function suggestRules(db: Db, practiceId: string, now = new Date()): Promise<RuleSuggestion[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const { rows } = await db.execute<Row>(sql`
    SELECT x.payer_id, x.payer_name, x.cpt, x.carc, count(*)::text AS n, COALESCE(sum(x.amount_cents), 0)::text AS cents
    FROM (
      SELECT DISTINCT d.id, c.payer_id, p.name AS payer_name, ch.cpt, d.carc, d.amount_cents
      FROM denials d
      JOIN claims c ON c.id = d.claim_id
      JOIN payers p ON p.id = c.payer_id
      JOIN charges ch ON ch.encounter_id = c.encounter_id
      WHERE d.practice_id = ${practiceId} AND d.created_at >= ${since} AND d.carc IN (${sql.join(Object.keys(CARC_TO_KIND).map((k) => sql`${k}`), sql`, `)})
    ) x
    GROUP BY 1, 2, 3, 4`);
  // Merge CARCs that point at the same kind of fix.
  const grouped = new Map<string, { payerId: string; payerName: string; cpt: string; kind: RuleSuggestion["kind"]; denials: number; cents: number; carcs: Set<string> }>();
  for (const r of rows) {
    const kind = CARC_TO_KIND[r.carc!];
    const key = `${r.payer_id}|${kind}|${r.cpt}`;
    const g = grouped.get(key) ?? { payerId: r.payer_id!, payerName: r.payer_name!, cpt: r.cpt!, kind, denials: 0, cents: 0, carcs: new Set<string>() };
    g.denials += Number(r.n);
    g.cents += Number(r.cents);
    g.carcs.add(r.carc!);
    grouped.set(key, g);
  }
  const candidates = [...grouped.entries()].filter(([, g]) => g.denials >= MIN_DENIALS);
  if (!candidates.length) return [];

  const [existing, dismissed] = await Promise.all([
    db.select({ payerId: payerEdits.payerId, kind: payerEdits.kind, cpt: payerEdits.cpt }).from(payerEdits).where(and(eq(payerEdits.practiceId, practiceId), eq(payerEdits.active, true))),
    db.select({ key: ruleSuggestionDismissals.suggestionKey }).from(ruleSuggestionDismissals).where(eq(ruleSuggestionDismissals.practiceId, practiceId)),
  ]);
  const has = new Set(existing.map((e) => `${e.payerId ?? "*"}|${e.kind}|${e.cpt}`));
  const skip = new Set(dismissed.map((d) => d.key));

  const out: RuleSuggestion[] = [];
  for (const [key, g] of candidates) {
    if (skip.has(key) || has.has(`${g.payerId}|${g.kind}|${g.cpt}`) || has.has(`*|${g.kind}|${g.cpt}`)) continue;
    const params: RuleSuggestion["params"] = {};
    // What this payer pays for the code tells us what the rule should require.
    if (g.kind === "dx_required" || g.kind === "modifier_required" || g.kind === "max_units") {
      const { rows: paid } = await db.execute<Row>(sql`
        SELECT e.diagnoses::text AS dx, ch.modifiers::text AS mods, ch.units::text AS units
        FROM claims c JOIN encounters e ON e.id = c.encounter_id JOIN charges ch ON ch.encounter_id = e.id
        WHERE c.practice_id = ${practiceId} AND c.payer_id = ${g.payerId} AND ch.cpt = ${g.cpt} AND c.status IN ('paid', 'partially_paid') AND c.created_at >= ${since}
        LIMIT 500`);
      if (paid.length < MIN_DENIALS) continue; // not enough paid history to say what the payer wants
      if (g.kind === "dx_required") {
        const counts = new Map<string, number>();
        for (const p of paid) for (const d of JSON.parse(p.dx ?? "[]") as string[]) { const k = d.replace(".", "").toUpperCase().slice(0, 3); counts.set(k, (counts.get(k) ?? 0) + 1); }
        params.dxPrefixes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
      } else if (g.kind === "modifier_required") {
        const counts = new Map<string, number>();
        for (const p of paid) for (const m of JSON.parse(p.mods ?? "[]") as string[]) counts.set(m.toUpperCase(), (counts.get(m.toUpperCase()) ?? 0) + 1);
        const common = [...counts.entries()].filter(([, n]) => n >= Math.ceil(paid.length / 3)).map(([m]) => m);
        if (!common.length) continue;
        params.modifiers = common.slice(0, 4);
      } else {
        params.maxUnits = Math.max(...paid.map((p) => Number(p.units)));
      }
    }
    const detail = g.kind === "dx_required" ? ` Paid claims for ${g.cpt} used diagnoses starting ${params.dxPrefixes!.join(", ")}.`
      : g.kind === "modifier_required" ? ` Paid lines carried ${params.modifiers!.join(" or ")}.`
      : g.kind === "max_units" ? ` The most it has paid on one line is ${params.maxUnits} unit${params.maxUnits === 1 ? "" : "s"}.` : "";
    out.push({
      key, payerId: g.payerId, payerName: g.payerName, cpt: g.cpt, kind: g.kind, params, denials: g.denials, deniedCents: g.cents, carcs: [...g.carcs].sort(),
      evidence: `${g.payerName} denied ${g.denials} claims with ${g.cpt} for CARC ${[...g.carcs].sort().join("/")} in the last ${WINDOW_DAYS} days.${detail}`,
    });
  }
  return out.sort((a, b) => b.deniedCents - a.deniedCents);
}

export async function adoptSuggestion(db: Db, practiceId: string, key: string, userId?: string) {
  const s = (await suggestRules(db, practiceId)).find((x) => x.key === key);
  if (!s) throw new Error("That suggestion is no longer current");
  const edit = await createPayerEdit(db, practiceId, {
    payerId: s.payerId, kind: s.kind, cpt: s.cpt, modifiers: s.params.modifiers, dxPrefixes: s.params.dxPrefixes, maxUnits: s.params.maxUnits ?? null,
    severity: s.kind === "not_covered" || s.kind === "auth_required" ? "error" : "warning",
  });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "rule_suggestion_adopted", entity: "payer_edit", entityId: edit.id, details: { key, evidence: s.evidence } });
  return edit;
}

export async function dismissSuggestion(db: Db, practiceId: string, key: string, userId?: string) {
  await db.insert(ruleSuggestionDismissals).values({ practiceId, suggestionKey: key.slice(0, 200), dismissedBy: userId ?? null }).onConflictDoNothing();
}

