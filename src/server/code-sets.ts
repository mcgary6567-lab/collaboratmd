/**
 * National code sets from CMS, checked on every professional claim:
 *
 *  - NCCI procedure-to-procedure (PTP) edits: pairs of codes not paid
 *    together on the same day, unless the modifier indicator allows an
 *    NCCI-associated modifier and one is present.
 *  - Medically unlikely edits (MUE): the most units of a code per day.
 *  - Medicare coverage policies (LCD articles / NCDs): diagnoses that
 *    support a procedure. A miss is a warning (an ABN may be needed), never
 *    a block, because coverage also depends on documentation.
 *
 * The data is CMS's, loaded by the platform operator from the quarterly
 * files (scripts/import-code-sets.ts, or the upload on Settings, Code sets).
 * Nothing here is typed in from memory: with no data loaded, these checks
 * simply do not fire.
 */
import { and, desc, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";
import { parseCsv } from "@/lib/import/csv";
import { normalizeDate } from "@/lib/import/patients";

const { ncciPtp, ncciMue, coveragePolicyCodes, codeSetLoads } = schema;

export type CodeSet = "ncci_ptp" | "ncci_mue" | "coverage";

/** Platform operators, by email: the only people who can replace national code sets. */
export function isPlatformOperator(email: string | null | undefined) {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

/* ------------------------------ Parsing ------------------------------ */

/** CMS files open with title and copyright lines; the table starts at the first line that has the columns we need. */
function tableFrom(text: string, required: RegExp[]) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => required.every((r) => r.test(l)));
  if (start < 0) return null;
  return parseCsv(lines.slice(start).join("\n"), 5_000_000);
}
const col = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h));
const code = (v: string | undefined) => (v ?? "").trim().toUpperCase().replace(/^'/, "");

export type PtpRow = { column1: string; column2: string; effective: string; deletion: string | null; modifierIndicator: string; rationale: string | null };
export function parsePtp(text: string): { rows: PtpRow[]; skipped: number } {
  const t = tableFrom(text, [/column\s*1/i, /column\s*2/i, /modifier/i]);
  if (!t) throw new Error("Not an NCCI PTP file: no header with Column 1, Column 2 and Modifier columns");
  const h = t.headers;
  const [c1, c2, eff, del, mod, rat] = [col(h, /column\s*1/i), col(h, /column\s*2/i), col(h, /effective/i), col(h, /deletion/i), col(h, /modifier/i), col(h, /rationale/i)];
  const rows: PtpRow[] = [];
  let skipped = 0;
  for (const r of t.rows) {
    const column1 = code(r[c1]);
    const column2 = code(r[c2]);
    const effective = normalizeDate(r[eff] ?? "") ?? null;
    const indicator = (r[mod] ?? "").trim().charAt(0);
    if (!/^[0-9A-Z]{5}$/.test(column1) || !/^[0-9A-Z]{5}$/.test(column2) || !effective || !["0", "1", "9"].includes(indicator)) { skipped++; continue; }
    const delRaw = del >= 0 ? (r[del] ?? "").trim() : "";
    rows.push({ column1, column2, effective, deletion: delRaw && delRaw !== "*" ? normalizeDate(delRaw) : null, modifierIndicator: indicator, rationale: rat >= 0 ? (r[rat] ?? "").trim().slice(0, 200) || null : null });
  }
  return { rows, skipped };
}

export type MueRow = { code: string; maxUnits: number; adjudicationIndicator: string | null; rationale: string | null };
export function parseMue(text: string): { rows: MueRow[]; skipped: number } {
  const t = tableFrom(text, [/hcpcs|cpt/i, /mue/i]);
  if (!t) throw new Error("Not an MUE file: no header with HCPCS/CPT and MUE columns");
  const h = t.headers;
  const [c, v, mai, rat] = [col(h, /hcpcs|cpt/i), col(h, /mue value/i) >= 0 ? col(h, /mue value/i) : col(h, /mue/i), col(h, /adjudication|mai/i), col(h, /rationale/i)];
  const rows: MueRow[] = [];
  let skipped = 0;
  for (const r of t.rows) {
    const hc = code(r[c]);
    const units = Number((r[v] ?? "").trim());
    if (!/^[0-9A-Z]{5}$/.test(hc) || !Number.isInteger(units) || units < 0) { skipped++; continue; }
    rows.push({ code: hc, maxUnits: units, adjudicationIndicator: mai >= 0 ? (r[mai] ?? "").trim().charAt(0) || null : null, rationale: rat >= 0 ? (r[rat] ?? "").trim().slice(0, 200) || null : null });
  }
  return { rows, skipped };
}

export type CoverageRow = { policyId: string; title: string; cpt: string; icd10: string };
/** policy_id, title, hcpcs (or cpt), icd10: one covered diagnosis per row. Join CMS's article HCPCS and covered-ICD-10 tables on the article to produce it. */
export function parseCoverage(text: string): { rows: CoverageRow[]; skipped: number } {
  const t = tableFrom(text, [/policy|lcd|ncd|article/i, /hcpcs|cpt/i, /icd/i]);
  if (!t) throw new Error("Not a coverage file: expected columns policy_id, title, hcpcs, icd10");
  const h = t.headers;
  const [p, ti, c, d] = [col(h, /policy|lcd|ncd|article/i), col(h, /title|name/i), col(h, /hcpcs|cpt/i), col(h, /icd/i)];
  const rows: CoverageRow[] = [];
  let skipped = 0;
  for (const r of t.rows) {
    const policyId = (r[p] ?? "").trim().slice(0, 40);
    const cpt = code(r[c]);
    const icd10 = code(r[d]).replace(".", "");
    if (!policyId || !/^[0-9A-Z]{5}$/.test(cpt) || !/^[A-Z][0-9][0-9A-Z]{1,5}$/.test(icd10)) { skipped++; continue; }
    rows.push({ policyId, title: (ti >= 0 ? r[ti] : "")?.trim().slice(0, 200) || policyId, cpt, icd10 });
  }
  return { rows, skipped };
}

/* ------------------------------ Loading ------------------------------ */

async function inChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function importCodeSet(db: Db, set: CodeSet, text: string, label: string, loadedBy: string) {
  let added = 0;
  let skipped = 0;
  if (set === "ncci_ptp") {
    const p = parsePtp(text);
    skipped = p.skipped;
    await inChunks(p.rows, 1000, (chunk) => db.insert(ncciPtp).values(chunk).onConflictDoUpdate({ target: [ncciPtp.column1, ncciPtp.column2, ncciPtp.effective], set: { deletion: sql`excluded.deletion`, modifierIndicator: sql`excluded.modifier_indicator`, rationale: sql`excluded.rationale` } }));
    added = p.rows.length;
  } else if (set === "ncci_mue") {
    const p = parseMue(text);
    skipped = p.skipped;
    await inChunks(p.rows, 1000, (chunk) => db.insert(ncciMue).values(chunk).onConflictDoUpdate({ target: ncciMue.code, set: { maxUnits: sql`excluded.max_units`, adjudicationIndicator: sql`excluded.adjudication_indicator`, rationale: sql`excluded.rationale` } }));
    added = p.rows.length;
  } else {
    const p = parseCoverage(text);
    skipped = p.skipped;
    // A file replaces the policies it contains, so a removed diagnosis does not linger.
    const policies = [...new Set(p.rows.map((r) => r.policyId))];
    await inChunks(policies, 500, (chunk) => db.delete(coveragePolicyCodes).where(inArray(coveragePolicyCodes.policyId, chunk)));
    await inChunks(p.rows, 1000, (chunk) => db.insert(coveragePolicyCodes).values(chunk).onConflictDoNothing());
    added = p.rows.length;
  }
  if (!added) throw new Error(`No usable rows found (${skipped} skipped)`);
  await db.insert(codeSetLoads).values({ codeSet: set, label: label.slice(0, 120), rows: added, loadedBy });
  return { added, skipped };
}

export async function codeSetStatus(db: Db) {
  const [[ptp], [mue], [cov], loads] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(ncciPtp),
    db.select({ n: sql<number>`count(*)::int` }).from(ncciMue),
    db.select({ n: sql<number>`count(DISTINCT policy_id)::int`, pairs: sql<number>`count(*)::int` }).from(coveragePolicyCodes),
    db.select().from(codeSetLoads).orderBy(desc(codeSetLoads.createdAt)).limit(20),
  ]);
  return { ptp: Number(ptp.n), mue: Number(mue.n), policies: Number(cov.n), coveragePairs: Number(cov.pairs), loads };
}

/* ------------------------------ Checking claims ------------------------------ */

/** Modifiers CMS lists as NCCI-associated: anatomic, global surgery, and 27, 59, 91, XE, XS, XP, XU. */
const NCCI_MODIFIERS = new Set(["E1", "E2", "E3", "E4", "FA", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "LC", "LD", "LM", "RC", "RI", "LT", "RT", "TA", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "24", "25", "57", "58", "78", "79", "27", "59", "91", "XE", "XS", "XP", "XU"]);

export type CodeSetClaim = {
  payerType: string;
  dateOfService: string;
  diagnoses: string[];
  lines: { lineNumber: number; cpt: string; modifiers: string[]; units: number }[];
};

export async function codeSetFindings(db: Db, c: CodeSetClaim): Promise<ScrubFinding[]> {
  const codes = [...new Set(c.lines.map((l) => l.cpt.toUpperCase()).filter(Boolean))];
  if (!codes.length) return [];
  // NCCI is mandated for Medicare and Medicaid; most commercial payers apply it too, so elsewhere it warns.
  const severity: ScrubFinding["severity"] = c.payerType === "medicare" || c.payerType === "medicaid" ? "error" : "warning";
  const dos = c.dateOfService;
  const out: ScrubFinding[] = [];

  const [pairs, mues, coverage] = await Promise.all([
    codes.length > 1
      ? db.select().from(ncciPtp).where(and(inArray(ncciPtp.column1, codes), inArray(ncciPtp.column2, codes), lte(ncciPtp.effective, dos), or(isNull(ncciPtp.deletion), gt(ncciPtp.deletion, dos))))
      : Promise.resolve([]),
    db.select().from(ncciMue).where(inArray(ncciMue.code, codes)),
    c.payerType === "medicare" ? db.select().from(coveragePolicyCodes).where(inArray(coveragePolicyCodes.cpt, codes)) : Promise.resolve([]),
  ]);

  for (const p of pairs) {
    if (p.column1 === p.column2 || p.modifierIndicator === "9") continue;
    const l1 = c.lines.find((l) => l.cpt.toUpperCase() === p.column1);
    const l2 = c.lines.find((l) => l.cpt.toUpperCase() === p.column2);
    if (!l1 || !l2) continue;
    const bypassed = p.modifierIndicator === "1" && [...l1.modifiers, ...l2.modifiers].some((m) => NCCI_MODIFIERS.has(m.toUpperCase()));
    if (bypassed) continue;
    out.push({
      rule: "NCCI_PTP", severity, field: `lines.${l2.lineNumber}`,
      message: p.modifierIndicator === "0"
        ? `NCCI: ${p.column2} (line ${l2.lineNumber}) is not paid with ${p.column1} on the same day, and no modifier can override it${p.rationale ? ` (${p.rationale})` : ""}. Remove one of the codes.`
        : `NCCI: ${p.column2} (line ${l2.lineNumber}) is bundled into ${p.column1}${p.rationale ? ` (${p.rationale})` : ""}. Add a modifier such as 59 or XU only if the services were truly distinct, or remove it.`,
    });
  }

  const units = new Map<string, number>();
  for (const l of c.lines) units.set(l.cpt.toUpperCase(), (units.get(l.cpt.toUpperCase()) ?? 0) + l.units);
  for (const m of mues) {
    const perLine = m.adjudicationIndicator === "1";
    const worst = perLine ? Math.max(...c.lines.filter((l) => l.cpt.toUpperCase() === m.code).map((l) => l.units)) : units.get(m.code) ?? 0;
    if (worst > m.maxUnits) {
      out.push({ rule: "NCCI_MUE", severity, field: "lines", message: `MUE: ${m.code} is limited to ${m.maxUnits} unit${m.maxUnits === 1 ? "" : "s"} ${perLine ? "per line" : "per day"}; this claim has ${worst}. Units above the limit are denied${m.rationale ? ` (${m.rationale})` : ""}.` });
    }
  }

  if (coverage.length) {
    const dx = c.diagnoses.map((d) => d.replace(".", "").toUpperCase());
    const byCpt = new Map<string, typeof coverage>();
    for (const row of coverage) byCpt.set(row.cpt, [...(byCpt.get(row.cpt) ?? []), row]);
    for (const [cpt, rows] of byCpt) {
      const covered = rows.some((r) => dx.some((d) => d === r.icd10 || d.startsWith(r.icd10)));
      if (!covered) {
        const policy = rows[0];
        out.push({ rule: "MEDICARE_COVERAGE", severity: "warning", field: "diagnoses", message: `Medicare coverage: no diagnosis on this claim is listed as supporting ${cpt} under ${policy.title} (${policy.policyId}). Medicare may deny it as not medically necessary; check the documentation and whether an ABN was signed.` });
      }
    }
  }
  return out;
}

