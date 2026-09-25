"use client";

/**
 * The landing page's product tour: one tab per stage of the revenue cycle,
 * each with what the product does there and a drawn preview of the screen.
 *
 * Previews are markup, not screenshots, and their figures are sample values
 * in the shape the product shows them. Anything that only works once the
 * practice connects its own outside account carries a tag saying which.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BadgeCheck, CalendarDays, Check, CreditCard, FileSearch, Gauge, MessageSquareText, Pause, Play, ScanLine, Wand2,
} from "lucide-react";

type Bullet = { text: string; needs?: string };
type Stage = { key: string; label: string; icon: typeof Check; title: string; lead: string; bullets: Bullet[]; preview: ReactNode };

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="ml-2 truncate text-xs font-medium text-slate-500">{title}</span>
      </div>
      <div className="space-y-3 p-5 text-sm">{children}</div>
    </div>
  );
}

const Pill = ({ tone, children }: { tone: "green" | "amber" | "red" | "slate" | "blue"; children: ReactNode }) => {
  const tones = { green: "bg-green-100 text-green-800", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800", slate: "bg-slate-100 text-slate-700", blue: "bg-blue-100 text-blue-800" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
};

const Row = ({ left, right }: { left: ReactNode; right: ReactNode }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
    <span className="min-w-0 truncate text-slate-700">{left}</span>
    <span className="shrink-0">{right}</span>
  </div>
);

const STAGES: Stage[] = [
  {
    key: "visit",
    label: "Before the visit",
    icon: CalendarDays,
    title: "Know the coverage before the patient sits down",
    lead: "Eligibility runs for tomorrow's whole schedule in one pass, and patients update their own details before they arrive.",
    bullets: [
      { text: "X12 270/271 eligibility, one patient or the full day's schedule", needs: "Clearinghouse" },
      { text: "Copay, deductible remaining and out-of-pocket maximum on screen" },
      { text: "Online check-in link: the patient confirms insurance and signs notices" },
      { text: "Appointment reminders by text or email, with the check-in link", needs: "Twilio / Resend" },
    ],
    preview: (
      <Frame title="Eligibility · tomorrow's schedule">
        <Row left={<><b>Ramirez, Ana</b> · Aetna PPO</>} right={<Pill tone="green">Active</Pill>} />
        <div className="grid grid-cols-3 gap-2 text-center">
          {[["Copay", "$30"], ["Deductible left", "$412"], ["OOP left", "$2,860"]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-2 py-2">
              <div className="text-[11px] text-slate-500">{k}</div>
              <div className="font-bold text-slate-900">{v}</div>
            </div>
          ))}
        </div>
        <Row left={<><b>Chen, Marcus</b> · Medicare Part B</>} right={<Pill tone="green">Active</Pill>} />
        <Row left={<><b>Okafor, Grace</b> · Cigna</>} right={<Pill tone="red">Inactive</Pill>} />
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-green-600 px-3 py-2 text-xs text-white">
          Reminder of your appointment tomorrow at 9:30 AM. Check in online: https://…/check-in/…
        </div>
      </Frame>
    ),
  },
  {
    key: "coding",
    label: "Coding",
    icon: Wand2,
    title: "The right visit level, without guessing",
    lead: "Coding help sits beside charge entry, built on the AMA's time and medical decision making rules.",
    bullets: [
      { text: "E/M level calculator for 99202-99215, with 99417 prolonged time" },
      { text: "Diagnosis finder that understands everyday words" },
      { text: "Fee-schedule pricing and modifiers on every line" },
      { text: "Code suggestions from a full visit note, off until the practice enables it", needs: "AI key + BAA" },
    ],
    preview: (
      <Frame title="Coding help">
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[["Patient", "Established"], ["Total time", "32 min"], ["MDM", "Moderate"]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
              <div className="font-semibold text-slate-800">{v}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <div className="text-2xl font-extrabold text-slate-900">99214</div>
          <div className="text-xs text-slate-600">By time: 99214 · By MDM: 99214 · the higher of the two</div>
        </div>
        <div className="rounded-lg border border-slate-200 px-3 py-2 text-slate-500">high blood pressure</div>
        <Row left={<><span className="font-mono font-semibold text-slate-900">I10</span> Essential (primary) hypertension</>} right={<Pill tone="slate">Copy</Pill>} />
      </Frame>
    ),
  },
  {
    key: "claims",
    label: "Clean claims",
    icon: ScanLine,
    title: "Stop the denial before the claim leaves",
    lead: "Every claim is scrubbed and scored for denial risk from your own history with that payer, with the reason for every point.",
    bullets: [
      { text: "Built-in scrubber rules plus payer-specific edits you configure" },
      { text: "Denial risk score with plain-English reasons, on every unsent claim" },
      { text: "Warns when a provider is not enrolled with the payer on the date of service" },
      { text: "Secondary claims bill automatically with the primary's adjudication (loop 2320)" },
    ],
    preview: (
      <Frame title="Claim CMD00090223 · ready to submit">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-900">Denial risk before you submit</span>
          <Pill tone="amber">medium risk · 44</Pill>
        </div>
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-slate-700">
          <li>This payer denied 6 of 48 claims with diagnosis E03.9 in the last 12 months, mostly for authorization.</li>
          <li>This payer has denied these codes for authorization, and the claim has no authorization number.</li>
          <li>Coverage was not verified as active within 30 days of the visit.</li>
        </ul>
        <Row left="Scrubber" right={<Pill tone="green">0 errors · 0 warnings</Pill>} />
        <Row left="Provider enrollment" right={<Pill tone="green">Approved</Pill>} />
      </Frame>
    ),
  },
  {
    key: "denials",
    label: "Denials",
    icon: FileSearch,
    title: "Every denial explained, and an appeal ready to send",
    lead: "Payer shorthand becomes what happened and what to do next, and quiet claims are chased automatically.",
    bullets: [
      { text: "CARC and RARC translated into plain English, with next steps" },
      { text: "Appeal letter drafted in one click, filled with the claim's details" },
      { text: "AI-written appeals see only codes, never patient details", needs: "AI key" },
      { text: "X12 276/277 status inquiries for claims with no answer" },
    ],
    preview: (
      <Frame title="Appeal · CARC 16 / M51">
        <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          <b className="text-slate-900">What happened:</b> the claim is missing information the payer needs. Remark M51: missing or invalid procedure code.
        </div>
        <div className="rounded-lg border border-slate-200 p-3 font-serif text-xs leading-relaxed text-slate-700">
          Re: Request for reconsideration, claim CMD00043872<br />
          We are writing to request reconsideration of the above claim, denied as missing a valid procedure code. The corrected procedure detail is enclosed…
        </div>
        <div className="flex gap-2">
          <Pill tone="blue">Template draft</Pill>
          <Pill tone="green">Appeal by Oct 24</Pill>
        </div>
      </Frame>
    ),
  },
  {
    key: "paid",
    label: "Getting paid",
    icon: BadgeCheck,
    title: "From ERA to bank deposit, reconciled",
    lead: "835 remittances post themselves, and each deposit on your bank statement is tied back to the payment it came from.",
    bullets: [
      { text: "835 auto-posting: payments, adjustments and patient responsibility by line" },
      { text: "Bank deposits matched to ERAs by trace number or amount" },
      { text: "ERAs with no deposit after 7 days flagged for a payer trace" },
      { text: "Underpayments caught against your contracted rates" },
    ],
    preview: (
      <Frame title="Bank deposits">
        <Row left={<>HCCLAIMPMT MEDICARE TRN*1*EFT150…</>} right={<Pill tone="green">matched · trace</Pill>} />
        <Row left={<>DEPOSIT REF 701441 · $89,017.20</>} right={<Pill tone="green">matched · amount</Pill>} />
        <Row left={<>HCCLAIMPMT CIGNA TRN*1*EFT232…</>} right={<Pill tone="green">matched · trace</Pill>} />
        <Row left={<>MERCHANT CARD SETTLEMENT</>} right={<Pill tone="amber">to review</Pill>} />
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">1 ERA paid 9 days ago has not reached the bank.</div>
      </Frame>
    ),
  },
  {
    key: "patients",
    label: "Patient payments",
    icon: CreditCard,
    title: "Balances patients understand, and can pay from their phone",
    lead: "A secure portal link, plain statements and payment plans, then a respectful path to collections when nothing else works.",
    bullets: [
      { text: "Patient portal: see what the balance is for and pay by card", needs: "Stripe" },
      { text: "Payment plans, with autopay on a card the patient saves", needs: "Stripe" },
      { text: "Statements, discounts and No Surprises Act good faith estimates" },
      { text: "Final notice, agency placement and recovery, posted to the ledger" },
    ],
    preview: (
      <Frame title="Patient portal">
        <div className="text-center">
          <div className="text-xs text-slate-500">Your balance</div>
          <div className="text-3xl font-extrabold text-slate-900">$186.40</div>
          <div className="text-xs text-slate-500">Visit on Aug 12, 2026 · Dr. Patel</div>
        </div>
        <div className="rounded-lg bg-green-600 py-2 text-center text-sm font-semibold text-white">Pay securely by card</div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-600">Payment plan: next installment $62.13 due Oct 1 · paid automatically from Visa ending 4242</div>
        <div className="flex items-center justify-between gap-1 pt-1 text-[11px] font-semibold">
          {["Statement", "Reminder", "Final notice", "Agency"].map((s, i) => (
            <span key={s} className={`flex-1 rounded-full py-1 text-center ${i < 2 ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"}`}>{s}</span>
          ))}
        </div>
      </Frame>
    ),
  },
  {
    key: "run",
    label: "Run the business",
    icon: Gauge,
    title: "The numbers, the work, and the Monday report",
    lead: "Metrics against industry targets, a task inbox for the team, and automation that runs every morning.",
    bullets: [
      { text: "Days in A/R, net collection, clean claim and denial rates vs benchmarks" },
      { text: "Tasks, notes, saved views and bulk actions for the billing team" },
      { text: "Daily automation and a weekly report by email", needs: "Resend" },
      { text: "Many practices under one login for billing companies" },
    ],
    preview: (
      <Frame title="Practice analytics">
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Days in A/R", "36", "target < 40", "green"],
            ["Net collection", "96.1%", "target ≥ 95%", "green"],
            ["Clean claim rate", "93.4%", "target ≥ 95%", "amber"],
            ["Denial rate", "4.3%", "target < 5%", "green"],
          ].map(([k, v, t, tone]) => (
            <div key={k} className="rounded-lg border border-slate-200 p-2.5">
              <div className="text-[11px] text-slate-500">{k}</div>
              <div className={`text-lg font-extrabold ${tone === "green" ? "text-green-700" : "text-amber-700"}`}>{v}</div>
              <div className="text-[10px] text-slate-400">{t}</div>
            </div>
          ))}
        </div>
        <Row left={<><MessageSquareText className="mr-1 inline h-3.5 w-3.5" />Weekly report sent to the practice owner</>} right={<Pill tone="slate">Mondays</Pill>} />
      </Frame>
    ),
  },
];

const AUTOPLAY_MS = 7000;

export function FeatureTour() {
  const [active, setActive] = useState(0);
  // The tour plays itself until the visitor takes over, and never for people who asked for reduced motion.
  const [playing, setPlaying] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = STAGES[active];

  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setActive((a) => (a + 1) % STAGES.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [playing]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    setPlaying(false);
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (active + delta + STAGES.length) % STAGES.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Product tour" onKeyDown={onKey} className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          const on = i === active;
          return (
            <button
              key={s.key}
              ref={(el) => { tabs.current[i] = el; }}
              role="tab"
              id={`tour-tab-${s.key}`}
              aria-selected={on}
              aria-controls={`tour-panel-${s.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => { setActive(i); setPlaying(false); }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                on ? "border-green-600 bg-green-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-green-300 hover:text-green-700"
              }`}
            >
              <Icon className="h-4 w-4" /> {s.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => setPlaying((p) => !p)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-green-700" aria-label={playing ? "Pause the tour" : "Play the tour"}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {playing ? "Pause tour" : "Play tour"}
        </button>
        <div className="flex gap-1" aria-hidden>
          {STAGES.map((s, i) => <span key={s.key} className={`h-1 rounded-full transition-all ${i === active ? "w-6 bg-green-600" : "w-2 bg-slate-200"}`} />)}
        </div>
      </div>

      <div
        onPointerEnter={() => setPlaying(false)}
        role="tabpanel"
        id={`tour-panel-${stage.key}`}
        aria-labelledby={`tour-tab-${stage.key}`}
        className="mt-8 grid gap-10 lg:grid-cols-2 lg:items-center"
      >
        <div>
          <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{stage.title}</h3>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">{stage.lead}</p>
          <ul className="mt-6 space-y-3">
            {stage.bullets.map((b) => (
              <li key={b.text} className="flex items-start gap-3 text-slate-700">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span>
                  {b.text}
                  {b.needs && <span className="ml-2 whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">needs {b.needs}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <div aria-hidden className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-green-500/10 via-transparent to-slate-900/5 blur-xl" />
          <div className="relative">{stage.preview}</div>
          <p className="relative mt-3 text-center text-xs text-slate-400">Illustration of the screen with sample figures</p>
        </div>
      </div>
    </div>
  );
}
