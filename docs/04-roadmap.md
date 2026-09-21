# Roadmap

## Phase 0 — Foundations (weeks 1-3)
- Monorepo, CI, environments, Terraform skeleton.
- Tenancy, users, roles, RLS, audit log.
- Code libraries loaded (ICD-10-CM, HCPCS, POS, modifiers, CARC/RARC, taxonomy). CPT pending AMA license.
- Payer master + provider enrollment data.
- Clearinghouse sandbox account and `ClearinghouseGateway` stub.

**Exit:** a user can log in, create a practice, providers, payers; cross-tenant access test fails as expected.

## Phase 1 — MVP: professional claims end-to-end (weeks 4-12)
- Patients, insurance, guarantors, documents.
- Scheduling (basic) and check-in with copay capture (manual posting).
- Real-time eligibility 270/271 with stored benefit snapshot.
- Encounters, charges, superbills, fee schedules.
- Claim builder (837P), Level 1 scrub, batches, submission, 999/277CA/277 status.
- ERA 835 ingestion, auto-posting, exception queue; manual EOB posting; ledger.
- Basic denial worklist with resubmit/write-off/transfer.
- Patient statements (PDF, print/email).
- Standard reports + KPI dashboard (AR aging, claims by status, clean-claim rate, days in AR).
- Universal Import: CSV demographics and charges with saved mappings.

**Exit:** one pilot practice bills real claims via the clearinghouse sandbox then production, receives ERAs, and closes a month.

## Phase 2 — Automation and patient payments (weeks 13-24)
- Level 2 scrub rules (NCCI, MUE, payer edits), timely-filing alerts.
- Secondary/tertiary claims with COB; paper CMS-1500 printing.
- Card processing, card on file, text/email-to-pay, payment plans, prompt-pay discounts.
- Patient portal (balances, statements, pay, appointments).
- Reminders (SMS/email/voice), digital intake forms.
- Patient Responsibility Estimator (Good Faith Estimate).
- Tasks and work queues; denial workflow with appeal letters and deadlines.
- Custom report builder with scheduling and sharing; billing-company portfolio dashboard.
- HL7 v2 inbound (ADT, DFT); SSO.
- AI: rejection explainer and import column mapping (Claude API, PHI-minimized).

## Phase 3 — Scale and specialty segments (weeks 25+)
- Institutional claims (837I / UB-04) and lab billing workflows.
- Lab interfaces (Quest, LabCorp, LabDAQ), FHIR R4.
- Claim attachments (275), collections/dunning and agency export.
- AI: denial prioritization and pattern analytics, coding suggestions, task priority signals.
- White-label branding, public API, broadcast messaging, USPS address scrubbing.
- Reporting warehouse (ClickHouse) if Postgres aggregation limits are hit.

## MVP cut line (what we will NOT build before pilot)
Card processing, portal, reminders, Level 2 scrubbing, secondary claims, custom report builder, any AI, HL7, institutional claims, white-label.

## Risks
| Risk | Mitigation |
|---|---|
| Clearinghouse onboarding and payer enrollment delays (weeks) | Start vendor selection and enrollment paperwork in Phase 0 |
| CPT licensing cost | Ship HCPCS/ICD-10 first; customers load CPT; budget AMA license before GA |
| EDI edge cases (835 with reversals, takebacks, interest, PLB segments) | Golden-file test corpus from day one; exception queue rather than silent failure |
| HIPAA scope creep in logs/AI | PHI redaction middleware; PHI-free AI prompts; security review gate per phase |
| Reporting performance at billing-company scale | Materialized AR/claims facts refreshed on ledger events |
