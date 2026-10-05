import { getBlob, setBlob, setBlobKeysIfAbsent } from "@/db/doc-store";
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
  const res = cleanDeviceTypesInput(input, await getDeviceTypes());
  if (!res.ok) return res;
  await setBlob(DEVICE_TYPES_BLOB, { types: res.types });
  return res;
}

/** Grid Settings → Device type icons. Validation (isGridIconId) is the action's job. */
export async function setDeviceTypeIcons(icons: Record<string, string | null>): Promise<DeviceType[]> {
  const next = withTypeIcons(await getDeviceTypes(), icons);
  await setBlob(DEVICE_TYPES_BLOB, { types: next });
  return next;
}

/** Grid Settings → Device types drawing slot (#300). `docId` null clears.
 *  Refuses an unknown type key or a malformed document id; that the document
 *  exists and is a `symbol` is the action's job. */
export async function setDeviceTypeSymbol(
  typeKey: string,
  docId: string | null
): Promise<{ ok: true; types: DeviceType[] } | { ok: false; error: string }> {
  const types = await getDeviceTypes();
  if (!types.some((t) => t.key === typeKey)) return { ok: false, error: "That device type no longer exists." };
  if (docId !== null && !isDocumentId(docId)) return { ok: false, error: "Not a document id." };
  const next = withTypeSymbol(types, typeKey, docId);
  await setBlob(DEVICE_TYPES_BLOB, { types: next });
  return { ok: true, types: next };
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
  await setBlob(DEVICE_TYPES_BLOB, { types: types.map((t) => (t.key === fromKey ? { ...t, archived: true } : t)) });
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
  const res = toggleInList(await getGridFavorites(userId), partId, FAVORITES_CAP);
  if (!res.ok) return res;
  await setBlob(favoritesBlobId(userId), { ids: res.list });
  return { ok: true, favorites: res.list, on: res.on };
}

export async function getGridRecent(userId: string): Promise<string[]> {
  const row = await getBlob<Record<string, unknown>>(recentBlobId(userId), {});
  return cleanIdList(row.ids, RECENT_CAP);
}

export async function pushGridRecent(userId: string, partId: string): Promise<string[]> {
  const next = withRecent(await getGridRecent(userId), partId, RECENT_CAP);
  await setBlob(recentBlobId(userId), { ids: next });
  return next;
}
