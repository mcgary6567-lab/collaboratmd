import { reportMeasureAction } from "@/app/(app)/quality-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import type { measuresForClaim } from "@/server/quality";

/** Quality measures this visit qualifies for: one click adds the outcome's code at $0.00. */
export function QualityCard({ claimId, items, editable }: { claimId: string; items: Awaited<ReturnType<typeof measuresForClaim>>; editable: boolean }) {
  if (!items.length) return null;
  return (
    <Card title="Quality measures for this visit">
      <ul className="space-y-3 text-sm">
        {items.map(({ measure: m, reported }) => (
          <li key={m.id}>
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">#{m.number} {m.title}</span>{reported ? <Badge tone="green">Reported: {reported.code}</Badge> : <Badge tone="amber">Not reported</Badge>}</div>
            {editable && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.codes.map((c) => (
                  <ActionForm key={c.code} action={reportMeasureAction.bind(null, claimId, m.id, c.code)}>
                    <SubmitButton className={`btn text-xs ${reported?.code === c.code ? "btn-primary" : "btn-secondary"}`} pendingLabel="Adding...">{c.code}: {c.label}</SubmitButton>
                  </ActionForm>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
