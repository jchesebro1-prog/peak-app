import { clearCollection, getDoc, getDocRows, getDocsByIdAnyCase, listDocs, listDocsByField, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { nextPricedAt } from "@/lib/catalog-books";
import type { Port } from "@/lib/catalog-connect";
import { isFabricPart, SOFT_GOODS_CATEGORY } from "@/lib/fabric-part";
import type { DocNotNeeded } from "@/lib/part-docs/types";
import type { PortalVisibility } from "@/lib/portal-visibility";
import type { RackPartFacts } from "@/lib/rack/types";
import { orderNumberOf } from "@/lib/catalog-rename/sku";
import { MAX_PARAGRAPH } from "@/app/(app)/estimator/narrative";

export type CatalogProductMetadata = {
  productFamily?: string;
  specSection?: string;
  specArticle?: string;
  specLanguageKey?: string;
  researchStatus?: "unverified" | "needs-review" | "researched";
  source?: {
    manufacturerUrl?: string;
    sourceDocumentName?: string;
    sourceDocumentDate?: number | null;
    researchedAt?: number | null;
    researchedBy?: string;
  };
  datasheets?: Array<{
    kind: "datasheet" | "guide-spec" | "manual" | "cut-sheet" | "other";
    fileName: string;
    blobKey?: string;
    sourceUrl?: string;
    verifiedAt?: number | null;
  }>;
  accessories?: Array<{ sku?: string; manufacturerPartNumber?: string; description: string; required?: boolean }>;
};

export function mergeProductMetadata(
  existing: CatalogProductMetadata | undefined,
  patch: CatalogProductMetadata | undefined,
): CatalogProductMetadata | undefined {
  if (!existing && !patch) return undefined;
  if (!existing) return patch;
  if (!patch) return existing;
  return {
    ...existing,
    ...patch,
    source: existing.source || patch.source ? { ...existing.source, ...patch.source } : undefined,
  };
}

/**
 * Catalog — server port of app/catalog-data.js (window.MASTER_CATALOG +
 * window.catalogByCategory) over collection "catalog_parts". Single source of
 * truth for catalog parts across the system.
 *
 * Part shape is the prototype's entry shape exactly; the document id is the
 * SKU (the parts' natural key).
 * - `category` drives filtering. Curtain fabrics are tagged "Fabric", or
 *   "Theatrical/Soft Goods" with a sq-ft unit (#264 — see lib/fabric-part).
 * - `costPerSqft` is only present on Fabric rows; the curtain configurator
 *   uses it as the material cost basis.
 * - Labor/travel rates are tagged "Labor"; the labor configurator reads
 *   `cost` as the rate. Edit a rate here to reprice every quote globally.
 *
 * Note: listDocs orders by id (SKU) ascending; the prototype array's
 * insertion order is not preserved in the DB.
 */

export type CatalogPart = {
  /** Document id — equals the SKU. */
  id: string;
  sku: string;
  desc: string;
  /** 'Fabric' | 'Labor' | … */
  category: string;
  /** 'sq ft' | 'hr' | 'mi' | 'night' | 'day' | 'ea' | … */
  unit: string;
  list: number;
  cost: number;
  mfr?: string;
  /** Manufacturer's printed part number, distinct from Peak's SKU. */
  manufacturerPartNumber?: string;
  /** Manufacturer's model number, when the vendor distinguishes it from P/N. */
  manufacturerModelNumber?: string;
  /** #304 — every SKU this part has had (order numbers replaced by a
   *  `Brand:Model` SKU). Searched everywhere a part is searched; the
   *  importers match an incoming row on it. Written only by the rename tool. */
  formerSkus?: string[];
  /** #304 — set ONLY on a retired (soft-deleted) part: the SKU it was renamed
   *  to. get/getMany follow it so frozen history (sent revisions) resolves. */
  renamedTo?: string;
  /** Minimum advertised price; never treated as Peak cost or sell. */
  mapPrice?: number | null;
  /** Fabric rows only — curtain configurator material cost basis. */
  costPerSqft?: number;
  /** Fabric rows only — weight basis, so one fabric choice drives both price
   *  and rigging weight. The oz also appears in `desc` for humans; this is the
   *  machine-readable copy. */
  oz?: number;
  /** How `oz` is measured. Velour bolts are sold by linear yard at a given
   *  bolt width; muslin and scrim by square yard. */
  ozBasis?: "lin-yd" | "sq-yd";
  /** Bolt width in inches — only meaningful when ozBasis is "lin-yd". */
  boltWidthIn?: number;
  /** Curtain FABRIC cost, $/ft² of sewn fabric area (#227 — one flat rate;
   *  #227 late — no sewing in it: every curtain estimate adds the sewing
   *  rule, Estimating Rules curtains.sewingPct). Fabric rows only. Edited in
   *  the catalog part editor or imported as "Fabric $/sq ft"; read only
   *  through fabricAreaRateOf. Distinct from raw costPerSqft. */
  curtainAreaRate?: number;
  /** #292 — Fabric parts only: flame rating as printed on cut sheets (e.g. "NFPA 701 (IFR)"), ≤ 120 chars. Written only through mergeUpsert. */
  flameRating?: string;
  /** Labor rows — 'RIG' | 'LIG' | 'AUD' | 'VID' picks the rate set. */
  discipline?: string;
  /** Labor rows — 'labor' | 'ot' | 'sup' | 'shop' | 'travel' | 'equip'. */
  role?: string;
  /** Freeform flag shown in the catalog (e.g. "verify price" on imported rows
   *  whose price looked off). Cleared once a human confirms the pricing. */
  note?: string;
  /** Trade override — normally derived via the category map. */
  trade?: string;
  /** Device connectors (punch #39, Task 3) — feeds Grid wiring validation
   *  (Task 4), which uses canConnect/compatibleWireTypes from
   *  lib/catalog-connect to check patched runs between device ports. */
  ports?: Port[];
  /** Datasheet attachment (punch #39, Task 5, D116 blob pattern) — the PDF's
   *  bytes live in Vercel Blob, never in this doc (10.7k parts × MB-scale
   *  jsonb is exactly the anti-pattern D116 exists to avoid); this is just
   *  the blob's pathname, streamed by the authenticated
   *  /api/part-datasheet/<sku> proxy. LEGACY since part documents (#207):
   *  nothing writes it any more; the backfill (src/lib/part-docs/legacy.ts)
   *  turns it into a shared `part_documents` row, and it stays readable
   *  for the readers that have not switched. */
  datasheetBlobKey?: string;
  /** Original filename of the attached datasheet, for display. */
  datasheetName?: string;
  /** Part documents (#207): "this part needs no datasheet / spec sheet" —
   *  satisfies that slot in the coverage rule (src/lib/part-docs/coverage.ts).
   *  Written only through mergeUpsert (setDocNotNeeded). */
  docNotNeeded?: DocNotNeeded;
  /** Researched, provenance-aware fields used by the Specs builder and read-only Displays API. */
  productMetadata?: CatalogProductMetadata;
  /** Manufacturer document links (#162). Distinct from `datasheetBlobKey`,
   *  which is a Peak-uploaded PDF in Blob storage: these are the
   *  manufacturer's own public URLs carried from ETC's DaVinci library. They
   *  are rendered as outbound links and are never fetched server-side or
   *  proxied — treat them as third-party content. */
  docs?: { kind: "datasheet" | "manual"; label: string; url: string }[];
  /** Provenance for anything the DaVinci enricher wrote (#162) — which library
   *  export and which ETC type a row's ports and docs came from, so a later run
   *  can tell its own writes from a human's edit in the #158 ports editor. */
  davinci?: { typeId: string; libraryTimestamp: string; enrichedAt: number };
  /** Epoch ms of the last write through `upsert`/`mergeUpsert` (PUNCHLIST
   *  #14, decision A) — drives the dashboard's price-book age pills. Unset
   *  on rows that have never been touched since seeding (the seed fixtures
   *  predate this field on purpose; "unknown age" is honest for a row
   *  nobody has confirmed since import). */
  updatedAt?: number;
  /** Epoch ms of the price list this line's price came from — its effective
   *  date (PUNCHLIST #133, D156). Stamped by `upsert`/`mergeUpsert` ONLY when
   *  `list` or `cost` actually changes (importers pass the price list's
   *  effective date; any other write stamps "now"), so it means "when this
   *  price last moved" — unlike `updatedAt`, which moves on every write.
   *  Absent on parts that predate the field; the manufacturer-level
   *  `settings.priceListEffective` date covers those (lib/catalog-books
   *  effectivePriceDate). */
  pricedAt?: number;

  /* --- Specs module (#205). All additive JSONB, no migration. ---
   * These are the ONE canonical set (D258). productMetadata.specSection /
   * .specArticle (Displays API, 2e284665) are legacy free text, adopted into
   * specSectionId / specArticleId only when they resolve — see
   * adoptLegacySpecPointers in src/lib/specs/articles.ts. A table-style Part 2
   * prints manufacturerModelNumber → manufacturerPartNumber → sku as the
   * model; there is no separate model field (D261). */
  /** The Part 2 category article this part's entry prints under. Replaces
   *  D94's specSectionId as the placement pointer. */
  specArticleId?: string;
  /** D94's pointer. Still read as a fallback. Written only as a MIRROR of the
   *  effective article's section (so D94's assemble, which groups by it,
   *  keeps placing the part) and by legacy-pointer adoption. */
  specSectionId?: string;
  /** Generic name printed as the entry heading, e.g. "COLOR MIXING LIGHT
   *  EMITTING DIODE PROFILE FIXTURE". */
  specTitle?: string;
  /** Outline text — see src/lib/specs/outline.ts for the convention. */
  specBody?: string;
  /** SKU whose specTitle/specBody/specArticleId this part reuses. One hop. */
  specSameAs?: string;
  /** Order within the article. */
  specSort?: number;
  /** draft = imported and not yet reviewed. Only "authored" text ever
   *  prints, anywhere (hasPrintableSpec). No state + a body = a D94 part,
   *  which counts as authored. */
  specState?: "authored" | "draft";
  /** Provenance: "authored", "seed:northhs-2026-07-30", "skill:<date>". */
  specSource?: string;
  specUpdatedAt?: number;
  specUpdatedBy?: string;

  /** Customer portal visibility (#245 Task 5, spec §1.3) — Auto (the rule
   *  decides, see src/lib/portal-visibility.ts), Show (always browsable), or
   *  Hide (never quotable or browsable in the portal). Absent means "auto";
   *  the part editor stores auto by omitting the key rather than writing the
   *  string, same convention as the rest of this doc's optional fields, so
   *  mergeUpsert never has to distinguish "never set" from "explicitly set
   *  back to auto". Written only through mergeUpsert — no importer or
   *  enricher patch object carries this key, so a price-book import,
   *  DaVinci enrich, or ports-rule apply never clears a stored override. */
  portalVisibility?: PortalVisibility;
  /** #293: the part's write-once customer paragraph (plain text, D488 rules)
   *  — sales prose for the Estimator's narrative, distinct from specBody (CSI
   *  Part 2 spec language). Written ONLY through mergeUpsert by
   *  saveProductParagraph — no importer, enricher or price-book patch carries
   *  these keys, so imports never clear it. A quote keeps its own copy. */
  narrativeText?: string;
  narrativeUpdatedAt?: number;
  narrativeUpdatedBy?: string;
} & RackPartFacts; // #296 — rack data, optional; absent = unknown, 0 = measured none. Written only through mergeUpsert; no price-book, enricher or importer patch carries these keys.

/** All parts (port of window.MASTER_CATALOG reads). */
export async function list(): Promise<CatalogPart[]> {
  return listDocs<CatalogPart>("catalog_parts");
}

/** #304 — how many renamedTo links a read follows (a→b→c is two). */
const MAX_RENAME_HOPS = 8;

/** requested SKU → the live part it now means (#304). Exact primary-key reads
 *  first; only a SKU that reads as a retired part with `renamedTo` costs
 *  another batched read, so a book that was never renamed reads exactly as it
 *  did. Missing, deleted-without-redirect and cyclic/over-long chains are
 *  absent from the result. Never reads the whole book. */
async function resolveLiveBySku(skus: readonly string[]): Promise<Map<string, CatalogPart>> {
  const out = new Map<string, CatalogPart>();
  let pending = new Map<string, string>(); // requested → SKU to read this hop
  for (const s of skus) if (s) pending.set(s, s);
  for (let hop = 0; hop <= MAX_RENAME_HOPS && pending.size; hop++) {
    const rows = new Map((await getDocRows<CatalogPart>("catalog_parts", [...pending.values()])).map((r) => [r.id, r]));
    const next = new Map<string, string>();
    for (const [requested, key] of pending) {
      const row = rows.get(key);
      if (!row) continue;
      if (!row.deleted) out.set(requested, row.doc);
      else if (row.doc.renamedTo && row.doc.renamedTo !== key) next.set(requested, row.doc.renamedTo);
    }
    pending = next;
  }
  return out;
}

/** The live part for `sku`; a SKU retired by a rename (#304) resolves to the
 *  part it became, so frozen history that names the old SKU still finds it. */
export async function get(sku: string): Promise<CatalogPart | null> {
  const live = await getDoc<CatalogPart>("catalog_parts", sku);
  if (live) return live;
  return (await resolveLiveBySku([sku])).get(sku) ?? null;
}

/** The live parts among `skus`, read by primary key (the SKU is the document
 *  id) — batched, never the whole book and never one query per part. Missing
 *  and deleted SKUs are simply absent; a retired SKU follows `renamedTo`
 *  (#304), and the result is deduped by sku. */
export async function getMany(skus: readonly string[]): Promise<CatalogPart[]> {
  return dedupeBySku([...(await resolveLiveBySku(skus)).values()]);
}

/** getMany keyed by the REQUESTED sku (#304): `map.get(oldSku)` is the part
 *  that SKU now means. Two requested SKUs may map to the same part. */
export async function getManyBySku(skus: readonly string[]): Promise<Map<string, CatalogPart>> {
  return resolveLiveBySku(skus);
}

function dedupeBySku(parts: CatalogPart[]): CatalogPart[] {
  const seen = new Set<string>();
  return parts.filter((p) => (seen.has(p.sku) ? false : (seen.add(p.sku), true)));
}

/** getMany, ignoring SKU case: exact primary-key reads first (renamed SKUs
 *  followed), then one case-insensitive query for only the SKUs that missed
 *  (#205 spec builder). #304: only an exact-case old SKU follows the
 *  `renamedTo` redirect — a wrong-case old SKU reaches the case-insensitive
 *  query, which reads live parts only, so it finds nothing. */
export async function getManyAnyCase(skus: readonly string[]): Promise<CatalogPart[]> {
  const bySku = await resolveLiveBySku(skus);
  const found = dedupeBySku([...bySku.values()]);
  const missed = skus.filter((s) => s && !bySku.has(s));
  if (!missed.length) return found;
  return dedupeBySku([...found, ...(await getDocsByIdAnyCase<CatalogPart>("catalog_parts", missed))]);
}

/** Rows of a given category (port of window.catalogByCategory). */
export async function byCategory(category: string): Promise<CatalogPart[]> {
  const all = await list();
  return all.filter((p) => p.category === category);
}

/** Every fabric part (#264, D473): category Fabric, or Theatrical/Soft Goods
 *  sold per sq ft — the one isFabricPart rule. */
export async function fabricParts(): Promise<CatalogPart[]> {
  const all = await list();
  return all.filter(isFabricPart);
}

/** fabricParts() with the category filtered in SQL — only the Fabric and
 *  Soft Goods rows are read, never the whole book (#292 cut sheets). A
 *  category stored with stray surrounding spaces is missed here (isFabricPart
 *  trims); the exact rule still re-runs on what comes back. */
export async function fabricPartsByCategory(): Promise<CatalogPart[]> {
  return (await listDocsByField<CatalogPart>("catalog_parts", "category", ["Fabric", SOFT_GOODS_CATEGORY])).filter(isFabricPart);
}

/** Options for a part write. `pricedAt` is the effective date to stamp WHEN
 *  the write changes `list` or `cost` (the importers pass the price list's
 *  effective date); it is ignored when the price is unchanged. Default: now. */
export type UpsertOpts = { pricedAt?: number };

async function writePart(
  existing: CatalogPart | null,
  part: Omit<CatalogPart, "id"> & { id?: string },
  opts: UpsertOpts
): Promise<CatalogPart> {
  const now = Date.now();
  const pricedAt = nextPricedAt(existing, part, opts.pricedAt ?? now);
  const doc: CatalogPart = { ...part, id: part.id || part.sku, updatedAt: now };
  if (pricedAt != null) doc.pricedAt = pricedAt;
  else delete doc.pricedAt;
  return upsertDoc<CatalogPart>("catalog_parts", doc);
}

/** Insert or fully replace a part; the SKU is the document id. Stamps
 *  `updatedAt` on every write (PUNCHLIST #14, decision A) and `pricedAt`
 *  only when the price changed (PUNCHLIST #133) — centralized here rather
 *  than left to each caller so every write path (the catalog edit form, the
 *  .xlsx/CSV importers, the spec-builder's create-on-the-fly path, the
 *  datasheet actions) gets both for free. Reads the existing doc first to
 *  compare prices; `mergeUpsert` shares that read. */
export async function upsert(
  part: Omit<CatalogPart, "id"> & { id?: string },
  opts: UpsertOpts = {}
): Promise<CatalogPart> {
  const requested = part.id || part.sku;
  const existing = await get(requested);
  // #304: a SKU retired by a rename reads as the part it became. Write THAT
  // part (full replace of its doc, keeping its formerSkus) — never the
  // tombstone at the old id, which upsertDoc would revive as a live duplicate.
  if (existing && existing.sku !== requested) {
    const doc = { ...part, id: existing.id, sku: existing.sku, formerSkus: existing.formerSkus };
    if (!doc.formerSkus) delete doc.formerSkus;
    delete doc.renamedTo;
    return writePart(existing, doc, opts);
  }
  return writePart(existing, part, opts);
}

/**
 * Load the existing part (if any) and shallow-merge `patch` over it before
 * writing — a bare `upsert` is a FULL REPLACE and would otherwise silently
 * drop any field the caller doesn't happen to carry (ports,
 * datasheetBlobKey/Name, trade, discipline/role, costPerSqft, pricedAt, …).
 *
 * Use this instead of a bare `upsert(...)` whenever the caller only knows
 * about a subset of a part's fields — the catalog edit form and bulk/paste
 * import both authoritatively own a handful of fields (desc, category, unit,
 * list, cost, mfr, note, …) and should overwrite exactly those, while
 * everything else on an existing part rides along untouched. A key present
 * in `patch` always wins, including an explicit `undefined` (how a caller
 * clears a field it owns, e.g. a blanked `mfr`/`note`); a key simply absent
 * from `patch` (as with a JSON-parsed import row that never had it) leaves
 * the existing value in place.
 */
export async function mergeUpsert(
  sku: string,
  patch: Partial<Omit<CatalogPart, "id" | "sku">>,
  opts: UpsertOpts = {}
): Promise<CatalogPart> {
  const existing = await get(sku);
  // #304: an old SKU (retired by a rename) resolves to the renamed part; the
  // patch lands on THAT part under its own sku/id. Writing `sku: <old>` would
  // either stamp the old SKU onto the renamed doc or revive the tombstone.
  const target = existing?.sku ?? sku;
  // Cast: TS can't see that callers only omit fields `existing` already
  // supplies (or, for a brand-new part, that `patch` carries every required
  // field itself) — the runtime contract is enforced by callers, same as
  // the pre-existing `{ ...part, ... } as SpecCatalogPart` pattern in
  // design/engagements/spec/actions.ts.
  const merged = {
    ...(existing ?? {}),
    ...patch,
    ...(patch.productMetadata || existing?.productMetadata
      ? { productMetadata: mergeProductMetadata(existing?.productMetadata, patch.productMetadata) }
      : {}),
    id: target,
    sku: target,
  };
  return writePart(existing, merged as Omit<CatalogPart, "id"> & { id?: string }, opts);
}

export type ProductParagraphResult =
  | { ok: true; part: CatalogPart }
  | { ok: false; error: string; stale?: { paragraph: string | null; updatedAt: number | null } };

/**
 * #293 — save a part's library paragraph ("Save to library" in the Estimator,
 * and the part editor's Narrative paragraph). mergeUpsert, never upsert: only
 * the three narrative keys are written, so price, pricedAt, spec text, ports,
 * documents… ride along untouched. `expectUpdatedAt` (when given) must equal
 * the stored narrativeUpdatedAt (null = "there was none") — otherwise the
 * caller re-asks "changed since you loaded it". A soft-deleted or unknown sku
 * is refused (custom lines can't have a library paragraph).
 */
export async function saveProductParagraph(
  sku: string,
  text: string,
  by: string,
  opts: { expectUpdatedAt?: number | null; now?: number } = {}
): Promise<ProductParagraphResult> {
  const key = String(sku || "").trim();
  const body = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "Write the paragraph first." };
  if (body.length > MAX_PARAGRAPH) return { ok: false, error: `Keep the paragraph under ${MAX_PARAGRAPH.toLocaleString("en-US")} characters.` };
  const part = key ? await get(key) : null;
  if (!part) return { ok: false, error: "Only catalog parts have a library paragraph." };
  if (opts.expectUpdatedAt !== undefined && (part.narrativeUpdatedAt ?? null) !== opts.expectUpdatedAt) {
    return {
      ok: false,
      error: "The library paragraph changed since you loaded it.",
      stale: { paragraph: part.narrativeText ?? null, updatedAt: part.narrativeUpdatedAt ?? null },
    };
  }
  const saved = await mergeUpsert(part.sku, { narrativeText: body, narrativeUpdatedAt: opts.now ?? Date.now(), narrativeUpdatedBy: by });
  return { ok: true, part: saved };
}

/** Explicit go-live reset for the pricing catalog only. Grid symbols and all
 * other pricing/rate collections are intentionally untouched. */
export async function clearCatalogPriceList(): Promise<number> {
  return clearCollection("catalog_parts");
}

/**
 * Soft delete one part. Callers that resolve a part by id/SKU already treat
 * a miss as "not in the catalog" rather than an error (e.g. Grid's
 * pricingById.get() falls back to a zero-priced placeholder in
 * design/grid-quote.ts — resolveTierCatalog), so removing a SKU here can't
 * crash an existing quote line or BOM read; it just stops the part from
 * being offered/priced going forward. Quote/vendor-quote lines copy a
 * part's desc/price at the moment they're added (they don't re-resolve the
 * catalog on read), so a past quote's line text is unaffected either way.
 */
export async function remove(sku: string): Promise<boolean> {
  // #304: only a LIVE doc at this exact id is deleted. An old SKU retired by a
  // rename is a tombstone — removing it acts on nothing (never on the part it
  // was renamed to, and the tombstone keeps its rev and renamedTo).
  if (!sku || !(await getDoc<CatalogPart>("catalog_parts", sku))) return false;
  await softDeleteDoc("catalog_parts", sku);
  return true;
}

/**
 * #304 — rename a part's SKU: write the copy under `to` and retire `from`
 * with `renamedTo`, so get/getMany keep resolving the old SKU. One write path
 * for the whole feature; it never touches frozen data (quote revisions, Grid
 * revisions, generated specs) — those keep the old SKU and resolve through
 * the redirect. Idempotent: a `from` already retired to `to` returns the
 * live part. Returns null (writes nothing) when `from` is missing or retired
 * elsewhere, or when `to` is a live part — or another part's tombstone —
 * that is not a previous rename of `from`. Crash recovery: a `to` that already
 * lists `from` in its formerSkus while `from` is still live (live `to`, or a
 * tombstone renamed onward) just retires `from` and returns the live part.
 *
 * Written through upsertDoc, not writePart/upsert, so `pricedAt` is carried
 * as-is: a rename is not a price change. #313: a non-blank `mfr` re-files the
 * new copy under that manufacturer (the recovery branches never touch it).
 */
export async function renamePartDocs(from: string, to: string, model: string, mfr?: string): Promise<CatalogPart | null> {
  if (!from || !to) return null;
  if (from === to) return getDoc<CatalogPart>("catalog_parts", to); // #304: nothing to move — the live part, else null
  const [oldRow, toRow] = await getDocRows<CatalogPart>("catalog_parts", [from, to]).then((rows) => [
    rows.find((r) => r.id === from),
    rows.find((r) => r.id === to),
  ]);
  if (!oldRow) return null;
  if (oldRow.deleted) return oldRow.doc.renamedTo === to ? get(to) : null;
  const old = oldRow.doc;
  const retire = async () => {
    await patchDoc<CatalogPart>("catalog_parts", from, (d) => { d.renamedTo = to; });
    await softDeleteDoc("catalog_parts", from);
  };
  if (toRow && !(toRow.doc.formerSkus ?? []).includes(from)) return null;
  // #304: a tombstoned `to` that was itself renamed onward is history, not a
  // free slot — reviving it would put a second live copy beside its successor.
  // It lists `from` (checked above), so `from` was renamed to it and then the
  // call died before retiring `from`: finish that retire (renamedTo = `to`,
  // whose own redirect reaches the successor) and hand back the live end of
  // the chain. A chain that ends nowhere, or back at `from`, is refused.
  if (toRow?.deleted && toRow.doc.renamedTo) {
    const live = await get(to);
    if (!live || live.sku === from) return null;
    await retire();
    return live;
  }
  if (toRow && !toRow.deleted) {
    await retire();
    return toRow.doc;
  }
  const copy: CatalogPart = {
    ...old,
    id: to,
    sku: to,
    ...(mfr?.trim() ? { mfr: mfr.trim() } : {}),
    manufacturerModelNumber: model,
    manufacturerPartNumber: old.manufacturerPartNumber || orderNumberOf(from),
    formerSkus: [...new Set([...(old.formerSkus ?? []), from])],
    updatedAt: Date.now(),
  };
  delete copy.renamedTo;
  const written = await upsertDoc<CatalogPart>("catalog_parts", copy);
  await retire();
  return written;
}
