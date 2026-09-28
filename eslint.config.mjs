import { registerHooks } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";

// The project builds and type-checks with TypeScript 7, which has no programmatic API yet, so
// typescript-eslint refuses to load with it. As the TypeScript team recommends, the linter runs on
// TypeScript 6 (@typescript/typescript6). This hook lives only in the ESLint process, so `tsc` and
// `next build` keep TypeScript 7.
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === "typescript" ? "@typescript/typescript6" : specifier, context);
  },
});

const { default: nextVitals } = await import("eslint-config-next/core-web-vitals");
const { default: nextTs } = await import("eslint-config-next/typescript");

// Next.js 16 has no `next lint`: this is the ESLint CLI setup from the Next.js docs (npm run lint).
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore marks a parameter that must be there but is not used (a server action's previous state).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    // The server runs in UTC: a time shown to a practice goes through its time zone, or it reads hours off.
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["warn",
        { selector: "CallExpression[callee.name='fmtDateTime'][arguments.length<2]", message: "Pass the practice's time zone: fmtDateTime(date, s.timeZone). Appointment times use fmtClock." },
        { selector: "CallExpression[callee.property.name='toUTCString']", message: "Show dates with fmtDate or fmtDateTime and the practice's time zone." },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**", "playwright-report/**", "test-results/**", ".scratch/**", "public/**"]),
]);

export default eslintConfig;
