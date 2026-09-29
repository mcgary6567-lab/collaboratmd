/** Provider credentials, for the claim checks and Medicare pricing that depend on who performed the service. */
export const CREDENTIALS: [string, string][] = [
  ["MD", "MD (physician)"], ["DO", "DO (physician)"], ["NP", "Nurse practitioner"], ["PA", "Physician assistant"], ["CNS", "Clinical nurse specialist"],
  ["CNM", "Certified nurse-midwife"], ["DPM", "Podiatrist"], ["DC", "Chiropractor"], ["OD", "Optometrist"], ["PT", "Physical therapist"], ["OT", "Occupational therapist"],
  ["SLP", "Speech-language pathologist"], ["PHD", "Clinical psychologist"], ["LCSW", "Clinical social worker"], ["OTHER", "Other"],
];
export const isCredential = (c: string | null | undefined) => !!c && CREDENTIALS.some(([k]) => k === c);

/** Medicare pays these practitioners 85% of the physician fee schedule when they bill under their own NPI. */
export const NPP_85 = new Set(["NP", "PA", "CNS"]);
export const medicarePercentFor = (credential: string | null | undefined) => (credential && NPP_85.has(credential) ? 85 : 100);
