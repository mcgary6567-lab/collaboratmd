import Link from "next/link";
import type { Db } from "@/db";
import { KINDS, arrangementsOn } from "@/server/substitutes";
import { applySubstituteAction } from "@/app/(app)/visit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card } from "@/components/ui";

/** Seen by a substitute physician: shown when an arrangement covers the claim's provider on its date. */
export async function SubstituteCard({ db, claimId, providerId, dateOfService, substituteId, editable }: { db: Db; claimId: string; providerId: string; dateOfService: string; substituteId: string | null; editable: boolean }) {
  const options = await arrangementsOn(db, providerId, dateOfService);
  if (!options.length && !substituteId) return null;
  const current = options.find((a) => a.id === substituteId);
  return (
    <Card title="Substitute physician" actions={<Link href="/settings/substitutes" className="text-sm text-brand-700 hover:underline">Arrangements</Link>}>
      <div className="space-y-2 text-sm">
        {current
          ? <p>Seen by {current.substituteName} (NPI {current.substituteNpi}), billed under the absent provider with {KINDS[current.kind as keyof typeof KINDS].modifier}.</p>
          : <p>The provider was away on this date and a substitute was covering. If the substitute saw this patient, mark it here: every line gets the modifier.</p>}
        {editable && (
          <ActionForm action={applySubstituteAction.bind(null, claimId)} className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">Seen by</span>
              <select name="arrangementId" defaultValue={substituteId ?? ""} className="input">
                <option value="">The provider (no substitute)</option>
                {options.map((a) => <option key={a.id} value={a.id}>{a.substituteName} ({KINDS[a.kind as keyof typeof KINDS].modifier})</option>)}
              </select>
            </label>
            <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
