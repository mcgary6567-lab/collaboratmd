/**
 * Medicare's ordering and referring edits. Claims for clinical lab tests,
 * imaging, and durable medical equipment and supplies ordered by another
 * practitioner must name that practitioner, and Medicare denies them when the
 * practitioner is not enrolled to order or refer for that kind of service
 * (CMS's Order and Referring file, published weekly: NPI, name, and Y/N for
 * Part B, DME, home health, power mobility devices and hospice).
 *
 * A practice billing its own in-office tests orders them itself, so a claim
 * without a referring provider is only flagged where one is expected: an
 * independent laboratory (place of service 81) or equipment and supplies.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { parseCsv } from "@/lib/import/csv";
import type { ScrubFinding } from "@/lib/scrub/rules";

const { orderingReferring, codeSetLoads } = schema;

export type OrderingRow = { npi: string; lastName: string; firstName: string | null; partB: boolean; dme: boolean; hha: boolean; pmd: boolean; hospice: boolean };

export function parseOrderingReferring(text: string): { rows: OrderingRow[]; skipped: number } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => /npi/i.test(l) && /last/i.test(l));
  if (start < 0) throw new Error("Not the Order and Referring file: no header with NPI and LAST_NAME");
  const t = parseCsv(lines.slice(start).join("\n"), 5_000_000);
  const h = t.headers.map((x) => x.trim().toUpperCase().replace(/[^A-Z]/g, ""));
  const at = (name: string) => h.indexOf(name);
  const [npi, last, first, partB, dme, hha, pmd, hospice] = [at("NPI"), at("LASTNAME"), at("FIRSTNAME"), at("PARTB"), at("DME"), at("HHA"), at("PMD"), at("HOSPICE")];
  if (npi < 0 || last < 0 || partB < 0) throw new Error("The file needs NPI, LAST_NAME and PARTB columns");
  const yes = (r: string[], i: number) => i >= 0 && /^y/i.test((r[i] ?? "").trim());
  const rows: OrderingRow[] = [];
  let skipped = 0;
  for (const r of t.rows) {
    const n = (r[npi] ?? "").trim();
    if (!/^\d{10}$/.test(n) || !(r[last] ?? "").trim()) { skipped++; continue; }
    rows.push({ npi: n, lastName: r[last].trim().slice(0, 80), firstName: first >= 0 ? (r[first] ?? "").trim().slice(0, 80) || null : null, partB: yes(r, partB), dme: yes(r, dme), hha: yes(r, hha), pmd: yes(r, pmd), hospice: yes(r, hospice) });
  }
  return { rows, skipped };
}

/** Replaces the list: the file is the whole current list, so someone no longer on it must not linger. */
export async function importOrderingReferring(db: Db, text: string, label: string, loadedBy: string) {
  const { rows, skipped } = parseOrderingReferring(text);
  if (rows.length < 10) throw new Error(`No practitioners found in the file (${skipped} rows skipped)`);
  await db.delete(orderingReferring);
  for (let i = 0; i < rows.length; i += 2000) await db.insert(orderingReferring).values(rows.slice(i, i + 2000)).onConflictDoNothing();
  await db.insert(codeSetLoads).values({ codeSet: "order_referring", label: label.slice(0, 120), rows: rows.length, loadedBy });
  return { added: rows.length, skipped };
}

/** Clinical lab (80000-89999) and imaging (70000-79999) need a Part B orderer; equipment and supplies need a DME one. */
export function orderingNeed(code: string): "partB" | "dme" | null {
  const c = code.toUpperCase();
  if (/^[78]\d{4}$/.test(c)) return "partB";
  if (/^([EKLB]\d{4}|A[4-9]\d{3})$/.test(c)) return "dme";
  return null;
}

export async function orderingFindings(db: Db, c: { payerType: string; placeOfService: string; referringNpi: string | null; referringName: string | null; lines: { lineNumber: number; cpt: string }[] }): Promise<ScrubFinding[]> {
  if (c.payerType !== "medicare") return [];
  const needs = c.lines.map((l) => ({ l, need: orderingNeed(l.cpt) })).filter((x) => x.need);
  if (!needs.length) return [];
  const npi = c.referringNpi?.trim() || null;
  if (!npi) {
    const expected = c.placeOfService === "81" || needs.some((x) => x.need === "dme");
    return expected ? [{ rule: "ORDERING_MISSING", severity: "warning", field: "encounter.referringNpi", message: `Medicare needs the ordering practitioner's name and NPI for ${needs.map((x) => x.l.cpt).join(", ")}; add the referring provider` }] : [];
  }
  const [loaded] = await db.select({ one: sql<number>`1` }).from(orderingReferring).limit(1);
  if (!loaded) return [];
  const [who] = await db.select().from(orderingReferring).where(eq(orderingReferring.npi, npi)).limit(1);
  const name = c.referringName || `NPI ${npi}`;
  if (!who) return [{ rule: "ORDERING_NOT_ENROLLED", severity: "error", field: "encounter.referringNpi", message: `${name} is not on Medicare's Order and Referring file, so Medicare will deny ${needs.map((x) => x.l.cpt).join(", ")}: check the NPI, or ask the practitioner to enroll in PECOS` }];
  const out: ScrubFinding[] = [];
  for (const { l, need } of needs) {
    if (need === "partB" && !who.partB) out.push({ rule: "ORDERING_NOT_ELIGIBLE", severity: "error", field: `lines.${l.lineNumber}.cpt`, message: `Line ${l.lineNumber}: ${name} may not order Part B services such as ${l.cpt} (Order and Referring file)` });
    if (need === "dme" && !who.dme) out.push({ rule: "ORDERING_NOT_ELIGIBLE", severity: "error", field: `lines.${l.lineNumber}.cpt`, message: `Line ${l.lineNumber}: ${name} may not order equipment or supplies such as ${l.cpt} (Order and Referring file)` });
  }
  return out;
}
