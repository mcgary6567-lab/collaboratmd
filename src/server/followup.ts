/**
 * Following up on unpaid claims.
 *
 * A claim the payer accepted but has not paid is money nobody is watching.
 * After it has waited long enough (30 days by default), the payer is asked
 * its status with a 276 and the 277 answer decides the next step: wait, post
 * the ERA, work it as a denial, send information, or fix and resubmit. Each
 * claim is asked at most once a week, so a batch can run every day.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { build276, nextStep, parse277 } from "@/lib/edi/x276";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";
import { loadClaimBundle } from "./claims";

const { claims, claimStatusChecks, claimEvents, patients, payers } = schema;

export const OPEN_STATUSES = ["submitted", "accepted", "pending", "billed_secondary"] as const;

export async function checkClaimStatus(db: Db, claimId: string) {
  const b = await loadClaimBundle(db, claimId);
  if (!b) throw new Error("Claim not found");
  const now = new Date();
  const edi = build276({
    senderId: "COLLABORATMD", receiverId: b.payer.payerId, now, control: String(now.getTime() % 1_000_000_000),
    payer: { name: b.payer.name, payerId: b.payer.payerId },
    billingProvider: { name: b.practice.name, npi: b.practice.npi },
    subscriber: { lastName: b.patient.lastName, firstName: b.patient.firstName, memberId: b.insurance.memberId, dob: b.patient.dob, sex: b.patient.sex },
    claim: { controlNumber: b.claim.controlNumber, payerClaimNumber: b.claim.payerClaimNumber, chargeCents: b.claim.totalCents, serviceFrom: b.encounter.dateOfService, serviceTo: b.encounter.dateOfService },
  });
  let raw: string | null = null;
  try {
    raw = await getClearinghouse().checkClaimStatus(edi);
  } catch (e) {
    const [row] = await db.insert(claimStatusChecks).values({ practiceId: b.claim.practiceId, claimId, request276: edi, error: e instanceof Error ? e.message : "No answer", nextAction: "call_payer" }).returning();
    return row;
  }
  const st = parse277(raw).find((x) => x.controlNumber === b.claim.controlNumber) ?? parse277(raw)[0];
  const step = st ? nextStep(st) : { action: "call_payer" as const, label: "The payer's answer did not mention this claim" };
  const [row] = await db
    .insert(claimStatusChecks)
    .values({
      practiceId: b.claim.practiceId, claimId, category: st?.category ?? null, statusCode: st?.statusCode ?? null, entity: st?.entity || null,
      message: st?.message ?? null, paidCents: st?.paidCents ?? null, nextAction: step.action, request276: edi, response277: raw,
    })
    .returning();
  if (st?.payerClaimNumber && !b.claim.payerClaimNumber) {
    await db.update(claims).set({ payerClaimNumber: st.payerClaimNumber }).where(eq(claims.id, claimId));
  }
  await db.insert(claimEvents).values({ claimId, status: b.claim.status, source: "277", message: `Status check: ${st?.message ?? "no answer"}. ${step.label}` });
  return row;
}

export interface FollowUpRow {
  claim: typeof claims.$inferSelect;
  patientName: string;
  payerName: string;
  ageDays: number;
  last: typeof claimStatusChecks.$inferSelect | null;
}

/** Unpaid claims older than `minAgeDays`, oldest first, with the payer's last answer. */
export async function followUpList(db: Db, practiceId: string, minAgeDays = 30, limit = 200): Promise<FollowUpRow[]> {
  const cutoff = new Date(Date.now() - minAgeDays * 86_400_000);
  const rows = await db
    .select({ claim: claims, first: patients.firstName, last: patients.lastName, payerName: payers.name })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(and(eq(claims.practiceId, practiceId), inArray(claims.status, [...OPEN_STATUSES]), lt(claims.submittedAt, cutoff)))
    .orderBy(claims.submittedAt)
    .limit(limit);
  const checks = rows.length
    ? await db
        .selectDistinctOn([claimStatusChecks.claimId])
        .from(claimStatusChecks)
        .where(inArray(claimStatusChecks.claimId, rows.map((r) => r.claim.id)))
        .orderBy(claimStatusChecks.claimId, desc(claimStatusChecks.checkedAt))
    : [];
  const byClaim = new Map(checks.map((c) => [c.claimId, c]));
  return rows.map((r) => ({
    claim: r.claim,
    patientName: `${r.last}, ${r.first}`,
    payerName: r.payerName,
    ageDays: Math.floor((Date.now() - (r.claim.submittedAt?.getTime() ?? Date.now())) / 86_400_000),
    last: byClaim.get(r.claim.id) ?? null,
  }));
}

/**
 * Asks about every unpaid claim that is due: old enough, and not asked in the
 * last `recheckDays`. Safe to run daily.
 */
export async function runFollowUp(db: Db, practiceId: string, opts: { minAgeDays?: number; recheckDays?: number; limit?: number } = {}) {
  const recheckBefore = Date.now() - (opts.recheckDays ?? 7) * 86_400_000;
  const due = (await followUpList(db, practiceId, opts.minAgeDays ?? 30, 500)).filter((r) => !r.last || r.last.checkedAt.getTime() < recheckBefore).slice(0, opts.limit ?? 50);
  const tally: Record<string, number> = {};
  for (const r of due) {
    const c = await checkClaimStatus(db, r.claim.id);
    tally[c.nextAction ?? "call_payer"] = (tally[c.nextAction ?? "call_payer"] ?? 0) + 1;
  }
  return { checked: due.length, tally };
}

/** Counts for the dashboard: unpaid claims past the follow-up age, and ones needing action. */
export async function followUpSummary(db: Db, practiceId: string, minAgeDays = 30) {
  const cutoff = new Date(Date.now() - minAgeDays * 86_400_000);
  const [{ n, cents }] = await db
    .select({ n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${claims.totalCents}), 0)::bigint` })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), inArray(claims.status, [...OPEN_STATUSES]), lt(claims.submittedAt, cutoff)));
  return { count: Number(n), cents: Number(cents) };
}
