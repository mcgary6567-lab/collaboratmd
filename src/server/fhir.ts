/**
 * Patients and finished visits from an EHR over FHIR R4 (Epic, Cerner/Oracle
 * Health, athenahealth and others expose it). Each run reads Patients and
 * Encounters changed since the last run:
 *
 *  - Patients are matched by their FHIR id, then by name and date of birth,
 *    and created if new. Demographics are updated from the EHR.
 *  - A finished Encounter becomes a completed appointment with the provider
 *    whose NPI matches the Practitioner on it. It then shows under Missed
 *    charges until someone enters its charges, which is where coding happens.
 *
 * Authentication is a bearer token the practice pastes (from the EHR's
 * backend app registration). Obtaining tokens automatically with SMART
 * backend services (signed JWT client assertions) is not built. Read only:
 * nothing is written back to the EHR.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { seal, unseal } from "@/lib/seal";

const { fhirConnections, patients, appointments, providers, auditLog } = schema;
const MAX_PAGES = 20;

type Http = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Resource = Record<string, unknown> & { resourceType: string; id: string };
type Bundle = { entry?: { resource?: Resource }[]; link?: { relation: string; url: string }[] };

export async function getFhir(db: Db, practiceId: string) {
  const [row] = await db.select().from(fhirConnections).where(eq(fhirConnections.practiceId, practiceId)).limit(1);
  return row ?? null;
}

export async function saveFhir(db: Db, practiceId: string, input: { baseUrl: string; token?: string }, userId?: string) {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  if (!/^https:\/\/[^\s]+$/.test(baseUrl)) throw new Error("Enter the FHIR base URL (https), e.g. https://fhir.example.org/r4");
  const existing = await getFhir(db, practiceId);
  const token = input.token?.trim();
  const tokenSealed = token ? seal(token, appSecret()) : existing?.tokenSealed ?? null;
  await db.insert(fhirConnections).values({ practiceId, baseUrl, tokenSealed }).onConflictDoUpdate({ target: fhirConnections.practiceId, set: { baseUrl, tokenSealed } });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "fhir_saved", entity: "practice", entityId: practiceId, details: { baseUrl } });
}

export async function removeFhir(db: Db, practiceId: string, userId?: string) {
  await db.delete(fhirConnections).where(eq(fhirConnections.practiceId, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "fhir_removed", entity: "practice", entityId: practiceId });
}

function client(conn: { baseUrl: string; tokenSealed: string | null }, http: Http) {
  const headers: Record<string, string> = { Accept: "application/fhir+json" };
  if (conn.tokenSealed) headers.Authorization = `Bearer ${unseal(conn.tokenSealed, appSecret())}`;
  return async (url: string) => {
    const full = url.startsWith("http") ? url : `${conn.baseUrl}/${url}`;
    // Follow-up page links must stay on the same server, so a token is never sent elsewhere.
    if (!full.startsWith(conn.baseUrl)) throw new Error("The FHIR server pointed to another host; stopping");
    const res = await http(full, { headers });
    if (!res.ok) throw new Error(`The FHIR server returned ${res.status} for ${url.split("?")[0]}`);
    return res.json();
  };
}

export async function testFhir(db: Db, practiceId: string, http: Http = fetch as unknown as Http) {
  const conn = await getFhir(db, practiceId);
  if (!conn) throw new Error("Save the FHIR connection first");
  const cap = (await client(conn, http)("metadata")) as { resourceType?: string; fhirVersion?: string; software?: { name?: string } };
  if (cap.resourceType !== "CapabilityStatement") throw new Error("That address did not answer like a FHIR server");
  return `${cap.software?.name ?? "FHIR server"}, FHIR ${cap.fhirVersion ?? "unknown version"}`;
}

async function* pages(get: (url: string) => Promise<unknown>, first: string) {
  let url: string | undefined = first;
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const b = (await get(url)) as Bundle;
    yield (b.entry ?? []).map((e) => e.resource).filter((r): r is Resource => !!r);
    url = b.link?.find((l) => l.relation === "next")?.url;
  }
}

type FhirName = { use?: string; family?: string; given?: string[] };
type FhirPatient = Resource & { name?: FhirName[]; birthDate?: string; gender?: string; telecom?: { system?: string; value?: string }[]; address?: { line?: string[]; city?: string; state?: string; postalCode?: string }[] };

export function mapPatient(p: FhirPatient) {
  const name = p.name?.find((n) => n.use === "official") ?? p.name?.[0];
  const phone = p.telecom?.find((t) => t.system === "phone")?.value ?? null;
  const email = p.telecom?.find((t) => t.system === "email")?.value ?? null;
  const addr = p.address?.[0];
  return {
    firstName: (name?.given?.[0] ?? "").trim(), lastName: (name?.family ?? "").trim(), dob: p.birthDate ?? "",
    sex: p.gender === "male" ? "M" : p.gender === "female" ? "F" : "U",
    phone, email, address1: addr?.line?.join(" ") || null, city: addr?.city ?? null, state: addr?.state?.slice(0, 2).toUpperCase() ?? null, zip: addr?.postalCode ?? null,
  };
}

const NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";

export async function syncFhir(db: Db, practiceId: string, opts: { http?: Http; now?: Date; userId?: string } = {}) {
  const conn = await getFhir(db, practiceId);
  if (!conn) throw new Error("Connect a FHIR server first");
  const get = client(conn, opts.http ?? (fetch as unknown as Http));
  const now = opts.now ?? new Date();
  const since = (conn.lastSyncAt ?? new Date(now.getTime() - 30 * 86_400_000)).toISOString();
  const result = { patientsCreated: 0, patientsUpdated: 0, visits: 0, skipped: [] as string[] };

  const ours = new Map<string, string>(); // FHIR patient id -> our patient id
  const upsertPatient = async (p: FhirPatient) => {
    const m = mapPatient(p);
    if (!m.lastName || !m.firstName || !/^\d{4}-\d{2}-\d{2}$/.test(m.dob)) { result.skipped.push(`Patient/${p.id}: missing name or birth date`); return null; }
    const [byId] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.fhirId, p.id))).limit(1);
    const [byName] = byId ? [byId] : await db.select({ id: patients.id }).from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.lastName, m.lastName), eq(patients.firstName, m.firstName), eq(patients.dob, m.dob))).limit(1);
    const found = byId ?? byName;
    const values = { firstName: m.firstName, lastName: m.lastName, dob: m.dob, sex: m.sex, ...(m.phone ? { phone: m.phone } : {}), ...(m.email ? { email: m.email } : {}), ...(m.address1 ? { address1: m.address1, city: m.city, state: m.state, zip: m.zip } : {}) };
    if (found) {
      await db.update(patients).set({ ...values, fhirId: p.id }).where(eq(patients.id, found.id));
      result.patientsUpdated++;
      ours.set(p.id, found.id);
      return found.id;
    }
    const [created] = await db.insert(patients).values({ practiceId, mrn: `FHIR-${p.id}`.slice(0, 40), fhirId: p.id, ...values }).returning();
    result.patientsCreated++;
    ours.set(p.id, created.id);
    return created.id;
  };

  for await (const batch of pages(get, `Patient?_lastUpdated=ge${encodeURIComponent(since)}&_count=100`)) {
    for (const r of batch) if (r.resourceType === "Patient") await upsertPatient(r as FhirPatient);
  }

  const npiCache = new Map<string, string | null>();
  const providerFor = async (ref: string | undefined) => {
    if (!ref?.startsWith("Practitioner/")) return null;
    if (!npiCache.has(ref)) {
      const pr = (await get(ref)) as { identifier?: { system?: string; value?: string }[] };
      npiCache.set(ref, pr.identifier?.find((i) => i.system === NPI_SYSTEM)?.value ?? null);
    }
    const npi = npiCache.get(ref);
    if (!npi) return null;
    const [p] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.practiceId, practiceId), eq(providers.npi, npi), eq(providers.active, true))).limit(1);
    return p?.id ?? null;
  };

  type FhirEncounter = Resource & { status?: string; subject?: { reference?: string }; participant?: { individual?: { reference?: string } }[]; period?: { start?: string; end?: string }; reasonCode?: { text?: string; coding?: { display?: string }[] }[] };
  for await (const batch of pages(get, `Encounter?status=finished&_lastUpdated=ge${encodeURIComponent(since)}&_count=100`)) {
    for (const r of batch) {
      const e = r as FhirEncounter;
      if (e.resourceType !== "Encounter" || e.status !== "finished" || !e.period?.start) continue;
      const [exists] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.practiceId, practiceId), eq(appointments.fhirId, e.id))).limit(1);
      if (exists) continue;
      const pid = e.subject?.reference?.replace("Patient/", "");
      if (!pid) continue;
      let patientId: string | null = ours.get(pid) ?? (await db.select({ id: patients.id }).from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.fhirId, pid))).limit(1))[0]?.id ?? null;
      if (!patientId) patientId = await upsertPatient((await get(`Patient/${pid}`)) as FhirPatient);
      if (!patientId) continue;
      let providerId: string | null = null;
      for (const part of e.participant ?? []) if (!providerId) providerId = await providerFor(part.individual?.reference);
      if (!providerId) { result.skipped.push(`Encounter/${e.id}: no provider here with the practitioner's NPI`); continue; }
      const starts = new Date(e.period.start);
      const ends = e.period.end ? new Date(e.period.end) : new Date(starts.getTime() + 30 * 60_000);
      const reason = e.reasonCode?.[0]?.text ?? e.reasonCode?.[0]?.coding?.[0]?.display ?? null;
      await db.insert(appointments).values({ practiceId, patientId, providerId, startsAt: starts, endsAt: ends, status: "completed", type: "office_visit", reason: reason?.slice(0, 200) ?? "From the EHR", fhirId: e.id });
      result.visits++;
    }
  }

  await db.update(fhirConnections).set({ lastSyncAt: now, lastResult: { ...result, skipped: result.skipped.slice(0, 20), skippedCount: result.skipped.length } }).where(eq(fhirConnections.practiceId, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "fhir_synced", entity: "practice", entityId: practiceId, details: { patientsCreated: result.patientsCreated, patientsUpdated: result.patientsUpdated, visits: result.visits, skipped: result.skipped.length } });
  return result;
}
