/**
 * Taking over a practice's open balances from its previous billing system.
 *
 * A CSV of open items is matched to patients already imported (by MRN, or
 * by name and date of birth). Patient balances become opening balances on
 * the ledger, so statements, the portal and collections work on them like
 * any other. Insurance balances stay in a work list here until they are
 * collected or written off: their claims live in the old system, which
 * keeps those books, so they are tracked rather than posted.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { legacyAr, patients, ledgerEntries, auditLog } = schema;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const HEADERS: Record<string, string[]> = {
  mrn: ["mrn", "account", "account number", "patient id", "chart"],
  last: ["last name", "last", "patient last name"],
  first: ["first name", "first", "patient first name"],
  dob: ["dob", "date of birth", "birth date"],
  payer: ["payer", "insurance", "carrier", "payer name"],
  claim: ["claim", "claim number", "claim id", "icn"],
  dos: ["dos", "date of service", "service date"],
  billed: ["billed", "charge", "charges", "billed amount"],
  balance: ["balance", "open balance", "amount due", "outstanding"],
  responsibility: ["responsibility", "resp", "owed by", "party"],
};

const money = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, "")) * 100);
function isoDate(v: string) {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export type LegacyImportResult = { imported: number; patientCents: number; insuranceCents: number; problems: { row: number; message: string }[] };

export async function importLegacyAr(db: Db, practiceId: string, csv: string, batch: string, userId?: string): Promise<LegacyImportResult> {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one balance");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  if (col.balance < 0) throw new Error("No balance column (expected a header like Balance or Amount due)");
  if (col.mrn < 0 && (col.last < 0 || col.first < 0 || col.dob < 0)) throw new Error("Patients are matched by MRN, or by last name, first name and date of birth; the file has neither");
  const name = batch.trim().slice(0, 60) || `Import ${new Date().toISOString().slice(0, 10)}`;
  const [dupe] = await db.select({ id: legacyAr.id }).from(legacyAr).where(and(eq(legacyAr.practiceId, practiceId), eq(legacyAr.batch, name))).limit(1);
  if (dupe) throw new Error(`A batch named "${name}" was already imported; give this one another name`);

  const all = await db.select({ id: patients.id, mrn: patients.mrn, first: patients.firstName, last: patients.lastName, dob: patients.dob }).from(patients).where(eq(patients.practiceId, practiceId));
  const byMrn = new Map(all.map((p) => [p.mrn.toLowerCase(), p.id]));
  const byName = new Map(all.map((p) => [`${p.last.toLowerCase()}|${p.first.toLowerCase()}|${p.dob}`, p.id]));
  const out: LegacyImportResult = { imported: 0, patientCents: 0, insuranceCents: 0, problems: [] };
  const get = (r: string[], k: string) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");

  for (let i = 1; i < rows.length && i <= 20_000; i++) {
    const r = rows[i];
    const dob = isoDate(get(r, "dob"));
    const patientId = (get(r, "mrn") && byMrn.get(get(r, "mrn").toLowerCase())) || (dob && byName.get(`${get(r, "last").toLowerCase()}|${get(r, "first").toLowerCase()}|${dob}`)) || null;
    if (!patientId) { out.problems.push({ row: i + 1, message: "No matching patient; import patients first" }); continue; }
    const balance = money(get(r, "balance"));
    if (!Number.isFinite(balance) || balance <= 0) { out.problems.push({ row: i + 1, message: "Balance is zero or not a number" }); continue; }
    const billed = get(r, "billed") ? money(get(r, "billed")) : balance;
    const resp = /pat|self|guar/i.test(get(r, "responsibility")) || (!get(r, "payer") && !get(r, "responsibility")) ? "patient" : "insurance";
    const dos = get(r, "dos") ? isoDate(get(r, "dos")) : null;
    await db.insert(legacyAr).values({ practiceId, patientId, payerName: get(r, "payer") || null, sourceClaimNumber: get(r, "claim") || null, dateOfService: dos, billedCents: Number.isFinite(billed) ? billed : balance, balanceCents: balance, responsibility: resp, batch: name });
    if (resp === "patient") {
      await db.insert(ledgerEntries).values({ practiceId, patientId, type: "transfer_to_patient", amountCents: balance, note: `Opening balance from previous system (${name}${get(r, "claim") ? `, claim ${get(r, "claim")}` : ""}${dos ? `, DOS ${dos}` : ""})`, postedBy: userId ?? null });
      out.patientCents += balance;
    } else out.insuranceCents += balance;
    out.imported++;
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "legacy_ar_imported", entity: "practice", entityId: practiceId, details: { batch: name, imported: out.imported, problems: out.problems.length, patientCents: out.patientCents, insuranceCents: out.insuranceCents } });
  return out;
}

export async function legacySummary(db: Db, practiceId: string) {
  const { rows } = await db.execute<{ responsibility: string; status: string; n: string; cents: string }>(sql`
    SELECT responsibility, status, count(*)::text AS n, sum(balance_cents)::text AS cents FROM legacy_ar WHERE practice_id = ${practiceId} GROUP BY 1, 2`);
  return rows.map((r) => ({ responsibility: r.responsibility, status: r.status, count: Number(r.n), cents: Number(r.cents) }));
}

export async function listLegacy(db: Db, practiceId: string, status = "open") {
  return db.select({ item: legacyAr, first: patients.firstName, last: patients.lastName }).from(legacyAr).innerJoin(patients, eq(patients.id, legacyAr.patientId))
    .where(and(eq(legacyAr.practiceId, practiceId), eq(legacyAr.status, status), eq(legacyAr.responsibility, "insurance"))).orderBy(desc(legacyAr.balanceCents)).limit(300);
}

/** Closes an insurance item: collected (in the old system's books) or written off. */
export async function closeLegacyItem(db: Db, practiceId: string, id: string, status: "collected" | "written_off", userId?: string) {
  const [row] = await db.update(legacyAr).set({ status }).where(and(eq(legacyAr.id, id), eq(legacyAr.practiceId, practiceId), eq(legacyAr.status, "open"))).returning();
  if (!row) throw new Error("Item not found or already closed");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: `legacy_ar_${status}`, entity: "legacy_ar", entityId: id, details: { cents: row.balanceCents } });
}
