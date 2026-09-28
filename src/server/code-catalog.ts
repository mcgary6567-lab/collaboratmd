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
import { and, asc, eq, ilike, inArray, like, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";
import { parseCsv } from "@/lib/import/csv";
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
    const plain = order ? null : /^([A-Z][0-9][0-9A-Z]{1,5})\s+(\S.*)$/.exec(line);
    const code = order ? line.slice(6, 13).trim() : plain?.[1];
    const flag = order ? line.charAt(14) : "1";
    const description = (order ? line.slice(77).trim() || line.slice(16, 76).trim() : plain?.[2])?.trim();
    if (!code || !description || !/^[A-Z][0-9][0-9A-Z]{1,5}$/.test(code) || !["0", "1"].includes(flag)) { skipped++; continue; }
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

/** The newest fiscal year loaded, or null when only the built-in list is there. */
export async function icdYearLoaded(db: Db) {
  const [r] = await db.select({ y: sql<number | null>`max(${icd10Codes.seenYear})` }).from(icd10Codes);
  return r?.y ? Number(r.y) : null;
}

/** Diagnosis checks against the loaded code set, for the date of service. */
export async function icdFindings(db: Db, dateOfService: string, diagnoses: string[]): Promise<ScrubFinding[]> {
  const latest = await icdYearLoaded(db);
  if (!latest || !diagnoses.length || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfService)) return [];
  const fy = fiscalYear(dateOfService);
  const wanted = [...new Set(diagnoses.map(dotted))];
  const found = new Map((await db.select().from(icd10Codes).where(inArray(icd10Codes.code, wanted))).map((r) => [r.code, r]));
  const out: ScrubFinding[] = [];
  const field = "encounter.diagnoses";
  for (const dx of wanted) {
    const r = found.get(dx);
    if (!r || r.firstYear === null || r.seenYear === null) {
      out.push({ rule: "DX_CODE", severity: "error", field, message: `${dx} is not an ICD-10-CM code in the FY ${Math.min(fy, latest)} code set` });
    } else if (fy < r.firstYear) {
      out.push({ rule: "DX_NOT_YET_VALID", severity: "error", field, message: `${dx} takes effect October 1, ${r.firstYear - 1}; the date of service is before that` });
    } else if (r.seenYear < fy && r.seenYear < latest) {
      out.push({ rule: "DX_DELETED", severity: "error", field, message: `${dx} was deleted after FY ${r.seenYear} (September 30, ${r.seenYear}); use its replacement for this date of service` });
    } else if (!r.billable) {
      out.push({ rule: "DX_BILLABLE", severity: "error", field, message: `${dx} (${r.description}) is a category, not a billable code: choose a more specific code under it` });
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

/** Diagnosis search by code or words, billable codes first. */
export async function searchDiagnoses(db: Db, q: string, limit = 25): Promise<CodeOption[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const asCode = /^[A-Za-z][0-9]/.test(term);
  const words = term.split(/\s+/).filter((w) => w.length > 1).slice(0, 4);
  const where = asCode
    ? like(icd10Codes.code, `${dotted(term).replace(/[%_]/g, "")}%`)
    : and(...words.map((w) => ilike(icd10Codes.description, `%${w.replace(/[%_]/g, "")}%`)));
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
    .where(isCode ? like(hcpcsCodes.code, `${term.toUpperCase()}%`) : or(ilike(hcpcsCodes.description, `%${term}%`), ilike(hcpcsCodes.shortDescription, `%${term}%`))).limit(limit);
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
