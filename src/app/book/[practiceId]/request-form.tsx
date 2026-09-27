"use client";

import { useActionState } from "react";
import { BOOKING_TEXT } from "@/lib/i18n/booking";
import type { Lang } from "@/lib/i18n/patient";
import { requestBookingAction } from "./actions";

export function RequestForm({ practiceId, providerId, startsAt, when, lang }: { practiceId: string; providerId: string; startsAt: string; when: string; lang: Lang }) {
  const t = BOOKING_TEXT[lang];
  const [state, action, pending] = useActionState(requestBookingAction.bind(null, practiceId, providerId, startsAt), undefined);
  if (state?.done) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-sm text-green-900">
        <p className="font-semibold">{t.sentFor(when)}</p>
        <p className="mt-1">{t.sentNote}</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3 text-sm">
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{state.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">{t.firstName}</span><input name="firstName" className="input" autoComplete="given-name" required /></label>
        <label className="block"><span className="label">{t.lastName}</span><input name="lastName" className="input" autoComplete="family-name" required /></label>
        <label className="block"><span className="label">{t.dob}</span><input name="dob" type="date" className="input" autoComplete="bday" required /></label>
        <label className="block"><span className="label">{t.mobile}</span><input name="phone" type="tel" className="input" autoComplete="tel" /></label>
        <label className="block sm:col-span-2"><span className="label">{t.email}</span><input name="email" type="email" className="input" autoComplete="email" /></label>
        <label className="block"><span className="label">{t.payer}</span><input name="payerName" className="input" /></label>
        <label className="block"><span className="label">{t.memberId}</span><input name="memberId" className="input" /></label>
        <label className="block sm:col-span-2"><span className="label">{t.reason}</span><input name="reason" className="input" maxLength={300} /></label>
      </div>
      <div aria-hidden="true" className="hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="flex items-start gap-2"><input type="checkbox" name="smsConsent" className="mt-1" /> <span>{t.smsConsent}</span></label>
      <button className="btn w-full justify-center bg-green-700 text-white hover:bg-green-800" disabled={pending}>{pending ? t.sending : t.requestWhen(when)}</button>
      <p className="text-xs text-slate-500">{t.contactNote}</p>
    </form>
  );
}
