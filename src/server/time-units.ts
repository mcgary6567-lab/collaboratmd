/** Anesthesia base units from CMS's file (code and base units), used to show what an anesthesia claim is worth. */
import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { parseCsv } from "@/lib/import/csv";

const { anesthesiaBaseUnits, codeSetLoads } = schema;

export function parseAnesthesiaBaseUnits(text: string) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => /code|cpt|hcpcs/i.test(l) && /base/i.test(l));
  if (start < 0) throw new Error("Not an anesthesia base unit file: no header with a code and a base unit column");
  const t = parseCsv(lines.slice(start).join("\n"), 20_000);
  const h = t.headers.map((x) => x.toLowerCase());
  const c = h.findIndex((x) => /code|cpt|hcpcs/.test(x));
  const b = h.findIndex((x) => /base/.test(x));
  const rows: { code: string; baseUnits: number }[] = [];
  let skipped = 0;
  for (const r of t.rows) {
    const code = (r[c] ?? "").trim().padStart(5, "0");
    const units = Number((r[b] ?? "").trim());
    if (!/^0[01]\d{3}$/.test(code) || !Number.isInteger(units) || units < 0 || units > 50) { skipped++; continue; }
    rows.push({ code, baseUnits: units });
  }
  return { rows, skipped };
}

export async function importAnesthesiaBaseUnits(db: Db, text: string, label: string, loadedBy: string) {
  const { rows, skipped } = parseAnesthesiaBaseUnits(text);
  if (!rows.length) throw new Error(`No anesthesia codes found (${skipped} rows skipped)`);
  await db.insert(anesthesiaBaseUnits).values(rows).onConflictDoUpdate({ target: anesthesiaBaseUnits.code, set: { baseUnits: sql`excluded.base_units` } });
  await db.insert(codeSetLoads).values({ codeSet: "anesthesia", label: label.slice(0, 120), rows: rows.length, loadedBy });
  return { added: rows.length, skipped };
}

export async function baseUnitsFor(db: Db, codes: string[]) {
  if (!codes.length) return new Map<string, number>();
  const rows = await db.select().from(anesthesiaBaseUnits).where(inArray(anesthesiaBaseUnits.code, codes));
  return new Map(rows.map((r) => [r.code, r.baseUnits]));
}
