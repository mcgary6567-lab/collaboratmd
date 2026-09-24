import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000 },
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
      "server-only": path.resolve(here, "src/test/empty.ts"),
    },
  },
});
