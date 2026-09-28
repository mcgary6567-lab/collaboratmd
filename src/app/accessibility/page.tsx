import type { Metadata } from "next";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY } from "@/content/company";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "How CollaboratMD works toward WCAG 2.1 Level AA, how it is checked, and how to report a problem.",
};

export default function AccessibilityPage() {
  const mail = `mailto:${COMPANY.contact.general}?subject=${encodeURIComponent("Accessibility")}`;
  return (
    <PageShell eyebrow="Legal" title="Accessibility" lead="Billing staff, front desk teams and patients should all be able to use CollaboratMD, including with a keyboard, a screen reader or magnification.">
      <Prose>
        <h2>Our target</h2>
        <p>
          We work toward the Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA, for the application, the patient check-in and payment pages, and this website.
        </p>

        <h2>How we check</h2>
        <ul>
          <li>Every release is tested automatically against WCAG 2.1 A and AA rules on every screen we can reach, at desktop and phone widths; serious and critical problems are treated as defects to fix.</li>
          <li>We build forms with visible labels and error messages in words rather than color alone, and design every action to work from the keyboard.</li>
          <li>The application has a dark theme and follows your device&apos;s light or dark setting.</li>
        </ul>
        <p>
          Automated tests find many problems, but not all of them. Some parts, such as long data tables and charts, may still be hard to use with assistive technology.
        </p>

        <h2>Tell us about a problem</h2>
        <p>
          If something is hard or impossible to use, email <a href={mail}>{COMPANY.contact.general}</a> with the page and what happened.
          We will reply, and if we cannot fix it quickly we will help you get the task done another way.
        </p>
      </Prose>
    </PageShell>
  );
}
