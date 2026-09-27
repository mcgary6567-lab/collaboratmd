import { getDb } from "@/db";
import { getSession } from "@/lib/auth";
import { recordUsage } from "@/server/usage";

export const dynamic = "force-dynamic";

/** Page views from the app's usage beacon: the path only, reduced to a pattern before it is stored. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 204 });
  const body = await req.text();
  if (body.length > 500) return new Response(null, { status: 204 });
  let path = "";
  try {
    path = String((JSON.parse(body) as { path?: unknown }).path ?? "");
  } catch {
    return new Response(null, { status: 204 });
  }
  await recordUsage(await getDb(), session.practiceId, path).catch(() => false);
  return new Response(null, { status: 204 });
}
