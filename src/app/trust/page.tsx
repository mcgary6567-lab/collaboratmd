import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trust center — CollaboratMD",
  description: "How CollaboratMD handles patient data: safeguards in the product, the services it runs on, what AI sees, and where independent assurance stands.",
};

const SAFEGUARDS = [
  "Two-factor sign-in, which an administrator can require for every user",
  "Account lockout for 15 minutes after five failed sign-ins",
  "Four roles (administrator, biller, front desk, read-only), plus custom roles that can only narrow them, checked on every request",
  "Single sign-on through your identity provider (OpenID Connect or SAML 2.0) and SCIM to remove access when people leave",
  "Password resets by one-time emailed link that ends every other session",
  "Per-practice session length and an optional allowlist of office networks",
  "Every record scoped to its practice, with ownership checked on every change",
  "Posted amounts never edited; corrections post as reversals",
  "An audit log of sign-ins, claims, payments, exports and settings changes, exportable by administrators",
  "Patient links, API keys, SCIM tokens and recovery codes stored only as hashes",
  "Server errors recorded with patient details masked, and no request headers or query strings kept",
  "Integration keys and authenticator secrets encrypted (AES-256-GCM) before they are stored",
  "HTTPS everywhere, and a certificate-verified TLS connection to the database",
  "Card numbers entered on Stripe's hosted page, never on our servers",
  "A compliance center for practices: control checks, access reviews and a vendor BAA register",
];

const SUBPROCESSORS = [
  { name: "Vercel", role: "Application hosting", when: "Always, for the hosted service" },
  { name: "Neon", role: "Database hosting (PostgreSQL)", when: "Always, for the hosted service" },
  { name: "Stedi", role: "Clearinghouse: claims, eligibility, status, remittances", when: "Only for practices that connect it" },
  { name: "Stripe", role: "Card payments and saved cards", when: "Only for practices that connect it" },
  { name: "Twilio", role: "Text messages to patients who agreed to texts", when: "Only for practices that connect it" },
  { name: "Resend", role: "Email to patients and staff", when: "Only for practices that connect it" },
  { name: "Anthropic", role: "AI: denial explanations, appeal drafts, coding help, report questions, insurance card reading", when: "Only for practices that connect it" },
];

const ASSURANCE = [
  { done: true, text: "Security safeguards built into the product (listed above), covered by automated tests" },
  { done: true, text: "Tools for practices to evidence their own HIPAA safeguards: access reviews, audit export, BAA register" },
  { done: false, text: "SOC 2 Type I or Type II audit by an independent firm: not yet completed" },
  { done: false, text: "Third-party penetration test: not yet completed" },
  { done: false, text: "HITRUST certification: not pursued yet" },
];

export default function TrustPage() {
  return (
    <PageShell
      eyebrow="Trust center"
      title="How patient data is handled"
      lead="What the product does to protect the data it holds, which services it runs on, what AI is and is not shown, and exactly where independent assurance stands today."
      wide
    >
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-xl font-bold text-slate-900">Safeguards in the product</h2>
          <ul className="mt-4 space-y-2.5">
            {SAFEGUARDS.map((s) => (
              <li key={s} className="flex gap-2.5 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> {s}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-600">More detail on the <Link href="/security" className="font-semibold text-green-700 underline">security page</Link>.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">Independent assurance, honestly</h2>
          <ul className="mt-4 space-y-2.5">
            {ASSURANCE.map((a) => (
              <li key={a.text} className="flex gap-2.5 text-sm text-slate-700">
                {a.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />} {a.text}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-600">
            We would rather tell you what has not been done than let a badge imply it. When an audit is completed, its report will be available here under NDA.
          </p>
        </section>

        <section className="lg:col-span-2">
          <h2 className="text-xl font-bold text-slate-900">Services that process data</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left"><tr><th className="px-4 py-3">Service</th><th className="px-4 py-3">What for</th><th className="px-4 py-3">When</th></tr></thead>
              <tbody>
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.name} className="border-t border-slate-200"><td className="px-4 py-3 font-semibold">{s.name}</td><td className="px-4 py-3 text-slate-700">{s.role}</td><td className="px-4 py-3 text-slate-500">{s.when}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Practices connect the optional services with their own accounts, so the agreement with each (including any business associate agreement) is between the practice and that service.
            The compliance center inside the product keeps a register of them.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">What AI sees</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            AI is off until a practice connects its own Anthropic account. When on, denial explanations and appeal drafts are written from codes only (CARC, RARC, CPT, ICD-10, payer type);
            patient names, dates of birth, member IDs and addresses are filled in by our servers after the AI answers. Import column matching sends column headers and the shape of values, never the values.
            Questions asked of the report builder send the question and the practice&apos;s payer and provider names, never report results.
            Coding from full visit notes and reading insurance card photos, which contain patient information, stay off unless the practice confirms it has a BAA with Anthropic.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">Questions and agreements</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            For a security questionnaire, a business associate agreement or anything on this page, <Link href="/contact" className="font-semibold text-green-700 underline">contact us</Link>.
            To report a vulnerability, write to us through the same form and mark it security; please do not test against other practices&apos; data.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
