import blackboxRaw from "./blackbox.json";
import { BLACKBOX_KEYS } from "./blackbox.keys";
import churchContemporaryRaw from "./church-contemporary.json";
import { CHURCH_CONTEMPORARY_KEYS } from "./church-contemporary.keys";
import churchTraditionalRaw from "./church-traditional.json";
import { CHURCH_TRADITIONAL_KEYS } from "./church-traditional.keys";
import gymStageRaw from "./gym-stage.json";
import { GYM_STAGE_KEYS } from "./gym-stage.keys";
import { PROSCENIUM_TEMPLATE, stretchProscenium } from "./proscenium";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import { stretchTemplate } from "./stretch";
import type { StretchDims, StretchedPlan, TemplateKeys, VenueTemplate } from "./types";

/**
 * Venue template drawings by id (#255). Imports the converted JSON, so it is
 * for geometry code (plan-svg, Grid), not for the Settings card — the
 * client-safe registry is ./index.
 */
type TemplateData = { template: VenueTemplate; keys: TemplateKeys; stretch: (d: StretchDims) => StretchedPlan };

/** A stretch memoised on its last two calls (a Quick Design drag alternates drag-start and render dims). */
function memo(template: VenueTemplate, keys: TemplateKeys): TemplateData {
  const cache: Array<{ key: string; plan: StretchedPlan }> = [];
  const stretch = (d: StretchDims) => {
    const key = JSON.stringify(d);
    const i = cache.findIndex((e) => e.key === key);
    if (i !== -1) {
      const [hit] = cache.splice(i, 1);
      cache.unshift(hit);
      return hit.plan;
    }
    const plan = stretchTemplate(template, keys, d);
    cache.unshift({ key, plan });
    cache.length = Math.min(cache.length, 2);
    return plan;
  };
  return { template, keys, stretch };
}

const DATA: Record<string, TemplateData> = {
  "proscenium@1": { template: PROSCENIUM_TEMPLATE, keys: PROSCENIUM_KEYS, stretch: stretchProscenium },
  "church-traditional@1": memo(churchTraditionalRaw as unknown as VenueTemplate, CHURCH_TRADITIONAL_KEYS),
  "church-contemporary@1": memo(churchContemporaryRaw as unknown as VenueTemplate, CHURCH_CONTEMPORARY_KEYS),
  "gym-stage@1": memo(gymStageRaw as unknown as VenueTemplate, GYM_STAGE_KEYS),
  "blackbox@1": memo(blackboxRaw as unknown as VenueTemplate, BLACKBOX_KEYS),
};

export const TEMPLATE_IDS = Object.keys(DATA);

export function templateData(id: string): TemplateData {
  const d = DATA[id];
  if (!d) throw new Error(`unknown venue template "${id}"`);
  return d;
}

export const keysById = (id: string): TemplateKeys => templateData(id).keys;
export const stretchById = (id: string, d: StretchDims): StretchedPlan => templateData(id).stretch(d);
