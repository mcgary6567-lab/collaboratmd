import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { accessFor } from "@/lib/auth";
import type { ScrubFinding } from "@/lib/scrub/rules";
import { adjustSmallBalances, assertWriteOffAllowed, blocksSubmission, getPolicies, savePolicies, validatePolicies } from "./policies";
import { revokeAllSessions, revokeUserSessions, saveProfile, savePayer, saveProvider, setHiddenNav, setProviderActive } from "./admin";
import { patientBalanceCents } from "./billing";
import { listProviders } from "./encounters";
import { claimRisk } from "./risk";
import { rescrubClaim, submitClaim } from "./claims";
import { approveRefund, requestRefund } from "./recovery";

describe("policy rules", () => {
  it("validates bounds and keeps defaults", () => {
    expect(validatePolicies({})).toMatchObject({ writeOffLimitCents: null, strictScrub: false, statementMinCents: 500, statementIntervalDays: 25, smallBalanceAgeDays: 90 });
    expect(() => validatePolicies({ riskHoldScore: 150 })).toThrow(/1 to 100/);
    expect(() => validatePolicies({ statementIntervalDays: 3 })).toThrow(/7 to 90/);
    expect(() => validatePolicies({ smallBalanceCents: 50_000 })).toThrow(/small balance/);
  });

  it("makes warnings blocking only under strict scrubbing", () => {
    const warn: ScrubFinding[] = [{ rule: "X", severity: "warning", message: "w" }];
    expect(blocksSubmission(warn, {})).toBe(false);
    expect(blocksSubmission(warn, { strictScrub: true })).toBe(true);
    expect(blocksSubmission([{ rule: "E", severity: "error", message: "e" }], {})).toBe(true);
  });
});

describe("administration against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("records which policies changed, and limits write-offs for non-admins", async () => {
    await savePolicies(t.db, t.practiceId, { writeOffLimitCents: 50_000, refundDualControl: true }, t.userId);
    const [entry] = await t.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.practiceId, t.practiceId), eq(schema.auditLog.action, "policies_changed"))).orderBy(desc(schema.auditLog.at)).limit(1);
    expect((entry.details as { changed: string[] }).changed.sort()).toEqual(["refundDualControl", "writeOffLimitCents"]);
    await expect(assertWriteOffAllowed(t.db, t.practiceId, "biller", 50_001)).rejects.toThrow(/need an administrator/);
    await assertWriteOffAllowed(t.db, t.practiceId, "biller", 50_000);
    await assertWriteOffAllowed(t.db, t.practiceId, "admin", 10_000_000);
  });

  it("requires a second person to approve a refund under two-person control", async () => {
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    const owed = await patientBalanceCents(t.db, claim.patientId);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: claim.patientId, type: "patient_payment", amountCents: owed + 2_000 });
    const r = await requestRefund(t.db, t.practiceId, { payee: "patient", patientId: claim.patientId, amountCents: 2_000, reason: "Paid twice" }, t.userId);
    await expect(approveRefund(t.db, t.practiceId, r.id, t.userId)).rejects.toThrow(/someone other than/);
    const [other] = await t.db.select().from(schema.users).where(eq(schema.users.practiceId, t.practiceId)).then((us) => us.filter((u) => u.id !== t.userId));
    await approveRefund(t.db, t.practiceId, r.id, other.id);
  });

  it("adjusts off small, stale patient balances as discounts", async () => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: "SMALL1", firstName: "Tiny", lastName: "Balance", dob: "1970-01-01", sex: "F" }).returning();
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: p.id, type: "transfer_to_patient", amountCents: 350, postedAt: new Date("2025-01-01T00:00:00Z") });
    expect(await adjustSmallBalances(t.db, t.practiceId)).toEqual({ adjusted: 0, cents: 0 }); // policy off
    await savePolicies(t.db, t.practiceId, { ...(await getPolicies(t.db, t.practiceId)), smallBalanceCents: 500, smallBalanceAgeDays: 90 }, t.userId);
    const r = await adjustSmallBalances(t.db, t.practiceId, { now: new Date("2026-09-25T00:00:00Z") });
    expect(r.adjusted).toBeGreaterThanOrEqual(1);
    expect(await patientBalanceCents(t.db, p.id)).toBe(0);
  });

  it("holds risky claims for an administrator when a risk hold is set", async () => {
    const ready = await t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.status, "ready"))).limit(1);
    if (!ready.length) return;
    const claim = ready[0];
    const risk = await claimRisk(t.db, t.practiceId, claim.id);
    await savePolicies(t.db, t.practiceId, { ...(await getPolicies(t.db, t.practiceId)), riskHoldScore: Math.max(1, risk?.score ?? 0) }, t.userId);
    if ((risk?.score ?? 0) >= 1) await expect(submitClaim(t.db, claim.id, t.userId, { role: "biller" })).rejects.toThrow(/Held for review/);
    const sent = await submitClaim(t.db, claim.id, t.userId, { role: "admin" });
    expect(sent.status).not.toBe("ready");
    await savePolicies(t.db, t.practiceId, { ...(await getPolicies(t.db, t.practiceId)), riskHoldScore: null }, t.userId);
  });

  it("blocks warnings under strict scrubbing when a claim is rescrubbed", async () => {
    const all = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId));
    const withWarning = all.find((c) => (c.scrubResults ?? []).some((f) => f.severity === "warning") && !(c.scrubResults ?? []).some((f) => f.severity === "error") && ["ready", "scrub_errors"].includes(c.status));
    if (!withWarning) return;
    await savePolicies(t.db, t.practiceId, { ...(await getPolicies(t.db, t.practiceId)), strictScrub: true }, t.userId);
    expect((await rescrubClaim(t.db, withWarning.id)).status).toBe("scrub_errors");
    await savePolicies(t.db, t.practiceId, { ...(await getPolicies(t.db, t.practiceId)), strictScrub: false }, t.userId);
    expect((await rescrubClaim(t.db, withWarning.id)).status).toBe("ready");
  });

  it("validates the practice profile, providers and payers, and logs what changed", async () => {
    const base = { name: "Summit Health", npi: "1234567893", taxId: "12-3456789", address1: "1 Main St", city: "Dallas", state: "tx", zip: "75201", phone: "(555) 010-0100" };
    await expect(saveProfile(t.db, t.practiceId, { ...base, npi: "1234567890" }, t.userId)).rejects.toThrow(/check digit/);
    await expect(saveProfile(t.db, t.practiceId, { ...base, address1: "PO Box 12" }, t.userId)).rejects.toThrow(/PO box/);
    await saveProfile(t.db, t.practiceId, base, t.userId);
    const [log] = await t.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.practiceId, t.practiceId), eq(schema.auditLog.action, "practice_profile_changed"))).limit(1);
    expect(log.details).toHaveProperty("name");
    const [practice] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, t.practiceId));
    expect(practice.state).toBe("TX");

    await expect(saveProvider(t.db, t.practiceId, null, { firstName: "Ana", lastName: "Ruiz", npi: "1234567893", taxonomy: "207Q", specialty: "Family" })).rejects.toThrow(/taxonomy/);
    const id = await saveProvider(t.db, t.practiceId, null, { firstName: "Ana", lastName: "Ruiz", npi: "1245319599", taxonomy: "207q00000x", specialty: "Family medicine" }, t.userId);
    await expect(saveProvider(t.db, t.practiceId, null, { firstName: "B", lastName: "C", npi: "1245319599", taxonomy: "207Q00000X", specialty: "x" })).rejects.toThrow(/already has that NPI/);
    await setProviderActive(t.db, t.practiceId, id, false, t.userId);
    expect((await listProviders(t.db, t.practiceId)).some((p) => p.id === id)).toBe(false);
    expect((await listProviders(t.db, t.practiceId, true)).some((p) => p.id === id)).toBe(true);

    await expect(savePayer(t.db, t.practiceId, null, { name: "New Plan", payerId: "NP1", type: "commercial", timelyFilingDays: 10, appealDays: 60 })).rejects.toThrow(/Timely filing/);
    const payerId = await savePayer(t.db, t.practiceId, null, { name: "New Plan", payerId: "np01", type: "commercial", timelyFilingDays: 180, appealDays: 90 }, t.userId);
    const [payer] = await t.db.select().from(schema.payers).where(eq(schema.payers.id, payerId));
    expect(payer).toMatchObject({ payerId: "NP01", timelyFilingDays: 180 });
  });

  it("hides menu items except the fixed ones, and signs people out", async () => {
    expect(await setHiddenNav(t.db, t.practiceId, ["/encounters/dental", "/settings", "/not-a-page"], t.userId)).toEqual(["/encounters/dental"]);

    expect((await accessFor(t.db, t.userId, t.practiceId))?.revokedAt).toBeNull();
    await revokeUserSessions(t.db, t.practiceId, t.userId, t.userId);
    const user = (await accessFor(t.db, t.userId, t.practiceId))?.revokedAt ?? 0;
    expect(user).toBeGreaterThan(Date.now() - 60_000);
    await new Promise((r) => setTimeout(r, 5));
    await revokeAllSessions(t.db, t.practiceId, t.userId);
    expect((await accessFor(t.db, t.userId, t.practiceId))?.revokedAt).toBeGreaterThan(user);
  });
});
