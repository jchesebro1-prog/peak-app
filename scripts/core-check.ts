/**
 * core:check — the estimating-core purity gate (estimator handoff, spec
 * docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md §3).
 *
 * Builds a TypeScript program from src/lib/estimating-core/index.ts alone and
 * walks every file it reaches through value AND type imports. The core has to
 * run in a browser with no server, so nothing it reaches may live under
 * src/db, src/lib/stores, src/app or src/components, be a *-server.ts or .tsx
 * file, or come from a server/UI package. A violation names the clean file
 * that imports it — that import is the edge to cut.
 *
 *   npm run core:check   → prints the closure size; exits 1 on any violation
 *   test:specs           → coreCheckChecks(ok)
 */
import * as path from "node:path";
import ts from "typescript";
import type { Ok } from "./test-inbox-org";

export const CORE_ENTRY = "src/lib/estimating-core/index.ts";

const FORBIDDEN_PATHS: Array<[RegExp, string]> = [
  [/^src\/db\//, "database layer"],
  [/^src\/lib\/stores\//, "store (database-backed)"],
  [/^src\/app\//, "route folder (import the estimating-core path)"],
  [/^src\/components\//, "React component"],
  [/-server\.tsx?$/, "server-only module"],
  [/\.tsx$/, "React component"],
];

export const FORBIDDEN_PACKAGES = new Set([
  "next", "next-auth", "react", "react-dom", "server-only", "drizzle-orm", "@electric-sql/pglite",
  "@neondatabase/serverless", "pg", "@vercel/blob", "@sparticuz/chromium", "puppeteer-core",
  "docx", "pdf-lib", "sharp", "googleapis", "@anthropic-ai/sdk",
]);

export type CoreViolation = { file: string; why: string; importedBy: string[] };
export type CoreReport = { files: string[]; violations: CoreViolation[] };

function packageOf(rel: string): string | null {
  const i = rel.lastIndexOf("node_modules/");
  if (i < 0) return null;
  const [a, b] = rel.slice(i + "node_modules/".length).split("/");
  const pkg = a.startsWith("@") ? `${a}/${b}` : a;
  // @types/react → react, @types/foo__bar → @foo/bar
  if (pkg.startsWith("@types/")) {
    const name = pkg.slice("@types/".length);
    return name.includes("__") ? `@${name.replace("__", "/")}` : name;
  }
  return pkg;
}

export function whyForbidden(rel: string): string | null {
  const pkg = packageOf(rel);
  if (pkg !== null) return FORBIDDEN_PACKAGES.has(pkg) ? `server/UI package "${pkg}"` : null;
  for (const [re, why] of FORBIDDEN_PATHS) if (re.test(rel)) return why;
  return null;
}

/** Every module a file names: import/export … from (incl. `export * as ns`,
 *  which ts.preProcessFile misses), `import("x")` types and dynamic import(). */
export function moduleSpecifiers(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function coreReport(root: string = process.cwd()): CoreReport {
  const cfg = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
  // types: [] — only what the core actually imports, not every @types package.
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, types: [] };
  const program = ts.createProgram([path.join(root, CORE_ENTRY)], options);
  const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
  const sources = program.getSourceFiles().filter((sf) => !program.isSourceFileDefaultLibrary(sf));

  const imports = new Map<string, string[]>();
  for (const sf of sources) {
    const from = rel(sf.fileName);
    const to: string[] = [];
    for (const spec of moduleSpecifiers(sf)) {
      const hit = ts.resolveModuleName(spec, sf.fileName, options, ts.sys).resolvedModule;
      if (hit) to.push(rel(hit.resolvedFileName));
    }
    imports.set(from, to);
  }

  // Walk from the entry through clean files only, so each violation is the
  // first forbidden file on a path — the import edge to cut — not everything
  // behind it.
  const byFile = new Map<string, CoreViolation>();
  const seen = new Set<string>([CORE_ENTRY]);
  const queue = [CORE_ENTRY];
  while (queue.length) {
    const from = queue.shift()!;
    for (const to of imports.get(from) ?? []) {
      const why = whyForbidden(to);
      if (why) {
        const v = byFile.get(to) ?? { file: to, why, importedBy: [] };
        if (!v.importedBy.includes(from)) v.importedBy.push(from);
        byFile.set(to, v);
      } else if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  const files = [...seen].sort();
  const violations = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  return { files, violations };
}

export function formatViolations(v: CoreViolation[]): string {
  return v.map((x) => `  ${x.file}  [${x.why}]\n    ← ${x.importedBy.join("\n    ← ")}`).join("\n");
}

export async function coreCheckChecks(ok: Ok) {
  const r = coreReport();
  ok(r.files.includes("src/lib/estimating-core/pricing.ts"), "core:check: the closure reaches estimating-core/pricing.ts");
  ok(r.files.includes("src/lib/estimating-core/types.ts"), "core:check: the closure reaches estimating-core/types.ts");
  ok(r.violations.length === 0, `core:check: estimating-core is browser-pure (${r.files.length} files)` +
    (r.violations.length ? `\n${formatViolations(r.violations)}` : ""));
  const probe = ts.createSourceFile("probe.ts", 'export * as ns from "a"; import type { T } from "b"; type U = import("c").U; export { x } from "d"; void import("e");', ts.ScriptTarget.ES2017);
  ok(moduleSpecifiers(probe).join(",") === "a,b,c,d,e", "core:check: moduleSpecifiers sees export * as, import type, import() types, re-exports and dynamic import()");
  ok(whyForbidden("src/lib/stores/quotes.ts") !== null && whyForbidden("node_modules/@types/react/index.d.ts") !== null &&
    whyForbidden("node_modules/zod/index.d.ts") === null && whyForbidden("src/lib/rack/rules.ts") === null,
    "core:check: the forbidden-path rules classify stores, @types/react, zod and a pure lib module correctly");
}

if (process.argv[1]?.endsWith("core-check.ts")) {
  const r = coreReport();
  if (r.violations.length) {
    console.error(`estimating-core is NOT browser-pure — ${r.violations.length} violation(s):\n${formatViolations(r.violations)}`);
    process.exit(1);
  }
  console.log(`estimating-core is browser-pure: ${r.files.length} files in its closure, 0 violations.`);
}
