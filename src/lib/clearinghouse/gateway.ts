/**
 * Clearinghouse gateway abstraction.
 *
 * Production wires a real vendor (Stedi, Claim.MD, Availity, ...) behind this
 * interface. The MockClearinghouse simulates a payer end-to-end so the whole
 * revenue cycle can be exercised locally: 837 submission -> 277CA acknowledgment
 * -> adjudication -> 835 remittance.
 */
import { buildEdi835, type Adjustment } from "@/lib/edi/x835";

export interface SubmissionResult {
  clearinghouseId: string;
  accepted: boolean;
  status: "accepted" | "rejected";
  message: string;
  rejectionCode?: string; // CSCC:CSC style code from 277CA
}

export interface EligibilityRequest {
  memberId: string;
  payerId: string;
  dob: string;
  lastName: string;
  firstName: string;
  serviceDate: string;
}

export interface EligibilityResult {
  status: "active" | "inactive" | "error";
  planName?: string;
  copayCents?: number;
  deductibleCents?: number;
  deductibleRemainingCents?: number;
  oopMaxCents?: number;
  raw: Record<string, unknown>;
}

export interface AdjudicationLine {
  cpt: string;
  units: number;
  chargeCents: number;
}

export interface ClearinghouseGateway {
  submit837(edi: string, meta: { controlNumber: string; memberId: string }): Promise<SubmissionResult>;
  checkEligibility(req: EligibilityRequest): Promise<EligibilityResult>;
  /** Simulates the payer producing an ERA for previously accepted claims. */
  fetch835(claims: { controlNumber: string; payerName: string; payerId: string; lines: AdjudicationLine[]; memberId: string }[]): Promise<string | null>;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Picks a deterministic element from a list.
 * `hash` is an unsigned 32-bit value, so the shift must be unsigned (`>>>`):
 * a signed `>>` would produce a negative index and an undefined element.
 */
function pick<T>(list: readonly T[], hash: number, shift = 0): T {
  return list[((hash >>> shift) >>> 0) % list.length];
}

/** Deterministic pseudo-random adjudication driven by the member ID / control number. */
export class MockClearinghouse implements ClearinghouseGateway {
  async submit837(edi: string, meta: { controlNumber: string; memberId: string }): Promise<SubmissionResult> {
    const id = "CH" + hashStr(edi).toString(16).toUpperCase().padStart(8, "0");
    // Member IDs ending in "X" are rejected at the front end (simulates invalid subscriber).
    if (/X$/i.test(meta.memberId)) {
      return {
        clearinghouseId: id,
        accepted: false,
        status: "rejected",
        rejectionCode: "A7:164:IL",
        message: "Acknowledgement/Rejected for Invalid Information: Entity's contract/member number. Subscriber",
      };
    }
    if (!/CLM\*/.test(edi)) {
      return { clearinghouseId: id, accepted: false, status: "rejected", rejectionCode: "A7:21", message: "Missing or invalid information: Claim segment not found" };
    }
    return { clearinghouseId: id, accepted: true, status: "accepted", message: "Acknowledgement/Acceptance into adjudication system (277CA A1:19)" };
  }

  async checkEligibility(req: EligibilityRequest): Promise<EligibilityResult> {
    const h = hashStr(req.memberId + req.payerId);
    if (/X$/i.test(req.memberId)) {
      return { status: "inactive", raw: { transaction: "271", eb: "6", message: "Subscriber not found or coverage terminated" } };
    }
    const deductible = pick([50000, 100000, 150000, 300000], h);
    const remaining = Math.round(deductible * ((h % 7) / 7));
    return {
      status: "active",
      planName: pick(["PPO Choice Plus", "HMO Select", "POS Standard", "High Deductible Health Plan"], h),
      copayCents: pick([2000, 2500, 3000, 4000], h, 3),
      deductibleCents: deductible,
      deductibleRemainingCents: remaining,
      oopMaxCents: deductible * 3,
      raw: { transaction: "271", eb: "1", coverageLevel: "IND", serviceDate: req.serviceDate },
    };
  }

  async fetch835(claims: { controlNumber: string; payerName: string; payerId: string; lines: AdjudicationLine[]; memberId: string }[]): Promise<string | null> {
    if (claims.length === 0) return null;
    const first = claims[0];
    const gen = claims.map((c) => {
      const h = hashStr(c.controlNumber + c.memberId);
      // Member IDs ending in "D" always deny (for demos); otherwise ~11%, near real-world rates.
      const scenario = c.memberId.endsWith("D") || h % 9 === 0 ? "deny" : "pay";
      const charged = c.lines.reduce((a, l) => a + l.chargeCents, 0);
      if (scenario === "deny") {
        // auth, medical necessity, missing info, timely filing, duplicate
        const carc = pick(["197", "50", "16", "29", "18"], h);
        const rarc: string = { "197": "N54", "50": "M76", "16": "M51", "29": "N30", "18": "M86" }[carc] ?? "N30";
        return {
          patientControlNumber: c.controlNumber,
          payerClaimNumber: "PCN" + (h % 1_000_000).toString().padStart(6, "0"),
          statusCode: "4",
          chargedCents: charged,
          paidCents: 0,
          patientResponsibilityCents: 0,
          adjustments: [{ group: "CO", reason: carc, amountCents: charged }] as Adjustment[],
          remarks: [rarc],
          lines: c.lines.map((l) => ({ cpt: l.cpt, chargedCents: l.chargeCents, paidCents: 0, units: l.units, adjustments: [{ group: "CO", reason: carc, amountCents: l.chargeCents }] })),
        };
      }
      // Paid: allowed = 52-85% of charge, patient copay/coinsurance on first line.
      // The low end sits below typical contract rates so underpayment detection
      // has something real to find, as it would with a live payer.
      const allowedPct = 0.52 + (((h >>> 4) >>> 0) % 34) / 100;
      const copay = pick([2000, 2500, 3000], h, 8);
      let totalPaid = 0;
      let totalPr = 0;
      const lines = c.lines.map((l, i) => {
        const allowed = Math.round(l.chargeCents * allowedPct);
        const contractual = l.chargeCents - allowed;
        const pr = i === 0 ? Math.min(copay, allowed) : 0;
        const paid = allowed - pr;
        totalPaid += paid;
        totalPr += pr;
        const adjustments: Adjustment[] = [{ group: "CO", reason: "45", amountCents: contractual }];
        if (pr) adjustments.push({ group: "PR", reason: "3", amountCents: pr });
        return { cpt: l.cpt, chargedCents: l.chargeCents, paidCents: paid, units: l.units, adjustments };
      });
      return {
        patientControlNumber: c.controlNumber,
        payerClaimNumber: "PCN" + (h % 1_000_000).toString().padStart(6, "0"),
        statusCode: "1",
        chargedCents: charged,
        paidCents: totalPaid,
        patientResponsibilityCents: totalPr,
        adjustments: [] as Adjustment[],
        lines,
      };
    });
    return buildEdi835({
      payerName: first.payerName,
      payerId: first.payerId,
      checkNumber: "EFT" + hashStr(claims.map((c) => c.controlNumber).join()).toString().slice(0, 8),
      paymentDate: new Date(),
      claims: gen,
    });
  }
}

let gateway: ClearinghouseGateway | null = null;
export function getClearinghouse(): ClearinghouseGateway {
  if (!gateway) gateway = new MockClearinghouse();
  return gateway;
}
