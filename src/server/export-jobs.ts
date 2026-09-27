/**
 * Full exports prepared in the background when file storage is configured:
 * the zip streams into the private store while the administrator does
 * something else, and is downloadable for a week. Without file storage the
 * export streams straight to the browser instead (see the export route).
 *
 * A practice too large for one run is exported in parts (planExportParts).
 * Each run builds parts until its time budget is nearly spent, then starts the
 * next run through a signed link to /api/export/jobs/<id>/continue, so no
 * single run is cut off by the platform's time limit.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { fileStore } from "./files";
import { planExportParts, practiceExport } from "./practice-export";
import { notify } from "./notifications";

const { exportJobs, auditLog } = schema;
export const KEEP_DAYS = 7;
/** Stop starting new parts after this long in one run (the platform allows 300 s). */
export const RUN_BUDGET_MS = 180_000;

export async function queueExport(db: Db, practiceId: string, userId?: string) {
  if (!fileStore()) throw new Error("Background exports need file storage; download the export directly instead");
  const [running] = await db.select({ id: exportJobs.id }).from(exportJobs).where(and(eq(exportJobs.practiceId, practiceId), inArray(exportJobs.status, ["queued", "running"]))).limit(1);
  if (running) throw new Error("An export is already being prepared");
  const [job] = await db.insert(exportJobs).values({ practiceId, requestedBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "export", entity: "practice", entityId: practiceId, details: { full: true, background: true, job: job.id } });
  return job;
}

export function continuationToken(jobId: string) {
  return createHmac("sha256", Buffer.from(appSecret())).update(`export-continue:${jobId}`).digest("base64url");
}
export function validContinuation(jobId: string, token: string) {
  const want = Buffer.from(continuationToken(jobId));
  const got = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

type RunOpts = { now?: () => Date; budgetMs?: number; continueWith?: (jobId: string) => Promise<void>; planOpts?: Parameters<typeof planExportParts>[2] };

/**
 * Builds parts of the export until done or out of time. Returns what it did.
 * Parts are claimed one at a time (next_part goes negative while one is being
 * built), so an extra continuation never builds the same part twice.
 */
export async function runExport(db: Db, jobId: string, opts: RunOpts = {}) {
  const now = opts.now ?? (() => new Date());
  const store = fileStore();
  const started = Date.now();
  // First run: plan the parts.
  const [fresh] = await db.update(exportJobs).set({ status: "running" }).where(and(eq(exportJobs.id, jobId), eq(exportJobs.status, "queued"))).returning();
  if (fresh) await db.update(exportJobs).set({ plan: await planExportParts(db, fresh.practiceId, opts.planOpts) }).where(eq(exportJobs.id, jobId));
  let built = 0;
  try {
    for (;;) {
      const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
      if (!job || job.status !== "running" || !store || !job.plan) return job?.status === "done" ? { done: true, built } : null;
      const k = job.nextPart;
      if (k < 0) return { done: false, built };
      if (k >= job.plan.length) break;
      const [claimed] = await db.update(exportJobs).set({ nextPart: -(k + 1) }).where(and(eq(exportJobs.id, jobId), eq(exportJobs.nextPart, k))).returning();
      if (!claimed) return { done: false, built };
      const total = job.plan.length;
      let bytes = 0;
      const it = practiceExport(db, job.practiceId, now(), { segments: job.plan[k], index: k, total });
      const body = new ReadableStream<Uint8Array>({
        async pull(c) {
          const { value, done } = await it.next();
          if (done) c.close();
          else { bytes += value.length; c.enqueue(value); }
        },
      });
      const date = now().toISOString().slice(0, 10);
      const key = await store.put(`practices/${job.practiceId}/exports/collaboratmd-export-${date}${total > 1 ? `-part${k + 1}of${total}` : ""}.zip`, body, "application/zip");
      await db.update(exportJobs).set({ parts: [...job.parts, { key, bytes }], nextPart: k + 1, storageKey: job.storageKey ?? key, bytes: (job.bytes ?? 0) + bytes }).where(eq(exportJobs.id, jobId));
      built++;
      if (k + 1 < total && Date.now() - started > (opts.budgetMs ?? RUN_BUDGET_MS)) {
        await (opts.continueWith ?? continueInNewRun)(jobId);
        return { done: false, built };
      }
    }
    const finished = now();
    const [job] = await db.update(exportJobs).set({ status: "done", finishedAt: finished, expiresAt: new Date(finished.getTime() + KEEP_DAYS * 86_400_000) }).where(and(eq(exportJobs.id, jobId), eq(exportJobs.status, "running"))).returning();
    if (job) await notify(db, job.practiceId, { userId: job.requestedBy, kind: "export_ready", title: "Your practice data export is ready", body: `It can be downloaded for ${KEEP_DAYS} days${job.parts.length > 1 ? `, in ${job.parts.length} parts` : ""}.`, href: "/settings/data-export", dedupeKey: `export:${jobId}` });
    return { done: true, built };
  } catch (e) {
    await db.update(exportJobs).set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Export failed", finishedAt: now() }).where(eq(exportJobs.id, jobId));
    throw e;
  }
}

/** Starts the next run through the app's own address; the request carries a token only this server can make. */
async function continueInNewRun(jobId: string) {
  // The configured address, not the per-deployment one, which deployment protection may put behind a sign-in.
  const origin = process.env.APP_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!origin) throw new Error("Set APP_URL so a large export can continue in a new run");
  const res = await fetch(`${origin.replace(/\/$/, "")}/api/export/jobs/${jobId}/continue`, { method: "POST", headers: { Authorization: `Bearer ${continuationToken(jobId)}` } });
  if (!res.ok) throw new Error(`Could not continue the export (${res.status})`);
}

export async function listExports(db: Db, practiceId: string) {
  return db.select().from(exportJobs).where(eq(exportJobs.practiceId, practiceId)).orderBy(desc(exportJobs.createdAt)).limit(10);
}

export async function openExport(db: Db, practiceId: string, jobId: string, now = new Date(), part = 0) {
  const [job] = await db.select().from(exportJobs).where(and(eq(exportJobs.id, jobId), eq(exportJobs.practiceId, practiceId))).limit(1);
  if (!job || job.status !== "done" || (job.expiresAt && job.expiresAt <= now)) return null;
  const key = job.parts[part]?.key ?? (part === 0 ? job.storageKey : null);
  if (!key) return null;
  const stream = await fileStore()?.get(key);
  return stream ? { job, stream, part, parts: Math.max(job.parts.length, 1) } : null;
}

/** Daily: exports past their week are deleted from the store. */
export async function expireExports(db: Db, now = new Date()) {
  const old = await db.select().from(exportJobs).where(and(eq(exportJobs.status, "done"), lte(exportJobs.expiresAt, now)));
  const keys = [...new Set(old.flatMap((j) => [j.storageKey, ...j.parts.map((p) => p.key)]).filter((k): k is string => !!k))];
  if (keys.length) await fileStore()?.del(keys);
  if (old.length) await db.update(exportJobs).set({ status: "expired", storageKey: null, parts: [] }).where(inArray(exportJobs.id, old.map((j) => j.id)));
  return old.length;
}
