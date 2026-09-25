/**
 * Universal patient import: any system's CSV export, mapped onto our fields.
 *
 * Preview parses the file, maps its columns (by rules, then optionally by AI
 * from headers and value shapes only) and shows how the first rows will
 * land. Import then creates or updates patients: a matching MRN updates, a
 * matching name and date of birth updates, anything else is created. Blank
 * cells never erase what is on file. Every run is recorded with its counts
 * and the reason each skipped row was skipped.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { emit } from "./webhooks";
import { schema } from "@/db";
import { parseCsv, type Table } from "@/lib/import/csv";
import { PATIENT_FIELDS, autoMap, profileColumn, toPatientRow, type Mapping, type PatientField, type PatientRow } from "@/lib/import/patients";
import { applyPrimaryInsurance } from "./hl7";

const { patients, importJobs } = schema;

export const MAX_IMPORT_ROWS = 5_000;

export interface ImportPreview {
  headers: string[];
  rowCount: number;
  mapping: Mapping;
  confidence: Partial<Record<PatientField, number>>;
  sample: ReturnType<typeof toPatientRow>[];
  unmapped: string[];
}

export function preview(table: Table, mapping?: Mapping): ImportPreview {
  const profiles = table.headers.map((h, i) => profileColumn(h, table.rows.slice(0, 500).map((r) => r[i])));
  const auto = autoMap(profiles);
  const chosen: Mapping = mapping ?? Object.fromEntries(auto.map((c) => [c.field, c.column]));
  const used = new Set(Object.values(chosen).filter((v): v is number => typeof v === "number"));
  return {
    headers: table.headers,
    rowCount: table.rows.length,
    mapping: chosen,
    confidence: Object.fromEntries(auto.filter((c) => c.column !== null).map((c) => [c.field, c.confidence])),
    sample: table.rows.slice(0, 5).map((r) => toPatientRow(r, chosen)),
    unmapped: table.headers.filter((_, i) => !used.has(i)),
  };
}

export function profiles(table: Table) {
  return table.headers.map((h, i) => profileColumn(h, table.rows.slice(0, 500).map((r) => r[i])));
}

export function readTable(text: string): Table {
  const t = parseCsv(text, MAX_IMPORT_ROWS);
  if (t.rows.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time`);
  return t;
}

const key = (last: string, first: string, dob: string) => `${last.toLowerCase()}|${first.toLowerCase()}|${dob}`;

export async function importPatients(
  db: Db,
  practiceId: string,
  input: { filename: string; text: string; mapping: Mapping; mappedBy: "rules" | "ai" | "user"; userId?: string },
) {
  const table = readTable(input.text);
  const validFields = new Set<string>(PATIENT_FIELDS.map((f) => f.key));
  const mapping: Mapping = Object.fromEntries(
    Object.entries(input.mapping).filter(([f, c]) => validFields.has(f) && (c === null || (Number.isInteger(c) && (c as number) >= 0 && (c as number) < table.headers.length))),
  );
  if (mapping.dob === undefined || mapping.dob === null) throw new Error("Map a column to date of birth; it is needed to match patients safely");

  // Load what exists once, so each row costs one write rather than several reads.
  const existing = await db
    .select({ id: patients.id, mrn: patients.mrn, firstName: patients.firstName, lastName: patients.lastName, dob: patients.dob })
    .from(patients)
    .where(eq(patients.practiceId, practiceId));
  const byMrn = new Map(existing.map((p) => [p.mrn.toLowerCase(), p.id]));
  const byName = new Map(existing.map((p) => [key(p.lastName, p.firstName, p.dob), p.id]));
  let nextNumber = existing.length + 1001;
  const freshMrn = () => {
    let mrn: string;
    do mrn = `P${String(nextNumber++).padStart(5, "0")}`;
    while (byMrn.has(mrn.toLowerCase()));
    return mrn;
  };

  let created = 0;
  let updated = 0;
  const errors: { row: number; message: string }[] = [];
  const notes: { row: number; message: string }[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < table.rows.length; i++) {
    const rowNo = i + 2; // spreadsheet row, counting the header
    const parsed = toPatientRow(table.rows[i], mapping);
    if (!parsed.ok) {
      errors.push({ row: rowNo, message: parsed.error });
      continue;
    }
    const r: PatientRow = parsed.value;
    const identity = r.mrn ? `mrn:${r.mrn.toLowerCase()}` : key(r.lastName, r.firstName, r.dob);
    if (seenInFile.has(identity)) {
      errors.push({ row: rowNo, message: "Duplicate of an earlier row in this file" });
      continue;
    }
    seenInFile.add(identity);

    const matchId = (r.mrn && byMrn.get(r.mrn.toLowerCase())) || byName.get(key(r.lastName, r.firstName, r.dob));
    const fields = {
      firstName: r.firstName, lastName: r.lastName, dob: r.dob, sex: r.sex,
      phone: r.phone || null, email: r.email || null, address1: r.address1 || null, city: r.city || null, state: r.state || null, zip: r.zip || null,
    };
    let patientId: string;
    try {
      if (matchId) {
        const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== null && v !== "" && !(k === "sex" && v === "U")));
        await db.update(patients).set(changes).where(eq(patients.id, matchId));
        patientId = matchId;
        updated++;
      } else {
        const mrn = r.mrn || freshMrn();
        const [p] = await db.insert(patients).values({ practiceId, mrn, ...fields }).returning();
        await emit(db, practiceId, "patient.created", { patient_id: p.id, mrn: p.mrn, source: "import" });
        patientId = p.id;
        byMrn.set(mrn.toLowerCase(), p.id);
        byName.set(key(r.lastName, r.firstName, r.dob), p.id);
        created++;
      }
      if (r.payerName && r.memberId) {
        const n = await applyPrimaryInsurance(db, practiceId, patientId, { payerId: "", payerName: r.payerName, memberId: r.memberId, groupNumber: r.groupNumber, relationship: "self" });
        for (const message of n) if (message.startsWith("Insurance not applied")) notes.push({ row: rowNo, message });
      }
    } catch (e) {
      errors.push({ row: rowNo, message: e instanceof Error ? e.message : "Could not save" });
    }
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      practiceId, kind: "patients", filename: input.filename.slice(0, 200), mapping: Object.fromEntries(Object.entries(mapping).map(([f, c]) => [f, c === null || c === undefined ? null : table.headers[c]])),
      mappedBy: input.mappedBy, totalRows: table.rows.length, created, updated, skipped: errors.length,
      errors: [...errors, ...notes].sort((a, b) => a.row - b.row).slice(0, 500), createdBy: input.userId ?? null,
    })
    .returning();
  await db.insert(schema.auditLog).values({ practiceId, userId: input.userId ?? null, action: "import_patients", entity: "import_job", entityId: job.id, details: { created, updated, skipped: errors.length } });
  return job;
}

export async function listImportJobs(db: Db, practiceId: string, limit = 20) {
  return db.select().from(importJobs).where(eq(importJobs.practiceId, practiceId)).orderBy(desc(importJobs.createdAt)).limit(limit);
}
