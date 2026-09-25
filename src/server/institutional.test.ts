import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { buildEdi837I, isInpatient, type Edi837IInput } from "@/lib/edi/x837i";
import { tokenize } from "@/lib/edi/x12";
import { validateStructure } from "@/lib/edi/x999";
import { scrubInstitutional } from "@/lib/scrub/institutional";
import { StediClearinghouse } from "@/lib/clearinghouse/stedi";
import { createInstitutionalClaim } from "./institutional";
import { fetchAndPostRemittances, getClaimFinancials, submitClaim } from "./claims";

const input = (over: Partial<Edi837IInput["claim"]["institutional"]> = {}): Edi837IInput => ({
  controlNumber: "CMD000777", interchangeControl: "123456789", senderId: "COLLABORATMD", receiverId: "00430", now: new Date("2026-09-25T10:00:00Z"),
  billingProvider: { name: "Summit Health", npi: "1234567893", taxId: "74-1234567", address1: "1 Main", city: "Austin", state: "TX", zip: "78701" },
  attending: { lastName: "Reyes", firstName: "Hannah", npi: "1234567893", taxonomy: "207R00000X" },
  payer: { name: "Medicare Part A", payerId: "00430", type: "medicare" },
  subscriber: { lastName: "Nguyen", firstName: "Linh", memberId: "1EG4TE5MK73", dob: "1950-04-05", sex: "F", relationship: "self" },
  claim: {
    totalCents: 1_250_00, frequencyCode: "1", diagnoses: ["I21.4", "E11.9"],
    institutional: { typeOfBill: "0111", statementFrom: "2026-09-10", statementTo: "2026-09-14", admissionDate: "2026-09-10", admissionHour: "1430", admissionType: "1", admissionSource: "7", patientStatus: "01", admittingDiagnosis: "R07.9", ...over },
  },
  lines: [
    { revenueCode: "0120", chargeCents: 1_000_00, units: 4, dateOfService: "2026-09-10" },
    { revenueCode: "0450", hcpcs: "99284", chargeCents: 250_00, units: 1, dateOfService: "2026-09-10" },
  ],
});

describe("837I", () => {
  it("builds a well-formed institutional claim", () => {
    const edi = buildEdi837I(input());
    expect(validateStructure(edi)).toEqual([]);
    expect(edi).toContain("GS*HC*COLLABORATMD*00430");
    expect(edi).toContain("ST*837*0001*005010X223A2~");
    expect(edi).toContain("SBR*P*18*******MA~");
    expect(edi).toContain("CLM*CMD000777*1250.00***11:A:1**A*Y*Y~");
    expect(edi).toContain("DTP*435*DT*202609101430~");
    expect(edi).toContain("DTP*434*RD8*20260910-20260914~");
    expect(edi).toContain("CL1*1*7*01~");
    expect(edi).toContain("HI*ABK:I214~");
    expect(edi).toContain("HI*ABJ:R079~");
    expect(edi).toContain("HI*ABF:E119~");
    expect(edi).toContain("NM1*71*1*Reyes*Hannah****XX*1234567893~");
    expect(edi).toContain("SV2*0120**1000.00*UN*4~");
    expect(edi).toContain("SV2*0450*HC:99284*250.00*UN*1~");
    const { segments } = tokenize(edi);
    const st = segments.findIndex((s) => s[0] === "ST");
    const se = segments.findIndex((s) => s[0] === "SE");
    expect(Number(segments[se][1])).toBe(se - st + 1);
  });

  it("knows inpatient bill types", () => {
    expect(isInpatient("0111")).toBe(true);
    expect(isInpatient("0211")).toBe(true);
    expect(isInpatient("0131")).toBe(false);
    expect(isInpatient("0831")).toBe(false);
  });

  it("scrubs the things a facility claim is rejected for", () => {
    const base = { billingNpi: "1234567893", attendingNpi: "1234567893", memberId: "M1", payerId: "00430", diagnoses: ["I21.4"], today: "2026-09-25" };
    const inpatientNoAdmit = scrubInstitutional({ ...base, institutional: { typeOfBill: "0111", statementFrom: "2026-09-10", statementTo: "2026-09-14", patientStatus: "01" }, lines: [{ lineNumber: 1, revenueCode: "0120", hcpcs: "", units: 4, chargeCents: 100 }] });
    expect(inpatientNoAdmit.filter((f) => f.severity === "error").map((f) => f.rule)).toEqual(["ADMIT_DATE", "ADMIT_TYPE", "ADMIT_SOURCE"]);
    const outpatient = scrubInstitutional({ ...base, institutional: { typeOfBill: "0131", statementFrom: "2026-09-10", statementTo: "2026-09-10", patientStatus: "01" }, lines: [{ lineNumber: 1, revenueCode: "0320", hcpcs: "", units: 1, chargeCents: 100 }, { lineNumber: 2, revenueCode: "12", hcpcs: "7005", units: 0, chargeCents: 0 }] });
    expect(outpatient.map((f) => f.rule)).toEqual(expect.arrayContaining(["HCPCS_OUTPATIENT", "REVENUE_CODE", "UNITS", "LINE_CHARGE", "HCPCS_FORMAT"]));
    expect(outpatient.find((f) => f.rule === "HCPCS_OUTPATIENT")?.severity).toBe("warning");
    const bad = scrubInstitutional({ ...base, institutional: { typeOfBill: "131", statementFrom: "2026-09-14", statementTo: "2026-09-10", patientStatus: "" }, lines: [] });
    expect(bad.map((f) => f.rule)).toEqual(expect.arrayContaining(["STATEMENT_ORDER", "PATIENT_STATUS", "NO_LINES"]));
  });

  it("sends institutional claims to Stedi's institutional endpoint", async () => {
    const calls: string[] = [];
    const http = async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ status: "SUCCESS" }), text: async () => "{}" }; };
    await new StediClearinghouse("k", http as never).submit837("ISA~", { controlNumber: "C1", memberId: "M", claimType: "institutional" });
    expect(calls[0]).toBe("https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/institutionalclaims/v1/raw-x12-submission");
  });
});

describe("institutional claims against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("creates, scrubs, submits and posts a facility claim", async () => {
    const [row] = await t.db.select({ p: schema.patients }).from(schema.patients).innerJoin(schema.patientInsurances, eq(schema.patientInsurances.patientId, schema.patients.id)).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    await expect(createInstitutionalClaim(t.db, t.practiceId, { patientId: row.p.id, attendingProviderId: provider.id, typeOfBill: "0131", statementFrom: "2026-09-10", statementTo: "2026-09-10", patientStatus: "01", diagnoses: ["R10.9"], lines: [] })).rejects.toThrow(/revenue line/);

    const claim = await createInstitutionalClaim(t.db, t.practiceId, {
      patientId: row.p.id, attendingProviderId: provider.id, typeOfBill: "0131", statementFrom: "2026-09-10", statementTo: "2026-09-10", patientStatus: "01",
      diagnoses: ["R10.9"], lines: [{ revenueCode: "450", hcpcs: "99284", units: 1, chargeCents: 850_00 }, { revenueCode: "0300", hcpcs: "80053", units: 1, chargeCents: 120_00 }],
    }, t.userId);
    expect(claim).toMatchObject({ claimType: "institutional", totalCents: 970_00 });
    expect(claim.institutional?.typeOfBill).toBe("0131");
    expect(claim.status).toBe("ready");
    const lines = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, claim.encounterId));
    expect(lines.map((l) => l.revenueCode).sort()).toEqual(["0300", "0450"]);

    const sent = await submitClaim(t.db, claim.id, t.userId);
    expect(sent.status).toBe("accepted");
    const [after] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, claim.id));
    expect(after.edi837).toContain("005010X223A2");
    expect(after.edi837).toContain("SV2*0450*HC:99284*850.00*UN*1");

    await fetchAndPostRemittances(t.db, t.practiceId, t.userId, [claim.id]);
    const fin = await getClaimFinancials(t.db, claim.id);
    expect(fin.chargesCents).toBe(970_00);
    expect(fin.insurancePaidCents + fin.adjustmentsCents + fin.patientRespCents).toBeGreaterThan(0);
  });
});
