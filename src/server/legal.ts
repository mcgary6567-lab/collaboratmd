/**
 * Records who accepted which version of the terms and privacy policy, and
 * when. Self-serve practices accept at signup; when a document changes, their
 * administrators are asked again before continuing. Practices on a separate
 * signed agreement are not asked, because that agreement governs them.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { LEGAL_VERSIONS, type LegalDocument } from "@/content/legal";

const { legalAcceptances, auditLog } = schema;
const DOCS = Object.keys(LEGAL_VERSIONS) as LegalDocument[];

export const ipHash = (ip: string | null | undefined) => (ip ? createHash("sha256").update(ip).digest("hex").slice(0, 32) : null);

export async function recordAcceptance(db: Db, input: { practiceId: string; userId: string; ip?: string | null; at?: Date; documents?: LegalDocument[] }) {
  const docs = input.documents ?? DOCS;
  await db.insert(legalAcceptances).values(docs.map((d) => ({ practiceId: input.practiceId, userId: input.userId, document: d, version: LEGAL_VERSIONS[d], acceptedAt: input.at ?? new Date(), ipHash: ipHash(input.ip) })));
  await db.insert(auditLog).values({ practiceId: input.practiceId, userId: input.userId, action: "terms_accepted", entity: "user", entityId: input.userId, details: Object.fromEntries(docs.map((d) => [d, LEGAL_VERSIONS[d]])) });
}

/** Documents this user has not accepted in their current version, for this practice. */
export async function pendingDocuments(db: Db, practiceId: string, userId: string): Promise<LegalDocument[]> {
  const rows = await db.select({ document: legalAcceptances.document, version: legalAcceptances.version }).from(legalAcceptances)
    .where(and(eq(legalAcceptances.practiceId, practiceId), eq(legalAcceptances.userId, userId), inArray(legalAcceptances.document, DOCS)));
  return DOCS.filter((d) => !rows.some((r) => r.document === d && r.version === LEGAL_VERSIONS[d]));
}
