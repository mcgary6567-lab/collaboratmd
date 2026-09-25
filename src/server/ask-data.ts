/**
 * "Ask your data": turns a plain-English question into a report-builder
 * config. The answer is always a normal report (fixed SQL from
 * report-builder.ts), so a question can never read more than the builder
 * allows. Claude does the translation when the practice has connected it;
 * otherwise a keyword parser handles the common shapes.
 *
 * Only the question and the practice's payer and provider names are sent to
 * Claude. Report results never leave the server.
 */
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ReportConfig } from "@/db/schema";
import { DATASETS, normalizeConfig } from "./report-builder";

export type Named = { id: string; name: string };
export type Answer = { dataset: string; config: ReportConfig; via: "ai" | "keywords"; note?: string };

/** Things that look like patient identifiers: dates, SSNs, member or record numbers. */
const IDENTIFIER = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{3}-\d{2}-\d{4}\b|\b[A-Z]{0,3}\d{6,}\b/i;

export function looksLikePhi(question: string) {
  return IDENTIFIER.test(question);
}

const DATASET_WORDS: [string, RegExp][] = [
  ["denials", /\bdenial|denied|carc|rejected by the payer/i],
  ["payments", /\bpayment|paid|collect|cash|deposit|revenue|posted/i],
  ["charges", /\bcharge|cpt|procedure|code|units|service line/i],
  ["claims", /\bclaim/i],
];
const GROUP_WORDS: Record<string, [string, RegExp][]> = {
  claims: [["payer", /\bby (payer|insurance|insurer)/i], ["provider", /\bby (provider|doctor|physician|clinician)/i], ["status", /\bby status/i], ["month", /\b(by|per|each) month|monthly|trend/i]],
  denials: [["payer", /\bby (payer|insurance|insurer)/i], ["carc", /\bby (carc|reason code|code)/i], ["category", /\bby (category|reason|type)/i], ["status", /\bby status/i], ["month", /\b(by|per|each) month|monthly|trend/i]],
  payments: [["payer", /\bby (payer|insurance|insurer|source)/i], ["type", /\bby type/i], ["month", /\b(by|per|each) month|monthly|trend/i]],
  charges: [["cpt", /\bby (cpt|code|procedure)/i], ["provider", /\bby (provider|doctor|physician|clinician)/i], ["payer", /\bby (payer|insurance|insurer)/i], ["month", /\b(by|per|each) month|monthly|trend/i]],
};
const RANGE_WORDS: [string, RegExp][] = [
  ["7d", /\b(last|past) (7 days|week)\b|this week/i],
  ["30d", /\b(last|past) (30 days|month)\b/i],
  ["90d", /\b(last|past) (90 days|3 months|three months|quarter)\b/i],
  ["mtd", /\bthis month|month to date|mtd\b/i],
  ["qtd", /\bthis quarter|quarter to date|qtd\b/i],
  ["ytd", /\bthis year|year to date|ytd\b/i],
  ["12m", /\b(last|past) (12 months|twelve months|year)\b/i],
  ["all", /\ball time|ever\b/i],
];

/** Finds a payer or provider named in the question, longest name first so "Blue Cross Blue Shield of Texas" beats "Blue Cross". */
function findNamed(question: string, list: Named[]) {
  const q = question.toLowerCase();
  return [...list].sort((a, b) => b.name.length - a.name.length).find((x) => {
    const n = x.name.toLowerCase();
    if (q.includes(n)) return true;
    const last = n.split(",")[0].trim();
    return last.length >= 4 && new RegExp(`\\b(dr\\.? )?${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q);
  });
}

export function parseQuestion(question: string, payers: Named[], providers: Named[]): Answer | null {
  const q = question.trim();
  if (!q) return null;
  const dataset = DATASET_WORDS.find(([, re]) => re.test(q))?.[0];
  if (!dataset) return null;
  const ds = DATASETS[dataset];
  const group = GROUP_WORDS[dataset].find(([, re]) => re.test(q))?.[0] ?? null;
  const range = RANGE_WORDS.find(([, re]) => re.test(q))?.[0] ?? "30d";
  const status = ds.statuses?.find((st) => new RegExp(`\\b${st.replace(/_/g, "[ _]")}\\b`, "i").test(q)) ?? null;
  const payer = findNamed(q, payers);
  const provider = findNamed(q, providers);
  return { dataset, via: "keywords", config: normalizeConfig(dataset, { columns: [], group, range, status, payerId: payer?.id ?? null, providerId: provider?.id ?? null }) };
}

/** The whitelist the AI chooses from, written out for its prompt. */
export function describeDatasets() {
  return Object.entries(DATASETS).map(([key, d]) => [
    `dataset "${key}": ${d.description}. Date filter applies to ${d.dateLabel.toLowerCase()}.`,
    `  columns: ${Object.entries(d.columns).map(([k, c]) => `${k} (${c.label})`).join(", ")}`,
    `  group options: ${Object.entries(d.groups).map(([k, g]) => `${k} (${g.label})`).join(", ")}`,
    d.statuses ? `  status values: ${d.statuses.join(", ")}` : "  no status filter",
  ].join("\n")).join("\n");
}

/** Accepts whatever the model returned only if it names a real dataset, then cleans it through the builder's whitelist. */
export function validateAiAnswer(raw: unknown, payers: Named[], providers: Named[]): Answer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const dataset = typeof r.dataset === "string" && r.dataset in DATASETS ? r.dataset : null;
  if (!dataset) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const payerId = payers.find((p) => p.id === str(r.payerId))?.id ?? null;
  const providerId = providers.find((p) => p.id === str(r.providerId))?.id ?? null;
  const config = normalizeConfig(dataset, {
    columns: Array.isArray(r.columns) ? r.columns.filter((c): c is string => typeof c === "string") : [],
    group: str(r.group), range: str(r.range) ?? "30d", status: str(r.status), payerId, providerId,
  });
  const note = typeof r.note === "string" ? r.note.slice(0, 300) : undefined;
  return { dataset, config, via: "ai", note };
}

export async function namesFor(db: Db, practiceId: string) {
  const [payers, providers] = await Promise.all([
    db.select({ id: schema.payers.id, name: schema.payers.name }).from(schema.payers).where(eq(schema.payers.practiceId, practiceId)).orderBy(asc(schema.payers.name)),
    db.select({ id: schema.providers.id, first: schema.providers.firstName, last: schema.providers.lastName }).from(schema.providers).where(eq(schema.providers.practiceId, practiceId)).orderBy(asc(schema.providers.lastName)),
  ]);
  return { payers, providers: providers.map((p) => ({ id: p.id, name: `${p.last}, ${p.first}` })) };
}

/** Query string for the builder page that shows this answer. */
export function builderQuery(a: Answer, question: string) {
  const q = new URLSearchParams([["dataset", a.dataset], ["run", "1"], ...a.config.columns.map((c) => ["col", c]), ["group", a.config.group ?? ""], ["range", a.config.range], ["payer", a.config.payerId ?? ""], ["provider", a.config.providerId ?? ""], ["status", a.config.status ?? ""], ["asked", question.slice(0, 300)], ["via", a.via]] as [string, string][]);
  if (a.note) q.set("note", a.note);
  return q.toString();
}
