/**
 * Mapping another system's patient export onto CollaboratMD's fields.
 *
 * Every EHR names its columns differently ("DOB", "Birth Date", "Pt_BirthDt").
 * The mapper scores each column against each field twice: by its header,
 * against synonyms, and by the shape of its values (dates, two-letter states,
 * five-digit ZIPs, emails). A user can then correct any choice before import.
 *
 * `profileColumn` describes a column's values without including any of them,
 * so that description is what may be sent to an AI model to help map an
 * unusual file: headers and shapes, never patient data.
 */

export type PatientField =
  | "mrn" | "lastName" | "firstName" | "fullName" | "dob" | "sex" | "phone" | "email"
  | "address1" | "city" | "state" | "zip" | "payerName" | "memberId" | "groupNumber";

export const PATIENT_FIELDS: { key: PatientField; label: string; synonyms: string[] }[] = [
  { key: "mrn", label: "MRN / account number", synonyms: ["mrn", "medical record number", "medical record", "account number", "account", "acct", "chart number", "chart", "patient id", "pat id", "person number", "patient number", "patient account"] },
  { key: "lastName", label: "Last name", synonyms: ["last name", "lastname", "lname", "surname", "family name", "patient last name", "pt last"] },
  { key: "firstName", label: "First name", synonyms: ["first name", "firstname", "fname", "given name", "patient first name", "pt first"] },
  { key: "fullName", label: "Full name (Last, First)", synonyms: ["patient name", "name", "full name", "patient"] },
  { key: "dob", label: "Date of birth", synonyms: ["dob", "date of birth", "birth date", "birthdate", "birthday", "pt birth dt", "birth dt"] },
  { key: "sex", label: "Sex", synonyms: ["sex", "gender", "birth sex"] },
  { key: "phone", label: "Phone", synonyms: ["phone", "phone number", "mobile", "cell", "cell phone", "home phone", "telephone", "primary phone", "contact number"] },
  { key: "email", label: "Email", synonyms: ["email", "e mail", "email address"] },
  { key: "address1", label: "Street address", synonyms: ["address", "address 1", "address1", "address line 1", "street", "street address", "addr"] },
  { key: "city", label: "City", synonyms: ["city", "town"] },
  { key: "state", label: "State", synonyms: ["state", "st", "state code", "province"] },
  { key: "zip", label: "ZIP", synonyms: ["zip", "zip code", "zipcode", "postal code", "postal"] },
  { key: "payerName", label: "Insurance company", synonyms: ["insurance", "insurance name", "insurance company", "payer", "payor", "payer name", "carrier", "primary insurance", "plan name", "ins name", "primary payer"] },
  { key: "memberId", label: "Member ID", synonyms: ["member id", "memberid", "subscriber id", "subscriber number", "policy number", "policy", "insurance id", "member number", "ins id", "policy id", "primary member id"] },
  { key: "groupNumber", label: "Group number", synonyms: ["group", "group number", "group no", "group id", "grp", "group num"] },
];

export const REQUIRED: PatientField[] = ["dob"];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ------------------------------ Values ------------------------------ */

export function normalizeDate(v: string, today = new Date()): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/))) {
    [m, d, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
    // Two-digit years: a birth year cannot be in the future.
    if (r[3].length === 2) y += y > today.getFullYear() % 100 ? 1900 : 2000;
  } else if ((r = s.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function normalizeSex(v: string): "M" | "F" | "U" | null {
  const s = v.trim().toLowerCase();
  if (["m", "male", "man", "1"].includes(s)) return "M";
  if (["f", "female", "woman", "2"].includes(s)) return "F";
  if (["u", "unknown", "o", "other", "x", "", "0", "9"].includes(s)) return "U";
  return null;
}

export function normalizePhone(v: string): string {
  const digits = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : v.trim();
}

/** "Doe, Jane" or "Jane Doe" into its parts. */
export function splitName(v: string): { firstName: string; lastName: string } | null {
  const s = v.trim().replace(/\s+/g, " ");
  if (s.includes(",")) {
    const [last, rest] = s.split(",", 2).map((x) => x.trim());
    const first = rest.split(" ")[0];
    return last && first ? { firstName: first, lastName: last } : null;
  }
  const parts = s.split(" ");
  return parts.length >= 2 ? { firstName: parts[0], lastName: parts[parts.length - 1] } : null;
}

/* ------------------------------ Mapping ------------------------------ */

export interface ColumnProfile {
  header: string;
  filled: number; // share of rows with a value, 0-1
  shapes: string[]; // e.g. "date", "email", "state", "zip", "sex", "digits", "alphanumeric id", "text"
}

/** Describes a column by the shape of its values, without any value. */
export function profileColumn(header: string, values: string[]): ColumnProfile {
  const present = values.filter((v) => v.trim() !== "");
  const share = (test: (v: string) => boolean) => (present.length ? present.filter(test).length / present.length : 0);
  const shapes: string[] = [];
  const checks: [string, (v: string) => boolean][] = [
    ["date", (v) => normalizeDate(v) !== null],
    ["email", (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)],
    ["us state code", (v) => /^[A-Za-z]{2}$/.test(v)],
    ["zip code", (v) => /^\d{5}(-\d{4})?$/.test(v)],
    ["sex code", (v) => normalizeSex(v) !== null && v.length <= 7],
    ["phone number", (v) => v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 11 && /^[\d\s().+-]+$/.test(v)],
    ["name with comma", (v) => /^[A-Za-z'.-]+,\s*[A-Za-z]/.test(v)],
    ["alphanumeric id", (v) => /^[A-Za-z0-9-]{5,20}$/.test(v) && /\d/.test(v)],
    ["street address", (v) => /^\d+\s+\S+/.test(v)],
    ["words", (v) => /^[A-Za-z][A-Za-z .'&-]*$/.test(v)],
  ];
  for (const [name, test] of checks) if (share(test) >= 0.8) shapes.push(name);
  return { header, filled: values.length ? present.length / values.length : 0, shapes };
}

function headerScore(header: string, field: (typeof PATIENT_FIELDS)[number]): number {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  for (const syn of field.synonyms) {
    if (h === syn) return 1;
    if (h.replace(/ /g, "") === syn.replace(/ /g, "")) best = Math.max(best, 0.95);
    else if (new RegExp(`(^| )${syn}( |$)`).test(h)) best = Math.max(best, syn.length > 3 ? 0.75 : 0.5);
  }
  return best;
}

const SHAPE_FIT: Partial<Record<PatientField, string[]>> = {
  dob: ["date"], email: ["email"], state: ["us state code"], zip: ["zip code"], sex: ["sex code"], phone: ["phone number"],
  fullName: ["name with comma"], address1: ["street address"], memberId: ["alphanumeric id"], mrn: ["alphanumeric id"],
};

export interface MappingChoice {
  field: PatientField;
  column: number | null;
  confidence: number;
}

/**
 * Picks at most one column per field, strongest match first. A header match
 * is confirmed or weakened by the values: a "Date" column full of emails is
 * not a date of birth.
 */
export function autoMap(profiles: ColumnProfile[]): MappingChoice[] {
  const candidates: { field: PatientField; column: number; score: number }[] = [];
  profiles.forEach((p, column) => {
    for (const f of PATIENT_FIELDS) {
      let score = headerScore(p.header, f);
      const fits = SHAPE_FIT[f.key];
      if (fits && score > 0) {
        // Values that fit confirm the header; values of some other distinct
        // kind (emails under "Date") contradict it; plain text is neutral.
        const distinct = p.shapes.filter((s) => s !== "words");
        if (fits.some((s) => p.shapes.includes(s))) score = Math.min(1, score + 0.1);
        else if (distinct.length) score *= 0.6;
      }
      if (score >= 0.45) candidates.push({ field: f.key, column, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const usedCols = new Set<number>();
  const chosen = new Map<PatientField, MappingChoice>();
  for (const c of candidates) {
    if (usedCols.has(c.column) || chosen.has(c.field)) continue;
    chosen.set(c.field, { field: c.field, column: c.column, confidence: Math.round(c.score * 100) / 100 });
    usedCols.add(c.column);
  }
  // Separate first and last names make a full-name column redundant.
  if (chosen.has("firstName") && chosen.has("lastName")) chosen.delete("fullName");
  return PATIENT_FIELDS.map((f) => chosen.get(f.key) ?? { field: f.key, column: null, confidence: 0 });
}

/* ------------------------------ Rows ------------------------------ */

export interface PatientRow {
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  sex: "M" | "F" | "U";
  phone: string;
  email: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  payerName: string;
  memberId: string;
  groupNumber: string;
}

export type Mapping = Partial<Record<PatientField, number | null>>;

/** One source row as a patient, or the reason it cannot be one. */
export function toPatientRow(row: string[], mapping: Mapping, today = new Date()): { ok: true; value: PatientRow } | { ok: false; error: string } {
  const val = (f: PatientField) => {
    const i = mapping[f];
    return i === null || i === undefined ? "" : (row[i] ?? "").trim();
  };
  let firstName = val("firstName");
  let lastName = val("lastName");
  if ((!firstName || !lastName) && val("fullName")) {
    const split = splitName(val("fullName"));
    if (split) ({ firstName, lastName } = split);
  }
  if (!firstName || !lastName) return { ok: false, error: "Missing first or last name" };
  const dob = normalizeDate(val("dob"), today);
  if (!dob) return { ok: false, error: val("dob") ? `Unreadable date of birth "${val("dob")}"` : "Missing date of birth" };
  if (dob > today.toISOString().slice(0, 10)) return { ok: false, error: "Date of birth is in the future" };
  const sex = normalizeSex(val("sex")) ?? "U";
  const email = val("email");
  const zip = val("zip").replace(/^(\d{5})(\d{4})$/, "$1-$2");
  return {
    ok: true,
    value: {
      mrn: val("mrn"), firstName, lastName, dob, sex,
      phone: val("phone") ? normalizePhone(val("phone")) : "",
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : "",
      address1: val("address1"), city: val("city"), state: val("state").toUpperCase().slice(0, 2), zip: /^\d{5}(-\d{4})?$/.test(zip) ? zip : "",
      payerName: val("payerName"), memberId: val("memberId"), groupNumber: val("groupNumber"),
    },
  };
}
