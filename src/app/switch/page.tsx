import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Switching to CollaboratMD",
  description: "How a practice moves its billing to CollaboratMD: what to export from the old system, how patients and charges come across, and how to run both side by side until the old A/R is worked down.",
};

const STEPS = [
  {
    title: "Set up the practice",
    body: "Enter the group NPI, tax ID and address as they appear on your payer enrollments; add providers, payers with their payer IDs, your fee schedule and contracted rates. The setup checklist in the product tracks what is left.",
  },
  {
    title: "Bring your patients",
    body: "Export the patient list from your old system as CSV (any layout). The importer matches the columns for you, shows the first rows before anything is saved, skips duplicates, and can be run again without creating copies.",
  },
  {
    title: "Connect your EHR, or keep entering charges",
    body: "An HL7 v2 feed (ADT for patients, DFT for charges) keeps patients and visits flowing in without re-keying. Without one, staff enter charges on one screen, with coding help beside it.",
  },
  {
    title: "Connect the services you use",
    body: "Under Settings, Integrations: your clearinghouse (Stedi), card payments (Stripe), texting (Twilio), email (Resend) and AI (Claude). Paste the keys, test, and the features that need them switch on.",
  },
  {
    title: "Enroll with payers for electronic claims",
    body: "Your clearinghouse handles enrollment for 837 claims and 835 remittances (ERA) with each payer. Track each provider's enrollment and revalidation dates in the product so nothing lapses.",
  },
  {
    title: "Run both systems until the old A/R is worked",
    body: "Send new visits from CollaboratMD from a chosen date of service; keep working claims already billed in the old system there until they are paid or closed. Keep access to the old system until its last claims and patient balances are settled.",
  },
];

const EXPORT = [
  "Patient demographics and insurance (CSV)",
  "Your fee schedule and payer contract rates",
  "Payer list with clearinghouse payer IDs",
  "Open patient balances, if you want them carried over",
  "Copies of any payment plans in progress",
  "Recent denial and A/R aging reports, to compare against after the switch",
];

export default function SwitchPage() {
  return (
    <PageShell eyebrow="Switching" title="Moving your billing to CollaboratMD" lead="A switch is mostly about not losing money in the middle. Here is the order that keeps claims going out and payments coming in while you move." wide>
      <div className="mt-10 grid gap-12 lg:grid-cols-3">
        <ol className="space-y-6 lg:col-span-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">{i + 1}</span>
              <div>
                <h2 className="font-bold text-slate-900">{s.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="font-bold text-slate-900">Export from your old system</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">{EXPORT.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
          <div className="rounded-2xl border border-slate-200 p-6">
            <h2 className="font-bold text-slate-900">See it first</h2>
            <p className="mt-2 text-sm text-slate-700">Every step above can be tried in the demo, which runs on a full-size synthetic practice.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/login" className="btn bg-green-600 text-white hover:bg-green-700">Open the demo</Link>
              <Link href="/contact" className="btn btn-secondary">Plan a switch with us</Link>
            </div>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
