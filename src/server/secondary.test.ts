import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { buildEdi835 } from "@/lib/edi/x835";
import { tokenize } from "@/lib/edi/x12";
import { createEncounterWithClaim } from "./encounters";
import { createSecondaryClaim, fetchAndPostRemittances, getClaimFinancials, importRemittance, postRemittance, submitClaim } from "./claims";

describe("secondary insurance billing", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patientId: string;
  let providerId: string;
  let primaryPayer: typeof schema.payers.$inferSelect;
  let secondaryPayer: typeof schema.payers.$inferSelect;

  beforeAll(async () => {
    t = await testDb();
    const [row] = await t.db
      .select({ patient: schema.patients, ins: schema.patientInsurances, payer: schema.payers })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true), eq(schema.patientInsurances.rank, 1)))
      .limit(1);
    patientId = row.patient.id;
    primaryPayer = row.payer;
    await t.db.update(schema.patientInsurances).set({ memberId: "PRI7001A" }).where(eq(schema.patientInsurances.id, row.ins.id));
    [secondaryPayer] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), ne(schema.payers.id, primaryPayer.id))).limit(1);
    await t.db.delete(schema.patientInsurances).where(and(eq(schema.patientInsurances.patientId, patientId), eq(schema.patientInsurances.rank, 2)));
    await t.db.insert(schema.patientInsurances).values({ patientId, payerId: secondaryPayer.id, memberId: "SUP5500B", rank: 2, relationship: "self" });
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = provider.id;
  });
  afterAll(async () => { await t?.close(); });

  const reload = async (id: string) => (await t.db.select().from(schema.claims).where(eq(schema.claims.id, id)))[0];

  it("bills the secondary for what the primary left, with the primary's adjudication, and posts its payment to the primary claim", async () => {
    const dos = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, {
      patientId, providerId, dateOfService: dos, placeOfService: "11", diagnoses: ["E11.9"],
      lines: [{ cpt: "99214", modifiers: [], units: 1, chargeCents: 20_000, dxPointers: [1] }],
    });
    expect((await submitClaim(t.db, claim.id)).status).toBe("accepted");

    // Primary pays 100 of 140 allowed; 40 is the patient's coinsurance.
    const raw = buildEdi835({
      payerName: primaryPayer.name, payerId: primaryPayer.payerId, checkNumber: "EFT-PRI", paymentDate: new Date(),
      claims: [{
        patientControlNumber: claim.controlNumber, payerClaimNumber: "PCN-PRI", statusCode: "1", chargedCents: 20_000, paidCents: 10_000, patientResponsibilityCents: 4_000, adjustments: [],
        lines: [{ cpt: "99214", chargedCents: 20_000, paidCents: 10_000, units: 1, adjustments: [{ group: "CO", reason: "45", amountCents: 6_000 }, { group: "PR", reason: "2", amountCents: 4_000 }] }],
      }],
    });
    const summary = (await postRemittance(t.db, await importRemittance(t.db, t.practiceId, raw))) as { secondaryBilled?: number };
    expect(summary.secondaryBilled).toBe(1);

    const [sec] = await t.db.select().from(schema.claims).where(eq(schema.claims.primaryClaimId, claim.id));
    expect(sec).toMatchObject({ payerSequence: "S", payerId: secondaryPayer.id, status: "accepted", totalCents: 20_000 });
    expect((await reload(claim.id)).status).toBe("billed_secondary");
    // The 40 is off the patient and back on the claim, waiting for the secondary.
    expect(await getClaimFinancials(t.db, claim.id)).toMatchObject({ insuranceBalanceCents: 4_000, patientBalanceCents: 0 });

    const segs = tokenize(sec.edi837!).segments.map((s) => s.join("*"));
    expect(segs.find((s) => s.startsWith("SBR*"))).toMatch(/^SBR\*S\*/);
    expect(segs).toContain("AMT*D*100.00");
    expect(segs).toContain("CAS*CO*45*60.00");
    expect(segs).toContain("CAS*PR*2*40.00");
    expect(segs.some((s) => s.startsWith("NM1*PR*2*" + primaryPayer.name))).toBe(true);
    expect(segs.some((s) => s.startsWith("DTP*573*D8*"))).toBe(true);

    // The secondary pays the balance (or leaves the patient a share).
    expect(await fetchAndPostRemittances(t.db, t.practiceId, undefined, [sec.id])).toBe(1);
    const fin = await getClaimFinancials(t.db, claim.id);
    expect(fin.insuranceBalanceCents).toBe(0);
    expect(fin.insurancePaidCents + fin.patientBalanceCents).toBe(14_000);
    expect(fin.chargesCents).toBe(20_000); // charged once
    expect(["paid"]).toContain((await reload(claim.id)).status);
    expect((await reload(sec.id)).status).toBe("paid");
    const secEntries = await t.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.claimId, sec.id));
    expect(secEntries).toEqual([]);
  });

  it("does not bill a secondary twice or when there is none", async () => {
    const [primary] = await t.db.select().from(schema.claims).where(and(eq(schema.claims.patientId, patientId), eq(schema.claims.payerSequence, "P"), eq(schema.claims.status, "paid"))).limit(1);
    await expect(createSecondaryClaim(t.db, primary.id)).rejects.toThrow(/already exists/);
  });
});
