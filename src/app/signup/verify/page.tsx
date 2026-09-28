import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/db";
import { LogoMark } from "@/components/logo";
import { readSignup, trialDays } from "@/server/signup";
import { ConfirmSignup } from "./confirm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your signup" };

/** Opening the link changes nothing; the button does, so a mail scanner that follows links cannot create the practice. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const pending = await readSignup(await getDb(), token);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-verify" />
          <h1 className="text-2xl font-bold">{pending ? "Create your practice" : "This link has expired"}</h1>
        </div>
        <div className="card p-6 shadow-xl text-sm">
          {pending ? (
            <>
              <p className="text-slate-700">Your email is confirmed. Create <b>{pending.practiceName}</b> with <b>{pending.email}</b> as its administrator and start the {trialDays()}-day trial.</p>
              <ConfirmSignup token={token} />
            </>
          ) : (
            <p className="text-slate-700">The link was already used or is more than a day old. <Link href="/signup" className="font-semibold text-brand-700 hover:underline">Sign up again</Link>, or <Link href="/login" className="font-semibold text-brand-700 hover:underline">sign in</Link> if you already finished.</p>
          )}
        </div>
      </div>
    </main>
  );
}
