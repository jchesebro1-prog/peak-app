/**
 * #357 — a system landing in an EXISTING estimate (Move/Copy system, #266, and
 * Move lines → Another estimate) keeps its item ids unless one is already
 * used anywhere in the target estimate. A colliding line gets the next free id
 * above everything the target uses — its lines and the ids its package
 * document still refers to (docIdFloor, the same floor the Estimator's
 * computeNid starts from) — and its key-product star follows
 * (remapKeyProducts, which also re-points a `line:<id>` token). Nothing else
 * changes: a section with no collision is returned as the same object. Pure.
 */
import type { SpecSection } from "@/app/(app)/estimator/types";
import { remapKeyProducts, withKeyProducts } from "@/app/(app)/estimator/narrative";

export function reIdIncomingSection(incoming: SpecSection, targetSections: readonly SpecSection[], docFloor = 0): SpecSection {
  const taken = new Set<number>();
  let max = Math.max(0, Number.isFinite(docFloor) ? docFloor : 0);
  for (const s of targetSections) {
    for (const it of s?.items || []) {
      if (typeof it?.id !== "number" || !Number.isFinite(it.id)) continue;
      taken.add(it.id);
      max = Math.max(max, Math.floor(it.id));
    }
  }
  const items = incoming.items || [];
  if (!items.some((it) => taken.has(it.id))) return incoming;
  // Above the incoming ids too, so a minted id never lands on a later incoming line.
  for (const it of items) if (typeof it?.id === "number" && Number.isFinite(it.id)) max = Math.max(max, Math.floor(it.id));
  const idMap = new Map<number, number>();
  const seen = new Set<number>();
  const original = new Set<number>(); // a star names the FIRST line with its id
  const nextItems = items.map((it) => {
    let id = it.id;
    if (taken.has(id) || seen.has(id)) {
      id = ++max;
      while (taken.has(id) || seen.has(id)) id = ++max;
    }
    seen.add(id);
    if (!original.has(it.id)) {
      original.add(it.id);
      if (id !== it.id) idMap.set(it.id, id);
    }
    return id === it.id ? it : { ...it, id };
  });
  const out: SpecSection = { ...incoming, items: nextItems };
  if (!Array.isArray(incoming.keyProducts)) return out;
  // Only a re-minted line's star moves; every other block is kept as it came.
  const kps = incoming.keyProducts.map((kp) => (idMap.has(Number(kp.lineKey)) ? remapKeyProducts([kp], idMap)![0] : kp));
  return withKeyProducts(out, kps);
}
