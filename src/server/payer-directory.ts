/**
 * Payers from Stedi's payer directory (GET /payers/search), so a practice picks
 * the payer instead of typing a payer ID from memory; a wrong payer ID is one
 * of the commonest reasons a claim bounces. Each result says which electronic
 * transactions the payer supports and which need enrollment first, and adding
 * a payer from here fills in the enrollment tracker to match.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { practiceConfig } from "./integrations";
import { savePayer } from "./admin";

const { payers, transactionEnrollments } = schema;
const BASE = "https://payers.us.stedi.com/2024-04-01";

type Support = "SUPPORTED" | "NOT_SUPPORTED" | "ENROLLMENT_REQUIRED";
export type DirectoryPayer = {
  name: string; payerId: string; stediId: string; aliases: string[];
  claims: Support | null; eligibility: Support | null; era: Support | null; eft: Support | null; claimStatus: Support | null;
};
type Http = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Raw = { displayName?: string; primaryPayerId?: string; stediId?: string; aliases?: string[]; transactionSupport?: Record<string, Support> };

/** Directory transaction names to the enrollment tracker's. */
const TXN_MAP = { claims: "professionalClaimSubmission", eligibility: "eligibilityCheck", era: "claimPayment", eft: "electronicFundsTransfer", claim_status: "claimStatus" } as const;

export async function searchPayerDirectory(db: Db, practiceId: string, query: string, http: Http = fetch as unknown as Http): Promise<DirectoryPayer[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = (await practiceConfig(db, practiceId)).stedi?.apiKey;
  if (!key) throw new Error("Connect Stedi under Integrations to search its payer directory");
  const res = await http(`${BASE}/payers/search?query=${encodeURIComponent(q.slice(0, 80))}&pageSize=15`, { method: "GET", headers: { Authorization: key, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Stedi's payer directory answered ${res.status}`);
  const body = (await res.json()) as { items?: { payer?: Raw }[] };
  return (body.items ?? []).map((i) => i.payer).filter((p): p is Raw => !!p?.primaryPayerId && !!p.displayName).map((p) => ({
    name: p.displayName!, payerId: p.primaryPayerId!, stediId: p.stediId ?? "", aliases: (p.aliases ?? []).slice(0, 6),
    claims: p.transactionSupport?.professionalClaimSubmission ?? null, eligibility: p.transactionSupport?.eligibilityCheck ?? null,
    era: p.transactionSupport?.claimPayment ?? null, eft: p.transactionSupport?.electronicFundsTransfer ?? null, claimStatus: p.transactionSupport?.claimStatus ?? null,
  }));
}

/** Adds the payer (or finds it by payer ID) and marks which transactions need enrollment. */
export async function addDirectoryPayer(db: Db, practiceId: string, p: { name: string; payerId: string; type: string; support: Partial<Record<keyof typeof TXN_MAP, Support | null>> }, userId?: string) {
  const [existing] = await db.select().from(payers).where(and(eq(payers.practiceId, practiceId), eq(payers.payerId, p.payerId.toUpperCase()))).limit(1);
  const id = existing?.id ?? (await savePayer(db, practiceId, null, { name: p.name, payerId: p.payerId, type: p.type, timelyFilingDays: p.type === "medicare" ? 365 : 90, appealDays: p.type === "medicare" ? 120 : 60 }, userId));
  for (const [txn, support] of Object.entries(p.support) as [keyof typeof TXN_MAP, Support | null][]) {
    if (!support || support === "NOT_SUPPORTED") continue;
    const status = support === "ENROLLMENT_REQUIRED" ? "not_started" : "not_required";
    await db.insert(transactionEnrollments).values({ practiceId, payerId: id, transaction: txn, status }).onConflictDoNothing();
  }
  return { id, existed: !!existing };
}

export const SUPPORT_LABEL: Record<Support, string> = { SUPPORTED: "yes", NOT_SUPPORTED: "no", ENROLLMENT_REQUIRED: "after enrollment" };
