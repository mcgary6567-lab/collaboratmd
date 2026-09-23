import type { Metadata } from "next";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY, addressLine } from "@/content/company";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy — CollaboratMD",
  description:
    "How CollaboratMD collects, uses, stores and protects personal information and protected health information.",
};

export default function PrivacyPage() {
  return (
    <PageShell
      eyebrow="Legal"
      title="Privacy Policy"
      lead="What we collect, why we collect it, how long we keep it, and the choices you have."
      meta="Last updated September 23, 2026"
    >
      <Prose>
        <h2>1. Who we are</h2>
        <p>
          {COMPANY.legalName} provides revenue cycle management software to medical practices and
          the billing companies that serve them. Our office is at {addressLine()}. Throughout this
          policy, <strong>we</strong> means {COMPANY.legalName}, and <strong>you</strong> means a
          person who visits this website or uses the platform.
        </p>
        <p>
          When a practice uses the platform to bill for care, that practice is the covered entity
          and we act as its business associate under the Health Insurance Portability and
          Accountability Act. The practice decides what information enters the system and why. We
          process it on the practice&apos;s written instructions.
        </p>

        <h2>2. Information we collect</h2>
        <h3>Information you give us</h3>
        <ul>
          <li>Account details such as your name, work email address, role and practice affiliation.</li>
          <li>Anything you send through a contact form, a support request or a sales inquiry.</li>
          <li>Billing and payment details for the subscription, handled by our payment processor.</li>
        </ul>
        <h3>Information a practice enters</h3>
        <ul>
          <li>Patient demographics, insurance coverage and guarantor details.</li>
          <li>Encounters, diagnosis and procedure codes, charges and claim records.</li>
          <li>Remittance advice, payments, adjustments, denials and appeal correspondence.</li>
        </ul>
        <h3>Information we collect automatically</h3>
        <ul>
          <li>Log data: IP address, browser and device type, pages requested and timestamps.</li>
          <li>Audit records of who viewed or changed a record, which HIPAA requires us to keep.</li>
          <li>Strictly necessary cookies that keep you signed in and protect the sign-in form.</li>
        </ul>

        <h2>3. Why we use it</h2>
        <p>We use information for a short and specific list of purposes:</p>
        <ul>
          <li><strong>To run the service.</strong> Verifying eligibility, scrubbing and submitting claims, posting remittances, tracking denials and producing statements.</li>
          <li><strong>To keep it secure.</strong> Detecting unusual access, investigating incidents and maintaining the audit trail.</li>
          <li><strong>To support you.</strong> Answering questions, diagnosing problems and restoring data after an error.</li>
          <li><strong>To meet legal obligations.</strong> Retention, reporting and responses to lawful requests.</li>
          <li><strong>To improve the product,</strong> using aggregated figures that cannot identify a patient.</li>
        </ul>
        <p>
          We do not sell personal information. We do not use protected health information for
          advertising, and we do not train machine learning models on it.
        </p>

        <h2>4. When we share it</h2>
        <p>Information leaves the platform in four circumstances, and no others:</p>
        <ul>
          <li><strong>Payers and clearinghouses,</strong> to submit claims and receive remittance advice, which is the purpose of the software.</li>
          <li><strong>Service providers</strong> that host infrastructure or process payments, each under a written agreement that limits them to our instructions.</li>
          <li><strong>Legal requirements,</strong> where a subpoena, court order or statute compels disclosure. Where we are permitted to tell you, we will.</li>
          <li><strong>A change of control,</strong> such as a merger or acquisition, with notice before your information becomes subject to a different policy.</li>
        </ul>

        <h2>5. How long we keep it</h2>
        <p>
          Claim and remittance records are retained for the period the practice specifies, which is
          commonly six years to satisfy HIPAA and payer audit requirements. Audit logs follow the
          same schedule. Marketing contact details are kept until you ask us to remove them. When a
          practice ends its subscription, we return or destroy its records on the timetable in the
          business associate agreement.
        </p>

        <h2>6. How we protect it</h2>
        <ul>
          <li>Encryption in transit with TLS, and encryption at rest for stored records.</li>
          <li>Role-based access, so a front desk user cannot open the financial ledger.</li>
          <li>An append-only ledger: a correction is posted as a reversal, so history is never rewritten.</li>
          <li>Access logging on every record that contains protected health information.</li>
          <li>Backups with tested restores, and a documented incident response procedure.</li>
        </ul>
        <p>
          No system is perfectly secure. If a breach affects your information, we will notify you and
          the relevant authorities within the timeframes the law requires.
        </p>

        <h2>7. Your choices and rights</h2>
        <p>
          You may ask us to access, correct, export or delete the personal information we hold about
          you, and you may object to certain processing. If your information is in a practice&apos;s
          records, we will refer your request to that practice, since it decides what happens to the
          data it controls.
        </p>
        <p>
          Residents of California, Colorado, Connecticut, Utah, Virginia and other states with
          comprehensive privacy laws have specific statutory rights, including the right not to be
          discriminated against for exercising them. Residents of the European Economic Area and the
          United Kingdom should read the <a href="/gdpr">GDPR page</a>, which sets out the lawful
          bases we rely on and how to reach our data protection contact.
        </p>

        <h2>8. Cookies</h2>
        <p>
          The platform uses strictly necessary cookies only: one session cookie that keeps you signed
          in, and protections against cross-site request forgery. We set no advertising cookies and
          run no third-party trackers, so there is no consent banner to dismiss.
        </p>

        <h2>9. Children</h2>
        <p>
          The platform is sold to healthcare organizations, not to individuals, and no one under 18
          may create an account. Pediatric records may of course appear in a practice&apos;s data;
          they are protected health information and are handled under the practice&apos;s direction.
        </p>

        <h2>10. Changes to this policy</h2>
        <p>
          We will post any revision on this page and update the date above. For a change that
          materially affects your rights, we will give advance notice by email or inside the
          application before it takes effect.
        </p>

        <h2>11. Contact us</h2>
        <p>
          Write to our privacy team through the <a href="/contact">contact page</a>, or by mail to{" "}
          {COMPANY.legalName}, {addressLine()}. We answer privacy requests within 30 days, and we
          will tell you if we need longer.
        </p>
      </Prose>
    </PageShell>
  );
}
