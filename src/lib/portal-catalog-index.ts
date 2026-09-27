import { get as getPart, list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { coveringParents, ownFiles, slotCoverage, type CoverageIndex } from "@/lib/part-docs/coverage";
import { buildImageIndex } from "@/lib/part-docs/views";
import { DOC_SLOT_KINDS } from "@/lib/part-docs/types";
import { loadPortalRules } from "@/lib/freight-rule-load";
import {
  browsable,
  browseReason,
  normalizeVisibility,
  type BrowseRule,
  type PortalVisibility,
  type VisibilityFacts,
} from "@/lib/portal-visibility";
import { buildHaystack, type SearchEntry } from "@/lib/portal-search";

/**
 * The portal's catalog index (#242, spec §1/§3/§8) — SERVER ONLY.
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
};

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

/** The cached index (5 min per process); `fresh` forces a rebuild. */
export async function portalIndex(opts?: { fresh?: boolean }): Promise<PortalIndex> {
  return (await built(opts)).ix;
}

/**
 * Distinct quotes per SKU created at or after `since` (#242 browse rule).
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

/** Datasheet/spec-sheet documents with a stored file a customer can open:
 *  the part's own, then those of parents whose documents cover it. */
function datasheetIdsFor(index: CoverageIndex, sku: string): string[] {
  const ids = new Set<string>();
  for (const kind of DOC_SLOT_KINDS) {
    for (const d of ownFiles(index, sku, kind)) ids.add(d.id);
    for (const parent of coveringParents(index, sku, kind)) for (const d of ownFiles(index, parent, kind)) ids.add(d.id);
  }
  return [...ids];
}

async function buildIndex(): Promise<Built> {
  const now = Date.now();
  const [all, rules, fixtureRows, quotes] = await Promise.all([listCatalog(), loadPortalRules(), listFixtures(), getAllQuotes()]);
  const rule: BrowseRule = { minQuotes: rules.browseMinQuotes };
  const state = await loadPartDocsState(all);
  const images = buildImageIndex(state.documents, state.links);
  const counts = countRecentQuotesBySku(quotes, now - rules.browseWindowMonths * MONTH_MS);

  const live: CatalogPart[] = all.filter((p) => p && p.sku && normalizeVisibility(p.portalVisibility) !== "hide");
  const liveSkus = new Set(live.map((p) => p.sku));

  const parts = new Map<string, IndexedPart>();
  const facts = new Map<string, VisibilityFacts>();
  const entries: SearchEntry[] = [];
  for (const p of live) {
    const visibility = normalizeVisibility(p.portalVisibility);
    const imageIds = (images.get(p.sku) ?? [])
      .filter((r) => !r.hidden && !!state.index.docsById.get(r.id)?.blobKey)
      .map((r) => r.id);
    // "Has a datasheet" for the browse rule = one a customer can actually
    // open, own or covered by a parent's — a "not needed" mark satisfies the
    // staff slot but gives the customer nothing to read.
    const ds = slotCoverage(state.index, p.sku, "datasheet").state;
    const f: VisibilityFacts = {
      visibility,
      hasVisibleImage: imageIds.length > 0,
      hasDatasheet: ds === "own" || ds === "covered",
      quoteCount: counts.get(p.sku) ?? 0,
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
    entries.push({
      key: ip.sku,
      kind: "part",
      title: ip.desc || ip.sku,
      sku: ip.sku,
      mfr: ip.mfr,
      category: ip.category,
      haystack: buildHaystack([ip.sku, ip.desc, ip.mfr, ip.category, ip.mpn, ip.model]),
      browsable: browsable(f, rule),
      rank: ip.quoteCount,
    });
  }

  const fixtures = new Map<string, IndexedFixture>();
  for (const fx of fixtureRows) {
    if (fx.kind !== "fixture" || !fx.lightEngineSku) continue;
    const engine = parts.get(fx.lightEngineSku);
    if (!engine) continue; // a light engine the customer can't quote → no fixture
    const labelOf = (sku: string, label?: string) => (label || "").trim() || parts.get(sku)?.desc || sku;
    const lines: IndexedFixture["lines"] = [
      { slot: "lightEngine", sku: fx.lightEngineSku, label: labelOf(fx.lightEngineSku, fx.lightEngineLine?.label), qty: headQty(fx.lightEngineLine?.qty), required: true },
    ];
    if (fx.lensSku) lines.push({ slot: "lens", sku: fx.lensSku, label: labelOf(fx.lensSku, fx.lensLine?.label), qty: headQty(fx.lensLine?.qty), required: true });
    for (const [box, boxLines] of Object.entries(fx.lines ?? {})) {
      for (const l of boxLines ?? []) {
        if (!l?.sku) continue;
        const qty = Number(l.qty) > 0 ? Number(l.qty) : 0;
        // An optional add-on the customer can't quote is simply not offered.
        if (qty === 0 && !parts.has(l.sku)) continue;
        lines.push({ slot: box, sku: l.sku, label: labelOf(l.sku, l.label), qty, required: qty > 0 });
      }
    }
    // Offered only when every required component is quotable (spec §2.1).
    if (lines.some((l) => l.required && !parts.has(l.sku))) continue;
    const f: IndexedFixture = { id: fx.id, label: fx.label, description: fx.description || "", lightEngineSku: fx.lightEngineSku, lensSku: fx.lensSku || null, lines };
    fixtures.set(fx.id, f);
    entries.push({
      key: "fixture:" + fx.id,
      kind: "fixture",
      title: f.label,
      sku: f.lightEngineSku,
      mfr: engine.mfr,
      category: "Fixture assemblies",
      haystack: buildHaystack([f.label, f.description, f.lightEngineSku]),
      browsable: true,
      rank: 1000,
    });
  }

  return { at: now, ix: { parts, fixtures, entries, builtAt: now }, facts, rule };
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
  if (!f) {
    const part = sku ? await getPart(sku) : null;
    if (part && normalizeVisibility(part.portalVisibility) !== "hide") {
      b = await built({ fresh: true });
      f = b.facts.get(sku);
    }
  }
  if (!f) {
    const hidden: VisibilityFacts = { visibility: "hide", hasVisibleImage: false, hasDatasheet: false, quoteCount: 0 };
    return { ...hidden, reason: "Hidden from customers" };
  }
  return { ...f, reason: browseReason(f, b.rule) };
}
