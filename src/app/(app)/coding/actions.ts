"use server";

import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import { listCodes } from "@/server/encounters";
import { codeNoteWithAi, noteCodingEnabled, type NoteCoding } from "@/lib/ai/code-note";
import { schema } from "@/db";
import { practiceConfig } from "@/server/integrations";

export type NoteCodingState = { ok: boolean; message?: string; result?: NoteCoding };

export async function codeNoteAction(_prev: NoteCodingState, formData: FormData): Promise<NoteCodingState> {
  const s = await requireRole(CAN_WRITE);
  const ai = (await practiceConfig(await getDb(), s.practiceId)).anthropic;
  if (!noteCodingEnabled(ai)) return { ok: false, message: "AI note coding is off. Connect Claude and confirm a BAA in Settings → Integrations." };
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 40) return { ok: false, message: "Paste the full visit note (at least a few sentences)." };
  try {
    const db = await getDb();
    const { cpts, icds } = await listCodes(db);
    const result = await codeNoteWithAi(ai, note, cpts, icds);
    // Record that a note was sent to the model, never the note itself.
    await db.insert(schema.auditLog).values({ practiceId: s.practiceId, userId: s.userId, action: "ai_note_coding", entity: "note", entityId: null });
    if (!result) return { ok: false, message: "The model declined to code this note." };
    return { ok: true, result };
  } catch (e) {
    console.warn("AI note coding failed", e instanceof Error ? e.message : e);
    return { ok: false, message: "Could not reach the AI service. Try again, or code the visit with the tools on this page." };
  }
}
