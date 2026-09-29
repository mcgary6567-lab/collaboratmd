/**
 * Proof of timely filing. A payer that denies a claim as filed too late (CARC
 * 29) will reverse it when shown the claim reached it in time: the first
 * submission date, and the clearinghouse's acceptance (999) and the payer's
 * acknowledgment (277CA) with their dates and control numbers. Earlier
 * submissions of the same service (a claim rejected and resent, or replaced)
 * count, so the chain is followed back to the first one.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { claims, claimAcknowledgments, encounters, payers, patients, practices } = schema;

export async function timelyFilingProof(db: Db, practiceId: string, claimId: string) {
  const [row] = await db.select({ claim: claims, payer: payers, patient: patients, practice: practices, dos: encounters.dateOfService })
    .from(claims).innerJoin(payers, eq(payers.id, claims.payerId)).innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(practices, eq(practices.id, claims.practiceId)).innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!row) return null;
  // The chain: this claim and every earlier one it corrected or replaced.
  const chain = [row.claim];
  let prev = row.claim.originalClaimId;
  for (let i = 0; prev && i < 10; i++) {
    const [c] = await db.select().from(claims).where(and(eq(claims.id, prev), eq(claims.practiceId, practiceId))).limit(1);
    if (!c) break;
    chain.unshift(c);
    prev = c.originalClaimId;
  }
  const acks = await db.select().from(claimAcknowledgments).where(inArray(claimAcknowledgments.claimId, chain.map((c) => c.id))).orderBy(asc(claimAcknowledgments.receivedAt));
  const submissions = chain.filter((c) => c.submittedAt).map((c) => ({
    controlNumber: c.controlNumber, submittedOn: c.submittedAt!.toISOString().slice(0, 10), frequencyCode: c.frequencyCode, status: c.status,
    acks: acks.filter((a) => a.claimId === c.id).map((a) => ({ kind: a.kind, accepted: a.accepted, code: a.code, on: a.receivedAt.toISOString().slice(0, 10) })),
  }));
  const first = submissions[0] ?? null;
  const days = first ? Math.round((Date.parse(`${first.submittedOn}T12:00:00Z`) - Date.parse(`${row.dos}T12:00:00Z`)) / 86_400_000) : null;
  return { ...row, submissions, firstSubmittedOn: first?.submittedOn ?? null, daysAfterService: days, limitDays: row.payer.timelyFilingDays, inTime: days !== null && days <= row.payer.timelyFilingDays };
}

/** The paragraph for an appeal letter, or null when the record does not show a timely submission. */
export function timelyFilingParagraph(p: NonNullable<Awaited<ReturnType<typeof timelyFilingProof>>>) {
  if (!p.firstSubmittedOn || !p.inTime) return null;
  const lines = p.submissions.map((s) => {
    const acks = s.acks.map((a) => `${a.kind} ${a.accepted ? "accepted" : "rejected"}${a.code ? ` (${a.code})` : ""} on ${a.on}`).join("; ");
    return `- Claim ${s.controlNumber} submitted electronically on ${s.submittedOn}${acks ? `: ${acks}` : ""}`;
  });
  return [
    `Proof of timely filing: the date of service was ${p.dos}, and the claim was first submitted on ${p.firstSubmittedOn}, ${p.daysAfterService} days later, within your ${p.limitDays}-day filing limit. The electronic submission record:`,
    ...lines,
    "The clearinghouse acceptance reports are available on request. We ask that the denial for timely filing be reversed and the claim processed.",
  ].join("\n");
}
