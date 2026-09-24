import { describe, expect, it } from "vitest";
import { detectDelimiters, tokenize } from "./x12";
import { build999, parse999, validateStructure } from "./x999";
import { build277CA, parse277CA } from "./x277ca";
import { buildEdi837P, type Edi837Input } from "./x837p";
import { buildEdi835, parseEdi835 } from "./x835";

const base837: Edi837Input = {
  controlNumber: "CMD000123",
  interchangeControl: "123456789",
  senderId: "COLLABORATMD",
  receiverId: "60054",
  now: new Date("2026-09-24T15:00:00Z"),
  billingProvider: { name: "Summit Health Partners", npi: "1234567893", taxId: "84-2917465", address1: "1 Main St", city: "Dallas", state: "TX", zip: "75201" },
  renderingProvider: { lastName: "King", firstName: "Jacob", npi: "1234567893", taxonomy: "207Q00000X" },
  payer: { name: "Aetna", payerId: "60054" },
  subscriber: { lastName: "Doe", firstName: "Jane", memberId: "AE123", groupNumber: null, dob: "1980-01-01", sex: "F", relationship: "self" },
  claim: { totalCents: 13_500, placeOfService: "11", frequencyCode: "1", dateOfService: "2026-09-20", diagnoses: ["E11.9"] },
  lines: [{ cpt: "99213", modifiers: [], chargeCents: 13_500, units: 1, dxPointers: [1], dateOfService: "2026-09-20" }],
};

describe("X12 delimiters", () => {
  it("reads non-default delimiters from the ISA header", () => {
    const raw = "ISA|00|          |00|          |ZZ|SENDER         |ZZ|RECEIVER       |260924|1500|^|00501|000000001|0|P|>!GS|HP|S|R|20260924|1500|1|X|005010X221A1!ST|835|0001!SE|2|0001!";
    expect(detectDelimiters(raw)).toEqual({ element: "|", component: ">", segment: "!", repetition: "^" });
    expect(tokenize(raw).segments.map((s) => s[0])).toEqual(["ISA", "GS", "ST", "SE"]);
  });

  it("parses an 835 whose trading partner uses pipes and a different terminator", () => {
    const standard = buildEdi835({
      payerName: "Aetna", payerId: "60054", checkNumber: "EFT1", paymentDate: new Date("2026-09-24"),
      claims: [{ patientControlNumber: "CMD1", payerClaimNumber: "P1", statusCode: "1", chargedCents: 10_000, paidCents: 6_000, patientResponsibilityCents: 1_000, adjustments: [],
        lines: [{ cpt: "99213", chargedCents: 10_000, paidCents: 6_000, units: 1, adjustments: [{ group: "CO", reason: "45", amountCents: 3_000 }, { group: "PR", reason: "3", amountCents: 1_000 }] }] }],
    });
    // Re-express the same file with pipe, greater-than and exclamation mark.
    const exotic = standard.replace(/\*/g, "|").replace(/~\n?/g, "!").replace(/\|:!/, "|>!").replace(/HC:/g, "HC>");
    const parsed = parseEdi835(exotic);
    expect(parsed.claims[0].paidCents).toBe(6_000);
    expect(parsed.claims[0].lines[0].cpt).toBe("99213");
    expect(parsed.claims[0].lines[0].adjustments).toHaveLength(2);
  });
});

describe("837P references", () => {
  it("sends REF*F8 for a replacement and REF*G1 for an authorization, before HI", () => {
    const edi = buildEdi837P({ ...base837, claim: { ...base837.claim, frequencyCode: "7", originalPayerClaimNumber: "PCN998877", authorizationNumber: "AUTH-55" } });
    const tags = tokenize(edi).segments.map((s) => s.join("*"));
    const clm = tags.findIndex((t) => t.startsWith("CLM*"));
    expect(tags[clm]).toContain("11:B:7");
    expect(tags[clm + 1]).toBe("REF*F8*PCN998877");
    expect(tags[clm + 2]).toBe("REF*G1*AUTH-55");
    expect(tags[clm + 3].startsWith("HI*")).toBe(true);
  });

  it("refuses to build a void without the payer's original claim number", () => {
    expect(() => buildEdi837P({ ...base837, claim: { ...base837.claim, frequencyCode: "8" } })).toThrow(/REF\*F8/);
  });
});

describe("999 implementation acknowledgment", () => {
  it("accepts a well-formed 837 and echoes its control numbers", () => {
    const edi = buildEdi837P(base837);
    expect(validateStructure(edi)).toEqual([]);
    const ack = parse999(build999({ original837: edi, senderId: "CH", receiverId: "COLLABORATMD", now: new Date(), control: "5", errors: [] }));
    expect(ack.accepted).toBe(true);
    expect(ack.acknowledgedTransactionControl).toBe("0001");
    expect(ack.acknowledgedGroupControl).toBe("123456789");
  });

  it("rejects a file whose SE segment count is wrong", () => {
    const edi = buildEdi837P(base837).replace(/SE\*(\d+)\*0001/, (_m, n) => `SE*${Number(n) + 3}*0001`);
    const errors = validateStructure(edi);
    expect(errors.length).toBeGreaterThan(0);
    const ack = parse999(build999({ original837: edi, senderId: "CH", receiverId: "COLLABORATMD", now: new Date(), control: "6", errors }));
    expect(ack.accepted).toBe(false);
    expect(ack.errors[0].segmentId).toBe("SE");
  });
});

describe("277CA claim acknowledgment", () => {
  it("round-trips accepted and rejected claims with their status codes", () => {
    const raw = build277CA({
      senderId: "CH", receiverId: "COLLABORATMD", now: new Date("2026-09-24T15:00:00Z"), control: "7",
      sourceName: "Clearinghouse", submitterName: "Summit", billingProvider: { name: "Summit", npi: "1234567893" },
      claims: [
        { controlNumber: "CMD1", patientLast: "Doe", patientFirst: "Jane", memberId: "A1", chargeCents: 10_000, dateOfService: "2026-09-20", status: "A2:20", payerClaimNumber: "ICN1" },
        { controlNumber: "CMD2", patientLast: "Roe", patientFirst: "Rich", memberId: "BADX", chargeCents: 5_000, dateOfService: "2026-09-21", status: "A7:164:IL" },
      ],
    });
    const claims = parse277CA(raw);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ controlNumber: "CMD1", accepted: true, category: "A2", statusCode: "20", payerClaimNumber: "ICN1", chargeCents: 10_000, dateOfService: "2026-09-20" });
    expect(claims[1]).toMatchObject({ controlNumber: "CMD2", accepted: false, category: "A7", statusCode: "164", entity: "IL" });
    expect(claims[1].message).toMatch(/Rejected for invalid information/);
    expect(claims[1].message).toMatch(/member number/);
  });
});
