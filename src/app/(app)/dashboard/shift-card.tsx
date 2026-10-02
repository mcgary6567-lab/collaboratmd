import Link from "next/link";
import type { Db } from "@/db";
import { currentBreak, currentEntry, recentHandovers } from "@/server/shifts";
import { clockAction } from "@/app/(app)/shift-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { fmtDateTime } from "@/lib/utils";

/** The start of a shift: clock in or out, breaks, and the last handover note someone else left. */
export async function ShiftStrip({ db, practiceId, userId, timeZone }: { db: Db; practiceId: string; userId: string; timeZone: string }) {
  const now = new Date();
  const [entry, handovers] = await Promise.all([currentEntry(db, userId), recentHandovers(db, practiceId, 16, now)]);
  const onBreak = entry ? !!(await currentBreak(db, entry.id)) : false;
  const last = handovers.find((h) => h.h.userId !== userId);
  return (
    <section aria-label="Your shift" className="card mb-6 flex flex-wrap items-start justify-between gap-4 p-4 text-sm">
      <div className="min-w-0 max-w-3xl space-y-1">
        {last ? (
          <>
            <p className="font-medium">Handover from {last.name}, {fmtDateTime(last.h.createdAt, timeZone)}</p>
            {last.h.inProgress && <p><span className="font-medium">In progress:</span> {last.h.inProgress}</p>}
            {last.h.problems && <p className="text-amber-800 dark:text-amber-300"><span className="font-medium">Problems:</span> {last.h.problems}</p>}
            {!last.h.inProgress && !last.h.problems && last.h.done && <p><span className="font-medium">Done:</span> {last.h.done}</p>}
          </>
        ) : <p className="text-slate-600 dark:text-slate-300">No handover notes from the last shift.</p>}
        <Link href="/work/shifts" className="text-brand-700 underline">Shifts and handovers</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-slate-600 dark:text-slate-300">{entry ? `Clocked in since ${fmtDateTime(entry.clockIn, timeZone)}${onBreak ? ", on a break" : ""}` : "Not clocked in"}</span>
        {entry && (
          <ActionForm action={clockAction}>
            <input type="hidden" name="to" value={onBreak ? "back" : "break"} />
            <SubmitButton className="btn btn-secondary" pendingLabel="...">{onBreak ? "End break" : "Start break"}</SubmitButton>
          </ActionForm>
        )}
        <ActionForm action={clockAction}>
          <input type="hidden" name="to" value={entry ? "out" : "in"} />
          <SubmitButton className="btn btn-secondary" pendingLabel="...">{entry ? "Clock out" : "Clock in"}</SubmitButton>
        </ActionForm>
      </div>
    </section>
  );
}
