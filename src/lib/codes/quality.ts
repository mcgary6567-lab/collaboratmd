/** Quality data codes (MIPS): CPT Category II (four digits and F) and HCPCS G-codes, reported at $0.00 alongside the visit. */
export const isQualityCode = (code: string) => /^\d{4}F$/.test(code.toUpperCase()) || /^G\d{4}$/.test(code.toUpperCase());

/** Codes billed at $0.00: quality data codes, and 99024 for a routine visit inside a surgery's global period. */
export const isZeroChargeCode = (code: string) => isQualityCode(code) || code.toUpperCase() === "99024";
