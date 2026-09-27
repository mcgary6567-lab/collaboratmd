import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { appointmentReminder, bookingConfirmed, visitTime } from "@/lib/i18n/messages";
import { BOOKING_TEXT, bookingError } from "@/lib/i18n/booking";
import { STATEMENT_TEXT } from "@/lib/i18n/statement";
import { PATIENT_TEXT } from "@/lib/i18n/patient";
import { confirmRequest, requestBooking, saveBookingSettings, saveProviderHours } from "./booking";
import { rememberLanguage } from "./patient-language";

/** Every key present in English is present in Spanish, and no Spanish text is left empty. */
function sameShape(en: Record<string, unknown>, es: Record<string, unknown>) {
  expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  for (const [k, v] of Object.entries(es)) if (typeof v === "string") expect(v.trim(), k).not.toBe("");
}

describe("Spanish for patients", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("has every text in both languages", () => {
    sameShape(BOOKING_TEXT.en, BOOKING_TEXT.es);
    sameShape(STATEMENT_TEXT.en, STATEMENT_TEXT.es);
    sameShape(PATIENT_TEXT.en, PATIENT_TEXT.es);
    expect(bookingError("es", "Enter a valid email")).toBe("Escriba un correo electrónico válido");
    expect(bookingError("es", "Something new")).toBe("Something new");
    expect(bookingError("en", "Enter a valid email")).toBe("Enter a valid email");
  });

  it("writes appointment times as the clock time, in either language", () => {
    const d = new Date("2026-10-06T09:00:00.000Z");
    expect(visitTime("en", d)).toBe("Tuesday, October 6 at 9:00 AM");
    expect(visitTime("es", d)).toMatch(/^martes, 6 de octubre, 9:00/);
    const en = appointmentReminder("en", { name: "Clinic", phone: "555-0100" }, "Ana", visitTime("en", d), "https://x/c/1");
    expect(en.sms).toBe("Clinic: reminder of your appointment Tuesday, October 6 at 9:00 AM. Check in online: https://x/c/1 . Reply STOP to opt out.");
    const es = bookingConfirmed("es", { name: "Clínica" }, visitTime("es", d));
    expect(es.sms).toContain("su cita está confirmada");
    expect(es.sms).toContain("STOP");
  });

  it("books in Spanish: the patient gets their confirmation in Spanish, and keeps Spanish", async () => {
    const [prov] = await t.db.select({ id: schema.providers.id }).from(schema.providers).where(and(eq(schema.providers.practiceId, t.practiceId), eq(schema.providers.active, true))).limit(1);
    const now = new Date("2026-10-05T13:00:00Z");
    await saveBookingSettings(t.db, t.practiceId, { enabled: true, timeZone: "America/Chicago", slotMinutes: 30, minNoticeHours: 24, horizonDays: 7 });
    await saveProviderHours(t.db, t.practiceId, prov.id, [{ weekday: 2, start: "09:00", end: "11:00" }]);
    const req = await requestBooking(t.db, t.practiceId, { providerId: prov.id, startsAt: "2026-10-06T09:00:00.000Z", firstName: "Lucía", lastName: "Morales", dob: "1988-02-02", phone: "5550102222", smsConsent: true, language: "es" }, { now });
    expect(req.language).toBe("es");
    const r = await confirmRequest(t.db, t.practiceId, req.id, t.userId);
    const [appt] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.id, r.appointmentId));
    expect(bookingConfirmed("es", { name: "Clínica" }, visitTime("es", appt.startsAt)).sms).toContain("su cita está confirmada para el martes, 6 de octubre, 9:00");
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, r.patientId));
    expect(p.preferredLanguage).toBe("es");

    // Choosing a language on the patient pages only counts when they actually chose one.
    expect(await rememberLanguage(t.db, p.id, null)).toBe(false);
    expect(await rememberLanguage(t.db, p.id, "es")).toBe(false);
    expect(await rememberLanguage(t.db, p.id, "en")).toBe(true);
    const [after] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, p.id));
    expect(after.preferredLanguage).toBe("en");
  });
});
