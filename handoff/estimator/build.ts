/**
 * handoff:build — bundles the real Estimator client for a server-less, file:// page.
 *
 *   npm run handoff:build [-- --out <dir>] [--data <slice dir>] [--images <dir>] [--no-minify]
 *
 * Writes <out>/{index.html, app/app.js, app/app.css, app/assets/*, CONFIDENTIAL.txt}.
 * The slice (handoff:slice) and photos normally live in <out>/data and <out>/images already;
 * --data / --images copy them in from elsewhere. Every emitted file must stay ≤ 15,000,000
 * bytes (the Artifact limit) or the build fails. Build diagnostics (discovered server actions,
 * esbuild metafile) go to output/handoff-build/, outside the package. Plan: PR 2 Task 2.
 */
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { imagePlugin, shimPlugin, serverActionStubPlugin } from "./esbuild-plugins";

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");
export const MAX_FILE_BYTES = 15_000_000;

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

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

async function buildCss(): Promise<string> {
  const from = path.join(ROOT, "src/app/globals.css");
  const r = await postcss([tailwindcss({ base: ROOT })]).process(readFileSync(from, "utf8"), { from, to: from });
  return r.css;
}

export async function build(args: Args): Promise<{ files: Array<{ file: string; bytes: number }>; oversize: string[] }> {
  const OUT = args.out;
  const APP = path.join(OUT, "app");
  mkdirSync(OUT, { recursive: true });
  rmSync(APP, { recursive: true, force: true });
  rmSync(path.join(OUT, "index.html"), { force: true });

  const hasData = syncDir(args.data, path.join(OUT, "data"), "data");
  const hasImages = syncDir(args.images, path.join(OUT, "images"), "images");

  // --- JS: the real Estimator client, server actions swapped for registry stubs ---
  const discovered: Record<string, string[]> = {};
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
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: 'var process = globalThis.process || { env: { NODE_ENV: "production" } };' },
    loader: { ".jpg": "file", ".jpeg": "file", ".png": "file", ".webp": "file", ".gif": "file", ".svg": "file", ".woff2": "file", ".woff": "file" },
    plugins: [shimPlugin(), imagePlugin(), serverActionStubPlugin(ROOT, discovered)],
  });
  const jsMs = Date.now() - t0;

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

  const files = listFiles(OUT).map((f) => ({ file: f, bytes: statSync(path.join(OUT, f)).size }));
  const oversize = files.filter((f) => f.bytes > MAX_FILE_BYTES).map((f) => f.file);

  const actions = Object.values(discovered).reduce((n, v) => n + v.length, 0);
  console.log(`handoff:build → ${path.relative(ROOT, OUT)}  (JS ${jsMs} ms, CSS ${cssMs} ms)`);
  console.log(`  "use server" modules stubbed: ${Object.keys(discovered).length} (${actions} exports) → output/handoff-build/discovered-actions.json`);
  for (const w of result.warnings) console.log(`  WARN ${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ""}`);
  if (!hasData) console.log("  no data/ — the page mounts with an empty slice (run npm run handoff:slice first)");
  if (!hasImages) console.log("  no images/ (optional)");
  console.log(`  data scripts: ${scripts.join(", ") || "(none)"}`);
  let total = 0;
  for (const f of files) {
    total += f.bytes;
    console.log(`  ${f.file.padEnd(40)} ${String(f.bytes).padStart(11)} bytes${f.bytes > MAX_FILE_BYTES ? "  ← OVER 15,000,000" : ""}`);
  }
  console.log(`  total ${(total / 1e6).toFixed(2)} MB in ${files.length} files`);
  return { files, oversize };
}

async function main() {
  const r = await build(parseArgs(process.argv.slice(2)));
  if (r.oversize.length) {
    console.error(`handoff:build: ${r.oversize.length} file(s) over ${MAX_FILE_BYTES} bytes: ${r.oversize.join(", ")}`);
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
