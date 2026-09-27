import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { LEGAL_VERSIONS } from "@/content/legal";
import { pendingDocuments, recordAcceptance } from "./legal";
import { sendLifecycleEmails, sendWelcome } from "./lifecycle";
import { standing, handlePlatformEvent, GRACE_DAYS } from "./subscription";
import { cancelClosure, deletePracticeData, runScheduledClosures, scheduleClosure } from "./offboarding";

const DAY = 86_400_000;

describe("platform operations", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("asks for the current terms until they are accepted", async () => {
    expect(await pendingDocuments(t.db, t.practiceId, t.userId)).toEqual(["terms", "privacy"]);
    await recordAcceptance(t.db, { practiceId: t.practiceId, userId: t.userId, ip: "203.0.113.5" });
    expect(await pendingDocuments(t.db, t.practiceId, t.userId)).toEqual([]);
    const [row] = await t.db.select().from(schema.legalAcceptances).where(eq(schema.legalAcceptances.document, "terms"));
    expect(row.version).toBe(LEGAL_VERSIONS.terms);
    expect(row.ipHash).not.toContain("203.0.113");
  });

  it("sends each account email once, only when due, and retries when email was not delivered", async () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const [p] = await t.db.insert(schema.practices).values({ name: "Trial Clinic", taxId: "", npi: "", address1: "", city: "", state: "", zip: "", selfServe: true, subscriptionStatus: "trialing", trialEndsAt: new Date(now.getTime() + 2 * DAY), billingEmail: "owner@trial.test", createdAt: new Date(now.getTime() - 5 * DAY) }).returning();
    await t.db.insert(schema.users).values({ practiceId: p.id, email: "owner@trial.test", passwordHash: "x", name: "Owner", role: "admin" });
    const sent: string[] = [];
    const ok = async (to: string, subject: string) => { sent.push(`${to} | ${subject}`); return true; };
    const down = async () => false;

    expect(await sendWelcome(t.db, p.id, "https://app.test", down, now)).toBe(false);
    expect(await sendWelcome(t.db, p.id, "https://app.test", ok, now)).toBe(true);
    expect(await sendWelcome(t.db, p.id, "https://app.test", ok, now)).toBe(false);
    expect(await sendLifecycleEmails(t.db, "https://app.test", ok, now)).toBe(2);
    expect(sent).toEqual([
      "owner@trial.test | Welcome to CollaboratMD, Trial Clinic",
      "owner@trial.test | A few things left before Trial Clinic can send claims",
      "owner@trial.test | Your CollaboratMD trial ends in 2 days",
    ]);
    expect(await sendLifecycleEmails(t.db, "https://app.test", ok, now)).toBe(0);
    const after = new Date(now.getTime() + 3 * DAY);
    expect(await sendLifecycleEmails(t.db, "https://app.test", ok, after)).toBe(1);
    expect(sent.at(-1)).toBe("owner@trial.test | Your CollaboratMD trial has ended");
  });

  it("gives a failed payment a grace period before claims pause", async () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const base = { selfServe: true, subscriptionStatus: "past_due", plan: "essentials", stripeSubscriptionId: "sub_x", trialEndsAt: null };
    expect(standing({ ...base, pastDueSince: new Date(now.getTime() - 2 * DAY) }, now)).toMatchObject({ blocked: false, status: "past_due" });
    expect(standing({ ...base, pastDueSince: new Date(now.getTime() - (GRACE_DAYS + 1) * DAY) }, now)).toMatchObject({ blocked: true });

    const [p] = await t.db.insert(schema.practices).values({ name: "Paying Clinic", taxId: "", npi: "", address1: "", city: "", state: "", zip: "", selfServe: true, subscriptionStatus: "active", stripeSubscriptionId: "sub_pd" }).returning();
    const ev = (status: string) => ({ id: "e", type: "customer.subscription.updated", data: { object: { id: "sub_pd", status, customer: "cus_pd", metadata: { practice_id: p.id } } } }) as never;
    await handlePlatformEvent(t.db, ev("past_due"));
    const [a] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, p.id));
    expect(a.pastDueSince).toBeInstanceOf(Date);
    await handlePlatformEvent(t.db, ev("past_due"));
    const [b] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, p.id));
    expect(b.pastDueSince!.getTime()).toBe(a.pastDueSince!.getTime());
    await handlePlatformEvent(t.db, ev("active"));
    const [c] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, p.id));
    expect(c.pastDueSince).toBeNull();
  });

  it("closes a practice after notice, deleting every row it owns and keeping people who work elsewhere", async () => {
    const [other] = await t.db.insert(schema.practices).values({ name: "Neighbor Clinic", taxId: "", npi: "", address1: "", city: "", state: "", zip: "" }).returning();
    await t.db.insert(schema.patients).values({ practiceId: other.id, mrn: "N-1", firstName: "Keep", lastName: "Me", dob: "1970-01-01", sex: "F" });
    const [biller] = await t.db.select().from(schema.users).where(eq(schema.users.email, "biller@collaboratmd.local"));
    await t.db.insert(schema.practiceMemberships).values({ userId: biller.id, practiceId: other.id, role: "biller" });

    const [p] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, t.practiceId));
    await expect(scheduleClosure(t.db, t.practiceId, { confirmName: "wrong", userId: t.userId })).rejects.toThrow(/exactly/);
    const now = new Date("2026-10-01T00:00:00Z");
    const when = await scheduleClosure(t.db, t.practiceId, { confirmName: p.name, userId: t.userId }, now);
    expect(when.getTime() - now.getTime()).toBe(30 * DAY);
    await cancelClosure(t.db, t.practiceId, t.userId);
    await scheduleClosure(t.db, t.practiceId, { confirmName: p.name, userId: t.userId }, now);
    expect(await runScheduledClosures(t.db, new Date(now.getTime() + 29 * DAY))).toBe(0);
    expect(await runScheduledClosures(t.db, new Date(now.getTime() + 31 * DAY))).toBe(1);

    const { rows: tables } = await t.db.execute(sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'practice_id'`);
    // Everything goes except the record that the deletion happened.
    for (const { table_name } of (tables as { table_name: string }[]).filter((x) => x.table_name !== "practice_deletions")) {
      const { rows } = await t.db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${table_name}"`)} WHERE practice_id = ${t.practiceId}`);
      expect([table_name, (rows[0] as { n: number }).n]).toEqual([table_name, 0]);
    }
    expect(await t.db.select().from(schema.practices).where(eq(schema.practices.id, t.practiceId))).toHaveLength(0);
    expect(await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, other.id))).toHaveLength(1);
    const [moved] = await t.db.select().from(schema.users).where(eq(schema.users.id, biller.id));
    expect(moved.practiceId).toBe(other.id);
    expect(await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId))).toHaveLength(0);
    const [record] = await t.db.select().from(schema.practiceDeletions);
    expect(record).toMatchObject({ practiceId: t.practiceId, practiceName: p.name });
    expect(record.rowsDeleted).toBeGreaterThan(100);
    await expect(deletePracticeData(t.db, t.practiceId)).rejects.toThrow(/not found/);
  });
});
