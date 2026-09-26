import { normalizeSku } from "@/lib/davinci/sku";
import type { DavinciExtract } from "@/lib/davinci/types";
import type { AccessoryPair } from "./types";

/**
 * DaVinci pre-fill plan (#207, spec §6) — pure. Maps ETC's library onto
 * Peak's catalog:
 *  - every English DaVinci datasheet becomes ONE shared, link-only document
 *    (keyed by URL — the same URL on several types is one document) linked
 *    to every Peak part whose SKU matches one of those types;
 *  - every `types[].accessories` link becomes parent → accessory pairs
 *    between the matching Peak SKUs. A Peak SKU claimed by several DaVinci
 *    types (a Product and an Accessory classification of one model) is
 *    simply the same SKU on both ends — pairs are merged per (parent,
 *    accessory), keeping the larger maxQty.
 * No file is downloaded here or anywhere in the pre-fill: fetching is a
 * separate, explicit step.
 *
 * `parts` must already be scoped to the manufacturer DaVinci may enrich, and
 * `allowed` is that manufacturer gate on the DaVinci side
 * (catalog-davinci-apply.peakMfrFor) — SKU matching alone is not
 * brand-aware (#162: Draper "450" normalizes to ETC's "450").
 */

export type PrefillDoc = { url: string; label: string; typeId: string; skus: string[] };

export type PrefillStats = {
  parts: number;
  typesMatched: number;
  documents: number;
  documentLinks: number;
  accessoryPairs: number;
  accessoryLinksUnmatched: number;
};

export type PrefillPlan = {
  libraryTimestamp: string;
  documents: PrefillDoc[];
  accessoryPairs: AccessoryPair[];
  stats: PrefillStats;
};

export function planDavinciPrefill(
  extract: DavinciExtract,
  parts: ReadonlyArray<{ sku: string }>,
  allowed: (davinciManufacturer: string) => boolean
): PrefillPlan {
  const bySku = new Map<string, string[]>();
  for (const p of parts) {
    const k = normalizeSku(p.sku);
    if (!k) continue;
    const list = bySku.get(k);
    if (list) list.push(p.sku);
    else bySku.set(k, [p.sku]);
  }
  const matchedTypes = new Set<string>();
  const skusFor = (typeId: string, modelNumbers: readonly string[]): string[] => {
    const out = new Set<string>();
    for (const m of modelNumbers) for (const s of bySku.get(m) ?? []) out.add(s);
    if (out.size) matchedTypes.add(typeId);
    return [...out];
  };

  const docs = new Map<string, { url: string; label: string; typeId: string; skus: Set<string> }>();
  for (const r of extract.records) {
    if (!allowed(r.manufacturer)) continue;
    const datasheets = r.docs.filter((d) => d.kind === "datasheet" && d.url);
    if (!datasheets.length) continue;
    const skus = skusFor(r.typeId, r.modelNumbers);
    if (!skus.length) continue;
    for (const d of datasheets) {
      let entry = docs.get(d.url);
      if (!entry) docs.set(d.url, (entry = { url: d.url, label: d.label || r.displayName, typeId: r.typeId, skus: new Set() }));
      for (const s of skus) entry.skus.add(s);
    }
  }

  const types = extract.accessoryTypes ?? {};
  const pairs = new Map<string, AccessoryPair>();
  let unmatched = 0;
  for (const l of extract.accessoryLinks ?? []) {
    const parent = types[l.parentTypeId];
    const accessory = types[l.accessoryTypeId];
    if (!parent || !accessory || !allowed(parent.manufacturer) || !allowed(accessory.manufacturer)) {
      unmatched++;
      continue;
    }
    const ps = skusFor(l.parentTypeId, parent.modelNumbers);
    const as = skusFor(l.accessoryTypeId, accessory.modelNumbers);
    if (!ps.length || !as.length) {
      unmatched++;
      continue;
    }
    for (const parentSku of ps) {
      for (const accessorySku of as) {
        if (parentSku === accessorySku) continue;
        const key = `${parentSku}\u0000${accessorySku}`;
        const prior = pairs.get(key);
        if (prior) prior.maxQty = Math.max(prior.maxQty ?? 0, l.maxQuantity);
        else pairs.set(key, { parentSku, accessorySku, maxQty: l.maxQuantity, sourceRef: l.parentTypeId });
      }
    }
  }

  const documents = [...docs.values()].map((d) => ({ url: d.url, label: d.label, typeId: d.typeId, skus: [...d.skus].sort() }));
  return {
    libraryTimestamp: extract.libraryTimestamp,
    documents,
    accessoryPairs: [...pairs.values()],
    stats: {
      parts: parts.length,
      typesMatched: matchedTypes.size,
      documents: documents.length,
      documentLinks: documents.reduce((n, d) => n + d.skus.length, 0),
      accessoryPairs: pairs.size,
      accessoryLinksUnmatched: unmatched,
    },
  };
}
