import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { mapPatient, saveFhir, syncFhir } from "./fhir";
import { missedCharges } from "./recovery";

const BASE = "https://fhir.test/r4";

describe("FHIR import", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("maps FHIR patients", () => {
    expect(mapPatient({ resourceType: "Patient", id: "p", name: [{ use: "official", family: "Rivera", given: ["Ana", "M"] }], birthDate: "1980-02-03", gender: "female", telecom: [{ system: "phone", value: "555-010-1111" }], address: [{ line: ["1 Main St"], city: "Austin", state: "tx", postalCode: "78701" }] }))
      .toEqual({ firstName: "Ana", lastName: "Rivera", dob: "1980-02-03", sex: "F", phone: "555-010-1111", email: null, address1: "1 Main St", city: "Austin", state: "TX", zip: "78701" });
  });

  it("brings in patients and finished visits once, matched to providers by NPI, and they wait as missed charges", async () => {
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const start = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const calls: string[] = [];
    const resources: Record<string, unknown> = {
      "Patient?": { resourceType: "Bundle", entry: [
        { resource: { resourceType: "Patient", id: "fp1", name: [{ family: "Fhirson", given: ["Freda"] }], birthDate: "1970-07-07", gender: "female" } },
        { resource: { resourceType: "Patient", id: "fp-bad", name: [{ family: "NoBirth", given: ["X"] }] } },
      ], link: [{ relation: "next", url: `${BASE}/Patient?page=2` }] },
      "Patient?page=2": { resourceType: "Bundle", entry: [] },
      "Encounter?": { resourceType: "Bundle", entry: [
        { resource: { resourceType: "Encounter", id: "fe1", status: "finished", subject: { reference: "Patient/fp1" }, participant: [{ individual: { reference: "Practitioner/pr1" } }], period: { start }, reasonCode: [{ text: "Follow-up" }] } },
        { resource: { resourceType: "Encounter", id: "fe2", status: "finished", subject: { reference: "Patient/fp1" }, participant: [{ individual: { reference: "Practitioner/unknown" } }], period: { start } } },
        { resource: { resourceType: "Encounter", id: "fe3", status: "in-progress", subject: { reference: "Patient/fp1" }, period: { start } } },
      ] },
      "Practitioner/pr1": { resourceType: "Practitioner", id: "pr1", identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: provider.npi }] },
      "Practitioner/unknown": { resourceType: "Practitioner", id: "unknown", identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: "1999999992" }] },
    };
    const http = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(`${url.replace(BASE + "/", "")} ${init.headers.Authorization ?? ""}`);
      const path = url.replace(BASE + "/", "");
      const key = Object.keys(resources).find((k) => (k.endsWith("?") ? path.startsWith(k) && !path.includes("page=") : path === k));
      return { ok: !!key, status: key ? 200 : 404, json: async () => resources[key!] };
    };
    await expect(saveFhir(t.db, t.practiceId, { baseUrl: "http://insecure.test" })).rejects.toThrow(/https/);
    await saveFhir(t.db, t.practiceId, { baseUrl: BASE, token: "tok-123" }, t.userId);
    const r = await syncFhir(t.db, t.practiceId, { http });
    expect(r).toMatchObject({ patientsCreated: 1, visits: 1 });
    expect(r.skipped.some((x) => x.startsWith("Patient/fp-bad"))).toBe(true);
    expect(r.skipped.some((x) => x.startsWith("Encounter/fe2"))).toBe(true);
    expect(calls[0]).toMatch(/^Patient\?_lastUpdated=ge.* Bearer tok-123$/);
    const [p] = await t.db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patients.fhirId, "fp1")));
    expect(p).toMatchObject({ firstName: "Freda", lastName: "Fhirson", mrn: "FHIR-fp1" });
    const [visit] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.fhirId, "fe1"));
    expect(visit).toMatchObject({ status: "completed", providerId: provider.id, patientId: p.id, reason: "Follow-up" });
    expect((await missedCharges(t.db, t.practiceId)).some((m) => m.id === visit.id)).toBe(true);

    // Running again changes nothing.
    await t.db.update(schema.fhirConnections).set({ lastSyncAt: null }).where(eq(schema.fhirConnections.practiceId, t.practiceId));
    const again = await syncFhir(t.db, t.practiceId, { http });
    expect(again).toMatchObject({ patientsCreated: 0, visits: 0 });
  });

  it("refuses to follow a paging link to another host", async () => {
    const http = async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes("Patient?_lastUpdated") ? { resourceType: "Bundle", entry: [], link: [{ relation: "next", url: "https://evil.test/steal" }] } : { resourceType: "Bundle", entry: [] }) });
    await expect(syncFhir(t.db, t.practiceId, { http })).rejects.toThrow(/another host/);
  });
});
