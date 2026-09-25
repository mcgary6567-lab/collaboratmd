import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { loadClaimBundle, scrubBundle } from "./claims";
import { alertsFor, enrollmentAlerts, enrollmentFinding, enrollmentGrid, saveEnrollment, type Enrollment } from "./enrollment";

const row = (o: Partial<Enrollment>): Enrollment => ({
  id: "e1", practiceId: "p", providerId: "pr", payerId: "pa", status: "approved", payerProviderId: null,
  submittedOn: null, effectiveOn: "2026-01-01", revalidationDue: null, notes: null, updatedAt: new Date(), ...o,
});

describe("enrollment rules", () => {
  it("alerts on revalidation within 90 days, overdue, and stalled applications", () => {
    const today = "2026-09-24";
    expect(alertsFor([row({ revalidationDue: "2026-11-01" })], today)[0]).toMatchObject({ kind: "revalidation_due", message: expect.stringMatching(/38 days/) });
    expect(alertsFor([row({ revalidationDue: "2026-09-20" })], today)[0].kind).toBe("revalidation_overdue");
    expect(alertsFor([row({ revalidationDue: "2027-06-01" })], today)).toEqual([]);
    expect(alertsFor([row({ status: "submitted", submittedOn: "2026-05-01", effectiveOn: null })], today)[0].kind).toBe("stalled");
    expect(alertsFor([row({ status: "submitted", submittedOn: "2026-08-01", effectiveOn: null })], today)).toEqual([]);
  });

  it("warns the scrubber only about tracked pairs that cannot bill on the date", () => {
    expect(enrollmentFinding(null, "2026-09-01", "Dr. A", "Aetna")).toBeNull();
    expect(enrollmentFinding(row({}), "2026-09-01", "Dr. A", "Aetna")).toBeNull();
    expect(enrollmentFinding(row({ status: "in_process" }), "2026-09-01", "Dr. A", "Aetna")?.message).toMatch(/not approved.*in process/);
    expect(enrollmentFinding(row({ effectiveOn: "2026-10-01" }), "2026-09-01", "Dr. A", "Aetna")?.message).toMatch(/starts 2026-10-01/);
  });
});

describe("enrollment against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("saves, updates in place, and feeds the scrubber", async () => {
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    const b = (await loadClaimBundle(t.db, claim.id))!;
    await expect(saveEnrollment(t.db, t.practiceId, { providerId: b.provider.id, payerId: b.payer.id, status: "approved" })).rejects.toThrow(/effective date/);
    await expect(saveEnrollment(t.db, t.practiceId, { providerId: b.provider.id, payerId: b.payer.id, status: "bogus" })).rejects.toThrow(/Unknown/);
    await expect(saveEnrollment(t.db, t.practiceId, { providerId: "00000000-0000-0000-0000-000000000000", payerId: b.payer.id, status: "submitted" })).rejects.toThrow(/not found/);

    await saveEnrollment(t.db, t.practiceId, { providerId: b.provider.id, payerId: b.payer.id, status: "in_process", submittedOn: "2026-01-02" }, t.userId);
    let findings = (await scrubBundle(t.db, b)).findings;
    expect(findings.find((f) => f.rule === "provider_enrollment")?.severity).toBe("warning");

    const saved = await saveEnrollment(t.db, t.practiceId, { providerId: b.provider.id, payerId: b.payer.id, status: "approved", effectiveOn: "2000-01-01", revalidationDue: "2000-06-01" }, t.userId);
    const grid = await enrollmentGrid(t.db, t.practiceId);
    expect(grid.get(b.provider.id, b.payer.id)?.id).toBe(saved.id);
    findings = (await scrubBundle(t.db, b)).findings;
    expect(findings.some((f) => f.rule === "provider_enrollment")).toBe(false);
    expect((await enrollmentAlerts(t.db, t.practiceId))[0].kind).toBe("revalidation_overdue");
  });
});
