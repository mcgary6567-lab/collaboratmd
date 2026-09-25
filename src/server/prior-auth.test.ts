import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { build278, build278Response, parse278Request, parse278Response } from "@/lib/edi/x278";
import { tokenize } from "@/lib/edi/x12";
import { requestPriorAuth } from "./prior-auth";
import { clearConfigCache } from "./integrations";

const request = () => build278({
  senderId: "COLLABORATMD", receiverId: "60054", now: new Date("2026-09-25T10:00:00Z"), control: "123456789",
  payer: { name: "Aetna", payerId: "60054" },
  requester: { name: "Summit Health", npi: "1234567893", lastName: "Reyes", firstName: "Hannah" },
  subscriber: { lastName: "Nguyen", firstName: "Linh", memberId: "W123456789", dob: "1990-04-05", sex: "F" },
  event: { serviceFrom: "2026-10-01", serviceTo: "2026-10-31", placeOfService: "22", diagnoses: ["G43.909", "R51.9"], trace: "PATEST1" },
  services: [{ cpt: "70553", units: 1 }],
});

describe("X12 278", () => {
  it("builds a well-formed request with the member, event and service", () => {
    const edi = request();
    // Envelope: SE counts the segments from ST to SE, and the control numbers pair up.
    const { segments } = tokenize(edi);
    const st = segments.findIndex((x) => x[0] === "ST");
    const se = segments.findIndex((x) => x[0] === "SE");
    expect(Number(segments[se][1])).toBe(se - st + 1);
    expect(segments[se][2]).toBe(segments[st][2]);
    expect(segments.at(-1)![2]).toBe(segments[0][13]);
    expect(edi).toContain("ST*278*0001*005010X217~");
    expect(edi).toContain("UM*HS*I*3*22:B~");
    expect(edi).toContain("HI*ABK:G43909*ABF:R519~");
    expect(edi).toContain("SV1*HC:70553**UN*1~");
    expect(parse278Request(edi)).toMatchObject({ trace: "PATEST1", memberId: "W123456789", from: "2026-10-01", to: "2026-10-31", services: [{ cpt: "70553", units: 1 }] });
  });

  it("reads each payer decision, and rejections with their reason", () => {
    const req = parse278Request(request());
    const base = { senderId: "P", receiverId: "C", now: new Date("2026-09-25T10:00:00Z"), control: "1", request: req };
    const approved = parse278Response(build278Response({ ...base, action: "A1", authNumber: "PA7788", validFrom: "2026-10-01", validTo: "2026-12-30", units: 1 }));
    expect(approved).toMatchObject({ status: "approved", authNumber: "PA7788", validFrom: "2026-10-01", validTo: "2026-12-30", units: 1 });
    expect(parse278Response(build278Response({ ...base, action: "A4", authNumber: "REF1" }))).toMatchObject({ status: "pended", authNumber: "REF1" });
    expect(parse278Response(build278Response({ ...base, action: "A3" })).status).toBe("denied");
    expect(parse278Response(build278Response({ ...base, action: "NA" })).status).toBe("not_required");
    const rejected = parse278Response(build278Response({ ...base, action: "", reject: "72" }));
    expect(rejected).toMatchObject({ status: "error", actionLabel: "Invalid or missing member ID" });
  });
});

describe("prior authorization requests against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patient: typeof schema.patients.$inferSelect;
  let provider: typeof schema.providers.$inferSelect;
  beforeAll(async () => {
    t = await testDb();
    [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const [row] = await t.db.select({ p: schema.patients }).from(schema.patients).innerJoin(schema.patientInsurances, eq(schema.patientInsurances.patientId, schema.patients.id)).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    patient = row.p;
  });
  afterEach(() => { vi.unstubAllEnvs(); clearConfigCache(); });
  afterAll(async () => { await t?.close(); });

  it("validates the request before sending anything", async () => {
    await expect(requestPriorAuth(t.db, t.practiceId, { patientId: patient.id, providerId: provider.id, cpts: ["x"], diagnoses: ["G43.909"], units: 1, serviceFrom: "2026-10-01", serviceTo: "2026-10-01" })).rejects.toThrow(/procedure codes/);
    await expect(requestPriorAuth(t.db, t.practiceId, { patientId: patient.id, providerId: provider.id, cpts: ["70553"], diagnoses: [], units: 1, serviceFrom: "2026-10-01", serviceTo: "2026-10-01" })).rejects.toThrow(/diagnosis/);
    await expect(requestPriorAuth(t.db, "00000000-0000-0000-0000-000000000000", { patientId: patient.id, providerId: provider.id, cpts: ["70553"], diagnoses: ["G43.909"], units: 1, serviceFrom: "2026-10-01", serviceTo: "2026-10-01" })).rejects.toThrow(/insurance/);
  });

  it("records each answer; approvals go on file and pended requests become tasks", async () => {
    const statuses = new Set<string>();
    for (let i = 0; i < 12 && statuses.size < 3; i++) {
      const r = await requestPriorAuth(t.db, t.practiceId, { patientId: patient.id, providerId: provider.id, cpts: ["70553"], diagnoses: ["G43.909"], units: 1, serviceFrom: `2026-10-${String(1 + i).padStart(2, "0")}`, serviceTo: `2026-10-${String(1 + i).padStart(2, "0")}` }, t.userId);
      statuses.add(r.status);
      expect(r.request278).toContain("ST*278");
      if (r.status === "approved") {
        expect(r.authorizationId).toBeTruthy();
        const [auth] = await t.db.select().from(schema.authorizations).where(eq(schema.authorizations.id, r.authorizationId!));
        expect(auth).toMatchObject({ authNumber: r.authNumber, cpts: ["70553"], patientId: patient.id });
      }
      if (r.status === "pended") {
        const tasks = await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.entityId, patient.id), eq(schema.tasks.practiceId, t.practiceId)));
        expect(tasks.some((x) => x.title.includes("prior authorization"))).toBe(true);
      }
      await new Promise((res) => setTimeout(res, 5)); // a new trace per request
    }
    expect(statuses.has("approved")).toBe(true);
  });

  it("records a clear error when the clearinghouse cannot take a 278", async () => {
    vi.stubEnv("CLEARINGHOUSE", "stedi");
    vi.stubEnv("STEDI_API_KEY", "test-key");
    const r = await requestPriorAuth(t.db, t.practiceId, { patientId: patient.id, providerId: provider.id, cpts: ["70553"], diagnoses: ["G43.909"], units: 1, serviceFrom: "2026-11-01", serviceTo: "2026-11-01" });
    expect(r).toMatchObject({ status: "error", authorizationId: null });
    expect(r.message).toMatch(/not enabled for Stedi/);
  });
});
