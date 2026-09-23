import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";

/**
 * Marketing site header, shared by the landing page and every content page.
 *
 * `anchored` is true only on the landing page, where the section links are
 * in-page anchors. Everywhere else they have to jump home first, or they do
 * nothing at all.
 */
export function SiteHeader({
  signedIn = false,
  anchored = false,
}: {
  signedIn?: boolean;
  anchored?: boolean;
}) {
  const p = anchored ? "" : "/";
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <Link href="/" aria-label="CollaboratMD home">
          <Logo id="cmd-nav" />
        </Link>
        <div className="hidden items-center gap-7 text-sm font-medium text-slate-600 lg:flex">
          <a href={`${p}#platform`} className="hover:text-slate-900">Platform</a>
          <a href={`${p}#workflow`} className="hover:text-slate-900">How it works</a>
          <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
          <Link href="/blog" className="hover:text-slate-900">Blog</Link>
          <Link href="/contact" className="hover:text-slate-900">Contact</Link>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {signedIn ? (
            <Link href="/dashboard" className="btn bg-green-600 text-white hover:bg-green-700">
              Open dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden text-sm font-semibold text-slate-600 hover:text-slate-900 sm:block">
                Sign in
              </Link>
              <Link href="/login" className="btn bg-green-600 text-white hover:bg-green-700">
                View the demo <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
