import Link from "next/link";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { LogoMark } from "@/components/logo";
import { availableSlots, getBookingSettings, localDateLabel, localTimeLabel } from "@/server/booking";
import { RequestForm } from "./request-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book an appointment", robots: { index: false } };

/** The practice's public booking page. Shows open times only; nothing about other patients. */
export default async function BookPage({ params, searchParams }: { params: Promise<{ practiceId: string }>; searchParams: Promise<{ provider?: string; start?: string }> }) {
  const { practiceId } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const valid = /^[0-9a-f-]{36}$/i.test(practiceId);
  const [practice] = valid ? await db.select({ name: schema.practices.name, phone: schema.practices.phone }).from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1) : [];
  const settings = practice ? await getBookingSettings(db, practiceId) : null;
  const shell = (body: React.ReactNode) => (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3"><LogoMark className="h-9 w-9" id="cmd-book" /><div><h1 className="text-xl font-bold">{practice?.name ?? "Online booking"}</h1><p className="text-sm text-slate-600">Request an appointment</p></div></div>
        <div className="card p-6">{body}</div>
      </div>
    </main>
  );
  if (!practice || !settings?.enabled) return shell(<p className="text-sm text-slate-700">Online booking is not available for this practice. Please call the office{practice?.phone ? ` at ${practice.phone}` : ""}.</p>);

  const tz = settings.timeZone;
  const provs = await db.select().from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true)));
  const slots = await availableSlots(db, practiceId, sp.provider ? { providerId: sp.provider } : {});
  const bookable = provs.filter((p) => slots.some((s) => s.providerId === p.id));
  const name = (id: string) => { const p = provs.find((x) => x.id === id); return p ? `Dr. ${p.firstName} ${p.lastName}` : "Provider"; };

  const chosen = sp.provider && sp.start ? slots.find((s) => s.providerId === sp.provider && s.startsAt.toISOString() === sp.start) : null;
  if (chosen) {
    const when = `${localDateLabel(chosen.startsAt, tz)} at ${localTimeLabel(chosen.startsAt, tz)}`;
    return shell(
      <>
        <p className="mb-4 text-sm text-slate-700">{name(chosen.providerId)}, {when}. <Link className="font-semibold text-brand-700 underline" href={`/book/${practiceId}?provider=${chosen.providerId}`}>Pick another time</Link></p>
        <RequestForm practiceId={practiceId} providerId={chosen.providerId} startsAt={chosen.startsAt.toISOString()} when={when} />
      </>,
    );
  }

  const days = new Map<string, typeof slots>();
  for (const s of slots) {
    const key = localDateLabel(s.startsAt, tz);
    days.set(key, [...(days.get(key) ?? []), s]);
  }
  return shell(
    <div className="space-y-5 text-sm">
      {settings.intro && <p className="text-slate-700">{settings.intro}</p>}
      {bookable.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link href={`/book/${practiceId}`} className={`rounded-full px-3 py-1 font-semibold ${!sp.provider ? "bg-green-700 text-white" : "bg-slate-100 text-slate-700"}`}>Any provider</Link>
          {bookable.map((p) => <Link key={p.id} href={`/book/${practiceId}?provider=${p.id}`} className={`rounded-full px-3 py-1 font-semibold ${sp.provider === p.id ? "bg-green-700 text-white" : "bg-slate-100 text-slate-700"}`}>Dr. {p.firstName} {p.lastName}</Link>)}
        </div>
      )}
      {slots.length === 0 ? <p className="text-slate-700">No open times right now. Please call the office{practice.phone ? ` at ${practice.phone}` : ""}.</p> : [...days].slice(0, 14).map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-2 font-semibold text-slate-900">{day}</h2>
          <div className="flex flex-wrap gap-2">
            {list.map((s) => (
              <Link key={`${s.providerId}-${s.startsAt.toISOString()}`} href={`/book/${practiceId}?provider=${s.providerId}&start=${encodeURIComponent(s.startsAt.toISOString())}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:border-green-700">
                {localTimeLabel(s.startsAt, tz)}{!sp.provider && bookable.length > 1 ? <span className="text-xs text-slate-500"> · {name(s.providerId)}</span> : null}
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-slate-500">Times are {tz.replace("_", " ").split("/")[1]} time. Your request is confirmed by the office.</p>
    </div>,
  );
}
