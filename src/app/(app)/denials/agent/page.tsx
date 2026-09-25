import Link from "next/link";
import { Bot, FileText, PenLine, Trash2, UserRound } from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { ACTION_LABEL, agentCounts, agentQueue, type AgentAction } from "@/server/denial-agent";
import { practiceConfig } from "@/server/integrations";
import { approveAgentItemAction, dismissAgentItemAction, runAgentAction } from "@/app/(app)/agent-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader, PatientLink } from "@/components/ui";
import { fmtDateTime, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ICON: Record<AgentAction, typeof Bot> = { appeal: FileText, correct_claim: PenLine, write_off: Trash2, update_insurance: UserRound };
const TONE: Record<AgentAction, "blue" | "amber" | "red" | "slate"> = { appeal: "blue", correct_claim: "amber", write_off: "red", update_insurance: "slate" };

export default async function DenialAgentPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const status = view === "approved" || view === "dismissed" ? view : "proposed";
  const s = await requireSession();
  const db = await getDb();
  const [items, counts, cfg] = await Promise.all([agentQueue(db, s.practiceId, status), agentCounts(db, s.practiceId), practiceConfig(db, s.practiceId)]);
  const canAct = ["admin", "biller"].includes(s.role);

  return (
    <>
      <PageHeader
        title="Denial agent"
        subtitle="Open denials worked overnight: each one prepared and waiting for your approval"
        actions={
          <>
            <Link href="/denials" className="btn btn-secondary">All denials</Link>
            {canAct && <ActionForm action={runAgentAction}><SubmitButton pendingLabel="Working the queue...">Run the agent now</SubmitButton></ActionForm>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {(["proposed", "approved", "dismissed"] as const).map((v) => (
          <Link key={v} href={v === "proposed" ? "/denials/agent" : `/denials/agent?view=${v}`} className={`rounded-full px-3 py-1 font-semibold ${status === v ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {v === "proposed" ? "Waiting for review" : v[0].toUpperCase() + v.slice(1)} · {counts[v] ?? 0}
          </Link>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          {cfg.anthropic ? "Appeals are written by Claude from codes only." : "Appeals come from templates; connect Claude in Integrations for AI-written appeals."}{" "}
          Turn on the nightly run in <Link className="underline" href="/settings/automation">Automation</Link>.
        </span>
      </div>

      {items.length === 0 ? (
        <Card><Empty>{status === "proposed" ? "Nothing waiting. Run the agent to prepare the open denials." : "Nothing here yet."}</Empty></Card>
      ) : (
        <div className="space-y-3">
          {items.map(({ item, denial, claim, patientFirst, patientLast, payerName }) => {
            const action = item.action as AgentAction;
            const Icon = ICON[action] ?? Bot;
            return (
              <Card key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon className="h-4.5 w-4.5" /></span>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        <PatientLink id={claim.patientId} first={patientFirst} last={patientLast} /> · {payerName} · {money(denial.amountCents)} ·{" "}
                        <Link className="underline" href={`/claims/${claim.id}`}>{claim.controlNumber}</Link>
                        {item.decidedAt && <> · {status} {fmtDateTime(item.decidedAt)}</>}
                      </p>
                    </div>
                  </div>
                  <Badge tone={TONE[action]}>{ACTION_LABEL[action]}</Badge>
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {item.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.letterId && <Link href={`/denials/${denial.id}/appeal`} className="btn btn-secondary text-xs">Read and edit the letter</Link>}
                  {item.resultClaimId && <Link href={`/claims/${item.resultClaimId}/edit`} className="btn btn-secondary text-xs">Open the corrected claim</Link>}
                  {status === "proposed" && canAct && (
                    <>
                      <ActionForm action={approveAgentItemAction.bind(null, item.id)}><SubmitButton className="btn btn-primary text-xs" pendingLabel="Working...">Approve: {ACTION_LABEL[action].toLowerCase()}</SubmitButton></ActionForm>
                      <ActionForm action={dismissAgentItemAction.bind(null, item.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Dismiss</SubmitButton></ActionForm>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
