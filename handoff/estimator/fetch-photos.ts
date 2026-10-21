/**
 * handoff:photos — downloads the primary product photo of every part the sliced estimates and fixtures name from
 * Peak's PRIVATE Vercel Blob store into the package's images/ folder. Jeff runs it, with the production token in
 * his own shell (this repo never holds one):
 *
 *   BLOB_READ_WRITE_TOKEN=… npm run handoff:photos -- --in <export.json> --out output/peak-estimator-handoff/images
 *   npm run handoff:photos -- --in <export.json> --out output/peak-estimator-handoff/images --dry-run     (no token, no network)
 *
 * Then re-run handoff:slice (it writes data/photos.js when images/manifest.json exists) and handoff:build.
 * --out must be inside output/ and be empty, missing, or an earlier handoff:photos folder (it holds our manifest.json);
 * anything else is refused before a byte is written (photosOutProblem).
 * --recent-days <n> (default 28; the SAME flag and rule as handoff:slice — pass the same value to both): only the parts the
 * Estimator estimates changed within n days of the export's exportedAt (and every assembly) use are downloaded.
 * Options: --dry-run · --verbose (list every pick) · --force (re-download files already in the folder) ·
 *          --prune (delete image files in the folder the manifest does not reference) ·
 *          --concurrency N (default 6) · --retries N (default 2).
 *
 * The selection (sku → document → private Blob pathname) is recomputed from the export on every run; the Blob pathnames
 * are never written into the package (images/manifest.json holds file names only). Each pathname is checked against the
 * app's own rule (part-docs/<docId>/<one safe file name>) before anything is fetched. Files are written to <file>.part
 * and renamed; a file already in the folder is re-checked (format, completeness) before it is reused. Three
 * consecutive 401/403 responses abort the run.
 *
 * Which photo: photo-select.ts (the app's own rule). Files are kept exactly as stored (WebP) — no transcoding —
 * and named <docId>.<ext>. A link-only document (no stored file) is recorded in manifest.json, not downloaded.
 * Exit codes: 0 done · 1 some downloads failed (manifest still written for the rest), the token was rejected, or no estimate falls in the window · 2 usage / missing token / bad export.
 * Plan: PR 2 Task 11.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { downloadPlan, DOC_ID_RE, IMAGE_FILE_RE, parsePhotoManifest, PHOTO_MANIFEST_VERSION, selectPhotos, type PhotoManifest, type PhotoPick, type PhotoSelection } from "./photo-select";
import { DEFAULT_RECENT_DAYS, SelectionError, describeEstimateSelection, noEstimatesMessage, parseRecentDays, scanForSecrets, selectBundledEstimates, summarizeEstimate, pickAndScrub, FIXTURE_FIELDS, type DocRow, type QuoteDoc, type RecentWindow, type ScrubEntry } from "./slice-rules";
import type { ExportV2 } from "./slice";

/** Per-image ceiling (the app's own MAX_PART_IMAGE_BYTES); anything bigger is refused, not buffered. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_CONCURRENCY = 6;
export const DEFAULT_RETRIES = 2;
/** Consecutive 401/403 responses after which the run stops (a rejected token fails every document alike). */
export const AUTH_ABORT_AFTER = 3;
export const AUTH_ABORT_MESSAGE = "Blob token rejected — check BLOB_READ_WRITE_TOKEN";

/** A Blob read the store refused for want of valid credentials (HTTP 401/403). */
export class BlobAuthError extends Error {
  constructor(message = "access denied") {
    super(message);
    this.name = "BlobAuthError";
  }
}

/** True for our own BlobAuthError, the SDK's BlobAccessError, or anything carrying an HTTP status of 401/403. */
export function isAuthError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as { status?: unknown; statusCode?: unknown }).status ?? (e as { statusCode?: unknown }).statusCode;
  return e instanceof BlobAuthError || e.name === "BlobAccessError" || status === 401 || status === 403;
}

/**
 * Mirrors src/lib/part-docs/types.ts blobPathBelongsTo (a strict allow-list: `get` concatenates the pathname into a URL,
 * so literal ".." / "/" blocklists can be bypassed by encoded or backslash traversal). The key must be
 * `part-docs/<docId>/<one file segment>`; the segment starts with a letter, digit, "_" or "-", and holds only
 * letters, digits, ".", "_", "-" (no "%", "\\", "?", "#", spaces, control characters, slashes or a leading dot).
 */
const SAFE_FILE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/;
export function blobKeyBelongsTo(blobKey: unknown, docId: string): blobKey is string {
  if (typeof blobKey !== "string" || !DOC_ID_RE.test(docId)) return false;
  const prefix = `part-docs/${docId}/`;
  return blobKey.startsWith(prefix) && SAFE_FILE_SEGMENT.test(blobKey.slice(prefix.length));
}

/** What a Blob read returns: the bytes, or null when the blob does not exist (never retried). Throws on anything else. */
export type BlobClient = { read(blobKey: string): Promise<Uint8Array | null> };

/** The real client: @vercel/blob get(key, { access: "private" }), authorized by BLOB_READ_WRITE_TOKEN (src/lib/blob.ts's call). */
export async function vercelBlobClient(): Promise<BlobClient> {
  const { get, BlobNotFoundError, BlobAccessError } = await import("@vercel/blob");
  return {
    async read(blobKey) {
      let res: Awaited<ReturnType<typeof get>>;
      try {
        res = await get(blobKey, { access: "private" });
      } catch (e) {
        if (e instanceof BlobNotFoundError) return null;
        if (e instanceof BlobAccessError) throw new BlobAuthError(e.message);
        throw e;
      }
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      const reader = res.stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_IMAGE_BYTES) throw new Error(`larger than ${MAX_IMAGE_BYTES} bytes`);
          chunks.push(value);
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
      }
      return Buffer.concat(chunks, total);
    },
  };
}

/** The image format a file's first bytes declare (extension used on disk), or null when it is not a browser image. */
export function sniffImageExt(b: Uint8Array): "webp" | "png" | "jpg" | "gif" | null {
  const at = (i: number) => b[i];
  if (b.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "webp";
  if (b.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  if (b.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "gif";
  return null;
}

/**
 * A stored image that really is whole: right format AND its own end marker (WebP: RIFF length = file length; PNG ends in
 * IEND + CRC; JPEG ends FFD9; GIF ends 3B). Catches a truncated copy left by an interrupted run. Returns the format or null.
 */
export function completeImageExt(b: Uint8Array): "webp" | "png" | "jpg" | "gif" | null {
  const ext = sniffImageExt(b);
  const n = b.length;
  if (!ext) return null;
  if (ext === "webp") return n >= 12 && (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) + 8 === n ? ext : null;
  if (ext === "png") return n >= 20 && b[n - 8] === 0x49 && b[n - 7] === 0x45 && b[n - 6] === 0x4e && b[n - 5] === 0x44 ? ext : null;
  if (ext === "jpg") return n >= 4 && b[n - 2] === 0xff && b[n - 1] === 0xd9 ? ext : null;
  return n >= 7 && b[n - 1] === 0x3b ? ext : null;
}

export type DownloadResult = {
  /** document id → file name written (or already present) in the folder. */
  files: Record<string, string>;
  failed: Array<{ docId: string; error: string }>;
  downloaded: number;
  reused: number;
  bytes: number;
  /** Set when the run stopped early (a rejected token); documents not attempted are in neither files nor failed. */
  aborted?: string;
};

export type DownloadOptions = {
  client: BlobClient;
  outDir: string;
  concurrency?: number;
  retries?: number;
  force?: boolean;
  /** Backoff between attempts (ms, doubles each retry). Tests pass 0. */
  backoffMs?: number;
  /** Text to blank out of error messages (the token). */
  redact?: string[];
};

/** A usable copy already in the folder: the file is re-read and must be a whole image whose format matches its extension. */
const existingFile = (dir: string, docId: string): string | null => {
  for (const ext of ["webp", "png", "jpg", "gif"]) {
    const f = `${docId}.${ext}`;
    try {
      if (completeImageExt(fs.readFileSync(path.join(dir, f))) === ext) return f;
    } catch {
      /* not there */
    }
  }
  return null;
};

function redacted(msg: string, secrets: readonly string[]): string {
  let out = msg;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  // a Blob error often quotes the pathname it was asked for; those are private and never go into the manifest
  out = out.replace(/part-docs\/[^\s"'`]*/g, "[blob path]");
  return out.slice(0, 300);
}

/** Downloads each document once (concurrency, retries); writes <docId>.<ext> into outDir. Never throws for one bad document. */
export async function downloadPhotos(items: ReadonlyArray<{ docId: string; blobKey: string }>, opts: DownloadOptions): Promise<DownloadResult> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const retries = Math.max(0, opts.retries ?? DEFAULT_RETRIES);
  const backoff = opts.backoffMs ?? 500;
  fs.mkdirSync(opts.outDir, { recursive: true });
  const res: DownloadResult = { files: {}, failed: [], downloaded: 0, reused: 0, bytes: 0 };
  let next = 0;
  let authStreak = 0;
  const one = async (it: { docId: string; blobKey: string }) => {
    if (!DOC_ID_RE.test(it.docId)) {
      res.failed.push({ docId: it.docId, error: "document id is not a safe file name" });
      return;
    }
    // The export is data, not trust: only part-docs/<this doc>/<one safe segment> is ever handed to the Blob client.
    if (!blobKeyBelongsTo(it.blobKey, it.docId)) {
      res.failed.push({ docId: it.docId, error: "blob path outside part-docs/<docId>/" });
      return;
    }
    if (!opts.force) {
      const have = existingFile(opts.outDir, it.docId);
      if (have) {
        res.files[it.docId] = have;
        res.reused++;
        return;
      }
    }
    if (res.aborted) return;
    let lastErr = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0 && backoff > 0) await new Promise((r) => setTimeout(r, backoff * 2 ** (attempt - 1)));
      try {
        const bytes = await opts.client.read(it.blobKey);
        authStreak = 0;
        if (bytes === null) {
          res.failed.push({ docId: it.docId, error: "not found in Blob" });
          return;
        }
        const ext = sniffImageExt(bytes);
        if (!ext) {
          lastErr = "the stored file is not an image";
          continue;
        }
        const file = `${it.docId}.${ext}`;
        if (!IMAGE_FILE_RE.test(file)) {
          res.failed.push({ docId: it.docId, error: "unsafe file name" });
          return;
        }
        // a stale copy of this document in another format is removed so the folder holds exactly one file per document
        for (const other of ["webp", "png", "jpg", "gif"]) if (`${it.docId}.${other}` !== file) fs.rmSync(path.join(opts.outDir, `${it.docId}.${other}`), { force: true });
        const dest = path.join(opts.outDir, file);
        const tmp = `${dest}.part`;
        try {
          fs.writeFileSync(tmp, bytes);
          fs.renameSync(tmp, dest);
        } catch (we) {
          fs.rmSync(tmp, { force: true });
          throw we;
        }
        res.files[it.docId] = file;
        res.downloaded++;
        res.bytes += bytes.byteLength;
        return;
      } catch (e) {
        lastErr = redacted(e instanceof Error ? e.message : String(e), opts.redact ?? []);
        if (isAuthError(e)) {
          // a refused token is not transient: no retry for this document, and a streak stops the whole run
          if (++authStreak >= AUTH_ABORT_AFTER && !res.aborted) res.aborted = AUTH_ABORT_MESSAGE;
          break;
        }
        authStreak = 0;
      }
    }
    res.failed.push({ docId: it.docId, error: lastErr || "failed" });
  };
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length || res.aborted) return;
      await one(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  res.failed.sort((a, b) => a.docId.localeCompare(b.docId));
  return res;
}

/** images/manifest.json for a selection and what was downloaded: only skus whose file really exists are mapped. Pure. */
export function buildPhotoManifest(picks: readonly PhotoPick[], result: DownloadResult): PhotoManifest {
  const bySku: Record<string, string> = {};
  const byDoc: Record<string, string> = {};
  for (const p of picks) {
    const file = result.files[p.docId];
    if (!file) continue;
    bySku[p.sku] = p.docId;
    byDoc[p.docId] = file;
  }
  const { linkOnly } = downloadPlan(picks);
  return { version: PHOTO_MANIFEST_VERSION, bySku, byDoc, linkOnly: linkOnly.map(({ sku, docId }) => ({ sku, docId })), failed: result.failed };
}

/** Entries of the images folder the manifest does not reference (manifest.json itself and in-flight .part files excluded from "referenced" only for the manifest). Pure on the listing. */
export function unreferencedFiles(names: readonly string[], manifest: Pick<PhotoManifest, "byDoc">): string[] {
  const keep = new Set<string>(["manifest.json", ...Object.values(manifest.byDoc)]);
  return names.filter((n) => !keep.has(n)).sort();
}

/** Lists the folder's top-level entries and returns the unreferenced ones; with `prune`, deletes only the IMAGE_FILE_RE matches among them. */
export function reconcileImagesDir(dir: string, manifest: Pick<PhotoManifest, "byDoc">, prune: boolean): { unreferenced: string[]; pruned: string[]; remaining: string[] } {
  const unreferenced = unreferencedFiles(fs.readdirSync(dir), manifest);
  const pruned: string[] = [];
  if (prune) {
    for (const n of unreferenced) {
      if (!IMAGE_FILE_RE.test(n)) continue;
      const p = path.join(dir, n);
      if (!fs.statSync(p).isFile()) continue;
      fs.rmSync(p);
      pruned.push(n);
    }
  }
  return { unreferenced, pruned, remaining: unreferenced.filter((n) => !pruned.includes(n)) };
}

/**
 * The estimates the slicer will bundle for this export and window (slice-rules.ts selectBundledEstimates — the very function
 * handoff:slice calls, so the two cannot pick differently). Throws SelectionError(no-exported-at | no-estimates).
 */
export function estimatesForExport(exp: ExportV2, recentDays: number = DEFAULT_RECENT_DAYS): { window: RecentWindow; estimates: QuoteDoc[] } {
  const sel = selectBundledEstimates((exp.collections?.quotes ?? []) as DocRow[], exp.meta?.exportedAt, recentDays);
  if (sel.estimates.length === 0) throw new SelectionError("no-estimates", noEstimatesMessage(sel.window));
  return sel;
}

/** The selection for an export, exactly as the slicer will slice it (same estimates, fixtures). */
export function selectionForExport(exp: ExportV2, recentDays: number = DEFAULT_RECENT_DAYS): PhotoSelection {
  const { estimates } = estimatesForExport(exp, recentDays);
  const log: ScrubEntry[] = [];
  const fixtures = (exp.collections?.subassemblies ?? []).filter((r) => !r.deleted).map((r) => pickAndScrub({ ...(r.doc ?? {}), id: r.id }, FIXTURE_FIELDS, r.id, log));
  return selectPhotos(exp, estimates, fixtures);
}

/** The --dry-run report (and the header of a real run). */
export function describeSelection(sel: PhotoSelection, verbose = false): string[] {
  const plan = downloadPlan(sel.picks);
  const own = sel.picks.filter((p) => p.via === "own").length;
  const lines = [
    `parts the sliced estimates and fixtures name: ${sel.scopeSkus.length}`,
    `  with a photo: ${sel.picks.length}  (own primary image: ${own}, manufacturer image: ${sel.picks.length - own})`,
    `  without a photo (placeholder): ${sel.withoutPhoto.length}`,
    `documents to download from private Blob: ${plan.download.length}`,
    `link-only documents (recorded, not downloaded): ${plan.linkOnly.length}`,
  ];
  const shown = verbose ? sel.picks : sel.picks.slice(0, 15);
  if (shown.length) lines.push(verbose ? "picks:" : `picks (first ${shown.length} of ${sel.picks.length}; --verbose lists all):`);
  for (const p of shown) lines.push(`  ${p.sku}  ←  ${p.docId}  [${p.via}]  ${p.blobKey ?? `link-only ${p.sourceUrl ?? ""}`}`);
  if (verbose && sel.withoutPhoto.length) lines.push("without a photo:", ...sel.withoutPhoto.map((s) => `  ${s}`));
  return lines;
}

/** The repo's output/ folder — the only place handoff:photos writes (like handoff:build's --out). */
export const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, "..", "..", "output");

/**
 * Why `out` can't be handoff:photos' folder, or null when it can: it must sit inside `outputRoot` (output/), and be
 * missing, empty, or already hold a handoff images/manifest.json — so a mistyped --out (a home folder, a Downloads
 * folder) is refused before anything is written, and --prune can never delete files that aren't ours.
 */
export function photosOutProblem(outputRoot: string, out: string): string | null {
  const abs = path.resolve(out);
  const rel = path.relative(path.resolve(outputRoot), abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return `--out must be inside ${path.resolve(outputRoot)}${path.sep} (got ${out}); refusing to write there`;
  if (!fs.existsSync(abs)) return null;
  if (!fs.statSync(abs).isDirectory()) return `--out ${out} is a file, not a folder`;
  const names = fs.readdirSync(abs);
  if (names.length === 0) return null;
  let manifest: PhotoManifest | null = null;
  try {
    manifest = names.includes("manifest.json") ? parsePhotoManifest(JSON.parse(fs.readFileSync(path.join(abs, "manifest.json"), "utf8"))) : null;
  } catch {
    manifest = null;
  }
  return manifest ? null : `--out ${out} is not empty and holds no handoff:photos manifest.json — refusing (it may not be an images folder; --prune would delete its files). Use an empty folder.`;
}

export async function main(argv: string[], env: Record<string, string | undefined> = process.env, makeClient: () => Promise<BlobClient> = vercelBlobClient, outputRoot: string = DEFAULT_OUTPUT_ROOT): Promise<number> {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = val("--in"), out = val("--out");
  const dry = argv.includes("--dry-run");
  if (!input || !out) {
    console.error("usage: npm run handoff:photos -- --in <export.json> --out <images dir> [--recent-days <n>] [--dry-run] [--verbose] [--force] [--prune] [--concurrency N] [--retries N]");
    return 2;
  }
  let recentDays: number;
  try {
    recentDays = parseRecentDays(val("--recent-days"));
  } catch (e) {
    console.error(`handoff:photos: ${e instanceof Error ? e.message : String(e)} Nothing was downloaded or written.`);
    return 2;
  }
  let exp: ExportV2;
  try {
    exp = JSON.parse(fs.readFileSync(input, "utf8")) as ExportV2;
  } catch (e) {
    console.error(`${input}: cannot read the export (${e instanceof Error ? e.message : String(e)})`);
    return 2;
  }
  if (exp.meta?.format !== 2) {
    console.error(`${input}: expected a format-2 export (re-run npm run db:export); got format ${exp.meta?.format ?? "?"}`);
    return 2;
  }
  let sel: PhotoSelection;
  try {
    const { window, estimates } = estimatesForExport(exp, recentDays);
    for (const l of describeEstimateSelection(window, estimates.map((q) => summarizeEstimate(q)))) console.log(l);
    sel = selectionForExport(exp, recentDays);
  } catch (e) {
    if (e instanceof SelectionError) {
      console.error(`handoff:photos: ${e.message} Nothing was downloaded or written.`);
      return e.code === "no-estimates" ? 1 : 2;
    }
    throw e;
  }
  for (const l of describeSelection(sel, argv.includes("--verbose"))) console.log(l);
  if (dry) {
    console.log("dry run: nothing downloaded, nothing written.");
    return 0;
  }
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("handoff:photos needs BLOB_READ_WRITE_TOKEN (the production Blob read-write token) in your shell, e.g.\n  BLOB_READ_WRITE_TOKEN=… npm run handoff:photos -- --in <export.json> --out <images dir>\nUse --dry-run to see what would be downloaded without it. Nothing was downloaded or written.");
    return 2;
  }
  const outProblem = photosOutProblem(outputRoot, out);
  if (outProblem) {
    console.error(`handoff:photos: ${outProblem} Nothing was downloaded or written.`);
    return 2;
  }
  const plan = downloadPlan(sel.picks);
  const outDir = path.resolve(out);
  const client = await makeClient();
  const num = (name: string, d: number) => {
    const n = Number(val(name));
    return Number.isFinite(n) && n >= 0 && val(name) !== undefined ? n : d;
  };
  const t0 = Date.now();
  const result = await downloadPhotos(plan.download, {
    client,
    outDir,
    concurrency: num("--concurrency", DEFAULT_CONCURRENCY),
    retries: num("--retries", DEFAULT_RETRIES),
    force: argv.includes("--force"),
    redact: [token],
  });
  if (result.aborted) {
    console.error(`${result.aborted}. Stopped after ${AUTH_ABORT_AFTER} consecutive 401/403 responses; ${result.downloaded} downloaded before that. images/manifest.json was not written.`);
    return 1;
  }
  const manifest = buildPhotoManifest(sel.picks, result);
  const body = JSON.stringify(manifest, null, 2) + "\n";
  const hits = scanForSecrets(body);
  if (hits.length) {
    console.error(`SECRET SCAN: images/manifest.json matches ${hits.join(", ")}; not written.`);
    return 1;
  }
  const manifestFile = path.join(outDir, "manifest.json");
  fs.writeFileSync(`${manifestFile}.part`, body);
  fs.renameSync(`${manifestFile}.part`, manifestFile);
  console.log(`downloaded ${result.downloaded} (${(result.bytes / 1e6).toFixed(2)} MB), already present ${result.reused}, failed ${result.failed.length}, link-only ${plan.linkOnly.length} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const f of result.failed) console.error(`  FAILED ${f.docId}: ${f.error}`);
  for (const l of plan.linkOnly) console.log(`  link-only (not downloaded) ${l.sku} ← ${l.docId} ${l.sourceUrl ?? ""}`);
  console.log(`wrote ${path.join(outDir, "manifest.json")} (${Object.keys(manifest.byDoc).length} images for ${Object.keys(manifest.bySku).length} parts)`);
  const rec = reconcileImagesDir(outDir, manifest, argv.includes("--prune"));
  if (rec.pruned.length) console.log(`pruned ${rec.pruned.length} unreferenced image file(s): ${rec.pruned.join(", ")}`);
  if (rec.remaining.length) console.warn(`WARNING: ${rec.remaining.length} unreferenced files in images/ — delete them or pass --prune${argv.includes("--prune") ? " (--prune removes image files only; the rest need deleting by hand)" : ""}: ${rec.remaining.slice(0, 10).join(", ")}${rec.remaining.length > 10 ? ", …" : ""}`);
  console.log("next: npm run handoff:slice (writes data/photos.js), then npm run handoff:build");
  return result.failed.length ? 1 : 0;
}

if (/handoff[\\/]estimator[\\/]fetch-photos\.ts$/.test(path.resolve(process.argv[1] ?? ""))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
