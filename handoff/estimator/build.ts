/**
 * handoff:build — bundles the real Estimator client for a server-less, file:// page.
 *
 *   npm run handoff:build [-- --out <dir>] [--data <slice dir>] [--images <dir>] [--no-minify]
 *
 * Writes <out>/{index.html, app/app.js, app/app.css, app/assets/*, CONFIDENTIAL.txt}, and (Task 12) the founder half:
 * app/estimating-core.js (the readable engine, package.ts), spec/{README,data-model,pricing,ports}.md (handoff/estimator/spec/
 * with their generated blocks expanded from the source, spec-gen.ts), spec/golden/<id>.json (core:golden's figures for every
 * sliced estimate) — spec/screenshots/ (handoff:verify --full) is kept — then audits the folder (auditPackage). The build
 * never writes the zip: it deletes any <out>.zip first (that zip no longer matches the folder), and only a passing
 * handoff:verify --full writes output/peak-estimator-handoff.zip, so an unverified zip never sits there looking done.
 * The slice (handoff:slice) and photos normally live in <out>/data and <out>/images already;
 * --data / --images copy them in from elsewhere. Only the files images/manifest.json references (plus the manifest)
 * ship; anything else in an images folder stays out (copied folder) or is removed (in-place folder). No package file
 * may name a private Blob pathname ("part-docs/<id>/…") — the build fails if one does. Every emitted file must stay ≤ 15,000,000
 * bytes (the Artifact limit) or the build fails. Build diagnostics (discovered server actions,
 * esbuild metafile) go to output/handoff-build/, outside the package. Plan: PR 2 Task 2.
 */
import * as esbuild from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { FORBIDDEN_PACKAGES } from "../../scripts/core-check";
import { parsePhotoManifest } from "./photo-select";
import { APP_OVERRIDES, appOverridePlugin, bakeModules, bakePlugin, imagePlugin, shimPlugin, serverActionStubPlugin } from "./esbuild-plugins";
import { auditPackage, buildEngineBundle, ENGINE_FILE, MAX_FILE_BYTES, MAX_TOTAL_BYTES, readSliceGlobals, sliceSystemQuotes, stageSpecDocs, writeGoldenFiles, zipPathFor } from "./package";

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");

/** Slice files in dependency order; `catalog-*` expands to every catalog-<n>.js present, by n. */
export const DATA_ORDER = ["rules.js", "team.js", "customers.js", "fixtures.js", "catalog-*", "estimates.js", "meta.js"] as const;

/** The `<script>` srcs for a data dir's files, in DATA_ORDER. Other .js files (later slicer
 *  output) go before meta.js, alphabetically. */
export function dataScripts(files: string[]): string[] {
  const js = files.filter((f) => f.endsWith(".js"));
  const catalog = js
    .filter((f) => /^catalog-\d+\.js$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const known = new Set<string>([...DATA_ORDER, ...catalog]);
  const extra = js.filter((f) => !known.has(f)).sort();
  const out: string[] = [];
  for (const f of DATA_ORDER) {
    if (f === "catalog-*") out.push(...catalog);
    else if (f === "meta.js") out.push(...extra, ...(js.includes(f) ? [f] : []));
    else if (js.includes(f)) out.push(f);
  }
  return out;
}

export const CONFIDENTIAL_TXT = `CONFIDENTIAL — Peak Systems Group

This folder holds a working prototype of Peak's Estimator together with real
Peak data: costs, margins, prices, customer names and staff names.

It is shared with one named recipient for evaluation only. Do not forward,
upload, publish or copy it, in whole or in part, without Peak Systems Group's
written permission. Delete it when the evaluation ends.

Open index.html in a browser. Nothing in the prototype sends or saves anything
to Peak.
`;

/** Browser-legitimate packages that core-check's list also names (it forbids UI packages for the pure core). */
const BROWSER_OK_PACKAGES = new Set(["react", "react-dom"]);

/** Bundled inputs that must never reach the browser: the DB layer, the stores, and server packages
 *  (core-check's FORBIDDEN_PACKAGES minus react/react-dom). Input paths are repo-relative, as in esbuild's metafile. */
export function forbiddenBundleInputs(inputPaths: string[]): string[] {
  const bad: string[] = [];
  for (const rel of inputPaths) {
    if (/^src\/db\//.test(rel) || /^src\/lib\/stores\//.test(rel)) {
      bad.push(rel);
      continue;
    }
    const i = rel.lastIndexOf("node_modules/");
    if (i < 0) continue;
    const [a, b] = rel.slice(i + "node_modules/".length).split("/");
    const pkg = a.startsWith("@") ? `${a}/${b}` : a;
    if (FORBIDDEN_PACKAGES.has(pkg) && !BROWSER_OK_PACKAGES.has(pkg)) bad.push(rel);
  }
  return bad;
}

/** null when `out` is inside <root>/output/ (and not output/ itself), else the reason it is refused. */
export function outDirProblem(root: string, out: string): string | null {
  const rel = path.relative(path.join(root, "output"), path.resolve(out));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return `--out must be inside ${path.join(root, "output")}${path.sep} (got ${out}); refusing to clean and write there`;
  }
  return null;
}

type Args = { out: string; data: string | null; images: string | null; minify: boolean };

function parseArgs(argv: string[]): Args {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const out = path.resolve(ROOT, val("--out") ?? "output/peak-estimator-handoff");
  const data = val("--data");
  const images = val("--images");
  return { out, data: data ? path.resolve(data) : null, images: images ? path.resolve(images) : null, minify: !argv.includes("--no-minify") };
}

/** Copies `from` into `to` (replacing it) unless they are the same directory. */
function syncDir(from: string | null, to: string, label: string): boolean {
  if (from && path.resolve(from) !== path.resolve(to)) {
    if (!existsSync(from)) throw new Error(`--${label} ${from} does not exist`);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
  return existsSync(to);
}

/** Files of the images folder `from` that ship: the manifest's referenced files (that exist) plus manifest.json itself. */
export function referencedImageFiles(from: string): { manifest: boolean; files: string[] } {
  const mf = path.join(from, "manifest.json");
  if (!existsSync(mf)) return { manifest: false, files: [] };
  let m: ReturnType<typeof parsePhotoManifest>;
  try {
    m = parsePhotoManifest(JSON.parse(readFileSync(mf, "utf8")));
  } catch {
    m = null;
  }
  if (!m) throw new Error(`${mf} is unreadable — re-run handoff:photos`);
  return { manifest: true, files: [...new Set(Object.values(m.byDoc))].filter((f) => existsSync(path.join(from, f))).sort() };
}

/**
 * Puts only the referenced images (+ manifest.json) into the package's images/ folder. From another folder: a fresh copy of
 * just those. In place (from === to, the usual case): every other entry of the folder is deleted. No manifest = no images.
 * Returns what shipped and what was left out / removed.
 */
export function stageImages(from: string | null, to: string): { shipped: string[]; dropped: string[] } {
  const src = from ?? to;
  if (!existsSync(src)) {
    if (from) throw new Error(`--images ${from} does not exist`);
    return { shipped: [], dropped: [] };
  }
  const { manifest, files } = referencedImageFiles(src);
  const keep = new Set<string>(manifest ? [...files, "manifest.json"] : []);
  const dropped = readdirSync(src).filter((n) => !keep.has(n)).sort();
  if (path.resolve(src) === path.resolve(to)) {
    for (const n of dropped) rmSync(path.join(to, n), { recursive: true, force: true });
    if (!manifest) rmSync(to, { recursive: true, force: true });
  } else {
    rmSync(to, { recursive: true, force: true });
    if (manifest) {
      mkdirSync(to, { recursive: true });
      for (const n of keep) copyFileSync(path.join(src, n), path.join(to, n));
    }
  }
  return { shipped: [...keep].sort(), dropped };
}

async function buildCss(): Promise<string> {
  const from = path.join(ROOT, "src/app/globals.css");
  const r = await postcss([tailwindcss({ base: ROOT })]).process(readFileSync(from, "utf8"), { from, to: from });
  return r.css;
}

export async function build(args: Args): Promise<{ files: Array<{ file: string; bytes: number }>; oversize: string[]; problems: string[] }> {
  const OUT = args.out;
  const APP = path.join(OUT, "app");
  mkdirSync(OUT, { recursive: true });
  rmSync(APP, { recursive: true, force: true });
  rmSync(path.join(OUT, "index.html"), { force: true });
  // a zip from an earlier build no longer matches the folder; only a passing handoff:verify --full writes a new one
  rmSync(zipPathFor(OUT), { force: true });

  const hasData = syncDir(args.data, path.join(OUT, "data"), "data");
  // a data/photo-manifest.json from an earlier slicer carried private Blob pathnames; it never ships
  rmSync(path.join(OUT, "data", "photo-manifest.json"), { force: true });
  const staged = stageImages(args.images, path.join(OUT, "images"));
  const hasImages = existsSync(path.join(OUT, "images"));

  // --- JS: the real Estimator client, server actions swapped for registry stubs ---
  const discovered: Record<string, string[]> = {};
  const overridden = new Map<string, Set<string>>();
  // Plain data from app modules the bundle can't include (a store), read here in Node (BAKED_MODULES).
  const baked = await bakeModules();
  const t0 = Date.now();
  const result = await esbuild.build({
    entryPoints: [path.join(HERE, "main.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    outdir: APP,
    entryNames: "app",
    assetNames: "assets/[name]-[hash]",
    // Asset URLs resolve against the page (index.html), not the script.
    publicPath: "./app/",
    minify: args.minify,
    sourcemap: args.minify ? false : "inline",
    metafile: true,
    logLevel: "silent",
    absWorkingDir: ROOT,
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".jpg": "file", ".jpeg": "file", ".png": "file", ".webp": "file", ".gif": "file", ".svg": "file", ".woff2": "file", ".woff": "file" },
    plugins: [appOverridePlugin(ROOT, APP_OVERRIDES, overridden), shimPlugin(), imagePlugin(), bakePlugin(baked), serverActionStubPlugin(ROOT, discovered)],
  });
  const jsMs = Date.now() - t0;
  // An override nothing imported any more is stale: the app moved on and the prototype would silently show the original.
  const stale = Object.keys(APP_OVERRIDES).filter((orig) => !overridden.has(orig));
  if (stale.length) throw new Error(`app override(s) never applied (nothing imports the original any more): ${stale.join(", ")}`);
  const leaked = forbiddenBundleInputs(Object.keys(result.metafile.inputs));
  if (leaked.length) {
    throw new Error(`server code reached the browser bundle (${leaked.length} input(s)):\n  ${leaked.slice(0, 20).join("\n  ")}`);
  }

  // --- the placeholder images the app's absolute /placeholders/*.webp URLs point at (runtime/assets.ts) ---
  const placeholders = path.join(ROOT, "public", "placeholders");
  if (existsSync(placeholders)) cpSync(placeholders, path.join(APP, "assets", "placeholders"), { recursive: true });

  // --- CSS: Quartzite's Tailwind + pk-* styles, plus any CSS the bundle imported ---
  const t1 = Date.now();
  let css = await buildCss();
  const bundledCss = path.join(APP, "app.css");
  if (existsSync(bundledCss)) css += "\n/* imported by the bundle */\n" + readFileSync(bundledCss, "utf8");
  writeFileSync(bundledCss, css);
  const cssMs = Date.now() - t1;

  // --- index.html: data globals in dependency order, then the app ---
  const scripts = hasData ? dataScripts(readdirSync(path.join(OUT, "data"))) : [];
  const template = readFileSync(path.join(HERE, "index.html"), "utf8");
  const marker = "<!-- @HANDOFF_DATA_SCRIPTS -->";
  if (!template.includes(marker)) throw new Error(`index.html template lost its ${marker} marker`);
  const tags = scripts.map((f) => `<script src="./data/${f}"></script>`).join("\n    ");
  writeFileSync(path.join(OUT, "index.html"), template.replace(marker, tags || "<!-- no slice: run npm run handoff:slice -->"));
  writeFileSync(path.join(OUT, "CONFIDENTIAL.txt"), CONFIDENTIAL_TXT);

  // --- diagnostics, outside the package ---
  const diag = path.join(ROOT, "output", "handoff-build");
  mkdirSync(diag, { recursive: true });
  writeFileSync(path.join(diag, "meta.json"), JSON.stringify(result.metafile));
  writeFileSync(path.join(diag, "discovered-actions.json"), JSON.stringify(discovered, null, 2) + "\n");

  // --- the founder half (Task 12): readable engine, spec docs, golden totals ---
  const t2 = Date.now();
  const engine = await buildEngineBundle(ROOT);
  writeFileSync(path.join(OUT, ENGINE_FILE), engine.text);
  const estimates = (readSliceGlobals(OUT, hasData ? ["estimates.js"] : []).PEAK_ESTIMATES ?? []) as Array<{ id: string } & Record<string, unknown>>;
  const goldens = writeGoldenFiles(OUT, sliceSystemQuotes(estimates));
  const docs = stageSpecDocs(OUT, ROOT);
  const specMs = Date.now() - t2;

  const audit = auditPackage(OUT);
  const files = audit.files;
  const oversize = audit.oversize;
  const problems = [
    ...(audit.totalOver ? [`the package is ${audit.totalBytes} bytes, over ${MAX_TOTAL_BYTES}`] : []),
    ...audit.privatePaths.map((f) => `${f} contains a private Blob pathname ("part-docs/<id>/…")`),
    ...audit.missing.map((f) => `${f} is missing`),
  ];

  const actions = Object.values(discovered).reduce((n, v) => n + v.length, 0);
  console.log(`handoff:build → ${path.relative(ROOT, OUT)}  (JS ${jsMs} ms, CSS ${cssMs} ms, engine + spec ${specMs} ms)`);
  console.log(`  ${ENGINE_FILE}: ${engine.inputs.length} source modules, readable; spec: ${docs.written.join(", ")}; golden: ${goldens} estimate(s)`);
  if (docs.undocumented.length) console.log(`  WARN fields printed with no note (add a doc comment or a spec-gen HAND_NOTES entry): ${docs.undocumented.join(", ")}`);
  console.log(`  "use server" modules stubbed: ${Object.keys(discovered).length} (${actions} exports) → output/handoff-build/discovered-actions.json`);
  for (const [orig, importers] of overridden) console.log(`  override ${orig} → ${APP_OVERRIDES[orig]} (imported by ${[...importers].join(", ")})`);
  for (const abs of baked.keys()) console.log(`  baked ${path.relative(ROOT, abs)}${result.metafile.inputs[path.relative(ROOT, abs)] ? "" : " (not imported by the bundle)"}`);
  for (const w of result.warnings) console.log(`  WARN ${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ""}`);
  if (!hasData) console.log("  no data/ — the page mounts with an empty slice (run npm run handoff:slice first)");
  if (!hasImages) console.log("  no images/ (optional)");
  else console.log(`  images: ${staged.shipped.length ? staged.shipped.length - 1 : 0} referenced file(s) shipped${staged.dropped.length ? `; ${staged.dropped.length} unreferenced left out (${staged.dropped.slice(0, 5).join(", ")}${staged.dropped.length > 5 ? ", …" : ""})` : ""}`);
  console.log(`  data scripts: ${scripts.join(", ") || "(none)"}`);
  let total = 0;
  for (const f of files) {
    total += f.bytes;
    console.log(`  ${f.file.padEnd(40)} ${String(f.bytes).padStart(11)} bytes${f.bytes > MAX_FILE_BYTES ? "  ← OVER 15,000,000" : ""}`);
  }
  console.log(`  total ${(total / 1e6).toFixed(2)} MB in ${files.length} files`);
  if (audit.junk.length) console.log(`  never zipped: ${audit.junk.join(", ")}`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);
  if (!oversize.length && !problems.length) console.log(`  zip: not written — run handoff:verify --full; it writes ${path.relative(ROOT, zipPathFor(OUT))} on PASS`);
  return { files, oversize, problems };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const problem = outDirProblem(ROOT, args.out);
  if (problem) {
    console.error(`handoff:build: ${problem}`);
    process.exit(2);
  }
  const r = await build(args);
  if (r.oversize.length) {
    console.error(`handoff:build: ${r.oversize.length} file(s) over ${MAX_FILE_BYTES} bytes: ${r.oversize.join(", ")}`);
    process.exit(1);
  }
  if (r.problems.length) {
    console.error(`handoff:build: ${r.problems.join("; ")}`);
    process.exit(1);
  }
}

if (/handoff[\\/]estimator[\\/]build\.ts$/.test(path.resolve(process.argv[1] ?? ""))) {
  main().catch((e: unknown) => {
    const errs = (e as { errors?: esbuild.Message[] }).errors;
    if (errs?.length) for (const er of errs) console.error(`ERROR ${er.text}${er.location ? ` (${er.location.file}:${er.location.line})` : ""}`);
    else console.error(e);
    process.exit(1);
  });
}
