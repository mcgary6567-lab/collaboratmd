import { describe, expect, it } from "vitest";
import { estimateInsured, estimateSelfPay, isEvaluationAndManagement } from "./estimate";
import { addMonths, allocatePayment, buildSchedule } from "./plans";

describe("insured estimate", () => {
  const visit = { cpt: "99214", units: 1, chargeCents: 20_000, allowedCents: 12_000 };
  const lab = { cpt: "80053", units: 1, chargeCents: 10_000, allowedCents: 4_000 };

  it("recognizes evaluation and management codes", () => {
    expect(isEvaluationAndManagement("99213")).toBe(true);
    expect(isEvaluationAndManagement("99245")).toBe(true);
    expect(isEvaluationAndManagement("80053")).toBe(false);
  });

  it("applies the copay to the visit and deductible then coinsurance to the rest", () => {
    const e = estimateInsured([visit, lab], { copayCents: 3_000, deductibleRemainingCents: 1_000, coinsurancePct: 20 });
    expect(e.copayCents).toBe(3_000);
    expect(e.deductibleCents).toBe(1_000);
    // 4,000 lab allowed - 1,000 deductible = 3,000 at 20%
    expect(e.coinsuranceCents).toBe(600);
    expect(e.patientOwesCents).toBe(4_600);
    expect(e.insurancePaysCents).toBe(16_000 - 4_600);
    expect(e.allowedCents).toBe(16_000);
    expect(e.totalChargeCents).toBe(30_000);
  });

  it("never charges a copay larger than the visit allowed", () => {
    const e = estimateInsured([{ ...visit, allowedCents: 2_000 }], { copayCents: 5_000, deductibleRemainingCents: 0, coinsurancePct: 20 });
    expect(e.copayCents).toBe(2_000);
    expect(e.insurancePaysCents).toBe(0);
  });

  it("caps the patient at the remaining out-of-pocket maximum", () => {
    const e = estimateInsured([lab], { copayCents: 0, deductibleRemainingCents: 50_000, coinsurancePct: 20, oopRemainingCents: 1_500 });
    expect(e.patientOwesCents).toBe(1_500);
    expect(e.oopCapCents).toBe(2_500);
    expect(e.insurancePaysCents).toBe(2_500);
  });

  it("puts the whole allowed amount on the patient while the deductible is unmet", () => {
    const e = estimateInsured([lab], { copayCents: 0, deductibleRemainingCents: 100_000, coinsurancePct: 20 });
    expect(e.patientOwesCents).toBe(4_000);
    expect(e.insurancePaysCents).toBe(0);
  });
});

describe("good faith estimate", () => {
  it("discounts charges for a self-pay patient", () => {
    const e = estimateSelfPay([{ cpt: "99213", units: 1, chargeCents: 15_000, allowedCents: 15_000 }, { cpt: "36415", units: 2, chargeCents: 2_500, allowedCents: 2_500 }], 30);
    expect(e.totalChargeCents).toBe(20_000);
    expect(e.discountCents).toBe(6_000);
    expect(e.patientOwesCents).toBe(14_000);
  });
});

describe("payment plan schedule", () => {
  it("sums exactly to the balance with leftover cents on the first installment", () => {
    const s = buildSchedule(100_001, 3, "2026-01-15", "monthly");
    expect(s.map((i) => i.amountCents)).toEqual([33_335, 33_333, 33_333]);
    expect(s.reduce((a, i) => a + i.amountCents, 0)).toBe(100_001);
  });

  it("keeps month-end due dates valid in short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 2)).toBe("2027-01-30");
    expect(buildSchedule(9_000, 3, "2026-01-31", "monthly").map((i) => i.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("spaces biweekly installments fourteen days apart", () => {
    expect(buildSchedule(6_000, 3, "2026-03-01", "biweekly").map((i) => i.dueDate)).toEqual(["2026-03-01", "2026-03-15", "2026-03-29"]);
  });

  it("rejects plans that are not plans", () => {
    expect(() => buildSchedule(10_000, 1, "2026-01-01", "monthly")).toThrow();
    expect(() => buildSchedule(0, 3, "2026-01-01", "monthly")).toThrow();
  });
});

describe("payment allocation", () => {
  const plan = [
    { id: "a", seq: 1, amountCents: 5_000, paidCents: 5_000 },
    { id: "b", seq: 2, amountCents: 5_000, paidCents: 1_000 },
    { id: "c", seq: 3, amountCents: 5_000, paidCents: 0 },
  ];

  it("pays the oldest unpaid installment first", () => {
    const { allocations, leftoverCents } = allocatePayment(plan, 6_000);
    expect(allocations).toEqual([
      { id: "b", appliedCents: 4_000, paidCents: 5_000, status: "paid" },
      { id: "c", appliedCents: 2_000, paidCents: 2_000, status: "partial" },
    ]);
    expect(leftoverCents).toBe(0);
  });

  it("reports overpayment instead of absorbing it", () => {
    expect(allocatePayment(plan, 20_000).leftoverCents).toBe(11_000);
  });
});
