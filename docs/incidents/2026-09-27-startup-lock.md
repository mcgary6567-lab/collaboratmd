# 2026-09-27: every database request hung after a deploy

**Impact.** From about 12:28 to 12:47 UTC (roughly 20 minutes), `/api/health` and every page and API route that reads the database hung until the platform timed them out. Pages that do not touch the database (sign-in form, marketing pages) loaded. No data was lost or changed. No patient data was exposed.

**Detection.** Found by running the new live check (`scripts/live-check.mjs`) by hand right after the deploy: `/api/health` gave no answer within 15 seconds, twice. The scheduled live check had not started running yet, and nothing checked the deployment automatically.

## Timeline (UTC)

- 12:28: commit `e17152e` deployed to production.
- ~12:35: the live check fails on `/api/health`; `curl` confirms requests hang for 40 s or more.
- ~12:38: the database shows one pooled connection (PgBouncer) holding the start-up advisory lock (key 8147236), idle, and another start waiting on it.
- 12:47: commit `0525eb8` deployed; health answers in 0.3 s.

## Cause

On its first request, each server instance ran migrations under a session-level advisory lock: `pg_advisory_lock` before, `pg_advisory_unlock` after. Production connects through Neon's pooler, which is PgBouncer in transaction mode: every statement can run on a different server connection. The lock was taken on one server connection and the unlock sent to another, where it did nothing, so the first connection kept the lock after the instance finished. Every later cold start waited on `pg_advisory_lock` forever, with no timeout.

The flaw had been there since start-up locking was added. It went unnoticed because lock and unlock usually landed on the same server connection when traffic was light. CI only ran against the embedded database, which has no pooler.

## Fix

- `0525eb8`: start-up takes no lock when nothing is pending, and otherwise uses a transaction-scoped lock (`pg_advisory_xact_lock`) with the migrations inside that one transaction, under a new key so the stale lock cannot block it.
- Follow-ups, same day:
  - migrations run in the build (`scripts/migrate.ts`), so no request waits on them;
  - start-up gives up with an error after 15 s waiting for the lock, and 25 s overall, so health returns 503 and alerts fire instead of requests hanging;
  - every production deployment is checked as soon as it is live (`.github/workflows/after-deploy.yml`), with optional automatic rollback;
  - CI runs start-up and the built app against real Postgres behind PgBouncer in transaction mode (`scripts/startup-check.ts`), including several simultaneous starts and a start that cannot get the lock;
  - the codebase was checked for other state that assumes one connection per session (`SET` without `LOCAL`, session locks, prepared statements, temporary tables, `LISTEN`). None was found.

## Left over

The old lock (key 8147236) may still be held by one pooled server connection until the pooler recycles it. Nothing uses that key any more. To clear it by hand, an operator can end that connection: find it in `pg_locks` where `locktype = 'advisory' AND objid = 8147236`, then run `pg_terminate_backend(pid)`. That is safe; the pooler reconnects.

## Rule

Behind a transaction-mode pooler, anything that must span statements (locks, settings) must live inside one transaction: `pg_advisory_xact_lock`, `SET LOCAL`. Never a session lock or plain `SET`.
