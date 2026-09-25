/**
 * Office and outpatient E/M level (CPT 99202-99205, 99212-99215) under the
 * AMA guidelines in effect since 2021: the level is chosen by total time on
 * the date of the encounter or by medical decision making (MDM), whichever
 * supports the higher level. MDM is met by two of its three elements.
 */

export type PatientKind = "new" | "established";
export type MdmLevel = "straightforward" | "low" | "moderate" | "high";
export const MDM_LEVELS: MdmLevel[] = ["straightforward", "low", "moderate", "high"];

/** Minimum total minutes for each level (time must be met or exceeded). */
const TIME: Record<PatientKind, [code: string, minutes: number][]> = {
  new: [["99202", 15], ["99203", 30], ["99204", 45], ["99205", 60]],
  established: [["99212", 10], ["99213", 20], ["99214", 30], ["99215", 40]],
};
const BY_MDM: Record<PatientKind, Record<MdmLevel, string>> = {
  new: { straightforward: "99202", low: "99203", moderate: "99204", high: "99205" },
  established: { straightforward: "99212", low: "99213", moderate: "99214", high: "99215" },
};

export const MDM_ELEMENTS = {
  problems: {
    label: "Number and complexity of problems addressed",
    options: {
      straightforward: "1 self-limited or minor problem",
      low: "2+ minor problems, 1 stable chronic illness, or 1 acute uncomplicated illness or injury",
      moderate: "1+ chronic illness with progression or side effects, 2+ stable chronic illnesses, 1 undiagnosed new problem with uncertain prognosis, or 1 acute illness with systemic symptoms",
      high: "1+ chronic illness with severe progression, or 1 acute or chronic illness posing a threat to life or bodily function",
    },
  },
  data: {
    label: "Amount and complexity of data reviewed and analyzed",
    options: {
      straightforward: "Minimal or none",
      low: "Limited: 2 of tests or documents reviewed, or tests ordered; or an independent historian",
      moderate: "Moderate: 3 of those; or independent interpretation of a test; or discussion with an external physician",
      high: "Extensive: 2 of the moderate categories",
    },
  },
  risk: {
    label: "Risk of complications from patient management",
    options: {
      straightforward: "Minimal (e.g. rest, gargles)",
      low: "Low (e.g. over-the-counter drugs, minor surgery without risk factors)",
      moderate: "Moderate (e.g. prescription drug management, minor surgery with risk factors, social determinants limiting treatment)",
      high: "High (e.g. drug therapy needing intensive toxicity monitoring, decision about hospitalization or major surgery)",
    },
  },
} as const;

export type EmInput = {
  kind: PatientKind;
  minutes?: number | null;
  mdm?: { problems: MdmLevel; data: MdmLevel; risk: MdmLevel } | null;
};

export type EmResult = {
  byTime: string | null;
  byMdm: string | null;
  mdmLevel: MdmLevel | null;
  code: string | null;
  basis: "time" | "mdm" | null;
  /** AMA 99417 units: each full 15 minutes beyond the top level's minimum. */
  prolongedUnits: number;
  notes: string[];
};

/** Two of three elements: the middle value of the three levels. */
export function mdmLevel(m: { problems: MdmLevel; data: MdmLevel; risk: MdmLevel }): MdmLevel {
  const ranks = [m.problems, m.data, m.risk].map((l) => MDM_LEVELS.indexOf(l)).sort((a, b) => a - b);
  return MDM_LEVELS[ranks[1]];
}

export function emLevel(input: EmInput): EmResult {
  const notes: string[] = [];
  const table = TIME[input.kind];
  let byTime: string | null = null;
  let prolongedUnits = 0;
  if (input.minutes != null && input.minutes > 0) {
    for (const [code, min] of table) if (input.minutes >= min) byTime = code;
    if (!byTime) notes.push(`${input.minutes} minutes is below the ${table[0][1]}-minute minimum for ${table[0][0]}; code by MDM instead.`);
    const top = table[table.length - 1];
    if (input.minutes >= top[1] + 15) {
      prolongedUnits = Math.floor((input.minutes - top[1]) / 15);
      notes.push(`Add 99417 x${prolongedUnits} for prolonged service (AMA rule). Medicare instead uses G2212, first reported at ${top[1] + 29} minutes; check the payer's policy.`);
    }
  }
  const lvl = input.mdm ? mdmLevel(input.mdm) : null;
  const byMdm = lvl ? BY_MDM[input.kind][lvl] : null;

  let code: string | null = null;
  let basis: EmResult["basis"] = null;
  if (byTime && (!byMdm || byTime >= byMdm)) { code = byTime; basis = "time"; }
  else if (byMdm) { code = byMdm; basis = "mdm"; }
  if (basis === "time" && prolongedUnits === 0) notes.push("Document the total time spent on the date of the encounter, and what it was spent on.");
  if (basis === "mdm") notes.push("The note must support two of the three MDM elements at this level.");
  if (basis !== "time") prolongedUnits = 0; // prolonged service is only reported with time-based coding
  return { byTime, byMdm, mdmLevel: lvl, code, basis, prolongedUnits, notes: basis === "mdm" ? notes.filter((n) => !n.startsWith("Add 99417")) : notes };
}
