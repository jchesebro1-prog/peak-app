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
    // Vendored third-party build artifacts we neither write nor can fix.
    // public/pdf.worker.min.mjs is pdfjs-dist's minified worker, re-copied
    // verbatim by `npm run sync:pdf-worker`; linting it produced 1577 of the
    // repo's 1600 warnings and buried every real finding under minifier
    // output. Linting anything under public/ is meaningless for the same
    // reason — nothing there is authored here.
    "public/**",
  ]),
  {
    rules: {
      /**
       * react-hooks/purity arrived as an error with eslint-config-next 16 and
       * flagged 37 sites, every one of them a `Date.now()` read. None is a
       * defect here:
       *   - 26 are in server components, where reading the clock during
       *     render is how a server-rendered page gets "now" in the first place;
       *   - 9 are inside event handlers and the doc-builders they call
       *     (field-work, flame-tests/results, inspections, venue-assessments
       *     controls), which the rule cannot tell apart from render;
       *   - 2 are deliberate render-time reads in client components — the
       *     "milestones due in 60 days" count and the today-marker on the
       *     consulting timeline. Both are SUPPOSED to re-read on render.
       *
       * The guarantee this rule protects is React Compiler's, and the compiler
       * is neither enabled in next.config.ts nor installed. Kept as a warning
       * rather than switched off so the signal stays visible.
       *
       * RAISE BACK TO "error" if babel-plugin-react-compiler is ever turned
       * on — at that point the 2 client-component reads become real
       * memoization hazards and need useMemo/key treatment.
       */
      "react-hooks/purity": "warn",
    },
  },
  {
    /**
     * Internal verification scripts, never bundled and never shipped. Their
     * 23 `any`s are all fixture construction — deliberately partial or
     * deliberately wrong shapes fed to a function to assert how it reacts,
     * which is the one place `any` earns its keep. Retyping them would mean
     * building complete valid fixtures for cases whose entire point is being
     * incomplete, inside the script the rest of the suite is verified by.
     *
     * Kept as a warning, and scoped to scripts/ so nothing that reaches the
     * browser or the server is covered by this relaxation.
     */
    files: ["scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
]);

export default eslintConfig;
