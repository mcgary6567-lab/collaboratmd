/**
 * A patient who picked a language on the check-in or portal pages, and then
 * proved who they are, gets statements and messages in it from then on.
 */
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

export async function rememberLanguage(db: Db, patientId: string, lang: "en" | "es" | null) {
  if (!lang) return false;
  const r = await db.update(schema.patients).set({ preferredLanguage: lang }).where(and(eq(schema.patients.id, patientId), ne(schema.patients.preferredLanguage, lang))).returning();
  return r.length > 0;
}
