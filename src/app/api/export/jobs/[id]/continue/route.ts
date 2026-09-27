import { after } from "next/server";
import { getDb } from "@/db";
import { runExport, validContinuation } from "@/server/export-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The next run of a large export, started by the previous run with a token only this server can make. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !validContinuation(id, token)) return new Response("Forbidden", { status: 403 });
  after(async () => {
    await runExport(await getDb(), id).catch((e) => console.error("export continuation failed", e instanceof Error ? e.message : e));
  });
  return new Response(null, { status: 202 });
}
