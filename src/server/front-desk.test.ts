import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { build270, parse270 } from "@/lib/edi/x270";
import { cleanCardFields } from "@/lib/ai/insurance-card";
import type { IntegrationConfig } from "./integrations";
import { addDiscoveredCoverage, addInsurance, discoverCoverage, matchPayer, selfPayCandidates } from "./coverage";
import { listThreads, openThread, receiveSms, replySms, twilioSignature, verifyTwilioSignature } from "./sms-inbox";

describe("Twilio request signatures", () => {
  it("signs the URL followed by the parameters sorted by name", () => {
    const params = { To: "+15550100", From: "+15550199", Body: "hi" };
    const expected = crypto.createHmac("sha1", "tok").update("https://x.test/api/twilio/sms/p" + "Body" + "hi" + "From" + "+15550199" + "To" + "+15550100").digest("base64");
    expect(twilioSignature("tok", "https://x.test/api/twilio/sms/p", params)).toBe(expected);
    expect(verifyTwilioSignature("tok", "https://x.test/api/twilio/sms/p", params, expected)).toBe(true);
    expect(verifyTwilioSignature("tok", "https://x.test/api/twilio/sms/p", { ...params, Body: "HI" }, expected)).toBe(false);
    expect(verifyTwilioSignature("other", "https://x.test/api/twilio/sms/p", params, expected)).toBe(false);
    expect(verifyTwilioSignature("tok", "https://x.test/api/twilio/sms/p", params, null)).toBe(false);
  });
});

describe("insurance cards and payer matching", () => {
  it("keeps only known card fields and matches the printed payer to one on file", () => {
    expect(cleanCardFields({ memberId: " W123 ", groupNumber: "null", payerName: "Aetna", extra: "x", rxBin: 610014 })).toMatchObject({ memberId: "W123", groupNumber: null, payerName: "Aetna", rxBin: null });
    const payers = [{ id: "a", name: "Aetna" }, { id: "b", name: "Blue Cross Blue Shield of Texas" }, { id: "u", name: "UnitedHealthcare" }];
    expect(matchPayer("BlueCross BlueShield of Texas", payers)).toBe("b");
    expect(matchPayer("Molina Healthcare of Texas", payers)).toBe(null); // sharing only a state is not a match
    expect(matchPayer("Blue Cross and Blue Shield of Texas", payers)).toBe("b");
    expect(matchPayer("aetna open access", payers)).toBe("a");
    expect(matchPayer("Acme Health Plan", payers)).toBe(null);
  });

  it("builds a name and date-of-birth search when there is no member ID", () => {
    const edi = build270({ senderId: "S", receiverId: "R", now: new Date("2026-09-25T12:00:00Z"), control: "1", traceNumber: "T1", payer: { name: "P", payerId: "P1" }, provider: { name: "Prac", npi: "1234567893" }, subscriber: { lastName: "Doe", firstName: "Jane", memberId: "", dob: "1980-02-03" }, serviceDate: "2026-09-25" });
    expect(edi).toMatch(/NM1\*IL\*1\*Doe\*Jane~/);
    expect(parse270(edi)).toMatchObject({ memberId: "", lastName: "Doe", dob: "1980-02-03" });
  });
});

describe("texting inbox and coverage against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patientId: string;
  const cfg = { twilio: { accountSid: "AC1", authToken: "tok", from: "+15550100" } } as unknown as IntegrationConfig;
  const sent: string[] = [];
  const send = async (_t: unknown, to: string, body: string) => { sent.push(`${to}:${body}`); return { ok: true, detail: `sid SM${sent.length}` }; };

  beforeAll(async () => {
    t = await testDb();
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: "TXT1", firstName: "Rosa", lastName: "Textwell", dob: "1975-05-05", sex: "F", phone: "(555) 010-4477" }).returning();
    patientId = p.id;
  });
  afterAll(async () => { await t?.close(); });

  it("threads an inbound text under the patient and ignores Twilio's retries", async () => {
    const r = await receiveSms(t.db, t.practiceId, { From: "+15550104477", Body: "Can I pay next week?", MessageSid: "SMin1" });
    expect(r).toMatchObject({ stored: true, patientId, matches: 1, keyword: null });
    expect((await receiveSms(t.db, t.practiceId, { From: "+15550104477", Body: "Can I pay next week?", MessageSid: "SMin1" })).stored).toBe(false);
    const thread = (await listThreads(t.db, t.practiceId)).find((x) => x.phone === "+15550104477")!;
    expect(thread).toMatchObject({ patientId, patientName: "Textwell, Rosa", unread: 1 });
    await openThread(t.db, t.practiceId, "+15550104477");
    expect((await listThreads(t.db, t.practiceId)).find((x) => x.phone === "+15550104477")!.unread).toBe(0);
  });

  it("answers a patient who wrote in, and honors STOP and START", async () => {
    await replySms(t.db, t.practiceId, cfg, "+15550104477", "Yes, a plan is fine.", t.userId, send);
    expect(sent.at(-1)).toBe("+15550104477:Yes, a plan is fine.");

    await receiveSms(t.db, t.practiceId, { From: "+15550104477", Body: "Stop", MessageSid: "SMin2" });
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, patientId));
    expect(p.smsConsentAt).toBeNull();
    await expect(replySms(t.db, t.practiceId, cfg, "+15550104477", "Hello?", t.userId, send)).rejects.toThrow(/replied STOP/);

    const r = await receiveSms(t.db, t.practiceId, { From: "+15550104477", Body: "START", MessageSid: "SMin3" });
    expect(r).toMatchObject({ keyword: "start" });
    const [again] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, patientId));
    expect(again.smsConsentAt).toBeInstanceOf(Date);
    await replySms(t.db, t.practiceId, cfg, "+15550104477", "Welcome back.", t.userId, send);
    expect((await openThread(t.db, t.practiceId, "+15550104477")).messages.map((m) => m.direction)).toEqual(["in", "out", "in", "in", "out"]);
  });

  it("will not start a conversation without consent", async () => {
    await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: "TXT2", firstName: "Sam", lastName: "Quiet", dob: "1970-01-01", sex: "M", phone: "555-010-9911" });
    await expect(replySms(t.db, t.practiceId, cfg, "5550109911", "Hi", t.userId, send)).rejects.toThrow(/No texting consent/);
  });

  it("adds insurance, finds coverage by name and birth date, and adds what it finds", async () => {
    const payers = await t.db.select().from(schema.payers).where(eq(schema.payers.practiceId, t.practiceId));
    expect((await selfPayCandidates(t.db, t.practiceId)).some((c) => c.id === patientId)).toBe(true);

    // The simulated payer finds about one person in six per payer, deterministically by name and birth date.
    let found = null as Awaited<ReturnType<typeof discoverCoverage>>[number] | null;
    let pid = patientId;
    for (let i = 0; i < 12 && !found; i++) {
      if (i > 0) [{ id: pid }] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: `DISC${i}`, firstName: `Test${i}`, lastName: "Discovery", dob: `1960-0${(i % 9) + 1}-1${i % 9}`, sex: "U" }).returning();
      const results = await discoverCoverage(t.db, t.practiceId, pid, t.userId, "2026-09-25");
      expect(results.length).toBe(Math.min(15, payers.filter((p) => p.type !== "self_pay").length));
      found = results.find((r) => r.status === "found") ?? null;
      if (!found) expect(results.every((r) => r.status === "not_found")).toBe(true);
    }
    expect(found?.memberId).toMatch(/^SIM\d{9}$/);
    const ins = await addDiscoveredCoverage(t.db, t.practiceId, found!.id, t.userId);
    expect(ins).toMatchObject({ patientId: pid, memberId: found!.memberId, rank: 1 });
    await expect(addDiscoveredCoverage(t.db, t.practiceId, found!.id)).rejects.toThrow(/Already added/);
    expect((await selfPayCandidates(t.db, t.practiceId)).some((c) => c.id === pid)).toBe(false);

    // A second policy goes behind it, unless it is made primary.
    const other = payers.find((p) => p.id !== found!.payerId && p.type !== "self_pay")!;
    const second = await addInsurance(t.db, t.practiceId, pid, { payerId: other.id, memberId: "abc123" });
    expect(second).toMatchObject({ rank: 2, memberId: "ABC123" });
    await expect(addInsurance(t.db, t.practiceId, pid, { payerId: other.id, memberId: "ABC123" })).rejects.toThrow(/already on file/);
    const third = payers.find((p) => ![found!.payerId, other.id].includes(p.id) && p.type !== "self_pay")!;
    await addInsurance(t.db, t.practiceId, pid, { payerId: third.id, memberId: "NEWPRIMARY", makePrimary: true });
    const ranks = await t.db.select().from(schema.patientInsurances).where(and(eq(schema.patientInsurances.patientId, pid), eq(schema.patientInsurances.active, true)));
    expect(Object.fromEntries(ranks.map((r) => [r.memberId, r.rank]))).toEqual({ NEWPRIMARY: 1, [found!.memberId!]: 2, ABC123: 3 });
  });
});
