/**
 * core:check — the estimating-core purity gate (estimator handoff, spec
 * docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md §3).
 *
 * Builds a TypeScript program from src/lib/estimating-core/index.ts alone and
 * walks every file it reaches through value AND type imports. The core has to
 * run in a browser with no server, so nothing it reaches may live under
 * src/db, src/lib/stores, src/app or src/components, be a *-server.ts or .tsx
 * file, or come from a server/UI package. A violation names the clean file
 * that imports it — that import is the edge to cut. An import TypeScript
 * cannot resolve is an edge too: a Node built-in (fs, node:crypto) or a
 * forbidden package (server-only) is refused by name, anything else is refused
 * as unverifiable. A file whose directive prologue holds "use server" / "use client" is refused.
 *
 *   npm run core:check   → prints the closure size; exits 1 on any violation
 *   test:specs           → coreCheckChecks(ok)
 */
import * as fs from "node:fs";
import { isBuiltin } from "node:module";
import * as os from "node:os";
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

const UNRESOLVED = "unresolved:";

/** `@a/b/c` → `@a/b`, `x/y` → `x`. */
function barePackage(spec: string): string {
  const [a, b] = spec.split("/");
  return a.startsWith("@") && b ? `${a}/${b}` : a;
}

export function whyForbidden(rel: string): string | null {
  if (rel.startsWith(UNRESOLVED)) {
    const spec = rel.slice(UNRESOLVED.length);
    if (spec.startsWith("node:") || isBuiltin(spec)) return "Node built-in";
    if (!spec.startsWith(".") && !spec.startsWith("/")) {
      const name = barePackage(spec);
      if (FORBIDDEN_PACKAGES.has(name)) return `server/UI package "${name}"`;
    }
    return "unresolved import (cannot verify)";
  }
  const pkg = packageOf(rel);
  if (pkg !== null) return FORBIDDEN_PACKAGES.has(pkg) ? `server/UI package "${pkg}"` : null;
  for (const [re, why] of FORBIDDEN_PATHS) if (re.test(rel)) return why;
  return null;
}

/** Every module a file names: import/export … from (incl. `export * as ns`,
 *  which ts.preProcessFile misses), `import("x")` types, dynamic import() and
 *  CommonJS `require("x")` calls. */
export function moduleSpecifiers(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      out.push(node.moduleReference.expression.text);
    } else if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.push(node.arguments[0].text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The "use server" / "use client" directive a file opens with, if any — the
 *  whole directive prologue (the leading run of string-literal statements), so
 *  `"use strict"; "use client"` is caught. */
export function fileDirective(sf: ts.SourceFile): string | null {
  for (const st of sf.statements) {
    if (!(ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression))) break;
    const t = st.expression.text;
    if (t === "use server" || t === "use client") return t;
  }
  return null;
}

export function coreReport(root: string = process.cwd(), entry: string = CORE_ENTRY): CoreReport {
  const cfg = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
  // types: [] — only what the core actually imports, not every @types package.
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, types: [] };
  const program = ts.createProgram([path.join(root, entry)], options);
  const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
  const sources = program.getSourceFiles().filter((sf) => !program.isSourceFileDefaultLibrary(sf));

  const imports = new Map<string, string[]>();
  const directives = new Map<string, string>();
  for (const sf of sources) {
    const from = rel(sf.fileName);
    const to: string[] = [];
    for (const spec of moduleSpecifiers(sf)) {
      const hit = ts.resolveModuleName(spec, sf.fileName, options, ts.sys).resolvedModule;
      to.push(hit ? rel(hit.resolvedFileName) : `${UNRESOLVED}${spec}`);
    }
    imports.set(from, to);
    const d = fileDirective(sf);
    if (d) directives.set(from, d);
  }

  // Walk from the entry through clean files only, so each violation is the
  // first forbidden file on a path — the import edge to cut — not everything
  // behind it.
  const byFile = new Map<string, CoreViolation>();
  const seen = new Set<string>([entry]);
  const queue = [entry];
  const entryDirective = directives.get(entry);
  if (entryDirective) byFile.set(entry, { file: entry, why: `client/server directive "${entryDirective}"`, importedBy: [] });
  while (queue.length) {
    const from = queue.shift()!;
    for (const to of imports.get(from) ?? []) {
      const directive = directives.get(to);
      const why = whyForbidden(to) ?? (directive ? `client/server directive "${directive}"` : null);
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
  ok(moduleSpecifiers(ts.createSourceFile("p2.ts", 'import fs = require("fs");', ts.ScriptTarget.ES2017)).join(",") === "fs",
    "core:check: moduleSpecifiers sees import x = require()");
  ok(moduleSpecifiers(ts.createSourceFile("p3.ts", 'const fs = require("fs"); const n = require(name); foo("zz");', ts.ScriptTarget.ES2017)).join(",") === "fs",
    "core:check: moduleSpecifiers sees CommonJS require(\"x\") calls (string literal only)");
  ok(fileDirective(ts.createSourceFile("d1.ts", '"use strict";\n"use client";\nexport const a = 1;', ts.ScriptTarget.ES2017)) === "use client" &&
    fileDirective(ts.createSourceFile("d2.ts", '"use strict";\nexport const a = 1;', ts.ScriptTarget.ES2017)) === null &&
    fileDirective(ts.createSourceFile("d3.ts", 'export const a = 1;\n"use client";', ts.ScriptTarget.ES2017)) === null,
    "core:check: fileDirective scans the whole directive prologue and stops at the first real statement");
  ok(whyForbidden("unresolved:fs") === "Node built-in" && whyForbidden("unresolved:node:crypto") === "Node built-in" &&
    whyForbidden("unresolved:server-only") === 'server/UI package "server-only"' &&
    whyForbidden("unresolved:@vercel/blob/client") === 'server/UI package "@vercel/blob"' &&
    whyForbidden("unresolved:left-pad") === "unresolved import (cannot verify)",
    "core:check: unresolved imports classify as Node built-ins, forbidden packages or unverifiable");
  // End to end on a throwaway project: each bad entry must come back as a violation.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "core-check-"));
  try {
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "esnext", moduleResolution: "bundler", strict: true, skipLibCheck: true }, include: [] }));
    const cases: Array<[string, string, string]> = [
      ["server-only", 'import "server-only";\nexport const a = 1;', 'server/UI package "server-only"'],
      ["node:fs", 'import "node:fs";\nexport const a = 1;', "Node built-in"],
      ["fs", 'import { readFileSync } from "fs";\nexport const a = readFileSync;', "Node built-in"],
      ["import = require", 'import fs = require("fs");\nexport const a = fs;', "Node built-in"],
      ["require()", 'const fs = require("fs");\nexport const a = fs;', "Node built-in"],
      ["use server file", 'import { b } from "./b";\nexport const a = b;', 'client/server directive "use server"'],
      ["use client file", 'import { d } from "./d";\nexport const a = d;', 'client/server directive "use client"'],
      ["use strict + use client prologue", 'import { e } from "./e";\nexport const a = e;', 'client/server directive "use client"'],
    ];
    fs.writeFileSync(path.join(tmp, "b.ts"), '"use server";\nexport const b = 1;');
    fs.writeFileSync(path.join(tmp, "d.ts"), '"use client";\nexport const d = 1;');
    fs.writeFileSync(path.join(tmp, "e.ts"), '"use strict";\n"use client";\nexport const e = 1;');
    for (const [name, src, why] of cases) {
      fs.writeFileSync(path.join(tmp, "entry.ts"), src);
      const rep = coreReport(tmp, "entry.ts");
      ok(rep.violations.some((v) => v.why === why), `core:check: the gate refuses ${name} (${rep.violations.map((v) => v.why).join("; ") || "no violation"})`);
    }
    fs.writeFileSync(path.join(tmp, "entry.ts"), 'import { b } from "./c";\nexport const a = b;');
    fs.writeFileSync(path.join(tmp, "c.ts"), "export const b = 1;");
    ok(coreReport(tmp, "entry.ts").violations.length === 0, "core:check: a clean synthetic entry has no violations");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
