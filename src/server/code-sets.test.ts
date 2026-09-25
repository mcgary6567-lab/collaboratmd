import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { codeSetFindings, importCodeSet, isPlatformOperator, parseMue, parsePtp } from "./code-sets";
import { adoptSuggestion, dismissSuggestion, suggestRules } from "./rule-suggestions";

// Synthetic codes throughout: these fixtures are shaped like CMS files but are not real edits.
const PTP = [
  "CPT codes, descriptions, and other data only are copyright 2025 American Medical Association.",
  "",
  "Column 1\tColumn 2\t*=in existence prior to 1996\tEffective Date\tDeletion Date *=no data\tModifier 0=not allowed 1=allowed 9=not applicable\tPTP Edit Rationale",
  "11111\t22222\t\t20250101\t*\t1\tStandards of medical/surgical services",
  "11111\t33333\t\t20250101\t*\t0\tMutually exclusive procedures",
  "11111\t44444\t\t20200101\t20240101\t0\tDeleted pair",
  "bad row",
].join("\n");
const MUE = [
  "HCPCS/CPT Code,Practitioner Services MUE Values,MUE Adjudication Indicator,MUE Rationale",
  "55555,2,2 Date of Service Edit: Policy,Nature of service",
  "66666,1,1 Line Edit,Anatomic",
].join("\n");
const COVERAGE = "policy_id,title,hcpcs,icd10\nA99999,Sample coverage article,77777,E11.9\nA99999,Sample coverage article,77777,E10\n";

describe("CMS file parsing", () => {
  it("finds the header below CMS's title lines and reads each field", () => {
    const p = parsePtp(PTP);
    expect(p.rows).toEqual([
      { column1: "11111", column2: "22222", effective: "2025-01-01", deletion: null, modifierIndicator: "1", rationale: "Standards of medical/surgical services" },
      { column1: "11111", column2: "33333", effective: "2025-01-01", deletion: null, modifierIndicator: "0", rationale: "Mutually exclusive procedures" },
      { column1: "11111", column2: "44444", effective: "2020-01-01", deletion: "2024-01-01", modifierIndicator: "0", rationale: "Deleted pair" },
    ]);
    expect(p.skipped).toBe(1);
    expect(parseMue(MUE).rows).toEqual([
      { code: "55555", maxUnits: 2, adjudicationIndicator: "2", rationale: "Nature of service" },
      { code: "66666", maxUnits: 1, adjudicationIndicator: "1", rationale: "Anatomic" },
    ]);
    expect(() => parsePtp("a,b\n1,2")).toThrow(/Not an NCCI PTP file/);
  });

  it("only lets named platform operators load national data", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "ops@example.com, Second@Example.com");
    expect(isPlatformOperator("second@example.com")).toBe(true);
    expect(isPlatformOperator("admin@practice.com")).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("code-set checks and learned rules against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => {
    t = await testDb();
    await importCodeSet(t.db, "ncci_ptp", PTP, "fixture", "test");
    await importCodeSet(t.db, "ncci_mue", MUE, "fixture", "test");
    await importCodeSet(t.db, "coverage", COVERAGE, "fixture", "test");
  });
  afterAll(async () => { await t?.close(); });

  const line = (lineNumber: number, cpt: string, units = 1, modifiers: string[] = []) => ({ lineNumber, cpt, modifiers, units });

  it("flags bundled pairs, respecting modifiers, dates and payer type", async () => {
    const base = { payerType: "medicare", dateOfService: "2026-09-01", diagnoses: ["E11.9"] };
    let f = await codeSetFindings(t.db, { ...base, lines: [line(1, "11111"), line(2, "22222")] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: "NCCI_PTP", severity: "error" });
    expect(f[0].message).toMatch(/22222.*bundled into 11111/);
    expect(await codeSetFindings(t.db, { ...base, lines: [line(1, "11111"), line(2, "22222", 1, ["59"])] })).toEqual([]);
    f = await codeSetFindings(t.db, { ...base, lines: [line(1, "11111"), line(2, "33333", 1, ["59"])] });
    expect(f[0].message).toMatch(/no modifier can override/);
    expect(await codeSetFindings(t.db, { ...base, lines: [line(1, "11111"), line(2, "44444")] })).toEqual([]); // deleted in 2024
    f = await codeSetFindings(t.db, { ...base, payerType: "commercial", lines: [line(1, "11111"), line(2, "22222")] });
    expect(f[0].severity).toBe("warning");
  });

  it("enforces unit limits per day or per line", async () => {
    const base = { payerType: "medicaid", dateOfService: "2026-09-01", diagnoses: ["E11.9"] };
    expect(await codeSetFindings(t.db, { ...base, lines: [line(1, "55555", 1), line(2, "55555", 1)] })).toEqual([]);
    const f = await codeSetFindings(t.db, { ...base, lines: [line(1, "55555", 2), line(2, "55555", 1)] });
    expect(f[0]).toMatchObject({ rule: "NCCI_MUE", severity: "error" });
    expect(f[0].message).toMatch(/2 units per day; this claim has 3/);
    expect(await codeSetFindings(t.db, { ...base, lines: [line(1, "66666", 1), line(2, "66666", 1)] })).toEqual([]); // per-line limit
  });

  it("warns on Medicare claims without a covered diagnosis", async () => {
    const miss = await codeSetFindings(t.db, { payerType: "medicare", dateOfService: "2026-09-01", diagnoses: ["I10"], lines: [line(1, "77777")] });
    expect(miss[0]).toMatchObject({ rule: "MEDICARE_COVERAGE", severity: "warning" });
    expect(await codeSetFindings(t.db, { payerType: "medicare", dateOfService: "2026-09-01", diagnoses: ["E10.65"], lines: [line(1, "77777")] })).toEqual([]); // prefix E10 covers E10.65
    expect(await codeSetFindings(t.db, { payerType: "commercial", dateOfService: "2026-09-01", diagnoses: ["I10"], lines: [line(1, "77777")] })).toEqual([]);
  });

  it("suggests a payer rule from repeated denials, and adopting or dismissing clears it", async () => {
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.id, claim.encounterId));
    const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.id, claim.patientInsuranceId));
    for (let i = 0; i < 3; i++) {
      const [e] = await t.db.insert(schema.encounters).values({ practiceId: t.practiceId, patientId: claim.patientId, providerId: enc.providerId, dateOfService: `2026-08-0${i + 1}`, diagnoses: ["M54.50"] }).returning();
      await t.db.insert(schema.charges).values({ encounterId: e.id, lineNumber: 1, cpt: "88888", chargeCents: 50_000 });
      const [c] = await t.db.insert(schema.claims).values({ practiceId: t.practiceId, encounterId: e.id, patientId: claim.patientId, payerId: claim.payerId, patientInsuranceId: ins.id, controlNumber: `SUGG${i}`, totalCents: 50_000, status: "denied" }).returning();
      await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: c.id, category: "authorization", carc: "197", amountCents: 50_000 });
    }
    const s = (await suggestRules(t.db, t.practiceId)).find((x) => x.cpt === "88888")!;
    expect(s).toMatchObject({ kind: "auth_required", denials: 3, deniedCents: 150_000, carcs: ["197"] });
    await adoptSuggestion(t.db, t.practiceId, s.key, t.userId);
    const edits = await t.db.select().from(schema.payerEdits).where(and(eq(schema.payerEdits.practiceId, t.practiceId), eq(schema.payerEdits.cpt, "88888")));
    expect(edits[0]).toMatchObject({ kind: "auth_required", payerId: claim.payerId });
    expect((await suggestRules(t.db, t.practiceId)).some((x) => x.cpt === "88888")).toBe(false);
    await expect(adoptSuggestion(t.db, t.practiceId, s.key)).rejects.toThrow(/no longer current/);
    await dismissSuggestion(t.db, t.practiceId, "any|key|x");
  });
});
