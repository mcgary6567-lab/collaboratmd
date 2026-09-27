# Operations

How to know the platform is up, hear about failures, and respond. Written for whoever is on call, which today is the founding team.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Web app, API, server actions | Vercel (project `collaboratmd`), deployed on every push to `main` | Functions time out at 300 s |
| Database | Neon Postgres (pooled connection in `DATABASE_URL`) | Point-in-time restore depends on the plan's history window |
| Daily job | Vercel Cron → `/api/cron/daily` at 13:00 UTC (`vercel.json`) | Needs `CRON_SECRET`. Runs eligibility, claim status checks, statements, reminders, ERA pickup, daily checks, digests, FHIR sync, webhook retries, throttle cleanup |
| Email, SMS, payments, clearinghouse | Resend, Twilio, Stripe, Stedi | Per practice (Settings → Integrations) or deployment-wide env vars |

## Uptime monitoring

**Built in:** the "Live check" GitHub Action (`.github/workflows/live-check.yml`) runs `scripts/live-check.mjs` every 10 minutes from outside: `/api/health` must return `{"ok":true}`, `/login` must render the sign-in form with a nonce in its Content-Security-Policy, and `/` and `/status` must load. A failing check is retried after 30 seconds, so one blip does not alert.

- A failed run emails whoever last changed the workflow's schedule (GitHub's default for scheduled workflows).
- To alert the operators' channel too, add the repository secret `OPS_ALERT_WEBHOOK_URL` (Settings → Secrets and variables → Actions). It receives `{"text": ...}`, the same as the app's own alerts.
- To check another address, set the repository variable `LIVE_URL`.
- Run it by hand from Actions → Live check → Run workflow, or locally: `node scripts/live-check.mjs https://collaboratmd.vercel.app`.

Limits: GitHub may start scheduled runs several minutes late when busy, and turns schedules off after 60 days with no activity in the repository. It checks from GitHub's network only. For paging-grade monitoring, also use an external monitor:

1. Pick any HTTP monitor (Better Stack, UptimeRobot, Pingdom, Checkly and similar all work).
2. Monitor `GET https://<your domain>/api/health` every 1 to 5 minutes.
   - Healthy: HTTP 200 with `{"ok":true,...}`. It runs `SELECT 1` against the database, so it fails when Neon is unreachable.
   - Unhealthy: HTTP 503 `{"ok":false}`, or a timeout.
3. Alert after 2 consecutive failures, to the same people as below.
4. The public `/status` page shows the same database check plus recent error counts; link it from support replies during an incident.

## Error alerts

Every server error is recorded, with patient details masked, in `error_events` and listed at `/ops/errors` for platform operators (`PLATFORM_ADMIN_EMAILS`).

Operators are also told when:

- a new kind of error appears (at most one alert per 30 minutes), usually a bad deploy; or
- errors burst: `OPS_ALERT_THRESHOLD` (default 25) errors within 10 minutes (at most one alert per hour).

Set any of these on the Vercel project:

| Variable | Channel |
|---|---|
| `PLATFORM_ADMIN_EMAILS` | Email through `RESEND_API_KEY` |
| `OPS_ALERT_PHONES` | Text through `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |
| `OPS_ALERT_WEBHOOK_URL` | JSON `{"text": "..."}` POST; a Slack incoming webhook accepts it directly |

With none set, nothing is sent, and errors are still listed at `/ops/errors`.

## Request IDs

Every request gets an ID (a valid incoming `X-Request-Id` is kept, otherwise a new one is made), returned in the `X-Request-Id` response header. Server errors are logged as one JSON line with `requestId`, `route`, `method` and `digest`, and `/ops/errors` shows the last request ID for each error. To trace a report, search the Vercel function logs for that ID.

## Problem reports and usage

- The **?** button on every screen has "Report a problem with this page". Reports go to `/ops/feedback` and alert operators through the channels above. The alert names only the practice and the page; read the report itself in `/ops/feedback`. Mark each one resolved when handled.
- Answer a report from `/ops/feedback` with "Send reply". The person who reported it reads the answer in their notifications; their email only says an answer is waiting, since email is not a safe place for anything that might mention a patient. The reply can mark the report resolved at the same time.
- Administrators see "Not tried yet" on their dashboard: up to three useful screens nobody in the practice opened in the last 60 days, once the practice has been live for two weeks. Each can be dismissed.
- Screens opened are counted per practice per day, by address pattern only (ids replaced by `:id`, no query strings). `/ops/practices` shows the most used screens over 30 days, for deciding what to improve and for spotting practices that stopped using something.

## Large exports

With file storage configured, the data export runs in the background. A practice too large for one run is split into parts (tables over 100,000 rows are sliced, about 250,000 rows or 300 attachments per part). Each run builds parts for up to three minutes, then starts the next run by calling `/api/export/jobs/<id>/continue` on the site's own address (`APP_URL`, else the production domain) with a signed token. The administrator downloads each part from Settings → Data export. If an export shows "failed", its error says why; start a new one.

## Data retention

The daily job deletes operational records past their period. Clinical and financial records (patients, claims, the ledger, remittances, statements, documents) are never deleted here; they go only when a practice closes.

| Records | Kept (days) | Minimum | Variable |
|---|---|---|---|
| Read notifications | 365 | 30 | `RETENTION_NOTIFICATIONS_DAYS` |
| Unread notifications | 730 | 90 | `RETENTION_UNREAD_NOTIFICATIONS_DAYS` |
| Resolved server errors | 180 | 30 | `RETENTION_RESOLVED_ERRORS_DAYS` |
| Integration doctor results | 365 | 30 | `RETENTION_INTEGRATION_CHECKS_DAYS` |
| Delivered webhook attempts | 365 | 30 | `RETENTION_WEBHOOK_DELIVERIES_DAYS` |
| Daily usage counts | 730 | 90 | `RETENTION_USAGE_DAYS` |
| Resolved problem reports | 730 | 90 | `RETENTION_FEEDBACK_DAYS` |
| Record of texts and emails sent | 2555 | 2190 | `RETENTION_MESSAGES_DAYS` |
| Audit log | 2555 | 2190 | `RETENTION_AUDIT_LOG_DAYS` |

A value below the minimum is ignored and the default used. The daily job's response includes how many rows each rule removed. Confirm the periods with counsel and with your BAAs before relying on them; some states and payer contracts require longer.

## When something breaks

1. **Confirm.** Open `/status` and `/ops/errors`. Check the Vercel deployment list and the Neon console for incidents.
2. **Bad deploy?** If errors started with a deployment, promote the previous deployment in Vercel (Deployments → ⋯ → Promote to Production). This takes seconds and needs no code change. Then fix forward on a branch.
3. **Database?** If `/api/health` returns 503, check Neon status and the project's compute. Do not rotate `DATABASE_URL` unless it was leaked.
4. **Integration down?** Stedi, Stripe or Twilio failures show as errors on those routes. Claims stay queued and the daily job retries; tell affected practices.
5. **Tell people.** If practices are affected for more than 15 minutes, email the administrators of affected practices with what is affected and when you will update next.
6. **Mark resolved** in `/ops/errors` once fixed, so a return of the same error alerts again.
7. **Write it up** within 5 business days: what happened, impact, timeline, cause, what changes. If patient data may have been exposed, follow the breach steps in `docs/legal/hipaa-policies.md` (section 9) immediately; do not wait for the write-up.

## Self-serve signup and subscriptions

- `/signup` emails a confirmation link through the deployment's `RESEND_API_KEY`. Without it the form says the email could not be sent, and no practice is created.
- New practices start a trial of `TRIAL_DAYS` (default 14). After it ends, claims stop going out until an administrator subscribes (Settings → Subscription). Everything else keeps working, including the data export. Practices created by us rather than by signup are never held to this.
- Subscriptions run on CollaboratMD's own Stripe account, separate from any practice's:
  1. In Stripe, create a product per plan with a per-unit recurring price (one unit per provider) matching `/pricing`, monthly and, if offered, annual. For per-claim billing, create a meter and a metered price on it.
  2. Set `PLATFORM_STRIPE_SECRET_KEY`, the `PLATFORM_PRICE_*` IDs, and optionally `PLATFORM_PRICE_CLAIMS` with `PLATFORM_CLAIM_METER_EVENT` (the meter's event name).
  3. Add a webhook endpoint at `/api/platform/stripe/webhook` for `checkout.session.completed` and `customer.subscription.created`, `updated` and `deleted`, and set its secret as `PLATFORM_STRIPE_WEBHOOK_SECRET`.
  4. Turn on Stripe's customer portal (Billing → Customer portal) so practices can change cards, see invoices and cancel.
- The daily job sets each subscription's quantity to the practice's active providers and reports claims sent to the meter.
- Try the whole flow with test-mode keys and prices first.

## Checks on every push

CI (`.github/workflows/ci.yml`) runs on every push and pull request:

- **Type check and unit tests**, with `npm audit --audit-level=high`: a known high or critical vulnerability in a dependency fails the build. Fix it by updating the package (Dependabot usually has a pull request open), or, if there is no fix and the code path is unused, record why in the pull request.
- **Production build and performance**: builds, then measures the most used screens on the production build against budgets for JavaScript size, server time, largest paint and layout shift (`e2e-perf/budgets.spec.ts`; the numbers appear in the run's summary). If a change legitimately needs more, raise that page's budget in the same pull request and say why.
- **End-to-end and accessibility**: the browser tests, and an accessibility check of every screen at desktop and phone width, including the screens for individual records and the patient pages.

CodeQL (`.github/workflows/codeql.yml`) scans the code for security problems on every push and weekly; findings appear under Security → Code scanning. Secret scanning and push protection are repository settings (Settings → Code security) and must be switched on there.

The runners are pinned to Ubuntu 24.04 because `ubuntu-latest` moves to 26.04 from October 19, 2026; move to 26.04 once Playwright supports it.

## Routine checks

| When | What |
|---|---|
| Daily | Glance at `/ops/errors` and `/ops/feedback`; confirm the daily job ran (Vercel → Cron Jobs) |
| Weekly | Review Vercel function errors and Neon storage growth; merge the Dependabot pull requests once CI is green |
| Monthly | `npm audit`; review platform operator list |
| Quarterly | Restore drill (`docs/08-restore-drill.md`); access review prompt goes to every practice admin automatically |
| Yearly | Rotate `CRON_SECRET` and integration keys; HIPAA risk assessment |

## Secrets

Never commit `.env.local`. To rotate:

- `CRON_SECRET`: set a new value in Vercel and redeploy. Vercel Cron picks it up automatically.
- `AUTH_SECRET`: signs everyone out. Before the first rotation, set `SEAL_KEYS` and press "Re-encrypt stored secrets" in /ops/practices; otherwise integration keys and second-factor secrets become unreadable.
- `SEAL_KEYS` (encryption of stored secrets): put a new `id=key` at the front, deploy, re-encrypt from /ops/practices, then remove the old key and deploy again.
- Integration keys: replace them in the provider, then in Settings → Integrations or the Vercel env.
