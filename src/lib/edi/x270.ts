/**
 * ASC X12 005010X279A1: 270 eligibility inquiry and 271 eligibility response.
 *
 * The 270 asks a payer whether a subscriber is covered on a date for a type
 * of service (EQ, 30 = health benefit plan coverage). The 271 answers with
 * benefit segments (EB): active or inactive coverage, then copay, deductible,
 * coinsurance and out-of-pocket amounts, each qualified by time period
 * (23 = calendar year, 29 = remaining) and network. If the payer cannot find
 * the subscriber it answers with an AAA rejection instead of benefits.
 */
import { d8, envelope, fromD8, money, toCents, tokenize } from "./x12";

export interface Inquiry270 {
  senderId: string;
  receiverId: string;
  now: Date;
  control: string;
  /** Echoed back in the 271's TRN so the response can be matched to the request. */
  traceNumber: string;
  payer: { name: string; payerId: string };
  provider: { name: string; npi: string };
  subscriber: { lastName: string; firstName: string; memberId: string; dob: string; sex?: string | null };
  serviceDate: string; // YYYY-MM-DD
  /** EQ01 service type codes; 30 is general health plan coverage. */
  serviceTypes?: string[];
}

const version = "005010X279A1";

export function build270(q: Inquiry270): string {
  const hhmm = q.now.toISOString().slice(11, 16).replace(":", "");
  const body: string[][] = [
    ["BHT", "0022", "13", q.traceNumber, d8(q.now), hhmm],
    ["HL", "1", "", "20", "1"],
    ["NM1", "PR", "2", q.payer.name, "", "", "", "", "PI", q.payer.payerId],
    ["HL", "2", "1", "21", "1"],
    ["NM1", "1P", "2", q.provider.name, "", "", "", "", "XX", q.provider.npi],
    ["HL", "3", "2", "22", "0"],
    ["TRN", "1", q.traceNumber, "9" + q.senderId.replace(/\W/g, "").padEnd(9, "0").slice(0, 9)],
    ["NM1", "IL", "1", q.subscriber.lastName, q.subscriber.firstName, "", "", "", "MI", q.subscriber.memberId],
    ["DMG", "D8", d8(q.subscriber.dob), q.subscriber.sex === "F" || q.subscriber.sex === "M" ? q.subscriber.sex : "U"],
    ["DTP", "291", "D8", d8(q.serviceDate)],
    ...(q.serviceTypes?.length ? q.serviceTypes : ["30"]).map((st) => ["EQ", st]),
  ];
  return envelope({ senderId: q.senderId, receiverId: q.receiverId, functionalId: "HS", transactionSet: "270", version, control: q.control, now: q.now, body });
}

/** Reads back what a 270 asks, as a payer would. */
export function parse270(raw: string) {
  const { segments } = tokenize(raw);
  const out = { traceNumber: "", payerId: "", payerName: "", providerNpi: "", providerName: "", memberId: "", lastName: "", firstName: "", dob: "", sex: "", serviceDate: "", serviceTypes: [] as string[] };
  for (const s of segments) {
    if (s[0] === "TRN") out.traceNumber = s[2] ?? "";
    else if (s[0] === "NM1" && s[1] === "PR") { out.payerName = s[3] ?? ""; out.payerId = s[9] ?? ""; }
    else if (s[0] === "NM1" && s[1] === "1P") { out.providerName = s[3] ?? ""; out.providerNpi = s[9] ?? ""; }
    else if (s[0] === "NM1" && s[1] === "IL") { out.lastName = s[3] ?? ""; out.firstName = s[4] ?? ""; out.memberId = s[9] ?? ""; }
    else if (s[0] === "DMG") { out.dob = fromD8(s[2]); out.sex = s[3] ?? ""; }
    else if (s[0] === "DTP" && s[1] === "291") out.serviceDate = fromD8(s[3]);
    else if (s[0] === "EQ") out.serviceTypes.push(s[1] ?? "");
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 271                                                                  */
/* ------------------------------------------------------------------ */

/** AAA03 reject reasons a practice will actually see. */
export const AAA_REASONS: Record<string, string> = {
  "15": "Required application data missing",
  "41": "Authorization/access restrictions",
  "42": "Unable to respond at current time",
  "43": "Invalid/missing provider identification",
  "56": "Inappropriate date",
  "57": "Invalid/missing date(s) of service",
  "58": "Invalid/missing date of birth",
  "71": "Patient birth date does not match that for the patient on the database",
  "72": "Invalid/missing subscriber/insured ID",
  "73": "Invalid/missing subscriber/insured name",
  "75": "Subscriber/insured not found",
  "76": "Duplicate subscriber/insured ID number",
};

export interface Benefit {
  /** EB01: 1 active, 6 inactive, A coinsurance, B copay, C deductible, G out of pocket. */
  code: string;
  coverageLevel: string; // IND | FAM
  serviceType: string;
  insuranceType: string;
  planDescription: string;
  timePeriod: string; // 23 calendar year | 29 remaining
  amountCents: number | null;
  percent: number | null; // 0-100
  inNetwork: string; // Y | N | W (not applicable)
}

export interface Response271 {
  traceNumber: string;
  payerName: string;
  memberId: string;
  /** AAA rejections, from any loop. */
  rejections: { code: string; reason: string; followUp: string }[];
  planBegin: string;
  benefits: Benefit[];
}

export interface Build271Input {
  senderId: string;
  receiverId: string;
  now: Date;
  control: string;
  inquiry: ReturnType<typeof parse270>;
  rejection?: { code: string; followUp?: string };
  planBegin?: string;
  benefits?: Benefit[];
}

export function build271(input: Build271Input): string {
  const q = input.inquiry;
  const hhmm = input.now.toISOString().slice(11, 16).replace(":", "");
  const body: string[][] = [
    ["BHT", "0022", "11", q.traceNumber, d8(input.now), hhmm],
    ["HL", "1", "", "20", "1"],
    ["NM1", "PR", "2", q.payerName, "", "", "", "", "PI", q.payerId],
    ["HL", "2", "1", "21", "1"],
    ["NM1", "1P", "2", q.providerName, "", "", "", "", "XX", q.providerNpi],
    ["HL", "3", "2", "22", "0"],
    ["TRN", "2", q.traceNumber, "9" + input.senderId.replace(/\W/g, "").padEnd(9, "0").slice(0, 9)],
    ["NM1", "IL", "1", q.lastName, q.firstName, "", "", "", "MI", q.memberId],
  ];
  if (input.rejection) {
    // Subscriber-level rejection: C = please correct and resubmit.
    body.push(["AAA", "N", "", input.rejection.code, input.rejection.followUp ?? "C"]);
    body.push(["DMG", "D8", d8(q.dob || "1900-01-01")]);
  } else {
    body.push(["DMG", "D8", d8(q.dob), q.sex || "U"]);
    if (input.planBegin) body.push(["DTP", "346", "D8", d8(input.planBegin)]);
    for (const b of input.benefits ?? []) {
      body.push([
        "EB", b.code, b.coverageLevel, b.serviceType, b.insuranceType, b.planDescription, b.timePeriod,
        b.amountCents === null ? "" : money(b.amountCents),
        b.percent === null ? "" : String(b.percent / 100),
        "", "", "", b.inNetwork,
      ]);
    }
  }
  return envelope({ senderId: input.senderId, receiverId: input.receiverId, functionalId: "HB", transactionSet: "271", version, control: input.control, now: input.now, body });
}

export function parse271(raw: string): Response271 {
  const { segments } = tokenize(raw);
  const out: Response271 = { traceNumber: "", payerName: "", memberId: "", rejections: [], planBegin: "", benefits: [] };
  for (const s of segments) {
    switch (s[0]) {
      case "TRN":
        if (s[1] === "2") out.traceNumber = s[2] ?? "";
        break;
      case "NM1":
        if (s[1] === "PR") out.payerName = s[3] ?? "";
        if (s[1] === "IL") out.memberId = s[9] ?? "";
        break;
      case "AAA":
        out.rejections.push({ code: s[3] ?? "", reason: AAA_REASONS[s[3] ?? ""] ?? `Rejection ${s[3]}`, followUp: s[4] ?? "" });
        break;
      case "DTP":
        if (s[1] === "346") out.planBegin = fromD8(s[3]);
        break;
      case "EB": {
        const pct = s[8] ? parseFloat(s[8]) : NaN;
        out.benefits.push({
          code: s[1] ?? "", coverageLevel: s[2] ?? "", serviceType: s[3] ?? "", insuranceType: s[4] ?? "", planDescription: s[5] ?? "",
          timePeriod: s[6] ?? "", amountCents: s[7] ? toCents(s[7]) : null,
          percent: Number.isFinite(pct) ? Math.round(pct * 10000) / 100 : null,
          inNetwork: s[12] ?? "",
        });
        break;
      }
    }
  }
  return out;
}

export interface EligibilitySummary {
  status: "active" | "inactive" | "error";
  planName?: string;
  copayCents?: number;
  deductibleCents?: number;
  deductibleRemainingCents?: number;
  oopMaxCents?: number;
  oopRemainingCents?: number;
  coinsurancePct?: number;
  message?: string;
}

/**
 * Reduces a 271 to what the front desk and the estimator need: individual,
 * in-network figures for general coverage. A payer that rejects the inquiry
 * for bad data (AAA with follow-up C) is "inactive" until corrected; one that
 * cannot answer right now (AAA 42) is an "error" to retry.
 */
export function summarize271(r: Response271): EligibilitySummary {
  if (r.rejections.length) {
    const first = r.rejections[0];
    return { status: first.code === "42" ? "error" : "inactive", message: `${first.reason} (AAA ${first.code})` };
  }
  const ind = r.benefits.filter((b) => (b.coverageLevel === "IND" || b.coverageLevel === "") && b.inNetwork !== "N");
  const find = (code: string, period?: string) => ind.find((b) => b.code === code && (period === undefined || b.timePeriod === period));
  const active = r.benefits.find((b) => b.code === "1");
  const inactive = r.benefits.find((b) => b.code === "6");
  if (!active) return { status: inactive ? "inactive" : "error", planName: inactive?.planDescription || undefined, message: inactive ? "Coverage is not active on the date of service" : "The payer returned no coverage information" };
  return {
    status: "active",
    planName: active.planDescription || undefined,
    copayCents: find("B")?.amountCents ?? undefined,
    deductibleCents: find("C", "23")?.amountCents ?? undefined,
    deductibleRemainingCents: find("C", "29")?.amountCents ?? undefined,
    oopMaxCents: find("G", "23")?.amountCents ?? undefined,
    oopRemainingCents: find("G", "29")?.amountCents ?? undefined,
    coinsurancePct: find("A")?.percent ?? undefined,
  };
}
