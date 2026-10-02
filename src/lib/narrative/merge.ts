import type { KeyProduct, SpecSection } from "@/app/(app)/estimator/types";
import { MAX_INTRO, MAX_KEY_PRODUCTS, MAX_PARAGRAPH, isKeyProductEligible, isLineToken, keyProductSkuOf, withKeyProducts } from "@/app/(app)/estimator/narrative";

/**
 * #293 slice 2 — Merge narrative: append library systems' intros and key
 * products into a system. Append-only, never invents a line (a block can't
 * exist without one, and adding a priced line would change the estimate).
 * Pure and client-safe: the modal previews with it, the column applies it.
 *
 * A `line:<id>` block (an allowance line, or a custom line with no real sku —
 * Manufacturer section Part 1)
 * names a line of its source system only — nothing here can match it, so it
 * is skipped and counted nowhere. A real sku matches only a line whose own
 * anchor is that sku (a tokenized line anchors on its token).
 */

export type MergeOpts = { intro: boolean; products: boolean };
export type MergeSource = { systemName: string; intro: string; keyProducts: Array<Pick<KeyProduct, "sku" | "text" | "photo">> };
export type MergeResult = {
  section: SpecSection;
  changed: boolean;
  introsAppended: number;
  /** Intros skipped because appending would pass MAX_INTRO. */
  introsTooLong: number;
  productsAdded: number;
  /** Sku already a key product here. */
  skippedPresent: string[];
  /** No eligible, unmarked line with that sku here. */
  skippedNoLine: string[];
  /** A line existed but the system is at MAX_KEY_PRODUCTS. */
  skippedFull: string[];
};

const normWs = (s: string): string => s.replace(/\s+/g, " ").trim();
const pushOnce = (list: string[], sku: string): void => {
  if (!list.includes(sku)) list.push(sku);
};

export function mergeNarrative(target: SpecSection, sources: MergeSource[], opts: MergeOpts): MergeResult {
  const srcs = Array.isArray(sources) ? sources : [];
  let narrative = typeof target.narrative === "string" ? target.narrative : "";
  let introsAppended = 0;
  let introsTooLong = 0;
  if (opts.intro) {
    for (const s of srcs) {
      const t = (typeof s?.intro === "string" ? s.intro : "").replace(/\r\n?/g, "\n").trim();
      if (!t || normWs(narrative).includes(normWs(t))) continue;
      const next = narrative.trim() ? narrative.replace(/\s+$/, "") + "\n\n" + t : t;
      if (next.length > MAX_INTRO) {
        introsTooLong++;
        continue;
      }
      narrative = next;
      introsAppended++;
    }
  }

  const kps: KeyProduct[] = Array.isArray(target.keyProducts) ? [...target.keyProducts] : [];
  let productsAdded = 0;
  const skippedPresent: string[] = [];
  const skippedNoLine: string[] = [];
  const skippedFull: string[] = [];
  if (opts.products) {
    for (const s of srcs) {
      for (const b of Array.isArray(s?.keyProducts) ? s.keyProducts : []) {
        const sku = typeof b?.sku === "string" ? b.sku.trim() : "";
        if (!sku || isLineToken(sku)) continue;
        if (kps.some((k) => k.sku === sku)) {
          pushOnce(skippedPresent, sku);
          continue;
        }
        const used = new Set(kps.map((k) => k.lineKey));
        const line = target.items.find((it) => isKeyProductEligible(it) && keyProductSkuOf(it) === sku && !used.has(String(it.id)));
        if (!line) {
          pushOnce(skippedNoLine, sku);
          continue;
        }
        if (kps.length >= MAX_KEY_PRODUCTS) {
          pushOnce(skippedFull, sku);
          continue;
        }
        kps.push({ lineKey: String(line.id), sku, text: (typeof b.text === "string" ? b.text : "").slice(0, MAX_PARAGRAPH), photo: b.photo !== false });
        productsAdded++;
      }
    }
  }

  const changed = introsAppended > 0 || productsAdded > 0;
  const result = { changed, introsAppended, introsTooLong, productsAdded, skippedPresent, skippedNoLine, skippedFull };
  if (!changed) return { section: target, ...result };
  const base: SpecSection = introsAppended ? { ...target, narrative } : target;
  return { section: productsAdded ? withKeyProducts(base, kps) : base, ...result };
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

export function mergeNotice(r: Omit<MergeResult, "section" | "changed">): string {
  const parts: string[] = [];
  if (r.introsAppended) parts.push(`Added intro from ${plural(r.introsAppended, "system")}`);
  if (r.productsAdded) parts.push(parts.length ? plural(r.productsAdded, "key product") : `Added ${plural(r.productsAdded, "key product")}`);
  if (r.skippedPresent.length) parts.push(`skipped ${r.skippedPresent.length} already featured`);
  if (r.skippedNoLine.length) parts.push(`${r.skippedNoLine.length} not on this system (add the part first): ${r.skippedNoLine.join(", ")}`);
  if (r.skippedFull.length) parts.push(`${r.skippedFull.length} over the ${MAX_KEY_PRODUCTS}-product limit`);
  if (r.introsTooLong) parts.push(`${plural(r.introsTooLong, "intro")} too long to append`);
  if (!parts.length) return "Nothing to merge — this system already has it all";
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
