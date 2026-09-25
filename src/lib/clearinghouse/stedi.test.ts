import { describe, expect, it } from "vitest";
import { StediClearinghouse, toResponse271 } from "./stedi";
import { build277CA } from "@/lib/edi/x277ca";
import { summarize271 } from "@/lib/edi/x270";

function stub(status: number, body: unknown) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const http = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { http, calls };
}

const ack = (status: string) =>
  build277CA({
    senderId: "STEDI", receiverId: "COLLABORATMD", now: new Date(), control: "1", sourceName: "Stedi", submitterName: "Summit",
    billingProvider: { name: "Summit", npi: "1234567893" },
    claims: [{ controlNumber: "CMD000001", patientLast: "Doe", patientFirst: "Jane", memberId: "A1", chargeCents: 100, dateOfService: "2026-09-20", status }],
  });

describe("Stedi adapter", () => {
  it("posts the raw 837 with the API key and an idempotency key", async () => {
    const { http, calls } = stub(200, { status: "SUCCESS", controlNumber: "555", claimReference: { correlationId: "01ABC" }, x12: ack("A1:19") });
    const r = await new StediClearinghouse("test_key_123", http).submit837("ISA*...~", { controlNumber: "CMD000001", memberId: "A1" });
    expect(calls[0].url).toBe("https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/raw-x12-submission");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "test_key_123", "Idempotency-Key": "claim-CMD000001" });
    expect(JSON.parse(calls[0].init.body)).toEqual({ x12: "ISA*...~" });
    expect(r).toMatchObject({ accepted: true, status: "accepted", clearinghouseId: "01ABC" });
  });

  it("reports a rejection in Stedi's acknowledgment", async () => {
    const { http } = stub(200, { status: "SUCCESS", x12: ack("A7:164:IL") });
    const r = await new StediClearinghouse("k", http).submit837("ISA", { controlNumber: "CMD000001", memberId: "A1" });
    expect(r).toMatchObject({ accepted: false, status: "rejected", rejectionCode: "A7:164:IL" });
  });

  it("surfaces an HTTP error with Stedi's detail", async () => {
    const { http } = stub(401, { message: "Unauthorized" });
    await expect(new StediClearinghouse("bad", http).submit837("ISA", { controlNumber: "C", memberId: "A" })).rejects.toThrow(/Stedi returned 401/);
  });

  it("maps Stedi's JSON 271 onto the same benefit summary as a raw 271", async () => {
    const body = {
      planDateInformation: { planBegin: "20260101" },
      benefitsInformation: [
        { code: "1", coverageLevelCode: "IND", serviceTypeCodes: ["30"], insuranceTypeCode: "PR", planCoverage: "Open Access Plus" },
        { code: "B", coverageLevelCode: "IND", serviceTypeCodes: ["30"], timeQualifierCode: "27", benefitAmount: "35", inPlanNetworkIndicatorCode: "Y" },
        { code: "C", coverageLevelCode: "IND", timeQualifierCode: "23", benefitAmount: "1500", inPlanNetworkIndicatorCode: "Y" },
        { code: "C", coverageLevelCode: "IND", timeQualifierCode: "29", benefitAmount: "425.50", inPlanNetworkIndicatorCode: "Y" },
        { code: "C", coverageLevelCode: "FAM", timeQualifierCode: "23", benefitAmount: "3000", inPlanNetworkIndicatorCode: "Y" },
        { code: "A", coverageLevelCode: "IND", benefitPercent: "0.2", inPlanNetworkIndicatorCode: "Y" },
        { code: "G", coverageLevelCode: "IND", timeQualifierCode: "23", benefitAmount: "4500", inPlanNetworkIndicatorCode: "Y" },
      ],
    };
    const { http, calls } = stub(200, body);
    const answer = await new StediClearinghouse("k", http).checkEligibility("ISA*270~");
    expect(calls[0].url).toMatch(/\/eligibility\/v3\/raw-x12$/);
    expect(answer.format).toBe("json");
    expect(answer.response.planBegin).toBe("2026-01-01");
    expect(summarize271(answer.response)).toEqual({
      status: "active", planName: "Open Access Plus", copayCents: 3_500, deductibleCents: 150_000, deductibleRemainingCents: 42_550,
      oopMaxCents: 450_000, oopRemainingCents: undefined, coinsurancePct: 20,
    });
  });

  it("treats Stedi's AAA errors like a 271 rejection", () => {
    const r = toResponse271({ errors: [{ code: "72", description: "Invalid/Missing Subscriber/Insured ID", followupAction: "Please Correct and Resubmit" }] });
    expect(summarize271(r)).toEqual({ status: "inactive", message: "Invalid/Missing Subscriber/Insured ID (AAA 72)" });
  });

  it("sends a 276 and returns the raw 277 from Stedi's response", async () => {
    const { http, calls } = stub(200, { x12: "ISA*277~", claims: [] });
    expect(await new StediClearinghouse("k", http).checkClaimStatus("ISA*276~")).toBe("ISA*277~");
    expect(calls[0].url).toBe("https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/claimstatus/v2/raw-x12");
    await expect(new StediClearinghouse("k", stub(200, {}).http).checkClaimStatus("ISA")).rejects.toThrow(/no 277/);
  });

  it("does not pretend to fetch ERAs", async () => {
    expect(await new StediClearinghouse("k", stub(200, {}).http).fetch835([])).toBeNull();
  });
});
