import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { practiceExport } from "@/server/practice-export";
import { recordRestrictedDisclosure, restrictedPatientIds } from "@/server/restricted";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The whole practice as a zip, streamed. Administrators only, and recorded in the audit log. */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.role !== "admin") return new Response("The full practice export is for administrators", { status: 403 });
  const db = await getDb();
  await db.insert(schema.auditLog).values({ practiceId: session.practiceId, userId: session.userId, action: "export", entity: "practice", entityId: session.practiceId, details: { full: true } });
  await recordRestrictedDisclosure(db, session.practiceId, await restrictedPatientIds(db, session.practiceId), { userId: session.userId }, "the full practice export");
  const it = practiceExport(db, session.practiceId);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        console.error("practice export failed", e instanceof Error ? e.message : e);
        controller.error(e);
      }
    },
    async cancel() { await it.return(undefined); },
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="collaboratmd-export-${date}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
