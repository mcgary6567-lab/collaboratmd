/**
 * "Report a problem" from inside the app: what the person wrote, the page, and
 * the browser, but no request data. Operators see reports in /ops/feedback and
 * get a short notice that names only the practice and the page, since the text
 * itself may mention a patient.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { alertOperators, type AlertSender } from "./ops-alerts";

const { feedback, practices, users } = schema;

export async function submitFeedback(db: Db, input: { practiceId: string; userId: string; page: string; message: string; userAgent?: string | null; viewport?: string | null; origin?: string }, send?: AlertSender) {
  const message = input.message.trim().slice(0, 4000);
  if (message.length < 5) throw new Error("Describe what happened in a few words");
  const page = input.page.split("?")[0].slice(0, 200);
  const [row] = await db.insert(feedback).values({ practiceId: input.practiceId, userId: input.userId, page, message, userAgent: input.userAgent?.slice(0, 300) ?? null, viewport: input.viewport?.slice(0, 20) ?? null }).returning();
  const [p] = await db.select({ name: practices.name }).from(practices).where(eq(practices.id, input.practiceId)).limit(1);
  await alertOperators("CollaboratMD: new problem report", `From ${p?.name ?? "a practice"} on ${page}.\n${input.origin ?? ""}/ops/feedback`, send).catch(() => 0);
  return row;
}

export async function listFeedback(db: Db, status: "open" | "resolved" = "open") {
  return db.select({ report: feedback, practiceName: practices.name, userName: users.name, userEmail: users.email }).from(feedback)
    .innerJoin(practices, eq(practices.id, feedback.practiceId)).leftJoin(users, eq(users.id, feedback.userId))
    .where(eq(feedback.status, status)).orderBy(desc(feedback.createdAt)).limit(200);
}

export async function resolveFeedback(db: Db, id: string) {
  await db.update(feedback).set({ status: "resolved", resolvedAt: new Date() }).where(and(eq(feedback.id, id), eq(feedback.status, "open")));
}
