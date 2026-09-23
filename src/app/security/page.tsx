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
    title: "Encryption everywhere",
    body: "TLS protects data in transit and storage is encrypted at rest. Database connections require TLS, and credentials never live in the application bundle.",
  },
  {
    icon: Users,
    title: "Role-based access",
    body: "Front desk, biller and administrator each see a different application. Practice analytics and the financial ledger are closed to roles that have no business reason to open them.",
  },
  {
    icon: ScrollText,
    title: "Append-only ledger",
    body: "A financial correction posts as a reversal rather than an edit. No row is rewritten, so the money trail reads forward and reconciles to the cent.",
  },
  {
    icon: ShieldCheck,
    title: "Audit trail on PHI",
    body: "Every read and write of a record containing protected health information is logged with the user, the action and the timestamp, and retained on the practice's schedule.",
  },
  {
    icon: KeyRound,
    title: "Session security",
    body: "Sessions are signed and stored in an HTTP-only cookie, validated against the user record on each request so a revoked account loses access immediately.",
  },
  {
    icon: ServerCog,
    title: "Tested restores",
    body: "Backups are meaningless until a restore is proven. Ours are exercised on a schedule, and the migration path is bundled with the application rather than read off a disk at runtime.",
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
            A practice using the platform is the covered entity; we are its business associate. The
            business associate agreement sets out what we may do with protected health information,
            how long we keep it, and what happens to it when the relationship ends. The technical
            safeguards above map to the Security Rule: access control, audit controls, integrity and
            transmission security.
          </p>

          <h2>Standards we implement</h2>
          <p>
            Claims and remittances are generated and parsed as real ASC X12 transactions rather than
            passed through a conversion layer: 837P for professional claims, 835 for remittance
            advice, and 270 and 271 for eligibility. Each is validated against golden-file fixtures
            in the test suite, so a change that would alter a segment fails before it ships.
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
