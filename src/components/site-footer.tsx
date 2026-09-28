import Link from "next/link";
import { ArrowRight, Lock, Mail, MapPin, MessageCircle, ScrollText, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { COMPANY, addressLines, whatsappLink } from "@/content/company";

const PRODUCT = [
  { href: "/#platform", label: "Platform" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#workflow", label: "How it works" },
  { href: "/#benchmarks", label: "Benchmarks" },
  { href: "/demo", label: "Live demo" },
];

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const RESOURCES = [
  { href: "/blog", label: "Blog" },
  { href: "/security", label: "Security" },
  { href: "/trust", label: "Trust center" },
  { href: "/changelog", label: "Changelog" },
  { href: "/status", label: "Status" },
  { href: "/switch", label: "Switching to us" },
  { href: "/#standards", label: "Standards" },
];

const LEGAL = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/baa", label: "Business Associate Agreement" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/gdpr", label: "GDPR (EU visitors)" },
];

const ASSURANCES = [
  { icon: ShieldCheck, label: "HIPAA-aligned design" },
  { icon: Lock, label: "TLS in transit; encrypted at rest by our hosts" },
  { icon: ScrollText, label: "Audit log of key actions" },
];

function Column({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-slate-600 transition-colors hover:text-green-700">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 pt-14">
        <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white px-7 py-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              See it running on a full-size practice
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              105,000 synthetic claims scrubbed, submitted, adjudicated by a simulated payer, denied and appealed. No sign-up form.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 sm:ml-auto sm:shrink-0">
            <Link href="/demo" className="btn bg-green-700 text-white hover:bg-green-800">
              Open the demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/contact" className="btn btn-secondary">
              Talk to us
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Logo id="cmd-footer" markClassName="h-9 w-9" textClassName="text-base" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
              Revenue cycle management for medical practices and billing companies. Eligibility,
              charge capture, claim scrubbing, 837P claims, remittance posting, denial management,
              patient billing and EHR and lab interfaces in one system.
            </p>
            <div className="mt-5 flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
              <address className="not-italic">
                {addressLines()[0]}
                <br />
                {addressLines()[1]}
              </address>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <a
                href={`mailto:${COMPANY.contact.general}`}
                className="flex items-center gap-2.5 text-slate-600 transition-colors hover:text-green-700"
              >
                <Mail className="h-4 w-4 shrink-0 text-green-700" />
                {COMPANY.contact.general}
              </a>
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2.5 text-slate-600 transition-colors hover:text-green-700"
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-green-700" />
                {COMPANY.contact.whatsappDisplay}
              </a>
            </div>

          </div>

          <Column title="Product" links={PRODUCT} />
          <Column title="Company" links={COMPANY_LINKS} />
          <Column title="Resources" links={RESOURCES} />
          <Column title="Legal" links={LEGAL} />
        </div>

        <div className="mt-12 flex flex-wrap gap-x-7 gap-y-3 border-t border-slate-200 pt-7">
          {ASSURANCES.map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <Icon className="h-4 w-4 text-green-700" />
              {label}
            </span>
          ))}
        </div>

        <div className="mt-7 flex flex-col gap-4 border-t border-slate-200 pt-7 sm:flex-row sm:items-center">
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm font-medium text-slate-600 sm:ml-auto">
            <Link href="/login" className="hover:text-green-700">Sign in</Link>
            <Link href="/unsubscribe" className="hover:text-green-700">Unsubscribe</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
