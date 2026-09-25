import { api, readBody } from "../_lib/handler";
import { createPatientFromApi, listPatients } from "@/server/public-api";

export const dynamic = "force-dynamic";

export const GET = api("read", ({ db, caller, query }) => listPatients(db, caller.practiceId, query));
export const POST = api("write", async ({ db, caller, req }) => createPatientFromApi(db, caller.practiceId, await readBody(req)), 201);
