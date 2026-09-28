# Incident response runbook

For the people who operate CollaboratMD. The policy is in `docs/legal/hipaa-policies.md` (sections 5 and 9); this is what to do, in order. Write down what you do and when, as you do it: the timeline is part of the record.

## Severity

| Level | Examples | Start within |
|---|---|---|
| **1: patient data may be exposed** | access by someone who should not have it, a leaked database URL or key, a practice seeing another practice's data | immediately |
| **2: the service is down or wrong** | sign-in failing, claims not going out, payments posting wrongly | 1 hour |
| **3: degraded** | a slow page, one integration failing for one practice | next business day |

## First hour (levels 1 and 2)

1. **Confirm.** Check `/ops/errors`, `/status`, Vercel's deployment and function logs, and Neon's monitoring. Note the time you found out.
2. **Contain.**
   - A person or account: end their sessions (Settings → Team, or Settings → Sign-in security → end every session for a practice), disable the account.
   - A leaked secret: rotate it where it lives (Vercel environment variables, Neon role password, GitHub secrets), redeploy, and check the audit log for use since the leak.
   - An integration: disconnect it from the practice's Integrations page.
   - A bad deployment: promote the previous deployment in Vercel. Migrations only add, so the previous code runs on the new schema.
   - Damaged data: stop writes and follow "A real restore" in `docs/08-restore-drill.md`.
3. **Preserve evidence.** Export the affected practice's audit log (Settings → Audit log) and the relevant platform logs before they age out. Do not copy patient data into tickets or chat.

## Investigate

- Who did what, when, from the audit log (sign-ins, chart access, exports, settings changes) and `/ops/errors`.
- For possible exposure, list each practice and each patient affected, what information was involved, and whether it was actually viewed or taken.

## Tell people

- **Practices affected:** the administrators, without unreasonable delay and as the business associate agreement requires, with what happened, what information was involved, what we have done, and what they should do. The practice is the covered entity and decides on notifying patients and HHS; give them what they need to do it.
- **Everyone else:** for level 2, a note on the status page while it lasts.

## Afterwards

Within a week: a written review (timeline, cause, what stopped it, what changes so it cannot happen again), filed with the security policies, and the changes made. Update the risk analysis if the incident showed a risk it missed.
