/**
 * The Grid Auto intake's persisted choices (#GEM, spec §5) — pure.
 * `tierByScope` = the Good/Better/Best pick per Grid scope; `overrides` = per
 * equation row (`system:itemKey`) swaps (a catalog SKU or an assembly id) and
 * qty edits. Stored on the project as `autoEstimate` so "Change equipment…"
 * re-opens with the last choices. Only the five Grid scopes are Auto scopes.
 */
import type { SysKey, TierKey } from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { TRACKABLE_SYS_KEYS } from "./grid-scopes";

export type AutoTag = { scope: SysKey; rowKey: string; tier: TierKey };
export type AutoOverride = { sku?: string; assemblyId?: string; qty?: number };
export type AutoEstimate = { tierByScope: Partial<Record<SysKey, TierKey>>; overrides: Record<string, AutoOverride> };

export const AUTO_QTY_MAX = 100_000;

const isTier = (v: unknown): v is TierKey => v === "good" || v === "better" || v === "best";

/** One row's override — a SKU wins over an assembly id; qty is a whole number ≥ 0. Empty → null. */
export function sanitizeAutoOverride(raw: unknown): AutoOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sku = typeof r.sku === "string" ? r.sku.trim().slice(0, 120) : "";
  const assemblyId = typeof r.assemblyId === "string" ? r.assemblyId.trim().slice(0, 120) : "";
  const q = Number(r.qty);
  const out: AutoOverride = {};
  if (sku) out.sku = sku;
  else if (assemblyId) out.assemblyId = assemblyId;
  if (r.qty !== undefined && r.qty !== null && Number.isFinite(q) && q >= 0) out.qty = Math.min(AUTO_QTY_MAX, Math.round(q));
  return Object.keys(out).length ? out : null;
}

export function sanitizeAutoEstimate(raw: unknown): AutoEstimate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tb = (r.tierByScope && typeof r.tierByScope === "object" ? r.tierByScope : {}) as Record<string, unknown>;
  const tierByScope: Partial<Record<SysKey, TierKey>> = {};
  for (const k of TRACKABLE_SYS_KEYS) {
    const t = tb[k];
    if (isTier(t)) tierByScope[k] = t;
  }
  const ov = (r.overrides && typeof r.overrides === "object" ? r.overrides : {}) as Record<string, unknown>;
  const overrides: Record<string, AutoOverride> = {};
  for (const [key, value] of Object.entries(ov)) {
    const def = EQUIPMENT_ROW_BY_KEY.get(key);
    if (!def || !TRACKABLE_SYS_KEYS.includes(def.system)) continue;
    const o = sanitizeAutoOverride(value);
    if (o) overrides[key] = o;
  }
  return { tierByScope, overrides };
}

/** "Change equipment…" for ONE scope: its tier and its rows' overrides are replaced; every other scope is kept. */
export function mergeScopeEstimate(
  est: AutoEstimate,
  scope: SysKey,
  tier: TierKey,
  overrides: Record<string, AutoOverride>
): AutoEstimate {
  const mine = sanitizeAutoEstimate({ tierByScope: {}, overrides }).overrides;
  const next: Record<string, AutoOverride> = {};
  for (const [k, v] of Object.entries(est.overrides)) if (!k.startsWith(`${scope}:`)) next[k] = v;
  for (const [k, v] of Object.entries(mine)) if (k.startsWith(`${scope}:`)) next[k] = v;
  return { tierByScope: { ...est.tierByScope, [scope]: tier }, overrides: next };
}

/** The SKUs and assembly ids the overrides reference — what the resolver must load. */
export function overrideRefs(est: AutoEstimate): { skus: string[]; assemblyIds: string[] } {
  const skus = new Set<string>();
  const assemblyIds = new Set<string>();
  for (const o of Object.values(est.overrides)) {
    if (o.sku) skus.add(o.sku);
    if (o.assemblyId) assemblyIds.add(o.assemblyId);
  }
  return { skus: [...skus], assemblyIds: [...assemblyIds] };
}
