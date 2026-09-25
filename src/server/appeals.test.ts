import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { fillPlaceholders, PLACEHOLDERS, templateLetter, unknownPlaceholders } from "@/lib/appeals";
import { draftAppeal, getAppeal, markAppealSent, saveAppeal } from "./appeals";

describe("appeal templates", () => {
  it("every template uses only known placeholders", () => {
    for (const c of ["authorization", "medical_necessity", "coding", "eligibility", "timely_filing", "duplicate", "cob", "other"]) {
      expect(unknownPlaceholders(templateLetter(c))).toEqual([]);
    }
    expect(unknownPlaceholders("Dear {{PAYER_NAME}}, {{SSN}}")).toEqual(["SSN"]);
    expect(PLACEHOLDERS).toContain("PATIENT_NAME");
  });

  it("fills placeholders and leaves nothing unfilled", () => {
    expect(fillPlaceholders("{{PATIENT_NAME}} / {{PAYER_NAME}}", { PATIENT_NAME: "Ann Lee", PAYER_NAME: "Aetna" })).toBe("Ann Lee / Aetna");
  });
});

describe("appeal letters against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let denial: typeof schema.denials.$inferSelect;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    t = await testDb();
    [denial] = await t.db.select().from(schema.denials).where(eq(schema.denials.practiceId, t.practiceId)).limit(1);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await t?.close();
  });

  it("drafts a template letter filled with the claim's details when no AI key is set", async () => {
    const letter = await draftAppeal(t.db, t.practiceId, denial.id, t.userId);
    expect(letter.source).toBe("template");
    expect(letter.body).not.toMatch(/\{\{/);
    const d = await getAppeal(t.db, t.practiceId, denial.id);
    expect(letter.body).toContain(d.claim.controlNumber);
    expect(letter.body).toContain(d.patient.lastName);
    expect(letter.body).toContain(d.insurance.memberId);
    expect(letter.body).toContain(`CARC ${denial.carc}`);
  });

  it("will not open another practice's denial", async () => {
    await expect(getAppeal(t.db, "00000000-0000-0000-0000-000000000000", denial.id)).rejects.toThrow(/not found/);
  });

  it("saves edits and marking it sent moves the denial to appealed", async () => {
    const { letter } = await getAppeal(t.db, t.practiceId, denial.id);
    await saveAppeal(t.db, t.practiceId, letter!.id, "Edited letter");
    await expect(saveAppeal(t.db, t.practiceId, letter!.id, "   ")).rejects.toThrow(/empty/);
    await markAppealSent(t.db, t.practiceId, letter!.id, t.userId);
    const after = await getAppeal(t.db, t.practiceId, denial.id);
    expect(after.letter?.body).toBe("Edited letter");
    expect(after.letter?.status).toBe("sent");
    expect(after.denial.status).toBe("appealed");
    const events = await t.db.select().from(schema.claimEvents).where(eq(schema.claimEvents.claimId, denial.claimId));
    expect(events.some((e) => e.message?.includes("Appeal letter sent"))).toBe(true);
  });
});
