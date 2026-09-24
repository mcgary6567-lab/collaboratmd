import type { Metadata } from "next";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY, addressLine } from "@/content/company";
import { UnsubscribeForm } from "./unsubscribe-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe — CollaboratMD",
  description: "Remove your email address from CollaboratMD mailings.",
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return (
    <PageShell
      eyebrow="Email preferences"
      title="Unsubscribe"
      lead="Enter the address you want removed. No sign-in, no survey, no second confirmation email."
    >
      <UnsubscribeForm />

      <div className="mt-10">
        <Prose>
          <h2>What this does</h2>
          <p>
            The address is added to our suppression list and excluded from every future mailing. It
            takes effect on the next send, and in no case later than ten business days, which is the
            deadline the CAN-SPAM Act sets.
          </p>
          <p>
            This does not close an account or stop service messages about something you asked for,
            such as a reply to a message you sent us or a notice about your subscription.
          </p>

          <h2>Still hearing from us?</h2>
          <p>
            Write to <a href={`mailto:${COMPANY.contact.general}`}>{COMPANY.contact.general}</a> and
            we will remove the address by hand, or by mail to {COMPANY.legalName}, {addressLine()}.
          </p>
        </Prose>
      </div>
    </PageShell>
  );
}
