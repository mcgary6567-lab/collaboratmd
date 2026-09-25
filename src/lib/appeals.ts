/**
 * Appeal letters.
 *
 * A letter is written with placeholders, {{PATIENT_NAME}} and the like, and
 * the placeholders are filled on our server. That way an AI model can draft
 * the argument from codes and context alone and never sees who the patient
 * is. Without AI, a template for the denial's category is used.
 */

export const PLACEHOLDERS = [
  "PRACTICE_NAME", "PRACTICE_ADDRESS", "PRACTICE_PHONE", "GROUP_NPI", "TAX_ID", "PAYER_NAME",
  "PATIENT_NAME", "PATIENT_DOB", "MEMBER_ID", "CLAIM_NUMBER", "PAYER_CLAIM_NUMBER", "DATE_OF_SERVICE",
  "BILLED_AMOUNT", "DENIED_AMOUNT", "PROVIDER_NAME", "PROCEDURES", "DIAGNOSES", "DENIAL_CODES", "TODAY",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const HEADER = `{{PRACTICE_NAME}}
{{PRACTICE_ADDRESS}}
{{PRACTICE_PHONE}}

{{TODAY}}

{{PAYER_NAME}}
Attn: Appeals Department

Re: Request for reconsideration
Patient: {{PATIENT_NAME}} (DOB {{PATIENT_DOB}})
Member ID: {{MEMBER_ID}}
Claim number: {{PAYER_CLAIM_NUMBER}} (our reference {{CLAIM_NUMBER}})
Date of service: {{DATE_OF_SERVICE}}
Amount billed: {{BILLED_AMOUNT}}; amount denied: {{DENIED_AMOUNT}}
Denial: {{DENIAL_CODES}}

To whom it may concern:
`;

const FOOTER = `
Enclosed are the documents supporting this request. Please reprocess the claim and contact our office at {{PRACTICE_PHONE}} with any questions.

Sincerely,

{{PROVIDER_NAME}}
{{PRACTICE_NAME}}
Group NPI {{GROUP_NPI}} · Tax ID {{TAX_ID}}
`;

const BODIES: Record<string, string> = {
  authorization: `We are requesting reconsideration of the claim above, denied for missing prior authorization. {{PROCEDURES}} was medically necessary for the diagnoses {{DIAGNOSES}}. [Choose one and delete the other: Authorization was obtained before the service; the authorization number and approval are enclosed. / The service was performed urgently and authorization could not reasonably be obtained in advance; the clinical notes documenting the urgency are enclosed, and we request retroactive authorization.]`,
  medical_necessity: `We are requesting reconsideration of the claim above, denied as not medically necessary. {{PROCEDURES}} was provided for {{DIAGNOSES}}. The enclosed clinical documentation shows the patient's condition, the findings that supported the service, and how it met the plan's coverage criteria for this procedure. We ask that the claim be reviewed against that documentation.`,
  coding: `We are requesting reconsideration of the claim above. We have reviewed the coding of {{PROCEDURES}} with diagnoses {{DIAGNOSES}}. [Explain what was corrected, or why the original coding is accurate, citing the documentation.] A corrected claim or the supporting documentation is enclosed.`,
  eligibility: `We are requesting reconsideration of the claim above, denied for eligibility. Our records show the patient's coverage under member ID {{MEMBER_ID}} was active on {{DATE_OF_SERVICE}}; the eligibility verification from that date is enclosed. Please verify the coverage and reprocess the claim.`,
  timely_filing: `We are requesting reconsideration of the claim above, denied for timely filing. The claim was submitted within the filing limit; the enclosed clearinghouse acceptance report shows the original submission date. [If the delay was caused by another payer or by retroactive eligibility, explain and enclose that proof.]`,
  duplicate: `We are requesting reconsideration of the claim above, denied as a duplicate. The services billed are distinct from those on any earlier claim: [explain, for example a different date of service, a separate procedure, or a corrected claim replacing the original]. Supporting documentation is enclosed.`,
  cob: `We are requesting reconsideration of the claim above, denied for coordination of benefits. The patient's other coverage has been updated [enclose the primary payer's remittance or a statement that there is no other coverage]. Please reprocess the claim with the corrected coordination of benefits.`,
  other: `We are requesting reconsideration of the claim above. We believe it was denied in error: {{PROCEDURES}} was provided for {{DIAGNOSES}} and is a covered benefit under the patient's plan. [Explain why the denial should be overturned.] Supporting documentation is enclosed.`,
};

export function templateLetter(category: string): string {
  return `${HEADER}\n${BODIES[category] ?? BODIES.other}\n${FOOTER}`;
}

/** The body an AI drafted, wrapped in the same header and footer. */
export function wrapBody(body: string): string {
  return `${HEADER}\n${body.trim()}\n${FOOTER}`;
}

/** Placeholders a draft uses that are not ones we know how to fill. */
export function unknownPlaceholders(text: string): string[] {
  const found = [...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p)))];
}

export function fillPlaceholders(text: string, values: Partial<Record<Placeholder, string>>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => (values as Record<string, string>)[key] ?? m);
}
