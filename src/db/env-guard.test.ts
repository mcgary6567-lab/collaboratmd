import { describe, expect, it } from "vitest";
import { environmentGuard } from "./index";

/** A stand-in database that remembers whether it has been marked as production. */
function fakeDb(marked = false) {
  const state = { marked, statements: [] as string[] };
  const runner = {
    shared: true,
    exec: async (q: string) => { state.statements.push(q); if (q.includes("INSERT INTO _environment")) state.marked = true; },
    db: { execute: async () => ({ rows: state.marked ? [{ label: "production" }] : [] }) },
  };
  return { runner: runner as unknown as Parameters<typeof environmentGuard>[0], state };
}

describe("keeping development off the production database", () => {
  it("lets production mark its database, and anything else use an unmarked one", async () => {
    const prod = fakeDb();
    await environmentGuard(prod.runner, { VERCEL_ENV: "production" });
    expect(prod.state.marked).toBe(true);
    const staging = fakeDb();
    await expect(environmentGuard(staging.runner, {})).resolves.toBeUndefined();
    await expect(environmentGuard(staging.runner, { VERCEL_ENV: "preview" })).resolves.toBeUndefined();
  });

  it("refuses a development server or preview on the production database unless told otherwise", async () => {
    await expect(environmentGuard(fakeDb(true).runner, {})).rejects.toThrow(/This development server is connected to the production database/);
    await expect(environmentGuard(fakeDb(true).runner, { VERCEL_ENV: "preview" })).rejects.toThrow(/This preview deployment/);
    await expect(environmentGuard(fakeDb(true).runner, { ALLOW_PRODUCTION_DATABASE: "true" })).resolves.toBeUndefined();
  });

  it("does nothing for the embedded local database", async () => {
    const local = fakeDb(true);
    (local.runner as { shared: boolean }).shared = false;
    await expect(environmentGuard(local.runner, {})).resolves.toBeUndefined();
    expect(local.state.statements).toEqual([]);
  });
});
