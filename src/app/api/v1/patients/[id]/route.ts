import { api } from "../../_lib/handler";
import { getPatient } from "@/server/public-api";

export const dynamic = "force-dynamic";

export const GET = api("read", ({ db, caller, params }) => getPatient(db, caller.practiceId, params.id));
