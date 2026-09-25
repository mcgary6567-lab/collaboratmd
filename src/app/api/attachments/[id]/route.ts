import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { getAttachmentFile } from "@/server/attachments";

export const dynamic = "force-dynamic";

/** Opens a claim attachment. Scoped to the practice and recorded in the audit log. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const db = await getDb();
  const file = await getAttachmentFile(db, session.practiceId, id).catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  await db.insert(schema.auditLog).values({ practiceId: session.practiceId, userId: session.userId, action: "attachment_viewed", entity: "claim", entityId: file.claimId });
  return new Response(Buffer.from(file.dataBase64, "base64"), {
    headers: { "Content-Type": file.contentType, "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
