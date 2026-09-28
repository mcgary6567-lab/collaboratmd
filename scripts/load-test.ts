/**
 * Load test: fills a throwaway database with a large practice and times the
 * queries behind the busiest screens and jobs.
 *
 *   npm run load-test                     # 100,000 claims in .loadtest/pg (embedded)
 *   LOAD_CLAIMS=250000 npm run load-test
 *   LOAD_TEST_DATABASE_URL=postgres://... npm run load-test   # a real Postgres (CI)
 *
 * The embedded database (PGlite, Postgres compiled to WebAssembly, single
 * threaded) lives under .loadtest/; its timings are an upper bound. With
 * LOAD_TEST_DATABASE_URL it runs against a real Postgres instead. That
 * database must be a throwaway one: rows are added to it. The app's
 * environment guard refuses a database production has used.
 *
 * With LOAD_TEST_BUDGETS=1 (CI) it also fails when:
 * - a query takes longer than its budget (BUDGET_MS below), or
 * - on a real Postgres, a query behind a list page, one claim or one
 *   patient would read a whole large table to find a handful of rows, which
 *   means a missing index. Postgres is asked how it would run each such
 *   query (EXPLAIN); a sequential scan of a table with more than
 *   BIG_TABLE_ROWS rows that is expected to keep under 1% of them fails the
 *   run. (Reading most of a table, such as counting every claim for a page
 *   total, is what a sequential scan is for; this test database holds one
 *   practice, so "the practice's claims" is the whole table.)
 * Results are printed as GitHub annotations and in the run summary.
 */
const REAL = !!process.env.LOAD_TEST_DATABASE_URL?.trim();
process.env.DATABASE_URL = REAL ? process.env.LOAD_TEST_DATABASE_URL!.trim() : "";
if (!REAL) process.env.PGLITE_DIR = process.env.PGLITE_DIR || ".loadtest/pg";
const ENFORCE = process.env.LOAD_TEST_BUDGETS === "1";
const BIG_TABLE_ROWS = 20_000;

import fs from "node:fs";
import { sql } from "drizzle-orm";

const TARGET = Number(process.env.LOAD_CLAIMS ?? 100_000);
const RUNS = 3;


async function main() {
  const { getDb } = await import("../src/db");
  const db = await getDb();
  const one = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  // The demo practice (the one with patients) is the one measured.
  const { id: practiceId } = await one<{ id: string }>(sql`SELECT p.id FROM practices p JOIN patients pt ON pt.practice_id = p.id GROUP BY p.id ORDER BY count(*) DESC LIMIT 1`);
  let { n } = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM claims WHERE practice_id = ${practiceId}`);
  console.log(`Practice ${practiceId}: ${n} claims before loading`);

  /** Adds `add` claims (with visits, charges, ledger entries and denials) to `target`, using the demo practice's patients and providers. */
  const load = async (target: string, add: number, prefix: string) => {
    const source = practiceId;
    await db.execute(sql`DROP TABLE IF EXISTS lt`);
    await db.execute(sql`
      CREATE TABLE lt AS
      WITH ins AS (SELECT array_agg(pi.id ORDER BY pi.id) AS ids, array_agg(pi.patient_id ORDER BY pi.id) AS pats, array_agg(pi.payer_id ORDER BY pi.id) AS pays, count(*)::int AS n
                   FROM patient_insurances pi JOIN patients p ON p.id = pi.patient_id WHERE p.practice_id = ${source}),
           pr AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM providers WHERE practice_id = ${source})
      SELECT g, gen_random_uuid() AS enc, gen_random_uuid() AS claim,
             ins.ids[1 + (g * 7919) % ins.n] AS pi, ins.pats[1 + (g * 7919) % ins.n] AS patient, ins.pays[1 + (g * 7919) % ins.n] AS payer,
             pr.ids[1 + g % pr.n] AS provider, (current_date - (g % 730))::date AS dos,
             (ARRAY['paid','paid','paid','paid','paid','paid','paid','paid','paid','paid','paid','paid','partially_paid','denied','denied','accepted','accepted','submitted','ready','rejected'])[1 + g % 20] AS status,
             (9000 + (g % 23) * 1500) AS line1, 2500 AS line2
      FROM generate_series(1, ${add}) g, ins, pr`);
    await db.execute(sql`INSERT INTO encounters (id, practice_id, patient_id, provider_id, date_of_service, place_of_service, diagnoses, status)
      SELECT enc, ${target}, patient, provider, dos, '11', '["E11.9","I10"]'::jsonb, 'billed' FROM lt`);
    await db.execute(sql`INSERT INTO charges (encounter_id, line_number, cpt, modifiers, units, charge_cents, dx_pointers)
      SELECT enc, 1, (ARRAY['99213','99214','99203','99204'])[1 + g % 4], '[]'::jsonb, 1, line1, '[1]'::jsonb FROM lt
      UNION ALL SELECT enc, 2, '36415', '[]'::jsonb, 1, line2, '[1]'::jsonb FROM lt`);
    await db.execute(sql`INSERT INTO claims (id, practice_id, encounter_id, patient_id, payer_id, patient_insurance_id, control_number, status, total_cents, submitted_at, created_at, updated_at)
      SELECT claim, ${target}, enc, patient, payer, pi, ${prefix} || lpad(g::text, 8, '0'), status, line1 + line2,
             CASE WHEN status = 'ready' THEN NULL ELSE dos + interval '2 days' END, dos + interval '1 day', dos + interval '20 days' FROM lt`);
    await db.execute(sql`INSERT INTO ledger_entries (practice_id, patient_id, claim_id, type, amount_cents, posted_at)
      SELECT ${target}, patient, claim, 'charge', line1 + line2, dos + interval '1 day' FROM lt`);
    await db.execute(sql`INSERT INTO ledger_entries (practice_id, patient_id, claim_id, type, amount_cents, group_code, reason_code, posted_at)
      SELECT ${target}, patient, claim, 'adjustment', ((line1 + line2) * 35 / 100), 'CO', '45', dos + interval '20 days' FROM lt WHERE status IN ('paid','partially_paid')`);
    await db.execute(sql`INSERT INTO ledger_entries (practice_id, patient_id, claim_id, type, amount_cents, posted_at)
      SELECT ${target}, patient, claim, 'insurance_payment', ((line1 + line2) * 55 / 100), dos + interval '20 days' FROM lt WHERE status IN ('paid','partially_paid')`);
    await db.execute(sql`INSERT INTO denials (practice_id, claim_id, category, carc, amount_cents, status, created_at)
      SELECT ${target}, claim, (ARRAY['eligibility','coding','authorization','medical_necessity','timely_filing'])[1 + g % 5], (ARRAY['27','16','197','50','29'])[1 + g % 5], line1 + line2,
             (ARRAY['open','open','in_progress','appealed','resolved'])[1 + g % 5], dos + interval '20 days' FROM lt WHERE status = 'denied'`);
    await db.execute(sql`DROP TABLE lt`);
  };

  /**
   * The rest of a busy practice's month, for `target`: 20 staff opening charts (the access log,
   * which grows faster than any other table), other audit entries, and two years of appointments.
   * Uses the demo practice's patients, like the claims.
   */
  const AUDIT_VIEWS = Math.round(TARGET * 2);
  const APPOINTMENTS = TARGET;
  const extras = async (target: string, prefix: string) => {
    const { n: views } = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE practice_id = ${target} AND action = 'patient_viewed'`);
    if (views < AUDIT_VIEWS) {
      await db.execute(sql`INSERT INTO users (practice_id, email, password_hash, name, role)
        SELECT ${target}, lower(${prefix}) || '-staff-' || g || '@loadtest.invalid', 'not-a-password-hash', 'Load test staff ' || g, 'biller'
        FROM generate_series(1, 20) g WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = lower(${prefix}) || '-staff-' || g || '@loadtest.invalid')`);
      await db.execute(sql`INSERT INTO audit_log (practice_id, user_id, action, entity, entity_id, details, at)
        SELECT ${target}, u.ids[1 + g % u.n], 'patient_viewed', 'patient', p.ids[1 + (g * 31) % p.n]::text, '{"via":"chart"}'::jsonb, now() - make_interval(mins => g % (31 * 24 * 60))
        FROM generate_series(1, ${AUDIT_VIEWS - views}) g,
          (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM users WHERE practice_id = ${target}) u,
          (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM patients WHERE practice_id = ${practiceId}) p`);
      await db.execute(sql`INSERT INTO audit_log (practice_id, action, entity, at)
        SELECT ${target}, 'claim_submitted', 'claim', now() - make_interval(mins => g % (365 * 24 * 60)) FROM generate_series(1, ${AUDIT_VIEWS / 2}) g`);
    }
    const { n: appts } = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM appointments WHERE practice_id = ${target}`);
    if (appts < APPOINTMENTS) {
      await db.execute(sql`INSERT INTO appointments (practice_id, patient_id, provider_id, starts_at, ends_at, type, status, confirmed_at)
        SELECT ${target}, p.ids[1 + (g * 13) % p.n], pr.ids[1 + g % pr.n],
          date_trunc('day', now()) + make_interval(days => (g % 760) - 730, hours => 8 + g % 9), date_trunc('day', now()) + make_interval(days => (g % 760) - 730, hours => 8 + g % 9, mins => 30),
          'office_visit', CASE WHEN (g % 760) >= 730 THEN 'scheduled' ELSE (ARRAY['completed','completed','completed','completed','no_show','cancelled'])[1 + g % 6] END,
          CASE WHEN g % 3 = 0 THEN now() END
        FROM generate_series(1, ${APPOINTMENTS - appts}) g,
          (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM patients WHERE practice_id = ${practiceId}) p,
          (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM providers WHERE practice_id = ${practiceId}) pr`);
    }
  };

  if (n < TARGET) {
    const t0 = Date.now();
    await load(practiceId, TARGET - n, "LT");
    n = TARGET;
    console.log(`Loaded ${TARGET} claims for the measured practice in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  // A second practice of the same size in the same tables, as in real use: queries for one practice must
  // find its rows through indexes rather than by reading everything. Its claims reuse the demo practice's
  // patients and providers; only its own visits, claims, ledger entries and denials are separate rows.
  if (process.env.LOAD_NEIGHBOUR !== "0") {
    const existing = await one<{ id: string } | undefined>(sql`SELECT id FROM practices WHERE name = 'Load test neighbour practice' LIMIT 1`);
    const neighbour = existing?.id ?? (await one<{ id: string }>(sql`INSERT INTO practices (name, tax_id, npi, address1, city, state, zip) SELECT 'Load test neighbour practice', tax_id, npi, address1, city, state, zip FROM practices WHERE id = ${practiceId} RETURNING id`)).id;
    const { n: has } = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM claims WHERE practice_id = ${neighbour}`);
    if (has < TARGET) {
      const t0 = Date.now();
      await load(neighbour, TARGET - has, "LN");
      console.log(`Loaded ${TARGET - has} claims for a second practice in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    await extras(neighbour, "LN");
  }
  {
    const t0 = Date.now();
    await extras(practiceId, "LT");
    // Everyone waiting and textable, at different hours: the waitlist's candidates query does the most work.
    await db.execute(sql`UPDATE patients SET sms_consent_at = coalesce(sms_consent_at, now()), phone = coalesce(phone, '5550100000') WHERE practice_id = ${practiceId}`);
    await db.execute(sql`INSERT INTO waitlist_entries (practice_id, patient_id, from_hour, until_hour)
      SELECT ${practiceId}, p.id, CASE WHEN row_number() OVER () % 3 = 1 THEN 12 END, CASE WHEN row_number() OVER () % 3 = 2 THEN 12 END
      FROM patients p WHERE p.practice_id = ${practiceId} AND NOT EXISTS (SELECT 1 FROM waitlist_entries w WHERE w.patient_id = p.id AND w.closed_at IS NULL)`);
    console.log(`Chart views, appointments and the waitlist ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  await db.execute(sql`ANALYZE`);

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
  const claims = await import("../src/server/claims");
  const patients = await import("../src/server/patients");
  const exp = await import("../src/server/practice-export");
  const access = await import("../src/server/access-anomalies");
  const enc = await import("../src/server/encounters");
  const waitlist = await import("../src/server/waitlist");
  const outcomes = await import("../src/server/appointment-outcomes");

  // A sample claim and patient for the single-record screens, and an upcoming time for the waitlist.
  const sample = await one<{ claim: string; patient: string }>(sql`SELECT id AS claim, patient_id AS patient FROM claims WHERE practice_id = ${practiceId} ORDER BY created_at DESC LIMIT 1`);
  const opening = await one<{ providerId: string; startsAt: Date; endsAt: Date }>(sql`SELECT provider_id AS "providerId", starts_at AS "startsAt", ends_at AS "endsAt" FROM appointments WHERE practice_id = ${practiceId} AND starts_at > now() ORDER BY starts_at LIMIT 1`);
  opening.startsAt = new Date(opening.startsAt);
  opening.endsAt = new Date(opening.endsAt);

  type Case = { name: string; run: (d: typeof db) => Promise<unknown>; selective?: boolean };
  const cases: Case[] = [
    { name: "Claims list, first page", run: (d) => lists.searchClaims(d, practiceId, { offset: 0, limit: 50 }), selective: true },
    { name: "Claims list, search by name", run: (d) => lists.searchClaims(d, practiceId, { q: "Garc", offset: 0, limit: 50 }) },
    { name: "Claims list, denied, page 20", run: (d) => lists.searchClaims(d, practiceId, { status: "denied", offset: 950, limit: 50 }), selective: true },
    { name: "Denials list", run: (d) => lists.searchDenials(d, practiceId, { status: "open", offset: 0, limit: 50 }), selective: true },
    { name: "One claim (claim page)", run: async (d) => Promise.all([claims.loadClaimBundle(d, sample.claim), claims.getClaimFinancials(d, sample.claim), claims.listAcknowledgments(d, sample.claim)]), selective: true },
    { name: "One patient (patient page)", run: async (d) => Promise.all([patients.getPatient(d, practiceId, sample.patient), billing.patientBalanceCents(d, sample.patient)]), selective: true },
    { name: "Dashboard KPIs (12 months)", run: (d) => a.headlineKpis(d, practiceId) },
    { name: "Monthly trend", run: (d) => a.monthlyTrend(d, practiceId) },
    { name: "A/R aging", run: (d) => a.arAging(d, practiceId) },
    { name: "Payer performance", run: (d) => a.payerPerformance(d, practiceId) },
    { name: "Provider productivity", run: (d) => a.providerProductivity(d, practiceId) },
    { name: "Denial reasons", run: (d) => a.denialReasons(d, practiceId) },
    { name: "Timely filing risk", run: (d) => a.timelyFilingRisk(d, practiceId) },
    { name: "Collections summary", run: (d) => a.collectionsSummary(d, practiceId) },
    { name: "Claims needing attention", run: (d) => a.claimsNeedingAttention(d, practiceId) },
    { name: "Patients with balances", run: (d) => billing.patientsWithBalances(d, practiceId, 1, 50) },
    { name: "Cash forecast", run: (d) => forecast.cashForecast(d, practiceId) },
    { name: "Payer behavior alerts", run: (d) => alerts.payerAlerts(d, practiceId) },
    { name: "Missed charges", run: (d) => recovery.missedCharges(d, practiceId) },
    { name: "Credit balances", run: (d) => recovery.creditBalances(d, practiceId) },
    { name: "Underpayment scan (all paid claims)", run: (d) => fees.scanUnderpayments(d, practiceId) },
    { name: "Chart access review (24 hours)", run: (d) => access.accessAnomalies(d, practiceId), selective: true },
    { name: "Schedule, one day", run: (d) => enc.listAppointments(d, practiceId, new Date()), selective: true },
    { name: "Waitlist: who can take an opening", run: (d) => waitlist.waitlistCandidates(d, practiceId, opening, [], waitlist.OFFER_TO), selective: true },
    { name: "Confirmations and no-shows (90 days)", run: (d) => outcomes.appointmentOutcomes(d, practiceId), selective: true },
  ];

  /**
   * Budgets in milliseconds, for a real Postgres at 100,000 claims (CI).
   * Generous on purpose: they catch a query that became several times
   * slower, not a few percent. Everything not listed gets DEFAULT_BUDGET_MS.
   */
  const DEFAULT_BUDGET_MS = 2_000;
  const BUDGET_MS: Record<string, number> = {
    "Claims list, first page": 500,
    "Claims list, denied, page 20": 500,
    "Denials list": 500,
    "One claim (claim page)": 300,
    "One patient (patient page)": 300,
    "Cash forecast": 5_000,
    "Underpayment scan (all paid claims)": 5_000,
  };
  const EXPORT_BUDGET_MS = 120_000;

  const failures: string[] = [];
  const rows: string[] = [];
  const results: { name: string; ms: number }[] = [];
  for (const c of cases) {
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      await c.run(db);
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    const ms = Math.round(times[Math.floor(RUNS / 2)]);
    const budget = BUDGET_MS[c.name] ?? DEFAULT_BUDGET_MS;
    results.push({ name: c.name, ms });
    rows.push(`| ${c.name} | ${ms} | ${budget} |`);
    console.log(`${c.name.padEnd(40)} ${String(ms).padStart(7)} ms`);
    if (ENFORCE && ms > budget) failures.push(`${c.name}: ${ms} ms, budget ${budget} ms`);
  }

  // On a real Postgres: would a query that should touch a few rows read a whole large table?
  if (REAL && ENFORCE) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const schema = await import("../src/db/schema");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const { rows: big } = await pool.query<{ relname: string; reltuples: number }>(`SELECT relname, reltuples FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND reltuples > $1`, [BIG_TABLE_ROWS]);
    const bigTables = new Map(big.map((r) => [r.relname, Number(r.reltuples)]));
    /** Large tables the plan reads in full to keep under 1% of their rows: an index would find those rows directly. */
    const fullScans = async (query: string, params: unknown[]) => {
      const { rows: [plan] } = await pool.query(`EXPLAIN (FORMAT JSON) ${query}`, params);
      const scans: string[] = [];
      const walk = (node: Record<string, unknown>) => {
        const table = String(node["Relation Name"]);
        const size = bigTables.get(table);
        if (node["Node Type"] === "Seq Scan" && size && Number(node["Plan Rows"]) < size * 0.01) scans.push(`${table} (to keep about ${node["Plan Rows"]} of ${Math.round(size).toLocaleString()} rows)`);
        for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) walk(child);
      };
      walk((plan["QUERY PLAN"] as { Plan: Record<string, unknown> }[])[0].Plan);
      return [...new Set(scans)];
    };
    // The check must catch a query with no index to use, or a pass means nothing.
    const canary = await fullScans("SELECT id FROM ledger_entries WHERE note = $1", ["load-test canary"]);
    if (!canary.length) failures.push("The missing-index check did not flag a lookup on an unindexed column (ledger_entries.note); the check itself is broken");
    else console.log(`Missing-index check: the unindexed canary lookup was flagged (${canary.join(", ")}), as it should be.`);
    for (const c of cases.filter((x) => x.selective)) {
      const captured: { query: string; params: unknown[] }[] = [];
      const logged = drizzle({ client: pool, schema, logger: { logQuery: (query, params) => captured.push({ query, params }) } });
      await c.run(logged as unknown as typeof db);
      for (const q of captured) {
        if (!/^\s*(select|with)\b/i.test(q.query)) continue;
        const scans = await fullScans(q.query, q.params as unknown[]);
        if (scans.length) failures.push(`${c.name}: reads all of ${scans.join(", ")} (missing index?) in: ${q.query.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
    await pool.end();
  }

  const t = performance.now();
  let bytes = 0;
  for await (const chunk of exp.practiceExport(db, practiceId)) bytes += chunk.length;
  const exportMs = Math.round(performance.now() - t);
  console.log(`${"Full practice export (zip)".padEnd(40)} ${String(exportMs).padStart(7)} ms, ${(bytes / 1e6).toFixed(1)} MB`);
  rows.push(`| Full practice export (${(bytes / 1e6).toFixed(1)} MB) | ${exportMs} | ${EXPORT_BUDGET_MS} |`);
  if (ENFORCE && exportMs > EXPORT_BUDGET_MS) failures.push(`Full practice export: ${exportMs} ms, budget ${EXPORT_BUDGET_MS} ms`);

  console.log(JSON.stringify({ database: REAL ? "postgres" : "embedded", claims: n, counts, results, exportMs, exportMB: +(bytes / 1e6).toFixed(1) }));
  if (process.env.GITHUB_ACTIONS) {
    // Annotations are readable on the run page without downloading logs.
    console.log(`::notice title=Load test (${n.toLocaleString()} claims)::${results.map((r) => `${r.name} ${r.ms} ms`).join("; ")}; export ${exportMs} ms`);
    for (const f of failures) console.log(`::error title=Load test::${f}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Load test, ${n.toLocaleString()} claims (median of ${RUNS}, ms)\n\n| Query | Measured | Budget |\n|---|---|---|\n${rows.join("\n")}\n`);
  if (failures.length) {
    console.error(`\nFailed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
