import Link from "next/link";
import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Step = { text: ReactNode; href?: string; label?: string };
type Part = { title: string; steps: Step[] };
type Role = { key: string; name: string; who: string; parts: Part[] };

const L = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="font-semibold text-brand-700 underline">{children}</Link>;

/** The working day for each role, in the order the work usually happens. Each step names the screen it happens on. */
const ROLES: Role[] = [
  {
    key: "front_desk", name: "Front desk", who: "Scheduling, check-in, payments at the desk and patients' texts.",
    parts: [
      { title: "Start of the day", steps: [
        { text: <>Open <L href="/scheduling">Scheduling</L>. Confirm or decline any <b>online requests waiting</b> at the top; the patient is told either way.</> },
        { text: <>Press <b>Verify coverage for this day</b> so each patient&apos;s insurance is checked before they arrive. Anything inactive shows on the row.</> },
        { text: <>Appointments marked <b>Confirmed by text</b> were confirmed by the patient replying C to their reminder. A patient who replies X is cancelled automatically and you get a notification.</> },
      ] },
      { title: "Before and during visits", steps: [
        { text: <>Send an <b>online check-in</b> link from the schedule row (reminders the day before include one when automation is on). Review what patients sent in <L href="/check-ins">Online check-ins</L>.</> },
        { text: <>For visits with a patient cost, send the estimate and a deposit link from <L href="/scheduling/estimates">Pre-visit estimates</L>.</> },
        { text: <>When the patient arrives, press <b>Check in</b> on the schedule. Take the copay on the patient&apos;s page (<b>Post payment</b>), or on the card reader when one is connected.</> },
      ] },
      { title: "Through the day", steps: [
        { text: <>Answer patients in <L href="/messages">Text messages</L>. STOP, START, C and X are handled automatically.</> },
        { text: <>Add new patients from <L href="/patients/new">Patients &gt; New patient</L>, or a whole list with <L href="/import">Import</L>. Record a patient&apos;s language on their page so their statements and texts are in it.</> },
        { text: <>Press Ctrl+K (Cmd+K on a Mac) to find any patient, claim or page.</> },
      ] },
    ],
  },
  {
    key: "biller", name: "Biller", who: "Charges, claims, payments, denials and patient balances.",
    parts: [
      { title: "Start of the day", steps: [
        { text: <><L href="/dashboard">My work</L> lists what is waiting for you: claims to fix, denials assigned to you, appeals due.</> },
        { text: <>In <L href="/claims">Claims</L>, work <b>Needs work</b> and <b>Scrub errors</b>, then <b>Submit all ready claims</b>. Acknowledgments from the clearinghouse appear on each claim.</> },
      ] },
      { title: "Through the day", steps: [
        { text: <>Enter charges for checked-in visits from the schedule (<b>Enter charges</b>) or <L href="/encounters/new">Charge entry</L>; <L href="/coding">Coding help</L> helps pick the office visit level and find diagnosis codes.</> },
        { text: <>Payments from payers post from <L href="/remittance">Remittance (ERA)</L>; once ERA enrollment is approved they arrive and post on their own. Check that each one reached the bank in <L href="/remittance/deposits">Bank deposits</L>.</> },
        { text: <>Work <L href="/denials">Denials</L>. The <L href="/denials/agent">Denial agent</L> prepares each open denial overnight for your approval.</> },
      ] },
      { title: "Each week", steps: [
        { text: <><L href="/claims/follow-up">Claim follow-up</L>: claims accepted more than 30 days ago and still unpaid.</> },
        { text: <><L href="/underpayments">Underpayments</L> and <L href="/billing/missed-charges">Missed charges</L>: money the practice is owed but has not asked for.</> },
        { text: <><L href="/billing">Patient billing</L>: generate statements; accounts still unpaid after two statements appear in <L href="/billing/collections">Collections</L>.</> },
      ] },
    ],
  },
  {
    key: "admin", name: "Administrator", who: "The practice's settings, people, numbers and privacy.",
    parts: [
      { title: "Each day", steps: [
        { text: <>Read the notifications (the bell). They include payer problems, expiring credentials, restricted records opened and unusual chart access.</> },
        { text: <><L href="/settings/access-review">Chart access review</L> shows who opened how many charts and flags anything unusual. A flag is a prompt to ask, not a finding.</> },
      ] },
      { title: "Each week", steps: [
        { text: <><L href="/admin">Practice analytics</L>: collections, days in A/R, denial rate and clean claim rate against their targets.</> },
        { text: <><L href="/reports/payer-alerts">Payer alerts</L> and the <L href="/reports/forecast">Cash forecast</L>: payers slowing down or denying more, and what should arrive in the coming weeks.</> },
      ] },
      { title: "Each quarter, and when people change", steps: [
        { text: <><L href="/settings/team">Team and roles</L>: remove anyone who has left the same day; the quarterly access review reminder asks you to confirm everyone else.</> },
        { text: <>On a patient&apos;s page: <b>Access log</b> shows who opened their records; <b>Restrict</b> makes opening them ask for a reason (for staff members or well-known patients).</> },
        { text: <><L href="/settings/compliance">Compliance</L> lists what is in place and what is still to do; <L href="/settings/data-export">Data export</L> keeps a copy of everything the practice has here.</> },
      ] },
    ],
  },
];

/** The daily routine for each role, linked from the help button. The reader's own role comes first. */
export default async function GuidePage() {
  const s = await requireSession();
  const mine = s.role === "admin" ? "admin" : s.role === "front_desk" ? "front_desk" : "biller";
  const ordered = [...ROLES.filter((r) => r.key === mine), ...ROLES.filter((r) => r.key !== mine)];
  return (
    <>
      <PageHeader title="The working day" subtitle="What each role does, in the order it usually happens, with the screen for each step. The help button on every page explains that page." />
      <div className="space-y-6">
        {ordered.map((r, i) => (
          <Card key={r.key} title={`${r.name}${i === 0 ? " (your role)" : ""}`}>
            <p className="mb-4 text-sm text-slate-600">{r.who}</p>
            <div className="grid gap-6 lg:grid-cols-3">
              {r.parts.map((p) => (
                <section key={p.title}>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">{p.title}</h3>
                  <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">{p.steps.map((st, j) => <li key={j}>{st.text}</li>)}</ol>
                </section>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
