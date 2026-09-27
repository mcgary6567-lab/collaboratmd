# Threat model

Written by the engineering team from the code as it stands. It is a working document, not an audit: an independent security review and penetration test are still to be commissioned, and their findings should be added here.

## What we protect

| Asset | Where it lives | Why it matters |
|---|---|---|
| Protected health information (patients, visits, diagnoses, claims, remittances, documents) | Neon Postgres; attachments in the database | HIPAA; harm to patients if disclosed |
| Money movement (ledger, refunds, write-offs, payments) | Postgres ledger (append-only by convention), Stripe | Theft or concealment through adjustments |
| Practice secrets (Stedi, Stripe, Twilio, Resend, Anthropic keys, FHIR tokens, SSO settings) | Postgres, sealed with AES-GCM under `AUTH_SECRET`-derived key | Access to third-party accounts and the data behind them |
| Sessions and sign-in | Signed JWT cookie (HS256, `AUTH_SECRET`), bcrypt password hashes | Account takeover |
| Platform configuration (`DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`) | Vercel project settings only; never in the repository | Full compromise |

## Who might attack

1. Someone on the internet with no account: credential stuffing, guessing portal links, abusing public endpoints (contact form, webhooks, SCIM, SSO callbacks).
2. A signed-in user of one practice reaching another practice's data (tenant isolation).
3. A signed-in user exceeding their role: a front-desk user writing off balances, a biller issuing refunds alone.
4. A departed employee whose access was not removed.
5. A compromised third party sending forged callbacks (Stripe, Twilio, identity provider).
6. A patient portal link that leaks through forwarding, browser history or referrer headers.

## Controls in place

**Sign-in**
- bcrypt hashes; a dummy compare for unknown emails so response time does not reveal accounts.
- Per-account lockout after repeated failures (15 minutes).
- Per-address attempt budgets on sign-in, second factor, password reset and portal checks (`server/throttle.ts`), stored as a hash of the address.
- TOTP second factor with recovery codes; administrators can require it.
- Password reset by one-time emailed link; using it ends every other session. The request form gives the same answer whether or not the account exists.
- OpenID Connect and SAML 2.0 single sign-on. SAML responses must answer a request we issued (InResponseTo, stored once), and signatures are checked against the configured certificate. Enforced SSO blocks password sign-in for the practice's domains.
- SCIM 2.0 bearer token (hashed) to deactivate people when they leave.
- Session length and IP allowlists per practice, and "sign everyone out" for administrators.

**Tenant isolation and roles**
- Every query is scoped by `practiceId` from the session, and object IDs from the browser are checked with `assertOwned` before use.
- Roles plus capabilities (`requireRole`, `requireCapability`); custom roles can only narrow the built-ins.
- Two-person rules where policy asks for them: refunds approved by a second person; write-off limits by role; risk holds on high-risk claims.
- Audit log of sign-ins, exports, adjustments and settings changes, viewable by administrators.

**Money**
- Posted ledger entries cannot be changed or deleted, enforced by a database trigger (migration 0042) as well as the application; corrections post new entries.

**Data in transit and at rest**
- TLS everywhere (Vercel), with HSTS.
- Neon encrypts storage at rest. Practice secrets are additionally sealed in the application.
- Error reports have emails, phone numbers, IDs and long numbers masked before storage.
- Notification titles and email digests carry no patient details.

**Browser**
- A strict Content-Security-Policy on every page (`src/proxy.ts`): scripts run only with the request's nonce, so injected scripts and inline handlers do not execute. A production-build crawl of the main pages found no violations.
- Security headers (`next.config.ts`): HSTS, `nosniff`, framing denied (`X-Frame-Options` and `frame-ancestors`), a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Referrer-Policy `strict-origin-when-cross-origin`, and `no-referrer` on pages whose address carries a secret token (portal, reset, check-in, welcome, unsubscribe).
- Session cookie is `httpOnly`, `secure` in production, `sameSite=lax`; server actions carry Next.js origin checks.

**Callbacks and integrations**
- Stripe webhooks verified by signature; Twilio requests verified by `X-Twilio-Signature`.
- Cron endpoint requires `CRON_SECRET` compared in constant time; without it the job does not run.
- Outgoing webhooks are signed; FHIR paging links to another host are refused.
- Clinical text goes to Anthropic only when the practice has marked its BAA as signed.

**Patient portal**
- Links are random tokens, expire after 30 days, require date of birth, and lock after repeated wrong answers.

## Known gaps and accepted risks

| Gap | Risk | Plan |
|---|---|---|
| Styles may still be inline (CSP allows inline style attributes) | Injected CSS could restyle a page, not run code | Accepted; charts and layout rely on style attributes |
| Attachments stored in Postgres by default | Database size and backup time grow | Private Vercel Blob storage is built (`FILE_STORAGE=blob`); turn it on once the Vercel BAA covers Blob, and move existing files from the operator console |
| Per-address budgets are shared by everyone behind one office NAT | A busy office could hit the sign-in budget (30 per 15 minutes) | Raise the budget or key it on address plus email if support tickets show it |
| The ledger guard is a trigger the database owner could disable | Someone with owner access could still rewrite history | Run the application under a role that does not own the tables, so it cannot drop the trigger |
| Secrets stay under the AUTH_SECRET-derived key until SEAL_KEYS is set and the operator re-encrypts | Rotating AUTH_SECRET before that makes them unreadable | Set SEAL_KEYS and re-encrypt from /ops/practices before the first rotation |
| No independent penetration test yet | Unknown unknowns | Commission before the first paying practice goes live |
| Point-in-time recovery depends on Neon plan settings | Data loss window | Configure PITR and run the restore drill in `docs/08-restore-drill.md` |

## How to report a vulnerability

The public page at `/security` gives the contact address. Reports are acknowledged within two business days.
