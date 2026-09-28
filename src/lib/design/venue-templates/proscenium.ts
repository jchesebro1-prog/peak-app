import raw from "./proscenium.json";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import { stretchTemplate } from "./stretch";
import type { StretchDims, StretchedPlan, VenueTemplate } from "./types";

/** Jeff's Auditorium / PAC background (#249), converted by scripts/venue-template-convert.py. */
export const PROSCENIUM_TEMPLATE = raw as unknown as VenueTemplate;
/** Stamped on a Grid design whose base sheet this template drew (intake.baseSheetTemplate). */
export const PROSCENIUM_TEMPLATE_ID = "proscenium@1";

const cache: Array<{ key: string; plan: StretchedPlan }> = [];

/** The proscenium template stretched to `d` — memoized on the last two calls
 * (during a Quick Design wall drag, the drag-start state and the render ask
 * with different dims on every pointermove, alternating two keys; a
 * single-entry memo would miss on every call). */
export function stretchProscenium(d: StretchDims): StretchedPlan {
  const key = JSON.stringify(d);
  const hitIdx = cache.findIndex((e) => e.key === key);
  if (hitIdx !== -1) {
    const [hit] = cache.splice(hitIdx, 1);
    cache.unshift(hit);
    return hit.plan;
  }
  const plan = stretchTemplate(PROSCENIUM_TEMPLATE, PROSCENIUM_KEYS, d);
  cache.unshift({ key, plan });
  cache.length = Math.min(cache.length, 2);
  return plan;
}
