import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { scrubClaim, hasBlockingErrors, type ScrubClaim, type ScrubFinding } from "@/lib/scrub/rules";
import { evaluatePayerEdits, type EditResult } from "@/lib/scrub/payer-edits";
import { buildEdi837P } from "@/lib/edi/x837p";
import { buildEdi837I } from "@/lib/edi/x837i";
import { buildEdi837D } from "@/lib/edi/x837d";
import { scrubDental } from "@/lib/scrub/dental";
import { attachmentRefs, markAttachmentsSent } from "./attachments";
import { scrubInstitutional } from "@/lib/scrub/institutional";
import { parseEdi835 } from "@/lib/edi/x835";
import { parse999, describeSyntaxError } from "@/lib/edi/x999";
import { parse277CA } from "@/lib/edi/x277ca";
import { getClearinghouse, type RemitRequest, type SubmissionResult } from "@/lib/clearinghouse/gateway";
import { explainDenial } from "@/lib/ai/explain";
import { carcCategory } from "@/lib/codes/carc";
import { checkClaimUnderpayment } from "./fees";
import { authsForPatient, consumeAuthorization, rulesForPayer } from "./payer-edits";
import { enrollmentFinding, enrollmentFor } from "./enrollment";
import { practiceConfig } from "./integrations";
import { emit } from "./webhooks";
import { codeSetFindings } from "./code-sets";

const { claims, claimEvents, claimAcknowledgments, encounters, charges, patients, patientInsurances, payers, providers, practices, remittances, ledgerEntries, denials } = schema;

export interface ClaimBundle {
  claim: typeof claims.$inferSelect;
  encounter: typeof encounters.$inferSelect;
  lines: (typeof charges.$inferSelect)[];
  patient: typeof patients.$inferSelect;
  insurance: typeof patientInsurances.$inferSelect;
  payer: typeof payers.$inferSelect;
  provider: typeof providers.$inferSelect;
  practice: typeof practices.$inferSelect;
}

export async function loadClaimBundle(db: Db, claimId: string): Promise<ClaimBundle | null> {
  const [row] = await db
    .select({ claim: claims, encounter: encounters, patient: patients, insurance: patientInsurances, payer: payers, provider: providers, practice: practices })
    .from(claims)
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(patientInsurances, eq(patientInsurances.id, claims.patientInsuranceId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(providers, eq(providers.id, encounters.providerId))
    .innerJoin(practices, eq(practices.id, claims.practiceId))
    .where(eq(claims.id, claimId))
    .limit(1);
  if (!row) return null;
  const lines = await db.select().from(charges).where(eq(charges.encounterId, row.encounter.id)).orderBy(asc(charges.lineNumber));
  return { ...row, lines };
}

function toScrubInput(b: ClaimBundle, today?: Date): ScrubClaim {
  return {
    claim: { frequencyCode: b.claim.frequencyCode, originalPayerClaimNumber: b.claim.originalPayerClaimNumber },
    patient: { firstName: b.patient.firstName, lastName: b.patient.lastName, dob: b.patient.dob, sex: b.patient.sex, address1: b.patient.address1, zip: b.patient.zip },
    insurance: { memberId: b.insurance.memberId, payerId: b.payer.payerId, relationship: b.insurance.relationship },
    provider: { npi: b.provider.npi, taxonomy: b.provider.taxonomy },
    practice: { npi: b.practice.npi, taxId: b.practice.taxId },
    encounter: { dateOfService: b.encounter.dateOfService, placeOfService: b.encounter.placeOfService, diagnoses: b.encounter.diagnoses },
    lines: b.lines.map((l) => ({ lineNumber: l.lineNumber, cpt: l.cpt, modifiers: l.modifiers, units: l.units, chargeCents: l.chargeCents, dxPointers: l.dxPointers })),
    payer: { timelyFilingDays: b.payer.timelyFilingDays },
    today,
  };
}

/**
 * Runs the general scrubber and this payer's own edits together. A void
 * (frequency 8) only cancels an earlier claim, so payer edits and
 * authorization checks do not apply to it.
 */
export async function scrubBundle(db: Db, b: ClaimBundle): Promise<{ findings: ScrubFinding[]; edits: EditResult }> {
  if (b.claim.claimType === "dental") {
    const findings = scrubDental({
      billingNpi: b.practice.npi, renderingNpi: b.provider.npi, memberId: b.insurance.memberId, payerId: b.payer.payerId, dateOfService: b.encounter.dateOfService,
      lines: b.lines.map((l) => ({ lineNumber: l.lineNumber, cdt: l.cpt, tooth: l.tooth, surfaces: l.surfaces, oralCavity: l.oralCavity, units: l.units, chargeCents: l.chargeCents })),
    });
    const enrollment = await enrollmentFor(db, b.provider.id, b.payer.id);
    const enrolled = enrollmentFinding(enrollment, b.encounter.dateOfService, `Dr. ${b.provider.firstName} ${b.provider.lastName}`, b.payer.name);
    return { findings: [...findings, ...(enrolled ? [enrolled] : [])], edits: { findings: [], authorization: null, authUnits: 0 } };
  }
  if (b.claim.claimType === "institutional") {
    const findings = scrubInstitutional({
      institutional: b.claim.institutional ?? null, billingNpi: b.practice.npi, attendingNpi: b.provider.npi,
      memberId: b.insurance.memberId, payerId: b.payer.payerId, diagnoses: b.encounter.diagnoses,
      lines: b.lines.map((l) => ({ lineNumber: l.lineNumber, revenueCode: l.revenueCode, hcpcs: l.cpt, units: l.units, chargeCents: l.chargeCents })),
    });
    const enrollment = await enrollmentFor(db, b.provider.id, b.payer.id);
    const enrolled = enrollmentFinding(enrollment, b.encounter.dateOfService, `Dr. ${b.provider.firstName} ${b.provider.lastName}`, b.payer.name);
    return { findings: [...findings, ...(enrolled ? [enrolled] : [])], edits: { findings: [], authorization: null, authUnits: 0 } };
  }
  const general = scrubClaim(toScrubInput(b));
  if (b.claim.frequencyCode === "8") return { findings: general, edits: { findings: [], authorization: null, authUnits: 0 } };
  const [rules, auths, enrollment] = await Promise.all([
    rulesForPayer(db, b.claim.practiceId, b.payer.id),
    authsForPatient(db, b.claim.practiceId, b.patient.id, b.payer.id),
    enrollmentFor(db, b.provider.id, b.payer.id),
  ]);
  const edits = evaluatePayerEdits(
    {
      dateOfService: b.encounter.dateOfService,
      diagnoses: b.encounter.diagnoses,
      lines: b.lines.map((l) => ({ lineNumber: l.lineNumber, cpt: l.cpt, modifiers: l.modifiers, units: l.units })),
    },
    rules,
    auths,
  );
  const enrolled = enrollmentFinding(enrollment, b.encounter.dateOfService, `Dr. ${b.provider.firstName} ${b.provider.lastName}`, b.payer.name);
  const national = await codeSetFindings(db, {
    payerType: b.payer.type, dateOfService: b.encounter.dateOfService, diagnoses: b.encounter.diagnoses,
    lines: b.lines.map((l) => ({ lineNumber: l.lineNumber, cpt: l.cpt, modifiers: l.modifiers, units: l.units })),
  });
  return { findings: [...general, ...edits.findings, ...national, ...(enrolled ? [enrolled] : [])], edits };
}

async function nextControlNumber(db: Db, practiceId: string): Promise<string> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(claims).where(eq(claims.practiceId, practiceId));
  return "CMD" + String(Number(n) + 1).padStart(6, "0");
}

/** Builds a claim from an encounter, runs the scrubber, and posts the charge ledger entries. */
export async function createClaimForEncounter(db: Db, encounterId: string, userId?: string) {
  const [enc] = await db.select().from(encounters).where(eq(encounters.id, encounterId)).limit(1);
  if (!enc) throw new Error("Encounter not found");
  const [ins] = await db
    .select()
    .from(patientInsurances)
    .where(and(eq(patientInsurances.patientId, enc.patientId), eq(patientInsurances.active, true)))
    .orderBy(asc(patientInsurances.rank))
    .limit(1);
  if (!ins) throw new Error("Patient has no active insurance");
  const lines = await db.select().from(charges).where(eq(charges.encounterId, encounterId));
  const total = lines.reduce((a, l) => a + l.chargeCents * l.units, 0);
  const [payer] = await db.select().from(payers).where(eq(payers.id, ins.payerId)).limit(1);
  const deadline = new Date(enc.dateOfService);
  deadline.setDate(deadline.getDate() + (payer?.timelyFilingDays ?? 90));

  const [claim] = await db
    .insert(claims)
    .values({
      practiceId: enc.practiceId,
      encounterId,
      patientId: enc.patientId,
      payerId: ins.payerId,
      patientInsuranceId: ins.id,
      controlNumber: await nextControlNumber(db, enc.practiceId),
      totalCents: total,
      status: "draft",
      timelyFilingDeadline: deadline.toISOString().slice(0, 10),
    })
    .returning();

  for (const l of lines) {
    await db.insert(ledgerEntries).values({ practiceId: enc.practiceId, patientId: enc.patientId, claimId: claim.id, chargeId: l.id, type: "charge", amountCents: l.chargeCents * l.units, postedBy: userId ?? null, note: `${l.cpt} x${l.units}` });
  }
  await db.update(encounters).set({ status: "billed" }).where(eq(encounters.id, encounterId));
  await db.insert(claimEvents).values({ claimId: claim.id, status: "draft", source: "system", message: "Claim created from encounter" });
  const scrubbed = await rescrubClaim(db, claim.id);
  await emit(db, enc.practiceId, "claim.created", { claim_id: claim.id, control_number: claim.controlNumber, patient_id: enc.patientId, status: scrubbed.status, total_cents: claim.totalCents });
  return scrubbed;
}

export async function rescrubClaim(db: Db, claimId: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  const { findings, edits } = await scrubBundle(db, bundle);
  const status = hasBlockingErrors(findings) ? "scrub_errors" : "ready";
  const [updated] = await db
    .update(claims)
    .set({ scrubResults: findings, status, authorizationNumber: edits.authorization?.authNumber ?? null, updatedAt: new Date() })
    .where(eq(claims.id, claimId))
    .returning();
  await db.insert(claimEvents).values({ claimId, status, source: "system", message: `Scrubbed: ${findings.filter((f) => f.severity === "error").length} errors, ${findings.filter((f) => f.severity === "warning").length} warnings` });
  return updated;
}

/** The 837 (P, I or D, by claim type) for a claim, without sending it. */
export function buildClaimEdi(
  bundle: ClaimBundle,
  o: { now: Date; authorizationNumber: string | null; attachments: Awaited<ReturnType<typeof attachmentRefs>>; otherPayer?: Awaited<ReturnType<typeof primaryAdjudication>> },
): string {
  const { now, authorizationNumber, attachments, otherPayer } = o;
  const dental = bundle.claim.claimType === "dental";
  const institutional = bundle.claim.claimType === "institutional";
  return dental ? buildEdi837D({
    controlNumber: bundle.claim.controlNumber,
    interchangeControl: String(Math.floor(now.getTime() / 1000) % 1_000_000_000),
    senderId: "COLLABORATMD",
    receiverId: bundle.payer.payerId,
    now,
    billingProvider: { name: bundle.practice.name, npi: bundle.practice.npi, taxId: bundle.practice.taxId, address1: bundle.practice.address1, city: bundle.practice.city, state: bundle.practice.state, zip: bundle.practice.zip, taxonomy: bundle.provider.taxonomy },
    rendering: { lastName: bundle.provider.lastName, firstName: bundle.provider.firstName, npi: bundle.provider.npi, taxonomy: bundle.provider.taxonomy },
    payer: { name: bundle.payer.name, payerId: bundle.payer.payerId, type: bundle.payer.type },
    subscriber: { lastName: bundle.patient.lastName, firstName: bundle.patient.firstName, memberId: bundle.insurance.memberId, groupNumber: bundle.insurance.groupNumber, dob: bundle.patient.dob, sex: bundle.patient.sex, address1: bundle.patient.address1, city: bundle.patient.city, state: bundle.patient.state, zip: bundle.patient.zip, relationship: bundle.insurance.relationship },
    claim: {
      totalCents: bundle.claim.totalCents, placeOfService: bundle.encounter.placeOfService, frequencyCode: bundle.claim.frequencyCode,
      originalPayerClaimNumber: bundle.claim.originalPayerClaimNumber, authorizationNumber, diagnoses: bundle.encounter.diagnoses, attachments,
    },
    lines: bundle.lines.map((l) => ({ cdt: l.cpt, chargeCents: l.chargeCents * l.units, units: l.units, dateOfService: bundle.encounter.dateOfService, tooth: l.tooth, surfaces: l.surfaces, oralCavity: l.oralCavity })),
  }) : institutional ? buildEdi837I({
    controlNumber: bundle.claim.controlNumber,
    interchangeControl: String(Math.floor(now.getTime() / 1000) % 1_000_000_000),
    senderId: "COLLABORATMD",
    receiverId: bundle.payer.payerId,
    now,
    billingProvider: { name: bundle.practice.name, npi: bundle.practice.npi, taxId: bundle.practice.taxId, address1: bundle.practice.address1, city: bundle.practice.city, state: bundle.practice.state, zip: bundle.practice.zip },
    attending: { lastName: bundle.provider.lastName, firstName: bundle.provider.firstName, npi: bundle.provider.npi, taxonomy: bundle.provider.taxonomy },
    payer: { name: bundle.payer.name, payerId: bundle.payer.payerId, type: bundle.payer.type },
    subscriber: { lastName: bundle.patient.lastName, firstName: bundle.patient.firstName, memberId: bundle.insurance.memberId, groupNumber: bundle.insurance.groupNumber, dob: bundle.patient.dob, sex: bundle.patient.sex, address1: bundle.patient.address1, city: bundle.patient.city, state: bundle.patient.state, zip: bundle.patient.zip, relationship: bundle.insurance.relationship },
    claim: {
      totalCents: bundle.claim.totalCents, frequencyCode: bundle.claim.frequencyCode, originalPayerClaimNumber: bundle.claim.originalPayerClaimNumber,
      authorizationNumber, diagnoses: bundle.encounter.diagnoses, institutional: bundle.claim.institutional!, attachments,
    },
    lines: bundle.lines.map((l) => ({ revenueCode: l.revenueCode ?? "", hcpcs: l.cpt || null, modifiers: l.modifiers, chargeCents: l.chargeCents * l.units, units: l.units, dateOfService: bundle.encounter.dateOfService })),
  }) : buildEdi837P({
    controlNumber: bundle.claim.controlNumber,
    interchangeControl: String(Math.floor(now.getTime() / 1000) % 1_000_000_000),
    senderId: "COLLABORATMD",
    receiverId: bundle.payer.payerId,
    now,
    billingProvider: { name: bundle.practice.name, npi: bundle.practice.npi, taxId: bundle.practice.taxId, address1: bundle.practice.address1, city: bundle.practice.city, state: bundle.practice.state, zip: bundle.practice.zip },
    renderingProvider: { lastName: bundle.provider.lastName, firstName: bundle.provider.firstName, npi: bundle.provider.npi, taxonomy: bundle.provider.taxonomy },
    payer: { name: bundle.payer.name, payerId: bundle.payer.payerId },
    subscriber: { lastName: bundle.patient.lastName, firstName: bundle.patient.firstName, memberId: bundle.insurance.memberId, groupNumber: bundle.insurance.groupNumber, dob: bundle.patient.dob, sex: bundle.patient.sex, address1: bundle.patient.address1, city: bundle.patient.city, state: bundle.patient.state, zip: bundle.patient.zip, relationship: bundle.insurance.relationship },
    claim: {
      totalCents: bundle.claim.totalCents, placeOfService: bundle.encounter.placeOfService, frequencyCode: bundle.claim.frequencyCode,
      originalPayerClaimNumber: bundle.claim.originalPayerClaimNumber, authorizationNumber,
      dateOfService: bundle.encounter.dateOfService, diagnoses: bundle.encounter.diagnoses, attachments,
    },
    lines: bundle.lines.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers, chargeCents: l.chargeCents * l.units, units: l.units, dxPointers: l.dxPointers, dateOfService: bundle.encounter.dateOfService })),
    otherPayer,
  });
}

/** The claim's 837 as it would be sent now, for uploading to another clearinghouse or checking. Scrub errors still block it. */
export async function previewClaimEdi(db: Db, claimId: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  const { findings, edits } = await scrubBundle(db, bundle);
  if (hasBlockingErrors(findings)) throw new Error("Fix the scrub errors first");
  const otherPayer = bundle.claim.payerSequence === "S" && bundle.claim.primaryClaimId ? await primaryAdjudication(db, bundle.claim.primaryClaimId) : undefined;
  const edi = buildClaimEdi(bundle, { now: new Date(), authorizationNumber: edits.authorization?.authNumber ?? bundle.claim.authorizationNumber ?? null, attachments: await attachmentRefs(db, claimId), otherPayer });
  const kind = bundle.claim.claimType === "dental" ? "837D" : bundle.claim.claimType === "institutional" ? "837I" : "837P";
  return { edi, filename: `${bundle.claim.controlNumber}-${kind}.x12`, practiceId: bundle.claim.practiceId };
}

/** Generates the 837P and submits it through the clearinghouse gateway. */
export async function submitClaim(db: Db, claimId: string, userId?: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  if (!["ready", "rejected", "scrub_errors"].includes(bundle.claim.status)) throw new Error(`Claim in status ${bundle.claim.status} cannot be submitted`);
  const { findings, edits } = await scrubBundle(db, bundle);
  if (hasBlockingErrors(findings)) {
    await db.update(claims).set({ scrubResults: findings, status: "scrub_errors", updatedAt: new Date() }).where(eq(claims.id, claimId));
    throw new Error("Claim has blocking scrub errors");
  }
  const authorizationNumber = edits.authorization?.authNumber ?? bundle.claim.authorizationNumber ?? null;
  const otherPayer = bundle.claim.payerSequence === "S" && bundle.claim.primaryClaimId ? await primaryAdjudication(db, bundle.claim.primaryClaimId) : undefined;
  if (bundle.claim.payerSequence === "S" && !otherPayer) throw new Error("The primary claim has no posted remittance to send to the secondary payer");
  const now = new Date();
  const institutional = bundle.claim.claimType === "institutional";
  const dental = bundle.claim.claimType === "dental";
  if ((institutional || dental) && otherPayer) throw new Error(`Secondary ${dental ? "dental" : "institutional"} claims are not supported yet; bill the secondary payer on paper or through its portal`);
  if (dental && (await practiceConfig(db, bundle.claim.practiceId)).stedi) {
    throw new Error("Sending dental (837D) claims through Stedi is not enabled in this version. Download the 837D from the claim and upload it to your dental clearinghouse, or bill on the payer's portal.");
  }
  const attachments = await attachmentRefs(db, claimId);
  const edi = buildClaimEdi(bundle, { now, authorizationNumber, attachments, otherPayer });
  await db.update(claims).set({ edi837: edi, status: "submitted", submittedAt: now, scrubResults: findings, authorizationNumber, updatedAt: now }).where(eq(claims.id, claimId));
  if (attachments.length) await markAttachmentsSent(db, claimId, now);
  const kind = bundle.claim.frequencyCode === "8" ? "Void" : bundle.claim.frequencyCode === "7" ? "Replacement" : bundle.claim.payerSequence === "S" ? "Secondary 837P" : dental ? "837D" : institutional ? "837I" : "837P";
  await db.insert(claimEvents).values({ claimId, status: "submitted", source: "user", message: `${kind} generated and sent to clearinghouse (${edi.length} bytes)` });

  const result = await getClearinghouse((await practiceConfig(db, bundle.claim.practiceId)).stedi?.apiKey).submit837(edi, {
    controlNumber: bundle.claim.controlNumber, memberId: bundle.insurance.memberId,
    patientLast: bundle.patient.lastName, patientFirst: bundle.patient.firstName,
    chargeCents: bundle.claim.totalCents, dateOfService: bundle.encounter.dateOfService,
    billingName: bundle.practice.name, billingNpi: bundle.practice.npi,
    claimType: dental ? "dental" : institutional ? "institutional" : "professional",
  });
  const ack277 = await recordAcknowledgments(db, claimId, bundle.claim.controlNumber, result);
  const status = result.status;
  await db
    .update(claims)
    .set({ status, payerClaimNumber: ack277?.payerClaimNumber || bundle.claim.payerClaimNumber, updatedAt: new Date() })
    .where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status, source: "clearinghouse", message: `${result.clearinghouseId}: ${result.message}${result.rejectionCode ? ` [${result.rejectionCode}]` : ""}` });
  await emit(db, bundle.claim.practiceId, "claim.submitted", { claim_id: claimId, control_number: bundle.claim.controlNumber, total_cents: bundle.claim.totalCents });
  if (status === "accepted" || status === "rejected") {
    await emit(db, bundle.claim.practiceId, "claim.status_changed", { claim_id: claimId, control_number: bundle.claim.controlNumber, status, message: result.message });
  }

  if (status === "accepted") {
    // Only an original claim draws down the authorization; a replacement is
    // the same service, already counted when the original was accepted.
    if (edits.authorization && bundle.claim.frequencyCode === "1") await consumeAuthorization(db, edits.authorization.id, edits.authUnits);
    if (bundle.claim.frequencyCode === "8" && bundle.claim.originalClaimId) {
      await db.insert(claimEvents).values({ claimId: bundle.claim.originalClaimId, status: "void_pending", source: "clearinghouse", message: `Void ${bundle.claim.controlNumber} accepted; waiting for the payer to reverse this claim` });
      await db.update(claims).set({ status: "void_pending", updatedAt: new Date() }).where(eq(claims.id, bundle.claim.originalClaimId));
    }
  }
  if (status === "rejected") {
    const exp = await explainRejection(result.rejectionCode ?? "", result.message);
    await db.insert(denials).values({
      practiceId: bundle.claim.practiceId,
      claimId,
      category: "coding",
      carc: result.rejectionCode ?? "277CA",
      amountCents: bundle.claim.totalCents,
      explanation: exp.explanation,
      nextSteps: exp.nextSteps,
      status: "open",
    });
    await emit(db, bundle.claim.practiceId, "denial.created", { claim_id: claimId, control_number: bundle.claim.controlNumber, carc: result.rejectionCode ?? "277CA", category: "coding", amount_cents: bundle.claim.totalCents, explanation: exp.explanation });
  }
  await db.insert(schema.auditLog).values({ practiceId: bundle.claim.practiceId, userId: userId ?? null, action: "submit_claim", entity: "claim", entityId: claimId, details: { status, clearinghouseId: result.clearinghouseId } });
  return { status, result };
}

/**
 * Stores the 999 and 277CA exactly as received, with what they said about
 * this claim. Returns this claim's 277CA status, if there was one.
 */
async function recordAcknowledgments(db: Db, claimId: string, controlNumber: string, result: SubmissionResult) {
  if (result.ack999) {
    const ack = parse999(result.ack999);
    const first = ack.errors[0];
    await db.insert(claimAcknowledgments).values({
      claimId, kind: "999", accepted: ack.accepted, code: `IK5:${ack.transactionStatus}`,
      message: ack.accepted ? "File accepted: the 837 is structurally valid" : `File rejected: ${first ? `${describeSyntaxError(first.code)} (${first.segmentId})` : "syntax errors"}`,
      raw: result.ack999,
    });
  }
  if (!result.ack277) return null;
  const mine = parse277CA(result.ack277).find((c) => c.controlNumber === controlNumber) ?? null;
  if (mine) {
    await db.insert(claimAcknowledgments).values({
      claimId, kind: "277CA", accepted: mine.accepted,
      code: [mine.category, mine.statusCode, mine.entity].filter(Boolean).join(":"),
      message: mine.message, raw: result.ack277,
    });
  }
  return mine;
}

export async function listAcknowledgments(db: Db, claimId: string) {
  return db.select().from(claimAcknowledgments).where(eq(claimAcknowledgments.claimId, claimId)).orderBy(asc(claimAcknowledgments.receivedAt));
}

async function explainRejection(code: string, message: string) {
  // Front-end (277CA) rejections are not CARCs; map the common ones.
  if (code === "999:R") {
    return { explanation: `The clearinghouse could not read the file: ${message}. The claim never reached the payer.`, nextSteps: ["Re-scrub the claim", "Resubmit; if it fails again, contact support with the 999"] };
  }
  if (code.startsWith("A7:164")) {
    return { explanation: "The clearinghouse rejected the claim before it reached the payer because the subscriber member ID is not valid for this payer.", nextSteps: ["Verify the member ID on the insurance card", "Run a real-time eligibility check", "Correct the policy and resubmit"] };
  }
  return { explanation: `Clearinghouse rejection: ${message}`, nextSteps: ["Review the rejection detail", "Correct the claim and resubmit"] };
}

/**
 * Pulls ERAs from the clearinghouse for accepted claims and auto-posts them.
 * Returns the number of remittances processed.
 */
export async function fetchAndPostRemittances(db: Db, practiceId: string, userId?: string, onlyClaimIds?: string[]) {
  if (onlyClaimIds && onlyClaimIds.length === 0) return 0;
  const open = await db
    .select({ claim: claims, payer: payers, insurance: patientInsurances })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(patientInsurances, eq(patientInsurances.id, claims.patientInsuranceId))
    .where(
      and(
        eq(claims.practiceId, practiceId),
        inArray(claims.status, ["accepted", "pending"]),
        ...(onlyClaimIds ? [inArray(claims.id, onlyClaimIds)] : []),
      ),
    );
  const byPayer = new Map<string, typeof open>();
  for (const row of open) byPayer.set(row.payer.id, [...(byPayer.get(row.payer.id) ?? []), row]);

  let processed = 0;
  for (const rows of byPayer.values()) {
    const items: RemitRequest[] = [];
    for (const r of rows) {
      const base = { controlNumber: r.claim.controlNumber, payerName: r.payer.name, payerId: r.payer.payerId, memberId: r.insurance.memberId };
      if (r.claim.frequencyCode === "8") {
        // A void is not adjudicated: the payer answers it by reversing the original.
        const reversal = r.claim.originalClaimId ? await reversalFor(db, r.claim.originalClaimId) : null;
        if (reversal) items.push({ ...base, lines: [], reversal });
        continue;
      }
      const lines = await db.select().from(charges).where(eq(charges.encounterId, r.claim.encounterId));
      const secondary = r.claim.payerSequence === "S" && r.claim.primaryClaimId
        ? { balanceCents: (await getClaimFinancials(db, r.claim.primaryClaimId)).insuranceBalanceCents }
        : undefined;
      items.push({ ...base, lines: lines.map((l) => ({ cpt: l.cpt, units: l.units, chargeCents: l.chargeCents * l.units })), secondary });
    }
    if (!items.length) continue;
    const raw = await getClearinghouse((await practiceConfig(db, practiceId)).stedi?.apiKey).fetch835(items);
    if (!raw) continue;
    const remitId = await importRemittance(db, practiceId, raw, userId);
    await postRemittance(db, remitId, userId);
    processed++;
  }
  return processed;
}

/** What the payer takes back when it reverses a claim: everything it posted. */
async function reversalFor(db: Db, originalClaimId: string) {
  const [orig] = await db.select().from(claims).where(eq(claims.id, originalClaimId)).limit(1);
  if (!orig) return null;
  const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.claimId, originalClaimId));
  const fin = computeFinancials(entries);
  const grouped = new Map<string, { group: string; reason: string; amountCents: number }>();
  for (const e of entries) {
    if (e.type !== "adjustment" && e.type !== "transfer_to_patient") continue;
    if (!e.groupCode || !e.reasonCode) continue; // manual write-offs and transfers are the practice's, not the payer's
    const key = `${e.groupCode}:${e.reasonCode}`;
    const g = grouped.get(key) ?? { group: e.groupCode, reason: e.reasonCode, amountCents: 0 };
    g.amountCents += e.amountCents;
    grouped.set(key, g);
  }
  return {
    originalControlNumber: orig.controlNumber,
    payerClaimNumber: orig.payerClaimNumber ?? "",
    chargedCents: orig.totalCents,
    paidCents: fin.insurancePaidCents,
    adjustments: [...grouped.values()].filter((a) => a.amountCents !== 0),
  };
}

export async function importRemittance(db: Db, practiceId: string, raw: string, userId?: string) {
  const parsed = parseEdi835(raw);
  const [payer] = parsed.payerId ? await db.select().from(payers).where(and(eq(payers.practiceId, practiceId), eq(payers.payerId, parsed.payerId))).limit(1) : [];
  const [remit] = await db
    .insert(remittances)
    .values({ practiceId, payerId: payer?.id ?? null, payerName: parsed.payerName || payer?.name || "Unknown payer", checkNumber: parsed.checkNumber || "N/A", amountCents: parsed.totalPaidCents, paymentDate: parsed.paymentDate || new Date().toISOString().slice(0, 10), raw835: raw })
    .returning();
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "import_835", entity: "remittance", entityId: remit.id, details: { claims: parsed.claims.length, amountCents: parsed.totalPaidCents } });
  return remit.id;
}

/** Auto-posts an 835: payments, contractual adjustments, patient responsibility transfers, denials. */
export async function postRemittance(db: Db, remittanceId: string, userId?: string) {
  const [remit] = await db.select().from(remittances).where(eq(remittances.id, remittanceId)).limit(1);
  if (!remit) throw new Error("Remittance not found");
  if (remit.posted) return remit.postingSummary;
  const parsed = parseEdi835(remit.raw835);
  const summary: { matched: number; unmatched: string[]; paidCents: number; deniedCents: number; patientRespCents: number; adjustedCents: number; denials: number; underpaid?: number; reversals?: number; secondaryBilled?: number } = { matched: 0, unmatched: [], paidCents: 0, deniedCents: 0, patientRespCents: 0, adjustedCents: 0, denials: 0 };
  const readyForSecondary: string[] = [];

  for (const rc of parsed.claims) {
    const [claim] = await db.select().from(claims).where(and(eq(claims.practiceId, remit.practiceId), eq(claims.controlNumber, rc.patientControlNumber))).limit(1);
    if (!claim) {
      summary.unmatched.push(rc.patientControlNumber);
      continue;
    }
    summary.matched++;
    // A secondary's payment settles the balance of the primary claim, so it posts there.
    const isSecondary = claim.payerSequence === "S" && !!claim.primaryClaimId;
    const base = { practiceId: remit.practiceId, patientId: claim.patientId, claimId: isSecondary ? claim.primaryClaimId! : claim.id, remittanceId, postedBy: userId ?? null };
    if (rc.statusCode === "22") {
      await postReversal(db, claim, rc, base, remit.checkNumber);
      summary.reversals = (summary.reversals ?? 0) + 1;
      summary.paidCents += rc.paidCents; // negative: money taken back
      continue;
    }
    if (rc.paidCents > 0) {
      await db.insert(ledgerEntries).values({ ...base, type: "insurance_payment", amountCents: rc.paidCents, note: `${remit.payerName} ${remit.checkNumber}` });
      summary.paidCents += rc.paidCents;
    }
    const allAdj = [...rc.adjustments, ...rc.lines.flatMap((l) => l.adjustments)];
    // Line-level adjustments take precedence when present; avoid double-posting claim-level duplicates.
    const adjustments = rc.lines.length ? rc.lines.flatMap((l) => l.adjustments) : rc.adjustments;
    for (const adj of adjustments) {
      // CARC 23 is the part the prior payer already settled; nothing to post.
      if (adj.reason === "23") continue;
      if (adj.group === "PR") {
        await db.insert(ledgerEntries).values({ ...base, type: "transfer_to_patient", amountCents: adj.amountCents, groupCode: adj.group, reasonCode: adj.reason, note: "Patient responsibility per ERA" });
        summary.patientRespCents += adj.amountCents;
      } else if (rc.statusCode === "4" || adj.reason !== "45") {
        // Denied amount stays in insurance AR until worked; we record it as a pending denial adjustment note.
        summary.deniedCents += adj.amountCents;
      } else {
        await db.insert(ledgerEntries).values({ ...base, type: "adjustment", amountCents: adj.amountCents, groupCode: adj.group, reasonCode: adj.reason, note: "Contractual adjustment" });
        summary.adjustedCents += adj.amountCents;
      }
    }
    const denialAdj = allAdj.find((a) => a.group !== "PR" && a.reason !== "45" && a.reason !== "23");
    let status: string;
    if (rc.statusCode === "4" || (rc.paidCents === 0 && denialAdj)) status = "denied";
    else if (rc.paidCents > 0 && denialAdj) status = "partially_paid";
    else status = "paid";
    await db.update(claims).set({ status, payerClaimNumber: rc.payerClaimNumber || claim.payerClaimNumber, updatedAt: new Date() }).where(eq(claims.id, claim.id));
    await db.insert(claimEvents).values({ claimId: claim.id, status, source: "835", message: `ERA ${remit.checkNumber}: paid ${(rc.paidCents / 100).toFixed(2)}, patient resp ${(rc.patientResponsibilityCents / 100).toFixed(2)}` });
    await emit(db, remit.practiceId, "claim.status_changed", { claim_id: claim.id, control_number: claim.controlNumber, status, paid_cents: rc.paidCents, patient_responsibility_cents: rc.patientResponsibilityCents });
    if (rc.paidCents > 0) {
      await emit(db, remit.practiceId, "payment.posted", { type: "insurance_payment", claim_id: isSecondary ? claim.primaryClaimId : claim.id, amount_cents: rc.paidCents, payer_name: remit.payerName, check_number: remit.checkNumber, remittance_id: remit.id });
    }
    if (isSecondary) {
      await db.update(claims).set({ status, updatedAt: new Date() }).where(eq(claims.id, claim.primaryClaimId!));
      await db.insert(claimEvents).values({ claimId: claim.primaryClaimId!, status, source: "835", message: `Secondary ${claim.controlNumber} paid ${(rc.paidCents / 100).toFixed(2)}` });
    } else if (status !== "denied" && rc.patientResponsibilityCents > 0) {
      readyForSecondary.push(claim.id);
    }

    // Compare what was allowed with the payer contract, now that it is posted.
    // A secondary pays against another payer's allowed amount, not a contract.
    const under = isSecondary ? null : await checkClaimUnderpayment(db, claim.id, remittanceId);
    if (under?.underpaid) {
      summary.underpaid = (summary.underpaid ?? 0) + 1;
      await db.insert(claimEvents).values({ claimId: claim.id, status, source: "system", message: `Underpaid against contract by ${(under.varianceCents / 100).toFixed(2)} (expected ${(under.expectedCents / 100).toFixed(2)} allowed)` });
    }

    if (denialAdj) {
      const rarc = rc.remarks[0] ?? rc.lines.flatMap((l) => l.remarks)[0] ?? null;
      const lines = await db.select().from(charges).where(eq(charges.encounterId, claim.encounterId));
      const [enc] = await db.select().from(encounters).where(eq(encounters.id, claim.encounterId)).limit(1);
      const [payer] = await db.select().from(payers).where(eq(payers.id, claim.payerId)).limit(1);
      const exp = await explainDenial({ carc: denialAdj.reason, rarc, cpts: lines.map((l) => l.cpt), diagnoses: enc?.diagnoses ?? [], payerType: payer?.type ?? "commercial", claimAgeDays: Math.floor((Date.now() - new Date(enc?.dateOfService ?? Date.now()).getTime()) / 86_400_000) }, (await practiceConfig(db, remit.practiceId)).anthropic?.apiKey);
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + (payer?.appealDays ?? 60));
      await db.insert(denials).values({ practiceId: remit.practiceId, claimId: claim.id, category: carcCategory(denialAdj.reason), carc: denialAdj.reason, rarc, amountCents: denialAdj.amountCents, explanation: exp.explanation, nextSteps: exp.nextSteps, appealDeadline: deadline.toISOString().slice(0, 10) });
      await emit(db, remit.practiceId, "denial.created", { claim_id: claim.id, control_number: claim.controlNumber, carc: denialAdj.reason, rarc, category: carcCategory(denialAdj.reason), amount_cents: denialAdj.amountCents, explanation: exp.explanation, appeal_deadline: deadline.toISOString().slice(0, 10) });
      summary.denials++;
    }
  }
  // Bill the patient's second insurer for what the first left, where there is one.
  for (const id of readyForSecondary) {
    try {
      const created = await createSecondaryClaim(db, id, userId);
      if (!created) continue;
      summary.secondaryBilled = (summary.secondaryBilled ?? 0) + 1;
      if (created.status === "ready") await submitClaim(db, created.id, userId);
    } catch (e) {
      await db.insert(claimEvents).values({ claimId: id, status: "paid", source: "system", message: `Secondary claim not created: ${e instanceof Error ? e.message : "error"}` });
    }
  }
  await db.update(remittances).set({ posted: true, postingSummary: summary }).where(eq(remittances.id, remittanceId));
  return summary;
}

/** The primary payer's decision on a claim, as a secondary claim must report it. */
async function primaryAdjudication(db: Db, primaryClaimId: string) {
  const bundle = await loadClaimBundle(db, primaryClaimId);
  if (!bundle) return undefined;
  // Only what the primary payer posted: its remittances, not a later secondary's.
  const rows = await db
    .select({ entry: ledgerEntries, paymentDate: remittances.paymentDate })
    .from(ledgerEntries)
    .innerJoin(remittances, eq(remittances.id, ledgerEntries.remittanceId))
    .where(and(eq(ledgerEntries.claimId, primaryClaimId), eq(remittances.payerId, bundle.claim.payerId)))
    .orderBy(asc(ledgerEntries.postedAt));
  if (!rows.length) return undefined;
  const paidCents = rows.reduce((a, r) => a + (r.entry.type === "insurance_payment" ? r.entry.amountCents : r.entry.type === "reversal" ? -r.entry.amountCents : 0), 0);
  const grouped = new Map<string, { group: string; reason: string; amountCents: number }>();
  for (const { entry } of rows) {
    if (!entry.groupCode || !entry.reasonCode || (entry.type !== "adjustment" && entry.type !== "transfer_to_patient")) continue;
    const key = `${entry.groupCode}:${entry.reasonCode}`;
    const g = grouped.get(key) ?? { group: entry.groupCode, reason: entry.reasonCode, amountCents: 0 };
    g.amountCents += entry.amountCents;
    grouped.set(key, g);
  }
  return {
    name: bundle.payer.name,
    payerId: bundle.payer.payerId,
    subscriber: { lastName: bundle.patient.lastName, firstName: bundle.patient.firstName, memberId: bundle.insurance.memberId, groupNumber: bundle.insurance.groupNumber, relationship: bundle.insurance.relationship },
    paidCents,
    adjudicatedOn: rows[rows.length - 1].paymentDate,
    adjustments: [...grouped.values()],
  };
}

/**
 * Bills the patient's secondary insurance for what the primary left as
 * patient responsibility. That amount moves off the patient's balance (it is
 * no longer theirs to pay unless the secondary declines it) and back onto
 * the primary claim's insurance balance, which the secondary's payment then
 * settles. Returns null when there is nothing to bill or no secondary.
 */
export async function createSecondaryClaim(db: Db, primaryClaimId: string, userId?: string) {
  const [primary] = await db.select().from(claims).where(eq(claims.id, primaryClaimId)).limit(1);
  if (!primary) throw new Error("Claim not found");
  if (primary.payerSequence !== "P") throw new Error("Only a primary claim has a secondary");
  if (!["paid", "partially_paid"].includes(primary.status)) throw new Error("The primary payer has not paid this claim yet");
  const [existing] = await db.select({ id: claims.id }).from(claims).where(and(eq(claims.primaryClaimId, primaryClaimId), eq(claims.payerSequence, "S"))).limit(1);
  if (existing) throw new Error("A secondary claim already exists for this claim");
  const [secondary] = await db
    .select()
    .from(patientInsurances)
    .where(and(eq(patientInsurances.patientId, primary.patientId), eq(patientInsurances.active, true), eq(patientInsurances.rank, 2)))
    .limit(1);
  if (!secondary) return null;
  const fin = await getClaimFinancials(db, primaryClaimId);
  const owed = fin.patientRespCents - fin.patientPaidCents - fin.discountsCents;
  if (owed <= 0) return null;

  await db.insert(ledgerEntries).values({
    practiceId: primary.practiceId, patientId: primary.patientId, claimId: primaryClaimId, type: "transfer_to_patient", amountCents: -owed,
    postedBy: userId ?? null, note: "Patient responsibility billed to secondary insurance",
  });
  const [created] = await db
    .insert(claims)
    .values({
      practiceId: primary.practiceId, encounterId: primary.encounterId, patientId: primary.patientId,
      payerId: secondary.payerId, patientInsuranceId: secondary.id, controlNumber: await nextControlNumber(db, primary.practiceId),
      payerSequence: "S", primaryClaimId, totalCents: primary.totalCents, status: "draft", timelyFilingDeadline: primary.timelyFilingDeadline,
    })
    .returning();
  await db.update(claims).set({ status: "billed_secondary", updatedAt: new Date() }).where(eq(claims.id, primaryClaimId));
  await db.insert(claimEvents).values({ claimId: primaryClaimId, status: "billed_secondary", source: "system", message: `${(owed / 100).toFixed(2)} billed to secondary insurance on ${created.controlNumber}` });
  await db.insert(claimEvents).values({ claimId: created.id, status: "draft", source: "system", message: `Secondary claim for ${primary.controlNumber}, balance ${(owed / 100).toFixed(2)}` });
  await db.insert(schema.auditLog).values({ practiceId: primary.practiceId, userId: userId ?? null, action: "secondary_claim", entity: "claim", entityId: created.id, details: { primary: primaryClaimId, owedCents: owed } });
  return rescrubClaim(db, created.id);
}

/**
 * Posts a payer reversal (CLP02 = 22). The payer sends the original claim's
 * amounts negated: the payment comes back as a recoupment, and the contractual
 * and patient-responsibility adjustments are backed out with negative entries,
 * so the claim returns to its full charge. If the reversal answers a void, the
 * charge is then removed, since the service should not have been billed.
 */
async function postReversal(
  db: Db,
  claim: typeof claims.$inferSelect,
  rc: ReturnType<typeof parseEdi835>["claims"][number],
  base: { practiceId: string; patientId: string; claimId: string; remittanceId: string; postedBy: string | null },
  checkNumber: string,
) {
  if (rc.paidCents !== 0) {
    await db.insert(ledgerEntries).values({ ...base, type: "reversal", amountCents: Math.abs(rc.paidCents), note: `Payer reversal ${checkNumber}` });
  }
  const adjustments = rc.lines.length ? rc.lines.flatMap((l) => l.adjustments) : rc.adjustments;
  for (const adj of adjustments) {
    // Mirror the original posting: only PR and CO-45 were posted to the ledger.
    const amount = -Math.abs(adj.amountCents);
    if (adj.group === "PR") {
      await db.insert(ledgerEntries).values({ ...base, type: "transfer_to_patient", amountCents: amount, groupCode: adj.group, reasonCode: adj.reason, note: "Patient responsibility reversed by payer" });
    } else if (adj.reason === "45") {
      await db.insert(ledgerEntries).values({ ...base, type: "adjustment", amountCents: amount, groupCode: adj.group, reasonCode: adj.reason, note: "Contractual adjustment reversed by payer" });
    }
  }
  await db.insert(claimEvents).values({ claimId: claim.id, status: "reversed", source: "835", message: `ERA ${checkNumber}: payer reversed this claim, recouping ${(Math.abs(rc.paidCents) / 100).toFixed(2)}` });

  const [voidClaim] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.originalClaimId, claim.id), eq(claims.frequencyCode, "8"), inArray(claims.status, ["accepted", "pending"])))
    .limit(1);
  if (!voidClaim) {
    await db.update(claims).set({ status: "reversed", updatedAt: new Date() }).where(eq(claims.id, claim.id));
    return;
  }
  const fin = await getClaimFinancials(db, claim.id);
  if (fin.insuranceBalanceCents > 0) {
    await db.insert(ledgerEntries).values({ ...base, remittanceId: null, type: "write_off", amountCents: fin.insuranceBalanceCents, note: `Charge removed: claim voided by ${voidClaim.controlNumber}` });
  }
  await db.update(claims).set({ status: "voided", updatedAt: new Date() }).where(eq(claims.id, claim.id));
  await db.update(claims).set({ status: "closed", updatedAt: new Date() }).where(eq(claims.id, voidClaim.id));
  await db.insert(claimEvents).values({ claimId: claim.id, status: "voided", source: "system", message: `Voided; charge removed from A/R${fin.patientBalanceCents < 0 ? `. Patient has a ${(-fin.patientBalanceCents / 100).toFixed(2)} credit to refund` : ""}` });
  await db.insert(claimEvents).values({ claimId: voidClaim.id, status: "closed", source: "835", message: `Payer reversed ${claim.controlNumber}; void complete` });
}

export interface ClaimFinancials {
  chargesCents: number;
  insurancePaidCents: number;
  patientPaidCents: number;
  adjustmentsCents: number;
  patientRespCents: number;
  discountsCents: number;
  insuranceBalanceCents: number;
  patientBalanceCents: number;
}

export function computeFinancials(entries: { type: string; amountCents: number }[]): ClaimFinancials {
  const sum = (t: string) => entries.filter((e) => e.type === t).reduce((a, e) => a + e.amountCents, 0);
  const chargesCents = sum("charge");
  // A reversal is a payer recoupment: it takes back part of what was paid.
  const insurancePaidCents = sum("insurance_payment") - sum("reversal");
  const patientPaidCents = sum("patient_payment");
  const adjustmentsCents = sum("adjustment") + sum("write_off");
  const patientRespCents = sum("transfer_to_patient");
  // Bad debt (sent to a collection agency) comes off what the patient owes, like a discount.
  const discountsCents = sum("discount") + sum("bad_debt");
  const refunds = sum("refund");
  return {
    chargesCents,
    insurancePaidCents,
    patientPaidCents,
    adjustmentsCents,
    patientRespCents,
    discountsCents,
    insuranceBalanceCents: chargesCents - insurancePaidCents - adjustmentsCents - patientRespCents,
    patientBalanceCents: patientRespCents - patientPaidCents - discountsCents + refunds,
  };
}

export async function getClaimFinancials(db: Db, claimId: string): Promise<ClaimFinancials> {
  const entries = await db.select({ type: ledgerEntries.type, amountCents: ledgerEntries.amountCents }).from(ledgerEntries).where(eq(ledgerEntries.claimId, claimId));
  return computeFinancials(entries);
}

export async function listClaims(db: Db, practiceId: string, status?: string) {
  const where = status ? and(eq(claims.practiceId, practiceId), eq(claims.status, status)) : eq(claims.practiceId, practiceId);
  return db
    .select({ claim: claims, patient: patients, payer: payers, encounter: encounters })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(where)
    .orderBy(desc(claims.createdAt))
    .limit(200);
}

export async function writeOffClaim(db: Db, claimId: string, reason: string, userId?: string) {
  const fin = await getClaimFinancials(db, claimId);
  const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  if (!claim) throw new Error("Claim not found");
  if (fin.insuranceBalanceCents > 0) {
    await db.insert(ledgerEntries).values({ practiceId: claim.practiceId, patientId: claim.patientId, claimId, type: "write_off", amountCents: fin.insuranceBalanceCents, note: reason, postedBy: userId ?? null });
  }
  await db.update(claims).set({ status: "closed", updatedAt: new Date() }).where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status: "closed", source: "user", message: `Written off: ${reason}` });
  await emit(db, claim.practiceId, "claim.status_changed", { claim_id: claimId, control_number: claim.controlNumber, status: "closed", message: "Written off" });
}

export async function transferToPatient(db: Db, claimId: string, userId?: string) {
  const fin = await getClaimFinancials(db, claimId);
  const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  if (!claim) throw new Error("Claim not found");
  if (fin.insuranceBalanceCents > 0) {
    await db.insert(ledgerEntries).values({ practiceId: claim.practiceId, patientId: claim.patientId, claimId, type: "transfer_to_patient", amountCents: fin.insuranceBalanceCents, groupCode: "PR", note: "Transferred to patient by biller", postedBy: userId ?? null });
  }
  await db.update(claims).set({ status: "closed", updatedAt: new Date() }).where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status: "closed", source: "user", message: "Balance transferred to patient responsibility" });
  await emit(db, claim.practiceId, "claim.status_changed", { claim_id: claimId, control_number: claim.controlNumber, status: "closed", message: "Balance transferred to the patient" });
}

/**
 * Creates the claim that corrects a denied or rejected one.
 *
 * If the payer adjudicated the original, it has a payer claim number and the
 * correction is a replacement (frequency 7) that cites it in REF*F8. If the
 * original was rejected before it reached the payer, the payer has no record
 * of it, so a replacement would be rejected too: the correction goes as a new
 * original claim (frequency 1).
 *
 * A claim the payer has paid, even in part, is not corrected this way: void it, then
 * bill the service again, so the payer's recoupment and the new payment post
 * against separate claims.
 */
export async function createCorrectedClaim(db: Db, claimId: string, userId?: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  if (!["denied", "rejected", "scrub_errors"].includes(bundle.claim.status)) {
    throw new Error(`A claim in status ${bundle.claim.status} cannot be corrected here`);
  }
  const fin = await getClaimFinancials(db, claimId);
  if (fin.insurancePaidCents > 0) {
    throw new Error("The payer has paid part of this claim. Void it and bill the service again instead.");
  }
  const pcn = bundle.claim.payerClaimNumber;
  const frequencyCode = pcn ? "7" : "1";
  const [created] = await db
    .insert(claims)
    .values({
      practiceId: bundle.claim.practiceId,
      encounterId: bundle.claim.encounterId,
      patientId: bundle.claim.patientId,
      payerId: bundle.claim.payerId,
      patientInsuranceId: bundle.claim.patientInsuranceId,
      controlNumber: await nextControlNumber(db, bundle.claim.practiceId),
      frequencyCode,
      originalClaimId: claimId,
      originalPayerClaimNumber: pcn,
      totalCents: bundle.claim.totalCents,
      status: "draft",
      timelyFilingDeadline: bundle.claim.timelyFilingDeadline,
    })
    .returning();
  // Move ledger entries to the new claim so A/R follows the live claim.
  await db.update(ledgerEntries).set({ claimId: created.id }).where(eq(ledgerEntries.claimId, claimId));
  await db.update(claims).set({ status: "closed", updatedAt: new Date() }).where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status: "closed", source: "user", message: `Replaced by corrected claim ${created.controlNumber}` });
  await db.insert(claimEvents).values({
    claimId: created.id, status: "draft", source: "user",
    message: pcn
      ? `Replacement (frequency 7) of ${bundle.claim.controlNumber}, citing payer claim ${pcn}`
      : `Resubmission of ${bundle.claim.controlNumber} as a new claim: the payer never received the original`,
  });
  await db.update(denials).set({ status: "resolved", resolvedAt: new Date() }).where(eq(denials.claimId, claimId));
  await db.insert(schema.auditLog).values({ practiceId: bundle.claim.practiceId, userId: userId ?? null, action: "corrected_claim", entity: "claim", entityId: created.id, details: { original: claimId, frequencyCode } });
  return rescrubClaim(db, created.id);
}

/**
 * Creates a void (frequency 8) for a claim the payer has adjudicated, to take
 * back a claim billed in error. The payer answers with a reversal on its ERA,
 * which recoups any payment; posting that reversal completes the void.
 */
export async function voidClaim(db: Db, claimId: string, reason: string, userId?: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  if (bundle.claim.frequencyCode === "8") throw new Error("This claim is itself a void");
  if (!["paid", "partially_paid", "denied"].includes(bundle.claim.status)) {
    throw new Error(`A claim in status ${bundle.claim.status} cannot be voided. Only a claim the payer has adjudicated can be.`);
  }
  if (!bundle.claim.payerClaimNumber) throw new Error("The payer has not assigned a claim number to this claim, so it cannot be voided yet");
  const [existing] = await db.select({ id: claims.id }).from(claims).where(and(eq(claims.originalClaimId, claimId), eq(claims.frequencyCode, "8"))).limit(1);
  if (existing) throw new Error("A void already exists for this claim");
  if (!reason.trim()) throw new Error("Say why the claim is being voided");

  const [created] = await db
    .insert(claims)
    .values({
      practiceId: bundle.claim.practiceId,
      encounterId: bundle.claim.encounterId,
      patientId: bundle.claim.patientId,
      payerId: bundle.claim.payerId,
      patientInsuranceId: bundle.claim.patientInsuranceId,
      controlNumber: await nextControlNumber(db, bundle.claim.practiceId),
      frequencyCode: "8",
      originalClaimId: claimId,
      originalPayerClaimNumber: bundle.claim.payerClaimNumber,
      totalCents: bundle.claim.totalCents,
      status: "draft",
      timelyFilingDeadline: bundle.claim.timelyFilingDeadline,
    })
    .returning();
  await db.insert(claimEvents).values({ claimId, status: bundle.claim.status, source: "user", message: `Void ${created.controlNumber} created: ${reason.trim()}` });
  await db.insert(claimEvents).values({ claimId: created.id, status: "draft", source: "user", message: `Void (frequency 8) of ${bundle.claim.controlNumber}, citing payer claim ${bundle.claim.payerClaimNumber}` });
  await db.insert(schema.auditLog).values({ practiceId: bundle.claim.practiceId, userId: userId ?? null, action: "void_claim", entity: "claim", entityId: created.id, details: { original: claimId, reason: reason.trim() } });
  return rescrubClaim(db, created.id);
}
