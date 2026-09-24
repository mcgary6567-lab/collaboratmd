/**
 * What billing needs out of the HL7 messages an EHR sends.
 *
 * ADT (admit/discharge/transfer) messages register and update patients: A04
 * register, A08 update, A28 add person, A31 update person. They carry the
 * patient in PID and insurance in IN1.
 *
 * DFT^P03 (detailed financial transaction) posts charges: one FT1 per
 * procedure, with diagnoses in FT1-19 or DG1 segments and the rendering
 * provider in FT1-20 or PV1-7.
 */
import { get, hl7Date, repetitions, segment, segments, type Hl7Message } from "./v2";

export const ADT_EVENTS = ["A04", "A08", "A28", "A31", "A01", "A05"];

export interface Hl7Patient {
  mrn: string;
  lastName: string;
  firstName: string;
  dob: string;
  sex: "M" | "F" | "U";
  address1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
}

export interface Hl7Insurance {
  payerId: string;
  payerName: string;
  memberId: string;
  groupNumber: string;
  relationship: "self" | "spouse" | "child" | "other";
}

export interface Hl7Charge {
  dateOfService: string;
  cpt: string;
  modifiers: string[];
  units: number;
  /** Extended amount from FT1-11, when the EHR prices the line. */
  chargeCents: number | null;
  diagnoses: string[];
  providerNpi: string;
  description: string;
}

export interface Hl7Encounter {
  visitNumber: string;
  placeOfService: string;
  providerNpi: string;
  diagnoses: string[];
  charges: Hl7Charge[];
}

const SEX: Record<string, Hl7Patient["sex"]> = { M: "M", F: "F", U: "U", O: "U", A: "U", N: "U" };
/** HL7 table 0063, insured's relationship to patient. */
const RELATIONSHIP: Record<string, Hl7Insurance["relationship"]> = {
  SEL: "self", "01": "self", "18": "self", SPO: "spouse", "02": "spouse", CHD: "child", "03": "child", "19": "child",
};

export function extractPatient(msg: Hl7Message): Hl7Patient {
  const pid = segment(msg, "PID");
  if (!pid) throw new Error("The message has no PID segment");
  // PID-3 repeats (MRN, SSN, other IDs); prefer the one typed MR.
  const ids = repetitions(msg, pid, 3);
  const mrn = (ids.find((r) => r[4] === "MR") ?? ids[0] ?? [])[0] ?? "";
  // PID-13 (XTN) repeats: phone numbers in XTN-1, or split into area code
  // (XTN-6) and local number (XTN-7); email in XTN-4 on the NET/Internet entry.
  const telecom = repetitions(msg, pid, 13);
  const phoneOf = (r: string[]) => r[0] || (r[5] && r[6] ? `${r[5]}-${r[6].replace(/^(\d{3})(\d{4})$/, "$1-$2")}` : "");
  const phone = telecom.filter((r) => r[1] !== "NET" && r[2] !== "Internet").map(phoneOf).find(Boolean) ?? "";
  const email = telecom.find((r) => r[1] === "NET" || r[2] === "Internet")?.[3] ?? "";
  const p: Hl7Patient = {
    mrn,
    lastName: get(msg, pid, 5, 1),
    firstName: get(msg, pid, 5, 2),
    dob: hl7Date(get(msg, pid, 7)),
    sex: SEX[get(msg, pid, 8).toUpperCase()] ?? "U",
    address1: get(msg, pid, 11, 1),
    city: get(msg, pid, 11, 3),
    state: get(msg, pid, 11, 4).toUpperCase().slice(0, 2),
    zip: get(msg, pid, 11, 5),
    phone,
    email: email.toLowerCase(),
  };
  const missing = [!p.mrn && "PID-3 (MRN)", !p.lastName && "PID-5 (last name)", !p.firstName && "PID-5.2 (first name)", !p.dob && "PID-7 (date of birth)"].filter(Boolean);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}`);
  return p;
}

/** Primary insurance, from the first IN1 (IN1-1 = 1). */
export function extractInsurance(msg: Hl7Message): Hl7Insurance | null {
  const in1 = segments(msg, "IN1").find((s) => get(msg, s, 1) === "1") ?? segment(msg, "IN1");
  if (!in1) return null;
  const memberId = get(msg, in1, 36) || get(msg, in1, 49);
  if (!memberId) return null;
  return {
    payerId: get(msg, in1, 3),
    payerName: get(msg, in1, 4),
    memberId,
    groupNumber: get(msg, in1, 8),
    relationship: RELATIONSHIP[get(msg, in1, 17).toUpperCase()] ?? "other",
  };
}

export function extractEncounter(msg: Hl7Message): Hl7Encounter {
  const pv1 = segment(msg, "PV1");
  const dg1 = segments(msg, "DG1")
    .sort((a, b) => Number(get(msg, a, 15) || get(msg, a, 1)) - Number(get(msg, b, 15) || get(msg, b, 1)))
    .map((s) => get(msg, s, 3));
  const providerNpi = get(msg, pv1, 7);
  const charges = segments(msg, "FT1").map((ft1): Hl7Charge => {
    // The procedure is FT1-25; many EHRs put it in FT1-7 (transaction code) instead.
    const cpt = (get(msg, ft1, 25) || get(msg, ft1, 7)).toUpperCase();
    const units = Number(get(msg, ft1, 10)) || 1;
    const extended = parseFloat(get(msg, ft1, 11));
    return {
      dateOfService: hl7Date(get(msg, ft1, 4)),
      cpt,
      modifiers: repetitions(msg, ft1, 26).map((r) => r[0].toUpperCase()).filter(Boolean),
      units,
      chargeCents: Number.isFinite(extended) && extended > 0 ? Math.round(extended * 100) : null,
      diagnoses: repetitions(msg, ft1, 19).map((r) => r[0]).filter(Boolean),
      providerNpi: get(msg, ft1, 20) || providerNpi,
      description: get(msg, ft1, 25, 2) || get(msg, ft1, 7, 2),
    };
  });
  if (!charges.length) throw new Error("The DFT has no FT1 charge segments");
  const bad = charges.find((c) => !/^[A-Z0-9]{5}$/.test(c.cpt));
  if (bad) throw new Error(`FT1 has an invalid procedure code "${bad.cpt}"`);
  if (charges.some((c) => !c.dateOfService)) throw new Error("FT1-4 (transaction date) is missing");
  const diagnoses = [...new Set([...dg1, ...charges.flatMap((c) => c.diagnoses)].map((d) => d.replace(/\./g, "").toUpperCase()).filter(Boolean))];
  if (!diagnoses.length) throw new Error("No diagnoses in DG1 or FT1-19");
  return {
    visitNumber: get(msg, pv1, 19),
    // PV1-2 patient class: I inpatient -> 21, E emergency -> 23, otherwise office.
    placeOfService: { I: "21", E: "23", O: "11" }[get(msg, pv1, 2).toUpperCase()] ?? "11",
    providerNpi,
    diagnoses: diagnoses.slice(0, 12),
    charges,
  };
}
