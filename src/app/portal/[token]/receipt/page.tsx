import type { Metadata } from "next";
import { getDb } from "@/db";
import { portalVerifiedFor } from "@/lib/portal-session";
import { openPortal, portalData } from "@/server/portal";
import { yearReceipt } from "@/server/receipts";
import { patientText } from "@/lib/i18n/patient-server";
import { PaymentReceipt } from "@/components/payment-receipt";

export const metadata: Metadata = { title: "Payment receipt", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The patient's own year-end receipt, from their portal link (after they confirm who they are). */
export default async function PortalReceiptPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ year?: string }> }) {
  const { token } = await params;
  const year = Number((await searchParams).year) || new Date().getUTCFullYear() - 1;
  const { lang, t } = await patientText();
  const db = await getDb();
  const o = await openPortal(db, token);
  const back = <a href={`/portal/${token}`} className="text-sm font-semibold text-brand-700 underline">{lang === "es" ? "Volver a su cuenta" : "Back to your account"}</a>;
  if (o.state !== "open" || !(await portalVerifiedFor(o.link.id))) {
    return <main lang={lang} className="min-h-screen bg-slate-50 px-4 py-8"><div className="card mx-auto max-w-md p-6 text-sm">{o.state === "invalid" ? t.portalInvalid : t.confirmTitle} <div className="mt-3">{back}</div></div></main>;
  }
  const d = await portalData(db, o.link.id);
  if (!d) return <main lang={lang} className="min-h-screen bg-slate-50 px-4 py-8"><div className="card mx-auto max-w-md p-6 text-sm">{t.portalNotLoaded} <div className="mt-3">{back}</div></div></main>;
  const receipt = await yearReceipt(db, d.practice.id, d.patient.id, year);
  return (
    <main lang={lang} className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3">{back}</div>
      <PaymentReceipt receipt={receipt} practice={d.practice} patient={d.patient} lang={lang} />
    </main>
  );
}
