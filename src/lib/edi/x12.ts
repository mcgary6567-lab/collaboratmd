/**
 * Shared ASC X12 plumbing: delimiter detection, tokenizing and the
 * interchange envelope.
 *
 * X12 does not fix its delimiters. The interchange header declares them: the
 * element separator is the character after "ISA", the component separator is
 * the value of ISA16, and the segment terminator is the character that
 * follows it. Files from a real trading partner often use something other
 * than the textbook "*", ":" and "~", so every parser reads them from the ISA
 * rather than assuming.
 */

export interface Delimiters {
  element: string;
  component: string;
  segment: string;
  repetition: string;
}

export const DEFAULT_DELIMITERS: Delimiters = { element: "*", component: ":", segment: "~", repetition: "^" };

export function detectDelimiters(raw: string): Delimiters {
  const t = raw.trimStart();
  if (!t.startsWith("ISA") || t.length < 20) return DEFAULT_DELIMITERS;
  const element = t[3];
  // Walk to the separator in front of ISA16, counting sixteen of them.
  let idx = 3;
  let seen = 1;
  while (seen < 16 && idx < t.length - 1) {
    idx++;
    if (t[idx] === element) seen++;
  }
  const component = t[idx + 1] ?? DEFAULT_DELIMITERS.component;
  const segment = t[idx + 2] ?? DEFAULT_DELIMITERS.segment;
  const fields = t.slice(0, idx).split(element);
  const repetition = fields[11]?.length === 1 ? fields[11] : DEFAULT_DELIMITERS.repetition;
  return { element, component, segment, repetition };
}

/** Splits an interchange into segments of elements, ignoring line breaks between segments. */
export function tokenize(raw: string): { segments: string[][]; delimiters: Delimiters } {
  const delimiters = detectDelimiters(raw);
  const segments = raw
    .split(delimiters.segment)
    .map((s) => s.replace(/[\r\n]/g, "").trim())
    .filter(Boolean)
    .map((s) => s.split(delimiters.element));
  return { segments, delimiters };
}

export function d8(date: Date | string): string {
  const iso = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  return iso.replace(/-/g, "").slice(0, 8);
}

export function fromD8(v: string | undefined): string {
  if (!v || v.length < 8) return "";
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export function money(cents: number): string {
  if (!Number.isFinite(cents)) throw new Error(`Cannot serialize non-numeric monetary amount: ${cents}`);
  return (cents / 100).toFixed(2);
}

export function toCents(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function pad(v: string, len: number): string {
  return v.padEnd(len, " ").slice(0, len);
}

export interface EnvelopeInput {
  senderId: string;
  receiverId: string;
  /** GS01: HC 837, FA 999, HN 277, HS 270, HB 271, HP 835. */
  functionalId: string;
  /** ST01, e.g. "999". */
  transactionSet: string;
  /** Implementation guide, e.g. "005010X231A1". */
  version: string;
  /** Numeric interchange control number; padded to nine digits. */
  control: string;
  now: Date;
  /** Every segment between ST and SE, exclusive. */
  body: string[][];
}

/**
 * Wraps transaction segments in ST/SE, GS/GE and ISA/IEA with correct counts
 * and control numbers, using the default delimiters.
 */
export function envelope(input: EnvelopeInput): string {
  const yymmdd = input.now.toISOString().slice(2, 10).replace(/-/g, "");
  const ccyymmdd = input.now.toISOString().slice(0, 10).replace(/-/g, "");
  const hhmm = input.now.toISOString().slice(11, 16).replace(":", "");
  const icn = input.control.replace(/\D/g, "").padStart(9, "0").slice(-9);
  const gcn = icn.replace(/^0+/, "") || "1";
  const segs: string[][] = [
    ["ISA", "00", pad("", 10), "00", pad("", 10), "ZZ", pad(input.senderId, 15), "ZZ", pad(input.receiverId, 15), yymmdd, hhmm, "^", "00501", icn, "0", "P", ":"],
    ["GS", input.functionalId, input.senderId, input.receiverId, ccyymmdd, hhmm, gcn, "X", input.version],
    ["ST", input.transactionSet, "0001", input.version],
    ...input.body,
  ];
  segs.push(["SE", String(input.body.length + 2), "0001"]);
  segs.push(["GE", "1", gcn]);
  segs.push(["IEA", "1", icn]);
  return segs.map((seg) => seg.join("*").replace(/\*+$/, "")).join("~\n") + "~";
}

/** Reads GS06 and ST02, which a 999 has to echo back. */
export function controlNumbers(raw: string): { groupControl: string; transactionControl: string; functionalId: string; version: string } {
  const { segments } = tokenize(raw);
  const gs = segments.find((s) => s[0] === "GS");
  const st = segments.find((s) => s[0] === "ST");
  return { groupControl: gs?.[6] ?? "", transactionControl: st?.[2] ?? "", functionalId: gs?.[1] ?? "", version: gs?.[8] ?? "" };
}
