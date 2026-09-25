/**
 * ASC X12 005010X217: 278 health care services review (prior authorization)
 * request and response.
 *
 * The request names the payer (UMO), the requesting provider, the member,
 * the event (dates, place of service, diagnoses) and each service asked for.
 * The payer answers with an HCR segment per event or service: A1 certified,
 * A2 certified in part, A3 not certified, A4 pended, A6 modified, CT contact
 * the payer, NA no action required; HCR02 carries the authorization number
 * and DTP*AAH the period it is valid for. AAA segments mean the request
 * itself could not be processed.
 */
import { d8, envelope, fromD8, tokenize } from "./x12";

export interface Request278 {
  senderId: string;
  receiverId: string;
  now: Date;
  control: string;
  payer: { name: string; payerId: string };
  requester: { name: string; npi: string; lastName?: string; firstName?: string };
  subscriber: { lastName: string; firstName: string; memberId: string; dob: string; sex: string };
  event: { serviceFrom: string; serviceTo: string; placeOfService: string; diagnoses: string[]; trace: string };
  services: { cpt: string; modifiers?: string[]; units: number }[];
}

const VERSION = "005010X217";
const dx = (code: string) => code.replace(".", "").toUpperCase();

export function build278(r: Request278): string {
  const hhmm = r.now.toISOString().slice(11, 16).replace(":", "");
  const body: string[][] = [
    ["BHT", "0007", "13", r.event.trace, d8(r.now), hhmm],
    ["HL", "1", "", "20", "1"],
    ["NM1", "X3", "2", r.payer.name, "", "", "", "", "PI", r.payer.payerId],
    ["HL", "2", "1", "21", "1"],
    r.requester.lastName
      ? ["NM1", "1P", "1", r.requester.lastName, r.requester.firstName ?? "", "", "", "", "XX", r.requester.npi]
      : ["NM1", "1P", "2", r.requester.name, "", "", "", "", "XX", r.requester.npi],
    ["HL", "3", "2", "22", "1"],
    ["NM1", "IL", "1", r.subscriber.lastName, r.subscriber.firstName, "", "", "", "MI", r.subscriber.memberId],
    ["DMG", "D8", d8(r.subscriber.dob), r.subscriber.sex === "M" || r.subscriber.sex === "F" ? r.subscriber.sex : "U"],
    ["HL", "4", "3", "EV", "1"],
    ["TRN", "1", r.event.trace, "9COLLABMD"],
    // Health services review, initial request, place of service qualified by B (UB/CMS place of service code).
    ["UM", "HS", "I", "3", `${r.event.placeOfService}:B`],
    ["DTP", "472", "RD8", `${d8(r.event.serviceFrom)}-${d8(r.event.serviceTo)}`],
    ["HI", ...r.event.diagnoses.slice(0, 12).map((c, i) => `${i === 0 ? "ABK" : "ABF"}:${dx(c)}`)],
    ...r.services.flatMap((s, i) => [
      ["HL", String(5 + i), "4", "SS", "0"],
      ["TRN", "1", `${r.event.trace}-${i + 1}`, "9COLLABMD"],
      ["UM", "HS", "I"],
      ["SV1", ["HC", s.cpt, ...(s.modifiers ?? [])].join(":"), "", "UN", String(s.units)],
    ]),
  ];
  return envelope({ senderId: r.senderId, receiverId: r.receiverId, functionalId: "HI", transactionSet: "278", version: VERSION, control: r.control, now: r.now, body });
}

/** The request read back (for the simulator and for display). */
export function parse278Request(raw: string) {
  const { segments, delimiters } = tokenize(raw);
  const out = { trace: "", payerId: "", memberId: "", lastName: "", services: [] as { cpt: string; units: number }[], from: "", to: "" };
  for (const s of segments) {
    if (s[0] === "BHT") out.trace = s[3] ?? "";
    if (s[0] === "NM1" && s[1] === "X3") out.payerId = s[9] ?? "";
    if (s[0] === "NM1" && s[1] === "IL") { out.memberId = s[9] ?? ""; out.lastName = s[3] ?? ""; }
    if (s[0] === "DTP" && s[1] === "472") { const [a, b] = (s[3] ?? "").split("-"); out.from = fromD8(a); out.to = fromD8(b ?? a); }
    if (s[0] === "SV1") out.services.push({ cpt: (s[1] ?? "").split(delimiters.component)[1] ?? "", units: Number(s[4] ?? 1) });
  }
  return out;
}

export const HCR_ACTION: Record<string, { status: AuthStatus; label: string }> = {
  A1: { status: "approved", label: "Certified in total" },
  A2: { status: "partial", label: "Certified in part" },
  A3: { status: "denied", label: "Not certified" },
  A4: { status: "pended", label: "Pended for review" },
  A6: { status: "partial", label: "Modified" },
  C: { status: "cancelled", label: "Cancelled" },
  CT: { status: "pended", label: "Contact the payer" },
  NA: { status: "not_required", label: "No authorization required" },
};

const AAA_REASON: Record<string, string> = {
  "15": "Required application data missing",
  "33": "Input errors",
  "41": "Authorization or access restrictions",
  "42": "Unable to respond at this time",
  "43": "Invalid or missing provider identification",
  "57": "Invalid or missing dates of service",
  "58": "Invalid or missing date of birth",
  "72": "Invalid or missing member ID",
  "73": "Invalid or missing subscriber name",
  "75": "Subscriber or insured not found",
  "AF": "Invalid or missing diagnosis codes",
  "AG": "Invalid or missing procedure codes",
};

export type AuthStatus = "approved" | "partial" | "denied" | "pended" | "cancelled" | "not_required" | "error";

export interface Response278 {
  status: AuthStatus;
  action: string | null;
  actionLabel: string;
  authNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  units: number | null;
  errors: string[];
  services: { cpt: string; action: string; authNumber: string | null; units: number | null }[];
}

export function parse278Response(raw: string): Response278 {
  const { segments, delimiters } = tokenize(raw);
  const out: Response278 = { status: "error", action: null, actionLabel: "No decision in the response", authNumber: null, validFrom: null, validTo: null, units: null, errors: [], services: [] };
  let inService: { cpt: string; action: string; authNumber: string | null; units: number | null } | null = null;
  for (const s of segments) {
    if (s[0] === "HL") {
      if (inService) out.services.push(inService);
      inService = s[3] === "SS" ? { cpt: "", action: "", authNumber: null, units: null } : null;
    }
    if (s[0] === "AAA" && s[1] === "N") out.errors.push(AAA_REASON[s[3] ?? ""] ?? `Rejected (reason ${s[3] ?? "unknown"})`);
    if (s[0] === "SV1" && inService) {
      inService.cpt = (s[1] ?? "").split(delimiters.component)[1] ?? "";
      inService.units = s[4] ? Number(s[4]) : null;
    }
    if (s[0] === "HCR") {
      const action = s[1] ?? "";
      if (inService) {
        inService.action = action;
        inService.authNumber = s[2] || null;
      } else {
        out.action = action;
        out.authNumber = s[2] || null;
      }
    }
    if (s[0] === "HSD" && s[1] === "VS" && s[2]) out.units = Number(s[2]);
    if (s[0] === "DTP" && (s[1] === "AAH" || s[1] === "472") && s[2] === "RD8" && !out.validFrom) {
      const [a, b] = (s[3] ?? "").split("-");
      if (s[1] === "AAH") { out.validFrom = fromD8(a); out.validTo = fromD8(b ?? a); }
    }
  }
  if (inService) out.services.push(inService);
  // An event with no HCR of its own takes the services' decision.
  const action = out.action ?? out.services.find((x) => x.action)?.action ?? null;
  out.action = action;
  out.authNumber = out.authNumber ?? out.services.find((x) => x.authNumber)?.authNumber ?? null;
  if (out.units === null) out.units = out.services.reduce((a, x) => a + (x.units ?? 0), 0) || null;
  if (out.errors.length && !action) {
    out.status = "error";
    out.actionLabel = out.errors.join("; ");
  } else if (action && HCR_ACTION[action]) {
    out.status = HCR_ACTION[action].status;
    out.actionLabel = HCR_ACTION[action].label;
  }
  return out;
}

/** What a payer's 278 response looks like, for the simulator. */
export function build278Response(input: {
  senderId: string; receiverId: string; now: Date; control: string; request: ReturnType<typeof parse278Request>;
  action: string; authNumber?: string | null; validFrom?: string; validTo?: string; units?: number; reject?: string;
}): string {
  const r = input.request;
  const body: string[][] = [
    ["BHT", "0007", "11", r.trace, d8(input.now), input.now.toISOString().slice(11, 16).replace(":", "")],
    ["HL", "1", "", "20", "1"],
    ["NM1", "X3", "2", "SIMULATED PAYER", "", "", "", "", "PI", r.payerId],
    ["HL", "2", "1", "21", "1"],
    ["NM1", "1P", "2", "REQUESTER"],
    ["HL", "3", "2", "22", "1"],
    ["NM1", "IL", "1", r.lastName, "", "", "", "", "MI", r.memberId],
    ...(input.reject ? [["AAA", "N", "", input.reject, "C"]] : []),
    ["HL", "4", "3", "EV", input.reject ? "0" : "1"],
    ["TRN", "2", r.trace, "9COLLABMD"],
    ...(input.reject ? [] : [
      ["UM", "HS", "I"],
      ["HCR", input.action, input.authNumber ?? ""],
      ...(input.validFrom ? [["DTP", "AAH", "RD8", `${d8(input.validFrom)}-${d8(input.validTo ?? input.validFrom)}`]] : []),
      ...(input.units ? [["HSD", "VS", String(input.units)]] : []),
      ...r.services.flatMap((s, i) => [["HL", String(5 + i), "4", "SS", "0"], ["SV1", `HC:${s.cpt}`, "", "UN", String(s.units)], ["HCR", input.action, input.authNumber ?? ""]]),
    ]),
  ];
  return envelope({ senderId: input.senderId, receiverId: input.receiverId, functionalId: "HI", transactionSet: "278", version: VERSION, control: input.control, now: input.now, body });
}
