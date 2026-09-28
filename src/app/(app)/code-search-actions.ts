"use server";

import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { searchDiagnoses, searchProcedures, type CodeOption } from "@/server/code-catalog";

/** Codes matching what someone is typing, for the pickers on charge entry, claim edits and coding help. */
export async function searchCodesAction(kind: "dx" | "px", q: string): Promise<CodeOption[]> {
  const s = await requireSession();
  const term = String(q ?? "").slice(0, 60);
  const db = await getDb();
  return kind === "dx" ? searchDiagnoses(db, term) : searchProcedures(db, s.practiceId, term);
}
