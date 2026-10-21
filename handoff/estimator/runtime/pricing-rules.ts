/**
 * Estimator handoff — the Estimating Rules store (src/lib/stores/pricing.ts) over the HandoffStore's `blobs`
 * collection: a rate's current value and effective default, set / reset one rate, reset every rate, and the CSV / JSON
 * exports. The registry itself (GROUPS) and the engine-rate defaults are the app's own, baked at build time
 * (baked/pricing-registry.ts); what is ported here is the storage logic, line for line:
 *
 *   - a `general` rate lives in blob `pricing_rules` under its id (null = no override → its default; a labor % row's
 *     default is the stored, retired install % — #232);
 *   - an engine rate (flame / repair / inspection / travel / catalog / fixture) lives in that engine's own blob under
 *     its key, as a fraction when `pctStored` (shown as a percent, rounded to 0.1);
 *   - setValue clamps to the rate's min / max; resetAll nulls every general rate and writes every engine blob back to
 *     its defaults.
 *
 * setBlob's jsonb merge (`data || patch`, right side wins per top-level key) becomes a read-merge-write serialized per
 * blob id in this window (`setBlobLocal`). Readers elsewhere (ports.ts blobData, readers.ts) see a write once
 * refreshPortsFromStore re-reads the store — every action here does that before returning. Plan: PR 2 Task 10.
 */
import type { PricingEntry, RateEntry } from "@/lib/stores/pricing";
import { FIXTURE_RATE_DEFAULTS } from "@/lib/fixture-rates";
import { LABOR_SYSTEMS, laborPctDefault, laborRateId } from "@/lib/design/wire-labor";
import {
  CATALOG_RATE_DEFAULTS,
  CATALOG_RATES_BLOB,
  FIXTURE_RATES_BLOB,
  FLAMETEST_RATE_DEFAULTS,
  FLAMETEST_RATES_BLOB,
  GROUPS,
  INSPECTION_RATE_DEFAULTS,
  INSPECTION_RATES_BLOB,
  REPAIR_RATE_DEFAULTS,
  REPAIR_RATES_BLOB,
  TRAVEL_RATE_DEFAULTS,
  TRAVEL_RATES_BLOB,
} from "./baked/pricing-registry";
import type { HandoffStore } from "./store";

export { GROUPS };

/** pricing.ts PRICING_RULES_BLOB — the general editable rates (not exported by the original). */
export const PRICING_RULES_BLOB = "pricing_rules";

/* ------------------------------------------------------------------ blobs over the store */

type BlobDoc = { id: string; data?: unknown };
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** doc-store getBlob: the stored data over `defaults` (a top-level spread). */
export async function getBlobLocal<T extends Record<string, unknown>>(store: HandoffStore, id: string, defaults: T): Promise<T> {
  return { ...defaults, ...asRecord((await store.get<BlobDoc>("blobs", id))?.data) } as T;
}

const blobQueues = new Map<string, Promise<unknown>>();

/** doc-store setBlob: `patch` merged over the stored data per top-level key (right side wins), one write at a time per blob. */
export function setBlobLocal(store: HandoffStore, id: string, patch: Record<string, unknown>): Promise<void> {
  const prev = blobQueues.get(id) ?? Promise.resolve();
  const run = prev.then(async () => {
    const prior = asRecord((await store.get<BlobDoc>("blobs", id))?.data);
    await store.put("blobs", { id, data: { ...prior, ...patch } });
  });
  const tail = run.catch(() => undefined);
  blobQueues.set(id, tail);
  void tail.then(() => {
    if (blobQueues.get(id) === tail) blobQueues.delete(id);
  });
  return run;
}

/* ------------------------------------------------------------------ the registry index */

const LABOR_PCT_IDS: ReadonlySet<string> = new Set(LABOR_SYSTEMS.map((sys) => laborRateId(sys, "pct")));

const BY_ID: Record<string, PricingEntry> = {};
for (const g of GROUPS) for (const it of g.items) BY_ID[it.id] = it;

/** actions.ts findRate: the registry entry for `id` (a formula too), or null. */
export function findRate(id: string): PricingEntry | null {
  return Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null;
}

type EngineStore = Exclude<RateEntry["store"], "general">;

const ENGINE_BLOBS: Record<EngineStore, [string, Record<string, number>]> = {
  flame: [FLAMETEST_RATES_BLOB, FLAMETEST_RATE_DEFAULTS as unknown as Record<string, number>],
  repair: [REPAIR_RATES_BLOB, REPAIR_RATE_DEFAULTS as unknown as Record<string, number>],
  inspection: [INSPECTION_RATES_BLOB, INSPECTION_RATE_DEFAULTS as unknown as Record<string, number>],
  travel: [TRAVEL_RATES_BLOB, TRAVEL_RATE_DEFAULTS as unknown as Record<string, number>],
  catalog: [CATALOG_RATES_BLOB, CATALOG_RATE_DEFAULTS as unknown as Record<string, number>],
  fixture: [FIXTURE_RATES_BLOB, FIXTURE_RATE_DEFAULTS as unknown as Record<string, number>],
};

const resolve = (item: PricingEntry | string): PricingEntry | undefined => (typeof item === "string" ? (findRate(item) ?? undefined) : item);
const general = (store: HandoffStore) => getBlobLocal<Record<string, number | null>>(store, PRICING_RULES_BLOB, {});

/** A general rate's EFFECTIVE default: a labor % follows the stored install % (#232); every other rate is its registry def. */
function generalDefault(it: RateEntry, g: Record<string, number | null>): number {
  return LABOR_PCT_IDS.has(it.id) ? laborPctDefault((id) => g[id]) : it.def;
}

/** pricing.ts value(): the rate's current value in display units (null for a formula or an unknown id). */
export async function value(store: HandoffStore, item: PricingEntry | string): Promise<number | null> {
  const it = resolve(item);
  if (!it || it.kind !== "rate") return null;
  if (it.store !== "general") {
    const [blob, defaults] = ENGINE_BLOBS[it.store];
    const r = await getBlobLocal(store, blob, { ...defaults });
    let v: number | undefined = r[it.key || it.id];
    if (v == null) v = it.pctStored ? it.def / 100 : it.def;
    return it.pctStored ? Math.round(v * 1000) / 10 : v;
  }
  const g = await general(store);
  const gv = g[it.id];
  if (gv != null) return gv;
  return generalDefault(it, g);
}

/** pricing.ts defaultOf(): what the row shows as its default and resets to. */
export async function defaultOf(store: HandoffStore, item: PricingEntry | string): Promise<number | null> {
  const it = resolve(item);
  if (!it || it.kind !== "rate") return null;
  if (it.store !== "general" || !LABOR_PCT_IDS.has(it.id)) return it.def;
  return generalDefault(it, await general(store));
}

/** pricing.ts setValue(): clamped to [min, max]; an engine rate into its blob (a fraction when pctStored). */
export async function setValue(store: HandoffStore, item: PricingEntry | string, val: number | string): Promise<void> {
  const it = resolve(item);
  if (!it || it.kind !== "rate") return;
  let v = typeof val === "number" ? val : parseFloat(val);
  if (isNaN(v)) return;
  v = Math.max(it.min, Math.min(it.max, v));
  if (it.store !== "general") {
    await setBlobLocal(store, ENGINE_BLOBS[it.store][0], { [it.key || it.id]: it.pctStored ? v / 100 : v });
    return;
  }
  await setBlobLocal(store, PRICING_RULES_BLOB, { [it.id]: v });
}

/** pricing.ts resetValue(): a labor % is cleared to null (it follows the install % again); any other rate → its def. */
export async function resetValue(store: HandoffStore, item: PricingEntry | string): Promise<void> {
  const it = resolve(item);
  if (!it || it.kind !== "rate") return;
  if (it.store === "general" && LABOR_PCT_IDS.has(it.id)) {
    await setBlobLocal(store, PRICING_RULES_BLOB, { [it.id]: null });
    return;
  }
  await setValue(store, it, it.def);
}

/** pricing.ts resetAll(): every general rate nulled; every engine blob written back to its defaults. */
export async function resetAll(store: HandoffStore): Promise<void> {
  const clear: Record<string, null> = {};
  for (const g of GROUPS) for (const it of g.items) if (it.kind === "rate" && it.store === "general") clear[it.id] = null;
  await setBlobLocal(store, PRICING_RULES_BLOB, clear);
  for (const [blob, defaults] of Object.values(ENGINE_BLOBS)) await setBlobLocal(store, blob, { ...defaults });
}

/* ------------------------------------------------------------------ export */

function csvCell(s: unknown): string {
  const str = s == null ? "" : String(s);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

/** pricing.ts exportCSV(). */
export async function exportCSV(store: HandoffStore): Promise<string> {
  const lines = ["Area,Item,Type,Value,Unit,Detail"];
  for (const g of GROUPS) {
    for (const it of g.items) {
      if (it.kind === "rate") lines.push([g.label, it.label, "Rate", await value(store, it), it.unit, it.help].map(csvCell).join(","));
      else lines.push([g.label, it.label, "Formula", "", "", it.expr].map(csvCell).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

/** pricing.ts exportJSON(). */
export async function exportJSON(store: HandoffStore, now: Date = new Date()): Promise<string> {
  const out: { exportedAt: string; version: number; rates: Record<string, number | null> } = { exportedAt: now.toISOString(), version: 1, rates: {} };
  for (const g of GROUPS) for (const it of g.items) if (it.kind === "rate") out.rates[it.id] = await value(store, it);
  return JSON.stringify(out, null, 2);
}

/**
 * pricing.ts exportFileName(): Peak_estimating_rules_YYYYMMDD.<ext>. The app's server stamps its own local date; the
 * prototype runs in whatever time zone the viewer's browser is in, so it stamps the business's day — America/Chicago,
 * the zone every Peak date prints in — not the browser's.
 */
export function exportFileName(ext: "csv" | "json", d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const part = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `Peak_estimating_rules_${part("year")}${part("month")}${part("day")}.${ext}`;
}
