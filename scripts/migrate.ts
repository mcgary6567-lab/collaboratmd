/**
 * Applies pending migrations before a build goes live, so no request ever
 * waits on them (package.json "build" runs this, then next build).
 *
 * - No DATABASE_URL (local builds, CI): nothing to do.
 * - Production build: migrates, and marks the database as production.
 * - Preview build on a database production uses: skipped with a warning;
 *   the preview itself refuses to start against it (docs/11-environments.md).
 * - Any other failure fails the build, and the running deployment stays as it
 *   was. Migrations must therefore work with the code already live: add
 *   columns and tables, never rename or drop in the same deploy.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/migrate.ts
 */
import { migrateNow, pendingWork } from "@/db";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("[migrate] No DATABASE_URL; nothing to migrate.");
    return;
  }
  const started = Date.now();
  try {
    const runner = await migrateNow();
    const left = await pendingWork(runner);
    if (left.migrations.length) throw new Error(`Still pending after migrating: ${left.migrations.join(", ")}`);
    console.log(`[migrate] Database is up to date (${((Date.now() - started) / 1000).toFixed(1)} s).`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (process.env.VERCEL_ENV === "preview" && /connected to the production database/.test(message)) {
      console.warn(`[migrate] Skipped: ${message}`);
      return;
    }
    console.error(`[migrate] Failed: ${message}`);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
