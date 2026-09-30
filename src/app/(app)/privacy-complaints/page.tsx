import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireSession } from "@/lib/auth";
import { CATEGORIES, CHANNELS, FINDINGS, TARGET_DAYS, listComplaints } from "@/server/privacy-complaints";
import { closeComplaintAction, investigationAction, logComplaintAction } from "@/app/(app)/account-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Privacy complaints" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** HIPAA privacy complaints: received, investigated, answered and kept on file. */
export default async function PrivacyComplaintsPage() {
  const s = await requireSession();
  const rows = await listComplaints(await getDb(), s.practiceId);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const canInvestigate = (CAN_ADJUST as readonly string[]).includes(s.role);
  const open = rows.filter((r) => r.c.status === "open");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Privacy complaints" subtitle={`${open.length} open${open.some((r) => r.overdue) ? `, ${open.filter((r) => r.overdue).length} past the ${TARGET_DAYS}-day target` : ""}. HIPAA requires every complaint and its outcome to be documented and kept for six years.`} actions={<Link href="/privacy-requests" className="btn btn-secondary">Privacy requests</Link>} />
      {canWrite && (
        <Card title="Log a complaint" className="mb-6">
          <ActionForm action={logComplaintAction} className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="label">Received on</span><input type="date" name="receivedOn" defaultValue={today} className="input" required /></label>
            <label className="block"><span className="label">How</span><select name="channel" className="input">{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="block"><span className="label">From</span><input name="complainant" className="input" required maxLength={120} placeholder="The patient, a relative, anonymous" /></label>
            <label className="block"><span className="label">Patient MRN (if about a patient)</span><input name="mrn" className="input" /></label>
            <label className="block sm:col-span-2"><span className="label">About</span><select name="category" className="input">{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="block sm:col-span-2 lg:col-span-4"><span className="label">What happened</span><textarea name="description" className="input" rows={3} required maxLength={4000} /></label>
            <div><SubmitButton pendingLabel="Logging...">Log complaint</SubmitButton></div>
          </ActionForm>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Anyone may complain, and no one may be retaliated against for doing so (45 CFR 164.530(g)). Tell the complainant they can also complain to the HHS Office for Civil Rights. A complaint that describes a breach may also need a breach risk assessment.</p>
        </Card>
      )}
      <Card title="Complaints">
        {rows.length === 0 ? <Empty>No complaints logged.</Empty> : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {rows.map(({ c, patient, daysOpen, overdue }) => (
              <li key={c.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">{day(c.receivedOn)}</span>
                  <span>{CATEGORIES[c.category] ?? c.category}</span>
                  <span className="text-slate-500 dark:text-slate-400">from {c.complainant} by {(CHANNELS[c.channel] ?? c.channel).toLowerCase()}{patient ? ` · patient ${patient}` : ""}</span>
                  {c.status === "closed"
                    ? <Badge tone="green">closed, answered {c.respondedOn ? day(c.respondedOn) : ""}</Badge>
                    : <Badge tone={overdue ? "red" : "amber"}>open {daysOpen} day{daysOpen === 1 ? "" : "s"}</Badge>}
                  {c.finding && <Badge tone={c.finding === "substantiated" ? "red" : "slate"}>{FINDINGS[c.finding]?.split(":")[0]}</Badge>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{c.description}</p>
                {c.status === "closed" ? (
                  <dl className="mt-1 grid gap-x-4 text-slate-600 dark:text-slate-300 sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium">Investigation</dt><dd>{c.investigation}</dd>
                    {c.mitigation && <><dt className="font-medium">Mitigation</dt><dd>{c.mitigation}</dd></>}
                    {c.sanctions && <><dt className="font-medium">Sanctions</dt><dd>{c.sanctions}</dd></>}
                  </dl>
                ) : canInvestigate && (
                  <div className="mt-2 grid gap-3 lg:grid-cols-3">
                    <ActionForm action={investigationAction.bind(null, c.id)} className="grid gap-2 lg:col-span-2 sm:grid-cols-2">
                      <label className="block sm:col-span-2"><span className="label">Investigation</span><textarea name="investigation" defaultValue={c.investigation ?? ""} className="input" rows={2} maxLength={4000} /></label>
                      <label className="block"><span className="label">Finding</span><select name="finding" defaultValue={c.finding ?? ""} className="input"><option value="">Not yet</option>{Object.entries(FINDINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label className="block"><span className="label">Sanctions applied</span><input name="sanctions" defaultValue={c.sanctions ?? ""} className="input" maxLength={4000} /></label>
                      <label className="block sm:col-span-2"><span className="label">Mitigation (what was done about it)</span><input name="mitigation" defaultValue={c.mitigation ?? ""} className="input" maxLength={4000} /></label>
                      <div><SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save</SubmitButton></div>
                    </ActionForm>
                    <ActionForm action={closeComplaintAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Complainant answered on</span><input type="date" name="respondedOn" defaultValue={today} className="input" /></label>
                      <SubmitButton pendingLabel="...">Close</SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
