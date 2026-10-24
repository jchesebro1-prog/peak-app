/**
 * Estimator handoff — browser implementations of the Estimating Rules server actions, over the HandoffStore's `blobs`
 * and `settings` collections (the stores they call are ported here or in ../pricing-rules.ts). Each is typed
 * `Impl<typeof Original, K>` — the original's own signature — and mirrors its validation, writes and result:
 *
 *   src/app/(app)/estimating-rules/actions.ts
 *     setValueAction / resetItemAction / resetAllAction   pricing.ts setValue / resetValue / resetAll (pricing-rules.ts)
 *     exportCsvAction / exportJsonAction                  pricing.ts exportCSV / exportJSON + exportFileName
 *     saveVenueDoctrineAction                             settings.ts setVenueDoctrineEntry over the settings row
 *   …/track-series/actions.ts      saveTrackSeriesAction / deleteTrackSeriesAction   stores/track-series.ts
 *   …/curtain-mounts/actions.ts    saveCurtainMountAction                            stores/curtain-mounts.ts
 *   …/system-categories/actions.ts saveSystemCategoriesAction                        stores/system-categories.ts
 *                                  searchCategoryPartsAction                         the Estimator's searchCatalog, 20 hits
 *   src/app/(app)/design/grid/settings/actions.ts
 *     searchEquipmentPartsAction   IMPLEMENTED (searchCatalog, 20 hits): it is the default search of the shared
 *                                  PartPicker, which Track series and Curtain mounts use — so the rules editors'
 *                                  part pickers work. Its result type has no refusal member: a refusal would crash
 *                                  the picker (`r.hits.length`).
 *     every other export           the Grid's own settings — no bundled component calls them (the PartPicker
 *                                  imports this module for its search only): refusals where the type admits one,
 *                                  the original's own empty answer otherwise (see GRID_SETTINGS_* below).
 *   …/conduit-sizes/actions.ts     a Grid concern — the Conduit sizes card shows "Not part of the prototype" and its
 *                                  client is never bundled; registered anyway (save refused, search empty).
 *
 * Permission: every original starts with requirePerm("manage_users") (Admin). Here: where the original's result admits
 * a refusal, that refusal; otherwise a thrown error, as requirePerm throws. The pages never mount an editor for a
 * non-admin, so neither is reachable from the UI. revalidatePath → refreshPortsFromStore + the router's refresh() (the
 * rules screens and the Estimator re-read their props from the store). Plan: PR 2 Task 10.
 */
import type * as RulesOriginal from "@/app/(app)/estimating-rules/actions";
import type * as TrackSeriesOriginal from "@/app/(app)/estimating-rules/track-series/actions";
import type * as CurtainMountsOriginal from "@/app/(app)/estimating-rules/curtain-mounts/actions";
import type * as SystemCategoriesOriginal from "@/app/(app)/estimating-rules/system-categories/actions";
import type * as ConduitSizesOriginal from "@/app/(app)/estimating-rules/conduit-sizes/actions";
import type * as GridSettingsOriginal from "@/app/(app)/design/grid/settings/actions";
import type { VenueDoctrineEntry, VenueDoctrinePatch } from "@/lib/venue-doctrine";
import { resolveVenueDoctrine } from "@/lib/venue-doctrine";
import { activationProblems, allocateTrackSeriesId, sanitizeTrackSeries, sanitizeTrackSeriesBlob, seriesSkus, TRACK_SERIES_BLOB, type TrackSeries } from "@/lib/track-series";
import { CURTAIN_MOUNTS_BLOB, validateMountRows, type CurtainMountHardware } from "@/lib/curtain-mounts";
import { isMountTypeId } from "@/lib/curtain-cut-sheets/vocab";
import { sanitizeSystemCategories, SYSTEM_CATEGORIES_BLOB, type SystemCategory } from "@/lib/system-categories";
import { NOT_IN_PROTOTYPE, type ActionImpl } from "../actions-registry";
import { refresh } from "../router";
import type { HandoffStore } from "../store";
import { clock, refreshPortsFromStore, users } from "../ports";
import { getManyLocal } from "../readers";
import { VENUE_CLASSES } from "../baked/venue-classes";
import { exportCSV, exportFileName, exportJSON, findRate, getBlobLocal, resetAll, resetValue, setBlobLocal, setValue } from "../pricing-rules";
import { canManageRules } from "../props/rules";
import { estimatorActions } from "./estimator-actions";
import { refusals } from "./misc-refusals";
import type { Impl } from "./util";

export const RULES_ACTIONS_KEY = "src/app/(app)/estimating-rules/actions.ts";
export const TRACK_SERIES_ACTIONS_KEY = "src/app/(app)/estimating-rules/track-series/actions.ts";
export const CURTAIN_MOUNTS_ACTIONS_KEY = "src/app/(app)/estimating-rules/curtain-mounts/actions.ts";
export const SYSTEM_CATEGORIES_ACTIONS_KEY = "src/app/(app)/estimating-rules/system-categories/actions.ts";
export const CONDUIT_SIZES_ACTIONS_KEY = "src/app/(app)/estimating-rules/conduit-sizes/actions.ts";
export const GRID_SETTINGS_ACTIONS_KEY = "src/app/(app)/design/grid/settings/actions.ts";

type R = typeof RulesOriginal;
type T = typeof TrackSeriesOriginal;
type C = typeof CurtainMountsOriginal;
type S = typeof SystemCategoriesOriginal;
type D = typeof ConduitSizesOriginal;
type G = typeof GridSettingsOriginal;

/** The refusal a rules action gives a non-admin where its type admits one (the original: requirePerm throws). */
export const NO_PERMISSION = "You don't have permission to do that.";
const denied = (): never => {
  throw new Error(NO_PERMISSION);
};

/* ------------------------------------------------------------------ the stores, over the HandoffStore */

/** stores/track-series saveTrackSeries: re-sanitized; a blank / duplicate name, a vanished id, or Active while the activation check fails (a SKU no longer in the catalog counts as unmapped) is refused. */
export async function saveTrackSeriesLocal(store: HandoffStore, input: unknown, by: string, now = clock.now()): Promise<{ ok: true; series: TrackSeries } | { ok: false; error: string }> {
  const clean = sanitizeTrackSeries(input);
  if (!clean) return { ok: false, error: "Nothing to save." };
  if (!clean.name) return { ok: false, error: "Give the series a name." };
  const requestedActive = !!input && typeof input === "object" && (input as Record<string, unknown>).active === true;

  const raw = await getBlobLocal<Record<string, unknown>>(store, TRACK_SERIES_BLOB, {});
  const existing = sanitizeTrackSeriesBlob(raw);
  const suppliedId = input && typeof input === "object" ? (input as Record<string, unknown>).id : undefined;
  if (suppliedId !== undefined && suppliedId !== "" && suppliedId !== null) {
    if (!clean.id || !existing.some((s) => s.id === clean.id)) return { ok: false, error: "This series no longer exists — reload the page." };
  }
  const lower = clean.name.toLowerCase();
  if (existing.some((s) => s.id !== clean.id && s.name.toLowerCase() === lower)) return { ok: false, error: `There is already a series called "${clean.name}".` };

  if (requestedActive) {
    const want = [...new Set(seriesSkus(clean).filter(Boolean))];
    const live = new Set(want.length ? (await getManyLocal(store, want)).map((p) => p.sku) : []);
    const problems = activationProblems(clean, live);
    if (problems.length) return { ok: false, error: `Can't mark it active yet: ${problems.join(" ")}` };
  }

  const id = clean.id || allocateTrackSeriesId(clean.name, new Set(Object.keys(raw)));
  const series: TrackSeries = { ...clean, id, active: requestedActive, updatedBy: by, updatedAt: now };
  await setBlobLocal(store, TRACK_SERIES_BLOB, { [id]: series });
  return { ok: true, series };
}

/** stores/track-series deleteTrackSeries: `{ [id]: null }` — the key stays, so the id is never handed out again. */
export async function deleteTrackSeriesLocal(store: HandoffStore, id: string): Promise<boolean> {
  const raw = await getBlobLocal<Record<string, unknown>>(store, TRACK_SERIES_BLOB, {});
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(raw, id) || raw[id] == null) return false;
  await setBlobLocal(store, TRACK_SERIES_BLOB, { [id]: null });
  return true;
}

/** stores/curtain-mounts saveCurtainMount: an unknown mount, a row that would be dropped, or a SKU missing from the catalog refuses (writing nothing). */
export async function saveCurtainMountLocal(store: HandoffStore, mountTypeId: unknown, rows: unknown, by: string, now = clock.now()): Promise<{ ok: true; hardware: CurtainMountHardware } | { ok: false; error: string }> {
  if (!isMountTypeId(mountTypeId)) return { ok: false, error: "Unknown mount type." };
  const checked = validateMountRows(rows);
  if (!checked.ok) return checked;
  const clean = checked.rows;
  const skus = [...new Set(clean.map((r) => r.sku))];
  const live = new Set(skus.length ? (await getManyLocal(store, skus)).map((p) => p.sku) : []);
  const missing = skus.filter((s) => !live.has(s));
  if (missing.length) return { ok: false, error: `Not in the catalog: ${missing.join(", ")}.` };
  const hardware: CurtainMountHardware = { rows: clean, updatedBy: by, updatedAt: now };
  await setBlobLocal(store, CURTAIN_MOUNTS_BLOB, { [mountTypeId]: hardware });
  return { ok: true, hardware };
}

/** stores/system-categories saveSystemCategories: sanitized, stored under `categories`, returned. */
export async function saveSystemCategoriesLocal(store: HandoffStore, next: unknown): Promise<SystemCategory[]> {
  const clean = sanitizeSystemCategories(next);
  await setBlobLocal(store, SYSTEM_CATEGORIES_BLOB, { categories: clean });
  return clean;
}

type SettingsRow = { id: string; data?: Record<string, unknown> };
let settingsQueue: Promise<unknown> = Promise.resolve();

/** settings.ts setVenueDoctrineEntry: one class's entry over the resolved doctrine, written to the settings row (one write at a time). */
export function setVenueDoctrineEntryLocal(store: HandoffStore, venueClass: string, entry: VenueDoctrineEntry): Promise<void> {
  const run = settingsQueue.then(async () => {
    const row = (await store.get<SettingsRow>("settings", "main")) ?? { id: "main", data: {} };
    const data = row.data ?? {};
    const venueDoctrine = resolveVenueDoctrine(data.venueDoctrine as VenueDoctrinePatch | null | undefined) as Record<string, VenueDoctrineEntry>;
    venueDoctrine[venueClass] = { ...entry };
    await store.put("settings", { ...row, id: "main", data: { ...data, venueDoctrine } });
  });
  settingsQueue = run.catch(() => undefined);
  return run;
}

/* ------------------------------------------------------------------ the actions */

export function rulesActions(store: HandoffStore): Record<string, Record<string, ActionImpl>> {
  const { searchCatalog } = estimatorActions(store);
  /** revalidatePath: the ports re-read the store, then every mounted screen re-reads its props. */
  const revalidate = async () => {
    await refreshPortsFromStore(store);
    refresh();
  };
  /** The admin search the PartPicker calls: 20 hits, reshaped to EquipPartHit (cost shown — admin page). */
  const adminSearch = async (query: string, perLengthOnly = false) => {
    if (!canManageRules()) denied();
    const { hits, total } = await searchCatalog(String(query ?? ""), "", 20, perLengthOnly);
    return { hits: hits.map((h) => ({ sku: h.sku, desc: h.desc, category: h.category, unit: h.unit, cost: h.cost, list: h.list })), total };
  };

  // --- estimating-rules/actions.ts ---
  const setValueAction: Impl<R, "setValueAction"> = async (id, val) => {
    if (!canManageRules()) return { ok: false as const };
    if (typeof val !== "number" || !Number.isFinite(val)) return { ok: false as const };
    await setValue(store, id, val);
    await revalidate();
    return { ok: true as const };
  };
  const resetItemAction: Impl<R, "resetItemAction"> = async (id) => {
    if (!canManageRules()) return { ok: false as const };
    const it = findRate(String(id ?? ""));
    if (!it || it.kind !== "rate") return { ok: false as const };
    await resetValue(store, it);
    await revalidate();
    return { ok: true as const };
  };
  const resetAllAction: Impl<R, "resetAllAction"> = async () => {
    if (!canManageRules()) denied();
    await resetAll(store);
    await revalidate();
    return { ok: true as const };
  };
  const exportCsvAction: Impl<R, "exportCsvAction"> = async () => {
    if (!canManageRules()) denied();
    return { csv: await exportCSV(store), name: exportFileName("csv") };
  };
  const exportJsonAction: Impl<R, "exportJsonAction"> = async () => {
    if (!canManageRules()) denied();
    return { json: await exportJSON(store), name: exportFileName("json") };
  };
  const saveVenueDoctrineAction: Impl<R, "saveVenueDoctrineAction"> = async (venueClass, entry) => {
    if (!canManageRules()) return { ok: false as const };
    if (!VENUE_CLASSES.some((item) => item.key === venueClass)) return { ok: false as const };
    if (typeof entry?.curtains !== "string" || typeof entry?.lighting !== "string" || typeof entry?.confirmed !== "boolean") return { ok: false as const };
    await setVenueDoctrineEntryLocal(store, venueClass, { curtains: entry.curtains.trim().slice(0, 500), lighting: entry.lighting.trim().slice(0, 500), confirmed: entry.confirmed });
    await revalidate();
    return { ok: true as const };
  };

  // --- track-series/actions.ts ---
  const saveTrackSeriesAction: Impl<T, "saveTrackSeriesAction"> = async (input) => {
    if (!canManageRules()) return { ok: false, error: NO_PERMISSION };
    const r = await saveTrackSeriesLocal(store, input, users.current().name);
    if (!r.ok) return r;
    await revalidate();
    return { ok: true, id: r.series.id };
  };
  const deleteTrackSeriesAction: Impl<T, "deleteTrackSeriesAction"> = async (id) => {
    if (!canManageRules()) return { ok: false, error: NO_PERMISSION };
    if (!(await deleteTrackSeriesLocal(store, String(id ?? "")))) return { ok: false, error: "This series no longer exists." };
    await revalidate();
    return { ok: true };
  };

  // --- curtain-mounts/actions.ts ---
  const saveCurtainMountAction: Impl<C, "saveCurtainMountAction"> = async (mountTypeId, rows) => {
    if (!canManageRules()) return { ok: false, error: NO_PERMISSION };
    const r = await saveCurtainMountLocal(store, mountTypeId, rows, users.current().name);
    if (!r.ok) return r;
    await revalidate();
    return { ok: true };
  };

  // --- system-categories/actions.ts ---
  const saveSystemCategoriesAction: Impl<S, "saveSystemCategoriesAction"> = async (list) => {
    if (!canManageRules()) return { ok: false, error: NO_PERMISSION };
    try {
      const categories = await saveSystemCategoriesLocal(store, list);
      await revalidate();
      return { ok: true, categories };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not save the categories." };
    }
  };
  const searchCategoryPartsAction: Impl<S, "searchCategoryPartsAction"> = (query) => adminSearch(query);

  // --- design/grid/settings/actions.ts: the PartPicker's search; the rest is the Grid's ---
  const searchEquipmentPartsAction: Impl<G, "searchEquipmentPartsAction"> = (query) => adminSearch(query);
  // The Equipment map's per-row Suggest (a PartPicker `onSuggest`, which no rules editor passes): the original's own
  // answer for a row it doesn't know — no suggestions.
  const suggestEquipmentPartsAction: Impl<G, "suggestEquipmentPartsAction"> = async () => ({ hits: [] });
  const saveRiserBoxTypesAction: Impl<G, "saveRiserBoxTypesAction"> = async () => {
    warnOnce("saveRiserBoxTypesAction");
    return { ...NOT_IN_PROTOTYPE, errors: [] };
  };
  const saveDeviceTypeIconsAction: Impl<G, "saveDeviceTypeIconsAction"> = async () => {
    warnOnce("saveDeviceTypeIconsAction");
  };

  // --- conduit-sizes/actions.ts (never bundled: the card shows the notice) ---
  const searchConduitPartsAction: Impl<D, "searchConduitPartsAction"> = async () => ({ hits: [], total: 0 });

  return {
    [RULES_ACTIONS_KEY]: { setValueAction, resetItemAction, resetAllAction, exportCsvAction, exportJsonAction, saveVenueDoctrineAction },
    [TRACK_SERIES_ACTIONS_KEY]: { saveTrackSeriesAction, deleteTrackSeriesAction },
    [CURTAIN_MOUNTS_ACTIONS_KEY]: { saveCurtainMountAction },
    [SYSTEM_CATEGORIES_ACTIONS_KEY]: { saveSystemCategoriesAction, searchCategoryPartsAction },
    [GRID_SETTINGS_ACTIONS_KEY]: {
      ...refusals<G>(REFUSED_GRID_SETTINGS_ACTIONS),
      ...unreachableGridSettingsActions(),
      searchEquipmentPartsAction,
      suggestEquipmentPartsAction,
      saveRiserBoxTypesAction,
      saveDeviceTypeIconsAction,
    },
    [CONDUIT_SIZES_ACTIONS_KEY]: { ...refusals<D>(REFUSED_CONDUIT_SIZES_ACTIONS), searchConduitPartsAction },
  };
}

/** The Grid settings writers whose result admits a refusal (tsc-checked). */
export const REFUSED_GRID_SETTINGS_ACTIONS = [
  "setDeviceTypeSymbolAction", "loadWireStarterAction", "syncWireLibraryAction", "applyPortRuleAction", "saveDesignatorDigitsAction", "saveEquipmentRowAction", "clearEquipmentRowAction",
] as const;
/**
 * The Grid settings writers typed `{ ok: true }` only — no refusal member, and nothing in the bundle calls them (the
 * PartPicker imports the module for its search alone; the Grid settings page isn't in the prototype). They warn and
 * answer NOT_IN_PROTOTYPE rather than claim a save that never happened.
 */
export const UNREACHABLE_GRID_SETTINGS_ACTIONS = ["saveCategoryIconsAction", "saveSymbolColorsAction", "saveWireTypesAction", "saveStandardNotesAction"] as const satisfies readonly (keyof G)[];
export const REFUSED_CONDUIT_SIZES_ACTIONS = ["saveConduitSizesAction"] as const;

const warned = new Set<string>();
function warnOnce(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[handoff] ${name} is not in the prototype`);
}

function unreachableGridSettingsActions(): Record<(typeof UNREACHABLE_GRID_SETTINGS_ACTIONS)[number], ActionImpl> {
  return Object.fromEntries(
    UNREACHABLE_GRID_SETTINGS_ACTIONS.map((n) => [
      n,
      () => {
        warnOnce(n);
        return { ...NOT_IN_PROTOTYPE };
      },
    ]),
  ) as Record<(typeof UNREACHABLE_GRID_SETTINGS_ACTIONS)[number], ActionImpl>;
}
