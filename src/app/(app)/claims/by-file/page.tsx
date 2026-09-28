import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, like } from "drizzle-orm";
import { Download, Upload } from "lucide-react";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { markSentAction, saveEdiIdsAction, uploadResponseAction } from "@/app/(app)/clearinghouse-file-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Send claims by file" };
export const dynamic = "force-dynamic";

/** For practices whose clearinghouse takes 837 files: download, upload there, mark sent, and bring the answers back. */
export default async function ByFilePage() {
  const s = await requireSession();
  const db = await getDb();
  const [ready, [practice], uploads] = await Promise.all([
    db.select({ id: schema.claims.id, controlNumber: schema.claims.controlNumber, totalCents: schema.claims.totalCents, payer: schema.payers.name, dos: schema.encounters.dateOfService })
      .from(schema.claims)
      .innerJoin(schema.payers, eq(schema.payers.id, schema.claims.payerId))
      .innerJoin(schema.encounters, eq(schema.encounters.id, schema.claims.encounterId))
      .where(and(eq(schema.claims.practiceId, s.practiceId), eq(schema.claims.status, "ready")))
      .orderBy(asc(schema.claims.controlNumber)).limit(500),
    db.select({ submitter: schema.practices.ediSubmitterId, receiver: schema.practices.ediReceiverId }).from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1),
    db.select().from(schema.inboundTransactions).where(and(eq(schema.inboundTransactions.practiceId, s.practiceId), like(schema.inboundTransactions.transactionId, "upload:%"))).orderBy(desc(schema.inboundTransactions.receivedAt)).limit(10),
  ]);
  const ids = ready.map((r) => r.id);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader title="Send claims by file" subtitle="For a clearinghouse you upload files to (Office Ally, Availity, Claim.MD and others)" actions={<Link href="/claims" className="btn btn-secondary">Claims</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`1. Download ready claims · ${ready.length}`}>
            {ready.length === 0 ? <Empty>No claims are ready. Claims become ready once they pass their checks.</Empty> : (
              <>
                <div className="max-h-72 overflow-auto" tabIndex={0} role="region" aria-label="Ready claims">
                  <table className="table">
                    <thead><tr><th>Claim</th><th>Payer</th><th>Date of service</th><th className="text-right">Billed</th></tr></thead>
                    <tbody>{ready.map((r) => (
                      <tr key={r.id}><td><Link href={`/claims/${r.id}`} className="font-mono text-brand-700 hover:underline">{r.controlNumber}</Link></td><td className="text-xs">{r.payer}</td><td>{fmtDate(r.dos)}</td><td className="text-right"><Money cents={r.totalCents} /></td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <a href={`/api/claims/batch-837?ids=${ids.join(",")}`} className="btn btn-primary mt-4"><Download className="h-4 w-4" /> Download one 837 file with these {ready.length} claims</a>
              </>
            )}
          </Card>
          <Card title="2. After uploading it to your clearinghouse">
            {ready.length === 0 ? <p className="text-sm text-slate-500">Nothing waiting.</p> : (
              <ActionForm action={markSentAction.bind(null, ids)} className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingLabel="Saving...">Mark these {ready.length} claims as sent</SubmitButton>
                <span className="text-xs text-slate-500">Do this once the clearinghouse accepted the file. Timely filing and follow-up count from today.</span>
              </ActionForm>
            )}
          </Card>
          <Card title="3. Upload what comes back">
            <ActionForm action={uploadResponseAction} className="flex flex-wrap items-end gap-3 text-sm">
              <label className="block"><span className="label">999, 277CA or 835 file</span><input type="file" name="file" className="input" accept=".x12,.edi,.txt,.835,.277,.999" required /></label>
              <SubmitButton pendingLabel="Reading..."><Upload className="h-4 w-4" /> Upload</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-slate-500">A 277CA moves each claim to accepted or rejected (a rejection opens a denial to work); an 835 posts the payments. The same file uploaded twice is read once.</p>
            {uploads.length > 0 && (
              <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {uploads.map((u) => <li key={u.transactionId} className="flex flex-wrap justify-between gap-2 py-2"><span>{u.note}</span><span className="text-xs text-slate-500">{fmtDateTime(u.receivedAt, s.timeZone)}</span></li>)}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Your IDs at the clearinghouse">
          <p className="mb-3 text-sm text-slate-600">The clearinghouse gives you a submitter ID and tells you its own receiver ID (in its enrollment email or companion guide). Downloaded files carry them in the envelope (ISA06 and ISA08).</p>
          {admin ? (
            <ActionForm action={saveEdiIdsAction} className="space-y-3">
              <label className="block text-sm"><span className="label">Your submitter ID</span><input name="submitter" className="input font-mono" defaultValue={practice?.submitter ?? ""} maxLength={15} autoComplete="off" /></label>
              <label className="block text-sm"><span className="label">Clearinghouse receiver ID</span><input name="receiver" className="input font-mono" defaultValue={practice?.receiver ?? ""} maxLength={15} autoComplete="off" /></label>
              <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-slate-500">{practice?.submitter ? `Submitter ${practice.submitter}, receiver ${practice.receiver}` : "Not set. An administrator can set them."}</p>}
        </Card>
      </div>
    </>
  );
}
