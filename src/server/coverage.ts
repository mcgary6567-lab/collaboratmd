/**
 * Adding insurance to an existing patient, and coverage discovery: for a
 * patient with no insurance on file, asking each of the practice's payers
 * whether they cover someone with this name and date of birth.
 *
 * Discovery sends real 270 inquiries without a member ID. Whether a payer
 * answers a name-and-birthdate search depends on the payer; many do, some
 * reject it (AAA 72/75). Each answer is recorded, and nothing is added to the
 * patient until someone chooses to.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { build270, summarize271 } from "@/lib/edi/x270";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";
import { practiceConfig } from "./integrations";

const { patients, patientInsurances, payers, practices, coverageSearches, auditLog } = schema;

export type NewInsurance = { payerId: string; memberId: string; groupNumber?: string | null; relationship?: string; copayCents?: number | null; makePrimary?: boolean };

/** Adds a policy to a patient. A new primary pushes the others down one rank. */
export async function addInsurance(db: Db, practiceId: string, patientId: string, input: NewInsurance, userId?: string) {
  const memberId = input.memberId.trim().toUpperCase().slice(0, 40);
  if (!memberId) throw new Error("Enter the member ID");
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  const [payer] = await db.select({ id: payers.id }).from(payers).where(and(eq(payers.id, input.payerId), eq(payers.practiceId, practiceId))).limit(1);
  if (!payer) throw new Error("Choose the payer");
  const current = await db.select().from(patientInsurances).where(and(eq(patientInsurances.patientId, patientId), eq(patientInsurances.active, true))).orderBy(asc(patientInsurances.rank));
  if (current.some((c) => c.payerId === payer.id && c.memberId.toUpperCase() === memberId)) throw new Error("This policy is already on file");
  const relationship = ["self", "spouse", "child", "other"].includes(input.relationship ?? "") ? input.relationship! : "self";
  let rank = (current.at(-1)?.rank ?? 0) + 1;
  if (input.makePrimary || !current.length) {
    for (const c of current.reverse()) await db.update(patientInsurances).set({ rank: c.rank + 1 }).where(eq(patientInsurances.id, c.id));
    rank = 1;
  }
  const [row] = await db.insert(patientInsurances).values({
    patientId, payerId: payer.id, memberId, groupNumber: input.groupNumber?.trim().slice(0, 40) || null, rank, relationship, copayCents: input.copayCents ?? 0,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "insurance_added", entity: "patient", entityId: patientId, details: { payerId: payer.id, rank } });
  return row;
}

/* ------------------------------ Coverage discovery ------------------------------ */

/** Payers asked per patient, so one search cannot fan out to hundreds of inquiries. */
export const DISCOVERY_MAX_PAYERS = 15;

export async function discoverCoverage(db: Db, practiceId: string, patientId: string, userId?: string, serviceDate = new Date().toISOString().slice(0, 10)) {
  const [row] = await db.select({ patient: patients, practice: practices }).from(patients).innerJoin(practices, eq(practices.id, patients.practiceId)).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Patient not found");
  if (!row.patient.dob) throw new Error("A date of birth is needed to search");
  const list = (await db.select().from(payers).where(and(eq(payers.practiceId, practiceId), sql`${payers.type} <> 'self_pay'`)).orderBy(asc(payers.name))).slice(0, DISCOVERY_MAX_PAYERS);
  if (!list.length) throw new Error("Add payers first; discovery asks each of them");
  const gateway = getClearinghouse((await practiceConfig(db, practiceId)).stedi?.apiKey);
  const results: (typeof coverageSearches.$inferSelect)[] = [];
  // A few at a time: fast enough for the front desk, gentle on the clearinghouse.
  for (let i = 0; i < list.length; i += 4) {
    const batch = await Promise.all(list.slice(i, i + 4).map(async (payer, j) => {
      const now = new Date();
      const trace = `D${now.getTime().toString(36).toUpperCase()}${i + j}`;
      const edi = build270({
        senderId: "COLLABORATMD", receiverId: payer.payerId, now, control: String((now.getTime() + i + j) % 1_000_000_000), traceNumber: trace,
        payer: { name: payer.name, payerId: payer.payerId }, provider: { name: row.practice.name, npi: row.practice.npi },
        subscriber: { lastName: row.patient.lastName, firstName: row.patient.firstName, memberId: "", dob: row.patient.dob, sex: row.patient.sex },
        serviceDate,
      });
      let status = "error", memberId: string | null = null, planName: string | null = null, message: string | null = null;
      try {
        const answer = await gateway.checkEligibility(edi);
        const summary = summarize271(answer.response);
        if (summary.status === "active" && answer.response.memberId) {
          status = "found"; memberId = answer.response.memberId; planName = summary.planName ?? null;
        } else {
          status = summary.status === "error" ? "error" : "not_found";
          message = summary.message ?? null;
        }
      } catch (e) {
        message = e instanceof Error ? e.message.slice(0, 200) : "The clearinghouse did not answer";
      }
      const [saved] = await db.insert(coverageSearches).values({ practiceId, patientId, payerId: payer.id, status, memberId, planName, message, checkedBy: userId ?? null }).returning();
      return saved;
    }));
    results.push(...batch);
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "coverage_discovery", entity: "patient", entityId: patientId, details: { payers: list.length, found: results.filter((r) => r.status === "found").length } });
  return results;
}

/** The most recent answer from each payer for this patient. */
export async function latestSearches(db: Db, practiceId: string, patientId: string) {
  const rows = await db
    .select({ search: coverageSearches, payerName: payers.name })
    .from(coverageSearches)
    .innerJoin(payers, eq(payers.id, coverageSearches.payerId))
    .where(and(eq(coverageSearches.practiceId, practiceId), eq(coverageSearches.patientId, patientId)))
    .orderBy(desc(coverageSearches.createdAt))
    .limit(100);
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.search.payerId) ? false : (seen.add(r.search.payerId), true)));
}

export async function addDiscoveredCoverage(db: Db, practiceId: string, searchId: string, userId?: string) {
  const [s] = await db.select().from(coverageSearches).where(and(eq(coverageSearches.id, searchId), eq(coverageSearches.practiceId, practiceId))).limit(1);
  if (!s || s.status !== "found" || !s.memberId) throw new Error("Nothing found to add");
  if (s.addedInsuranceId) throw new Error("Already added");
  const ins = await addInsurance(db, practiceId, s.patientId, { payerId: s.payerId, memberId: s.memberId }, userId);
  await db.update(coverageSearches).set({ addedInsuranceId: ins.id }).where(eq(coverageSearches.id, s.id));
  return ins;
}

/** Patients with a balance or an upcoming visit but no active insurance: who discovery is for. */
export async function selfPayCandidates(db: Db, practiceId: string, limit = 100) {
  const { rows } = await db.execute<{ id: string; first_name: string; last_name: string; mrn: string; dob: string | null; next_visit: string | null; last_search: string | null; found: string }>(sql`
    SELECT p.id, p.first_name, p.last_name, p.mrn, p.dob::text AS dob,
      (SELECT min(a.starts_at)::date::text FROM appointments a WHERE a.patient_id = p.id AND a.starts_at >= now() AND a.status = 'scheduled') AS next_visit,
      (SELECT max(cs.created_at)::date::text FROM coverage_searches cs WHERE cs.patient_id = p.id) AS last_search,
      (SELECT count(*) FROM coverage_searches cs WHERE cs.patient_id = p.id AND cs.status = 'found' AND cs.added_insurance_id IS NULL)::text AS found
    FROM patients p
    WHERE p.practice_id = ${practiceId}
      AND NOT EXISTS (SELECT 1 FROM patient_insurances pi JOIN payers py ON py.id = pi.payer_id WHERE pi.patient_id = p.id AND pi.active AND py.type <> 'self_pay')
    ORDER BY next_visit NULLS LAST, p.last_name
    LIMIT ${limit}`);
  return rows;
}


const STATES = "alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode island tennessee texas utah vermont virginia washington wisconsin wyoming new north south west east central".split(" ");
/** Words that say nothing about which payer is meant: filler, and places (many payers operate in the same state). */
const STOP = new Set(["of", "the", "and", "inc", "health", "healthcare", "insurance", "plan", "plans", "company", "co", "medical", "care", "group", ...STATES]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The practice payer a card's printed name most likely means, or null when nothing shares a distinctive word. */
export function matchPayer(printed: string | null, list: { id: string; name: string }[]): string | null {
  if (!printed) return null;
  const want = new Set(words(printed));
  // "BlueCross BlueShield" and "Blue Cross Blue Shield" are the same name once spaces are ignored.
  const exact = list.find((p) => compact(p.name) === compact(printed));
  if (exact) return exact.id;
  const joined = compact(words(printed).join(""));
  let best: { id: string; score: number } | null = null;
  for (const p of list) {
    const theirs = compact(words(p.name).join(""));
    if (theirs.length >= 5 && (joined.includes(theirs) || theirs.includes(joined))) {
      if (!best || best.score < 1) best = { id: p.id, score: 1 };
      continue;
    }
    const have = words(p.name);
    const shared = have.filter((w) => want.has(w)).length;
    if (!shared) continue;
    const score = shared / Math.max(have.length, want.size);
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best?.id ?? null;
}
