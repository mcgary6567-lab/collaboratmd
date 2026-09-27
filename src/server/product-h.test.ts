import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clearConfigCache } from "./integrations";
import { addDirectoryPayer, searchPayerDirectory } from "./payer-directory";
import { listTemplates, saveTemplate } from "./import-templates";
import { mappingFromTemplate, matchingTemplate } from "@/lib/import/templates";
import { locationSummary } from "./location-report";
import { saveLocation } from "./locations";
import { guideFor } from "@/content/help";

describe("product round", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => { vi.unstubAllEnvs(); clearConfigCache(); });

  it("searches Stedi's payer directory and adds a payer with its enrollment needs", async () => {
    await expect(searchPayerDirectory(t.db, t.practiceId, "aetna")).rejects.toThrow(/Connect Stedi/);
    vi.stubEnv("CLEARINGHOUSE", "stedi");
    vi.stubEnv("STEDI_API_KEY", "test_stedi_key");
    clearConfigCache();
    const calls: string[] = [];
    const http = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(`${url} ${init.headers.Authorization}`);
      return { ok: true, status: 200, json: async () => ({ items: [{ score: 9, payer: { displayName: "Directory Health", primaryPayerId: "DIR01", stediId: "ABCDE", aliases: ["DH"], transactionSupport: { professionalClaimSubmission: "SUPPORTED", claimPayment: "ENROLLMENT_REQUIRED", eligibilityCheck: "SUPPORTED", electronicFundsTransfer: "NOT_SUPPORTED" } } }] }) };
    };
    const found = await searchPayerDirectory(t.db, t.practiceId, " directory ", http);
    expect(calls[0]).toBe("https://payers.us.stedi.com/2024-04-01/payers/search?query=directory&pageSize=15 test_stedi_key");
    expect(found[0]).toMatchObject({ name: "Directory Health", payerId: "DIR01", claims: "SUPPORTED", era: "ENROLLMENT_REQUIRED", eft: "NOT_SUPPORTED" });

    const r = await addDirectoryPayer(t.db, t.practiceId, { name: found[0].name, payerId: found[0].payerId, type: "commercial", support: { claims: found[0].claims, era: found[0].era, eligibility: found[0].eligibility, eft: found[0].eft } }, t.userId);
    const rows = await t.db.select().from(schema.transactionEnrollments).where(and(eq(schema.transactionEnrollments.practiceId, t.practiceId), eq(schema.transactionEnrollments.payerId, r.id)));
    expect(Object.fromEntries(rows.map((x) => [x.transaction, x.status]))).toEqual({ claims: "not_required", era: "not_started", eligibility: "not_required" });
    expect((await addDirectoryPayer(t.db, t.practiceId, { name: "Directory Health", payerId: "dir01", type: "commercial", support: {} })).existed).toBe(true);
  });

  it("saves an import mapping by header name and applies it to a file whose columns moved", async () => {
    await expect(saveTemplate(t.db, t.practiceId, "Old EHR", ["Name"], {})).rejects.toThrow(/date of birth/);
    await saveTemplate(t.db, t.practiceId, "Old EHR", ["Chart #", "Pt Last", "Pt First", "Birth Date"], { mrn: 0, lastName: 1, firstName: 2, dob: 3 }, t.userId);
    const [tpl] = await listTemplates(t.db, t.practiceId);
    expect(tpl.mapping).toEqual({ mrn: "Chart #", lastName: "Pt Last", firstName: "Pt First", dob: "Birth Date" });
    const moved = ["birth date", "Pt First", "Pt Last", "Extra", "Chart #"];
    expect(mappingFromTemplate(moved, tpl)).toEqual({ mapping: { mrn: 4, lastName: 2, firstName: 1, dob: 0 }, missing: [] });
    expect(matchingTemplate(moved, [tpl])?.t.name).toBe("Old EHR");
    expect(matchingTemplate(["Birth Date", "Last"], [tpl])).toBeNull();
  });

  it("totals each location, counting visits without one under the main office", async () => {
    const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.practiceId, t.practiceId)).limit(1);
    const loc = await saveLocation(t.db, t.practiceId, null, { name: "Eastside", address1: "9 East St", city: "Orlando", state: "FL", zip: "32803" });
    await t.db.update(schema.encounters).set({ locationId: loc.id }).where(eq(schema.encounters.id, enc.id));
    const rows = await locationSummary(t.db, t.practiceId, "2000-01-01", "2100-01-01");
    const east = rows.find((r) => r.name === "Eastside")!;
    const main = rows.find((r) => r.name === "Main office")!;
    expect(east.claims).toBeGreaterThanOrEqual(1);
    expect(east.visits).toBe(1);
    expect(main.claims).toBeGreaterThan(east.claims);
    expect(main.chargesCents).toBeGreaterThan(0);
    expect(main.denialRate).toBeGreaterThanOrEqual(0);
  });

  it("finds the most specific help guide for a page", () => {
    expect(guideFor("/settings/connections/doctor")?.title).toBe("Integration doctor");
    expect(guideFor("/settings/connections")?.title).toBe("Integrations");
    expect(guideFor("/settings/team")?.title).toBe("Settings");
    expect(guideFor("/claims/abc")?.title).toBe("Claims");
    expect(guideFor("/claimsx")).toBeNull();
  });
});
