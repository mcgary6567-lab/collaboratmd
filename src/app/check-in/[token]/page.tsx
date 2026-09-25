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
import { patientText } from "@/lib/i18n/patient-server";
import type { Lang, PatientText } from "@/lib/i18n/patient";
import { setPatientLangAction } from "@/app/lang-actions";
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

function Shell({ practice, children, t, lang, path }: { practice?: string; children: ReactNode; t: PatientText; lang: Lang; path: string }) {
  return (
    <main lang={lang} className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <form action={setPatientLangAction.bind(null, lang === "es" ? "en" : "es", path)} className="mb-2 text-right">
          <button className="text-xs font-semibold text-brand-700 underline">{t.switchTo}</button>
        </form>
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.checkinEyebrow}</p>
          <h1 className="text-xl font-bold text-slate-900">{practice ?? t.yourVisit}</h1>
        </div>
        <div className="card p-6 shadow-sm">{children}</div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <LogoMark className="h-4 w-4" id="cmd-checkin" /> {t.securedBy}
        </p>
      </div>
    </main>
  );
}

export default async function CheckInPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  const { lang, t } = await patientText();
  const path = `/check-in/${token}`;
  const db = await getDb();
  const opened = await openLink(db, token);

  if (opened.state === "invalid") {
    return (
      <Shell t={t} lang={lang} path={path}>
        <p className="text-sm text-slate-700">{t.linkInvalid}</p>
      </Shell>
    );
  }
  if (opened.state !== "open") {
    const text = { completed: t.completed, locked: t.locked, expired: t.expired }[opened.state];
    const payment = opened.state === "completed" && paid
      ? ({ "1": t.paidOk, "0": t.paidCancelled, unavailable: t.paidUnavailable } as Record<string, string>)[paid]
      : null;
    return (
      <Shell practice={opened.practiceName} t={t} lang={lang} path={path}>
        <p className="text-sm text-slate-700">{text}</p>
        {payment && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{payment}</p>}
      </Shell>
    );
  }

  if (!(await verifiedFor(opened.link.id))) {
    return (
      <Shell practice={opened.practiceName} t={t} lang={lang} path={path}>
        <h2 className="mb-1 text-base font-semibold">{t.confirmTitle}</h2>
        <p className="mb-4 text-sm text-slate-600">{t.confirmCheckin}</p>
        <ActionForm action={verifyDobAction.bind(null, token)} className="space-y-3">
          <label className="label" htmlFor="dob">{t.dob}</label>
          <input id="dob" name="dob" type="date" className="input" required autoComplete="bday" />
          <SubmitButton className="btn btn-primary w-full justify-center" pendingLabel={t.checking}>{t.continue}</SubmitButton>
        </ActionForm>
        {opened.practicePhone && <p className="mt-4 text-xs text-slate-500">{t.questionsCall(opened.practicePhone)}</p>}
      </Shell>
    );
  }

  const data = await loadCheckin(db, opened.link.id);
  const payOnline = stripeReady((await practiceConfig(db, opened.link.practiceId)).stripe);
  if (!data) return <Shell practice={opened.practiceName} t={t} lang={lang} path={path}><p className="text-sm">{t.notLoaded}</p></Shell>;
  const { patient, appt, insurance } = data;
  const when = appt.startsAt.toLocaleString(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Shell practice={data.practiceName} t={t} lang={lang} path={path}>
      <div className="mb-5 rounded-lg bg-green-50 p-3 text-sm text-green-900">
        <div className="font-semibold">{t.hi(patient.firstName)}</div>
        <div>{t.visitWhen(when, data.providerLast)}</div>
      </div>
      <ActionForm action={submitCheckinAction.bind(null, token)} className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">{t.contact}</h2>
          <p className="text-xs text-slate-500">{t.correctChanged}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label" htmlFor="address1">{t.street}</label><input id="address1" name="address1" className="input" defaultValue={patient.address1 ?? ""} autoComplete="street-address" /></div>
            <div><label className="label" htmlFor="city">{t.city}</label><input id="city" name="city" className="input" defaultValue={patient.city ?? ""} autoComplete="address-level2" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="state">{t.state}</label><input id="state" name="state" className="input uppercase" maxLength={2} defaultValue={patient.state ?? ""} autoComplete="address-level1" /></div>
              <div><label className="label" htmlFor="zip">{t.zip}</label><input id="zip" name="zip" className="input" inputMode="numeric" defaultValue={patient.zip ?? ""} autoComplete="postal-code" /></div>
            </div>
            <div><label className="label" htmlFor="phone">{t.mobile}</label><input id="phone" name="phone" type="tel" className="input" defaultValue={patient.phone ?? ""} autoComplete="tel" /></div>
            <div><label className="label" htmlFor="email">{t.email}</label><input id="email" name="email" type="email" className="input" defaultValue={patient.email ?? ""} autoComplete="email" /></div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">{t.insurance}</h2>
          <InsuranceFields
            onFile={insurance ? { payerName: insurance.payerName, memberEnding: insurance.ins.memberId.slice(-4) } : null}
            text={{ same: t.insSame, memberEnding: t.insMemberEnding(insurance?.ins.memberId.slice(-4) ?? ""), newCard: t.insNew, add: t.insAdd, company: t.insCompany, memberId: t.memberId, group: t.groupNumber, relationship: t.relationshipLabel, self: t.relSelf, spouse: t.relSpouse, child: t.relChild, other: t.relOther }}
          />
          {data.copayCents ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <p>{t.copayExpect(money(data.copayCents), payOnline)}</p>
              {payOnline && (
                <label className="mt-2 flex items-start gap-2">
                  <input type="checkbox" name="payCopay" className="mt-1" />
                  <span>{t.payCopayNow(money(data.copayCents))}</span>
                </label>
              )}
            </div>
          ) : null}
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-slate-900">{t.notices}</h2>
          <label className="flex gap-2"><input type="checkbox" name="privacyNotice" required className="mt-1" /> <span>{t.privacyNotice}</span></label>
          <label className="flex gap-2"><input type="checkbox" name="financialPolicy" required className="mt-1" /> <span>{t.financialPolicy}</span></label>
          <label className="flex gap-2"><input type="checkbox" name="assignmentOfBenefits" required className="mt-1" /> <span>{t.assignment}</span></label>
          <div className="pt-2">
            <label className="label" htmlFor="signature">{t.signLabel}</label>
            <input id="signature" name="signature" className="input" required minLength={3} autoComplete="name" />
          </div>
        </section>

        <SubmitButton className="btn btn-primary w-full justify-center" pendingLabel={t.submitting}>{t.finish}</SubmitButton>
      </ActionForm>
    </Shell>
  );
}
