/**
 * Saved column mappings for patient imports. A mapping is kept by header name,
 * not column position, so next month's export from the same system maps itself
 * even if its columns moved. We ship no presets for particular vendors'
 * exports written from memory: their column names vary by version and by how
 * each practice set up the report. Instead, once a practice has mapped a real
 * export from a system (Tebra, AdvancedMD, athenaOne...), the platform
 * operator can share that mapping, and every practice whose file has the same
 * columns gets it applied automatically.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { PATIENT_FIELDS, type Mapping } from "@/lib/import/patients";

const { importTemplates, importPresets } = schema;
const SHARED = "shared:";
const FIELD_KEYS = new Set<string>(PATIENT_FIELDS.map((f) => f.key));

import type { Template } from "@/lib/import/templates";
export type { Template } from "@/lib/import/templates";

/** The practice's own templates, then the ones the platform shares with everyone. */
export async function listTemplates(db: Db, practiceId: string): Promise<Template[]> {
  const [own, shared] = await Promise.all([
    db.select({ id: importTemplates.id, name: importTemplates.name, mapping: importTemplates.mapping }).from(importTemplates).where(eq(importTemplates.practiceId, practiceId)).orderBy(asc(importTemplates.name)),
    db.select().from(importPresets).where(and(isNull(importPresets.practiceId), eq(importPresets.kind, "patients"))).orderBy(asc(importPresets.name)),
  ]);
  return [...own, ...shared.map((p) => ({ id: `${SHARED}${p.id}`, name: `${p.name} (shared)`, mapping: p.mapping }))];
}

/** Shares one of the practice's templates with every practice, under a name that says which system's export it reads. */
export async function shareTemplate(db: Db, practiceId: string, templateId: string, name: string, sharedBy: string) {
  const [t] = await db.select().from(importTemplates).where(and(eq(importTemplates.id, templateId), eq(importTemplates.practiceId, practiceId))).limit(1);
  if (!t) throw new Error("Template not found");
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error("Name it after the system whose export it reads, e.g. Tebra patient list");
  const [row] = await db.insert(importPresets).values({ practiceId: null, kind: "patients", name: n, mapping: t.mapping, createdBy: sharedBy }).returning();
  return row;
}

export async function deleteSharedTemplate(db: Db, id: string) {
  await db.delete(importPresets).where(and(eq(importPresets.id, id.replace(SHARED, "")), isNull(importPresets.practiceId)));
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
