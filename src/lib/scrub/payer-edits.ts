/**
 * Payer-specific claim edits.
 *
 * The general scrubber checks what every payer requires. These are the rules
 * one payer imposes and another does not: this plan wants prior authorization
 * for an MRI, that one will not pay a lipid panel without a qualifying
 * diagnosis. They are configured per practice and payer, and evaluated
 * alongside the general rules so a claim is stopped at the desk instead of
 * denied weeks later.
 *
 * Pure functions over plain data, so they are tested without a database.
 */
import type { ScrubFinding } from "./rules";

export type PayerEditKind = "auth_required" | "modifier_required" | "dx_required" | "max_units" | "not_covered";

export const EDIT_KINDS: { kind: PayerEditKind; label: string; help: string }[] = [
  { kind: "auth_required", label: "Prior authorization required", help: "The code needs an authorization on file that covers the date of service." },
  { kind: "modifier_required", label: "Modifier required", help: "The code must carry one of the listed modifiers." },
  { kind: "dx_required", label: "Qualifying diagnosis required", help: "The claim must include a diagnosis starting with one of the listed codes." },
  { kind: "max_units", label: "Unit limit", help: "The code may not be billed with more units than the limit on one line." },
  { kind: "not_covered", label: "Not covered", help: "The payer does not cover the code." },
];

export interface PayerEditRule {
  id: string;
  kind: string;
  cpt: string | null;
  params: { modifiers?: string[]; dxPrefixes?: string[]; maxUnits?: number };
  severity: string;
  message: string;
}

export interface AuthOnFile {
  id: string;
  authNumber: string;
  cpts: string[];
  unitsApproved: number | null;
  unitsUsed: number;
  validFrom: string;
  validTo: string;
  status: string;
}

export interface EditClaim {
  dateOfService: string;
  diagnoses: string[];
  lines: { lineNumber: number; cpt: string; modifiers: string[]; units: number }[];
}

export interface EditResult {
  findings: ScrubFinding[];
  /** The authorization that satisfied the auth rules, for REF*G1 and unit tracking. */
  authorization: AuthOnFile | null;
  /** Units drawn against that authorization if the claim is accepted. */
  authUnits: number;
}

const norm = (dx: string) => dx.replace(/\./g, "").toUpperCase();

function severity(rule: PayerEditRule): "error" | "warning" {
  return rule.severity === "warning" ? "warning" : "error";
}

/** Finds an active authorization covering a code, a date and a number of units. */
export function findAuthorization(auths: AuthOnFile[], cpt: string, dos: string, units: number): AuthOnFile | null {
  return (
    auths.find(
      (a) =>
        a.status === "active" &&
        a.cpts.includes(cpt) &&
        a.validFrom <= dos &&
        dos <= a.validTo &&
        (a.unitsApproved === null || a.unitsApproved - a.unitsUsed >= units),
    ) ?? null
  );
}

export function evaluatePayerEdits(claim: EditClaim, rules: PayerEditRule[], auths: AuthOnFile[]): EditResult {
  const findings: ScrubFinding[] = [];
  let authorization: AuthOnFile | null = null;
  let authUnits = 0;
  const dxs = claim.diagnoses.map(norm);

  for (const rule of rules) {
    const lines = rule.cpt ? claim.lines.filter((l) => l.cpt === rule.cpt) : claim.lines;
    if (!lines.length) continue;
    const sev = severity(rule);

    switch (rule.kind) {
      case "auth_required":
        for (const l of lines) {
          const auth = findAuthorization(auths, l.cpt, claim.dateOfService, l.units);
          if (auth) {
            authorization = authorization ?? auth;
            if (auth.id === authorization.id) authUnits += l.units;
          } else {
            findings.push({ rule: "PAYER_AUTH", severity: sev, message: `Line ${l.lineNumber} (${l.cpt}): ${rule.message}`, field: `lines.${l.lineNumber}.cpt` });
          }
        }
        break;
      case "modifier_required": {
        const wanted = (rule.params.modifiers ?? []).map((m) => m.toUpperCase());
        for (const l of lines) {
          if (!wanted.some((m) => l.modifiers.map((x) => x.toUpperCase()).includes(m))) {
            findings.push({ rule: "PAYER_MODIFIER", severity: sev, message: `Line ${l.lineNumber} (${l.cpt}): ${rule.message}`, field: `lines.${l.lineNumber}.modifiers` });
          }
        }
        break;
      }
      case "dx_required": {
        const prefixes = (rule.params.dxPrefixes ?? []).map(norm);
        if (!dxs.some((d) => prefixes.some((p) => d.startsWith(p)))) {
          findings.push({ rule: "PAYER_DX", severity: sev, message: `${lines.map((l) => l.cpt).join(", ")}: ${rule.message}`, field: "encounter.diagnoses" });
        }
        break;
      }
      case "max_units": {
        const max = rule.params.maxUnits ?? Infinity;
        for (const l of lines) {
          if (l.units > max) {
            findings.push({ rule: "PAYER_UNITS", severity: sev, message: `Line ${l.lineNumber} (${l.cpt}): ${rule.message}`, field: `lines.${l.lineNumber}.units` });
          }
        }
        break;
      }
      case "not_covered":
        for (const l of lines) {
          findings.push({ rule: "PAYER_NOT_COVERED", severity: sev, message: `Line ${l.lineNumber} (${l.cpt}): ${rule.message}`, field: `lines.${l.lineNumber}.cpt` });
        }
        break;
    }
  }
  return { findings, authorization, authUnits };
}
