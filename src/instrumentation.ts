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
    const [{ getDb }, { recordError }] = await Promise.all([import("@/db"), import("@/server/errors")]);
    await recordError(await getDb(), { message, digest, path: request.path, method: request.method, routePath: context.routePath, routeType: context.routeType });
  } catch (e) {
    console.error("Could not record a server error", e instanceof Error ? e.message : e);
  }
};
