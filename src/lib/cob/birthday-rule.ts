/**
 * The birthday rule (NAIC coordination of benefits model): when a child is
 * covered as a dependent on both parents' plans, the plan of the parent whose
 * birthday (month and day, not year) comes first in the calendar year pays
 * first. Same birthday: the plan that has covered that parent longer, which
 * this cannot tell. A court decree, custody arrangements or a plan that does
 * not follow the NAIC rule can change the order, so this is a warning.
 */
export type CobPlan = { id: string; rank: number; relationship: string; subscriberDob: string | null; payerType: string; payerName: string };

export function birthdayRuleCheck(plans: CobPlan[]): { expectedPrimaryId: string; message: string } | null {
  const top = [...plans].sort((a, b) => a.rank - b.rank).slice(0, 2);
  if (top.length < 2) return null;
  if (!top.every((p) => p.relationship === "child" && p.subscriberDob && p.payerType === "commercial")) return null;
  const md = (d: string) => d.slice(5, 10);
  const [a, b] = top;
  if (md(a.subscriberDob!) === md(b.subscriberDob!)) return null;
  const first = md(a.subscriberDob!) < md(b.subscriberDob!) ? a : b;
  if (first.id === a.id) return null;
  return {
    expectedPrimaryId: first.id,
    message: `Birthday rule: the patient is a dependent on two plans, and the parent on ${first.payerName} has the earlier birthday in the year, so ${first.payerName} usually pays first, not ${a.payerName}. Check the order (a custody decree can change it) and swap the plans if needed.`,
  };
}
