/**
 * The Medicare Physician Fee Schedule: what Medicare allows for a code in the
 * practice's payment locality, from CMS's public files.
 *
 *   allowed = (work RVU x work GPCI + PE RVU x PE GPCI + MP RVU x MP GPCI) x conversion factor
 *
 * with the facility practice-expense RVU when the place of service is a
 * facility (hospital, ASC, SNF...) and the non-facility one otherwise. The RVU
 * file (PPRRVU) and the GPCI file are loaded each year on Settings, Code sets.
 * Uses: expected Medicare payments for underpayment checks, and payer
 * contracts written as a percentage of Medicare.
 */
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { parseCsv } from "@/lib/import/csv";

const { mpfsRvus, mpfsLocalities, mpfsYears, codeSetLoads, practices } = schema;

/** Places of service CMS pays at the facility rate. */
export const FACILITY_POS = new Set(["02", "19", "21", "22", "23", "24", "26", "31", "34", "41", "42", "51", "52", "53", "56", "61"]);

const num = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * The header of a CMS spreadsheet saved as CSV: CMS sometimes splits a
 * column title over two or three rows ("WORK" / "RVU"), so rows are joined
 * cell by cell until the data starts.
 */
function table(text: string, first: RegExp, isData: (cells: string[]) => boolean) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => first.test(l));
  if (start < 0) return null;
  const parsed = parseCsv(lines.slice(start).join("\n"), 2_000_000);
  const header = [...parsed.headers];
  let skip = 0;
  for (const row of parsed.rows) {
    if (isData(row)) break;
    row.forEach((c, i) => { header[i] = `${header[i] ?? ""} ${c}`.trim(); });
    skip++;
  }
  return { header: header.map((h) => h.toUpperCase().replace(/\s+/g, " ")), rows: parsed.rows.slice(skip) };
}

export type RvuRow = { code: string; modifier: string; status: string | null; workRvu: number; peNonFacility: number; peFacility: number; mpRvu: number; multProc: string | null };

/** CMS's PPRRVU file saved as CSV. Returns the rows and the conversion factor it lists, if any. */
export function parseRvuFile(text: string) {
  const t = table(text, /HCPCS/i, (r) => /^[0-9A-Z]{5}$/.test((r[0] ?? "").trim()));
  if (!t) throw new Error("Not a Medicare RVU file: no header with HCPCS");
  const at = (re: RegExp, not?: RegExp) => t.header.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const c = { code: at(/^HCPCS/), mod: at(/^MOD/), status: at(/STATUS/), work: at(/WORK/), peNon: at(/NON-?\s?FAC.*PE|PE.*NON-?\s?FAC/, /TOTAL|INDICATOR|NA /), peFac: at(/FAC.*PE|PE.*FAC/, /NON|TOTAL|INDICATOR|NA /), mp: at(/^MP|MALPRACTICE|MP RVU/, /TOTAL/), cf: at(/CONV/), multProc: at(/MULT/) };
  if ([c.code, c.work, c.peNon, c.peFac, c.mp].some((i) => i < 0)) throw new Error("The RVU file needs HCPCS, work RVU, non-facility PE RVU, facility PE RVU and MP RVU columns");
  const rows: RvuRow[] = [];
  let skipped = 0;
  let conversionFactor: number | null = null;
  for (const r of t.rows) {
    const code = (r[c.code] ?? "").trim().toUpperCase();
    const [w, pn, pf, mp] = [num(r[c.work]), num(r[c.peNon]), num(r[c.peFac]), num(r[c.mp])];
    if (!/^[0-9A-Z]{5}$/.test(code) || w === null || pn === null || pf === null || mp === null) { skipped++; continue; }
    if (conversionFactor === null && c.cf >= 0) conversionFactor = num(r[c.cf]);
    rows.push({ code, modifier: c.mod >= 0 ? (r[c.mod] ?? "").trim().toUpperCase() : "", status: c.status >= 0 ? (r[c.status] ?? "").trim() || null : null, workRvu: w, peNonFacility: pn, peFacility: pf, mpRvu: mp, multProc: c.multProc >= 0 ? (r[c.multProc] ?? "").trim() || null : null });
  }
  return { rows, skipped, conversionFactor: conversionFactor && conversionFactor > 1 ? conversionFactor : null };
}

export type LocalityRow = { carrier: string; locality: string; name: string; state: string | null; workGpci: number; peGpci: number; mpGpci: number };

/** CMS's GPCI file (Addendum E) saved as CSV. */
export function parseGpciFile(text: string) {
  const t = table(text, /(MAC|CONTRACTOR|CARRIER).*LOCALITY/i, (r) => /^\d{4,5}$/.test((r[0] ?? "").trim()));
  if (!t) throw new Error("Not a GPCI file: no header with Locality");
  const at = (re: RegExp) => t.header.findIndex((h) => re.test(h));
  const c = { carrier: at(/MAC|CONTRACTOR|CARRIER/), state: at(/^STATE/), locality: at(/LOCALITY (NUMBER|NO)|^LOCALITY$/), name: at(/LOCALITY NAME/), work: at(/PW GPCI|WORK GPCI/), pe: at(/PE GPCI/), mp: at(/MP GPCI/) };
  if ([c.carrier, c.locality, c.work, c.pe, c.mp].some((i) => i < 0)) throw new Error("The GPCI file needs MAC, locality number and the work, PE and MP GPCI columns");
  const rows: LocalityRow[] = [];
  let skipped = 0;
  for (const r of t.rows) {
    const carrier = (r[c.carrier] ?? "").trim();
    const locality = (r[c.locality] ?? "").trim().padStart(2, "0");
    const [w, pe, mp] = [num(r[c.work]), num(r[c.pe]), num(r[c.mp])];
    if (!/^\d{4,5}$/.test(carrier) || !/^\d{2}$/.test(locality) || !w || !pe || !mp) { skipped++; continue; }
    rows.push({ carrier, locality, name: (r[c.name] ?? "").replace(/\*/g, "").trim() || `Locality ${locality}`, state: c.state >= 0 ? (r[c.state] ?? "").trim().toUpperCase() || null : null, workGpci: w, peGpci: pe, mpGpci: mp });
  }
  return { rows, skipped };
}

async function inChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

const validYear = (year: number) => {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Give the calendar year the fee schedule is for, e.g. 2026");
};

export async function importRvus(db: Db, text: string, year: number, label: string, loadedBy: string, conversionFactor?: number) {
  validYear(year);
  const { rows, skipped, conversionFactor: fromFile } = parseRvuFile(text);
  if (rows.length < 50) throw new Error(`Only ${rows.length} codes found (${skipped} rows skipped); is this the PPRRVU file?`);
  const cf = conversionFactor || fromFile;
  if (!cf) throw new Error("The file has no conversion factor column; enter the year's conversion factor");
  await db.delete(mpfsRvus).where(eq(mpfsRvus.year, year));
  await inChunks(rows, 1000, (chunk) => db.insert(mpfsRvus).values(chunk.map((r) => ({ ...r, year }))).onConflictDoNothing());
  await db.insert(mpfsYears).values({ year, conversionFactor: cf }).onConflictDoUpdate({ target: mpfsYears.year, set: { conversionFactor: cf } });
  await db.insert(codeSetLoads).values({ codeSet: "mpfs_rvu", label: `${year}: ${label}`.slice(0, 120), rows: rows.length, loadedBy });
  return { added: rows.length, skipped };
}

export async function importGpcis(db: Db, text: string, year: number, label: string, loadedBy: string) {
  validYear(year);
  const { rows, skipped } = parseGpciFile(text);
  if (!rows.length) throw new Error(`No localities found (${skipped} rows skipped)`);
  await db.delete(mpfsLocalities).where(eq(mpfsLocalities.year, year));
  await db.insert(mpfsLocalities).values(rows.map((r) => ({ ...r, year }))).onConflictDoNothing();
  await db.insert(codeSetLoads).values({ codeSet: "mpfs_gpci", label: `${year}: ${label}`.slice(0, 120), rows: rows.length, loadedBy });
  return { added: rows.length, skipped };
}

/** The localities of the newest year loaded, for choosing the practice's. */
export async function listLocalities(db: Db) {
  const [y] = await db.select({ year: sql<number | null>`max(${mpfsLocalities.year})` }).from(mpfsLocalities);
  if (!y?.year) return [];
  return db.select().from(mpfsLocalities).where(eq(mpfsLocalities.year, Number(y.year))).orderBy(mpfsLocalities.state, mpfsLocalities.name);
}

export async function mpfsStatus(db: Db) {
  const [years] = await Promise.all([db.select().from(mpfsYears).orderBy(desc(mpfsYears.year)).limit(3)]);
  const [loc] = await db.select({ n: sql<number>`count(*)::int`, year: sql<number | null>`max(${mpfsLocalities.year})` }).from(mpfsLocalities);
  return { years, localities: Number(loc.n), localityYear: loc.year ? Number(loc.year) : null };
}

/** The fee schedule year for a date of service: its own year if loaded, otherwise the newest earlier one. */
async function yearFor(db: Db, dateOfService: string) {
  const y = Number(dateOfService.slice(0, 4));
  const [row] = await db.select().from(mpfsYears).where(lte(mpfsYears.year, y)).orderBy(desc(mpfsYears.year)).limit(1);
  return row ?? null;
}

export type Locality = { carrier: string; locality: string };

/**
 * Medicare's allowed amount for each code, in cents, for a locality, date of
 * service and place of service, and the codes subject to the multiple
 * procedure reduction. A code with no RVUs (not paid under the schedule) is
 * left out. A modifier with its own RVUs (26, TC) uses them.
 */
export async function medicareAllowed(db: Db, loc: Locality, dateOfService: string, pos: string, lines: { cpt: string; modifiers?: string[] | null }[]) {
  const out = new Map<string, number>();
  const mppr = new Set<string>();
  const year = await yearFor(db, dateOfService);
  if (!year || !lines.length) return { rates: out, mppr };
  const [gpci] = await db.select().from(mpfsLocalities).where(and(eq(mpfsLocalities.year, year.year), eq(mpfsLocalities.carrier, loc.carrier), eq(mpfsLocalities.locality, loc.locality))).limit(1);
  if (!gpci) return { rates: out, mppr };
  const codes = [...new Set(lines.map((l) => l.cpt.toUpperCase()))];
  const rvus = await db.select().from(mpfsRvus).where(and(eq(mpfsRvus.year, year.year), inArray(mpfsRvus.code, codes)));
  const facility = FACILITY_POS.has(pos);
  for (const l of lines) {
    const code = l.cpt.toUpperCase();
    const mod = (l.modifiers ?? []).map((m) => m.toUpperCase()).find((m) => m === "26" || m === "TC") ?? "";
    const r = rvus.find((x) => x.code === code && x.modifier === mod) ?? rvus.find((x) => x.code === code && x.modifier === "");
    if (!r) continue;
    const pe = facility ? r.peFacility : r.peNonFacility;
    const dollars = (r.workRvu * gpci.workGpci + pe * gpci.peGpci + r.mpRvu * gpci.mpGpci) * year.conversionFactor;
    if (dollars > 0) out.set(code, Math.round(dollars * 100));
    if (r.multProc === "2") mppr.add(code);
  }
  return { rates: out, mppr };
}

/** The practice's locality, when it has chosen one. */
export async function practiceLocality(db: Db, practiceId: string): Promise<Locality | null> {
  const [p] = await db.select({ carrier: practices.medicareCarrier, locality: practices.medicareLocality }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  return p?.carrier && p.locality ? { carrier: p.carrier, locality: p.locality } : null;
}
