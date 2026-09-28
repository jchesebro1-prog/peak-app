import raw from "./proscenium.json";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import { stretchTemplate } from "./stretch";
import type { StretchDims, StretchedPlan, VenueTemplate } from "./types";

/** Jeff's Auditorium / PAC background (#249), converted by scripts/venue-template-convert.py. */
export const PROSCENIUM_TEMPLATE = raw as unknown as VenueTemplate;
/** Stamped on a Grid design whose base sheet this template drew (intake.baseSheetTemplate). */
export const PROSCENIUM_TEMPLATE_ID = "proscenium@1";

let last: { key: string; plan: StretchedPlan } | null = null;

/** The proscenium template stretched to `d` — memoized on the last call (a render and its drag math ask twice). */
export function stretchProscenium(d: StretchDims): StretchedPlan {
  const key = JSON.stringify(d);
  if (last?.key === key) return last.plan;
  const plan = stretchTemplate(PROSCENIUM_TEMPLATE, PROSCENIUM_KEYS, d);
  last = { key, plan };
  return plan;
}
