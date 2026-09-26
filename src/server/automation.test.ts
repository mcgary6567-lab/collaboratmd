import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { csvCell, toCsv } from "@/lib/csv-out";
import { createAppointment } from "./encounters";
import { appointmentReminders, runDailyForPractice, weeklyReportText } from "./automation";

describe("CSV export encoding", () => {
  it("quotes where needed and defuses spreadsheet formulas", () => {
    expect(csvCell('Doe, "Jay"')).toBe('"Doe, ""Jay"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("daily automation against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let apptId: string;
  const sent: string[] = [];

  beforeAll(async () => {
    t = await testDb();
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    await t.db.update(schema.patients).set({ email: "patient@example.com" }).where(eq(schema.patients.id, p.id));
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const appt = await createAppointment(t.db, t.practiceId, { patientId: p.id, providerId: provider.id, startsAt: new Date(Date.now() + 26 * 3_600_000), minutes: 20, type: "office_visit" });
    apptId = appt.id;
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      sent.push(`${url} ${JSON.parse(init.body).to}`);
      return { ok: true, status: 200, text: async () => "{}" };
    });
  });
  afterAll(async () => {
    delete process.env.RESEND_API_KEY;
    vi.unstubAllGlobals();
    await t?.close();
  });

  it("reminds each appointment once, with a check-in link", async () => {
    const first = await appointmentReminders(t.db, t.practiceId, "https://site.test");
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(sent.some((s) => s.includes("patient@example.com"))).toBe(true);
    const [log] = await t.db.select().from(schema.messageLog).where(and(eq(schema.messageLog.kind, "appointment_reminder"), eq(schema.messageLog.entityId, apptId)));
    expect(log).toMatchObject({ channel: "email", status: "sent" });
    const [link] = await t.db.select().from(schema.checkinLinks).where(eq(schema.checkinLinks.appointmentId, apptId));
    expect(link).toBeTruthy();

    const before = sent.length;
    await appointmentReminders(t.db, t.practiceId, "https://site.test");
    expect(sent.filter((s) => s.includes("patient@example.com")).length).toBe(sent.slice(0, before).filter((s) => s.includes("patient@example.com")).length);
  });

  it("writes a weekly report and records each daily run, doing only what is switched on", async () => {
    const text = await weeklyReportText(t.db, t.practiceId);
    expect(text).toMatch(/Clean claim rate/);
    expect(text).toMatch(/Days in A\/R/);

    const off = await runDailyForPractice(t.db, t.practiceId, "https://site.test");
    expect(Object.keys(off)).toEqual(["planStatuses", "dailyChecks"]);
    await t.db.update(schema.practices).set({ automation: { claimFollowUp: true } }).where(eq(schema.practices.id, t.practiceId));
    const on = await runDailyForPractice(t.db, t.practiceId, "https://site.test");
    expect(Object.keys(on)).toEqual(["planStatuses", "claimFollowUp", "dailyChecks"]);
    const runs = await t.db.select().from(schema.automationRuns).where(eq(schema.automationRuns.practiceId, t.practiceId));
    expect(runs).toHaveLength(2);
  });
});
