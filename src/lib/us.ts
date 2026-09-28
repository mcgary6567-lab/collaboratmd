/**
 * United States formats: states and territories, ZIP codes and phone numbers,
 * checked and shown the same way everywhere.
 */

/** The 50 states, DC, and the territories whose practices bill US payers. */
export const US_STATES: [code: string, name: string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"],
  ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"],
  ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"], ["AS", "American Samoa"], ["MP", "Northern Mariana Islands"],
];
const CODES = new Set(US_STATES.map(([c]) => c));

export const isUsState = (v: string | null | undefined) => !!v && CODES.has(v.trim().toUpperCase());

/** "32801" or "32801-1234" from what was typed, or null when it is not a US ZIP code. */
export function normalizeZip(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 5) return d;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return null;
}

/** "(407) 555-0100" from any way a US number is typed, or null when it is not one. */
export function normalizePhone(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}

/** A stored number shown the US way; anything that is not a US number is shown as it was typed. */
export const fmtPhone = (v: string | null | undefined) => (v ? normalizePhone(v) ?? v : "");

/**
 * Checks an address typed by staff or a patient. Empty parts are allowed (the
 * scrubber asks for what a claim needs); what is there must be a US state and
 * ZIP. Returns the cleaned values.
 */
export function checkUsAddress(a: { state?: string | null; zip?: string | null; phone?: string | null }) {
  const state = a.state?.trim().toUpperCase() || null;
  if (state && !CODES.has(state)) throw new Error(`${state} is not a US state or territory`);
  const zip = a.zip?.trim() ? normalizeZip(a.zip) : null;
  if (a.zip?.trim() && !zip) throw new Error("ZIP code must be 5 digits, or ZIP+4");
  const phone = a.phone?.trim() ? normalizePhone(a.phone) : null;
  if (a.phone?.trim() && !phone) throw new Error("Phone must be a 10-digit US number");
  return { state, zip, phone };
}
