import Link from "next/link";
import { getDb } from "@/db";
import { listAttachments, REPORT_TYPES, TRANSMISSIONS } from "@/server/attachments";
import { addAttachmentAction, removeAttachmentAction } from "@/app/(app)/dental-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";

/** Documents that support the claim, each referenced on the claim by a PWK segment. */
export async function AttachmentsSection({ practiceId, claimId, submitted, canWrite }: { practiceId: string; claimId: string; submitted: boolean; canWrite: boolean }) {
  const files = await listAttachments(await getDb(), practiceId, claimId);
  return (
    <Card title={`Attachments${files.length ? ` · ${files.length}` : ""}`} actions={files.length ? <Link href={`/claims/${claimId}/cover`} className="btn btn-secondary text-xs">Fax or mail cover sheet</Link> : undefined}>
      {files.length > 0 && (
        <ul className="mb-3 space-y-2 text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2">
              <div className="min-w-0">
                <a href={`/api/attachments/${f.id}`} target="_blank" className="font-medium text-brand-700 hover:underline">{f.filename}</a>
                <div className="text-xs text-slate-500">{REPORT_TYPES[f.reportType] ?? f.reportType} · {TRANSMISSIONS[f.transmission] ?? f.transmission} · control <span className="font-mono">{f.controlNumber}</span> · {Math.ceil(f.sizeBytes / 1024)} KB</div>
              </div>
              {f.sentAt ? <Badge tone="green">on the claim sent</Badge> : canWrite && (
                <ActionForm action={removeAttachmentAction.bind(null, f.id, claimId)}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Remove</SubmitButton></ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <ActionForm action={addAttachmentAction.bind(null, claimId)} className="space-y-2 text-sm">
          <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/tiff" className="block w-full text-xs" required />
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="reportType" defaultValue="OZ" className="input">{Object.entries(REPORT_TYPES).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}</select>
            <select name="transmission" defaultValue="FX" className="input">{Object.entries(TRANSMISSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Uploading...">Attach</SubmitButton>
          <p className="text-xs text-slate-500">
            {submitted ? "This claim was already sent; a new attachment reaches the payer on a corrected claim or when you send it quoting the control number." : "The claim will carry a PWK segment for each attachment."}{" "}
            Send the document itself by fax or mail with the cover sheet, or upload it on the payer&apos;s portal quoting the control number. PDF, JPEG, PNG or TIFF, up to 5 MB.
          </p>
        </ActionForm>
      )}
    </Card>
  );
}
