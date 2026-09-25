import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { isPlatformOperator } from "@/server/code-sets";
import { listErrors, resolveError } from "@/server/errors";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function resolveAction(fingerprint: string) {
  "use server";
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) throw new Error("Only the platform operator can resolve errors");
  await resolveError(await getDb(), fingerprint);
  revalidatePath("/ops/errors");
}

/** Server errors across the platform, grouped. For the people who run the service (PLATFORM_ADMIN_EMAILS). */
export default async function ErrorsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) {
    return <><PageHeader title="Server errors" /><Card><p className="text-sm text-slate-600">This page is for the people who operate the service. Practices see their own activity in the audit log.</p></Card></>;
  }
  const errors = await listErrors(await getDb(), all === "1");
  return (
    <>
      <PageHeader title="Server errors" subtitle="Every server error, grouped and counted. Messages are redacted before they are stored; no headers or query strings are kept." actions={<><Link href="/status" className="btn btn-secondary">Public status</Link><Link href={all === "1" ? "/ops/errors" : "/ops/errors?all=1"} className="btn btn-secondary">{all === "1" ? "Unresolved only" : "Include resolved"}</Link></>} />
      <Card>
        {errors.length === 0 ? <Empty>No errors recorded.</Empty> : (
          <table className="table">
            <thead><tr><th>Error</th><th>Where</th><th className="text-right">Count</th><th>First seen</th><th>Last seen</th><th /></tr></thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.fingerprint}>
                  <td className="max-w-md"><p className="break-words font-mono text-xs">{e.message}</p>{e.digest && <p className="text-[11px] text-slate-400">digest {e.digest}</p>}</td>
                  <td className="text-xs"><span className="font-mono">{e.method} {e.path}</span><span className="block text-slate-500">{e.routePath} · {e.routeType}</span></td>
                  <td className="text-right font-semibold">{e.count}</td>
                  <td className="text-xs">{fmtDateTime(e.firstSeen)}</td>
                  <td className="text-xs">{fmtDateTime(e.lastSeen)}</td>
                  <td className="text-right">{e.resolvedAt ? <Badge tone="green">resolved</Badge> : <form action={resolveAction.bind(null, e.fingerprint)}><button className="btn btn-secondary px-2 py-1 text-xs">Resolve</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
