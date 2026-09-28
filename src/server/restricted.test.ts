import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { breakGlass, GRANT_HOURS, recordRestrictedDisclosure, restrictedAccess, setRestricted } from "./restricted";
import { runReport } from "./report-builder";
import { getClaim, getPatient, listPatients } from "./public-api";
import { patientAccessLog } from "./access-log";

describe("restricted patients", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("asks for a reason, records it, tells the administrators, and opens the record for a few hours", async () => {
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    const who = { practiceId: t.practiceId, userId: t.userId };
    expect(await restrictedAccess(t.db, who, p.id)).toEqual({ restricted: false, granted: true });

    await setRestricted(t.db, t.practiceId, p.id, true, t.userId);
    const now = new Date();
    expect(await restrictedAccess(t.db, who, p.id, now)).toEqual({ restricted: true, granted: false });
    await expect(breakGlass(t.db, who, p.id, "need it")).rejects.toThrow(/few words/);
    await breakGlass(t.db, who, p.id, "Posting the payment the patient made by phone", now);
    expect(await restrictedAccess(t.db, who, p.id, new Date(now.getTime() + 60_000))).toEqual({ restricted: true, granted: true });
    expect((await restrictedAccess(t.db, who, p.id, new Date(now.getTime() + (GRANT_HOURS + 1) * 3_600_000))).granted).toBe(false);

    const [n] = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "restricted_record"));
    expect(n.title).toBe("A restricted patient record was opened");
    expect(`${n.title} ${n.body}`).not.toContain(p.lastName);
    const log = await patientAccessLog(t.db, t.practiceId, p.id);
    expect(log.entries.map((e) => e.what)).toContain("Opened the restricted record. Reason: Posting the payment the patient made by phone");
    expect(log.entries.map((e) => e.what)).toContain("Restricted the record");

    // Another person needs their own reason.
    const [other] = await t.db.insert(schema.users).values({ practiceId: t.practiceId, email: "other.biller@example.test", passwordHash: "x", name: "Other Biller", role: "biller" }).returning();
    expect((await restrictedAccess(t.db, { practiceId: t.practiceId, userId: other.id }, p.id)).granted).toBe(false);

    await setRestricted(t.db, t.practiceId, p.id, false, t.userId);
    expect((await restrictedAccess(t.db, { practiceId: t.practiceId, userId: other.id }, p.id)).granted).toBe(true);

    // Restricting again asks again, even of someone who gave a reason within the last few hours.
    await setRestricted(t.db, t.practiceId, p.id, true, t.userId);
    expect(await restrictedAccess(t.db, who, p.id)).toEqual({ restricted: true, granted: false });
    await breakGlass(t.db, who, p.id, "Answering the patient's question about a bill");
    expect((await restrictedAccess(t.db, who, p.id)).granted).toBe(true);
  });

  it("notes a restricted patient on exports that include them, and nobody else", async () => {
    const rows = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(3);
    const [restricted, other] = rows;
    await setRestricted(t.db, t.practiceId, restricted.id, true, t.userId);
    const before = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "restricted_record"));
    expect(await recordRestrictedDisclosure(t.db, t.practiceId, [restricted.id, other.id, restricted.id], { userId: t.userId }, "the claims export (CSV)")).toBe(1);
    expect(await recordRestrictedDisclosure(t.db, t.practiceId, [other.id], { userId: t.userId }, "the claims export (CSV)")).toBe(0);

    const log = await patientAccessLog(t.db, t.practiceId, restricted.id);
    expect(log.entries.map((e) => e.what)).toContain("Included in the claims export (CSV)");
    expect((await patientAccessLog(t.db, t.practiceId, other.id)).entries.map((e) => e.what)).not.toContain("Included in the claims export (CSV)");
    const after = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "restricted_record"));
    expect(after.length).toBe(before.length + 1);
    const n = after.find((x) => !before.some((b) => b.id === x.id))!;
    expect(`${n.title} ${n.body}`).not.toContain(restricted.lastName);

    // A report that names patients lists whose rows it holds; one grouped by payer names nobody.
    const named = await runReport(t.db, t.practiceId, "claims", { columns: ["claim", "patient"], range: "all" });
    expect(named.patientIds.length).toBeGreaterThan(0);
    expect(named.rows[0]).not.toHaveProperty("__patient");
    expect((await runReport(t.db, t.practiceId, "claims", { columns: ["claim", "billed"], range: "all" })).patientIds).toEqual([]);
    expect((await runReport(t.db, t.practiceId, "claims", { columns: ["patient"], group: "payer" })).patientIds).toEqual([]);
  });

  it("keeps restricted patients out of the API unless the key is allowed, and records what an allowed key reads", async () => {
    const [p] = await t.db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patients.restricted, true))).limit(1);
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.patientId, p.id)).limit(1);
    const plain = { restrictedAccess: false, keyName: "Billing sync" };
    const allowed = { restrictedAccess: true, keyName: "Chart archive" };

    const list = await listPatients(t.db, t.practiceId, new URLSearchParams({ limit: "200" }), plain);
    expect(list.data.find((x) => x.id === p.id)).toEqual({ id: p.id, restricted: true });
    const search = await listPatients(t.db, t.practiceId, new URLSearchParams({ q: p.lastName }), plain);
    expect(search.data.some((x) => x.id === p.id)).toBe(false);
    await expect(getPatient(t.db, t.practiceId, p.id, plain)).rejects.toMatchObject({ status: 403, code: "restricted" });
    if (claim) await expect(getClaim(t.db, t.practiceId, claim.id, plain)).rejects.toMatchObject({ status: 403, code: "restricted" });

    expect(await getPatient(t.db, t.practiceId, p.id, allowed)).toMatchObject({ id: p.id, last_name: p.lastName, restricted: true });
    const log = await patientAccessLog(t.db, t.practiceId, p.id);
    expect(log.entries.find((e) => e.what === "Included in a patient record read through the API")?.who).toBe('API key "Chart archive"');
  });
});
