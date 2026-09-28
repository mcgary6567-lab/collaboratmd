import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { isPlatformOperator } from "@/server/code-sets";
import { listRestoreTests, recordRestoreTest } from "@/server/restore-tests";
import { ActionForm, SubmitButton, type FormResult } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Restore tests" };
export const dynamic = "force-dynamic";

async function recordAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  "use server";
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) return { ok: false, message: "Only the platform operator can record restore tests" };
  try {
    await recordRestoreTest(await getDb(), {
      testedAt: String(fd.get("testedAt") ?? ""), target: String(fd.get("target") ?? ""), minutes: fd.get("minutes") ? Number(fd.get("minutes")) : null,
      result: String(fd.get("result")) === "failed" ? "failed" : "passed", notes: String(fd.get("notes") ?? ""),
    }, s.email);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
  revalidatePath("/ops/restore-tests");
  return { ok: true, message: "Recorded. The security questionnaire shows the latest test." };
}

/** The record of backup restore drills (docs/08-restore-drill.md), shown to buyers as the latest result. */
export default async function RestoreTestsPage() {
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) {
    return <><PageHeader title="Restore tests" /><Card><p className="text-sm text-slate-600">This page is for the people who operate the service.</p></Card></>;
  }
  const rows = await listRestoreTests(await getDb());
  return (
    <>
      <PageHeader title="Restore tests" subtitle="Each backup restore drill: what was restored, how long it took, and whether the data and the app checked out" actions={<Link href="/trust/questionnaire" className="btn btn-secondary">Public questionnaire</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Record a drill">
          <ActionForm action={recordAction} className="space-y-3 text-sm">
            <label className="block"><span className="label">When it ran (UTC)</span><input type="datetime-local" name="testedAt" className="input" required /></label>
            <label className="block"><span className="label">What was restored</span><input name="target" className="input" placeholder="Production as of 1 hour earlier, to branch drill-2026-10-03" required /></label>
            <label className="block"><span className="label">Minutes to restore and check</span><input name="minutes" type="number" min={0} className="input" /></label>
            <fieldset className="flex gap-4"><legend className="label">Result</legend>
              <label className="flex items-center gap-2"><input type="radio" name="result" value="passed" defaultChecked /> Passed</label>
              <label className="flex items-center gap-2"><input type="radio" name="result" value="failed" /> Failed</label>
            </fieldset>
            <label className="block"><span className="label">Notes (no patient data)</span><textarea name="notes" rows={3} className="input" /></label>
            <SubmitButton pendingLabel="Saving...">Record</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="History" className="lg:col-span-2">
          {rows.length === 0 ? <Empty>No drills recorded yet. Run the drill in docs/08-restore-drill.md and record it here.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {rows.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={r.result === "passed" ? "green" : "red"}>{r.result === "passed" ? "Passed" : "Failed"}</Badge><span className="font-medium">{fmtDateTime(r.testedAt, s.timeZone)}</span>{r.minutes !== null && <span className="text-slate-500">{r.minutes} min</span>}</div>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">{r.target}</p>
                  {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
                  <p className="text-xs text-slate-500">Recorded by {r.recordedBy}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
