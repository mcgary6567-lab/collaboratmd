import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { build277CA } from "@/lib/edi/x277ca";
import { pollRemittances } from "./era-poll";

describe("277CA acknowledgments picked up by polling", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("accepts and rejects the claims it names, once, and opens a denial for the rejection", async () => {
    const two = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(2);
    for (const c of two) await t.db.update(schema.claims).set({ status: "submitted" }).where(eq(schema.claims.id, c.id));
    const [good, bad] = two;
    const acks = async () => (await t.db.select().from(schema.claimAcknowledgments).where(eq(schema.claimAcknowledgments.claimId, bad.id))).filter((a) => a.kind === "277CA").length;
    const acksBefore = await acks();
    const x12 = build277CA({
      senderId: "PAYER", receiverId: "COLLABORATMD", now: new Date(), control: "7", sourceName: "Payer", submitterName: "Practice",
      billingProvider: { name: "Practice", npi: "1234567893" },
      claims: [
        { controlNumber: good.controlNumber, patientLast: "A", patientFirst: "B", memberId: "M1", chargeCents: good.totalCents, dateOfService: "2026-09-20", status: "A2:20", payerClaimNumber: "PCN-9" },
        { controlNumber: bad.controlNumber, patientLast: "C", patientFirst: "D", memberId: "M2", chargeCents: bad.totalCents, dateOfService: "2026-09-20", status: "A7:164:IL" },
        { controlNumber: "NOT-OURS", patientLast: "E", patientFirst: "F", memberId: "M3", chargeCents: 100, dateOfService: "2026-09-20", status: "A2:20" },
      ],
    });
    const gateway = { pollInbound: async () => ({ items: [{ transactionId: "tx-277-1", transactionSet: "277", x12 }], cursor: "c1" }) };

    const r = await pollRemittances(t.db, t.practiceId, { gateway });
    expect(r).toMatchObject({ acknowledged: 2, rejected: 1 });
    const [g] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, good.id));
    const [b] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, bad.id));
    expect(g).toMatchObject({ status: "accepted", payerClaimNumber: "PCN-9" });
    expect(b.status).toBe("rejected");
    const denials = await t.db.select().from(schema.denials).where(and(eq(schema.denials.claimId, bad.id), eq(schema.denials.carc, "A7:164:IL")));
    expect(denials).toHaveLength(1);
    expect(denials[0].explanation).toMatch(/member ID/);
    const [tx] = await t.db.select().from(schema.inboundTransactions).where(eq(schema.inboundTransactions.transactionId, "tx-277-1"));
    expect(tx.note).toBe("277CA: 1 accepted, 1 rejected, 1 not this practice's");

    // The same transaction again changes nothing.
    await pollRemittances(t.db, t.practiceId, { gateway });
    expect(await t.db.select().from(schema.denials).where(eq(schema.denials.claimId, bad.id))).toHaveLength(denials.length);
    expect(await acks()).toBe(acksBefore + 1);
  });
});
