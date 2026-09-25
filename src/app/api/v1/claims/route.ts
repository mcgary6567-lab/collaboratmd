import { api } from "../_lib/handler";
import { listClaims } from "@/server/public-api";

export const dynamic = "force-dynamic";

export const GET = api("read", ({ db, caller, query }) => listClaims(db, caller.practiceId, query));
