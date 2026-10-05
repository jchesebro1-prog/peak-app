/**
 * DaVinci product drawings → `symbol` / `riser` part documents (#300 slice 3,
 * spec §3, D610–D611). Peak has ETC's dealer permission to use them (D612).
 *
 *   npm run symbols:davinci                              → dry run, writes nothing
 *   npm run symbols:davinci -- --apply                   → write (hosted also needs --yes)
 *   npm run symbols:davinci -- --source <dir>            → a DaVinci export elsewhere
 *
 * `--source` is the folder holding the timestamped exports (default
 * `data/davinci/source`, the newest timestamp wins) or one export folder
 * itself (it has `images/`). Files are `images/{<uuid>}.svg|png`.
 *
 * Each catalog part matched to a DaVinci type exactly as #162/#207 do gets
 * that type's plan drawing (symbol) and riser drawing (riser) when the file
 * is on disk: SVG through `sanitizeSvg` (an SVG over its 1 MB cap is
 * rasterized to a ≤ 1024 px WebP instead — librsvg runs no scripts), PNG
 * shrunk to ≤ 1024 px WebP. One shared document per (image, kind) with a
 * deterministic id (davinciDrawingId), so a re-run never mints a second one;
 * linked through attachDocument (one current drawing per part per kind).
 * A drawing a person uploaded is never replaced (symbols-plan.ts).
 *
 * No Blob token → nothing is written: "Blob storage is not configured — dry
 * run only."
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { listDocs } from "../src/db/doc-store";
import { blobEnabled, deleteBlob, putBlob } from "../src/lib/blob";
import { loadExtract } from "../src/lib/davinci/load";
import { candidatesFor, planSymbolImport, type ExistingSymbol, type SymbolImportCandidate, type SymbolSkipReason } from "../src/lib/davinci/symbols-plan";
import { DRAWING_MAX_EDGE } from "../src/lib/part-docs/drawing-upload";
import { CONTENT_TYPES } from "../src/lib/part-docs/files";
import { shrinkImage } from "../src/lib/part-docs/shrink";
import { SVG_MAX_BYTES, sanitizeSvg } from "../src/lib/part-docs/svg-sanitize";
import { isDrawingKind, partDocBlobPath, safeDocFileName, type PartDocument } from "../src/lib/part-docs/types";
import { list as allParts } from "../src/lib/stores/catalog";
import { allDocumentLinks, attachDocument, createDocument, detachedDocumentLinks } from "../src/lib/stores/part-documents";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const n = (x: number) => x.toLocaleString("en-US");
const BY = "DaVinci drawings";

/** Deterministic per (kind, image), so a re-run never mints a second document. */
function davinciDrawingId(kind: string, imageId: string): string {
  return `PD-V${createHash("sha1").update(`${kind}\u0000${imageId}`).digest("hex").slice(0, 15)}`;
}

function argValue(flag: string): string | null {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : null;
}

/** The export folder: `dir` itself when it holds images/, else its newest timestamped child. */
function resolveExportDir(dir: string): string | null {
  const abs = path.resolve(dir);
  const has = (d: string) => {
    try {
      return statSync(path.join(d, "images")).isDirectory();
    } catch {
      return false;
    }
  };
  if (has(abs)) return abs;
  let children: string[] = [];
  try {
    children = readdirSync(abs).filter((c) => has(path.join(abs, c)));
  } catch {
    return null;
  }
  children.sort();
  return children.length ? path.join(abs, children[children.length - 1]) : null;
}

type OnDiskFile = { file: string; ext: "svg" | "png"; size: number };

/** `{UUID}.svg|png` → lower-case id without braces. SVG wins when both exist. */
function listImages(exportDir: string): Map<string, OnDiskFile> {
  const out = new Map<string, OnDiskFile>();
  const imagesDir = path.join(exportDir, "images");
  for (const name of readdirSync(imagesDir)) {
    const m = /^\{?([0-9a-fA-F-]{36})\}?\.(svg|png)$/i.exec(name);
    if (!m) continue;
    const id = m[1].toLowerCase();
    const ext = m[2].toLowerCase() as "svg" | "png";
    const prior = out.get(id);
    if (prior && prior.ext === "svg") continue;
    const file = path.join(imagesDir, name);
    out.set(id, { file, ext, size: statSync(file).size });
  }
  return out;
}

type Prepared =
  | { ok: true; bytes: Buffer; contentType: string; ext: "svg" | "webp"; removed: string[]; rasterized: boolean }
  | { ok: false; reason: string };

async function prepare(f: OnDiskFile): Promise<Prepared> {
  if (!f.size) return { ok: false, reason: "unreadable (empty file)" };
  const raw = readFileSync(f.file);
  if (f.ext === "png") {
    const shrunk = await shrinkImage(raw, { maxEdge: DRAWING_MAX_EDGE });
    return shrunk.ok
      ? { ok: true, bytes: shrunk.bytes, contentType: shrunk.contentType, ext: "webp", removed: [], rasterized: false }
      : { ok: false, reason: `unreadable (${shrunk.error})` };
  }
  if (raw.byteLength > SVG_MAX_BYTES) {
    // Over the sanitizer's cap: rasterize instead. librsvg (via sharp) draws the
    // SVG without running scripts, and only the WebP pixels are stored.
    try {
      const bytes = await sharp(raw, { limitInputPixels: 100_000_000 })
        .resize({ width: DRAWING_MAX_EDGE, height: DRAWING_MAX_EDGE, fit: "inside" })
        .webp({ quality: 80 })
        .toBuffer();
      return { ok: true, bytes, contentType: "image/webp", ext: "webp", removed: [], rasterized: true };
    } catch {
      return { ok: false, reason: "unreadable (oversized SVG did not rasterize)" };
    }
  }
  const clean = sanitizeSvg(raw.toString("utf8"));
  if (!clean.ok) return { ok: false, reason: `unreadable (${clean.error})` };
  return { ok: true, bytes: Buffer.from(clean.svg, "utf8"), contentType: CONTENT_TYPES.svg, ext: "svg", removed: clean.removed, rasterized: false };
}

/** One document per (kind, image id), linked to every part the plan attaches it to. */
type Group = { id: string; kind: "symbol" | "riser"; imageId: string; displayName: string; skus: string[] };

async function main() {
  const { hosted } = resolveDbTarget(apply ? "symbols:davinci (WRITE)" : "symbols:davinci (dry run)");
  if (apply) requireHostedConfirmation(hosted, args);

  const sourceArg = argValue("--source") ?? "data/davinci/source";
  const exportDir = resolveExportDir(sourceArg);
  if (!exportDir) {
    console.error(`\n  No DaVinci export with an images/ folder under ${path.resolve(sourceArg)}.\n  Pass --source <dir>.\n`);
    process.exit(1);
  }
  const files = listImages(exportDir);

  const extract = loadExtract();
  const catalog = (await allParts()).map((p) => ({ id: p.id, sku: p.sku, manufacturer: p.mfr }));
  const candidates = candidatesFor(extract, catalog);

  // Every drawing document (live) and every drawing link (live + detached) → ExistingSymbol.
  const drawingDocs = new Map<string, PartDocument>();
  for (const d of await listDocs<PartDocument>("part_documents")) if (isDrawingKind(d.kind)) drawingDocs.set(d.id, d);
  const existing: ExistingSymbol[] = [];
  const pushLinks = (links: Awaited<ReturnType<typeof allDocumentLinks>>, detached: boolean) => {
    for (const l of links) {
      const d = drawingDocs.get(l.documentId);
      if (!d || !isDrawingKind(d.kind)) continue;
      existing.push({ partSku: l.partSku, kind: d.kind, source: d.source, ...(d.sourceRef ? { sourceRef: d.sourceRef } : {}), ...(detached ? { detached: true } : {}) });
    }
  };
  pushLinks(await allDocumentLinks(), false);
  pushLinks(await detachedDocumentLinks(), true);

  const plan = planSymbolImport(candidates, new Set(files.keys()), existing);

  const groups = new Map<string, Group>();
  for (const c of plan.attach) {
    const id = davinciDrawingId(c.kind, c.imageId);
    const g = groups.get(id);
    if (g) g.skus.push(c.partSku);
    else groups.set(id, { id, kind: c.kind, imageId: c.imageId, displayName: c.displayName, skus: [c.partSku] });
  }

  // Prepare every file now (dry run too), so the report says what the write would store.
  const prepared = new Map<string, Prepared>();
  const unreadable: Array<{ g: Group; reason: string }> = [];
  let rasterized = 0;
  let sanitizedWithRemovals = 0;
  for (const g of groups.values()) {
    const p = await prepare(files.get(g.imageId)!);
    prepared.set(g.id, p);
    if (!p.ok) unreadable.push({ g, reason: p.reason });
    else {
      if (p.rasterized) rasterized++;
      if (p.removed.length) sanitizedWithRemovals++;
    }
  }

  const reasons: Record<SymbolSkipReason, number> = { "not-downloaded": 0, "already-present": 0, "hand-uploaded": 0, removed: 0 };
  for (const s of plan.skipped) reasons[s.reason]++;
  const byKind = (list: readonly SymbolImportCandidate[], k: string) => list.filter((c) => c.kind === k).length;
  const unreadableParts = unreadable.reduce((t, u) => t + u.g.skus.length, 0);

  console.log(`\n  library                 ${extract.libraryTimestamp}`);
  console.log(`  export                  ${exportDir}`);
  console.log(`  image files on disk     ${n(files.size)}`);
  console.log(`  catalog parts           ${n(catalog.length)}`);
  console.log(`  matched parts           ${n(new Set(candidates.map((c) => c.partSku)).size)} (${n(byKind(candidates, "symbol"))} symbol, ${n(byKind(candidates, "riser"))} riser candidates)`);
  console.log(`  to attach               ${n(plan.attach.length - unreadableParts)} part drawings (${n(byKind(plan.attach, "symbol"))} symbol, ${n(byKind(plan.attach, "riser"))} riser planned) from ${n(groups.size - unreadable.length)} drawings`);
  console.log(`    rasterized (over 1 MB) ${n(rasterized)}`);
  console.log(`    sanitizer stripped     ${n(sanitizedWithRemovals)} drawings`);
  console.log(`  skipped — not downloaded ${n(reasons["not-downloaded"])}`);
  console.log(`  skipped — already present ${n(reasons["already-present"])}`);
  console.log(`  skipped — hand-uploaded  ${n(reasons["hand-uploaded"])}`);
  console.log(`  skipped — removed by a person ${n(reasons.removed)}`);
  console.log(`  skipped — unreadable     ${n(unreadable.length)} drawings (${n(unreadableParts)} part drawings)`);
  for (const u of unreadable) console.log(`      ${u.g.imageId} (${u.g.kind}, ${u.g.displayName}): ${u.reason}`);
  console.log("");

  if (!apply) {
    console.log("  DRY RUN — nothing written. To write: npm run symbols:davinci -- --apply");
    console.log("  (a hosted DATABASE_URL target also needs --yes)\n");
    return;
  }
  if (!blobEnabled()) {
    console.log("  Blob storage is not configured — dry run only.\n");
    return;
  }

  const everIds = new Set((await listDocs("part_documents", { includeDeleted: true })).map((d) => d.id));
  let created = 0;
  let linked = 0;
  let failed = 0;
  for (const g of groups.values()) {
    const p = prepared.get(g.id);
    if (!p || !p.ok) continue;
    if (!everIds.has(g.id)) {
      const fileName = safeDocFileName(`DaVinci ${g.displayName} ${g.kind}.${p.ext}`);
      let blobKey: string;
      try {
        blobKey = (await putBlob(partDocBlobPath(g.id, fileName), p.bytes, p.contentType)).pathname;
      } catch (e) {
        failed++;
        console.error(`  upload failed: ${g.imageId} (${g.kind}) — ${(e as Error).message}`);
        continue;
      }
      const doc = await createDocument({
        id: g.id,
        kind: g.kind,
        title: `DaVinci ${g.displayName}`,
        fileName,
        contentType: p.contentType,
        size: p.bytes.byteLength,
        blobKey,
        sourceUrl: null,
        source: "davinci",
        sourceRef: g.imageId,
        svgRemoved: p.removed,
        by: BY,
      });
      if (!doc) {
        // Someone minted the same id meanwhile — keep theirs, drop this upload.
        try {
          await deleteBlob(blobKey);
        } catch {
          /* best effort */
        }
      } else {
        created++;
        if (p.removed.length) console.log(`  sanitized ${g.imageId} (${g.kind}): removed ${p.removed.join(", ")}`);
      }
      everIds.add(g.id);
    }
    linked += await attachDocument(g.id, g.skus, BY);
  }
  console.log(`\n  WROTE ${n(created)} drawing documents, ${n(linked)} part links${failed ? `, ${n(failed)} uploads failed (re-run to retry)` : ""}.\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
