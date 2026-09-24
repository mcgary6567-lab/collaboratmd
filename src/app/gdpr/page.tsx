import type { Metadata } from "next";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY, addressLine } from "@/content/company";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GDPR — CollaboratMD",
  description:
    "How CollaboratMD meets the General Data Protection Regulation: lawful bases, data subject rights, transfers and sub-processors.",
};

const RIGHTS = [
  { right: "Access", article: "Article 15", what: "Get a copy of your personal data and learn how it is used." },
  { right: "Rectification", article: "Article 16", what: "Have inaccurate data corrected and incomplete data completed." },
  { right: "Erasure", article: "Article 17", what: "Have data deleted where no legal duty requires us to keep it." },
  { right: "Restriction", article: "Article 18", what: "Pause processing while an accuracy or objection dispute is resolved." },
  { right: "Portability", article: "Article 20", what: "Receive your data in a structured, machine-readable format." },
  { right: "Objection", article: "Article 21", what: "Object to processing based on our legitimate interests." },
  { right: "Automated decisions", article: "Article 22", what: "Not be subject to a decision based solely on automated processing." },
];

export default function GdprPage() {
  return (
    <PageShell
      eyebrow="Legal"
      title="GDPR compliance"
      lead="How we meet the General Data Protection Regulation, what we rely on to process data, and how to exercise your rights."
      meta="Last updated September 23, 2026"
    >
      <Prose>
        <h2>1. Controller and processor</h2>
        <p>
          Where a practice uses the platform to bill for care, the practice is the{" "}
          <strong>controller</strong>: it decides why and how personal data is processed. We are the{" "}
          <strong>processor</strong>, acting only on the controller&apos;s documented instructions
          under Article 28. For our own website visitors and for the administration of our
          subscriptions, we are the controller.
        </p>

        <h2>2. Lawful bases</h2>
        <ul>
          <li><strong>Contract (Article 6(1)(b)).</strong> Providing the service you subscribed to, and administering your account.</li>
          <li><strong>Legal obligation (Article 6(1)(c)).</strong> Retention and reporting duties, including audit records.</li>
          <li><strong>Legitimate interests (Article 6(1)(f)).</strong> Securing the platform, preventing fraud and improving the product, balanced against your rights.</li>
          <li><strong>Consent (Article 6(1)(a)).</strong> Optional communications, which you can withdraw at any time.</li>
        </ul>
        <p>
          Health data is a special category under Article 9. It is processed under Article 9(2)(h),
          for the management of health care services, on the controller&apos;s instructions and
          subject to the duty of professional secrecy.
        </p>

        <h2>3. Your rights</h2>
        <p>Under the Regulation you have the following rights. Use the contact details in section 8 to exercise any of them.</p>
      </Prose>

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-5 py-3 font-semibold text-slate-600">Right</th>
              <th className="hidden px-5 py-3 font-semibold text-slate-600 sm:table-cell">Article</th>
              <th className="px-5 py-3 font-semibold text-slate-600">What it means</th>
            </tr>
          </thead>
          <tbody>
            {RIGHTS.map((r) => (
              <tr key={r.right} className="border-t border-slate-200">
                <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">{r.right}</td>
                <td className="hidden whitespace-nowrap px-5 py-4 font-medium text-green-700 sm:table-cell">{r.article}</td>
                <td className="px-5 py-4 text-slate-600">{r.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10">
        <Prose>
          <p>
            We respond within one month, as Article 12 requires. If a request is complex we may
            extend by two further months and will tell you why within the first month. We do not
            charge a fee unless a request is manifestly unfounded or excessive.
          </p>
          <p>
            If your data sits in a practice&apos;s records, we will forward your request to that
            practice without undue delay, because the controller decides the outcome.
          </p>

          <h2>4. International transfers</h2>
          <p>
            Our infrastructure is hosted in the United States. Where personal data moves from the
            European Economic Area, the United Kingdom or Switzerland, we rely on the European
            Commission&apos;s Standard Contractual Clauses together with a transfer impact
            assessment, and on the UK International Data Transfer Addendum where it applies.
          </p>

          <h2>5. Sub-processors</h2>
          <p>
            We engage sub-processors for hosting, database services, email delivery and, when a
            practice enables AI features, Anthropic, which receives only non-identifying codes and
            column descriptions. Each is bound by a written contract imposing the same obligations we
            carry. The current list is available on request, and we give controllers advance notice
            of any addition, with the right to object.
          </p>

          <h2>6. Security and breach notification</h2>
          <p>
            We apply the technical and organizational measures Article 32 requires: encryption in
            transit, encryption at rest by our hosting providers, role-based access control, an
            audit log of key actions, and the database host&apos;s backups. If a
            personal data breach occurs, we notify the controller without undue delay so it can meet
            the 72-hour deadline in Article 33.
          </p>

          <h2>7. Retention and data minimization</h2>
          <p>
            We collect only what the service needs and keep it only as long as the controller
            specifies or the law requires. At the end of a subscription we return or delete personal
            data on the controller&apos;s instruction, retaining only what a legal obligation
            compels us to keep.
          </p>

          <h2>8. Contact and complaints</h2>
          <p>
            Reach our data protection contact through the <a href="/contact">contact page</a>,
            selecting the privacy topic, or by mail to {COMPANY.legalName}, {addressLine()}. You
            also have the right to lodge a complaint with your local supervisory authority, and we
            would ask that you raise the matter with us first so we have the chance to put it
            right.
          </p>
        </Prose>
      </div>
    </PageShell>
  );
}
