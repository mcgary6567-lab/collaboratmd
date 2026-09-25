import { getDb } from "@/db";
import { practiceForScimToken } from "@/server/sso";
import {
  createScimUser, deleteScimUser, getScimUser, listScimUsers, patchScimUser, replaceScimUser, ScimError, scimError, SERVICE_PROVIDER_CONFIG,
} from "@/server/scim";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/scim+json" } });

/** SCIM 2.0: /api/scim/v2/Users[/id] and /ServiceProviderConfig, authenticated by the practice's SCIM bearer token. */
async function handle(req: Request, ctx: Ctx, method: string) {
  const db = await getDb();
  const cfg = await practiceForScimToken(db, req.headers.get("authorization"));
  if (!cfg) return json(scimError(401, "Missing or invalid SCIM token"), 401);
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const base = `${url.origin}/api/scim/v2`;
  const [resource, id, extra] = path;
  try {
    if (resource === "ServiceProviderConfig" && method === "GET" && !id) return json(SERVICE_PROVIDER_CONFIG);
    if (resource !== "Users" || extra) return json(scimError(404, "Not found"), 404);
    const body = method === "POST" || method === "PUT" || method === "PATCH" ? await req.json().catch(() => { throw new ScimError(400, "The body is not JSON", "invalidSyntax"); }) : null;
    if (!id) {
      if (method === "GET") return json(await listScimUsers(db, cfg, base, { filter: url.searchParams.get("filter"), startIndex: Number(url.searchParams.get("startIndex")) || 1, count: url.searchParams.has("count") ? Number(url.searchParams.get("count")) : undefined }));
      if (method === "POST") return json(await createScimUser(db, cfg, base, body), 201);
    } else {
      if (method === "GET") return json(await getScimUser(db, cfg, base, id));
      if (method === "PUT") return json(await replaceScimUser(db, cfg, base, id, body));
      if (method === "PATCH") return json(await patchScimUser(db, cfg, base, id, body));
      if (method === "DELETE") { await deleteScimUser(db, cfg, id); return new Response(null, { status: 204 }); }
    }
    return json(scimError(405, "Method not allowed"), 405);
  } catch (e) {
    if (e instanceof ScimError) return json(scimError(e.status, e.message, e.scimType), e.status);
    if (e instanceof Error && /invalid input syntax for type uuid/.test(e.message)) return json(scimError(404, "User not found"), 404);
    throw e;
  }
}

export const GET = (req: Request, ctx: Ctx) => handle(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx, "POST");
export const PUT = (req: Request, ctx: Ctx) => handle(req, ctx, "PUT");
export const PATCH = (req: Request, ctx: Ctx) => handle(req, ctx, "PATCH");
export const DELETE = (req: Request, ctx: Ctx) => handle(req, ctx, "DELETE");
