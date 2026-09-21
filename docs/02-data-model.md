# Data Model

All tables carry `id (uuid)`, `tenant_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, and `deleted_at` (soft delete). Financial tables are append-only.

## 1. Tenancy and organization

```
Organization (billing company or standalone practice)
  └── Practice (one legal billing entity: Tax ID, NPI Type 2, billing address)
        ├── Location (service facility: address, POS code, NPI, CLIA)
        ├── Provider (rendering/billing/referring: NPI Type 1, taxonomy, credentials)
        │     └── ProviderPayerEnrollment (payer-specific provider IDs, effective dates)
        └── FeeSchedule -> FeeScheduleItem (code, modifier, amount, effective range)
User
  └── UserRole (role, scope: organization | practice | location)
Role -> Permission (resource, action)
AuditLog (actor, action, entity, entity_id, before, after, ip, at)
```

## 2. Patients and coverage

```
Patient (demographics, contact, preferred language, communication prefs, portal account)
  ├── Guarantor (self or responsible party)
  ├── PatientInsurance (policy: payer, member id, group, relationship, rank primary/secondary/tertiary, effective/term dates, copay)
  ├── EligibilityCheck (270 request, 271 response raw + parsed benefits, checked_at, status)
  ├── PriorAuthorization (payer, auth number, codes, units, valid range, status)
  ├── PatientDocument (insurance card images, consents, intake forms)
  └── PatientEstimate (Good Faith Estimate: codes, allowed, expected patient amount)
Payer (name, payer id per clearinghouse, type: commercial/Medicare/Medicaid/workers comp/self-pay, address, claim submission method, timely-filing days, appeal days)
```

## 3. Scheduling

```
Appointment (patient, provider, location, start/end, type, status, reason, resource, recurrence)
AppointmentType (duration, default CPT codes, color)
Reminder (appointment, channel, scheduled_at, sent_at, status, response)
CheckIn (appointment, arrived_at, forms_completed, copay_collected)
```

## 4. Encounters and charges

```
Encounter (patient, provider, location, date_of_service, POS, referring provider, auth, status)
  ├── EncounterDiagnosis (ICD-10 code, sequence 1-12)
  └── Charge (CPT/HCPCS, modifiers[4], units, charge_amount, dx_pointers, NDC, rendering provider, line note)
ChargeImport (source, file, mapping, row count, status) -> ChargeImportRow (raw, parsed, error)
CodeLibrary: CptCode, HcpcsCode, Icd10Code, Modifier, PlaceOfService, Taxonomy, Carc, Rarc
CodeFavorite (practice/provider, code, label)
SuperbillTemplate (practice, specialty, sections -> codes)
```

## 5. Claims

```
Claim (encounter, practice, payer, patient_insurance, claim_type P/I, frequency_code 1/7/8,
       total_charge, status, control_number, payer_claim_number, submitted_at,
       timely_filing_deadline, original_claim_id for corrections, cob_rank)
  ├── ClaimLine (charge, line_number, allowed, paid, adjustment, patient_resp, status)
  ├── ClaimScrubResult (rule_id, severity error/warning, message, field, resolved_at, override_reason)
  ├── ClaimSubmission (batch, clearinghouse_id, 837 payload ref, 999 status, 277CA status, sent_at)
  ├── ClaimStatusEvent (source: clearinghouse/277/ERA/manual, status code, category, message, at)
  ├── ClaimAttachment (type, document, control number)
  └── ClaimNote (user, text, at)
ClaimBatch (practice, created_at, submitted_at, count, clearinghouse batch id)
ScrubRule (level 1/2, code, payer scope, specialty scope, logic ref, message, active)
```

Claim status machine:
```
draft -> scrubbed(errors) -> ready -> submitted -> acknowledged(999) -> accepted(277CA) | rejected(277CA)
accepted -> pending -> paid | partially_paid | denied
rejected/denied -> corrected(new claim, freq 7) | appealed | written_off | transferred_to_patient
```

## 6. Remittance and payments (append-only ledger)

```
Remittance (835 file: payer, check/EFT number, amount, date, raw payload ref, posted status)
  └── RemittanceClaim (claim match, status code, charged, paid, patient resp)
        └── RemittanceLine (claim line match, paid, adjustments[] {group CO/PR/OA/PI, CARC, RARC, amount})
PaymentTransaction (source: insurance_era / insurance_manual / patient_card / patient_cash / patient_check / refund,
                    payer or patient, amount, method, reference, received_at, processor_txn_id, unapplied_amount)
LedgerEntry (charge_id, claim_line_id?, type: charge / insurance_payment / patient_payment / adjustment / write_off / transfer / refund / reversal,
             amount, reason_code, payment_transaction_id, posted_at, reverses_entry_id)
Denial (claim, claim_line?, category, CARC, RARC, amount, assigned_to, priority, appeal_deadline, status, resolution, resolved_at)
  └── DenialAction (type: resubmit / appeal / write_off / transfer / note, document, user, at)
```

Balances are derived: `charge - sum(payments) - sum(adjustments)` split into insurance vs patient responsibility.

## 7. Patient billing

```
StatementCycle (practice, frequency days, max statements before collections, min balance)
Statement (patient/guarantor, period, balance, charges included, channel, delivered_at, pdf ref, pay link token)
PaymentPlan (patient, total, installment amount, schedule, card token, status)
  └── PaymentPlanInstallment (due date, amount, transaction, status)
CardOnFile (patient, processor token, last4, brand, expiry, consent doc)
CollectionsCase (patient, balance, stage, agency export ref)
```

## 8. Work management and integrations

```
Task (type, entity ref, assigned_to, due, priority, status, created_from: rule/AI/manual)
WorkQueue (name, filter definition, owner role)
IntegrationConnection (type: clearinghouse / payment / ehr_hl7 / lab / sms / email, credentials ref, status, config)
IntegrationMessage (connection, direction, message type 837/835/270/271/276/277/ADT/DFT/ORU, payload ref, status, error)
ReportDefinition (owner, name, dataset, columns, filters, group by, chart, schedule, shared_with)
Notification (user, type, payload, read_at)
```

## 9. Key indexes and constraints

- Unique: `(tenant_id, patient.mrn)`, `(practice_id, claim.control_number)`, `(payer_id, provider_id)` enrollment.
- Row-level security policy on every table keyed by `tenant_id`; practice scoping via join to `UserRole`.
- Partial indexes for worklists: open claims by status, open denials by assignee, statements due.
- `LedgerEntry` has no UPDATE/DELETE grants; corrections insert a reversal row.
