import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { accessiblePractices, roleIn } from "./auth";

describe("practice access", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let clientA: string;
  let clientB: string;

  beforeAll(async () => {
    t = await testDb();
    const mk = async (name: string) =>
      (await t.db.insert(schema.practices).values({ name, taxId: "33-3333333", npi: "3333333334", address1: "3 Oak", city: "Plano", state: "TX", zip: "75024" }).returning())[0].id;
    clientA = await mk("Alpha Pediatrics");
    clientB = await mk("Bravo Orthopedics");
  });
  afterAll(async () => { await t?.close(); });

  it("gives a user their own practice with their own role", async () => {
    const [u] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    expect(await roleIn(t.db, t.userId, t.practiceId)).toBe(u.role);
    expect(await roleIn(t.db, t.userId, clientA)).toBeNull();
  });

  it("grants other practices only through a membership, with that membership's role", async () => {
    await t.db.insert(schema.practiceMemberships).values({ userId: t.userId, practiceId: clientA, role: "readonly" });
    expect(await roleIn(t.db, t.userId, clientA)).toBe("readonly");
    expect(await roleIn(t.db, t.userId, clientB)).toBeNull();
    const list = await accessiblePractices(t.db, t.userId);
    expect(list[0].id).toBe(t.practiceId);
    expect(list.map((p) => p.name)).toContain("Alpha Pediatrics");
    expect(list.map((p) => p.id)).not.toContain(clientB);
  });

  it("revokes at once when the membership is removed", async () => {
    await t.db.delete(schema.practiceMemberships).where(and(eq(schema.practiceMemberships.userId, t.userId), eq(schema.practiceMemberships.practiceId, clientA)));
    expect(await roleIn(t.db, t.userId, clientA)).toBeNull();
  });

  it("knows no one who does not exist", async () => {
    expect(await roleIn(t.db, "00000000-0000-0000-0000-000000000000", t.practiceId)).toBeNull();
    expect(await accessiblePractices(t.db, "00000000-0000-0000-0000-000000000000")).toEqual([]);
  });
});
