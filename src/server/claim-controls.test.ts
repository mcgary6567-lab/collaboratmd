import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { buildEdi835 } from "@/lib/edi/x835";
import { tokenize } from "@/lib/edi/x12";
import { createEncounterWithClaim } from "./encounters";
import {
  createCorrectedClaim, fetchAndPostRemittances, getClaimFinancials, importRemittance, listAcknowledgments,
  postRemittance, submitClaim, voidClaim,
} from "./claims";
import { createAuthorization, createPayerEdit } from "./payer-edits";

type T = Awaited<ReturnType<typeof testDb>>;

describe("claim controls against a migrated database", () => {
  let t: T;
  let patientId: string;
  let providerId: string;
  let insuranceId: string;
  let payer: typeof schema.payers.$inferSelect;
  const dos = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    t = await testDb();
    const [row] = await t.db
      .select({ patient: schema.patients, ins: schema.patientInsurances, payer: schema.payers })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true)))
      .limit(1);
    patientId = row.patient.id;
    insuranceId = row.ins.id;
    payer = row.payer;
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = provider.id;
  });
  afterAll(async () => { await t?.close(); });

  async function setMemberId(memberId: string) {
    await t.db.update(schema.patientInsurances).set({ memberId }).where(eq(schema.patientInsurances.id, insuranceId));
  }

  async function newClaim(cpt = "99213", chargeCents = 15_000) {
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, {
      patientId, providerId, dateOfService: dos, placeOfService: "11", diagnoses: ["E11.9"],
      lines: [{ cpt, modifiers: [], units: 1, chargeCents, dxPointers: [1] }],
    });
    return claim;
  }

  /** Posts an ERA for a claim as the payer would send it. */
  async function remit(claim: typeof schema.claims.$inferSelect, outcome: "paid" | "denied") {
    const c = outcome === "paid"
      ? { statusCode: "1", paidCents: 9_000, patientResponsibilityCents: 2_000, adjustments: [],
          lines: [{ cpt: "99213", chargedCents: claim.totalCents, paidCents: 9_000, units: 1, adjustments: [{ group: "CO", reason: "45", amountCents: claim.totalCents - 11_000 }, { group: "PR", reason: "3", amountCents: 2_000 }] }] }
      : { statusCode: "4", paidCents: 0, patientResponsibilityCents: 0, adjustments: [],
          lines: [{ cpt: "99213", chargedCents: claim.totalCents, paidCents: 0, units: 1, adjustments: [{ group: "CO", reason: "16", amountCents: claim.totalCents }], remarks: ["M51"] }] };
    const raw = buildEdi835({
      payerName: payer.name, payerId: payer.payerId, checkNumber: `EFT-${claim.controlNumber}`, paymentDate: new Date(),
      claims: [{ patientControlNumber: claim.controlNumber, payerClaimNumber: `PCN-${claim.controlNumber}`, chargedCents: claim.totalCents, ...c }],
    });
    await postRemittance(t.db, await importRemittance(t.db, t.practiceId, raw));
  }

  const reload = async (id: string) => (await t.db.select().from(schema.claims).where(eq(schema.claims.id, id)))[0];

  it("stores the 999 and 277CA for an accepted claim", async () => {
    await setMemberId("ZZ100200A");
    const claim = await newClaim();
    const { status } = await submitClaim(t.db, claim.id);
    expect(status).toBe("accepted");
    const acks = await listAcknowledgments(t.db, claim.id);
    expect(acks.map((a) => [a.kind, a.accepted])).toEqual([["999", true], ["277CA", true]]);
    expect(acks[1].code).toBe("A2:20");
    expect(acks[1].raw).toContain("STC*A2:20");
  });

  it("records a front-end rejection and resubmits it as a new claim, since the payer never saw it", async () => {
    await setMemberId("ZZ100200X");
    const claim = await newClaim();
    const { status } = await submitClaim(t.db, claim.id);
    expect(status).toBe("rejected");
    const acks = await listAcknowledgments(t.db, claim.id);
    expect(acks.find((a) => a.kind === "277CA")).toMatchObject({ accepted: false, code: "A7:164:IL" });

    await setMemberId("ZZ100200A");
    const corrected = await createCorrectedClaim(t.db, claim.id);
    expect(corrected.frequencyCode).toBe("1");
    expect(corrected.originalClaimId).toBe(claim.id);
    expect((await reload(claim.id)).status).toBe("closed");
  });

  it("corrects an adjudicated denial as a replacement that cites the payer's claim number", async () => {
    await setMemberId("ZZ100300A");
    const claim = await newClaim();
    await submitClaim(t.db, claim.id);
    await remit(await reload(claim.id), "denied");
    expect((await reload(claim.id)).status).toBe("denied");

    const corrected = await createCorrectedClaim(t.db, claim.id);
    expect(corrected).toMatchObject({ frequencyCode: "7", originalPayerClaimNumber: `PCN-${claim.controlNumber}`, status: "ready" });
    await submitClaim(t.db, corrected.id);
    const segs = tokenize((await reload(corrected.id)).edi837!).segments.map((s) => s.join("*"));
    expect(segs).toContain(`REF*F8*PCN-${claim.controlNumber}`);
    expect(segs.find((s) => s.startsWith("CLM*"))).toContain(":B:7");
  });

  it("stops a claim that needs prior authorization, then sends REF*G1 and draws down the units", async () => {
    await setMemberId("ZZ100400A");
    await createPayerEdit(t.db, t.practiceId, { payerId: payer.id, kind: "auth_required", cpt: "70553", severity: "error" });
    const blocked = await newClaim("70553", 120_000);
    expect(blocked.status).toBe("scrub_errors");
    expect(blocked.scrubResults.map((f) => f.rule)).toContain("PAYER_AUTH");
    await expect(submitClaim(t.db, blocked.id)).rejects.toThrow(/blocking/);

    const auth = await createAuthorization(t.db, t.practiceId, {
      patientId, payerId: payer.id, authNumber: "AUTH-7781", cpts: ["70553"], unitsApproved: 1, validFrom: dos, validTo: dos,
    });
    const claim = await newClaim("70553", 120_000);
    expect(claim).toMatchObject({ status: "ready", authorizationNumber: "AUTH-7781" });
    expect((await submitClaim(t.db, claim.id)).status).toBe("accepted");
    expect((await reload(claim.id)).edi837).toContain("REF*G1*AUTH-7781");
    const [after] = await t.db.select().from(schema.authorizations).where(eq(schema.authorizations.id, auth.id));
    expect(after.unitsUsed).toBe(1);

    // The single approved unit is used up, so a second MRI is stopped again.
    expect((await newClaim("70553", 120_000)).status).toBe("scrub_errors");
  });

  it("voids a paid claim: the payer's reversal recoups the payment and the charge leaves A/R", async () => {
    await setMemberId("ZZ100500A");
    const claim = await newClaim();
    await submitClaim(t.db, claim.id);
    await remit(await reload(claim.id), "paid");
    expect(await getClaimFinancials(t.db, claim.id)).toMatchObject({ insurancePaidCents: 9_000, patientRespCents: 2_000, insuranceBalanceCents: 0 });

    await expect(createCorrectedClaim(t.db, claim.id)).rejects.toThrow(/cannot be corrected/);
    const v = await voidClaim(t.db, claim.id, "Billed under the wrong patient");
    expect(v).toMatchObject({ frequencyCode: "8", originalPayerClaimNumber: `PCN-${claim.controlNumber}`, status: "ready" });
    await expect(voidClaim(t.db, claim.id, "again")).rejects.toThrow(/already exists/);

    expect((await submitClaim(t.db, v.id)).status).toBe("accepted");
    expect((await reload(v.id)).edi837).toContain(`REF*F8*PCN-${claim.controlNumber}`);
    expect((await reload(claim.id)).status).toBe("void_pending");

    expect(await fetchAndPostRemittances(t.db, t.practiceId, undefined, [v.id])).toBe(1);
    expect((await reload(claim.id)).status).toBe("voided");
    expect((await reload(v.id)).status).toBe("closed");
    const fin = await getClaimFinancials(t.db, claim.id);
    expect(fin).toMatchObject({ insurancePaidCents: 0, patientRespCents: 0, insuranceBalanceCents: 0, patientBalanceCents: 0 });

    const entries = await t.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.claimId, claim.id));
    expect(entries.filter((e) => e.type === "reversal").map((e) => e.amountCents)).toEqual([9_000]);

    // Nothing is left to reverse: a second pull does not recoup twice.
    expect(await fetchAndPostRemittances(t.db, t.practiceId, undefined, [v.id])).toBe(0);
  });
});
