import { getDb, schema } from "@/db";
import { CAN_WRITE, getSession } from "@/lib/auth";
import { previewClaimEdi } from "@/server/claims";

export const dynamic = "force-dynamic";

/** The claim's 837 file as it would be sent now, without sending it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!(CAN_WRITE as readonly string[]).includes(session.role)) return new Response("Your role cannot download claims", { status: 403 });
  const { id } = await params;
  const db = await getDb();
  let file: Awaited<ReturnType<typeof previewClaimEdi>>;
  try {
    file = await previewClaimEdi(db, id);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Could not build the claim", { status: 400 });
  }
  if (file.practiceId !== session.practiceId) return new Response("Not found", { status: 404 });
  await db.insert(schema.auditLog).values({ practiceId: session.practiceId, userId: session.userId, action: "export", entity: "claim", entityId: id, details: { kind: "edi" } });
  return new Response(file.edi, { headers: { "Content-Type": "application/edi-x12", "Content-Disposition": `attachment; filename="${file.filename}"` } });
}
