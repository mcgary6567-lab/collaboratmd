/**
 * Saved column mappings for patient imports. A mapping is kept by header name,
 * not column position, so next month's export from the same system maps itself
 * even if its columns moved. We ship no presets for particular vendors'
 * exports: their column names vary by version and by how each practice set up
 * the report, so a practice maps its own file once and saves it.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { PATIENT_FIELDS, type Mapping } from "@/lib/import/patients";

const { importTemplates } = schema;
const FIELD_KEYS = new Set<string>(PATIENT_FIELDS.map((f) => f.key));

import type { Template } from "@/lib/import/templates";
export type { Template } from "@/lib/import/templates";

export async function listTemplates(db: Db, practiceId: string): Promise<Template[]> {
  return db.select({ id: importTemplates.id, name: importTemplates.name, mapping: importTemplates.mapping }).from(importTemplates).where(eq(importTemplates.practiceId, practiceId)).orderBy(asc(importTemplates.name));
}

/** Stores the mapping as field to header name. Saving under an existing name replaces it. */
export async function saveTemplate(db: Db, practiceId: string, name: string, headers: string[], mapping: Mapping, userId?: string) {
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error("Name the template, e.g. the system the file comes from");
  const byHeader: Record<string, string> = {};
  for (const [field, col] of Object.entries(mapping)) {
    if (!FIELD_KEYS.has(field) || typeof col !== "number" || !headers[col]) continue;
    byHeader[field] = headers[col];
  }
  if (!byHeader.dob) throw new Error("Map the date of birth before saving");
  await db.insert(importTemplates).values({ practiceId, name: n, mapping: byHeader, createdBy: userId ?? null })
    .onConflictDoUpdate({ target: [importTemplates.practiceId, importTemplates.name], set: { mapping: byHeader } });
}

export async function deleteTemplate(db: Db, practiceId: string, id: string) {
  await db.delete(importTemplates).where(and(eq(importTemplates.id, id), eq(importTemplates.practiceId, practiceId)));
}

export { mappingFromTemplate, matchingTemplate } from "@/lib/import/templates";
