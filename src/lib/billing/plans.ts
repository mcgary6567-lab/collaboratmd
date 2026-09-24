/**
 * Payment plan schedules and payment allocation. Pure functions.
 */

export interface ScheduledInstallment {
  seq: number;
  dueDate: string; // YYYY-MM-DD
  amountCents: number;
}

/** Adds whole months, clamping to the last day when the month is shorter. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const targetMonth = m - 1 + months;
  const year = y + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(isoDate: string, days: number): string {
  const t = new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Splits a balance into equal installments. Leftover cents go on the first
 * installment, so every later payment is the same round amount and the plan
 * still sums exactly to the balance.
 */
export function buildSchedule(
  totalCents: number,
  count: number,
  startDate: string,
  frequency: "monthly" | "biweekly",
): ScheduledInstallment[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("Plan total must be a positive amount");
  if (!Number.isInteger(count) || count < 2 || count > 60) throw new Error("A plan needs between 2 and 60 installments");
  const base = Math.floor(totalCents / count);
  if (base < 1) throw new Error("Each installment must be at least one cent");
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    dueDate: frequency === "monthly" ? addMonths(startDate, i) : addDays(startDate, i * 14),
    amountCents: base + (i === 0 ? remainder : 0),
  }));
}

export interface InstallmentState {
  id: string;
  seq: number;
  amountCents: number;
  paidCents: number;
}

export interface Allocation {
  id: string;
  appliedCents: number;
  paidCents: number;
  status: "paid" | "partial";
}

/**
 * Applies a payment to installments oldest first. Returns the updates and any
 * amount left over, which the caller posts as ordinary account credit rather
 * than silently absorbing.
 */
export function allocatePayment(installments: InstallmentState[], paymentCents: number): { allocations: Allocation[]; leftoverCents: number } {
  let remaining = paymentCents;
  const allocations: Allocation[] = [];
  for (const inst of [...installments].sort((a, b) => a.seq - b.seq)) {
    if (remaining <= 0) break;
    const due = inst.amountCents - inst.paidCents;
    if (due <= 0) continue;
    const applied = Math.min(due, remaining);
    remaining -= applied;
    const paidCents = inst.paidCents + applied;
    allocations.push({ id: inst.id, appliedCents: applied, paidCents, status: paidCents >= inst.amountCents ? "paid" : "partial" });
  }
  return { allocations, leftoverCents: remaining };
}

/** Days after the due date before an unpaid installment counts as missed. */
export const GRACE_DAYS = 10;

/** A plan with this many missed installments is treated as defaulted. */
export const DEFAULT_AFTER_MISSED = 2;
