import type { Db } from "@/db";
import { assignableUsers, notesFor, tasksFor, type EntityType } from "@/server/work";
import { addNoteAction, createTaskAction, setTaskStatusAction } from "@/app/(app)/work-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

/** Open tasks and notes for one record, with forms to add both. */
export async function WorkPanel({ db, practiceId, entityType, entityId, defaultTitle }: { db: Db; practiceId: string; entityType: EntityType; entityId: string; defaultTitle: string }) {
  const [open, notes, people] = await Promise.all([
    tasksFor(db, practiceId, entityType, entityId),
    notesFor(db, practiceId, entityType, entityId),
    assignableUsers(db, practiceId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card title={`Tasks and notes${open.length ? ` · ${open.length} open` : ""}`}>
      <div className="space-y-4 text-sm">
        {open.length > 0 && (
          <ul className="space-y-2">
            {open.map(({ task, assignee }) => (
              <li key={task.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2">
                <form action={setTaskStatusAction.bind(null, task.id, "done")}>
                  <button className="mt-0.5 h-4 w-4 rounded border border-slate-300 hover:bg-green-100" title="Mark done" aria-label="Mark done" />
                </form>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{task.title}</div>
                  <div className="text-xs text-slate-500">
                    {assignee ?? "Unassigned"}
                    {task.dueDate && <span className={task.dueDate < today ? " font-semibold text-red-700" : ""}> · due {fmtDate(task.dueDate + "T00:00:00")}</span>}
                  </div>
                  {task.note && <div className="mt-1 text-xs text-slate-600">{task.note}</div>}
                </div>
                {task.priority === "high" && <Badge tone="red">High</Badge>}
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-lg border border-dashed border-slate-300 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-brand-700">Assign a task</summary>
          <ActionForm action={createTaskAction} className="mt-2 space-y-2">
            <input type="hidden" name="entityType" value={entityType} />
            <input type="hidden" name="entityId" value={entityId} />
            <input name="title" className="input text-xs" defaultValue={defaultTitle} required />
            <div className="grid grid-cols-2 gap-2">
              <select name="assigneeId" className="input text-xs" defaultValue="">
                <option value="">Unassigned</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input name="dueDate" type="date" className="input text-xs" />
            </div>
            <div className="flex gap-2">
              <select name="priority" className="input text-xs" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="high">High priority</option>
              </select>
              <SubmitButton className="btn btn-primary whitespace-nowrap text-xs" pendingLabel="Saving...">Create task</SubmitButton>
            </div>
          </ActionForm>
        </details>
        <ActionForm action={addNoteAction.bind(null, entityType, entityId)} className="space-y-2">
          <textarea name="body" rows={2} className="input text-xs" placeholder="Add a note: a call with the payer, what the patient said, what to try next" required />
          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Add note</SubmitButton>
        </ActionForm>
        {notes.length > 0 && (
          <ol className="space-y-2 border-t border-slate-200 pt-3">
            {notes.map(({ note, author }) => (
              <li key={note.id}>
                <div className="whitespace-pre-wrap text-slate-800">{note.body}</div>
                <div className="text-[11px] text-slate-400">{author ?? "Someone"} · {fmtDateTime(note.createdAt)}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
