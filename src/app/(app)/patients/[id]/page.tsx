import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireSession } from "@/lib/auth";
import { logPatientView } from "@/lib/log-view";
import { restrictedAccess } from "@/server/restricted";
import { RestrictedGate } from "@/components/restricted-gate";
import { setRestrictedAction } from "@/app/(app)/restricted-actions";
import { addToWaitlistAction, removeFromWaitlistAction } from "@/app/(app)/waitlist-actions";
import { windowLabel } from "@/server/waitlist";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { listProviders } from "@/server/encounters";
import { practiceConfig } from "@/server/integrations";
import { InsuranceTools } from "./insurance-tools";
import { CoverageSection } from "./coverage-section";
import { MspCard } from "./msp-card";
import { latestMspScreening } from "@/server/msp";
import { AbnCard } from "./abn-card";
import { CareCard } from "./care-card";
import { SlidingFeeCard } from "./sliding-fee-card";
import { AccountCard } from "./account-card";
import { StatusCard } from "./status-card";
import { CardOnFileCard } from "./card-on-file-card";
import { cardOnFileFor } from "@/server/card-on-file";
import { slidingFeeOf } from "@/server/sliding-fee";
import { benefitsToDate } from "@/server/accumulators";
import { therapyToDate, thresholdFor } from "@/server/therapy-threshold";
import { careMonths } from "@/server/care-programs";
import { listAbns } from "@/server/abn";
import { getPatient, managedCareOf, medicareAdvantageOf } from "@/server/patients";
import { computeFinancials } from "@/server/claims";
import { eligibilityAction, patientPaymentAction } from "@/app/(app)/actions";
import { Card, PageHeader, Badge, Money, Empty, Field } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/utils";
import { BillingSection } from "./billing-section";
import { TerminalSection } from "./terminal-section";
import { AuthorizationsSection } from "./authorizations-section";
import { LabsSection } from "./labs-section";
import { WorkPanel } from "@/components/work-panel";
import { PortalLinkButton } from "./patient-contact";
import { preferredLanguageAction, remindersOptOutAction, smsConsentAction } from "@/app/(app)/portal-actions";

export const metadata: Metadata = { title: "Patient" };

export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const data = await getPatient(db, s.practiceId, id);
  if (!data) notFound();
  // A duplicate merged into another record opens the one kept.
  if (data.patient.mergedInto) redirect(`/patients/${data.patient.mergedInto}`);
  const gate = await restrictedAccess(db, s, id);
  if (!gate.granted) return <RestrictedGate patientId={id} back={`/patients/${id}`} what="chart" />;
  await logPatientView(s, id, "chart");
  const { patient, insurances, checks, visits, ledger } = data;
  const fin = computeFinancials(ledger);
  const latestCheck = checks[0];
  const toDate = latestCheck?.status === "active" ? await benefitsToDate(db, latestCheck.patientInsuranceId) : null;
  const [payerList, cfg, [waiting], providerList] = await Promise.all([
    db.select({ id: schema.payers.id, name: schema.payers.name, type: schema.payers.type }).from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
    practiceConfig(db, s.practiceId),
    db.select().from(schema.waitlistEntries).where(and(eq(schema.waitlistEntries.practiceId, s.practiceId), eq(schema.waitlistEntries.patientId, id), isNull(schema.waitlistEntries.closedAt))).limit(1),
    listProviders(db, s.practiceId),
  ]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const insured = insurances.some(({ insurance, payer }) => insurance.active && payer.type !== "self_pay");
  const onMedicare = insurances.some(({ insurance, payer }) => insurance.active && payer.type === "medicare");
  const mspLast = onMedicare ? await latestMspScreening(db, patient.id) : null;
  const abnList = onMedicare ? await listAbns(db, s.practiceId, patient.id) : [];
  const care = await careMonths(db, s.practiceId, patient.id);
  const cardOnFile = await cardOnFileFor(db, patient.id);
  const [slidingFee, slidingTiers] = await Promise.all([slidingFeeOf(db, patient.id), db.select({ id: schema.slidingFeeTiers.id }).from(schema.slidingFeeTiers).where(eq(schema.slidingFeeTiers.practiceId, s.practiceId)).limit(1)]);
  const [injury] = await db.select().from(schema.injuryCases).where(and(eq(schema.injuryCases.patientId, patient.id), eq(schema.injuryCases.status, "open"))).limit(1);
  const thisYear = new Date().getUTCFullYear();
  const threshold = onMedicare ? await thresholdFor(db, thisYear) : null;
  const therapyYear = threshold ? { threshold, used: await therapyToDate(db, patient.id, thisYear) } : null;

  return (
    <>
      {injury && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Balance held for a personal injury case: {injury.attorney}{injury.firm ? `, ${injury.firm}` : ""}, lien signed {fmtDate(`${injury.lienSignedOn}T00:00:00`)}. No statements, reminders, card charges or collections until it settles. <Link href="/injury-cases" className="font-semibold underline">Personal injury cases</Link>
        </div>
      )}
      {therapyYear && (therapyYear.used.pt_slp > 0 || therapyYear.used.ot > 0) && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
          Medicare therapy in {thisYear} (estimate): physical therapy and speech <Money cents={therapyYear.used.pt_slp} />, occupational therapy <Money cents={therapyYear.used.ot} />, against the <Money cents={therapyYear.threshold.kxCents} /> KX threshold for each.
        </div>
      )}
      <PageHeader
        title={`${patient.lastName}, ${patient.firstName}`}
        subtitle={`MRN ${patient.mrn} · DOB ${fmtDate(patient.dob + "T00:00:00")} · ${patient.sex}${patient.restricted ? " · Restricted record" : ""}`}
        actions={
          <>
            {s.role === "admin" && <Link href={`/patients/${patient.id}/access`} className="btn btn-secondary">Access log</Link>}
            <Link href={`/print/receipt/${patient.id}?year=${new Date().getUTCFullYear() - 1}`} className="btn btn-secondary">Payment receipt</Link>
            <Link href={`/print/disclosures/${patient.id}`} className="btn btn-secondary">Accounting of disclosures</Link>
            <Link href={`/encounters/new?patientId=${patient.id}`} className="btn btn-primary">
              New charge
            </Link>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Demographics">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd>{patient.phone ?? "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd>{patient.email ?? "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Address</dt><dd className="text-right">{patient.address1}<br />{patient.city}, {patient.state} {patient.zip}</dd></div>
          </dl>
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs">
            <div className="flex items-center justify-between">
              <span>Texts: {patient.smsConsentAt ? <span className="text-green-700">consented {fmtDate(patient.smsConsentAt)}</span> : <span className="text-slate-500">no consent on file</span>}</span>
              <form action={smsConsentAction.bind(null, patient.id, !patient.smsConsentAt)}>
                <button className="font-semibold text-brand-700 hover:underline">{patient.smsConsentAt ? "Withdraw" : "Record consent"}</button>
              </form>
            </div>
            <div className="flex items-center justify-between">
              <span>Reminders: {patient.remindersOptOut ? <span className="text-amber-700">opted out</span> : "on"}</span>
              <form action={remindersOptOutAction.bind(null, patient.id, !patient.remindersOptOut)}>
                <button className="font-semibold text-brand-700 hover:underline">{patient.remindersOptOut ? "Turn back on" : "Opt out"}</button>
              </form>
            </div>
            <div className="flex items-center justify-between">
              <span>Language: {patient.preferredLanguage === "es" ? "Spanish" : "English"} <span className="text-slate-500">(statements and messages)</span></span>
              <form action={preferredLanguageAction.bind(null, patient.id, patient.preferredLanguage === "es" ? "en" : "es")}>
                <button className="font-semibold text-brand-700 hover:underline">{patient.preferredLanguage === "es" ? "Use English" : "Use Spanish"}</button>
              </form>
            </div>
            {s.role === "admin" && (
              <div className="flex items-center justify-between">
                <span>Access: {patient.restricted ? <span className="font-semibold text-amber-700">restricted</span> : "normal"} <span className="text-slate-500">(opening asks for a reason)</span></span>
                <form action={setRestrictedAction.bind(null, patient.id, !patient.restricted)}>
                  <button className="font-semibold text-brand-700 hover:underline">{patient.restricted ? "Remove restriction" : "Restrict"}</button>
                </form>
              </div>
            )}
            {canWrite && (waiting ? (
              <div className="flex items-center justify-between">
                <span>Waitlist: since {fmtDate(waiting.createdAt)} <span className="text-slate-500">({waiting.providerId ? `Dr. ${providerList.find((p) => p.id === waiting.providerId)?.lastName ?? ""} only` : "any provider"}, {windowLabel(waiting.fromHour, waiting.untilHour)})</span></span>
                <form action={removeFromWaitlistAction.bind(null, waiting.id, patient.id)}>
                  <button className="font-semibold text-brand-700 hover:underline" aria-label="Remove from the waitlist">Remove</button>
                </form>
              </div>
            ) : (
              <details>
                <summary className="cursor-pointer font-semibold text-brand-700">Add to the waitlist</summary>
                <ActionForm action={addToWaitlistAction.bind(null, patient.id)} className="mt-2 space-y-2">
                  <label className="block"><span className="label">Provider</span>
                    <select name="providerId" className="select" defaultValue="">
                      <option value="">Any provider</option>
                      {providerList.map((p) => <option key={p.id} value={p.id}>Dr. {p.firstName} {p.lastName}</option>)}
                    </select>
                  </label>
                  <label className="block"><span className="label">Hours they can come</span>
                    <select name="hours" className="select" defaultValue="any">
                      <option value="any">Any time</option>
                      <option value="morning">Mornings (before noon)</option>
                      <option value="afternoon">Afternoons (from noon)</option>
                    </select>
                  </label>
                  <label className="block"><span className="label">Note</span><input name="note" className="input" maxLength={300} placeholder="Knee follow-up; can come at short notice" /></label>
                  <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Adding...">Add</SubmitButton>
                  {!patient.smsConsentAt && <p className="text-amber-800">No texting consent: openings cannot be texted to this patient; the waitlist will say to call.</p>}
                </ActionForm>
              </details>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <PortalLinkButton patientId={patient.id} purpose="portal" label="Send portal link" />
              <PortalLinkButton patientId={patient.id} purpose="pay" label="Send pay link" />
            </div>
          </div>
        </Card>
        <Card title="Insurance">
          {insurances.map(({ insurance, payer }) => (
            <div key={insurance.id} className="mb-3 rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{payer.name}</div>
                <Badge tone="blue">{insurance.rank === 1 ? "Primary" : insurance.rank === 2 ? "Secondary" : "Tertiary"}</Badge>
              </div>
              <div className="mt-1 text-slate-500">Member {insurance.memberId}{insurance.groupNumber ? ` · Group ${insurance.groupNumber}` : ""} · {insurance.relationship === "self" ? "self" : `${insurance.relationship} of ${insurance.subscriberFirstName ?? ""} ${insurance.subscriberLastName ?? "(insured person not entered)"}`.trim()}</div>
              <div className="text-slate-500">Copay {money(insurance.copayCents)}</div>
              <form action={eligibilityAction.bind(null, insurance.id, patient.id)} className="mt-2">
                <button className="btn btn-secondary text-xs">Check eligibility (270/271)</button>
              </form>
            </div>
          ))}
          {latestCheck && (
            <div className={`rounded-lg p-3 text-sm ${latestCheck.status === "active" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
              <div className="font-semibold">Coverage {latestCheck.status} · {fmtDateTime(latestCheck.checkedAt, s.timeZone)}</div>
              {managedCareOf(latestCheck.response) && (
                <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
                  Medicaid says this patient is in a managed care plan ({managedCareOf(latestCheck.response)!.plan}). Bill that plan, not state Medicaid: add it as the patient&apos;s insurance.
                </p>
              )}
              {medicareAdvantageOf(latestCheck.response) && (
                <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
                  Medicare says this patient is in a Medicare Advantage plan ({medicareAdvantageOf(latestCheck.response)!.plan}). Bill that plan, not Medicare: add it as the patient&apos;s insurance.
                </p>
              )}
              {latestCheck.status === "active" ? (
                <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs">
                  <span>Plan: {latestCheck.planName}</span>
                  <span>Copay: {money(latestCheck.copayCents)}</span>
                  <span>Deductible: {money(latestCheck.deductibleCents)}</span>
                  <span>Remaining: {money(latestCheck.deductibleRemainingCents)}</span>
                  <span>OOP max: {money(latestCheck.oopMaxCents)}</span>
                  {latestCheck.oopRemainingCents !== null && <span>OOP remaining: {money(latestCheck.oopRemainingCents)}</span>}
                  {latestCheck.coinsurancePct !== null && <span>Coinsurance: {latestCheck.coinsurancePct}%</span>}
                  {latestCheck.serviceDate && <span>For DOS: {fmtDate(latestCheck.serviceDate + "T00:00:00")}</span>}
                  {toDate && (toDate.newPlanYear || toDate.appliedOopCents > 0) && (
                    <span className="col-span-2 mt-1 font-semibold">
                      Left today (estimate): deductible {toDate.deductibleRemainingCents === null ? "unknown" : money(toDate.deductibleRemainingCents)}
                      {toDate.oopRemainingCents !== null && <>, out-of-pocket {money(toDate.oopRemainingCents)}</>}
                      <span className="block font-normal">{toDate.newPlanYear ? "A new plan year: the yearly amounts less what payers applied since January 1." : `Less ${money(toDate.appliedDeductibleCents)} to the deductible and ${money(toDate.appliedOopCents)} patient share on claims processed since the check.`}</span>
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-xs">{latestCheck.message ?? String((latestCheck.response as { message?: string })?.message ?? "")}</div>
              )}
              {latestCheck.request270 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer opacity-70">270 sent and 271 received (trace {latestCheck.traceNumber})</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900 p-2 font-mono text-[10px] text-green-200">{latestCheck.request270}</pre>
                  {latestCheck.response271 && (
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 font-mono text-[10px] text-green-200">{latestCheck.response271}</pre>
                  )}
                </details>
              )}
            </div>
          )}
          {!insured && <CoverageSection practiceId={s.practiceId} patientId={patient.id} canWrite={canWrite} simulated={!cfg.stedi} />}
          {onMedicare && <MspCard patientId={patient.id} last={mspLast} canWrite={canWrite} timeZone={s.timeZone} />}
          {onMedicare && <AbnCard patientId={patient.id} notices={abnList} canWrite={canWrite} />}
          {cardOnFile && <CardOnFileCard patientId={patient.id} data={cardOnFile} canWrite={canWrite} />}
          {(slidingFee || slidingTiers.length > 0) && <SlidingFeeCard patientId={patient.id} fee={slidingFee} canWrite={canWrite} />}
          <AccountCard db={db} practiceId={s.practiceId} patient={patient} insurances={insurances} canWrite={canWrite} canAdjust={(CAN_ADJUST as readonly string[]).includes(s.role)} />
          <StatusCard db={db} patient={patient} canWrite={canWrite} />
          <CareCard patientId={patient.id} data={care} providers={providerList.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}${p.credential ? `, ${p.credential}` : ""}` }))} canWrite={canWrite} />
          {canWrite && <InsuranceTools patientId={patient.id} payers={payerList.filter((p) => p.type !== "self_pay").map(({ id, name }) => ({ id, name }))} cardReading={!!cfg.anthropic?.phiAllowed} />}
        </Card>
        <Card title="Account balance">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Total charges</dt><dd><Money cents={fin.chargesCents} /></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Insurance paid</dt><dd><Money cents={fin.insurancePaidCents} /></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Adjustments</dt><dd><Money cents={fin.adjustmentsCents} /></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Patient paid</dt><dd><Money cents={fin.patientPaidCents} /></dd></div>
            {fin.discountsCents > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discounts</dt><dd><Money cents={fin.discountsCents} /></dd></div>}
            <div className="flex justify-between border-t pt-1 font-semibold"><dt>Insurance balance</dt><dd><Money cents={fin.insuranceBalanceCents} /></dd></div>
            <div className="flex justify-between font-semibold"><dt>Patient balance</dt><dd className={fin.patientBalanceCents > 0 ? "text-red-700" : ""}><Money cents={fin.patientBalanceCents} /></dd></div>
          </dl>
          <form action={patientPaymentAction.bind(null, patient.id)} className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Post payment ($)"><input name="amount" type="number" step="0.01" min="0.01" className="input w-28" placeholder="25.00" required /></Field>
            <Field label="Method">
              <select name="method" className="select">
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
              </select>
            </Field>
            <button className="btn btn-primary">Post</button>
          </form>
        </Card>
      </div>

      <TerminalSection timeZone={s.timeZone} db={db} practiceId={s.practiceId} patientId={patient.id} canWrite={canWrite} admin={s.role === "admin"} />
      <BillingSection db={db} practiceId={s.practiceId} patientId={patient.id} />
      <AuthorizationsSection db={db} practiceId={s.practiceId} patientId={patient.id} />
      <LabsSection db={db} practiceId={s.practiceId} patientId={patient.id} />
      <div className="mt-6 max-w-2xl">
        <WorkPanel timeZone={s.timeZone} db={db} practiceId={s.practiceId} entityType="patient" entityId={patient.id} defaultTitle={`Follow up with ${patient.firstName} ${patient.lastName}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Visits">
          {visits.length === 0 ? (
            <Empty>No encounters yet.</Empty>
          ) : (
            <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
              <thead><tr><th>DOS</th><th>POS</th><th>Diagnoses</th><th>Status</th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>{fmtDate(v.dateOfService + "T00:00:00")}</td>
                    <td>{v.placeOfService}</td>
                    <td className="font-mono text-xs">{v.diagnoses.join(", ")}</td>
                    <td><Badge tone={v.status === "billed" ? "green" : "amber"}>{v.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card title="Ledger (most recent)">
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Note</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDate(e.postedAt)}</td>
                  <td className="whitespace-nowrap">{e.type.replace(/_/g, " ")}</td>
                  <td className="text-slate-500">{e.note}{e.reasonCode ? ` (${e.groupCode}-${e.reasonCode})` : ""}</td>
                  <td className="text-right"><Money cents={e.amountCents} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      </div>
    </>
  );
}
