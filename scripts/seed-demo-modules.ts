/**
 * Demo data for the modules added after the base seed: payer contracts and
 * underpayments, payer edits and prior authorizations, statements and
 * payment plans, lab orders (results from the labeled simulator), and a
 * second practice so the practice switcher and all-clients view have
 * something to compare.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/seed-demo-modules.ts
 *
 * Uses DATABASE_URL (or .env.local). It refuses to run unless the database
 * is the demo one (the demo admin account exists), and every step checks
 * whether it already ran, so running it twice changes nothing.
 * Everything it creates is fictional demo data.
 */
import fs from "node:fs";

if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  const m = fs.readFileSync(".env.local", "utf8").match(/DATABASE_URL\s*=\s*(.*)/);
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, "");
}

const SECOND_PRACTICE = "Lakeside Family Medicine";

function luhnNpi(base9: string): string {
  const digits = ("80840" + base9).split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = digits[i];
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return base9 + String((10 - (sum % 10)) % 10);
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { getDb, schema } = await import("@/db");
  const { and, desc, eq, inArray, sql } = await import("drizzle-orm");
  const fees = await import("@/server/fees");
  const billing = await import("@/server/billing");
  const edits = await import("@/server/payer-edits");
  const labs = await import("@/server/labs");
  const patientsSvc = await import("@/server/patients");
  const encounters = await import("@/server/encounters");
  const claims = await import("@/server/claims");
  const data = await import("@/db/us-data");

  const db = await getDb();
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@collaboratmd.local")).limit(1);
  if (!admin) throw new Error("This is not the demo database (no demo admin account). Refusing to add demo data.");
  const practiceId = admin.practiceId;
  const log = (s: string) => console.log(`- ${s}`);
  const payers = await db.select().from(schema.payers).where(eq(schema.payers.practiceId, practiceId));

  /* ---------------- Fee schedules, contracts, underpayments ---------------- */
  const schedules = await fees.listSchedules(db, practiceId);
  if (!schedules.length) {
    await fees.ensureSchedule(db, practiceId, null);
    const big = payers.filter((p) => p.type !== "self_pay").slice(0, 5);
    for (const [i, p] of big.entries()) await fees.contractFromPercent(db, practiceId, p.id, [72, 68, 75, 70, 65][i] ?? 70);
    const r = await fees.scanUnderpayments(db, practiceId);
    log(`fee schedules: standard + ${big.length} payer contracts; ${r.flagged} underpaid claims flagged`);
  } else log("fee schedules: already present");

  /* ---------------- Payer edits and authorizations ---------------- */
  const existingEdits = await edits.listPayerEdits(db, practiceId);
  const has = (kind: string, cpt: string | null) => existingEdits.some((e) => e.edit.kind === kind && e.edit.cpt === cpt);
  const medicare = payers.find((p) => p.type === "medicare");
  if (!has("auth_required", "70553")) await edits.createPayerEdit(db, practiceId, { payerId: null, kind: "auth_required", cpt: "70553", severity: "error" });
  if (!has("dx_required", "80061")) {
    await edits.createPayerEdit(db, practiceId, { payerId: medicare?.id ?? null, kind: "dx_required", cpt: "80061", dxPrefixes: ["E78", "Z13.220", "Z13.6", "I10"], severity: "warning", message: "Lipid panels need a lipid disorder or screening diagnosis for this payer" });
  }
  if (!has("max_units", "36415")) await edits.createPayerEdit(db, practiceId, { payerId: null, kind: "max_units", cpt: "36415", maxUnits: 1, severity: "error", message: "Venipuncture is billed once per visit" });
  log("payer edits: MRI prior auth, lipid panel diagnosis, venipuncture units");

  const [{ n: authCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.authorizations).where(eq(schema.authorizations.practiceId, practiceId));
  if (Number(authCount) === 0) {
    const withIns = await db
      .select({ patientId: schema.patients.id, payerId: schema.patientInsurances.payerId })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .where(and(eq(schema.patients.practiceId, practiceId), eq(schema.patientInsurances.active, true), eq(schema.patientInsurances.rank, 1)))
      .limit(4);
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const add = (days: number) => new Date(today.getTime() + days * 86_400_000);
    const specs = [
      { cpts: ["70553"], units: 1, from: add(-10), to: add(50) },
      { cpts: ["97110", "97140"], units: 12, from: add(-30), to: add(60) },
      { cpts: ["72148"], units: 1, from: add(-90), to: add(-5) }, // expired
      { cpts: ["70553", "70551"], units: 1, from: add(-5), to: add(85) },
    ];
    for (const [i, p] of withIns.entries()) {
      await edits.createAuthorization(db, practiceId, { patientId: p.patientId, payerId: p.payerId, authNumber: `PA${260900 + i * 17}`, cpts: specs[i].cpts, unitsApproved: specs[i].units, validFrom: iso(specs[i].from), validTo: iso(specs[i].to), note: "Demo authorization" });
    }
    log(`prior authorizations: ${withIns.length}`);
  } else log("prior authorizations: already present");

  /* ---------------- Statements and payment plans ---------------- */
  const [{ n: planCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.paymentPlans).where(eq(schema.paymentPlans.practiceId, practiceId));
  if (Number(planCount) === 0) {
    const owing = await billing.patientsWithBalances(db, practiceId, 15_000, 3);
    const start = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    for (const [i, p] of owing.entries()) {
      await billing.createPaymentPlan(db, practiceId, p.patientId, { totalCents: p.balanceCents, installmentCount: [3, 6, 4][i] ?? 3, frequency: i === 2 ? "biweekly" : "monthly", startDate: start, note: "Demo plan" }, admin.id);
    }
    log(`payment plans: ${owing.length}`);
  } else log("payment plans: already present");
  const [{ n: stmtCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.statements).where(eq(schema.statements.practiceId, practiceId));
  if (Number(stmtCount) < 5) {
    const r = await billing.generateStatementBatch(db, practiceId, { minBalanceCents: 5_000 }, admin.id);
    log(`statements: batch generated (${JSON.stringify(r).slice(0, 80)})`);
  } else log("statements: already present");

  /* ---------------- Lab orders ---------------- */
  const [{ n: labCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.labOrders).where(eq(schema.labOrders.practiceId, practiceId));
  if (Number(labCount) === 0) {
    const recent = await db
      .select({ patientId: schema.encounters.patientId, providerId: schema.encounters.providerId, diagnoses: schema.encounters.diagnoses })
      .from(schema.encounters)
      .where(eq(schema.encounters.practiceId, practiceId))
      .orderBy(desc(schema.encounters.dateOfService))
      .limit(40);
    const seen = new Set<string>();
    const picks = recent.filter((r) => !seen.has(r.patientId) && seen.add(r.patientId)).slice(0, 8);
    const panels = [["CMP", "A1C"], ["LIPID"], ["CBC", "CMP"], ["TSH"], ["A1C", "LIPID"], ["VITD"], ["CBC"], ["CMP", "LIPID", "A1C"]];
    let simulated = 0;
    for (const [i, p] of picks.entries()) {
      const order = await labs.createLabOrder(db, practiceId, { patientId: p.patientId, providerId: p.providerId, labCode: i % 3 === 2 ? "LABCORP" : "QUEST", testCodes: panels[i], diagnoses: p.diagnoses.length ? p.diagnoses : ["Z00.00"] }, admin.id);
      if (i < 5) {
        await labs.simulateLabResult(db, practiceId, order.id, admin.id);
        simulated++;
      }
    }
    log(`lab orders: ${picks.length}, of which ${simulated} have simulated results`);
  } else log("lab orders: already present");

  /* ---------------- A second practice ---------------- */
  let [second] = await db.select().from(schema.practices).where(eq(schema.practices.name, SECOND_PRACTICE)).limit(1);
  if (!second) {
    [second] = await db
      .insert(schema.practices)
      .values({ name: SECOND_PRACTICE, taxId: "84-3319027", npi: luhnNpi("159372846"), address1: "4150 Lakeside Pkwy, Suite 210", city: "Flower Mound", state: "TX", zip: "75028", phone: "972-555-0147" })
      .returning();
    const provs = await db
      .insert(schema.providers)
      .values([
        { practiceId: second.id, firstName: "Hannah", lastName: "Reyes", npi: luhnNpi("174839205"), taxonomy: "207Q00000X", specialty: "Family Medicine" },
        { practiceId: second.id, firstName: "Marcus", lastName: "Bennett", npi: luhnNpi("128465930"), taxonomy: "207R00000X", specialty: "Internal Medicine" },
      ])
      .returning();
    const newPayers = await db
      .insert(schema.payers)
      .values(payers.filter((p) => p.type !== "self_pay").slice(0, 6).map((p) => ({ practiceId: second.id, name: p.name, payerId: p.payerId, type: p.type, timelyFilingDays: p.timelyFilingDays, appealDays: p.appealDays })))
      .returning();
    const rand = rng(20260924);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
    const fee = await fees.standardCharges(db, second.id);
    const visitCodes = ["99213", "99214", "99213", "99395", "99396"];
    let created = 0;
    for (let i = 0; i < 30; i++) {
      const sex = rand() < 0.55 ? "F" : "M";
      const [city, state, zip3, area] = pick(data.US_CITIES);
      const payer = pick(newPayers);
      const suffix = i === 7 ? "D" : i === 19 ? "X" : "ABCEFGHJK"[i % 9];
      const p = await patientsSvc.createPatient(db, second.id, {
        firstName: pick(sex === "F" ? data.FIRST_NAMES_F : data.FIRST_NAMES_M), lastName: pick(data.LAST_NAMES),
        dob: `${1945 + Math.floor(rand() * 60)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
        sex, phone: `${area}-555-01${String(i).padStart(2, "0")}`, address1: `${100 + Math.floor(rand() * 9000)} ${pick(data.STREETS)}`, city, state, zip: `${zip3}${String(Math.floor(rand() * 100)).padStart(2, "0")}`,
        payerId: payer.id, memberId: `LK${String(4000000 + i * 7919).slice(0, 7)}${suffix}`, relationship: "self", copayCents: pick([2000, 2500, 3000]),
      });
      for (let v = 0; v < 1 + Math.floor(rand() * 3); v++) {
        const dos = new Date(Date.now() - (5 + Math.floor(rand() * 80)) * 86_400_000).toISOString().slice(0, 10);
        const dx = [pick(data.ICDS)[0]];
        const visit = pick(visitCodes);
        const lines = [{ cpt: visit, modifiers: [] as string[], units: 1, chargeCents: fee.get(visit) ?? 15_000, dxPointers: [1] }];
        if (rand() < 0.4) lines.push({ cpt: "36415", modifiers: [], units: 1, chargeCents: fee.get("36415") ?? 1_500, dxPointers: [1] });
        const { claim } = await encounters.createEncounterWithClaim(db, second.id, { patientId: p.id, providerId: pick(provs).id, dateOfService: dos, placeOfService: "11", diagnoses: dx, lines }, admin.id);
        if (claim.status === "ready") await claims.submitClaim(db, claim.id, admin.id);
        created++;
      }
    }
    const remits = await claims.fetchAndPostRemittances(db, second.id, admin.id);
    log(`second practice "${SECOND_PRACTICE}": 2 providers, ${newPayers.length} payers, 30 patients, ${created} claims, ${remits} ERAs posted`);
  } else log(`second practice: already present`);

  // The demo admin and biller work for both practices.
  const staff = await db.select().from(schema.users).where(inArray(schema.users.email, ["admin@collaboratmd.local", "biller@collaboratmd.local"]));
  for (const u of staff) {
    await db.insert(schema.practiceMemberships).values({ userId: u.id, practiceId: second.id, role: u.role }).onConflictDoNothing();
  }
  log(`memberships: ${staff.map((u) => u.email).join(", ")} can switch to ${SECOND_PRACTICE}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
