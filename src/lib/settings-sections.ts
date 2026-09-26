/** Every settings page, grouped: the settings menu and the settings home page both read this. */
export type SettingsLink = { href: string; label: string; description: string; adminOnly?: boolean; keywords?: string };

export const SETTINGS_SECTIONS: { title: string; links: SettingsLink[] }[] = [
  {
    title: "Practice",
    links: [
      { href: "/settings", label: "Overview", description: "Setup health and every setting in one place" },
      { href: "/settings/profile", label: "Practice profile", description: "Legal name, NPI, tax ID and address sent on every claim", adminOnly: true, keywords: "billing provider npi ein tin address phone" },
      { href: "/settings/providers", label: "Providers", description: "Add, edit and deactivate rendering providers", keywords: "doctor physician npi taxonomy" },
      { href: "/settings/payers", label: "Payers", description: "Payer IDs, types, timely filing and appeal windows", keywords: "insurance payer id timely filing" },
      { href: "/settings/fees", label: "Fee schedules", description: "Standard charges and payer contract rates", keywords: "prices contract rates cpt" },
      { href: "/settings/enrollment", label: "Payer enrollment", description: "Enrollment status and revalidation dates per payer" },
      { href: "/settings/credentials", label: "Credentials", description: "Licenses, DEA, board, malpractice and CAQH, with expiry reminders", keywords: "license dea caqh malpractice board credentialing" },
    ],
  },
  {
    title: "Billing rules",
    links: [
      { href: "/settings/policies", label: "Policies", description: "Write-off limits, strict scrubbing, risk holds, statements, small balances", adminOnly: true, keywords: "rules approval limit strict risk statement export refund" },
      { href: "/settings/payer-edits", label: "Payer edits", description: "Your own rules per payer, and ones suggested from denials" },
      { href: "/settings/code-sets", label: "National code sets", description: "NCCI edits and Medicare coverage data", adminOnly: true, keywords: "ncci mue lcd" },
      { href: "/settings/automation", label: "Automation", description: "Reminders, follow-up, autopay and reports that run every morning", keywords: "daily cron reminders" },
      { href: "/work", label: "Work queues", description: "Rules that assign denials and stuck claims, with due dates", keywords: "assignment sla tasks" },
    ],
  },
  {
    title: "People and access",
    links: [
      { href: "/settings/team", label: "Team and roles", description: "Who has access, custom roles, invites, sign out a person", adminOnly: true, keywords: "users staff invite role permissions" },
      { href: "/settings/security", label: "Sign-in security", description: "Two-factor, session length, allowed networks, sign everyone out", keywords: "mfa 2fa ip allowlist session" },
      { href: "/settings/sso", label: "Single sign-on", description: "Okta, Entra ID, Google Workspace and SCIM provisioning", adminOnly: true, keywords: "oidc scim saml okta azure" },
    ],
  },
  {
    title: "Connections",
    links: [
      { href: "/settings/connections", label: "Integrations", description: "Clearinghouse, payments, texting, email and AI keys", adminOnly: true, keywords: "stedi stripe twilio resend claude api key" },
      { href: "/settings/integrations", label: "EHR interfaces", description: "HL7 feeds for patients, charges, orders and results", keywords: "hl7 ehr emr lab" },
      { href: "/settings/developers", label: "Developers", description: "API keys and webhooks", adminOnly: true, keywords: "rest api webhook" },
    ],
  },
  {
    title: "Oversight",
    links: [
      { href: "/settings/audit", label: "Audit log", description: "Every sign-in, change, export and payment, searchable", adminOnly: true, keywords: "history activity who changed" },
      { href: "/settings/compliance", label: "Compliance", description: "HIPAA control checks, access reviews and BAAs", adminOnly: true, keywords: "hipaa soc 2 baa" },
      { href: "/settings/menu", label: "Menu", description: "Hide the modules your practice does not use", adminOnly: true, keywords: "navigation sidebar hide modules" },
    ],
  },
];

export function settingsFor(role: string) {
  return SETTINGS_SECTIONS.map((s) => ({ ...s, links: s.links.filter((l) => !l.adminOnly || role === "admin") })).filter((s) => s.links.length);
}
