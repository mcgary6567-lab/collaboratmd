/**
 * Generates src/db/migrations.ts from the .sql files in src/db/migrations/.
 *
 * Migrations ship inside the compiled bundle because the app runs on
 * serverless platforms where the source tree is not present at runtime.
 * Run this after adding or editing a migration: `npm run build:migrations`.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join("src", "db", "migrations");
const OUT = path.join("src", "db", "migrations.ts");

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No .sql files found in ${DIR}`);
  process.exit(1);
}

/**
 * Escapes SQL for embedding in a TypeScript template literal.
 *
 * Line endings are normalized first so the generated file is identical
 * regardless of the platform or Git's autocrlf setting.
 */
function escapeForTemplate(sql) {
  return sql.replaceAll("\r\n", "\n").replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}

const entries = files
  .map((file) => {
    const sql = escapeForTemplate(fs.readFileSync(path.join(DIR, file), "utf8"));
    return `  {\n    name: ${JSON.stringify(path.basename(file, ".sql"))},\n    sql: \`${sql}\`,\n  },\n`;
  })
  .join("");

const out = `/**
 * Database migrations, applied in order and recorded in the _migrations table.
 *
 * GENERATED FILE - do not edit by hand.
 * Source: src/db/migrations/*.sql   Regenerate: npm run build:migrations
 *
 * These are compiled into the bundle rather than read from disk at runtime so
 * they are available on serverless platforms, which deploy only the build
 * output and not the source tree.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [
${entries}];
`;

fs.writeFileSync(OUT, out);
console.log(`Wrote ${OUT} from ${files.length} migration(s): ${files.join(", ")}`);
