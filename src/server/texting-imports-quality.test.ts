import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { numberKind, registrationAnswers, smsRegistrationStatus } from "./sms-registration";
import { deleteSharedTemplate, listTemplates, saveTemplate, shareTemplate } from "./import-templates";
import { measuresForClaim, parseMeasureCodes, qualifies, qualityReport, reportMeasure, saveMeasure } from "./quality";
import { receiveSms } from "./sms-inbox";
import { prefixQuery } from "./code-catalog";

describe("text message registration", () => {
  const twilio = { accountSid: "AC123", authToken: "tok", from: "(407) 555-0100" };
  /** A fake Twilio API answering the calls the check makes. */
  const api = (answers: Record<string, unknown>) => async (url: string) => {
    const key = Object.keys(answers).find((k) => url.includes(k));
    return { ok: !!key, status: key ? 200 : 404, json: async () => (key ? answers[key] : {}) };
  };

  it("tells local, toll-free and short-code senders apart", () => {
    expect(numberKind("+1 407 555 0100")).toBe("local");
    expect(numberKind("(833) 555-0100")).toBe("toll_free");
    expect(numberKind("55123")).toBe("short_code");
    expect(numberKind("MG0123456789abcdef0123456789abcdef")).toBe("service");
  });

  it("finds the number's campaign through its messaging service", async () => {
    const ok = await smsRegistrationStatus(twilio, api({
      "IncomingPhoneNumbers.json": { incoming_phone_numbers: [{ sid: "PN1" }] },
      "/v1/Services?": { services: [{ sid: "MG1" }] },
      "/Services/MG1/PhoneNumbers": { phone_numbers: [{ phone_number: "+14075550100", sid: "PN1" }] },
      "/Services/MG1/Compliance/Usa2p": { compliance: [{ campaign_status: "VERIFIED" }] },
    }));
    expect(ok).toMatchObject({ kind: "local", status: "approved" });
    const none = await smsRegistrationStatus(twilio, api({ "IncomingPhoneNumbers.json": { incoming_phone_numbers: [{ sid: "PN1" }] }, "/v1/Services?": { services: [] } }));
    expect(none.status).toBe("not_registered");
    const tf = await smsRegistrationStatus({ ...twilio, from: "8335550100" }, api({ "IncomingPhoneNumbers.json": { incoming_phone_numbers: [{ sid: "PN2" }] }, "Tollfree/Verifications": { verifications: [{ status: "PENDING_REVIEW" }] } }));
    expect(tf).toMatchObject({ kind: "toll_free", status: "pending" });
  });

  it("prepares the answers from the practice's details and the texts it really sends", () => {
    const a = registrationAnswers({ name: "Lakeside Family Medicine", taxId: "12-3456789", address1: "1 Main St", city: "Orlando", state: "FL", zip: "32801", phone: "(407) 555-0100" }, "https://app.test");
    expect(a.brand.find(([k]) => k === "EIN")?.[1]).toBe("12-3456789");
    expect(a.campaign.filter(([k]) => k.startsWith("Sample")).every(([, v]) => v.includes("Reply STOP"))).toBe(true);
  });
});

describe("the practice's texts and imports", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("answers HELP with who is texting and how to stop", async () => {
    const r = await receiveSms(t.db, t.practiceId, { From: "+14075559999", To: "+14075550100", Body: "HELP", MessageSid: "SMhelp1" });
    expect(r.stored && r.reply?.text).toMatch(/Reply STOP to opt out/);
  });

  it("shares a practice's saved mapping with every practice, and only the operator removes it", async () => {
    await saveTemplate(t.db, t.practiceId, "Our old system", ["Patient DOB", "Last", "First"], { dob: 0, lastName: 1, firstName: 2 });
    const [own] = (await listTemplates(t.db, t.practiceId)).filter((x) => !x.id.startsWith("shared:"));
    await shareTemplate(t.db, t.practiceId, own.id, "Example PM patient list", "ops@test");
    const [other] = (await t.db.execute<{ id: string }>(sql`SELECT id FROM practices WHERE id <> ${t.practiceId} LIMIT 1`)).rows;
    const theirs = await listTemplates(t.db, other?.id ?? t.practiceId);
    const shared = theirs.find((x) => x.id.startsWith("shared:"));
    expect(shared).toMatchObject({ name: "Example PM patient list (shared)", mapping: { dob: "Patient DOB" } });
    await deleteSharedTemplate(t.db, shared!.id);
    expect((await listTemplates(t.db, t.practiceId)).some((x) => x.id.startsWith("shared:"))).toBe(false);
  });
});

describe("quality measures (MIPS)", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("reads the quality codes and decides which visits qualify", () => {
    expect(parseMeasureCodes("G8752, met, Below 140\nG8753, not met, 140 or higher")).toHaveLength(2);
    expect(() => parseMeasureCodes("99213, met, x")).toThrow(/quality data code/);
    expect(() => parseMeasureCodes("G8752, maybe, x")).toThrow(/met, not met or excluded/);
    const m = { eligibleCodes: ["99213"], dxPrefixes: ["I10"], minAge: 18, maxAge: 85 };
    expect(qualifies(m, { dob: "1960-01-01", dateOfService: "2026-09-01", diagnoses: ["I10"], codes: ["99213"] })).toBe(true);
    expect(qualifies(m, { dob: "1960-01-01", dateOfService: "2026-09-01", diagnoses: ["E11.9"], codes: ["99213"] })).toBe(false);
    expect(qualifies(m, { dob: "2015-01-01", dateOfService: "2026-09-01", diagnoses: ["I10"], codes: ["99213"] })).toBe(false);
    expect(prefixQuery("back pa")).toBe("back:* & pa:*");
  });

  it("shows the measure on a qualifying claim, adds the chosen code at $0.00, and reports the rates", async () => {
    const [row] = await t.db.select({ claim: schema.claims, enc: schema.encounters }).from(schema.claims).innerJoin(schema.encounters, eq(schema.encounters.id, schema.claims.encounterId))
      .where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.status, "ready"), eq(schema.claims.claimType, "professional"))).limit(1);
    const lines = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, row.enc.id));
    const m = await saveMeasure(t.db, t.practiceId, null, { number: "236", title: "Controlling high blood pressure", eligibleCodes: lines[0].cpt, dxPrefixes: "", codes: "G8752, met, Below 140\nG8753, not met, 140 or higher" });
    const items = await measuresForClaim(t.db, t.practiceId, row.claim.id);
    expect(items.map((i) => i.measure.id)).toContain(m.id);
    await reportMeasure(t.db, t.practiceId, row.claim.id, m.id, "G8752");
    await reportMeasure(t.db, t.practiceId, row.claim.id, m.id, "G8753");
    const after = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, row.enc.id));
    expect(after.filter((l) => l.cpt.startsWith("G875"))).toMatchObject([{ cpt: "G8753", chargeCents: 0 }]);
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, row.claim.id));
    expect(claim.totalCents).toBe(row.claim.totalCents);
    expect(claim.scrubResults.map((f) => f.rule)).not.toContain("LINE_CHARGE");
    const year = row.enc.dateOfService.slice(0, 4);
    const [report] = await qualityReport(t.db, t.practiceId, `${year}-01-01`, `${year}-12-31`);
    expect(report.eligible).toBeGreaterThan(0);
    expect(report.notMet).toBeGreaterThanOrEqual(1);
    expect(report.performanceRate).toBe(report.met / (report.met + report.notMet));
  });
});
