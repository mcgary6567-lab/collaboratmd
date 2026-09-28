import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { receiveSms } from "./sms-inbox";
import { clockDay, practiceNow } from "./practice-time";

describe("confirming or cancelling an appointment by text", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patientId: string;
  let providerId: string;
  beforeAll(async () => {
    t = await testDb();
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    patientId = p.id;
    await t.db.update(schema.patients).set({ phone: "555-010-7788" }).where(eq(schema.patients.id, p.id));
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
  });
  afterAll(async () => { await t?.close(); });

  const tomorrowAt = async (hour: number) => new Date(clockDay(await practiceNow(t.db, t.practiceId)).getTime() + (24 + hour) * 3_600_000);
  const book = async (hour: number) => {
    const startsAt = await tomorrowAt(hour);
    const [a] = await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId, providerId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), type: "office_visit" }).returning();
    return a;
  };

  it("confirms the next appointment on C, and says so in the reply", async () => {
    await t.db.update(schema.appointments).set({ status: "cancelled" }).where(and(eq(schema.appointments.patientId, patientId), eq(schema.appointments.status, "scheduled")));
    const appt = await book(10);
    const r = await receiveSms(t.db, t.practiceId, { From: "+15550107788", Body: " c ", MessageSid: "SMc1" });
    expect(r.stored && r.reply?.answer).toBe("confirm");
    expect(r.stored && r.reply?.text).toMatch(/is confirmed/);
    const [after] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.id, appt.id));
    expect(after).toMatchObject({ status: "scheduled", confirmedVia: "sms" });
    expect(after.confirmedAt).toBeInstanceOf(Date);
  });

  it("cancels on X, tells the front desk without patient details, and replies in the patient's language", async () => {
    await t.db.update(schema.patients).set({ preferredLanguage: "es" }).where(eq(schema.patients.id, patientId));
    const [appt] = await t.db.select().from(schema.appointments).where(and(eq(schema.appointments.patientId, patientId), eq(schema.appointments.status, "scheduled")));
    const r = await receiveSms(t.db, t.practiceId, { From: "+15550107788", Body: "X", MessageSid: "SMx1" });
    expect(r.stored && r.reply?.answer).toBe("cancel");
    expect(r.stored && r.reply?.text).toMatch(/cancelamos su cita/);
    const [after] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.id, appt.id));
    expect(after.status).toBe("cancelled");
    const [n] = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "appointment_cancelled"));
    expect(n.title).toBe("An appointment was cancelled by text");
    const [me] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, patientId));
    expect(n.title + (n.body ?? "")).not.toContain(me.lastName);
    await t.db.update(schema.patients).set({ preferredLanguage: "en" }).where(eq(schema.patients.id, patientId));
  });

  it("leaves CANCEL to mean stop all texts, and answers nothing when there is no appointment", async () => {
    const none = await receiveSms(t.db, t.practiceId, { From: "+15550107788", Body: "C", MessageSid: "SMc2" });
    expect(none.stored && none.reply).toBeNull();
    await book(11);
    const stop = await receiveSms(t.db, t.practiceId, { From: "+15550107788", Body: "CANCEL", MessageSid: "SMs1" });
    expect(stop.stored && stop.keyword).toBe("stop");
    expect(stop.stored && stop.reply).toBeNull();
    const [still] = await t.db.select().from(schema.appointments).where(and(eq(schema.appointments.patientId, patientId), eq(schema.appointments.status, "scheduled")));
    expect(still).toBeTruthy();
  });
});
