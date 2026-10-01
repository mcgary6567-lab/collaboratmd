/**
 * When each national code set changes, and whether the one loaded is current.
 *
 * CMS publishes its files on a fixed calendar: ICD-10-CM every October 1 (with
 * April updates), NCCI edits and HCPCS every quarter, the physician fee
 * schedule, anesthesia base units, the telehealth list and the HCC mapping
 * every January. Claims are only checked against the latest rules if someone
 * loads the new file in time. This module knows the calendar and compares it
 * with what was loaded: a set is "due" from the time its file is usually
 * published until it takes effect, and "overdue" once it is in effect and
 * the new file has not been loaded. The daily job tells the platform's
 * operators (at most weekly), and Settings, Maintenance and Settings, Code
 * sets show the same list.
 *
 * The calendar is fixed by regulation and CMS practice; if CMS moves a date,
 * the table below is the one place to change.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { CodeSet } from "./code-sets";
import { icdYearLoaded } from "./code-catalog";
import { beat, lastBeat } from "./heartbeats";

/** [month, day] each year the release takes effect. */
type Effective = [number, number][];

export type CalendarEntry = {
  set: CodeSet;
  name: string;
  effective: Effective;
  /** About how many days before it takes effect CMS usually publishes the file. */
  publishedDaysBefore: number;
  source: string;
};

const QUARTERLY: Effective = [[1, 1], [4, 1], [7, 1], [10, 1]];
const JANUARY: Effective = [[1, 1]];
const MONTHLY: Effective = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1]];

export const CALENDAR: CalendarEntry[] = [
  { set: "icd10cm", name: "ICD-10-CM diagnosis codes", effective: [[10, 1]], publishedDaysBefore: 90, source: "https://www.cms.gov/medicare/coding-billing/icd-10-codes" },
  { set: "icd10cm_addenda", name: "ICD-10-CM addenda (April and October updates)", effective: [[4, 1], [10, 1]], publishedDaysBefore: 60, source: "https://www.cms.gov/medicare/coding-billing/icd-10-codes" },
  { set: "ncci_ptp", name: "NCCI procedure-to-procedure edits", effective: QUARTERLY, publishedDaysBefore: 30, source: "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits" },
  { set: "ncci_mue", name: "NCCI medically unlikely edits", effective: QUARTERLY, publishedDaysBefore: 30, source: "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits" },
  { set: "hcpcs", name: "HCPCS Level II codes", effective: QUARTERLY, publishedDaysBefore: 30, source: "https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update" },
  { set: "mpfs_rvu", name: "Physician fee schedule relative values", effective: JANUARY, publishedDaysBefore: 45, source: "https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files" },
  { set: "mpfs_gpci", name: "Physician fee schedule locality adjustments (GPCI)", effective: JANUARY, publishedDaysBefore: 45, source: "https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files" },
  { set: "anesthesia", name: "Anesthesia base units", effective: JANUARY, publishedDaysBefore: 45, source: "https://www.cms.gov/medicare/payment/fee-schedules/physician/anesthesiologists-center" },
  { set: "telehealth", name: "Medicare telehealth services list", effective: JANUARY, publishedDaysBefore: 45, source: "https://www.cms.gov/medicare/coverage/telehealth/list-services" },
  { set: "hcc", name: "ICD-10 to HCC risk adjustment mapping", effective: JANUARY, publishedDaysBefore: 60, source: "https://www.cms.gov/medicare/payment/medicare-advantage-rates-statistics/risk-adjustment" },
  { set: "coverage", name: "Medicare coverage policies (LCD articles)", effective: QUARTERLY, publishedDaysBefore: 0, source: "https://www.cms.gov/medicare-coverage-database/downloads/downloads.aspx" },
  { set: "order_referring", name: "Medicare ordering and referring providers", effective: MONTHLY, publishedDaysBefore: 0, source: "https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment/order-and-referring" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** The latest effective date on or before `today`, and the next one after it. */
export function releaseDates(effective: Effective, today: Date) {
  const y = today.getUTCFullYear();
  const all = [y - 1, y, y + 1].flatMap((yr) => effective.map(([m, d]) => day(yr, m, d))).sort((a, b) => a.getTime() - b.getTime());
  const t = today.getTime();
  const current = [...all].reverse().find((d) => d.getTime() <= t)!;
  const next = all.find((d) => d.getTime() > t)!;
  return { current, next };
}

export type SetStatus = "current" | "due" | "overdue" | "never";

/**
 * Where a set stands, from the date its latest file was loaded:
 *  - never: nothing has been loaded;
 *  - overdue: a release has taken effect and no file was loaded for it (loaded before it was published);
 *  - due: the next release's file is usually published by now, and it has not been loaded yet;
 *  - current: otherwise.
 */
export function setStatus(entry: Pick<CalendarEntry, "effective" | "publishedDaysBefore">, lastLoaded: Date | null, today: Date): { status: SetStatus; current: string; next: string } {
  const { current, next } = releaseDates(entry.effective, today);
  const lead = entry.publishedDaysBefore * 86_400_000;
  const out = { current: iso(current), next: iso(next) };
  if (!lastLoaded) return { status: "never", ...out };
  if (lastLoaded.getTime() < current.getTime() - lead) return { status: "overdue", ...out };
  if (today.getTime() >= next.getTime() - lead && lastLoaded.getTime() < next.getTime() - lead) return { status: "due", ...out };
  return { status: "current", ...out };
}

/** The ICD-10-CM fiscal year in effect on a day: FY 2027 runs from October 1, 2026. */
export const fiscalYear = (today: Date) => today.getUTCFullYear() + (today.getUTCMonth() >= 9 ? 1 : 0);

export async function codeSetCalendar(db: Db, now = new Date()) {
  const today = day(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  const loads = await db.select({ set: schema.codeSetLoads.codeSet, at: sql<string>`to_char(max(${schema.codeSetLoads.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` })
    .from(schema.codeSetLoads).groupBy(schema.codeSetLoads.codeSet);
  const last = new Map(loads.map((l) => [l.set, l.at ? new Date(l.at) : null]));
  const [icdYear, [mpfs]] = await Promise.all([
    icdYearLoaded(db),
    db.select({ year: sql<number | null>`max(${schema.mpfsYears.year})` }).from(schema.mpfsYears),
  ]);
  return CALENDAR.map((entry) => {
    const s = setStatus(entry, last.get(entry.set) ?? null, today);
    let status = s.status;
    // Year-stamped sets: judge by the year the file covers, not only when it was loaded.
    if (entry.set === "icd10cm" && icdYear !== null) {
      const fy = fiscalYear(today);
      const nextOpen = today.getTime() >= day(today.getUTCFullYear(), 10, 1).getTime() - entry.publishedDaysBefore * 86_400_000 && today.getUTCMonth() < 9;
      status = icdYear < fy ? "overdue" : nextOpen && icdYear < fy + 1 ? "due" : "current";
    }
    if (entry.set === "mpfs_rvu" && mpfs?.year) {
      const y = Number(mpfs.year);
      const nextOpen = today.getUTCMonth() === 11 || (today.getUTCMonth() === 10 && today.getUTCDate() >= 17);
      status = y < today.getUTCFullYear() ? "overdue" : nextOpen && y < today.getUTCFullYear() + 1 ? "due" : "current";
    }
    return { ...entry, ...s, status, lastLoaded: last.get(entry.set) ?? null, loadedYear: entry.set === "icd10cm" ? icdYear : entry.set === "mpfs_rvu" ? (mpfs?.year ? Number(mpfs.year) : null) : null };
  });
}

/** For the daily job: tells operators about overdue and due sets, at most once a week. */
export async function alertStaleCodeSets(db: Db, alert: (subject: string, text: string) => Promise<unknown>, now = new Date()) {
  const lastSent = await lastBeat(db, "code-set-alert");
  if (lastSent && now.getTime() - lastSent.getTime() < 7 * 86_400_000) return { sent: false, reason: "sent this week" };
  const rows = (await codeSetCalendar(db, now)).filter((r) => r.status === "overdue" || r.status === "due");
  if (!rows.length) return { sent: false, reason: "all current" };
  const lines = rows.map((r) => `${r.status === "overdue" ? "OVERDUE" : "Due"}: ${r.name} (${r.status === "overdue" ? `in effect since ${r.current}` : `takes effect ${r.next}`}). ${r.source}`);
  await alert(`${rows.length} code set${rows.length === 1 ? "" : "s"} to load`, `Claims are checked against the code sets loaded. Load these on Settings, Code sets:\n\n${lines.join("\n")}`);
  await beat(db, "code-set-alert", now);
  return { sent: true, count: rows.length };
}
