import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { openExport } from "@/server/export-jobs";
import { recordRestrictedDisclosure, restrictedPatientIds } from "@/server/restricted";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A prepared export, streamed from private storage. Administrators only; each download is audited. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.role !== "admin") return new Response("Exports are for administrators", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const part = Math.max(0, Number(new URL(req.url).searchParams.get("part") ?? 0) || 0);
  const file = await openExport(db, session.practiceId, id, new Date(), part);
  if (!file) return new Response("This export has expired or is not ready", { status: 404 });
  await db.insert(schema.auditLog).values({ practiceId: session.practiceId, userId: session.userId, action: "export_downloaded", entity: "practice", entityId: session.practiceId, details: { job: id, part } });
  // Every restricted patient is in a full export: note it on their access logs (once, with the first part).
  if (part === 0) await recordRestrictedDisclosure(db, session.practiceId, await restrictedPatientIds(db, session.practiceId), { userId: session.userId }, "the full practice export");
  return new Response(file.stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="collaboratmd-export-${file.job.createdAt.toISOString().slice(0, 10)}${file.parts > 1 ? `-part${part + 1}of${file.parts}` : ""}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
