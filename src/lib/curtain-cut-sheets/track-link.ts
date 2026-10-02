/**
 * Curtain ↔ track link (#292 decision 5, spec §2.2). Pure.
 * By key: a track line and a curtain line sharing `curtainTrackKey` link —
 * a track in the curtain's OWN section first, then one in any section. The
 * same-section pass repairs quotes saved before keys were unique (two
 * systems copied from one could share a `ct-<line id>` key). Fallback for
 * quotes saved before #292: a key-less curtain links to the item right after
 * it in the SAME section when that item is a track line with no key of its
 * own. One track per curtain: a second curtain naming the same key is
 * returned in `duplicates` (staff warning) and falls back to its own picked
 * mount.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

/** Unique enough across estimates (the mintVendorQuoteId idiom): time + random, base 36. */
const defaultNonce = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * `ct-<curtain line id>-<nonce>` (final review #1). The line id alone was
 * per-estimate (a counter from 100), so a copied system or a moved one could
 * share it; the nonce makes a new key globally unique. Legacy `ct-<id>` keys
 * keep linking — keys are only ever compared, never parsed.
 */
export function newCurtainTrackKey(curtainLineId: number, nonce: () => string = defaultNonce): string {
  return `ct-${curtainLineId}-${nonce()}`;
}

/**
 * A copied system's curtain/track pairs, each given a fresh shared key (old
 * key → one new key, every line carrying it in this copy). Lines without a
 * key are untouched; the input is never mutated.
 */
export function remapCurtainTrackKeys(items: readonly SpecItem[], mint: (curtainLineId: number) => string = (id) => newCurtainTrackKey(id)): SpecItem[] {
  const next = new Map<string, string>();
  for (const it of items) {
    const k = it.curtainTrackKey;
    if (!k || next.has(k)) continue;
    const curtain = items.find((x) => x.curtain && x.curtainTrackKey === k);
    next.set(k, mint((curtain ?? it).id));
  }
  if (!next.size) return items.slice();
  return items.map((it) => (it.curtainTrackKey ? { ...it, curtainTrackKey: next.get(it.curtainTrackKey) } : it));
}

export type CurtainTrackLinks = { links: Map<SpecItem, SpecItem>; duplicates: SpecItem[] };

export function linkCurtainTracks(sections: readonly SpecSection[]): CurtainTrackLinks {
  const tracksByKey = new Map<string, SpecItem[]>();
  const sectionOf = new Map<SpecItem, number>();
  sections.forEach((sec, si) => {
    for (const it of sec.items || []) {
      sectionOf.set(it, si);
      if (!it.track || !it.curtainTrackKey) continue;
      const list = tracksByKey.get(it.curtainTrackKey);
      if (list) list.push(it);
      else tracksByKey.set(it.curtainTrackKey, [it]);
    }
  });
  const links = new Map<SpecItem, SpecItem>();
  const used = new Set<SpecItem>();
  const crossSection: SpecItem[] = [];
  // Pass 1: a track keyed in the curtain's own section, else the adjacency fallback.
  sections.forEach((sec, si) => {
    const items = sec.items || [];
    items.forEach((it, i) => {
      if (!it.curtain) return;
      let track: SpecItem | undefined;
      if (it.curtainTrackKey) {
        track = (tracksByKey.get(it.curtainTrackKey) || []).find((t) => sectionOf.get(t) === si && !used.has(t));
        if (!track) {
          crossSection.push(it);
          return;
        }
      } else {
        const next = items[i + 1];
        if (next && next.track && !next.curtainTrackKey && !used.has(next)) track = next;
      }
      if (!track) return;
      used.add(track);
      links.set(it, track);
    });
  });
  // Pass 2: a key with no free track in its own section — the first free one anywhere; none free is a duplicate.
  const duplicates: SpecItem[] = [];
  for (const it of crossSection) {
    const all = tracksByKey.get(it.curtainTrackKey as string) || [];
    const track = all.find((t) => !used.has(t));
    if (track) {
      used.add(track);
      links.set(it, track);
    } else if (all.length) duplicates.push(it);
  }
  return { links, duplicates };
}
