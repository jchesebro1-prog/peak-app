/**
 * handoff:slice — cuts a db:export (format 2) into the Estimator handoff prototype's
 * data/*.js globals. Only allow-listed collections, blobs, settings fields and columns
 * are read (slice-rules.ts); secret-shaped text is scrubbed and the final file bodies are
 * scanned — any hit means exit 1 and nothing is written.
 *
 *   npm run handoff:slice -- --in <export.json> --out output/peak-estimator-handoff/data
 *                           [--extra-estimates <other-export.json>]   (dev only)
 *                           [--images <dir>]   (default: ../images beside the data dir)
 *
 * Run handoff:photos first: when <images>/manifest.json exists the slice also writes data/photos.js, the browser's
 * photo map (photo-select.ts). Without it the page shows placeholders. The photo SELECTION (which Blob pathname feeds which
 * part) is private and never part of the package: handoff:photos recomputes it from the export.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  BLOB_IDS, COMPANY_COLS, CONTACT_COLS, CONTACT_EMAIL_COLS, CONTACT_PHONE_COLS, CATALOG_FIELDS, FIXTURE_FIELDS, SETTINGS_FIELDS, SITE_COLS, TEAM_FIELDS, INACTIVE_TEAM_FIELDS,
  pickAndScrub, pickFields, scanForSecrets, scrubValue, selectEstimates, packCatalog, catalogBody,
  type DocRow, type QuoteDoc, type ScrubEntry,
} from "./slice-rules";
import { parsePhotoManifest, photosScript, selectPhotos, type PhotoManifest } from "./photo-select";

export const SLICE_VERSION = 1;
export const MAX_FILE_BYTES = 15_000_000;

type Row = Record<string, unknown>;
export type ExportV2 = {
  meta?: { app?: string; exportedAt?: string; source?: string; format?: number };
  users?: Row[];
  appSettings?: Array<{ id: string; data?: Row }>;
  blobs?: Array<{ id: string; data?: Row }>;
  geoCache?: Array<{ key: string; data?: Row }>;
  companies?: Row[];
  contacts?: Row[];
  contactEmails?: Row[];
  contactPhones?: Row[];
  sites?: Row[];
  collections?: Record<string, DocRow[]>;
  [other: string]: unknown;
};

export type SliceResult = {
  /** Output files keyed `data/<name>`. */
  files: Record<string, string>;
  /** Final-scan secret hits per file; non-empty = refuse to write. */
  hits: Array<{ file: string; rules: string[] }>;
  /** Files over MAX_FILE_BYTES; non-empty = refuse to write. */
  oversize: Array<{ file: string; bytes: number }>;
  /** Parts the sliced estimates/fixtures name that have a photo in Peak but none in the supplied images/manifest.json (only computed when one was supplied). */
  photosMissing: string[];
  /** Free-text values blanked because they were secret-shaped. */
  scrubbed: Array<{ file: string; id: string; field: string; rule: string }>;
  counts: Record<string, number>;
};

const r4 = (n: number | string) => (Math.round(Number(n) * 1e4) / 1e4).toFixed(4);

const js = (name: string, value: unknown) => `window.${name} = ${JSON.stringify(value)};\n`;

function liveDocs(file: ExportV2, collection: string): Array<{ id: string; doc: Row }> {
  return (file.collections?.[collection] ?? [])
    .filter((r) => !r.deleted)
    .map((r) => ({ id: r.id, doc: (r.doc ?? {}) as Row }));
}

export function sliceExport(exp: ExportV2, opts: { extraEstimates?: QuoteDoc[]; photos?: PhotoManifest | null } = {}): SliceResult {
  const files: Record<string, string> = {};
  const scrubbed: SliceResult["scrubbed"] = [];
  const counts: Record<string, number> = {};
  const noteScrub = (file: string, log: ScrubEntry[]) => { for (const e of log) scrubbed.push({ file, ...e }); };

  // --- estimates (+ dev-only extras), scrubbed deep ---
  const picked = selectEstimates((exp.collections?.quotes ?? []) as DocRow[]);
  const have = new Set(picked.map((q) => q.id));
  for (const q of opts.extraEstimates ?? []) if (!have.has(q.id)) { picked.push(q); have.add(q.id); }
  picked.sort((a, b) => a.id.localeCompare(b.id));
  const estimates: QuoteDoc[] = picked.map((q) => {
    const log: ScrubEntry[] = [];
    const out: Row = {};
    for (const [k, v] of Object.entries(q)) out[k] = scrubValue(v, q.id, k, log);
    noteScrub("data/estimates.js", log);
    return out as QuoteDoc;
  });
  files["data/estimates.js"] = js("PEAK_ESTIMATES", estimates);
  counts.estimates = estimates.length;

  // --- catalog, chunked ---
  const catalogRows = liveDocs(exp, "catalog_parts");
  const catalogLog: ScrubEntry[] = [];
  const parts = catalogRows
    .map((r) => pickAndScrub({ ...r.doc, id: r.id }, CATALOG_FIELDS, r.id, catalogLog))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // Parts retired by a SKU rename (#304) ride along as { id, sku, renamedTo } so an old SKU on a quote or
  // category still resolves to the part it became (catalog getManyBySku). Nothing else of them is kept.
  const retired = (exp.collections?.catalog_parts ?? [])
    .filter((r) => r.deleted && typeof (r.doc as Row | null | undefined)?.renamedTo === "string" && (r.doc as Row).renamedTo !== "")
    .map((r) => pickAndScrub({ id: r.id, sku: r.id, renamedTo: (r.doc as Row).renamedTo }, CATALOG_FIELDS, r.id, catalogLog));
  const groups = packCatalog([...parts, ...retired].sort((a, b) => String(a.id).localeCompare(String(b.id))), MAX_FILE_BYTES);
  const fileOfPart = new Map<string, string>();
  groups.forEach((g, i) => {
    const name = `data/catalog-${i + 1}.js`;
    files[name] = catalogBody(g);
    for (const p of g) fileOfPart.set(String(p.id), name);
  });
  for (const e of catalogLog) scrubbed.push({ file: fileOfPart.get(e.id) ?? "data/catalog-1.js", ...e });
  counts.catalog = parts.length;
  counts.catalogRetired = retired.length;
  counts.catalogFiles = groups.length;

  // --- fixtures (subassemblies) ---
  const fixLog: ScrubEntry[] = [];
  const fixtures = liveDocs(exp, "subassemblies")
    .map((r) => pickAndScrub({ ...r.doc, id: r.id }, FIXTURE_FIELDS, r.id, fixLog))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  noteScrub("data/fixtures.js", fixLog);
  files["data/fixtures.js"] = js("PEAK_FIXTURES", fixtures);
  counts.fixtures = fixtures.length;

  // --- rules: allow-listed settings + blobs ---
  const main = (exp.appSettings ?? []).find((r) => r.id === "main");
  const settings = pickFields((main?.data ?? {}) as Row, SETTINGS_FIELDS);
  const blobs: Record<string, unknown> = {};
  for (const id of BLOB_IDS) {
    const b = (exp.blobs ?? []).find((x) => x.id === id);
    if (b) blobs[id] = b.data;
  }
  files["data/rules.js"] = js("PEAK_RULES", { settings, blobs });
  counts.blobs = Object.keys(blobs).length;

  // --- customers: only what the selected estimates reference ---
  const refIds = new Set(estimates.map((q) => q.customerId).filter((x): x is string => typeof x === "string" && x !== ""));
  const companies = (exp.companies ?? []).filter((c) => !c.deleted && refIds.has(String(c.id)));
  const keptCo = new Set(companies.map((c) => String(c.id)));
  // Every non-deleted site of a referenced company is emitted (not only the quotes' locationId): the Estimator's
  // venue picker lists all of a company's venues. Deleted sites and contacts never are.
  const sites = (exp.sites ?? []).filter((s) => !s.deleted && keptCo.has(String(s.companyId)));
  const contacts = (exp.contacts ?? []).filter((c) => !c.deleted && keptCo.has(String(c.homeCompanyId)));
  const keptCt = new Set(contacts.map((c) => String(c.id)));
  // geoCache keys are routeKey(a, b) = "lat,lng|lat,lng" at 4 dp. A row is kept only when BOTH halves are a kept
  // site's coordinate or an office coordinate from the sliced settings — never a pairing with an unreferenced venue.
  const coordOf = (lat: unknown, lng: unknown) =>
    lat != null && lng != null && lat !== "" && lng !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? `${r4(lat as string)},${r4(lng as string)}` : null;
  const coords = new Set<string>();
  for (const s of sites) { const c = coordOf(s.lat, s.lng); if (c) coords.add(c); }
  const offices = Array.isArray(settings.offices) ? (settings.offices as Row[]) : [];
  for (const o of offices) { const c = coordOf(o?.lat, o?.lng); if (c) coords.add(c); }
  const geoCache = (exp.geoCache ?? [])
    .filter((g) => { const halves = String(g.key).split("|"); return halves.length === 2 && halves.every((h) => coords.has(h)); })
    .map((g) => ({ key: g.key, data: g.data }));
  const customers = {
    companies: companies.map((c) => pickFields(c, COMPANY_COLS)),
    sites: sites.map((s) => pickFields(s, SITE_COLS)),
    contacts: contacts.map((c) => pickFields(c, CONTACT_COLS)),
    contactEmails: (exp.contactEmails ?? []).filter((e) => keptCt.has(String(e.contactId))).map((e) => pickFields(e, CONTACT_EMAIL_COLS)),
    contactPhones: (exp.contactPhones ?? []).filter((p) => keptCt.has(String(p.contactId))).map((p) => pickFields(p, CONTACT_PHONE_COLS)),
    geoCache,
  };
  files["data/customers.js"] = js("PEAK_CUSTOMERS", customers);
  for (const [k, v] of Object.entries(customers)) counts[k] = v.length;

  // --- team: active users (no contact details) + inactive users as { id, name, status, roles } only — the bonus
  // record names a split's people from the FULL roster (users.ts allUsers()), so a departed owner still resolves ---
  const team = (exp.users ?? []).map((u) => pickFields(u, u.status === "active" ? TEAM_FIELDS : INACTIVE_TEAM_FIELDS));
  files["data/team.js"] = js("PEAK_TEAM", team);
  counts.team = team.length;

  // --- photos: the selection (the app's own primary-image rule + manufacturer fallback, over the parts the sliced
  // estimates and fixtures name) only sizes the counts here — it carries PRIVATE Blob pathnames, so it is not written to
  // the package (handoff:photos recomputes it from the export). data/photos.js — the browser's map, sku → document →
  // file name — exists only when handoff:photos has already written images/manifest.json (opts.photos). Not loaded
  // without it: placeholders show. ---
  const selection = selectPhotos(exp, estimates, fixtures);
  counts.photos = selection.picks.length;
  if (opts.photos) {
    files["data/photos.js"] = photosScript(opts.photos);
    counts.photoFiles = Object.keys(opts.photos.byDoc).length;
  }

  // --- meta ---
  files["data/meta.js"] = js("PEAK_META", {
    exportedAt: exp.meta?.exportedAt ?? null,
    source: exp.meta?.source ?? null,
    sliceVersion: SLICE_VERSION,
    counts,
  });

  // --- final backstop ---
  const hits: SliceResult["hits"] = [];
  const oversize: SliceResult["oversize"] = [];
  for (const [file, body] of Object.entries(files)) {
    const rules = scanForSecrets(body);
    if (rules.length) hits.push({ file, rules });
    const bytes = Buffer.byteLength(body);
    if (bytes > MAX_FILE_BYTES) oversize.push({ file, bytes });
  }
  const photosMissing = opts.photos ? selection.picks.filter((p) => !Object.prototype.hasOwnProperty.call(opts.photos!.bySku, p.sku)).map((p) => p.sku) : [];
  return { files, hits, oversize, scrubbed, photosMissing, counts };
}

/** Writes the slice into `outDir` (the prototype's data folder). Refuses — writing nothing — if the scan or size check failed. */
export function writeSlice(r: SliceResult, outDir: string): boolean {
  if (r.hits.length > 0 || r.oversize.length > 0) return false;
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^catalog-\d+\.js$/.test(f)) fs.rmSync(path.join(outDir, f));
  // a photos.js from an earlier run must not outlive the images/manifest.json that justified it
  if (!("data/photos.js" in r.files)) fs.rmSync(path.join(outDir, "photos.js"), { force: true });
  // an earlier slicer wrote the private selection here; it must never ship
  fs.rmSync(path.join(outDir, "photo-manifest.json"), { force: true });
  for (const [file, body] of Object.entries(r.files)) fs.writeFileSync(path.join(outDir, path.basename(file)), body);
  return true;
}

/** images/manifest.json → the photo map, keeping only documents whose file is really in the folder. null = no manifest. */
export function loadPhotoManifest(imagesDir: string): { manifest: PhotoManifest | null; missing: string[] } {
  const file = path.join(imagesDir, "manifest.json");
  if (!fs.existsSync(file)) return { manifest: null, missing: [] };
  const m = parsePhotoManifest(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!m) throw new Error(`${file} is not a handoff:photos manifest; re-run npm run handoff:photos`);
  const missing = Object.entries(m.byDoc).filter(([, f]) => !fs.existsSync(path.join(imagesDir, f))).map(([id]) => id);
  for (const id of missing) delete m.byDoc[id];
  for (const [sku, id] of Object.entries(m.bySku)) if (!(id in m.byDoc)) delete m.bySku[sku];
  return { manifest: m, missing };
}

/** The CLI. Returns the exit code (0 written · 1 refused/unreadable · 2 usage or a bad export). */
export function run(argv: string[]): number {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const input = arg("--in"), out = arg("--out"), extra = arg("--extra-estimates"), imagesArg = arg("--images");
  if (!input || !out) {
    console.error("usage: npm run handoff:slice -- --in <export.json> --out <data dir> [--extra-estimates <export.json>] [--images <dir>]");
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
  let extraEstimates: QuoteDoc[] | undefined;
  if (extra) {
    const other = JSON.parse(fs.readFileSync(extra, "utf8")) as ExportV2;
    extraEstimates = selectEstimates((other.collections?.quotes ?? []) as DocRow[]);
    console.log(`--extra-estimates: ${extraEstimates.length} estimate(s) from ${extra} (dev only — never for production)`);
  }
  const imagesDir = path.resolve(imagesArg ?? path.join(path.dirname(path.resolve(out)), "images"));
  let photos: ReturnType<typeof loadPhotoManifest>;
  try {
    photos = loadPhotoManifest(imagesDir);
  } catch {
    console.error(`${path.join(imagesDir, "manifest.json")} is unreadable — re-run handoff:photos`);
    return 1;
  }
  if (photos.manifest) console.log(`photos: ${Object.keys(photos.manifest.byDoc).length} image(s) from ${imagesDir}${photos.missing.length ? ` (${photos.missing.length} listed in manifest.json but missing from the folder — left out)` : ""}`);
  else console.log(`photos: no ${path.join(imagesDir, "manifest.json")} — no data/photos.js (placeholders only); run npm run handoff:photos first for product photos`);
  const r = sliceExport(exp, { extraEstimates, photos: photos.manifest });
  if (r.photosMissing.length) console.warn(`WARNING: ${r.photosMissing.length} picked parts have no downloaded photo (${r.photosMissing.slice(0, 8).join(", ")}${r.photosMissing.length > 8 ? ", …" : ""}) — re-run handoff:photos; they show the placeholder`);
  for (const h of r.hits) console.error(`SECRET SCAN: ${h.file} matches ${h.rules.join(", ")}`);
  for (const o of r.oversize) console.error(`TOO BIG: ${o.file} is ${o.bytes} bytes (limit ${MAX_FILE_BYTES})`);
  if (!writeSlice(r, out)) {
    console.error("handoff:slice refused to write (see above); nothing was written.");
    return 1;
  }
  let total = 0;
  console.log(`Slice written to ${out}`);
  for (const [file, body] of Object.entries(r.files)) {
    const bytes = Buffer.byteLength(body);
    total += bytes;
    console.log(`  ${path.basename(file).padEnd(22)} ${String(bytes).padStart(11)} bytes`);
  }
  console.log(`  total ${(total / 1e6).toFixed(2)} MB`);
  console.log("  counts: " + Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`  secret scan: clean (${r.scrubbed.length} value(s) scrubbed)`);
  for (const s of r.scrubbed) console.log(`    scrubbed ${s.file} ${s.id}.${s.field} (${s.rule})`);
  return 0;
}

if (/handoff[\\/]estimator[\\/]slice\.ts$/.test(path.resolve(process.argv[1] ?? ""))) process.exit(run(process.argv.slice(2)));
