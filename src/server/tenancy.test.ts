import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { assertOwned } from "./tenancy";

describe("ownership checks", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let otherPracticeId: string;
  let otherPatientId: string;
  let ownPatientId: string;
  let ownClaimId: string;

  beforeAll(async () => {
    t = await testDb();
    const [other] = await t.db
      .insert(schema.practices)
      .values({ name: "Other Clinic", taxId: "11-1111111", npi: "1111111112", address1: "1 Elm", city: "Austin", state: "TX", zip: "78701" })
      .returning();
    otherPracticeId = other.id;
    const [p] = await t.db
      .insert(schema.patients)
      .values({ practiceId: other.id, mrn: "OTHER1", firstName: "Olive", lastName: "Other", dob: "1970-01-01", sex: "F" })
      .returning();
    otherPatientId = p.id;
    const [own] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    ownPatientId = own.id;
    const [c] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    ownClaimId = c.id;
  });
  afterAll(async () => { await t?.close(); });

  it("accepts the practice's own records", async () => {
    await expect(assertOwned(t.db, t.practiceId, "patient", ownPatientId)).resolves.toBeUndefined();
    await expect(assertOwned(t.db, t.practiceId, "claim", ownClaimId)).resolves.toBeUndefined();
  });

  it("refuses another practice's record exactly as it refuses a missing one", async () => {
    await expect(assertOwned(t.db, t.practiceId, "patient", otherPatientId)).rejects.toThrow("Patient not found");
    await expect(assertOwned(t.db, t.practiceId, "patient", "00000000-0000-0000-0000-000000000000")).rejects.toThrow("Patient not found");
    await expect(assertOwned(t.db, otherPracticeId, "claim", ownClaimId)).rejects.toThrow("Claim not found");
  });

  it("rejects malformed IDs without querying", async () => {
    for (const bad of ["", "1 OR 1=1", null, undefined]) {
      await expect(assertOwned(t.db, t.practiceId, "patient", bad)).rejects.toThrow("Patient not found");
    }
  });
});
