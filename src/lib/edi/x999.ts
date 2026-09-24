/**
 * ASC X12 999 Implementation Acknowledgment (005010X231A1).
 *
 * The first response to any submission: it says whether the file was
 * syntactically valid, not whether the claim is any good. A rejected 999 means
 * nothing in the transaction reached a payer.
 */
import { controlNumbers, envelope, tokenize } from "./x12";

export interface SyntaxError999 {
  segmentId: string;
  position: string;
  /** IK304 implementation segment syntax error code. */
  code: string;
}

export interface Ack999 {
  accepted: boolean;
  /** IK501: A accepted, E accepted with errors, R rejected. */
  transactionStatus: string;
  /** AK901 for the functional group. */
  groupStatus: string;
  errors: SyntaxError999[];
  acknowledgedGroupControl: string;
  acknowledgedTransactionControl: string;
}

const SYNTAX_ERRORS: Record<string, string> = {
  "1": "Unrecognized segment ID",
  "2": "Unexpected segment",
  "3": "Required segment missing",
  "5": "Segment exceeds maximum use",
  "8": "Segment has data element errors",
  "I6": "Implementation segment below minimum use",
};

export function describeSyntaxError(code: string): string {
  return SYNTAX_ERRORS[code] ?? `Syntax error ${code}`;
}

/**
 * Structural checks a clearinghouse runs before anything else: the envelope
 * control numbers match, and SE01 counts the segments actually present.
 */
export function validateStructure(raw: string): SyntaxError999[] {
  const { segments } = tokenize(raw);
  const errors: SyntaxError999[] = [];
  const stIndex = segments.findIndex((s) => s[0] === "ST");
  const seIndex = segments.findIndex((s) => s[0] === "SE");
  if (stIndex < 0) return [{ segmentId: "ST", position: "1", code: "3" }];
  if (seIndex < 0) return [{ segmentId: "SE", position: String(segments.length), code: "3" }];
  const counted = seIndex - stIndex + 1;
  if (Number(segments[seIndex][1]) !== counted) errors.push({ segmentId: "SE", position: String(counted), code: "8" });
  if (segments[seIndex][2] !== segments[stIndex][2]) errors.push({ segmentId: "SE", position: String(counted), code: "8" });
  if (!segments.some((s) => s[0] === "CLM")) errors.push({ segmentId: "CLM", position: "0", code: "3" });
  return errors;
}

export function build999(input: { original837: string; senderId: string; receiverId: string; now: Date; control: string; errors: SyntaxError999[] }): string {
  const orig = controlNumbers(input.original837);
  const rejected = input.errors.length > 0;
  const body: string[][] = [
    ["AK1", orig.functionalId || "HC", orig.groupControl, orig.version || "005010X222A1"],
    ["AK2", "837", orig.transactionControl, orig.version || "005010X222A1"],
    ...input.errors.map((e) => ["IK3", e.segmentId, e.position, "", e.code]),
    rejected ? ["IK5", "R", "5"] : ["IK5", "A"],
    ["AK9", rejected ? "R" : "A", "1", "1", rejected ? "0" : "1"],
  ];
  return envelope({
    senderId: input.senderId, receiverId: input.receiverId, functionalId: "FA", transactionSet: "999",
    version: "005010X231A1", control: input.control, now: input.now, body,
  });
}

export function parse999(raw: string): Ack999 {
  const { segments } = tokenize(raw);
  const ack: Ack999 = {
    accepted: false, transactionStatus: "", groupStatus: "", errors: [],
    acknowledgedGroupControl: "", acknowledgedTransactionControl: "",
  };
  for (const s of segments) {
    switch (s[0]) {
      case "AK1": ack.acknowledgedGroupControl = s[2] ?? ""; break;
      case "AK2": ack.acknowledgedTransactionControl = s[2] ?? ""; break;
      case "IK3": ack.errors.push({ segmentId: s[1] ?? "", position: s[2] ?? "", code: s[4] ?? "" }); break;
      case "IK5": ack.transactionStatus = s[1] ?? ""; break;
      case "AK9": ack.groupStatus = s[1] ?? ""; break;
    }
  }
  // E is "accepted, but errors were noted": the transaction still goes through.
  ack.accepted = ["A", "E"].includes(ack.transactionStatus || ack.groupStatus);
  return ack;
}
