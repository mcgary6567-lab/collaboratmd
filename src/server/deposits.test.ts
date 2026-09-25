import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { autoMatch, depositsOverview, importDeposits, matchDeposit, parseAmount, parseBankCsv, setDepositStatus } from "./deposits";

describe("bank CSV parsing", () => {
  it("reads amounts the ways banks write them", () => {
    expect(parseAmount("$1,234.56")).toBe(123456);
    expect(parseAmount("(12.00)")).toBe(-1200);
    expect(parseAmount("-5")).toBe(-500);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("keeps credits only, from one amount column or split credit and debit columns", () => {
    const one = parseBankCsv("Date,Description,Amount\n09/01/2026,HCCLAIMPMT AETNA TRN*1*EFT123456,1500.00\n09/02/2026,RENT,-2000.00\n");
    expect(one.rows).toEqual([{ date: "2026-09-01", amountCents: 150000, description: "HCCLAIMPMT AETNA TRN*1*EFT123456" }]);
    expect(one.skipped).toBe(1);
    const split = parseBankCsv("Posting Date;Memo;Debit;Credit\n2026-09-03;BCBS EFT 998877;;250.10\n2026-09-03;Fee;15.00;\n");
    expect(split.rows).toEqual([{ date: "2026-09-03", amountCents: 25010, description: "BCBS EFT 998877" }]);
    expect(parseBankCsv("foo,bar\n1,2\n").error).toMatch(/date column/);
  });
});

describe("deposit matching against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  const era = (checkNumber: string, amountCents: number, paymentDate: string) =>
    t.db.insert(schema.remittances).values({ practiceId: t.practiceId, payerName: "Test Payer", checkNumber, amountCents, paymentDate, raw835: "ISA*" }).returning().then((r) => r[0]);
  let byTrace: typeof schema.remittances.$inferSelect;
  let byAmount: typeof schema.remittances.$inferSelect;
  let twinA: typeof schema.remittances.$inferSelect;

  beforeAll(async () => {
    t = await testDb();
    // Keep the seeded ERAs out of the way so the test controls every candidate.
    await t.db.update(schema.remittances).set({ amountCents: 1 }).where(eq(schema.remittances.practiceId, t.practiceId));
    byTrace = await era("EFT7788990", 123_45, "2026-09-01");
    byAmount = await era("CHK1", 555_00, "2026-09-02");
    twinA = await era("TWIN-A", 700_00, "2026-09-03");
    await era("TWIN-B", 700_00, "2026-09-03");
  });
  afterAll(async () => { await t?.close(); });

  it("reports no missing deposits before any bank file is imported", async () => {
    const o = await depositsOverview(t.db, t.practiceId);
    expect(o).toMatchObject({ since: null, missing: [], openRemittances: [] });
  });

  it("does not count ERAs paid long before the first import as missing", async () => {
    await era("OLD-ERA-1", 999_00, "2025-01-15");
    await era("ZERO-PAY", 0, "2026-09-05");
    await importDeposits(t.db, t.practiceId, "Date,Description,Amount\n09/10/2026,UNRELATED,1.23\n");
    const o = await depositsOverview(t.db, t.practiceId);
    expect(o.since).toBe("2026-08-31");
    expect(o.missing.some((r) => r.checkNumber === "OLD-ERA-1")).toBe(false);
    expect(o.openRemittances.some((r) => r.checkNumber === "ZERO-PAY")).toBe(false); // a $0 ERA never produces a deposit
    await t.db.delete(schema.bankDeposits).where(eq(schema.bankDeposits.practiceId, t.practiceId));
  });

  it("matches by trace number, or by a unique amount within days, and leaves ambiguous ones", async () => {
    const csv = [
      "Date,Description,Amount",
      "09/05/2026,HCCLAIMPMT TRN*1*EFT7788990*1234,123.45",
      "09/04/2026,DEPOSIT,555.00",
      "09/04/2026,DEPOSIT,700.00",
      "09/04/2026,PATIENT CARD BATCH,80.00",
      "09/04/2026,PATIENT CARD BATCH,80.00",
    ].join("\n");
    const r = await importDeposits(t.db, t.practiceId, csv, t.userId);
    expect(r).toMatchObject({ added: 5, matched: 2, duplicates: 0 });
    const o = await depositsOverview(t.db, t.practiceId);
    const find = (amount: number) => o.deposits.filter((x) => x.deposit.amountCents === amount);
    expect(find(12345)[0].deposit).toMatchObject({ status: "matched", remittanceId: byTrace.id });
    expect(find(12345)[0].deposit.matchReason).toMatch(/Trace number/);
    expect(find(55500)[0].deposit).toMatchObject({ status: "matched", remittanceId: byAmount.id });
    expect(find(70000)[0].deposit.status).toBe("unmatched");
    expect(find(8000)).toHaveLength(2); // identical twin rows in one file are two deposits

    const again = await importDeposits(t.db, t.practiceId, csv, t.userId);
    expect(again).toMatchObject({ added: 0, duplicates: 5 });
  });

  it("lets a person match, refuses a double match, and ignores non-insurance deposits", async () => {
    const o = await depositsOverview(t.db, t.practiceId);
    const twin = o.deposits.find((x) => x.deposit.amountCents === 70000)!.deposit;
    await matchDeposit(t.db, t.practiceId, twin.id, twinA.id, t.userId);
    const card = o.deposits.filter((x) => x.deposit.amountCents === 8000);
    await expect(matchDeposit(t.db, t.practiceId, card[0].deposit.id, twinA.id)).rejects.toThrow(/already matched/);
    await expect(matchDeposit(t.db, "00000000-0000-0000-0000-000000000000", card[0].deposit.id, twinA.id)).rejects.toThrow(/not found/);
    for (const c of card) await setDepositStatus(t.db, t.practiceId, c.deposit.id, "ignored");
    const after = await depositsOverview(t.db, t.practiceId);
    expect(after.counts).toMatchObject({ matched: 3, ignored: 2, unmatched: 0 });
    expect(await autoMatch(t.db, t.practiceId)).toBe(0);
  });
});
