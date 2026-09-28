import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clearConfigCache, saveIntegration } from "./integrations";
import { clockDay, practiceNow } from "./practice-time";
import { receiveSms } from "./sms-inbox";
import { addToWaitlist, listWaitlist, offerSlot } from "./waitlist";
import { sameDayReminders } from "./automation";
import { appointmentOutcomes } from "./appointment-outcomes";

type Sent = { to: string; body: string };

describe("filling a cancelled time from the waitlist", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let pats: (typeof schema.patients.$inferSelect)[];
  let providerId: string;
  let otherProviderId: string;
  const sent: Sent[] = [];
  const send = async (to: string, body: string) => {
    sent.push({ to, body });
    return { ok: true, detail: `sid SM${sent.length}` };
  };
  const phoneOf = (i: number) => `+1555010${String(2000 + i)}`;
  const text = (i: number, body: string) => receiveSms(t.db, t.practiceId, { From: phoneOf(i), Body: body, MessageSid: `SMin${Math.random()}` }, { send });

  beforeAll(async () => {
    t = await testDb();
    // Texting "connected" with test values; every text goes through `send` above, never to Twilio.
    await saveIntegration(t.db, t.practiceId, "twilio", { enabled: true, settings: { accountSid: "AC" + "a".repeat(32), from: "+15125550100" }, secrets: { authToken: "b".repeat(32) } });
    clearConfigCache();
    pats = (await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId))).slice(0, 6);
    for (const [i, p] of pats.entries()) await t.db.update(schema.patients).set({ phone: phoneOf(i), smsConsentAt: i === 4 ? null : new Date() }).where(eq(schema.patients.id, p.id));
    const [prov, other] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(2);
    otherProviderId = other.id;
    providerId = prov.id;
    // Nothing else of theirs in the coming week, so X and B act on the appointments made here.
    await t.db.update(schema.appointments).set({ status: "cancelled" }).where(eq(schema.appointments.practiceId, t.practiceId));
  });
  afterAll(async () => { await t?.close(); });

  const tomorrowAt = async (hour: number) => new Date(clockDay(await practiceNow(t.db, t.practiceId)).getTime() + (24 + hour) * 3_600_000);
  const book = async (patientIdx: number, startsAt: Date, withProvider = providerId) => {
    const [a] = await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: pats[patientIdx].id, providerId: withProvider, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), type: "office_visit" }).returning();
    return a;
  };

  it("offers the time a patient cancels by text to those who can take it, and books the first to reply B", async () => {
    const ten = await tomorrowAt(10);
    const cancelling = await book(0, ten);
    // 1, 2 and 3 are waiting; 4 has no texting consent; 5 is already booked at that time.
    for (const i of [1, 2, 3, 4, 5]) await addToWaitlist(t.db, t.practiceId, pats[i].id, { providerId: i === 3 ? providerId : null }, t.userId);
    await expect(addToWaitlist(t.db, t.practiceId, pats[1].id, {}, t.userId)).rejects.toThrow(/already on the waitlist/);
    await book(5, ten, otherProviderId); // with another provider: busy, but the opening is still free
    expect((await listWaitlist(t.db, t.practiceId)).find((w) => w.patient.id === pats[4].id)?.canText).toBe(false);

    const x = await text(0, "x");
    expect(x.reply?.text).toMatch(/cancelled/);
    const offers = sent.filter((m) => /Reply B to book it/.test(m.body));
    expect(offers.map((m) => m.to).sort()).toEqual([phoneOf(1), phoneOf(2), phoneOf(3)]);

    const won = await text(2, "B");
    expect(won.reply).toMatchObject({ status: "booked" });
    expect(won.reply?.text).toMatch(/you are booked/);
    const [booked] = await t.db.select().from(schema.appointments).where(and(eq(schema.appointments.patientId, pats[2].id), eq(schema.appointments.status, "scheduled")));
    expect(booked).toMatchObject({ providerId, confirmedVia: "sms", reason: "From the waitlist" });
    expect(booked.startsAt.getTime()).toBe(ten.getTime());
    expect((await listWaitlist(t.db, t.practiceId)).some((w) => w.patient.id === pats[2].id)).toBe(false);
    const [n] = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "waitlist_filled"));
    expect(n.title).toBe("A cancelled time was filled from the waitlist");

    const late = await text(1, "b");
    expect(late.reply).toMatchObject({ status: "taken" });
    expect(await t.db.select().from(schema.appointments).where(and(eq(schema.appointments.patientId, pats[1].id), eq(schema.appointments.status, "scheduled")))).toHaveLength(0);
    // Once per cancellation.
    expect((await offerSlot(t.db, t.practiceId, cancelling.id, { send })).status).toBe("already_offered");
    // B from someone with no offer is just a message in the inbox.
    expect((await text(4, "B")).reply).toBeNull();
  });

  it("does not offer a time too soon to reach, or one that was booked by hand meanwhile", async () => {
    const soon = new Date((await practiceNow(t.db, t.practiceId)).getTime() + 30 * 60_000);
    const a = await book(0, soon);
    await t.db.update(schema.appointments).set({ status: "cancelled" }).where(eq(schema.appointments.id, a.id));
    expect((await offerSlot(t.db, t.practiceId, a.id, { send })).status).toBe("too_soon");

    const later = await book(0, await tomorrowAt(15));
    await t.db.update(schema.appointments).set({ status: "cancelled" }).where(eq(schema.appointments.id, later.id));
    const offer = await offerSlot(t.db, t.practiceId, later.id, { send });
    expect(offer.status).toBe("offered");
    await book(5, await tomorrowAt(15)); // the front desk filled it by phone
    expect((await text(1, "B")).reply).toMatchObject({ status: "taken" });
  });

  it("texts the morning of the visit to patients who have not confirmed, once", async () => {
    // 13:00 UTC on Oct 6 is 9:00 in New York: a 14:00 visit is reminded; one at 9:30 is too close, and a confirmed one needs no reminder.
    const now = new Date("2026-10-06T13:00:00Z");
    const day = Date.UTC(2026, 9, 6);
    const due = await book(3, new Date(day + 14 * 3_600_000));
    await book(3, new Date(day + 9.5 * 3_600_000));
    const done = await book(1, new Date(day + 15 * 3_600_000));
    await t.db.update(schema.appointments).set({ confirmedAt: new Date(), confirmedVia: "sms" }).where(eq(schema.appointments.id, done.id));
    const before = sent.length;
    expect(await sameDayReminders(t.db, t.practiceId, now, { sms: send })).toEqual({ due: 1, sent: 1, skipped: 0 });
    expect(sent.slice(before).map((m) => m.to)).toEqual([phoneOf(3)]);
    expect(sent.at(-1)!.body).toMatch(/we expect you today, 2:00 PM\. Reply C to confirm or X/);
    expect((await sameDayReminders(t.db, t.practiceId, now, { sms: send })).sent).toBe(0);
    expect(due.id).toBeTruthy();
  });

  it("compares no-shows for patients who confirmed and who did not", async () => {
    const past = new Date((await practiceNow(t.db, t.practiceId)).getTime() - 5 * 86_400_000);
    for (const [status, confirmed] of [["completed", true], ["completed", true], ["no_show", true], ["no_show", false], ["no_show", false], ["completed", false]] as const) {
      const a = await book(1, past);
      await t.db.update(schema.appointments).set({ status, confirmedAt: confirmed ? past : null }).where(eq(schema.appointments.id, a.id));
    }
    const r = await appointmentOutcomes(t.db, t.practiceId, 30);
    const confirmed = r.rows.find((x) => x.group === "confirmed")!;
    const unconfirmed = r.rows.find((x) => x.group === "unconfirmed")!;
    expect(confirmed).toMatchObject({ noShows: 1 });
    expect(unconfirmed.noShows).toBeGreaterThanOrEqual(2);
    expect(confirmed.rate!).toBeLessThan(unconfirmed.rate!);
    expect(r.filled).toBe(1);
    expect(r.offered).toBe(2);
  });
});
