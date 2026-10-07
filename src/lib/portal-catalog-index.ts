import { get as getPart, list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { coveringParents, ownFiles, slotCoverage, type CoverageIndex } from "@/lib/part-docs/coverage";
import { buildImageIndex, type ImageRef } from "@/lib/part-docs/views";
import { DOC_SLOT_KINDS, isDocSlotKind, type DocSlotKind, type PartDocument } from "@/lib/part-docs/types";
import { loadPortalRules } from "@/lib/freight-rule-load";
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
import { isFabricPart } from "@/lib/fabric-part";
import {
  browsable,
  browseReason,
  INTERNAL_HIDDEN_REASON,
  isInternalCategory,
  normalizeVisibility,
  portalHidden,
  type BrowseRule,
  type PortalVisibility,
  type VisibilityFacts,
} from "@/lib/portal-visibility";
import { buildHaystack, type SearchEntry } from "@/lib/portal-search";
import { cleanPortalCategory } from "@/lib/fixture-assemblies";
import { listManufacturers } from "@/lib/stores/manufacturers";
import { canonicalKeyMap } from "@/lib/manufacturer-aliases";
import { mfrKey } from "@/lib/catalog-books";
import { OTHER_PACKAGES_CATEGORY } from "@/lib/portal-departments";

/**
 * The portal's catalog index (#245, spec §1/§3/§8) — SERVER ONLY.
 *
 * `IndexedPart` carries `cost`, because server pricing (portal-pricing.ts)
 * needs it. This module must never be imported into a client component; pages
 * hand the browser `SearchEntry` rows and sell-only prices, never an
 * `IndexedPart`. (No "server-only" package in this repo — same comment-only
 * convention as src/lib/curtain-pricing.ts.)
 *
 * Built from bulk loads only — one catalog list, one part-docs state load
 * (its documents + links also yield the image galleries), one fixtures list,
 * one quotes list — because production carries ~37k parts; nothing here
 * queries per part.
 *
 * The cache is per-process module state with a 5-minute TTL. A write in this
 * process (catalog part save/delete, part-document actions) calls
 * `invalidatePortalIndex()`; other serverless instances keep their copy until
 * their own TTL lapses, so they converge within 5 minutes.
 */

export type IndexedPart = {
  sku: string;
  desc: string;
  mfr: string;
  category: string;
  unit: string;
  mpn: string;
  model: string;
  cost: number;
  list: number;
  note: string;
  pricedAt: number | null;
  visibility: PortalVisibility;
  imageIds: string[];
  datasheetIds: string[];
  specText: string | null;
  accessories: string[];
  quoteCount: number;
};

export type IndexedFixture = {
  id: string;
  label: string;
  description: string;
  lightEngineSku: string;
  lensSku: string | null;
  lines: Array<{ slot: string; sku: string; label: string; qty: number; required: boolean }>;
};

export type PortalIndex = {
  parts: Map<string, IndexedPart>;
  fixtures: Map<string, IndexedFixture>;
  entries: SearchEntry[];
  builtAt: number;
  /** Every part-document id a portal customer may fetch (#245 Task 9, spec
   *  §7). Built once per index build, not per request, by the pure
   *  `servableDocIdsFrom` below: for every quotable (non-hidden) SKU, its
   *  own visible images with a stored file, plus its own and covering-
   *  parents' datasheet/spec-sheet/manual documents with a stored file (never
   *  through an image — only a datasheet or spec sheet "covers" a child
   *  part, and an `ownDatasheet` accessory pair opts a child back out of
   *  that coverage). "Hidden" excludes an image whose LINK is marked
   *  hidden — `hidden` is a field only image links carry
   *  (part-docs/types.ts `PartDocumentLink`), so there's no "hidden
   *  datasheet link" case to filter here at all. */
  servableDocIds: Set<string>;
  /** Kind + title of every datasheet/spec-sheet/manual id any
   *  `IndexedPart.datasheetIds` names (#245 Task 11 — the part sidebar's
   *  Documents list; #290 adds manuals). */
  docMeta: Map<string, PortalDocMeta>;
  /** Internal labor/travel rows left on "auto" (#245 Task 11 fix round 1) —
   *  NOT quotable, searchable, browsable or doc-servable on their own, but a
   *  fixture may carry one as a component (e.g. shop fabrication), so fixture
   *  resolution and fixture pricing — and nothing else — read this map via
   *  `fixtureComponentPart`. An explicit Hide is never here. */
  componentParts: Map<string, IndexedPart>;
  /** Curtain fabrics a customer may name on a curtain request (#245 Task 11,
   *  spec §3.3): quotable fabric parts (#264: isFabricPart) with an area rate. Names only —
   *  the rate never leaves the server. */
  fabrics: Array<{ sku: string; name: string }>;
  /** #250 SERVER-ONLY: fabric SKU → its curtain area rate (fabricAreaRateOf),
   *  for priceCurtain/priceCurtainOptions. Deliberately separate from
   *  `fabrics` above (which pages hand straight to the client) so the rate
   *  never rides along in a server-component prop. */
  fabricRates: Map<string, number>;
  /** Manufacturer section Part 1 — mfrKey → that manufacturer's image
   *  document (unlinked; servable); used only as a fallback for parts with no
   *  photo of their own. Never feeds `IndexedPart.imageIds`, visibility or the
   *  browse rule. */
  mfrImageDocs: Map<string, string>;
  /** #304 — a renamed part's former SKU → its live SKU (from the parts'
   *  `formerSkus`), so an old `?part=` bookmark or a cart line written before
   *  the cart sweep still finds the part. Read through `portalPart`. */
  formerSkus: Map<string, string>;
};

/** The quotable part `sku` names — its live SKU, or a former one a rename
 *  moved (#304). The returned part carries the live `sku`. */
export function portalPart(ix: Pick<PortalIndex, "parts" | "formerSkus">, sku: string): IndexedPart | undefined {
  const own = ix.parts.get(sku);
  if (own) return own;
  const to = ix.formerSkus.get(sku);
  return to ? ix.parts.get(to) : undefined;
}

/** Manufacturer name → its image document id (servable), or null. */
export function portalMfrImage(ix: Pick<PortalIndex, "mfrImageDocs">): (mfr: string) => string | null {
  return (mfr) => ix.mfrImageDocs.get(mfrKey(mfr)) ?? null;
}

const TTL_MS = 5 * 60 * 1000;
const MONTH_MS = 30.4375 * 86400000;

type Built = { at: number; ix: PortalIndex; facts: Map<string, VisibilityFacts>; rule: BrowseRule };

let cache: Built | null = null;
let building: Promise<Built> | null = null;
/** Bumped by every invalidation, so a build that started before a write
 *  never lands in the cache after it. */
let generation = 0;

export function invalidatePortalIndex(): void {
  cache = null;
  building = null;
  generation++;
}

async function built(opts?: { fresh?: boolean }): Promise<Built> {
  if (!opts?.fresh && cache && Date.now() - cache.at < TTL_MS) return cache;
  if (!opts?.fresh && building) return building;
  const gen = generation;
  const p = buildIndex().then((b) => {
    if (gen === generation) cache = b;
    return b;
  });
  building = p;
  try {
    return await p;
  } finally {
    if (building === p) building = null;
  }
}

/** #289: a fixture's portal catalog category — its cleaned `portalCategory`,
 *  else "Other packages". Fixtures browse under Packages & Assemblies,
 *  grouped by this; departments never hold them. */
export function packageCategoryOf(portalCategory: unknown): string {
  return cleanPortalCategory(portalCategory) || OTHER_PACKAGES_CATEGORY;
}

/** The cached index (5 min per process); `fresh` forces a rebuild. */
/** A fixture component: a quotable part, or a labor row the fixture carries.
 *  Only fixture resolution/pricing may call this — never a lone-part path. */
export function fixtureComponentPart(ix: Pick<PortalIndex, "parts" | "componentParts" | "formerSkus">, sku: string): IndexedPart | undefined {
  return portalPart(ix, sku) ?? ix.componentParts.get(sku);
}

export async function portalIndex(opts?: { fresh?: boolean }): Promise<PortalIndex> {
  return (await built(opts)).ix;
}

/**
 * Distinct quotes per SKU created at or after `since` (#245 browse rule).
 * Skips deleted quotes and Daylite history imports; walks
 * `spec.sections[].items[].sku`, guarding every level; a SKU counts once per
 * quote however many lines carry it. Pure.
 */
export function countRecentQuotesBySku(
  quotes: ReadonlyArray<{ source?: string; createdAt: number; spec?: unknown; deleted?: boolean }>,
  since: number
): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of quotes) {
    if (!q || q.deleted || q.source === "daylite") continue;
    if (!(typeof q.createdAt === "number" && q.createdAt >= since)) continue;
    const sections = (q.spec as { sections?: unknown } | null | undefined)?.sections;
    if (!Array.isArray(sections)) continue;
    const seen = new Set<string>();
    for (const sec of sections) {
      const items = (sec as { items?: unknown } | null)?.items;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        const sku = (it as { sku?: unknown } | null)?.sku;
        if (typeof sku === "string" && sku) seen.add(sku);
      }
    }
    for (const sku of seen) out.set(sku, (out.get(sku) ?? 0) + 1);
  }
  return out;
}

/** One sidebar document's kind + title (#245 Task 11; #290 adds manual). */
export type PortalDocMeta = { kind: DocSlotKind; title: string; pdf: boolean };

/** A slot document's sidebar meta, or null for an image or an unknown kind
 *  (#290: pure, so the harness checks a manual without a DB). */
export function portalDocMetaOf(d: Pick<PartDocument, "kind" | "title" | "fileName" | "contentType">): PortalDocMeta | null {
  if (!isDocSlotKind(d.kind)) return null;
  const pdf = (d.contentType || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(d.fileName || "");
  return { kind: d.kind, title: (d.title || d.fileName || "").trim(), pdf };
}

/** The slots that count as "has a datasheet" for the browse rule (spec
 *  §1.3). #290 decision: a manual alone does NOT make a part browsable — the
 *  rule stays datasheet/spec sheet, as it was before manuals existed. */
const BROWSE_DOC_KINDS: readonly DocSlotKind[] = ["datasheet", "specsheet"];

/** "Has a datasheet" for the browse rule (spec §1.3) = a document a
 *  customer can actually open in the datasheet or spec-sheet slot, own or
 *  covered by a parent's — a "not needed" mark satisfies the staff slot but
 *  gives the customer nothing to read. Pure (#290). */
export function portalHasCustomerDocument(index: CoverageIndex, sku: string): boolean {
  return BROWSE_DOC_KINDS.some((kind) => {
    const st = slotCoverage(index, sku, kind).state;
    return st === "own" || st === "covered";
  });
}

/** Datasheet/spec-sheet/manual documents with a stored file a customer can
 *  open: the part's own, then those of parents whose documents cover it. */
function datasheetIdsFor(index: CoverageIndex, sku: string): string[] {
  const ids = new Set<string>();
  for (const kind of DOC_SLOT_KINDS) {
    for (const d of ownFiles(index, sku, kind)) ids.add(d.id);
    for (const parent of coveringParents(index, sku, kind)) for (const d of ownFiles(index, parent, kind)) ids.add(d.id);
  }
  return [...ids];
}

/**
 * The pure computation behind `PortalIndex.servableDocIds` (#245 Task 9 fix
 * round 1, spec §7) — factored out of `buildIndex` so it's exercised
 * directly against `buildCoverageIndex`/`buildImageIndex` fixtures, no DB.
 * For every SKU in `liveSkus` (quotable — already filtered to non-hidden
 * parts by the caller): its own visible (not-hidden-link) images that have
 * a stored file, plus `datasheetIdsFor` — its own and covering-parents'
 * datasheet/spec-sheet/manual documents with a stored file. `ownFiles` (used by
 * both `datasheetIdsFor` and here) already requires `blobKey`, so a
 * link-only document (fetched URL, no bytes yet) never appears in either
 * set; `coveringParents` already excludes an `ownDatasheet` accessory pair
 * and never crosses an image (`buildCoverageIndex` drops image links
 * entirely from `docsBySku`).
 */
export function servableDocIdsFrom(
  index: CoverageIndex,
  images: ReadonlyMap<string, ImageRef[]>,
  liveSkus: Iterable<string>
): Set<string> {
  const ids = new Set<string>();
  for (const sku of liveSkus) {
    for (const r of images.get(sku) ?? []) {
      if (!r.hidden && index.docsById.get(r.id)?.blobKey) ids.add(r.id);
    }
    for (const id of datasheetIdsFor(index, sku)) ids.add(id);
  }
  return ids;
}

async function buildIndex(): Promise<Built> {
  const now = Date.now();
  const [all, rules, fixtureRows, quotes, manufacturerRows] = await Promise.all([listCatalog(), loadPortalRules(), listFixtures(), getAllQuotes(), listManufacturers()]);
  const rule: BrowseRule = { minQuotes: rules.browseMinQuotes };
  const state = await loadPartDocsState(all);
  const images = buildImageIndex(state.documents, state.links);
  const counts = countRecentQuotesBySku(quotes, now - rules.browseWindowMonths * MONTH_MS);

  // Withheld: an explicit Hide, and internal labor/travel rows left on
  // "auto" (#245 Task 11) — neither quotable, browsable nor searchable.
  const live: CatalogPart[] = all.filter((p) => p && p.sku && !portalHidden(p.portalVisibility, p.category));
  const liveSkus = new Set(live.map((p) => p.sku));

  const parts = new Map<string, IndexedPart>();
  const formerSkus = new Map<string, string>();
  const facts = new Map<string, VisibilityFacts>();
  const docMeta: PortalIndex["docMeta"] = new Map();
  const fabrics: PortalIndex["fabrics"] = [];
  const fabricRates: PortalIndex["fabricRates"] = new Map();
  const entries: SearchEntry[] = [];
  for (const p of live) {
    const visibility = normalizeVisibility(p.portalVisibility);
    const imageIds = (images.get(p.sku) ?? [])
      .filter((r) => !r.hidden && !!state.index.docsById.get(r.id)?.blobKey)
      .map((r) => r.id);
    const hasDatasheet = portalHasCustomerDocument(state.index, p.sku);
    const f: VisibilityFacts = {
      visibility,
      hasVisibleImage: imageIds.length > 0,
      hasDatasheet,
      quoteCount: counts.get(p.sku) ?? 0,
      ...(isInternalCategory(p.category) ? { internal: true } : {}),
    };
    facts.set(p.sku, f);
    const ip: IndexedPart = {
      sku: p.sku,
      desc: p.desc || "",
      mfr: p.mfr || "",
      category: p.category || "",
      unit: p.unit || "ea",
      mpn: p.manufacturerPartNumber || "",
      model: p.manufacturerModelNumber || "",
      cost: Number(p.cost) || 0,
      list: Number(p.list) || 0,
      note: p.note || "",
      pricedAt: typeof p.pricedAt === "number" ? p.pricedAt : null,
      visibility,
      imageIds,
      datasheetIds: datasheetIdsFor(state.index, p.sku),
      specText: p.specState === "authored" && p.specBody ? p.specBody : null,
      accessories: (state.index.childrenOf.get(p.sku) ?? []).filter((s) => liveSkus.has(s)),
      quoteCount: f.quoteCount,
    };
    parts.set(p.sku, ip);
    for (const old of p.formerSkus ?? []) if (old && !liveSkus.has(old)) formerSkus.set(old, p.sku);
    for (const id of ip.datasheetIds) {
      if (docMeta.has(id)) continue;
      const d = state.index.docsById.get(id);
      const meta = d ? portalDocMetaOf(d) : null;
      if (meta) docMeta.set(id, meta);
    }
    if (isFabricPart(p)) {
      const rate = fabricAreaRateOf(p);
      if (rate > 0) {
        fabrics.push({ sku: p.sku, name: (p.desc || p.sku).trim() });
        fabricRates.set(p.sku, rate);
      }
    }
    entries.push({
      key: ip.sku,
      kind: "part",
      title: ip.desc || ip.sku,
      sku: ip.sku,
      mfr: ip.mfr,
      category: ip.category,
      haystack: buildHaystack([ip.sku, ip.desc, ip.mfr, ip.category, ip.mpn, ip.model, ...(p.formerSkus ?? [])]), // #304: old order numbers find the part
      browsable: browsable(f, rule),
      rank: ip.quoteCount,
    });
  }

  // Labor rows on "auto": fixture components only (never entries, facts,
  // docs, accessories or priceSku).
  const componentParts = new Map<string, IndexedPart>();
  for (const p of all) {
    if (!p || !p.sku || parts.has(p.sku)) continue;
    if (normalizeVisibility(p.portalVisibility) !== "auto" || !isInternalCategory(p.category)) continue;
    componentParts.set(p.sku, {
      sku: p.sku, desc: p.desc || "", mfr: p.mfr || "", category: p.category || "", unit: p.unit || "ea",
      mpn: p.manufacturerPartNumber || "", model: p.manufacturerModelNumber || "",
      cost: Number(p.cost) || 0, list: Number(p.list) || 0, note: p.note || "",
      pricedAt: typeof p.pricedAt === "number" ? p.pricedAt : null, visibility: "auto",
      imageIds: [], datasheetIds: [], specText: null, accessories: [], quoteCount: 0,
    });
  }
  const comp = (sku: string) => parts.get(sku) ?? componentParts.get(sku);

  const fixtures = new Map<string, IndexedFixture>();
  for (const fx of fixtureRows) {
    if (fx.kind !== "fixture" || !fx.lightEngineSku) continue;
    const engine = parts.get(fx.lightEngineSku);
    if (!engine) continue; // a light engine the customer can't quote → no fixture
    const labelOf = (sku: string, label?: string) => (label || "").trim() || comp(sku)?.desc || sku;
    const lines: IndexedFixture["lines"] = [
      { slot: "lightEngine", sku: fx.lightEngineSku, label: labelOf(fx.lightEngineSku, fx.lightEngineLine?.label), qty: headQty(fx.lightEngineLine?.qty), required: true },
    ];
    if (fx.lensSku) lines.push({ slot: "lens", sku: fx.lensSku, label: labelOf(fx.lensSku, fx.lensLine?.label), qty: headQty(fx.lensLine?.qty), required: true });
    for (const [box, boxLines] of Object.entries(fx.lines ?? {})) {
      for (const l of boxLines ?? []) {
        if (!l?.sku) continue;
        const qty = Number(l.qty) > 0 ? Number(l.qty) : 0;
        // An optional add-on the customer can't quote is simply not offered.
        if (qty === 0 && !comp(l.sku)) continue;
        lines.push({ slot: box, sku: l.sku, label: labelOf(l.sku, l.label), qty, required: qty > 0 });
      }
    }
    // Offered only when every required component is quotable (spec §2.1).
    if (lines.some((l) => l.required && !comp(l.sku))) continue;
    const f: IndexedFixture = { id: fx.id, label: fx.label, description: fx.description || "", lightEngineSku: fx.lightEngineSku, lensSku: fx.lensSku || null, lines };
    fixtures.set(fx.id, f);
    entries.push({
      key: "fixture:" + fx.id,
      kind: "fixture",
      title: f.label,
      sku: f.lightEngineSku,
      mfr: engine.mfr,
      category: packageCategoryOf(fx.portalCategory),
      haystack: buildHaystack([f.label, f.description, f.lightEngineSku, fx.portalCategory]),
      browsable: true,
      rank: 1000,
    });
  }

  const servableDocIds = servableDocIdsFrom(state.index, images, liveSkus);
  // Manufacturer images are unlinked documents (docsById is built from every
  // document, linked or not). They are servable but never a part's own photo.
  const mfrImageDocs = new Map<string, string>();
  const mfrCanon = canonicalKeyMap(manufacturerRows);
  for (const m of manufacturerRows) {
    if (m.mergedInto || mfrCanon(m.key) !== m.key) continue; // a merged-away spelling is reached through its target's aliasKeys
    const d = m.imageDocumentId ? state.index.docsById.get(m.imageDocumentId) : undefined;
    if (d && d.kind === "image" && d.blobKey && ["image/png", "image/jpeg", "image/webp"].includes(d.contentType)) {
      for (const k of [m.key, ...m.aliasKeys]) mfrImageDocs.set(k, d.id);
      servableDocIds.add(d.id);
    }
  }

  fabrics.sort((a, b) => a.name.localeCompare(b.name));

  return { at: now, ix: { parts, componentParts, fixtures, entries, builtAt: now, servableDocIds, docMeta, fabrics, fabricRates, mfrImageDocs, formerSkus }, facts, rule };
}

function headQty(q: number | undefined): number {
  return typeof q === "number" && q > 0 ? q : 1;
}

/**
 * What the portal does with one part, plus the reason line the catalog part
 * editor shows under Auto/Show/Hide. A part absent from the index is either
 * hidden or newer than the cached index — the second case rebuilds once.
 */
export async function portalFactsForSku(sku: string): Promise<VisibilityFacts & { reason: string }> {
  let b = await built();
  let f = b.facts.get(sku);
  let part: CatalogPart | null = null;
  if (!f) {
    part = sku ? await getPart(sku) : null;
    if (part && !portalHidden(part.portalVisibility, part.category)) {
      b = await built({ fresh: true });
      f = b.facts.get(sku);
    }
  }
  if (!f) {
    // An internal labor/travel row on "auto" is withheld by category, not by
    // a human's Hide — say so, so the editor's Auto reads right (#245 Task 11).
    if (part && normalizeVisibility(part.portalVisibility) === "auto" && isInternalCategory(part.category)) {
      return { visibility: "auto", hasVisibleImage: false, hasDatasheet: false, quoteCount: 0, internal: true, reason: INTERNAL_HIDDEN_REASON };
    }
    const hidden: VisibilityFacts = { visibility: "hide", hasVisibleImage: false, hasDatasheet: false, quoteCount: 0 };
    return { ...hidden, reason: "Hidden from customers" };
  }
  return { ...f, reason: browseReason(f, b.rule) };
}
