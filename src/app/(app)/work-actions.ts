"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { ENTITY_TYPES, addNote, assignMany, createTask, deleteView, reassignTask, saveView, setTaskStatus, type EntityType } from "@/server/work";
import { submitClaim } from "@/server/claims";
import { assertOwned } from "@/server/tenancy";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const entityPath = (type: string | null, id: string | null) => (type && id ? (type === "denial" ? "/denials" : `/${type}s/${id}`) : null);

export async function createTaskAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const entityType = str(formData, "entityType") || null;
    const entityId = str(formData, "entityId") || null;
    await createTask(db, s.practiceId, {
      title: str(formData, "title"), entityType, entityId, assigneeId: str(formData, "assigneeId") || null,
      dueDate: str(formData, "dueDate") || null, priority: str(formData, "priority"), note: str(formData, "note"),
    }, s.userId);
    revalidatePath("/tasks");
    const p = entityPath(entityType, entityId);
    if (p) revalidatePath(p);
    return { ok: true, message: "Task created" };
  } catch (e) {
    return fail(e);
  }
}

export async function setTaskStatusAction(id: string, status: "open" | "done"): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await setTaskStatus(db, s.practiceId, id, status);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function reassignTaskAction(id: string, formData: FormData): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await reassignTask(db, s.practiceId, id, str(formData, "assigneeId") || null);
  revalidatePath("/tasks");
}

export async function addNoteAction(entityType: EntityType, entityId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) throw new Error("Unknown record");
    const db = await getDb();
    await addNote(db, s.practiceId, entityType, entityId, str(formData, "body"), s.userId);
    const p = entityPath(entityType, entityId);
    if (p) revalidatePath(p);
    return { ok: true, message: "Note added" };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------- Claims list bulk --------------------------- */

export async function bulkClaimsAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (!ids.length) return { ok: false, message: "Select at least one claim" };
  const op = str(formData, "op");
  try {
    const db = await getDb();
    if (op === "submit") {
      let accepted = 0, rejected = 0, skipped = 0;
      for (const id of ids.slice(0, 200)) {
        try {
          await assertOwned(db, s.practiceId, "claim", id);
          const { status } = await submitClaim(db, id, s.userId, { role: s.role });
          if (status === "accepted") accepted++;
          else rejected++;
        } catch {
          skipped++;
        }
      }
      revalidatePath("/claims");
      return { ok: true, message: `Submitted ${accepted + rejected}: ${accepted} accepted, ${rejected} rejected${skipped ? `, ${skipped} not ready` : ""}` };
    }
    if (op === "assign") {
      const assigneeId = str(formData, "assigneeId");
      if (!assigneeId) return { ok: false, message: "Choose who to assign them to" };
      const n = await assignMany(db, s.practiceId, "claim", ids, {
        assigneeId, dueDate: str(formData, "dueDate") || null, priority: str(formData, "priority"), note: str(formData, "note"),
        titleFor: (label) => `Work claim ${label}`,
      }, s.userId);
      revalidatePath("/tasks");
      revalidatePath("/claims");
      return { ok: true, message: `Assigned ${n} claim${n === 1 ? "" : "s"}` };
    }
    return { ok: false, message: "Choose an action" };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------ Saved views ------------------------------ */

export async function saveViewAction(page: string, query: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireSession();
  try {
    const db = await getDb();
    await saveView(db, s.userId, s.practiceId, page, str(formData, "name"), query);
    revalidatePath(`/${page}`);
    return { ok: true, message: "View saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteViewAction(page: string, id: string): Promise<void> {
  const s = await requireSession();
  const db = await getDb();
  await deleteView(db, s.userId, id);
  revalidatePath(`/${page}`);
}
