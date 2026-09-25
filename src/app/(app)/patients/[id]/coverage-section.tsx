import { getDb } from "@/db";
import { latestSearches, DISCOVERY_MAX_PAYERS } from "@/server/coverage";
import { addDiscoveredAction, discoverCoverageAction } from "@/app/(app)/front-desk-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

/** For a patient with no insurance on file: ask each payer whether it covers them. */
export async function CoverageSection({ practiceId, patientId, canWrite, simulated }: { practiceId: string; patientId: string; canWrite: boolean; simulated: boolean }) {
  const searches = await latestSearches(await getDb(), practiceId, patientId);
  const found = searches.filter((r) => r.search.status === "found");
  return (
    <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">No insurance on file</p>
      <p className="mt-1 text-xs">Coverage discovery asks up to {DISCOVERY_MAX_PAYERS} of your payers, by name and date of birth, whether they cover this patient. Not every payer answers that kind of search.{simulated ? " Stedi is not connected, so answers come from the simulated clearinghouse and are not real coverage." : ""}</p>
      {canWrite && (
        <ActionForm action={discoverCoverageAction.bind(null, patientId)} className="mt-2">
          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Asking payers...">{searches.length ? "Search again" : "Find coverage"}</SubmitButton>
        </ActionForm>
      )}
      {searches.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {found.map(({ search: r, payerName }) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white p-2 text-slate-800">
              <span><strong>{payerName}</strong> · member {r.memberId}{r.planName ? ` · ${r.planName}` : ""}</span>
              {r.addedInsuranceId ? <Badge tone="green">added</Badge> : canWrite && (
                <ActionForm action={addDiscoveredAction.bind(null, r.id, patientId)}><SubmitButton className="btn btn-primary text-xs" pendingLabel="...">Add as insurance</SubmitButton></ActionForm>
              )}
            </li>
          ))}
          <li className="text-amber-900/80">
            Last searched {fmtDate(searches[0].search.createdAt)}: {found.length} found, {searches.filter((r) => r.search.status === "not_found").length} not found, {searches.filter((r) => r.search.status === "error").length} could not answer.
          </li>
        </ul>
      )}
    </div>
  );
}
