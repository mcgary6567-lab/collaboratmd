/**
 * Applying a saved import template to a file's headers. Pure, so the browser
 * can apply a template the moment a file is chosen (see server/import-templates.ts
 * for saving them).
 */
import type { Mapping } from "./patients";

export type Template = { id: string; name: string; mapping: Record<string, string> };

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** The template's mapping for this file's columns; fields whose header is missing are left unmapped. */
export function mappingFromTemplate(headers: string[], t: Pick<Template, "mapping">): { mapping: Mapping; missing: string[] } {
  const index = new Map(headers.map((h, i) => [norm(h), i]));
  const mapping: Mapping = {};
  const missing: string[] = [];
  for (const [field, header] of Object.entries(t.mapping)) {
    const i = index.get(norm(header));
    if (i === undefined) missing.push(header);
    else (mapping as Record<string, number>)[field] = i;
  }
  return { mapping, missing };
}

/** A template whose every header is in the file, preferring the one that maps the most fields. */
export function matchingTemplate(headers: string[], templates: Template[]) {
  return templates
    .map((t) => ({ t, r: mappingFromTemplate(headers, t) }))
    .filter((x) => x.r.missing.length === 0)
    .sort((a, b) => Object.keys(b.t.mapping).length - Object.keys(a.t.mapping).length)[0] ?? null;
}
