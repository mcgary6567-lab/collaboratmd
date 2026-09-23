import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { needsSsl, poolSize } from "./connection";

const SQL_DIR = path.join(process.cwd(), "src", "db", "migrations");

describe("bundled migrations", () => {
  it("match the .sql sources exactly", () => {
    const files = fs
      .readdirSync(SQL_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files.map((f) => path.basename(f, ".sql")));
    for (const migration of MIGRATIONS) {
      // Compared with normalized line endings so the check does not depend on
      // the platform or Git's autocrlf setting.
      const source = fs.readFileSync(path.join(SQL_DIR, `${migration.name}.sql`), "utf8").replaceAll("\r\n", "\n");
      expect(migration.sql, `${migration.name} is stale - run: npm run build:migrations`).toBe(source);
    }
  });

  it("creates every table the schema depends on", () => {
    const sql = MIGRATIONS.map((m) => m.sql).join("\n");
    const required = [
      "practices",
      "users",
      "providers",
      "payers",
      "patients",
      "patient_insurances",
      "eligibility_checks",
      "appointments",
      "encounters",
      "charges",
      "claims",
      "claim_events",
      "remittances",
      "ledger_entries",
      "denials",
      "cpt_codes",
      "icd10_codes",
      "audit_log",
    ];
    for (const table of required) {
      expect(sql, `missing table ${table}`).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
  });
});

describe("connection settings", () => {
  it("requires TLS for managed providers and not for local servers", () => {
    expect(needsSsl("postgres://u:p@ep-cool-name.us-east-2.aws.neon.tech/db")).toBe(true);
    expect(needsSsl("postgres://u:p@db.abcdefgh.supabase.co:5432/postgres")).toBe(true);
    expect(needsSsl("postgres://u:p@localhost:5432/collaboratmd")).toBe(false);
    expect(needsSsl("postgres://u:p@127.0.0.1:5432/collaboratmd")).toBe(false);
    expect(needsSsl("postgres://u:p@db.example.com/collaboratmd?sslmode=disable")).toBe(false);
  });

  it("uses a single connection per serverless instance", () => {
    expect(poolSize(true)).toBe(1);
    expect(poolSize(false)).toBeGreaterThan(1);
  });
});
