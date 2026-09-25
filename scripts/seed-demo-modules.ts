/**
 * Demo data for the modules added after the base seed: payer contracts and
 * underpayments, payer edits and prior authorizations, statements and
 * payment plans, lab orders (results from the labeled simulator), provider
 * enrollment, a bank deposit file, collection accounts, appeal letters, a few
 * credit balances (duplicate payments) to refund, and
 * a second practice so the practice switcher and all-clients view have
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
  const enrollment = await import("@/server/enrollment");
  const deposits = await import("@/server/deposits");
  const collections = await import("@/server/collections");
  const appeals = await import("@/server/appeals");

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

  /* ---------------- Provider enrollment ---------------- */
  const [{ n: enrollCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.providerEnrollments).where(eq(schema.providerEnrollments.practiceId, practiceId));
  if (Number(enrollCount) === 0) {
    const provs = await db.select().from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true)));
    const tracked = payers.filter((p) => p.type !== "self_pay").slice(0, 6);
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const rand = rng(20260925);
    let saved = 0;
    for (const [pi, pr] of provs.entries()) {
      for (const [qi, pa] of tracked.entries()) {
        const base = { providerId: pr.id, payerId: pa.id, payerProviderId: `${pa.type === "medicare" ? "PTAN" : "PRV"}${String(100000 + pi * 97 + qi * 13).slice(0, 6)}` };
        let input: Parameters<typeof enrollment.saveEnrollment>[2];
        if (pi === 0 && qi === 1) input = { ...base, status: "approved", effectiveOn: day(-1780), revalidationDue: day(41), notes: "Demo: revalidation window open" };
        else if (pi === 1 && qi === 2) input = { ...base, status: "approved", effectiveOn: day(-1850), revalidationDue: day(-9), notes: "Demo: revalidation overdue" };
        else if (pi === 2 && qi === 3) input = { ...base, payerProviderId: null, status: "in_process", submittedOn: day(-118), notes: "Demo: application still pending with the payer" };
        else if (pi === 3 && qi === 4) input = { ...base, payerProviderId: null, status: "submitted", submittedOn: day(-19), notes: "Demo: new provider application" };
        else input = { ...base, status: "approved", effectiveOn: day(-400 - Math.floor(rand() * 1400)), revalidationDue: pa.type === "medicare" || pa.type === "medicaid" ? day(200 + Math.floor(rand() * 1200)) : null };
        await enrollment.saveEnrollment(db, practiceId, input, admin.id);
        saved++;
      }
    }
    log(`provider enrollment: ${saved} provider-payer pairs across ${tracked.length} payers (one due, one overdue, one stalled, one new)`);
  } else log("provider enrollment: already present");

  /* ---------------- Bank deposits ---------------- */
  const [{ n: depCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.bankDeposits).where(eq(schema.bankDeposits.practiceId, practiceId));
  if (Number(depCount) === 0) {
    const recentEras = (await db.select().from(schema.remittances).where(eq(schema.remittances.practiceId, practiceId)).orderBy(desc(schema.remittances.paymentDate)).limit(30)).reverse();
    // A deposit never lands after the newest ERA's day, so the file never runs into tomorrow in any time zone.
    const todayIso = recentEras.at(-1)?.paymentDate ?? new Date().toISOString().slice(0, 10);
    const plus = (iso: string, n: number) => {
      const d = new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
      return d > todayIso ? todayIso : d;
    };
    const mdY = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
    const lines = ["Posting Date,Description,Amount"];
    let withheld = 0;
    for (const [i, r] of recentEras.entries()) {
      // Two older ERAs whose money never shows up in the bank file.
      if ((i === 3 || i === 9) && recentEras.length > 12) {
        withheld++;
        continue;
      }
      const who = r.payerName.toUpperCase().replace(/[^A-Z ]/g, "").split(" ")[0];
      const desc = i % 6 === 5 ? `DEPOSIT REF ${700000 + i * 131}` : `HCCLAIMPMT ${who} TRN*1*${r.checkNumber}*1${String(i).padStart(3, "0")}`;
      lines.push(`${mdY(plus(r.paymentDate, 1 + (i % 2)))},"${desc}",${(r.amountCents / 100).toFixed(2)}`);
    }
    const last = recentEras.at(-1)?.paymentDate ?? todayIso;
    lines.push(`${mdY(plus(last, -2))},MERCHANT CARD SETTLEMENT,1284.50`);
    lines.push(`${mdY(plus(last, -1))},MERCHANT CARD SETTLEMENT,932.15`);
    lines.push(`${mdY(plus(last, -3))},ACH DEBIT PAYROLL,-18450.00`);
    lines.push(`${mdY(plus(last, -1))},OFFICE SUPPLY CO,-212.40`);
    const r = await deposits.importDeposits(db, practiceId, lines.join("\n"), admin.id);
    const [card] = await db.select().from(schema.bankDeposits).where(and(eq(schema.bankDeposits.practiceId, practiceId), eq(schema.bankDeposits.amountCents, 128450))).limit(1);
    if (card) await deposits.setDepositStatus(db, practiceId, card.id, "ignored", admin.id);
    log(`bank deposits: ${r.added} imported (${r.matched} matched to ERAs, ${r.skipped} withdrawals skipped); ${withheld} ERAs left without a deposit`);
  } else log("bank deposits: already present");

  /* ---------------- Collections ---------------- */
  const [{ n: collCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.patientCollections).where(eq(schema.patientCollections.practiceId, practiceId));
  if (Number(collCount) === 0) {
    const onPlan = new Set((await db.select({ id: schema.paymentPlans.patientId }).from(schema.paymentPlans).where(eq(schema.paymentPlans.practiceId, practiceId))).map((p) => p.id));
    const owing = (await billing.patientsWithBalances(db, practiceId, 7_500, 60)).filter((o) => !onPlan.has(o.patientId)).slice(0, 7);
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
    const isoAgo = (n: number) => ago(n).toISOString().slice(0, 10);
    // Each account has had two statements, the first three months ago.
    for (const o of owing) {
      for (const days of [95, 65]) {
        const st = await billing.generateStatement(db, practiceId, o.patientId, admin.id);
        await db.update(schema.statements).set({ statementDate: isoAgo(days), dueDate: isoAgo(days - 30), status: "sent", sentAt: ago(days) }).where(eq(schema.statements.id, st.id));
      }
    }
    const agency = "Demo Collection Agency";
    const steps: string[] = [];
    if (owing[3]) {
      await collections.sendFinalNotice(db, practiceId, owing[3].patientId, { userId: admin.id, now: ago(24) });
      steps.push("1 final notice past its 10 days");
    }
    if (owing[4]) {
      await collections.sendFinalNotice(db, practiceId, owing[4].patientId, { userId: admin.id, now: ago(4) });
      steps.push("1 final notice still running");
    }
    if (owing[5]) {
      const { collection } = await collections.sendFinalNotice(db, practiceId, owing[5].patientId, { userId: admin.id, now: ago(70) });
      await collections.placeWithAgency(db, practiceId, collection.id, agency, { userId: admin.id, now: ago(55) });
      steps.push("1 at the agency");
    }
    if (owing[6]) {
      const { collection } = await collections.sendFinalNotice(db, practiceId, owing[6].patientId, { userId: admin.id, now: ago(120) });
      const placed = await collections.placeWithAgency(db, practiceId, collection.id, agency, { userId: admin.id, now: ago(100) });
      await collections.closeCollection(db, practiceId, collection.id, "settled", Math.round(placed.amountCents * 0.4), { userId: admin.id, note: "Demo: settled at 40%" });
      steps.push("1 settled by the agency");
    }
    log(`collections: ${Math.min(3, owing.length)} accounts ready for a final notice, ${steps.join(", ")}`);
  } else log("collections: already present");

  /* ---------------- Appeal letters ---------------- */
  const [{ n: appealCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.appealLetters).where(eq(schema.appealLetters.practiceId, practiceId));
  if (Number(appealCount) === 0) {
    const open = await db.select().from(schema.denials).where(and(eq(schema.denials.practiceId, practiceId), eq(schema.denials.status, "open"))).orderBy(desc(schema.denials.createdAt)).limit(4);
    for (const [i, d] of open.entries()) {
      const letter = await appeals.draftAppeal(db, practiceId, d.id, admin.id);
      if (i === 0) await appeals.markAppealSent(db, practiceId, letter.id, admin.id);
    }
    log(`appeal letters: ${open.length} drafted from templates, 1 marked sent`);
  } else log("appeal letters: already present");

  /* ---------------- Credit balances ---------------- */
  const [{ n: creditCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.practiceId, practiceId), sql`${schema.ledgerEntries.note} LIKE 'Demo credit:%'`));
  if (Number(creditCount) === 0) {
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
    // Patients who owe nothing and then paid a copay twice.
    const { rows: settled } = await db.execute<{ patient_id: string }>(sql`
      SELECT patient_id FROM ledger_entries WHERE practice_id = ${practiceId}
      GROUP BY patient_id HAVING (${billing.patientBalanceSql}) = 0 AND count(*) FILTER (WHERE type = 'patient_payment') > 0
      ORDER BY patient_id LIMIT 3`);
    for (const [i, p] of settled.entries()) {
      await db.insert(schema.ledgerEntries).values({ practiceId, patientId: p.patient_id, type: "patient_payment", amountCents: [2_500, 4_000, 7_500][i], note: "Demo credit: copay collected twice at check-in", postedBy: admin.id, postedAt: ago(10 + i * 9) });
    }
    // Paid-in-full claims the payer then paid a second time: two commercial, one Medicare paid 50 days ago.
    const paidInFull = (type: string, n: number) => db.execute<{ id: string; patient_id: string; paid: string }>(sql`
      SELECT c.id, c.patient_id, COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'insurance_payment'), 0)::text AS paid
      FROM claims c JOIN payers py ON py.id = c.payer_id JOIN ledger_entries l ON l.claim_id = c.id
      WHERE c.practice_id = ${practiceId} AND c.status = 'paid' AND py.type = ${type}
      GROUP BY c.id
      HAVING COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'charge'), 0)
           - COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'insurance_payment'), 0)
           + COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'reversal'), 0)
           - COALESCE(sum(l.amount_cents) FILTER (WHERE l.type IN ('adjustment', 'write_off', 'transfer_to_patient')), 0) = 0
         AND COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'insurance_payment'), 0) BETWEEN 5000 AND 60000
      ORDER BY c.id LIMIT ${n}`);
    const dupes = [...(await paidInFull("commercial", 2)).rows.map((r) => ({ ...r, days: 20 })), ...(await paidInFull("medicare", 1)).rows.map((r) => ({ ...r, days: 50 }))];
    for (const c of dupes) {
      await db.insert(schema.ledgerEntries).values({ practiceId, patientId: c.patient_id, claimId: c.id, type: "insurance_payment", amountCents: Number(c.paid), note: "Demo credit: payer paid the claim a second time", postedBy: admin.id, postedAt: ago(c.days) });
    }
    log(`credit balances: ${settled.length} patient credits, ${dupes.length} duplicate insurance payments`);
  } else log("credit balances: already present");

  /* ---------------- Front desk: self-pay patients and text threads ---------------- */
  const [{ n: selfPayCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.patients).where(and(eq(schema.patients.practiceId, practiceId), sql`${schema.patients.mrn} LIKE 'DEMO-SP%'`));
  if (Number(selfPayCount) === 0) {
    const people = [
      { firstName: "Harper", lastName: "Quinlan", dob: "1988-04-17", sex: "F", phone: "555-010-2231" },
      { firstName: "Mateo", lastName: "Vance", dob: "1979-11-02", sex: "M", phone: "555-010-2232" },
      { firstName: "Ivy", lastName: "Castellano", dob: "1993-07-29", sex: "F", phone: "555-010-2233" },
      { firstName: "Desmond", lastName: "Okafor", dob: "1965-01-08", sex: "M", phone: "555-010-2234" },
    ];
    const [provider] = await db.select().from(schema.providers).where(eq(schema.providers.practiceId, practiceId)).limit(1);
    for (const [i, p] of people.entries()) {
      const [row] = await db.insert(schema.patients).values({ practiceId, mrn: `DEMO-SP${i + 1}`, ...p, address1: `${100 + i} Demo Lane`, city: "Dallas", state: "TX", zip: "75201" }).returning();
      if (provider && i < 3) {
        const starts = new Date(Date.now() + (i + 2) * 86_400_000);
        starts.setUTCHours(15, 0, 0, 0);
        await db.insert(schema.appointments).values({ practiceId, patientId: row.id, providerId: provider.id, startsAt: starts, endsAt: new Date(starts.getTime() + 1_800_000), reason: "New patient visit" });
      }
    }
    log(`self-pay patients: ${people.length} without insurance for coverage discovery`);
  } else log("self-pay patients: already present");

  const [{ n: smsCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.smsMessages).where(eq(schema.smsMessages.practiceId, practiceId));
  if (Number(smsCount) === 0) {
    const withPhones = await db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, practiceId), sql`${schema.patients.phone} IS NOT NULL`, sql`${schema.patients.mrn} NOT LIKE 'DEMO-SP%'`)).limit(3);
    const ago = (m: number) => new Date(Date.now() - m * 60_000);
    const e164 = (ph: string) => `+1${ph.replace(/\D/g, "").slice(-10)}`;
    const threads: [string, string, number][][] = [
      [["out", "Summit Health Partners: your statement is ready. View and pay: (link)", 2900], ["in", "Can I split this into payments?", 2880]],
      [["out", "Reminder from Summit Health Partners: appointment tomorrow at 9:30 AM. Reply C to confirm.", 1500], ["in", "C", 1490], ["in", "Also do I need to bring my new insurance card?", 1485]],
      [["out", "Summit Health Partners: please complete check-in before your visit: (link)", 300], ["in", "Done, thanks!", 42]],
    ];
    for (const [i, p] of withPhones.entries()) {
      for (const [direction, body, minutes] of threads[i] ?? []) {
        await db.insert(schema.smsMessages).values({ practiceId, patientId: p.id, direction, phone: e164(p.phone!), body, status: direction === "in" ? "received" : "sent", readAt: direction === "out" || minutes > 2000 ? ago(minutes) : null, createdAt: ago(minutes) });
      }
    }
    log(`text threads: ${Math.min(3, withPhones.length)} demo conversations`);
  } else log("text threads: already present");

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
