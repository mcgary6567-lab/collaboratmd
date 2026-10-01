import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { referralsRunningOut } from "@/server/referrals-in";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "HMO referrals" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** Referrals ending soon or nearly used up: ask the primary care physician for a new one before the next visit. */
export default async function ReferralsPage() {
  const s = await requireSession();
  const rows = await referralsRunningOut(await getDb(), s.practiceId);
  return (
    <>
      <PageHeader title="HMO referrals" subtitle="Referrals that end in the next 14 days or have one visit or none left. Ask the primary care physician for the next one before the patient comes in." actions={<Link href="/settings/payers" className="btn btn-secondary">Plans that need referrals</Link>} />
      <Card title={`Running out (${rows.length})`}>
        {rows.length === 0 ? <Empty>No referrals running out. Referrals are added on the patient&apos;s page.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Referrals running out" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Patient</th><th>Plan</th><th>Referral</th><th>From</th><th>Ends</th><th>Visits</th></tr></thead>
              <tbody>{rows.map((x) => (
                <tr key={x.r.id}>
                  <td data-label="Patient"><Link href={`/patients/${x.r.patientId}`} className="text-brand-700 underline">{x.lastName}, {x.firstName}</Link></td>
                  <td data-label="Plan">{x.payer}</td>
                  <td data-label="Referral" className="font-mono">{x.r.referralNumber}</td>
                  <td data-label="From">{x.r.referringName ?? "-"}</td>
                  <td data-label="Ends">{day(x.r.endsOn)}</td>
                  <td data-label="Visits">{x.r.visitsAllowed === null ? `${x.used} used` : <Badge tone={x.left !== null && x.left <= 0 ? "red" : "amber"}>{x.used} of {x.r.visitsAllowed} used</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
