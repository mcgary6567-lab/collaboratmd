import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { Db } from "./index";
import * as schema from "./schema";
import { createEncounterWithClaim } from "@/server/encounters";
import { submitClaim, fetchAndPostRemittances } from "@/server/claims";
import { postPatientPayment } from "@/server/patients";

/** Appends the Luhn check digit to a 9-digit NPI base. */
function makeNpi(base9: string): string {
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

const CPTS: [string, string, number][] = [
  ["99202", "Office visit, new patient, straightforward", 11500],
  ["99203", "Office visit, new patient, low complexity", 16500],
  ["99204", "Office visit, new patient, moderate complexity", 24500],
  ["99212", "Office visit, established patient, straightforward", 8500],
  ["99213", "Office visit, established patient, low complexity", 13500],
  ["99214", "Office visit, established patient, moderate complexity", 19500],
  ["99215", "Office visit, established patient, high complexity", 27500],
  ["99385", "Preventive visit, new patient 18-39", 22000],
  ["99395", "Preventive visit, established patient 18-39", 18500],
  ["99396", "Preventive visit, established patient 40-64", 19500],
  ["36415", "Collection of venous blood by venipuncture", 1500],
  ["80053", "Comprehensive metabolic panel", 4500],
  ["80061", "Lipid panel", 3800],
  ["85025", "Complete blood count with differential", 3200],
  ["83036", "Hemoglobin A1c", 3900],
  ["81002", "Urinalysis, non-automated, without microscopy", 900],
  ["93000", "Electrocardiogram with interpretation", 6500],
  ["90471", "Immunization administration, first vaccine", 3000],
  ["90686", "Influenza vaccine, quadrivalent, preservative free", 3500],
  ["96372", "Therapeutic injection, subcutaneous or intramuscular", 4200],
  ["20610", "Arthrocentesis, major joint", 15500],
  ["17110", "Destruction of benign lesions, up to 14", 14500],
  ["12001", "Simple repair of superficial wound, 2.5 cm or less", 21000],
  ["69210", "Removal of impacted cerumen", 7500],
  ["94640", "Inhalation treatment for airway obstruction", 5500],
  ["97110", "Therapeutic exercises, each 15 minutes", 6500],
  ["97140", "Manual therapy techniques, each 15 minutes", 6000],
  ["90834", "Psychotherapy, 45 minutes", 15000],
  ["90837", "Psychotherapy, 60 minutes", 19500],
  ["G0439", "Annual wellness visit, subsequent", 17500],
];

const ICDS: [string, string][] = [
  ["E11.9", "Type 2 diabetes mellitus without complications"],
  ["I10", "Essential (primary) hypertension"],
  ["E78.5", "Hyperlipidemia, unspecified"],
  ["J06.9", "Acute upper respiratory infection, unspecified"],
  ["M54.50", "Low back pain, unspecified"],
  ["Z00.00", "General adult medical exam without abnormal findings"],
  ["F41.1", "Generalized anxiety disorder"],
  ["F32.A", "Depression, unspecified"],
  ["J45.20", "Mild intermittent asthma, uncomplicated"],
  ["K21.9", "Gastro-esophageal reflux disease without esophagitis"],
  ["M17.11", "Unilateral primary osteoarthritis, right knee"],
  ["N39.0", "Urinary tract infection, site not specified"],
  ["R51.9", "Headache, unspecified"],
  ["Z23", "Encounter for immunization"],
  ["E66.9", "Obesity, unspecified"],
  ["G47.00", "Insomnia, unspecified"],
  ["L30.9", "Dermatitis, unspecified"],
  ["H61.23", "Impacted cerumen, bilateral"],
  ["S61.011A", "Laceration without foreign body of right thumb, initial"],
  ["M25.561", "Pain in right knee"],
  ["R07.9", "Chest pain, unspecified"],
  ["Z13.220", "Encounter for screening for lipoid disorders"],
];

const FIRST = ["Maria", "James", "Aisha", "David", "Elena", "Michael", "Priya", "Robert", "Sofia", "Daniel", "Grace", "Omar", "Hannah", "Luis", "Chloe", "Ethan", "Nadia", "Samuel", "Isabella", "Noah", "Layla", "Benjamin", "Zoe", "Marcus", "Amara", "Henry", "Leah", "Victor"];
const LAST = ["Garcia", "Johnson", "Khan", "Miller", "Petrova", "Brown", "Patel", "Davis", "Rossi", "Wilson", "Kim", "Hassan", "Schmidt", "Martinez", "Dubois", "Anderson", "Ali", "Thompson", "Costa", "Clark", "Nguyen", "Lewis", "Walker", "Reed", "Okafor", "Hall", "Young", "Silva"];

function daysAgoDate(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Populates a freshly truncated database with a realistic demo practice. */
export async function seedDemoData(db: Db) {
  console.log("[medbill] Seeding demo data...");

  const [practice] = await db
    .insert(schema.practices)
    .values({ name: "Lakeside Family Medicine", taxId: "12-3456789", npi: makeNpi("123456789"), address1: "410 Lakeside Ave, Suite 200", city: "Orlando", state: "FL", zip: "32801", phone: "407-555-0100" })
    .returning();

  await db.insert(schema.users).values([
    { practiceId: practice.id, email: "admin@medbill.local", passwordHash: await bcrypt.hash("admin123", 10), name: "Alex Rivera", role: "admin" },
    { practiceId: practice.id, email: "biller@medbill.local", passwordHash: await bcrypt.hash("biller123", 10), name: "Jordan Lee", role: "biller" },
    { practiceId: practice.id, email: "frontdesk@medbill.local", passwordHash: await bcrypt.hash("front123", 10), name: "Sam Ortiz", role: "front_desk" },
  ]);
  const [admin] = await db.select().from(schema.users).limit(1);

  const providerRows = await db
    .insert(schema.providers)
    .values([
      { practiceId: practice.id, firstName: "Sarah", lastName: "Chen", npi: makeNpi("987654321"), taxonomy: "207Q00000X", specialty: "Family Medicine" },
      { practiceId: practice.id, firstName: "Marcus", lastName: "Okafor", npi: makeNpi("456789012"), taxonomy: "207R00000X", specialty: "Internal Medicine" },
      { practiceId: practice.id, firstName: "Priya", lastName: "Natarajan", npi: makeNpi("321654987"), taxonomy: "2084P0800X", specialty: "Psychiatry" },
    ])
    .returning();

  const payerRows = await db
    .insert(schema.payers)
    .values([
      { practiceId: practice.id, name: "Blue Cross Blue Shield FL", payerId: "00590", type: "commercial", timelyFilingDays: 180, appealDays: 90 },
      { practiceId: practice.id, name: "Aetna", payerId: "60054", type: "commercial", timelyFilingDays: 120, appealDays: 60 },
      { practiceId: practice.id, name: "UnitedHealthcare", payerId: "87726", type: "commercial", timelyFilingDays: 90, appealDays: 60 },
      { practiceId: practice.id, name: "Cigna", payerId: "62308", type: "commercial", timelyFilingDays: 90, appealDays: 60 },
      { practiceId: practice.id, name: "Medicare Part B (FL)", payerId: "09102", type: "medicare", timelyFilingDays: 365, appealDays: 120 },
      { practiceId: practice.id, name: "Florida Medicaid", payerId: "77027", type: "medicaid", timelyFilingDays: 365, appealDays: 90 },
    ])
    .returning();

  await db.insert(schema.cptCodes).values(CPTS.map(([code, description, defaultFeeCents]) => ({ code, description, defaultFeeCents })));
  await db.insert(schema.icd10Codes).values(ICDS.map(([code, description]) => ({ code, description })));

  const patientRows = [];
  for (let i = 0; i < FIRST.length; i++) {
    const year = 1945 + ((i * 7) % 60);
    const [p] = await db
      .insert(schema.patients)
      .values({
        practiceId: practice.id,
        mrn: "P" + String(1001 + i).padStart(5, "0"),
        firstName: FIRST[i],
        lastName: LAST[(i * 3) % LAST.length],
        dob: `${year}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + ((i * 5) % 28)).padStart(2, "0")}`,
        sex: i % 2 === 0 ? "F" : "M",
        phone: `407-555-${String(1000 + i * 37).slice(-4)}`,
        email: `${FIRST[i].toLowerCase()}.${LAST[(i * 3) % LAST.length].toLowerCase()}@example.com`,
        address1: `${100 + i * 13} ${["Oak", "Maple", "Pine", "Cedar", "Elm"][i % 5]} St`,
        city: ["Orlando", "Winter Park", "Kissimmee", "Sanford"][i % 4],
        state: "FL",
        zip: String(32801 + (i % 40)),
      })
      .returning();
    const payer = payerRows[i % payerRows.length];
    // Member IDs ending in X are rejected by the clearinghouse; ending in D are denied by the payer.
    const suffix = i === 4 || i === 17 ? "X" : i % 11 === 3 ? "D" : String.fromCharCode(65 + (i % 20));
    await db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: payer.id, memberId: `${payer.payerId.slice(0, 2)}${String(100000 + i * 911)}${suffix}`, groupNumber: i % 3 ? `GRP${1000 + i}` : null, relationship: "self", copayCents: [2000, 2500, 3000][i % 3] });
    patientRows.push(p);
  }

  // Appointments: today and the next two days.
  const visitKinds: [string, string][] = [
    ["office_visit", "Cough and fever"],
    ["follow_up", "Follow-up hypertension"],
    ["annual_physical", "Annual wellness exam"],
    ["telehealth", "Medication review"],
    ["procedure", "Knee injection"],
    ["office_visit", "Low back pain"],
    ["follow_up", "Diabetes management"],
  ];
  for (let i = 0; i < 14; i++) {
    const start = new Date();
    start.setDate(start.getDate() + (i % 3));
    start.setHours(8 + (i % 8), i % 2 ? 30 : 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60_000);
    const [type, reason] = visitKinds[i % visitKinds.length];
    await db.insert(schema.appointments).values({
      practiceId: practice.id,
      patientId: patientRows[(i * 2) % patientRows.length].id,
      providerId: providerRows[(i * 2) % providerRows.length].id,
      startsAt: start,
      endsAt: end,
      type,
      status: i % 3 === 0 && i < 6 ? "checked_in" : "scheduled",
      reason,
    });
  }

  // Encounters and claims across the last ~110 days so aging buckets are populated.
  const scenarios: { dx: string[]; lines: { cpt: string; mods?: string[]; dx: number[] }[] }[] = [
    { dx: ["E11.9", "I10"], lines: [{ cpt: "99214", dx: [1, 2] }, { cpt: "36415", dx: [1] }, { cpt: "83036", dx: [1] }] },
    { dx: ["Z00.00", "Z13.220"], lines: [{ cpt: "99396", dx: [1] }, { cpt: "80061", dx: [2] }] },
    { dx: ["J06.9"], lines: [{ cpt: "99213", dx: [1] }] },
    { dx: ["M25.561", "M17.11"], lines: [{ cpt: "99213", mods: ["25"], dx: [1] }, { cpt: "20610", dx: [2] }] },
    { dx: ["F41.1"], lines: [{ cpt: "90834", dx: [1] }] },
    { dx: ["Z23"], lines: [{ cpt: "90471", dx: [1] }, { cpt: "90686", dx: [1] }] },
    { dx: ["I10", "E78.5"], lines: [{ cpt: "99214", dx: [1, 2] }, { cpt: "93000", dx: [1] }] },
    { dx: ["H61.23"], lines: [{ cpt: "99212", mods: ["25"], dx: [1] }, { cpt: "69210", dx: [1] }] },
    { dx: ["S61.011A"], lines: [{ cpt: "12001", dx: [1] }] },
    { dx: ["F32.A"], lines: [{ cpt: "90837", dx: [1] }] },
  ];
  const fee = new Map(CPTS.map(([c, , f]) => [c, f]));
  const cptDesc = new Map(CPTS.map(([c, d]) => [c, d]));
  const created: { claimId: string; age: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const patient = patientRows[i % patientRows.length];
    const sc = scenarios[i % scenarios.length];
    const age = [3, 6, 12, 20, 27, 35, 44, 52, 61, 75, 88, 97, 105, 118][i % 14];
    const { claim } = await createEncounterWithClaim(db, practice.id, {
      patientId: patient.id,
      providerId: providerRows[i % providerRows.length].id,
      dateOfService: daysAgoDate(age),
      placeOfService: sc.lines[0].cpt.startsWith("908") ? "11" : "11",
      diagnoses: sc.dx,
      lines: sc.lines.map((l) => ({ cpt: l.cpt, modifiers: l.mods ?? [], units: 1, chargeCents: fee.get(l.cpt) ?? 10000, dxPointers: l.dx, description: cptDesc.get(l.cpt) })),
    }, admin.id);
    created.push({ claimId: claim.id, age });
  }

  // Submit everything older than 5 days; leave the newest as drafts/ready for the worklist.
  for (const c of created.filter((x) => x.age > 5)) {
    try {
      await submitClaim(db, c.claimId, admin.id);
    } catch {
      /* claims with scrub errors stay in the worklist */
    }
  }
  // Payer adjudication for claims older than ~3 weeks; newer accepted claims stay awaiting adjudication.
  const remitTargets = created.filter((x) => x.age > 20).map((x) => x.claimId);
  await fetchAndPostRemittances(db, practice.id, admin.id, remitTargets);

  // A few patient payments against transferred balances.
  for (const p of patientRows.slice(0, 6)) await postPatientPayment(db, practice.id, p.id, 2500, "card", admin.id);

  // Back-date ledger and claim timestamps to the encounter dates so trends and aging are realistic.
  await db.execute(sql`
    UPDATE ledger_entries le SET posted_at = (e.date_of_service::timestamptz + CASE WHEN le.type = 'charge' THEN interval '0 day' ELSE interval '18 day' END)
    FROM claims c JOIN encounters e ON e.id = c.encounter_id WHERE le.claim_id = c.id`);
  await db.execute(sql`UPDATE claims c SET created_at = e.date_of_service::timestamptz, submitted_at = CASE WHEN submitted_at IS NULL THEN NULL ELSE e.date_of_service::timestamptz + interval '1 day' END, updated_at = e.date_of_service::timestamptz + interval '2 day' FROM encounters e WHERE e.id = c.encounter_id`);
  await db.execute(sql`UPDATE claim_events ev SET at = c.created_at + (interval '1 hour' * (SELECT count(*) FROM claim_events x WHERE x.claim_id = ev.claim_id AND x.at <= ev.at)) FROM claims c WHERE c.id = ev.claim_id`);
  await db.execute(sql`UPDATE denials d SET created_at = c.created_at + interval '19 day' FROM claims c WHERE c.id = d.claim_id`);
  await db.execute(sql`UPDATE remittances SET received_at = now() - interval '2 day'`);
  console.log("[medbill] Seed complete.");
}
