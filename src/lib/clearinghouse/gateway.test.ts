import { describe, expect, it } from "vitest";
import { MockClearinghouse } from "./gateway";
import { parseEdi835 } from "@/lib/edi/x835";

const ch = new MockClearinghouse();

/** Member IDs wide enough to exercise the full 32-bit hash space. */
const memberIds = Array.from({ length: 300 }, (_, i) => `BC${100000 + i * 911}${String.fromCharCode(65 + (i % 20))}`);

describe("MockClearinghouse adjudication", () => {
  it("never produces non-numeric amounts for any member ID", async () => {
    const raw = await ch.fetch835(
      memberIds.map((memberId, i) => ({
        controlNumber: `MB${String(i + 1).padStart(6, "0")}`,
        payerName: "Blue Cross Blue Shield FL",
        payerId: "00590",
        memberId,
        lines: [
          { cpt: "99214", units: 1, chargeCents: 19500 },
          { cpt: "36415", units: 1, chargeCents: 1500 },
        ],
      })),
    );
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("NaN");

    const remit = parseEdi835(raw!);
    expect(remit.claims).toHaveLength(memberIds.length);
    for (const claim of remit.claims) {
      expect(Number.isFinite(claim.paidCents)).toBe(true);
      expect(Number.isFinite(claim.patientResponsibilityCents)).toBe(true);
      expect(claim.paidCents).toBeGreaterThanOrEqual(0);
      expect(claim.paidCents).toBeLessThanOrEqual(claim.chargedCents);
      for (const line of claim.lines) {
        expect(Number.isFinite(line.paidCents)).toBe(true);
        for (const adj of line.adjustments) expect(Number.isFinite(adj.amountCents)).toBe(true);
      }
    }
  });

  it("balances each paid claim: charged = paid + adjustments", async () => {
    const raw = await ch.fetch835([
      { controlNumber: "CMD000001", payerName: "Aetna", payerId: "60054", memberId: "AE100001A", lines: [{ cpt: "99213", units: 1, chargeCents: 13500 }] },
    ]);
    const [claim] = parseEdi835(raw!).claims;
    const adjustments = claim.lines.flatMap((l) => l.adjustments).reduce((a, x) => a + x.amountCents, 0);
    const paid = claim.lines.reduce((a, l) => a + l.paidCents, 0);
    expect(paid + adjustments).toBe(claim.chargedCents);
  });

  it("denies claims whose member ID ends in D and pays a typical one", async () => {
    const denied = parseEdi835((await ch.fetch835([{ controlNumber: "CMD000002", payerName: "Cigna", payerId: "62308", memberId: "CI200002D", lines: [{ cpt: "90834", units: 1, chargeCents: 15000 }] }]))!).claims[0];
    expect(denied.statusCode).toBe("4");
    expect(denied.paidCents).toBe(0);
    expect(denied.adjustments[0].group).toBe("CO");
  });

  it("rejects submissions with an invalid subscriber ID and accepts valid ones", async () => {
    const bad = await ch.submit837("ISA*00*~CLM*CMD1*100.00~", { controlNumber: "CMD1", memberId: "BC123X" });
    expect(bad.accepted).toBe(false);
    expect(bad.rejectionCode).toBe("A7:164:IL");
    const good = await ch.submit837("ISA*00*~CLM*CMD2*100.00~", { controlNumber: "CMD2", memberId: "BC123A" });
    expect(good.accepted).toBe(true);
  });

  it("returns complete, finite benefits for every eligibility check", async () => {
    for (const memberId of memberIds.slice(0, 100)) {
      const r = await ch.checkEligibility({ memberId, payerId: "00590", dob: "1980-01-01", lastName: "Garcia", firstName: "Maria", serviceDate: "2026-09-01" });
      expect(r.status).toBe("active");
      expect(r.planName).toBeTruthy();
      for (const v of [r.copayCents, r.deductibleCents, r.deductibleRemainingCents, r.oopMaxCents]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(r.deductibleRemainingCents!).toBeLessThanOrEqual(r.deductibleCents!);
    }
  });
});
