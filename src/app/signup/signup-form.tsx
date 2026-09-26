"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "./actions";

export function SignupForm({ plans, plan, trialDays }: { plans: { id: string; name: string }[]; plan: string; trialDays: number }) {
  const [state, action, pending] = useActionState(signupAction, undefined);
  if (state?.done) {
    return (
      <div className="rounded-lg bg-green-50 px-4 py-4 text-sm text-green-900">
        <p className="font-semibold">Check your email</p>
        <p className="mt-1">We sent a link to confirm your address. Open it within 24 hours to create your practice and start the {trialDays}-day trial. No email after a few minutes? Check spam.</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{state.error}</p>}
      <label className="block"><span className="label">Your name</span><input name="name" className="input" autoComplete="name" required /></label>
      <label className="block"><span className="label">Work email</span><input name="email" type="email" className="input" autoComplete="email" required /></label>
      <label className="block"><span className="label">Practice or billing company name</span><input name="practiceName" className="input" autoComplete="organization" required /></label>
      <label className="block"><span className="label">Password (at least 12 characters)</span><input name="password" type="password" className="input" autoComplete="new-password" minLength={12} required /></label>
      {plans.length > 1 && (
        <label className="block"><span className="label">Plan</span>
          <select name="plan" defaultValue={plan} className="input">{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
      )}
      {plans.length === 1 && <input type="hidden" name="plan" value={plans[0].id} />}
      <div aria-hidden="true" className="hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input type="checkbox" name="agree" className="mt-1" required />
        <span>I agree to the <Link href="/terms" className="text-brand-700 underline">Terms of Service</Link> and <Link href="/privacy" className="text-brand-700 underline">Privacy Policy</Link>, and I have authority to sign up this practice.</span>
      </label>
      <button className="btn w-full justify-center bg-green-700 text-white hover:bg-green-800" disabled={pending}>{pending ? "Sending..." : `Start the ${trialDays}-day trial`}</button>
      <p className="text-center text-xs text-slate-500">No card needed for the trial. Use test data until your business associate agreement with us is signed; ask us for it.</p>
    </form>
  );
}
