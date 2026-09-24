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

  /**
   * Contact channels.
   *
   * PLACEHOLDERS. The address is real; these are not. The mailboxes need the
   * collaboratmd.com domain registered and receiving, and the number is in the
   * 555-01XX range reserved for fictional use, so it can never ring a real
   * person by accident. Replace both before any outbound campaign: a bounced
   * reply from a fund is a lead you never learn about.
   */
  contact: {
    general: "hello@collaboratmd.com",
    investors: "investors@collaboratmd.com",
    /** E.164, digits only, for the wa.me link. */
    whatsapp: "18015550147",
    whatsappDisplay: "+1 (801) 555-0147",
    /** Booking link, e.g. a Calendly URL. Null hides the button entirely. */
    calendar: null as string | null,
  },

  /** Where disputes under the Terms are heard. South Jordan sits in Salt Lake County. */
  jurisdiction: {
    state: "Utah",
    county: "Salt Lake County",
  },
} as const;

/** wa.me deep link, which opens WhatsApp on desktop and mobile alike. */
export function whatsappLink(text?: string): string {
  const base = `https://wa.me/${COMPANY.contact.whatsapp}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

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
