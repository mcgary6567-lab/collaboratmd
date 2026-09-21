# Medical Billing Software — Product Definition

**Status:** Definition phase (no code yet)
**Date:** 2026-09-21
**Reference benchmark:** CollaborateMD (collaboratemd.com) — medical billing, practice management, built-in clearinghouse, patient payments, EHR/lab integrations, AI features, pricing.

This document defines *what* we are building and *why* before any code is written. Companion documents:

- `02-data-model.md` — entities, relationships, key fields
- `03-architecture.md` — tech stack, services, integrations, security
- `04-roadmap.md` — phased delivery plan and MVP cut line

---

## 1. Vision

A cloud-based **Revenue Cycle Management (RCM) platform** that lets medical practices and third-party billing companies get paid faster with fewer denials. The core loop:

```
Schedule -> Register/Verify -> Capture charges -> Scrub -> Submit claim ->
Track -> Post payment (ERA/manual) -> Work denials -> Bill patient -> Collect -> Report
```

Everything else (portal, reminders, AI, integrations, analytics) exists to shorten or de-risk that loop.

## 2. Target customers (from CollaborateMD segments)

| Segment | Primary needs | Notes |
|---|---|---|
| **Medical practices** (primary care, behavioral health, PT, cardiology, 100+ specialties) | In-house billing, scheduling, patient collections, eligibility | 1-50 providers, 1-10 locations |
| **Medical billing companies** | Manage many client practices, multi-Tax-ID, per-client reporting, granular user access, white-label | Per-claim pricing model, unlimited users |
| **Labs and diagnostic facilities** | High-volume charge import from LIS, order/result-driven billing, Quest/LabCorp/LabDAQ interfaces | Institutional (837I/UB-04) as well as professional claims |

## 3. Personas

| Persona | Goals | Key screens |
|---|---|---|
| Front-desk / Scheduler | Book, check in, verify insurance, collect copay | Scheduler, Patient, Eligibility, Payment |
| Biller / Coder | Enter charges, scrub, submit, fix rejections, post payments | Charge entry, Claim worklist, Rejection queue, Payment posting |
| Denial / AR specialist | Work aging AR, appeals, follow-up tasks | Denial worklist, AR aging, Tasks |
| Practice manager / Owner | Cash flow, provider productivity, payer performance | Dashboards, Reports |
| Billing-company admin | Onboard clients, control access, cross-client KPIs | Client (tenant) admin, User/roles, Portfolio dashboard |
| Patient | See balance, pay, set up plan, get estimate | Patient portal, text-to-pay |
| System admin | Fee schedules, payers, code libraries, integrations | Settings |

## 4. Feature inventory (mapped from CollaborateMD)

Priority: **P0** = MVP, **P1** = Phase 2, **P2** = Phase 3+.

### 4.1 Practice management / front office
| Feature | Priority | Source |
|---|---|---|
| Patient registration and demographics, guarantor, multiple insurance policies (primary/secondary/tertiary) | P0 | PM page |
| Appointment scheduling (multi-provider, multi-location, resources, recurring) | P0 | PM page |
| Digital check-in and intake forms | P1 | Homepage, Pro plan |
| Appointment reminders (SMS/email/voice) | P1 | Add-on |
| Broadcast messaging to patients | P2 | Plan tiers |
| Address correction/scrubbing (USPS) | P2 | Optimize plan |
| Patient portal (scheduling, visit history, statements, payments) | P1 | PM/Payments page |

### 4.2 Eligibility and pre-service
| Feature | Priority | Source |
|---|---|---|
| Real-time eligibility (X12 270/271) on demand and batch pre-visit | P0 | Core plan "unlimited real-time eligibility" |
| Coverage snapshot stored per visit (copay, deductible, OOP, plan) | P0 | - |
| Patient Responsibility Estimator (Good Faith Estimate, No Surprises Act) | P1 | Pro plan |
| Prior authorization tracking | P1 | Implied |

### 4.3 Charge capture and coding
| Feature | Priority | Source |
|---|---|---|
| Charge entry (CPT/HCPCS, ICD-10-CM, modifiers, units, POS, dx pointers, NDC) | P0 | - |
| Specialty code libraries / favorites, superbill templates | P0 | Billing page |
| Fee schedules (per practice, per payer contract, effective dating) | P0 | Billing page |
| Universal Import: file-based (CSV/HL7) charge and demographics import with mapping | P0 (rules) / P1 (AI mapping) | AI page |
| Context-based coding suggestions (AI) | P2 | AI page |
| Lab charge auto-population from results | P2 | Lab page |

### 4.4 Claims and clearinghouse
| Feature | Priority | Source |
|---|---|---|
| Claim generation: professional (837P / CMS-1500) | P0 | - |
| Claim generation: institutional (837I / UB-04) | P1 | Labs segment |
| Claim scrubbing Level 1 (structural/required fields) | P0 | Core |
| Claim scrubbing Level 2 (payer-specific edits, NCCI, LCD/NCD, modifier rules) | P1 | Optimize plan |
| Electronic submission via clearinghouse partner, batch and real-time | P0 | - |
| Claim status tracking (X12 276/277 + clearinghouse status feeds) | P0 | - |
| Rejection queue with plain-language explanations (AI) | P0 (rules) / P1 (AI) | AI page |
| Secondary / tertiary claims with COB from primary ERA | P1 | - |
| Paper claims (CMS-1500 PDF print) | P1 | Pro plan |
| Claim attachments (275 / clearinghouse upload) | P2 | Pro plan |
| Timely-filing alerts | P1 | - |
| Claim follow-up worklists and tasks | P1 | Optimize plan |

### 4.5 Payments and remittance
| Feature | Priority | Source |
|---|---|---|
| ERA (X12 835) ingestion with auto-posting, CARC/RARC parsing | P0 | Core plan "unlimited ERA with auto-posting" |
| Manual insurance payment posting (EOB), adjustments, write-offs | P0 | - |
| Patient payment posting (cash/check/card) | P0 | - |
| Unapplied credits, refunds, transfers | P1 | - |
| Denial management: categorize, assign, appeal letters, resubmit | P0 (basic) / P1 (workflow) | Billing page |
| Denial prioritization and pattern analytics (AI) | P2 | AI page |

### 4.6 Patient financial experience
| Feature | Priority | Source |
|---|---|---|
| Patient statements (HFMA patient-friendly format), print/email/SMS | P0 (PDF) / P1 (multi-channel) | Payments page |
| In-app card processing, card on file, tokenized | P1 | Payments page |
| Text-to-pay / email-to-pay links | P1 | Payments page |
| Payment plans, prompt-pay discounts | P1 | Payments page |
| Collections workflow (dunning cycles, agency export) | P2 | - |

### 4.7 Reporting and analytics
| Feature | Priority | Source |
|---|---|---|
| Standard reports (AR aging by payer/patient, charges/payments/adjustments, claim status, denials, productivity, payer mix) | P0 | 125+ reports |
| KPI dashboard: clean-claim rate, first-pass acceptance, days in AR, denial rate, net collection rate | P0 | Billing-company page |
| Custom report builder (drag/drop, filters, grouping, charts, scheduling, share) | P1 | Core plan |
| Cross-client portfolio dashboard for billing companies | P1 | Billing-company page |

### 4.8 Platform, multi-tenancy, admin
| Feature | Priority | Source |
|---|---|---|
| Multi-tenant: Billing company -> Practices (Tax ID) -> Locations -> Providers | P0 | Billing-company page |
| RBAC with per-practice scoping, read-only roles, SSO (P1) | P0 | Billing-company page |
| Audit trail on all PHI access and financial changes | P0 | HIPAA |
| Payer master, provider credentialing data (NPI, taxonomy, payer IDs) | P0 | - |
| Task management / work queues | P1 | AI page |
| White-label branding for billing companies | P2 | Billing-company page |
| Document storage (quota per plan) | P1 | Plan tiers |

### 4.9 Integrations
| Feature | Priority | Source |
|---|---|---|
| Clearinghouse API (claims, ERA, eligibility, status) | P0 | Built-in clearinghouse |
| Payment processor (tokenized cards) | P1 | Patient payments |
| EHR inbound: HL7 v2 (ADT, DFT/charges), CSV Universal Import | P1 | EHR page |
| FHIR R4 (Patient, Coverage, Claim, ExplanationOfBenefit) | P2 | Modern standard (not on CMD page) |
| Lab interfaces: Quest, LabCorp, LabDAQ (HL7 ORM/ORU) | P2 | Lab page |
| SMS/email/voice provider | P1 | Reminders |
| Public REST/WebAPI for custom interfaces | P2 | Pricing page |

## 5. Core workflows (functional spec)

### 5.1 Visit-to-claim
1. Appointment created; eligibility auto-checked 1-3 days before visit.
2. Check-in: verify demographics, insurance card scan, collect copay (card on file).
3. Encounter charges entered (manually, superbill, or imported from EHR).
4. Claim auto-built from encounter; scrubber runs; errors block submission; warnings allow override with reason.
5. Claim batched and submitted to clearinghouse; 999/277CA acknowledgments update status.
6. Status polled or streamed: Accepted -> Pending -> Paid/Denied.

### 5.2 Remittance and posting
1. 835 files pulled daily from clearinghouse.
2. Match by claim control number / patient control number; auto-post paid amounts, apply adjustments per CARC group codes (CO, PR, OA, PI).
3. PR amounts move balance to patient responsibility; secondary claim auto-generated if secondary coverage exists.
4. Denials (claim-level or line-level with CARC in denial set) create Denial records in worklist.
5. Unmatched or partial matches land in an exception queue for manual posting.

### 5.3 Denial management
1. Denial categorized (eligibility, auth, coding, timely filing, duplicate, medical necessity, COB, other).
2. Assigned to user; SLA and appeal deadline tracked from payer rules.
3. Actions: correct and resubmit (frequency code 7), appeal (letter template + attachments), write-off with reason, transfer to patient.
4. Outcome recorded for pattern analytics.

### 5.4 Patient billing
1. After insurance adjudication, statement cycle runs (for example every 30 days, 3 statements then collections review).
2. Statement rendered (HFMA format), delivered per patient preference; each includes a pay link.
3. Payments post automatically to oldest open charges (configurable allocation).
4. Payment plans schedule auto-charges to card on file.

## 6. Standards and regulatory scope

| Area | Standard |
|---|---|
| Claims | X12 005010X222A1 (837P), X12 005010X223A2 (837I), CMS-1500 (02/12), UB-04 |
| Remittance | X12 005010X221A1 (835), CARC/RARC code sets |
| Eligibility | X12 005010X279A1 (270/271) |
| Claim status | X12 005010X212 (276/277), 277CA, 999 |
| Code sets | ICD-10-CM, CPT, HCPCS Level II, modifiers, POS codes, taxonomy, NDC |
| Identifiers | NPI (Type 1 and 2), Tax ID/EIN, payer IDs, CLIA (labs) |
| Privacy/security | HIPAA Privacy and Security Rules, HITECH, BAA with all vendors |
| Payments | PCI DSS via processor tokenization (target SAQ-A) |
| Patient billing | No Surprises Act (Good Faith Estimates), state balance-billing rules |
| Accessibility | WCAG 2.1 AA for patient portal |

Note: CPT is licensed by the AMA. Shipping a CPT code library requires an AMA license; budget for it or ship with HCPCS/ICD-10 only and let customers load CPT under their own license.

## 7. Non-functional requirements

- **Availability:** 99.9% for the app; clearinghouse submissions queued and retried on outage.
- **Performance:** claim scrub under 500 ms; ERA batch of 5,000 lines posts under 2 min; reports over 1M+ charges under 10 s using pre-aggregation.
- **Scale:** billing companies with 200+ practices, 5M claims/year.
- **Security:** encryption at rest and in transit, MFA, session timeouts, IP allowlist option, field-level PHI audit.
- **Data retention:** 7-10 years for claims/financials (state-dependent); soft delete only.
- **Auditability:** immutable ledger for all financial postings (append-only; corrections are reversals, never edits).
- **Multi-tenancy isolation:** row-level tenant scoping enforced at the data layer, not only the app layer.

## 8. Explicitly out of scope (v1)

- Full EHR / clinical charting (we integrate, we do not chart).
- Building our own direct payer connections (use a clearinghouse partner).
- Credentialing/enrollment services as a business process (we store credentialing data only).
- Being the merchant of record for payments (the processor handles PCI).

## 9. Key decisions to confirm before coding

| # | Decision | Recommendation |
|---|---|---|
| 1 | Clearinghouse partner | Developer-friendly API vendor (Stedi, Claim.MD, or Availity). Evaluate 837/835/270/276 support, sandbox, payer list, per-transaction pricing. |
| 2 | Payment processor | Stripe (with Connect for billing companies) or a healthcare-focused processor; must support tokenization, card on file, payment links. |
| 3 | Tech stack | See `03-architecture.md`: TypeScript full stack with PostgreSQL. |
| 4 | Initial segment | Start with **small practices + billing companies** on professional claims (837P). Institutional and labs in Phase 3. |
| 5 | AI features | Rules-based first; LLM-assisted rejection explanations and import mapping in Phase 2 using the Claude API. |
| 6 | Pricing model | Mirror the market: per-provider/month tiers for practices, per-claim for billing companies. Affects Tenant/Plan entities only. |
