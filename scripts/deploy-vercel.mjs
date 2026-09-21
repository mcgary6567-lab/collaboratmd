/**
 * Deploys this project to Vercel with the environment it needs.
 *
 *   npm run deploy
 *
 * Requires a Vercel login: either run `npx vercel login` first, or set
 * VERCEL_TOKEN. Reads DATABASE_URL from .env.local (created by
 * `npx neon@latest claim create`), generates AUTH_SECRET if absent, uploads
 * both to the Production environment, then deploys.
 *
 * Secret values are passed to the Vercel CLI over stdin and never printed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const ENV_FILE = ".env.local";
const REQUIRED = ["DATABASE_URL", "AUTH_SECRET"];
const OPTIONAL = ["SEED_DEMO_DATA", "ANTHROPIC_API_KEY"];

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function vercel(args, { input } = {}) {
  const result = spawnSync("npx", ["--yes", "vercel@latest", ...args], {
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const fileEnv = readEnvFile(ENV_FILE);
const env = {
  DATABASE_URL: process.env.DATABASE_URL || fileEnv.DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET || fileEnv.AUTH_SECRET,
  SEED_DEMO_DATA: process.env.SEED_DEMO_DATA || fileEnv.SEED_DEMO_DATA,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || fileEnv.ANTHROPIC_API_KEY,
};

if (!env.DATABASE_URL) {
  console.error(
    `No DATABASE_URL found in the environment or ${ENV_FILE}.\n` +
      "Create a Neon database first:\n\n  npx neon@latest claim create --service postgres --file .env.local\n",
  );
  process.exit(1);
}

if (!env.AUTH_SECRET) {
  env.AUTH_SECRET = randomBytes(32).toString("base64");
  fs.appendFileSync(ENV_FILE, `\nAUTH_SECRET=${env.AUTH_SECRET}\n`);
  console.log(`Generated AUTH_SECRET and saved it to ${ENV_FILE}`);
}

const auth = vercel(["whoami"]);
if (auth.code !== 0 || /login_required|not authenticated/i.test(auth.out)) {
  console.error(
    "Not signed in to Vercel.\n\n" +
      "  Run:  npx vercel login\n" +
      "  Or:   set VERCEL_TOKEN=<token from vercel.com/account/tokens>\n",
  );
  process.exit(1);
}

console.log("Linking project...");
const link = vercel(["link", "--yes"]);
if (link.code !== 0) {
  console.error(link.out);
  process.exit(1);
}

for (const key of [...REQUIRED, ...OPTIONAL]) {
  const value = env[key];
  if (!value) continue;
  // Replace any existing value so re-running the script is idempotent.
  vercel(["env", "rm", key, "production", "--yes"]);
  const added = vercel(["env", "add", key, "production"], { input: `${value}\n` });
  console.log(added.code === 0 ? `  set ${key}` : `  FAILED to set ${key}: ${added.out.trim()}`);
  if (added.code !== 0) process.exit(1);
}

console.log("Deploying to production...");
try {
  execFileSync("npx", ["--yes", "vercel@latest", "deploy", "--prod"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
} catch {
  process.exit(1);
}
