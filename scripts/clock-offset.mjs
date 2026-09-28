#!/usr/bin/env node
/**
 * Minutes from now until the next time the clock in a time zone reads HH:MM,
 * for the time-of-day CI job (E2E_CLOCK_OFFSET_MIN; see playwright.config.ts).
 *
 *   node scripts/clock-offset.mjs 21:30 America/New_York   ->  e.g. 412
 */
const [hhmm, zone = "America/New_York"] = process.argv.slice(2);
const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
if (!m) {
  console.error("Usage: node scripts/clock-offset.mjs HH:MM [Time/Zone]");
  process.exit(2);
}
const target = Number(m[1]) * 60 + Number(m[2]);
const now = Date.now();
const clockMinutes = (t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};
// Step a minute at a time through the next day (a daylight-saving change makes the arithmetic shortcut wrong).
for (let i = 5; i <= 26 * 60; i++) {
  if (clockMinutes(now + i * 60_000) === target) {
    console.log(i);
    process.exit(0);
  }
}
console.error(`${hhmm} does not occur in ${zone} in the next day`);
process.exit(1);
