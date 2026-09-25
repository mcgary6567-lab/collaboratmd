import { api } from "./_lib/handler";

export const dynamic = "force-dynamic";

/** Who am I: confirms a key works and which practice it belongs to. */
export const GET = api("read", async ({ caller }) => ({
  practice: { id: caller.practiceId, name: caller.practiceName },
  scope: caller.scope,
  api_version: "2026-09-25",
}));
