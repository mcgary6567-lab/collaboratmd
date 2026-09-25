import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { assignableUsers, listTasks, type TaskView } from "@/server/work";
import { createTaskAction, reassignTaskAction, setTaskStatusAction } from "@/app/(app)/work-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const VIEWS: { key: TaskView; label: string }[] = [
  { key: "mine", label: "Assigned to me" },
  { key: "created", label: "I assigned" },
  { key: "unassigned", label: "Unassigned" },
  { key: "all", label: "All open" },
  { key: "done", label: "Done" },
];

const link = (type: string | null, id: string | null) =>
  !type || !id ? null : type === "claim" ? `/claims/${id}` : type === "patient" ? `/patients/${id}` : "/denials";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: v } = await searchParams;
  const view = (VIEWS.find((x) => x.key === v)?.key ?? "mine") as TaskView;
  const s = await requireSession();
  const db = await getDb();
  const [rows, people] = await Promise.all([listTasks(db, s.practiceId, s.userId, view), assignableUsers(db, s.practiceId)]);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = rows.filter((r) => r.task.status === "open" && r.task.dueDate && r.task.dueDate < today).length;

  return (
    <>
      <PageHeader title="Tasks" subtitle={view === "done" ? "Recently completed" : `${rows.length} open${overdue ? ` · ${overdue} overdue` : ""}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-1">
            {VIEWS.map((x) => (
              <Link key={x.key} href={`/tasks?view=${x.key}`} className={`rounded-full px-3 py-1 text-xs font-semibold ${view === x.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{x.label}</Link>
            ))}
          </div>
          {rows.length === 0 ? (
            <Empty>{view === "mine" ? "Nothing assigned to you. Nice." : "No tasks here."}</Empty>
          ) : (
            <ul className="divide-y divide-slate-200">
              {rows.map(({ task, assignee }) => {
                const href = link(task.entityType, task.entityId);
                const late = task.status === "open" && task.dueDate && task.dueDate < today;
                return (
                  <li key={task.id} className="flex flex-wrap items-start gap-3 py-3">
                    <form action={setTaskStatusAction.bind(null, task.id, task.status === "open" ? "done" : "open")}>
                      <button
                        className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${task.status === "done" ? "border-green-500 bg-green-500 text-white" : "border-slate-300 hover:bg-green-50"}`}
                        title={task.status === "open" ? "Mark done" : "Reopen"}
                        aria-label={task.status === "open" ? "Mark done" : "Reopen"}
                      >
                        {task.status === "done" ? "✓" : ""}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <div className={`font-medium ${task.status === "done" ? "text-slate-400 line-through" : ""}`}>
                        {href ? <Link href={href} className="hover:underline">{task.title}</Link> : task.title}
                      </div>
                      {task.note && <div className="mt-0.5 text-xs text-slate-600">{task.note}</div>}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {task.priority === "high" && <Badge tone="red">High</Badge>}
                        {task.dueDate && <span className={late ? "font-semibold text-red-700" : ""}>Due {fmtDate(task.dueDate + "T00:00:00")}{late ? " (overdue)" : ""}</span>}
                        <span>Created {fmtDateTime(task.createdAt)}</span>
                        {task.completedAt && <span>Done {fmtDateTime(task.completedAt)}</span>}
                      </div>
                    </div>
                    {task.status === "open" && (
                      <form action={reassignTaskAction.bind(null, task.id)} className="flex items-center gap-1">
                        <select name="assigneeId" defaultValue={task.assigneeId ?? ""} className="input w-40 py-1 text-xs" aria-label="Assignee">
                          <option value="">Unassigned</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <button className="btn btn-secondary py-1 text-xs">Move</button>
                      </form>
                    )}
                    {task.status !== "open" && assignee && <span className="text-xs text-slate-500">{assignee}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="New task">
          <ActionForm action={createTaskAction} className="space-y-3 text-sm">
            <input name="title" className="input" placeholder="What needs doing?" required />
            <select name="assigneeId" className="input" defaultValue={s.userId}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input name="dueDate" type="date" className="input" />
              <select name="priority" className="input" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="high">High priority</option>
              </select>
            </div>
            <textarea name="note" rows={2} className="input" placeholder="Details (optional)" />
            <SubmitButton pendingLabel="Saving...">Create task</SubmitButton>
            <p className="text-xs text-slate-500">To assign work on a specific claim, patient or group of claims, use the panel on its page or select claims in the claims list.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
