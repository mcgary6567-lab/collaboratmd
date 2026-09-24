import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";

/**
 * Marketing site header, shared by the landing page and every content page.
 *
 * `anchored` is true only on the landing page, where the section links are
 * in-page anchors. Everywhere else they have to jump home first.
 *
 * The small-screen menu is a native disclosure rather than component state, so
 * the header stays a server component and the menu opens without JavaScript.
 * Before this existed the navigation simply vanished below the large
 * breakpoint, which left a phone visitor with a logo and one button.
 */

type Item = { href: string; label: string; anchor?: boolean };

const ITEMS: Item[] = [
  { href: "#platform", label: "Platform", anchor: true },
  { href: "#workflow", label: "How it works", anchor: true },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({
  signedIn = false,
  anchored = false,
}: {
  signedIn?: boolean;
  anchored?: boolean;
}) {
  const href = (i: Item) => (i.anchor ? `${anchored ? "" : "/"}${i.href}` : i.href);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <Link href="/" aria-label="CollaboratMD home" className="shrink-0">
          <Logo id="cmd-nav" />
        </Link>

        {/* wide screens */}
        <div className="hidden items-center gap-1 lg:flex">
          {ITEMS.map((i) => (
            <a
              key={i.label}
              href={href(i)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {i.label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {signedIn ? (
            <Link href="/dashboard" className="btn bg-green-600 text-white hover:bg-green-700">
              Open dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:block"
              >
                Sign in
              </Link>
              <Link href="/login" className="btn bg-green-600 text-white hover:bg-green-700">
                View the demo <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}

          {/* small screens */}
          <details className="group relative lg:hidden">
            <summary
              aria-label="Menu"
              className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
            >
              <Menu className="h-5 w-5 group-open:hidden" />
              <X className="hidden h-5 w-5 group-open:block" />
            </summary>
            <div className="absolute right-0 top-12 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
              {ITEMS.map((i) => (
                <a
                  key={i.label}
                  href={href(i)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-green-700"
                >
                  {i.label}
                </a>
              ))}
              <div className="my-2 border-t border-slate-100" />
              <Link
                href={signedIn ? "/dashboard" : "/login"}
                className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-green-700 transition-colors hover:bg-green-50"
              >
                {signedIn ? "Open dashboard" : "Sign in"}
              </Link>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
