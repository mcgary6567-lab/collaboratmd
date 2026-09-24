/**
 * Patient cost estimates.
 *
 * Pure functions: the numbers a patient is quoted before care must be
 * explainable and reproducible, so the arithmetic lives here with its tests
 * rather than inside a database routine.
 */

export interface EstimateLineInput {
  cpt: string;
  units: number;
  /** What the practice bills for the line. */
  chargeCents: number;
  /** What the payer will allow, from the contract. Falls back to the charge. */
  allowedCents: number;
}

export interface Benefits {
  /** Flat copay for an office visit, applied once, to evaluation and management services. */
  copayCents: number;
  deductibleRemainingCents: number;
  /** Patient's share after the deductible, 0-100. */
  coinsurancePct: number;
  /** Out-of-pocket maximum still to reach this plan year, when known. */
  oopRemainingCents?: number | null;
}

export interface InsuredEstimate {
  totalChargeCents: number;
  allowedCents: number;
  copayCents: number;
  deductibleCents: number;
  coinsuranceCents: number;
  /** Reduction applied because the out-of-pocket maximum was reached. */
  oopCapCents: number;
  patientOwesCents: number;
  insurancePaysCents: number;
}

/** Evaluation and management codes, which is where an office copay applies. */
export function isEvaluationAndManagement(cpt: string): boolean {
  return /^99(2[0-9]|3[0-9]|4[0-9])\d$/.test(cpt);
}

/**
 * Standard benefit order: the copay covers the visit itself, the remaining
 * allowed amount goes to the deductible first, then coinsurance applies to
 * what is left, and the out-of-pocket maximum caps the patient's total.
 *
 * Plans vary, and some waive the deductible for services under a copay. This
 * is the common case, and every figure it produces is itemized so the
 * patient can see how it was reached.
 */
export function estimateInsured(lines: EstimateLineInput[], b: Benefits): InsuredEstimate {
  const totalChargeCents = lines.reduce((a, l) => a + l.chargeCents * l.units, 0);
  const allowedCents = lines.reduce((a, l) => a + l.allowedCents * l.units, 0);

  const emAllowed = lines.filter((l) => isEvaluationAndManagement(l.cpt)).reduce((a, l) => a + l.allowedCents * l.units, 0);
  const copayCents = emAllowed > 0 ? Math.min(Math.max(b.copayCents, 0), emAllowed) : 0;

  // The copay stands in for cost sharing on the visit; everything else is
  // subject to the deductible and coinsurance.
  const subjectToDeductible = allowedCents - emAllowed;
  const deductibleCents = Math.min(Math.max(b.deductibleRemainingCents, 0), subjectToDeductible);
  const pct = Math.min(Math.max(b.coinsurancePct, 0), 100);
  const coinsuranceCents = Math.round(((subjectToDeductible - deductibleCents) * pct) / 100);

  let patient = copayCents + deductibleCents + coinsuranceCents;
  let oopCapCents = 0;
  if (b.oopRemainingCents !== undefined && b.oopRemainingCents !== null && patient > b.oopRemainingCents) {
    oopCapCents = patient - Math.max(b.oopRemainingCents, 0);
    patient = Math.max(b.oopRemainingCents, 0);
  }
  return {
    totalChargeCents,
    allowedCents,
    copayCents,
    deductibleCents,
    coinsuranceCents,
    oopCapCents,
    patientOwesCents: patient,
    insurancePaysCents: allowedCents - patient,
  };
}

export interface GoodFaithEstimate {
  totalChargeCents: number;
  discountCents: number;
  patientOwesCents: number;
}

/**
 * A good faith estimate for an uninsured or self-pay patient, as the No
 * Surprises Act requires: the expected charges, less the practice's self-pay
 * discount. No payer is involved, so there is no allowed amount.
 */
export function estimateSelfPay(lines: EstimateLineInput[], discountPct: number): GoodFaithEstimate {
  const totalChargeCents = lines.reduce((a, l) => a + l.chargeCents * l.units, 0);
  const pct = Math.min(Math.max(discountPct, 0), 100);
  const discountCents = Math.round((totalChargeCents * pct) / 100);
  return { totalChargeCents, discountCents, patientOwesCents: totalChargeCents - discountCents };
}

/**
 * Under the No Surprises Act a patient may dispute a bill that exceeds the
 * good faith estimate by $400 or more. Shown on the estimate so the patient
 * knows the threshold that protects them.
 */
export const GFE_DISPUTE_THRESHOLD_CENTS = 40_000;
