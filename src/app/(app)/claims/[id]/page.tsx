import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { loadClaimBundle, getClaimFinancials, listAcknowledgments } from "@/server/claims";
import { writeOffClaimAction, transferToPatientAction } from "@/app/(app)/actions";
import { billAgainAction, billSecondaryAction, correctClaimAction, voidClaimAction } from "@/app/(app)/claim-control-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader, StatusBadge, PatientLink, Money, Badge } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { ClaimActions } from "./claim-actions";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const b = await loadClaimBundle(db, id);
  if (!b || b.claim.practiceId !== s.practiceId) notFound();
  // A secondary claim's money posts to its primary, so show the primary's books.
  const ledgerClaimId = b.claim.payerSequence === "S" && b.claim.primaryClaimId ? b.claim.primaryClaimId : id;
  const [events, fin, ledger, claimDenials, acks, related, secondaryIns] = await Promise.all([
    db.select().from(schema.claimEvents).where(eq(schema.claimEvents.claimId, id)).orderBy(desc(schema.claimEvents.at)),
    getClaimFinancials(db, ledgerClaimId),
    db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.claimId, ledgerClaimId)).orderBy(asc(schema.ledgerEntries.postedAt)),
    db.select().from(schema.denials).where(eq(schema.denials.claimId, id)),
    listAcknowledgments(db, id),
    // The claim this one replaces or voids, and any claims that replace or void it.
    db
      .select({ id: schema.claims.id, controlNumber: schema.claims.controlNumber, frequencyCode: schema.claims.frequencyCode, status: schema.claims.status, originalClaimId: schema.claims.originalClaimId, primaryClaimId: schema.claims.primaryClaimId, payerSequence: schema.claims.payerSequence })
      .from(schema.claims)
      .where(and(eq(schema.claims.practiceId, s.practiceId), or(
        eq(schema.claims.originalClaimId, id),
        eq(schema.claims.primaryClaimId, id),
        ...(b.claim.originalClaimId ? [eq(schema.claims.id, b.claim.originalClaimId)] : []),
        ...(b.claim.primaryClaimId ? [eq(schema.claims.id, b.claim.primaryClaimId)] : []),
      ))),
    db.select({ id: schema.patientInsurances.id }).from(schema.patientInsurances)
      .where(and(eq(schema.patientInsurances.patientId, b.claim.patientId), eq(schema.patientInsurances.active, true), eq(schema.patientInsurances.rank, 2))).limit(1),
  ]);
  const primaryClaim = related.find((r) => r.id === b.claim.primaryClaimId);
  const secondaryClaim = related.find((r) => r.primaryClaimId === id && r.payerSequence === "S");
  const canBillSecondary =
    b.claim.payerSequence === "P" && ["paid", "partially_paid"].includes(b.claim.status) && !secondaryClaim && secondaryIns.length > 0 &&
    fin.patientRespCents - fin.patientPaidCents - fin.discountsCents > 0;
  const original = related.find((r) => r.id === b.claim.originalClaimId);
  const successors = related.filter((r) => r.originalClaimId === id);
  const FREQ: Record<string, string> = { "1": "Original", "7": "Replacement", "8": "Void" };
  const canCorrect = ["denied", "rejected"].includes(b.claim.status) && fin.insurancePaidCents === 0;
  const canVoid =
    ["paid", "partially_paid", "denied"].includes(b.claim.status) &&
    b.claim.frequencyCode !== "8" &&
    !!b.claim.payerClaimNumber &&
    !successors.some((r) => r.frequencyCode === "8");
  const errors = b.claim.scrubResults.filter((f) => f.severity === "error");
  const warnings = b.claim.scrubResults.filter((f) => f.severity === "warning");
  const canSubmit = ["ready", "rejected"].includes(b.claim.status) || (b.claim.status === "scrub_errors" && errors.length === 0);
  const canClose = ["denied", "rejected", "partially_paid", "accepted", "pending"].includes(b.claim.status) && fin.insuranceBalanceCents > 0;

  return (
    <>
      <PageHeader
        title={`Claim ${b.claim.controlNumber}`}
        subtitle={`${b.payer.name} · DOS ${fmtDate(b.encounter.dateOfService + "T00:00:00")} · Dr. ${b.provider.firstName} ${b.provider.lastName}`}
        actions={
          <>
            <StatusBadge status={b.claim.status} />
            <ClaimActions claimId={id} canSubmit={canSubmit} canRescrub={["draft", "scrub_errors", "ready"].includes(b.claim.status)} />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {(errors.length > 0 || warnings.length > 0) && (
            <Card title={`Scrub results · ${errors.length} errors · ${warnings.length} warnings`}>
              <ul className="space-y-2 text-sm">
                {b.claim.scrubResults.map((f, i) => (
                  <li key={i} className={`rounded-lg border px-3 py-2 ${f.severity === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                    <span className="mr-2 font-mono text-[11px] font-semibold uppercase">{f.rule}</span>
                    {f.message}
                    {f.field && <span className="ml-2 text-xs opacity-70">({f.field})</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {claimDenials.length > 0 && (
            <Card title="Denial guidance">
              {claimDenials.map((d) => (
                <div key={d.id} className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge tone="red">CARC {d.carc}</Badge>
                    {d.rarc && <Badge tone="amber">RARC {d.rarc}</Badge>}
                    <Badge>{d.category.replace(/_/g, " ")}</Badge>
                    <span className="ml-auto text-xs text-slate-500">{d.status}{d.appealDeadline ? ` · appeal by ${fmtDate(d.appealDeadline + "T00:00:00")}` : ""}</span>
                  </div>
                  <p className="text-rose-950">{d.explanation}</p>
                  {d.nextSteps && d.nextSteps.length > 0 && (
                    <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-rose-900">
                      {d.nextSteps.map((st, i) => (
                        <li key={i}>{st}</li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {canCorrect && (
                  <ActionForm action={correctClaimAction.bind(null, id)}>
                    <SubmitButton className="btn btn-primary text-xs" pendingLabel="Creating...">
                      {b.claim.payerClaimNumber ? "Create replacement claim (freq. 7)" : "Correct and resubmit as a new claim"}
                    </SubmitButton>
                  </ActionForm>
                )}
                {canClose && (
                  <>
                    <form action={transferToPatientAction.bind(null, id)}>
                      <button className="btn btn-secondary text-xs">Transfer balance to patient</button>
                    </form>
                    <form action={writeOffClaimAction.bind(null, id)} className="flex gap-1">
                      <input name="reason" className="input text-xs" placeholder="Write-off reason" required />
                      <button className="btn btn-danger text-xs">Write off</button>
                    </form>
                  </>
                )}
              </div>
            </Card>
          )}

          {(primaryClaim || secondaryClaim || canBillSecondary) && (
            <Card title={b.claim.payerSequence === "S" ? "Secondary claim" : "Secondary insurance"}>
              <div className="space-y-2 text-sm">
                {primaryClaim && (
                  <p>
                    Bills the balance the primary payer left on{" "}
                    <Link className="font-mono text-brand-700 hover:underline" href={`/claims/${primaryClaim.id}`}>{primaryClaim.controlNumber}</Link>.
                    Its payments post to that claim, so the financials here are the primary claim&apos;s.
                  </p>
                )}
                {secondaryClaim && (
                  <p className="flex items-center gap-2">
                    Balance billed to secondary insurance on
                    <Link className="font-mono text-brand-700 hover:underline" href={`/claims/${secondaryClaim.id}`}>{secondaryClaim.controlNumber}</Link>
                    <StatusBadge status={secondaryClaim.status} />
                  </p>
                )}
                {canBillSecondary && (
                  <ActionForm action={billSecondaryAction.bind(null, id)} className="space-y-2">
                    <p className="text-slate-600">The patient has secondary insurance. Bill it for the patient responsibility the primary left, instead of the patient.</p>
                    <SubmitButton className="btn btn-primary text-xs" pendingLabel="Billing...">Bill secondary insurance</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}

          {(original || successors.length > 0 || b.claim.frequencyCode !== "1") && (
            <Card title={`${FREQ[b.claim.frequencyCode] ?? "Claim"} claim · frequency ${b.claim.frequencyCode}`}>
              <ul className="space-y-1 text-sm">
                {original && (
                  <li>
                    {b.claim.frequencyCode === "8" ? "Voids" : "Replaces"}{" "}
                    <Link className="font-mono text-brand-700 hover:underline" href={`/claims/${original.id}`}>{original.controlNumber}</Link>
                    {b.claim.originalPayerClaimNumber && <> · cites payer claim <span className="font-mono">{b.claim.originalPayerClaimNumber}</span> in REF*F8</>}
                  </li>
                )}
                {successors.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    {r.frequencyCode === "8" ? "Voided by" : "Replaced by"}
                    <Link className="font-mono text-brand-700 hover:underline" href={`/claims/${r.id}`}>{r.controlNumber}</Link>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {acks.length > 0 && (
            <Card title="Clearinghouse acknowledgments">
              <ul className="space-y-2 text-sm">
                {acks.map((a) => (
                  <li key={a.id} className={`rounded-lg border px-3 py-2 ${a.accepted ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                    <div className="flex items-center gap-2">
                      <Badge tone={a.accepted ? "green" : "red"}>{a.kind}</Badge>
                      <span className="font-mono text-xs">{a.code}</span>
                      <span className="ml-auto text-xs text-slate-500">{fmtDateTime(a.receivedAt)}</span>
                    </div>
                    <p className="mt-1 text-slate-800">{a.message}</p>
                    {a.raw && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-500">Raw X12</summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-3 font-mono text-[11px] text-green-200">{a.raw}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(canVoid || b.claim.status === "voided") && (
            <Card title={b.claim.status === "voided" ? "Voided" : "Void this claim"}>
              {b.claim.status === "voided" ? (
                <div className="space-y-2 text-sm text-slate-600">
                  <p>
                    The payer reversed this claim and its charge has been removed from A/R. If the service should still be billed, for example to
                    the right patient or payer after fixing the record, bill it again as a new claim.
                  </p>
                  <ActionForm action={billAgainAction.bind(null, id)}>
                    <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Creating...">Bill this encounter again</SubmitButton>
                  </ActionForm>
                </div>
              ) : (
                <ActionForm action={voidClaimAction.bind(null, id)} className="space-y-2 text-sm">
                  <p className="text-slate-600">
                    For a claim billed in error. This sends a frequency 8 claim citing payer claim{" "}
                    <span className="font-mono">{b.claim.payerClaimNumber}</span>, and the payer answers with a reversal that takes back anything it
                    paid. To fix a denied claim instead, create a corrected claim.
                  </p>
                  <div className="flex gap-2">
                    <input name="reason" className="input flex-1 text-xs" placeholder="Why is this claim being voided?" required />
                    <SubmitButton className="btn btn-danger text-xs" pendingLabel="Creating void...">Create void</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="Service lines">
            <table className="table">
              <thead><tr><th>#</th><th>CPT</th><th>Description</th><th>Mods</th><th>Units</th><th>Dx ptr</th><th className="text-right">Charge</th></tr></thead>
              <tbody>
                {b.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.lineNumber}</td>
                    <td className="font-mono">{l.cpt}</td>
                    <td className="text-slate-600">{l.description}</td>
                    <td className="font-mono text-xs">{l.modifiers.join(", ")}</td>
                    <td>{l.units}</td>
                    <td className="font-mono text-xs">{l.dxPointers.join(",")}</td>
                    <td className="text-right"><Money cents={l.chargeCents * l.units} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={6} className="text-right font-semibold">Total</td><td className="text-right font-semibold"><Money cents={b.claim.totalCents} /></td></tr>
              </tfoot>
            </table>
            <div className="mt-3 text-sm text-slate-600">
              <span className="font-semibold">Diagnoses:</span> {b.encounter.diagnoses.map((d, i) => `${i + 1}. ${d}`).join("   ")} · <span className="font-semibold">POS</span> {b.encounter.placeOfService}
            </div>
          </Card>

          <Card title="Ledger">
            <table className="table">
              <thead><tr><th>Date</th><th>Type</th><th>Code</th><th>Note</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.postedAt)}</td>
                    <td className="whitespace-nowrap">{e.type.replace(/_/g, " ")}</td>
                    <td className="font-mono text-xs">{e.groupCode ? `${e.groupCode}-${e.reasonCode}` : ""}</td>
                    <td className="text-slate-500">{e.note}</td>
                    <td className="text-right"><Money cents={e.amountCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {b.claim.edi837 && (
            <Card title="837P transaction (X12 005010X222A1)">
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-green-200">{b.claim.edi837}</pre>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Financials">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Charges</dt><dd><Money cents={fin.chargesCents} /></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Insurance paid</dt><dd className="text-green-700"><Money cents={fin.insurancePaidCents} /></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Adjustments &amp; write-offs</dt><dd><Money cents={fin.adjustmentsCents} /></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Patient resp.</dt><dd><Money cents={fin.patientRespCents} /></dd></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><dt>Insurance balance</dt><dd><Money cents={fin.insuranceBalanceCents} /></dd></div>
            </dl>
          </Card>
          <Card title="Subscriber">
            <div className="text-sm">
              <PatientLink id={b.patient.id} first={b.patient.firstName} last={b.patient.lastName} mrn={b.patient.mrn} />
              <div className="text-slate-500">DOB {fmtDate(b.patient.dob + "T00:00:00")} · {b.patient.sex}</div>
              <div className="mt-2">Member <span className="font-mono">{b.insurance.memberId}</span></div>
              {b.insurance.groupNumber && <div>Group <span className="font-mono">{b.insurance.groupNumber}</span></div>}
              <div className="text-slate-500">Payer ID {b.payer.payerId} · timely filing {b.payer.timelyFilingDays}d</div>
              {b.claim.payerClaimNumber && <div className="mt-2">Payer claim # <span className="font-mono">{b.claim.payerClaimNumber}</span></div>}
              {b.claim.authorizationNumber && <div>Prior auth <span className="font-mono">{b.claim.authorizationNumber}</span> (REF*G1)</div>}
            </div>
          </Card>
          <Card title="Timeline">
            <ol className="space-y-3 text-sm">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                  <div className="flex items-center gap-2"><StatusBadge status={e.status} /><span className="text-xs text-slate-400">{e.source}</span></div>
                  <div className="text-slate-700">{e.message}</div>
                  <div className="text-xs text-slate-400">{fmtDateTime(e.at)}</div>
                </li>
              ))}
            </ol>
          </Card>
          <Link href="/claims" className="btn btn-secondary w-full justify-center">Back to worklist</Link>
        </div>
      </div>
    </>
  );
}
