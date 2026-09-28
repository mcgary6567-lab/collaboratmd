import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY } from "@/content/company";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Business Associate Agreement",
  description: "CollaboratMD signs a HIPAA business associate agreement with every practice and billing company before it handles protected health information.",
};

export default function BaaPage() {
  const mail = `mailto:${COMPANY.contact.general}?subject=${encodeURIComponent("Business associate agreement request")}`;
  return (
    <PageShell eyebrow="Legal" title="Business Associate Agreement" lead="Under HIPAA, a billing service that handles protected health information for a covered entity is its business associate. We sign a business associate agreement (BAA) with every customer before real patient data goes into the system.">
      <Prose>
        <h2>Who needs one</h2>
        <p>
          Every practice, and every billing company working for practices, that puts protected health information into CollaboratMD.
          A billing company signs with us as its subcontractor, and with each practice it serves as that practice&apos;s business associate.
        </p>

        <h2>What it covers</h2>
        <p>The agreement contains what the HIPAA Privacy and Security Rules require of one (45 CFR 164.504(e) and 164.314(a)). In it we agree to:</p>
        <ul>
          <li>use and disclose protected health information only to provide the service, or as the law requires;</li>
          <li>apply administrative, physical and technical safeguards under the Security Rule;</li>
          <li>report any use or disclosure the agreement does not allow, including breaches of unsecured protected health information and security incidents;</li>
          <li>hold our own subcontractors that handle the information to the same restrictions, through agreements of their own;</li>
          <li>make the information available so you can meet patients&apos; rights to access, amend and receive an accounting of disclosures;</li>
          <li>make our practices and records available to the Department of Health and Human Services on request;</li>
          <li>return or destroy the information when the service ends, where that is feasible.</li>
        </ul>
        <p>
          The services we use to run CollaboratMD, and what each one handles, are listed in the <Link href="/trust">trust center</Link>.
          How the system itself protects data is on the <Link href="/security">security page</Link>.
        </p>

        <h2>Before it is signed</h2>
        <p>
          You can set up a practice and try every feature with test data. The setup checklist keeps a reminder until the agreement is in place.
          Please do not enter real patient information until it is signed.
        </p>

        <h2>Requesting the agreement</h2>
        <p>
          Email <a href={mail}>{COMPANY.contact.general}</a> with your organization&apos;s legal name and the person who will sign.
          We send our agreement for your review. If your organization has its own form, send it and we will review it.
        </p>
      </Prose>
    </PageShell>
  );
}
