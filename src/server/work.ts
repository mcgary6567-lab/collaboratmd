/**
 * Assigning and tracking work: tasks, notes, and saved list views.
 *
 * A task points at the record it is about (a claim, denial or patient), so
 * the inbox links straight to it and the record shows its open tasks. Every
 * lookup is scoped to the practice, and an assignee must be someone with
 * access to that practice.
 */
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { roleIn } from "@/lib/auth";

const { tasks, notes, savedViews, users, claims, denials, patients } = schema;

export const ENTITY_TYPES = ["claim", "denial", "patient"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

async function assertEntity(db: Db, practiceId: string, type: string | null | undefined, id: string | null | undefined) {
  if (!type && !id) return;
  if (!type || !id || !(ENTITY_TYPES as readonly string[]).includes(type)) throw new Error("Unknown record");
  const table = type === "claim" ? claims : type === "denial" ? denials : patients;
  const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Record not found");
}

/** People who can be assigned work in a practice: its users and members. */
export async function assignableUsers(db: Db, practiceId: string) {
  const own = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.practiceId, practiceId));
  const members = await db
    .select({ id: users.id, name: users.name, role: schema.practiceMemberships.role })
    .from(schema.practiceMemberships)
    .innerJoin(users, eq(users.id, schema.practiceMemberships.userId))
    .where(eq(schema.practiceMemberships.practiceId, practiceId));
  const byId = new Map([...own, ...members].map((u) => [u.id, u]));
  return [...byId.values()].filter((u) => u.role !== "readonly").sort((a, b) => a.name.localeCompare(b.name));
}

export interface NewTask {
  title: string;
  entityType?: string | null;
  entityId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  priority?: string;
  note?: string;
}

export async function createTask(db: Db, practiceId: string, input: NewTask, userId?: string) {
  const title = input.title.trim();
  if (!title) throw new Error("Give the task a title");
  await assertEntity(db, practiceId, input.entityType, input.entityId);
  if (input.assigneeId && !(await roleIn(db, input.assigneeId, practiceId))) throw new Error("That person does not work in this practice");
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error("Invalid due date");
  const [row] = await db
    .insert(tasks)
    .values({
      practiceId, title: title.slice(0, 200), entityType: input.entityType || null, entityId: input.entityId || null,
      assigneeId: input.assigneeId || null, createdBy: userId ?? null, dueDate: input.dueDate || null,
      priority: input.priority === "high" ? "high" : "normal", note: input.note?.trim().slice(0, 2000) || null,
    })
    .returning();
  return row;
}

/** One task per record, for bulk assignment from a list. */
export async function assignMany(db: Db, practiceId: string, entityType: EntityType, ids: string[], input: Omit<NewTask, "entityType" | "entityId" | "title"> & { titleFor: (label: string) => string }, userId?: string) {
  let created = 0;
  for (const id of ids.slice(0, 200)) {
    let label = id;
    if (entityType === "claim") {
      const [c] = await db.select({ n: claims.controlNumber }).from(claims).where(and(eq(claims.id, id), eq(claims.practiceId, practiceId))).limit(1);
      if (!c) continue;
      label = c.n;
    }
    await createTask(db, practiceId, { ...input, entityType, entityId: id, title: input.titleFor(label) }, userId);
    created++;
  }
  return created;
}

export async function setTaskStatus(db: Db, practiceId: string, id: string, status: "open" | "done") {
  await db.update(tasks).set({ status, completedAt: status === "done" ? new Date() : null }).where(and(eq(tasks.id, id), eq(tasks.practiceId, practiceId)));
}

export async function reassignTask(db: Db, practiceId: string, id: string, assigneeId: string | null) {
  if (assigneeId && !(await roleIn(db, assigneeId, practiceId))) throw new Error("That person does not work in this practice");
  await db.update(tasks).set({ assigneeId }).where(and(eq(tasks.id, id), eq(tasks.practiceId, practiceId)));
}

export type TaskView = "mine" | "created" | "all" | "unassigned" | "done";

export async function listTasks(db: Db, practiceId: string, userId: string, view: TaskView = "mine") {
  const scope =
    view === "mine" ? and(eq(tasks.assigneeId, userId), eq(tasks.status, "open"))
    : view === "created" ? and(eq(tasks.createdBy, userId), eq(tasks.status, "open"))
    : view === "unassigned" ? and(isNull(tasks.assigneeId), eq(tasks.status, "open"))
    : view === "done" ? eq(tasks.status, "done")
    : eq(tasks.status, "open");
  const rows = await db
    .select({ task: tasks, assignee: users.name })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(eq(tasks.practiceId, practiceId), scope))
    .orderBy(view === "done" ? desc(tasks.completedAt) : sql`${tasks.dueDate} ASC NULLS LAST`, desc(tasks.priority), asc(tasks.createdAt))
    .limit(300);
  return rows;
}

/** Open tasks on one record, for its page. */
export async function tasksFor(db: Db, practiceId: string, entityType: EntityType, entityId: string) {
  return db
    .select({ task: tasks, assignee: users.name })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(eq(tasks.practiceId, practiceId), eq(tasks.entityType, entityType), eq(tasks.entityId, entityId), eq(tasks.status, "open")))
    .orderBy(asc(tasks.createdAt));
}

/** For the notification bell: my open tasks, and how many are due or overdue. */
export async function myTaskCounts(db: Db, practiceId: string, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [r] = await db
    .select({
      open: sql<number>`count(*)::int`,
      due: sql<number>`count(*) FILTER (WHERE ${tasks.dueDate} <= ${today})::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.practiceId, practiceId), eq(tasks.assigneeId, userId), eq(tasks.status, "open")));
  return { open: Number(r?.open ?? 0), due: Number(r?.due ?? 0) };
}

export async function dueSoon(db: Db, practiceId: string, userId: string, limit = 6) {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.practiceId, practiceId), eq(tasks.assigneeId, userId), eq(tasks.status, "open"), or(lte(tasks.dueDate, soon), eq(tasks.priority, "high"))))
    .orderBy(sql`${tasks.dueDate} ASC NULLS LAST`)
    .limit(limit);
}

/* ------------------------------ Notes ------------------------------ */

export async function addNote(db: Db, practiceId: string, entityType: EntityType, entityId: string, body: string, userId?: string) {
  const text = body.trim();
  if (!text) throw new Error("Write something first");
  await assertEntity(db, practiceId, entityType, entityId);
  const [row] = await db.insert(notes).values({ practiceId, entityType, entityId, userId: userId ?? null, body: text.slice(0, 4000) }).returning();
  return row;
}

export async function notesFor(db: Db, practiceId: string, entityType: EntityType, entityId: string) {
  return db
    .select({ note: notes, author: users.name })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.userId))
    .where(and(eq(notes.practiceId, practiceId), eq(notes.entityType, entityType), eq(notes.entityId, entityId)))
    .orderBy(desc(notes.createdAt));
}

/* --------------------------- Saved views --------------------------- */

export async function listViews(db: Db, userId: string, practiceId: string, page: string) {
  return db.select().from(savedViews).where(and(eq(savedViews.userId, userId), eq(savedViews.practiceId, practiceId), eq(savedViews.page, page))).orderBy(asc(savedViews.name));
}

export async function saveView(db: Db, userId: string, practiceId: string, page: string, name: string, query: string) {
  if (!name.trim()) throw new Error("Name the view");
  const clean = new URLSearchParams(query);
  clean.delete("page");
  await db.insert(savedViews).values({ userId, practiceId, page, name: name.trim().slice(0, 60), query: clean.toString().slice(0, 1000) });
}

export async function deleteView(db: Db, userId: string, id: string) {
  await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, userId)));
}

// Used by list pages that show a task count per row.
export async function openTaskCounts(db: Db, practiceId: string, entityType: EntityType, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db
    .select({ id: tasks.entityId, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.practiceId, practiceId), eq(tasks.entityType, entityType), inArray(tasks.entityId, ids), eq(tasks.status, "open")))
    .groupBy(tasks.entityId);
  return new Map(rows.map((r) => [r.id!, Number(r.n)]));
}
