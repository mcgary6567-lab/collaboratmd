import { api } from "../_lib/handler";
import { listDenials } from "@/server/public-api";

export const dynamic = "force-dynamic";

export const GET = api("read", ({ db, caller, query }) => listDenials(db, caller.practiceId, query));
