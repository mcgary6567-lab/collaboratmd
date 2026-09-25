/**
 * Clearinghouse gateway abstraction.
 *
 * Production wires a real vendor (Stedi, Claim.MD, Availity, ...) behind this
 * interface. The MockClearinghouse simulates a payer end-to-end so the whole
 * revenue cycle can be exercised locally: 837 submission -> 277CA acknowledgment
 * -> adjudication -> 835 remittance.
 */
import { buildEdi835, type Adjustment } from "@/lib/edi/x835";
import { build999, describeSyntaxError, validateStructure } from "@/lib/edi/x999";
import { build277CA } from "@/lib/edi/x277ca";
import { build271, parse270, parse271, type Benefit, type Response271 } from "@/lib/edi/x270";
import { StediClearinghouse } from "./stedi";

export interface SubmissionResult {
  clearinghouseId: string;
  accepted: boolean;
  /** "pending" when acknowledgments arrive later and must be polled for. */
  status: "accepted" | "rejected" | "pending";
  message: string;
  rejectionCode?: string; // CSCC:CSC style code from 277CA
  /** Raw X12 acknowledgments, when the clearinghouse returns them with the submission. */
  ack999?: string;
  ack277?: string;
}

/** What a clearinghouse needs alongside the 837 to route and acknowledge it. */
export interface SubmissionMeta {
  controlNumber: string;
  memberId: string;
  patientLast?: string;
  patientFirst?: string;
  chargeCents?: number;
  dateOfService?: string;
  billingName?: string;
  billingNpi?: string;
}

export interface AdjudicationLine {
  cpt: string;
  units: number;
  chargeCents: number;
}

/** What the payer posted on a claim it is now reversing, because of a void. */
export interface ReversalRequest {
  originalControlNumber: string;
  payerClaimNumber: string;
  chargedCents: number;
  paidCents: number;
  adjustments: Adjustment[];
}

export interface RemitRequest {
  controlNumber: string;
  payerName: string;
  payerId: string;
  lines: AdjudicationLine[];
  memberId: string;
  /** Present for an accepted void: the payer answers it by reversing the original claim. */
  reversal?: ReversalRequest;
  /** Present for a secondary claim: what the primary left unpaid. */
  secondary?: { balanceCents: number };
}

/**
 * A payer's eligibility answer. Some clearinghouses return the raw 271, others
 * a JSON rendering of it; either way it is reduced to the same structure.
 */
export interface EligibilityAnswer {
  format: "x12" | "json";
  /** The 271 as received, or the clearinghouse's JSON, for the record. */
  raw: string;
  response: Response271;
}

export interface ClearinghouseGateway {
  submit837(edi: string, meta: SubmissionMeta): Promise<SubmissionResult>;
  /** Sends a 270 eligibility inquiry and returns the payer's answer. */
  checkEligibility(edi270: string): Promise<EligibilityAnswer>;
  /** Simulates the payer producing an ERA for previously accepted claims. */
  fetch835(claims: RemitRequest[]): Promise<string | null>;
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
  /**
   * Answers the way a clearinghouse does: a 999 for the file's syntax, then,
   * if that passes, a 277CA per claim. Member IDs ending in "X" are rejected at
   * the front end, which simulates an invalid subscriber.
   */
  async submit837(edi: string, meta: SubmissionMeta): Promise<SubmissionResult> {
    const id = "CH" + hashStr(edi).toString(16).toUpperCase().padStart(8, "0");
    const now = new Date();
    const control = String(hashStr(edi + "ack") % 1_000_000_000);
    const errors = validateStructure(edi);
    const ack999 = build999({ original837: edi, senderId: "MOCKCH", receiverId: "COLLABORATMD", now, control, errors });
    if (errors.length) {
      return {
        clearinghouseId: id, accepted: false, status: "rejected", rejectionCode: "999:R", ack999,
        message: `Rejected by the clearinghouse: ${describeSyntaxError(errors[0].code)} (${errors[0].segmentId})`,
      };
    }
    const rejected = /X$/i.test(meta.memberId);
    const status = rejected ? "A7:164:IL" : "A2:20";
    const ack277 = build277CA({
      senderId: "MOCKCH", receiverId: "COLLABORATMD", now, control,
      sourceName: "Mock Clearinghouse", submitterName: meta.billingName ?? "Submitter",
      billingProvider: { name: meta.billingName ?? "Billing provider", npi: meta.billingNpi ?? "" },
      claims: [{
        controlNumber: meta.controlNumber, patientLast: meta.patientLast ?? "", patientFirst: meta.patientFirst ?? "",
        memberId: meta.memberId, chargeCents: meta.chargeCents ?? 0, dateOfService: meta.dateOfService ?? now.toISOString().slice(0, 10), status,
      }],
    });
    return rejected
      ? { clearinghouseId: id, accepted: false, status: "rejected", rejectionCode: status, ack999, ack277, message: "Acknowledgement/Rejected for Invalid Information: Entity's contract/member number. Subscriber" }
      : { clearinghouseId: id, accepted: true, status: "accepted", ack999, ack277, message: "Acknowledgement/Acceptance into adjudication system (277CA A2:20)" };
  }

  /**
   * Answers a 270 the way a payer does, with a 271. Member IDs ending in "X"
   * are not found (AAA 72); everyone else has active coverage whose figures
   * are derived from the member ID, so they are stable between checks.
   */
  async checkEligibility(edi270: string): Promise<EligibilityAnswer> {
    const raw = this.respond271(edi270);
    return { format: "x12", raw, response: parse271(raw) };
  }

  /** The 271 this simulated payer sends back. */
  respond271(edi270: string): string {
    const q = parse270(edi270);
    const now = new Date();
    const control = String(hashStr(edi270 + "271") % 1_000_000_000);
    const base = { senderId: "MOCKCH", receiverId: "COLLABORATMD", now, control, inquiry: q };
    if (!q.memberId || /X$/i.test(q.memberId)) return build271({ ...base, rejection: { code: "72" } });

    const h = hashStr(q.memberId + q.payerId);
    const deductible = pick([50000, 100000, 150000, 300000], h);
    const remaining = Math.round(deductible * ((h % 7) / 7));
    const oopMax = deductible * 3;
    const plan = pick(["PPO Choice Plus", "HMO Select", "POS Standard", "High Deductible Health Plan"], h);
    const insuranceType = plan.startsWith("HMO") ? "HM" : plan.startsWith("PPO") ? "PR" : "C1";
    const eb = (code: string, timePeriod: string, amountCents: number | null, percent: number | null, desc = ""): Benefit => ({
      code, coverageLevel: "IND", serviceType: "30", insuranceType, planDescription: desc, timePeriod, amountCents, percent, inNetwork: code === "1" ? "" : "Y",
    });
    return build271({
      ...base,
      planBegin: `${(q.serviceDate || now.toISOString()).slice(0, 4)}-01-01`,
      benefits: [
        eb("1", "", null, null, plan),
        eb("B", "27", pick([2000, 2500, 3000, 4000], h, 3), null),
        eb("C", "23", deductible, null),
        eb("C", "29", remaining, null),
        eb("A", "27", null, pick([10, 20, 30], h, 5)),
        eb("G", "23", oopMax, null),
        // Spent so far is the deductible already met; the rest of the maximum remains.
        eb("G", "29", oopMax - (deductible - remaining), null),
      ],
    });
  }

  async fetch835(claims: RemitRequest[]): Promise<string | null> {
    if (claims.length === 0) return null;
    const first = claims[0];
    const gen = claims.map((c) => {
      if (c.reversal) {
        // CLP02 = 22: the original claim's amounts, negated, under its own control number.
        const r = c.reversal;
        const pr = r.adjustments.filter((a) => a.group === "PR").reduce((s, a) => s + a.amountCents, 0);
        return {
          patientControlNumber: r.originalControlNumber,
          payerClaimNumber: r.payerClaimNumber,
          statusCode: "22",
          chargedCents: -r.chargedCents,
          paidCents: -r.paidCents,
          patientResponsibilityCents: -pr,
          adjustments: r.adjustments.map((a) => ({ ...a, amountCents: -a.amountCents })),
          lines: [],
        };
      }
      if (c.secondary) {
        // CLP02 = 2, processed as secondary. CARC 23 covers what the primary
        // settled; the rest is paid, less a share some plans leave the patient.
        const charged = c.lines.reduce((a, l) => a + l.chargeCents, 0);
        const balance = Math.max(0, Math.min(c.secondary.balanceCents, charged));
        const h2 = hashStr(c.controlNumber + "secondary");
        const pr = h2 % 4 === 0 ? Math.round(balance * 0.2) : 0;
        return {
          patientControlNumber: c.controlNumber,
          payerClaimNumber: "SEC" + (h2 % 1_000_000).toString().padStart(6, "0"),
          statusCode: "2",
          chargedCents: charged,
          paidCents: balance - pr,
          patientResponsibilityCents: pr,
          adjustments: [
            { group: "OA", reason: "23", amountCents: charged - balance },
            ...(pr ? [{ group: "PR", reason: "2", amountCents: pr }] : []),
          ] as Adjustment[],
          lines: [],
        };
      }
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
/**
 * The configured clearinghouse. CLEARINGHOUSE=stedi with STEDI_API_KEY sends
 * real transactions through Stedi; anything else uses the simulator, which is
 * never mistaken for a real payer: its acknowledgments name MOCKCH.
 */
export function getClearinghouse(): ClearinghouseGateway {
  if (gateway) return gateway;
  if (process.env.CLEARINGHOUSE?.trim().toLowerCase() === "stedi") {
    const key = process.env.STEDI_API_KEY?.trim();
    if (!key) throw new Error("CLEARINGHOUSE=stedi needs STEDI_API_KEY");
    gateway = new StediClearinghouse(key);
  } else {
    gateway = new MockClearinghouse();
  }
  return gateway;
}

/** Which clearinghouse is live, for the UI and the site's claims about itself. */
export function clearinghouseName(): "Stedi" | "Simulated" {
  return process.env.CLEARINGHOUSE?.trim().toLowerCase() === "stedi" && process.env.STEDI_API_KEY ? "Stedi" : "Simulated";
}
