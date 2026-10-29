/**
 * Estimator handoff — the founder-facing half of the package (PR 2 Task 12): the readable engine
 * (`app/estimating-core.js`), the spec folder (docs expanded from the source, the golden totals), the package
 * audit every Artifact / zip rule hangs on, and the deterministic zip. Node-only; handoff:build and
 * handoff:verify (--parity, --full) both use it. The one home of the package's shared rules (MAX_FILE_BYTES, listFiles,
 * the private-path check, the zip's path).
 */
import * as esbuild from "esbuild";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";
import JSZip from "jszip";
import { goldenFileName, goldenFor, goldenJson, goldenWith, systemQuotesOf, type GoldenEngine, type SystemQuote } from "../../scripts/estimating-golden";
import { expandSpecMarkdown, hasMarkers, scrubProse, undocumentedFields } from "./spec-gen";
import { IMAGE_FILE_RE } from "./photo-select";
import { scanForSecrets } from "./slice-rules";

const ROOT = path.resolve(__dirname, "..", "..");
export const ENGINE_ENTRY = "src/lib/estimating-core/index.ts";
/** Package-relative paths. */
export const ENGINE_FILE = "app/estimating-core.js";
export const SPEC_DIR = "spec";
export const GOLDEN_DIR = "spec/golden";
export const SCREENSHOT_DIR = "spec/screenshots";
/** The hand-written docs, in handoff/estimator/spec/ (copied with their generated blocks expanded). */
export const SPEC_DOCS = ["README.md", "data-model.md", "pricing.md", "ports.md"] as const;
export const ENGINE_GLOBAL = "PeakEstimatingCore";
export const MAX_FILE_BYTES = 15_000_000;
export const MAX_TOTAL_BYTES = 150_000_000;
/**
 * Every private Vercel Blob prefix the app writes under (src/lib: part-docs/types.ts, quote-pdf/state.ts,
 * vendor-quotes/thread-attachment-server.ts, part-docs/datasheet-book-download.ts, estimate-output/package-files.ts,
 * document-files.ts, field-files/files.ts, assessments/photos.ts + report-pdf-path.ts, mail attachments,
 * grid-sheet-file.ts, consulting-files.ts, the recorder, client-package-server.ts — whose racks/ datasheets/ cutsheets/
 * also name package folders). No package file may name one.
 */
export const PRIVATE_BLOB_PREFIXES = [
  "part-docs", "quote-pdfs", "vendor-quotes", "estimate-package", "estimate-files", "documents", "surveys", "assessments",
  "assessment-pdfs", "mail-attachments", "grid-sheets", "engagement-files", "recordings", "client-packages", "cutsheets",
  "racks", "datasheets",
] as const;
const PREFIX_ALT = PRIVATE_BLOB_PREFIXES.join("|");
const PATH_CHARS = String.raw`[^\s"'\`<>()\[\]{}*|\\]`;
/**
 * A private Blob pathname: no package file may contain one (photos ship as images/<file>). Two shapes count:
 *  - "<prefix>/<id>/…"        — part-docs/PD-1/photo.webp, quote-pdfs/Q-1/rev-1.pdf, …
 *  - "<prefix>/<id>-<file>"   — one segment: vendor-quote uploads and thread-attachment copies are
 *                               vendor-quotes/<vqId>-<file> (src/lib/vendor-quote-file.ts, vendor-quotes/thread-attachment-server.ts).
 * The one-segment shape needs a "-" (the id-file join) and must not sit inside a longer path ("/api/documents/${id}",
 * "src/lib/vendor-quotes/rules" are routes and source paths, not Blob pathnames) unless it follows a Blob host
 * ("….vercel-storage.com/<prefix>/…"). The literal text "part-docs/<docId>/" (a photo failure message) is neither
 * shape: "<" is not an id character.
 */
export const PRIVATE_PATH_RE = new RegExp(
  `(?:${PREFIX_ALT})/[A-Za-z0-9_-]+/|(?:(?<![\\w./-])|(?<=vercel-storage\\.com/))(?:${PREFIX_ALT})/[A-Za-z0-9]+-${PATH_CHARS}+`,
);
/** The one folder every zip entry sits under (spec §2), so a command-line unzip doesn't spill into the current folder. */
export const ZIP_ROOT = "peak-estimator-handoff";

const ENGINE_BANNER = `/*!
 * Peak Systems Group — estimating core, readable build. CONFIDENTIAL.
 *
 * The Estimator's pricing engine, bundled unchanged from Quartzite's ${ENGINE_ENTRY} (and the pure modules it
 * re-exports). Not minified; the source's doc comments are kept. One script, one global: ${ENGINE_GLOBAL}.
 *   Browser: <script src="app/estimating-core.js"></script>  →  window.${ENGINE_GLOBAL}
 *   Node:    const core = require("./app/estimating-core.js")
 * spec/pricing.md walks through every formula and names the function here that computes it; spec/golden/*.json are
 * the totals this engine produces for every bundled estimate (handoff:verify --parity proves it, to the byte).
 * The prototype's own app/app.js carries the same engine, compiled from the same source.
 */`;
const ENGINE_FOOTER = `if (typeof module === "object" && module && module.exports) module.exports = ${ENGINE_GLOBAL};`;

/**
 * esbuild drops ordinary comments from a bundle but keeps statement-level "legal" ones (`/*!`). Turning each JSDoc
 * opener into one keeps the source's doc comments next to the functions they describe. Comment text only: code
 * is unchanged (--parity proves the numbers). A `/**` inside a string literal would be rewritten too — none exists
 * in the engine's closure, and the unit test checks the bundle still matches the source's exports.
 */
export function keepDocComments(src: string): string {
  return src.replace(/\/\*\*(?=[\s*])([^]*?)\*\//g, (_m, body: string) => `/*!${scrubDocBody(body)}*/`);
}

/** A line that starts a new list item / tag inside a doc comment — never joined onto the line above. */
const DOC_ITEM_RE = /^(?:[-*•+]\s|\d+[.)]\s|@\w)/;
/**
 * The founder package does not name people or internal tracking: a doc comment that does (a punch / decision /
 * review reference, a date, "Jeff") is rewritten with spec-gen's scrubProse — the same scrub data-model.md uses —
 * paragraph by paragraph. A paragraph the scrub leaves alone keeps its exact lines; a changed one becomes one line.
 */
function scrubDocBody(body: string): string {
  const lines = body.split("\n");
  const prefixOf = (l: string) => /^\s*\*? ?/.exec(l)?.[0] ?? "";
  const textOf = (ls: string[], first: boolean) => ls.map((l, i) => (first && i === 0 ? l : l.slice(prefixOf(l).length)).trim()).join(" ").replace(/\s+/g, " ").trim();
  if (lines.length === 1) {
    const t = textOf(lines, true);
    const s = scrubProse(t);
    return s === t ? body : ` ${s} `;
  }
  const out: string[] = [];
  let unit: string[] = [];
  let unitIsOpener = false;
  const flush = () => {
    if (!unit.length) return;
    const text = textOf(unit, unitIsOpener);
    const scrubbed = scrubProse(text);
    if (scrubbed === text) out.push(...unit);
    else if (scrubbed) out.push(unitIsOpener ? ` ${scrubbed}` : `${prefixOf(unit[0])}${scrubbed}`);
    unit = [];
    unitIsOpener = false;
  };
  lines.forEach((l, i) => {
    const bare = i === 0 ? l.trim() : l.slice(prefixOf(l).length).trim();
    if (!bare) { flush(); out.push(l); return; }
    if (i > 0 && DOC_ITEM_RE.test(bare)) flush();
    if (i === 0) unitIsOpener = true;
    unit.push(l);
    if (i === 0) flush();
  });
  flush();
  return out.join("\n");
}

/**
 * esbuild also keeps some full-line `//` comments in its output. The same scrub applies to them, line by line (a
 * line that is nothing but a comment; code with a trailing comment is untouched — the engine's closure has none that
 * names a person, which the unit test asserts on the built bundle).
 */
export function scrubLineComments(src: string): string {
  return src.replace(/^([ \t]*\/\/ ?)(.*)$/gm, (m, lead: string, text: string) => {
    if (!text.trim()) return m;
    const s = scrubProse(text);
    return s === text.trim() ? m : s ? `${lead}${s}` : lead.trimEnd();
  });
}

const keepDocsPlugin: esbuild.Plugin = {
  name: "handoff-keep-docs",
  setup(b) {
    b.onLoad({ filter: /\.tsx?$/ }, (args) => ({ contents: scrubLineComments(keepDocComments(readFileSync(args.path, "utf8"))), loader: args.path.endsWith(".tsx") ? "tsx" : "ts" }));
  },
};

/** The readable engine bundle's text: an unminified IIFE that sets `PeakEstimatingCore` (and module.exports in Node). */
export async function buildEngineBundle(root: string = ROOT): Promise<{ text: string; inputs: string[] }> {
  const r = await esbuild.build({
    entryPoints: [path.join(root, ENGINE_ENTRY)],
    bundle: true,
    format: "iife",
    globalName: ENGINE_GLOBAL,
    platform: "browser",
    target: "es2020",
    minify: false,
    sourcemap: false,
    write: false,
    metafile: true,
    legalComments: "inline",
    charset: "utf8",
    logLevel: "silent",
    absWorkingDir: root,
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: ENGINE_BANNER },
    footer: { js: ENGINE_FOOTER },
    plugins: [keepDocsPlugin],
  });
  return { text: r.outputFiles[0].text, inputs: Object.keys(r.metafile.inputs).sort() };
}

export type Engine = Record<string, unknown> & GoldenEngine;

/** Runs the bundle's text in a fresh vm context and returns the PeakEstimatingCore global. */
export function loadEngine(text: string, filename = ENGINE_FILE): Engine {
  const ctx = vm.createContext({});
  vm.runInContext(text, ctx, { filename });
  const core = (ctx as Record<string, unknown>)[ENGINE_GLOBAL];
  if (!core || typeof core !== "object") throw new Error(`${filename} did not define ${ENGINE_GLOBAL}`);
  return core as Engine;
}

/** The value at a dotted path of the engine ("totals", "bonusRules.withBonusLines"); undefined when absent. */
export function engineAt(core: Record<string, unknown>, dotted: string): unknown {
  let v: unknown = core;
  for (const k of dotted.split(".")) {
    if (!v || (typeof v !== "object" && typeof v !== "function") || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

/** Every `PeakEstimatingCore.<path>` a document cites (deduplicated, in first-seen order). */
export function citedEnginePaths(md: string): string[] {
  return [...new Set([...md.matchAll(new RegExp(`${ENGINE_GLOBAL}\\.([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)`, "g"))].map((m) => m[1]))];
}

/* ------------------------------------------------------------------ slice + golden */

/** window.* globals of the given data/*.js files, run in a sandbox (the page loads them the same way). */
export function readSliceGlobals(pkg: string, files: readonly string[]): Record<string, unknown> {
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window });
  for (const f of files) {
    const file = path.join(pkg, "data", f);
    if (existsSync(file)) vm.runInContext(readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return window;
}

/** The slice's estimates as core:golden reads quotes from an export (live system quotes with a line), sorted by id. */
export function sliceSystemQuotes(estimates: ReadonlyArray<{ id: string } & Record<string, unknown>>): SystemQuote[] {
  return systemQuotesOf({ collections: { quotes: estimates.map((doc) => ({ id: doc.id, doc })) } });
}

/** spec/golden/<id>.json for every sliced estimate, computed with the app's own engine (core:golden's goldenFor). */
export function writeGoldenFiles(pkg: string, quotes: SystemQuote[]): number {
  const dir = path.join(pkg, GOLDEN_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const q of quotes) writeFileSync(path.join(dir, goldenFileName(q.id)), goldenJson(goldenFor(q)));
  return quotes.length;
}

export type ParityProblem = { file: string; why: string };

/**
 * Bundle parity: `engine` (the readable bundle) prices every quote and its goldenJson must equal the golden file
 * byte for byte; every golden file must belong to a quote. [] = identical.
 */
export function parityProblems(engine: GoldenEngine, quotes: SystemQuote[], goldenDir: string): ParityProblem[] {
  const problems: ParityProblem[] = [];
  const files = new Set(existsSync(goldenDir) ? readdirSync(goldenDir).filter((f) => f.endsWith(".json")) : []);
  for (const q of quotes) {
    const name = goldenFileName(q.id);
    if (!files.has(name)) {
      problems.push({ file: name, why: "no golden file" });
      continue;
    }
    files.delete(name);
    if (readFileSync(path.join(goldenDir, name), "utf8") !== goldenJson(goldenWith(engine, q))) problems.push({ file: name, why: "the bundle's totals differ from the golden file" });
  }
  for (const extra of files) problems.push({ file: extra, why: "golden file has no matching estimate" });
  return problems;
}

/* ------------------------------------------------------------------ spec folder */

/** Copies the founder docs into <pkg>/spec with their generated blocks expanded. spec/screenshots/ (handoff:verify --full) is kept. */
export function stageSpecDocs(pkg: string, root: string = ROOT): { written: string[]; undocumented: string[] } {
  const from = path.join(root, "handoff", "estimator", "spec");
  const to = path.join(pkg, SPEC_DIR);
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(to)) {
    if (name.endsWith(".md")) rmSync(path.join(to, name), { force: true });
  }
  const written: string[] = [];
  const undocumented: string[] = [];
  for (const name of SPEC_DOCS) {
    const src = path.join(from, name);
    if (!existsSync(src)) throw new Error(`${path.relative(root, src)} is missing`);
    const raw = readFileSync(src, "utf8");
    const md = expandSpecMarkdown(raw, root);
    if (hasMarkers(md)) throw new Error(`${name}: a generated-block marker was not expanded`);
    undocumented.push(...undocumentedFields(raw, root));
    writeFileSync(path.join(to, name), md);
    written.push(`${SPEC_DIR}/${name}`);
  }
  return { written, undocumented: [...new Set(undocumented)] };
}

/* ------------------------------------------------------------------ audit + zip */

export function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

/**
 * A package path that never ships: a dotfile anywhere in the path (.DS_Store …), the old private photo manifest, or
 * images/manifest.json — handoff:photos' workspace file (handoff:slice reads it to write data/photos.js, which is all the
 * browser needs), never zipped or published.
 */
export function isJunkPath(rel: string): boolean {
  return rel.split("/").some((seg) => seg.startsWith(".")) || rel === "data/photo-manifest.json" || rel === "images/manifest.json";
}

/** One Artifact publish carries at most this many files; past it the package goes up over several publishes. */
export const ARTIFACT_PUBLISH_FILES = 255;
/** An Artifact version holds at most this many files — past it the package cannot be one Artifact at all. */
export const ARTIFACT_VERSION_FILES = 511;

const DATA_FILE_RE = /^data\/(?:rules|team|customers|fixtures|estimates|meta|photos|catalog-[1-9]\d*)\.js$/;
/** Is `rel` a path the package may hold (anything else fails the audit)? The layout of spec §2. */
export function allowedPackagePath(rel: string): boolean {
  if (rel === "index.html" || rel === "CONFIDENTIAL.txt") return true;
  if (/^app\/[^]+$/.test(rel) && !rel.split("/").includes("..")) return true;
  if (DATA_FILE_RE.test(rel)) return true;
  const img = /^images\/([^/]+)$/.exec(rel);
  if (img) return IMAGE_FILE_RE.test(img[1]);
  return (SPEC_DOCS as readonly string[]).some((d) => rel === `${SPEC_DIR}/${d}`) || /^spec\/golden\/[^/]+\.json$/.test(rel) || /^spec\/screenshots\/[^/]+\.png$/.test(rel);
}

/** Package files read as text for the secret scan (images and fonts are binary). */
const TEXT_FILE_RE = /\.(?:js|mjs|css|html?|md|json|txt|svg|csv|xml)$/i;

/** What the package must contain (beyond data/): the page, the app, the engine, the docs, and the notice. */
export const REQUIRED_FILES = ["index.html", "CONFIDENTIAL.txt", "app/app.js", "app/app.css", ENGINE_FILE, ...SPEC_DOCS.map((d) => `${SPEC_DIR}/${d}`)] as const;

export type PackageAudit = {
  files: Array<{ file: string; bytes: number }>;
  totalBytes: number;
  /** Files over MAX_FILE_BYTES. */
  oversize: string[];
  /** total > MAX_TOTAL_BYTES. */
  totalOver: boolean;
  /** Files whose bytes contain a private Blob pathname (PRIVATE_PATH_RE). */
  privatePaths: string[];
  /** Junk (isJunkPath) present in the folder — never zipped, but reported. */
  junk: string[];
  missing: string[];
  /** Files outside the package layout (allowedPackagePath) — a stray file fails the audit. */
  unexpected: string[];
  /** Text files whose content matches a secret rule (scanForSecrets): file → rule names. */
  secrets: Array<{ file: string; rules: string[] }>;
  /** Shipped file count, and the Artifact warnings it earns (never a failure: the zip has no such limit). */
  fileCount: number;
  warnings: string[];
  ok: boolean;
};

/** The Artifact file-count warnings for a package of `n` files (empty under ARTIFACT_PUBLISH_FILES). */
export function fileCountWarnings(n: number): string[] {
  if (n > ARTIFACT_VERSION_FILES)
    return [`!!! ${n} files — over ${ARTIFACT_VERSION_FILES}, the most one Artifact version holds: the package cannot be published as one Artifact (ship the zip, or cut images)`];
  if (n > ARTIFACT_PUBLISH_FILES)
    return [`${n} files — over ${ARTIFACT_PUBLISH_FILES}, one Artifact publish's limit: publish in several passes to the same Artifact (the zip is unaffected)`];
  return [];
}

/** Shipped package files (junk is never zipped) that carry a private Blob pathname — the package's one private-path check. [] = clean. */
export function privatePathFiles(pkg: string, files: readonly string[] = listFiles(pkg).filter((f) => !isJunkPath(f))): string[] {
  return files.filter((f) => PRIVATE_PATH_RE.test(readFileSync(path.join(pkg, f)).toString("latin1")));
}

/** The package folder against every size / privacy / layout rule. */
export function auditPackage(pkg: string): PackageAudit {
  const all = listFiles(pkg);
  const junk = all.filter(isJunkPath);
  const files = all.filter((f) => !isJunkPath(f)).map((file) => ({ file, bytes: statSync(path.join(pkg, file)).size }));
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const oversize = files.filter((f) => f.bytes > MAX_FILE_BYTES).map((f) => f.file);
  const privatePaths = privatePathFiles(pkg, files.map((f) => f.file));
  const have = new Set(files.map((f) => f.file));
  const missing = REQUIRED_FILES.filter((f) => !have.has(f));
  const totalOver = totalBytes > MAX_TOTAL_BYTES;
  const unexpected = files.map((f) => f.file).filter((f) => !allowedPackagePath(f));
  const secrets = files
    .filter((f) => TEXT_FILE_RE.test(f.file))
    .map((f) => ({ file: f.file, rules: scanForSecrets(readFileSync(path.join(pkg, f.file), "utf8")) }))
    .filter((x) => x.rules.length > 0);
  const fileCount = files.length;
  return {
    files, totalBytes, oversize, totalOver, privatePaths, junk, missing, unexpected, secrets, fileCount, warnings: fileCountWarnings(fileCount),
    ok: !oversize.length && !totalOver && !privatePaths.length && !missing.length && !unexpected.length && !secrets.length,
  };
}

/** The audit's failures, one line each ([] = it passed). */
export function auditProblems(a: PackageAudit): string[] {
  return [
    ...a.oversize.map((f) => `${f} is over ${MAX_FILE_BYTES} bytes`),
    ...(a.totalOver ? [`the package is ${a.totalBytes} bytes, over ${MAX_TOTAL_BYTES}`] : []),
    ...a.privatePaths.map((f) => `${f} contains a private Blob pathname (<prefix>/<id>/…)`),
    ...a.missing.map((f) => `${f} is missing`),
    ...a.unexpected.map((f) => `${f} is not part of the package layout (stray file)`),
    ...a.secrets.map((s) => `${s.file} matches secret rule(s) ${s.rules.join(", ")}`),
  ];
}

/** The package files the zip carries (folder-relative): everything except junk, CONFIDENTIAL.txt first, then sorted. */
export function zipEntries(pkg: string): string[] {
  const files = listFiles(pkg).filter((f) => !isJunkPath(f));
  return [...files.filter((f) => f === "CONFIDENTIAL.txt"), ...files.filter((f) => f !== "CONFIDENTIAL.txt")];
}

/** A package file's name inside the zip: under ZIP_ROOT/. */
export const zipName = (rel: string): string => `${ZIP_ROOT}/${rel}`;

const STORED = /\.(webp|png|jpe?g|gif|woff2?|zip)$/i;

/**
 * Writes the zip deterministically: every entry under ZIP_ROOT/ (CONFIDENTIAL.txt first, the rest sorted), one fixed
 * timestamp, no folder entries, DEFLATE for text and STORE for already-compressed images/fonts. Same package →
 * same bytes. Returns the zip's size and entry names (with the ZIP_ROOT/ prefix).
 */
export async function writeZip(pkg: string, zipFile: string, date: Date = new Date(Date.UTC(2026, 0, 1))): Promise<{ bytes: number; entries: string[] }> {
  const files = zipEntries(pkg);
  if (!files.includes("CONFIDENTIAL.txt")) throw new Error(`${pkg} has no CONFIDENTIAL.txt — refusing to zip`);
  const zip = new JSZip();
  for (const e of files) {
    zip.file(zipName(e), readFileSync(path.join(pkg, e)), { date, createFolders: false, compression: STORED.test(e) ? "STORE" : "DEFLATE", compressionOptions: { level: 6 } });
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", platform: "DOS", streamFiles: false });
  mkdirSync(path.dirname(zipFile), { recursive: true });
  writeFileSync(zipFile, buf);
  return { bytes: buf.length, entries: files.map(zipName) };
}

/** The slice's export time (meta.js), as the zip's fixed timestamp; Jan 1 2026 UTC when there is none. */
export function zipDateOf(pkg: string): Date {
  const meta = readSliceGlobals(pkg, ["meta.js"]).PEAK_META as { exportedAt?: unknown } | undefined;
  const d = typeof meta?.exportedAt === "string" ? new Date(meta.exportedAt) : null;
  return d && Number.isFinite(d.getTime()) && d.getUTCFullYear() >= 1980 ? d : new Date(Date.UTC(2026, 0, 1));
}

/** The zip beside a package folder: output/peak-estimator-handoff → output/peak-estimator-handoff.zip. Only a passing --full writes it. */
export const zipPathFor = (out: string): string => `${path.resolve(out)}.zip`;
