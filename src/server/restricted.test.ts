import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { breakGlass, GRANT_HOURS, restrictedAccess, setRestricted } from "./restricted";
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
});
