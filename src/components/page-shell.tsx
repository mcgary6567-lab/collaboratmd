import { getSession } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/**
 * Shell for every marketing and content page: shared header, a titled hero,
 * and the shared footer. Keeping it in one place is what stops the legal
 * pages from drifting away from the rest of the site as either one changes.
 */
export async function PageShell({
  eyebrow,
  title,
  lead,
  meta,
  children,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  meta?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const session = await getSession();
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader signedIn={!!session} />

      <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(45rem_22rem_at_50%_-8rem,rgba(22,163,74,0.13),transparent)]"
        />
        <div className="relative mx-auto max-w-7xl px-6 py-14 lg:py-20">
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">{eyebrow}</span>
          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          {lead && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">{lead}</p>}
          {meta && <p className="mt-5 text-sm font-medium text-slate-500">{meta}</p>}
        </div>
      </section>

      <main className={`mx-auto px-6 py-14 lg:py-20 ${wide ? "max-w-7xl" : "max-w-3xl"}`}>{children}</main>

      <SiteFooter />
    </div>
  );
}

/** Long-form text styling, hand-rolled so the site carries no typography plugin. */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="
        text-[15px] leading-relaxed text-slate-700
        [&>h2]:mt-12 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:tracking-tight [&>h2]:text-slate-900
        [&>h2:first-child]:mt-0
        [&>h3]:mt-8 [&>h3]:text-base [&>h3]:font-bold [&>h3]:text-slate-900
        [&>p]:mt-4
        [&>ul]:mt-4 [&>ul]:space-y-2 [&>ul]:pl-5
        [&>ul>li]:list-disc [&>ul>li]:marker:text-green-600
        [&>ol]:mt-4 [&>ol]:space-y-2 [&>ol]:pl-5
        [&>ol>li]:list-decimal [&>ol>li]:marker:font-semibold [&>ol>li]:marker:text-green-600
        [&_a]:font-medium [&_a]:text-green-700 [&_a]:underline [&_a]:underline-offset-2
        [&_strong]:font-semibold [&_strong]:text-slate-900
      "
    >
      {children}
    </div>
  );
}

/** Callout used on the legal pages to say plainly what this document is. */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-10 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm leading-relaxed text-green-900">
      {children}
    </div>
  );
}
