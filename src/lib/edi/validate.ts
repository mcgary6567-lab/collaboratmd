/**
 * Structural checks on an outgoing X12 interchange, run before a claim leaves
 * and in the test suite against every claim type we build. They catch the
 * mistakes a builder change can introduce without anyone noticing: wrong
 * segment counts or control numbers, a broken HL tree, charges that do not add
 * up, invalid NPIs, impossible dates, oversized fields, trailing empty
 * elements.
 *
 * This is not a full implementation-guide validator (that needs the licensed
 * X12 guides); a clearinghouse still runs its own. It is the part we can check
 * for certain, so a 999 rejection never comes from our own bookkeeping.
 */
import { tokenize } from "./x12";
import { isValidNpi } from "@/lib/scrub/rules";

export type X12Check = { errors: string[]; warnings: string[] };

/** ISA element widths are fixed (ISA01 to ISA16). */
const ISA_WIDTHS = [2, 10, 2, 10, 2, 15, 2, 15, 6, 4, 1, 5, 9, 1, 1, 1];

/** Maximum lengths for elements that carry free text or identifiers, per the 005010 guides. */
const MAX: Record<string, number[]> = {
  NM1: [0, 3, 1, 60, 35, 25, 10, 10, 2, 80],
  N3: [0, 55, 55],
  N4: [0, 30, 2, 15],
  REF: [0, 3, 50],
  CLM: [0, 38, 18],
  PER: [0, 2, 60, 2, 256],
  DMG: [0, 3, 35, 1],
};

const ICN_FOR: Record<string, string> = { "837": "HC" };

function validD8(v: string) {
  if (!/^\d{8}$/.test(v)) return false;
  const d = new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10).replace(/-/g, "") === v;
}

const cents = (v: string | undefined) => Math.round(parseFloat(v ?? "0") * 100);

export function validateX12(raw: string): X12Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { segments, delimiters } = tokenize(raw);
  if (!segments.length || segments[0][0] !== "ISA") return { errors: ["The file does not start with an ISA segment"], warnings };

  // Envelope.
  const isa = segments[0];
  if (isa.length !== 17) errors.push(`ISA has ${isa.length - 1} elements; it must have 16`);
  else ISA_WIDTHS.forEach((w, i) => { if (isa[i + 1].length !== w) errors.push(`ISA${String(i + 1).padStart(2, "0")} is ${isa[i + 1].length} characters; it must be ${w}`); });
  const iea = segments[segments.length - 1];
  if (iea[0] !== "IEA") errors.push("The file does not end with an IEA segment");
  const groups = segments.filter((s) => s[0] === "GS");
  if (iea[0] === "IEA") {
    if (iea[2] !== isa[13]) errors.push(`IEA02 (${iea[2]}) does not match ISA13 (${isa[13]})`);
    if (Number(iea[1]) !== groups.length) errors.push(`IEA01 says ${iea[1]} groups; there are ${groups.length}`);
  }

  let gs: string[] | null = null;
  let st: string[] | null = null;
  let stIndex = 0;
  let setsInGroup = 0;
  let hls: { id: string; parent: string; level: string; child: string }[] = [];
  let claim: { id: string; total: number; lines: number } | null = null;
  const closeClaim = () => {
    if (claim && claim.total !== claim.lines) errors.push(`Claim ${claim.id}: CLM02 ${(claim.total / 100).toFixed(2)} does not equal the service lines, ${(claim.lines / 100).toFixed(2)}`);
    claim = null;
  };
  const closeHls = () => {
    const ids = new Set<string>();
    hls.forEach((h, i) => {
      if (h.id !== String(i + 1)) errors.push(`HL01 ${h.id} is out of sequence; expected ${i + 1}`);
      if (h.parent && !ids.has(h.parent)) errors.push(`HL ${h.id} points to parent ${h.parent}, which does not come before it`);
      ids.add(h.id);
      const hasChild = hls.some((x) => x.parent === h.id);
      if (h.child && h.child !== (hasChild ? "1" : "0")) errors.push(`HL ${h.id}: HL04 is ${h.child} but it ${hasChild ? "has" : "has no"} child levels`);
    });
    hls = [];
  };

  segments.forEach((seg, i) => {
    const id = seg[0];
    if (id !== "ISA" && seg.length > 1 && seg[seg.length - 1] === "") errors.push(`${id} (segment ${i + 1}) ends with an empty element; trailing separators must be left off`);
    if (/[^\x20-\x7E]/.test(seg.join(delimiters.element))) warnings.push(`${id} (segment ${i + 1}) has characters outside the X12 basic set`);
    const max = MAX[id];
    if (max) seg.forEach((v, j) => { if (j > 0 && max[j] && v.length > max[j]) errors.push(`${id}${String(j).padStart(2, "0")} is ${v.length} characters; the limit is ${max[j]}`); });

    switch (id) {
      case "GS":
        gs = seg; setsInGroup = 0;
        break;
      case "GE":
        if (!gs) { errors.push("GE without GS"); break; }
        if (seg[2] !== gs[6]) errors.push(`GE02 (${seg[2]}) does not match GS06 (${gs[6]})`);
        if (Number(seg[1]) !== setsInGroup) errors.push(`GE01 says ${seg[1]} transaction sets; the group has ${setsInGroup}`);
        gs = null;
        break;
      case "ST":
        st = seg; stIndex = i; setsInGroup++;
        if (gs && ICN_FOR[seg[1]] && gs[1] !== ICN_FOR[seg[1]]) errors.push(`GS01 is ${gs[1]}; a ${seg[1]} belongs in a ${ICN_FOR[seg[1]]} group`);
        if (gs && seg[3] && seg[3] !== gs[8]) errors.push(`ST03 (${seg[3]}) does not match GS08 (${gs[8]})`);
        break;
      case "SE":
        closeClaim();
        closeHls();
        if (!st) { errors.push("SE without ST"); break; }
        if (Number(seg[1]) !== i - stIndex + 1) errors.push(`SE01 says ${seg[1]} segments; the transaction has ${i - stIndex + 1}`);
        if (seg[2] !== st[2]) errors.push(`SE02 (${seg[2]}) does not match ST02 (${st[2]})`);
        st = null;
        break;
      case "HL":
        closeClaim();
        hls.push({ id: seg[1], parent: seg[2] ?? "", level: seg[3] ?? "", child: seg[4] ?? "" });
        if (!["20", "22", "23"].includes(seg[3] ?? "")) errors.push(`HL ${seg[1]}: level code ${seg[3]} is not billing (20), subscriber (22) or patient (23)`);
        break;
      case "CLM":
        closeClaim();
        claim = { id: seg[1], total: cents(seg[2]), lines: 0 };
        break;
      case "SV1": case "SV2": case "SV3":
        if (claim) claim.lines += cents(id === "SV2" ? seg[3] : seg[2]);
        break;
      case "NM1":
        if (seg[8] === "XX" && !isValidNpi(seg[9] ?? "")) errors.push(`NM1*${seg[1]}: NPI ${seg[9]} fails the check digit`);
        break;
      case "DTP": {
        const [, , fmt, v = ""] = seg;
        if (fmt === "D8" && !validD8(v)) errors.push(`DTP*${seg[1]}: ${v} is not a real date`);
        if (fmt === "RD8") {
          const [a, b] = v.split("-");
          if (!validD8(a ?? "") || !validD8(b ?? "") || a > b) errors.push(`DTP*${seg[1]}: ${v} is not a valid date range`);
        }
        break;
      }
      case "PER":
        for (let j = 3; j < seg.length; j += 2) if (seg[j] === "TE" && /^0+$/.test(seg[j + 1] ?? "")) errors.push("PER has a placeholder phone number");
        break;
      case "N4":
        if (seg[3] && !/^\d{5}(\d{4})?$/.test(seg[3])) errors.push(`N4: ZIP ${seg[3]} must be 5 or 9 digits`);
        break;
    }
  });
  if (st) errors.push("A transaction set has no SE");
  if (gs) errors.push("A functional group has no GE");
  return { errors, warnings };
}
