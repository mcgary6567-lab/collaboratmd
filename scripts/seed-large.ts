/**
 * Bulk data loader for a full-size US practice.
 *
 *   npm run seed:large                 # uses DATABASE_URL from .env.local
 *   TARGET_CHARGES_USD=60000000 npm run seed:large
 *
 * This runs standalone rather than at app boot: loading ~2M rows inside a
 * request would exceed any serverless timeout. It writes with multi-row
 * INSERT batches and reports progress.
 *
 * It TRUNCATES the application tables first. Never point it at real data.
 */
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import {
  FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES, US_CITIES, STREETS,
  SPECIALTIES, US_PAYERS, CPTS, ICDS, DENIAL_MIX,
} from "../src/db/us-data";
import { CARC, RARC } from "../src/lib/codes/carc";

/* ---------------------------------------------------------------- config */

const TARGET_CHARGES_CENTS = Math.round(Number(process.env.TARGET_CHARGES_USD ?? 60_000_000) * 100);
const PROVIDER_COUNT = Number(process.env.PROVIDER_COUNT ?? 100);
const PATIENT_COUNT = Number(process.env.PATIENT_COUNT ?? 15_000);
const MONTHS_OF_HISTORY = Number(process.env.MONTHS_OF_HISTORY ?? 24);
const BATCH = 1_000;

/* ------------------------------------------------------------- utilities */

/** Deterministic PRNG so repeated runs produce the same practice. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260921);

const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

/** Builds a weighted sampler with O(1) draws. */
function weighted<T>(entries: [T, number][]) {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  const cumulative: number[] = [];
  let acc = 0;
  for (const [, w] of entries) {
    acc += w / total;
    cumulative.push(acc);
  }
  return () => {
    const r = rnd();
    for (let i = 0; i < cumulative.length; i++) if (r <= cumulative[i]) return entries[i][0];
    return entries[entries.length - 1][0];
  };
}

/** Appends the Luhn check digit to a 9-digit NPI base. */
function npiFrom(base9: string): string {
  const digits = ("80840" + base9).split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, alt = true; i >= 0; i--, alt = !alt) {
    let d = digits[i];
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return base9 + ((10 - (sum % 10)) % 10);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pad = (n: number, w: number) => String(n).padStart(w, "0");

/* ------------------------------------------------------- bulk insert core */

let pool: Pool;

async function insertBatched(table: string, columns: string[], rows: unknown[][]) {
  if (rows.length === 0) return;
  const colList = columns.map((c) => `"${c}"`).join(", ");
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    const params: unknown[] = [];
    const tuples = slice.map((row) => {
      const placeholders = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${placeholders.join(",")})`;
    });
    await pool.query(`INSERT INTO ${table} (${colList}) VALUES ${tuples.join(",")}`, params);
  }
}

function progress(label: string, done: number, total: number, startedAt: number) {
  const pct = ((done / total) * 100).toFixed(0);
  const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
  process.stdout.write(`\r  ${label}: ${done.toLocaleString()} / ${total.toLocaleString()} (${pct}%) ${secs}s   `);
}

/* ------------------------------------------------------------------ main */

const SEEDED_TABLES = [
  "audit_log", "denials", "ledger_entries", "remittances", "claim_events", "claims",
  "charges", "encounters", "appointments", "eligibility_checks", "patient_insurances",
  "patients", "payers", "providers", "users", "practices", "cpt_codes", "icd10_codes",
];

async function main() {
  const url = process.env.DATABASE_URL?.trim() || readEnvLocal("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is required (set it, or put it in .env.local)");
  const host = /@([^/]+)\//.exec(url)?.[1] ?? "unknown";
  console.log(`Target: ~$${(TARGET_CHARGES_CENTS / 100_000_000).toFixed(0)}M charges, ${PROVIDER_COUNT} providers, ${PATIENT_COUNT.toLocaleString()} patients`);
  console.log(`Database host: ${host}\n`);

  pool = new Pool({
    connectionString: url,
    max: 4,
    ssl: /@(localhost|127\.0\.0\.1)/.test(url) ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("pool error:", e.message));

  const t0 = Date.now();
  console.log("Clearing existing data...");
  await pool.query(`TRUNCATE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);

  /* --- practice, users, reference data --- */
  const practiceId = crypto.randomUUID();
  await insertBatched("practices", ["id", "name", "tax_id", "npi", "address1", "city", "state", "zip", "phone"], [[
    practiceId, "Summit Health Partners", "84-2917465", npiFrom("142536978"),
    "2200 Commerce Blvd, Suite 500", "Dallas", "TX", "75201", "214-555-0180",
  ]]);

  const users: unknown[][] = [
    [crypto.randomUUID(), practiceId, "admin@medbill.local", await bcrypt.hash("admin123", 10), "Alex Rivera", "admin"],
    [crypto.randomUUID(), practiceId, "biller@medbill.local", await bcrypt.hash("biller123", 10), "Jordan Lee", "biller"],
    [crypto.randomUUID(), practiceId, "frontdesk@medbill.local", await bcrypt.hash("front123", 10), "Sam Ortiz", "front_desk"],
  ];
  await insertBatched("users", ["id", "practice_id", "email", "password_hash", "name", "role"], users);
  const adminId = users[0][0] as string;
  const billerId = users[1][0] as string;

  await insertBatched("cpt_codes", ["code", "description", "default_fee_cents"],
    dedupeByFirst(CPTS.map(([c, d, f]) => [c, d, f])));
  await insertBatched("icd10_codes", ["code", "description"],
    dedupeByFirst(ICDS.map(([c, d]) => [c, d])));

  /* --- payers --- */
  const payerRows = US_PAYERS.map(([name, pid, type, tf, ap]) => [crypto.randomUUID(), practiceId, name, pid, type, tf, ap]);
  await insertBatched("payers", ["id", "practice_id", "name", "payer_id", "type", "timely_filing_days", "appeal_days"], payerRows);
  const pickPayer = weighted(US_PAYERS.map((p, i) => [i, p[5]] as [number, number]));

  /* --- providers --- */
  const providerRows: unknown[][] = [];
  for (let i = 0; i < PROVIDER_COUNT; i++) {
    const female = rnd() < 0.45;
    const [specialty, taxonomy] = SPECIALTIES[i % SPECIALTIES.length];
    providerRows.push([
      crypto.randomUUID(), practiceId,
      pick(female ? FIRST_NAMES_F : FIRST_NAMES_M), pick(LAST_NAMES),
      npiFrom(pad(100000000 + i * 7919, 9)), taxonomy, specialty, true,
    ]);
  }
  await insertBatched("providers", ["id", "practice_id", "first_name", "last_name", "npi", "taxonomy", "specialty", "active"], providerRows);
  console.log(`  providers: ${PROVIDER_COUNT}`);

  /* --- patients + insurance --- */
  console.log("Generating patients...");
  const patientIds: string[] = [];
  const insuranceIds: string[] = [];
  const insurancePayerIdx: number[] = [];
  let pStart = Date.now();
  for (let offset = 0; offset < PATIENT_COUNT; offset += 5000) {
    const count = Math.min(5000, PATIENT_COUNT - offset);
    const pRows: unknown[][] = [];
    const iRows: unknown[][] = [];
    for (let i = 0; i < count; i++) {
      const n = offset + i;
      const female = rnd() < 0.52;
      const [city, state, zip3, area] = pick(US_CITIES);
      const id = crypto.randomUUID();
      const birthYear = int(1935, 2020);
      const first = pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
      const last = pick(LAST_NAMES);
      pRows.push([
        id, practiceId, "P" + pad(100001 + n, 6), first, last,
        `${birthYear}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`,
        female ? "F" : "M",
        `${area}-555-${pad(int(0, 9999), 4)}`,
        `${first.toLowerCase()}.${last.toLowerCase()}${n}@example.com`,
        `${int(100, 9999)} ${pick(STREETS)}`, city, state, `${zip3}${pad(int(0, 99), 2)}`,
      ]);
      // Medicare skews to 65+, Medicaid to younger adults; otherwise commercial.
      const age = 2026 - birthYear;
      let payerIdx = pickPayer();
      if (age >= 65 && rnd() < 0.7) payerIdx = US_PAYERS.findIndex((p) => p[2] === "medicare");
      else if (age < 40 && rnd() < 0.15) payerIdx = US_PAYERS.findIndex((p) => p[2] === "medicaid");
      const insId = crypto.randomUUID();
      iRows.push([
        insId, id, payerRows[payerIdx][0], `${US_PAYERS[payerIdx][1].slice(0, 3)}${pad(int(100000000, 999999999), 9)}`,
        rnd() < 0.7 ? `GRP${int(1000, 9999)}` : null, 1, "self", pick([1500, 2000, 2500, 3000, 4000]), true,
      ]);
      patientIds.push(id);
      insuranceIds.push(insId);
      insurancePayerIdx.push(payerIdx);
    }
    await insertBatched("patients", ["id", "practice_id", "mrn", "first_name", "last_name", "dob", "sex", "phone", "email", "address1", "city", "state", "zip"], pRows);
    await insertBatched("patient_insurances", ["id", "patient_id", "payer_id", "member_id", "group_number", "rank", "relationship", "copay_cents", "active"], iRows);
    progress("patients", offset + count, PATIENT_COUNT, pStart);
  }
  console.log("");

  /* --- encounters, charges, claims, ledger, denials --- */
  const pickCpt = weighted(CPTS.map((c, i) => [i, c[3]] as [number, number]));
  const pickIcd = weighted(ICDS.map((c, i) => [i, c[2]] as [number, number]));
  const pickDenial = weighted(DENIAL_MIX.map((d, i) => [i, d[2]] as [number, number]));

  // Generate until the billed-charge target is met rather than trusting an
  // estimated average: the CPT mix decides the average, not the other way
  // round, and a wrong guess silently lands far from the target.
  const MAX_CLAIMS = Number(process.env.MAX_CLAIMS ?? 400_000);
  console.log(`Generating claims until $${(TARGET_CHARGES_CENTS / 100_000_000).toFixed(0)}M billed (cap ${MAX_CLAIMS.toLocaleString()} claims), ${MONTHS_OF_HISTORY} months of history...`);

  const now = new Date();
  const oldest = new Date(now);
  oldest.setMonth(oldest.getMonth() - MONTHS_OF_HISTORY);
  const spanMs = now.getTime() - oldest.getTime();

  let totalCharges = 0;
  let claimNo = 0;
  let paidTotal = 0;
  let deniedCount = 0;
  const statusCounts: Record<string, number> = {};
  const eStart = Date.now();

  while (totalCharges < TARGET_CHARGES_CENTS && claimNo < MAX_CLAIMS) {
    const count = Math.min(5000, MAX_CLAIMS - claimNo);
    const encRows: unknown[][] = [];
    const chgRows: unknown[][] = [];
    const clmRows: unknown[][] = [];
    const evtRows: unknown[][] = [];
    const ledRows: unknown[][] = [];
    const denRows: unknown[][] = [];

    for (let i = 0; i < count; i++) {
      const patientIdx = Math.floor(rnd() * PATIENT_COUNT);
      const patientId = patientIds[patientIdx];
      const insuranceId = insuranceIds[patientIdx];
      const payerIdx = insurancePayerIdx[patientIdx];
      const payer = US_PAYERS[payerIdx];
      const providerRow = providerRows[Math.floor(rnd() * PROVIDER_COUNT)];

      const dos = new Date(oldest.getTime() + rnd() * spanMs);
      const ageDays = Math.floor((now.getTime() - dos.getTime()) / 86_400_000);
      const encId = crypto.randomUUID();
      const claimId = crypto.randomUUID();

      const dxCount = rnd() < 0.45 ? 1 : rnd() < 0.85 ? 2 : 3;
      const diagnoses: string[] = [];
      while (diagnoses.length < dxCount) {
        const code = ICDS[pickIcd()][0];
        if (!diagnoses.includes(code)) diagnoses.push(code);
      }

      encRows.push([encId, practiceId, patientId, providerRow[0], iso(dos), "11", JSON.stringify(diagnoses), "billed"]);

      // 1-4 service lines: an E/M plus ancillaries.
      const lineCount = rnd() < 0.35 ? 1 : rnd() < 0.75 ? 2 : rnd() < 0.93 ? 3 : 4;
      let claimTotal = 0;
      const lines: { cpt: string; cents: number }[] = [];
      for (let l = 0; l < lineCount; l++) {
        const [cpt, desc, fee] = CPTS[pickCpt()];
        if (lines.some((x) => x.cpt === cpt)) continue;
        const units = 1;
        const cents = fee * units;
        claimTotal += cents;
        lines.push({ cpt, cents });
        chgRows.push([
          crypto.randomUUID(), encId, lines.length, cpt, JSON.stringify(l === 0 && lineCount > 1 && /^992/.test(cpt) ? ["25"] : []),
          units, cents, JSON.stringify([1]), desc,
        ]);
      }
      if (lines.length === 0) continue;

      const deadline = new Date(dos);
      deadline.setDate(deadline.getDate() + payer[3]);

      // Lifecycle by age. Work in progress only exists near the present: a
      // claim from eighteen months ago has long since been paid, appealed to a
      // conclusion, or written off. Leaving old claims sitting in "rejected"
      // would show thousands of permanently overdue items on the worklists.
      // Payers take weeks, so recent claims are still outstanding. Resolving
      // them too quickly would collapse A/R to a few days, which no real
      // practice achieves.
      const roll = rnd();
      let lifecycle: string;
      if (ageDays < 4) lifecycle = roll < 0.35 ? "ready" : roll < 0.45 ? "scrub_errors" : "submitted";
      else if (ageDays < 16) lifecycle = roll < 0.07 ? "rejected" : "accepted";
      else if (ageDays < 35) lifecycle = roll < 0.04 ? "rejected" : roll < 0.40 ? "paid" : roll < 0.47 ? "denied" : "accepted";
      else if (ageDays < 70) lifecycle = roll < 0.02 ? "rejected" : roll < 0.76 ? "paid" : roll < 0.86 ? "denied" : "accepted";
      else if (ageDays < 120) lifecycle = roll < 0.86 ? "paid" : roll < 0.95 ? "denied" : "closed";
      else lifecycle = roll < 0.88 ? "paid" : roll < 0.955 ? "denied" : "closed";

      // Remittance lands 21-52 days after service, never in the future.
      const payLagDays = 21 + rnd() * 31;
      const postedPay = new Date(Math.min(dos.getTime() + payLagDays * 86_400_000, now.getTime() - 3_600_000));

      // A denial is only outstanding until someone works it. Once it is worked
      // the balance leaves A/R, either collected on appeal or written off, and
      // the claim closes. Without this the denied balance would sit in A/R for
      // ever and every aging and collection ratio would be wrong.
      let denialStatus: string | null = null;
      let denialResolvedAt: Date | null = null;
      if (lifecycle === "denied") {
        const denialAgeDays = Math.floor((now.getTime() - postedPay.getTime()) / 86_400_000);
        const resolveChance = denialAgeDays > 120 ? 0.985 : denialAgeDays > 60 ? 0.9 : denialAgeDays > 30 ? 0.6 : 0.2;
        if (rnd() < resolveChance) {
          denialStatus = rnd() < 0.45 ? "resolved" : "written_off";
          denialResolvedAt = new Date(postedPay.getTime() + (8 + rnd() * 40) * 86_400_000);
          if (denialResolvedAt > now) denialResolvedAt = now;
        } else {
          denialStatus = rnd() < 0.4 ? "in_progress" : "open";
        }
      }
      const status = denialResolvedAt ? "closed" : lifecycle;
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;

      const submittedAt = ["ready", "scrub_errors"].includes(status) ? null : new Date(dos.getTime() + 86_400_000);
      const adjudicated = lifecycle === "paid" || lifecycle === "denied";
      clmRows.push([
        claimId, practiceId, encId, patientId, payerRows[payerIdx][0], insuranceId,
        "MB" + pad(++claimNo, 8), adjudicated ? "PCN" + pad(int(100000, 999999), 6) : null,
        "1", status, claimTotal, JSON.stringify(status === "scrub_errors"
          ? [{ rule: "PAT_ADDRESS", severity: "error", message: "Subscriber address is incomplete", field: "patient.address1" }]
          : []),
        submittedAt, iso(deadline), dos, denialResolvedAt ?? submittedAt ?? dos,
      ]);
      evtRows.push([crypto.randomUUID(), claimId, status, adjudicated ? "835" : "clearinghouse",
        lifecycle === "paid" ? "ERA posted"
          : lifecycle === "denied" ? (denialStatus === "written_off" ? "Denied, balance written off" : denialStatus === "resolved" ? "Denied, overturned on appeal" : "Denied on remittance")
          : `Claim ${status.replace("_", " ")}`,
        denialResolvedAt ?? submittedAt ?? dos]);

      totalCharges += claimTotal;

      // Charge postings always exist.
      const postedCharge = dos;
      for (const line of lines) {
        ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "charge", line.cents, null, null, `${line.cpt}`, adminId, postedCharge]);
      }

      // A claim closed without ever being adjudicated was abandoned; the
      // balance has to be written off rather than left hanging as revenue.
      if (lifecycle === "closed") {
        ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "write_off", claimTotal, "CO", "16", "Closed without adjudication", adminId, postedPay]);
      }

      if (adjudicated) {
        if (lifecycle === "paid") {
          const allowedPct = 0.55 + rnd() * 0.3;
          const allowed = Math.round(claimTotal * allowedPct);
          const contractual = claimTotal - allowed;
          const patientResp = Math.min(Math.round(allowed * (rnd() < 0.6 ? 0.15 : 0.05)), 12000);
          const insPaid = allowed - patientResp;
          paidTotal += insPaid;
          ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "insurance_payment", insPaid, null, null, payer[0], adminId, postedPay]);
          ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "adjustment", contractual, "CO", "45", "Contractual adjustment", adminId, postedPay]);
          if (patientResp > 0) {
            ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "transfer_to_patient", patientResp, "PR", "3", "Patient responsibility per ERA", adminId, postedPay]);
            // Most patients eventually pay their share.
            if (rnd() < 0.62) {
              const postedPt = new Date(postedPay.getTime() + (10 + rnd() * 40) * 86_400_000);
              if (postedPt < now) ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "patient_payment", patientResp, null, null, "Patient payment (card)", adminId, postedPt]);
            }
          }
        } else {
          deniedCount++;
          const [carc, rarc] = DENIAL_MIX[pickDenial()];
          const info = CARC[carc];
          const appealBy = new Date(postedPay.getTime() + payer[4] * 86_400_000);
          denRows.push([
            crypto.randomUUID(), practiceId, claimId, info?.category ?? "other", carc, rarc, claimTotal,
            denialStatus, rnd() < 0.5 ? billerId : adminId,
            `${info?.plain ?? "The payer denied this claim."}${rarc && RARC[rarc] ? ` Remark ${rarc}: ${RARC[rarc]}` : ""}`,
            JSON.stringify(info?.nextSteps ?? ["Review the remittance detail"]),
            iso(appealBy), postedPay, denialResolvedAt,
          ]);

          // Clear the balance once the denial has been worked, so it stops
          // ageing in A/R: an overturned appeal collects, a write-off does not.
          if (denialResolvedAt) {
            if (denialStatus === "resolved") {
              const allowed = Math.round(claimTotal * (0.5 + rnd() * 0.3));
              paidTotal += allowed;
              ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "insurance_payment", allowed, null, null, `${payer[0]} (appeal overturned)`, adminId, denialResolvedAt]);
              ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "adjustment", claimTotal - allowed, "CO", "45", "Contractual adjustment", adminId, denialResolvedAt]);
            } else {
              ledRows.push([crypto.randomUUID(), practiceId, patientId, claimId, "write_off", claimTotal, "CO", carc, `Written off after denial (CARC ${carc})`, adminId, denialResolvedAt]);
            }
          }
        }
      }
    }

    await insertBatched("encounters", ["id", "practice_id", "patient_id", "provider_id", "date_of_service", "place_of_service", "diagnoses", "status"], encRows);
    await insertBatched("charges", ["id", "encounter_id", "line_number", "cpt", "modifiers", "units", "charge_cents", "dx_pointers", "description"], chgRows);
    await insertBatched("claims", ["id", "practice_id", "encounter_id", "patient_id", "payer_id", "patient_insurance_id", "control_number", "payer_claim_number", "frequency_code", "status", "total_cents", "scrub_results", "submitted_at", "timely_filing_deadline", "created_at", "updated_at"], clmRows);
    await insertBatched("claim_events", ["id", "claim_id", "status", "source", "message", "at"], evtRows);
    await insertBatched("ledger_entries", ["id", "practice_id", "patient_id", "claim_id", "type", "amount_cents", "group_code", "reason_code", "note", "posted_by", "posted_at"], ledRows);
    await insertBatched("denials", ["id", "practice_id", "claim_id", "category", "carc", "rarc", "amount_cents", "status", "assigned_to", "explanation", "next_steps", "appeal_deadline", "created_at", "resolved_at"], denRows);
    progress("billed", Math.min(totalCharges, TARGET_CHARGES_CENTS), TARGET_CHARGES_CENTS, eStart);
  }
  console.log("");

  /* --- upcoming appointments so the scheduler is populated --- */
  const apptRows: unknown[][] = [];
  for (let d = 0; d < 14; d++) {
    for (let i = 0; i < 40; i++) {
      const start = new Date(now);
      start.setDate(start.getDate() + d);
      start.setHours(7 + Math.floor(i / 5), (i % 5) * 12, 0, 0);
      apptRows.push([
        crypto.randomUUID(), practiceId, patientIds[Math.floor(rnd() * PATIENT_COUNT)],
        providerRows[Math.floor(rnd() * PROVIDER_COUNT)][0], start, new Date(start.getTime() + 20 * 60_000),
        pick(["office_visit", "follow_up", "annual_physical", "telehealth", "procedure"]),
        d === 0 && i < 12 ? "checked_in" : "scheduled",
        pick(["Follow-up hypertension", "Annual wellness exam", "Medication review", "Cough and fever", "Diabetes management", "Low back pain"]),
      ]);
    }
  }
  await insertBatched("appointments", ["id", "practice_id", "patient_id", "provider_id", "starts_at", "ends_at", "type", "status", "reason"], apptRows);

  await pool.query("INSERT INTO _migrations (name) VALUES ('seed') ON CONFLICT (name) DO NOTHING");
  await pool.query("ANALYZE");

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nDone in ${secs}s`);
  console.log(`  charges billed : $${(totalCharges / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  console.log(`  insurance paid : $${(paidTotal / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  console.log(`  claims         : ${claimNo.toLocaleString()}`);
  console.log(`  denied         : ${deniedCount.toLocaleString()}`);
  console.log(`  status mix     : ${Object.entries(statusCounts).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ")}`);
  await pool.end();
}

function dedupeByFirst(rows: unknown[][]): unknown[][] {
  const seen = new Set<unknown>();
  return rows.filter((r) => (seen.has(r[0]) ? false : (seen.add(r[0]), true)));
}

function readEnvLocal(key: string): string | undefined {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

main().catch((err) => {
  console.error("\nSeed failed:", err);
  process.exit(1);
});
