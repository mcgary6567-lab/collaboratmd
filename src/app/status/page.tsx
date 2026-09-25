import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { recentErrorCount } from "@/server/errors";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System status — CollaboratMD",
  description: "Whether CollaboratMD is up right now: the application, its database, background jobs and server errors, checked live.",
};

type State = "up" | "degraded" | "down" | "unknown";
const COLOR: Record<State, string> = { up: "bg-green-500", degraded: "bg-amber-500", down: "bg-red-500", unknown: "bg-slate-300" };
const WORD: Record<State, string> = { up: "Operational", degraded: "Degraded", down: "Down", unknown: "No data yet" };

async function check() {
  const out: { name: string; state: State; detail: string }[] = [{ name: "Application", state: "up", detail: "This page was served by it" }];
  let db;
  try {
    db = await getDb();
    const t = Date.now();
    await db.execute(sql`SELECT 1`);
    const ms = Date.now() - t;
    out.push({ name: "Database", state: ms > 2000 ? "degraded" : "up", detail: `Answered in ${ms} ms` });
  } catch {
    out.push({ name: "Database", state: "down", detail: "Not answering" });
    return { components: out, days: [] as { day: string; ran: boolean }[] };
  }
  const { rows: runs } = await db.execute<{ last: string | null }>(sql`SELECT max(ran_at)::text AS last FROM automation_runs`);
  const last = runs[0]?.last ? new Date(runs[0].last) : null;
  const hours = last ? (Date.now() - last.getTime()) / 3_600_000 : null;
  out.push({ name: "Daily jobs (reminders, follow-up, reports)", state: hours === null ? "unknown" : hours <= 26 ? "up" : "degraded", detail: hours === null ? "Have not run yet" : `Last ran ${hours < 1 ? "under an hour" : `${Math.floor(hours)} hours`} ago` });
  const errors = await recentErrorCount(db, 3_600_000).catch(() => null);
  out.push({ name: "Server errors", state: errors === null ? "unknown" : errors.hits === 0 ? "up" : errors.hits > 50 ? "degraded" : "up", detail: errors === null ? "Unavailable" : errors.hits === 0 ? "None in the last hour" : `${errors.hits} in the last hour` });
  const { rows } = await db.execute<{ day: string }>(sql`SELECT DISTINCT ran_at::date::text AS day FROM automation_runs WHERE ran_at >= now() - interval '14 days'`);
  const ranOn = new Set(rows.map((r) => r.day));
  const days = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, ran: ranOn.has(day) };
  });
  return { components: out, days };
}

/** Public status, checked live each time the page loads. It shows states, not internals. */
export default async function StatusPage() {
  const { components, days } = await check();
  const worst: State = components.some((c) => c.state === "down") ? "down" : components.some((c) => c.state === "degraded") ? "degraded" : "up";
  return (
    <PageShell eyebrow="Status" title={worst === "up" ? "All systems operational" : worst === "down" ? "Some systems are down" : "Some systems are degraded"} lead={`Checked live at ${new Date().toUTCString()}. Reload to check again.`}>
      <ul className="mt-8 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {components.map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="font-semibold text-slate-900">{c.name}</p>
              <p className="text-sm text-slate-500">{c.detail}</p>
            </div>
            <span className="flex items-center gap-2 text-sm font-medium text-slate-700"><span className={`h-2.5 w-2.5 rounded-full ${COLOR[c.state]}`} />{WORD[c.state]}</span>
          </li>
        ))}
      </ul>
      {days.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-slate-900">Daily jobs, last 14 days</h2>
          <div className="mt-3 flex gap-1" aria-label="Days the daily jobs ran">
            {days.map((d) => <span key={d.day} title={`${d.day}: ${d.ran ? "ran" : "did not run"}`} className={`h-8 flex-1 rounded ${d.ran ? "bg-green-500" : "bg-slate-200"}`} />)}
          </div>
          <p className="mt-2 text-xs text-slate-500">Green: the daily jobs ran that day (UTC). This page does not yet keep a history of outages.</p>
        </section>
      )}
    </PageShell>
  );
}
