import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { demoOpen, isDemoEmail } from "@/lib/demo";
import { checkUsAddress, fmtPhone, isUsState, normalizePhone, normalizeZip } from "@/lib/us";
import { isPlatformOperator } from "./code-sets";
import { createPatient } from "./patients";
import { addInsurance } from "./coverage";
import { buildClaimEdi, claimParties } from "./claim-edi";
import { payerDefaults, saveProfile, savePayer } from "./admin";
import { createEncounterWithClaim } from "./encounters";
import { loadClaimBundle } from "./claims";
import { validateLocation } from "./locations";

describe("launch readiness", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  const env = { ...process.env };
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => {
    for (const k of ["DEMO_LOGINS", "VERCEL_ENV", "PLATFORM_ADMIN_EMAILS"]) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  });

  it("opens the demo everywhere unless it is switched off, and never makes a demo account an operator on production", () => {
    expect(isDemoEmail("biller@collaboratmd.local")).toBe(true);
    expect(isDemoEmail("jane@clinic.com")).toBe(false);
    delete process.env.VERCEL_ENV;
    delete process.env.DEMO_LOGINS;
    expect(demoOpen()).toBe(true);
    process.env.VERCEL_ENV = "production";
    expect(demoOpen()).toBe(true);
    process.env.DEMO_LOGINS = "off";
    expect(demoOpen()).toBe(false);
    process.env.DEMO_LOGINS = "on";
    expect(demoOpen()).toBe(true);
    process.env.PLATFORM_ADMIN_EMAILS = "admin@collaboratmd.local,ops@company.com";
    expect(isPlatformOperator("admin@collaboratmd.local")).toBe(false);
    expect(isPlatformOperator("ops@company.com")).toBe(true);
    delete process.env.VERCEL_ENV;
    expect(isPlatformOperator("admin@collaboratmd.local")).toBe(true);
  });

  it("marks the seeded practice as the demo, the only one public pages read", async () => {
    const all = await t.db.select({ id: schema.practices.id, isDemo: schema.practices.isDemo }).from(schema.practices);
    expect(all.filter((p) => p.isDemo).map((p) => p.id)).toEqual([t.practiceId]);
  });

  it("formats and checks US addresses and phone numbers", () => {
    expect(isUsState("fl")).toBe(true);
    expect(isUsState("ZZ")).toBe(false);
    expect(normalizeZip("32801")).toBe("32801");
    expect(normalizeZip("328011234")).toBe("32801-1234");
    expect(normalizeZip("3280")).toBeNull();
    expect(normalizePhone("1-407-555-0100")).toBe("(407) 555-0100");
    expect(normalizePhone("555-0100")).toBeNull();
    expect(fmtPhone("4075550100")).toBe("(407) 555-0100");
    expect(fmtPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(() => checkUsAddress({ state: "ZZ" })).toThrow(/not a US state/);
    expect(() => checkUsAddress({ zip: "123" })).toThrow(/ZIP/);
    expect(() => checkUsAddress({ phone: "12345" })).toThrow(/10-digit/);
  });

  it("registers a self-pay patient with no insurance, and a dependent with the insured person", async () => {
    const [payer] = await t.db.select().from(schema.payers).where(eq(schema.payers.practiceId, t.practiceId)).limit(1);
    const selfPay = await createPatient(t.db, t.practiceId, { firstName: "Cash", lastName: "Only", dob: "1990-01-01", sex: "M", phone: "407.555.0199", state: "fl", zip: "32801", payerId: null, memberId: "", relationship: "self", copayCents: 0 });
    expect(selfPay).toMatchObject({ phone: "(407) 555-0199", state: "FL" });
    expect(await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.patientId, selfPay.id))).toHaveLength(0);

    const child = { firstName: "Sofia", lastName: "Reyes", dob: "2016-07-19", sex: "F", payerId: payer.id, memberId: "XYZ123", relationship: "child", copayCents: 0 };
    await expect(createPatient(t.db, t.practiceId, child)).rejects.toThrow(/insured person/);
    const p = await createPatient(t.db, t.practiceId, { ...child, subscriber: { firstName: "Ana", lastName: "Reyes", dob: "1984-03-02", sex: "F" } });
    const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.patientId, p.id));
    expect(ins).toMatchObject({ relationship: "child", subscriberFirstName: "Ana", subscriberDob: "1984-03-02" });
    const parties = claimParties(p, ins);
    expect(parties.subscriber).toMatchObject({ firstName: "Ana", relationship: "child", memberId: "XYZ123" });
    expect(parties.patient).toMatchObject({ firstName: "Sofia" });

    // Adding a spouse's plan later needs the same.
    await expect(addInsurance(t.db, t.practiceId, p.id, { payerId: payer.id, memberId: "SP1", relationship: "spouse" })).rejects.toThrow(/insured person/);
    const row = await addInsurance(t.db, t.practiceId, p.id, { payerId: payer.id, memberId: "SP1", relationship: "spouse", subscriber: { firstName: "Luis", lastName: "Reyes", dob: "1982-05-05", sex: "M", state: "ZZ" } }).catch((e) => e);
    expect(String(row)).toMatch(/not a US state/);
    const ok = await addInsurance(t.db, t.practiceId, p.id, { payerId: payer.id, memberId: "SP1", relationship: "spouse", subscriber: { firstName: "Luis", lastName: "Reyes", dob: "1982-05-05", sex: "M" } });
    expect((await t.db.select().from(schema.patientInsurances).where(and(eq(schema.patientInsurances.id, ok.id))))[0].subscriberLastName).toBe("Reyes");
  });

  it("a solo provider's practice bills under their own NPI, with CLIA and the referring provider on the claim", async () => {
    const base = { name: "Sarah Chen MD", npi: "1234567893", taxId: "123456789", address1: "410 Lakeside Ave", city: "Orlando", state: "fl", zip: "328011234", phone: "407.555.0100" };
    await expect(saveProfile(t.db, t.practiceId, { ...base, billingEntity: "individual" }, t.userId)).rejects.toThrow(/first and last name/);
    await expect(saveProfile(t.db, t.practiceId, { ...base, cliaNumber: "10-1234567" }, t.userId)).rejects.toThrow(/CLIA/);
    await expect(saveProfile(t.db, t.practiceId, { ...base, state: "XX" }, t.userId)).rejects.toThrow(/state/);
    await saveProfile(t.db, t.practiceId, { ...base, billingEntity: "individual", billingFirstName: "Sarah", billingLastName: "Chen", cliaNumber: "10d1234567" }, t.userId);
    const [p] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, t.practiceId));
    expect(p).toMatchObject({ taxId: "12-3456789", zip: "32801-1234", phone: "(407) 555-0100", state: "FL", billingEntity: "individual", billingLastName: "Chen", cliaNumber: "10D1234567" });

    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const [ins] = await t.db.select().from(schema.patientInsurances).limit(1);
    const input = { patientId: ins.patientId, providerId: prov.id, dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "83036", modifiers: [], units: 1, chargeCents: 4000, dxPointers: [1] }] };
    await expect(createEncounterWithClaim(t.db, t.practiceId, { ...input, referring: { lastName: "Patel", npi: "1234567890" } }, t.userId)).rejects.toThrow(/check digit/);
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, { ...input, referring: { lastName: "Patel", firstName: "Raj", npi: "1245319599" } }, t.userId);
    const bundle = (await loadClaimBundle(t.db, claim.id))!;
    const edi = buildClaimEdi(bundle, { now: new Date("2026-09-02T12:00:00Z"), authorizationNumber: null, attachments: [] });
    expect(edi).toContain("NM1*85*1*Chen*Sarah****XX*1234567893~");
    expect(edi).toContain("REF*X4*10D1234567~");
    expect(edi).toContain("NM1*DN*1*Patel*Raj****XX*1245319599~");
  });

  it("knows Medicare's one-year filing limit and accepts only real places of service and states for locations", async () => {
    expect(payerDefaults("medicare")).toEqual({ timelyFilingDays: 365, appealDays: 120 });
    expect(payerDefaults("commercial").timelyFilingDays).toBe(90);
    await expect(savePayer(t.db, t.practiceId, null, { name: "Medicare FL", payerId: "09102X", type: "medicare", timelyFilingDays: 400, appealDays: 120 }, t.userId)).rejects.toThrow(/365/);
    const loc = { name: "Northside", address1: "1 Oak St", city: "Tampa", state: "FL", zip: "33601" };
    expect(() => validateLocation({ ...loc, placeOfService: "98" })).toThrow(/CMS list/);
    expect(() => validateLocation({ ...loc, state: "ZZ", placeOfService: "11" })).toThrow(/state/);
    expect(validateLocation({ ...loc, placeOfService: "15" }).placeOfService).toBe("15");
  });
});
