import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { LogoMark } from "@/components/logo";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { verifiedFor } from "@/lib/checkin-session";
import { loadCheckin, openLink } from "@/server/checkin";
import { money } from "@/lib/utils";
import { practiceConfig } from "@/server/integrations";
import { stripeReady } from "@/lib/stripe";
import { submitCheckinAction, verifyDobAction } from "./actions";
import { InsuranceFields } from "./insurance-fields";

export const dynamic = "force-dynamic";

// The URL carries the token: keep it out of search engines and out of Referer
// headers sent to other sites. "same-origin" rather than "no-referrer": the
// latter makes browsers send Origin: null on the form's POST, which the
// server-action CSRF check rightly rejects.
export const metadata: Metadata = {
  title: "Check in for your visit",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

function Shell({ practice, children }: { practice?: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Online check-in</p>
          <h1 className="text-xl font-bold text-slate-900">{practice ?? "Your visit"}</h1>
        </div>
        <div className="card p-6 shadow-sm">{children}</div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <LogoMark className="h-4 w-4" id="cmd-checkin" /> Secured by CollaboratMD
        </p>
      </div>
    </main>
  );
}

export default async function CheckInPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  const db = await getDb();
  const opened = await openLink(db, token);

  if (opened.state === "invalid") {
    return (
      <Shell>
        <p className="text-sm text-slate-700">This check-in link is not valid. It may have been replaced by a newer one. Please use the most recent link from the office, or call them.</p>
      </Shell>
    );
  }
  if (opened.state !== "open") {
    const text = {
      completed: "You're checked in. Thank you. The front desk will review your information before your visit.",
      locked: "For your security, this link was locked after several unsuccessful attempts. Please call the office to check in.",
      expired: "This check-in link has expired. Please call the office, or check in at the front desk when you arrive.",
    }[opened.state];
    const payment = opened.state === "completed" && paid
      ? { "1": "Your copay payment went through. Stripe emails your receipt, and it will show on your account shortly.", "0": "Your copay was not charged. You can pay at the front desk.", unavailable: "Online payment was not available, so your copay was not charged. You can pay at the front desk." }[paid]
      : null;
    return (
      <Shell practice={opened.practiceName}>
        <p className="text-sm text-slate-700">{text}</p>
        {payment && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{payment}</p>}
      </Shell>
    );
  }

  if (!(await verifiedFor(opened.link.id))) {
    return (
      <Shell practice={opened.practiceName}>
        <h2 className="mb-1 text-base font-semibold">Confirm it&apos;s you</h2>
        <p className="mb-4 text-sm text-slate-600">To protect your information, enter the patient&apos;s date of birth.</p>
        <ActionForm action={verifyDobAction.bind(null, token)} className="space-y-3">
          <label className="label" htmlFor="dob">Date of birth</label>
          <input id="dob" name="dob" type="date" className="input" required autoComplete="bday" />
          <SubmitButton className="btn btn-primary w-full justify-center" pendingLabel="Checking...">Continue</SubmitButton>
        </ActionForm>
        {opened.practicePhone && <p className="mt-4 text-xs text-slate-500">Questions? Call {opened.practicePhone}.</p>}
      </Shell>
    );
  }

  const data = await loadCheckin(db, opened.link.id);
  const payOnline = stripeReady((await practiceConfig(db, opened.link.practiceId)).stripe);
  if (!data) return <Shell practice={opened.practiceName}><p className="text-sm">This check-in could not be loaded. Please call the office.</p></Shell>;
  const { patient, appt, insurance } = data;
  const when = appt.startsAt.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Shell practice={data.practiceName}>
      <div className="mb-5 rounded-lg bg-green-50 p-3 text-sm text-green-900">
        <div className="font-semibold">Hi {patient.firstName}.</div>
        <div>Your visit is {when} with Dr. {data.providerLast}.</div>
      </div>
      <ActionForm action={submitCheckinAction.bind(null, token)} className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Contact details</h2>
          <p className="text-xs text-slate-500">Correct anything that has changed.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label" htmlFor="address1">Street address</label><input id="address1" name="address1" className="input" defaultValue={patient.address1 ?? ""} autoComplete="street-address" /></div>
            <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="input" defaultValue={patient.city ?? ""} autoComplete="address-level2" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="state">State</label><input id="state" name="state" className="input uppercase" maxLength={2} defaultValue={patient.state ?? ""} autoComplete="address-level1" /></div>
              <div><label className="label" htmlFor="zip">ZIP</label><input id="zip" name="zip" className="input" inputMode="numeric" defaultValue={patient.zip ?? ""} autoComplete="postal-code" /></div>
            </div>
            <div><label className="label" htmlFor="phone">Mobile phone</label><input id="phone" name="phone" type="tel" className="input" defaultValue={patient.phone ?? ""} autoComplete="tel" /></div>
            <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" defaultValue={patient.email ?? ""} autoComplete="email" /></div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Insurance</h2>
          <InsuranceFields onFile={insurance ? { payerName: insurance.payerName, memberEnding: insurance.ins.memberId.slice(-4) } : null} />
          {data.copayCents ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                Based on your plan, expect a copay of <span className="font-semibold">{money(data.copayCents)}</span>{payOnline ? "." : ", payable at the front desk."}{" "}
                Your final amount depends on the services you receive.
              </p>
              {payOnline && (
                <label className="mt-2 flex items-start gap-2">
                  <input type="checkbox" name="payCopay" className="mt-1" />
                  <span>Pay my {money(data.copayCents)} copay now by card. You will go to Stripe&apos;s secure page after checking in; your card number never reaches the practice.</span>
                </label>
              )}
            </div>
          ) : null}
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-slate-900">Notices and consent</h2>
          <label className="flex gap-2"><input type="checkbox" name="privacyNotice" required className="mt-1" /> <span>I have received the practice&apos;s Notice of Privacy Practices.</span></label>
          <label className="flex gap-2"><input type="checkbox" name="financialPolicy" required className="mt-1" /> <span>I understand I am responsible for copays, deductibles, coinsurance and services my plan does not cover.</span></label>
          <label className="flex gap-2"><input type="checkbox" name="assignmentOfBenefits" required className="mt-1" /> <span>I authorize my insurance to pay the practice directly, and the practice to release the information needed to process my claims.</span></label>
          <div className="pt-2">
            <label className="label" htmlFor="signature">Type your full name to sign</label>
            <input id="signature" name="signature" className="input" required minLength={3} autoComplete="name" />
          </div>
        </section>

        <SubmitButton className="btn btn-primary w-full justify-center" pendingLabel="Submitting...">Finish check-in</SubmitButton>
      </ActionForm>
    </Shell>
  );
}
