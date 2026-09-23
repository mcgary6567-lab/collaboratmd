/**
 * Company facts, in one place.
 *
 * The address, the legal name and the governing jurisdiction appear on the
 * contact page, in the footer and inside three legal documents. Keeping one
 * definition is what stops those copies disagreeing the first time something
 * changes.
 */
export const COMPANY = {
  name: "CollaboratMD",
  legalName: "CollaboratMD",
  tagline: "Medical billing and revenue cycle management",

  address: {
    street: "10377 S Jordan Gateway #110",
    city: "South Jordan",
    state: "UT",
    stateName: "Utah",
    zip: "84095",
    country: "United States",
  },

  /** Where disputes under the Terms are heard. South Jordan sits in Salt Lake County. */
  jurisdiction: {
    state: "Utah",
    county: "Salt Lake County",
  },
} as const;

/** One-line form, for a footer or a signature block. */
export function addressLine(): string {
  const a = COMPANY.address;
  return `${a.street}, ${a.city}, ${a.state} ${a.zip}`;
}

/** Two-line form, for a contact card. */
export function addressLines(): [string, string] {
  const a = COMPANY.address;
  return [a.street, `${a.city}, ${a.state} ${a.zip}`];
}
