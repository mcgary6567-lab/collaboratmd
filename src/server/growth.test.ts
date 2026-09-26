import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { MockClearinghouse } from "@/lib/clearinghouse/gateway";
import { StediClearinghouse } from "@/lib/clearinghouse/stedi";
import { pollRemittances } from "./era-poll";
import { completeReset, readResetToken, requestReset } from "./password-reset";
import { listNotifications, markRead, notify, sendDigests, setDigest, unreadCount } from "./notifications";
import { credentialState, saveCredential } from "./credentials";
import { runDailyChecks } from "./daily-checks";
import { accessFor } from "@/lib/auth";

describe("Stedi transaction polling", () => {
  it("reads inbound 835s from the polling API and their raw X12 input artifact", async () => {
    const calls: string[] = [];
    const http = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(`${url} ${init.headers.Authorization ?? ""}`);
      const body = url.includes("/polling/transactions")
        ? { items: [
            { transactionId: "t-835", direction: "INBOUND", x12: { transactionSetIdentifier: "835" }, artifacts: [{ artifactType: "application/json", usage: "output", url: "https://core.test/out" }, { artifactType: "application/edi-x12", usage: "input", url: "https://core.test/t-835/input" }] },
            { transactionId: "t-277", direction: "INBOUND", x12: { transactionSetIdentifier: "277" }, artifacts: [] },
            { transactionId: "t-837", direction: "OUTBOUND", x12: { transactionSetIdentifier: "837" }, artifacts: [] },
          ], nextPageToken: "next-1" }
        : "ISA*00*...~";
      return { ok: true, status: 200, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
    };
    const page = await new StediClearinghouse("key-1", http).pollInbound(null, new Date("2026-09-01T00:00:00Z"));
    expect(calls[0]).toBe("https://core.us.stedi.com/2023-08-01/polling/transactions?startDateTime=2026-09-01T00%3A00%3A00.000Z&pageSize=100 key-1");
    expect(calls[1]).toBe("https://core.test/t-835/input key-1");
    expect(page).toEqual({ cursor: "next-1", items: [{ transactionId: "t-835", transactionSet: "835", x12: "ISA*00*...~" }, { transactionId: "t-277", transactionSet: "277", x12: null }] });
  });
});

describe("the growth round against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("imports and posts an 835 from polling once, and skips one for another practice", async () => {
    const [claim] = await t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.status, "accepted"))).limit(1);
    const [payer] = await t.db.select().from(schema.payers).where(eq(schema.payers.id, claim.payerId));
    const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.id, claim.patientInsuranceId));
    const lines = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, claim.encounterId));
    const x12 = (await new MockClearinghouse().fetch835([{ controlNumber: claim.controlNumber, payerName: payer.name, payerId: payer.payerId, memberId: ins.memberId, lines: lines.map((l) => ({ cpt: l.cpt, units: l.units, chargeCents: l.chargeCents * l.units })) }]))!;
    const foreign = (await new MockClearinghouse().fetch835([{ controlNumber: "NOT-OURS-1", payerName: payer.name, payerId: payer.payerId, memberId: "X1", lines: [{ cpt: "99213", units: 1, chargeCents: 10_000 }] }]))!;
    let served = false;
    const gateway = { pollInbound: async () => (served ? { items: [], cursor: "c2" } : ((served = true), { cursor: "c1", items: [{ transactionId: "tx-1", transactionSet: "835", x12 }, { transactionId: "tx-2", transactionSet: "835", x12: foreign }] })) };
    const r = await pollRemittances(t.db, t.practiceId, { gateway });
    expect(r).toMatchObject({ seen: 2, imported: 1, skipped: 1 });
    const [after] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, claim.id));
    expect(after.status).not.toBe("accepted");
    served = false;
    expect((await pollRemittances(t.db, t.practiceId, { gateway })).imported).toBe(0); // same transactions: not imported twice
    const [state] = await t.db.select().from(schema.clearinghousePolls).where(eq(schema.clearinghousePolls.practiceId, t.practiceId));
    expect(state).toMatchObject({ erasImported: 1, lastError: null });
    expect((await listNotifications(t.db, t.practiceId, t.userId, true)).some((n) => n.kind === "eras")).toBe(true);
  });

  it("emails a one-time reset link that ends other sessions and stops working once used", async () => {
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    const sent: string[] = [];
    const send = async (_to: string, _s: string, text: string) => { sent.push(text); return true; };
    expect(await requestReset(t.db, "nobody@example.org", "https://app.test", { send })).toBe("no_account");
    expect(await requestReset(t.db, user.email.toUpperCase(), "https://app.test", { send, now: new Date("2026-09-25T10:00:00Z") })).toBe("sent");
    expect(await requestReset(t.db, user.email, "https://app.test", { send, now: new Date("2026-09-25T10:02:00Z") })).toBe("throttled");
    const token = decodeURIComponent(sent[0].match(/reset\?token=(\S+)/)![1]);
    expect((await readResetToken(t.db, token))?.id).toBe(user.id);
    await expect(completeReset(t.db, token, "short")).rejects.toThrow(/12 characters/);
    await completeReset(t.db, token, "a brand new passphrase");
    expect(await readResetToken(t.db, token)).toBeNull();
    expect((await accessFor(t.db, user.id, t.practiceId))?.revokedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it("delivers notifications to one person or to administrators, once per dedupe key", async () => {
    const [other] = (await t.db.select().from(schema.users).where(eq(schema.users.practiceId, t.practiceId))).filter((u) => u.id !== t.userId && u.role !== "admin");
    await notify(t.db, t.practiceId, { kind: "x", title: "For admins", dedupeKey: "k1" });
    await notify(t.db, t.practiceId, { kind: "x", title: "For admins", dedupeKey: "k1" });
    await notify(t.db, t.practiceId, { userId: other.id, kind: "x", title: "For one person" });
    const adminList = await listNotifications(t.db, t.practiceId, t.userId, true);
    expect(adminList.filter((n) => n.title === "For admins")).toHaveLength(1);
    expect(adminList.some((n) => n.title === "For one person")).toBe(false);
    expect((await listNotifications(t.db, t.practiceId, other.id, false)).map((n) => n.title)).toEqual(["For one person"]);
    const before = await unreadCount(t.db, t.practiceId, other.id, false);
    await markRead(t.db, t.practiceId, other.id, false);
    expect(await unreadCount(t.db, t.practiceId, other.id, false)).toBe(before - 1);

    await setDigest(t.db, t.userId, true);
    const mails: { to: string; text: string }[] = [];
    const r = await sendDigests(t.db, t.practiceId, "https://app.test", async (to, _s, text) => { mails.push({ to, text }); return true; });
    expect(r.sent).toBe(1);
    expect(mails[0].text).toContain("For admins");
  });

  it("warns about expiring credentials and an overdue access review, once each", async () => {
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    await expect(saveCredential(t.db, t.practiceId, { providerId: provider.id, kind: "dea" })).rejects.toThrow(/expiry date/);
    await saveCredential(t.db, t.practiceId, { providerId: provider.id, kind: "state_license", state: "tx", identifier: "L123", expiresOn: "2026-10-20" }, t.userId);
    expect(credentialState("2026-10-20", "2026-09-25")).toBe("due");
    expect(credentialState("2026-09-01", "2026-09-25")).toBe("expired");
    const now = new Date("2026-09-25T12:00:00Z");
    const first = await runDailyChecks(t.db, t.practiceId, now);
    expect(first.credentials).toBeGreaterThanOrEqual(1);
    expect(first.accessReview).toBe(true);
    const count = (await listNotifications(t.db, t.practiceId, t.userId, true)).length;
    await runDailyChecks(t.db, t.practiceId, now);
    expect((await listNotifications(t.db, t.practiceId, t.userId, true)).length).toBe(count);
  });
});
