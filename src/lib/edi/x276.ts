/**
 * ASC X12 005010X212: 276 claim status request and 277 claim status response.
 *
 * A claim that was accepted but not paid after a few weeks is usually either
 * still in process, waiting on something from the provider, or already
 * decided with the remittance not yet received. A 276 asks the payer which;
 * the 277 answers with STC category codes: A acknowledgment, P pending, F
 * finalized, R request for more information, E error.
 */
import { d8, envelope, fromD8, money, toCents, tokenize } from "./x12";
import { describeStatus } from "./x277ca";

export interface Inquiry276 {
  senderId: string;
  receiverId: string;
  now: Date;
  control: string;
  payer: { name: string; payerId: string };
  billingProvider: { name: string; npi: string };
  subscriber: { lastName: string; firstName: string; memberId: string; dob: string; sex: string };
  claim: {
    /** Our patient control number (CLM01); echoed back in TRN*2. */
    controlNumber: string;
    payerClaimNumber?: string | null;
    chargeCents: number;
    serviceFrom: string;
    serviceTo: string;
  };
}

const VERSION = "005010X212";

export function build276(q: Inquiry276): string {
  const hhmm = q.now.toISOString().slice(11, 16).replace(":", "");
  const body: string[][] = [
    ["BHT", "0010", "13", q.claim.controlNumber, d8(q.now), hhmm],
    ["HL", "1", "", "20", "1"],
    ["NM1", "PR", "2", q.payer.name, "", "", "", "", "PI", q.payer.payerId],
    ["HL", "2", "1", "21", "1"],
    ["NM1", "41", "2", q.billingProvider.name, "", "", "", "", "46", q.senderId],
    ["HL", "3", "2", "19", "1"],
    ["NM1", "1P", "2", q.billingProvider.name, "", "", "", "", "XX", q.billingProvider.npi],
    ["HL", "4", "3", "22", "0"],
    ["DMG", "D8", d8(q.subscriber.dob), q.subscriber.sex === "M" || q.subscriber.sex === "F" ? q.subscriber.sex : "U"],
    ["NM1", "IL", "1", q.subscriber.lastName, q.subscriber.firstName, "", "", "", "MI", q.subscriber.memberId],
    ["TRN", "1", q.claim.controlNumber],
    ...(q.claim.payerClaimNumber ? [["REF", "1K", q.claim.payerClaimNumber]] : []),
    ["REF", "EJ", q.claim.controlNumber],
    ["AMT", "T3", money(q.claim.chargeCents)],
    ["DTP", "472", "RD8", `${d8(q.claim.serviceFrom)}-${d8(q.claim.serviceTo)}`],
  ];
  return envelope({ senderId: q.senderId, receiverId: q.receiverId, functionalId: "HR", transactionSet: "276", version: VERSION, control: q.control, now: q.now, body });
}

/** What the payer is asked about, read back from a 276 (for the simulator). */
export function parse276(raw: string) {
  const { segments } = tokenize(raw);
  const out = { controlNumber: "", payerClaimNumber: "", payerName: "", payerId: "", memberId: "", chargeCents: 0, providerName: "", providerNpi: "", lastName: "", firstName: "" };
  for (const s of segments) {
    if (s[0] === "TRN" && s[1] === "1") out.controlNumber = s[2] ?? "";
    else if (s[0] === "REF" && s[1] === "1K") out.payerClaimNumber = s[2] ?? "";
    else if (s[0] === "NM1" && s[1] === "PR") { out.payerName = s[3] ?? ""; out.payerId = s[9] ?? ""; }
    else if (s[0] === "NM1" && s[1] === "1P") { out.providerName = s[3] ?? ""; out.providerNpi = s[9] ?? ""; }
    else if (s[0] === "NM1" && s[1] === "IL") { out.lastName = s[3] ?? ""; out.firstName = s[4] ?? ""; out.memberId = s[9] ?? ""; }
    else if (s[0] === "AMT" && s[1] === "T3") out.chargeCents = toCents(s[2]);
  }
  return out;
}

export interface ClaimStatus {
  controlNumber: string;
  payerClaimNumber: string;
  category: string; // A, P, F, R, E + digit, e.g. F1
  statusCode: string;
  entity: string;
  effectiveDate: string;
  chargeCents: number;
  paidCents: number;
  paidDate: string;
  checkNumber: string;
  message: string;
}

export function parse277(raw: string): ClaimStatus[] {
  const { segments, delimiters } = tokenize(raw);
  const out: ClaimStatus[] = [];
  let current: ClaimStatus | null = null;
  for (const s of segments) {
    if (s[0] === "TRN" && s[1] === "2") {
      current = { controlNumber: s[2] ?? "", payerClaimNumber: "", category: "", statusCode: "", entity: "", effectiveDate: "", chargeCents: 0, paidCents: 0, paidDate: "", checkNumber: "", message: "" };
      out.push(current);
    } else if (!current) continue;
    else if (s[0] === "STC" && !current.category) {
      const [category = "", statusCode = "", entity = ""] = (s[1] ?? "").split(delimiters.component);
      current.category = category;
      current.statusCode = statusCode;
      current.entity = entity;
      current.effectiveDate = fromD8(s[2]);
      current.chargeCents = toCents(s[4]);
      current.paidCents = toCents(s[5]);
      current.paidDate = fromD8(s[6]);
      current.checkNumber = s[9] ?? "";
      current.message = describeStatus(category, statusCode, entity);
    } else if (s[0] === "REF" && s[1] === "1K") current.payerClaimNumber = s[2] ?? "";
  }
  return out;
}

/** What to do about a claim, given the payer's answer. */
export function nextStep(st: Pick<ClaimStatus, "category">): { action: "wait" | "post_era" | "work_denial" | "send_info" | "fix_and_resubmit" | "call_payer"; label: string } {
  const c = st.category.charAt(0);
  if (st.category === "F1" || st.category === "F3") return { action: "post_era", label: "Paid: pull or import the remittance" };
  if (st.category === "F2" || st.category === "F4") return { action: "work_denial", label: "Decided without payment: work it as a denial" };
  if (c === "P" && st.category === "P3") return { action: "send_info", label: "Payer is waiting on information from the practice" };
  if (c === "R") return { action: "send_info", label: "Payer requested more information" };
  if (c === "P" || c === "A") return { action: "wait", label: "In process: check again in a week" };
  if (c === "E" || c === "D") return { action: "fix_and_resubmit", label: "Payer cannot find or read the claim: fix and resubmit" };
  return { action: "call_payer", label: "No clear answer: call the payer" };
}

export interface Build277Input {
  senderId: string;
  receiverId: string;
  now: Date;
  control: string;
  inquiry: ReturnType<typeof parse276>;
  status: { category: string; statusCode: string; entity?: string; paidCents?: number; paidDate?: string; checkNumber?: string; payerClaimNumber?: string };
}

/** A 277 as a payer sends it; used by the simulator and tests. */
export function build277(i: Build277Input): string {
  const q = i.inquiry;
  const st = i.status;
  const hhmm = i.now.toISOString().slice(11, 16).replace(":", "");
  const code = [st.category, st.statusCode, st.entity].filter(Boolean).join(":");
  const body: string[][] = [
    ["BHT", "0010", "08", q.controlNumber, d8(i.now), hhmm, "DG"],
    ["HL", "1", "", "20", "1"],
    ["NM1", "PR", "2", q.payerName, "", "", "", "", "PI", q.payerId],
    ["HL", "2", "1", "21", "1"],
    ["NM1", "41", "2", q.providerName, "", "", "", "", "46", i.receiverId],
    ["HL", "3", "2", "19", "1"],
    ["NM1", "1P", "2", q.providerName, "", "", "", "", "XX", q.providerNpi],
    ["HL", "4", "3", "22", "0"],
    ["NM1", "IL", "1", q.lastName, q.firstName, "", "", "", "MI", q.memberId],
    ["TRN", "2", q.controlNumber],
    ["STC", code, d8(i.now), "", money(q.chargeCents), money(st.paidCents ?? 0), st.paidDate ? d8(st.paidDate) : "", "", "", st.checkNumber ?? ""],
    ...(st.payerClaimNumber || q.payerClaimNumber ? [["REF", "1K", st.payerClaimNumber || q.payerClaimNumber]] : []),
    ["REF", "EJ", q.controlNumber],
  ];
  return envelope({ senderId: i.senderId, receiverId: i.receiverId, functionalId: "HN", transactionSet: "277", version: VERSION, control: i.control, now: i.now, body });
}
