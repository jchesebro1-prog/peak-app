import { getBlob, setBlob, setBlobKeysIfAbsent, updateBlob } from "@/db/doc-store";
import {
  DEVICE_TYPES_BLOB,
  FAVORITES_CAP,
  RECENT_CAP,
  TYPE_MAP_BLOB,
  acceptSuggestionEntries,
  assignEntries,
  autoTypeEntries,
  cleanDeviceTypesInput,
  cleanIdList,
  deviceTypesFrom,
  favoritesBlobId,
  mergeTypeEntries,
  planPartTypeEdit,
  recentBlobId,
  sanitizeTypeMap,
  toggleInList,
  typeReviewRows,
  withRecent,
  withTypeIcons,
  withTypeSymbol,
  type DeviceType,
  type DeviceTypeContext,
  type TypeMap,
} from "@/lib/design/device-types";
import { isDocumentId } from "@/lib/part-docs/types";
import { getManyBySku, partsWithOwnDeviceType, setPartDeviceTypeKeys } from "@/lib/stores/catalog";

/**
 * Grid device types store (#226). Four doc-store blobs, no table and no
 * migration (the dashboard_layouts:<userId> / grid_equipment_map idiom):
 *   gridDeviceTypes        { types: DeviceType[] }   full replacement
 *   gridTypeMap            one top-level key per normalized raw category
 *   gridFavorites:<userId> { ids: string[] }         cap 300
 *   gridRecent:<userId>    { ids: string[] }         last 40 distinct
 * Survives the go-live reset (clearDemoData never touches blobs).
 */

export async function getDeviceTypes(): Promise<DeviceType[]> {
  const row = await getBlob<Record<string, unknown>>(DEVICE_TYPES_BLOB, {});
  return deviceTypesFrom(row.types);
}

export async function saveDeviceTypes(input: unknown): Promise<{ ok: true; types: DeviceType[] } | { ok: false; error: string }> {
  // #343: merged with the STORED list under the row lock — the stored icon,
  // drawing and code it carries over (and the stored types it archives) are
  // the current ones, not a copy an icon or drawing save has since replaced.
  const out: { res?: ReturnType<typeof cleanDeviceTypesInput> } = {};
  await editDeviceTypes((types) => {
    const res = cleanDeviceTypesInput(input, types);
    out.res = res;
    return res.ok ? res.types : null;
  });
  return out.res!;
}

/** Grid Settings → Device type icons. Validation (isGridIconId) is the action's job. */
export async function setDeviceTypeIcons(icons: Record<string, string | null>): Promise<DeviceType[]> {
  // #343: applied to the stored list under the row lock (editDeviceTypes).
  let next: DeviceType[] = [];
  await editDeviceTypes((types) => (next = withTypeIcons(types, icons)));
  return next;
}

/** #343 — the `types` list edited under the blob's row lock: `edit` gets the
 *  stored list (seeded when absent, as getDeviceTypes reads it) and returns
 *  the new one, or null to write nothing. Pure, synchronous. */
async function editDeviceTypes(edit: (types: DeviceType[]) => DeviceType[] | null): Promise<void> {
  await updateBlob(DEVICE_TYPES_BLOB, (raw) => {
    const next = edit(deviceTypesFrom(raw.types));
    return next ? { types: next } : null;
  });
}

/** Grid Settings → Device types drawing slot (#300). `docId` null clears.
 *  Refuses an unknown type key or a malformed document id; that the document
 *  exists and is a `symbol` is the action's job. */
export async function setDeviceTypeSymbol(
  typeKey: string,
  docId: string | null
): Promise<{ ok: true; types: DeviceType[] } | { ok: false; error: string }> {
  // #343: checked and written against the stored list under the row lock
  // (same checks, same order, as before).
  let res: { ok: true; types: DeviceType[] } | { ok: false; error: string } = { ok: false, error: "That device type no longer exists." };
  await editDeviceTypes((types) => {
    if (!types.some((t) => t.key === typeKey)) {
      res = { ok: false, error: "That device type no longer exists." };
      return null;
    }
    if (docId !== null && !isDocumentId(docId)) {
      res = { ok: false, error: "Not a document id." };
      return null;
    }
    const next = withTypeSymbol(types, typeKey, docId);
    res = { ok: true, types: next };
    return next;
  });
  return res;
}

export async function getTypeMap(): Promise<TypeMap> {
  return sanitizeTypeMap(await getBlob<Record<string, unknown>>(TYPE_MAP_BLOB, {}));
}

/**
 * THE read every Grid surface uses (spec: auto-apply). Categories in
 * `parts` with no map entry and a HIGH suggestion are written as `auto`
 * entries through setBlobKeysIfAbsent — an admin entry always wins, even
 * against a racing write — and the map is re-read so the caller sees what
 * actually landed. A second read with nothing new writes nothing. On a
 * Vercel preview (which shares production's database) the matches apply in
 * memory only.
 */
export async function loadDeviceTypeContext(parts: ReadonlyArray<{ category: string }>, now = Date.now()): Promise<DeviceTypeContext> {
  const [types, stored] = await Promise.all([getDeviceTypes(), getTypeMap()]);
  const auto = autoTypeEntries(parts, stored, types, now);
  if (!Object.keys(auto).length) return { types, map: stored };
  if (process.env.VERCEL_ENV === "preview") return { types, map: { ...stored, ...auto } };
  await setBlobKeysIfAbsent(TYPE_MAP_BLOB, auto);
  return { types, map: await getTypeMap() };
}

/** Admin assignment (one row or a bulk selection). `null` = deliberately
 *  unmapped: auto-apply never touches that category again. */
export async function assignDeviceType(
  categories: string[],
  typeKey: string | null,
  now = Date.now()
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const types = await getDeviceTypes();
  if (typeKey !== null && !types.some((t) => t.key === typeKey && !t.archived)) return { ok: false, error: "Pick an active device type." };
  const patch = assignEntries(categories, typeKey, now);
  const count = Object.keys(patch).length;
  if (!count) return { ok: false, error: "Pick at least one category." };
  await setBlob(TYPE_MAP_BLOB, patch);
  return { ok: true, count };
}

/** Most distinct catalog parts one Type edit may touch (the Grid's multi-select). */
export const MAX_TYPE_EDIT_PARTS = 200;

/**
 * Grid notes #2 — an admin's Type edit from the Grid (or the part editor):
 * per part, store/clear each part's `deviceTypeKey`; whole category, clear
 * the override of EVERY part in the parts' raw categories (catalog-wide) and
 * then re-type those categories through the map (assignDeviceType). Clears
 * go first, batched (setPartDeviceTypeKeys), so a failure never leaves a
 * re-typed category whose parts still ignore it; a failure mid-way returns
 * "N of M saved — reload to see the current types" with `partial`. The
 * caller has checked manage_users. Every sku must be a live catalog part
 * (a renamed SKU follows to the part it became).
 */
export async function setPartsDeviceType(
  skus: readonly string[],
  typeKey: string | null,
  opts: { wholeCategory?: boolean; now?: number } = {}
): Promise<{ ok: true; parts: number; categories: number } | { ok: false; error: string; partial?: true }> {
  const wanted = [...new Set(skus.filter((s) => typeof s === "string" && s.trim()))];
  if (!wanted.length) return { ok: false, error: "Pick at least one catalog part." };
  if (wanted.length > MAX_TYPE_EDIT_PARTS) return { ok: false, error: `Change at most ${MAX_TYPE_EDIT_PARTS} different parts at once.` };
  const whole = opts.wholeCategory === true;
  const [types, bySku, mates] = await Promise.all([getDeviceTypes(), getManyBySku(wanted), whole ? partsWithOwnDeviceType() : Promise.resolve([])]);
  if (wanted.some((s) => !bySku.has(s))) return { ok: false, error: "A part is no longer in the catalog — reload and try again." };
  const parts = [...new Map([...bySku.values()].map((p) => [p.sku, p])).values()];
  const res = planPartTypeEdit(parts, typeKey, whole, types, mates.map((m) => ({ sku: m.sku || m.id, category: m.category || "", deviceTypeKey: m.deviceTypeKey })));
  if (!res.ok) return res;
  const steps = res.plan.overrides.length + (res.plan.categories.length ? 1 : 0);
  const partial = (done: number) => ({ ok: false as const, partial: true as const, error: `${done} of ${steps} saved — reload to see the current types.` });
  const w = await setPartDeviceTypeKeys(res.plan.overrides);
  if (w.failed) return partial(w.saved);
  let categories = 0;
  if (res.plan.categories.length) {
    let a: Awaited<ReturnType<typeof assignDeviceType>>;
    try {
      a = await assignDeviceType(res.plan.categories, typeKey, opts.now);
    } catch (e) {
      console.error("[device-types] category assign failed:", e);
      return w.saved ? partial(w.saved) : { ok: false, error: "That didn't save — check your connection and try again." };
    }
    if (!a.ok) return w.saved ? partial(w.saved) : a;
    categories = a.count;
  }
  return { ok: true, parts: w.saved, categories };
}

/** "Accept all suggestions" — low ones included — for categories that still
 *  have no entry. Fills gaps only (setBlobKeysIfAbsent), so an admin edit
 *  made meanwhile is never replaced. Returns how many it wrote. */
export async function acceptAllSuggestions(parts: ReadonlyArray<{ category: string; desc?: string }>, now = Date.now()): Promise<number> {
  const { types, map } = await loadDeviceTypeContext(parts, now);
  const patch = acceptSuggestionEntries(typeReviewRows(parts, map, types), types, now);
  const n = Object.keys(patch).length;
  if (n) await setBlobKeysIfAbsent(TYPE_MAP_BLOB, patch);
  return n;
}

/** Merge = reassign every category of `fromKey` to `toKey` (admin), then
 *  archive `fromKey`. */
export async function mergeDeviceType(
  fromKey: string,
  toKey: string,
  now = Date.now()
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const types = await getDeviceTypes();
  const from = types.find((t) => t.key === fromKey);
  const to = types.find((t) => t.key === toKey);
  if (!from || !to || from.key === to.key) return { ok: false, error: "Pick two different device types." };
  if (to.archived) return { ok: false, error: `"${to.label}" is archived — restore it first.` };
  const patch = mergeTypeEntries(await getTypeMap(), fromKey, toKey, now);
  const moved = Object.keys(patch).length;
  if (moved) await setBlob(TYPE_MAP_BLOB, patch);
  // #343: archive `fromKey` in the STORED list (row lock), not the copy read
  // above — a type added or edited meanwhile is kept.
  await editDeviceTypes((cur) => cur.map((t) => (t.key === fromKey ? { ...t, archived: true } : t)));
  return { ok: true, moved };
}

export async function getGridFavorites(userId: string): Promise<string[]> {
  const row = await getBlob<Record<string, unknown>>(favoritesBlobId(userId), {});
  return cleanIdList(row.ids, FAVORITES_CAP);
}

export async function toggleGridFavorite(
  userId: string,
  partId: string
): Promise<{ ok: true; favorites: string[]; on: boolean } | { ok: false; error: string }> {
  // #343: toggled in the stored list under the row lock (two stars clicked
  // in quick succession both stick).
  let res = toggleInList([], partId, FAVORITES_CAP);
  await updateBlob(favoritesBlobId(userId), (raw) => {
    res = toggleInList(cleanIdList(raw.ids, FAVORITES_CAP), partId, FAVORITES_CAP);
    return res.ok ? { ids: res.list } : null;
  });
  if (!res.ok) return res;
  return { ok: true, favorites: res.list, on: res.on };
}

export async function getGridRecent(userId: string): Promise<string[]> {
  const row = await getBlob<Record<string, unknown>>(recentBlobId(userId), {});
  return cleanIdList(row.ids, RECENT_CAP);
}

export async function pushGridRecent(userId: string, partId: string): Promise<string[]> {
  // #343: pushed onto the stored list under the row lock.
  let next: string[] = [];
  await updateBlob(recentBlobId(userId), (raw) => {
    next = withRecent(cleanIdList(raw.ids, RECENT_CAP), partId, RECENT_CAP);
    return { ids: next };
  });
  return next;
}
