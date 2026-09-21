import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { computeFinancials } from "./claims";

const { claims, payers, patients, ledgerEntries, denials, claimEvents } = schema;

export interface ArRow {
  key: string;
  label: string;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b91_120: number;
  b120p: number;
  total: number;
}

function bucket(days: number): keyof Omit<ArRow, "key" | "label" | "total"> {
  if (days <= 30) return "b0_30";
  if (days <= 60) return "b31_60";
  if (days <= 90) return "b61_90";
  if (days <= 120) return "b91_120";
  return "b120p";
}

/** Insurance AR aging by payer, based on ledger balances and date of service. */
export async function arAgingByPayer(db: Db, practiceId: string): Promise<{ rows: ArRow[]; totals: ArRow }> {
  const rows = await db
    .select({ claim: claims, payerName: payers.name, payerId: payers.id, dos: schema.encounters.dateOfService })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(schema.encounters, eq(schema.encounters.id, claims.encounterId))
    .where(and(eq(claims.practiceId, practiceId), inArray(claims.status, ["draft", "scrub_errors", "ready", "submitted", "accepted", "rejected", "pending", "denied", "partially_paid"])));
  const entries = rows.length
    ? await db.select({ claimId: ledgerEntries.claimId, type: ledgerEntries.type, amountCents: ledgerEntries.amountCents }).from(ledgerEntries).where(inArray(ledgerEntries.claimId, rows.map((r) => r.claim.id)))
    : [];
  const byClaim = new Map<string, { type: string; amountCents: number }[]>();
  for (const e of entries) if (e.claimId) byClaim.set(e.claimId, [...(byClaim.get(e.claimId) ?? []), e]);

  const map = new Map<string, ArRow>();
  const blank = (key: string, label: string): ArRow => ({ key, label, b0_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b120p: 0, total: 0 });
  const totals = blank("total", "Total");
  for (const r of rows) {
    const fin = computeFinancials(byClaim.get(r.claim.id) ?? []);
    if (fin.insuranceBalanceCents <= 0) continue;
    const days = Math.floor((Date.now() - new Date(r.dos).getTime()) / 86_400_000);
    const b = bucket(days);
    const row = map.get(r.payerId) ?? blank(r.payerId, r.payerName);
    row[b] += fin.insuranceBalanceCents;
    row.total += fin.insuranceBalanceCents;
    totals[b] += fin.insuranceBalanceCents;
    totals.total += fin.insuranceBalanceCents;
    map.set(r.payerId, row);
  }
  return { rows: [...map.values()].sort((a, b) => b.total - a.total), totals };
}

export async function dashboardKpis(db: Db, practiceId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const ledger = await db.select({ type: ledgerEntries.type, amountCents: ledgerEntries.amountCents, postedAt: ledgerEntries.postedAt }).from(ledgerEntries).where(eq(ledgerEntries.practiceId, practiceId));
  const sum = (t: string, from?: Date) => ledger.filter((e) => e.type === t && (!from || e.postedAt >= from)).reduce((a, e) => a + e.amountCents, 0);
  const charges90 = sum("charge", since);
  const insPaid90 = sum("insurance_payment", since);
  const patPaid90 = sum("patient_payment", since);
  const adj90 = sum("adjustment", since) + sum("write_off", since);

  const ar = await arAgingByPayer(db, practiceId);
  const patientAr = ledger.filter((e) => e.type === "transfer_to_patient").reduce((a, e) => a + e.amountCents, 0) - ledger.filter((e) => e.type === "patient_payment").reduce((a, e) => a + e.amountCents, 0);
  const avgDailyCharges = charges90 / 90 || 1;
  const daysInAr = Math.round((ar.totals.total + Math.max(patientAr, 0)) / avgDailyCharges);

  const statusRows = await db.select({ status: claims.status, n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${claims.totalCents}),0)` }).from(claims).where(eq(claims.practiceId, practiceId)).groupBy(claims.status);
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, { n: Number(r.n), total: Number(r.total) }]));

  // Clean-claim rate: share of submitted claims that were accepted on first pass (no rejection event).
  const submitted = await db.select({ id: claims.id }).from(claims).where(and(eq(claims.practiceId, practiceId), inArray(claims.status, ["accepted", "pending", "paid", "partially_paid", "denied", "rejected", "closed"])));
  const rejectedEvents = submitted.length ? await db.select({ claimId: claimEvents.claimId }).from(claimEvents).where(and(inArray(claimEvents.claimId, submitted.map((s) => s.id)), eq(claimEvents.status, "rejected"))) : [];
  const rejectedSet = new Set(rejectedEvents.map((r) => r.claimId));
  const cleanClaimRate = submitted.length ? (submitted.length - rejectedSet.size) / submitted.length : 0;

  const [{ openDenials, deniedCents }] = await db.select({ openDenials: sql<number>`count(*)`, deniedCents: sql<number>`coalesce(sum(${denials.amountCents}),0)` }).from(denials).where(and(eq(denials.practiceId, practiceId), inArray(denials.status, ["open", "in_progress", "appealed"])));
  const adjudicated = (byStatus.paid?.n ?? 0) + (byStatus.partially_paid?.n ?? 0) + (byStatus.denied?.n ?? 0);
  const denialRate = adjudicated ? (byStatus.denied?.n ?? 0) / adjudicated : 0;
  const netCollectionRate = charges90 - adj90 > 0 ? (insPaid90 + patPaid90) / (charges90 - adj90) : 0;

  // Monthly trend for charts (last 6 months).
  const months: { month: string; charges: number; payments: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    const inMonth = (e: { postedAt: Date }) => e.postedAt.toISOString().slice(0, 7) === key;
    months.push({
      month: d.toLocaleDateString("en-US", { month: "short" }),
      charges: ledger.filter((e) => e.type === "charge" && inMonth(e)).reduce((a, e) => a + e.amountCents, 0) / 100,
      payments: ledger.filter((e) => (e.type === "insurance_payment" || e.type === "patient_payment") && inMonth(e)).reduce((a, e) => a + e.amountCents, 0) / 100,
    });
  }

  const recent = await db
    .select({ claim: claims, patient: patients, payer: payers })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(eq(claims.practiceId, practiceId))
    .orderBy(desc(claims.updatedAt))
    .limit(8);

  return {
    charges90,
    insPaid90,
    patPaid90,
    adj90,
    insuranceAr: ar.totals.total,
    patientAr: Math.max(patientAr, 0),
    daysInAr,
    cleanClaimRate,
    denialRate,
    netCollectionRate,
    openDenials: Number(openDenials),
    deniedCents: Number(deniedCents),
    byStatus,
    months,
    aging: ar.totals,
    recent,
  };
}

export async function payerMix(db: Db, practiceId: string) {
  const rows = await db
    .select({ payer: payers.name, type: payers.type, claims: sql<number>`count(*)`, charged: sql<number>`coalesce(sum(${claims.totalCents}),0)` })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(eq(claims.practiceId, practiceId))
    .groupBy(payers.name, payers.type)
    .orderBy(desc(sql`count(*)`));
  const paid = await db
    .select({ payerId: claims.payerId, paid: sql<number>`coalesce(sum(${ledgerEntries.amountCents}),0)` })
    .from(ledgerEntries)
    .innerJoin(claims, eq(claims.id, ledgerEntries.claimId))
    .where(and(eq(ledgerEntries.practiceId, practiceId), eq(ledgerEntries.type, "insurance_payment")))
    .groupBy(claims.payerId);
  const payerList = await db.select().from(payers).where(eq(payers.practiceId, practiceId));
  const paidByName = new Map(paid.map((p) => [payerList.find((x) => x.id === p.payerId)?.name ?? "", Number(p.paid)]));
  return rows.map((r) => ({ payer: r.payer, type: r.type, claims: Number(r.claims), charged: Number(r.charged), paid: paidByName.get(r.payer) ?? 0 }));
}

export async function listDenials(db: Db, practiceId: string, status?: string) {
  const where = status ? and(eq(denials.practiceId, practiceId), eq(denials.status, status)) : eq(denials.practiceId, practiceId);
  return db
    .select({ denial: denials, claim: claims, patient: patients, payer: payers })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(where)
    .orderBy(desc(denials.createdAt))
    .limit(200);
}

export async function updateDenialStatus(db: Db, id: string, status: string) {
  await db.update(denials).set({ status, resolvedAt: ["resolved", "written_off"].includes(status) ? new Date() : null }).where(eq(denials.id, id));
}
