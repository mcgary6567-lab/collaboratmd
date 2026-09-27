import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clearConfigCache } from "./integrations";
import { getStatement } from "./billing";
import { mailStatement, mailUnsentStatements, statementLetterHtml } from "./mail";

describe("mailing statements through Lob", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => { vi.unstubAllEnvs(); clearConfigCache(); });

  async function aStatement() {
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    await t.db.update(schema.patients).set({ address1: "12 Oak <St>", city: "Austin", state: "TX", zip: "78701" }).where(eq(schema.patients.id, p.id));
    const [st] = await t.db.insert(schema.statements).values({
      practiceId: t.practiceId, patientId: p.id, statementNumber: `S-${Math.random().toString(36).slice(2, 8)}`, statementDate: "2026-09-26", dueDate: "2026-10-16",
      chargesCents: 20000, insurancePaidCents: 12000, adjustmentsCents: 3000, patientPaidCents: 0, amountDueCents: 5000,
      detail: { visits: [{ claimId: null, dateOfService: "2026-09-01", provider: "Dr. A", services: [{ cpt: "99213", description: "Office visit" }], chargesCents: 20000, insurancePaidCents: 12000, adjustmentsCents: 3000, patientPaidCents: 0, youOweCents: 5000 }], unappliedPaymentsCents: 0, discountsCents: 0 },
    }).returning();
    return st;
  }

  it("writes escaped, compact HTML", async () => {
    const st = await aStatement();
    const html = statementLetterHtml((await getStatement(t.db, t.practiceId, st.id))!);
    expect(html).toContain("$50.00");
    expect(html).toContain("Office visit");
    expect(html).not.toContain("<St>");
    expect(html.length).toBeLessThan(10_000);
  });

  it("writes the letter in the patient's language", async () => {
    const st = await aStatement();
    await t.db.update(schema.patients).set({ preferredLanguage: "es" }).where(eq(schema.patients.id, st.patientId));
    const html = statementLetterHtml((await getStatement(t.db, t.practiceId, st.id))!);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("Monto a pagar");
    expect(html).toContain("Pagado por su seguro");
    expect(html).not.toContain("Amount due");
    await t.db.update(schema.patients).set({ preferredLanguage: "en" }).where(eq(schema.patients.id, st.patientId));
  });

  it("needs Lob, sends one letter per statement with an idempotency key, and records it", async () => {
    const st = await aStatement();
    await expect(mailStatement(t.db, t.practiceId, st.id)).rejects.toThrow(/Connect Lob/);
    vi.stubEnv("LOB_API_KEY", "test_abcdefghijklmnop");
    clearConfigCache();
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const http = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ id: "ltr_123", expected_delivery_date: "2026-10-01" }) };
    };
    const r = await mailStatement(t.db, t.practiceId, st.id, { http });
    expect(r).toEqual({ lobId: "ltr_123", expectedDelivery: "2026-10-01", test: true });
    expect(calls[0].url).toBe("https://api.lob.com/v1/letters");
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("test_abcdefghijklmnop:").toString("base64")}`);
    expect(calls[0].headers["Idempotency-Key"]).toBe(`statement-${st.id}`);
    expect(calls[0].body).toMatchObject({ use_type: "operational", address_placement: "insert_blank_page", color: false, to: { address_line1: "12 Oak <St>", address_state: "TX", address_zip: "78701" } });
    const [row] = await t.db.select().from(schema.statements).where(eq(schema.statements.id, st.id));
    expect(row).toMatchObject({ status: "sent", channel: "mail", mailId: "ltr_123", mailStatus: "test" });
    await expect(mailStatement(t.db, t.practiceId, st.id, { http })).rejects.toThrow(/already mailed/);
  });

  it("mails the unsent batch, skipping incomplete addresses and reporting Lob's refusals", async () => {
    vi.stubEnv("LOB_API_KEY", "test_abcdefghijklmnop");
    clearConfigCache();
    await t.db.update(schema.statements).set({ status: "void" }).where(and(eq(schema.statements.practiceId, t.practiceId), eq(schema.statements.status, "generated")));
    const good = await aStatement();
    const [other] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).offset(1).limit(1);
    await t.db.update(schema.patients).set({ address1: null }).where(eq(schema.patients.id, other.id));
    await t.db.insert(schema.statements).values({ ...(({ id: _id, createdAt: _c, ...rest }) => rest)(good), patientId: other.id, statementNumber: "S-noaddr", mailId: null, status: "generated", channel: null, sentAt: null });
    let n = 0;
    const http = async () => ({ ok: n++ === 0 ? false : true, status: 422, json: async () => ({ error: { message: "address_zip is invalid" } }) });
    const r = await mailUnsentStatements(t.db, t.practiceId, { http });
    expect(r).toEqual({ mailed: 0, skipped: 1, failed: ["Lob refused the letter: address_zip is invalid"] });
  });
});
