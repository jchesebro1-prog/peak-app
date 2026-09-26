/**
 * Grid Scope panel targets (#211, D305) — pure, computed on the SERVER.
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

/**
 * Total needs-a-part lines across every in-scope system of one priced tier
 * (#211 D310). With the Equipment map empty or partial, an estimate is
 * INCOMPLETE — never $0: Quick Design and the Designs dashboard show this
 * count in place of a bare dollar total, and "Add to Quotes" refuses to
 * promote while it's non-zero (see addToQuotesGuard below).
 */
export function needsPartCount(systems: SystemBlock[]): number {
  return Object.values(targetsFromSystems(systems)).reduce((n, t) => n + t.needsPart, 0);
}

/**
 * The "Add to Quotes" guard (#211 D310) — pure so both the client's
 * disabled-button check and the server actions (quick/actions.ts
 * addToQuotesAction, designs/actions.ts promoteDesignAction) share the exact
 * same rule and message. Returns the message to show, or null when the
 * chosen tier is clear to promote (every line mapped or a confirmed
 * allowance).
 */
export function addToQuotesGuard(needsPart: number): string | null {
  if (!(needsPart > 0)) return null;
  return `Incomplete — ${needsPart} item${needsPart === 1 ? "" : "s"} still need${needsPart === 1 ? "s" : ""} a part. Map ${
    needsPart === 1 ? "it" : "them"
  } in the Equipment map before adding to Quotes.`;
}

/**
 * A saved design's needs-a-part count (#211 D310/D319) — what the
 * server derived at save time. A pre-#211 record has no `incomplete` and
 * reads as 0: its stored budget stays visible (it is still refused as a
 * quote until the server re-price clears it — see design-pricing.ts).
 */
export function designNeedsPart(d: { incomplete?: { needsPart?: number } | null }): number {
  const n = Number(d.incomplete?.needsPart);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** What a person does to bring a Quick design's stored price up to date
 *  (#211 wave 2, M5): the record's `incomplete`/`budget` are what the server
 *  derived at its last save (D323), so after the missing rows are mapped
 *  it still reads Incomplete until it is re-saved. */
export const REFRESH_PRICE_HINT = "Open in Quick Design and save to refresh its price";

/** The refresh hint for an incomplete QUICK design (a Grid design's
 *  completeness is read live — D322 — so it never goes stale). */
export function designRefreshHint(d: { layoutMode?: string | null; incomplete?: { needsPart?: number } | null }): string | null {
  return d.layoutMode !== "manual" && designNeedsPart(d) > 0 ? REFRESH_PRICE_HINT : null;
}

/**
 * The one budget label every design surface shows (#211 final review I1):
 * Home cards, the Reviews queue, the engagement letter. "Incomplete" while
 * any line of the saved tier still needs a part — never the partial dollar
 * figure, which reads as a (wrong) price.
 */
export function designBudgetLabel(
  d: { budget?: number | null; incomplete?: { needsPart?: number } | null },
  money: (n: number) => string
): string {
  return designNeedsPart(d) > 0 ? "Incomplete" : money(d.budget || 0);
}
