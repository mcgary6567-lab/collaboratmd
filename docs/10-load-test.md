# Load test

`npm run load-test` builds a throwaway practice with 100,000 claims (230,000 ledger entries, 10,000 denials, two years of visits) in an embedded database under `.loadtest/`, then times the queries behind the busiest screens and jobs. It never touches `DATABASE_URL`.

## In CI

The "Real Postgres behind a pooler" CI job runs the same load test against a real Postgres (through PgBouncer in transaction mode) on every push, with `LOAD_TEST_BUDGETS=1`:

- each query has a time budget (`BUDGET_MS` in `scripts/load-test.ts`); a query over it fails the build;
- for the queries behind list pages, one claim and one patient, Postgres is asked how it would run them (`EXPLAIN`); a plan that reads the whole of a table with more than 20,000 rows to keep under 1% of it fails the build as a probable missing index. Reading most of a table (counting every claim for a page total, say) is not flagged: that is what a full scan is for, and the test database holds a single practice.

The timings appear as an annotation on the run and in its summary. To run it against your own throwaway Postgres: `LOAD_TEST_DATABASE_URL=postgres://... LOAD_TEST_BUDGETS=1 npm run load-test`. It adds rows, and refuses a database production has used.

## How to read these numbers

The embedded database is PGlite: Postgres compiled to WebAssembly, single-threaded, on a laptop. It is several times slower than a Neon compute running the same query plans, so treat these as upper bounds. They are good at showing queries whose cost grows with the data, which is what this test is for. Repeat it on a Neon branch before a large practice goes live.

The generated practice has many claims but only the demo's 28 patients, so per-patient screens (a patient's ledger, statements) are not represented here.

## Results, 26 September 2026 (median of 3 runs, milliseconds)

| Query | Before fixes | After fixes |
|---|---|---|
| Claims list, first page | 365 | 487 |
| Claims list, name search | 857 | 805 |
| Claims list, denied, page 20 | 150 | 215 |
| Denials list | 241 | 218 |
| Dashboard KPIs, 12 months | 1,264 | 1,228 |
| Monthly trend | 610 | 482 |
| A/R aging | 701 | 691 |
| Payer performance | 345 | 351 |
| Provider productivity | 911 | 934 |
| Collections summary | 745 | 701 |
| Patients with balances | 299 | 289 |
| **Cash forecast** | **4,837** | **about 2,400** |
| Payer behavior alerts | 484 | 527 |
| **Credit balances** | **3,064** | **1,382** |
| Full practice export (32.5 MB zip) | 67,818 | 59,834 |

Differences under about 20% between runs are noise on this engine.

## What changed

- **Cash forecast:** the payer paid-rate query checked the ledger once per claim; it now joins one set of paid claims. The ledger scans are also bounded by date, since a payment cannot come before the claim or visit it pays, which lets them use the practice/type/date index.
- **Credit balances:** balances are now totaled per claim from the ledger alone, and patient and payer names are joined only for the few overpaid claims instead of for every claim.
- **Practice export:** it pages by id instead of by offset, so the last page of a large table costs what the first does, in pages of 5,000 rows.

## Limits worth knowing

- **Export time:** 100,000 claims exported in about a minute here. Direct downloads run inside one request, which Vercel stops at 300 seconds, so the practical ceiling is several hundred thousand claims. For larger practices, turn on file storage (`FILE_STORAGE=blob`). Exports are then prepared in the background, kept for 7 days, and downloaded when ready. The same 300-second limit applies to the background job, so very large practices still need an export split across several runs; that isn't built.
- **Dashboard and reports** stay around a second at this size on PGlite, which is acceptable for screens opened a few times a day. The dashboard KPIs are the next candidate for caching if Neon timings disagree.
