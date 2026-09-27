/**
 * Full exports prepared in the background when file storage is configured:
 * the zip streams into the private store while the administrator does
 * something else, and is downloadable for a week. Without file storage the
 * export streams straight to the browser instead (see the export route).
 */
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { fileStore } from "./files";
import { practiceExport } from "./practice-export";
import { notify } from "./notifications";

const { exportJobs, auditLog } = schema;
export const KEEP_DAYS = 7;

export async function queueExport(db: Db, practiceId: string, userId?: string) {
  if (!fileStore()) throw new Error("Background exports need file storage; download the export directly instead");
  const [running] = await db.select({ id: exportJobs.id }).from(exportJobs).where(and(eq(exportJobs.practiceId, practiceId), inArray(exportJobs.status, ["queued", "running"]))).limit(1);
  if (running) throw new Error("An export is already being prepared");
  const [job] = await db.insert(exportJobs).values({ practiceId, requestedBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "export", entity: "practice", entityId: practiceId, details: { full: true, background: true, job: job.id } });
  return job;
}

/** Builds the zip into the store. Safe to call twice: only a queued job runs. */
export async function runExport(db: Db, jobId: string, now = () => new Date()) {
  const store = fileStore();
  const [job] = await db.update(exportJobs).set({ status: "running" }).where(and(eq(exportJobs.id, jobId), eq(exportJobs.status, "queued"))).returning();
  if (!job || !store) return null;
  try {
    let bytes = 0;
    const it = practiceExport(db, job.practiceId, now());
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        const { value, done } = await it.next();
        if (done) c.close();
        else { bytes += value.length; c.enqueue(value); }
      },
    });
    const key = await store.put(`practices/${job.practiceId}/exports/collaboratmd-export-${now().toISOString().slice(0, 10)}.zip`, body, "application/zip");
    const finished = now();
    await db.update(exportJobs).set({ status: "done", storageKey: key, bytes, finishedAt: finished, expiresAt: new Date(finished.getTime() + KEEP_DAYS * 86_400_000) }).where(eq(exportJobs.id, jobId));
    await notify(db, job.practiceId, { userId: job.requestedBy, kind: "export_ready", title: "Your practice data export is ready", body: `It can be downloaded for ${KEEP_DAYS} days.`, href: "/settings/data-export", dedupeKey: `export:${jobId}` });
    return { bytes };
  } catch (e) {
    await db.update(exportJobs).set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Export failed", finishedAt: now() }).where(eq(exportJobs.id, jobId));
    throw e;
  }
}

export async function listExports(db: Db, practiceId: string) {
  return db.select().from(exportJobs).where(eq(exportJobs.practiceId, practiceId)).orderBy(desc(exportJobs.createdAt)).limit(10);
}

export async function openExport(db: Db, practiceId: string, jobId: string, now = new Date()) {
  const [job] = await db.select().from(exportJobs).where(and(eq(exportJobs.id, jobId), eq(exportJobs.practiceId, practiceId))).limit(1);
  if (!job || job.status !== "done" || !job.storageKey || (job.expiresAt && job.expiresAt <= now)) return null;
  const stream = await fileStore()?.get(job.storageKey);
  return stream ? { job, stream } : null;
}

/** Daily: exports past their week are deleted from the store. */
export async function expireExports(db: Db, now = new Date()) {
  const old = await db.select().from(exportJobs).where(and(eq(exportJobs.status, "done"), lte(exportJobs.expiresAt, now)));
  const keys = old.map((j) => j.storageKey).filter((k): k is string => !!k);
  if (keys.length) await fileStore()?.del(keys);
  if (old.length) await db.update(exportJobs).set({ status: "expired", storageKey: null }).where(inArray(exportJobs.id, old.map((j) => j.id)));
  return old.length;
}
