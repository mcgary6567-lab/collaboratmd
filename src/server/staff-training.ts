/**
 * Staff training and certifications. HIPAA requires security awareness
 * training for the whole workforce; most practices repeat it every year, and
 * so this treats HIPAA training as good for a year unless another expiry date
 * is entered. Certifications (CPC, CPB, CCS and others) carry the expiry date
 * the certifying body gives. Each person can sign for their own training; an
 * administrator can record anyone's. The morning checks remind the person and
 * the administrators 60 days before something expires, when it has expired,
 * and when someone has no HIPAA training on record.
 *
 * Provider licenses and credentials are separate (server/credentials.ts).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { assignableUsers } from "./work";
import { notify } from "./notifications";

const { staffTraining, auditLog } = schema;
export const TRAINING_KINDS: Record<string, string> = { hipaa: "HIPAA training", certification: "Certification", other: "Other training" };
export const EXPIRY_WARN_DAYS = 60;
const DAY = 86_400_000;
const isDate = (v?: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nextYear = (date: string) => `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;

export type TrainingState = "current" | "expiring" | "expired";
export function trainingState(expiresOn: string | null, today: string): TrainingState {
  if (!expiresOn) return "current";
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, EXPIRY_WARN_DAYS) ? "expiring" : "current";
}

export async function recordTraining(db: Db, practiceId: string, by: string, isAdmin: boolean, input: { userId: string; kind: string; name?: string; completedOn: string; expiresOn?: string; credentialNo?: string }, now = new Date()) {
  if (!isAdmin && input.userId !== by) throw new Error("You can only sign for your own training");
  if (!(await assignableUsers(db, practiceId)).some((u) => u.id === input.userId)) throw new Error("That person is not on this practice's team");
  if (!TRAINING_KINDS[input.kind]) throw new Error("Choose the kind of training");
  if (!isDate(input.completedOn)) throw new Error("Enter the date it was completed");
  if (input.completedOn > now.toISOString().slice(0, 10)) throw new Error("The completion date cannot be in the future");
  const name = (input.name?.trim() || (input.kind === "hipaa" ? "HIPAA training" : "")).slice(0, 120);
  if (!name) throw new Error("Name the training or certification, for example CPC");
  const expiresOn = isDate(input.expiresOn) ? input.expiresOn! : input.kind === "hipaa" ? nextYear(input.completedOn) : null;
  if (expiresOn && expiresOn <= input.completedOn) throw new Error("The expiry date must be after the completion date");
  const [row] = await db.insert(staffTraining).values({
    practiceId, userId: input.userId, kind: input.kind, name, completedOn: input.completedOn, expiresOn,
    credentialNo: input.credentialNo?.trim().slice(0, 60) || null, attested: input.userId === by, createdBy: by,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: by, action: "staff_training_recorded", entity: "user", entityId: input.userId, details: { kind: input.kind, name, completedOn: input.completedOn, expiresOn, attested: row.attested } });
  return row;
}

export async function removeTraining(db: Db, practiceId: string, id: string, by: string) {
  const [row] = await db.delete(staffTraining).where(and(eq(staffTraining.id, id), eq(staffTraining.practiceId, practiceId))).returning();
  if (!row) throw new Error("Not found");
  await db.insert(auditLog).values({ practiceId, userId: by, action: "staff_training_removed", entity: "user", entityId: row.userId, details: { kind: row.kind, name: row.name } });
}

/** Each person on the team: their records (newest first), the latest of each training or certification, and their HIPAA state. */
export async function trainingStatus(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const team = await assignableUsers(db, practiceId);
  const ids = team.map((t) => t.id);
  const records = ids.length ? await db.select().from(staffTraining).where(and(eq(staffTraining.practiceId, practiceId), inArray(staffTraining.userId, ids))).orderBy(desc(staffTraining.completedOn)) : [];
  return team.map((t) => {
    const mine = records.filter((r) => r.userId === t.id);
    // The newest record of each training or certification counts; an older one it replaced does not need renewing.
    const latest = new Map<string, (typeof mine)[number]>();
    for (const r of mine) if (!latest.has(`${r.kind}:${r.name.toLowerCase()}`)) latest.set(`${r.kind}:${r.name.toLowerCase()}`, r);
    const current = [...latest.values()];
    const hipaa = current.find((r) => r.kind === "hipaa");
    const hipaaState: TrainingState | "missing" = hipaa ? trainingState(hipaa.expiresOn, today) : "missing";
    const attention = current.filter((r) => trainingState(r.expiresOn, today) !== "current");
    return { userId: t.id, name: t.name, records: mine, current, hipaaState, attention };
  });
}

/** From the morning checks: reminders to the person and the administrators. Each fires once per record and state. */
export async function trainingReminders(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let sent = 0;
  for (const p of await trainingStatus(db, practiceId, now)) {
    if (p.hipaaState === "missing") {
      await notify(db, practiceId, { userId: p.userId, kind: "training", title: "No HIPAA training on record for you: complete it and sign for it", href: "/work/training", dedupeKey: `training-missing:${p.userId}:${today.slice(0, 7)}` });
      sent++;
    }
    for (const r of p.attention) {
      const state = trainingState(r.expiresOn, today);
      const title = `${r.name} ${state === "expired" ? "has expired" : `expires ${r.expiresOn}`}`;
      await notify(db, practiceId, { userId: p.userId, kind: "training", title: `Your ${title}`, href: "/work/training", dedupeKey: `training:${r.id}:${state}:self` });
      await notify(db, practiceId, { kind: "training", title: `${p.name}: ${title}`, href: "/work/training", dedupeKey: `training:${r.id}:${state}:admins` });
      sent++;
    }
  }
  return sent;
}
