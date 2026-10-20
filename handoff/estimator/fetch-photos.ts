/**
 * handoff:photos — downloads the primary product photo of every part the sliced estimates and fixtures name from
 * Peak's PRIVATE Vercel Blob store into the package's images/ folder. Jeff runs it, with the production token in
 * his own shell (this repo never holds one):
 *
 *   BLOB_READ_WRITE_TOKEN=… npm run handoff:photos -- --in <export.json> --out output/peak-estimator-handoff/images
 *   npm run handoff:photos -- --in <export.json> --out output/peak-estimator-handoff/images --dry-run     (no token, no network)
 *
 * Then re-run handoff:slice (it writes data/photos.js when images/manifest.json exists) and handoff:build.
 * Options: --dry-run · --verbose (list every pick) · --force (re-download files already in the folder) ·
 *          --concurrency N (default 6) · --retries N (default 2).
 *
 * Which photo: photo-select.ts (the app's own rule). Files are kept exactly as stored (WebP) — no transcoding —
 * and named <docId>.<ext>. A link-only document (no stored file) is recorded in manifest.json, not downloaded.
 * Exit codes: 0 done · 1 some downloads failed (manifest still written for the rest) · 2 usage / missing token / bad export.
 * Plan: PR 2 Task 11.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { downloadPlan, DOC_ID_RE, IMAGE_FILE_RE, PHOTO_MANIFEST_VERSION, selectPhotos, type PhotoManifest, type PhotoPick, type PhotoSelection } from "./photo-select";
import { scanForSecrets, selectEstimates, pickAndScrub, FIXTURE_FIELDS, type DocRow, type ScrubEntry } from "./slice-rules";
import type { ExportV2 } from "./slice";

/** Per-image ceiling (the app's own MAX_PART_IMAGE_BYTES); anything bigger is refused, not buffered. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_CONCURRENCY = 6;
export const DEFAULT_RETRIES = 2;

/** What a Blob read returns: the bytes, or null when the blob does not exist (never retried). Throws on anything else. */
export type BlobClient = { read(blobKey: string): Promise<Uint8Array | null> };

/** The real client: @vercel/blob get(key, { access: "private" }), authorized by BLOB_READ_WRITE_TOKEN (src/lib/blob.ts's call). */
export async function vercelBlobClient(): Promise<BlobClient> {
  const { get } = await import("@vercel/blob");
  return {
    async read(blobKey) {
      let res: Awaited<ReturnType<typeof get>>;
      try {
        res = await get(blobKey, { access: "private" });
      } catch (e) {
        if (e instanceof Error && e.name === "BlobNotFoundError") return null;
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

export type DownloadResult = {
  /** document id → file name written (or already present) in the folder. */
  files: Record<string, string>;
  failed: Array<{ docId: string; error: string }>;
  downloaded: number;
  reused: number;
  bytes: number;
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

const existingFile = (dir: string, docId: string): string | null => {
  for (const ext of ["webp", "png", "jpg", "gif"]) {
    const f = `${docId}.${ext}`;
    try {
      if (fs.statSync(path.join(dir, f)).size > 0) return f;
    } catch {
      /* not there */
    }
  }
  return null;
};

function redacted(msg: string, secrets: readonly string[]): string {
  let out = msg;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
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
  const one = async (it: { docId: string; blobKey: string }) => {
    if (!DOC_ID_RE.test(it.docId)) {
      res.failed.push({ docId: it.docId, error: "document id is not a safe file name" });
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
    let lastErr = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0 && backoff > 0) await new Promise((r) => setTimeout(r, backoff * 2 ** (attempt - 1)));
      try {
        const bytes = await opts.client.read(it.blobKey);
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
        fs.writeFileSync(path.join(opts.outDir, file), bytes);
        res.files[it.docId] = file;
        res.downloaded++;
        res.bytes += bytes.byteLength;
        return;
      } catch (e) {
        lastErr = redacted(e instanceof Error ? e.message : String(e), opts.redact ?? []);
      }
    }
    res.failed.push({ docId: it.docId, error: lastErr || "failed" });
  };
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
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

/** The selection for an export, exactly as the slicer will slice it (same estimates, fixtures). */
export function selectionForExport(exp: ExportV2): PhotoSelection {
  const estimates = selectEstimates((exp.collections?.quotes ?? []) as DocRow[]);
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

export async function main(argv: string[], env: Record<string, string | undefined> = process.env, makeClient: () => Promise<BlobClient> = vercelBlobClient): Promise<number> {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = val("--in"), out = val("--out");
  const dry = argv.includes("--dry-run");
  if (!input || !out) {
    console.error("usage: npm run handoff:photos -- --in <export.json> --out <images dir> [--dry-run] [--verbose] [--force] [--concurrency N] [--retries N]");
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
  const sel = selectionForExport(exp);
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
  const manifest = buildPhotoManifest(sel.picks, result);
  const body = JSON.stringify(manifest, null, 2) + "\n";
  const hits = scanForSecrets(body);
  if (hits.length) {
    console.error(`SECRET SCAN: images/manifest.json matches ${hits.join(", ")}; not written.`);
    return 1;
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), body);
  console.log(`downloaded ${result.downloaded} (${(result.bytes / 1e6).toFixed(2)} MB), already present ${result.reused}, failed ${result.failed.length}, link-only ${plan.linkOnly.length} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const f of result.failed) console.error(`  FAILED ${f.docId}: ${f.error}`);
  for (const l of plan.linkOnly) console.log(`  link-only (not downloaded) ${l.sku} ← ${l.docId} ${l.sourceUrl ?? ""}`);
  console.log(`wrote ${path.join(outDir, "manifest.json")} (${Object.keys(manifest.byDoc).length} images for ${Object.keys(manifest.bySku).length} parts)`);
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
