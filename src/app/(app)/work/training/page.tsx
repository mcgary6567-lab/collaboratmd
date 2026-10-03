import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { EXPIRY_WARN_DAYS, TRAINING_KINDS, trainingState, trainingStatus } from "@/server/staff-training";
import { recordTrainingAction, removeTrainingAction } from "@/app/(app)/staff-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Training and certifications" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);
const STATE: Record<string, { tone: "green" | "amber" | "red"; label: string }> = {
  current: { tone: "green", label: "current" }, expiring: { tone: "amber", label: "renew soon" }, expired: { tone: "red", label: "expired" }, missing: { tone: "red", label: "none on record" },
};

function Fields({ today }: { today: string }) {
  return (
    <>
      <label className="block"><span className="label">Kind</span><select name="kind" className="input">{Object.entries(TRAINING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="block"><span className="label">Name (CPC, CPB...)</span><input name="name" className="input" maxLength={120} placeholder="HIPAA training" /></label>
      <label className="block"><span className="label">Completed on</span><input type="date" name="completedOn" defaultValue={today} className="input" required /></label>
      <label className="block"><span className="label">Expires on (optional)</span><input type="date" name="expiresOn" className="input" /></label>
      <label className="block"><span className="label">Credential number (optional)</span><input name="credentialNo" className="input" maxLength={60} /></label>
    </>
  );
}

/** HIPAA training and certifications for everyone on the team, with what needs renewing. */
export default async function TrainingPage() {
  const s = await requireSession();
  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const status = await trainingStatus(db, s.practiceId, now);
  const me = status.find((p) => p.userId === s.userId);
  const admin = s.role === "admin";
  const due = status.filter((p) => p.hipaaState !== "current" || p.attention.length > 0);
  return (
    <>
      <PageHeader title="Training and certifications" subtitle={`HIPAA training every year for everyone, and certifications with their expiry dates. Reminders go out ${EXPIRY_WARN_DAYS} days before something expires.`} />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Yours">
          {me ? (
            <>
              <p className="mb-3 text-sm">HIPAA training: <Badge tone={STATE[me.hipaaState].tone}>{STATE[me.hipaaState].label}</Badge></p>
              {me.records.length === 0 ? <Empty>Nothing on record yet.</Empty> : (
                <ul className="mb-4 space-y-1 text-sm">
                  {me.records.map((r) => <li key={r.id}>{r.name}: completed {day(r.completedOn)}{r.expiresOn ? `, expires ${day(r.expiresOn)}` : ""}{r.attested ? " (signed by you)" : ""}</li>)}
                </ul>
              )}
              <h3 className="text-sm font-semibold">Sign for training you completed</h3>
              <ActionForm action={recordTrainingAction} className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <Fields today={today} />
                <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">By saving, you confirm you completed it on that date. HIPAA training counts for a year unless you enter another expiry date.</p>
                <div><SubmitButton pendingLabel="Saving...">Sign and save</SubmitButton></div>
              </ActionForm>
            </>
          ) : <Empty>Read-only accounts have no training record here.</Empty>}
        </Card>
        <Card title={`Needs attention (${due.length})`}>
          {due.length === 0 ? <Empty>Everyone is current.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {due.map((p) => (
                <li key={p.userId} className="py-2">
                  <span className="font-medium">{p.name}</span>
                  {p.hipaaState !== "current" && <> <Badge tone={STATE[p.hipaaState].tone}>HIPAA: {STATE[p.hipaaState].label}</Badge></>}
                  {p.attention.filter((r) => r.kind !== "hipaa").map((r) => <span key={r.id}> <Badge tone={STATE[trainingState(r.expiresOn, today)].tone}>{r.name}: {r.expiresOn && trainingState(r.expiresOn, today) === "expired" ? "expired" : `expires ${r.expiresOn}`}</Badge></span>)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {admin && (
        <Card title="Everyone">
          <ActionForm action={recordTrainingAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
            <label className="block"><span className="label">Person</span><select name="userId" className="input">{status.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</select></label>
            <Fields today={today} />
            <div className="self-end"><SubmitButton pendingLabel="Saving...">Record</SubmitButton></div>
          </ActionForm>
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {status.map((p) => (
              <li key={p.userId} className="py-3">
                <div className="font-medium">{p.name} <Badge tone={STATE[p.hipaaState].tone}>HIPAA: {STATE[p.hipaaState].label}</Badge></div>
                {p.records.length === 0 ? <p className="text-slate-500 dark:text-slate-400">Nothing on record.</p> : (
                  <ul className="mt-1 space-y-1">
                    {p.records.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{r.name}{r.credentialNo ? ` #${r.credentialNo}` : ""}: completed {day(r.completedOn)}{r.expiresOn ? `, expires ${day(r.expiresOn)}` : ""}{r.attested ? " (signed by them)" : ""}</span>
                        <ActionForm action={removeTrainingAction.bind(null, r.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Remove</SubmitButton></ActionForm>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
