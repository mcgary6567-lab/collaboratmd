import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { clearinghouseName } from "@/lib/clearinghouse/gateway";
import { DISCOVERY_MAX_PAYERS, selfPayCandidates } from "@/server/coverage";
import { practiceConfig } from "@/server/integrations";
import { discoverCoverageAction } from "@/app/(app)/front-desk-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CoverageDiscoveryPage() {
  const s = await requireSession();
  const db = await getDb();
  const [rows, cfg] = await Promise.all([selfPayCandidates(db, s.practiceId), practiceConfig(db, s.practiceId)]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const via = clearinghouseName(cfg.stedi?.apiKey);

  return (
    <>
      <PageHeader title="Coverage discovery" subtitle="Patients with no insurance on file, soonest visit first. Find coverage they may not have mentioned." />
      <Card>
        <p className="mb-4 text-sm text-slate-600">
          Each search sends an eligibility inquiry (270) by name and date of birth to up to {DISCOVERY_MAX_PAYERS} of your payers through {via === "Stedi" ? "Stedi" : "the simulated clearinghouse (connect Stedi for real answers)"}.
          Payers that support this kind of search answer with the member ID; the rest say they could not find the patient. Nothing is added until you add it on the patient&apos;s page.
        </p>
        {rows.length === 0 ? (
          <Empty>Every patient has insurance on file.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Patient</th><th>Date of birth</th><th>Next visit</th><th>Last searched</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/patients/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.last_name}, {r.first_name}</Link> <span className="text-xs text-slate-500">{r.mrn}</span></td>
                  <td>{r.dob ? fmtDate(`${r.dob}T00:00:00`) : <span className="text-amber-700">missing</span>}</td>
                  <td>{r.next_visit ? fmtDate(`${r.next_visit}T00:00:00`) : "-"}</td>
                  <td>{r.last_search ? fmtDate(`${r.last_search}T00:00:00`) : "never"} {Number(r.found) > 0 && <Link href={`/patients/${r.id}`}><Badge tone="green">{r.found} found</Badge></Link>}</td>
                  <td className="text-right">
                    {canWrite && r.dob && (
                      <ActionForm action={discoverCoverageAction.bind(null, r.id)}>
                        <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Asking payers...">Find coverage</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
