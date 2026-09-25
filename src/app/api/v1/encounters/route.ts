import { api, readBody } from "../_lib/handler";
import { createEncounterFromApi } from "@/server/public-api";

export const dynamic = "force-dynamic";

/** Charges from an outside system: creates the visit and a scrubbed claim. */
export const POST = api("write", async ({ db, caller, req }) => createEncounterFromApi(db, caller.practiceId, await readBody(req)), 201);
