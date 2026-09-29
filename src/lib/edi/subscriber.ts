/**
 * The insured person (subscriber) and, when that is someone else, the patient,
 * as the 837 (P, I and D, 5010) carries them:
 *
 * - The patient is the subscriber: loop 2000B only, SBR02 = 18.
 * - The patient is a dependent (a child on a parent's plan, a spouse): loop
 *   2000B describes the subscriber with SBR02 left empty and HL04 = 1, and a
 *   2000C patient level follows the payer (HL level 23, PAT01 relationship,
 *   NM1*QC name, address and DMG).
 *
 * Sending the patient's own name and birth date as the subscriber of someone
 * else's plan is the classic reason a payer rejects a dependent's claim.
 */
export type Person = {
  lastName: string;
  firstName: string;
  dob: string; // YYYY-MM-DD
  sex: string; // M | F | U
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type Subscriber = Person & { memberId: string; groupNumber?: string | null; relationship: string };

/** PAT01 / 2320 SBR02 individual relationship codes. */
export const REL_CODE: Record<string, string> = { self: "18", spouse: "01", child: "19", other: "G8" };

export const isDependent = (relationship: string) => relationship !== "self";

const d8 = (date: string) => date.replace(/-/g, "");
const sexCode = (s: string) => (s === "F" || s === "M" ? s : "U");

function nameAndPlace(p: Person): string[][] {
  return [
    ...(p.address1 ? [["N3", p.address1]] : []),
    ...(p.city ? [["N4", p.city, p.state ?? "", (p.zip ?? "").replace("-", "")]] : []),
    ["DMG", "D8", d8(p.dob), sexCode(p.sex)],
  ];
}

/**
 * Loops 2000B/2010BA/2010BB and, for a dependent, 2000C/2010CA. `payer` is the
 * 2010BB payer name segment; `filing` is SBR09 (the claim filing indicator).
 */
export function subscriberLoops(o: { sequence: "P" | "S"; subscriber: Subscriber; patient: Person; filing: string; payer: string[]; propertyClaimNumber?: string | null; insuranceType?: string | null }): string[][] {
  const dependent = isDependent(o.subscriber.relationship);
  const out: string[][] = [
    ["HL", "2", "1", "22", dependent ? "1" : "0"],
    // SBR05: when Medicare pays second, why (the Medicare Secondary Payer type).
    ["SBR", o.sequence, dependent ? "" : "18", o.subscriber.groupNumber ?? "", "", o.sequence === "S" && o.filing === "MB" ? o.insuranceType ?? "" : "", "", "", "", o.filing],
    ["NM1", "IL", "1", o.subscriber.lastName, o.subscriber.firstName, "", "", "", "MI", o.subscriber.memberId],
    ...nameAndPlace(o.subscriber),
    // Workers' comp and auto: the insurer's own claim number for the injury.
    ...(o.propertyClaimNumber ? [["REF", "Y4", o.propertyClaimNumber]] : []),
    o.payer,
  ];
  if (dependent) {
    out.push(
      ["HL", "3", "2", "23", "0"],
      ["PAT", REL_CODE[o.subscriber.relationship] ?? "G8"],
      ["NM1", "QC", "1", o.patient.lastName, o.patient.firstName],
      ...nameAndPlace(o.patient),
    );
  }
  return out;
}
