import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { logPatientView } from "@/lib/log-view";
import { getPolicies } from "@/server/policies";
import { unclaimedCase } from "@/server/unclaimed";
import { fmtDate, money } from "@/lib/utils";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "Unclaimed credit letter" };
export const dynamic = "force-dynamic";

/** The due-diligence letter: the credit is the patient's, and how to claim it before it goes to the state. */
export default async function UnclaimedLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const db = await getDb();
  const row = await unclaimedCase(db, s.practiceId, id);
  if (!row) notFound();
  const [practice] = await db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
  const state = (await getPolicies(db, s.practiceId)).unclaimed?.state ?? "your state";
  await logPatientView(s, row.p.id, "unclaimed_letter", id);
  const { c, p } = row;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className="mx-auto max-w-3xl bg-white p-10 text-slate-900">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href="/billing/credits" className="btn btn-secondary">Back to credits</Link>
        <PrintButton />
      </div>
      <p className="text-sm">{practice.name}<br />{practice.address1}<br />{practice.city}, {practice.state} {practice.zip}{practice.phone ? <><br />{practice.phone}</> : null}</p>
      <p className="mt-8 text-sm">{fmtDate(`${today}T00:00:00`)}</p>
      <p className="mt-6 text-sm">{p.firstName} {p.lastName}<br />{p.address1}<br />{[p.city, p.state].filter(Boolean).join(", ")} {p.zip}</p>
      <h1 className="mt-8 text-lg font-bold">You have a credit of {money(c.amountCents)} with us</h1>
      <div className="mt-4 space-y-3 text-sm leading-relaxed">
        <p>Dear {p.firstName} {p.lastName},</p>
        <p>Our records show a credit of {money(c.amountCents)} on your account (account {p.mrn}). It is money you paid that was more than you owed, and it belongs to you. There has been no activity on the account since {fmtDate(`${c.lastActivityOn}T00:00:00`)}.</p>
        <p>To claim it, please call us{practice.phone ? ` at ${practice.phone}` : ""} or write to the address above within 30 days of this letter, and tell us whether you would like a refund or would like the credit kept on your account for future visits.</p>
        <p>If we do not hear from you, the law requires us to report the credit to the {state} unclaimed property program and send the money to it. You can still claim it from the state after that.</p>
        <p>Sincerely,<br />{practice.name}</p>
      </div>
    </main>
  );
}
