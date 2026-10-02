/**
 * Curtain ↔ track link (#292 decision 5, spec §2.2). Pure.
 * By key: a track line and a curtain line sharing `curtainTrackKey` link,
 * across sections. Fallback for quotes saved before #292: a key-less curtain
 * links to the item right after it in the SAME section when that item is a
 * track line with no key of its own. One track per curtain: a second curtain
 * naming the same key is returned in `duplicates` (staff warning) and falls
 * back to its own picked mount.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

export function newCurtainTrackKey(curtainLineId: number): string {
  return `ct-${curtainLineId}`;
}

export type CurtainTrackLinks = { links: Map<SpecItem, SpecItem>; duplicates: SpecItem[] };

export function linkCurtainTracks(sections: readonly SpecSection[]): CurtainTrackLinks {
  const trackByKey = new Map<string, SpecItem>();
  for (const sec of sections) {
    for (const it of sec.items || []) {
      if (it.track && it.curtainTrackKey && !trackByKey.has(it.curtainTrackKey)) trackByKey.set(it.curtainTrackKey, it);
    }
  }
  const links = new Map<SpecItem, SpecItem>();
  const used = new Set<SpecItem>();
  const duplicates: SpecItem[] = [];
  for (const sec of sections) {
    const items = sec.items || [];
    items.forEach((it, i) => {
      if (!it.curtain) return;
      let track: SpecItem | undefined;
      if (it.curtainTrackKey) track = trackByKey.get(it.curtainTrackKey);
      else {
        const next = items[i + 1];
        if (next && next.track && !next.curtainTrackKey) track = next;
      }
      if (!track) return;
      if (used.has(track)) {
        duplicates.push(it);
        return;
      }
      used.add(track);
      links.set(it, track);
    });
  }
  return { links, duplicates };
}
