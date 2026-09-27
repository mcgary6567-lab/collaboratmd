"use client";

import { useActionState } from "react";
import { requestBookingAction } from "./actions";

export function RequestForm({ practiceId, providerId, startsAt, when }: { practiceId: string; providerId: string; startsAt: string; when: string }) {
  const [state, action, pending] = useActionState(requestBookingAction.bind(null, practiceId, providerId, startsAt), undefined);
  if (state?.done) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-sm text-green-900">
        <p className="font-semibold">Request sent for {when}</p>
        <p className="mt-1">The office will confirm it by phone, text or email. It is not booked until they do.</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3 text-sm">
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{state.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">First name</span><input name="firstName" className="input" autoComplete="given-name" required /></label>
        <label className="block"><span className="label">Last name</span><input name="lastName" className="input" autoComplete="family-name" required /></label>
        <label className="block"><span className="label">Date of birth</span><input name="dob" type="date" className="input" autoComplete="bday" required /></label>
        <label className="block"><span className="label">Mobile phone</span><input name="phone" type="tel" className="input" autoComplete="tel" /></label>
        <label className="block sm:col-span-2"><span className="label">Email</span><input name="email" type="email" className="input" autoComplete="email" /></label>
        <label className="block"><span className="label">Insurance company (optional)</span><input name="payerName" className="input" /></label>
        <label className="block"><span className="label">Member ID (optional)</span><input name="memberId" className="input" /></label>
        <label className="block sm:col-span-2"><span className="label">Reason for the visit (optional)</span><input name="reason" className="input" maxLength={300} /></label>
      </div>
      <div aria-hidden="true" className="hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="flex items-start gap-2"><input type="checkbox" name="smsConsent" className="mt-1" /> <span>Text me about this appointment. Message and data rates may apply; reply STOP to stop.</span></label>
      <button className="btn w-full justify-center bg-green-700 text-white hover:bg-green-800" disabled={pending}>{pending ? "Sending..." : `Request ${when}`}</button>
      <p className="text-xs text-slate-500">Give a phone number or an email so the office can confirm. For an emergency, call 911.</p>
    </form>
  );
}
