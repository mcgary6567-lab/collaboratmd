import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { createEncounterWithClaim } from "./encounters";
import { getClaimFinancials } from "./claims";
import { editClaim } from "./claim-edit";
import { searchClaims, searchPatients } from "./lists";
import { addNote, assignMany, createTask, deleteView, listTasks, listViews, myTaskCounts, notesFor, openTaskCounts, saveView, setTaskStatus, tasksFor } from "./work";
import { setupSteps } from "./setup";

describe("work, lists and claim editing against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let claimId: string;
  let otherPracticeId: string;

  beforeAll(async () => {
    t = await testDb();
    const [row] = await t.db
      .select({ patient: schema.patients })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true)))
      .limit(1);
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, {
      patientId: row.patient.id, providerId: provider.id, dateOfService: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      placeOfService: "11", diagnoses: ["I10"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 12_000, dxPointers: [1] }],
    });
    claimId = claim.id;
    const [other] = await t.db.insert(schema.practices).values({ name: "Elsewhere", taxId: "22-2222222", npi: "2222222223", address1: "2 Elm", city: "Austin", state: "TX", zip: "78701" }).returning();
    otherPracticeId = other.id;
  });
  afterAll(async () => { await t?.close(); });

  it("assigns tasks, counts them for the bell, and closes them", async () => {
    const task = await createTask(t.db, t.practiceId, { title: "Call payer", entityType: "claim", entityId: claimId, assigneeId: t.userId, dueDate: "2020-01-01", priority: "high" }, t.userId);
    expect(await myTaskCounts(t.db, t.practiceId, t.userId)).toEqual({ open: 1, due: 1 });
    expect((await tasksFor(t.db, t.practiceId, "claim", claimId)).map((r) => r.task.id)).toEqual([task.id]);
    expect((await openTaskCounts(t.db, t.practiceId, "claim", [claimId])).get(claimId)).toBe(1);
    expect((await listTasks(t.db, t.practiceId, t.userId, "mine")).length).toBe(1);
    await setTaskStatus(t.db, t.practiceId, task.id, "done");
    expect(await myTaskCounts(t.db, t.practiceId, t.userId)).toEqual({ open: 0, due: 0 });
    expect((await listTasks(t.db, t.practiceId, t.userId, "done"))[0].task.completedAt).toBeTruthy();
  });

  it("refuses to point a task at another practice's record or assign an outsider", async () => {
    await expect(createTask(t.db, otherPracticeId, { title: "x", entityType: "claim", entityId: claimId })).rejects.toThrow(/not found/);
    const [outsider] = await t.db.insert(schema.users).values({ practiceId: otherPracticeId, email: "out@x.test", passwordHash: "x", name: "Outsider" }).returning();
    await expect(createTask(t.db, t.practiceId, { title: "x", assigneeId: outsider.id })).rejects.toThrow(/does not work in this practice/);
  });

  it("assigns many claims at once", async () => {
    const n = await assignMany(t.db, t.practiceId, "claim", [claimId, "00000000-0000-0000-0000-000000000000"], { assigneeId: t.userId, titleFor: (c) => `Work ${c}` }, t.userId);
    expect(n).toBe(1);
  });

  it("keeps notes and saved views", async () => {
    await addNote(t.db, t.practiceId, "claim", claimId, "Payer said resubmit with modifier 25", t.userId);
    expect((await notesFor(t.db, t.practiceId, "claim", claimId))[0].note.body).toMatch(/modifier 25/);
    await saveView(t.db, t.userId, t.practiceId, "claims", "My denials", "status=denied&page=3");
    const views = await listViews(t.db, t.userId, t.practiceId, "claims");
    expect(views[0]).toMatchObject({ name: "My denials", query: "status=denied" });
    await deleteView(t.db, t.userId, views[0].id);
    expect(await listViews(t.db, t.userId, t.practiceId, "claims")).toEqual([]);
  });

  it("searches, sorts and pages claims and patients in SQL", async () => {
    const all = await searchClaims(t.db, t.practiceId, { offset: 0, limit: 5 });
    expect(all.rows.length).toBeLessThanOrEqual(5);
    expect(all.total).toBeGreaterThan(5);
    const [c] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, claimId));
    const found = await searchClaims(t.db, t.practiceId, { q: c.controlNumber, offset: 0, limit: 10 });
    expect(found.rows.map((r) => r.claim.id)).toContain(claimId);
    const byAmount = await searchClaims(t.db, t.practiceId, { sort: "amount", dir: "desc", offset: 0, limit: 3 });
    expect(byAmount.rows[0].claim.totalCents).toBeGreaterThanOrEqual(byAmount.rows[2].claim.totalCents);
    expect((await searchClaims(t.db, t.practiceId, { q: "%", offset: 0, limit: 5 })).total).toBe(0); // % is literal, not a wildcard
    const pts = await searchPatients(t.db, t.practiceId, { offset: 0, limit: 10, sort: "name", dir: "asc" });
    expect(pts.total).toBeGreaterThan(0);
  });

  it("edits an unsubmitted claim, reversing old charges rather than rewriting them", async () => {
    const r = await editClaim(t.db, t.practiceId, claimId, {
      dateOfService: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10), placeOfService: "11", diagnoses: ["I10", "E11.9"],
      lines: [
        { cpt: "99214", modifiers: ["25"], units: 1, chargeCents: 18_000, dxPointers: [1, 2] },
        { cpt: "36415", modifiers: [], units: 1, chargeCents: 1_500, dxPointers: [2] },
      ],
    }, t.userId);
    expect(r.changes).toEqual(expect.arrayContaining([
      "Diagnoses I10 → I10, E11.9",
      "Line 1: 99213 x1 $120.00 → 99214-25 x1 $180.00 (pointers 1,2)",
      "Line 2 added: 36415 x1 $15.00",
    ]));
    expect(r.claim.totalCents).toBe(19_500);
    expect((await getClaimFinancials(t.db, claimId)).chargesCents).toBe(19_500);
    const charges = await t.db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.claimId, claimId), eq(schema.ledgerEntries.type, "charge")));
    expect(charges.map((e) => e.amountCents).sort((a, b) => a - b)).toEqual([-12_000, 1_500, 12_000, 18_000]);

    await expect(editClaim(t.db, t.practiceId, claimId, { dateOfService: "2026-01-01", placeOfService: "11", diagnoses: ["I10"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 100, dxPointers: [5] }] })).rejects.toThrow(/pointers/);
    await t.db.update(schema.claims).set({ status: "paid" }).where(eq(schema.claims.id, claimId));
    await expect(editClaim(t.db, t.practiceId, claimId, { dateOfService: "2026-01-01", placeOfService: "11", diagnoses: ["I10"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 100, dxPointers: [1] }] })).rejects.toThrow(/corrected claim/);
  });

  it("works out the setup checklist from the data", async () => {
    const steps = await setupSteps(t.db, t.practiceId);
    expect(steps.find((s) => s.key === "providers")?.done).toBe(true);
    expect(steps.find((s) => s.key === "clearinghouse")?.done).toBe(false);
    const empty = await setupSteps(t.db, otherPracticeId);
    expect(empty.find((s) => s.key === "patients")?.done).toBe(false);
  });
});
