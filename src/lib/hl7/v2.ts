/**
 * HL7 version 2 messages: parsing, field access and acknowledgments.
 *
 * An HL7 v2 message is segments separated by carriage returns. Like X12, it
 * declares its own delimiters: the character after "MSH" separates fields,
 * and MSH-2 lists the component, repetition, escape and subcomponent
 * characters (almost always ^~\&, but not guaranteed). Field numbering has one
 * quirk: in MSH the field separator itself is MSH-1, so MSH-n is element n-1
 * of the split, while in every other segment field n is element n.
 */

export interface Hl7Delimiters {
  field: string;
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
}

export interface Hl7Segment {
  id: string;
  /** Raw fields, indexed by HL7 field number (index 0 is the segment ID). */
  fields: string[];
}

export interface Hl7Message {
  delimiters: Hl7Delimiters;
  segments: Hl7Segment[];
  /** MSH-9, e.g. "ADT^A04". */
  type: string;
  event: string;
  controlId: string;
  version: string;
  sendingApplication: string;
  sendingFacility: string;
}

export class Hl7Error extends Error {}

export function parseHl7(raw: string): Hl7Message {
  // Senders vary: \r is standard, but files and HTTP bodies often arrive with \n or \r\n.
  const text = raw.replace(/^﻿/, "").replace(/\x0b|\x1c/g, "").trim();
  if (!text.startsWith("MSH")) throw new Hl7Error("Message must start with an MSH segment");
  const field = text[3];
  const enc = text.slice(4, 8);
  const delimiters: Hl7Delimiters = {
    field,
    component: enc[0] ?? "^",
    repetition: enc[1] ?? "~",
    escape: enc[2] ?? "\\",
    subcomponent: enc[3] ?? "&",
  };
  const segments = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line): Hl7Segment => {
      const parts = line.split(field);
      const id = parts[0];
      // Re-number MSH so that fields[n] is MSH-n like every other segment.
      return id === "MSH" ? { id, fields: [id, field, ...parts.slice(1)] } : { id, fields: parts };
    });
  const msh = segments[0];
  const typeField = msh.fields[9] ?? "";
  const [type = "", event = ""] = typeField.split(delimiters.component);
  return {
    delimiters,
    segments,
    type,
    event,
    controlId: msh.fields[10] ?? "",
    version: msh.fields[12] ?? "",
    sendingApplication: (msh.fields[3] ?? "").split(delimiters.component)[0],
    sendingFacility: (msh.fields[4] ?? "").split(delimiters.component)[0],
  };
}

/** Undoes HL7 escape sequences (\F\ \S\ \T\ \R\ \E\ and \X..\ hex). */
export function unescape(value: string, d: Hl7Delimiters): string {
  const e = d.escape;
  if (!value.includes(e)) return value;
  const re = new RegExp(`${escapeRe(e)}(F|S|T|R|E|X[0-9A-Fa-f]+|\\.br)${escapeRe(e)}`, "g");
  return value.replace(re, (_m, code: string) => {
    switch (code) {
      case "F": return d.field;
      case "S": return d.component;
      case "T": return d.subcomponent;
      case "R": return d.repetition;
      case "E": return d.escape;
      case ".br": return "\n";
      default: return String.fromCharCode(...(code.slice(1).match(/../g) ?? []).map((h) => parseInt(h, 16)));
    }
  });
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function segments(msg: Hl7Message, id: string): Hl7Segment[] {
  return msg.segments.filter((s) => s.id === id);
}

export function segment(msg: Hl7Message, id: string): Hl7Segment | undefined {
  return msg.segments.find((s) => s.id === id);
}

/**
 * One value from a segment: field, then 1-based repetition, component and
 * subcomponent. `get(pid, 5, 1, 1)` is the family name of the first patient
 * name. Missing parts come back as "".
 */
export function get(msg: Hl7Message, seg: Hl7Segment | undefined, fieldNo: number, component = 1, rep = 1, sub = 1): string {
  if (!seg) return "";
  const d = msg.delimiters;
  const raw = seg.fields[fieldNo] ?? "";
  const r = raw.split(d.repetition)[rep - 1] ?? "";
  const c = r.split(d.component)[component - 1] ?? "";
  const s = c.split(d.subcomponent)[sub - 1] ?? "";
  return unescape(s, d).trim();
}

/** Every repetition of a field, each split into components. */
export function repetitions(msg: Hl7Message, seg: Hl7Segment | undefined, fieldNo: number): string[][] {
  if (!seg) return [];
  const d = msg.delimiters;
  return (seg.fields[fieldNo] ?? "")
    .split(d.repetition)
    .filter(Boolean)
    .map((r) => r.split(d.component).map((c) => unescape(c, d).trim()));
}

/** HL7 dates are YYYYMMDD[HHMM[SS]]; returns YYYY-MM-DD or "". */
export function hl7Date(v: string): string {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function hl7Timestamp(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/**
 * Builds the acknowledgment the sender waits for. AA accepted, AE error (the
 * sender should fix and resend), AR rejected (the receiver could not process
 * it at all). The MSH swaps sender and receiver and echoes the control ID.
 */
export function buildAck(msg: Hl7Message | null, code: "AA" | "AE" | "AR", text = "", receivingApp = "COLLABORATMD"): string {
  const now = hl7Timestamp(new Date());
  const d = msg?.delimiters ?? { field: "|", component: "^", repetition: "~", escape: "\\", subcomponent: "&" };
  const f = d.field;
  const enc = `${d.component}${d.repetition}${d.escape}${d.subcomponent}`;
  const clean = (s: string) => s.replace(/[\r\n]/g, " ").split(f).join(`${d.escape}F${d.escape}`);
  const ackControl = `ACK${now}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
  const msh = ["MSH", enc, receivingApp, "", msg?.sendingApplication ?? "", msg?.sendingFacility ?? "", now, "", `ACK${d.component}${msg?.event ?? ""}${d.component}ACK`, ackControl, "P", msg?.version || "2.5.1"].join(f);
  const msa = ["MSA", code, msg?.controlId ?? "", clean(text)].join(f);
  const err = code === "AA" ? "" : `\r${["ERR", "", "", "", code === "AR" ? "E" : "W", "", "", "", clean(text)].join(f)}`;
  return `${msh}\r${msa}${err}\r`;
}

/** A segment from field numbers (values already encoded), so no field lands one pipe off. */
export function buildSegment(id: string, fields: Record<number, string>): string {
  const n = Math.max(0, ...Object.keys(fields).map(Number));
  return [id, ...Array.from({ length: n }, (_, i) => fields[i + 1] ?? "")].join("|");
}
