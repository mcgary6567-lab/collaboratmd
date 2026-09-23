import Link from "next/link";
import { Logo } from "@/components/logo";

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
  { href: "/#workflow", label: "How it works" },
  { href: "/#benchmarks", label: "Benchmarks" },
  { href: "/#standards", label: "Standards" },
  { href: "/login", label: "Live demo" },
];

const COMPANY = [
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
  { href: "/security", label: "Security" },
];

const LEGAL = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/gdpr", label: "GDPR" },
];

/**
 * The social links point at the platforms themselves. This is a demonstration
 * product with no accounts of its own, and inventing profile URLs would send
 * people somewhere that does not represent it.
 */
const SOCIAL = [
  { href: "https://www.facebook.com/", label: "Facebook", Icon: FacebookIcon },
  { href: "https://x.com/", label: "X", Icon: XIcon },
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
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo id="cmd-footer" markClassName="h-9 w-9" textClassName="text-base" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
              Revenue cycle management for medical practices and billing companies. Eligibility,
              charge capture, claim scrubbing, electronic submission, remittance posting, denial
              management and patient billing in one system.
            </p>
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
          <Column title="Company" links={COMPANY} />
          <Column title="Legal" links={LEGAL} />
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-slate-200 pt-7 sm:flex-row sm:items-center">
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} CollaboratMD. A demonstration platform running on synthetic
            data. Not for real patient information.
          </p>
          <div className="flex gap-6 text-sm font-medium text-slate-600 sm:ml-auto">
            <Link href="/login" className="hover:text-green-700">Sign in</Link>
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
