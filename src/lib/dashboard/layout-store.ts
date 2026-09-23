/**
 * #43 — per-user dashboard layouts. One blobs row per user
 * (`dashboard_layouts:<userId>`), one key per surface. `null` for a surface
 * means "never customized" → the role preset. Same shape as the notifPrefs
 * row (per-user, sparse JSON) but keyed by user id and stored through the
 * settings-style getBlob/setBlob so no table or migration is needed.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { normalizeLayout, type Surface, type WidgetId } from "./registry";

type Stored = { home: string[] | null; reports: string[] | null };
const EMPTY: Stored = { home: null, reports: null };
const blobId = (userId: string) => `dashboard_layouts:${userId}`;

async function storedLayout(userId: string, surface: Surface): Promise<string[] | null> {
  const row = await getBlob<Stored>(blobId(userId), EMPTY);
  const v = row[surface];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

export async function layoutFor(
  userId: string,
  surface: Surface,
  roles: string[]
): Promise<{ ids: WidgetId[]; customized: boolean }> {
  const stored = await storedLayout(userId, surface);
  return { ids: normalizeLayout(stored, surface, roles), customized: stored !== null };
}

/** Normalizes before writing so a stale client list can't persist junk. */
export async function saveLayout(
  userId: string,
  surface: Surface,
  ids: string[],
  roles: string[]
): Promise<WidgetId[]> {
  const next = normalizeLayout(ids, surface, roles);
  await setBlob(blobId(userId), { [surface]: next });
  return next;
}

export async function resetLayout(userId: string, surface: Surface): Promise<void> {
  await setBlob(blobId(userId), { [surface]: null });
}
