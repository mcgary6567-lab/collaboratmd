import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { isPlatformOperator } from "@/server/code-sets";
import { listFeedback, resolveFeedback } from "@/server/feedback";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function resolveAction(id: string) {
  "use server";
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) throw new Error("Only platform operators can do this");
  await resolveFeedback(await getDb(), id);
  revalidatePath("/ops/feedback");
}

/** Problem reports sent from inside the app. For the people who run the service. */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ resolved?: string }> }) {
  const { resolved } = await searchParams;
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) return <><PageHeader title="Problem reports" /><Card><p className="text-sm text-slate-600">This page is for the people who operate the service.</p></Card></>;
  const rows = await listFeedback(await getDb(), resolved ? "resolved" : "open");
  return (
    <>
      <PageHeader title="Problem reports" subtitle="Sent with the help button's Report a problem. The text may mention patients; handle it as PHI." actions={<><Link href="/ops/practices" className="btn btn-secondary">Practices</Link><Link href={resolved ? "/ops/feedback" : "/ops/feedback?resolved=1"} className="btn btn-secondary">{resolved ? "Open reports" : "Resolved reports"}</Link></>} />
      <Card>
        {rows.length === 0 ? <Empty>{resolved ? "Nothing resolved yet." : "No open reports."}</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {rows.map(({ report: r, practiceName, userName, userEmail }) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-xs text-slate-500">{fmtDateTime(r.createdAt)} · {practiceName} · {userName ?? "unknown"}{userEmail ? ` <${userEmail}>` : ""} · <span className="font-mono">{r.page}</span>{r.viewport ? ` · ${r.viewport}` : ""}</div>
                  {r.status === "open" && <form action={resolveAction.bind(null, r.id)}><button className="btn btn-secondary text-xs">Mark resolved</button></form>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-800">{r.message}</p>
                {r.userAgent && <p className="mt-1 text-[11px] text-slate-500">{r.userAgent}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
