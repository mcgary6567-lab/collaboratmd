import { getDb, type Db } from "@/db";
import { authenticateApiKey, rateLimit, type ApiCaller, type ApiScope } from "@/server/api-keys";
import { ApiError } from "@/server/public-api";

type Ctx = { db: Db; caller: ApiCaller; req: Request; query: URLSearchParams; params: Record<string, string> };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const problem = (status: number, code: string, message: string, headers?: Record<string, string>) => json(status, { error: { code, message } }, headers);

/**
 * Wraps a /api/v1 route: bearer-key authentication, scope check, a per-key
 * rate limit, JSON errors in one shape, and no caching.
 */
export function api(scope: ApiScope, fn: (ctx: Ctx) => Promise<unknown>, status = 200) {
  return async (req: Request, context: { params: Promise<Record<string, string>> }) => {
    const db = await getDb();
    const caller = await authenticateApiKey(db, req.headers.get("authorization"));
    if (!caller) return problem(401, "unauthorized", "Send a valid API key as: Authorization: Bearer cmd_live_…");
    if (scope === "write" && caller.scope !== "write") return problem(403, "forbidden", "This API key is read-only");
    const limit = rateLimit(caller.keyId);
    const rl = { "X-RateLimit-Remaining": String(limit.remaining), "X-RateLimit-Reset": String(limit.resetSec) };
    if (!limit.ok) return problem(429, "rate_limited", "Too many requests; slow down and retry after the reset", { ...rl, "Retry-After": String(limit.resetSec) });
    try {
      const params = context?.params ? await context.params : {};
      const body = await fn({ db, caller, req, query: new URL(req.url).searchParams, params });
      return json(status, body, rl);
    } catch (e) {
      if (e instanceof ApiError) return problem(e.status, e.code, e.message, rl);
      if (e instanceof SyntaxError) return problem(400, "invalid_json", "The request body is not valid JSON", rl);
      console.error("[collaboratmd] api error", e);
      return problem(500, "server_error", "Something went wrong on our side", rl);
    }
  };
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 200_000) throw new ApiError(413, "too_large", "Request body is over 200 KB");
  const body = JSON.parse(text || "{}");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "invalid_json", "Send a JSON object");
  return body as Record<string, unknown>;
}
