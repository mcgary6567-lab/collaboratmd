import type { Instrumentation } from "next";

/**
 * Records server errors (pages, route handlers, server actions) in the
 * error_events table; see server/errors.ts for what is kept and what is
 * redacted. Reporting must never cause a second failure, so it swallows its
 * own errors.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const message = err instanceof Error ? err.message : String(err);
    // Redirects and not-found are control flow, not failures.
    if (/NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/.test(message)) return;
    const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
    const [{ getDb }, { recordError, redact }, { noteError }] = await Promise.all([import("@/db"), import("@/server/errors"), import("@/server/ops-alerts")]);
    const db = await getDb();
    const header = request.headers["x-request-id"];
    const requestId = Array.isArray(header) ? header[0] : header ?? null;
    // One structured line per error, with the request id, so it can be found in the platform's logs.
    console.error(JSON.stringify({ level: "error", requestId, route: context.routePath, method: request.method, digest: digest ?? null }));
    const fingerprint = await recordError(db, { message, digest, path: request.path, method: request.method, routePath: context.routePath, routeType: context.routeType, requestId });
    // Operators hear about new errors and bursts (see server/ops-alerts.ts).
    await noteError(db, { fingerprint, message: redact(message.split("\n")[0] || "Unknown error"), routePath: context.routePath });
  } catch (e) {
    console.error("Could not record a server error", e instanceof Error ? e.message : e);
  }
};
