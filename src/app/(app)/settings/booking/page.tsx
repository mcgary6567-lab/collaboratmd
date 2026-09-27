import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { getBookingSettings, hoursFor, US_TIME_ZONES } from "@/server/booking";
import { listProviders } from "@/server/encounters";
import { listLocations } from "@/server/locations";
import { saveBookingSettingsAction, saveProviderHoursAction } from "@/app/(app)/booking-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function BookingSettingsPage() {
  const s = await requireRole(["admin"]);
  const db = await getDb();
  const [settings, hours, providers, locations, origin] = await Promise.all([getBookingSettings(db, s.practiceId), hoursFor(db, s.practiceId), listProviders(db, s.practiceId), listLocations(db, s.practiceId, { activeOnly: true }), siteOrigin().catch(() => "")]);
  const link = `${origin}/book/${s.practiceId}`;
  return (
    <>
      <PageHeader title="Online booking" subtitle="Patients request open times from a page you link to; staff confirm each request before it is booked" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Booking page">
          <ActionForm action={saveBookingSettingsAction} className="space-y-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Accept online requests</label>
            <label className="block"><span className="label">Time zone of your hours</span>
              <select name="timeZone" defaultValue={settings.timeZone} className="input">{US_TIME_ZONES.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</select></label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block"><span className="label">Visit length</span><select name="slotMinutes" defaultValue={settings.slotMinutes} className="input">{[10, 15, 20, 30, 40, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
              <label className="block"><span className="label">Notice (hours)</span><input name="minNoticeHours" type="number" min={0} max={168} defaultValue={settings.minNoticeHours} className="input" /></label>
              <label className="block"><span className="label">Days ahead</span><input name="horizonDays" type="number" min={1} max={90} defaultValue={settings.horizonDays} className="input" /></label>
            </div>
            <label className="block"><span className="label">Note shown on the page (optional)</span><textarea name="intro" rows={2} maxLength={500} defaultValue={settings.intro ?? ""} className="input" placeholder="New patients: please bring your insurance card and photo ID." /></label>
            <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
          </ActionForm>
          {settings.enabled && (
            <div className="mt-4 border-t border-slate-200 pt-4 text-sm">
              <p className="mb-1 font-semibold">Link for your website and messages</p>
              <div className="flex items-center gap-2"><code className="break-all rounded bg-slate-50 px-2 py-1 text-xs">{link}</code><CopyButton value={link} label="Copy link" /></div>
            </div>
          )}
        </Card>
        <Card title="How requests are handled">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Only open times inside the hours below are offered, after the notice period, skipping anything already booked or requested.</li>
            <li>A request holds its time. It appears on the Schedule, where staff confirm or decline it.</li>
            <li>Confirming matches an existing patient by name and date of birth, or creates one, then books the visit and tells the patient by text or email when those are connected.</li>
            <li>Nothing typed on the public page changes a chart until staff confirm. Insurance given online is noted on the appointment for staff to check.</li>
          </ul>
        </Card>
      </div>
      <div className="mt-6 space-y-6">
        {providers.map((p) => {
          const mine = hours.filter((h) => h.providerId === p.id);
          return (
            <Card key={p.id} title={`Dr. ${p.firstName} ${p.lastName}: weekly hours`}>
              <ActionForm action={saveProviderHoursAction.bind(null, p.id)} className="space-y-2 text-sm">
                <div className="grid gap-2">
                  {DAYS.map((d, i) => {
                    const h = mine.find((x) => x.weekday === i);
                    return (
                      <div key={d} className="grid grid-cols-[7rem_1fr_1fr_2fr] items-center gap-2">
                        <span className="font-medium">{d}</span>
                        <input type="time" name={`start_${i}`} defaultValue={h ? hhmm(h.startMinute) : ""} className="input py-1" aria-label={`${d} start`} />
                        <input type="time" name={`end_${i}`} defaultValue={h ? hhmm(h.endMinute) : ""} className="input py-1" aria-label={`${d} end`} />
                        {locations.length > 0 ? (
                          <select name={`loc_${i}`} defaultValue={h?.locationId ?? ""} className="input py-1" aria-label={`${d} location`}>
                            <option value="">Main office</option>
                            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        ) : <span />}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500">Leave a day blank when this provider does not take online bookings that day.</p>
                <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save hours</SubmitButton>
              </ActionForm>
            </Card>
          );
        })}
      </div>
    </>
  );
}
