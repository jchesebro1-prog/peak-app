/**
 * Estimator handoff — `npm run handoff:verify -- --parity [--export <export.json> …]` (PR 2 Task 12): the readable engine
 * the package ships (app/estimating-core.js) against the golden totals it ships (spec/golden/*.json). No browser.
 *
 *   1. The bundle loads in Node twice — in a vm context (the browser's way: one global, PeakEstimatingCore) and through
 *      require() (module.exports) — and both expose exactly the export surface of src/lib/estimating-core/index.ts
 *      (every top-level name, and every name inside each namespace).
 *   2. For every estimate in data/estimates.js, core:golden's goldenFor computed WITH THE BUNDLE (goldenWith) equals its
 *      spec/golden file byte for byte; no golden file is missing or left over.
 *   3. With --export (repeatable): core:golden itself (systemQuotesOf + goldenFor over the export) reproduces every
 *      golden file of an estimate that export holds, byte for byte — the golden files are what `npm run core:golden`
 *      writes for the same export. Every sliced estimate must be found in one of the exports given.
 * Result: output/verify/parity.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { goldenFileName, goldenFor, goldenJson, systemQuotesOf, type ExportFile } from "../../../scripts/estimating-golden";
import { ENGINE_FILE, GOLDEN_DIR, loadEngine, parityProblems, readSliceGlobals, sliceSystemQuotes, type ParityProblem } from "../package";

export type ParityResult = {
  pass: boolean;
  engineFile: string;
  engineBytes: number;
  /** Top-level exports of the bundle / of the source index.ts. */
  exports: { bundle: number; source: number; namespaced: number };
  /** "name" or "ns.name" present in the source but not the bundle, or the other way round. */
  missingExports: string[];
  extraExports: string[];
  /** require() returned the same export names as the vm load. */
  requireOk: boolean;
  estimates: number;
  problems: ParityProblem[];
  exportsChecked: Array<{ file: string; compared: number; problems: string[] }>;
  /** Sliced estimate ids no --export file holds (only when --export was given). */
  notInExports: string[];
  error?: string;
};

const isNs = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** "name" for each top-level export and "ns.name" for each member of a namespace object (`export * as ns`). */
export function exportNames(mod: Record<string, unknown>, namespaces: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(mod).sort()) {
    out.push(k);
    if (namespaces.has(k) && isNs(mod[k])) for (const m of Object.keys(mod[k] as Record<string, unknown>).sort()) out.push(`${k}.${m}`);
  }
  return out;
}

export async function parityCheck(pkgDir: string, exportFiles: readonly string[]): Promise<ParityResult> {
  const engineFile = path.join(pkgDir, ENGINE_FILE);
  const base: ParityResult = {
    pass: false, engineFile: path.relative(process.cwd(), engineFile), engineBytes: 0, exports: { bundle: 0, source: 0, namespaced: 0 }, missingExports: [], extraExports: [],
    requireOk: false, estimates: 0, problems: [], exportsChecked: [], notInExports: [],
  };
  if (!existsSync(engineFile)) return { ...base, error: `${ENGINE_FILE} not found — run npm run handoff:build` };
  const text = readFileSync(engineFile, "utf8");
  base.engineBytes = Buffer.byteLength(text);
  let engine: ReturnType<typeof loadEngine>;
  try {
    engine = loadEngine(text, engineFile);
  } catch (e) {
    return { ...base, error: `loading ${ENGINE_FILE} in a vm context failed: ${(e as Error).message}` };
  }

  // 1 — the export surface, against the source's own index.ts (namespaces = `export * as ns`)
  const source = (await import("@/lib/estimating-core")) as unknown as Record<string, unknown>;
  const namespaces = new Set(Object.keys(source).filter((k) => isNs(source[k])));
  const want = exportNames(source, namespaces);
  const have = exportNames(engine, namespaces);
  const haveSet = new Set(have);
  const wantSet = new Set(want);
  base.missingExports = want.filter((n) => !haveSet.has(n));
  base.extraExports = have.filter((n) => !wantSet.has(n));
  base.exports = { bundle: Object.keys(engine).length, source: Object.keys(source).length, namespaced: namespaces.size };
  try {
    const req = createRequire(engineFile);
    delete req.cache[req.resolve(engineFile)];
    const viaRequire = req(engineFile) as Record<string, unknown>;
    base.requireOk = exportNames(viaRequire, namespaces).join(",") === have.join(",");
  } catch {
    base.requireOk = false;
  }

  // 2 — the bundle prices every sliced estimate exactly as its golden file says
  const estimates = (readSliceGlobals(pkgDir, ["estimates.js"]).PEAK_ESTIMATES ?? []) as Array<{ id: string } & Record<string, unknown>>;
  const quotes = sliceSystemQuotes(estimates);
  base.estimates = quotes.length;
  const goldenDir = path.join(pkgDir, GOLDEN_DIR);
  base.problems = parityProblems(engine, quotes, goldenDir);
  if (!quotes.length) base.problems.push({ file: "data/estimates.js", why: "no estimate to price (an empty slice proves nothing)" });

  // 3 — core:golden over the original export(s) writes the same files
  const found = new Set<string>();
  const sliceIds = new Set(quotes.map((q) => q.id));
  for (const file of exportFiles) {
    const exp = JSON.parse(readFileSync(file, "utf8")) as ExportFile;
    const problems: string[] = [];
    let compared = 0;
    for (const q of systemQuotesOf(exp)) {
      if (!sliceIds.has(q.id) || found.has(q.id)) continue;
      found.add(q.id);
      compared++;
      const g = path.join(goldenDir, goldenFileName(q.id));
      if (!existsSync(g)) problems.push(`${goldenFileName(q.id)}: no golden file`);
      else if (readFileSync(g, "utf8") !== goldenJson(goldenFor(q))) problems.push(`${goldenFileName(q.id)}: core:golden over the export differs from the packaged golden file`);
    }
    base.exportsChecked.push({ file, compared, problems });
  }
  if (exportFiles.length) base.notInExports = [...sliceIds].filter((id) => !found.has(id));

  base.pass =
    !base.error && base.requireOk && !base.missingExports.length && !base.extraExports.length && !base.problems.length &&
    base.exportsChecked.every((x) => !x.problems.length) && !base.notInExports.length;
  return base;
}

export function printParity(r: ParityResult): void {
  console.log(`handoff:verify --parity  ${r.pass ? "PASS" : "FAIL"}`);
  if (r.error) console.log(`  ${r.error}`);
  console.log(`  ${r.engineFile}: ${r.engineBytes} bytes; exports ${r.exports.bundle} (source ${r.exports.source}, ${r.exports.namespaced} namespaces); require(): ${r.requireOk ? "same exports" : "FAILED"}`);
  for (const n of r.missingExports) console.log(`    missing from the bundle: ${n}`);
  for (const n of r.extraExports) console.log(`    not in the source: ${n}`);
  console.log(`  bundle vs spec/golden: ${r.estimates} estimate(s), ${r.problems.length} problem(s)`);
  for (const p of r.problems) console.log(`    ${p.file}: ${p.why}`);
  for (const x of r.exportsChecked) {
    console.log(`  core:golden over ${x.file}: ${x.compared} golden file(s) compared, ${x.problems.length} problem(s)`);
    for (const p of x.problems) console.log(`    ${p}`);
  }
  if (r.notInExports.length) console.log(`  sliced estimates in none of the exports: ${r.notInExports.join(", ")}`);
}
