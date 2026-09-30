import Link from "next/link";
import type { codingQueries } from "@/db/schema";
import { QUERY_TOPICS } from "@/server/coding-queries";
import { askProviderAction } from "@/app/(app)/review-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";

/** Questions to the provider about this visit, and a form to ask one; an open question holds the claim. */
export function AskProviderCard({ encounterId, provider, queries, canWrite }: { encounterId: string; provider: string; queries: (typeof codingQueries.$inferSelect)[]; canWrite: boolean }) {
  return (
    <Card title="Questions to the provider" actions={<Link href="/coding/queries" className="text-sm text-brand-700 hover:underline">All questions</Link>}>
      {queries.length > 0 && (
        <ul className="mb-3 space-y-2 text-sm">
          {queries.map((q) => (
            <li key={q.id}>
              <div className="flex flex-wrap items-center gap-2"><Badge tone={q.status === "open" ? "amber" : q.status === "answered" ? "green" : "slate"}>{q.status === "open" ? "Waiting" : q.status === "answered" ? "Answered" : "Withdrawn"}</Badge><span className="font-medium">{QUERY_TOPICS[q.topic] ?? q.topic}</span></div>
              <p className="text-slate-700 dark:text-slate-200">{q.question}</p>
              {q.answer && <p className="text-slate-600 dark:text-slate-300">Answer: {q.answer}</p>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <ActionForm action={askProviderAction.bind(null, encounterId)} className="grid gap-2 text-sm">
          <label className="block"><span className="label">About</span>
            <select name="topic" className="input">{Object.entries(QUERY_TOPICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="label">Question for {provider}</span><textarea name="question" rows={2} className="input" required minLength={10} maxLength={2000} placeholder="The note documents 25 minutes and moderate decision making. Can you clarify which supports the level billed?" /></label>
          <div><SubmitButton className="btn btn-secondary" pendingLabel="Sending...">Ask, and hold the claim</SubmitButton></div>
        </ActionForm>
      )}
    </Card>
  );
}
