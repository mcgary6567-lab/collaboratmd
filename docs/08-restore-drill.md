# Restore drill

A backup nobody has restored is a hope, not a backup. Run this drill every quarter and after any change to the Neon plan. It restores into a **separate branch** and never touches production.

Recovery targets to prove (adjust once the pilot shows what practices need):

- **RPO** (data you can afford to lose): 5 minutes, which needs Neon's point-in-time history to cover the period.
- **RTO** (time to be back up): 1 hour.

## Automated monthly drill

`.github/workflows/restore-drill.yml` runs `scripts/restore-drill.ts` on the 3rd of every month (and by hand from Actions → Restore drill → Run workflow):

1. restores production as it was an hour ago into a temporary Neon branch;
2. connects to it, and checks that migrations are recorded without gaps, that practices, users, patients, claims, ledger entries and audit log rows are there, that the ledger guard trigger exists, and that the copy accepts writes (rolled back);
3. reports how long the restore took (the RTO so far) in the run's annotations and summary;
4. deletes the branch, even when a check fails.

It prints counts only, never patient data. To switch it on, create a Neon API key (Neon console → Account settings → API keys) and add it as the repository secret `NEON_API_KEY`, and add the project ID (Project settings → General) as the repository variable `NEON_PROJECT_ID`. Without them the workflow reports that it was skipped.

The point in time must be inside the project's history window: 6 hours on Neon's Free plan, 1 day by default (up to 7 or 30) on paid plans. The automated drill checks that a restore works; the manual drill below also checks that a specific record you wrote down is there, and practises the steps a person would take in an incident. Keep doing the manual drill quarterly.

## Before the first drill (one time)

1. In the Neon console, open the project → Settings and check the **history window** (what Neon calls the period you can restore from). Set it to at least 7 days; longer if the plan allows. The length depends on the Neon plan, so confirm it there rather than assuming.
2. Note the production branch name (usually `main` or `production`) and that `DATABASE_URL` in Vercel points at its **pooled** endpoint.
3. Decide who runs drills and where results are recorded (a row in the table at the end of this file is enough).

## The drill (about 30 minutes)

1. **Pick a moment.** Choose a time about an hour ago, and write down a fact you can check, for example the newest claim's control number at that time. Find it with a read-only query in the Neon SQL editor against production:
   ```sql
   SELECT control_number, created_at FROM claims ORDER BY created_at DESC LIMIT 3;
   ```
2. **Branch from the past.** In Neon, create a new branch from the production branch, choosing the option to include data up to a specific date and time, and enter the moment from step 1. Name it `drill-YYYY-MM-DD`. Start the timer.
3. **Check the data.** Connect to the new branch (SQL editor, or `psql` with its connection string) and confirm:
   ```sql
   SELECT count(*) FROM practices;
   SELECT count(*) FROM patients;
   SELECT count(*) FROM claims;
   SELECT control_number, created_at FROM claims ORDER BY created_at DESC LIMIT 3;
   SELECT max(posted_at) FROM ledger_entries;
   ```
   The newest claim must match what you noted, and nothing newer should appear.
4. **Check the app runs on it.** Locally, with the drill branch's pooled connection string in a temporary shell variable (never in a committed file):
   ```bash
   DATABASE_URL="<drill branch pooled URL>" npx next dev -p 3100
   ```
   Sign in with a real administrator account of your own. Open a patient, a claim and the ledger, and run a report. Nothing should error. Don't send anything to patients or payers from this copy; leave integrations unconfigured in that shell.
5. **Check a practice export.** From Settings → Data export on the drill copy, download the zip and open `README.txt` and `tables/claims.csv`.
6. **Stop the timer.** Record how long steps 2 to 4 took.
7. **Clean up.** Delete the `drill-...` branch in Neon. It holds a full copy of PHI.

## Record

| Date | Run by | Restore point | Data matched | App ran | Minutes | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

## A real restore (production data damaged)

Only when data was lost or corrupted. It is not the fix for an outage.

1. Stop writes: promote a maintenance deployment, or set the Vercel project to a password-protected state, so users do not keep adding to the damaged data.
2. Find the last good moment using a branch from the past, as in the drill, or Neon's Time Travel queries.
3. Choose one of these:
   - **Restore the branch in place** (Neon's instant restore on the production branch, under Backup & Restore). Neon keeps the pre-restore state in an automatically created backup branch, so you can go back. Everything written after the restore point is lost unless you copy it out of that backup branch first.
   - **Copy back only what was lost** from a past-data branch, if the damage is narrow (one practice, one table). This is slower but keeps other practices' later work.
4. Reopen writes, confirm with the checks from drill step 3, and tell affected practices what time their data now reflects and what they need to re-enter.
5. If the cause was unauthorized access, it is also a potential breach: follow `docs/legal/hipaa-policies.md`, section 9.
