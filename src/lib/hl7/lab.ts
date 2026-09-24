/**
 * Lab orders out (ORM^O01) and results in (ORU^R01), HL7 v2.5.1.
 *
 * An order carries the patient (PID), their insurance for the lab to bill
 * (IN1), and for each test a common order (ORC, new order "NW") and its
 * observation request (OBR) naming the test and the ordering provider, plus
 * the diagnoses that justify it (DG1). The placer order number in ORC-2 and
 * OBR-2 is ours; the lab echoes it in the result, which is how a result finds
 * its order.
 *
 * A result repeats ORC/OBR per test, with one OBX per measured component:
 * value, units, reference range and an abnormal flag.
 */
import { buildSegment as seg, get, hl7Date, segments, type Hl7Message } from "./v2";

const esc = (v: string) => v.replace(/\\/g, "\\E\\").replace(/\|/g, "\\F\\").replace(/\^/g, "\\S\\").replace(/&/g, "\\T\\").replace(/~/g, "\\R\\");
const ts = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
const d8 = (iso: string) => iso.replace(/-/g, "");

export interface OrmInput {
  controlId: string;
  now: Date;
  receivingLab: string;
  placerOrderNumber: string;
  patient: { mrn: string; lastName: string; firstName: string; dob: string; sex: string };
  provider: { npi: string; lastName: string; firstName: string };
  insurance: { payerId: string; payerName: string; memberId: string; groupNumber: string | null } | null;
  diagnoses: string[];
  tests: { code: string; name: string }[];
  facility: string;
}

export function buildOrm(o: OrmInput): string {
  const now = ts(o.now);
  const doctor = `${o.provider.npi}^${esc(o.provider.lastName)}^${esc(o.provider.firstName)}^^^^^^NPI`;
  const lines = [
    `MSH|^~\\&|COLLABORATMD|${esc(o.facility)}|${o.receivingLab}|${o.receivingLab}|${now}||ORM^O01^ORM_O01|${o.controlId}|P|2.5.1`,
    seg("PID", { 1: "1", 3: `${esc(o.patient.mrn)}^^^^MR`, 5: `${esc(o.patient.lastName)}^${esc(o.patient.firstName)}`, 7: d8(o.patient.dob), 8: o.patient.sex }),
    seg("PV1", { 1: "1", 2: "O" }),
  ];
  if (o.insurance) {
    lines.push(seg("IN1", { 1: "1", 3: esc(o.insurance.payerId), 4: esc(o.insurance.payerName), 8: esc(o.insurance.groupNumber ?? ""), 17: "SEL", 36: esc(o.insurance.memberId) }));
  }
  o.tests.forEach((t, i) => {
    lines.push(seg("ORC", { 1: "NW", 2: o.placerOrderNumber, 4: o.placerOrderNumber, 9: now, 12: doctor }));
    lines.push(seg("OBR", { 1: String(i + 1), 2: o.placerOrderNumber, 4: `${esc(t.code)}^${esc(t.name)}^L`, 7: now, 16: doctor }));
  });
  o.diagnoses.forEach((dx, i) => lines.push(seg("DG1", { 1: String(i + 1), 3: `${esc(dx)}^^I10` })));
  return lines.join("\r") + "\r";
}

export interface OruObservation {
  testCode: string;
  loinc: string;
  name: string;
  value: string;
  units: string;
  range: string;
  flag: string;
  status: string; // F final, P preliminary, C corrected
  observedAt: string;
}

export interface OruResult {
  mrn: string;
  placerOrderNumber: string;
  fillerOrderNumber: string;
  observations: OruObservation[];
}

export function parseOru(msg: Hl7Message): OruResult {
  const pid = msg.segments.find((s) => s.id === "PID");
  const orc = segments(msg, "ORC")[0];
  const firstObr = segments(msg, "OBR")[0];
  const placer = get(msg, orc, 2) || get(msg, firstObr, 2);
  if (!placer) throw new Error("The result has no placer order number (ORC-2 or OBR-2) to match an order");
  const observations: OruObservation[] = [];
  let testCode = "";
  for (const seg of msg.segments) {
    if (seg.id === "OBR") testCode = get(msg, seg, 4, 1);
    if (seg.id !== "OBX") continue;
    observations.push({
      testCode,
      loinc: get(msg, seg, 3, 1),
      name: get(msg, seg, 3, 2),
      value: get(msg, seg, 5),
      units: get(msg, seg, 6),
      range: get(msg, seg, 7),
      flag: get(msg, seg, 8),
      status: get(msg, seg, 11) || "F",
      observedAt: hl7Date(get(msg, seg, 14)),
    });
  }
  if (!observations.length) throw new Error("The result has no OBX observations");
  return { mrn: get(msg, pid, 3, 1), placerOrderNumber: placer, fillerOrderNumber: get(msg, orc, 3) || get(msg, firstObr, 3), observations };
}

export interface OruInput {
  controlId: string;
  now: Date;
  sendingLab: string;
  placerOrderNumber: string;
  fillerOrderNumber: string;
  patient: { mrn: string; lastName: string; firstName: string; dob: string; sex: string };
  tests: { code: string; name: string; observations: { loinc: string; name: string; value: string; units: string; range: string; flag: string }[] }[];
}

/** A result as a lab sends it; used by the demo simulator and tests. */
export function buildOru(r: OruInput): string {
  const now = ts(r.now);
  const lines = [
    `MSH|^~\\&|${r.sendingLab}|${r.sendingLab}|COLLABORATMD||${now}||ORU^R01^ORU_R01|${r.controlId}|P|2.5.1`,
    seg("PID", { 1: "1", 3: `${esc(r.patient.mrn)}^^^^MR`, 5: `${esc(r.patient.lastName)}^${esc(r.patient.firstName)}`, 7: d8(r.patient.dob), 8: r.patient.sex }),
  ];
  let setId = 0;
  r.tests.forEach((t, i) => {
    lines.push(seg("ORC", { 1: "RE", 2: r.placerOrderNumber, 3: r.fillerOrderNumber }));
    // OBR-22 results reported, OBR-25 result status (F final).
    lines.push(seg("OBR", { 1: String(i + 1), 2: r.placerOrderNumber, 3: r.fillerOrderNumber, 4: `${esc(t.code)}^${esc(t.name)}^L`, 7: now, 22: now, 25: "F" }));
    for (const o of t.observations) {
      lines.push(seg("OBX", { 1: String(++setId), 2: "NM", 3: `${o.loinc}^${esc(o.name)}^LN`, 5: esc(o.value), 6: esc(o.units), 7: esc(o.range), 8: o.flag, 11: "F", 14: now }));
    }
  });
  return lines.join("\r") + "\r";
}
