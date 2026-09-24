import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { get, parseHl7, segment, segments } from "@/lib/hl7/v2";
import { buildOru, parseOru } from "@/lib/hl7/lab";
import { abnormalFlag } from "@/lib/labs/catalog";
import { applyOru, cancelLabOrder, createLabOrder, getLabOrder, labWorklist, markLabReviewed, simulateLabResult } from "./labs";
import { processHl7 } from "./hl7";

describe("lab flags", () => {
  it("flags low, high and critical values against the range", () => {
    expect(abnormalFlag(90, 70, 99)).toBe("");
    expect(abnormalFlag(65, 70, 99)).toBe("L");
    expect(abnormalFlag(40, 70, 99)).toBe("LL");
    expect(abnormalFlag(130, 70, 99)).toBe("H");
    expect(abnormalFlag(400, 70, 99)).toBe("HH");
    expect(abnormalFlag(250, null, 200)).toBe("H");
  });
});

describe("lab orders against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patient: typeof schema.patients.$inferSelect;
  let providerId: string;

  beforeAll(async () => {
    t = await testDb();
    const [row] = await t.db
      .select({ patient: schema.patients })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true)))
      .limit(1);
    patient = row.patient;
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = provider.id;
  });
  afterAll(async () => { await t?.close(); });

  const order = () => createLabOrder(t.db, t.practiceId, { patientId: patient.id, providerId, labCode: "QUEST", testCodes: ["CMP", "A1C"], diagnoses: ["E11.9", "i10"] }, t.userId);

  it("writes a well-formed ORM^O01 with one ORC/OBR per test, insurance and diagnoses", async () => {
    const o = await order();
    expect(o.placerOrderNumber).toMatch(/^L\d{6}\d{5}$/);
    expect(o.diagnoses).toEqual(["E119", "I10"]);
    const m = parseHl7(o.ormMessage);
    expect(`${m.type}^${m.event}`).toBe("ORM^O01");
    expect(get(m, segment(m, "PID"), 3)).toBe(patient.mrn);
    const obrs = segments(m, "OBR");
    expect(obrs.map((s) => get(m, s, 4))).toEqual(["CMP", "A1C"]);
    expect(get(m, obrs[0], 2)).toBe(o.placerOrderNumber);
    expect(get(m, obrs[0], 16)).toMatch(/^\d{10}$/); // ordering provider NPI in OBR-16
    expect(get(m, segments(m, "ORC")[0], 12)).toMatch(/^\d{10}$/);
    expect(get(m, segment(m, "IN1"), 36)).toBeTruthy();
    expect(segments(m, "DG1").map((s) => get(m, s, 3))).toEqual(["E119", "I10"]);
  });

  it("refuses orders without tests or with a malformed diagnosis", async () => {
    await expect(createLabOrder(t.db, t.practiceId, { patientId: patient.id, providerId, labCode: "QUEST", testCodes: [], diagnoses: ["E11.9"] })).rejects.toThrow(/at least one test/);
    await expect(createLabOrder(t.db, t.practiceId, { patientId: patient.id, providerId, labCode: "QUEST", testCodes: ["TSH"], diagnoses: ["diabetes"] })).rejects.toThrow(/ICD-10/);
  });

  it("attaches a lab's result, flags it, and waits for review", async () => {
    const o = await order();
    const pt = { mrn: patient.mrn, lastName: patient.lastName, firstName: patient.firstName, dob: patient.dob, sex: patient.sex };
    const raw = buildOru({
      controlId: "LAB-1", now: new Date(), sendingLab: "QUEST", placerOrderNumber: o.placerOrderNumber, fillerOrderNumber: "Q123", patient: pt,
      tests: [{ code: "A1C", name: "Hemoglobin A1c", observations: [{ loinc: "4548-4", name: "Hemoglobin A1c", value: "8.2", units: "%", range: "4.0-5.6", flag: "H" }] }],
    });
    expect(parseOru(parseHl7(raw)).observations[0]).toMatchObject({ testCode: "A1C", loinc: "4548-4", value: "8.2", flag: "H", status: "F" });

    const r = await processHl7(t.db, t.practiceId, raw, { source: "manual" });
    expect(r.status).toBe("processed");
    let got = await getLabOrder(t.db, t.practiceId, o.id);
    expect(got?.order).toMatchObject({ status: "partial", fillerOrderNumber: "Q123" }); // CMP not back yet
    expect(got?.results).toHaveLength(1);

    const wl = await labWorklist(t.db, t.practiceId);
    expect(wl.find((w) => w.order.id === o.id)).toMatchObject({ resultCount: 1, abnormal: 1 });

    // A corrected value replaces the earlier one rather than adding to it.
    const corrected = raw.replace("LAB-1", "LAB-2").replace("|8.2|", "|7.9|").replace(/\|F\|\|\|(\d+)$/m, "|C|||$1");
    await processHl7(t.db, t.practiceId, corrected, { source: "manual" });
    got = await getLabOrder(t.db, t.practiceId, o.id);
    expect(got?.results.map((x) => [x.value, x.status])).toEqual([["7.9", "C"]]);

    await markLabReviewed(t.db, t.practiceId, o.id, t.userId);
    expect((await labWorklist(t.db, t.practiceId)).find((w) => w.order.id === o.id)).toBeUndefined();
  });

  it("refuses a result whose patient is not the patient on the order", async () => {
    const o = await order();
    const raw = buildOru({
      controlId: "LAB-X", now: new Date(), sendingLab: "QUEST", placerOrderNumber: o.placerOrderNumber, fillerOrderNumber: "Q9",
      patient: { mrn: "SOMEONE-ELSE", lastName: "Other", firstName: "Person", dob: "1970-01-01", sex: "M" },
      tests: [{ code: "A1C", name: "A1c", observations: [{ loinc: "4548-4", name: "A1c", value: "5.0", units: "%", range: "", flag: "" }] }],
    });
    await expect(applyOru(t.db, t.practiceId, parseHl7(raw))).rejects.toThrow(/not the patient on order/);
    expect((await getLabOrder(t.db, t.practiceId, o.id))?.results).toEqual([]);
  });

  it("simulates a complete, labeled result once, and not for a cancelled order", async () => {
    const o = await order();
    const r = await simulateLabResult(t.db, t.practiceId, o.id, t.userId);
    expect(r.status).toBe("processed");
    const got = await getLabOrder(t.db, t.practiceId, o.id);
    expect(got?.order.status).toBe("resulted");
    expect(got?.order.fillerOrderNumber).toMatch(/^SIM-/);
    expect(got?.results).toHaveLength(15); // 14 CMP components + A1c
    await expect(simulateLabResult(t.db, t.practiceId, o.id)).rejects.toThrow(/already has results/);

    const other = await order();
    await cancelLabOrder(t.db, t.practiceId, other.id);
    await expect(simulateLabResult(t.db, t.practiceId, other.id)).rejects.toThrow(/cancelled/);
  });
});
