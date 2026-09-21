# Architecture

## 1. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (React, TypeScript), Tailwind, shadcn/ui, TanStack Table/Query | Dense data grids, fast iteration, SSR for portal SEO not needed but fine |
| Backend API | NestJS (TypeScript) with REST + OpenAPI; modular monolith | One language across stack, strong DI/module boundaries, easy to split later |
| Database | PostgreSQL 16 with row-level security; Prisma or Drizzle ORM | RLS gives hard tenant isolation; JSONB for 271/835 raw payloads |
| Jobs / queues | BullMQ on Redis | Claim batches, ERA polling, statement runs, reminders, retries |
| File storage | S3-compatible (encrypted, versioned) | EDI files, PDFs, insurance cards, attachments |
| Search / reporting | Postgres materialized views + read replica; ClickHouse later if needed | 125+ reports need pre-aggregated AR/claims facts |
| Auth | Auth service with MFA, SAML/OIDC SSO (Phase 2); short-lived JWT + refresh | Billing companies need SSO and per-client scoping |
| EDI | X12 parser/generator library (e.g. `node-x12` / `stedi` SDK) behind an internal `EdiService` | Isolate 837/835/270/271 from domain code |
| PDF | Headless Chromium (Playwright) for CMS-1500, UB-04, statements | Pixel-accurate forms |
| AI | Claude API (`claude-sonnet-5` default, `claude-fable-5-1` for complex mapping) via a `AiAssistService` with PHI minimization | Rejection explanations, import column mapping, coding hints |
| Infra | Docker, AWS (ECS/Fargate or EKS), RDS, ElastiCache, S3, KMS; Terraform | HIPAA-eligible services, BAA available |
| Observability | OpenTelemetry, structured logs with PHI redaction, Sentry | Required for audit and support |

Alternatives considered: .NET 8 + Blazor (strong in healthcare, fine choice if the team is C#-first); Django (fast admin, weaker typing across stack). Pick TypeScript unless the team already lives in C#.

## 2. Modules (modular monolith boundaries)

```
apps/
  web/            Next.js staff app (scheduler, billing, reports, admin)
  portal/         Next.js patient portal + pay pages
  api/            NestJS
    modules/
      tenancy     organizations, practices, locations, providers, users, roles
      patients    demographics, insurance, documents
      scheduling  appointments, reminders, check-in
      eligibility 270/271 orchestration, benefit parsing, estimates
      coding      code libraries, favorites, superbills, fee schedules
      encounters  encounters, charges, imports (Universal Import)
      claims      claim builder, scrub engine, batches, submissions, status
      remittance  835 ingestion, matching, auto-post, exception queue
      ledger      append-only postings, balances, adjustments, refunds
      denials     worklists, appeals, actions
      patientbill statements, payment plans, card on file, pay links
      reporting   datasets, standard reports, custom builder, KPIs
      tasks       work queues, assignments, AI priority signals
      integrations clearinghouse, payments, HL7, lab, messaging adapters
      ai          rejection explainer, import mapper, coding hints
      audit       PHI access + financial change log
packages/
  edi/            X12 build/parse, code sets
  domain/         shared types, validation schemas (zod)
  ui/             shared components
```

Rule: modules talk through service interfaces and domain events (`ClaimSubmitted`, `RemittancePosted`, `DenialCreated`), never by reaching into another module's tables.

## 3. Integration adapters

| Adapter | Protocol | Notes |
|---|---|---|
| Clearinghouse | REST/SFTP; 837 out, 999/277CA/277/835 in; 270/271 real-time | Interface `ClearinghouseGateway` with vendor implementations (Stedi, Claim.MD, Availity). Sandbox first. |
| Payments | Processor REST + webhooks; hosted fields or tokenization so card data never touches our servers | Interface `PaymentGateway`; Stripe first. |
| EHR inbound | HL7 v2 over MLLP/SFTP (ADT A04/A08, DFT P03), CSV drop | Mirth-style listener service or a managed HL7 gateway |
| FHIR | R4 REST client (Phase 3) | Patient, Coverage, Claim, EOB |
| Lab | HL7 ORM/ORU from Quest/LabCorp/LabDAQ (Phase 3) | Maps result codes to billable CPT via config |
| Messaging | SMS/email/voice provider | Reminders, statements, pay links; opt-out tracking |

## 4. Claim scrub engine

- Rule DSL stored in DB (`ScrubRule`) with a versioned evaluator; rules tagged by level (1 structural, 2 payer/specialty), payer scope, specialty scope, effective dates.
- Runs synchronously on save (under 500 ms target) and again at batch time.
- Level 1 examples: NPI check digit, dx pointer validity, POS vs CPT, modifier format, subscriber DOB, timely filing.
- Level 2 examples: NCCI PTP edits, MUE units, gender/age code edits, payer-required modifiers, LCD/NCD medical necessity dx-to-CPT.
- Output feeds both the UI (blocking errors vs warnings) and the AI explainer.

## 5. Security and compliance design

- **PHI boundary:** all PHI in Postgres/S3 inside a private VPC; KMS-managed keys; TLS 1.2+ everywhere.
- **Tenant isolation:** Postgres RLS with `SET app.tenant_id` per request; tests assert cross-tenant reads fail.
- **AuthZ:** RBAC + scope (org/practice/location); read-only roles for practice admins of billing-company clients.
- **Audit:** every PHI read of a patient record and every financial write logged with actor, IP, before/after; audit store is append-only and exportable.
- **Secrets:** vault/KMS; no credentials in config files.
- **PCI:** hosted payment fields; store only processor tokens; SAQ-A scope.
- **PHI and AI:** send minimum necessary (codes, rejection text, no names/DOB) to the Claude API; log prompts without PHI; BAA in place.
- **Backups:** daily encrypted snapshots, point-in-time recovery, tested restores quarterly.
- **Retention:** soft delete + legal hold; purge jobs honor state retention rules.

## 6. Environments and delivery

- `dev` (seeded synthetic data), `staging` (clearinghouse sandbox, processor test mode), `prod`.
- CI: lint, typecheck, unit tests, EDI golden-file tests (837/835 fixtures), RLS isolation tests, e2e (Playwright) for claim lifecycle.
- Feature flags per tenant for plan-gated features (Level 2 scrubbing, estimator, SMS).
- Synthetic test data only; never load real PHI outside prod.
