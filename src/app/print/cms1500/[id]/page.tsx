import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { paperClaim } from "@/server/paper-claim";
import type { Field } from "@/lib/cms1500";
import { PrintToolbar } from "./toolbar";

export const metadata: Metadata = { title: "CMS-1500 claim form" };
export const dynamic = "force-dynamic";

const LINE_IN = 1 / 6;
const COL_IN = 0.1;

/** Where every field lands on an alignment test: a mark at a few known boxes. */
const TEST: Field[] = [
  { line: 8, col: 50, text: "1A XXXXXXXXXX", box: "1a" }, { line: 10, col: 2, text: "2 XXXXXXXXXXXX", box: "2" }, { line: 10, col: 31, text: "MM DD YYYY", box: "3" },
  { line: 39, col: 3, text: "A.XXXXX", box: "21A" }, { line: 45, col: 1, text: "MM DD YY", box: "24A" }, { line: 45, col: 25, text: "XXXXX", box: "24D" },
  { line: 45, col: 50, text: "   99999", box: "24F" }, { line: 45, col: 58, text: "99" }, { line: 57, col: 1, text: "XXXXXXXXX", box: "25" }, { line: 61, col: 50, text: "XXXXXXXXXX", box: "33a" },
];

export default async function Cms1500Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ plain?: string; test?: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const q = await searchParams;
  const paper = await paperClaim(await getDb(), s.practiceId, id);
  if (!paper) notFound();
  const plain = q.plain === "1";
  const pages = q.test === "1" ? [TEST] : paper.pages;
  const { x, y } = paper.offset;
  return (
    <div className="cms1500-root overflow-x-auto bg-slate-100 print:overflow-visible print:bg-white" tabIndex={0} role="region" aria-label="Claim form (scrolls sideways)">
      <PrintToolbar claimId={id} controlNumber={paper.bundle.claim.controlNumber} status={paper.bundle.claim.status} plain={plain} test={q.test === "1"} pages={paper.pages.length} />
      {pages.map((fields, i) => (
        <section key={i} className="cms1500-sheet" aria-label={`CMS-1500 form ${i + 1} of ${pages.length}`}>
          {plain && <div className="cms1500-title">HEALTH INSURANCE CLAIM FORM · APPROVED BY NUCC 02/12 · PLAIN-PAPER COPY</div>}
          {fields.map((f, k) => (
            <span key={k} className="cms1500-field" style={{ left: `calc(${(f.col - 1) * COL_IN}in + ${x}mm)`, top: `calc(${(f.line - 1) * LINE_IN}in + ${y}mm)` }}>
              {plain && f.box && <span className="cms1500-box">{f.box}</span>}
              {f.text}
            </span>
          ))}
        </section>
      ))}
      <p className="no-print mx-auto max-w-3xl px-4 pb-10 text-xs text-slate-700">
        On a pre-printed red CMS-1500, print at 100% (no &quot;fit to page&quot;). If the text sits off the boxes, print the alignment test and set the offset under
        {" "}<Link href="/settings/profile" className="underline">Practice profile</Link>. Most payers that take paper scan the red form and reject copies on plain paper.
      </p>
    </div>
  );
}
