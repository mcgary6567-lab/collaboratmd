import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { scrubClaim, hasBlockingErrors, type ScrubClaim } from "@/lib/scrub/rules";
import { buildEdi837P } from "@/lib/edi/x837p";
import { parseEdi835 } from "@/lib/edi/x835";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";
import { explainDenial } from "@/lib/ai/explain";
import { carcCategory } from "@/lib/codes/carc";

const { claims, claimEvents, encounters, charges, patients, patientInsurances, payers, providers, practices, remittances, ledgerEntries, denials } = schema;

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
  return rescrubClaim(db, claim.id);
}

export async function rescrubClaim(db: Db, claimId: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  const findings = scrubClaim(toScrubInput(bundle));
  const status = hasBlockingErrors(findings) ? "scrub_errors" : "ready";
  const [updated] = await db.update(claims).set({ scrubResults: findings, status, updatedAt: new Date() }).where(eq(claims.id, claimId)).returning();
  await db.insert(claimEvents).values({ claimId, status, source: "system", message: `Scrubbed: ${findings.filter((f) => f.severity === "error").length} errors, ${findings.filter((f) => f.severity === "warning").length} warnings` });
  return updated;
}

/** Generates the 837P and submits it through the clearinghouse gateway. */
export async function submitClaim(db: Db, claimId: string, userId?: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  if (!["ready", "rejected", "scrub_errors"].includes(bundle.claim.status)) throw new Error(`Claim in status ${bundle.claim.status} cannot be submitted`);
  const findings = scrubClaim(toScrubInput(bundle));
  if (hasBlockingErrors(findings)) {
    await db.update(claims).set({ scrubResults: findings, status: "scrub_errors", updatedAt: new Date() }).where(eq(claims.id, claimId));
    throw new Error("Claim has blocking scrub errors");
  }
  const now = new Date();
  const edi = buildEdi837P({
    controlNumber: bundle.claim.controlNumber,
    interchangeControl: String(Math.floor(now.getTime() / 1000) % 1_000_000_000),
    senderId: "COLLABORATMD",
    receiverId: bundle.payer.payerId,
    now,
    billingProvider: { name: bundle.practice.name, npi: bundle.practice.npi, taxId: bundle.practice.taxId, address1: bundle.practice.address1, city: bundle.practice.city, state: bundle.practice.state, zip: bundle.practice.zip },
    renderingProvider: { lastName: bundle.provider.lastName, firstName: bundle.provider.firstName, npi: bundle.provider.npi, taxonomy: bundle.provider.taxonomy },
    payer: { name: bundle.payer.name, payerId: bundle.payer.payerId },
    subscriber: { lastName: bundle.patient.lastName, firstName: bundle.patient.firstName, memberId: bundle.insurance.memberId, groupNumber: bundle.insurance.groupNumber, dob: bundle.patient.dob, sex: bundle.patient.sex, address1: bundle.patient.address1, city: bundle.patient.city, state: bundle.patient.state, zip: bundle.patient.zip, relationship: bundle.insurance.relationship },
    claim: { totalCents: bundle.claim.totalCents, placeOfService: bundle.encounter.placeOfService, frequencyCode: bundle.claim.frequencyCode, dateOfService: bundle.encounter.dateOfService, diagnoses: bundle.encounter.diagnoses },
    lines: bundle.lines.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers, chargeCents: l.chargeCents * l.units, units: l.units, dxPointers: l.dxPointers, dateOfService: bundle.encounter.dateOfService })),
  });
  await db.update(claims).set({ edi837: edi, status: "submitted", submittedAt: now, scrubResults: findings, updatedAt: now }).where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status: "submitted", source: "user", message: `837P generated and sent to clearinghouse (${edi.length} bytes)` });

  const result = await getClearinghouse().submit837(edi, { controlNumber: bundle.claim.controlNumber, memberId: bundle.insurance.memberId });
  const status = result.accepted ? "accepted" : "rejected";
  await db.update(claims).set({ status, updatedAt: new Date() }).where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status, source: "clearinghouse", message: `${result.clearinghouseId}: ${result.message}${result.rejectionCode ? ` [${result.rejectionCode}]` : ""}` });
  if (!result.accepted) {
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
  }
  await db.insert(schema.auditLog).values({ practiceId: bundle.claim.practiceId, userId: userId ?? null, action: "submit_claim", entity: "claim", entityId: claimId, details: { status, clearinghouseId: result.clearinghouseId } });
  return { status, result };
}

async function explainRejection(code: string, message: string) {
  // Front-end (277CA) rejections are not CARCs; map the common ones.
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
    const items = [];
    for (const r of rows) {
      const lines = await db.select().from(charges).where(eq(charges.encounterId, r.claim.encounterId));
      items.push({ controlNumber: r.claim.controlNumber, payerName: r.payer.name, payerId: r.payer.payerId, memberId: r.insurance.memberId, lines: lines.map((l) => ({ cpt: l.cpt, units: l.units, chargeCents: l.chargeCents * l.units })) });
    }
    const raw = await getClearinghouse().fetch835(items);
    if (!raw) continue;
    const remitId = await importRemittance(db, practiceId, raw, userId);
    await postRemittance(db, remitId, userId);
    processed++;
  }
  return processed;
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
  const summary = { matched: 0, unmatched: [] as string[], paidCents: 0, deniedCents: 0, patientRespCents: 0, adjustedCents: 0, denials: 0 };

  for (const rc of parsed.claims) {
    const [claim] = await db.select().from(claims).where(and(eq(claims.practiceId, remit.practiceId), eq(claims.controlNumber, rc.patientControlNumber))).limit(1);
    if (!claim) {
      summary.unmatched.push(rc.patientControlNumber);
      continue;
    }
    summary.matched++;
    const base = { practiceId: remit.practiceId, patientId: claim.patientId, claimId: claim.id, remittanceId, postedBy: userId ?? null };
    if (rc.paidCents > 0) {
      await db.insert(ledgerEntries).values({ ...base, type: "insurance_payment", amountCents: rc.paidCents, note: `${remit.payerName} ${remit.checkNumber}` });
      summary.paidCents += rc.paidCents;
    }
    const allAdj = [...rc.adjustments, ...rc.lines.flatMap((l) => l.adjustments)];
    // Line-level adjustments take precedence when present; avoid double-posting claim-level duplicates.
    const adjustments = rc.lines.length ? rc.lines.flatMap((l) => l.adjustments) : rc.adjustments;
    for (const adj of adjustments) {
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
    const denialAdj = allAdj.find((a) => a.group !== "PR" && a.reason !== "45");
    let status: string;
    if (rc.statusCode === "4" || (rc.paidCents === 0 && denialAdj)) status = "denied";
    else if (rc.paidCents > 0 && denialAdj) status = "partially_paid";
    else status = "paid";
    await db.update(claims).set({ status, payerClaimNumber: rc.payerClaimNumber || claim.payerClaimNumber, updatedAt: new Date() }).where(eq(claims.id, claim.id));
    await db.insert(claimEvents).values({ claimId: claim.id, status, source: "835", message: `ERA ${remit.checkNumber}: paid ${(rc.paidCents / 100).toFixed(2)}, patient resp ${(rc.patientResponsibilityCents / 100).toFixed(2)}` });

    if (denialAdj) {
      const rarc = rc.remarks[0] ?? rc.lines.flatMap((l) => l.remarks)[0] ?? null;
      const lines = await db.select().from(charges).where(eq(charges.encounterId, claim.encounterId));
      const [enc] = await db.select().from(encounters).where(eq(encounters.id, claim.encounterId)).limit(1);
      const [payer] = await db.select().from(payers).where(eq(payers.id, claim.payerId)).limit(1);
      const exp = await explainDenial({ carc: denialAdj.reason, rarc, cpts: lines.map((l) => l.cpt), diagnoses: enc?.diagnoses ?? [], payerType: payer?.type ?? "commercial", claimAgeDays: Math.floor((Date.now() - new Date(enc?.dateOfService ?? Date.now()).getTime()) / 86_400_000) });
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + (payer?.appealDays ?? 60));
      await db.insert(denials).values({ practiceId: remit.practiceId, claimId: claim.id, category: carcCategory(denialAdj.reason), carc: denialAdj.reason, rarc, amountCents: denialAdj.amountCents, explanation: exp.explanation, nextSteps: exp.nextSteps, appealDeadline: deadline.toISOString().slice(0, 10) });
      summary.denials++;
    }
  }
  await db.update(remittances).set({ posted: true, postingSummary: summary }).where(eq(remittances.id, remittanceId));
  return summary;
}

export interface ClaimFinancials {
  chargesCents: number;
  insurancePaidCents: number;
  patientPaidCents: number;
  adjustmentsCents: number;
  patientRespCents: number;
  insuranceBalanceCents: number;
  patientBalanceCents: number;
}

export function computeFinancials(entries: { type: string; amountCents: number }[]): ClaimFinancials {
  const sum = (t: string) => entries.filter((e) => e.type === t).reduce((a, e) => a + e.amountCents, 0);
  const chargesCents = sum("charge");
  const insurancePaidCents = sum("insurance_payment");
  const patientPaidCents = sum("patient_payment");
  const adjustmentsCents = sum("adjustment") + sum("write_off");
  const patientRespCents = sum("transfer_to_patient");
  const refunds = sum("refund");
  return {
    chargesCents,
    insurancePaidCents,
    patientPaidCents,
    adjustmentsCents,
    patientRespCents,
    insuranceBalanceCents: chargesCents - insurancePaidCents - adjustmentsCents - patientRespCents,
    patientBalanceCents: patientRespCents - patientPaidCents + refunds,
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
}

/** Creates a corrected claim (frequency code 7) from a denied/rejected claim. */
export async function createCorrectedClaim(db: Db, claimId: string, userId?: string) {
  const bundle = await loadClaimBundle(db, claimId);
  if (!bundle) throw new Error("Claim not found");
  const [created] = await db
    .insert(claims)
    .values({
      practiceId: bundle.claim.practiceId,
      encounterId: bundle.claim.encounterId,
      patientId: bundle.claim.patientId,
      payerId: bundle.claim.payerId,
      patientInsuranceId: bundle.claim.patientInsuranceId,
      controlNumber: await nextControlNumber(db, bundle.claim.practiceId),
      frequencyCode: "7",
      totalCents: bundle.claim.totalCents,
      status: "draft",
      timelyFilingDeadline: bundle.claim.timelyFilingDeadline,
    })
    .returning();
  // Move charge ledger entries to the new claim so AR follows the live claim.
  await db.update(ledgerEntries).set({ claimId: created.id }).where(eq(ledgerEntries.claimId, claimId));
  await db.update(claims).set({ status: "closed", updatedAt: new Date() }).where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status: "closed", source: "user", message: `Replaced by corrected claim ${created.controlNumber}` });
  await db.insert(claimEvents).values({ claimId: created.id, status: "draft", source: "user", message: `Corrected claim (frequency 7) of ${bundle.claim.controlNumber}` });
  await db.update(denials).set({ status: "resolved", resolvedAt: new Date() }).where(eq(denials.claimId, claimId));
  await db.insert(schema.auditLog).values({ practiceId: bundle.claim.practiceId, userId: userId ?? null, action: "corrected_claim", entity: "claim", entityId: created.id, details: { original: claimId } });
  return rescrubClaim(db, created.id);
}
