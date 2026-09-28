import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { LogoMark } from "@/components/logo";
import { TIERS } from "@/content/pricing";
import { SELF_SERVE_PLANS, trialDays } from "@/server/signup";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Start a free trial" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { plan } = await searchParams;
  const plans = TIERS.filter((t) => SELF_SERVE_PLANS.includes(t.id)).map((t) => ({ id: t.id, name: `${t.name}, $${t.priceMonthly} per provider per month` }));
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-signup" />
          <h1 className="text-2xl font-bold">Start your free trial</h1>
          <p className="text-sm text-white/85">Set up your practice and send your first claims. Subscribe when the trial ends.</p>
        </div>
        <div className="card p-6 shadow-xl">
          <SignupForm plans={plans} plan={plan && SELF_SERVE_PLANS.includes(plan) ? plan : plans[0]?.id ?? ""} trialDays={trialDays()} />
          <p className="mt-4 text-center text-sm text-slate-600">Already have an account? <Link href="/login" className="font-semibold text-brand-700 hover:underline">Sign in</Link></p>
          <p className="mt-1 text-center text-sm text-slate-600">A billing company with many practices? <Link href="/contact" className="font-semibold text-brand-700 hover:underline">Talk to us</Link></p>
        </div>
      </div>
    </main>
  );
}
