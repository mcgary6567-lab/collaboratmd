import type { Metadata } from "next";
import { KeyRound, Lock, ScrollText, ServerCog, ShieldCheck, Users } from "lucide-react";
import { PageShell, Prose } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security — CollaboratMD",
  description:
    "How CollaboratMD protects protected health information: encryption, access control, the append-only ledger and audit logging.",
};

const CONTROLS = [
  {
    icon: Lock,
    title: "Encryption",
    body: "TLS protects data in transit, including the connection to the database, whose certificate is verified. Data is encrypted at rest by our database host. Credentials never live in the application bundle.",
  },
  {
    icon: Users,
    title: "Role-based access and tenant isolation",
    body: "Four roles: administrator, biller, front desk and read-only. Posting, adjustments, voids and write-offs are limited to billers and administrators, and practice analytics to administrators. Every request is checked against the practice it belongs to.",
  },
  {
    icon: ScrollText,
    title: "Amounts are never edited",
    body: "A financial correction posts as a reversal rather than an edit to a posted amount, so the money trail reads forward and reconciles to the cent.",
  },
  {
    icon: ShieldCheck,
    title: "Audit log",
    body: "Key actions are recorded with the user, the action and the time: sign-in, claim submission, corrections and voids, discounts, payment plans, imports, lab orders, check-ins and integration keys.",
  },
  {
    icon: KeyRound,
    title: "Sign-in and session security",
    body: "Two-factor sign-in with any authenticator app, which an administrator can require for the whole practice, plus one-time recovery codes. Accounts lock for 15 minutes after five failed attempts. Sessions are signed, stored in an HTTP-only cookie and validated against the user record on each request, so a revoked account loses access immediately.",
  },
  {
    icon: ServerCog,
    title: "Secrets stored as hashes",
    body: "Integration keys, patient check-in and portal links, and recovery codes are stored only as SHA-256 hashes, and authenticator secrets are encrypted, so a copy of the database does not yield working credentials. Patient links lock after repeated wrong dates of birth. Card numbers are entered on Stripe's hosted page and never reach our servers; only the card brand and last four digits are kept.",
  },
];

export default function SecurityPage() {
  return (
    <PageShell
      eyebrow="Trust"
      title="Security at CollaboratMD"
      lead="Billing software holds the most sensitive record a practice keeps. Here is what protects it."
      wide
    >
      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {CONTROLS.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="group rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-lg hover:shadow-slate-900/5"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600 transition-colors group-hover:bg-green-600 group-hover:text-white">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-3xl">
        <Prose>
          <h2>HIPAA alignment</h2>
          <p>
            A practice using the platform is the covered entity; we are its business associate. A
            business associate agreement is available on request and is signed before any protected
            health information is loaded. It sets out what we may do with protected health information,
            how long we keep it, and what happens to it when the relationship ends. The technical
            safeguards above map to the Security Rule: access control, audit controls, integrity and
            transmission security.
          </p>

          <h2>Standards we implement</h2>
          <p>
            Claims and remittances are generated and parsed as real ASC X12 transactions rather than
            passed through a conversion layer: 837P for professional claims, 835 for remittance
            advice, 270 and 271 for eligibility, and 999 and 277CA acknowledgments; EHR and lab
            traffic is HL7 v2. Each is covered by segment-level tests, so a change that would alter a
            segment fails before it ships.
          </p>

          <h2>Reporting a vulnerability</h2>
          <p>
            If you believe you have found a security issue, tell us through the{" "}
            <a href="/contact">contact page</a> and select the security topic. Please include enough
            detail to reproduce it, and give us a reasonable period to investigate before publishing.
            We will confirm receipt within two business days.
          </p>

          <h2>Related reading</h2>
          <p>
            The <a href="/privacy">Privacy Policy</a> covers what we collect and why. The{" "}
            <a href="/gdpr">GDPR page</a> covers lawful bases, transfers and data subject rights.
          </p>
        </Prose>
      </div>
    </PageShell>
  );
}
