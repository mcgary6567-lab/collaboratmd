import type { Metadata } from "next";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY, addressLine } from "@/content/company";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms & Conditions — CollaboratMD",
  description:
    "The agreement that governs access to and use of the CollaboratMD revenue cycle management platform.",
};

export default function TermsPage() {
  return (
    <PageShell
      eyebrow="Legal"
      title="Terms & Conditions"
      lead="The agreement between CollaboratMD and the organizations that use the platform."
      meta="Last updated September 23, 2026"
    >
      <Prose>
        <h2>1. Agreement to these terms</h2>
        <p>
          These Terms and Conditions govern access to and use of the {COMPANY.legalName} website
          and platform, operated by {COMPANY.legalName}, {addressLine()}. By creating an account, signing an order form or using the service, you agree to
          them. If you are agreeing on behalf of an organization, you confirm that you have the
          authority to bind it, and <strong>you</strong> then means that organization.
        </p>

        <h2>2. The service</h2>
        <p>
          CollaboratMD is software for revenue cycle management: eligibility verification, charge
          capture, claim scrubbing, electronic claim submission, remittance posting, denial
          management, patient billing and reporting. We provide the software. We do not provide
          medical, coding, legal or financial advice, and we do not decide what to bill.
        </p>

        <h2>3. Your account</h2>
        <ul>
          <li>Give accurate registration details and keep them current.</li>
          <li>Keep credentials confidential, and use one account per person. Shared logins defeat the audit trail that HIPAA requires.</li>
          <li>Tell us promptly if you suspect unauthorized access.</li>
          <li>You are responsible for everything done under your account.</li>
        </ul>

        <h2>4. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Submit a claim you know to be false, or use the platform to misrepresent services rendered.</li>
          <li>Upload malicious code, or probe, scan or attempt to breach the service.</li>
          <li>Reverse engineer the platform, or copy it to build a competing product.</li>
          <li>Resell or sublicense access without our written agreement.</li>
          <li>Use the service in a way that breaks any applicable law, including HIPAA, the False Claims Act and the Anti-Kickback Statute.</li>
        </ul>

        <h2>5. Your data</h2>
        <p>
          You keep ownership of everything you put into the platform. You grant us only the license
          needed to host, process, transmit and back it up so the service can function. Where the
          data includes protected health information, our business associate agreement governs and
          controls over any conflicting term in this document.
        </p>
        <p>
          You are responsible for the accuracy of what you enter, for the codes you select and for
          the claims you submit. The scrubber catches many errors. It does not make the submission
          correct, and it is not a substitute for a qualified coder.
        </p>

        <h2>6. Fees and payment</h2>
        <p>
          Fees are set in your order form. Subscriptions renew for successive terms unless either
          party gives notice before the renewal date. Invoices are due 30 days from issue. Late
          amounts may carry interest at the lower of 1.5% per month or the maximum the law allows.
          Fees exclude taxes, which are your responsibility. We may change pricing for a renewal
          term with 60 days&apos; notice.
        </p>

        <h2>7. Availability and support</h2>
        <p>
          We work to keep the service available at all times, excluding scheduled maintenance
          announced in advance and events outside our reasonable control. Where an order form
          includes a service level agreement, the remedies in it are your exclusive remedy for
          missed availability.
        </p>

        <h2>8. Intellectual property</h2>
        <p>
          The platform, its interface and its documentation remain our property and that of our
          licensors. We grant you a non-exclusive, non-transferable right to use the service during
          your subscription, for your internal business purposes. Nothing else is granted.
        </p>

        <h2>9. Third-party services</h2>
        <p>
          The platform exchanges transactions with clearinghouses, payers, EHRs and laboratories.
          Their performance is their own, and their terms govern their services. We are not
          responsible for a payer&apos;s adjudication decision or for how long it takes.
        </p>

        <h2>10. Disclaimers</h2>
        <p>
          Except as expressly stated, the service is provided <strong>as is</strong> and{" "}
          <strong>as available</strong>, without warranties of any kind, whether express, implied or
          statutory, including merchantability, fitness for a particular purpose and
          non-infringement. We do not warrant that a claim will be accepted, that a payer will pay,
          or that any particular financial result will follow from using the platform.
        </p>

        <h2>11. Limitation of liability</h2>
        <p>
          To the fullest extent the law permits, neither party is liable for indirect, incidental,
          special, consequential or punitive damages, or for lost profits, revenue or data. Our
          total liability arising out of this agreement is capped at the fees you paid in the twelve
          months before the event giving rise to the claim. These limits do not apply to a
          party&apos;s indemnification obligations, to breach of confidentiality, or to liability
          that cannot be limited by law.
        </p>

        <h2>12. Indemnification</h2>
        <p>
          You will defend and indemnify us against claims arising from your use of the service in
          breach of these terms or of applicable law, including claims about the accuracy of what
          you submitted. We will defend and indemnify you against claims that the platform, used as
          permitted, infringes a third party&apos;s intellectual property rights.
        </p>

        <h2>13. Term and termination</h2>
        <p>
          Either party may terminate for material breach that is not cured within 30 days of written
          notice. On termination, your right to use the service ends and we will provide an export
          of your data on request for 30 days, after which we may delete it in line with the business
          associate agreement and the <a href="/privacy">Privacy Policy</a>.
        </p>

        <h2>14. Changes</h2>
        <p>
          We may update these terms. For a material change we will give 30 days&apos; notice by
          email or inside the application. Continuing to use the service after the change takes
          effect means you accept the revision.
        </p>

        <h2>15. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of the State of {COMPANY.jurisdiction.state},
          without regard to its conflict of laws rules. The parties will attempt to resolve any
          dispute in good faith for 30 days before starting proceedings, which will be brought in
          the state or federal courts located in {COMPANY.jurisdiction.county},{" "}
          {COMPANY.jurisdiction.state}.
        </p>

        <h2>16. General</h2>
        <p>
          If a provision is held unenforceable, the rest stays in force. A failure to enforce a right
          is not a waiver of it. You may not assign this agreement without our consent, except to a
          successor in a merger or a sale of substantially all assets. These terms, the order form
          and the business associate agreement are the entire agreement between us.
        </p>

        <h2>17. Contact</h2>
        <p>
          Questions about these terms go to our legal team through the{" "}
          <a href="/contact">contact page</a>, or by mail to {COMPANY.legalName}, {addressLine()}.
        </p>
      </Prose>
    </PageShell>
  );
}
