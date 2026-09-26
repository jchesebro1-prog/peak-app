/**
 * Grid Scope panel targets (#GEM, D-GEM-5) — pure, computed on the SERVER.
 * grid/[id]/page.tsx runs the estimate pipeline once per tier and sends only
 * these sell numbers to the editor: the client never holds a price table, a
 * unit cost or a pricing constant. That is what removes D139's crossing of
 * the sell-only boundary. A needs-a-part line is COUNTED, never summed.
 */
import {
  defaultAState,
  type AState,
  type QuickScopeInputs,
  type SysKey,
  type SystemBlock,
  type TierKey,
} from "@/app/(app)/design/quick/engine";

export type ScopeTarget = { sell: number; needsPart: number; allowances: number };
export type ScopeTargets = Partial<Record<SysKey, ScopeTarget>>;
export type ScopeTargetsByTier = Record<TierKey, ScopeTargets>;
/** Price the estimate for one tier: (merged state with `tier` set, tier) → priced systems. */
export type PriceSystems = (s: AState, tier: TierKey) => SystemBlock[];

export function targetsFromSystems(systems: SystemBlock[]): ScopeTargets {
  const out: ScopeTargets = {};
  for (const sys of systems) {
    if (!sys.on) continue;
    let needsPart = 0;
    let allowances = 0;
    for (const it of sys.items) {
      if (it.qty <= 0) continue;
      if (it.status === "needs-part") needsPart += 1;
      else if (it.status === "allowance") allowances += 1;
    }
    out[sys.key] = { sell: sys.rev, needsPart, allowances };
  }
  return out;
}

/** Good / Better / Best targets for a project's live scope inputs (merged onto defaultAState so every compute() field exists). */
export function scopeTargetsByTier(inputs: QuickScopeInputs, price: PriceSystems): ScopeTargetsByTier {
  const one = (tier: TierKey) => targetsFromSystems(price({ ...defaultAState(0), ...inputs, tier }, tier));
  return { good: one("good"), better: one("better"), best: one("best") };
}
