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

**Built in:** the "Live check" GitHub Action (`.github/workflows/live-check.yml`) runs `scripts/live-check.mjs` every 5 minutes from outside (each run keeps checking for five and a half hours and the next is always queued, because GitHub starts scheduled runs hours apart when busy): `/api/health` must return `{"ok":true}`, `/login` must render the sign-in form with a nonce in its Content-Security-Policy, and `/` and `/status` must load. A failing check is retried after 30 seconds, so one blip does not alert.

**The five-minute run.** After each check that passes, the same workflow starts the site's five-minute run (`POST /api/cron/tick`, `src/server/tick.ts`): waitlist offers nobody has taken go to the next people on the list, the morning-of reminder goes out at 7:00 on each practice's clock and tomorrow's reminders at 10:00. Vercel's plan runs its own cron once a day (13:00 UTC), which still does everything else and sends any reminder the five-minute run missed. **To turn it on, add the repository secret `CRON_SECRET` with the same value as the Vercel project's `CRON_SECRET`.** Without it, nothing here changes except that reminders wait for the daily run and waitlist offers get one round.

**Knowing the checks themselves stopped.** Each five-minute run is recorded; the status page shows "Checks from outside: last one N minutes ago", and the daily job alerts the operators if the last one is over an hour old. That still leaves up to a day before anyone hears. For an alert within minutes, create a free heartbeat check (healthchecks.io or similar, expecting a ping every 5 minutes) and add its ping address as the repository secret `LIVE_HEARTBEAT_URL`: each passing check pings it, and the service alerts you when the pings stop, whatever the reason (GitHub not running the workflow, the site down, the workflow switched off after 60 quiet days).

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

## Patient access log

Opening a patient's chart, one of their claims, a statement or an estimate is recorded (the same person reopening the same record within 15 minutes is recorded once; link prefetches are not views). Administrators see it from the chart: **Access log**, which lists who opened what and when, what was done (links sent, statements mailed, attachments opened, changes), and the full practice exports in the same period, which include every patient.

Use it to review access and to investigate a suspected snooping incident. It is the practice's internal access log (HIPAA audit controls).

**Restricted patients.** An administrator can mark a patient **Restrict** on their page (a staff member, someone well known). Opening that patient's chart, claims, statements or estimates then asks for a reason and for proof that it is still the signed-in person: their password, or a code from their authenticator app when two-factor is on (someone at an unlocked desk has the session, not those). People who sign in with single sign-on have no password here, so their identity provider must have checked their credentials within the last 15 minutes: the gate's **Sign in again with single sign-on** asks it to (OpenID Connect `prompt=login`, `max_age=0`; SAML `ForceAuthn`) and brings them back to the record. The time the provider says it checked (`auth_time`, or the assertion's `AuthnInstant`) is what counts, so a provider that silently reuses its own session does not open the record; one that ignores the request gets an error saying so. Wrong answers count towards the same lockout as signing in. The reason goes in the access log, administrators get a notification (naming the staff member, not the patient), and the person can open that patient's records for 4 hours (restricting the patient again asks everyone again, the administrator who did it included).

Lists (patients, claims, the schedule) still show the name so the account can be worked. When records leave the app, the restricted patients among them get an entry on their access log ("Included in the claims export (CSV)") and administrators are notified: the claims, denials and collections CSVs, a saved report that shows the patient or MRN, and the full practice export (which includes everyone). Through the API, a key sees restricted patients only as `{ "id", "restricted": true }` in lists and gets `403 restricted` for their record and claims, unless an administrator ticked **Can read restricted patients** when creating it (Settings → Developers); each read by such a key is on the patient's access log under the key's name.

**Chart access review** (Settings → Chart access review, and a notification each morning): each person's charts opened in the last 24 hours against their usual, flagged at 40 or more charts in a day, at least 15 and over three times their usual, or 10 or more patients with no appointment within 30 days, no claim or payment in six months, and not new. Administrators set the limits on the same page to what is normal for their staff (the change is audited), and record what they found for each flag ("Record the review"); reviews stay in the audit log and the last 90 days are listed there. A flag is a prompt to ask, not a finding. It is not the accounting of disclosures a patient can request, which covers disclosures outside the practice and excludes treatment, payment and operations; keep that record separately.

## The demo practice

Lakeside Family Medicine is seeded with fictional patients and published sign-ins (they are in the seed and the public repository), and is marked as the demo (`practices.is_demo`). Visitors try it from **/demo** in one click, as a biller, the front desk or an administrator; the sign-in page never shows or pre-fills demo passwords. The public investors page reads figures only from the demo practice, never a customer's.

On the production deployment (`VERCEL_ENV=production`) the demo is **closed** unless the Vercel environment variable `DEMO_LOGINS=on` is set: the demo accounts cannot sign in at all, so their published passwords open nothing, and /demo offers a walkthrough and the free trial instead. Everywhere else (local, CI, preview deployments) it is open unless `DEMO_LOGINS=off`. A demo account is never a platform operator on production, whatever `PLATFORM_ADMIN_EMAILS` says. Better still, run the demo as its own Vercel project with its own database, and keep the production site for customers only.

## Claims for dependents and Medicare

When the patient is not the insured person (a child on a parent's plan, a spouse), the insurance records the insured person's name, date of birth, sex and, if different, address. Claims (837P, 837I, 837D) then send the insured person as the subscriber and the patient in loop 2000C, and eligibility checks (270) ask under the insured person with the patient as the dependent. The scrubber stops a dependent's claim that lacks the insured person. Professional claims carry the right filing indicator (SBR09: MB for Medicare Part B, MC for Medicaid, CI otherwise), and a traditional Medicare member ID must be an MBI (11 characters, like 1EG4-TE5-MK73). Self-pay patients can be registered without insurance.

**Solo providers, labs and referrals.** Settings → Practice profile says who bills: the practice (Type 2 group NPI, the default) or a solo provider under their own Type 1 NPI, whose name then goes in the billing provider loop (NM1\*85\*1). The CLIA number there is sent (2300 REF\*X4) on claims with a lab code (CPT 80000–89999); the scrubber stops a Medicare lab claim without a valid one and warns for other payers. Charge entry takes an optional referring provider (name and NPI, checked), sent in loop 2310A (NM1\*DN). Modifier GZ on a Medicare claim gets a warning (no ABN on file). Places of service come from the full CMS list; locations can only use codes on it. A Medicare payer defaults to 365 days to file and 120 to appeal, and more than 365 days is refused.

## Times and formats

Times are shown on the practice's clock with its zone ("Sep 28, 2026, 9:05 AM EDT"): the session carries the practice's time zone, and `fmtDateTime(date, s.timeZone)` formats with it. Appointment times are stored as clock times, so they go through `fmtClock` (no zone conversion). Calendar dates (date of service, birth) go through `fmtDate`, which never shifts them a day. Money is always `money()`. Phone numbers are stored as (407) 555-0100 and ZIP codes as 32801 or 32801-1234.

## Setup checklist

`/setup` is the one checklist: the go-live phases (practice, connections, first claims, what to confirm yourself) and then the rest of a full setup (fees, team, patients, EHR, payments, texts). The dashboard shows the steps still to do to administrators, with a link to it. `/settings/go-live` redirects there.

## Two-factor sign-in

Settings → Sign-in security has two rules: two-factor for everyone, and two-factor for administrators and anyone whose role can export (billers and read-only by default; a custom role without exports is left out). New self-serve practices start with the second on; existing practices choose. Someone the rule covers is asked to set it up before they can use the app, and the export routes refuse them until they do. People who sign in with single sign-on are not asked here: their identity provider is where their second factor belongs. The demo practice has both rules off, so the demo can be tried without a phone.

## Texts: confirm or cancel

Appointment reminders say "Reply C to confirm or X to cancel". A reply of C (or CONFIRM) marks the patient's next appointment within a week as confirmed ("Confirmed by text" on the schedule); X cancels it and notifies the front desk. The patient gets a reply in their language through Twilio's answer to the webhook, and it is kept in the texting inbox. The number must belong to exactly one patient. CANCEL is not used: carriers treat it as an opt-out word that stops all texts, and it still does that here.

**Same-day reminder** (Settings → Automation, off by default): the morning of the visit, a text to patients who have not replied C, at 7:00 on the practice's clock through the five-minute run (or with the daily run at 13:00 UTC when that is not set up). Visits less than an hour away are skipped.

**Delivery reports.** Each text is sent with a StatusCallback (`/api/twilio/status/<practice>`, signed by Twilio like the incoming-text webhook), so Twilio says whether it reached the phone. A reminder that did not arrive shows on the schedule as "Reminder not delivered: call" and is not sent again to the same dead number; a waitlist offer that did not arrive is counted on the schedule ("2 not delivered"). This needs the site's public address (`APP_URL`, or Vercel's production domain); locally there are no reports.

**Waitlist.** Staff add a patient from their page (**Add to the waitlist**, any provider or one, any time, mornings or afternoons), or patients ask on the online booking page (**No time that suits?**), and staff confirm the request on the schedule like a booking. When a time opens (a patient replies X, or staff press **Cancel** and then **Offer to waitlist** on the schedule), it is texted to up to 5 people on the list, oldest first, who are waiting for that provider or any, can come at that hour, have texting consent, and are free then. If nobody takes it within 30 minutes, the next 5 are texted (up to 4 rounds; this needs the five-minute run). Times less than 2 hours away are not offered. The first to reply B (or BOOK) is booked into it, confirmed, taken off the list and told; later replies are told it has gone; the front desk gets a notification. If someone was booked into the time by hand meanwhile, a B reply is told it has gone. Patients without texting consent stay on the list marked "call when a time opens". B, not YES: carriers treat YES as an opt-in word. Reports shows the no-show rate for patients who confirmed against those who did not, and how many offered times were filled (a comparison, not proof: patients who confirm were likelier to come anyway).

## Staff guide

The help button links to **The working day, by role** (`/guide`): the front desk, biller and administrator routines, step by step, each step linked to its screen. Update it when a screen it names changes.

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

## Deploys

1. **Migrations run in the build.** Vercel runs `npm run build`, which applies pending migrations (`scripts/migrate.ts`) before `next build`. A failed migration fails the build, and the running deployment stays live. A preview build against the production database skips migrating (the preview refuses that database anyway). Migrations must work with the code already live: add tables and columns; never rename or drop in the same deploy.
2. **Start-up cannot hang.** If a server instance still finds migrations pending, it takes a transaction-scoped lock. It gives up after 15 s waiting for the lock and 25 s overall, so `/api/health` answers 503 and alerts fire. Behind the pooler, never use session locks or plain `SET`; see `docs/incidents/2026-09-27-startup-lock.md`.
3. **Every production deploy is checked when it goes live** (`.github/workflows/after-deploy.yml`): the same checks as the scheduled live check. On failure GitHub emails whoever pushed, and `OPS_ALERT_WEBHOOK_URL` (repository secret) alerts the operators' channel.
4. **Automatic rollback (optional).** Add the repository secret `VERCEL_TOKEN` (vercel.com/account/tokens) and the repository variables `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (Vercel → Project → Settings → General), and a failed check rolls production back to the previous deployment. After a rollback, Vercel does not move production to new deployments until one is promoted (Deployments → ⋯ → Promote), so fix forward and promote the fix.

## Checks on every push

CI (`.github/workflows/ci.yml`) runs on every push and pull request:

- **Type check and unit tests**, which also runs ESLint (`npm run lint`: the Next.js and React rules, no warnings allowed) and `npm audit --audit-level=high`. The unit tests migrate and seed the test database once per run and load that snapshot in each test file (`src/test/global-setup.ts`), in under half the time of each file seeding its own (about 8 minutes instead of 18 on a laptop); a test that fakes the clock seeds its own. A known high or critical vulnerability in a dependency fails the build. Fix it by updating the package (Dependabot usually has a pull request open), or, if there is no fix and the code path is unused, record why in the pull request.
- **Production build and performance**: builds, then measures the most used screens on the production build against budgets for JavaScript size, server time, largest paint and layout shift (`e2e-perf/budgets.spec.ts`; the numbers appear in the run's summary). If a change legitimately needs more, raise that page's budget in the same pull request and say why.
- **End-to-end and accessibility**: the browser tests, run against a production build (`next build`, then `next start`; `E2E_DEV=1` uses the development server for quick local runs), and an accessibility check of every screen at desktop and phone width, including the screens for individual records and the patient pages. The same pass fails on any button, link or field that something else covers (a card sliding under its neighbour), and on any page wider than the screen (on a phone, the whole page sliding sideways).
- **Time of day** (three jobs): the time-sensitive browser tests (the schedule's today, online booking, charge entry to payment, the record screens with a check-in link) with the server's clock moved by libfaketime to 07:30, 21:30 and 00:30 in New York, since several bugs only showed in the practice's evening, when UTC is already on the next day. Daylight-saving changeovers are unit tests (`src/server/practice-time.test.ts`). Locally, each browser test run starts from an empty database (`E2E_KEEP_DB=1` keeps the last one).
- **Real Postgres behind a pooler**: start-up and the built app against Postgres through PgBouncer in transaction mode, the way Neon's pooler works: several starts at once, a start that cannot get the lock (it must fail within seconds), the load test at 100,000 claims with time budgets and a missing-index check (`docs/10-load-test.md`), and the live check against the running app (`scripts/startup-check.ts`).

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

## Code sets every year

- **ICD-10-CM** changes on **October 1** (and sometimes April 1). CMS publishes the files in the summer on its ICD-10 page ("Code Descriptions in Tabular Order"). Before October 1, load the new year's order file:
  `npm run import:code-sets -- icd10cm ./icd10cm_order_2027.txt 2027`
  Each code keeps the first and latest fiscal year that listed it: a new code is refused for earlier dates of service, a deleted one for later dates, and a category (header) code is never billable. Once any year is loaded, every diagnosis on every claim is checked; a date of service in a year not loaded yet gets a warning. Load earlier years' files too if practices bill older dates of service.
- **HCPCS Level II**: CMS's quarterly Alpha-Numeric HCPCS file, opened in Excel and saved as CSV, loaded under Settings → Code sets (or `npm run import:code-sets -- hcpcs file.csv "2026 Q4"`). Discontinued and not-yet-effective codes are refused for the date of service.
- **CPT** codes and descriptions belong to the AMA. The product ships only short labels of our own for a few dozen common codes; practices add their own codes, descriptions and fees under Fee schedules (CSV with code, description, fee). Showing AMA CPT descriptions needs an AMA distribution license.

## Paper claims, and clearinghouses by file

- **CMS-1500**: a professional claim's "Paper claim (CMS-1500)" button opens `/print/cms1500/<claim>`: data only for a pre-printed red form, a plain-paper copy with box captions, or an alignment test. Print at 100%. If the text sits off the boxes, set the alignment under Settings → Practice profile (millimetres right and down). "Mark as mailed" moves a ready claim to submitted.
- **Another clearinghouse** (Office Ally, Availity, Claim.MD...): Claims → Send by file downloads every ready claim as one 837 (one functional group per claim kind, one transaction set per claim), under the submitter and receiver IDs the practice enters there. After uploading it to the clearinghouse, "Mark as sent". The 999, 277CA and 835 files that come back are uploaded on the same page and read like polled ones; the same file twice is read once.
- **Workers' comp and auto**: payer types `workers_comp` (SBR09 WC) and `auto` (AM). Charge entry and the claim page take whether the condition is related to employment, an auto accident (with its state) or another accident, the accident date, and the insurer's claim number (CLM11, DTP*439, REF*Y4; boxes 10, 14 and 11b).

## NPI lookup

"Look up NPI" (practice profile, providers, locations, referring provider) asks CMS's public NPI Registry (`npiregistry.cms.hhs.gov`, no key) and fills the name, address, phone and taxonomy. Only the NPI is sent. If the registry is down, the fields are typed by hand as before.

## Subscription invoices

The platform Stripe webhook also takes `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided` and `invoice.marked_uncollectible`: add them to the webhook endpoint's events in Stripe. Invoices are listed on Settings → Subscription with Stripe's hosted invoice and PDF links. A failed payment notifies the practice's administrators in the app; the account emails send one reminder when it fails and a last one two days before claims pause.

## Security evidence

- `/trust/questionnaire` answers the usual vendor security questions (and downloads as CSV). Keep it true: when a control changes, change the answer in `src/content/security-questionnaire.ts`.
- Record every restore drill (docs/08-restore-drill.md) at `/ops/restore-tests`; the questionnaire shows the latest.
- Incidents: `docs/12-incident-response.md`.

## Medicare fee schedule

Each year, load CMS's Physician Fee Schedule files on Settings → Code sets (or the importer): the **PPRRVU** file saved as CSV (`mpfs_rvu`, with the calendar year; the conversion factor is read from the file or entered) and the **GPCI** file, Addendum E, saved as CSV (`mpfs_gpci`). Each practice then chooses its **Medicare payment locality** on the practice profile. With both:
- A paid Medicare claim with no contract on file is checked for underpayment against the fee schedule (office or facility rate by place of service, with the 50% multiple procedure reduction on codes marked for it).
- A payer contract can be built as a percentage of Medicare (Fee schedules → Add a schedule).
Anesthesia base units: CMS's file saved as CSV (code, base units), code set `anesthesia`.

## Medicare Secondary Payer and crossovers

A patient on Medicare shows the MSP questions on their page. The first "yes" in CMS's order makes Medicare secondary for that reason and records the MSP type on the Medicare coverage (sent as SBR05 on a Medicare-secondary 837P). Claims to Medicare as primary for a patient whose answers say Medicare is second are stopped (MSP_ORDER); a Medicare-secondary claim without a type is stopped (MSP_TYPE); a patient with Medicare and another plan and no answers in a year gets a warning. When Medicare's 835 says it forwarded the claim to a supplemental payer (NM1*TT, claim status 19-21, or remark MA18/N89), the claim records the crossover and no secondary claim is sent.

## Time-based codes

Charge entry and claim edits take minutes for timed therapy codes and anesthesia. "Units from minutes" applies CMS's 8-minute rule across the visit's timed codes. Checks: therapy codes need GP, GO or GN (error for Medicare); Medicare and Medicaid timed units may not exceed what the minutes allow; anesthesia needs minutes and AA/AD/QK/QX/QY/QZ. Anesthesia goes on the 837P in minutes (SV103 MJ).

## Text message registration

US carriers block unregistered business texts. Settings → Text message registration shows whether the practice's Twilio sender is registered (A2P 10DLC through its messaging service, or toll-free verification), prepares the brand and campaign answers from the practice's details and the texts the system actually sends, and checks again on demand (also part of the integration doctor, check `twilio.registration`). The Messages page warns while registration is not approved. HELP and INFO get an automatic reply with the practice's name and phone; STOP is handled as before.

## Shared import mappings

A practice saves a column mapping after importing a real export from another system. The platform operator can share it (Import patients → Share a mapping with every practice, named after the system and report); every practice whose file has the same columns gets it applied automatically. No mappings are shipped from memory.

## Passkeys

Settings → Sign-in security → Passkeys: add a passkey (fingerprint, face or device PIN). The sign-in page has "Sign in with a passkey". A passkey requires user verification, so it counts as two-factor for the practice's two-factor rules; the usual account rules still apply (deactivated accounts, SSO-only practices, network allowlist). Passkeys are bound to the site's address (APP_URL): they work on the production domain, not on preview deployments.

## Quality measures (MIPS)

Settings → Quality measures: each practice enters the measures it reports from this year's CMS specifications (visit codes, optional diagnoses and ages, and the quality data codes for met / not met / excluded). A qualifying claim shows the measure; choosing an outcome adds the code as a $0.00 line (quality codes are allowed at $0.00 and post nothing). Reports → Quality (MIPS) shows qualifying visits, reporting rate and performance rate per measure.

## Code search at full size

Diagnosis and HCPCS word search use a full-text index; code search is a range on the primary key. The load test adds 74,000 diagnosis codes and fails if either search reads the whole table.

## Drug lines (NDC)

A J-code line takes the NDC from the package (any printed layout: 4-4-2, 5-3-2, 5-4-1; stored as the 11-digit 5-4-2 form), the quantity and its unit (UN, ML, GR, F2, ME). It goes on the 837P as LIN*N4 and CTP (loop 2410) and in the shaded part of the CMS-1500 line. A J-code without an NDC is an error for Medicaid and a warning otherwise.

## Payer takebacks (835 PLB)

When a payer takes back an earlier overpayment from a later check (PLB WO or 72), posting the 835 posts the takeback to the claim its reference names (control number or payer claim number) as a reversal. Interest (L6) and other provider-level adjustments are listed with the check on the Remittance page. A takeback whose claim cannot be found notifies the practice and waits on the Remittance page to be matched by hand.

## Coverage for tomorrow's appointments

Settings → Automation → "Check coverage for tomorrow's appointments" runs the eligibility check for everyone on the next day's schedule (on the practice's clock) and notifies the front desk about anyone with inactive coverage, no insurance, or no answer from the payer.

## Appeal levels

Each denial's appeal page shows its levels. For Medicare: redetermination (120 days), QIC reconsideration (180 days from the decision), ALJ hearing, Medicare Appeals Council and federal court (60 days each). For other payers: the payer's appeal window, then a second level and external review, as a guide only (the plan or contract decides). Recording the payer's decision either resolves the denial or opens the next level with its deadline.

## Advance Beneficiary Notices (ABN)

A Medicare patient's page has an ABN card: prepare a notice (services, reason, estimated cost), print its details to copy onto CMS's own form CMS-R-131 (the official form must be used; the link is on the print page), then record the option the patient checked and the date signed. A new Medicare claim gets GA on lines covered by a signed option 1 (and loses GZ). Claim checks: GA without a signed notice (error), option 2 (the patient asked not to bill Medicare, error), and a signed option 1 without GA (warning).

## The 60-day overpayment rule

Medicare and Medicaid overpayments must be reported and returned within 60 days of being identified. On Billing → Credits each such overpayment shows its deadline; the clock starts on the day the payment that caused it was posted, and a biller can correct the identified date (it is audit logged). The daily job notifies when one is within 15 days of its deadline or late. A claim that is no longer overpaid stops its clock. The 2024 rule's suspension for a good-faith investigation (up to 180 days) is the practice's judgment: record it as a later identified date.

## Telehealth

Claim checks: 95 with 93 or FQ on the same line (error); GT on a Medicare claim (warning: Medicare retired it); POS 02 or 10 without a telehealth modifier for payers other than Medicare (warning). Load CMS's **List of Telehealth Services** each year (Settings → Code sets, `telehealth`, CSV with the HCPCS, status and audio-only columns, and the calendar year). Then a Medicare telehealth line whose code is not on that year's list, or billed audio-only (93/FQ) where the list does not allow it, gets a warning. With no list loaded for the year, that check does not run.

## Inpatient procedures and the UB-04

Facility claim entry takes up to six ICD-10-PCS procedures with dates (principal first), sent on the 837I as HI*BBR and HI*BBQ. Codes are checked for format (seven characters, no I or O) and dates within the stay; procedure codes on an outpatient bill get a warning. An institutional claim's "Printable UB-04 (plain paper)" button lays the claim out by form locator for review or for a payer that accepts a plain copy. It is not aligned to the red OCR form, so payers that scan paper UB-04s will not accept it: send the 837I.

## Surgical global periods

CMS's RVU file carries each code's global days (GLOB DAYS: 000, 010, 090). Once that year's file is loaded, a claim for a patient whose earlier encounter in this practice had a 10- or 90-day procedure is checked: an E/M visit inside the window needs 24, 25 or 57 (an error for Medicare and Medicaid, a warning otherwise), and another procedure needs 58, 78 or 79 (warning). Routine post-op visits go in as 99024 at $0.00, which the scrubber and charge entry accept.

## Medicare Advantage

A Medicare eligibility response that shows a Medicare Advantage plan (insurance type HN, or a plan named as Medicare Advantage, with the plan from loop 2120) is shown on the patient page and in tomorrow's coverage check. A claim to traditional Medicare within 90 days of such a response is stopped (MEDICARE_ADVANTAGE): add the plan as the patient's insurance and bill it. Stedi's JSON response is read for the insurance type and plan text; its related-entity fields are not mapped yet, so the plan's ID may be missing there.

## Supervising provider and practitioner credentials

Providers have a credential (Settings → Providers). Medicare underpayment checks expect 85% of the fee schedule for NPs, PAs and CNSs billing under their own NPI. Charge entry takes a supervising provider, sent in 837P loop 2310D (NM1*DQ) and in box 17 with DQ when there is no referring provider. The supervising provider must differ from the rendering one and pass the NPI check.

## Monthly care programs

A patient's page has Monthly care programs: record consent (required before billing), then log minutes through the month for CCM by clinical staff (99490, 99439 up to twice), CCM by the practitioner (99491), BHI (99484) or RPM treatment management (99457, 99458 up to twice). After the month ends, "Bill" creates one claim dated the month's last day, at the practice's standard charges, under the practitioner who logged the most time. CCM needs two or more conditions; staff and practitioner CCM are not both billed for a month; a billed month takes no more time.

## Frequency limits

Settings → Payer edits has a Frequency limit rule: a code at most N times in D days per patient (0 days for a lifetime), for one payer or all. The patient's earlier encounters (not voided) are counted. Enter the limits from CMS's or the payer's policy.

## Records requests

Records requests (Billing menu) tracks each payer request for medical records: Medicare ADR, RAC, TPE (45 days by default) and commercial audits (30 days), or the date on the letter. A claim with an open request cannot be written off or appealed until the records are marked sent. The daily job notifies a week before the due date and when it is past.

## Productivity and coding profile

Reports → Productivity (administrators): work RVUs per provider from the fee schedule year loaded for each visit, each provider's E/M level mix against the practice's, and a random sample of 10 visits for an internal chart review. A mix half a level or more from the practice's is marked as a prompt to review, not a finding.

## Prompt-pay interest

Settings → Prompt-pay law: the practice enters its state's statute (days to pay a clean claim, yearly interest, citation). Underpayments then lists commercial payments in the last year that took longer (counted from submission to the first payment), with simple interest on the amount paid, and a letter per payer. "Mark as sent" records the claims so they are asked about once. Self-funded ERISA plans are exempt from state prompt-pay law, and statutes differ on when the clock starts: check before sending.

## Duplicate claims

A claim is checked against the patient's other claims to the same payer for the same date of service. A code already on a claim that was sent (or paid) is stopped (DUPLICATE_CLAIM) unless the line has 76, 77 or 91; one on a denied claim is a warning to send a corrected claim (frequency 7) instead; one on a claim not yet sent is a warning. Voided and clearinghouse-rejected claims, and replacement or void claims in the same chain, are not counted.

## Birthday rule

For a dependent child on two commercial plans (both with the relationship "child" and the subscribers' dates of birth on file), the plan of the parent whose birthday comes first in the calendar year should be primary. A primary claim whose insurance order contradicts that gets a warning (COB_BIRTHDAY). Custody decrees and plans that do not follow the NAIC rule can change the order.

## Out-of-network disputes (No Surprises Act)

Billing → Out-of-network disputes tracks a claim from the plan's initial payment or denial: open negotiation must start within 30 business days (with CMS's standard notice), runs 30 business days, and IDR must start within the following 4 business days. Business days skip weekends and federal holidays (computed by the holiday rules, observed on the nearest weekday). The daily job warns 5 business days before each deadline. The notice and IDR themselves are filed on CMS's forms and portal.

## Sliding fee scale

Settings → Sliding fee scale: the year's HHS poverty guidelines (household of one, and each additional person) and the practice's discount tiers by percent of the guideline. On a patient's page, "Verify income" records household size, income and the proof seen; the tier's discount posts on each claim's patient share arising in the following year, and the daily job keeps it current. Posting is idempotent.

## Contract comparison and charge lag

Reports → Contract comparison: each non-Medicare payer's allowed amounts over a period against Medicare's fee schedule for the same claims (needs the locality and fee schedule files), and what a proposed percent of Medicare would have paid. Reports → Charge lag: days from visit to charges and from charges to submission, by provider.

## Medicaid managed care and monthly checks

A Medicaid eligibility response naming a managed care organization (entity Y2 in loop 2120, or an HMO benefit with its plan) is shown on the patient's page; a claim to state Medicaid in the same month is stopped (MEDICAID_MANAGED_CARE). Settings → Automation → "Re-check Medicaid every month" checks Medicaid patients with a visit in the next 30 days once each month and notifies the front desk of lost coverage or a managed care plan.

## Split/shared and teaching visits

Charge entry has "Split/shared visit or teaching setting": the practitioner the facility visit was shared with and the attestation that the billing practitioner did the substantive portion (FS is added to E/M lines), and whether the teaching physician was present for the key portion. Checks: FS required on a shared E/M, the attestation required (Medicare and Medicaid), a warning in office settings, GC requires the teaching physician's presence, GC with GE is refused, and GE on codes outside the primary care exception warns.

## Proof of timely filing

A claim denied for timely filing (CARC 29) has a "Proof of timely filing" page: the first electronic submission date, days after the date of service against the payer's limit, and each 999 and 277CA with its date and code, following any earlier claims it corrected or replaced. Drafting the appeal letter for such a denial adds the same record.

## Care gaps

Reports → Care gaps: Medicare patients due an annual wellness visit (last G0438/G0439 11 full months ago or more, or none here; "Send reminders" texts or emails them, at most once in 60 days, respecting opt-outs), chronic care management candidates (two or more of the practice's chronic condition groups in the last year, not enrolled; the groups start as an editable example list), and HCC recapture (conditions mapped to an HCC coded last year but not yet this year). HCC recapture needs CMS's ICD-10 to HCC mapping loaded as code set `hcc` with its payment year (CSV; the V28 column is used when there are several).

## Card on file

In the patient portal a patient can keep the card they pay with on file, authorizing charges for what they owe after insurance up to a limit they choose. The daily job (when Stripe is connected) sends a notice with the amount and date, then charges three days later no more than the balance still owed and never more than the limit; patients on a payment plan pay through the plan instead. The patient's page shows the card, recent notices and "Stop charging this card".

## Modifier audit

Reports → Productivity also shows each provider's share of E/M lines with 25 and of procedure lines with 59/XE/XS/XP/XU against the practice, marking rates half again above it, with a random sample of claims to review.

## Payer refund demands

Billing → Payer refund demands tracks each payer letter asking for an overpayment back: amount, claim, the date to answer (30 days by default) and any offset date. "Agree" requests the refund when the claim is overpaid on the books (otherwise the payer's offset settles it); "Dispute" records why and writes the letter. A PLB takeback for the claim marks the demand offset. The daily job warns 5 days before the answer date.

## Primary EOB for paper secondary claims

A secondary claim links to "Primary EOB page": the primary payer's adjudication rebuilt from its 835s (charged, allowed, paid, patient share, and each adjustment with its CARC group and reason), to print with the paper CMS-1500 for a secondary payer that does not take electronic coordination of benefits.
