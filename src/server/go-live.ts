/**
 * The path from a new account to real claims, in order, with each step's
 * state read from the practice's own data: set up, connect and check the
 * services, send the first claims and see them acknowledged and paid. The last
 * phase is what only people can confirm (agreements, training).
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { setupHealth } from "./setup-health";
import { latestChecks } from "./doctor";
import { eraGaps } from "./transaction-enrollment";
import { practiceConfig } from "./integrations";

export type Step = { label: string; done: boolean; detail: string; href?: string };
export type Phase = { title: string; steps: Step[] };

export async function goLivePlan(db: Db, practiceId: string): Promise<Phase[]> {
  const [health, checks, gaps, cfg] = await Promise.all([setupHealth(db, practiceId), latestChecks(db, practiceId), eraGaps(db, practiceId), practiceConfig(db, practiceId)]);
  const h = (key: string) => health.find((c) => c.key === key);
  const fromHealth = (key: string): Step => {
    const c = h(key)!;
    return { label: c.label, done: c.state === "ok", detail: c.detail, href: c.href };
  };
  const failing = [...checks.entries()].filter(([, v]) => v.status === "fail");
  const stedi = checks.get("stedi.key");
  const { rows: [counts] } = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM claim_acknowledgments a JOIN claims c ON c.id = a.claim_id WHERE c.practice_id = ${practiceId}) AS acks,
      (SELECT count(*)::int FROM claim_acknowledgments a JOIN claims c ON c.id = a.claim_id WHERE c.practice_id = ${practiceId} AND a.accepted) AS accepted,
      (SELECT count(*)::int FROM inbound_transactions WHERE practice_id = ${practiceId} AND remittance_id IS NOT NULL) AS eras`);
  const n = counts as { acks: number; accepted: number; eras: number };
  const [practice] = await db.select({ selfServe: schema.practices.selfServe }).from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1);

  return [
    { title: "1. Set up the practice", steps: [fromHealth("profile"), fromHealth("roster"), fromHealth("mfa"), fromHealth("policies")] },
    {
      title: "2. Connect and check the services",
      steps: [
        fromHealth("clearinghouse"),
        { label: "Integration doctor run", done: checks.size > 0 && failing.length === 0, detail: checks.size === 0 ? "Not run yet" : failing.length ? `${failing.length} failing: ${failing.slice(0, 2).map(([k]) => k).join(", ")}` : "Nothing failing", href: "/settings/connections/doctor" },
        { label: "Clearinghouse key accepted", done: stedi?.status === "pass", detail: stedi ? stedi.detail : cfg.stedi ? "Run the integration doctor" : "Connect Stedi first", href: "/settings/connections/doctor" },
        fromHealth("automation"),
      ],
    },
    {
      title: "3. First claims",
      steps: [
        fromHealth("first_claim"),
        { label: "Acknowledgment received", done: Number(n.accepted) > 0, detail: Number(n.acks) ? `${n.acks} acknowledgments, ${n.accepted} accepted` : "None yet: 999 and 277CA responses appear on each claim", href: "/claims" },
        { label: "ERA enrollment for billed payers", done: gaps.length === 0 && fromHealth("first_claim").done, detail: gaps.length ? `Not approved yet: ${gaps.slice(0, 3).map((g) => g.payerName).join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""}` : "All billed payers covered", href: "/settings/enrollment" },
        { label: "First ERA posted automatically", done: Number(n.eras) > 0, detail: Number(n.eras) ? `${n.eras} posted` : "Arrives once a payer pays and ERA enrollment is approved", href: "/remittance" },
      ],
    },
    {
      title: "4. Before real patient data (confirm yourself)",
      steps: [
        { label: "Business associate agreement signed with CollaboratMD", done: false, detail: practice?.selfServe ? "Use test data until it is signed; ask us for it" : "Signed as part of your agreement with us" },
        { label: "Staff trained", done: false, detail: "Front desk on check-in and payments; billers on claims, denials and remittance" },
        { label: "Old system kept running for the first month", done: false, detail: "So nothing is missed while claims move over" },
      ],
    },
  ];
}
