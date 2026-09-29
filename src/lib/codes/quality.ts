/** Quality data codes (MIPS): CPT Category II (four digits and F) and HCPCS G-codes, reported at $0.00 alongside the visit. */
export const isQualityCode = (code: string) => /^\d{4}F$/.test(code.toUpperCase()) || /^G\d{4}$/.test(code.toUpperCase());
