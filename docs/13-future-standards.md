# Keeping CollaboratMD current

For the people who operate CollaboratMD. Medical billing rules change on their own schedules, by law, so no billing system can go years without updates. The aim here is that almost every change is a data load or an automated update, and code changes are rare and planned. Settings, Maintenance shows where everything stands.

## What changes, and who does it

| What | When | How it reaches the app | Who |
|---|---|---|---|
| ICD-10-CM diagnosis codes | Every October 1 (files published about June to August), with April updates | Load the order file and addenda on Settings, Code sets, or `npm run import:code-sets` | Platform operator |
| NCCI edits (PTP and MUE) | January, April, July, October 1 | Load on Settings, Code sets | Platform operator |
| HCPCS Level II codes | Quarterly | Load on Settings, Code sets | Platform operator |
| Physician fee schedule (RVUs, GPCIs), anesthesia base units, telehealth list, HCC mapping | Every January 1 (final rule about November) | Load on Settings, Code sets | Platform operator |
| Medicare therapy threshold | Every January 1 | Settings, Code sets | Platform operator |
| Medicare coverage policies, ordering and referring file | Continuously; load quarterly and monthly | Load on Settings, Code sets | Platform operator |
| A practice's fees and contracts | After Medicare's January update; at each contract renewal | Settings, Fee schedules; Contract calendar | Practice administrator |
| Provider licenses, certificates, API keys | On their own expiry dates | Settings pages linked from Maintenance | Practice administrator |
| Package updates and security fixes | Weekly (Dependabot) | Pull request, merged when CI passes | Developer |
| Node.js release line | About every 2 to 3 years | NODE_VERSION in `ci.yml` and `maintenance.yml`, the Vercel project's Node.js setting, `NODE_END_OF_LIFE` in `src/server/maintenance.ts` | Developer |

The daily job tells the operators every week while any code set is due or overdue (`src/server/code-set-calendar.ts`). The monthly *Maintenance check* workflow fails when a production package has a high or critical advisory, or when the Node.js line has less than 180 days of security fixes left.

## When a code set is overdue

Claims keep going out, checked against the last file loaded. That is safe for most claims, but a code deleted on October 1 passes the check until the new file is loaded, and a code added on October 1 is flagged as unknown. Load the new file as soon as CMS publishes it; the app keeps each year's codes and checks a claim against the year of its date of service, so loading early does not affect earlier visits.

## A new X12 version

Electronic claims, remittances and eligibility checks use HIPAA X12 version 5010, which HHS mandates. When HHS adopts a newer version, it publishes a final rule with a compliance date, usually two or more years out, and payers and clearinghouses move on that date.

1. Read the final rule and the new implementation guides (from X12), transaction by transaction. Most of the work is in the 837 claims and the 835 remittance.
2. Add each new guide to `src/lib/edi/standards.ts` beside the current one, and write the new builders and parsers next to the old ones (for example `x837p-8020.ts`), not over them.
3. Choose the version per clearinghouse or payer from a setting, so a practice can move when its clearinghouse is ready, and both versions run during the transition.
4. Test against the clearinghouse's test system with real sample files before the compliance date, then switch practices over one at a time.
5. Remove the old version only after the compliance date has passed and every practice has moved.

## ICD-11

The United States has not set a date to move to ICD-11, and would first need its own clinical modification, a rule with a compliance date, and crosswalks from ICD-10-CM. When that happens: load the new code system as a second code set beside ICD-10-CM, choose the system by date of service (the app already checks codes by date of service), and use the official crosswalk to suggest new codes for chronic conditions on open accounts, as the October code-change report does today.

## Changes that need code

Some laws add new obligations rather than new data (the No Surprises Act, price transparency, the information blocking rules). Each needs a developer: expect a few a year. Watch the CMS and HHS rulemaking calendars, and plan the work against the compliance date.
