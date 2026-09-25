import { api } from "../../_lib/handler";
import { getClaim } from "@/server/public-api";

export const dynamic = "force-dynamic";

export const GET = api("read", ({ db, caller, params }) => getClaim(db, caller.practiceId, params.id));
