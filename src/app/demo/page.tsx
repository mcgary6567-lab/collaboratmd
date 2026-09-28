import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardList, ReceiptText, Settings } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { DEMO_ACCOUNTS, demoOpen, type DemoRole } from "@/lib/demo";
import { tryDemoAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Try the demo",
  description: "Work a full-size sample practice as a biller, the front desk or an administrator. Fictional patients; no account needed.",
};

const ICON: Record<DemoRole, typeof ReceiptText> = { biller: ReceiptText, front_desk: ClipboardList, admin: Settings };

/** One click into the demo practice as a role (lib/demo.ts), or, where the demo is closed, a way to see it with us. */
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ busy?: string }> }) {
  const { busy } = await searchParams;
  if (!demoOpen()) {
    return (
      <PageShell eyebrow="Demo" title="See CollaboratMD on a sample practice" lead="The self-serve demo is not open on this site. We will walk you through it on a call, using a sample practice with fictional patients, or you can start a free trial with your own practice.">
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/contact?topic=sales" className="btn bg-green-700 text-white hover:bg-green-800">Book a walkthrough <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          <Link href="/signup" className="btn btn-secondary">Start a free trial</Link>
        </div>
      </PageShell>
    );
  }
  return (
    <PageShell eyebrow="Demo" title="Try it on a full-size sample practice" lead="Lakeside Family Medicine is a made-up practice with fictional patients and a year of claims, payments and denials. Pick the job you do; nothing you change leaves the demo.">
      {busy && <p className="mt-6 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">Too many tries from this network. Wait a minute and try again.</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {(Object.keys(DEMO_ACCOUNTS) as DemoRole[]).map((role) => {
          const a = DEMO_ACCOUNTS[role];
          const I = ICON[role];
          return (
            <form key={role} action={tryDemoAction.bind(null, role)} className="card flex flex-col p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-700"><I className="h-5 w-5" aria-hidden /></span>
              <h2 className="mt-3 text-base font-semibold text-slate-900">{a.label}</h2>
              <p className="mt-1 flex-1 text-sm text-slate-600">{a.does}</p>
              <button className="btn mt-4 justify-center bg-green-700 text-white hover:bg-green-800">Try as {a.label.toLowerCase()} <ArrowRight className="h-4 w-4" aria-hidden /></button>
            </form>
          );
        })}
      </div>
      <p className="mt-6 text-sm text-slate-600">
        Ready for your own practice? <Link href="/signup" className="font-semibold text-brand-700 hover:underline">Start a free trial</Link>. Please do not enter real patient information in the demo.
      </p>
    </PageShell>
  );
}
