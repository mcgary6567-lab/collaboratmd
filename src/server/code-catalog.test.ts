import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import {
  dotted, fiscalYear, hcpcsFindings, icdFindings, importHcpcs, importIcd10, importPracticeCodes, parseHcpcs, parseIcd10,
  procedureCatalog, searchDiagnoses, searchProcedures,
} from "./code-catalog";
import { codeSetFindings } from "./code-sets";
import { standardCharges } from "./fees";

/** A line of CMS's order file: order number, code, billable flag, short and long description in fixed columns. */
const line = (n: number, code: string, billable: boolean, short: string, long = short) =>
  `${String(n).padStart(5, "0")} ${code.replace(".", "").padEnd(7)} ${billable ? 1 : 0} ${short.padEnd(60)} ${long}`;

/** A year's file: the codes given, plus enough filler that it reads as a real file. */
const orderFile = (codes: [string, boolean, string][]) =>
  [...codes.map(([c, b, d], i) => line(i + 1, c, b, d.slice(0, 60), d)), ...Array.from({ length: 120 }, (_, i) => line(1000 + i, `Z99${String(i).padStart(2, "0")}`, true, `Filler ${i}`))].join("\n");

describe("ICD-10-CM by fiscal year", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("reads CMS's order and codes files", () => {
    const { rows } = parseIcd10([
      line(1, "E11", false, "Type 2 diabetes mellitus", "Type 2 diabetes mellitus"),
      line(2, "E119", true, "Type 2 diabetes mellitus without complications", "Type 2 diabetes mellitus without complications"),
      "I10     Essential (primary) hypertension",
    ].join("\n"));
    expect(rows).toEqual([
      { code: "E11", description: "Type 2 diabetes mellitus", billable: false },
      { code: "E11.9", description: "Type 2 diabetes mellitus without complications", billable: true },
      { code: "I10", description: "Essential (primary) hypertension", billable: true },
    ]);
    expect(dotted("M5450")).toBe("M54.50");
    expect(fiscalYear("2026-09-30")).toBe(2026);
    expect(fiscalYear("2026-10-01")).toBe(2027);
  });

  it("checks each diagnosis is billable and valid on the date of service, across a yearly update", async () => {
    // Nothing loaded: the built-in list is not checked.
    expect(await icdFindings(t.db, "2026-09-01", ["E11.9", "XYZ"])).toEqual([]);

    await importIcd10(t.db, orderFile([["E11", false, "Type 2 diabetes mellitus"], ["E11.9", true, "Type 2 diabetes mellitus without complications"], ["M54.5", true, "Low back pain"]]), 2026, "icd10cm_order_2026.txt", "test");
    // FY 2027 splits M54.5 into M54.50 and friends: M54.5 becomes a header.
    await importIcd10(t.db, orderFile([["E11", false, "Type 2 diabetes mellitus"], ["E11.9", true, "Type 2 diabetes mellitus without complications"], ["M54.5", false, "Low back pain"], ["M54.50", true, "Low back pain, unspecified"]]), 2027, "icd10cm_order_2027.txt", "test");

    const rules = async (dos: string, dx: string[]) => (await icdFindings(t.db, dos, dx)).map((f) => f.rule);
    expect(await rules("2026-09-15", ["E11.9"])).toEqual([]);
    expect(await rules("2026-09-15", ["E11"])).toEqual(["DX_BILLABLE"]);
    expect(await rules("2026-09-15", ["M54.50"])).toEqual(["DX_NOT_YET_VALID"]);
    expect(await rules("2026-10-01", ["M54.50"])).toEqual([]);
    expect(await rules("2026-10-01", ["M54.5"])).toEqual(["DX_BILLABLE"]);
    expect(await rules("2026-10-01", ["Q99.99"])).toEqual(["DX_CODE"]);
    // The FY 2028 file is not loaded yet: warned, not blocked.
    expect(await rules("2027-10-02", ["E11.9"])).toEqual(["DX_YEAR_NOT_LOADED"]);

    // A code the newest year dropped stays valid only for earlier dates.
    await importIcd10(t.db, orderFile([["E11", false, "Type 2 diabetes mellitus"], ["M54.50", true, "Low back pain, unspecified"], ["E11.9", true, "Type 2 diabetes mellitus without complications"]]), 2028, "icd10cm_order_2028.txt", "test");
    expect(await rules("2027-10-02", ["M54.5"])).toEqual(["DX_DELETED"]);

    // Claims get the same checks through the code-set scrub.
    const findings = await codeSetFindings(t.db, { payerType: "commercial", dateOfService: "2026-10-05", diagnoses: ["E11"], lines: [{ lineNumber: 1, cpt: "99213", modifiers: [], units: 1 }] });
    expect(findings.map((f) => f.rule)).toContain("DX_BILLABLE");

    expect((await searchDiagnoses(t.db, "back pain")).map((r) => r.code)).toContain("M54.50");
    expect((await searchDiagnoses(t.db, "e11")).map((r) => r.code)[0]).toBe("E11.9");
  });
});

describe("HCPCS Level II and the practice's own codes", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("loads CMS's HCPCS file saved as CSV and checks codes on claims", async () => {
    const csv = [
      "HCPC,SEQNUM,RECID,LONG DESCRIPTION,SHORT DESCRIPTION,ADD DT,TERM DT",
      "J1100,00100,3,\"Injection, dexamethasone sodium\",Dexamethasone sodium phos,20020101,",
      "J1100,00200,4,\"phosphate, 1 mg\",,,",
      "A4550,00100,3,Surgical trays,Surgical trays,19860101,20251231",
      "G0999,00100,3,Future service,Future service,20270101,",
      "25,00100,7,Significant separately identifiable E/M,Significant E/M,,",
    ].join("\n");
    expect(parseHcpcs(csv).rows.find((r) => r.code === "J1100")?.description).toBe("Injection, dexamethasone sodium phosphate, 1 mg");
    expect(await hcpcsFindings(t.db, "2026-09-01", [{ lineNumber: 1, cpt: "J9999" }])).toEqual([]);
    await importHcpcs(t.db, csv, "2026 Q4", "test");
    const rules = async (code: string) => (await hcpcsFindings(t.db, "2026-09-01", [{ lineNumber: 1, cpt: code }])).map((f) => f.rule);
    expect(await rules("J1100")).toEqual([]);
    expect(await rules("A4550")).toEqual(["HCPCS_TERMINATED"]);
    expect(await rules("G0999")).toEqual(["HCPCS_NOT_YET_VALID"]);
    expect(await rules("J9999")).toEqual(["HCPCS_CODE"]);
    expect(await rules("99213")).toEqual([]);
    expect((await searchProcedures(t.db, t.practiceId, "dexameth")).map((r) => r.code)).toContain("J1100");
  });

  it("imports a practice's procedure list in its own words, with fees", async () => {
    const r = await importPracticeCodes(t.db, t.practiceId, "Code,Description,Fee\n20610,Large joint injection,$185.00\n99213,Est. visit (our wording),\nABC,Not a code,10\n");
    expect(r).toMatchObject({ added: 2, fees: 1 });
    expect(r.problems[0]).toMatch(/ABC/);
    const catalog = await procedureCatalog(t.db, t.practiceId);
    expect(catalog.find((c) => c.code === "20610")?.description).toBe("Large joint injection");
    expect(catalog.find((c) => c.code === "99213")?.description).toBe("Est. visit (our wording)");
    expect((await standardCharges(t.db, t.practiceId)).get("20610")).toBe(18500);
    // Another practice sees neither.
    const [other] = (await t.db.execute<{ id: string }>(sql`SELECT id FROM practices WHERE id <> ${t.practiceId} LIMIT 1`)).rows;
    if (other) expect((await procedureCatalog(t.db, other.id)).some((c) => c.code === "20610")).toBe(false);
    expect((await t.db.select().from(schema.practiceCodes).where(eq(schema.practiceCodes.practiceId, t.practiceId))).length).toBe(2);
  });
});

describe("the diagnoses offered without typing", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("puts the practice's most used first, then the built-in list, and charge entry gets them", async () => {
    const { commonDiagnoses } = await import("./code-catalog");
    const { listCodes } = await import("./encounters");
    const common = await commonDiagnoses(t.db, t.practiceId);
    expect(common.length).toBeGreaterThan(0);
    const [top] = (await t.db.execute<{ code: string }>(sql`SELECT d AS code FROM encounters e, jsonb_array_elements_text(e.diagnoses) d WHERE e.practice_id = ${t.practiceId} GROUP BY d ORDER BY count(*) DESC LIMIT 1`)).rows;
    expect(common[0].code).toBe(top.code);
    const { cpts, icds } = await listCodes(t.db, t.practiceId);
    expect(cpts.length).toBeGreaterThan(0);
    expect(icds.length).toBe(common.length);
  });
});
