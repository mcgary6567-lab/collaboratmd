/**
 * The code lists behind charge entry and the scrubber:
 *
 *  - ICD-10-CM, from CMS's yearly order file, kept by fiscal year (October 1
 *    to September 30). A diagnosis must be billable (not a category header)
 *    and valid on the date of service.
 *  - HCPCS Level II (supplies, drugs, some services), from CMS's public file.
 *  - Each practice's own procedure codes and descriptions. CPT descriptors
 *    belong to the AMA and are not shipped; practices describe their codes
 *    in their own words, as their fee schedule does.
 *
 * With no CMS file loaded, the ICD and HCPCS checks do not fire (the demo
 * ships a short list of common codes, unverified).
 */
import { and, asc, eq, gte, ilike, inArray, like, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";
import { parseCsv } from "@/lib/import/csv";
import { ICD10CM_UNDOTTED_RE } from "@/lib/codes/icd";
import { ensureSchedule, saveScheduleItems } from "./fees";

const { icd10Codes, hcpcsCodes, practiceCodes, cptCodes, codeSetLoads } = schema;

/* ------------------------------ ICD-10-CM ------------------------------ */

/** "E119" to "E11.9", the way codes are written on screens and claims here. */
export const dotted = (code: string) => {
  const c = code.trim().toUpperCase().replace(".", "");
  return c.length > 3 ? `${c.slice(0, 3)}.${c.slice(3)}` : c;
};

/** The fiscal year a date of service falls in: October 1, 2026 starts FY 2027. */
export function fiscalYear(dateOfService: string) {
  const [y, m] = dateOfService.split("-").map(Number);
  return m >= 10 ? y + 1 : y;
}

export type IcdRow = { code: string; description: string; billable: boolean };

/**
 * CMS's order file (icd10cm_order_YYYY.txt: order number, code, 0/1 billable
 * flag, short and long description in fixed columns) or its codes file
 * (icd10cm_codes_YYYY.txt: code, then the description; every code billable).
 */
export function parseIcd10(text: string): { rows: IcdRow[]; skipped: number } {
  const rows: IcdRow[] = [];
  let skipped = 0;
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Order file columns: 1-5 order number, 7-13 code, 15 billable flag, 17-76 short description, 78 on the long one.
    const order = /^\d{5} /.test(line);
    const plain = order ? null : /^([A-Z][0-9A-Z][0-9A-Z]{1,5})\s+(\S.*)$/.exec(line);
    const code = order ? line.slice(6, 13).trim() : plain?.[1];
    const flag = order ? line.charAt(14) : "1";
    const description = (order ? line.slice(77).trim() || line.slice(16, 76).trim() : plain?.[2])?.trim();
    if (!code || !description || !ICD10CM_UNDOTTED_RE.test(code) || !["0", "1"].includes(flag)) { skipped++; continue; }
    rows.push({ code: dotted(code), description: description.slice(0, 300), billable: flag === "1" });
  }
  return { rows, skipped };
}

async function inChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

/**
 * Loads one fiscal year's file. A code keeps the first year it appeared and
 * the latest year that listed it; a code missing from the newest file was
 * deleted, and stays valid only for dates of service in the years that had it.
 */
export async function importIcd10(db: Db, text: string, year: number, label: string, loadedBy: string) {
  if (!Number.isInteger(year) || year < 2015 || year > 2100) throw new Error("Give the fiscal year the file is for, e.g. 2027 for October 2026 to September 2027");
  const { rows, skipped } = parseIcd10(text);
  if (rows.length < 100) throw new Error(`Not an ICD-10-CM order or codes file (${rows.length} codes found, ${skipped} lines skipped)`);
  await inChunks(rows, 1000, (chunk) => db.insert(icd10Codes).values(chunk.map((r) => ({ ...r, firstYear: year, seenYear: year }))).onConflictDoUpdate({
    target: icd10Codes.code,
    set: {
      // The newest file's wording and billable flag win; an older file loaded later only widens the years.
      description: sql`CASE WHEN ${year} >= COALESCE(${icd10Codes.seenYear}, 0) THEN excluded.description ELSE ${icd10Codes.description} END`,
      billable: sql`CASE WHEN ${year} >= COALESCE(${icd10Codes.seenYear}, 0) THEN excluded.billable ELSE ${icd10Codes.billable} END`,
      firstYear: sql`LEAST(COALESCE(${icd10Codes.firstYear}, ${year}), ${year})`,
      seenYear: sql`GREATEST(COALESCE(${icd10Codes.seenYear}, ${year}), ${year})`,
    },
  }));
  await db.insert(codeSetLoads).values({ codeSet: "icd10cm", label: `FY ${year}: ${label}`.slice(0, 120), rows: rows.length, loadedBy });
  return { added: rows.length, skipped };
}

export type IcdChange = { kind: "add" | "delete"; code: string; billable: boolean; description: string };

/**
 * CMS's addenda file for a year (icd10cm_order_addenda_YYYY.txt): lines
 * "Add:", "Delete:", "Revise from:" and "Revise to:", each with the 0/1
 * billable flag, the code and its descriptions. A code both deleted and added
 * changed its billable flag (for example, it became a category with new codes
 * under it).
 */
export function parseIcd10Addenda(text: string): IcdChange[] {
  const out: IcdChange[] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = /^(Add|Delete):\s+([01])\s+([A-Z][0-9A-Z][0-9A-Z]{1,5})\s+(\S.*)$/.exec(line.trimEnd());
    if (!m) continue;
    const parts = m[4].split(/\s{2,}/);
    out.push({ kind: m[1] === "Add" ? "add" : "delete", code: dotted(m[3]), billable: m[2] === "1", description: (parts[parts.length - 1] ?? "").slice(0, 300) });
  }
  return out;
}

/**
 * Loads a year's addenda after that year's order file, so the year before is
 * known too: codes the year did not add existed the year before, codes it
 * deleted were valid until September 30, and codes whose billable flag changed
 * keep the year it changed. Without it, loading only the newest year would make
 * every code look new that year.
 */
export async function importIcd10Addenda(db: Db, text: string, year: number, label: string, loadedBy: string) {
  if (!Number.isInteger(year) || year < 2016 || year > 2100) throw new Error("Give the fiscal year of the addenda, e.g. 2027");
  const changes = parseIcd10Addenda(text);
  if (changes.length < 5) throw new Error(`Not an ICD-10-CM addenda file (${changes.length} changes found)`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(icd10Codes).where(gte(icd10Codes.seenYear, year));
  if (Number(n) < 100) throw new Error(`Load the FY ${year} order file first, then its addenda`);
  const adds = new Map(changes.filter((c) => c.kind === "add").map((c) => [c.code, c]));
  const deletes = new Map(changes.filter((c) => c.kind === "delete").map((c) => [c.code, c]));
  const flagChanged = [...adds.keys()].filter((c) => deletes.has(c) && deletes.get(c)!.billable !== adds.get(c)!.billable);
  const newCodes = [...adds.keys()].filter((c) => !deletes.has(c));
  const removed = [...deletes.values()].filter((c) => !adds.has(c.code));
  // Everything in this year's file that it did not add was already there the year before.
  await db.execute(sql`UPDATE icd10_codes SET first_year = ${year - 1}
    WHERE seen_year >= ${year} AND first_year = ${year} AND code NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(newCodes)}::jsonb))`);
  await inChunks(removed, 500, (chunk) => db.insert(icd10Codes).values(chunk.map((c) => ({ code: c.code, description: c.description, billable: c.billable, firstYear: year - 1, seenYear: year - 1 }))).onConflictDoUpdate({
    target: icd10Codes.code,
    set: { firstYear: sql`LEAST(COALESCE(${icd10Codes.firstYear}, ${year - 1}), ${year - 1})`, seenYear: sql`GREATEST(COALESCE(${icd10Codes.seenYear}, ${year - 1}), ${year - 1})` },
  }));
  if (flagChanged.length) await db.update(icd10Codes).set({ changedYear: year }).where(inArray(icd10Codes.code, flagChanged));
  await db.insert(codeSetLoads).values({ codeSet: "icd10cm", label: `FY ${year} addenda: ${label}`.slice(0, 120), rows: changes.length, loadedBy });
  return { added: newCodes.length, deleted: removed.length, flagChanged: flagChanged.length, skipped: 0 };
}

/** The newest fiscal year loaded, or null when only the built-in list is there. */
export async function icdYearLoaded(db: Db) {
  return (await icdYears(db)).latest;
}

/** The newest fiscal year loaded, and the earliest one the files describe (before it, a code's history is unknown). */
export async function icdYears(db: Db) {
  const [r] = await db.select({ latest: sql<number | null>`max(${icd10Codes.seenYear})`, earliest: sql<number | null>`min(${icd10Codes.firstYear})` }).from(icd10Codes);
  return { latest: r?.latest ? Number(r.latest) : null, earliest: r?.earliest ? Number(r.earliest) : null };
}

/** Whether a code was billable in a fiscal year, given the year its flag last changed. */
export const billableIn = (r: { billable: boolean; changedYear: number | null }, fy: number) => (r.changedYear && fy < r.changedYear ? !r.billable : r.billable);

/** Diagnosis checks against the loaded code set, for the date of service. */
export async function icdFindings(db: Db, dateOfService: string, diagnoses: string[]): Promise<ScrubFinding[]> {
  const { latest, earliest } = await icdYears(db);
  if (!latest || !diagnoses.length || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfService)) return [];
  const fy = fiscalYear(dateOfService);
  const first = earliest ?? latest;
  // Before the earliest year the files describe, a code's history is unknown: flag what may be wrong, but do not refuse.
  const unknownYear = fy < first;
  const wanted = [...new Set(diagnoses.map(dotted))];
  const found = new Map((await db.select().from(icd10Codes).where(inArray(icd10Codes.code, wanted))).map((r) => [r.code, r]));
  const out: ScrubFinding[] = [];
  const field = "encounter.diagnoses";
  for (const dx of wanted) {
    const r = found.get(dx);
    if (!r || r.firstYear === null || r.seenYear === null) {
      out.push(unknownYear
        ? { rule: "DX_CODE", severity: "warning", field, message: `${dx} is not in the ICD-10-CM files loaded (FY ${first} on); FY ${fy} is not loaded, so check it is valid for this date of service` }
        : { rule: "DX_CODE", severity: "error", field, message: `${dx} is not an ICD-10-CM code in the FY ${Math.min(fy, latest)} code set` });
    } else if (fy < r.firstYear && r.firstYear > first) {
      out.push({ rule: "DX_NOT_YET_VALID", severity: "error", field, message: `${dx} takes effect October 1, ${r.firstYear - 1}; the date of service is before that` });
    } else if (r.seenYear < fy && r.seenYear < latest) {
      out.push({ rule: "DX_DELETED", severity: "error", field, message: `${dx} was deleted after FY ${r.seenYear} (September 30, ${r.seenYear}); use its replacement for this date of service` });
    } else if (!billableIn(r, fy)) {
      out.push({ rule: "DX_BILLABLE", severity: unknownYear ? "warning" : "error", field, message: r.changedYear && fy >= r.changedYear && !r.billable
        ? `${dx} (${r.description}) became a category on October 1, ${r.changedYear - 1}: choose one of the more specific codes under it`
        : `${dx} (${r.description}) is a category, not a billable code: choose a more specific code under it` });
    }
  }
  if (fy > latest) out.push({ rule: "DX_YEAR_NOT_LOADED", severity: "warning", field, message: `The FY ${fy} ICD-10-CM codes (effective October 1, ${fy - 1}) are not loaded yet, so new and deleted codes for this date of service are not checked` });
  return out;
}

/* ------------------------------ HCPCS Level II ------------------------------ */

export type HcpcsRow = { code: string; description: string; shortDescription: string | null; addedOn: string | null; terminatedOn: string | null };

const ymd = (v: string | undefined) => {
  const d = (v ?? "").trim().replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null;
};

/**
 * CMS's HCPCS file saved as CSV (columns HCPC, RECID, LONG DESCRIPTION, SHORT
 * DESCRIPTION, ADD DT, TERM DT; a long description continues on RECID 4 rows),
 * or any CSV with code and description columns.
 */
export function parseHcpcs(text: string): { rows: HcpcsRow[]; skipped: number } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => /hcpc|code/i.test(l) && /desc/i.test(l));
  if (start < 0) throw new Error("Not a HCPCS file: no header with a code and a description column");
  const t = parseCsv(lines.slice(start).join("\n"), 2_000_000);
  const h = t.headers.map((x) => x.trim().toUpperCase());
  const at = (re: RegExp) => h.findIndex((x) => re.test(x));
  const [c, rec, long, short, add, term] = [at(/^HCPC|^CODE/), at(/RECID/), at(/LONG DESC|^DESCRIPTION/), at(/SHORT DESC/), at(/^ADD DT|^ADDED/), at(/^TERM DT|^TERMINAT/)];
  const byCode = new Map<string, HcpcsRow>();
  let skipped = 0;
  for (const r of t.rows) {
    const code = (r[c] ?? "").trim().toUpperCase();
    const kind = rec >= 0 ? (r[rec] ?? "").trim() : "3";
    if (!/^[A-V][0-9]{4}$/.test(code) || !["3", "4"].includes(kind)) { skipped++; continue; }
    const text = (r[long] ?? "").trim();
    const row = byCode.get(code);
    if (row) { if (text) row.description = `${row.description} ${text}`.slice(0, 600); continue; }
    if (!text) { skipped++; continue; }
    byCode.set(code, { code, description: text.slice(0, 600), shortDescription: short >= 0 ? (r[short] ?? "").trim().slice(0, 80) || null : null, addedOn: add >= 0 ? ymd(r[add]) : null, terminatedOn: term >= 0 ? ymd(r[term]) : null });
  }
  return { rows: [...byCode.values()], skipped };
}

export async function importHcpcs(db: Db, text: string, label: string, loadedBy: string) {
  const { rows, skipped } = parseHcpcs(text);
  if (!rows.length) throw new Error(`No HCPCS codes found (${skipped} rows skipped)`);
  await inChunks(rows, 1000, (chunk) => db.insert(hcpcsCodes).values(chunk).onConflictDoUpdate({
    target: hcpcsCodes.code,
    set: { description: sql`excluded.description`, shortDescription: sql`excluded.short_description`, addedOn: sql`excluded.added_on`, terminatedOn: sql`excluded.terminated_on` },
  }));
  await db.insert(codeSetLoads).values({ codeSet: "hcpcs", label: label.slice(0, 120), rows: rows.length, loadedBy });
  return { added: rows.length, skipped };
}

/** HCPCS Level II lines checked against the loaded file: the code exists and is in effect on the date of service. */
export async function hcpcsFindings(db: Db, dateOfService: string, lines: { lineNumber: number; cpt: string }[]): Promise<ScrubFinding[]> {
  const level2 = lines.filter((l) => /^[A-V][0-9]{4}$/.test(l.cpt.toUpperCase()));
  if (!level2.length) return [];
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(hcpcsCodes);
  if (!Number(n)) return [];
  const found = new Map((await db.select().from(hcpcsCodes).where(inArray(hcpcsCodes.code, level2.map((l) => l.cpt.toUpperCase())))).map((r) => [r.code, r]));
  const out: ScrubFinding[] = [];
  for (const l of level2) {
    const r = found.get(l.cpt.toUpperCase());
    const field = `lines.${l.lineNumber}.cpt`;
    if (!r) out.push({ rule: "HCPCS_CODE", severity: "error", field, message: `Line ${l.lineNumber}: ${l.cpt} is not a HCPCS Level II code` });
    else if (r.terminatedOn && r.terminatedOn < dateOfService) out.push({ rule: "HCPCS_TERMINATED", severity: "error", field, message: `Line ${l.lineNumber}: ${l.cpt} was discontinued on ${r.terminatedOn}` });
    else if (r.addedOn && r.addedOn > dateOfService) out.push({ rule: "HCPCS_NOT_YET_VALID", severity: "error", field, message: `Line ${l.lineNumber}: ${l.cpt} takes effect on ${r.addedOn}, after the date of service` });
  }
  return out;
}

/* ------------------------------ Choosing codes ------------------------------ */

export type CodeOption = { code: string; description: string };

/** Diagnoses to offer without typing: the practice's most used this past year, then the built-in list. */
export async function commonDiagnoses(db: Db, practiceId: string | undefined, limit = 300): Promise<CodeOption[]> {
  const used = practiceId
    ? (await db.execute<{ code: string }>(sql`
        SELECT d AS code FROM encounters e, jsonb_array_elements_text(e.diagnoses) AS d
        WHERE e.practice_id = ${practiceId} AND e.date_of_service >= (current_date - 365)
        GROUP BY d ORDER BY count(*) DESC LIMIT ${limit}`)).rows.map((r) => r.code)
    : [];
  const rank = new Map(used.map((c, i) => [c, i]));
  const rows = used.length
    ? (await db.select({ code: icd10Codes.code, description: icd10Codes.description }).from(icd10Codes).where(inArray(icd10Codes.code, used))).sort((a, b) => rank.get(a.code)! - rank.get(b.code)!)
    : [];
  const seen = new Set(rows.map((r) => r.code));
  const builtIn = await db.select({ code: icd10Codes.code, description: icd10Codes.description }).from(icd10Codes).where(sql`${icd10Codes.firstYear} IS NULL`).orderBy(asc(icd10Codes.code)).limit(limit);
  return [...rows, ...builtIn.filter((r) => !seen.has(r.code))].slice(0, limit);
}

/** Words typed as a full-text query where each word may be the start of one: "back pa" matches "back pain". */
export function prefixQuery(q: string) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1).slice(0, 5);
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
}

/** Codes starting with a prefix, as a range the primary key index answers. */
const codeRange = (column: typeof icd10Codes.code | typeof hcpcsCodes.code, prefix: string) => and(gte(column, prefix), lt(column, `${prefix}~`));

/** Diagnosis search by code or words, billable codes first. */
export async function searchDiagnoses(db: Db, q: string, limit = 25): Promise<CodeOption[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  // A code starts with a letter and has a digit by the third character (E11, QA0); words do not.
  const asCode = /^[A-Za-z]([0-9]|[A-Za-z][0-9])/.test(term);
  const words = prefixQuery(term);
  if (!asCode && !words) return [];
  // A code prefix is a range on the primary key; words go through the full-text index (both indexed, so fast on the full list).
  const where = asCode ? codeRange(icd10Codes.code, dotted(term)) : sql`to_tsvector('english', ${icd10Codes.description}) @@ to_tsquery('english', ${words})`;
  return db.select({ code: icd10Codes.code, description: icd10Codes.description }).from(icd10Codes)
    .where(where).orderBy(sql`${icd10Codes.billable} DESC`, sql`length(${icd10Codes.code})`, asc(icd10Codes.code)).limit(limit);
}

/** Procedure search: the built-in list, the practice's own codes and HCPCS Level II. */
export async function searchProcedures(db: Db, practiceId: string, q: string, limit = 25): Promise<CodeOption[]> {
  const term = q.trim().replace(/[%_]/g, "");
  if (term.length < 2) return [];
  const isCode = /^[A-Za-z0-9]{2,5}$/.test(term) && /\d/.test(term);
  const own = await db.select({ code: practiceCodes.code, description: practiceCodes.description }).from(practiceCodes)
    .where(and(eq(practiceCodes.practiceId, practiceId), isCode ? like(practiceCodes.code, `${term.toUpperCase()}%`) : ilike(practiceCodes.description, `%${term}%`))).limit(limit);
  const builtIn = await db.select({ code: cptCodes.code, description: cptCodes.description }).from(cptCodes)
    .where(isCode ? like(cptCodes.code, `${term.toUpperCase()}%`) : ilike(cptCodes.description, `%${term}%`)).limit(limit);
  const level2 = await db.select({ code: hcpcsCodes.code, description: hcpcsCodes.description }).from(hcpcsCodes)
    .where(isCode ? codeRange(hcpcsCodes.code, term.toUpperCase()) : prefixQuery(term) ? sql`to_tsvector('english', ${hcpcsCodes.description}) @@ to_tsquery('english', ${prefixQuery(term)})` : sql`false`).limit(limit);
  const seen = new Set<string>();
  return [...own, ...builtIn, ...level2].filter((r) => !seen.has(r.code) && seen.add(r.code)).slice(0, limit);
}

/* ------------------------------ The practice's own codes ------------------------------ */

/** CPT (5 digits, or 4 digits and F, T or U) or HCPCS Level II (a letter and 4 digits). */
export const PROCEDURE_CODE = /^([0-9]{4}[0-9FTU]|[A-V][0-9]{4})$/;

/**
 * Adds or updates procedure codes from a CSV with code, description and
 * (optionally) fee columns. A fee goes on the practice's standard charges.
 */
export async function importPracticeCodes(db: Db, practiceId: string, text: string) {
  const t = parseCsv(text.replace(/^﻿/, ""), 20_000);
  const h = t.headers.map((x) => x.trim().toLowerCase());
  const [c, d, f] = [h.findIndex((x) => /code|cpt|hcpcs/.test(x)), h.findIndex((x) => /desc|name/.test(x)), h.findIndex((x) => /fee|charge|price|amount/.test(x))];
  if (c < 0 || d < 0) throw new Error("The file needs a header row with a code column and a description column (and optionally a fee)");
  const rows: { code: string; description: string }[] = [];
  const fees: { cpt: string; amountCents: number }[] = [];
  const problems: string[] = [];
  t.rows.forEach((r, i) => {
    const code = (r[c] ?? "").trim().toUpperCase();
    const description = (r[d] ?? "").trim().slice(0, 200);
    if (!code && !description) return;
    if (!PROCEDURE_CODE.test(code)) { problems.push(`Row ${i + 2}: ${code || "(blank)"} is not a CPT or HCPCS code`); return; }
    if (!description) { problems.push(`Row ${i + 2}: ${code} has no description`); return; }
    rows.push({ code, description });
    const fee = f >= 0 ? Number((r[f] ?? "").replace(/[$,\s]/g, "")) : NaN;
    if (Number.isFinite(fee) && fee > 0) fees.push({ cpt: code, amountCents: Math.round(fee * 100) });
  });
  if (!rows.length) throw new Error(problems[0] ?? "No codes found in the file");
  await inChunks(rows, 500, (chunk) => db.insert(practiceCodes).values(chunk.map((r) => ({ practiceId, ...r }))).onConflictDoUpdate({ target: [practiceCodes.practiceId, practiceCodes.code], set: { description: sql`excluded.description` } }));
  if (fees.length) await saveScheduleItems(db, (await ensureSchedule(db, practiceId, null)).id, fees);
  return { added: rows.length, fees: fees.length, problems: problems.slice(0, 20) };
}

export async function listPracticeCodes(db: Db, practiceId: string) {
  return db.select().from(practiceCodes).where(eq(practiceCodes.practiceId, practiceId)).orderBy(asc(practiceCodes.code));
}

export async function removePracticeCode(db: Db, practiceId: string, code: string) {
  await db.delete(practiceCodes).where(and(eq(practiceCodes.practiceId, practiceId), eq(practiceCodes.code, code)));
}

/** Every procedure the practice can pick: the built-in list with the practice's wording where it has its own, then its other codes. */
export async function procedureCatalog(db: Db, practiceId: string) {
  const [builtIn, own] = await Promise.all([db.select().from(cptCodes).orderBy(asc(cptCodes.code)), listPracticeCodes(db, practiceId)]);
  const ownBy = new Map(own.map((o) => [o.code, o.description]));
  const list = builtIn.map((c) => ({ code: c.code, description: ownBy.get(c.code) ?? c.description, defaultFeeCents: c.defaultFeeCents }));
  const inList = new Set(list.map((c) => c.code));
  for (const o of own) if (!inList.has(o.code)) list.push({ code: o.code, description: o.description, defaultFeeCents: 0 });
  return list.sort((a, b) => a.code.localeCompare(b.code));
}
