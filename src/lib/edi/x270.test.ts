import { describe, expect, it } from "vitest";
import { build270, build271, parse270, parse271, summarize271, type Inquiry270 } from "./x270";
import { tokenize } from "./x12";

const inquiry: Inquiry270 = {
  senderId: "COLLABORATMD", receiverId: "60054", now: new Date("2026-09-24T15:30:00Z"), control: "42", traceNumber: "TRACE123",
  payer: { name: "Aetna", payerId: "60054" },
  provider: { name: "Summit Health Partners", npi: "1234567893" },
  subscriber: { lastName: "Doe", firstName: "Jane", memberId: "W123456789", dob: "1980-02-29", sex: "F" },
  serviceDate: "2026-09-25",
};

describe("270 eligibility inquiry", () => {
  it("builds the 005010X279A1 loops in order with a balanced envelope", () => {
    const raw = build270(inquiry);
    const tags = tokenize(raw).segments.map((s) => s.join("*"));
    expect(tags[1]).toBe("GS*HS*COLLABORATMD*60054*20260924*1530*42*X*005010X279A1");
    expect(tags[2]).toBe("ST*270*0001*005010X279A1");
    expect(tags).toContain("BHT*0022*13*TRACE123*20260924*1530");
    expect(tags).toContain("NM1*PR*2*Aetna*****PI*60054");
    expect(tags).toContain("NM1*1P*2*Summit Health Partners*****XX*1234567893");
    expect(tags).toContain("NM1*IL*1*Doe*Jane****MI*W123456789");
    expect(tags).toContain("DMG*D8*19800229*F");
    expect(tags).toContain("DTP*291*D8*20260925");
    expect(tags).toContain("EQ*30");
    // SE counts every segment from ST to SE inclusive.
    const st = tags.findIndex((t) => t.startsWith("ST*"));
    const se = tags.findIndex((t) => t.startsWith("SE*"));
    expect(tags[se]).toBe(`SE*${se - st + 1}*0001`);
  });

  it("reads back as the payer sees it", () => {
    expect(parse270(build270(inquiry))).toMatchObject({
      traceNumber: "TRACE123", payerId: "60054", memberId: "W123456789", lastName: "Doe", firstName: "Jane", dob: "1980-02-29", serviceDate: "2026-09-25", serviceTypes: ["30"],
    });
  });
});

describe("271 eligibility response", () => {
  const q = parse270(build270(inquiry));
  const common = { senderId: "60054", receiverId: "COLLABORATMD", now: new Date("2026-09-24T15:31:00Z"), control: "43", inquiry: q };

  it("summarizes individual in-network benefits and ignores family and out-of-network rows", () => {
    const eb = (code: string, level: string, period: string, amountCents: number | null, percent: number | null, net = "Y", desc = "") =>
      ({ code, coverageLevel: level, serviceType: "30", insuranceType: "PR", planDescription: desc, timePeriod: period, amountCents, percent, inNetwork: net });
    const raw = build271({
      ...common,
      planBegin: "2026-01-01",
      benefits: [
        eb("1", "IND", "", null, null, "", "Open Access PPO"),
        eb("B", "IND", "27", 3_500, null),
        eb("B", "IND", "27", 7_000, null, "N"), // out-of-network copay
        eb("C", "IND", "23", 150_000, null),
        eb("C", "IND", "29", 42_550, null),
        eb("C", "FAM", "23", 300_000, null),
        eb("A", "IND", "27", null, 20),
        eb("G", "IND", "23", 450_000, null),
        eb("G", "IND", "29", 342_550, null),
      ],
    });
    const parsed = parse271(raw);
    expect(parsed.traceNumber).toBe("TRACE123");
    expect(parsed.planBegin).toBe("2026-01-01");
    expect(parsed.benefits.find((b) => b.code === "A")?.percent).toBe(20);
    expect(summarize271(parsed)).toEqual({
      status: "active", planName: "Open Access PPO", copayCents: 3_500, deductibleCents: 150_000, deductibleRemainingCents: 42_550,
      oopMaxCents: 450_000, oopRemainingCents: 342_550, coinsurancePct: 20,
    });
  });

  it("reads a payer's pipe-delimited 271", () => {
    const raw = build271({ ...common, benefits: [{ code: "1", coverageLevel: "IND", serviceType: "30", insuranceType: "HM", planDescription: "HMO", timePeriod: "", amountCents: null, percent: null, inNetwork: "" }] });
    const exotic = raw.replace(/\*/g, "|").replace(/~\n?/g, "!").replace(/\|:!/, "|>!");
    expect(summarize271(parse271(exotic))).toMatchObject({ status: "active", planName: "HMO" });
  });

  it("treats a bad member ID as inactive until corrected and a payer outage as a retryable error", () => {
    const notFound = parse271(build271({ ...common, rejection: { code: "72" } }));
    expect(notFound.rejections).toEqual([{ code: "72", reason: "Invalid/missing subscriber/insured ID", followUp: "C" }]);
    expect(summarize271(notFound)).toEqual({ status: "inactive", message: "Invalid/missing subscriber/insured ID (AAA 72)" });
    expect(summarize271(parse271(build271({ ...common, rejection: { code: "42", followUp: "R" } }))).status).toBe("error");
  });

  it("reports inactive coverage when the payer answers EB*6", () => {
    const raw = build271({ ...common, benefits: [{ code: "6", coverageLevel: "IND", serviceType: "30", insuranceType: "", planDescription: "Terminated 2026-06-30", timePeriod: "", amountCents: null, percent: null, inNetwork: "" }] });
    expect(summarize271(parse271(raw))).toMatchObject({ status: "inactive", planName: "Terminated 2026-06-30" });
  });
});
