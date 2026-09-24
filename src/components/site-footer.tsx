import Link from "next/link";
import { ArrowRight, Lock, Mail, MapPin, MessageCircle, ScrollText, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { COMPANY, addressLines, whatsappLink } from "@/content/company";

/**
 * Brand glyphs are drawn here rather than pulled from the icon set: the icon
 * set ships a generic bird and a close-cross, neither of which is the mark
 * people recognize.
 */
function FacebookIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z" />
    </svg>
  );
}

function XIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.53 3h3.14l-6.86 7.84L22 21h-6.31l-4.95-6.47L5.08 21H1.93l7.34-8.39L2 3h6.47l4.47 5.91L17.53 3Zm-1.1 16.13h1.74L7.65 4.78H5.79l10.64 14.35Z" />
    </svg>
  );
}

const PRODUCT = [
  { href: "/#platform", label: "Platform" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#workflow", label: "How it works" },
  { href: "/#benchmarks", label: "Benchmarks" },
  { href: "/login", label: "Live demo" },
];

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/investors", label: "Investors" },
  { href: "/contact", label: "Contact" },
];

const RESOURCES = [
  { href: "/blog", label: "Blog" },
  { href: "/security", label: "Security" },
  { href: "/#standards", label: "Standards" },
];

const LEGAL = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/gdpr", label: "GDPR" },
];

/**
 * Replace these with the company profiles once the accounts exist. They point
 * at the platforms themselves for now, because a wrong handle sends visitors
 * to somebody else's page.
 */
const SOCIAL = [
  { href: "https://www.facebook.com/", label: "Facebook", Icon: FacebookIcon },
  { href: "https://x.com/", label: "X", Icon: XIcon },
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
            <Link href="/login" className="btn bg-green-600 text-white hover:bg-green-700">
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
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
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
                <Mail className="h-4 w-4 shrink-0 text-green-600" />
                {COMPANY.contact.general}
              </a>
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2.5 text-slate-600 transition-colors hover:text-green-700"
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-green-600" />
                {COMPANY.contact.whatsappDisplay}
              </a>
            </div>

            <div className="mt-5 flex items-center gap-2.5">
              {SOCIAL.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-green-600 hover:bg-green-600 hover:text-white"
                >
                  <Icon />
                </a>
              ))}
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
              <Icon className="h-4 w-4 text-green-600" />
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
            <a
              href="https://github.com/mcgary6567-lab/collaboratmd"
              className="hover:text-green-700"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
