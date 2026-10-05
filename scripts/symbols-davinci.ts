/**
 * DaVinci product drawings → `symbol` / `riser` part documents (#300 slice 3,
 * spec §3, D610–D611). Peak has ETC's dealer permission to use them (D612).
 *
 *   npm run symbols:davinci                              → dry run, writes nothing
 *   npm run symbols:davinci -- --apply --yes             → write (--yes is required whenever
 *                                                          a Blob token or a hosted DB is set)
 *   npm run symbols:davinci -- --source <dir>            → a DaVinci export elsewhere
 *
 * A LOCAL-database apply with a Blob token is refused unless --local-blob is
 * passed: the drawings would land in the shared store with only this local
 * database pointing at them (applyRefusal in symbols-plan.ts).
 *
 * `--source` is the folder holding the timestamped exports (default
 * `data/davinci/source`, the newest timestamp wins) or one export folder
 * itself (it has `images/`). Files are `images/{<uuid>}.svg|png`.
 *
 * Each catalog part matched to a DaVinci type exactly as #162/#207 do gets
 * that type's plan drawing (symbol) and riser drawing (riser) when the file
 * is on disk: SVG through `sanitizeSvg` (an SVG over its 1 MB cap is
 * rasterized to a ≤ 1024 px WebP instead — librsvg runs no scripts; drawn at
 * 144 dpi and never enlarged, so a small-intrinsic SVG stays sharp), PNG
 * shrunk to ≤ 1024 px WebP. One shared document per (image, kind) with a
 * deterministic id (davinciDrawingId), so a re-run never mints a second one;
 * linked through attachDocument (one current drawing per part per kind).
 * A drawing a person uploaded is never replaced (symbols-plan.ts), re-checked
 * per drawing just before it is linked. DaVinci's "Unknown" placeholder is
 * never imported, and any image more than 25 parts would share is listed.
 *
 * No Blob token → nothing is written: "Blob storage is not configured — dry
 * run only."
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { resolveDbTarget } from "./db-target";
import { listDocs } from "../src/db/doc-store";
import { blobEnabled, deleteBlob, putBlob } from "../src/lib/blob";
import { loadExtract } from "../src/lib/davinci/load";
import {
  applyRefusal,
  blobStoreLabel,
  candidatesFor,
  planSymbolImport,
  sharedImages,
  SKIP_REASON_LABEL,
  type ExistingSymbol,
  type SymbolImportCandidate,
  type SymbolSkipReason,
} from "../src/lib/davinci/symbols-plan";
import { DRAWING_MAX_EDGE } from "../src/lib/part-docs/drawing-upload";
import { CONTENT_TYPES } from "../src/lib/part-docs/files";
import { shrinkImage } from "../src/lib/part-docs/shrink";
import { SVG_MAX_BYTES, sanitizeSvg } from "../src/lib/part-docs/svg-sanitize";
import { isDrawingKind, partDocBlobPath, safeDocFileName, type PartDocument } from "../src/lib/part-docs/types";
import { list as allParts } from "../src/lib/stores/catalog";
import { allDocumentLinks, attachDocument, createDocument, detachedDocumentLinks, documentLinksForParts, getDocuments } from "../src/lib/stores/part-documents";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const n = (x: number) => x.toLocaleString("en-US");
const BY = "DaVinci drawings";

/** Deterministic per (kind, image), so a re-run never mints a second document. */
function davinciDrawingId(kind: string, imageId: string): string {
  return `PD-V${createHash("sha1").update(`${kind}\u0000${imageId}`).digest("hex").slice(0, 15)}`;
}

/** The flag's value; null when the flag is absent. A flag given with no value exits. */
function argValue(flag: string): string | null {
  const i = args.indexOf(flag);
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (i < 0 && !eq) return null;
  const v = i >= 0 ? args[i + 1] : eq!.slice(flag.length + 1);
  if (!v || v.startsWith("--")) {
    console.error(`\n  ${flag} needs a value: ${flag} <dir>\n`);
    process.exit(1);
  }
  return v;
}

/** The export's own library.json timestamp, or null when it has none / can't be read. */
function exportTimestamp(exportDir: string): string | null {
  const file = path.join(exportDir, "library.json");
  if (!existsSync(file)) return null;
  try {
    const t = (JSON.parse(readFileSync(file, "utf8")) as { timestamp?: unknown }).timestamp;
    return typeof t === "string" ? t : null;
  } catch {
    return null;
  }
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
      const bytes = await sharp(raw, { limitInputPixels: 100_000_000, density: 144 })
        .resize({ width: DRAWING_MAX_EDGE, height: DRAWING_MAX_EDGE, fit: "inside", withoutEnlargement: true })
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
type Group = { id: string; kind: "symbol" | "riser"; imageId: string; title: string; skus: string[] };

async function main() {
  const { hosted, label } = resolveDbTarget(apply ? "symbols:davinci (WRITE)" : "symbols:davinci (dry run)");
  // Before anything is read, planned or uploaded (#300 fix round 1).
  if (apply) {
    const blob = blobEnabled();
    const store = blob ? blobStoreLabel({ BLOB_STORE_ID: process.env.BLOB_STORE_ID, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN }) : "(none)";
    console.log(`[blob] ${blob ? store : "not configured — nothing will be written"}`);
    const refusal = applyRefusal({ hosted, blob, yes: args.includes("--yes"), localBlob: args.includes("--local-blob"), store, db: label });
    if (refusal) {
      console.error(`\n${refusal}\n`);
      process.exit(1);
    }
    if (blob || hosted) console.log(`[apply] confirmed with --yes: Blob ${store} → ${label}`);
  }

  const sourceArg = argValue("--source") ?? "data/davinci/source";
  const exportDir = resolveExportDir(sourceArg);
  if (!exportDir) {
    console.error(`\n  No DaVinci export with an images/ folder under ${path.resolve(sourceArg)}.\n  Pass --source <dir>.\n`);
    process.exit(1);
  }
  const files = listImages(exportDir);

  const extract = loadExtract();
  const exportStamp = exportTimestamp(exportDir);
  const catalog = (await allParts()).map((p) => ({ id: p.id, sku: p.sku, manufacturer: p.mfr }));
  const stats = { placeholder: 0 };
  const candidates = candidatesFor(extract, catalog, stats);
  const shared = sharedImages(candidates, 25);

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
    else groups.set(id, { id, kind: c.kind, imageId: c.imageId, title: c.imageName || c.displayName, skus: [c.partSku] });
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
  const pad = (s: string) => s.padEnd(31);

  console.log(`\n  library                 ${extract.libraryTimestamp}`);
  console.log(`  export                  ${exportDir}`);
  if (!exportStamp) console.log(`  WARNING: the export has no readable library.json timestamp — can't confirm it matches the extract.`);
  else if (exportStamp !== extract.libraryTimestamp) {
    console.log(`  WARNING: the export's library.json is ${exportStamp}, the extract is ${extract.libraryTimestamp}.`);
    console.log(`           Image ids may not line up — regenerate the extract (npm run davinci:extract) from this export.`);
  }
  console.log(`  image files on disk     ${n(files.size)}`);
  console.log(`  catalog parts           ${n(catalog.length)}`);
  console.log(`  matched parts           ${n(new Set(candidates.map((c) => c.partSku)).size)} (${n(byKind(candidates, "symbol"))} symbol, ${n(byKind(candidates, "riser"))} riser candidates)`);
  console.log(`  to attach               ${n(plan.attach.length - unreadableParts)} part drawings (${n(byKind(plan.attach, "symbol"))} symbol, ${n(byKind(plan.attach, "riser"))} riser planned) from ${n(groups.size - unreadable.length)} drawings`);
  console.log(`    rasterized (over 1 MB) ${n(rasterized)}`);
  console.log(`    sanitizer stripped     ${n(sanitizedWithRemovals)} drawings`);
  console.log(`  ${pad("skipped — DaVinci placeholder")}${n(stats.placeholder)} part drawings ("Unknown" / type Other)`);
  for (const r of Object.keys(reasons) as SymbolSkipReason[]) console.log(`  ${pad(`skipped — ${SKIP_REASON_LABEL[r]}`)}${n(reasons[r])}`);
  console.log(`  ${pad("skipped — unreadable")}${n(unreadable.length)} drawings (${n(unreadableParts)} part drawings)`);
  for (const u of unreadable) console.log(`      ${u.g.imageId} (${u.g.kind}, ${u.g.title}): ${u.reason}`);
  if (shared.length) {
    console.log(`  WARNING: ${n(shared.length)} image(s) would be shared by more than 25 matched parts — a placeholder? Check before --apply:`);
    for (const x of shared) console.log(`      ${x.imageId}  ${n(x.parts)} parts  ${x.name}`);
  } else console.log(`  ${pad("shared by > 25 parts")}none`);
  console.log("");

  if (!apply) {
    console.log("  DRY RUN — nothing written. To write: npm run symbols:davinci -- --apply --yes");
    console.log("  (--yes whenever a Blob token or a hosted DATABASE_URL is set)\n");
    return;
  }
  if (!blobEnabled()) {
    console.log("  Blob storage is not configured — dry run only.\n");
    return;
  }

  const everIds = new Set((await listDocs("part_documents", { includeDeleted: true })).map((d) => d.id));
  let created = 0;
  let linked = 0;
  let handSince = 0;
  const failed: Array<{ g: Group; error: string }> = [];
  for (const g of groups.values()) {
    const p = prepared.get(g.id);
    if (!p || !p.ok) continue;
    let blobKey: string | null = null;
    try {
      // Fresh read just before linking: a part that gained a drawing of this
      // kind from a person since the plan keeps it (hand-uploaded).
      const links = (await documentLinksForParts(g.skus)).filter((l) => l.documentId !== g.id);
      const docs = new Map((await getDocuments(links.map((l) => l.documentId))).map((d) => [d.id, d]));
      const handParts = new Set(
        links.filter((l) => {
          const d = docs.get(l.documentId);
          return d && d.kind === g.kind && d.source !== "davinci";
        }).map((l) => l.partSku)
      );
      const skus = g.skus.filter((s) => !handParts.has(s));
      handSince += g.skus.length - skus.length;
      if (!skus.length) continue;

      if (!everIds.has(g.id)) {
        const fileName = safeDocFileName(`DaVinci ${g.title} ${g.kind}.${p.ext}`);
        blobKey = (await putBlob(partDocBlobPath(g.id, fileName), p.bytes, p.contentType)).pathname;
        const doc = await createDocument({
          id: g.id,
          kind: g.kind,
          title: `DaVinci ${g.title}`,
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
          await deleteBlob(blobKey).catch(() => undefined);
        } else {
          created++;
          if (p.removed.length) console.log(`  sanitized ${g.imageId} (${g.kind}): removed ${p.removed.join(", ")}`);
        }
        blobKey = null;
        everIds.add(g.id);
      }
      linked += await attachDocument(g.id, skus, BY);
    } catch (e) {
      failed.push({ g, error: (e as Error).message });
      console.error(`  FAILED ${g.imageId} (${g.kind}, ${g.skus.length} parts) — ${(e as Error).message}`);
      // Uploaded but no document recorded it: best-effort delete the orphan.
      if (blobKey) await deleteBlob(blobKey).catch(() => undefined);
    }
  }

  console.log(`\n  WROTE ${n(created)} drawing documents, ${n(linked)} part links attached.`);
  console.log(`  ${pad("skipped — DaVinci placeholder")}${n(stats.placeholder)}`);
  for (const r of Object.keys(reasons) as SymbolSkipReason[]) {
    const extra = r === "hand-uploaded" && handSince ? ` (+${n(handSince)} hand-uploaded since the plan)` : "";
    console.log(`  ${pad(`skipped — ${SKIP_REASON_LABEL[r]}`)}${n(reasons[r] + (r === "hand-uploaded" ? handSince : 0))}${extra}`);
  }
  console.log(`  ${pad("skipped — unreadable")}${n(unreadable.length)} drawings (${n(unreadableParts)} part drawings)`);
  console.log(`  ${pad("failed")}${n(failed.length)} drawings (${n(failed.reduce((t, f) => t + f.g.skus.length, 0))} part drawings)${failed.length ? " — re-run to retry" : ""}\n`);
  if (failed.length) process.exitCode = 1;
}

main().then(
  () => process.exit(), // exitCode 1 when any drawing failed
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
