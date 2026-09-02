/* eslint-disable @typescript-eslint/no-explicit-any -- source JSON is intentionally schema-tolerant. */
/**
 * Read-only DaVinci source tooling (Phase 0/1).
 *
 * This intentionally has no database or Vercel dependencies.  It snapshots
 * source files, normalizes library.json, and writes review artifacts.  The
 * importer commands remain separate until the normalized output is approved.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, cpSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const repo = resolve(process.cwd());
const dataRoot = resolve(process.env.DAVINCI_DATA_DIR || join(repo, "data", "davinci"));
const sourceRoot = resolve(process.env.DAVINCI_SOURCE_DIR || join(dataRoot, "source"));
const handoffRoot = process.env.DAVINCI_HANDOFF_DIR ? resolve(process.env.DAVINCI_HANDOFF_DIR) : "";
const defaultLibrary = process.env.DAVINCI_LIBRARY || (handoffRoot ? join(handoffRoot, "source/library.json") : join(process.env.HOME || "", "Library/Application Support/ETC/DaVinci/library.json"));
const defaultImages = process.env.DAVINCI_IMAGES || (handoffRoot ? join(handoffRoot, "source/images") : join(process.env.HOME || "", "Library/Application Support/ETC/DaVinci/images"));

type AnyRecord = Record<string, any>;
type ManifestEntry = { relativePath: string; byteSize: number; sha256: string; mimeType: string; sourceModifiedAt: string };
type SnapshotManifest = { snapshotId: string; createdAt: string; files: ManifestEntry[] };

const mime = (file: string) => ({ ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".dwg": "application/acad", ".davinci": "application/zip" }[extname(file).toLowerCase()] || "application/octet-stream");
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as AnyRecord;
const arr = (...values: unknown[]) => values.find(Array.isArray) as AnyRecord[] | undefined;
const text = (...values: unknown[]) => values.find((v) => typeof v === "string" && v.trim()) as string | undefined;
const idOf = (v: AnyRecord) => text(v.id, v.typeId, v.uuid, v.uid) || "";
const writeJson = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const writeCsv = (file: string, headers: string[], rows: AnyRecord[]) => writeFileSync(file, [headers, ...rows.map((row) => headers.map((h) => csvCell(row[h])))] .map((row) => row.join(",")).join("\n") + "\n");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function snapshot() {
  if (!existsSync(defaultLibrary)) throw new Error(`library.json not found: ${defaultLibrary}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(sourceRoot, stamp);
  mkdirSync(out, { recursive: true });
  const copies: string[] = [defaultLibrary];
  if (existsSync(defaultImages)) copies.push(...walk(defaultImages));
  const dwgRoot = join(resolve(defaultLibrary, ".."));
  for (const name of ["DWG_Library.dwg", "Symbol_Library.dwg"]) if (existsSync(join(dwgRoot, name))) copies.push(join(dwgRoot, name));
  const projectsRoot = handoffRoot ? join(handoffRoot, "source/projects") : join(resolve(defaultLibrary, ".."), "projects");
  if (existsSync(projectsRoot)) copies.push(...walk(projectsRoot));
  const files: ManifestEntry[] = [];
  for (const file of copies) {
    const relativePath = file === defaultLibrary ? "library.json" : file.startsWith(defaultImages + "/") ? join("images", file.slice(defaultImages.length + 1)) : file.startsWith(projectsRoot + "/") ? join("projects", file.slice(projectsRoot.length + 1)) : basename(file);
    const target = join(out, relativePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    cpSync(file, target);
    const st = statSync(file);
    files.push({ relativePath, byteSize: st.size, sha256: sha(file), mimeType: mime(file), sourceModifiedAt: st.mtime.toISOString() });
  }
  const manifest: SnapshotManifest = { snapshotId: stamp, createdAt: new Date().toISOString(), files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)) };
  writeJson(join(out, "manifest.json"), manifest);
  console.log(`Snapshot ${manifest.snapshotId}: ${files.length} files -> ${out}`);
}

function sourceBlock(product: AnyRecord, images: Map<string, AnyRecord>, checksum: string, importedAt: string) {
  const visuals = product.visuals?.data || product.visuals || {};
  const imageId = text(visuals.imageId, visuals.iconImageId);
  const riserId = text(visuals.riserImageId, visuals.riserId);
  const docs = arr(product.documents, product.documentIds, product.resources) || [];
  const scripts = arr(product.scriptIds, product.scripts) || [];
  return {
    typeId: idOf(product), libraryUpdateId: text(product.libraryUpdateId, product.updateId),
    displayName: text(product.typeInformation?.displayName, product.displayName, product.name),
    modelNumber: text(product.typeInformation?.modelNumber, product.modelNumber),
    sourceCategoryId: text(product.categoryId, product.category?.id), sourceSubcategoryId: text(product.subcategoryId, product.subcategory?.id),
    imageIds: { icon: imageId, riser: riserId }, documentIds: docs.map((d) => typeof d === "string" ? d : idOf(d)).filter(Boolean),
    scriptIds: scripts.map((s) => typeof s === "string" ? s : idOf(s)).filter(Boolean), sourceSnapshotSha256: checksum, importedAt,
    _resolvedImages: { icon: imageId ? images.get(imageId)?.fileName : undefined, riser: riserId ? images.get(riserId)?.fileName : undefined },
  };
}

export function extract(snapshotDir: string) {
  const manifest = json(join(snapshotDir, "manifest.json")) as SnapshotManifest;
  const libraryPath = join(snapshotDir, "library.json");
  if (!existsSync(libraryPath)) throw new Error("Snapshot is missing library.json");
  if (sha(libraryPath) !== manifest.files.find((f) => f.relativePath === "library.json")?.sha256) throw new Error("library.json checksum does not match manifest");
  const library = json(libraryPath);
  const images = arr(library.images, library.imageRecords, library.resources?.images) || [];
  const imageMap = new Map(images.map((image) => [idOf(image), image]));
  const products = arr(library.products, library.productTypes, library.types, library.catalog) || [];
  const importedAt = new Date().toISOString();
  const checksum = manifest.files.find((f) => f.relativePath === "library.json")!.sha256;
  const catalog = products.map((p) => {
    const source = sourceBlock(p, imageMap, checksum, importedAt);
    const sku = text(p.partNumber, p.productNumber, p.sku, p.typeInformation?.modelNumber);
    const desc = text(p.typeInformation?.displayName, p.description, p.name, p.typeInformation?.modelNumber) || `ETC ${idOf(p)}`;
    return { id: sku || `ETC:${idOf(p)}`, sku: sku || `ETC:${idOf(p)}`, desc, category: text(p.category?.name, p.categoryName) || "Unmapped / DaVinci", unit: "EA", list: null, cost: null, pricingStatus: "missing", manufacturer: text(p.manufacturer?.name, p.manufacturerName) || "ETC", source: { daVinci: source } };
  });
  const assets = manifest.files.filter((f) => f.relativePath.startsWith("images/")).map((f) => ({ sourcePath: f.relativePath, storageKey: `catalog/davinci/${manifest.snapshotId}/${f.relativePath.slice(7)}`, sha256: f.sha256, mimeType: f.mimeType }));
  const resources = products.flatMap((p) => (arr(p.documents, p.resources) || []).map((d) => ({ title: text(d.title, d.name) || "DaVinci document", externalUrl: text(d.url, d.externalUrl), sourceDocumentId: typeof d === "string" ? d : idOf(d), kind: "other" })));
  const categories = [...new Map(products.map((p) => [text(p.category?.id, p.categoryId, p.category?.name, p.categoryName) || "", { sourceCategoryId: text(p.category?.id, p.categoryId), sourceCategoryName: text(p.category?.name, p.categoryName) || "", peakCategory: "Unmapped / DaVinci", group: "", trade: "", discipline: "", active: true, notes: "Review before import" }])).values()].filter((v) => v.sourceCategoryName);
  const behavior = products.flatMap((p) => (arr(p.scriptIds, p.scripts) || []).map((s) => ({ typeId: idOf(p), scriptId: typeof s === "string" ? s : idOf(s), classification: "unsupported", treatment: "defer" })));
  const exceptions = products.filter((p) => !idOf(p)).map((p, index) => ({ kind: "missing-type-id", index, displayName: text(p.name, p.description) }));
  const out = join(snapshotDir, "review"); mkdirSync(out, { recursive: true });
  writeJson(join(out, "catalog.json"), catalog); writeJson(join(out, "assets-manifest.json"), assets); writeJson(join(out, "resources-manifest.json"), resources); writeJson(join(out, "category-map.json"), categories); writeJson(join(out, "behavior-gap-report.json"), behavior); writeJson(join(out, "exceptions.json"), exceptions);
  writeCsv(join(out, "catalog.csv"), ["id", "sku", "desc", "category", "manufacturer", "pricingStatus"], catalog);
  writeCsv(join(out, "category-map.csv"), ["sourceCategoryId", "sourceCategoryName", "peakCategory", "group", "trade", "discipline", "active", "notes"], categories);
  writeCsv(join(out, "behavior-gap-report.csv"), ["typeId", "scriptId", "classification", "treatment"], behavior);
  writeJson(join(out, "summary.json"), { snapshotId: manifest.snapshotId, runId: `davinci-${Date.now()}`, completedAt: importedAt, source: { products: products.length, images: images.length, assets: assets.length, scripts: behavior.length }, output: { catalog: catalog.length, categories: categories.length, exceptions: exceptions.length }, status: exceptions.length ? "review" : "ok", librarySha256: checksum });
  console.log(`Extracted ${catalog.length} products, ${assets.length} assets, ${exceptions.length} exceptions -> ${out}`);
}

export function validateExport(exportDir: string) {
  const summary = json(join(exportDir, "summary.json"));
  const catalog = json(join(exportDir, "catalog.json")) as AnyRecord[];
  const ids = catalog.map((part) => part.id).filter(Boolean) as string[];
  const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const sourceLibrary = join(exportDir, "../source/library.json");
  const checks = {
    sourceChecksumMatches: existsSync(sourceLibrary) && sha(sourceLibrary) === summary.sourceLibrarySha256,
    catalogCountMatches: catalog.length === summary.exportCounts.parts,
    duplicateIds,
    exceptionFilePresent: existsSync(join(exportDir, "exceptions.json")),
  };
  const status = checks.sourceChecksumMatches && checks.catalogCountMatches && duplicateIds.length === 0 ? "ok" : "review";
  writeJson(join(exportDir, "validation.json"), { checkedAt: new Date().toISOString(), checks, status });
  console.log(`DaVinci export validation: ${status}`);
  if (status !== "ok") process.exitCode = 1;
}

function main() {
  const command = process.argv[2];
  if (command === "snapshot") return snapshot();
  if (command === "extract") return extract(resolve(process.argv[3] || ""));
  if (command === "validate") return validateExport(resolve(process.argv[3] || ""));
  if (command === "report") { console.log("report: review/summary.json and validation.json; no database writes are performed."); return; }
  throw new Error("usage: davinci.ts snapshot | extract <snapshot-dir> | validate | report");
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();
