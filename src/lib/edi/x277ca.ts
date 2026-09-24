/**
 * ASC X12 277CA Health Care Claim Acknowledgment (005010X214).
 *
 * The second response to a submission, after the 999: per claim, whether it
 * was accepted into the payer's adjudication system or rejected at the front
 * end, with a Claim Status Category and Status Code explaining why.
 */
import { d8, envelope, fromD8, money, toCents, tokenize } from "./x12";

export interface Ack277Claim {
  controlNumber: string;
  /** STC01-1, e.g. A2 (accepted into adjudication) or A7 (rejected, invalid information). */
  category: string;
  /** STC01-2, the claim status code. */
  statusCode: string;
  /** STC01-3, the entity the status refers to, when given. */
  entity: string;
  accepted: boolean;
  chargeCents: number;
  payerClaimNumber: string;
  dateOfService: string;
  message: string;
}

/** Categories that mean the claim went on to adjudication. */
const ACCEPTED = new Set(["A1", "A2"]);

const CATEGORIES: Record<string, string> = {
  A1: "Acknowledgement/Receipt",
  A2: "Acknowledgement/Acceptance into adjudication system",
  A3: "Acknowledgement/Returned as unprocessable claim",
  A4: "Acknowledgement/Not found",
  A6: "Acknowledgement/Rejected for missing information",
  A7: "Acknowledgement/Rejected for invalid information",
  A8: "Acknowledgement/Rejected for relational field in error",
};

const STATUS: Record<string, string> = {
  "19": "Entity acknowledges receipt of claim",
  "20": "Accepted for processing",
  "21": "Missing or invalid information",
  "33": "Subscriber and subscriber ID not found",
  "164": "Entity's contract/member number",
  "187": "Date(s) of service",
  "562": "Entity's National Provider Identifier (NPI)",
};

const ENTITY: Record<string, string> = { IL: "Subscriber", QC: "Patient", "85": "Billing provider", "82": "Rendering provider", PR: "Payer" };

export function describeStatus(category: string, statusCode: string, entity = ""): string {
  const parts = [CATEGORIES[category] ?? category, STATUS[statusCode] ?? `status ${statusCode}`];
  if (entity) parts.push(ENTITY[entity] ?? entity);
  return parts.join(": ");
}

export interface Build277Claim {
  controlNumber: string;
  patientLast: string;
  patientFirst: string;
  memberId: string;
  chargeCents: number;
  dateOfService: string;
  /** STC01 composite as category:status[:entity], e.g. "A2:20" or "A7:164:IL". */
  status: string;
  payerClaimNumber?: string;
}

export function build277CA(input: {
  senderId: string; receiverId: string; now: Date; control: string;
  sourceName: string; submitterName: string;
  billingProvider: { name: string; npi: string };
  claims: Build277Claim[];
}): string {
  const date = d8(input.now);
  const batch = `B${input.control}`;
  const accepted = input.claims.filter((c) => ACCEPTED.has(c.status.split(":")[0]));
  const rejected = input.claims.length - accepted.length;
  const body: string[][] = [
    ["BHT", "0085", "08", batch, date, input.now.toISOString().slice(11, 16).replace(":", ""), "TH"],
    ["HL", "1", "", "20", "1"],
    ["NM1", "AY", "2", input.sourceName, "", "", "", "", "46", input.senderId],
    ["TRN", "1", batch],
    ["DTP", "050", "D8", date],
    ["DTP", "009", "D8", date],
    ["HL", "2", "1", "21", "1"],
    ["NM1", "41", "2", input.submitterName, "", "", "", "", "46", input.receiverId],
    ["TRN", "2", batch],
    ["STC", "A1:19", date, "WQ", money(input.claims.reduce((a, c) => a + c.chargeCents, 0))],
    ["QTY", "90", String(accepted.length)],
    ...(rejected ? [["QTY", "AA", String(rejected)]] : []),
    ["AMT", "YU", money(accepted.reduce((a, c) => a + c.chargeCents, 0))],
    ["HL", "3", "2", "19", "1"],
    ["NM1", "85", "2", input.billingProvider.name, "", "", "", "", "XX", input.billingProvider.npi],
    ["TRN", "1", "0"],
  ];
  input.claims.forEach((c, i) => {
    const ok = ACCEPTED.has(c.status.split(":")[0]);
    body.push(["HL", String(4 + i), "3", "PT"]);
    body.push(["NM1", "QC", "1", c.patientLast, c.patientFirst, "", "", "", "MI", c.memberId]);
    body.push(["TRN", "2", c.controlNumber]);
    body.push(["STC", c.status, date, ok ? "WQ" : "U", money(c.chargeCents)]);
    if (c.payerClaimNumber) body.push(["REF", "1K", c.payerClaimNumber]);
    body.push(["DTP", "472", "D8", d8(c.dateOfService)]);
  });
  return envelope({
    senderId: input.senderId, receiverId: input.receiverId, functionalId: "HN", transactionSet: "277",
    version: "005010X214", control: input.control, now: input.now, body,
  });
}

/** Reads the claim-level (PT) loops of a 277CA. Batch-level status is ignored. */
export function parse277CA(raw: string): Ack277Claim[] {
  const { segments, delimiters } = tokenize(raw);
  const claims: Ack277Claim[] = [];
  let current: Ack277Claim | null = null;
  for (const s of segments) {
    if (s[0] === "HL") {
      current = null;
      if (s[3] === "PT") {
        current = { controlNumber: "", category: "", statusCode: "", entity: "", accepted: false, chargeCents: 0, payerClaimNumber: "", dateOfService: "", message: "" };
        claims.push(current);
      }
      continue;
    }
    if (!current) continue;
    switch (s[0]) {
      case "TRN":
        if (s[1] === "2") current.controlNumber = s[2] ?? "";
        break;
      case "STC": {
        // A claim can carry several STC segments; the first is the governing one.
        if (current.category) break;
        const [category = "", statusCode = "", entity = ""] = (s[1] ?? "").split(delimiters.component);
        current.category = category;
        current.statusCode = statusCode;
        current.entity = entity;
        current.accepted = ACCEPTED.has(category);
        current.chargeCents = toCents(s[4]);
        current.message = describeStatus(category, statusCode, entity);
        break;
      }
      case "REF":
        if (s[1] === "1K") current.payerClaimNumber = s[2] ?? "";
        break;
      case "DTP":
        if (s[1] === "472") current.dateOfService = fromD8(s[3]);
        break;
    }
  }
  return claims;
}
