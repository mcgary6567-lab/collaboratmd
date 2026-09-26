import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { estimateForAppointment, openDeposits, typicalService, upcomingVisits } from "./pre-visit";
import { importLegacyAr, legacySummary, closeLegacyItem } from "./legacy-ar";
import { saveFinancing } from "./admin";
import { patientBalanceCents } from "./billing";
import { createPortalLink, portalData } from "./portal";

describe("pre-visit estimates, legacy balances and financing", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patient: typeof schema.patients.$inferSelect;
  let providerId: string;
  beforeAll(async () => {
    t = await testDb();
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    [patient] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, claim.patientId));
    const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.id, claim.encounterId));
    providerId = enc.providerId;
  });
  afterAll(async () => { await t?.close(); });

  it("estimates an upcoming visit from the provider's usual service and lets the patient pay ahead", async () => {
    const starts = new Date(Date.now() + 3 * 86_400_000);
    const [appt] = await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: patient.id, providerId, startsAt: starts, endsAt: new Date(starts.getTime() + 1_800_000), type: "office_visit" }).returning();
    expect((await typicalService(t.db, t.practiceId, providerId, "office_visit")).cpt).toMatch(/^[0-9A-Z]{5}$/);
    const est = await estimateForAppointment(t.db, t.practiceId, appt.id, t.userId, "99213");
    expect(est).toMatchObject({ appointmentId: appt.id });
    expect((await upcomingVisits(t.db, t.practiceId)).find((v) => v.appt.id === appt.id)?.estimate?.id).toBe(est.id);
    expect(await openDeposits(t.db, patient.id)).toHaveLength(0);
    await t.db.update(schema.estimates).set({ depositRequestedAt: new Date(), patientOwesCents: 4_000 }).where(eq(schema.estimates.id, est.id));
    expect((await openDeposits(t.db, patient.id)).map((d) => d.amountCents)).toEqual([4_000]);
    const { path } = await createPortalLink(t.db, t.practiceId, patient.id, t.userId, "pay");
    const [link] = await t.db.select().from(schema.portalLinks).where(eq(schema.portalLinks.patientId, patient.id)).orderBy(schema.portalLinks.createdAt);
    expect(path).toContain("/portal/");
    const data = (await portalData(t.db, link.id))!;
    // Any existing credit counts toward the deposit.
    expect(data.depositDue).toBe(Math.max(0, 4_000 - Math.max(0, -data.balance)));
  });

  it("imports previous-system balances: patient ones onto the ledger, insurance ones to work", async () => {
    const before = await patientBalanceCents(t.db, patient.id);
    const csv = [
      "MRN,Payer,Claim Number,DOS,Billed,Balance,Responsibility",
      `${patient.mrn},,OLD-1,03/15/2026,200.00,45.50,patient`,
      `${patient.mrn},Aetna,OLD-2,2026-03-20,900.00,$612.00,insurance`,
      "NOPE123,Aetna,OLD-3,2026-03-21,100.00,100.00,insurance",
      `${patient.mrn},Aetna,OLD-4,2026-03-22,100.00,0,insurance`,
    ].join("\n");
    const r = await importLegacyAr(t.db, t.practiceId, csv, "Cutover", t.userId);
    expect(r).toMatchObject({ imported: 2, patientCents: 4_550, insuranceCents: 61_200 });
    expect(r.problems.map((p) => p.row)).toEqual([4, 5]);
    expect(await patientBalanceCents(t.db, patient.id)).toBe(before + 4_550);
    await expect(importLegacyAr(t.db, t.practiceId, csv, "Cutover")).rejects.toThrow(/already imported/);
    await expect(importLegacyAr(t.db, t.practiceId, "Payer,Amount\nx,1", "Other")).rejects.toThrow(/No balance column/);
    const [item] = await t.db.select().from(schema.legacyAr).where(and(eq(schema.legacyAr.practiceId, t.practiceId), eq(schema.legacyAr.sourceClaimNumber, "OLD-2")));
    await closeLegacyItem(t.db, t.practiceId, item.id, "collected", t.userId);
    await expect(closeLegacyItem(t.db, t.practiceId, item.id, "written_off")).rejects.toThrow(/already closed/);
    expect((await legacySummary(t.db, t.practiceId)).find((x) => x.responsibility === "insurance" && x.status === "collected")?.cents).toBe(61_200);
  });

  it("offers the practice's financing lender in the portal above the minimum balance", async () => {
    await expect(saveFinancing(t.db, t.practiceId, { lender: "Lendco", url: "http://insecure.example", minCents: 50_000 })).rejects.toThrow(/https/);
    await saveFinancing(t.db, t.practiceId, { lender: "Lendco", url: "https://apply.example/practice", minCents: 1 }, t.userId);
    await createPortalLink(t.db, t.practiceId, patient.id, t.userId, "portal");
    const [link] = await t.db.select().from(schema.portalLinks).where(eq(schema.portalLinks.patientId, patient.id)).limit(1);
    const data = (await portalData(t.db, link.id))!;
    expect(data.financing).toEqual(data.balance >= 1 ? { lender: "Lendco", url: "https://apply.example/practice", minCents: 1 } : null);
    await saveFinancing(t.db, t.practiceId, null, t.userId);
    expect((await portalData(t.db, link.id))!.financing).toBeNull();
  });
});
