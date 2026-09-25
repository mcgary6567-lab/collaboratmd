/**
 * The report builder: pick a dataset, columns, a date range, filters and an
 * optional grouping. Every column, filter and grouping is a fixed SQL
 * fragment defined here; only values (dates, ids, a status from a known
 * list) come from the request, as parameters. So a report can only ever read
 * what these definitions allow, and only for its own practice.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ReportConfig } from "@/db/schema";

type Kind = "text" | "money" | "date" | "number";
type Col = { label: string; expr: string; kind: Kind };
type Dataset = {
  label: string;
  description: string;
  from: string;
  practice: string;
  date: string;
  dateLabel: string;
  columns: Record<string, Col>;
  defaults: string[];
  groups: Record<string, { label: string; expr: string }>;
  statuses?: string[];
  status?: string;
  payer?: string;
  provider?: string;
};

const PATIENT = "pt.last_name || ', ' || pt.first_name";
const MONTH = (e: string) => `to_char(date_trunc('month', ${e}), 'YYYY-MM')`;

export const DATASETS: Record<string, Dataset> = {
  claims: {
    label: "Claims",
    description: "One row per claim, dated by date of service",
    from: "claims c JOIN payers p ON p.id = c.payer_id JOIN encounters e ON e.id = c.encounter_id JOIN providers pr ON pr.id = e.provider_id JOIN patients pt ON pt.id = c.patient_id",
    practice: "c.practice_id",
    date: "e.date_of_service",
    dateLabel: "Date of service",
    columns: {
      claim: { label: "Claim", expr: "c.control_number", kind: "text" },
      patient: { label: "Patient", expr: PATIENT, kind: "text" },
      mrn: { label: "MRN", expr: "pt.mrn", kind: "text" },
      dos: { label: "Date of service", expr: "e.date_of_service", kind: "date" },
      payer: { label: "Payer", expr: "p.name", kind: "text" },
      provider: { label: "Provider", expr: "pr.last_name || ', ' || pr.first_name", kind: "text" },
      status: { label: "Status", expr: "c.status", kind: "text" },
      billed: { label: "Billed", expr: "c.total_cents", kind: "money" },
      paid: { label: "Insurance paid", expr: "(SELECT COALESCE(SUM(CASE WHEN l.type = 'reversal' THEN -l.amount_cents ELSE l.amount_cents END), 0) FROM ledger_entries l WHERE l.claim_id = c.id AND l.type IN ('insurance_payment','reversal'))", kind: "money" },
      submitted: { label: "Submitted", expr: "c.submitted_at::date", kind: "date" },
    },
    defaults: ["claim", "patient", "dos", "payer", "status", "billed", "paid"],
    groups: {
      payer: { label: "Payer", expr: "p.name" },
      provider: { label: "Provider", expr: "pr.last_name || ', ' || pr.first_name" },
      status: { label: "Status", expr: "c.status" },
      month: { label: "Month of service", expr: MONTH("e.date_of_service") },
    },
    statuses: ["draft", "scrub_errors", "ready", "submitted", "accepted", "rejected", "pending", "paid", "partially_paid", "denied", "billed_secondary", "closed", "voided"],
    status: "c.status",
    payer: "c.payer_id",
    provider: "e.provider_id",
  },
  denials: {
    label: "Denials",
    description: "One row per denial, dated by when it arrived",
    from: "denials d JOIN claims c ON c.id = d.claim_id JOIN payers p ON p.id = c.payer_id JOIN patients pt ON pt.id = c.patient_id JOIN encounters e ON e.id = c.encounter_id",
    practice: "d.practice_id",
    date: "d.created_at",
    dateLabel: "Denied on",
    columns: {
      claim: { label: "Claim", expr: "c.control_number", kind: "text" },
      patient: { label: "Patient", expr: PATIENT, kind: "text" },
      payer: { label: "Payer", expr: "p.name", kind: "text" },
      carc: { label: "CARC", expr: "d.carc", kind: "text" },
      category: { label: "Category", expr: "d.category", kind: "text" },
      amount: { label: "Denied amount", expr: "d.amount_cents", kind: "money" },
      status: { label: "Status", expr: "d.status", kind: "text" },
      denied_on: { label: "Denied on", expr: "d.created_at::date", kind: "date" },
      deadline: { label: "Appeal deadline", expr: "d.appeal_deadline", kind: "date" },
    },
    defaults: ["claim", "payer", "carc", "category", "amount", "status", "denied_on"],
    groups: {
      payer: { label: "Payer", expr: "p.name" },
      category: { label: "Category", expr: "d.category" },
      carc: { label: "CARC", expr: "d.carc" },
      status: { label: "Status", expr: "d.status" },
      month: { label: "Month", expr: MONTH("d.created_at") },
    },
    statuses: ["open", "in_progress", "appealed", "resolved", "written_off"],
    status: "d.status",
    payer: "c.payer_id",
    provider: "e.provider_id",
  },
  payments: {
    label: "Payments",
    description: "Insurance and patient payments posted, dated by posting",
    from: "ledger_entries l JOIN patients pt ON pt.id = l.patient_id LEFT JOIN claims c ON c.id = l.claim_id LEFT JOIN payers p ON p.id = c.payer_id LEFT JOIN encounters e ON e.id = c.encounter_id",
    practice: "l.practice_id",
    date: "l.posted_at",
    dateLabel: "Posted on",
    columns: {
      posted: { label: "Posted on", expr: "l.posted_at::date", kind: "date" },
      type: { label: "Type", expr: "replace(l.type, '_', ' ')", kind: "text" },
      amount: { label: "Amount", expr: "CASE WHEN l.type = 'reversal' THEN -l.amount_cents ELSE l.amount_cents END", kind: "money" },
      payer: { label: "Payer", expr: "COALESCE(p.name, 'Patient')", kind: "text" },
      patient: { label: "Patient", expr: PATIENT, kind: "text" },
      claim: { label: "Claim", expr: "c.control_number", kind: "text" },
      note: { label: "Note", expr: "l.note", kind: "text" },
    },
    defaults: ["posted", "type", "payer", "patient", "amount"],
    groups: {
      type: { label: "Type", expr: "replace(l.type, '_', ' ')" },
      payer: { label: "Payer", expr: "COALESCE(p.name, 'Patient')" },
      month: { label: "Month", expr: MONTH("l.posted_at") },
    },
    payer: "c.payer_id",
    provider: "e.provider_id",
  },
  charges: {
    label: "Charges",
    description: "One row per service line, dated by date of service",
    from: "charges ch JOIN encounters e ON e.id = ch.encounter_id JOIN providers pr ON pr.id = e.provider_id JOIN patients pt ON pt.id = e.patient_id LEFT JOIN claims c ON c.encounter_id = e.id AND c.payer_sequence = 'P' AND c.frequency_code = '1' LEFT JOIN payers p ON p.id = c.payer_id",
    practice: "e.practice_id",
    date: "e.date_of_service",
    dateLabel: "Date of service",
    columns: {
      dos: { label: "Date of service", expr: "e.date_of_service", kind: "date" },
      cpt: { label: "CPT", expr: "ch.cpt", kind: "text" },
      units: { label: "Units", expr: "ch.units", kind: "number" },
      charge: { label: "Charge", expr: "ch.charge_cents * ch.units", kind: "money" },
      provider: { label: "Provider", expr: "pr.last_name || ', ' || pr.first_name", kind: "text" },
      payer: { label: "Payer", expr: "p.name", kind: "text" },
      patient: { label: "Patient", expr: PATIENT, kind: "text" },
    },
    defaults: ["dos", "cpt", "units", "charge", "provider", "payer"],
    groups: {
      cpt: { label: "CPT", expr: "ch.cpt" },
      provider: { label: "Provider", expr: "pr.last_name || ', ' || pr.first_name" },
      payer: { label: "Payer", expr: "p.name" },
      month: { label: "Month of service", expr: MONTH("e.date_of_service") },
    },
    payer: "c.payer_id",
    provider: "e.provider_id",
  },
};

export const RANGES: Record<string, string> = {
  "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", mtd: "This month", qtd: "This quarter", ytd: "This year", "12m": "Last 12 months", all: "All time",
};

export function rangeStart(range: string, now = new Date()): Date | null {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  if (days) return new Date(d.getTime() - days * 86_400_000);
  if (range === "mtd") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (range === "qtd") return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
  if (range === "ytd") return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  if (range === "12m") return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cleans a config from a form or the database against the dataset's whitelist. */
export function normalizeConfig(dataset: string, raw: Partial<ReportConfig>): ReportConfig {
  const ds = DATASETS[dataset];
  if (!ds) throw new Error("Unknown dataset");
  const columns = (raw.columns ?? []).filter((c) => c in ds.columns);
  return {
    columns: columns.length ? columns : ds.defaults,
    group: raw.group && raw.group in ds.groups ? raw.group : null,
    range: raw.range && raw.range in RANGES ? raw.range : "30d",
    payerId: raw.payerId && UUID.test(raw.payerId) ? raw.payerId : null,
    providerId: raw.providerId && UUID.test(raw.providerId) ? raw.providerId : null,
    status: raw.status && ds.statuses?.includes(raw.status) ? raw.status : null,
  };
}

/** Numbers as numbers, dates as YYYY-MM-DD, whatever the driver returned. */
function cell(kind: Kind, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (kind === "money" || kind === "number") return Number(v);
  if (kind === "date") return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return String(v);
}

export type ReportResult = {
  headers: { key: string; label: string; kind: Kind }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
  truncated: boolean;
  rowCount: number;
};

export async function runReport(db: Db, practiceId: string, dataset: string, input: Partial<ReportConfig>, opts: { limit?: number; now?: Date } = {}): Promise<ReportResult> {
  const ds = DATASETS[dataset];
  const cfg = normalizeConfig(dataset, input);
  const limit = opts.limit ?? 2_000;
  const where: SQL[] = [sql`${sql.raw(ds.practice)} = ${practiceId}`];
  if (dataset === "payments") where.push(sql.raw("l.type IN ('insurance_payment','patient_payment','reversal')"));
  const start = rangeStart(cfg.range, opts.now);
  if (start) where.push(sql`${sql.raw(ds.date)} >= ${start.toISOString().slice(0, 10)}`);
  if (cfg.payerId && ds.payer) where.push(sql`${sql.raw(ds.payer)} = ${cfg.payerId}`);
  if (cfg.providerId && ds.provider) where.push(sql`${sql.raw(ds.provider)} = ${cfg.providerId}`);
  if (cfg.status && ds.status) where.push(sql`${sql.raw(ds.status)} = ${cfg.status}`);
  const whereSql = sql.join(where, sql` AND `);
  const money = cfg.columns.filter((c) => ds.columns[c].kind === "money");

  if (cfg.group) {
    const g = ds.groups[cfg.group];
    const sums = (money.length ? money : Object.keys(ds.columns).filter((c) => ds.columns[c].kind === "money").slice(0, 1));
    const select = [sql.raw(`${g.expr} AS "group"`), sql.raw(`count(*)::int AS "count"`), ...sums.map((c) => sql.raw(`COALESCE(SUM(${ds.columns[c].expr}), 0)::bigint AS "${c}"`))];
    const { rows } = await db.execute<Record<string, string | number | null>>(sql`SELECT ${sql.join(select, sql`, `)} FROM ${sql.raw(ds.from)} WHERE ${whereSql} GROUP BY 1 ORDER BY ${sql.raw(sums.length ? `"${sums[0]}"` : `"count"`)} DESC NULLS LAST LIMIT ${limit + 1}`);
    const headers = [{ key: "group", label: g.label, kind: "text" as Kind }, { key: "count", label: "Count", kind: "number" as Kind }, ...sums.map((c) => ({ key: c, label: `${ds.columns[c].label} (total)`, kind: "money" as Kind }))];
    const clean: Record<string, string | number | null>[] = rows.slice(0, limit).map((r) => ({ group: r.group === null ? "(none)" : String(r.group), count: Number(r.count), ...Object.fromEntries(sums.map((c) => [c, Number(r[c] ?? 0)])) }));
    const totals = Object.fromEntries(["count", ...sums].map((k) => [k, clean.reduce((a, r) => a + Number(r[k] ?? 0), 0)]));
    return { headers, rows: clean, totals, truncated: rows.length > limit, rowCount: clean.length };
  }

  const select = cfg.columns.map((c) => sql.raw(`${ds.columns[c].expr} AS "${c}"`));
  const { rows } = await db.execute<Record<string, string | number | null>>(sql`SELECT ${sql.join(select, sql`, `)} FROM ${sql.raw(ds.from)} WHERE ${whereSql} ORDER BY ${sql.raw(ds.date)} DESC LIMIT ${limit + 1}`);
  const headers = cfg.columns.map((c) => ({ key: c, label: ds.columns[c].label, kind: ds.columns[c].kind }));
  const clean = rows.slice(0, limit).map((r) => Object.fromEntries(cfg.columns.map((c) => [c, cell(ds.columns[c].kind, r[c])])));
  const totals = Object.fromEntries(money.map((c) => [c, clean.reduce((a, r) => a + Number(r[c] ?? 0), 0)]));
  return { headers, rows: clean, totals, truncated: rows.length > limit, rowCount: clean.length };
}

/* ------------------------------ Saved reports ------------------------------ */

const { customReports, auditLog, practices } = schema;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveReport(db: Db, practiceId: string, input: { id?: string | null; name: string; dataset: string; config: Partial<ReportConfig>; schedule: string; recipients: string[] }, userId?: string) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Name the report");
  const config = normalizeConfig(input.dataset, input.config);
  const schedule = ["none", "weekly", "monthly"].includes(input.schedule) ? input.schedule : "none";
  const recipients = [...new Set(input.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const bad = recipients.find((r) => !EMAIL.test(r));
  if (bad) throw new Error(`"${bad}" is not an email address`);
  if (schedule !== "none" && !recipients.length) throw new Error("Add at least one recipient for a scheduled report");
  const values = { name, dataset: input.dataset, config, schedule, recipients, updatedAt: new Date() };
  let row;
  if (input.id) {
    [row] = await db.update(customReports).set(values).where(and(eq(customReports.id, input.id), eq(customReports.practiceId, practiceId))).returning();
    if (!row) throw new Error("Report not found");
  } else {
    [row] = await db.insert(customReports).values({ practiceId, ...values, createdBy: userId ?? null }).returning();
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "report_saved", entity: "report", entityId: row.id, details: { dataset: input.dataset, schedule } });
  return row;
}

export async function listReports(db: Db, practiceId: string) {
  return db.select().from(customReports).where(eq(customReports.practiceId, practiceId)).orderBy(desc(customReports.updatedAt));
}

export async function getReport(db: Db, practiceId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(customReports).where(and(eq(customReports.id, id), eq(customReports.practiceId, practiceId))).limit(1);
  return row ?? null;
}

export async function deleteReport(db: Db, practiceId: string, id: string, userId?: string) {
  await db.delete(customReports).where(and(eq(customReports.id, id), eq(customReports.practiceId, practiceId)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "report_deleted", entity: "report", entityId: id });
}

export async function hasScheduledReports(db: Db, practiceId: string) {
  const [row] = await db.select({ id: customReports.id }).from(customReports).where(and(eq(customReports.practiceId, practiceId), sql`${customReports.schedule} <> 'none'`)).limit(1);
  return !!row;
}

export function isDue(schedule: string, lastSentAt: Date | null, now = new Date()) {
  if (schedule === "weekly") return now.getUTCDay() === 1 && (!lastSentAt || now.getTime() - lastSentAt.getTime() > 5 * 86_400_000);
  if (schedule === "monthly") return now.getUTCDate() === 1 && (!lastSentAt || now.getTime() - lastSentAt.getTime() > 20 * 86_400_000);
  return false;
}

const fmtMoney = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Emails due scheduled reports: the headline numbers and a link to sign in
 * and see or download the rows. Patient-level rows are never put in email.
 */
export async function sendScheduledReports(db: Db, practiceId: string, origin: string, send: (to: string, subject: string, text: string) => Promise<boolean>, now = new Date()) {
  const reports = (await listReports(db, practiceId)).filter((r) => isDue(r.schedule, r.lastSentAt, now));
  if (!reports.length) return { due: 0, sent: 0 };
  const [practice] = await db.select({ name: practices.name }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  let sent = 0;
  for (const r of reports) {
    const result = await runReport(db, practiceId, r.dataset, r.config, { now, limit: 50_000 });
    const totals = result.headers.filter((h) => h.key in result.totals).map((h) => `${h.label}: ${h.kind === "money" ? fmtMoney(result.totals[h.key]) : result.totals[h.key].toLocaleString("en-US")}`);
    const text = [
      `${r.name} (${DATASETS[r.dataset].label}, ${RANGES[r.config.range]}) for ${practice.name}`,
      "",
      `${result.rowCount.toLocaleString("en-US")} ${r.config.group ? "groups" : "rows"}${result.truncated ? " (truncated)" : ""}`,
      ...totals,
      "",
      `See the full report or download it as CSV (sign-in required):`,
      `${origin}/reports/builder?id=${r.id}`,
      "",
      "Patient details are never included in this email. Change the schedule in Reports, Report builder.",
    ].join("\n");
    let ok = 0;
    for (const to of r.recipients) if (await send(to, `${r.name}: ${practice.name}`, text)) ok++;
    if (ok) {
      await db.update(customReports).set({ lastSentAt: now }).where(eq(customReports.id, r.id));
      sent++;
    }
  }
  return { due: reports.length, sent };
}

