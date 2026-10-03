import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import {
  availability, decideTimeOff, hoursAndOutput, partWindow, requestTimeOff, saveShifts, setTimeZone, subtractWindows, type Shift,
} from "./shifts";
import { saveRule, applyRules } from "./work-rules";
import { assignableUsers } from "./work";
import { setMemberActive } from "./team";
import { leaveBalances, requestDays, saveLeave } from "./leave";
import { cancelOpenShift, claimOpenShift, decideOpenShift, postOpenShift } from "./open-shifts";
import { createWorkAudit, qualityByWorker, reviewWorkItem, sample, workAuditItemsFor } from "./work-quality";
import { recordTraining, trainingReminders, trainingState, trainingStatus } from "./staff-training";
import { saveTargets, targetAttainment, todayProgress } from "./targets";
import { hoursOnDate, staffingForecast } from "./staffing-forecast";

const at = (iso: string) => new Date(iso);
const weekdays = (startsAt: string, endsAt: string): Shift[] => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt, endsAt }));

describe("part days, sampling, training dates and forecast hours", () => {
  it("takes the morning, the afternoon or set hours out of a shift", () => {
    const night = weekdays("21:00", "06:00");
    // Monday March 3, 2031 in Manila: 21:00 to 06:00 is 13:00 to 22:00 UTC.
    const am = partWindow({ startsOn: "2031-03-03", part: "am", fromTime: null, toTime: null }, night, "Asia/Manila");
    const pm = partWindow({ startsOn: "2031-03-03", part: "pm", fromTime: null, toTime: null }, night, "Asia/Manila");
    expect([am.startsAt.toISOString(), am.endsAt.toISOString(), pm.endsAt.toISOString()]).toEqual(["2031-03-03T13:00:00.000Z", "2031-03-03T17:30:00.000Z", "2031-03-03T22:00:00.000Z"]);
    const hours = partWindow({ startsOn: "2031-03-03", part: "hours", fromTime: "23:00", toTime: "02:00" }, night, "Asia/Manila");
    expect([hours.startsAt.toISOString(), hours.endsAt.toISOString()]).toEqual(["2031-03-03T15:00:00.000Z", "2031-03-03T18:00:00.000Z"]);
    expect(subtractWindows([{ startsAt: at("2031-03-03T13:00:00Z"), endsAt: at("2031-03-03T22:00:00Z") }], [hours]).map((s) => s.endsAt.toISOString()))
      .toEqual(["2031-03-03T15:00:00.000Z", "2031-03-03T22:00:00.000Z"]);
  });

  it("counts part days in leave: half a day, or the share of that day's shift", () => {
    const night = weekdays("21:00", "06:00");
    expect(requestDays({ startsOn: "2031-03-03", endsOn: "2031-03-07" }, night, "Asia/Manila", [])).toBe(5);
    expect(requestDays({ startsOn: "2031-03-03", endsOn: "2031-03-03", part: "pm" }, night, "Asia/Manila", [])).toBe(0.5);
    expect(requestDays({ startsOn: "2031-03-03", endsOn: "2031-03-03", part: "hours", fromTime: "23:00", toTime: "02:00" }, night, "Asia/Manila", [])).toBe(0.33);
    expect(requestDays({ startsOn: "2031-03-08", endsOn: "2031-03-08", part: "am" }, night, "Asia/Manila", [])).toBe(0); // Saturday: no shift
    expect(requestDays({ startsOn: "2031-03-03", endsOn: "2031-03-03", part: "hours", fromTime: "09:00", toTime: "13:00" }, [], "UTC", [])).toBe(0.5); // 4 of 8 hours
  });

  it("samples without repeats, dates training and sums scheduled hours per day", () => {
    const picked = sample([1, 2, 3, 4, 5], 3, () => 0.5);
    expect(new Set(picked).size).toBe(3);
    expect(sample([1, 2], 5)).toHaveLength(2);
    expect([trainingState(null, "2031-01-01"), trainingState("2031-02-01", "2031-01-01"), trainingState("2030-12-31", "2031-01-01"), trainingState("2031-06-01", "2031-01-01")])
      .toEqual(["current", "expiring", "expired", "current"]);
    expect(hoursOnDate([{ startsAt: at("2031-03-03T22:00:00Z"), endsAt: at("2031-03-04T06:00:00Z") }], "2031-03-03", "UTC")).toBe(2);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let ana: typeof schema.users.$inferSelect;
  let ben: typeof schema.users.$inferSelect;
  let cleo: typeof schema.users.$inferSelect;
  beforeAll(async () => {
    t = await testDb();
    [ana, ben, cleo] = await t.db.insert(schema.users).values([
      { practiceId: t.practiceId, email: "ana.staff@example.test", passwordHash: "x", name: "Ana Leaving", role: "biller" },
      { practiceId: t.practiceId, email: "ben.staff@example.test", passwordHash: "x", name: "Ben Staying", role: "biller" },
      { practiceId: t.practiceId, email: "cleo.staff@example.test", passwordHash: "x", name: "Cleo Night", role: "biller" },
    ]).returning();
    await setTimeZone(t.db, t.practiceId, ben.id, "Asia/Karachi");
    await setTimeZone(t.db, t.practiceId, cleo.id, "Asia/Manila");
    await saveShifts(t.db, t.practiceId, ben.id, weekdays("09:00", "18:00"));
    await saveShifts(t.db, t.practiceId, cleo.id, weekdays("21:00", "06:00"));
  });
  afterAll(async () => { await t?.close(); });

  it("hands over a deactivated person's queues, tasks, requests and open clock, and keeps their hours", async () => {
    const now = at("2031-02-03T08:00:00Z");
    const shared = await saveRule(t.db, t.practiceId, { name: "Shared queue", kind: "denials", conditions: {}, assigneeIds: [ana.id, ben.id], slaDays: 2, priority: "normal" }, t.userId);
    const solo = await saveRule(t.db, t.practiceId, { name: "Ana's queue", kind: "denials", conditions: {}, assigneeIds: [ana.id], slaDays: 2, priority: "normal" }, t.userId);
    const [x, y] = await t.db.insert(schema.tasks).values([
      { practiceId: t.practiceId, title: "Work denial 1", assigneeId: ana.id, ruleId: shared.id, dueDate: "2031-02-05" },
      { practiceId: t.practiceId, title: "Work denial 2", assigneeId: ana.id, ruleId: solo.id, dueDate: "2031-02-05" },
    ]).returning();
    await t.db.insert(schema.timeEntries).values([
      { practiceId: t.practiceId, userId: ana.id, clockIn: at("2031-02-02T08:00:00Z"), clockOut: at("2031-02-02T12:00:00Z") },
      { practiceId: t.practiceId, userId: ana.id, clockIn: at("2031-02-03T06:00:00Z") },
    ]);
    const req = await requestTimeOff(t.db, t.practiceId, ana.id, { startsOn: "2031-03-02", endsOn: "2031-03-03", kind: "vacation" });

    const r = await setMemberActive(t.db, t.practiceId, ana.id, false, t.userId);
    expect(r).toMatchObject({ rules: 2, paused: 1, moved: 1, unassigned: 1, timeOff: 1, clockedOut: true });
    const rules = await t.db.select().from(schema.workRules).where(eq(schema.workRules.practiceId, t.practiceId));
    expect(rules.find((q) => q.id === shared.id)?.assigneeIds).toEqual([ben.id]);
    expect(rules.find((q) => q.id === solo.id)).toMatchObject({ assigneeIds: [], active: false });
    const [tx] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, x.id));
    const [ty] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, y.id));
    expect([tx.assigneeId, ty.assigneeId]).toEqual([ben.id, null]);
    expect((await t.db.select().from(schema.staffTimeOff).where(eq(schema.staffTimeOff.id, req.id)))[0].status).toBe("denied");
    expect(await t.db.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.userId, ana.id), isNotNull(schema.timeEntries.clockOut)))).toHaveLength(2);

    expect((await assignableUsers(t.db, t.practiceId)).map((u) => u.id)).not.toContain(ana.id);
    await applyRules(t.db, t.practiceId, { now });
    expect(await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.assigneeId, ana.id), eq(schema.tasks.status, "open")))).toHaveLength(0);
    // Past hours stay in the report, marked as a leaver.
    const report = await hoursAndOutput(t.db, t.practiceId, "2031-02-02", "2031-02-02", now);
    expect(report.find((p) => p.userId === ana.id)).toMatchObject({ hours: 4, active: false });
  });

  it("takes a part day out of the shift without moving the day's work, and counts half a day of leave", async () => {
    const now = at("2031-03-01T00:00:00Z");
    await saveLeave(t.db, t.practiceId, ben.id, "vacation", { daysPerYear: 12, accrual: "upfront", carryOver: 0 }, t.userId, now);
    // Monday March 3: morning off in Karachi (09:00 to 13:30 of a 09:00 to 18:00 shift).
    const req = await requestTimeOff(t.db, t.practiceId, ben.id, { startsOn: "2031-03-03", endsOn: "2031-03-03", kind: "vacation", part: "am" });
    await expect(requestTimeOff(t.db, t.practiceId, ben.id, { startsOn: "2031-03-03", endsOn: "2031-03-04", kind: "vacation", part: "pm" })).rejects.toThrow(/one day/);
    await expect(requestTimeOff(t.db, t.practiceId, ben.id, { startsOn: "2031-03-03", endsOn: "2031-03-03", kind: "vacation", part: "hours", fromTime: "9am" })).rejects.toThrow(/hours off/);
    expect(await decideTimeOff(t.db, t.practiceId, req.id, true, t.userId, now)).toBe(0);
    const morning = (await availability(t.db, [ben.id], at("2031-03-03T05:00:00Z"))).get(ben.id)!; // 10:00 Karachi
    const afternoon = (await availability(t.db, [ben.id], at("2031-03-03T10:00:00Z"))).get(ben.id)!; // 15:00 Karachi
    expect([morning.onShift, morning.offToday, morning.partOffToday, afternoon.onShift]).toEqual([false, false, "Morning", true]);
    expect((await leaveBalances(t.db, [ben.id], now)).get(ben.id)?.[0]).toMatchObject({ used: 0.5, balance: 11.5 });
  });

  it("posts an open shift that someone claims and an administrator confirms", async () => {
    const now = at("2031-04-01T00:00:00Z");
    await expect(postOpenShift(t.db, t.practiceId, t.userId, { date: "2031-03-01", from: "21:00", to: "06:00" }, "Asia/Manila", now)).rejects.toThrow(/future/);
    // Monday April 7, 21:00 to 06:00 Manila = 13:00 to 22:00 UTC; Ben (Karachi 09:00 to 18:00) is free then, Cleo is not.
    const s = await postOpenShift(t.db, t.practiceId, t.userId, { date: "2031-04-07", from: "21:00", to: "06:00", note: "Month-end denials" }, "Asia/Manila", now);
    expect([s.startsAt.toISOString(), s.endsAt.toISOString()]).toEqual(["2031-04-07T13:00:00.000Z", "2031-04-07T22:00:00.000Z"]);
    await expect(claimOpenShift(t.db, t.practiceId, s.id, cleo.id, now)).rejects.toThrow(/already work/);
    await claimOpenShift(t.db, t.practiceId, s.id, ben.id, now);
    await expect(claimOpenShift(t.db, t.practiceId, s.id, cleo.id, now)).rejects.toThrow(/already claimed/);
    await expect(decideOpenShift(t.db, t.practiceId, s.id, ben.id, true, now)).rejects.toThrow(/Another administrator/);
    await decideOpenShift(t.db, t.practiceId, s.id, t.userId, true, now);
    expect((await availability(t.db, [ben.id], at("2031-04-07T16:00:00Z"))).get(ben.id)?.onShift).toBe(true); // 21:00 Karachi
    await cancelOpenShift(t.db, t.practiceId, s.id, t.userId);
    expect((await availability(t.db, [ben.id], at("2031-04-07T16:00:00Z"))).get(ben.id)?.onShift).toBe(false);
  });

  it("samples billers' claims and postings, checked by someone else, into accuracy", async () => {
    const claims = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(3);
    const [patient] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    expect(claims.length).toBe(3);
    await t.db.insert(schema.auditLog).values(claims.map((c, i) => ({ practiceId: t.practiceId, userId: ben.id, action: "submit_claim", entity: "claim", entityId: c.id, at: at(`2031-05-0${i + 5}T10:00:00Z`) })));
    await t.db.insert(schema.ledgerEntries).values([
      { practiceId: t.practiceId, patientId: patient.id, type: "insurance_payment", amountCents: -5_000, postedBy: ben.id, postedAt: at("2031-05-06T10:00:00Z") },
      { practiceId: t.practiceId, patientId: patient.id, type: "adjustment", amountCents: -1_000, reasonCode: "45", postedBy: ben.id, postedAt: at("2031-05-06T11:00:00Z") },
      { practiceId: t.practiceId, patientId: patient.id, type: "charge", amountCents: 9_000, postedBy: ben.id, postedAt: at("2031-05-06T12:00:00Z") },
    ]);
    await expect(createWorkAudit(t.db, t.practiceId, t.userId, { from: "2031-05-01", to: "2031-05-31", perPerson: 0 })).rejects.toThrow(/1 to 50/);
    const { audit, items } = await createWorkAudit(t.db, t.practiceId, t.userId, { from: "2031-05-01", to: "2031-05-31", perPerson: 2 });
    expect(items).toBe(4); // 2 of Ben's 3 claims, both payment postings (the charge is not a posting)
    const list = await workAuditItemsFor(t.db, t.practiceId, audit.id);
    expect(list.filter((i) => i.kind === "posting").every((i) => /insurance payment|adjustment/.test(i.label))).toBe(true);
    await expect(reviewWorkItem(t.db, t.practiceId, list[0].id, ben.id, { result: "correct" })).rejects.toThrow(/Someone else/);
    const claim = list.find((i) => i.kind === "claim")!;
    await expect(reviewWorkItem(t.db, t.practiceId, claim.id, t.userId, { result: "error" })).rejects.toThrow(/what was wrong/);
    await reviewWorkItem(t.db, t.practiceId, claim.id, t.userId, { result: "error", finding: "codes", note: "Missing modifier 25" });
    for (const i of list.filter((x) => x.id !== claim.id)) await reviewWorkItem(t.db, t.practiceId, i.id, cleo.id, { result: "correct" });
    const q = (await qualityByWorker(t.db, t.practiceId, at("2000-01-01T00:00:00Z"))).find((w) => w.workerId === ben.id);
    expect(q).toMatchObject({ reviewed: 4, errors: 1, accuracy: 0.75, findings: { "Codes, modifiers or units wrong": 1 } });
  });

  it("records training, signed by the person or by an administrator, and reminds before it expires", async () => {
    const now = at("2031-12-01T12:00:00Z");
    const own = await recordTraining(t.db, t.practiceId, ben.id, false, { userId: ben.id, kind: "hipaa", completedOn: "2031-01-10" }, now);
    expect(own).toMatchObject({ name: "HIPAA training", expiresOn: "2032-01-10", attested: true });
    await expect(recordTraining(t.db, t.practiceId, ben.id, false, { userId: cleo.id, kind: "hipaa", completedOn: "2031-01-10" }, now)).rejects.toThrow(/your own/);
    await expect(recordTraining(t.db, t.practiceId, t.userId, true, { userId: cleo.id, kind: "certification", completedOn: "2031-01-10" }, now)).rejects.toThrow(/Name/);
    await recordTraining(t.db, t.practiceId, t.userId, true, { userId: cleo.id, kind: "certification", name: "CPC", completedOn: "2029-12-01", expiresOn: "2031-11-30", credentialNo: "AAPC-1" }, now);
    const status = await trainingStatus(t.db, t.practiceId, now);
    expect(status.find((p) => p.userId === ben.id)?.hipaaState).toBe("expiring");
    expect(status.find((p) => p.userId === cleo.id)).toMatchObject({ hipaaState: "missing", attention: [expect.objectContaining({ name: "CPC" })] });
    const first = await trainingReminders(t.db, t.practiceId, now);
    expect(first).toBeGreaterThanOrEqual(3);
    const count = (await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "training"))).length;
    await trainingReminders(t.db, t.practiceId, now);
    expect((await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "training"))).length).toBe(count);
  });

  it("tracks daily targets against the work done", async () => {
    await expect(saveTargets(t.db, t.practiceId, ben.id, { claims: 0 }, t.userId)).rejects.toThrow(/whole number/);
    await saveTargets(t.db, t.practiceId, ben.id, { claims: 2, postings: 4, tasks: null }, t.userId);
    // Ben sent a claim on May 5 and May 6 and posted two payments on May 6 (Karachi days).
    const progress = await todayProgress(t.db, t.practiceId, ben.id, at("2031-05-06T15:00:00Z"));
    expect(progress).toEqual([
      expect.objectContaining({ metric: "claims", target: 2, done: 1 }),
      expect.objectContaining({ metric: "postings", target: 4, done: 2 }),
    ]);
    await t.db.insert(schema.timeEntries).values([
      { practiceId: t.practiceId, userId: ben.id, clockIn: at("2031-05-05T04:00:00Z"), clockOut: at("2031-05-05T13:00:00Z") },
      { practiceId: t.practiceId, userId: ben.id, clockIn: at("2031-05-06T04:00:00Z"), clockOut: at("2031-05-06T13:00:00Z") },
    ]);
    const [b] = (await targetAttainment(t.db, t.practiceId, "2031-05-05", "2031-05-06", at("2031-05-10T00:00:00Z"))).filter((r) => r.userId === ben.id);
    expect(b.days).toBe(2);
    expect(b.metrics.find((m) => m.metric === "claims")).toMatchObject({ goal: 4, done: 2, pct: 0.5 });
  });

  it("forecasts each day's queue work against the hours on the schedule", async () => {
    const now = at("2031-07-01T00:00:00Z");
    const [rule] = await t.db.select().from(schema.workRules).where(eq(schema.workRules.practiceId, t.practiceId)).limit(1);
    // Two queue tasks on each of the last eight Mondays (UTC), finished in 16 clocked hours: 1 task an hour.
    const mondays = Array.from({ length: 8 }, (_, i) => new Date(Date.parse("2031-06-30T10:00:00Z") - i * 7 * 86_400_000)); // June 30 back to May 12
    await t.db.insert(schema.tasks).values(mondays.flatMap((m) => [0, 1].map(() => ({ practiceId: t.practiceId, title: "Queue work", ruleId: rule.id, assigneeId: ben.id, status: "done", createdAt: m, completedAt: m }))));
    await t.db.insert(schema.timeEntries).values({ practiceId: t.practiceId, userId: ben.id, clockIn: at("2031-06-02T00:00:00Z"), clockOut: at("2031-06-02T16:00:00Z") });
    const scheduled = [[{ startsAt: at("2031-07-07T09:00:00Z"), endsAt: at("2031-07-07T10:00:00Z") }]];
    const f = await staffingForecast(t.db, t.practiceId, "2031-07-07", "UTC", scheduled, now);
    const monday = f.days[0];
    expect(monday).toMatchObject({ date: "2031-07-07", expected: 2, scheduled: 1 });
    expect(f.pace).toBeGreaterThan(0);
    expect(monday.short).toBe(monday.needed! > 1);
    expect(f.days[1]).toMatchObject({ expected: 0, short: false });
  });
});
