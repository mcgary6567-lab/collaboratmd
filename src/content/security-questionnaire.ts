/**
 * Answers to the questions practices and billing companies ask before they
 * buy (the common ground of SIG Lite, CAIQ and hospital vendor forms). Every
 * answer describes what the product and the company do today; where the
 * answer is "not yet", it says so. Keep it in step with the trust center and
 * docs/legal/hipaa-policies.md.
 */
export type QA = { id: string; section: string; question: string; answer: string };

export const QUESTIONNAIRE: QA[] = [
  // Company and assurance
  { id: "GOV-1", section: "Governance and assurance", question: "Do you sign a HIPAA business associate agreement?", answer: "Yes. Every customer signs one before real patient data is entered; see /baa." },
  { id: "GOV-2", section: "Governance and assurance", question: "Do you have written HIPAA security policies?", answer: "Yes: risk analysis, workforce access, training, incident procedures, contingency plan, business associates, technical safeguards, breach notification, devices, documentation and sanctions." },
  { id: "GOV-3", section: "Governance and assurance", question: "Do you have a SOC 2 report or HITRUST certification?", answer: "Not yet. No SOC 2 audit or HITRUST certification has been completed." },
  { id: "GOV-4", section: "Governance and assurance", question: "Has an independent firm penetration-tested the application?", answer: "Not yet." },
  { id: "GOV-5", section: "Governance and assurance", question: "Which subcontractors handle customer data?", answer: "Vercel (application hosting) and Neon (database) always; Stedi, Stripe, Twilio, Resend and Anthropic only for practices that connect them. The list is kept current in the trust center." },
  // Access control
  { id: "IAM-1", section: "Access control", question: "Is multi-factor authentication supported, and can it be required?", answer: "Yes. Authenticator-app two-factor sign-in; an administrator can require it for everyone, or for administrators and anyone who can export data." },
  { id: "IAM-2", section: "Access control", question: "Is single sign-on supported?", answer: "Yes: OpenID Connect and SAML 2.0, with SCIM to add and remove people automatically." },
  { id: "IAM-3", section: "Access control", question: "How is access limited by role?", answer: "Four built-in roles (administrator, biller, front desk, read-only) and custom roles that can only narrow them, checked on every request. Individual patient records can be restricted to named people." },
  { id: "IAM-4", section: "Access control", question: "Are sessions limited, and can they be ended?", answer: "Each practice sets its session length. Administrators can end one person's sessions or everyone's at once; a password reset ends all other sessions." },
  { id: "IAM-5", section: "Access control", question: "Is sign-in protected against password guessing?", answer: "Yes. An account locks for 15 minutes after five failed attempts, and attempts are also limited per network across all accounts." },
  { id: "IAM-6", section: "Access control", question: "Can access be limited to office networks?", answer: "Yes. A practice can set an allowlist of networks; sign-in and sessions from elsewhere are refused." },
  { id: "IAM-7", section: "Access control", question: "Are access reviews supported?", answer: "Yes. The compliance center runs access reviews and shows who opened which charts, with unusual access flagged for review." },
  // Data protection
  { id: "DAT-1", section: "Data protection", question: "Is data encrypted in transit?", answer: "Yes. HTTPS for every page and API, and a certificate-verified TLS connection to the database." },
  { id: "DAT-2", section: "Data protection", question: "Is data encrypted at rest?", answer: "Yes. The database is encrypted at rest by the database host. Integration keys and authenticator secrets are additionally encrypted with AES-256-GCM before they are stored; patient links, API keys and recovery codes are stored only as hashes." },
  { id: "DAT-3", section: "Data protection", question: "Is each customer's data separated?", answer: "Every record belongs to one practice, and ownership is checked on every read and change." },
  { id: "DAT-4", section: "Data protection", question: "Are card numbers stored?", answer: "No. Cards are entered on Stripe's hosted pages; the application never receives the card number." },
  { id: "DAT-5", section: "Data protection", question: "Can customers export all of their data?", answer: "Yes. Administrators can download everything the practice holds at any time, and the export is recorded in the audit log." },
  { id: "DAT-6", section: "Data protection", question: "What happens to data when a customer leaves?", answer: "The practice can export it, then close its account from Settings; all of its data is deleted 30 days later, and the closure can be cancelled until then." },
  { id: "DAT-7", section: "Data protection", question: "Is patient data sent to AI services?", answer: "Only when a practice connects an AI provider and confirms a business associate agreement with it. What each AI feature sees is listed in the trust center." },
  // Logging and monitoring
  { id: "LOG-1", section: "Logging and monitoring", question: "Is there an audit log?", answer: "Yes: sign-ins, chart access, claims, payments, exports and settings changes, with the value before each change. Administrators can export it." },
  { id: "LOG-2", section: "Logging and monitoring", question: "Are errors monitored without exposing patient data?", answer: "Yes. Server errors are recorded with patient details masked and no request headers or query strings kept; operators are alerted." },
  { id: "LOG-3", section: "Logging and monitoring", question: "Is availability monitored?", answer: "The public status page reports live checks of the application and database. A scheduled check from outside the hosting provider watches sign-in and the home page and alerts operators." },
  // Development
  { id: "DEV-1", section: "Secure development", question: "Is code reviewed and tested before release?", answer: "Every change runs type checks, linting, unit tests against a real database, end-to-end browser tests, automated accessibility checks and a load test." },
  { id: "DEV-2", section: "Secure development", question: "Is code scanned for vulnerabilities?", answer: "Yes. Static analysis (GitHub CodeQL) runs on every change, and dependency updates are proposed automatically (Dependabot)." },
  { id: "DEV-3", section: "Secure development", question: "Is there a Content Security Policy?", answer: "Yes. A strict, per-request nonce policy; the application cannot be framed by other sites." },
  // Continuity
  { id: "BCP-1", section: "Backup and continuity", question: "How is data backed up?", answer: "The database keeps a continuous point-in-time history, so it can be restored to any moment inside the history window." },
  { id: "BCP-2", section: "Backup and continuity", question: "Are restores tested?", answer: "A documented restore drill copies production to a separate branch as of a past moment, checks the data and the application against it, and deletes the copy. The date and result of the most recent recorded test are shown with these answers." },
  { id: "BCP-3", section: "Backup and continuity", question: "What are the recovery objectives?", answer: "Targets of 5 minutes of data (RPO) and 1 hour to be back up (RTO), measured in each drill." },
  // Incidents
  { id: "INC-1", section: "Incident response", question: "Do you have an incident response procedure?", answer: "Yes: triage, containment (ending sessions, rotating keys, disconnecting an integration), investigation from the audit log, customer communication and a written review afterwards." },
  { id: "INC-2", section: "Incident response", question: "How will you notify us of a breach?", answer: "As the business associate agreement requires: without unreasonable delay after discovery, with what is known about the information involved, so the practice can meet its own HIPAA breach notification duties." },
];

export const QUESTIONNAIRE_UPDATED = "2026-09-28";

/** The answers as CSV, for pasting into a buyer's own form. */
export function questionnaireCsv(lastRestore?: string | null) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = QUESTIONNAIRE.map((q) => [q.id, q.section, q.question, q.id === "BCP-2" && lastRestore ? `${q.answer} Most recent: ${lastRestore}.` : q.answer]);
  return [["ID", "Section", "Question", "Answer"], ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
