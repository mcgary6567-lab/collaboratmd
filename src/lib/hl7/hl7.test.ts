import { describe, expect, it } from "vitest";
import { buildAck, get, parseHl7, segment } from "./v2";
import { extractEncounter, extractInsurance, extractPatient } from "./extract";
import { ADT_A04, DFT_P03 } from "./fixtures";


describe("HL7 v2 parsing", () => {
  it("reads the header and numbers MSH fields the HL7 way", () => {
    const m = parseHl7(ADT_A04);
    expect(m).toMatchObject({ type: "ADT", event: "A04", controlId: "MSG00001", version: "2.5.1", sendingApplication: "EPIC", sendingFacility: "SUMMITCLINIC" });
    expect(get(m, segment(m, "MSH"), 1)).toBe("|");
    expect(get(m, segment(m, "MSH"), 3)).toBe("EPIC");
  });

  it("accepts \\n line endings and MLLP framing characters", () => {
    const framed = "\x0b" + ADT_A04.replace(/\r/g, "\n") + "\x1c\r";
    expect(parseHl7(framed).controlId).toBe("MSG00001");
  });

  it("honors non-default delimiters and unescapes values", () => {
    const m = parseHl7("MSH#*~!&#APP#FAC#X#Y#20260101##ADT*A08#C1#P#2.3\rPID#1##M1***X*MR##Smith!T!Jones*Ann##19700101#F");
    expect(m.event).toBe("A08");
    expect(extractPatient(m)).toMatchObject({ mrn: "M1", lastName: "Smith&Jones", firstName: "Ann" });
  });

  it("rejects something that is not HL7", () => {
    expect(() => parseHl7("PID|1||X")).toThrow(/MSH/);
  });
});

describe("ADT patient extraction", () => {
  const m = parseHl7(ADT_A04);

  it("takes the MR identifier, normalizes the address and finds phone and email", () => {
    expect(extractPatient(m)).toEqual({
      mrn: "MRN44120", lastName: "O'Brien", firstName: "Siobhan", dob: "1985-03-12", sex: "F",
      address1: "12 Elm St", city: "Dallas", state: "TX", zip: "75204", phone: "214-555-0142", email: "siobhan.obrien@example.com",
    });
  });

  it("reads primary insurance from IN1", () => {
    expect(extractInsurance(m)).toEqual({ payerId: "60054", payerName: "Aetna", memberId: "W123456789", groupNumber: "GRP-7781", relationship: "self" });
  });

  it("names every missing required field", () => {
    const bad = parseHl7("MSH|^~\\&|A|B|C|D|20260101||ADT^A04|X|P|2.5\rPID|1||^^^^MR||Doe");
    expect(() => extractPatient(bad)).toThrow("Missing PID-3 (MRN), PID-5.2 (first name), PID-7 (date of birth)");
  });
});

describe("DFT charge extraction", () => {
  it("builds one encounter with CPT, modifiers, units, price and ordered diagnoses", () => {
    const e = extractEncounter(parseHl7(DFT_P03));
    expect(e.visitNumber).toBe("V99812");
    expect(e.placeOfService).toBe("11");
    expect(e.diagnoses).toEqual(["E119", "I10"]);
    expect(e.charges).toEqual([
      { dateOfService: "2026-09-23", cpt: "99214", modifiers: ["25"], units: 1, chargeCents: 18_500, diagnoses: ["E11.9", "I10"], providerNpi: "1234567893", description: "Office visit est, moderate" },
      { dateOfService: "2026-09-23", cpt: "83036", modifiers: [], units: 1, chargeCents: null, diagnoses: ["E11.9"], providerNpi: "1234567893", description: "Hemoglobin A1C" },
    ]);
  });

  it("refuses a DFT with an unusable procedure code", () => {
    expect(() => extractEncounter(parseHl7(DFT_P03.replace("99214^Office visit est, moderate^CPT4", "OFFICE^Visit")))).toThrow(/invalid procedure code/);
  });
});

describe("acknowledgments", () => {
  it("echoes the control ID and swaps sender and receiver", () => {
    const ack = parseHl7(buildAck(parseHl7(ADT_A04), "AA"));
    expect(ack.type).toBe("ACK");
    expect(get(ack, segment(ack, "MSA"), 1)).toBe("AA");
    expect(get(ack, segment(ack, "MSA"), 2)).toBe("MSG00001");
    expect(get(ack, segment(ack, "MSH"), 5)).toBe("EPIC");
  });

  it("escapes the delimiter inside an error message", () => {
    const ack = parseHl7(buildAck(parseHl7(ADT_A04), "AE", "PID-7 | missing"));
    expect(get(ack, segment(ack, "MSA"), 3)).toBe("PID-7 | missing");
    expect(segment(ack, "ERR")).toBeDefined();
  });
});
