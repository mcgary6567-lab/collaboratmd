import { getDb, schema } from "@/db";
import { CAN_WRITE, getSession } from "@/lib/auth";
import { batch837 } from "@/server/clearinghouse-files";

export const dynamic = "force-dynamic";

/** The practice's ready claims (or the ones listed in ?ids=) as one 837 file, for uploading to another clearinghouse. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!(CAN_WRITE as readonly string[]).includes(session.role)) return new Response("Your role cannot download claims", { status: 403 });
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const db = await getDb();
  let file: Awaited<ReturnType<typeof batch837>>;
  try {
    file = await batch837(db, session.practiceId, ids.length ? ids : undefined);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Could not build the file", { status: 400 });
  }
  await db.insert(schema.auditLog).values({ practiceId: session.practiceId, userId: session.userId, action: "export", entity: "claim", entityId: null, details: { kind: "edi_batch", claims: file.included.length } });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(file.edi, { headers: { "Content-Type": "application/edi-x12", "Content-Disposition": `attachment; filename="claims-${stamp}.x12"`, "X-Claims-Included": String(file.included.length) } });
}
