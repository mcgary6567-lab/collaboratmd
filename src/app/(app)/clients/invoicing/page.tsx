import Link from "next/link";
import { getDb } from "@/db";
import { accessFor, accessiblePractices, requireSession } from "@/lib/auth";
import { collectionsFor, getAgreement, invoiceFee, lastMonth, listInvoices } from "@/server/client-billing";
import { createInvoiceAction, invoiceStatusAction, saveAgreementAction } from "@/app/(app)/ops-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TONE = { draft: "slate", sent: "blue", paid: "green", void: "red" } as const;

/** For billing companies: what each client practice owes for billing services, from its collections. */
export default async function InvoicingPage() {
  const s = await requireSession();
  const db = await getDb();
  const period = lastMonth();
  const all = await accessiblePractices(db, s.userId);
  const clients = (await Promise.all(all.map(async (p) => ((await accessFor(db, s.userId, p.id))?.role === "admin" ? p : null)))).filter((p): p is (typeof all)[number] => !!p);
  const rows = await Promise.all(clients.map(async (p) => {
    const [agreement, invoices, collections] = await Promise.all([getAgreement(db, p.id), listInvoices(db, p.id), collectionsFor(db, p.id, period)]);
    const preview = agreement ? invoiceFee(collections.insuranceCents, collections.patientCents, agreement.rateBps, agreement.minimumCents, agreement.includePatient) : null;
    return { p, agreement, invoices, collections, preview };
  }));
  const outstanding = rows.flatMap((r) => r.invoices).filter((i) => i.status === "sent").reduce((a, i) => a + i.feeCents, 0);

  return (
    <>
      <PageHeader title="Client invoicing" subtitle={`Bill each practice a percent of what you collected for it. Invoices are for whole months; the last one ended ${period}.`} actions={<Link href="/clients" className="btn btn-secondary">All clients</Link>} />
      {rows.length === 0 ? (
        <Card><Empty>You are not an administrator of any practice, so there is nothing to invoice.</Empty></Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">Sent and unpaid: <strong>{money(outstanding)}</strong> across {rows.length} client{rows.length === 1 ? "" : "s"}.</p>
          <div className="space-y-6">
            {rows.map(({ p, agreement, invoices, collections, preview }) => (
              <Card key={p.id} title={p.name}>
                <div className="grid gap-6 lg:grid-cols-5">
                  <div className="lg:col-span-2">
                    <details open={!agreement}>
                      <summary className="cursor-pointer text-sm font-semibold text-brand-700">{agreement ? `${(agreement.rateBps / 100).toFixed(2)}% of collections${agreement.minimumCents ? `, minimum ${money(agreement.minimumCents)}` : ""} · net ${agreement.termsDays}` : "Set up the billing agreement"}</summary>
                      <ActionForm action={saveAgreementAction.bind(null, p.id)} className="mt-3 space-y-2 text-sm">
                        <label className="block text-xs">Your company (shown on invoices)<input name="issuerName" defaultValue={agreement?.issuerName ?? ""} className="input mt-1" required /></label>
                        <label className="block text-xs">Your address<textarea name="issuerAddress" rows={2} defaultValue={agreement?.issuerAddress ?? ""} className="input mt-1" /></label>
                        <div className="grid grid-cols-3 gap-2">
                          <label className="block text-xs">Percent<input name="ratePct" inputMode="decimal" defaultValue={agreement ? (agreement.rateBps / 100).toString() : ""} placeholder="6.5" className="input mt-1" required /></label>
                          <label className="block text-xs">Monthly minimum<input name="minimum" inputMode="decimal" defaultValue={agreement ? (agreement.minimumCents / 100).toString() : "0"} className="input mt-1" /></label>
                          <label className="block text-xs">Terms
                            <select name="termsDays" defaultValue={String(agreement?.termsDays ?? 30)} className="input mt-1">{[0, 7, 10, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d ? `Net ${d}` : "On receipt"}</option>)}</select>
                          </label>
                        </div>
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="includePatient" defaultChecked={agreement?.includePatient ?? true} /> Include patient payments (not only insurance)</label>
                        <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Save agreement</SubmitButton>
                      </ActionForm>
                    </details>
                    {agreement && preview && (
                      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                        <div className="flex justify-between"><span>Insurance collected, {period}</span><Money cents={collections.insuranceCents} /></div>
                        <div className="flex justify-between"><span>Patient collected</span><Money cents={collections.patientCents} /></div>
                        <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Fee</span><Money cents={preview.feeCents} /></div>
                        <ActionForm action={createInvoiceAction.bind(null, p.id)} className="mt-2">
                          <input type="hidden" name="period" value={period} />
                          <SubmitButton className="btn btn-primary text-xs" pendingLabel="Creating...">Invoice {period}</SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                  </div>
                  <div className="lg:col-span-3">
                    {invoices.length === 0 ? <Empty>No invoices yet.</Empty> : (
                      <table className="table">
                        <thead><tr><th>Invoice</th><th>Month</th><th className="text-right">Collections</th><th className="text-right">Fee</th><th>Status</th><th /></tr></thead>
                        <tbody>
                          {invoices.map((i) => (
                            <tr key={i.id}>
                              <td><Link href={`/clients/invoicing/${i.id}`} className="font-mono text-brand-700 hover:underline">{i.number}</Link></td>
                              <td>{i.period}</td>
                              <td className="text-right"><Money cents={i.baseCents} /></td>
                              <td className="text-right font-semibold"><Money cents={i.feeCents} /></td>
                              <td><Badge tone={TONE[i.status as keyof typeof TONE] ?? "slate"}>{i.status}</Badge>{i.status === "sent" && i.dueDate && <span className="block text-xs text-slate-500">due {fmtDate(`${i.dueDate}T00:00:00`)}</span>}</td>
                              <td className="whitespace-nowrap text-right">
                                <div className="flex justify-end gap-1">
                                  {i.status === "draft" && <ActionForm action={invoiceStatusAction.bind(null, p.id, i.id, "sent")}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Mark sent</SubmitButton></ActionForm>}
                                  {i.status === "sent" && <ActionForm action={invoiceStatusAction.bind(null, p.id, i.id, "paid")}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Mark paid</SubmitButton></ActionForm>}
                                  {(i.status === "draft" || i.status === "sent") && <ActionForm action={invoiceStatusAction.bind(null, p.id, i.id, "void")}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs text-red-700" pendingLabel="...">Void</SubmitButton></ActionForm>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
