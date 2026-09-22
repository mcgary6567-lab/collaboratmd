import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

/**
 * Practice analytics.
 *
 * Every figure is aggregated in SQL. At practice scale the ledger runs to
 * millions of rows, so nothing here may pull raw rows into the app and sum
 * them in JavaScript.
 *
 * Money is stored in cents as integers; sums are cast to bigint in SQL and
 * converted once at the edge to avoid overflow and float drift.
 */

const n = (v: unknown): number => Number(v ?? 0);

export interface HeadlineKpis {
  chargesCents: number;
  insurancePaidCents: number;
  patientPaidCents: number;
  adjustmentsCents: number;
  insuranceArCents: number;
  patientArCents: number;
  daysInAr: number;
  cleanClaimRate: number;
  denialRate: number;
  netCollectionRate: number;
  firstPassYield: number;
  claimCount: number;
  patientCount: number;
  providerCount: number;
  openDenials: number;
  openDenialCents: number;
}

/**
 * Headline numbers.
 *
 * Volumes (charges, payments, adjustments) are for the trailing window.
 * Receivables are NOT: A/R is the balance outstanding right now, taken from
 * open claims across all time. Deriving it from a windowed ledger difference
 * mixes charges inside the window with payments for claims billed before it
 * and can even go negative.
 *
 * Days in A/R uses a 90-day average daily charge, the usual convention.
 */
export async function headlineKpis(db: Db, practiceId: string, months = 12): Promise<HeadlineKpis> {
  const [{ rows: ledger }, { rows: claims }, { rows: counts }, { rows: denials }, { rows: ar }] = await Promise.all([
    db.execute<Record<string, string>>(sql`
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE type = 'charge'), 0)::bigint AS charges,
        COALESCE(SUM(amount_cents) FILTER (WHERE type = 'insurance_payment'), 0)::bigint AS ins_paid,
        COALESCE(SUM(amount_cents) FILTER (WHERE type = 'patient_payment'), 0)::bigint AS pat_paid,
        COALESCE(SUM(amount_cents) FILTER (WHERE type IN ('adjustment','write_off')), 0)::bigint AS adjustments,
        -- Contractual adjustments only. Write-offs are lost revenue and must
        -- not be removed from the net collection denominator, or the rate can
        -- exceed 100%: you cannot collect more than you were owed.
        COALESCE(SUM(amount_cents) FILTER (WHERE type = 'adjustment'), 0)::bigint AS contractual,
        COALESCE(SUM(amount_cents) FILTER (WHERE type = 'transfer_to_patient'), 0)::bigint AS transferred
      FROM ledger_entries
      WHERE practice_id = ${practiceId}
        AND posted_at >= now() - (${months} || ' months')::interval`),
    db.execute<Record<string, string>>(sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status IN ('paid','partially_paid'))::bigint AS paid,
        COUNT(*) FILTER (WHERE status = 'rejected')::bigint AS rejected,
        COUNT(*) FILTER (WHERE status NOT IN ('draft','ready','scrub_errors'))::bigint AS submitted,
        -- A claim the payer ruled on, whatever the outcome. Current status is
        -- not a proxy: a denial that was appealed and closed still counts.
        COUNT(*) FILTER (WHERE payer_claim_number IS NOT NULL)::bigint AS adjudicated,
        (SELECT COUNT(*) FROM denials WHERE practice_id = ${practiceId})::bigint AS denied
      FROM claims WHERE practice_id = ${practiceId}`),
    db.execute<Record<string, string>>(sql`
      SELECT
        (SELECT COUNT(*) FROM patients WHERE practice_id = ${practiceId})::bigint AS patients,
        (SELECT COUNT(*) FROM providers WHERE practice_id = ${practiceId} AND active)::bigint AS providers`),
    db.execute<Record<string, string>>(sql`
      SELECT COUNT(*)::bigint AS open, COALESCE(SUM(amount_cents), 0)::bigint AS amount
      FROM denials WHERE practice_id = ${practiceId} AND status IN ('open','in_progress','appealed')`),
    db.execute<Record<string, string>>(sql`
      WITH claim_balance AS (
        SELECT c.id,
               SUM(CASE WHEN l.type = 'charge' THEN l.amount_cents
                        WHEN l.type IN ('insurance_payment','adjustment','write_off','transfer_to_patient') THEN -l.amount_cents
                        ELSE 0 END) AS balance
        FROM claims c JOIN ledger_entries l ON l.claim_id = c.id
        WHERE c.practice_id = ${practiceId} AND c.status NOT IN ('paid','closed')
        GROUP BY c.id
      )
      SELECT
        (SELECT COALESCE(SUM(balance), 0) FROM claim_balance WHERE balance > 0)::bigint AS insurance_ar,
        (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE type = 'transfer_to_patient'), 0)
              - COALESCE(SUM(amount_cents) FILTER (WHERE type = 'patient_payment'), 0)
         FROM ledger_entries WHERE practice_id = ${practiceId})::bigint AS patient_ar,
        (SELECT COALESCE(SUM(amount_cents), 0) / 90.0 FROM ledger_entries
         WHERE practice_id = ${practiceId} AND type = 'charge' AND posted_at >= now() - interval '90 days')::numeric AS daily_charges`),
  ]);

  const l = ledger[0] ?? {};
  const c = claims[0] ?? {};
  const chargesCents = n(l.charges);
  const insurancePaidCents = n(l.ins_paid);
  const patientPaidCents = n(l.pat_paid);
  const adjustmentsCents = n(l.adjustments);
  const insuranceArCents = n(ar[0]?.insurance_ar);
  const patientArCents = Math.max(n(ar[0]?.patient_ar), 0);
  const avgDailyCharges = Number(ar[0]?.daily_charges ?? 0) || 1;
  const adjudicated = n(c.adjudicated);

  return {
    chargesCents,
    insurancePaidCents,
    patientPaidCents,
    adjustmentsCents,
    insuranceArCents,
    patientArCents,
    daysInAr: Math.round((insuranceArCents + patientArCents) / avgDailyCharges),
    cleanClaimRate: n(c.submitted) ? (n(c.submitted) - n(c.rejected)) / n(c.submitted) : 0,
    denialRate: adjudicated ? n(c.denied) / adjudicated : 0,
    netCollectionRate: chargesCents - n(l.contractual) > 0 ? (insurancePaidCents + patientPaidCents) / (chargesCents - n(l.contractual)) : 0,
    firstPassYield: n(c.total) ? n(c.paid) / n(c.total) : 0,
    claimCount: n(c.total),
    patientCount: n(counts[0]?.patients),
    providerCount: n(counts[0]?.providers),
    openDenials: n(denials[0]?.open),
    openDenialCents: n(denials[0]?.amount),
  };
}

/** Charges, payments and adjustments per month for trend charts. */
export async function monthlyTrend(db: Db, practiceId: string, months = 12) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT
      to_char(date_trunc('month', posted_at), 'YYYY-MM') AS month,
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'charge'), 0)::bigint AS charges,
      COALESCE(SUM(amount_cents) FILTER (WHERE type IN ('insurance_payment','patient_payment')), 0)::bigint AS payments,
      COALESCE(SUM(amount_cents) FILTER (WHERE type IN ('adjustment','write_off')), 0)::bigint AS adjustments
    FROM ledger_entries
    WHERE practice_id = ${practiceId}
      AND posted_at >= date_trunc('month', now()) - (${months - 1} || ' months')::interval
    GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => ({
    month: new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    charges: n(r.charges) / 100,
    payments: n(r.payments) / 100,
    adjustments: n(r.adjustments) / 100,
  }));
}

export interface AgingRow {
  key: string;
  label: string;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b91_120: number;
  b120p: number;
  total: number;
}

/**
 * Insurance AR aged by date of service, per payer.
 *
 * The outstanding balance per claim is derived inside SQL so only one row per
 * payer crosses the wire.
 */
export async function arAging(db: Db, practiceId: string): Promise<{ rows: AgingRow[]; totals: AgingRow }> {
  const { rows } = await db.execute<Record<string, string>>(sql`
    WITH claim_balance AS (
      SELECT c.id, c.payer_id, e.date_of_service,
             SUM(CASE WHEN l.type = 'charge' THEN l.amount_cents
                      WHEN l.type IN ('insurance_payment','adjustment','write_off','transfer_to_patient') THEN -l.amount_cents
                      ELSE 0 END) AS balance
      FROM claims c
      JOIN encounters e ON e.id = c.encounter_id
      JOIN ledger_entries l ON l.claim_id = c.id
      WHERE c.practice_id = ${practiceId}
        AND c.status NOT IN ('paid','closed')
      GROUP BY c.id, c.payer_id, e.date_of_service
      HAVING SUM(CASE WHEN l.type = 'charge' THEN l.amount_cents
                      WHEN l.type IN ('insurance_payment','adjustment','write_off','transfer_to_patient') THEN -l.amount_cents
                      ELSE 0 END) > 0
    )
    SELECT p.id AS payer_id, p.name AS payer,
      COALESCE(SUM(b.balance) FILTER (WHERE now()::date - b.date_of_service <= 30), 0)::bigint AS b0_30,
      COALESCE(SUM(b.balance) FILTER (WHERE now()::date - b.date_of_service BETWEEN 31 AND 60), 0)::bigint AS b31_60,
      COALESCE(SUM(b.balance) FILTER (WHERE now()::date - b.date_of_service BETWEEN 61 AND 90), 0)::bigint AS b61_90,
      COALESCE(SUM(b.balance) FILTER (WHERE now()::date - b.date_of_service BETWEEN 91 AND 120), 0)::bigint AS b91_120,
      COALESCE(SUM(b.balance) FILTER (WHERE now()::date - b.date_of_service > 120), 0)::bigint AS b120p,
      COALESCE(SUM(b.balance), 0)::bigint AS total
    FROM claim_balance b JOIN payers p ON p.id = b.payer_id
    GROUP BY p.id, p.name ORDER BY total DESC`);

  const mapped: AgingRow[] = rows.map((r) => ({
    key: String(r.payer_id), label: String(r.payer),
    b0_30: n(r.b0_30), b31_60: n(r.b31_60), b61_90: n(r.b61_90),
    b91_120: n(r.b91_120), b120p: n(r.b120p), total: n(r.total),
  }));
  const totals = mapped.reduce<AgingRow>((acc, r) => ({
    ...acc,
    b0_30: acc.b0_30 + r.b0_30, b31_60: acc.b31_60 + r.b31_60, b61_90: acc.b61_90 + r.b61_90,
    b91_120: acc.b91_120 + r.b91_120, b120p: acc.b120p + r.b120p, total: acc.total + r.total,
  }), { key: "total", label: "Total", b0_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b120p: 0, total: 0 });
  return { rows: mapped, totals };
}

/** Claim counts and dollars by status. */
export async function claimsByStatus(db: Db, practiceId: string) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT status, COUNT(*)::bigint AS n, COALESCE(SUM(total_cents),0)::bigint AS total
    FROM claims WHERE practice_id = ${practiceId} GROUP BY status ORDER BY n DESC`);
  return rows.map((r) => ({ status: String(r.status), count: n(r.n), totalCents: n(r.total) }));
}

/** Payer performance: volume, billed, collected and realization rate. */
export async function payerPerformance(db: Db, practiceId: string, limit = 12) {
  // Claim totals and payments are aggregated separately: joining the ledger to
  // claims first would multiply claim rows and inflate the billed figure.
  const { rows } = await db.execute<Record<string, string>>(sql`
    WITH claim_agg AS (
      SELECT payer_id,
             COUNT(*)::bigint AS claims,
             SUM(total_cents)::bigint AS billed,
             COUNT(*) FILTER (WHERE status = 'denied')::bigint AS denied
      FROM claims WHERE practice_id = ${practiceId} GROUP BY payer_id
    ), paid_agg AS (
      SELECT c.payer_id, SUM(l.amount_cents)::bigint AS paid
      FROM ledger_entries l JOIN claims c ON c.id = l.claim_id
      WHERE l.practice_id = ${practiceId} AND l.type = 'insurance_payment'
      GROUP BY c.payer_id
    )
    SELECT p.name AS payer, p.type,
      COALESCE(ca.claims, 0)::bigint AS claims,
      COALESCE(ca.billed, 0)::bigint AS billed,
      COALESCE(pa.paid, 0)::bigint AS paid,
      COALESCE(ca.denied, 0)::bigint AS denied
    FROM payers p
    LEFT JOIN claim_agg ca ON ca.payer_id = p.id
    LEFT JOIN paid_agg pa ON pa.payer_id = p.id
    WHERE p.practice_id = ${practiceId}
    ORDER BY billed DESC LIMIT ${limit}`);
  return rows.map((r) => ({
    payer: String(r.payer), type: String(r.type), claims: n(r.claims),
    billedCents: n(r.billed), paidCents: n(r.paid), denied: n(r.denied),
  }));
}

/** Highest-volume providers with billed and collected dollars. */
export async function providerProductivity(db: Db, practiceId: string, limit = 10) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT pr.id, pr.first_name, pr.last_name, pr.specialty,
      COUNT(DISTINCT c.id)::bigint AS claims,
      COALESCE(SUM(c.total_cents),0)::bigint AS billed,
      COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'denied')::bigint AS denied
    FROM providers pr
    JOIN encounters e ON e.provider_id = pr.id
    JOIN claims c ON c.encounter_id = e.id
    WHERE pr.practice_id = ${practiceId}
    GROUP BY pr.id, pr.first_name, pr.last_name, pr.specialty
    ORDER BY billed DESC LIMIT ${limit}`);
  return rows.map((r) => ({
    name: `Dr. ${r.first_name} ${r.last_name}`, specialty: String(r.specialty),
    claims: n(r.claims), billedCents: n(r.billed), denied: n(r.denied),
  }));
}

/** Denial volume and dollars grouped by reason code. */
export async function denialReasons(db: Db, practiceId: string, limit = 8) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT carc, category, COUNT(*)::bigint AS n, COALESCE(SUM(amount_cents),0)::bigint AS amount
    FROM denials WHERE practice_id = ${practiceId}
    GROUP BY carc, category ORDER BY amount DESC LIMIT ${limit}`);
  return rows.map((r) => ({
    carc: String(r.carc), category: String(r.category), count: n(r.n), amountCents: n(r.amount),
  }));
}

/** Claims approaching or past their timely-filing deadline. */
export async function timelyFilingRisk(db: Db, practiceId: string) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT
      COUNT(*) FILTER (WHERE timely_filing_deadline < now()::date)::bigint AS overdue,
      COUNT(*) FILTER (WHERE timely_filing_deadline BETWEEN now()::date AND now()::date + 14)::bigint AS within_14,
      COALESCE(SUM(total_cents) FILTER (WHERE timely_filing_deadline < now()::date + 14), 0)::bigint AS at_risk
    FROM claims
    WHERE practice_id = ${practiceId} AND status NOT IN ('paid','closed')`);
  const r = rows[0] ?? {};
  return { overdue: n(r.overdue), within14: n(r.within_14), atRiskCents: n(r.at_risk) };
}

export interface CollectionsSummary {
  today: number;
  last7: number;
  last30: number;
  last365: number;
  charges30: number;
  postedCount30: number;
  bestMonth: { month: string; amount: number } | null;
}

/**
 * Money actually collected, for every role.
 *
 * Collections are the point of the product, so the figure is available to
 * anyone signed in rather than only to an administrator.
 */
export async function collectionsSummary(db: Db, practiceId: string): Promise<CollectionsSummary> {
  const paid = sql`type IN ('insurance_payment','patient_payment')`;
  const [{ rows: totals }, { rows: best }] = await Promise.all([
    db.execute<Record<string, string>>(sql`
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE ${paid} AND posted_at >= date_trunc('day', now())), 0)::bigint AS today,
        COALESCE(SUM(amount_cents) FILTER (WHERE ${paid} AND posted_at >= now() - interval '7 days'), 0)::bigint AS last7,
        COALESCE(SUM(amount_cents) FILTER (WHERE ${paid} AND posted_at >= now() - interval '30 days'), 0)::bigint AS last30,
        COALESCE(SUM(amount_cents) FILTER (WHERE ${paid} AND posted_at >= now() - interval '365 days'), 0)::bigint AS last365,
        COALESCE(SUM(amount_cents) FILTER (WHERE type = 'charge' AND posted_at >= now() - interval '30 days'), 0)::bigint AS charges30,
        COUNT(*) FILTER (WHERE ${paid} AND posted_at >= now() - interval '30 days')::bigint AS posted30
      FROM ledger_entries WHERE practice_id = ${practiceId}`),
    db.execute<Record<string, string>>(sql`
      SELECT to_char(date_trunc('month', posted_at), 'Mon YYYY') AS month,
             SUM(amount_cents)::bigint AS amount
      FROM ledger_entries
      WHERE practice_id = ${practiceId} AND ${paid}
        AND posted_at >= now() - interval '12 months'
      GROUP BY date_trunc('month', posted_at)
      ORDER BY amount DESC LIMIT 1`),
  ]);
  const t = totals[0] ?? {};
  return {
    today: n(t.today),
    last7: n(t.last7),
    last30: n(t.last30),
    last365: n(t.last365),
    charges30: n(t.charges30),
    postedCount30: n(t.posted30),
    bestMonth: best[0] ? { month: String(best[0].month), amount: n(best[0].amount) } : null,
  };
}

/** Most recent payments posted, for the "money arriving" panel. */
export async function recentPayments(db: Db, practiceId: string, limit = 8) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT l.id, l.amount_cents, l.type, l.posted_at,
           c.id AS claim_id, c.control_number,
           p.last_name, p.first_name, py.name AS payer
    FROM ledger_entries l
    JOIN claims c ON c.id = l.claim_id
    JOIN patients p ON p.id = c.patient_id
    JOIN payers py ON py.id = c.payer_id
    WHERE l.practice_id = ${practiceId}
      AND l.type IN ('insurance_payment','patient_payment')
    ORDER BY l.posted_at DESC LIMIT ${limit}`);
  return rows.map((r) => ({
    id: String(r.id),
    amountCents: n(r.amount_cents),
    source: String(r.type) === "patient_payment" ? "Patient" : "Insurance",
    postedAt: new Date(String(r.posted_at)),
    claimId: String(r.claim_id),
    controlNumber: String(r.control_number),
    patient: `${r.last_name}, ${r.first_name}`,
    payer: String(r.payer),
  }));
}

/** Denials overturned on appeal, with the dollars actually recovered. */
export async function recoveredDenials(db: Db, practiceId: string, limit = 8) {
  const [{ rows }, { rows: totals }] = await Promise.all([
    db.execute<Record<string, string>>(sql`
      SELECT d.id, d.carc, d.category, d.resolved_at,
             c.id AS claim_id, c.control_number,
             p.last_name, p.first_name, py.name AS payer,
             COALESCE((SELECT SUM(l.amount_cents) FROM ledger_entries l
                       WHERE l.claim_id = c.id AND l.type = 'insurance_payment'), 0)::bigint AS recovered
      FROM denials d
      JOIN claims c ON c.id = d.claim_id
      JOIN patients p ON p.id = c.patient_id
      JOIN payers py ON py.id = c.payer_id
      WHERE d.practice_id = ${practiceId} AND d.status = 'resolved'
        AND d.resolved_at >= now() - interval '90 days'
      ORDER BY recovered DESC LIMIT ${limit}`),
    db.execute<Record<string, string>>(sql`
      SELECT COUNT(*)::bigint AS n,
             COALESCE(SUM(amount_cents), 0)::bigint AS amount
      FROM denials
      WHERE practice_id = ${practiceId} AND status = 'resolved'
        AND resolved_at >= now() - interval '90 days'`),
  ]);
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      carc: String(r.carc),
      category: String(r.category),
      recoveredCents: n(r.recovered),
      resolvedAt: new Date(String(r.resolved_at)),
      claimId: String(r.claim_id),
      controlNumber: String(r.control_number),
      patient: `${r.last_name}, ${r.first_name}`,
      payer: String(r.payer),
    })),
    count: n(totals[0]?.n),
    amountCents: n(totals[0]?.amount),
  };
}

/* ------------------------------------------------------------ user scope */

export interface UserWorkload {
  assignedOpen: number;
  assignedOpenCents: number;
  dueSoon: number;
  /** Appeals nearing their deadline as a share of the open queue. */
  dueSoonShare: number;
  overdueAppeals: number;
  resolved30: number;
  needsAttention: number;
  /** Rework backlog as a share of all claims, for judging whether it is large. */
  needsAttentionShare: number;
  readyToSubmit: number;
  todaysAppointments: number;
  checkedIn: number;
}

/** Counters for one user's dashboard. */
export async function userWorkload(db: Db, practiceId: string, userId: string): Promise<UserWorkload> {
  const [{ rows: d }, { rows: c }, { rows: a }] = await Promise.all([
    db.execute<Record<string, string>>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open','in_progress','appealed'))::bigint AS assigned_open,
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('open','in_progress','appealed')),0)::bigint AS assigned_cents,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND appeal_deadline BETWEEN now()::date AND now()::date + 14)::bigint AS due_soon,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND appeal_deadline < now()::date)::bigint AS overdue,
        COUNT(*) FILTER (WHERE status IN ('resolved','written_off') AND resolved_at >= now() - interval '30 days')::bigint AS resolved30
      FROM denials WHERE practice_id = ${practiceId} AND assigned_to = ${userId}`),
    db.execute<Record<string, string>>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('scrub_errors','rejected'))::bigint AS needs_attention,
        COUNT(*) FILTER (WHERE status = 'ready')::bigint AS ready,
        COUNT(*)::bigint AS total
      FROM claims WHERE practice_id = ${practiceId}`),
    db.execute<Record<string, string>>(sql`
      SELECT
        COUNT(*)::bigint AS today,
        COUNT(*) FILTER (WHERE status = 'checked_in')::bigint AS checked_in
      FROM appointments
      WHERE practice_id = ${practiceId} AND starts_at::date = now()::date`),
  ]);
  return {
    assignedOpen: n(d[0]?.assigned_open),
    assignedOpenCents: n(d[0]?.assigned_cents),
    dueSoon: n(d[0]?.due_soon),
    dueSoonShare: n(d[0]?.assigned_open) ? n(d[0]?.due_soon) / n(d[0]?.assigned_open) : 0,
    overdueAppeals: n(d[0]?.overdue),
    resolved30: n(d[0]?.resolved30),
    needsAttention: n(c[0]?.needs_attention),
    needsAttentionShare: n(c[0]?.total) ? n(c[0]?.needs_attention) / n(c[0]?.total) : 0,
    readyToSubmit: n(c[0]?.ready),
    todaysAppointments: n(a[0]?.today),
    checkedIn: n(a[0]?.checked_in),
  };
}

/** The denials assigned to a user, most urgent first. */
export async function myDenialQueue(db: Db, practiceId: string, userId: string, limit = 8) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT d.id, d.carc, d.category, d.amount_cents, d.status, d.appeal_deadline,
           c.id AS claim_id, c.control_number, p.last_name, p.first_name, py.name AS payer
    FROM denials d
    JOIN claims c ON c.id = d.claim_id
    JOIN patients p ON p.id = c.patient_id
    JOIN payers py ON py.id = c.payer_id
    WHERE d.practice_id = ${practiceId} AND d.assigned_to = ${userId}
      AND d.status IN ('open','in_progress','appealed')
    ORDER BY d.appeal_deadline NULLS LAST, d.amount_cents DESC LIMIT ${limit}`);
  return rows.map((r) => ({
    id: String(r.id), carc: String(r.carc), category: String(r.category),
    amountCents: n(r.amount_cents), status: String(r.status),
    appealDeadline: r.appeal_deadline ? String(r.appeal_deadline) : null,
    claimId: String(r.claim_id), controlNumber: String(r.control_number),
    patient: `${r.last_name}, ${r.first_name}`, payer: String(r.payer),
  }));
}

/** Claims blocked before submission, newest first. */
export async function claimsNeedingAttention(db: Db, practiceId: string, limit = 8) {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT c.id, c.control_number, c.status, c.total_cents, c.timely_filing_deadline,
           p.last_name, p.first_name, py.name AS payer
    FROM claims c
    JOIN patients p ON p.id = c.patient_id
    JOIN payers py ON py.id = c.payer_id
    WHERE c.practice_id = ${practiceId} AND c.status IN ('scrub_errors','rejected')
    ORDER BY c.timely_filing_deadline NULLS LAST LIMIT ${limit}`);
  return rows.map((r) => ({
    id: String(r.id), controlNumber: String(r.control_number), status: String(r.status),
    totalCents: n(r.total_cents), deadline: r.timely_filing_deadline ? String(r.timely_filing_deadline) : null,
    patient: `${r.last_name}, ${r.first_name}`, payer: String(r.payer),
  }));
}
