import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { getAppeal } from "@/server/appeals";
import { draftAppealAction, markSentAction, saveAppealAction } from "@/app/(app)/appeal-actions";
import { ActionForm, PrintButton, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AppealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  let data;
  try {
    data = await getAppeal(db, s.practiceId, id);
  } catch {
    notFound();
  }
  const { denial, claim, patient, payer, letter } = data;

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
            <Card title="Letter" actions={<span className="no-print flex items-center gap-2">{letter.status === "sent" ? <Badge tone="green">Sent {fmtDateTime(letter.sentAt)}</Badge> : <Badge>Draft</Badge>}<Badge tone={letter.source === "ai" ? "blue" : "slate"}>{letter.source === "ai" ? "AI draft" : "Template"}</Badge></span>}>
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
          <Card title="How the draft is written">
            <p className="text-sm text-slate-600">
              {process.env.ANTHROPIC_API_KEY
                ? "An AI model drafts the argument from the denial codes, procedure and diagnosis codes only. It never receives the patient's name, date of birth or member ID; those are filled in here, after the draft comes back."
                : "Drafts come from a template for the denial reason. Set ANTHROPIC_API_KEY for AI drafts, which are written from the codes only and never see patient details."}
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
