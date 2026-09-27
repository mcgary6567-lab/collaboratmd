/**
 * Online booking requests made before 2026-09-27 12:28 UTC stored the moment
 * of the visit instead of the practice's clock time, so the visit shows on
 * the schedule off by the practice's UTC offset (a 9:00 Eastern booking at
 * 1:00 PM). This lists them, per practice, without patient details.
 *
 * Read-only by default. With --fix it rewrites each one to the clock time in
 * the practice's time zone: the request, and its appointment if the
 * appointment still has the time it was booked with (one staff moved since is
 * left alone and listed). Check the listing first.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/booking-time-check.ts [--fix]
 */
import fs from "node:fs";
import pg from "pg";
import { practiceClock } from "@/server/booking";

const FIXED_AT = new Date("2026-09-27T12:28:13Z");

function databaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const m = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").match(/DATABASE_URL\s*=\s*(.*)/) : null;
  if (!m) throw new Error("Set DATABASE_URL");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

type Row = { id: string; practice_id: string; practice: string; status: string; starts_at: Date; ends_at: Date; appointment_id: string | null; appt_starts: Date | null; appt_ends: Date | null; time_zone: string | null };

async function main() {
  const fix = process.argv.includes("--fix");
  const c = new pg.Client({ connectionString: databaseUrl() });
  await c.connect();
  const { rows } = await c.query<Row>(`
    SELECT r.id, r.practice_id, p.name AS practice, r.status, r.starts_at, r.ends_at, r.appointment_id,
           a.starts_at AS appt_starts, a.ends_at AS appt_ends, p.time_zone
    FROM booking_requests r
    JOIN practices p ON p.id = r.practice_id
    LEFT JOIN appointments a ON a.id = r.appointment_id
    WHERE r.created_at < $1 AND r.status IN ('pending', 'confirmed')
    ORDER BY p.name, r.starts_at`, [FIXED_AT]);
  if (!rows.length) {
    console.log("No online booking requests from before the fix. Nothing to correct.");
    await c.end();
    return;
  }
  const moved: string[] = [];
  let changed = 0;
  for (const r of rows) {
    const tz = r.time_zone ?? "America/New_York";
    const start = practiceClock(r.starts_at, tz);
    const end = practiceClock(r.ends_at, tz);
    const apptUntouched = r.appt_starts?.getTime() === r.starts_at.getTime();
    console.log(`${r.practice} · request ${r.id.slice(0, 8)} (${r.status}) · stored ${r.starts_at.toISOString()} · clock time ${start.toISOString().slice(0, 16).replace("T", " ")}${r.appointment_id ? (apptUntouched ? " · appointment unchanged since booking" : " · appointment moved since booking: left alone") : ""}`);
    if (r.appointment_id && !apptUntouched) moved.push(r.appointment_id);
    if (!fix) continue;
    await c.query("BEGIN");
    await c.query("UPDATE booking_requests SET starts_at = $2, ends_at = $3 WHERE id = $1", [r.id, start, end]);
    if (r.appointment_id && apptUntouched) await c.query("UPDATE appointments SET starts_at = $2, ends_at = $3 WHERE id = $1", [r.appointment_id, start, end]);
    await c.query("COMMIT");
    changed++;
  }
  console.log(fix ? `Corrected ${changed} request(s).` : `${rows.length} request(s) to correct. Run again with --fix to correct them.`);
  if (moved.length) console.log(`${moved.length} appointment(s) were moved by staff after booking; check them by hand.`);
  await c.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
