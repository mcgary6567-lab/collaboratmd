import "server-only";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { recordView, type ViewVia } from "@/server/access-log";

/**
 * Records that the signed-in person opened a patient's record, for the access
 * log (server/access-log.ts). Link prefetches are not views. Recording must
 * never stop the page from showing, so a failure is only logged.
 */
export async function logPatientView(s: { practiceId: string; userId: string }, patientId: string, via: ViewVia, id?: string) {
  if ((await headers()).get("next-router-prefetch")) return;
  await recordView(await getDb(), s, patientId, via, id).catch((e) => console.error("[collaboratmd] access log write failed", e instanceof Error ? e.message : e));
}
