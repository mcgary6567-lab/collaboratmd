import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { logPatientView } from "@/lib/log-view";
import { holdCase } from "@/server/account-holds";
import { buildStatementDetail } from "@/server/billing";
import { fmtDate, money } from "@/lib/utils";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "Claim against an estate" };
export const dynamic = "force-dynamic";

/** The practice's claim to the executor for what a deceased patient owed, itemized by visit. */
export default async function EstateClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const db = await getDb();
  const row = await holdCase(db, s.practiceId, id);
  if (!row || row.h.kind !== "deceased") notFound();
  const { h, p } = row;
  const [practice] = await db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
  const d = await buildStatementDetail(db, p.id);
  await logPatientView(s, p.id, "estate_claim", id);
  const today = new Date().toISOString().slice(0, 10);
  const day = (v: string) => fmtDate(`${v}T00:00:00`);
  return (
    <main className="mx-auto max-w-3xl bg-white p-10 text-slate-900">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href="/billing/holds" className="btn btn-secondary">Back to bankruptcy and estates</Link>
        <PrintButton />
      </div>
      <p className="text-sm">{practice.name}<br />{practice.address1}<br />{practice.city}, {practice.state} {practice.zip}{practice.phone ? <><br />{practice.phone}</> : null}</p>
      <p className="mt-8 text-sm">{day(today)}</p>
      <p className="mt-6 text-sm">{h.details.executor || "Personal representative"}<br />Estate of {p.firstName} {p.lastName}{h.details.executorAddress ? <><br />{h.details.executorAddress}</> : null}</p>
      <h1 className="mt-8 text-lg font-bold">Claim against the estate of {p.firstName} {p.lastName}</h1>
      <div className="mt-4 space-y-3 text-sm leading-relaxed">
        <p>Decedent: {p.firstName} {p.lastName}, date of birth {day(p.dob)}, date of death {day(h.startedOn)}. Account {p.mrn}.{h.details.probateCourt ? ` Probate court: ${h.details.probateCourt}.` : ""}</p>
        <p>{practice.name} submits this claim for {money(d.totals.amountDueCents)} for medical services provided to the decedent, as itemized below. Insurance has been billed and its payments and adjustments are applied.</p>
      </div>
      {d.visits.length > 0 && (
        <table className="mt-6 w-full text-left text-sm">
          <thead><tr className="border-b border-slate-300"><th className="py-1">Date of service</th><th>Services</th><th className="text-right">Charges</th><th className="text-right">Insurance paid</th><th className="text-right">Owed</th></tr></thead>
          <tbody>{d.visits.map((v) => (
            <tr key={v.claimId} className="border-b border-slate-100 align-top">
              <td className="py-1">{v.dateOfService ? day(v.dateOfService) : "-"}</td>
              <td>{v.services.map((x) => x.description).join("; ")}</td>
              <td className="text-right tabular-nums">{money(v.chargesCents)}</td>
              <td className="text-right tabular-nums">{money(v.insurancePaidCents)}</td>
              <td className="text-right tabular-nums">{money(v.youOweCents)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="mt-4 text-right text-sm font-semibold">Amount claimed: {money(d.totals.amountDueCents)}</p>
      <div className="mt-6 space-y-3 text-sm leading-relaxed">
        <p>Please direct questions and payment to the address above{practice.phone ? ` or call ${practice.phone}` : ""}. The personal representative is not personally responsible for this debt; it is a claim against the estate&apos;s assets.</p>
        <p>Sincerely,<br />{practice.name}</p>
      </div>
      <p className="no-print mt-8 text-xs text-slate-500">File by the deadline in the notice to creditors{h.deadline ? ` (${day(h.deadline)})` : ""}. Some probate courts require their own claim form; attach this itemization to it.</p>
    </main>
  );
}
