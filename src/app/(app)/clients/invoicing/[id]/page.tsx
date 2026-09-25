import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { accessFor, requireSession } from "@/lib/auth";
import { getInvoice } from "@/server/client-billing";
import { PrintButton } from "@/components/action-form";
import { Badge, Money } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** A client invoice, laid out to print or save as PDF. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const row = await getInvoice(db, id).catch(() => null);
  if (!row || !(await accessFor(db, s.userId, row.inv.practiceId))) notFound();
  const { inv, practice } = row;
  const monthName = new Date(`${inv.period}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <div className="no-print mb-4 flex gap-2">
        <Link href="/clients/invoicing" className="btn btn-secondary">Back</Link>
        <PrintButton label="Print or save as PDF" />
      </div>
      <article className="card mx-auto max-w-2xl p-8 text-sm text-slate-800">
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{inv.issuer.name}</h1>
            {inv.issuer.address && <p className="whitespace-pre-line text-slate-600">{inv.issuer.address}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">Invoice {inv.number}</p>
            <p>Issued {fmtDate(inv.createdAt)}</p>
            {inv.dueDate && <p>Due {fmtDate(`${inv.dueDate}T00:00:00`)}</p>}
            {inv.status !== "draft" && <Badge tone={inv.status === "paid" ? "green" : inv.status === "void" ? "red" : "blue"}>{inv.status}</Badge>}
          </div>
        </header>
        <section className="mt-8">
          <p className="text-xs uppercase tracking-wide text-slate-500">Bill to</p>
          <p className="font-semibold">{practice.name}</p>
          <p className="text-slate-600">{practice.address1}, {practice.city}, {practice.state} {practice.zip}</p>
        </section>
        <table className="mt-8 w-full">
          <thead><tr className="border-b border-slate-300 text-left"><th className="py-2">Billing services, {monthName}</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            <tr><td className="py-1">Insurance payments collected (net of recoupments)</td><td className="text-right"><Money cents={inv.insuranceCents} /></td></tr>
            <tr><td className="py-1">Patient payments collected (net of refunds){inv.baseCents === Math.max(0, inv.insuranceCents) && inv.patientCents ? ", not included" : ""}</td><td className="text-right"><Money cents={inv.patientCents} /></td></tr>
            <tr className="border-t border-slate-200"><td className="py-1">Collections the fee applies to</td><td className="text-right"><Money cents={inv.baseCents} /></td></tr>
            <tr><td className="py-1">Rate</td><td className="text-right">{(inv.rateBps / 100).toFixed(2)}%</td></tr>
            <tr className="border-t-2 border-slate-800 text-base font-bold"><td className="py-2">Amount due</td><td className="text-right"><Money cents={inv.feeCents} /></td></tr>
          </tbody>
        </table>
        {inv.feeCents > Math.round((inv.baseCents * inv.rateBps) / 10_000) && <p className="mt-2 text-xs text-slate-500">The monthly minimum in the billing agreement applies.</p>}
      </article>
    </>
  );
}
