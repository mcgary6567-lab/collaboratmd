import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireRole } from "@/lib/auth";
import { NOTICE_DAYS } from "@/server/offboarding";
import { cancelClosureAction, scheduleClosureAction } from "@/app/(app)/closure-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Close account" };

export const dynamic = "force-dynamic";

export default async function CloseAccountPage() {
  const s = await requireRole(["admin"]);
  const [p] = await (await getDb()).select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
  return (
    <>
      <PageHeader title="Close account" subtitle="End your use of CollaboratMD and have all of this practice's data deleted" />
      {p.closingAt ? (
        <Card>
          <Alert kind="error">This practice is scheduled to close on {fmtDate(p.closingAt)}. On that day every record, file and user that belongs only to it is permanently deleted.</Alert>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/settings/data-export" className="btn btn-secondary">Export the data first</Link>
            <ActionForm action={cancelClosureAction}><SubmitButton pendingLabel="Cancelling...">Cancel the closure</SubmitButton></ActionForm>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="What happens">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
              <li><Link href="/settings/data-export" className="font-semibold text-brand-700 underline">Export your data</Link>. You get everything as spreadsheets plus the claim attachments.</li>
              <li>Cancel any subscription under <Link href="/settings/subscription" className="font-semibold text-brand-700 underline">Subscription</Link>.</li>
              <li>Schedule the closure here. It takes effect {NOTICE_DAYS} days later, and any administrator can cancel it until then.</li>
              <li>On that day all of the practice&apos;s records, files and sign-ins are permanently deleted. People who also work in another practice keep their sign-in there. We keep only a note that the deletion happened, when, and who asked.</li>
            </ol>
            <p className="mt-3 text-xs text-slate-500">Deleted data cannot be recovered. Backups held by our database provider expire on their own schedule after that.</p>
          </Card>
          <Card title="Schedule the closure">
            <ActionForm action={scheduleClosureAction} className="space-y-3 text-sm">
              <label className="block"><span className="label">Type the practice name to confirm: {p.name}</span><input name="confirmName" className="input" autoComplete="off" required /></label>
              <SubmitButton className="btn bg-red-700 text-white hover:bg-red-800" pendingLabel="Scheduling...">Close this practice in {NOTICE_DAYS} days</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}
    </>
  );
}
