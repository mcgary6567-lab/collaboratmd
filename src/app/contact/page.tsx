import type { Metadata } from "next";
import { BookOpen, LifeBuoy, Lock, MessagesSquare } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { ContactForm } from "./contact-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact — CollaboratMD",
  description:
    "Talk to the CollaboratMD team about pricing, product support, privacy requests or a security disclosure.",
};

const ROUTES = [
  {
    icon: MessagesSquare,
    title: "Sales and pricing",
    body: "Walk through the platform with a full-size practice behind it and get a quote based on claim volume.",
  },
  {
    icon: LifeBuoy,
    title: "Product support",
    body: "Existing customers reach the support queue here. Include the claim control number when a specific claim is involved.",
  },
  {
    icon: Lock,
    title: "Privacy and security",
    body: "Data subject requests and vulnerability reports are triaged separately. Pick the matching topic and we will confirm receipt.",
  },
  {
    icon: BookOpen,
    title: "Press and partnerships",
    body: "Clearinghouse integrations, payer connections and media questions all start with the same form.",
  },
];

export default function ContactPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="Talk to us"
      lead="Tell us what you need and pick the topic that fits. Sales, support, privacy and security each go to a different queue."
      wide
    >
      <div className="grid gap-12 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm lg:p-9">
            <ContactForm />
          </div>
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-green-600">
            Where your message goes
          </h2>
          <div className="mt-5 space-y-5">
            {ROUTES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h3 className="text-sm font-bold text-slate-900">Response times</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Sales inquiries</dt>
                <dd className="font-semibold text-slate-900">1 business day</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Support requests</dt>
                <dd className="font-semibold text-slate-900">4 business hours</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Security disclosures</dt>
                <dd className="font-semibold text-slate-900">2 business days</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Privacy requests</dt>
                <dd className="font-semibold text-slate-900">30 days</dd>
              </div>
            </dl>
            <p className="mt-5 text-xs leading-relaxed text-slate-500">
              These are the targets a live deployment would publish. This demonstration site has no
              mailbox behind the form, so nothing you send is delivered or stored.
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
