import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { FINAL_NOTICE_DAYS, finalNoticeText, getCollection } from "@/server/collections";
import { PrintButton } from "@/components/action-form";

export const dynamic = "force-dynamic";

export default async function FinalNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  let data;
  try {
    data = await getCollection(db, s.practiceId, id);
  } catch {
    notFound();
  }
  const { collection: c, patient: p, practice } = data;
  const sent = c.finalNoticeAt ?? c.createdAt;
  const payBy = new Date(sent.getTime() + FINAL_NOTICE_DAYS * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex gap-2">
        <Link href="/billing/collections" className="btn btn-secondary">Back</Link>
        <PrintButton label="Print or save as PDF" />
      </div>
      <article className="card space-y-4 p-8 font-serif text-sm leading-relaxed text-slate-900">
        <header>
          <p className="font-sans text-base font-bold">{practice.name}</p>
          <p>{practice.address1}, {practice.city}, {practice.state} {practice.zip}{practice.phone ? ` · ${practice.phone}` : ""}</p>
        </header>
        <p>{sent.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        <p>
          {p.firstName} {p.lastName}<br />
          {p.address1 && <>{p.address1}<br /></>}
          {p.city && <>{p.city}, {p.state} {p.zip}</>}
        </p>
        <p className="font-sans font-bold uppercase tracking-wide">Final notice · Account {p.mrn}</p>
        <div className="whitespace-pre-line">{finalNoticeText(p, practice, c.amountCents, payBy)}</div>
      </article>
    </div>
  );
}
