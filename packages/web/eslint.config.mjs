import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Codama-generated client — regenerated on every IDL change. The
    // generator emits some patterns ESLint complains about (`{}` types,
    // unused exports) but rewriting them by hand would defeat the
    // generator. Trust the upstream output.
    "app/lib/generated/**",
  ]),
]);

export default eslintConfig;
