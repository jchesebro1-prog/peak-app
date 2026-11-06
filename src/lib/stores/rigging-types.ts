import { getBlob, setBlob } from "@/db/doc-store";
import { getMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { allocateTrackSeriesId } from "@/lib/track-series";
import {
  LINESET_TYPES_BLOB, PIPE_TYPES_BLOB, linesetTypeProblems, linesetTypeSkus, pipeTypeProblems, pipeTypeSkus,
  sanitizeLinesetType, sanitizeLinesetTypeBlob, sanitizePipeType, sanitizePipeTypeBlob,
  type LinesetType, type PipeType,
} from "@/lib/rigging-config/types";

/**
 * Pipe and lineset types (#373): one settings blob each, one key per type id,
 * written per key through setBlob's jsonb merge, the Track series idiom. A
 * delete writes `{ [id]: null }`, so a saved line never opens a different type.
 * Starts empty; survives the go-live reset, like every rate blob.
 */

const rawBlob = (name: string) => getBlob<Record<string, unknown>>(name, {});

export const listPipeTypes = async (): Promise<PipeType[]> => sanitizePipeTypeBlob(await rawBlob(PIPE_TYPES_BLOB));
export const listLinesetTypes = async (): Promise<LinesetType[]> => sanitizeLinesetTypeBlob(await rawBlob(LINESET_TYPES_BLOB));

async function liveSkus(skus: readonly string[]): Promise<Set<string>> {
  const want = [...new Set(skus.filter(Boolean))];
  return new Set(want.length ? (await getMany(want)).map((p) => p.sku) : []);
}

async function liveHardwareIds(): Promise<Set<string>> {
  return new Set((await listFixtures()).filter((f) => f.kind === "hardware").map((f) => f.id));
}

type Named = { id: string; name: string };
type Saved<T> = { ok: true; type: T } | { ok: false; error: string };

async function save<T extends Named & { active: boolean; updatedBy?: string; updatedAt?: number }>(
  blob: string,
  input: unknown,
  by: string,
  now: number,
  clean: (v: unknown) => T | null,
  list: (raw: unknown) => T[],
  problems: (t: T) => Promise<string[]>,
): Promise<Saved<T>> {
  const t = clean(input);
  if (!t) return { ok: false, error: "Nothing to save." };
  if (!t.name) return { ok: false, error: "Give the type a name." };
  const rec = input as Record<string, unknown>;
  const requestedActive = rec.active === true;
  const raw = await rawBlob(blob);
  const existing = list(raw);
  if (rec.id !== undefined && rec.id !== "" && rec.id !== null && (!t.id || !existing.some((e) => e.id === t.id))) {
    return { ok: false, error: "This type no longer exists — reload the page." };
  }
  const lower = t.name.toLowerCase();
  if (existing.some((e) => e.id !== t.id && e.name.toLowerCase() === lower)) return { ok: false, error: `There is already a type called "${t.name}".` };
  if (requestedActive) {
    const found = await problems(t);
    if (found.length) return { ok: false, error: `Can't mark it active yet: ${found.join(" ")}` };
  }
  const id = t.id || allocateTrackSeriesId(t.name, new Set(Object.keys(raw)));
  const type: T = { ...t, id, active: requestedActive, updatedBy: by, updatedAt: now };
  await setBlob(blob, { [id]: type });
  return { ok: true, type };
}

async function remove(blob: string, id: string): Promise<boolean> {
  const raw = await rawBlob(blob);
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(raw, id) || raw[id] == null) return false;
  await setBlob(blob, { [id]: null });
  return true;
}

export const savePipeType = (input: unknown, by: string, now = Date.now()) =>
  save<PipeType>(PIPE_TYPES_BLOB, input, by, now, sanitizePipeType, sanitizePipeTypeBlob, async (t) => pipeTypeProblems(t, await liveSkus(pipeTypeSkus(t))));

export const saveLinesetType = (input: unknown, by: string, now = Date.now()) =>
  save<LinesetType>(LINESET_TYPES_BLOB, input, by, now, sanitizeLinesetType, sanitizeLinesetTypeBlob, async (t) =>
    linesetTypeProblems(t, { skus: await liveSkus(linesetTypeSkus(t)), assemblyIds: await liveHardwareIds() }),
  );

export const deletePipeType = (id: string) => remove(PIPE_TYPES_BLOB, id);
export const deleteLinesetType = (id: string) => remove(LINESET_TYPES_BLOB, id);
