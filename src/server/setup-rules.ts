/**
 * The yearly files and practice settings that billing rules depend on: each
 * with whether it is in place, what it makes possible, and when the next one
 * is due. National files are loaded by the platform operator for everyone;
 * practice settings are the practice's own.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getPolicies } from "./policies";
import { icdYearLoaded } from "./code-catalog";

export type RuleSetupItem = { key: string; title: string; unlocks: string; done: boolean; detail: string; href: string; national: boolean; optional?: boolean };

type Row = Record<string, string | null>;

/** The ICD-10-CM fiscal year a date falls in: October 1 starts the next one. */
export const fiscalYearOf = (d: Date) => d.getUTCFullYear() + (d.getUTCMonth() >= 9 ? 1 : 0);

export async function rulesSetup(db: Db, practiceId: string, today = new Date()): Promise<RuleSetupItem[]> {
  const year = today.getUTCFullYear();
  const fy = fiscalYearOf(today);
  const q = async (query: ReturnType<typeof sql>) => ((await db.execute<Row>(query)).rows[0] ?? {}) as Row;
  const [icd, mpfs, gpci, tele, hcc, ncci, practiceRow, rules, providersMissing, tiers] = await Promise.all([
    icdYearLoaded(db).then((y) => ({ y: y === null ? null : String(y) }) as Row),
    q(sql`SELECT max(year)::text AS y FROM mpfs_years`),
    q(sql`SELECT max(year)::text AS y FROM mpfs_localities`),
    q(sql`SELECT max(year)::text AS y FROM medicare_telehealth_codes`),
    q(sql`SELECT max(year)::text AS y FROM hcc_mappings`),
    q(sql`SELECT max(created_at)::date::text AS d FROM code_set_loads WHERE code_set IN ('ncci_ptp', 'ncci_mue')`),
    db.select({ locality: schema.practices.medicareLocality, state: schema.practices.state }).from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1),
    db.select({ state: schema.promptPayRules.state }).from(schema.promptPayRules).where(eq(schema.promptPayRules.practiceId, practiceId)),
    db.select({ id: schema.providers.id }).from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true), isNull(schema.providers.credential))),
    db.select({ id: schema.slidingFeeTiers.id }).from(schema.slidingFeeTiers).where(eq(schema.slidingFeeTiers.practiceId, practiceId)).limit(1),
  ]);
  const policies = await getPolicies(db, practiceId);
  const practice = practiceRow[0];
  const n = (v: string | null | undefined) => (v ? Number(v) : null);
  const ncciAge = ncci.d ? Math.floor((today.getTime() - Date.parse(`${ncci.d}T12:00:00Z`)) / 86_400_000) : null;
  const loaded = (y: number | null, want: number) => (y === null ? "Not loaded" : y >= want ? `${y} loaded` : `Latest loaded is ${y}`);

  return [
    { key: "icd", national: true, href: "/settings/code-sets", title: `ICD-10-CM for fiscal year ${fy}`, unlocks: "Every diagnosis checked as billable and valid on the date of service", done: (n(icd.y) ?? 0) >= fy, detail: `${loaded(n(icd.y), fy)}. CMS publishes each fiscal year's file in the summer; it takes effect October 1.` },
    { key: "mpfs", national: true, href: "/settings/code-sets", title: `Medicare fee schedule for ${year}`, unlocks: "Medicare underpayment checks, contracts as a percent of Medicare, work RVUs, global periods, the fee schedule check", done: (n(mpfs.y) ?? 0) >= year && (n(gpci.y) ?? 0) >= year, detail: `RVUs: ${loaded(n(mpfs.y), year)}; localities: ${loaded(n(gpci.y), year)}. CMS publishes the final rule in November for January 1.` },
    { key: "telehealth", national: true, href: "/settings/code-sets", title: `Medicare telehealth list for ${year}`, unlocks: "Warnings for Medicare telehealth lines not on the year's list, or audio-only where it is not allowed", done: (n(tele.y) ?? 0) >= year, detail: loaded(n(tele.y), year) },
    { key: "hcc", national: true, href: "/settings/code-sets", title: `HCC mapping for ${year}`, unlocks: "HCC recapture on the care gaps report", done: (n(hcc.y) ?? 0) >= year, detail: loaded(n(hcc.y), year) },
    { key: "ncci", national: true, href: "/settings/code-sets", title: "NCCI edits for this quarter", unlocks: "Code pair and unit limit checks on every claim", done: ncciAge !== null && ncciAge <= 100, detail: ncciAge === null ? "Not loaded" : `Last loaded ${ncciAge} days ago; CMS updates them every quarter.` },
    { key: "locality", national: false, href: "/settings/profile", title: "Medicare locality", unlocks: "Everything priced from the Medicare fee schedule for your area", done: !!practice?.locality, detail: practice?.locality ? "Set" : "Choose the practice's Medicare payment locality on the practice profile." },
    { key: "credentials", national: false, href: "/settings/providers", title: "Provider credentials", unlocks: "Medicare's 85% rate for NPs, PAs and CNSs in underpayment checks", done: providersMissing.length === 0, detail: providersMissing.length ? `${providersMissing.length} active provider${providersMissing.length === 1 ? " has" : "s have"} no credential` : "Every active provider has one" },
    { key: "promptpay", national: false, href: "/settings/prompt-pay", title: "Your state's prompt-pay statute", unlocks: "Late commercial payments and the interest owed", done: rules.some((r) => r.state === practice?.state), detail: rules.length ? `Entered for ${rules.map((r) => r.state).join(", ")}` : "Not entered" },
    { key: "collections", national: false, href: "/billing/collections", title: "Collection safeguards", unlocks: "Accounts held from agencies until your state's and your own requirements are met", done: !!policies.collections && Object.values(policies.collections).some(Boolean), detail: policies.collections ? "Set" : "Not set: accounts can go to an agency after the final notice alone" },
    { key: "chronic", national: false, href: "/reports/care-gaps?tab=ccm", title: "Chronic condition groups", unlocks: "Chronic care management candidates from your own list", done: !!policies.chronicPrefixes?.length, detail: policies.chronicPrefixes?.length ? `${policies.chronicPrefixes.length} groups` : "Using the example list" },
    { key: "sliding", national: false, optional: true, href: "/settings/sliding-fee", title: "Sliding fee scale", unlocks: "Discounts by income for health centers and charity care", done: tiers.length > 0, detail: tiers.length ? "Tiers set" : "Only for practices that offer one" },
  ];
}
