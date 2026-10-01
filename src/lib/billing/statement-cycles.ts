/**
 * Statement cycles: patients are split by last name into 2 or 4 groups, and
 * each group is billed in its own part of the month, so statements (and the
 * payments and phone calls they bring) are spread out instead of arriving at
 * once. With one cycle everyone is billed whenever the batch runs.
 */

/** Last-name ranges for each cycle, chosen to split typical US surnames roughly evenly. */
export const CYCLE_RANGES: Record<number, [string, string][]> = {
  1: [["A", "Z"]],
  2: [["A", "K"], ["L", "Z"]],
  4: [["A", "D"], ["E", "K"], ["L", "R"], ["S", "Z"]],
};

const validCycles = (cycles: number | undefined | null) => (cycles === 2 || cycles === 4 ? cycles : 1);

/** The cycle (0-based) a last name falls in. Names not starting with A-Z go in the last cycle. */
export function cycleOfName(lastName: string, cycles: number | undefined | null) {
  const n = validCycles(cycles);
  const letter = lastName.trim().charAt(0).toUpperCase();
  const i = CYCLE_RANGES[n].findIndex(([from, to]) => letter >= from && letter <= to);
  return i < 0 ? n - 1 : i;
}

/** The cycle billed on a day of the month: the month split into equal parts (days 29-31 belong to the last). */
export function cycleOfDay(dayOfMonth: number, cycles: number | undefined | null) {
  const n = validCycles(cycles);
  return Math.min(n - 1, Math.floor((dayOfMonth - 1) / Math.floor(28 / n)));
}

export function cycleLabel(cycle: number, cycles: number | undefined | null) {
  const [from, to] = CYCLE_RANGES[validCycles(cycles)][cycle];
  return `last names ${from}–${to}`;
}
