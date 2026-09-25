import { api } from "../_lib/handler";
import { listPayments } from "@/server/public-api";

export const dynamic = "force-dynamic";

export const GET = api("read", ({ db, caller, query }) => listPayments(db, caller.practiceId, query));
