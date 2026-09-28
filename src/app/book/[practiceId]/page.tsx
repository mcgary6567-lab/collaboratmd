import Link from "next/link";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { LogoMark } from "@/components/logo";
import { availableSlots, getBookingSettings, localDateLabel, localTimeLabel } from "@/server/booking";
import { patientLang } from "@/lib/i18n/patient-server";
import { BOOKING_TEXT } from "@/lib/i18n/booking";
import { setPatientLangAction } from "@/app/lang-actions";
import { RequestForm } from "./request-form";
import { WaitlistForm } from "./waitlist-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book an appointment", robots: { index: false } };

/** The practice's public booking page. Shows open times only; nothing about other patients. */
export default async function BookPage({ params, searchParams }: { params: Promise<{ practiceId: string }>; searchParams: Promise<{ provider?: string; start?: string }> }) {
  const { practiceId } = await params;
  const sp = await searchParams;
  const lang = await patientLang();
  const t = BOOKING_TEXT[lang];
  const db = await getDb();
  const valid = /^[0-9a-f-]{36}$/i.test(practiceId);
  const [practice] = valid ? await db.select({ name: schema.practices.name, phone: schema.practices.phone }).from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1) : [];
  const settings = practice ? await getBookingSettings(db, practiceId) : null;
  const shell = (body: React.ReactNode) => (
    <main lang={lang} className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        {valid && (
          <form action={setPatientLangAction.bind(null, lang === "es" ? "en" : "es", `/book/${practiceId}`)} className="mb-2 text-right">
            <button className="text-xs font-semibold text-brand-700 underline">{t.switchTo}</button>
          </form>
        )}
        <div className="mb-6 flex items-center gap-3"><LogoMark className="h-9 w-9" id="cmd-book" /><div><h1 className="text-xl font-bold">{practice?.name ?? t.title}</h1><p className="text-sm text-slate-600">{t.request}</p></div></div>
        <div className="card p-6">{body}</div>
      </div>
    </main>
  );
  if (!practice || !settings?.enabled) return shell(<p className="text-sm text-slate-700">{t.notAvailable(practice?.phone ?? null)}</p>);

  const tz = settings.timeZone;
  const provs = await db.select().from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true)));
  const slots = await availableSlots(db, practiceId, sp.provider ? { providerId: sp.provider } : {});
  const bookable = provs.filter((p) => slots.some((s) => s.providerId === p.id));
  const name = (id: string) => { const p = provs.find((x) => x.id === id); return p ? `Dr. ${p.firstName} ${p.lastName}` : t.provider; };

  const chosen = sp.provider && sp.start ? slots.find((s) => s.providerId === sp.provider && s.startsAt.toISOString() === sp.start) : null;
  if (chosen) {
    const when = t.when(localDateLabel(chosen.startsAt, lang), localTimeLabel(chosen.startsAt, lang));
    return shell(
      <>
        <p className="mb-4 text-sm text-slate-700">{name(chosen.providerId)}, {when}. <Link className="font-semibold text-brand-700 underline" href={`/book/${practiceId}?provider=${chosen.providerId}`}>{t.pickAnother}</Link></p>
        <RequestForm practiceId={practiceId} providerId={chosen.providerId} startsAt={chosen.startsAt.toISOString()} when={when} lang={lang} />
      </>,
    );
  }

  const days = new Map<string, typeof slots>();
  for (const s of slots) {
    const key = localDateLabel(s.startsAt, lang);
    days.set(key, [...(days.get(key) ?? []), s]);
  }
  return shell(
    <div className="space-y-5 text-sm">
      {settings.intro && <p className="text-slate-700">{settings.intro}</p>}
      {bookable.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link href={`/book/${practiceId}`} className={`rounded-full px-3 py-1 font-semibold ${!sp.provider ? "bg-green-700 text-white" : "bg-slate-100 text-slate-700"}`}>{t.anyProvider}</Link>
          {bookable.map((p) => <Link key={p.id} href={`/book/${practiceId}?provider=${p.id}`} className={`rounded-full px-3 py-1 font-semibold ${sp.provider === p.id ? "bg-green-700 text-white" : "bg-slate-100 text-slate-700"}`}>Dr. {p.firstName} {p.lastName}</Link>)}
        </div>
      )}
      {slots.length === 0 ? <p className="text-slate-700">{t.noTimes(practice.phone)}</p> : [...days].slice(0, 14).map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-2 font-semibold text-slate-900">{day}</h2>
          <div className="flex flex-wrap gap-2">
            {list.map((s) => (
              <Link key={`${s.providerId}-${s.startsAt.toISOString()}`} href={`/book/${practiceId}?provider=${s.providerId}&start=${encodeURIComponent(s.startsAt.toISOString())}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:border-green-700">
                {localTimeLabel(s.startsAt, lang)}{!sp.provider && bookable.length > 1 ? <span className="text-xs text-slate-500"> · {name(s.providerId)}</span> : null}
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-slate-500">{t.timesNote(tz.replace("_", " ").split("/")[1])}</p>
      <details className="rounded-lg border border-slate-200 bg-white p-4" open={slots.length === 0}>
        <summary className="cursor-pointer font-semibold text-slate-900">{t.waitlistTitle}</summary>
        <div className="mt-3">
          <WaitlistForm practiceId={practiceId} providers={provs.map((p) => ({ id: p.id, name: `Dr. ${p.firstName} ${p.lastName}` }))} lang={lang} />
        </div>
      </details>
    </div>,
  );
}
