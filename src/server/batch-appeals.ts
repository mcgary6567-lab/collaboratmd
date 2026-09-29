/**
 * Batch appeals. When a payer denies many claims for the same reason (often a
 * policy or system change on its side), one letter listing every claim gets
 * them reprocessed together. Each denial still gets its own appeal record, so
 * the appeal levels and deadlines keep working per claim; a claim whose
 * medical records are still owed to the payer is left out.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { CARC } from "@/lib/codes/carc";
import { markAppealSent } from "./appeals";
import { openRequestFor } from "./records-requests";

const { denials, claims, payers, patients, patientInsurances, encounters, practices, appealLetters } = schema;

const OPEN = ["open", "in_progress"];

export async function batchAppealGroups(db: Db, practiceId: string, min = 2) {
  const { rows } = await db.execute<{ payer_id: string; payer: string; carc: string; n: string; cents: string }>(sql`
    SELECT c.payer_id, py.name AS payer, d.carc, count(*)::text AS n, sum(d.amount_cents)::text AS cents
    FROM denials d JOIN claims c ON c.id = d.claim_id JOIN payers py ON py.id = c.payer_id
    WHERE d.practice_id = ${practiceId} AND d.status IN ('open', 'in_progress')
    GROUP BY c.payer_id, py.name, d.carc HAVING count(*) >= ${min}
    ORDER BY sum(d.amount_cents) DESC`);
  return rows.map((r) => ({ payerId: r.payer_id, payerName: r.payer, carc: r.carc, count: Number(r.n), cents: Number(r.cents), reason: CARC[r.carc]?.description ?? `CARC ${r.carc}` }));
}

async function groupDenials(db: Db, practiceId: string, payerId: string, carc: string) {
  return db.select({ denial: denials, claim: claims, patient: patients, ins: patientInsurances, dos: encounters.dateOfService })
    .from(denials).innerJoin(claims, eq(claims.id, denials.claimId)).innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(patientInsurances, eq(patientInsurances.id, claims.patientInsuranceId)).innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(eq(denials.practiceId, practiceId), eq(claims.payerId, payerId), eq(denials.carc, carc), inArray(denials.status, OPEN)))
    .orderBy(asc(encounters.dateOfService)).limit(200);
}

export async function batchAppealLetter(db: Db, practiceId: string, payerId: string, carc: string, argument = "") {
  const [payer] = await db.select().from(payers).where(and(eq(payers.id, payerId), eq(payers.practiceId, practiceId))).limit(1);
  if (!payer) throw new Error("Payer not found");
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const all = await groupDenials(db, practiceId, payerId, carc);
  const held: string[] = [];
  const rows: typeof all = [];
  for (const r of all) {
    if (await openRequestFor(db, r.claim.id)) held.push(r.claim.controlNumber);
    else rows.push(r);
  }
  const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const total = rows.reduce((a, r) => a + r.denial.amountCents, 0);
  const reason = CARC[carc]?.description ?? `reason code ${carc}`;
  const list = rows.map((r, i) => `${i + 1}. Claim ${r.claim.controlNumber}${r.claim.payerClaimNumber ? ` (payer claim ${r.claim.payerClaimNumber})` : ""}, ${r.patient.firstName} ${r.patient.lastName}, member ID ${r.ins.memberId}, date of service ${r.dos}, denied ${usd(r.denial.amountCents)}`).join("\n");
  const text = `${practice.name}
${practice.address1}, ${practice.city}, ${practice.state} ${practice.zip}
NPI ${practice.npi} · Tax ID ${practice.taxId}

${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}

${payer.name}
Attn: Appeals / Provider Disputes

Re: Appeal of ${rows.length} claims denied with CARC ${carc} (${reason}), ${usd(total)} in total

We appeal the denial of each claim below. All were denied for the same reason, which we believe was applied in error.

${argument.trim() || "[State why the denials are wrong: the policy, the coverage or the coding that supports payment.]"}

${list}

We ask that each claim be reprocessed and paid. Supporting documentation for any claim is available on request.

Sincerely,

[Name, title]
${practice.name}${practice.phone ? `\n${practice.phone}` : ""}`;
  return { payer, carc, reason, claims: rows, held, total, text };
}

/** Records the letter against each denial in the group and marks each appealed. */
export async function sendBatchAppeal(db: Db, practiceId: string, payerId: string, carc: string, argument: string, userId?: string) {
  const letter = await batchAppealLetter(db, practiceId, payerId, carc, argument);
  if (!letter.claims.length) throw new Error("No open denials in this group to appeal");
  let sent = 0;
  for (const r of letter.claims) {
    const [row] = await db.insert(appealLetters).values({ practiceId, denialId: r.denial.id, body: letter.text, source: "batch", createdBy: userId ?? null }).returning();
    await markAppealSent(db, practiceId, row.id, userId);
    sent++;
  }
  return { sent, held: letter.held };
}
