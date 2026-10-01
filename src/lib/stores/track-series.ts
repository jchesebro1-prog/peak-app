import { getBlob, setBlob } from "@/db/doc-store";
import { getMany } from "@/lib/stores/catalog";
import {
  TRACK_SERIES_BLOB,
  activationProblems,
  allocateTrackSeriesId,
  sanitizeTrackSeries,
  sanitizeTrackSeriesBlob,
  seriesSkus,
  type TrackSeries,
} from "@/lib/track-series";

/**
 * Track series store (#274 §1): one settings blob `track_series`, one
 * top-level key per series id, written per key through setBlob's atomic
 * jsonb merge — same idiom as the Grid Equipment map
 * (src/lib/stores/equipment-map.ts). A delete writes `{ [id]: null }`, so the
 * key stays behind and its id is never handed to a new series (a saved track
 * line pointing at a deleted series must never open a different one). Starts
 * EMPTY; nothing here writes on its own. Survives the go-live reset
 * (clearDemoData never touches blobs), like every other rate blob.
 */

async function rawBlob(): Promise<Record<string, unknown>> {
  return getBlob<Record<string, unknown>>(TRACK_SERIES_BLOB, {});
}

export async function listTrackSeries(): Promise<TrackSeries[]> {
  return sanitizeTrackSeriesBlob(await rawBlob());
}

export async function getTrackSeries(id: string): Promise<TrackSeries | null> {
  return (await listTrackSeries()).find((s) => s.id === id) ?? null;
}

/** The subset of `skus` that exist (not deleted) in the live catalog — one getMany. */
export async function liveSkusOf(skus: readonly string[]): Promise<Set<string>> {
  const want = [...new Set(skus.filter(Boolean))];
  if (!want.length) return new Set();
  return new Set((await getMany(want)).map((p) => p.sku));
}

export type SaveTrackSeriesResult = { ok: true; series: TrackSeries } | { ok: false; error: string };

/**
 * Create (no id) or update (existing id) one series. Re-sanitizes the input;
 * refuses a blank or duplicate name, an id that no longer exists, and Active
 * while the activation check fails — with a mapped SKU that has since left
 * the catalog counting as unmapped.
 */
export async function saveTrackSeries(input: unknown, by: string, now = Date.now()): Promise<SaveTrackSeriesResult> {
  const clean = sanitizeTrackSeries(input);
  if (!clean) return { ok: false, error: "Nothing to save." };
  if (!clean.name) return { ok: false, error: "Give the series a name." };
  const requestedActive = !!input && typeof input === "object" && (input as Record<string, unknown>).active === true;

  const raw = await rawBlob();
  const existing = sanitizeTrackSeriesBlob(raw);
  const suppliedId = input && typeof input === "object" ? (input as Record<string, unknown>).id : undefined;
  if (suppliedId !== undefined && suppliedId !== "" && suppliedId !== null) {
    if (!clean.id || !existing.some((s) => s.id === clean.id)) return { ok: false, error: "This series no longer exists — reload the page." };
  }
  const lower = clean.name.toLowerCase();
  if (existing.some((s) => s.id !== clean.id && s.name.toLowerCase() === lower)) return { ok: false, error: `There is already a series called "${clean.name}".` };

  if (requestedActive) {
    const live = await liveSkusOf(seriesSkus(clean));
    const problems = activationProblems(clean, live);
    if (problems.length) return { ok: false, error: `Can't mark it active yet: ${problems.join(" ")}` };
  }

  const id = clean.id || allocateTrackSeriesId(clean.name, new Set(Object.keys(raw)));
  const series: TrackSeries = { ...clean, id, active: requestedActive, updatedBy: by, updatedAt: now };
  await setBlob(TRACK_SERIES_BLOB, { [id]: series });
  return { ok: true, series };
}

export async function deleteTrackSeries(id: string): Promise<boolean> {
  const raw = await rawBlob();
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(raw, id) || raw[id] == null) return false;
  await setBlob(TRACK_SERIES_BLOB, { [id]: null });
  return true;
}
