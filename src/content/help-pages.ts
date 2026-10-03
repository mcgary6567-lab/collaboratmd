import type { Guide } from "./help";

/** Guides for the menu and settings pages not covered in help.ts (a test keeps every page covered). */
export const PAGE_GUIDES: Record<string, Guide> = {
  "/work": {
    title: "Work queues",
    steps: [
      "Rules hand out denials and stuck claims as tasks, each with a due date.",
      "Add or change rules here, and see how the team is keeping up over the last 30 days.",
    ],
    related: [{ label: "Denials", href: "/denials" }, { label: "Claim follow-up", href: "/claims/follow-up" }],
  },
  "/admin": {
    title: "Practice analytics",
    steps: [
      "Charges, collections, days in A/R, denial rate and clean claim rate, each against its industry target.",
      "Use the payer and provider breakdowns to find where money is slow or lost.",
    ],
    related: [{ label: "Reports", href: "/reports" }],
  },
  "/clients": {
    title: "All clients",
    steps: [
      "Every practice you have access to, with its key numbers side by side.",
      "Open one to switch into it; your role there is the one that practice gave you.",
    ],
  },
  "/clients/invoicing": {
    title: "Client invoicing",
    steps: [
      "For billing companies: bill each client practice a percent of what you collected for it.",
      "Invoices cover whole months; set each practice's percent, then issue and track the invoices.",
    ],
  },
  "/check-ins": {
    title: "Online check-ins",
    steps: [
      "What patients submitted before their visit from their phone: insurance changes, signed notices and copays paid.",
      "Review each submission before the visit; send check-in links from the schedule.",
    ],
    related: [{ label: "Scheduling", href: "/scheduling" }],
  },
  "/messages": {
    title: "Text messages",
    steps: [
      "Two-way texts with patients, one conversation per patient; replies arrive here.",
      "Patients who reply STOP are not texted again; only send texts to patients who agreed to them.",
    ],
    related: [{ label: "Text message registration", href: "/settings/texting" }],
  },
  "/labs": {
    title: "Labs",
    steps: [
      "Lab results to review, and orders still waiting on the lab, sent and received over HL7.",
      "Set up each lab's connection at the bottom of the page.",
    ],
    related: [{ label: "EHR interfaces", href: "/settings/integrations" }],
  },
  "/coding": {
    title: "Coding help",
    steps: [
      "Work out the E/M level from time or medical decision making, and find diagnosis codes from plain words.",
      "AI coding from visit notes is available only after the practice has a BAA with the AI provider.",
    ],
    related: [{ label: "Charge entry", href: "/encounters/new" }],
  },
  "/encounters/institutional": {
    title: "Facility claim (UB-04)",
    steps: [
      "For hospitals, surgery centers and other facilities: type of bill, statement period, admission details and revenue-code lines.",
      "Inpatient bills also take ICD-10-PCS procedures. The claim is scrubbed with the institutional rules and sent as an 837I.",
    ],
    related: [{ label: "Claims", href: "/claims" }],
  },
  "/encounters/dental": {
    title: "Dental claim (837D)",
    steps: [
      "CDT codes with tooth, surfaces and quadrant for each line.",
      "The claim is checked with the dental rules and sent as an 837D; attachments such as X-rays go with it.",
    ],
    related: [{ label: "Claims", href: "/claims" }],
  },
  "/reports/warnings": {
    title: "Warnings that became denials",
    steps: [
      "Each scrub warning claims were sent with, by payer, and how often those claims were denied.",
      "Where the rate is high, block it: a payer edit for that payer, or strict scrubbing for every warning.",
    ],
    related: [{ label: "Payer edits", href: "/settings/payer-edits" }],
  },
  "/reports/code-changes": {
    title: "Diagnosis code changes",
    steps: [
      "Each October 1 CMS deletes some ICD-10-CM codes and splits others into more specific ones. This lists the ones your practice uses, and where: visits not billed yet, prior authorizations and lab orders.",
      "Pick the replacement the documentation supports; visits before October 1 keep the old code. The claim scrubber checks each date of service against its own year.",
    ],
    related: [{ label: "Code sets", href: "/settings/code-sets" }],
  },
  "/reports/contract-calendar": {
    title: "Contract calendar",
    steps: [
      "Each payer contract's renewal date, the last day to give notice to renegotiate or end it, any scheduled increase, and what that payer underpaid in the last year.",
      "Enter the dates on each contract's fee schedule; administrators are reminded 60, 30 and 7 days before the notice date.",
    ],
    related: [{ label: "Fee schedules", href: "/settings/fees" }, { label: "Contract comparison", href: "/reports/contracts" }],
  },
  "/privacy-requests": {
    title: "Privacy requests",
    steps: [
      "Record a patient's request for a copy of their records (due in 30 days) or for an accounting of disclosures (due in 60), extend it once by 30 days with a written reason, then mark it provided or denied.",
      "Record disclosures made outside treatment, payment and operations (subpoenas, public health reports, oversight agencies); they appear in the patient's printable accounting for six years. Records sent for payer requests are logged automatically.",
    ],
    related: [{ label: "Records requests", href: "/records-requests" }],
  },
  "/patients/duplicates": {
    title: "Duplicate patients",
    steps: [
      "Records that look like the same person: the same name and date of birth, the same member ID with the same payer, or the same date of birth and phone.",
      "Check they really are one person, choose the record to keep, and merge: every visit, claim, payment and document moves to it, and the other record opens the one kept.",
    ],
    related: [{ label: "Patients", href: "/patients" }],
  },
  "/coding/queries": {
    title: "Provider questions",
    steps: [
      "Ask the provider from the claim when a visit cannot be coded as documented; the claim is held by the scrubber until the question is answered or withdrawn.",
      "Record the answer here, correct the claim if needed, and scrub it again. The table shows each provider's questions and how long answers take.",
    ],
    related: [{ label: "Coding audits", href: "/coding/audits" }],
  },
  "/coding/audits": {
    title: "Coding audits",
    steps: [
      "Sample a number of each provider's billed claims from a period, at random, and have someone other than the coder check each against the note.",
      "Mark each correct or in error with what was wrong. Accuracy under 95% is a signal for education and a follow-up audit.",
    ],
    related: [{ label: "Provider questions", href: "/coding/queries" }],
  },
  "/injury-cases": {
    title: "Personal injury cases",
    steps: [
      "Open a case when a patient's attorney signs a lien or letter of protection: the balance is held from statements, reminders, card charges and collections.",
      "Record a reduction the attorney asks for and what you agree; when the settlement is paid, post it here, and normal billing resumes for anything left.",
    ],
    related: [{ label: "Patient billing", href: "/billing" }],
  },
  "/reports/write-offs": {
    title: "Write-off analysis",
    steps: [
      "Everything taken off A/R without being collected, split into contractual adjustments, avoidable write-offs, policy write-offs and discounts, and bad debt.",
      "Avoidable write-offs (timely filing, no authorization, eligibility, coding, medical necessity) are shown by payer, by month and by who posted them. Each write-off now asks for its reason.",
    ],
    related: [{ label: "Denials", href: "/denials" }],
  },
  "/reports/registration": {
    title: "Registration quality",
    steps: [
      "Front-end rejections, refused coverage checks and denials that trace back to registration, by the field that was wrong and by who entered the policy.",
      "Fix each patient's details from the list, and use the counts for front desk training.",
    ],
    related: [{ label: "Patients", href: "/patients" }],
  },
  "/work/shifts": {
    title: "Shifts and time off",
    steps: [
      "The team table shows who is on now, on a break, off or on a holiday, in their own time, and when everyone else is next on, in your time. Clock in and out at the start and end of a shift and take breaks with Start break and End break; breaks are not counted as hours worked. If your administrator set office networks, a clock-in from elsewhere is flagged or refused.",
      "Ask for time off: your leave balance shows above, and a request tells you if it goes over. An administrator approves it, and then your open queue tasks due in that time move to others on the same rule; if approved time off is cancelled, the tasks still open move back. To swap a shift, pick one of your upcoming shifts and a teammate; they accept, and an administrator who is not one of you approves it. Leave a handover note at the end of a shift; the next shift sees it on its dashboard.",
      "Your timesheet: check last week's and this week's entries, then submit the week for approval. If a time is wrong or you forgot to clock, ask for a correction with the right times and a reason. You get a reminder if your shift started 15 minutes ago and you have not clocked in, or if you are still clocked in an hour after it ended.",
    ],
    related: [{ label: "Team week", href: "/work/shifts/week" }, { label: "Manage shifts", href: "/work/shifts/manage" }, { label: "Work queues", href: "/work" }],
  },
  "/work/shifts/week": {
    title: "Team week",
    steps: [
      "Everyone's shifts for a week in your time zone (or the practice's), with approved time off (whole and part days), holidays, swaps and open shifts applied. Use Previous week and Next week to plan ahead. The hour-by-hour grid counts how many people are on; red hours have nobody.",
      "Open shifts: an administrator posts hours nobody covers; anyone who does not already work then can claim them, and an administrator confirms. The workload forecast compares each day's expected queue work (the last eight weeks on the same weekday) with the hours scheduled, at the team's own pace, and flags days that look short.",
    ],
    related: [{ label: "Shifts and time off", href: "/work/shifts" }, { label: "Manage shifts", href: "/work/shifts/manage" }],
  },
  "/work/quality": {
    title: "Work quality checks",
    steps: [
      "An administrator draws a random sample of each person's claims sent and payments or adjustments posted in a period. Someone other than the person who did the work opens each one and marks it correct or wrong, with what was wrong.",
      "Accuracy per person over the last 90 days is shown against a 95% target, with the most common mistakes, so coaching can focus on them. Provider coding is checked separately in Coding audits.",
    ],
    related: [{ label: "Coding audits", href: "/coding/audits" }, { label: "Hours, output and pay", href: "/reports/team-hours" }],
  },
  "/work/training": {
    title: "Training and certifications",
    steps: [
      "Sign for training you completed: HIPAA training counts for a year unless you enter another expiry date; certifications such as CPC or CPB take the expiry date the certifying body gives.",
      "Administrators can record anyone's training and see who needs attention: HIPAA training missing or expired, and anything expiring within 60 days. Reminders go to the person and the administrators each morning a record needs renewing.",
    ],
    related: [{ label: "Compliance", href: "/settings/compliance" }],
  },
  "/work/shifts/timesheets": {
    title: "Timesheets",
    steps: [
      "Approve corrections people asked for and the weeks they submitted. You cannot decide your own; another administrator does.",
      "Pick a person and week to correct their time: change an entry's clock-in or clock-out, add, change or remove a break, remove a wrong entry or add a missing one, always with a reason. Every change is in the audit log with the times before and after. An approved week is locked: reopen it first, with a reason. Correcting a submitted week sends it back to the person.",
    ],
    related: [{ label: "Hours, output and pay", href: "/reports/team-hours" }, { label: "Manage shifts", href: "/work/shifts/manage" }],
  },
  "/work/shifts/manage": {
    title: "Manage shifts",
    steps: [
      "Approve or deny time off and shift swaps; you cannot decide your own. Each request shows how many working days it takes and whether it goes over the person's balance. Set each person's time zone, weekly hours in their own time zone (21:00 to 06:00 runs past midnight), holiday calendar, leave allowances (days a year, given in January or monthly, plus days carried over) and pay: an hourly rate in their currency, overtime after so many hours a week or a day, the overtime multiplier, a night differential and holiday pay.",
      "Holidays: the US, Philippine, Pakistani and Indian calendars hold the dates that can be computed. Add holidays set by the moon or by proclamation, such as Eid or Diwali, once they are announced, to a calendar or company-wide. Office networks: list the IP addresses or ranges people clock in from, and choose whether a clock-in from elsewhere is flagged or refused.",
    ],
    related: [{ label: "Shifts and time off", href: "/work/shifts" }, { label: "Hours, output and pay", href: "/reports/team-hours" }],
  },
  "/reports/team-hours": {
    title: "Hours, output and pay",
    steps: [
      "Hours each person worked in a period (clocked time less breaks), with the tasks they finished, claims they sent and payments they posted, each per hour, and any clock-ins from outside the office networks. Compare people doing the same kind of work: an appeal takes longer than a payment posting.",
      "The pay worksheet splits hours into regular and overtime by each person's rules, counts night and holiday hours for premiums, shows gross pay in their currency and how many of their weeks are approved. Download it as CSV for your payroll provider. Pick a Monday-to-Sunday period so weekly overtime is complete. It is a worksheet for payroll: no taxes, deductions or payments.",
    ],
    related: [{ label: "Shifts and time off", href: "/work/shifts" }, { label: "Manage shifts", href: "/work/shifts/manage" }],
  },
  "/settings/maintenance": {
    title: "Maintenance",
    steps: [
      "Check this page once a month. It lists what goes out of date on its own: your fee schedules after Medicare's January update, contract notice dates, provider credentials, the single sign-on certificate, API keys, and the national code sets CMS replaces on its calendar.",
      "Open each item marked to fix it. Administrators are also notified each morning when something changes, and the platform's operators are told weekly while a code set is due.",
    ],
    related: [{ label: "National code sets", href: "/settings/code-sets" }],
  },
  "/settings/substitutes": {
    title: "Substitute physicians",
    steps: [
      "When a provider will be away, record the absence and the substitute covering it: a paid locum tenens (Q6) or a reciprocal arrangement with another physician (Q5), with the substitute's NPI.",
      "On each claim the substitute saw, choose them under Substitute physician: every line gets the modifier. Medicare allows 60 continuous days; after that the substitute bills under their own enrollment.",
    ],
    related: [{ label: "Claims", href: "/claims" }],
  },
  "/scheduling/referrals": {
    title: "HMO referrals",
    steps: [
      "Mark the plans that need a referral from the primary care physician under Settings, Payers. Add each referral on the patient's page: number, dates and visits allowed.",
      "The referral number goes on the claim automatically. This list shows referrals ending soon or used up, so you can ask for the next one before the visit.",
    ],
    related: [{ label: "Payers", href: "/settings/payers" }],
  },
  "/coding/therapy-plans": {
    title: "Therapy plans of care",
    steps: [
      "Record each patient's plan of care on their page when therapy starts, and the physician's signature when it comes back (within 30 days, or late with the reason).",
      "Recertify before a plan ends (at most every 90 days). Medicare claims with GP, GO or GN lines are flagged when no certified plan covers the visit.",
    ],
    related: [{ label: "Coding help", href: "/coding" }],
  },
  "/patients/other-coverage": {
    title: "Other insurance check",
    steps: [
      "Once a year, ask each patient whether they have any other health insurance. Online check-in asks automatically; record answers here for everyone else coming in.",
      "When someone says yes, add the policy on their page and set which plan pays first.",
    ],
    related: [{ label: "Online check-ins", href: "/check-ins" }],
  },
  "/billing/expiring-cards": {
    title: "Expiring cards on file",
    steps: [
      "Cards that pay a plan automatically or balances after insurance, expiring in the next 45 days.",
      "Send the patient a link: in the portal they choose Replace card, enter the new one, and nothing is charged. The autopay and their authorization carry over to the new card.",
    ],
    related: [{ label: "Patient billing", href: "/billing" }],
  },
  "/interpreters": {
    title: "Interpreter log",
    steps: [
      "Note on the patient's page the language they need an interpreter for; visits in the next week that need one are listed here so one can be booked.",
      "Log each interpreter provided (or offered and declined), with the vendor, minutes and cost. Where your state's Medicaid pays for interpreters, turn on T1013 in Billing policies to see the units to bill.",
    ],
    related: [{ label: "Billing policies", href: "/settings/policies" }],
  },
  "/billing/holds": {
    title: "Bankruptcy and estates",
    steps: [
      "Record a bankruptcy or a death on the patient's page, under Account status. Statements, reminders, card charges and collections stop at once; a death also cancels future visits.",
      "File the proof of claim (bankruptcy) or the claim against the estate by its deadline and record the date. When it ends, close it: a discharge writes off what was owed before the filing, and an estate settlement posts what it paid and writes off the rest.",
    ],
    related: [{ label: "Personal injury cases", href: "/injury-cases" }],
  },
  "/patients/account-review": {
    title: "Returned mail and adult dependents",
    steps: [
      "When a statement comes back, mark it on the patient's page. Nothing more is mailed there until the address is corrected or confirmed, and the schedule check reminds the front desk at the next visit.",
      "Dependents who have turned 18 are billed on their own account. Record their agreement to keep the guarantor, or move them to their own account.",
    ],
    related: [{ label: "Patients", href: "/patients" }],
  },
  "/reports/front-desk": {
    title: "Front-desk collections",
    steps: [
      "For each visit, what was due at check-in (the copay and any balance owed before that day) against what was collected that day, by location and week.",
      "Use it to coach the front desk: collecting at the visit costs far less than a statement later.",
    ],
    related: [{ label: "Daily cash close", href: "/billing/cash-close" }],
  },
  "/reports/referrals": {
    title: "Referral sources",
    steps: [
      "Ask new patients how they heard about the practice when registering them; add or change it later on the patient's page.",
      "Compare sources by new patients, visits and what they have paid, and see which physicians refer the most.",
    ],
    related: [{ label: "New patient", href: "/patients/new" }],
  },
  "/privacy-complaints": {
    title: "Privacy complaints",
    steps: [
      "Log every privacy complaint, however it arrives, even an anonymous one or one you think is unfounded.",
      "Record the investigation, the finding and what was done about it, then close it when the complainant has been answered. The log is kept for six years.",
    ],
    related: [{ label: "Privacy requests", href: "/privacy-requests" }],
  },
  "/reports/cost-to-collect": {
    title: "Cost to collect",
    steps: [
      "Each month, enter what billing cost: staff, an outside billing company, software, the clearinghouse, card fees and postage. Collection agency commissions are counted automatically.",
      "Cost to collect is those costs as a share of what was collected; watch the trend month to month.",
    ],
    related: [{ label: "Accounting", href: "/billing/accounting" }],
  },
  "/billing/cash-close": {
    title: "Daily cash close",
    steps: [
      "At the end of the day, count the cash and checks in the drawer and read the card terminal's batch total; the page shows what was posted for each.",
      "A difference needs a note before the day closes. Online, card-on-file and agency payments never pass through the desk, so they are shown but not counted.",
    ],
    related: [{ label: "Accounting", href: "/billing/accounting" }],
  },
  "/billing/missed-fees": {
    title: "Missed appointment fees",
    steps: [
      "Set the no-show and late cancellation fees; online check-in then asks patients to agree, or record a signed policy on the patient's page.",
      "Charge each missed appointment from the list (once each, never to insurance, never to Medicaid patients), or waive a fee with a reason.",
    ],
    related: [{ label: "Scheduling", href: "/scheduling" }],
  },
  "/reports/denial-causes": {
    title: "Denial root causes",
    steps: [
      "Each denial gets a cause and the team that owns preventing it (front desk, coding, clinical documentation, billing), guessed from its reason code: confirm or correct it.",
      "Watch the preventable share month by month, and take the biggest causes to the team that owns them.",
    ],
    related: [{ label: "Denials", href: "/denials" }, { label: "Registration quality", href: "/reports/registration" }],
  },
  "/reports/agencies": {
    title: "Collection agencies",
    steps: [
      "Post each payment an agency collects: the patient is credited in full, and the agency's commission is recorded so cash matches the agency's check.",
      "Compare agencies by recovery rate, commission and how fast they collect.",
    ],
    related: [{ label: "Collections", href: "/billing/collections" }],
  },
  "/reports/compensation": {
    title: "Provider compensation",
    steps: [
      "Set each provider's plan: a percentage of collections, an amount per work RVU, or a base with a bonus over a threshold.",
      "The worksheet shows each provider's collections, work RVUs and pay for the period. Check it against the employment agreement; it is not payroll.",
    ],
    related: [{ label: "Productivity (RVUs)", href: "/reports/productivity" }],
  },
  "/settings/chargemaster": {
    title: "Chargemaster",
    steps: [
      "Load your facility's items from a spreadsheet: item code, description, revenue code, HCPCS, charge and cash price. Facility claim lines left without a charge are priced from it.",
      "Review prices yearly, and download the standard charges file hospitals must publish; check it against CMS's current template before posting.",
    ],
    related: [{ label: "Facility claim (UB-04)", href: "/encounters/institutional" }],
  },
  "/setup": {
    title: "Setup checklist",
    steps: [
      "What the practice still needs before claims go out, and what each setting or yearly file makes possible.",
      "Work down the list; each item links to where it is set.",
    ],
  },
  "/settings/subscription": {
    title: "Subscription",
    steps: ["Your CollaboratMD plan, trial dates and invoices, with links to each invoice and receipt.", "Change or cancel the plan here; a failed payment shows how long before claims pause."],
  },
  "/settings/profile": {
    title: "Practice profile",
    steps: [
      "The legal name, NPI, tax ID, address and phone sent as the billing provider on every claim: check them against your enrollment.",
      "Also here: the Medicare locality (for fee schedule pricing), CLIA number, time zone and paper claim alignment.",
    ],
  },
  "/settings/locations": {
    title: "Locations",
    steps: ["Each clinic or facility where you see patients, with its address and place of service.", "A visit's location goes on the claim as the service facility when it differs from the billing address."],
  },
  "/settings/providers": {
    title: "Providers",
    steps: [
      "Rendering providers with NPI, taxonomy, specialty and credential; look the NPI up in the CMS registry to fill the rest.",
      "The credential matters for Medicare: nurse practitioners, physician assistants and clinical nurse specialists are paid 85% under their own NPI.",
      "Deactivate a provider who leaves; their past claims stay as they were.",
    ],
  },
  "/settings/payers": {
    title: "Payers",
    steps: ["Each insurer with its clearinghouse payer ID, type, timely filing limit and appeal window.", "The type (commercial, Medicare, Medicaid, workers' comp, auto) decides which rules apply to its claims."],
    related: [{ label: "Payer edits", href: "/settings/payer-edits" }],
  },
  "/settings/fees": {
    title: "Fee schedules",
    steps: [
      "Your standard charges, and each payer's contracted rates, which underpayment checks compare against.",
      "Build a contract as a percent of your charges or of Medicare; add your own codes, descriptions and fees from a spreadsheet.",
    ],
    related: [{ label: "Fee schedule check", href: "/reports/fee-check" }],
  },
  "/settings/enrollment": {
    title: "Payer enrollment",
    steps: ["Each provider's enrollment status with each payer, and revalidation dates.", "A claim for a provider not yet enrolled with the payer gets a warning before it goes out."],
  },
  "/settings/credentials": {
    title: "Credentials",
    steps: ["Licenses, DEA, board certification, malpractice and CAQH for each provider, with expiry dates.", "Reminders go out before anything expires."],
  },
  "/settings/policies": {
    title: "Policies",
    steps: [
      "Practice-wide rules: write-off limits for non-administrators, strict scrubbing, risk holds, statement settings, small balance adjustments and refund approval.",
      "Changes are recorded in the audit log.",
    ],
  },
  "/settings/payer-edits": {
    title: "Payer edits",
    steps: [
      "Rules one payer applies and another does not: prior authorization, required modifiers or diagnoses, unit and frequency limits, codes not covered.",
      "Rules suggested from your own denials appear at the top; add one and the next claim is checked against it.",
    ],
  },
  "/settings/code-sets": {
    title: "National code sets",
    steps: [
      "CMS's files, loaded by the platform operator: ICD-10-CM, HCPCS, NCCI edits, coverage policies, the physician fee schedule, the telehealth list and the HCC mapping.",
      "Checks that rely on a file run only once that year's file is loaded; the page shows what is loaded and when.",
    ],
  },
  "/settings/automation": {
    title: "Automation",
    steps: ["What runs every morning: reminders, claim follow-up, the denial agent, coverage checks, autopay and reports.", "Turn each on or off; results show in notifications and the automation history."],
  },
  "/settings/team": {
    title: "Team and roles",
    steps: ["Invite people, choose their role (or a custom role that narrows one), and remove access in one click.", "Signing someone out ends every session they have open."],
  },
  "/settings/security": {
    title: "Sign-in security",
    steps: ["Require two-factor sign-in, set how long sessions last, and limit sign-in to your office networks.", "Passkeys count as two-factor; \"Sign everyone out\" ends all sessions at once."],
  },
  "/settings/sso": {
    title: "Single sign-on",
    steps: ["Connect Okta, Entra ID or Google Workspace (OpenID Connect or SAML), and SCIM so leaving staff lose access automatically.", "Test the connection before requiring it for everyone."],
  },
  "/settings/quality": {
    title: "Quality measures",
    steps: ["The MIPS measures you report, with this year's visit codes and quality data codes from CMS's specifications.", "A qualifying claim then shows the measure, and the outcome is added as a $0.00 line."],
    related: [{ label: "Quality report", href: "/reports/quality" }],
  },
  "/settings/texting": {
    title: "Text message registration",
    steps: ["US carriers block unregistered business texts: register your Twilio sender (A2P 10DLC or toll-free) here.", "The answers are prepared from your practice details; check the status again after submitting."],
  },
  "/settings/integrations": {
    title: "EHR interfaces",
    steps: ["Receive patients and charges from your EHR over HL7 v2, with the integration key your EHR sends.", "Send a test message here to check the connection before going live."],
  },
  "/settings/fhir": {
    title: "EHR over FHIR",
    steps: ["Connect Epic, Oracle Health, athenahealth and others with SMART backend services to bring in patients and finished visits.", "Visits arrive as charges to review, not as sent claims."],
  },
  "/settings/developers": {
    title: "Developers",
    steps: ["API keys for your own systems, and webhooks that notify them when claims, payments and patients change.", "Keys are shown once; store them safely and revoke any you no longer use."],
  },
  "/settings/audit": {
    title: "Audit log",
    steps: ["Every sign-in, change, export and payment, with who and when.", "Search by person, action or record, and export it for a review."],
  },
  "/settings/access-review": {
    title: "Chart access review",
    steps: ["Charts each person opened in the last 24 hours, against their usual; unusual access is flagged.", "Flags are prompts to look, not findings: review each and record what you found."],
  },
  "/settings/close": {
    title: "Close account",
    steps: ["Download the whole practice first; closing schedules deletion of all of this practice's data after a notice period.", "Until the date, the closure can be cancelled."],
  },
  "/settings/compliance": {
    title: "Compliance",
    steps: ["HIPAA Security Rule controls, access reviews, vendors with their business associate agreements, and the audit trail in one place.", "Keep the vendor list and BAAs current as you add services."],
  },
  "/settings/menu": {
    title: "Menu",
    steps: ["Hide the modules your practice does not use, for everyone.", "Hidden pages still work from links and search; they just leave the menu."],
  },
};
