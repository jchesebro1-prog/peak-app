import { clearCollection, getDoc, getDocRows, listDocs, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { nextPricedAt } from "@/lib/catalog-books";
import type { Port } from "@/lib/catalog-connect";
import type { DocNotNeeded } from "@/lib/part-docs/types";

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
 * - `category` drives filtering. Curtain fabrics are tagged "Fabric".
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
  /** Curtain make-it-ourselves area cost, $/ft² of sewn fabric. Fabric rows
   *  only. Seeded ~10% above the Rose-Brand-reconciled rate; edit toward real
   *  shop cost when the curtain shop exists. Distinct from raw costPerSqft. */
  curtainAreaRate?: number;
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
};

/** All parts (port of window.MASTER_CATALOG reads). */
export async function list(): Promise<CatalogPart[]> {
  return listDocs<CatalogPart>("catalog_parts");
}

export async function get(sku: string): Promise<CatalogPart | null> {
  return getDoc<CatalogPart>("catalog_parts", sku);
}

/** The live parts among `skus`, read by primary key (the SKU is the document
 *  id) — batched, never the whole book and never one query per part. Missing
 *  and deleted SKUs are simply absent. */
export async function getMany(skus: readonly string[]): Promise<CatalogPart[]> {
  return (await getDocRows<CatalogPart>("catalog_parts", skus)).filter((r) => !r.deleted).map((r) => r.doc);
}

/** Rows of a given category (port of window.catalogByCategory). */
export async function byCategory(category: string): Promise<CatalogPart[]> {
  const all = await list();
  return all.filter((p) => p.category === category);
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
  const existing = await get(part.id || part.sku);
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
    sku,
  };
  return writePart(existing, merged as Omit<CatalogPart, "id"> & { id?: string }, opts);
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
export async function remove(sku: string): Promise<void> {
  await softDeleteDoc("catalog_parts", sku);
}
