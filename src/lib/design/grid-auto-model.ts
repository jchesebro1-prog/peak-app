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
import { PLACEMENT_QTY_MAX } from "./grid-bom";

export type AutoTag = { scope: SysKey; rowKey: string; tier: TierKey };
export type AutoOverride = { sku?: string; assemblyId?: string; qty?: number };
export type AutoEstimate = { tierByScope: Partial<Record<SysKey, TierKey>>; overrides: Record<string, AutoOverride> };

/** One cap for every Auto quantity: an override qty and a lot marker's qty. */
export const AUTO_QTY_MAX = PLACEMENT_QTY_MAX;

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

/* ---------------- store-side sanitizers (#GEM fix wave 1, M3) ---------------- */

/**
 * A lot marker's stored qty: a whole number in [2, AUTO_QTY_MAX], or
 * undefined for a plain one-unit marker (absent = 1). Non-finite, ≤ 1 or
 * junk input → undefined; anything above the cap is clamped to it.
 */
export function cleanLotQty(raw: unknown): number | undefined {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 1) return undefined;
  return Math.min(n, AUTO_QTY_MAX);
}

/** A stored auto tag: one of the five Auto scopes, a known equation row OF
 *  that scope, and a real tier — rebuilt as a fresh object. Anything else → null. */
export function sanitizeAutoTag(raw: unknown): AutoTag | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const scope = r.scope as SysKey;
  if (typeof r.scope !== "string" || !TRACKABLE_SYS_KEYS.includes(scope)) return null;
  const rowKey = typeof r.rowKey === "string" ? r.rowKey : "";
  const def = EQUIPMENT_ROW_BY_KEY.get(rowKey);
  if (!def || def.system !== scope) return null;
  if (!isTier(r.tier)) return null;
  return { scope, rowKey, tier: r.tier };
}

/** A hand-touched placement stops being "auto" (#GEM): later re-fills keep it.
 *  Returns the same object when there is no tag, else a copy without it. */
export function withoutAuto<T extends { auto?: unknown }>(pl: T): T {
  if (!pl.auto) return pl;
  const next = { ...pl };
  delete next.auto;
  return next;
}

/* ---------------- per-option estimates (#GEM fix wave 1, D1 / D-GEM-12) ---------------- */

/** Stored shape: one AutoEstimate per option id. A pre-D-GEM-12 doc stored a
 *  single AutoEstimate — read (and migrated on the next write) as the FIRST
 *  option's, the only option Auto could have filled before options mattered. */
export type AutoEstimates = Record<string, AutoEstimate>;

function isLegacyEstimate(raw: Record<string, unknown>): boolean {
  return "tierByScope" in raw || "overrides" in raw;
}

/** Normalize whatever is stored (map, legacy single value, junk) into a clean
 *  per-option map. `firstOptionId` owns a legacy single value. */
export function autoEstimatesOf(raw: unknown, firstOptionId: string): AutoEstimates {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  if (isLegacyEstimate(r)) return { [firstOptionId]: sanitizeAutoEstimate(r) };
  const out: AutoEstimates = {};
  for (const [optionId, v] of Object.entries(r)) {
    if (!optionId || !v || typeof v !== "object") continue;
    out[optionId] = sanitizeAutoEstimate(v);
  }
  return out;
}

/** The option's saved Auto choices, or null when it has none. */
export function autoEstimateFor(raw: unknown, optionId: string, firstOptionId: string): AutoEstimate | null {
  return autoEstimatesOf(raw, firstOptionId)[optionId] ?? null;
}

/* ---------------- client-safe UI helpers (#GEM fix wave 1, M7) ---------------- */

/**
 * The Equipment card's in-flight qty draft, reconciled against a fresh
 * server re-price — pure, so it's testable without mounting the card, and
 * safe for a client file to import as a VALUE (this module carries no
 * pricing). A rowKey's typed text survives only while it still agrees with
 * what the server now says that line's quantity is; a swap, a tier reset, or
 * "Change equipment…" landing on the same project elsewhere can move a
 * line's qty without going through this draft, and a row dropped from the
 * card entirely drops out too. Returns the SAME object when nothing is
 * stale, so a caller can skip its setState.
 */
export function reconcileQtyDraft(draft: Record<string, string>, lines: ReadonlyArray<{ rowKey: string; qty: number }>): Record<string, string> {
  if (!Object.keys(draft).length) return draft;
  const byRow = new Map(lines.map((l) => [l.rowKey, l.qty]));
  let changed = false;
  const next: Record<string, string> = {};
  for (const [rowKey, raw] of Object.entries(draft)) {
    const qty = byRow.get(rowKey);
    const drafted = Math.max(0, Math.round(Number(raw) || 0));
    if (qty !== undefined && qty === drafted) next[rowKey] = raw;
    else changed = true;
  }
  return changed ? next : draft;
}
