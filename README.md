# MedBill RCM

A cloud medical billing and revenue cycle management (RCM) web application. It covers the whole money path a medical practice walks every day:

```
Schedule → Verify eligibility → Capture charges → Scrub → Submit 837P →
Track status → Post 835 remittance → Work denials → Bill the patient → Report
```

The product scope was defined before any code was written. See [docs/01-product-definition.md](docs/01-product-definition.md) for the feature inventory, personas, workflows, and regulatory scope; [docs/02-data-model.md](docs/02-data-model.md), [docs/03-architecture.md](docs/03-architecture.md), and [docs/04-roadmap.md](docs/04-roadmap.md) cover the rest.

## What works today

| Area | Implemented |
|---|---|
| **Scheduling** | Multi-provider day view, booking, check-in, no-show, check-in → charge entry handoff |
| **Patients** | Registration, demographics, guarantor-less policy ranks, search by name or MRN, ledger and visit history |
| **Eligibility** | Real-time 270/271 check with stored benefit snapshot (plan, copay, deductible, remaining, out-of-pocket max) |
| **Charge entry** | ICD-10 and CPT pickers with fee-schedule autofill, modifiers, units, diagnosis pointers, up to 12 diagnoses and 50 lines |
| **Claim scrubbing** | 22 Level-1 rules, each unit-tested: NPI check digit, Tax ID, taxonomy, POS, ICD-10 format, dangling diagnosis pointers, duplicate lines, timely filing, E/M with procedure missing modifier 25 |
| **Claims** | 837P generation (X12 005010X222A1), batch submit, clearinghouse acknowledgment, status timeline, corrected claims with frequency code 7 |
| **Remittance** | 835 parsing and auto-posting: payments, CO contractual adjustments, PR transfers to patient, CARC/RARC capture, unmatched-claim exception list |
| **Denials** | Auto-created from 835 denial codes, categorized, prioritized by appeal deadline then dollars, with plain-language explanation and next steps |
| **Patient billing** | Patient balance, payment posting (card, cash, check), ledger split between insurance and patient AR |
| **Reporting** | KPI dashboard (days in AR, clean-claim rate, denial rate, net collection rate), AR aging by payer, payer mix and reimbursement, 6-month charge vs payment trend |
| **Platform** | Session auth with three roles, append-only financial ledger, audit log on PHI and financial actions, JSON API, health endpoint |

## Stack

Next.js 16 (App Router, React 19, Server Actions), TypeScript in strict mode, Tailwind CSS 4, Drizzle ORM, PostgreSQL, Recharts, Vitest.

The database is PostgreSQL either way. With no `DATABASE_URL` the app runs **PGlite**, real Postgres compiled to WebAssembly, stored in `./data/pg`, so it starts with zero setup. Point `DATABASE_URL` at a Postgres server and the same schema and migrations run there instead.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first boot the app creates the schema and seeds a demo practice: 3 providers, 6 payers, 28 patients, 14 appointments, 40 encounters, and a claim population already pushed through submission, adjudication, payment, and denial so every screen has real data.

Sign in with any of:

| Email | Password | Role |
|---|---|---|
| admin@medbill.local | admin123 | admin |
| biller@medbill.local | biller123 | biller |
| frontdesk@medbill.local | front123 | front desk |

```bash
npm test        # scrub-rule and EDI round-trip tests
npm run typecheck
npm run build
```

Optional environment variables are documented in `.env.example`.

## Try the full cycle

1. **Scheduling** → check a patient in → **Enter charges**.
2. Add diagnoses and CPT lines. Saving builds a claim and scrubs it immediately.
3. On the claim, fix any blocking errors, then **Submit to clearinghouse**. The generated 837P is shown on the page.
4. **Remittance** → **Fetch ERAs from clearinghouse**. Payments, adjustments, and patient responsibility post automatically, and denials appear in the worklist.
5. **Denials** → read the explanation, then create a corrected claim, transfer the balance, or write it off.
6. **Dashboard** and **Reports** reflect every posting instantly.

Three seeded member IDs are deliberately rigged so the unhappy paths are visible: IDs ending in `X` are rejected at the clearinghouse before reaching the payer, and IDs ending in `D` come back denied on the 835.

## Deploying to Vercel

The app is Vercel-ready, but it needs a Postgres database: serverless instances
have an ephemeral, read-only filesystem, so the embedded PGlite database used
for local development cannot run there. Startup fails with an explicit message
rather than a confusing filesystem error if `DATABASE_URL` is missing.

1. **Create a Postgres database.** Neon, Supabase, and Vercel Postgres all work.
   Copy the **pooled** connection string, not the direct one.
2. **Import the repository** at [vercel.com/new](https://vercel.com/new). Next.js
   is detected automatically; no build configuration is needed.
3. **Set environment variables** for the Production environment:

   | Variable | Value |
   |---|---|
   | `AUTH_SECRET` | output of `openssl rand -base64 32` |
   | `DATABASE_URL` | pooled Postgres connection string |
   | `SEED_DEMO_DATA` | `true` for a demo deployment, otherwise leave unset |
   | `ANTHROPIC_API_KEY` | optional, enables AI denial explanations |

4. **Deploy.** Migrations run on the first request, guarded by a Postgres
   advisory lock so simultaneous cold starts cannot race each other.

From the command line instead:

```bash
npx vercel login
npx vercel link
npx vercel env add AUTH_SECRET production
npx vercel env add DATABASE_URL production
npx vercel --prod
```

`SEED_DEMO_DATA=true` **truncates the application tables** before loading the
demo practice, so never set it against a database holding real data. Without it
a fresh database deploys empty, and empty means no accounts exist to log in
with, so create one before or after the first deploy.

Check `/api/health` after deploying: it reports which database backend is live
and how many claims it can see.

## Clearinghouse and AI are behind interfaces

`ClearinghouseGateway` in [src/lib/clearinghouse/gateway.ts](src/lib/clearinghouse/gateway.ts) is the seam for a real vendor (Stedi, Claim.MD, Availity). The bundled `MockClearinghouse` adjudicates deterministically from a hash of the member ID, so demos and tests are reproducible. Swapping in a real vendor means implementing three methods.

Denial explanations run rules-first from a CARC/RARC dictionary. Set `ANTHROPIC_API_KEY` and [src/lib/ai/explain.ts](src/lib/ai/explain.ts) upgrades them to Claude-generated guidance, sending only codes and de-identified context, never names, dates of birth, or member IDs, and falling back to the rules on any error.

## Not production-ready yet

This is a working Phase-1 build, not a certified product. Before touching real protected health information you need: a real clearinghouse contract and payer enrollment, an AMA license to ship CPT descriptions, Postgres row-level security enforced per tenant, encryption at rest with a managed key, signed business associate agreements, and a security review. The roadmap tracks these.

## License

MIT
