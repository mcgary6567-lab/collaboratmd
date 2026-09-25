import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { authenticateApiKey, createApiKey, rateLimit, revokeApiKey } from "./api-keys";
import { createEncounterFromApi, createPatientFromApi, getClaim, getPatient, listClaims, listPatients } from "./public-api";
import { createEndpoint, deliverPending, emit, retryDelivery, sendTestEvent, signPayload, validateWebhookUrl, verifySignature } from "./webhooks";

type Sent = { url: string; headers: Record<string, string>; body: string };
function receiver(status: number, sent: Sent[] = []) {
  return async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: init.body });
    return { ok: status < 300, status, text: async () => (status < 300 ? "ok" : "receiver error") };
  };
}

describe("public API and webhooks against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let other: string;
  let provider: typeof schema.providers.$inferSelect;
  let payer: typeof schema.payers.$inferSelect;

  beforeAll(async () => {
    t = await testDb();
    [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    [payer] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.name, "Aetna"))).limit(1);
    const [p] = await t.db.insert(schema.practices).values({ name: "Elsewhere Clinic", taxId: "98-7654321", npi: "1234567893", address1: "9 Oak", city: "Dallas", state: "TX", zip: "75201" }).returning();
    other = p.id;
  });
  afterAll(async () => { await t?.close(); });

  describe("API keys", () => {
    it("authenticates by hash, knows its scope, and stops working when revoked", async () => {
      const { key, row } = await createApiKey(t.db, t.practiceId, "Partner", "read", t.userId);
      expect(key).toMatch(/^cmd_live_/);
      expect(row.keyHash).not.toContain(key);
      expect(await authenticateApiKey(t.db, `Bearer ${key}`)).toMatchObject({ practiceId: t.practiceId, scope: "read" });
      expect(await authenticateApiKey(t.db, `Bearer ${key}x`)).toBeNull();
      expect(await authenticateApiKey(t.db, "Bearer cmd_hl7_abc")).toBeNull();
      await revokeApiKey(t.db, t.practiceId, row.id);
      expect(await authenticateApiKey(t.db, `Bearer ${key}`)).toBeNull();
      await expect(createApiKey(t.db, t.practiceId, "  ", "read")).rejects.toThrow(/Name the key/);
    });

    it("rate-limits each key per minute", () => {
      const now = 1_000_000;
      for (let i = 0; i < 300; i++) expect(rateLimit("k1", now).ok).toBe(true);
      expect(rateLimit("k1", now).ok).toBe(false);
      expect(rateLimit("k1", now + 61_000).ok).toBe(true);
    });
  });

  describe("REST data layer", () => {
    let patientId: string;

    it("creates a patient with insurance and validates the body", async () => {
      await expect(createPatientFromApi(t.db, t.practiceId, { first_name: "A", last_name: "B", dob: "1990-13-45" })).rejects.toMatchObject({ status: 422 });
      await expect(createPatientFromApi(t.db, t.practiceId, { first_name: "A", last_name: "B", dob: "1990-01-02", insurance: { payer_code: "NOPE", member_id: "1" } })).rejects.toThrow(/payer/);
      const p = await createPatientFromApi(t.db, t.practiceId, {
        first_name: "Ada", last_name: "Apitest", dob: "1984-02-03", sex: "f", address: { line1: "1 Main", city: "Austin", state: "tx", zip: "78701" },
        insurance: { payer_code: payer.payerId, member_id: "API123", relationship: "self", copay_cents: 2500 },
      });
      patientId = p.id;
      expect(p).toMatchObject({ first_name: "Ada", sex: "F", address: { state: "TX" }, insurances: [{ payer_name: "Aetna", member_id: "API123", rank: 1 }] });
      const list = await listPatients(t.db, t.practiceId, new URLSearchParams({ q: "Apitest" }));
      expect(list.data.map((x) => x.id)).toEqual([p.id]);
    });

    it("keeps each practice's data to itself", async () => {
      await expect(getPatient(t.db, other, patientId)).rejects.toMatchObject({ status: 404 });
      expect((await listPatients(t.db, other, new URLSearchParams())).data).toEqual([]);
    });

    it("turns posted charges into a scrubbed claim priced from the fee schedule", async () => {
      await expect(createEncounterFromApi(t.db, t.practiceId, { patient_id: patientId, provider_npi: provider.npi, date_of_service: "2999-01-01", diagnoses: ["I10"], lines: [{ cpt: "99213" }] })).rejects.toThrow(/future/);
      await expect(createEncounterFromApi(t.db, other, { patient_id: patientId, provider_npi: provider.npi, date_of_service: "2026-09-01", diagnoses: ["I10"], lines: [{ cpt: "99213" }] })).rejects.toThrow(/not a patient/);
      const r = await createEncounterFromApi(t.db, t.practiceId, {
        patient_id: patientId, provider_npi: provider.npi, date_of_service: "2026-09-01", diagnoses: ["E11.9", "I10"],
        lines: [{ cpt: "99214", dx_pointers: [1, 2] }, { cpt: "36415", units: 1, dx_pointers: [1] }],
      });
      expect(r.claim.lines).toHaveLength(2);
      expect(r.claim.lines[0]).toMatchObject({ cpt: "99214", dx_pointers: [1, 2] });
      expect(r.claim.lines[0].charge_cents).toBeGreaterThan(0);
      expect(["ready", "scrub_errors"]).toContain(r.claim.status);
      expect(r.claim.financials.charges_cents).toBe(r.claim.total_cents);
      const listed = await listClaims(t.db, t.practiceId, new URLSearchParams({ patient_id: patientId }));
      expect(listed.data[0].id).toBe(r.claim.id);
      await expect(getClaim(t.db, other, r.claim.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("webhooks", () => {
    it("accepts only public https URLs", () => {
      expect(validateWebhookUrl("https://hooks.example.com/x")).toBe("https://hooks.example.com/x");
      for (const bad of ["http://hooks.example.com", "https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.0.5/x", "https://169.254.169.254/latest", "https://user:pw@example.com", "nonsense"]) {
        expect(() => validateWebhookUrl(bad)).toThrow();
      }
    });

    it("queues subscribed events, delivers them signed, and a receiver can verify the signature", async () => {
      const { endpoint, secret } = await createEndpoint(t.db, t.practiceId, { url: "https://hooks.example.com/cmd", events: ["claim.created", "patient.created"] }, t.userId);
      expect(secret).toMatch(/^whsec_/);
      expect(endpoint.secret).not.toContain(secret);
      await createEndpoint(t.db, other, { url: "https://other.example.com/cmd", events: ["patient.created"] });

      await createPatientFromApi(t.db, t.practiceId, { first_name: "Hook", last_name: "Test", dob: "1970-01-01", insurance: { payer_code: payer.payerId, member_id: "H1" } });
      expect(await emit(t.db, t.practiceId, "denial.created", { x: 1 })).toBe(0); // not subscribed

      const sent: Sent[] = [];
      const r = await deliverPending(t.db, { practiceId: t.practiceId, http: receiver(200, sent) });
      expect(r.delivered).toBe(1);
      expect(sent[0].url).toBe("https://hooks.example.com/cmd");
      expect(sent[0].headers["CollaboratMD-Event"]).toBe("patient.created");
      expect(JSON.parse(sent[0].body)).toMatchObject({ type: "patient.created", practice_id: t.practiceId, data: { source: "staff" } });
      expect(verifySignature(secret, sent[0].body, sent[0].headers["CollaboratMD-Signature"])).toBe(true);
      expect(verifySignature(secret, sent[0].body + " ", sent[0].headers["CollaboratMD-Signature"])).toBe(false);
      expect(verifySignature("whsec_wrong", sent[0].body, sent[0].headers["CollaboratMD-Signature"])).toBe(false);
      expect(verifySignature(secret, "{}", signPayload(secret, "{}", Math.floor(Date.now() / 1000) - 3600))).toBe(false); // too old
    });

    it("retries failures with backoff, gives up after the last attempt, and can be retried by hand", async () => {
      const { endpoint } = await createEndpoint(t.db, t.practiceId, { url: "https://down.example.com/cmd", events: ["claim.created"] });
      await emit(t.db, t.practiceId, "claim.created", { claim_id: "x" });
      let now = new Date();
      let r = await deliverPending(t.db, { practiceId: t.practiceId, http: receiver(500), now });
      expect(r.failed).toBeGreaterThanOrEqual(1);
      let [d] = await t.db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, endpoint.id));
      expect(d).toMatchObject({ status: "pending", attempts: 1, lastStatus: 500 });
      expect(d.nextAttemptAt.getTime() - now.getTime()).toBe(60_000);
      for (let i = 0; i < 7; i++) {
        now = new Date(now.getTime() + 25 * 3_600_000);
        await deliverPending(t.db, { practiceId: t.practiceId, http: receiver(500), now });
      }
      [d] = await t.db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, endpoint.id));
      expect(d).toMatchObject({ status: "failed", attempts: 8 });
      r = await retryDelivery(t.db, t.practiceId, d.id, receiver(204));
      expect(r.delivered).toBe(1);
      await expect(retryDelivery(t.db, other, d.id)).rejects.toThrow(/not found/);
    });

    it("sends a test ping to one endpoint on demand", async () => {
      const { endpoint } = await createEndpoint(t.db, t.practiceId, { url: "https://ping.example.com/cmd", events: ["payment.posted"] });
      const sent: Sent[] = [];
      const r = await sendTestEvent(t.db, t.practiceId, endpoint.id, receiver(200, sent));
      expect(r.last?.status).toBe("delivered");
      expect(sent.some((s) => s.url === "https://ping.example.com/cmd" && s.headers["CollaboratMD-Event"] === "ping")).toBe(true);
    });
  });
});
