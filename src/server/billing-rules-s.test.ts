import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { createEncounterWithClaim } from "./encounters";
import { generateStatement, patientBalanceCents } from "./billing";
import { closeHold, heldPatientIds, holdReason, listHolds, recordBankruptcy, recordClaimFiled, recordDeath } from "./account-holds";
import { adultDependents, isAdult, markMailReturned, recordAdultConsent, releaseAdultDependent, returnedMail, updateAddress } from "./account-review";
import { billTo } from "./patient-accounts";
import { applyCollected, frontDeskCollections, weekOf } from "./pos-collections";
import { cleanReferral, referralReport } from "./referrals";
import { createPatient } from "./patients";
import { closeComplaint, listComplaints, logComplaint, updateInvestigation } from "./privacy-complaints";
import { costToCollect, monthsBetween, saveCosts } from "./cost-to-collect";

describe("pure parts", () => {
  it("knows when a dependent is an adult", () => {
    expect(isAdult("2008-10-01", "2026-10-01")).toBe(true);
    expect(isAdult("2008-10-02", "2026-10-01")).toBe(false);
    expect(isAdult("2008-02-29", "2026-02-28")).toBe(false);
  });

  it("splits a visit's payment between the copay and the prior balance", () => {
    expect(applyCollected(2_500, 4_000, 5_000)).toEqual({ copay: 2_500, prior: 2_500 });
    expect(applyCollected(2_500, 0, 9_000)).toEqual({ copay: 2_500, prior: 0 });
    expect(applyCollected(2_500, 4_000, 1_000)).toEqual({ copay: 1_000, prior: 0 });
    expect(weekOf("2026-09-30")).toBe("2026-09-28");
    expect(weekOf("2026-09-28")).toBe("2026-09-28");
    expect(weekOf("2026-10-04")).toBe("2026-09-28");
  });

  it("lists months and checks referral sources", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(cleanReferral("physician", " Dr. Lee ")).toEqual({ referralSource: "physician", referralDetail: "Dr. Lee" });
    expect(cleanReferral("", "ignored")).toEqual({ referralSource: null, referralDetail: null });
    expect(() => cleanReferral("billboard", "")).toThrow(/heard/);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let commercial: typeof schema.payers.$inferSelect;
  const newPatient = async (mrn: string, extra: Partial<typeof schema.patients.$inferInsert> = {}, copayCents = 0) => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn, firstName: "Dana", lastName: `Test${mrn.replace(/\W/g, "")}`, dob: "1960-02-02", sex: "F", ...extra }).returning();
    await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: commercial.id, memberId: `${mrn.replace(/\W/g, "")}M`, relationship: "self", copayCents });
    return p;
  };
  const owe = (patientId: string, amountCents: number, postedAt?: Date) =>
    t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId, type: "transfer_to_patient", amountCents, ...(postedAt ? { postedAt } : {}) });
  const appt = async (patientId: string, startsAt: Date, status: string) =>
    (await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId, providerId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status }).returning())[0];

  beforeAll(async () => {
    t = await testDb();
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    [commercial] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
  });
  afterAll(async () => { await t?.close(); });

  it("stops billing in bankruptcy and writes off what was owed before the filing on discharge", async () => {
    const p = await newPatient("BK-1");
    await owe(p.id, 6_000, new Date("2026-05-01T12:00:00Z"));
    await owe(p.id, 1_500, new Date("2026-07-01T12:00:00Z"));
    await expect(recordBankruptcy(t.db, t.practiceId, { patientId: p.id, chapter: "9", caseNumber: "x", filedOn: "2026-06-15" })).rejects.toThrow(/chapter/);
    const hold = await recordBankruptcy(t.db, t.practiceId, { patientId: p.id, chapter: "7", caseNumber: "26-10442", court: "M.D. Fla.", filedOn: "2026-06-15", deadline: "2026-10-20" }, t.userId);
    await expect(recordBankruptcy(t.db, t.practiceId, { patientId: p.id, chapter: "7", caseNumber: "26-10442", filedOn: "2026-06-15" })).rejects.toThrow(/already/);
    expect(await holdReason(t.db, p.id)).toMatch(/bankruptcy/);
    expect((await heldPatientIds(t.db, t.practiceId)).has(p.id)).toBe(true);
    await expect(generateStatement(t.db, t.practiceId, p.id)).rejects.toThrow(/automatic stay/);
    await recordClaimFiled(t.db, t.practiceId, hold.id, "2026-07-10");
    expect((await listHolds(t.db, t.practiceId)).find((h) => h.h.id === hold.id)).toMatchObject({ balanceCents: 7_500, h: { claimFiledOn: "2026-07-10" } });

    await expect(closeHold(t.db, t.practiceId, hold.id, { outcome: "estate_settled" })).rejects.toThrow(/how it ended/);
    expect(await closeHold(t.db, t.practiceId, hold.id, { outcome: "discharged" }, t.userId)).toEqual({ writtenOffCents: 6_000 });
    expect(await patientBalanceCents(t.db, p.id)).toBe(1_500); // care after the filing is still owed
    expect(await holdReason(t.db, p.id)).toBeNull();
  });

  it("records a death, cancels future visits and settles with the estate", async () => {
    const p = await newPatient("DEC-1");
    await owe(p.id, 5_000);
    const future = await appt(p.id, new Date(Date.now() + 7 * 86_400_000), "scheduled");
    const r = await recordDeath(t.db, t.practiceId, { patientId: p.id, diedOn: "2026-09-01", executor: "Sam Doe", executorAddress: "1 Main St, Tampa FL 33601", deadline: "2026-12-01" }, t.userId);
    expect(r.cancelledAppointments).toBe(1);
    const [a] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.id, future.id));
    expect(a.status).toBe("cancelled");
    await expect(generateStatement(t.db, t.practiceId, p.id)).rejects.toThrow(/estate/);
    expect(await closeHold(t.db, t.practiceId, r.hold.id, { outcome: "estate_settled", paidCents: 1_000, method: "check 88" })).toEqual({ writtenOffCents: 4_000 });
    expect(await patientBalanceCents(t.db, p.id)).toBe(0);
    const [paid] = await t.db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.patientId, p.id), eq(schema.ledgerEntries.type, "patient_payment")));
    expect(paid.paymentMethod).toBe("estate");
  });

  it("marks returned mail, stops mailing, and clears when the address changes by any route", async () => {
    const p = await newPatient("MAIL-1", { address1: "1 Old Rd", city: "Orlando", state: "FL", zip: "32801" });
    await owe(p.id, 2_000);
    await markMailReturned(t.db, t.practiceId, p.id, { on: "2026-09-20", note: "Moved, left no address" }, t.userId);
    const listed = (await returnedMail(t.db, t.practiceId)).find((r) => r.id === p.id);
    expect(listed).toMatchObject({ since: "2026-09-20", note: "Moved, left no address", balanceCents: 2_000 });
    await expect(updateAddress(t.db, t.practiceId, p.id, { address1: "2 New Ave", city: "Tampa", state: "fl", zip: "3360" })).rejects.toThrow(/ZIP/);
    await updateAddress(t.db, t.practiceId, p.id, { address1: "2 New Ave", city: "Tampa", state: "fl", zip: "33602" }, t.userId);
    let [row] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, p.id));
    expect([row.addressBadSince, row.state, row.city]).toEqual([null, "FL", "Tampa"]);

    // An address changed elsewhere (online check-in, HL7, import) clears the mark too, through the trigger.
    await markMailReturned(t.db, t.practiceId, p.id, {});
    await t.db.update(schema.patients).set({ zip: "33603" }).where(eq(schema.patients.id, p.id));
    [row] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, p.id));
    expect(row.addressBadSince).toBeNull();
    // Other edits leave it alone; confirming the same address clears it by hand.
    await markMailReturned(t.db, t.practiceId, p.id, {});
    await t.db.update(schema.patients).set({ phone: "4075550100" }).where(eq(schema.patients.id, p.id));
    [row] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, p.id));
    expect(row.addressBadSince).not.toBeNull();
    await updateAddress(t.db, t.practiceId, p.id, { address1: "2 New Ave", city: "Tampa", state: "FL", zip: "33603" });
    [row] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, p.id));
    expect(row.addressBadSince).toBeNull();
  });

  it("moves adult dependents off the guarantor's statements unless they agree", async () => {
    const parent = await newPatient("ADULT-P", { dob: "1970-01-01" });
    const grown = await newPatient("ADULT-K1", { dob: "2000-05-05", guarantorId: parent.id });
    const minor = await newPatient("ADULT-K2", { dob: "2015-05-05", guarantorId: parent.id });
    const list = await adultDependents(t.db, t.practiceId);
    expect(list.map((d) => d.id)).toContain(grown.id);
    expect(list.map((d) => d.id)).not.toContain(minor.id);
    expect(list.find((d) => d.id === grown.id)?.guarantorId).toBe(parent.id);
    expect(await billTo(t.db, grown.id)).toBeNull();
    expect((await billTo(t.db, minor.id))?.id).toBe(parent.id);

    await recordAdultConsent(t.db, t.practiceId, grown.id, "2026-09-01", t.userId);
    expect((await billTo(t.db, grown.id))?.id).toBe(parent.id);
    expect((await adultDependents(t.db, t.practiceId)).map((d) => d.id)).not.toContain(grown.id);
    await releaseAdultDependent(t.db, t.practiceId, grown.id);
    const [row] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, grown.id));
    expect([row.guarantorId, row.guarantorAdultConsentOn]).toEqual([null, null]);
    await expect(recordAdultConsent(t.db, t.practiceId, grown.id, "2026-09-01")).rejects.toThrow(/no guarantor/);
  });

  it("measures what the front desk collected against what was due", async () => {
    const p = await newPatient("POS-1", {}, 2_500);
    await owe(p.id, 4_000, new Date("2025-03-01T15:00:00Z"));
    await appt(p.id, new Date("2025-03-12T15:00:00Z"), "checked_in");
    await appt(p.id, new Date("2025-03-12T17:00:00Z"), "completed"); // same day: one visit
    const pay = (amountCents: number, paymentMethod: string, postedBy: string | null) =>
      t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: p.id, type: "patient_payment", amountCents, paymentMethod, postedBy, postedAt: new Date("2025-03-12T16:00:00Z") });
    await pay(5_000, "cash", t.userId);
    await pay(1_000, "card_on_file", null); // not the desk's
    const r = await frontDeskCollections(t.db, t.practiceId, "2025-03-12", "2025-03-12");
    expect(r.total).toEqual({ visits: 1, copayDueCents: 2_500, copayCollectedCents: 2_500, priorDueCents: 4_000, priorCollectedCents: 2_500, collectedCents: 5_000 });
    expect(r.byWeek).toEqual([{ week: "2025-03-10", ...r.total }]);
    expect(r.byStaff.reduce((a, s) => a + s.cents, 0)).toBe(5_000);
  });

  it("reports new patients by referral source", async () => {
    await expect(createPatient(t.db, t.practiceId, { firstName: "Ref", lastName: "Bad", dob: "1980-01-01", sex: "F", payerId: null, memberId: "", relationship: "self", copayCents: 0, referralSource: "billboard" })).rejects.toThrow(/heard/);
    const p = await createPatient(t.db, t.practiceId, { firstName: "Ref", lastName: "Doctor", dob: "1980-01-01", sex: "F", payerId: commercial.id, memberId: "REFDOC1", relationship: "self", copayCents: 0, referralSource: "physician", referralDetail: "Dr. Lee" });
    await createPatient(t.db, t.practiceId, { firstName: "Ref", lastName: "Web", dob: "1981-01-01", sex: "M", payerId: null, memberId: "", relationship: "self", copayCents: 0, referralSource: "website" });
    await createEncounterWithClaim(t.db, t.practiceId, { patientId: p.id, providerId, dateOfService: "2026-09-20", placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "99203", modifiers: [], units: 1, chargeCents: 18_000, dxPointers: [1] }] });
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: p.id, type: "patient_payment", amountCents: 4_000 });
    const today = new Date().toISOString().slice(0, 10);
    const r = await referralReport(t.db, t.practiceId, today, today);
    expect(r.sources.find((s) => s.source === "physician")).toMatchObject({ patients: 1, seen: 1, chargesCents: 18_000, collectedCents: 4_000, label: "Another physician" });
    expect(r.sources.find((s) => s.source === "website")?.patients).toBe(1);
    expect(r.doctors).toContainEqual({ name: "Dr. Lee", patients: 1 });
    expect(r.recordedShare).toBeGreaterThan(0);
  });

  it("logs a privacy complaint through investigation to its answer", async () => {
    await newPatient("PRIV-1");
    await expect(logComplaint(t.db, t.practiceId, { receivedOn: "2026-09-01", channel: "fax", complainant: "x", category: "access", description: "y" })).rejects.toThrow(/how the complaint/);
    const c = await logComplaint(t.db, t.practiceId, { receivedOn: "2026-08-01", channel: "phone", complainant: "The patient", patientMrn: "PRIV-1", category: "improper_disclosure", description: "Front desk read my diagnosis aloud in the waiting room" }, t.userId);
    expect(c.patientId).not.toBeNull();
    await expect(closeComplaint(t.db, t.practiceId, c.id, "2026-08-20")).rejects.toThrow(/investigation/);
    await updateInvestigation(t.db, t.practiceId, c.id, { investigation: "Spoke with staff; confirmed", finding: "substantiated" });
    await expect(closeComplaint(t.db, t.practiceId, c.id, "2026-08-20")).rejects.toThrow(/mitigate/);
    await updateInvestigation(t.db, t.practiceId, c.id, { mitigation: "Retrained the front desk; check-in now at the window", sanctions: "Verbal warning" });
    const listed = (await listComplaints(t.db, t.practiceId, new Date("2026-09-15T12:00:00Z"))).find((x) => x.c.id === c.id);
    expect(listed).toMatchObject({ overdue: true, daysOpen: 45 });
    await expect(closeComplaint(t.db, t.practiceId, c.id, "2026-07-01")).rejects.toThrow(/before/);
    await closeComplaint(t.db, t.practiceId, c.id, "2026-08-20", t.userId);
    expect((await listComplaints(t.db, t.practiceId)).find((x) => x.c.id === c.id)).toMatchObject({ overdue: false, c: { status: "closed", respondedOn: "2026-08-20" } });
    await expect(updateInvestigation(t.db, t.practiceId, c.id, { investigation: "more" })).rejects.toThrow(/closed/);
  });

  it("works out cost to collect from entered costs, agency commissions and collections", async () => {
    const p = await newPatient("CTC-1");
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: p.id, type: "patient_payment", amountCents: 1_000_000, postedAt: new Date("2025-04-15T12:00:00Z") });
    const [col] = await t.db.insert(schema.patientCollections).values({ practiceId: t.practiceId, patientId: p.id, stage: "agency", agency: "Acme", amountCents: 50_000, placedAt: new Date("2025-02-01T00:00:00Z") }).returning();
    await t.db.insert(schema.agencyRecoveries).values({ practiceId: t.practiceId, collectionId: col.id, receivedOn: "2025-04-20", grossCents: 20_000, commissionCents: 5_000 });
    await expect(saveCosts(t.db, t.practiceId, "2025-13", { staff: 1 })).rejects.toThrow(/month/);
    await saveCosts(t.db, t.practiceId, "2025-04", { staff: 300_000, clearinghouse: 20_000, software: 0 }, t.userId);
    await saveCosts(t.db, t.practiceId, "2025-04", { staff: 300_000, clearinghouse: 15_000 }); // updated, not added
    const r = await costToCollect(t.db, t.practiceId, "2025-03", "2025-04");
    expect(r.rows.map((x) => x.month)).toEqual(["2025-03", "2025-04"]);
    const april = r.rows[1];
    expect(april).toMatchObject({ byCategory: { staff: 300_000, clearinghouse: 15_000 }, agencyCents: 5_000, costCents: 320_000, entered: true });
    expect(april.collectedCents).toBeGreaterThanOrEqual(1_000_000);
    expect(april.pct).toBeCloseTo(320_000 / april.collectedCents);
    expect(r.rows[0].entered).toBe(false);
    expect(r.monthsEntered).toBe(1);
    await saveCosts(t.db, t.practiceId, "2025-04", { clearinghouse: 0 });
    expect((await costToCollect(t.db, t.practiceId, "2025-04", "2025-04")).rows[0].byCategory).toEqual({ staff: 300_000 });
  });
});
