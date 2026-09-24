import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { createAppointment } from "./encounters";
import {
  MAX_ATTEMPTS, applyCheckin, createCheckinLink, demographicChanges, hashToken, listCheckins, loadCheckin, normalizeDob, openLink,
  submitCheckin, verifyDob, type CheckinInput,
} from "./checkin";

describe("date of birth input", () => {
  it("accepts the ways people type it and rejects the rest", () => {
    expect(normalizeDob("1980-02-29")).toBe("1980-02-29");
    expect(normalizeDob("2/9/1980")).toBe("1980-02-09");
    expect(normalizeDob("02.09.1980")).toBe("1980-02-09");
    expect(normalizeDob("Feb 9 1980")).toBeNull();
  });

  it("reports only real changes and treats a blank as no answer", () => {
    const current = { phone: "555-0100", email: "a@b.com", address1: "1 Main", city: "Dallas", state: "TX", zip: "75201" };
    expect(demographicChanges(current, { ...current, email: "A@B.COM", zip: "" })).toEqual([]);
    expect(demographicChanges(current, { ...current, address1: "9 Oak" })).toEqual([{ field: "address1", label: "Address", from: "1 Main", to: "9 Oak" }]);
  });
});

describe("digital check-in against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patient: typeof schema.patients.$inferSelect;
  let insuranceId: string;
  let apptId: string;
  const input = (over: Partial<CheckinInput> = {}): CheckinInput => ({
    demographics: { phone: patient.phone ?? "", email: "new.address@example.com", address1: "77 Cedar Ln", city: patient.city ?? "", state: patient.state ?? "", zip: patient.zip ?? "" },
    insurance: { sameAsOnFile: true, payerName: "", memberId: "", groupNumber: "", relationship: "self" },
    consents: { privacyNotice: true, financialPolicy: true, assignmentOfBenefits: true, signature: `${patient.firstName} ${patient.lastName}` },
    ...over,
  });

  beforeAll(async () => {
    t = await testDb();
    const [row] = await t.db
      .select({ patient: schema.patients, ins: schema.patientInsurances })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true), eq(schema.patientInsurances.rank, 1)))
      .limit(1);
    patient = row.patient;
    insuranceId = row.ins.id;
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const appt = await createAppointment(t.db, t.practiceId, { patientId: patient.id, providerId: provider.id, startsAt: new Date(Date.now() + 26 * 3_600_000), minutes: 20, type: "office_visit" });
    apptId = appt.id;
  });
  afterAll(async () => { await t?.close(); });

  it("stores only a hash of the token and reveals nothing but the practice before verification", async () => {
    const { token, link } = await createCheckinLink(t.db, t.practiceId, apptId, t.userId);
    expect(link.tokenHash).toBe(hashToken(token));
    expect(link.tokenHash).not.toContain(token);
    const opened = await openLink(t.db, token);
    expect(opened.state).toBe("open");
    expect(Object.keys(opened).sort()).toEqual(["link", "practiceName", "practicePhone", "state"]);
    expect((await openLink(t.db, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).state).toBe("invalid");
  });

  it("will not create a link for another practice's appointment", async () => {
    const [other] = await t.db.insert(schema.practices).values({ name: "Elsewhere", taxId: "22-2222222", npi: "2222222223", address1: "2 Elm", city: "Austin", state: "TX", zip: "78701" }).returning();
    await expect(createCheckinLink(t.db, other.id, apptId)).rejects.toThrow("Appointment not found");
  });

  it("locks the link after repeated wrong dates of birth, even with the right one after", async () => {
    const { token } = await createCheckinLink(t.db, t.practiceId, apptId);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await verifyDob(t.db, token, "1901-01-01")).toMatchObject({ ok: false, message: expect.stringMatching(/tr(y|ies) left/) });
    }
    expect(await verifyDob(t.db, token, "1901-01-01")).toMatchObject({ ok: false, message: expect.stringMatching(/locked/) });
    expect((await verifyDob(t.db, token, patient.dob)).ok).toBe(false);
    expect((await openLink(t.db, token)).state).toBe("locked");
  });

  it("retires the previous link when a new one is sent", async () => {
    const first = await createCheckinLink(t.db, t.practiceId, apptId);
    const second = await createCheckinLink(t.db, t.practiceId, apptId);
    expect((await openLink(t.db, first.token)).state).toBe("invalid");
    expect((await openLink(t.db, second.token)).state).toBe("open");
  });

  it("refuses a submission before the date of birth is confirmed, then takes one and holds it for review", async () => {
    const { token, link } = await createCheckinLink(t.db, t.practiceId, apptId);
    await expect(submitCheckin(t.db, link.id, input())).rejects.toThrow(/can no longer be used/);

    const v = await verifyDob(t.db, token, patient.dob.split("-").reverse().join("/").replace(/^(\d+)\/(\d+)\/(\d+)$/, "$2/$1/$3"));
    expect(v.ok).toBe(true);
    const loaded = await loadCheckin(t.db, link.id);
    expect(loaded?.patient.id).toBe(patient.id);
    expect(loaded?.insurance?.ins.id).toBe(insuranceId);

    await expect(submitCheckin(t.db, link.id, input({ consents: { ...input().consents, financialPolicy: false } }))).rejects.toThrow(/accept each notice/);
    await submitCheckin(t.db, link.id, input());
    expect((await openLink(t.db, token)).state).toBe("completed");
    await expect(submitCheckin(t.db, link.id, input())).rejects.toThrow(/can no longer be used/);

    // Nothing reaches the chart until staff apply it.
    const [unchanged] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, patient.id));
    expect(unchanged.address1).toBe(patient.address1);
    const [pending] = await listCheckins(t.db, t.practiceId);
    expect(pending.changes.map((c) => c.field).sort()).toEqual(["address1", "email"]);

    const notes = await applyCheckin(t.db, t.practiceId, pending.submission.id, t.userId);
    expect(notes).toEqual(["Email updated", "Address updated"]);
    const [applied] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, patient.id));
    expect(applied).toMatchObject({ address1: "77 Cedar Ln", email: "new.address@example.com" });
    await expect(applyCheckin(t.db, t.practiceId, pending.submission.id)).rejects.toThrow(/already reviewed/);
  });

  it("updates the member ID for a new card from the same payer and re-checks eligibility", async () => {
    const [payer] = await t.db
      .select({ name: schema.payers.name })
      .from(schema.patientInsurances)
      .innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(eq(schema.patientInsurances.id, insuranceId));
    const { token, link } = await createCheckinLink(t.db, t.practiceId, apptId);
    await verifyDob(t.db, token, patient.dob);
    await submitCheckin(t.db, link.id, input({ insurance: { sameAsOnFile: false, payerName: payer.name.toUpperCase(), memberId: "NEWCARD123A", groupNumber: "G77", relationship: "self" } }));
    const [pending] = await listCheckins(t.db, t.practiceId);
    const notes = await applyCheckin(t.db, t.practiceId, pending.submission.id, t.userId);
    expect(notes.at(-1)).toBe("Member ID updated; eligibility re-checked: active");
    const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.id, insuranceId));
    expect(ins).toMatchObject({ memberId: "NEWCARD123A", groupNumber: "G77" });
  });
});
