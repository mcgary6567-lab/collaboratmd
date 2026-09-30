/**
 * The chargemaster (charge description master) for facility billing: every
 * billable item with its UB-04 revenue code, HCPCS or CPT code, gross charge
 * and discounted cash price. Facility claim lines left without a charge are
 * priced from it. Prices are reviewed yearly; the page shows when each was.
 *
 * Hospitals must also publish their standard charges as a machine-readable
 * file (45 CFR 180.50). The CSV here is laid out after CMS's version 2 "tall"
 * template: gross charge, discounted cash price, each payer's negotiated rate
 * from its contract (the fee schedule), and the minimum and maximum negotiated
 * rate. Check it against CMS's current template and data dictionary, and add
 * the hospital's attestation, before posting it.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { parseCsv } from "@/lib/import/csv";

const { chargemasterItems, practices, auditLog } = schema;

export type ChargemasterInput = { itemCode: string; description: string; revenueCode: string; hcpcs?: string | null; modifiers?: string | null; priceCents: number; cashPriceCents?: number | null; setting?: string };

function clean(i: ChargemasterInput) {
  const itemCode = i.itemCode.trim().toUpperCase().slice(0, 30);
  const revenueCode = i.revenueCode.trim().padStart(4, "0");
  const hcpcs = i.hcpcs?.trim().toUpperCase() || null;
  if (!itemCode) throw new Error("Each item needs a code");
  if (!i.description.trim()) throw new Error(`${itemCode}: add a description`);
  if (!/^0\d{3}$/.test(revenueCode)) throw new Error(`${itemCode}: the revenue code is four digits, like 0450`);
  if (hcpcs && !/^([0-9]{4}[0-9A-Z]|[A-V][0-9]{4})$/.test(hcpcs)) throw new Error(`${itemCode}: ${hcpcs} is not a CPT or HCPCS code`);
  if (!Number.isInteger(i.priceCents) || i.priceCents < 0) throw new Error(`${itemCode}: enter the charge`);
  const setting = ["inpatient", "outpatient", "both"].includes(i.setting ?? "both") ? (i.setting ?? "both") : "both";
  return { itemCode, description: i.description.trim().slice(0, 200), revenueCode, hcpcs, modifiers: i.modifiers?.trim().toUpperCase().slice(0, 20) || null, priceCents: i.priceCents, cashPriceCents: i.cashPriceCents ?? null, setting };
}

/** Adds or updates items from a CSV: item code, description, revenue code, HCPCS, modifiers, charge, cash price, setting. */
export async function importChargemaster(db: Db, practiceId: string, text: string, userId?: string) {
  const t = parseCsv(text.replace(/^﻿/, ""), 50_000);
  const h = t.headers.map((x) => x.trim().toLowerCase());
  const at = (re: RegExp) => h.findIndex((x) => re.test(x));
  const [code, desc, rev, hc, mod, price, cash, setting] = [at(/item|cdm|charge code|^code$/), at(/desc/), at(/rev/), at(/hcpcs|cpt/), at(/mod/), at(/^(price|charge|gross)/), at(/cash/), at(/setting|inpatient/)];
  if (code < 0 || desc < 0 || rev < 0 || price < 0) throw new Error("The file needs item code, description, revenue code and charge columns");
  const money = (v: string | undefined) => Math.round(Number((v ?? "").replace(/[$,\s]/g, "")) * 100);
  const rows = t.rows.filter((r) => (r[code] ?? "").trim()).map((r) => clean({
    itemCode: r[code], description: r[desc] ?? "", revenueCode: r[rev] ?? "", hcpcs: hc >= 0 ? r[hc] : null, modifiers: mod >= 0 ? r[mod] : null,
    priceCents: money(r[price]), cashPriceCents: cash >= 0 && (r[cash] ?? "").trim() ? money(r[cash]) : null, setting: setting >= 0 ? (r[setting] ?? "").trim().toLowerCase() : "both",
  }));
  if (!rows.length) throw new Error("No items found in the file");
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(chargemasterItems).values(rows.slice(i, i + 500).map((r) => ({ practiceId, ...r }))).onConflictDoUpdate({
      target: [chargemasterItems.practiceId, chargemasterItems.itemCode],
      set: { description: sql`excluded.description`, revenueCode: sql`excluded.revenue_code`, hcpcs: sql`excluded.hcpcs`, modifiers: sql`excluded.modifiers`, priceCents: sql`excluded.price_cents`, cashPriceCents: sql`excluded.cash_price_cents`, setting: sql`excluded.setting`, active: true, updatedAt: new Date() },
    });
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "chargemaster_imported", entity: "practice", entityId: practiceId, details: { items: rows.length } });
  return rows.length;
}

export async function listChargemaster(db: Db, practiceId: string) {
  return db.select().from(chargemasterItems).where(eq(chargemasterItems.practiceId, practiceId)).orderBy(asc(chargemasterItems.revenueCode), asc(chargemasterItems.itemCode));
}

/** Marks every active item's price as reviewed today (the yearly review). */
export async function markReviewed(db: Db, practiceId: string, userId?: string) {
  const today = new Date().toISOString().slice(0, 10);
  await db.update(chargemasterItems).set({ reviewedOn: today }).where(and(eq(chargemasterItems.practiceId, practiceId), eq(chargemasterItems.active, true)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "chargemaster_reviewed", entity: "practice", entityId: practiceId, details: { on: today } });
}

/** The gross charge for a facility line, by revenue code and HCPCS (or the revenue code alone when the line has none). */
export async function chargemasterPrice(db: Db, practiceId: string, revenueCode: string, hcpcs: string | null) {
  const rev = revenueCode.trim().padStart(4, "0");
  const code = hcpcs?.trim().toUpperCase() || null;
  const [item] = await db.select({ price: chargemasterItems.priceCents }).from(chargemasterItems)
    .where(and(eq(chargemasterItems.practiceId, practiceId), eq(chargemasterItems.active, true), eq(chargemasterItems.revenueCode, rev), code ? eq(chargemasterItems.hcpcs, code) : sql`${chargemasterItems.hcpcs} IS NULL`))
    .limit(1);
  return item?.price ?? null;
}

const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));

/** The standard charges file, laid out after CMS's v2 CSV "tall" template: one row per item and payer. */
export async function priceTransparencyCsv(db: Db, practiceId: string, info: { locationName: string; licenseNumber: string; licenseState: string }) {
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const items = (await listChargemaster(db, practiceId)).filter((i) => i.active);
  const { rows: rates } = await db.execute<{ hcpcs: string; payer: string; cents: string }>(sql`
    SELECT fi.cpt AS hcpcs, py.name AS payer, fi.amount_cents::text AS cents
    FROM fee_schedule_items fi JOIN fee_schedules fs ON fs.id = fi.fee_schedule_id JOIN payers py ON py.id = fs.payer_id
    WHERE fs.practice_id = ${practiceId} AND fs.active AND fs.payer_id IS NOT NULL`);
  const byCode = new Map<string, { payer: string; cents: number }[]>();
  for (const r of rates) byCode.set(r.hcpcs, [...(byCode.get(r.hcpcs) ?? []), { payer: r.payer, cents: Number(r.cents) }]);
  const today = new Date().toISOString().slice(0, 10);
  const lines: (string | number | null)[][] = [
    ["hospital_name", "last_updated_on", "version", "location_name", "hospital_address", `license_number | ${info.licenseState}`, "To the best of its knowledge and belief, the hospital has included all applicable standard charge information in accordance with the requirements of 45 CFR 180.50, and the information encoded is true, accurate, and complete as of the date indicated."],
    [practice.name, today, "2.0.0", info.locationName, `${practice.address1}, ${practice.city}, ${practice.state} ${practice.zip}`, info.licenseNumber, "true"],
    ["description", "code | 1", "code | 1 | type", "code | 2", "code | 2 | type", "modifiers", "setting", "drug_unit_of_measurement", "drug_type_of_measurement", "standard_charge | gross", "standard_charge | discounted_cash", "payer_name", "plan_name", "standard_charge | negotiated_dollar", "standard_charge | negotiated_percentage", "standard_charge | negotiated_algorithm", "estimated_amount", "standard_charge | methodology", "standard_charge | min", "standard_charge | max", "additional_generic_notes"],
  ];
  for (const i of items) {
    const payers = i.hcpcs ? byCode.get(i.hcpcs) ?? [] : [];
    const amounts = payers.map((p) => p.cents);
    const min = amounts.length ? Math.min(...amounts) : null;
    const max = amounts.length ? Math.max(...amounts) : null;
    const codeType = i.hcpcs ? (/^[0-9]/.test(i.hcpcs) ? "CPT" : "HCPCS") : "RC";
    const [c1, t1, c2, t2] = i.hcpcs ? [i.hcpcs, codeType, i.revenueCode, "RC"] : [i.revenueCode, "RC", "", ""];
    const base = [i.description, c1, t1, c2, t2, i.modifiers ?? "", i.setting, "", "", dollars(i.priceCents), dollars(i.cashPriceCents)];
    if (!payers.length) lines.push([...base, "", "", "", "", "", "", "", "", "", ""]);
    for (const p of payers) lines.push([...base, p.payer, "All plans", dollars(p.cents), "", "", "", "fee schedule", dollars(min), dollars(max), ""]);
  }
  return lines.map((l) => l.map(cell).join(",")).join("\n") + "\n";
}

export async function chargemasterStats(db: Db, practiceId: string) {
  const [r] = (await db.execute<{ n: string; unreviewed: string }>(sql`
    SELECT count(*)::text AS n, count(*) FILTER (WHERE reviewed_on IS NULL OR reviewed_on < current_date - 365)::text AS unreviewed
    FROM chargemaster_items WHERE practice_id = ${practiceId} AND active`)).rows;
  return { items: Number(r?.n ?? 0), unreviewed: Number(r?.unreviewed ?? 0) };
}

