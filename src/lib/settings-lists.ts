import { getSettingsStrict, settingsFrom, updateSettings } from "@/lib/settings";
import { mergeVenueTypes, venueTypesFrom, type VenueTypeInput, type VenueTypeMerge } from "@/lib/venue-types";
import {
  mergeDocumentCategories,
  resolveDocumentCategories,
  type DocumentCategory,
} from "@/lib/document-categories";
import { mergeSurveyTags, resolveSurveyTags, type SurveyTag } from "@/lib/survey-tags";

/**
 * #343 — the two Settings list editors whose save MERGES the posted list with
 * the stored one (stored keys kept, missing rows archived). The merge runs on
 * the stored list under the settings row lock (updateSettings), so an edit
 * landing between the editor's load and its save is merged, not reverted.
 * Validation and messages are the actions' own, unchanged.
 */

const VENUE_TYPE_ATTEMPTS = 3;

/**
 * Settings → Venue types. A type the posted list drops entirely ("removed")
 * may only go when no venue uses it — that count is an async read, so it is
 * made before the lock for the keys a pre-read merge removes; under the lock
 * the merge is re-run on the stored list, and if it would now remove a key
 * nobody counted, the save starts over (up to 3 times). `reserved` are keys
 * still on any site; `countUsed` counts venues per key.
 */
export async function saveVenueTypesLocked(
  input: readonly VenueTypeInput[],
  reserved: Iterable<string>,
  countUsed: (keys: string[]) => Promise<Record<string, number>>
): Promise<VenueTypeMerge> {
  const reservedList = [...reserved];
  const checked = new Set<string>();
  for (let attempt = 0; attempt < VENUE_TYPE_ATTEMPTS; attempt++) {
    const current = venueTypesFrom((await getSettingsStrict()).venueTypes);
    const pre = mergeVenueTypes(current, input, reservedList);
    if (!pre.ok) return pre;
    const toCheck = pre.removed.filter((k) => !checked.has(k));
    if (toCheck.length) {
      const used = await countUsed(toCheck);
      const busy = toCheck.find((k) => (used[k] || 0) > 0);
      if (busy) {
        const label = current.find((t) => t.key === busy)?.label ?? busy;
        const n = used[busy];
        return { ok: false, error: `"${label}" is used by ${n} venue${n === 1 ? "" : "s"} — archive it instead of removing it.` };
      }
      for (const k of toCheck) checked.add(k);
    }
    const out: { res?: VenueTypeMerge; retry?: boolean } = {};
    await updateSettings((cur) => {
      out.retry = false;
      const res = mergeVenueTypes(venueTypesFrom(settingsFrom(cur).venueTypes), input, reservedList);
      out.res = res;
      if (!res.ok) return null;
      if (res.removed.some((k) => !checked.has(k))) {
        out.retry = true;
        return null;
      }
      return { venueTypes: res.types };
    });
    if (!out.retry) return out.res!;
  }
  return { ok: false, error: "Venue types changed while saving — reload and try again." };
}

/** Settings → Admin → Document categories, merged on the stored list under
 *  the lock. updateSettings throws on a failed read, so a failed read can
 *  never pass for "no list saved yet" (the reason the action read strictly). */
export async function saveDocumentCategoriesLocked(
  input: unknown
): Promise<{ ok: true; categories: DocumentCategory[] } | { ok: false; error: string }> {
  const out: { res?: ReturnType<typeof mergeDocumentCategories> } = {};
  await updateSettings((cur) => {
    const res = mergeDocumentCategories(resolveDocumentCategories(settingsFrom(cur).documentCategories), input);
    out.res = res;
    return res.ok ? { documentCategories: res.categories } : null;
  });
  return out.res!;
}

/** #344 — Settings → Field → Final thoughts tags, merged on the stored list under the lock (a failed read throws). */
export async function saveSurveyTagsLocked(
  input: unknown
): Promise<{ ok: true; tags: SurveyTag[] } | { ok: false; error: string }> {
  const out: { res?: ReturnType<typeof mergeSurveyTags> } = {};
  await updateSettings((cur) => {
    const res = mergeSurveyTags(resolveSurveyTags(settingsFrom(cur).surveyInternalTags), input);
    out.res = res;
    return res.ok ? { surveyInternalTags: res.tags } : null;
  });
  return out.res!;
}
