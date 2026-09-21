/** Claim Adjustment Reason Codes (CARC) - subset with plain-language guidance. */
export interface CarcInfo {
  description: string;
  category: "eligibility" | "authorization" | "coding" | "timely_filing" | "duplicate" | "medical_necessity" | "cob" | "contractual" | "patient_responsibility" | "other";
  plain: string;
  nextSteps: string[];
}

export const CARC: Record<string, CarcInfo> = {
  "1": { description: "Deductible amount", category: "patient_responsibility", plain: "The payer applied this amount to the patient's deductible. The patient owes it.", nextSteps: ["Transfer the balance to patient responsibility", "Send a patient statement"] },
  "2": { description: "Coinsurance amount", category: "patient_responsibility", plain: "This is the patient's coinsurance share.", nextSteps: ["Transfer the balance to patient responsibility", "Send a patient statement"] },
  "3": { description: "Co-payment amount", category: "patient_responsibility", plain: "This is the patient's copay.", nextSteps: ["Confirm the copay was collected at check-in", "Bill the patient for any remaining copay"] },
  "4": { description: "Procedure code inconsistent with modifier or required modifier missing", category: "coding", plain: "The CPT code and modifier combination is not valid, or a required modifier is missing.", nextSteps: ["Review the modifier on the flagged line against the payer policy", "Correct and resubmit as a corrected claim (frequency code 7)"] },
  "11": { description: "Diagnosis inconsistent with procedure", category: "medical_necessity", plain: "The diagnosis on the claim does not support the procedure billed.", nextSteps: ["Check the diagnosis pointers and ICD-10 codes against the chart", "Correct the diagnosis and resubmit, or appeal with documentation"] },
  "16": { description: "Claim/service lacks information or has submission/billing error", category: "coding", plain: "The claim is missing information the payer needs. The remark code (RARC) says what is missing.", nextSteps: ["Read the RARC to find the missing element", "Add the missing information and resubmit as a corrected claim"] },
  "18": { description: "Exact duplicate claim/service", category: "duplicate", plain: "The payer already has this claim on file.", nextSteps: ["Check the original claim status before doing anything", "If the original was paid, adjust this one off; if it was denied, work the original denial"] },
  "22": { description: "Care may be covered by another payer per coordination of benefits", category: "cob", plain: "The payer believes another insurance is primary.", nextSteps: ["Verify coverage order with the patient", "Bill the primary payer first, then submit secondary with the primary EOB"] },
  "26": { description: "Expenses incurred prior to coverage", category: "eligibility", plain: "The patient was not covered on the date of service.", nextSteps: ["Re-run eligibility for the date of service", "Bill the correct payer or the patient"] },
  "27": { description: "Expenses incurred after coverage terminated", category: "eligibility", plain: "Coverage had ended before the date of service.", nextSteps: ["Ask the patient for current insurance", "Rebill the new payer or transfer to patient"] },
  "29": { description: "Time limit for filing has expired", category: "timely_filing", plain: "The claim was submitted after the payer's timely filing deadline.", nextSteps: ["Locate proof of timely submission (clearinghouse acceptance report)", "Appeal with proof, otherwise write off (cannot bill patient)"] },
  "45": { description: "Charge exceeds fee schedule/maximum allowable", category: "contractual", plain: "Normal contractual adjustment: the difference between your charge and the allowed amount.", nextSteps: ["No action needed; this is a contractual write-off"] },
  "50": { description: "Non-covered service because not deemed medically necessary", category: "medical_necessity", plain: "The payer decided the service was not medically necessary.", nextSteps: ["Pull the clinical notes and LCD/NCD policy", "Appeal with documentation supporting necessity"] },
  "96": { description: "Non-covered charge(s)", category: "other", plain: "The service is not covered under the patient's plan.", nextSteps: ["Check the plan benefits", "If an ABN/waiver was signed, bill the patient; otherwise write off"] },
  "97": { description: "Benefit included in payment for another service", category: "coding", plain: "The payer bundled this service into another service on the claim (NCCI edit).", nextSteps: ["Review NCCI edits for the code pair", "Append modifier 59/XU only if the services were truly distinct, then resubmit"] },
  "109": { description: "Claim not covered by this payer/contractor", category: "cob", plain: "You sent the claim to the wrong payer.", nextSteps: ["Verify the correct payer and payer ID", "Resubmit to the correct payer"] },
  "119": { description: "Benefit maximum reached", category: "other", plain: "The patient has used up the benefit for this service.", nextSteps: ["Confirm the benefit limit with the payer", "Transfer to patient responsibility"] },
  "197": { description: "Precertification/authorization absent", category: "authorization", plain: "The service required prior authorization and none was on file.", nextSteps: ["Check whether an authorization exists and was omitted from the claim", "If it exists, add it and resubmit; otherwise request a retro-authorization or appeal"] },
  "204": { description: "Service not covered under the patient's current benefit plan", category: "other", plain: "The plan does not cover this service.", nextSteps: ["Verify benefits", "Bill patient if a waiver was signed, otherwise write off"] },
  "B7": { description: "Provider not certified/eligible to be paid for this procedure on this date", category: "other", plain: "The provider was not credentialed with this payer on the date of service.", nextSteps: ["Check credentialing/enrollment status", "Appeal once enrollment is effective or bill under a credentialed provider if allowed"] },
};

export const RARC: Record<string, string> = {
  M51: "Missing/incomplete/invalid procedure code(s).",
  M76: "Missing/incomplete/invalid diagnosis or condition.",
  M86: "Service denied because payment already made for same/similar procedure within set time frame.",
  N30: "Patient ineligible for this service.",
  N54: "Claim information is inconsistent with pre-certified/authorized services.",
  N130: "Consult plan benefit documents/guidelines for information about restrictions for this service.",
  N179: "Additional information has been requested from the member.",
  MA130: "Your claim contains incomplete and/or invalid information; no appeal rights.",
};

export function carcCategory(carc: string): string {
  return CARC[carc]?.category ?? "other";
}
