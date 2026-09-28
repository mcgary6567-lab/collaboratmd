import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { cms1500Pages } from "@/lib/cms1500";
import { validateX12 } from "@/lib/edi/validate";
import { tokenize } from "@/lib/edi/x12";
import { parseNppes } from "@/lib/nppes";
import { paperClaim, markMailed } from "./paper-claim";
import { batch837, combine837, importResponseFile, markSent, transactionSetOf } from "./clearinghouse-files";
import { editClaimAccident } from "./claim-edit";
import { previewClaimEdi } from "./claims";

const at = (pages: ReturnType<typeof cms1500Pages>, line: number, col: number) => pages[0].find((f) => f.line === line && f.col === col)?.text;

describe("the CMS-1500 paper claim", () => {
  const base = {
    payer: { name: "State Fund", type: "workers_comp" },
    insured: { id: "WC123", lastName: "Reyes", firstName: "Ana" },
    patient: { lastName: "Reyes", firstName: "Ana", dob: "1984-03-02", sex: "F", address1: "9 Palm St", city: "Tampa", state: "FL", zip: "33601", phone: "(813) 555-0100", accountNumber: "CMD000077" },
    relationship: "self", otherInsurance: false,
    accident: { employment: true, auto: false, other: false, date: "2026-08-28", propertyClaimNumber: "WC-2026-42" },
    diagnoses: ["S93.401A", "M25.571"],
    lines: Array.from({ length: 8 }, (_, i) => ({ from: "2026-09-01", pos: "11", cpt: i ? "97110" : "99213", modifiers: i ? ["GP"] : [], pointers: [1, 2], chargeCents: 5000, units: i ? 2 : 1, renderingNpi: "1234567893" })),
    totalCents: 75000, paidCents: 0,
    billing: { name: "Lakeside Family Medicine", address1: "410 Lakeside Ave", city: "Orlando", state: "FL", zip: "32801-1234", phone: "(407) 555-0100", npi: "1234567893", taxId: "12-3456789" },
    signedOn: "2026-09-02",
  };

  it("puts each value in its box, with six lines to a form and the total on the last", () => {
    const pages = cms1500Pages(base);
    expect(pages).toHaveLength(2);
    expect(at(pages, 8, 45)).toBe("X"); // 1: other (workers' comp)
    expect(at(pages, 10, 2)).toBe("REYES, ANA");
    expect(at(pages, 10, 31)).toBe("03 02 1984");
    expect(at(pages, 20, 35)).toBe("X"); // 10a yes
    expect(at(pages, 22, 41)).toBe("X"); // 10b no
    expect(at(pages, 22, 53)).toBe("WC-2026-42"); // 11b with Y4
    expect(at(pages, 39, 3)).toBe("S93401A"); // 21A without the dot
    expect(at(pages, 45, 45)).toBe("AB");
    expect(at(pages, 45, 50)).toBe("      50"); // 24F dollars, right-aligned
    expect(at(pages, 47, 32)).toBe("GP");
    expect(at(pages, 57, 1)).toBe("123456789");
    expect(pages[0].find((f) => f.line === 57 && f.col === 51)?.text).toBe("CONTINUED");
    expect(pages[1].find((f) => f.line === 57 && f.col === 51)?.text).toBe("    750");
    expect(pages[1].filter((f) => f.line >= 45 && f.line <= 55 && f.col === 25)).toHaveLength(2);
  });
});

describe("paper and file-based claims for a practice", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  const readyClaims = () => t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.status, "ready"))).limit(3);

  it("prints a claim on the form, and marks it mailed", async () => {
    const [c] = await readyClaims();
    const paper = await paperClaim(t.db, t.practiceId, c.id);
    expect(paper?.pages[0].some((f) => f.text === c.controlNumber)).toBe(true);
    expect(await paperClaim(t.db, "00000000-0000-0000-0000-000000000000", c.id)).toBeNull();
    await markMailed(t.db, t.practiceId, c.id, t.userId);
    const [after] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, c.id));
    expect(after.status).toBe("submitted");
    await expect(markMailed(t.db, t.practiceId, c.id)).rejects.toThrow(/ready/);
  });

  it("builds one 837 file for many claims, under the clearinghouse's IDs, and marks them sent", async () => {
    await t.db.update(schema.practices).set({ ediSubmitterId: "SUB12345", ediReceiverId: "OFFALLY" }).where(eq(schema.practices.id, t.practiceId));
    const ready = await readyClaims();
    const { edi, included } = await batch837(t.db, t.practiceId, ready.map((r) => r.id));
    expect(included.length).toBe(ready.length);
    expect(validateX12(edi).errors).toEqual([]);
    const segs = tokenize(edi).segments;
    expect(segs[0][6].trim()).toBe("SUB12345");
    expect(segs[0][8].trim()).toBe("OFFALLY");
    const sts = segs.filter((s) => s[0] === "ST").map((s) => s[2]);
    expect(new Set(sts).size).toBe(ready.length);
    expect(segs.find((s) => s[0] === "GE")?.[1]).toBe(String(ready.length));
    // Each claim's own file carries the same IDs.
    expect(tokenize((await previewClaimEdi(t.db, ready[0].id)).edi).segments[0][6].trim()).toBe("SUB12345");
    expect(await markSent(t.db, t.practiceId, ready.map((r) => r.id), t.userId)).toBe(ready.length);
    expect(await markSent(t.db, t.practiceId, ready.map((r) => r.id), t.userId)).toBe(0);
  });

  it("reads a 277CA uploaded from the clearinghouse once", async () => {
    const [c] = await t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.status, "submitted"))).limit(1);
    const { build277CA } = await import("@/lib/edi/x277ca");
    const x12 = build277CA({
      senderId: "CH", receiverId: "SUB12345", now: new Date(), control: "9", sourceName: "Clearinghouse", submitterName: "Practice", billingProvider: { name: "Practice", npi: "1234567893" },
      claims: [{ controlNumber: c.controlNumber, patientLast: "A", patientFirst: "B", memberId: "M1", chargeCents: c.totalCents, dateOfService: "2026-09-20", status: "A2:20", payerClaimNumber: "PCN-77" }],
    });
    expect(transactionSetOf(x12)).toBe("277");
    expect((await importResponseFile(t.db, t.practiceId, x12, t.userId)).message).toMatch(/1 accepted/);
    expect((await importResponseFile(t.db, t.practiceId, x12, t.userId)).message).toMatch(/already read/);
    const [after] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, c.id));
    expect(after).toMatchObject({ status: "accepted", payerClaimNumber: "PCN-77" });
    await expect(importResponseFile(t.db, t.practiceId, "hello", t.userId)).rejects.toThrow(/not an 835/);
  });

  it("changes a claim's accident details and checks it again", async () => {
    const [c] = await t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.claimType, "professional"), eq(schema.claims.status, "draft"))).limit(1)
      .then(async (r) => r.length ? r : t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.status, "scrub_errors"))).limit(1));
    await expect(editClaimAccident(t.db, t.practiceId, c.id, { employment: false, auto: true, autoState: "ZZ", other: false, date: "2026-08-01" })).rejects.toThrow(/not a US state/);
    await editClaimAccident(t.db, t.practiceId, c.id, { employment: false, auto: true, autoState: "fl", other: false, date: "2026-08-01", claimNumber: "AUTO-9" }, t.userId);
    const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.id, c.encounterId));
    expect(enc).toMatchObject({ relatedAuto: true, autoAccidentState: "FL", accidentDate: "2026-08-01", propertyClaimNumber: "AUTO-9" });
  });

  it("combines only well-formed files", () => {
    expect(() => combine837([])).toThrow(/No claims/);
  });
});

describe("the NPI Registry", () => {
  it("reads a provider and an organization", () => {
    const person = parseNppes({ result_count: 1, results: [{
      number: 1245319599, enumeration_type: "NPI-1", basic: { first_name: "RAJ", last_name: "PATEL", credential: "M.D.", status: "A" },
      addresses: [{ address_purpose: "MAILING", address_1: "PO BOX 1" }, { address_purpose: "LOCATION", address_1: "100 MAIN ST", city: "ORLANDO", state: "FL", postal_code: "328011234", telephone_number: "407-555-0199" }],
      taxonomies: [{ code: "207R00000X", desc: "Internal Medicine", primary: true }],
    }] }, "1245319599");
    expect(person).toMatchObject({ kind: "individual", firstName: "Raj", lastName: "Patel", credential: "MD", address1: "100 Main St", city: "Orlando", state: "FL", zip: "32801-1234", phone: "(407) 555-0199", taxonomy: "207R00000X", specialty: "Internal Medicine", active: true });
    const org = parseNppes({ results: [{ number: "1234567893", enumeration_type: "NPI-2", basic: { organization_name: "LAKESIDE FAMILY MEDICINE LLC" }, addresses: [], taxonomies: [] }] }, "1234567893");
    expect(org).toMatchObject({ kind: "organization", name: "LAKESIDE FAMILY MEDICINE LLC", firstName: null });
    expect(parseNppes({ results: [] }, "1234567893")).toBeNull();
  });
});
