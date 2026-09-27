import Link from "next/link";
import { revalidatePath } from "next/cache";
import { isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { isPlatformOperator } from "@/server/code-sets";
import { extendTrial, practiceOverview } from "@/server/operator";
import { moveAttachmentsToStore } from "@/server/attachments";
import { fileStore } from "@/server/files";
import { platformBillingReady } from "@/server/subscription";
import { ActionForm, SubmitButton, type FormResult } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function operator() {
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) throw new Error("Only platform operators can do this");
  return s;
}

async function extendAction(practiceId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  "use server";
  try {
    const s = await operator();
    const until = await extendTrial(await getDb(), practiceId, Number(fd.get("days") ?? 14), s.email);
    revalidatePath("/ops/practices");
    return { ok: true, message: `Trial now ends ${until.toUTCString().slice(0, 16)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not extend" };
  }
}

async function moveFilesAction(_prev: FormResult): Promise<FormResult> {
  "use server";
  try {
    await operator();
    const r = await moveAttachmentsToStore(await getDb(), 200);
    revalidatePath("/ops/practices");
    return { ok: true, message: `Moved ${r.moved}; ${r.left} still in the database${r.left ? ". Run it again to continue." : "."}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not move files" };
  }
}

const TONE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = { active: "green", trialing: "blue", past_due: "amber", trial_ended: "red", canceled: "red", none: "slate" };

export default async function OperatorPracticesPage() {
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) {
    return <><PageHeader title="Practices" /><Card><p className="text-sm text-slate-600">This page is for the people who operate the service.</p></Card></>;
  }
  const db = await getDb();
  const { rows, totals } = await practiceOverview(db);
  const [{ n: dbFiles }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.claimAttachments).where(isNull(schema.claimAttachments.storageKey));
  const stat = (label: string, value: string) => <div className="card p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>;

  return (
    <>
      <PageHeader title="Practices" subtitle="Every practice on the platform: trials, subscriptions and use. Counts and dates only." actions={<Link href="/ops/errors" className="btn btn-secondary">Server errors</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stat("Practices", String(totals.practices))}
        {stat("Self-serve", String(totals.selfServe))}
        {stat("In trial", String(totals.trialing))}
        {stat("Paying", String(totals.paying))}
        {stat("Est. monthly", money(totals.monthlyCents))}
        {stat("Claims, 30 days", totals.claims30.toLocaleString())}
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Practice</th><th>Status</th><th>Plan</th><th className="text-right">Providers</th><th className="text-right">Users</th><th className="text-right">Claims (30d)</th><th>Last sign-in</th><th className="text-right">Monthly</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">since {fmtDate(r.createdAt)}{r.selfServe ? " · self-serve" : " · agreement"}{r.closingAt ? ` · closing ${fmtDate(r.closingAt)}` : ""}</div></td>
                  <td><Badge tone={r.blocked ? "red" : TONE[r.status] ?? "slate"}>{r.status.replace(/_/g, " ")}</Badge>{r.trialEndsAt && r.status === "trialing" && <div className="text-xs text-slate-500">ends {fmtDate(r.trialEndsAt)}</div>}</td>
                  <td>{r.plan ?? "-"}{r.seats ? <span className="text-xs text-slate-500"> × {r.seats}</span> : null}</td>
                  <td className="text-right">{r.providers}</td>
                  <td className="text-right">{r.users}</td>
                  <td className="text-right">{r.claims30.toLocaleString()}</td>
                  <td className="text-xs">{r.lastLogin ? fmtDateTime(r.lastLogin) : "never"}</td>
                  <td className="text-right">{r.monthlyCents !== null ? money(r.monthlyCents) : "-"}</td>
                  <td>{r.selfServe && <ActionForm action={extendAction.bind(null, r.id)} className="flex items-center gap-1"><input name="days" type="number" min={1} max={60} defaultValue={14} className="input w-16 py-1 text-xs" aria-label="Days to add" /><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Extend trial</SubmitButton></ActionForm>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">Monthly is estimated from the plan&apos;s list price per provider; annual plans and discounts are billed differently in Stripe.{platformBillingReady() ? "" : " Subscriptions are not set up on this deployment."}</p>
      </Card>
      <Card title="File storage" className="mt-6">
        <p className="text-sm text-slate-600">{fileStore() ? `${dbFiles} claim attachment${dbFiles === 1 ? " is" : "s are"} still in the database.` : "File storage is not configured (FILE_STORAGE=blob); attachments stay in the database."}</p>
        {fileStore() && dbFiles > 0 && <ActionForm action={moveFilesAction} className="mt-3"><SubmitButton pendingLabel="Moving...">Move 200 to file storage</SubmitButton></ActionForm>}
      </Card>
    </>
  );
}
