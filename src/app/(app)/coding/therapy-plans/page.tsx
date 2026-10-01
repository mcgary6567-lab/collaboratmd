import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { CERTIFY_WITHIN_DAYS, DISCIPLINES, plansNeedingAction } from "@/server/therapy-plans";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Therapy plans of care" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** Plans waiting for the physician's signature, and plans ending soon that need recertifying. */
export default async function TherapyPlansPage() {
  const s = await requireSession();
  const rows = await plansNeedingAction(await getDb(), s.practiceId);
  const unsigned = rows.filter((r) => r.uncertified);
  const ending = rows.filter((r) => !r.uncertified && r.endingSoon);
  const list = (items: typeof rows) => (
    <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
      {items.map((r) => (
        <li key={r.plan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <Link href={`/patients/${r.plan.patientId}`} className="font-medium text-brand-700 underline">{r.lastName}, {r.firstName}</Link>
          <span>{DISCIPLINES[r.plan.discipline as keyof typeof DISCIPLINES]?.label}</span>
          <span className="text-slate-500 dark:text-slate-400">{day(r.plan.startsOn)} to {day(r.plan.endsOn)}</span>
          {r.uncertified && <Badge tone={r.certificationLate ? "red" : "amber"}>{r.certificationLate ? `unsigned, ${r.daysSinceStart} days in` : `unsigned, day ${r.daysSinceStart}`}</Badge>}
          {!r.uncertified && <Badge tone={r.ended ? "red" : "amber"}>{r.ended ? "ended" : "ends soon"}</Badge>}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageHeader title="Therapy plans of care" subtitle={`Medicare outpatient therapy needs a plan signed by a physician or NPP within ${CERTIFY_WITHIN_DAYS} days of the first treatment, and recertified at least every 90 days`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Waiting for the signature (${unsigned.length})`}>{unsigned.length ? list(unsigned) : <Empty>Every plan is signed.</Empty>}</Card>
        <Card title={`Ending in the next 14 days (${ending.length})`}>{ending.length ? list(ending) : <Empty>No plans ending soon.</Empty>}</Card>
      </div>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Plans are recorded, certified and recertified on the patient&apos;s page. Medicare claims with GP, GO or GN lines are checked against them when scrubbed.</p>
    </>
  );
}
