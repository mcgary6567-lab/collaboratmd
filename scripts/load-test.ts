/**
 * Load test: fills a throwaway embedded database with a large practice and
 * times the queries behind the busiest screens and jobs.
 *
 *   npm run load-test                     # 100,000 claims in .loadtest/pg
 *   LOAD_CLAIMS=250000 npm run load-test
 *
 * It never touches DATABASE_URL: the embedded database (PGlite, Postgres
 * compiled to WebAssembly, single-threaded) is created under .loadtest/. Its
 * timings are an upper bound; a Neon compute runs the same plans faster.
 * The point is to find queries that grow with the data (missing indexes,
 * per-row loops), which show up here as clearly as anywhere.
 */
process.env.DATABASE_URL = "";
process.env.PGLITE_DIR = process.env.PGLITE_DIR || ".loadtest/pg";

import { sql } from "drizzle-orm";

const TARGET = Number(process.env.LOAD_CLAIMS ?? 100_000);
const RUNS = 3;

async function main() {
  const { getDb } = await import("../src/db");
  const db = await getDb();
  const one = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const { id: practiceId } = await one<{ id: string }>(sql`SELECT p.id FROM practices p JOIN claims c ON c.practice_id = p.id GROUP BY p.id ORDER BY count(*) DESC LIMIT 1`);
  let { n } = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM claims WHERE practice_id = ${practiceId}`);
  console.log(`Practice ${practiceId}: ${n} claims before loading`);

  if (n < TARGET) {
    const add = TARGET - n;
    const t0 = Date.now();
    // One row per new claim, spread across the practice's insured patients, providers and two years of visits.
    await db.execute(sql`DROP TABLE IF EXISTS lt`);
    await db.execute(sql`
      CREATE TABLE lt AS
      WITH ins AS (SELECT array_agg(pi.id ORDER BY pi.id) AS ids, array_agg(pi.patient_id ORDER BY pi.id) AS pats, array_agg(pi.payer_id ORDER BY pi.id) AS pays, count(*)::int AS n
                   FROM patient_insurances pi JOIN patients p ON p.id = pi.patient_id WHERE p.practice_id = ${practiceId}),
           pr AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM providers WHERE practice_id = ${practiceId})
      SELECT g, gen_random_uuid() AS enc, gen_random_uuid() AS claim,
             ins.ids[1 + (g * 7919) % ins.n] AS pi, ins.pats[1 + (g * 7919) % ins.n] AS patient, ins.pays[1 + (g * 7919) % ins.n] AS payer,
             pr.ids[1 + g % pr.n] AS provider, (current_date - (g % 730))::date AS dos,
             (ARRAY['paid','paid','paid','paid','paid','paid','paid','paid','paid','paid','paid','paid','partially_paid','denied','denied','accepted','accepted','submitted','ready','rejected'])[1 + g % 20] AS status,
             (9000 + (g % 23) * 1500) AS line1, 2500 AS line2
      FROM generate_series(1, ${add}) g, ins, pr`);
    await db.execute(sql`INSERT INTO encounters (id, practice_id, patient_id, provider_id, date_of_service, place_of_service, diagnoses, status)
      SELECT enc, ${practiceId}, patient, provider, dos, '11', '["E11.9","I10"]'::jsonb, 'billed' FROM lt`);
    await db.execute(sql`INSERT INTO charges (encounter_id, line_number, cpt, modifiers, units, charge_cents, dx_pointers)
      SELECT enc, 1, (ARRAY['99213','99214','99203','99204'])[1 + g % 4], '[]'::jsonb, 1, line1, '[1]'::jsonb FROM lt
      UNION ALL SELECT enc, 2, '36415', '[]'::jsonb, 1, line2, '[1]'::jsonb FROM lt`);
    await db.execute(sql`INSERT INTO claims (id, practice_id, encounter_id, patient_id, payer_id, patient_insurance_id, control_number, status, total_cents, submitted_at, created_at, updated_at)
      SELECT claim, ${practiceId}, enc, patient, payer, pi, 'LT' || lpad(g::text, 8, '0'), status, line1 + line2,
             CASE WHEN status = 'ready' THEN NULL ELSE dos + interval '2 days' END, dos + interval '1 day', dos + interval '20 days' FROM lt`);
    await db.execute(sql`INSERT INTO ledger_entries (practice_id, patient_id, claim_id, type, amount_cents, posted_at)
      SELECT ${practiceId}, patient, claim, 'charge', line1 + line2, dos + interval '1 day' FROM lt`);
    await db.execute(sql`INSERT INTO ledger_entries (practice_id, patient_id, claim_id, type, amount_cents, group_code, reason_code, posted_at)
      SELECT ${practiceId}, patient, claim, 'adjustment', ((line1 + line2) * 35 / 100), 'CO', '45', dos + interval '20 days' FROM lt WHERE status IN ('paid','partially_paid')`);
    await db.execute(sql`INSERT INTO ledger_entries (practice_id, patient_id, claim_id, type, amount_cents, posted_at)
      SELECT ${practiceId}, patient, claim, 'insurance_payment', ((line1 + line2) * 55 / 100), dos + interval '20 days' FROM lt WHERE status IN ('paid','partially_paid')`);
    await db.execute(sql`INSERT INTO denials (practice_id, claim_id, category, carc, amount_cents, status, created_at)
      SELECT ${practiceId}, claim, (ARRAY['eligibility','coding','authorization','medical_necessity','timely_filing'])[1 + g % 5], (ARRAY['27','16','197','50','29'])[1 + g % 5], line1 + line2,
             (ARRAY['open','open','in_progress','appealed','resolved'])[1 + g % 5], dos + interval '20 days' FROM lt WHERE status = 'denied'`);
    await db.execute(sql`DROP TABLE lt`);
    await db.execute(sql`ANALYZE`);
    n = TARGET;
    console.log(`Loaded ${add} claims with charges, ledger entries and denials in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  const counts = await one<Record<string, number>>(sql`SELECT
    (SELECT count(*)::int FROM claims WHERE practice_id = ${practiceId}) AS claims,
    (SELECT count(*)::int FROM ledger_entries WHERE practice_id = ${practiceId}) AS ledger,
    (SELECT count(*)::int FROM patients WHERE practice_id = ${practiceId}) AS patients,
    (SELECT count(*)::int FROM denials WHERE practice_id = ${practiceId}) AS denials`);
  console.log("Rows:", counts);

  const a = await import("../src/server/analytics");
  const lists = await import("../src/server/lists");
  const billing = await import("../src/server/billing");
  const forecast = await import("../src/server/forecast");
  const alerts = await import("../src/server/payer-alerts");
  const recovery = await import("../src/server/recovery");
  const fees = await import("../src/server/fees");
  const exp = await import("../src/server/practice-export");

  const cases: [string, () => Promise<unknown>][] = [
    ["Claims list, first page", () => lists.searchClaims(db, practiceId, { offset: 0, limit: 50 })],
    ["Claims list, search by name", () => lists.searchClaims(db, practiceId, { q: "Garc", offset: 0, limit: 50 })],
    ["Claims list, denied, page 20", () => lists.searchClaims(db, practiceId, { status: "denied", offset: 950, limit: 50 })],
    ["Denials list", () => lists.searchDenials(db, practiceId, { status: "open", offset: 0, limit: 50 })],
    ["Dashboard KPIs (12 months)", () => a.headlineKpis(db, practiceId)],
    ["Monthly trend", () => a.monthlyTrend(db, practiceId)],
    ["A/R aging", () => a.arAging(db, practiceId)],
    ["Payer performance", () => a.payerPerformance(db, practiceId)],
    ["Provider productivity", () => a.providerProductivity(db, practiceId)],
    ["Denial reasons", () => a.denialReasons(db, practiceId)],
    ["Timely filing risk", () => a.timelyFilingRisk(db, practiceId)],
    ["Collections summary", () => a.collectionsSummary(db, practiceId)],
    ["Claims needing attention", () => a.claimsNeedingAttention(db, practiceId)],
    ["Patients with balances", () => billing.patientsWithBalances(db, practiceId, 1, 50)],
    ["Cash forecast", () => forecast.cashForecast(db, practiceId)],
    ["Payer behavior alerts", () => alerts.payerAlerts(db, practiceId)],
    ["Missed charges", () => recovery.missedCharges(db, practiceId)],
    ["Credit balances", () => recovery.creditBalances(db, practiceId)],
    ["Underpayment scan (all paid claims)", () => fees.scanUnderpayments(db, practiceId)],
  ];

  const results: { name: string; ms: number }[] = [];
  for (const [name, run] of cases) {
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      await run();
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    results.push({ name, ms: Math.round(times[Math.floor(RUNS / 2)]) });
    console.log(`${name.padEnd(40)} ${String(Math.round(times[Math.floor(RUNS / 2)])).padStart(7)} ms`);
  }

  const t = performance.now();
  let bytes = 0;
  for await (const chunk of exp.practiceExport(db, practiceId)) bytes += chunk.length;
  const exportMs = Math.round(performance.now() - t);
  console.log(`${"Full practice export (zip)".padEnd(40)} ${String(exportMs).padStart(7)} ms, ${(bytes / 1e6).toFixed(1)} MB`);
  console.log(JSON.stringify({ claims: n, counts, results, exportMs, exportMB: +(bytes / 1e6).toFixed(1) }));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
