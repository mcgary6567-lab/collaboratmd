/** Laboratory tests: CPT 80000-89999 (pathology and laboratory). Claims with them carry the CLIA number. */
export const isLabCode = (cpt: string) => /^8\d{4}$/.test(cpt.trim());

/** A CLIA certificate number: two digits, D, seven digits (for example 10D1234567). */
export const CLIA_RE = /^\d{2}D\d{7}$/;
