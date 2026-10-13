/** Draft estimate candidates (D876) — reads stores; never returns cost/price to the prompt. Server-only. */
import { listDocsByField } from "@/db/doc-store";
import { rankCatalogParts } from "@/app/(app)/estimator/catalog-rank";
import { getManyBySku, list as catalogList } from "@/lib/stores/catalog";
import { systemLibraryIndex } from "@/lib/narrative/system-library-index";
import { searchSystemLibrary } from "@/lib/narrative/system-library";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { getSystemCategories } from "@/lib/stores/system-categories";
import { displayQuoteNumber } from "@/lib/estimate-number";
import type { SystemCategory } from "@/lib/system-categories";
import type { CandidatePart, ExampleSystem, PricePart } from "./features/estimate-draft";

const CANDIDATE_CAP = 400;
const PER_QUERY = 8;
const PAST_SYSTEMS = 5;
const CUSTOMER_QUOTES = 5;

type Item = { sku?: string; desc?: string; qty?: number; bonus?: unknown };
const itemsOf = (q: Quote | null, sectionId?: string): Item[] =>
  ((q?.spec as { sections?: Array<{ id: string; kind?: string; items?: Item[] }> } | null | undefined)?.sections ?? [])
    .filter((s) => s && s.kind !== "labor" && (!sectionId || s.id === sectionId))
    .flatMap((s) => (Array.isArray(s.items) ? s.items : []).filter((i) => i && !i.bonus));

const exampleLines = (items: Item[]) =>
  items
    .filter((i) => typeof i.sku === "string" && i.sku)
    .map((i) => ({ sku: i.sku as string, desc: i.desc || "", qty: Number(i.qty) || 1 }));

export type EstimateCandidates = {
  candidates: CandidatePart[];
  parts: Map<string, PricePart>;
  pastSystems: ExampleSystem[];
  customerSystems: ExampleSystem[];
  categories: SystemCategory[];
};

export async function gatherEstimateCandidates(input: { phrases: string[]; systems: string[]; customerId: string | null }): Promise<EstimateCandidates> {
  const skus = new Set<string>();

  // 1. catalog hits — each phrase plus each significant word of it
  const all = await catalogList();
  const queries = [...new Set(input.phrases.flatMap((p) => [p, ...p.split(/\s+/).filter((w) => w.length >= 4)]))];
  for (const q of queries) for (const { p } of rankCatalogParts(all, q).slice(0, PER_QUERY)) skus.add(p.sku);

  // 2. similar past systems (#293 library) — top 5 across system names + phrases
  const lib = await systemLibraryIndex();
  const seen = new Set<string>();
  const entries = [...input.systems, ...input.phrases]
    .flatMap((q) => searchSystemLibrary(lib, q, { limit: 3 }))
    .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
    .slice(0, PAST_SYSTEMS);
  const pastSystems: ExampleSystem[] = [];
  for (const e of entries) {
    const live = exampleLines(itemsOf(await getQuote(e.quoteId), e.sectionId));
    const lines = live.length ? live : e.skus.map((sku, i) => ({ sku, desc: e.descs[i] || "", qty: 1 }));
    if (!lines.length) continue;
    lines.forEach((l) => skus.add(l.sku));
    pastSystems.push({ label: `${e.estNumber} ${e.systemName}`.trim(), lines });
  }

  // 3. this customer's past system estimates (newest 5, no Daylite history)
  const customerSystems: ExampleSystem[] = [];
  if (input.customerId) {
    const qs = (await listDocsByField<Quote>("quotes", "customerId", [input.customerId]))
      .filter((q) => (q.quoteType || "system") === "system" && q.source !== "daylite")
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, CUSTOMER_QUOTES);
    for (const q of qs) {
      const lines = exampleLines(itemsOf(q));
      if (!lines.length) continue;
      lines.forEach((l) => skus.add(l.sku));
      customerSystems.push({ label: `${displayQuoteNumber(q)} ${q.name || ""}`.trim(), lines });
    }
  }

  // 4. system categories (Estimating Rules → System categories)
  const categories = await getSystemCategories();
  categories.forEach((c) => c.items.forEach((i) => skus.add(i.sku)));

  // Resolve to live parts (renames followed, retired/deleted parts absent), cap, build both views.
  const live = await getManyBySku([...skus]);
  const candidates: CandidatePart[] = [];
  const parts = new Map<string, PricePart>();
  for (const p of live.values()) {
    if (parts.has(p.sku) || candidates.length >= CANDIDATE_CAP) continue;
    parts.set(p.sku, { sku: p.sku, desc: p.desc || "", unit: p.unit || "ea", cost: p.cost || 0, list: p.list || 0 });
    candidates.push({ sku: p.sku, desc: p.desc || "", mfr: p.mfr || "", unit: p.unit || "ea", category: p.category || "" });
  }
  return { candidates, parts, pastSystems, customerSystems, categories };
}
