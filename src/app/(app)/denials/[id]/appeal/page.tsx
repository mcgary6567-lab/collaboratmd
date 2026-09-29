import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { getAppeal } from "@/server/appeals";
import { appealLevelsFor } from "@/server/appeal-levels";
import { appealDecisionAction } from "@/app/(app)/appeal-actions";
import { practiceConfig } from "@/server/integrations";
import { draftAppealAction, markSentAction, saveAppealAction } from "@/app/(app)/appeal-actions";
import { ActionForm, PrintButton, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Appeal letter" };

export const dynamic = "force-dynamic";

export default async function AppealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  let data;
  let levels: Awaited<ReturnType<typeof appealLevelsFor>> = [];
  try {
    data = await getAppeal(db, s.practiceId, id);
    levels = await appealLevelsFor(db, s.practiceId, id);
  } catch {
    notFound();
  }
  const { denial, claim, patient, payer, letter } = data;
  const aiOn = !!(await practiceConfig(db, s.practiceId)).anthropic;
  const medicareNote = payer.type === "medicare" ? "Medicare: 120 days to ask for redetermination, then 180 days for reconsideration, then 60 days for each later level, each counted from the decision before. A hearing before a judge also needs a minimum amount in dispute, set each year." : "The usual path; the plan or your contract sets the actual levels and deadlines.";

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`Appeal: claim ${claim.controlNumber}`}
          subtitle={`${patient.lastName}, ${patient.firstName} · ${payer.name} · CARC ${denial.carc}${denial.rarc ? ` / ${denial.rarc}` : ""} · ${money(denial.amountCents)}`}
          actions={<Link href="/denials" className="btn btn-secondary">Back to denials</Link>}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {letter ? (
            <Card title="Letter" actions={<span className="no-print flex items-center gap-2">{letter.status === "sent" ? <Badge tone="green">Sent {fmtDateTime(letter.sentAt, s.timeZone)}</Badge> : <Badge>Draft</Badge>}<Badge tone={letter.source === "ai" ? "blue" : "slate"}>{letter.source === "ai" ? "AI draft" : "Template"}</Badge></span>}>
              <ActionForm action={saveAppealAction.bind(null, id, letter.id)} className="space-y-3">
                <textarea name="body" defaultValue={letter.body} rows={30} className="input font-serif text-sm leading-relaxed print:border-0 print:p-0" />
                <div className="no-print flex flex-wrap gap-2">
                  <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save changes</SubmitButton>
                  <PrintButton label="Print or save as PDF" />
                </div>
              </ActionForm>
              {letter.status !== "sent" && (
                <ActionForm action={markSentAction.bind(null, id, letter.id)} className="no-print mt-3">
                  <SubmitButton pendingLabel="Saving...">Mark as sent to the payer</SubmitButton>
                </ActionForm>
              )}
            </Card>
          ) : (
            <Card title="No letter yet">
              <p className="mb-3 text-sm text-slate-600">Draft a letter for this denial. It is filled in with the claim, patient and practice details, and you can edit every word.</p>
              <ActionForm action={draftAppealAction.bind(null, id)}>
                <SubmitButton pendingLabel="Drafting...">Draft appeal letter</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="no-print space-y-6">
          <Card title="Denial">
            <p className="text-sm text-slate-800">{denial.explanation}</p>
            {denial.appealDeadline && <p className="mt-2 text-sm font-semibold">Appeal by {fmtDate(denial.appealDeadline + "T00:00:00")}</p>}
            <Link href={`/claims/${claim.id}`} className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">Open the claim</Link>
          </Card>
          <Card title="Appeal levels">
            <ol className="space-y-3 text-sm">
              {levels.map((l) => (
                <li key={l.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{l.level}. {l.name}</span>
                    {l.decision ? <Badge tone={l.decision === "overturned" ? "green" : l.decision === "partial" ? "amber" : "red"}>{l.decision === "overturned" ? "Won" : l.decision === "partial" ? "Partly won" : "Upheld"}</Badge> : l.filedOn ? <Badge tone="blue">Filed</Badge> : <Badge tone="amber">To file</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {l.dueOn && !l.filedOn && <>File by {fmtDate(l.dueOn)}. </>}
                    {l.filedOn && <>Filed {fmtDate(l.filedOn)}. </>}
                    {l.decidedOn && <>Decided {fmtDate(l.decidedOn)}.</>}
                  </p>
                  {l.filedOn && !l.decision && (
                    <ActionForm action={appealDecisionAction.bind(null, l.id, id)} className="mt-2 space-y-2">
                      <div className="flex flex-wrap gap-3 text-xs">
                        <label className="flex items-center gap-1"><input type="radio" name="decision" value="overturned" required /> Won</label>
                        <label className="flex items-center gap-1"><input type="radio" name="decision" value="partial" /> Partly won</label>
                        <label className="flex items-center gap-1"><input type="radio" name="decision" value="upheld" /> Denial upheld</label>
                      </div>
                      <label className="block text-xs"><span className="label">Date of the decision letter</span><input type="date" name="decidedOn" className="input" required /></label>
                      <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Record the decision</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-slate-500">{medicareNote}</p>
          </Card>
          <Card title="How the draft is written">
            <p className="text-sm text-slate-600">
              {aiOn
                ? "An AI model drafts the argument from the denial codes, procedure and diagnosis codes only. It never receives the patient's name, date of birth or member ID; those are filled in here, after the draft comes back."
                : "Drafts come from a template for the denial reason. Connect Claude in Settings → Integrations for AI drafts, which are written from the codes only and never see patient details."}
            </p>
            {letter && (
              <ActionForm action={draftAppealAction.bind(null, id)} className="mt-3">
                <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Drafting...">Draft again</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
