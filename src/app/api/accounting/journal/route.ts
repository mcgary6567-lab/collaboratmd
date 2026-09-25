import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { can, getSession } from "@/lib/auth";
import { accountNames, journalCsv, journalLines, periodTotals } from "@/server/accounting";

export const dynamic = "force-dynamic";

/** The month's journal entry as CSV. Recorded in the audit log, like every export. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!can(session, "export") || !["admin", "biller"].includes(session.role)) return new Response("The journal is for billers and administrators", { status: 403 });
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "";
  const format = url.searchParams.get("format") === "signed" ? "signed" : "standard";
  const db = await getDb();
  let csv: string;
  try {
    const [practice] = await db.select({ name: schema.practices.name }).from(schema.practices).where(eq(schema.practices.id, session.practiceId));
    csv = journalCsv(journalLines(await periodTotals(db, session.practiceId, period), await accountNames(db, session.practiceId)), period, practice.name, format);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Bad request", { status: 400 });
  }
  await db.insert(schema.auditLog).values({ practiceId: session.practiceId, userId: session.userId, action: "export", entity: "journal", details: { period, format } });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal-${period}${format === "signed" ? "-signed" : ""}.csv"` } });
}
