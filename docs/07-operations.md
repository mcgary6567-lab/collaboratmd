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

The app has no built-in uptime pinger; use an external monitor so an outage is noticed even when the app cannot send anything.

1. Pick any HTTP monitor (Better Stack, UptimeRobot, Pingdom, Checkly and similar all work).
2. Monitor `GET https://<your domain>/api/health` every 1 to 5 minutes.
   - Healthy: HTTP 200 with `{"ok":true,...}`. It runs `SELECT 1` against the database, so it fails when Neon is unreachable.
   - Unhealthy: HTTP 503 `{"ok":false}`, or a timeout.
3. Alert after 2 consecutive failures, to the same people as below.
4. Optionally monitor `https://<your domain>/login` for a 200 to catch rendering failures the health route would miss.
5. The public `/status` page shows the same database check plus recent error counts; link it from support replies during an incident.

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

## Routine checks

| When | What |
|---|---|
| Daily | Glance at `/ops/errors`; confirm the daily job ran (Vercel → Cron Jobs) |
| Weekly | Review Vercel function errors and Neon storage growth |
| Monthly | `npm audit` and dependency updates; review platform operator list |
| Quarterly | Restore drill (`docs/08-restore-drill.md`); access review prompt goes to every practice admin automatically |
| Yearly | Rotate `CRON_SECRET` and integration keys; HIPAA risk assessment |

## Secrets

Never commit `.env.local`. To rotate:

- `CRON_SECRET`: set a new value in Vercel and redeploy. Vercel Cron picks it up automatically.
- `AUTH_SECRET`: signs everyone out. Before the first rotation, set `SEAL_KEYS` and press "Re-encrypt stored secrets" in /ops/practices; otherwise integration keys and second-factor secrets become unreadable.
- `SEAL_KEYS` (encryption of stored secrets): put a new `id=key` at the front, deploy, re-encrypt from /ops/practices, then remove the old key and deploy again.
- Integration keys: replace them in the provider, then in Settings → Integrations or the Vercel env.
