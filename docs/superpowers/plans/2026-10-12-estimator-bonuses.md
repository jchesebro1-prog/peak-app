# Estimator Bonuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Estimator system quote carries two hidden, auto-computed bonus lines per system — a 5% package bonus (5% of system cost, marked up at the system's blended margin, only when the system has labor) and a 2% estimator bonus (2% of the system's price) — never shown to the customer, recorded per estimator at Won, and reported at Reports → Estimator bonuses.

**Architecture:** One pure rules module (`src/lib/estimate-bonus/`) owns the math and the line shapes. The Estimator client and every server write path call `withBonusLines()`; `customerLines()` folds both lines into other rows on every customer document; `setStatus("won")` writes a store-owned `Quote.bonusRecord`; a report page reads only those records.

**Tech Stack:** Next.js 16 App Router, TypeScript, JSONB doc store (no migration), `scripts/test-review-and-spec.ts` harness.

**Spec:** `docs/superpowers/specs/2026-10-12-estimator-bonuses-design.md` (approved 2026-10-12). Read it before any task.

## Global Constraints

- Work in `/Users/sm/Downloads/peak-app-wt-bonuses` on branch `feat/estimator-bonuses`. Node: `export PATH="$HOME/.local/node/bin:$PATH"`.
- Never open `.data/pglite`. `npm run test:specs` already uses a temp datadir. Never run two tsx/db scripts at once.
- Rates are constants: `BONUS_PACKAGE_PCT = 0.05`, `BONUS_ESTIMATOR_PCT = 0.02`.
- Line identity is the `SpecItem.bonus?: "package" | "estimator"` flag — never the SKU. SKUs: `BON-PKG-<sectionId>`, `BON-EST-<sectionId>`.
- Internal descriptions (staff only): `Package bonus — 5% of system cost`, `Estimator bonus — 2% of system price`.
- Both bonus lines carry `qty: 1`, `unit: "lot"`, `noFreight: true`. The package line carries `labor: true`; the estimator line must NOT carry `labor` (review limits treat any labor line as "has labor").
- No customer-facing surface may print `bonus`, `Package bonus`, `Estimator bonus`, or `BON-`, and every customer surface's total must equal the staff total.
- Eligible quotes: `quoteType` is `"system"` or absent, and `source` neither starts with `portal` nor equals `grid`.
- Rules apply when the quote is eligible AND (status is draft/unsaved, OR status is `sent` and the quote already carries a bonus line). Won and lost are never rewritten. Legacy sent quotes keep their old lines.
- Harness rules: one big file `scripts/test-review-and-spec.ts`; `ok(cond, msg)` is the assertion; every check message starts with `#bonus`; every imported binding name must be unique in the whole file (alias with a `bn` prefix); pure checks go in a `{ … }` block appended at EOF; async checks are `async function bonusXChecks()` chained with `.then(() => bonusXChecks())` immediately before `.finally(() => teardownFixtures())`.
- Run the suite: `npm run test:specs 2>&1 | grep -E "#bonus|FAIL|ALL PASSED|FAILED"`. Expect every `#bonus` line PASS and the final `ALL PASSED`.
- Commit after each task with a message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

---

### Task 1: Bonus flags + rules (pure)

**Files:**
- Create: `src/lib/estimate-bonus/flags.ts`
- Create: `src/lib/estimate-bonus/rules.ts`
- Modify: `src/app/(app)/estimator/types.ts` (SpecItem, near `laborOverhead` at ~line 92)
- Test: `scripts/test-review-and-spec.ts` (append EOF block)

**Interfaces:**
- Produces (flags.ts — imports nothing but types, so `pricing.ts` can import it without a cycle):
  - `type BonusKind = "package" | "estimator"`
  - `const BONUS_PACKAGE_PCT = 0.05`, `const BONUS_ESTIMATOR_PCT = 0.02`
  - `isBonusItem(it): boolean`, `isPackageBonusItem(it): boolean`, `isEstimatorBonusItem(it): boolean`, `isLegacyLaborBonusItem(it): boolean`
- Produces (rules.ts):
  - `type BonusAmount = { cost: number; sell: number }`
  - `hasLaborLine(sec: SpecSection): boolean`
  - `packageBonus(sec: SpecSection): BonusAmount | null`
  - `estimatorBonus(sec: SpecSection, pkg?: BonusAmount | null): BonusAmount | null`
  - `sectionWithBonusLines(sec: SpecSection, nextId: () => number): SpecSection` (returns `sec` itself when unchanged)
  - `withBonusLines(sections: SpecSection[], nextId: () => number): SpecSection[]` (returns the input array itself when unchanged)
  - `stripBonusLines(sec: SpecSection): SpecSection` (removes new and legacy bonus lines)
  - `idCounterFrom(sections: SpecSection[]): () => number` (max item id + 1, incrementing)
  - `isBonusEligibleQuote(q: { source?: string | null; quoteType?: string | null }): boolean`
  - `bonusRulesApply(q: { source?: string | null; quoteType?: string | null; status?: string | null }, sections: SpecSection[]): boolean`

- [ ] **Step 1: Add the type field.** In `src/app/(app)/estimator/types.ts`, directly after the `laborOverhead?: …` member of `SpecItem`, add:

```ts
  /**
   * Estimator bonuses (2026-10-12 spec): an automatic, internal-only line.
   * "package" = 5% of the system's cost (only when it has labor), marked up at
   * the system's blended margin; "estimator" = 2% of the system's price, at
   * cost. Written only by `withBonusLines` (src/lib/estimate-bonus/rules.ts);
   * folded into other rows on every customer surface by `customerLines`.
   */
  bonus?: "package" | "estimator";
```

- [ ] **Step 2: Write `flags.ts`.**

```ts
/**
 * Estimator bonuses — identity of the two automatic internal lines. Kept free
 * of runtime imports so `estimator/pricing.ts` can import it without a cycle
 * (rules.ts imports pricing.ts).
 */
export type BonusKind = "package" | "estimator";

export const BONUS_PACKAGE_PCT = 0.05;
export const BONUS_ESTIMATOR_PCT = 0.02;

type Flagged = { bonus?: unknown } | null | undefined;

export function isPackageBonusItem(it: Flagged): boolean {
  return !!it && it.bonus === "package";
}

export function isEstimatorBonusItem(it: Flagged): boolean {
  return !!it && it.bonus === "estimator";
}

export function isBonusItem(it: Flagged): boolean {
  return isPackageBonusItem(it) || isEstimatorBonusItem(it);
}

/** The pre-2026-10-12 "Performance bonus — 5% of labor cost" line (D136/D251). */
export function isLegacyLaborBonusItem(it: { laborOverhead?: unknown; labor?: unknown; sku?: unknown } | null | undefined): boolean {
  if (!it) return false;
  if (it.laborOverhead === "bonus") return true;
  return !!it.labor && typeof it.sku === "string" && /^LAB-BONUS-/.test(it.sku);
}
```

- [ ] **Step 3: Write the failing tests.** Append to the end of `scripts/test-review-and-spec.ts`:

```ts
import {
  hasLaborLine as bnHasLabor,
  packageBonus as bnPackage,
  estimatorBonus as bnEstimator,
  withBonusLines as bnWith,
  stripBonusLines as bnStrip,
  idCounterFrom as bnIds,
  isBonusEligibleQuote as bnEligible,
  bonusRulesApply as bnApplies,
} from "@/lib/estimate-bonus/rules";
import { isBonusItem as bnIsBonus } from "@/lib/estimate-bonus/flags";
import { systemSellTotal as bnSellTotal, systemFreight as bnFreight } from "@/app/(app)/estimator/pricing";
{
  const it = (id: number, cost: number, price: number, extra: Partial<SpecItem> = {}): SpecItem => ({
    id, sku: "P-" + id, desc: "Part " + id, qty: 1, unit: "ea", cost, price, ...extra,
  });
  const sec = (items: SpecItem[], extra: Partial<EstimatorSpecSection> = {}): EstimatorSpecSection => ({
    id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, items, ...extra,
  });

  // Labor detection
  const noLabor = sec([it(1, 1000, 1500)]);
  const withLabor = sec([it(1, 1000, 1500), it(2, 400, 600, { labor: true })]);
  ok(!bnHasLabor(noLabor), "#bonus hasLaborLine: materials-only system has no labor");
  ok(bnHasLabor(withLabor), "#bonus hasLaborLine: a labor:true line counts");
  ok(!bnHasLabor(sec([it(1, 1000, 1500), it(2, 400, 600, { labor: true, option: true })])), "#bonus hasLaborLine: an option labor line does not count");
  ok(bnHasLabor(sec([it(1, 100, 150)], { kind: "labor" })), "#bonus hasLaborLine: a labor-kind section counts");

  // 5%: of cost, at blended markup
  ok(bnPackage(noLabor) === null, "#bonus packageBonus: null without labor");
  const pkg = bnPackage(withLabor)!;
  ok(pkg.cost === 70, "#bonus packageBonus: 5% of 1400 cost = 70");
  ok(pkg.sell === 105, "#bonus packageBonus: marked up at blended 2100/1400 = 105");
  ok(bnPackage(sec([it(1, 0, 0, { labor: true })])) === null, "#bonus packageBonus: zero-cost system gets none");

  // 2%: of price before the 2% (5% sell + freight in)
  const est = bnEstimator(withLabor, pkg)!;
  ok(est.sell === 44.1 && est.cost === 44.1, "#bonus estimatorBonus: 2% of (2100 + 105) = 44.10, at cost");
  const freighted = sec([it(1, 1000, 1500), it(2, 400, 600, { labor: true })], { freightPct: 10 });
  const fPkg = bnPackage(freighted)!;
  ok(bnEstimator(freighted, fPkg)!.sell === Math.round(0.02 * (2100 + fPkg.sell + bnFreight(freighted)) * 100) / 100, "#bonus estimatorBonus: freight is inside the 2% base");
  const typed = sec([it(1, 1000, 1500)], { sellOverride: 5100 });
  ok(bnEstimator(typed, null)!.sell === 100, "#bonus estimatorBonus: typed sell 5100 → 5100 × 0.02 ÷ 1.02 = 100");
  ok(bnEstimator(sec([it(1, 0, 0)]), null) === null, "#bonus estimatorBonus: a $0 system gets none");

  // withBonusLines
  const ids = bnIds([withLabor]);
  const [w] = bnWith([withLabor], ids);
  const pLine = w.items.find((x) => x.bonus === "package")!;
  const eLine = w.items.find((x) => x.bonus === "estimator")!;
  ok(!!pLine && pLine.cost === 70 && pLine.price === 105 && pLine.labor === true && pLine.noFreight === true && pLine.sku === "BON-PKG-s1", "#bonus withBonusLines: package line shape");
  ok(!!eLine && eLine.cost === 44.1 && eLine.price === 44.1 && !eLine.labor && eLine.noFreight === true && eLine.sku === "BON-EST-s1", "#bonus withBonusLines: estimator line shape");
  ok(pLine.id === 3 && eLine.id === 4, "#bonus withBonusLines: new ids come from max id + 1");
  const again = bnWith([w], bnIds([w]));
  ok(again[0] === w, "#bonus withBonusLines: idempotent — second run returns the same section object");
  const arr = [w];
  ok(bnWith(arr, bnIds(arr)) === arr, "#bonus withBonusLines: unchanged input returns the same array");
  ok(bnSellTotal(w) === 2100 + 105 + 44.1, "#bonus withBonusLines: system total now includes both lines");
  const [nl] = bnWith([noLabor], bnIds([noLabor]));
  ok(!nl.items.some((x) => x.bonus === "package") && nl.items.some((x) => x.bonus === "estimator"), "#bonus withBonusLines: no-labor system gets only the 2%");
  const dropped = { ...w, items: w.items.filter((x) => !x.labor || x.bonus) };
  const [dr] = bnWith([dropped], bnIds([dropped]));
  ok(!dr.items.some((x) => x.bonus === "package"), "#bonus withBonusLines: removing the labor removes the 5% line");
  const legacy = sec([it(1, 1000, 1500), it(2, 400, 600, { labor: true }), it(3, 20, 30, { labor: true, sku: "LAB-BONUS-9", laborOverhead: "bonus" })]);
  const [lg] = bnWith([legacy], bnIds([legacy]));
  ok(!lg.items.some((x) => x.laborOverhead === "bonus") && lg.items.find((x) => x.bonus === "package")!.cost === 70, "#bonus withBonusLines: legacy 5%-of-labor line is replaced, not counted");
  ok(bnStrip(w).items.every((x) => !bnIsBonus(x)), "#bonus stripBonusLines: removes both lines");

  // Eligibility + when rules apply
  ok(bnEligible({ source: "estimator", quoteType: "system" }) && bnEligible({ source: "quick" }), "#bonus eligible: estimator + quick-turned-estimator");
  ok(!bnEligible({ source: "portal-catalog", quoteType: "system" }) && !bnEligible({ source: "grid" }) && !bnEligible({ source: "estimator", quoteType: "flame_test" }), "#bonus eligible: portal, grid, service excluded");
  ok(bnApplies({ source: "estimator", status: "draft" }, [noLabor]), "#bonus applies: draft");
  ok(bnApplies({ source: "estimator" }, [noLabor]), "#bonus applies: unsaved");
  ok(!bnApplies({ source: "estimator", status: "sent" }, [noLabor]) && bnApplies({ source: "estimator", status: "sent" }, [w]), "#bonus applies: sent only when already on the new rules");
  ok(!bnApplies({ source: "estimator", status: "won" }, [w]) && !bnApplies({ source: "estimator", status: "lost" }, [w]), "#bonus applies: won/lost frozen");
}
```

- [ ] **Step 4: Run to confirm failure.** `npm run test:specs 2>&1 | tail -5` — expected: the suite dies on the missing module `@/lib/estimate-bonus/rules`.

- [ ] **Step 5: Write `rules.ts`.**

```ts
/**
 * Estimator bonuses (spec docs/superpowers/specs/2026-10-12-estimator-bonuses-design.md).
 * Pure: no I/O. The only place the 5% package / 2% estimator math lives.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { isSystemLine, lineExtSellOf, round2, systemFreight, validSellOverride } from "@/app/(app)/estimator/pricing";
import {
  BONUS_ESTIMATOR_PCT,
  BONUS_PACKAGE_PCT,
  isBonusItem,
  isEstimatorBonusItem,
  isLegacyLaborBonusItem,
  isPackageBonusItem,
} from "./flags";

export type BonusAmount = { cost: number; sell: number };

const isAnyBonus = (it: SpecItem) => isBonusItem(it) || isLegacyLaborBonusItem(it);

/** The system with every bonus line (new and legacy) removed. */
export function stripBonusLines(sec: SpecSection): SpecSection {
  return sec.items.some(isAnyBonus) ? { ...sec, items: sec.items.filter((it) => !isAnyBonus(it)) } : sec;
}

/** In-total, non-option, non-bonus lines — the base both bonuses are figured on. */
function baseLines(sec: SpecSection): SpecItem[] {
  return sec.items.filter((it) => isSystemLine(it) && !isAnyBonus(it));
}

export function hasLaborLine(sec: SpecSection): boolean {
  const lines = baseLines(sec);
  if (!lines.length) return false;
  return sec.kind === "labor" || lines.some((it) => it.labor === true);
}

export function packageBonus(sec: SpecSection): BonusAmount | null {
  if (!hasLaborLine(sec)) return null;
  const lines = baseLines(sec);
  const cost = lines.reduce((a, it) => a + it.qty * it.cost, 0);
  const sell = lines.reduce((a, it) => a + lineExtSellOf(it), 0);
  if (!Number.isFinite(cost) || !Number.isFinite(sell) || cost <= 0) return null;
  const bCost = round2(cost * BONUS_PACKAGE_PCT);
  if (bCost <= 0) return null;
  return { cost: bCost, sell: round2(bCost * (sell / cost)) };
}

export function estimatorBonus(sec: SpecSection, pkg: BonusAmount | null = packageBonus(sec)): BonusAmount | null {
  const typed = validSellOverride(sec.sellOverride);
  let s: number;
  if (typed != null) {
    s = round2((typed * BONUS_ESTIMATOR_PCT) / (1 + BONUS_ESTIMATOR_PCT));
  } else {
    const stripped = stripBonusLines(sec);
    const p = baseLines(stripped).reduce((a, it) => a + lineExtSellOf(it), 0) + (pkg ? pkg.sell : 0) + systemFreight(stripped);
    if (!Number.isFinite(p)) return null;
    s = round2(p * BONUS_ESTIMATOR_PCT);
  }
  return s > 0 ? { cost: s, sell: s } : null;
}

function packageLine(secId: string, a: BonusAmount, id: number): SpecItem {
  return {
    id, sku: "BON-PKG-" + secId, desc: "Package bonus — 5% of system cost",
    qty: 1, unit: "lot", cost: a.cost, price: a.sell, labor: true, noFreight: true, bonus: "package",
  };
}

function estimatorLine(secId: string, a: BonusAmount, id: number): SpecItem {
  return {
    id, sku: "BON-EST-" + secId, desc: "Estimator bonus — 2% of system price",
    qty: 1, unit: "lot", cost: a.sell, price: a.sell, noFreight: true, bonus: "estimator",
  };
}

const LINE_KEYS = ["id", "sku", "desc", "qty", "unit", "cost", "price", "labor", "noFreight", "bonus"] as const;

function sameItems(a: SpecItem[], b: SpecItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!isBonusItem(a[i]) || !isBonusItem(b[i])) return false;
    // A bonus line must carry exactly the canonical keys — an extra key
    // (extSellOverride, option…) means it was tampered with.
    if (Object.keys(a[i]).length !== Object.keys(b[i]).length) return false;
    for (const k of LINE_KEYS) if (a[i][k] !== b[i][k]) return false;
  }
  return true;
}

export function sectionWithBonusLines(sec: SpecSection, nextId: () => number): SpecSection {
  const stripped = stripBonusLines(sec);
  const pkg = packageBonus(stripped);
  const est = estimatorBonus(stripped, pkg);
  const prevPkg = sec.items.find(isPackageBonusItem);
  const prevEst = sec.items.find(isEstimatorBonusItem);
  const add: SpecItem[] = [];
  if (pkg) add.push(packageLine(sec.id, pkg, prevPkg ? prevPkg.id : nextId()));
  if (est) add.push(estimatorLine(sec.id, est, prevEst ? prevEst.id : nextId()));
  const items = [...stripped.items, ...add];
  return sameItems(sec.items, items) ? sec : { ...sec, items };
}

export function withBonusLines(sections: SpecSection[], nextId: () => number): SpecSection[] {
  let changed = false;
  const out = sections.map((sec) => {
    const n = sectionWithBonusLines(sec, nextId);
    if (n !== sec) changed = true;
    return n;
  });
  return changed ? out : sections;
}

export function idCounterFrom(sections: SpecSection[]): () => number {
  let n = 0;
  for (const s of sections) for (const it of s.items) if (typeof it.id === "number" && it.id > n) n = it.id;
  return () => ++n;
}

export function isBonusEligibleQuote(q: { source?: string | null; quoteType?: string | null }): boolean {
  const t = q.quoteType ?? "system";
  if (t !== "system") return false;
  const s = q.source || "";
  return !s.startsWith("portal") && s !== "grid";
}

export function bonusRulesApply(
  q: { source?: string | null; quoteType?: string | null; status?: string | null },
  sections: SpecSection[],
): boolean {
  if (!isBonusEligibleQuote(q)) return false;
  if (q.status === "won" || q.status === "lost") return false;
  if (!q.status || q.status === "draft") return true;
  return sections.some((s) => s.items.some(isBonusItem));
}
```

If `validSellOverride` is not exported from `pricing.ts` (it is at line 189), export it.

- [ ] **Step 6: Run the tests.** `npm run test:specs 2>&1 | grep -E "#bonus|FAIL|ALL PASSED|FAILED"`. Expected: every `#bonus` line PASS. (Other suites may still be fine; `ALL PASSED`.) Also `npx tsc --noEmit -p . 2>&1 | head`. Expected: no new errors.

- [ ] **Step 7: Commit.** `git add -A src/lib/estimate-bonus "src/app/(app)/estimator/types.ts" scripts/test-review-and-spec.ts && git commit -m "feat(estimator): bonus rules — 5% package + 2% estimator lines (pure)"`

---

### Task 2: Pricing integration — totals, customer fold, labor modal

**Files:**
- Modify: `src/app/(app)/estimator/pricing.ts` — `totals()` (305–383), `customerLinesRaw()` (1092–1151), `computeLabor()` (701–743), `LaborCalc` (678–699), `buildLaborItems()` (832–939, the `if (r.performanceBonus > 0)` block at ~914)
- Modify: `src/app/(app)/estimator/labor-modal.tsx` (lines 16, 208–212, 826–829)
- Modify: `src/lib/estimate-review/labor.ts:97` only if it reads `performanceBonus` (check; keep compiling)
- Test: `scripts/test-review-and-spec.ts` — existing checks at 549–634 (`expectedLaborLineCount` counts `r.performanceBonus > 0 ? 1 : 0`, assertions on `LAB-BONUS-`); append new block

**Interfaces:**
- Consumes: `isPackageBonusItem`, `isEstimatorBonusItem` from `@/lib/estimate-bonus/flags`
- Produces: `customerLines(sec)` with neither bonus line in its output and the same total; `totals()` that splits the 2% line between `mat`/`lab` in proportion to the system's own material/labor sell; `LaborCalc` without `performanceBonus` (`totalCost === baseCost`).

- [ ] **Step 1: Write the failing tests.** Append:

```ts
import { customerLines as bnCustomerLines, totals as bnTotals, computeLabor as bnComputeLabor } from "@/app/(app)/estimator/pricing";
{
  const it = (id: number, cost: number, price: number, extra: Partial<SpecItem> = {}): SpecItem => ({
    id, sku: "P-" + id, desc: "Part " + id, qty: 1, unit: "ea", cost, price, ...extra,
  });
  const base: EstimatorSpecSection = {
    id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0,
    items: [it(1, 1000, 1500), it(2, 400, 600, { labor: true, mob: { type: "Install", days: 1, crew: 2, discipline: "RIG" } })],
  };
  const [w] = bnWith([base], bnIds([base]));
  const rows = bnCustomerLines(w);
  const rowsTotal = Math.round(rows.reduce((a, r) => a + r.ext, 0) * 100) / 100;
  ok(rows.every((r) => !r.item || !bnIsBonus(r.item)), "#bonus customerLines: neither bonus line is a customer row");
  ok(rows.every((r) => (r.item ? r.item.desc : r.desc).toLowerCase().indexOf("bonus") < 0), "#bonus customerLines: no row says bonus");
  ok(rowsTotal === bnSellTotal(w), "#bonus customerLines: rows still add up to the system total");
  const mobRow = rows.find((r) => r.item && r.item.id === 2)!;
  ok(mobRow.ext > 600 + 105 - 0.01, "#bonus customerLines: 5% sell folds into the labor line");

  const [nl] = bnWith([{ ...base, items: [it(1, 1000, 1500)] }], () => 50);
  const nlRows = bnCustomerLines(nl);
  ok(nlRows.length === 1 && !!nlRows[0].item && nlRows[0].ext === bnSellTotal(nl), "#bonus customerLines: no-labor system gets no extra row; the 2% spreads onto its lines");

  const t = bnTotals([w], 0);
  ok(Math.abs(t.rev - bnSellTotal(w)) < 0.005, "#bonus totals: rev includes both bonus lines");
  ok(Math.abs(t.lab - (600 + 105 + 44.1 * (705 / 2205))) < 0.02, "#bonus totals: the 2% splits by the system's labor share; the 5% is labor");
  ok(Math.abs(t.mat + t.lab - t.rev) < 0.005, "#bonus totals: mat + lab = rev");

  const lr = bnComputeLabor({ discipline: "RIG", margin: "30", mobs: [], pmHrs: "0", pmAuto: true, shopHrs: "0", drfHrs: "0", drfAuto: true, misc: "100" }, () => 0);
  ok(lr.totalCost === lr.baseCost && !("performanceBonus" in lr), "#bonus computeLabor: the modal no longer adds its own 5%");
}
```

- [ ] **Step 2: Run to confirm failure.** `npm run test:specs 2>&1 | grep -E "#bonus|FAILED"`. Expected: FAIL on the customerLines/totals/computeLabor checks.

- [ ] **Step 3: `customerLinesRaw`.** Add `import { isEstimatorBonusItem, isPackageBonusItem } from "@/lib/estimate-bonus/flags";` at the top of `pricing.ts`. In `customerLinesRaw`:
  1. Right after `const visible = sec.items.filter(isSystemLine);` add:
     ```ts
     // Estimator bonuses: the 2% line is spread over every row at the end;
     // the 5% line folds into labor exactly like shop & engineering (D251).
     const estimatorBonusSell = round2(visible.filter(isEstimatorBonusItem).reduce((a, it) => a + lineExtSellOf(it), 0));
     ```
     and change every later use of `visible` in this function to `visibleNoEst`, defined as `const visibleNoEst = visible.filter((it) => !isEstimatorBonusItem(it));`.
  2. Change the `overhead` / `rest` split to:
     ```ts
     const overhead = [...visibleNoEst.filter((it) => isLaborOverheadItem(it) || isPackageBonusItem(it)), ...orphanTravel];
     const rest = visibleNoEst.filter((it) => !isLaborOverheadItem(it) && !isPackageBonusItem(it) && !isLaborTravelItem(it));
     ```
  3. Rename the function's body to compute `rows` (each existing `return …` becomes the value of `rows`) and end with:
     ```ts
     return estimatorBonusSell > 0 ? absorbSellAdjustment(rows, estimatorBonusSell) : rows;
     ```
     Simplest: rename the existing function to `customerLinesBase(sec, visible)` taking the pre-filtered `visibleNoEst`, and make `customerLinesRaw(sec)` compute `visible`, `estimatorBonusSell`, call `customerLinesBase`, then apply `absorbSellAdjustment`. `absorbSellAdjustment` is declared later in the file as an exported `function` (hoisted), so calling it is fine.

  The exported `customerLines(sec)` (1158) stays `absorbSellAdjustment(customerLinesRaw(sec), systemSellAdjustment(sec))`.

- [ ] **Step 4: `totals()`.** Inside the per-section item loop, before the `if (sec.kind === "labor" || it.labor)` split, add:
  ```ts
      if (isEstimatorBonusItem(it)) {
        secEst += ext;
        continue;
      }
  ```
  after `rev += ext; cost += it.qty * it.cost;` (so rev/cost include it). Declare `let secEst = 0;` beside `secMat, secLab`. After the loop, before the `#267` adjustment block, add:
  ```ts
    if (secEst !== 0) {
      // Estimator bonuses: the 2% rides in revenue split like the #267 adjustment.
      const b = secMat + secLab;
      const labShare = b > 0 ? round2((secEst * secLab) / b) : sec.kind === "labor" ? secEst : 0;
      lab += labShare;
      mat += round2(secEst - labShare);
    }
  ```
  Do not add `secEst` into `secMat`/`secLab` (the #267 adjustment split must keep using line sell only).

- [ ] **Step 5: Labor modal.** In `computeLabor`: delete `const performanceBonus = baseCost * 0.05;`, set `const totalCost = baseCost;`, drop `performanceBonus` from the returned object and from `LaborCalc`. In `buildLaborItems`, delete the whole `if (r.performanceBonus > 0) { … }` block. In `labor-modal.tsx`: line 16 comment drop "/ performance bonus"; the sub-copy at 210–211 becomes `shop &amp; engineering lines (internal — the customer sees them folded into labor)`; replace the 826–829 `<div>` content with `Package bonus (5% of system cost) is added to the system automatically.` Fix any compile errors (`src/lib/estimate-review/labor.ts`, harness lines 549–634: change `expectedLaborLineCount` to stop counting the bonus, and delete/invert the assertions that expect a `LAB-BONUS-` line — they now must assert NO `LAB-BONUS-` line is emitted). Leave `isLaborOverheadItem`'s `LAB-BONUS-` recognition and `laborOverhead: "bonus"` in the type: frozen quotes still print through them.

- [ ] **Step 6: Run.** `npm run test:specs 2>&1 | grep -E "#bonus|FAIL|ALL PASSED|FAILED"` → all PASS, `ALL PASSED`. `npx tsc --noEmit -p .` → clean.

- [ ] **Step 7: Commit.** `git commit -am "feat(estimator): fold bonus lines on customer rows; split 2% in totals; labor modal drops its 5%"`

---

### Task 3: Keep bonus lines out of every other reader

**Files (modify — each gets an explicit `isBonusItem` skip; import from `@/lib/estimate-bonus/flags`):**
- `src/lib/client-package-server.ts:355` (`quoteBom` skip condition)
- `src/lib/specs/quote-bom.ts:79` (`bomFromQuote` skip condition)
- `src/app/(app)/estimator/narrative.ts:117-120` (`isKeyProductEligible`: add `&& !isBonusItem(it)`)
- `src/app/(app)/estimator/parts-csv.ts:90`
- `src/lib/manufacturer-analytics.ts:88`
- `src/lib/dashboard/metrics.ts:150`
- `src/lib/part-docs/quoted-parts.ts:40`
- `src/lib/design/estimate-tray.ts:126`
- `src/lib/package-doc/chips.ts:48-50` (`findLine` returns undefined for a bonus line)
- `src/lib/portal-pricing.ts:481-500` (`cartLinesFromSpec` skips bonus lines)
- `src/app/(app)/estimator/copy-system.ts:118` (`copySectionForTarget` drops bonus lines; the target re-derives them)
- `src/lib/narrative/system-library.ts:122` (`linesOf` drops bonus lines)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:** Consumes `isBonusItem`. Produces nothing new.

- [ ] **Step 1: Write the failing tests.** For each reader that is a pure, exported function, feed it a fixture quote whose sections went through `withBonusLines` and assert no `BON-` SKU / no "bonus" text comes out. Append:

```ts
import { bomFromQuote as bnBomFromQuote } from "@/lib/specs/quote-bom";
import { isKeyProductEligible as bnKeyEligible } from "@/app/(app)/estimator/narrative";
import { cartLinesFromSpec as bnCartLines } from "@/lib/portal-pricing";
import { copySectionForTarget as bnCopySection } from "@/app/(app)/estimator/copy-system";
{
  const it = (id: number, cost: number, price: number, extra: Partial<SpecItem> = {}): SpecItem => ({
    id, sku: "P-" + id, desc: "Part " + id, qty: 1, unit: "ea", cost, price, ...extra,
  });
  const base: EstimatorSpecSection = { id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, items: [it(1, 1000, 1500), it(2, 400, 600, { labor: true })] };
  const sections = bnWith([base], bnIds([base]));
  const bonusLines = sections[0].items.filter(bnIsBonus);
  ok(bonusLines.length === 2, "#bonus leak fixture has both lines");
  const noBon = (s: string) => !/BON-|bonus/i.test(s);
  ok(bonusLines.every((x) => !bnKeyEligible(x)), "#bonus leak: bonus lines can't be key products");
  ok(noBon(JSON.stringify(bnBomFromQuote({ spec: { sections } } as never))), "#bonus leak: Word spec BOM");
  ok(noBon(JSON.stringify(bnCartLines({ sections } as never))), "#bonus leak: portal copy-to-cart");
  ok(!bnCopySection(sections[0] as never, {} as never).items.some(bnIsBonus), "#bonus copy system drops bonus lines");
}
```

Before running, open each of these four functions and adjust the fixture call to its real signature (the `as never` casts mark the arguments to adapt). For `quoteBom` (client-package-server, server-only) and the remaining non-exported readers, add the skip without a harness check, and add one grep check that pins the skip:

```ts
{
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  for (const p of [
    "src/lib/client-package-server.ts", "src/lib/specs/quote-bom.ts", "src/app/(app)/estimator/narrative.ts",
    "src/app/(app)/estimator/parts-csv.ts", "src/lib/manufacturer-analytics.ts", "src/lib/dashboard/metrics.ts",
    "src/lib/part-docs/quoted-parts.ts", "src/lib/design/estimate-tray.ts", "src/lib/package-doc/chips.ts",
    "src/lib/portal-pricing.ts", "src/app/(app)/estimator/copy-system.ts", "src/lib/narrative/system-library.ts",
  ]) ok(src(p).includes("isBonusItem"), "#bonus leak pin: " + p + " skips bonus lines");
}
```

- [ ] **Step 2: Run to confirm failure.** Expected FAIL lines for each reader.

- [ ] **Step 3: Add the skips.** At each listed line add `|| isBonusItem(it)` (or `isBonusItem(item)`, matching the local variable) to the existing skip condition, or `.filter((it) => !isBonusItem(it))` where the function maps raw items. In `findLine` return `undefined` when the found line `isBonusItem`.

- [ ] **Step 4: QuoteDocument render check.** The harness already renders `QuoteDocument` (see `r282cRender` near line 39890 — copy its setup: props shape, fixture quote). Append one block that renders a quote whose sections went through `bnWith` and asserts `!/BON-|bonus/i.test(html)` and that the printed grand total equals `bnTotals(sections, 0).grand` formatted the same way the document formats money. Use a unique import alias (`bnRender`).

- [ ] **Step 5: Run.** All `#bonus` PASS, `ALL PASSED`; `npx tsc --noEmit -p .` clean.

- [ ] **Step 6: Commit.** `git commit -am "feat(estimator): keep bonus lines out of BOMs, key products, exports, carts, copy and library"`

---

### Task 4: Bonus record (pure)

**Files:**
- Create: `src/lib/estimate-bonus/record.ts`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export type BonusSplit = { leadPct: number };
  export type BonusCredit = { name: string; userId: string | null; role: "lead" | "prepared"; pct: number; amount: number };
  export type BonusRecord = {
    wonAt: number; sellTotal: number; estimatorBonus: number; packageBonusCost: number;
    alternatesTaken: string[]; credits: BonusCredit[];
  };
  export function normalizeSplit(v: unknown): BonusSplit;               // { leadPct } clamped 0–100, whole numbers, default 50
  export function quoteHasBonusLines(sections: SpecSection[]): boolean;
  export function defaultAlternatesTaken(sections: SpecSection[], responses: ClientResponse[] | null | undefined): string[];
  export function buildBonusRecord(input: {
    sections: SpecSection[]; owner: string; preparedBy?: string | null; split?: BonusSplit | null;
    alternatesTaken: string[]; users: { id: string; name: string }[]; wonAt: number;
  }): BonusRecord;
  export function resolveUserId(name: string, users: { id: string; name: string }[]): string | null; // unique case-insensitive exact match
  ```
  (`ClientResponse` from `@/lib/estimate-output/responses`.)

- [ ] **Step 1: Write the failing tests.**

```ts
import {
  normalizeSplit as bnSplit, buildBonusRecord as bnRecord, defaultAlternatesTaken as bnAltDefault,
  resolveUserId as bnResolve, quoteHasBonusLines as bnHasLines,
} from "@/lib/estimate-bonus/record";
{
  const it = (id: number, cost: number, price: number, extra: Partial<SpecItem> = {}): SpecItem => ({
    id, sku: "P-" + id, desc: "Part " + id, qty: 1, unit: "ea", cost, price, ...extra,
  });
  const mk = (id: string, items: SpecItem[], extra: Partial<EstimatorSpecSection> = {}): EstimatorSpecSection =>
    ({ id, name: id, kind: "materials", mfr: "", freightPct: 0, items, ...extra });
  const raw = [
    mk("a", [it(1, 1000, 1500), it(2, 400, 600, { labor: true })]),
    mk("b", [it(3, 2000, 2500)]),
    mk("alt1", [it(4, 500, 1000)], { alternate: true }),
  ];
  const secs = bnWith(raw, bnIds(raw));
  const users = [{ id: "u1", name: "Jeff Chesebro" }, { id: "u2", name: "Sam Smith" }];
  ok(bnSplit(undefined).leadPct === 50 && bnSplit({ leadPct: 140 }).leadPct === 100 && bnSplit({ leadPct: 70.4 }).leadPct === 70, "#bonus split: default 50, clamped, whole");
  ok(bnResolve("jeff chesebro", users) === "u1" && bnResolve("Nobody", users) === null, "#bonus resolveUserId");
  ok(bnHasLines(secs) && !bnHasLines(raw), "#bonus quoteHasBonusLines");

  const est = (id: string) => secs.find((s) => s.id === id)!.items.find((x) => x.bonus === "estimator")!.price;
  const pkgCost = secs[0].items.find((x) => x.bonus === "package")!.cost;
  const r = bnRecord({ sections: secs, owner: "Jeff Chesebro", preparedBy: "Sam Smith", split: { leadPct: 70 }, alternatesTaken: [], users, wonAt: 1000 });
  ok(r.estimatorBonus === Math.round((est("a") + est("b")) * 100) / 100, "#bonus record: Σ 2% of in-total systems; untaken alternate excluded");
  ok(r.packageBonusCost === pkgCost, "#bonus record: package pool = Σ 5% COST");
  ok(r.credits.length === 2 && r.credits[0].role === "lead" && r.credits[0].pct === 70 && r.credits[0].userId === "u1" && r.credits[1].pct === 30, "#bonus record: 70/30 credits");
  ok(Math.round((r.credits[0].amount + r.credits[1].amount) * 100) === Math.round(r.estimatorBonus * 100), "#bonus record: credits sum to the bonus to the cent");
  const rAlt = bnRecord({ sections: secs, owner: "Jeff Chesebro", preparedBy: "Sam Smith", alternatesTaken: ["alt1"], users, wonAt: 1000 });
  ok(rAlt.estimatorBonus === Math.round((est("a") + est("b") + est("alt1")) * 100) / 100 && rAlt.alternatesTaken.join() === "alt1", "#bonus record: a taken alternate counts");
  const same = bnRecord({ sections: secs, owner: "Jeff Chesebro", preparedBy: "jeff chesebro", alternatesTaken: [], users, wonAt: 1 });
  ok(same.credits.length === 1 && same.credits[0].pct === 100, "#bonus record: same person both roles → 100%");
  const blank = bnRecord({ sections: secs, owner: "Jeff Chesebro", preparedBy: "", alternatesTaken: [], users, wonAt: 1 });
  ok(blank.credits.length === 1 && blank.credits[0].role === "lead" && blank.credits[0].pct === 100, "#bonus record: blank Prepared by → lead 100%");
  const zero = bnRecord({ sections: secs, owner: "Jeff Chesebro", preparedBy: "Sam Smith", split: { leadPct: 100 }, alternatesTaken: [], users, wonAt: 1 });
  ok(zero.credits.length === 1 && zero.credits[0].role === "lead", "#bonus record: a 0% share is omitted");
  const resp = [{ id: "r1", kind: "accept", rev: 1, at: 5, name: "", email: "", message: "", sectionIds: ["a", "alt1"], sectionNames: [], total: 0 }];
  ok(bnAltDefault(secs, resp as never).join() === "alt1" && bnAltDefault(secs, []).length === 0, "#bonus defaultAlternatesTaken from the latest accept response");
}
```

- [ ] **Step 2: Run to confirm failure** (missing module).

- [ ] **Step 3: Write `record.ts`.**

```ts
/** Estimator bonuses — the store-owned record written at Won (pure). */
import type { SpecSection } from "@/app/(app)/estimator/types";
import { round2, systemSellTotal } from "@/app/(app)/estimator/pricing";
import type { ClientResponse } from "@/lib/estimate-output/responses";
import { isBonusItem, isEstimatorBonusItem, isPackageBonusItem } from "./flags";

export type BonusSplit = { leadPct: number };
export type BonusCredit = { name: string; userId: string | null; role: "lead" | "prepared"; pct: number; amount: number };
export type BonusRecord = {
  wonAt: number;
  sellTotal: number;
  estimatorBonus: number;
  packageBonusCost: number;
  alternatesTaken: string[];
  credits: BonusCredit[];
};

export function normalizeSplit(v: unknown): BonusSplit {
  const n = v && typeof v === "object" ? Number((v as { leadPct?: unknown }).leadPct) : NaN;
  return { leadPct: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50 };
}

export function quoteHasBonusLines(sections: SpecSection[]): boolean {
  return sections.some((s) => s.items.some(isBonusItem));
}

export function resolveUserId(name: string, users: { id: string; name: string }[]): string | null {
  const k = name.trim().toLowerCase();
  if (!k) return null;
  const hits = users.filter((u) => (u.name || "").trim().toLowerCase() === k);
  return hits.length === 1 ? hits[0].id : null;
}

export function defaultAlternatesTaken(sections: SpecSection[], responses: ClientResponse[] | null | undefined): string[] {
  const alts = new Set(sections.filter((s) => s.alternate === true).map((s) => s.id));
  const accepts = (responses || []).filter((r) => r.kind === "accept").sort((a, b) => b.at - a.at);
  return accepts.length ? accepts[0].sectionIds.filter((id) => alts.has(id)) : [];
}

export function buildBonusRecord(input: {
  sections: SpecSection[];
  owner: string;
  preparedBy?: string | null;
  split?: BonusSplit | null;
  alternatesTaken: string[];
  users: { id: string; name: string }[];
  wonAt: number;
}): BonusRecord {
  const taken = new Set(input.alternatesTaken);
  const counted = input.sections.filter((s) => s.alternate !== true || taken.has(s.id));
  let sell = 0, est = 0, pkg = 0;
  for (const s of counted) {
    sell += systemSellTotal(s);
    for (const it of s.items) {
      if (it.option) continue;
      if (isEstimatorBonusItem(it)) est += it.qty * it.price;
      if (isPackageBonusItem(it)) pkg += it.qty * it.cost;
    }
  }
  const estimatorBonus = round2(est);
  const lead = (input.owner || "").trim();
  const prep = (input.preparedBy || "").trim();
  const shares: { name: string; role: "lead" | "prepared"; pct: number }[] = [];
  if (lead && prep && lead.toLowerCase() !== prep.toLowerCase()) {
    const lp = normalizeSplit(input.split).leadPct;
    shares.push({ name: lead, role: "lead", pct: lp }, { name: prep, role: "prepared", pct: 100 - lp });
  } else if (lead || prep) {
    shares.push({ name: lead || prep, role: lead ? "lead" : "prepared", pct: 100 });
  }
  const live = shares.filter((s) => s.pct > 0);
  let given = 0;
  const credits: BonusCredit[] = live.map((s, i) => {
    const amount = i === live.length - 1 ? round2(estimatorBonus - given) : round2((estimatorBonus * s.pct) / 100);
    given = round2(given + amount);
    return { name: s.name, userId: resolveUserId(s.name, input.users), role: s.role, pct: s.pct, amount };
  });
  return {
    wonAt: input.wonAt,
    sellTotal: round2(sell),
    estimatorBonus,
    packageBonusCost: round2(pkg),
    alternatesTaken: counted.filter((s) => s.alternate === true).map((s) => s.id),
    credits,
  };
}
```

- [ ] **Step 4: Run.** All `#bonus` PASS. tsc clean.

- [ ] **Step 5: Commit.** `git commit -am "feat(estimator): bonus record builder — split, alternates, credits (pure)"`

---

### Task 5: Store — record at Won, split + alternates writers, project pool

**Files:**
- Modify: `src/lib/stores/quotes.ts` — `Quote` type (192–369: add `bonusRecord?: BonusRecord | null; estimatorBonusSplit?: BonusSplit | null;` with doc comments "store-owned; update() drops it; never content"), `update()` (816–841: `delete clean.bonusRecord; delete clean.estimatorBonusSplit;`), `SetStatusOpts` (add `alternatesTaken?: string[]`), `setStatus` (1857–2005)
- Add to `src/lib/stores/quotes.ts`: `setEstimatorBonusSplit(id, split)` and `setBonusAlternatesTaken(id, ids)`
- Modify: `src/app/(app)/estimator/actions.ts` — `setStatusAction` (1174) gains an optional `opts?: { alternatesTaken?: string[] }` passed through; add `saveBonusSplitAction(id, leadPct)` and `saveBonusAlternatesAction(id, ids)` (both `requirePerm("approve")`, `revalidatePath("/estimator")`)
- Modify: `src/lib/stores/projects.ts` — `ProjectRecord` (201) gains `performanceBonusPool?: number`; `fromQuote` (673–721) copies `q.bonusRecord?.packageBonusCost` when > 0; `QuoteLike` type gains `bonusRecord?`
- Modify: `src/app/(app)/projects/view.tsx:1017-1019` — append ` · Performance bonus pool {money(p.performanceBonusPool)}` when set
- Test: `scripts/test-review-and-spec.ts` — new `async function bonusStoreChecks()`; chain before `.finally(() => teardownFixtures())`

**Interfaces:**
- Consumes: `buildBonusRecord`, `defaultAlternatesTaken`, `quoteHasBonusLines`, `normalizeSplit` (Task 4); `isBonusEligibleQuote` (Task 1); `allUsers()` from `src/lib/users.ts` (returns rows with `id` and `name`).
- Produces: `Quote.bonusRecord`, `Quote.estimatorBonusSplit`, `ProjectRecord.performanceBonusPool`, `setStatusAction(id, status, …, opts?)`, `saveBonusSplitAction(id: string, leadPct: number): Promise<{ ok: boolean; error?: string }>`, `saveBonusAlternatesAction(id: string, ids: string[]): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Write the failing async test.** Find how nearby async checks create a quote and call `setStatus` (search the harness for `setStatus(` inside an `async function …Checks`); copy that setup. Then:

```ts
async function bonusStoreChecks(): Promise<void> {
  const { create: bnCreate, get: bnGet, setStatus: bnSetStatus, update: bnUpdate, setEstimatorBonusSplit: bnSetSplit } = await import("@/lib/stores/quotes");
  const { withBonusLines: w, idCounterFrom: ids } = await import("@/lib/estimate-bonus/rules");
  const base = [{ id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, items: [
    { id: 1, sku: "P-1", desc: "Part", qty: 1, unit: "ea", cost: 1000, price: 1500 },
    { id: 2, sku: "L-2", desc: "Labor", qty: 1, unit: "lot", cost: 400, price: 600, labor: true },
  ] }];
  const sections = w(base as never, ids(base as never));
  const q = await bnCreate({ name: "Bonus test", source: "estimator", quoteType: "system", owner: "Bonus Lead", preparedBy: "Bonus Prep", spec: { sections, mobs: [] } } as never);
  await bnUpdate(q.id, { bonusRecord: { wonAt: 1 } } as never);
  ok(!(await bnGet(q.id))!.bonusRecord, "#bonus store: update() can't write bonusRecord");
  await bnSetSplit(q.id, { leadPct: 60 });
  await bnSetStatus(q.id, "sent", "test");
  await bnSetStatus(q.id, "won", "test");
  const won = (await bnGet(q.id))!;
  ok(!!won.bonusRecord && won.bonusRecord.credits.length === 2 && won.bonusRecord.credits[0].pct === 60, "#bonus store: Won writes the record with the saved split");
  ok(won.bonusRecord!.estimatorBonus > 0 && won.bonusRecord!.packageBonusCost === 70, "#bonus store: record amounts");
  const { getProjectByQuote } = await import("@/lib/stores/projects");
  ok((await getProjectByQuote(q.id))?.performanceBonusPool === 70, "#bonus store: the install project carries the 5% pool");
  await bnSetSplit(q.id, { leadPct: 50 });
  ok((await bnGet(q.id))!.bonusRecord!.credits[0].pct === 50, "#bonus store: editing the split on a won quote rebuilds the record");
  await bnSetStatus(q.id, "lost", "test");
  ok(!(await bnGet(q.id))!.bonusRecord, "#bonus store: leaving Won withdraws the record");
  const legacy = await bnCreate({ name: "Legacy", source: "estimator", quoteType: "system", owner: "Bonus Lead", spec: { sections: base, mobs: [] } } as never);
  await bnSetStatus(legacy.id, "sent", "test");
  await bnSetStatus(legacy.id, "won", "test");
  ok(!(await bnGet(legacy.id))!.bonusRecord, "#bonus store: a quote without bonus lines records nothing");
}
```

Adapt `create`/`get` names to the store's real exports (the store exports `create` and `update`; find its single-quote getter). If `setStatus` to `sent`/`won` refuses because of the approval gate, use whatever bypass the neighbouring checks use (e.g. a held approval or an `opts` flag).

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement the store pieces.**
  - `setStatus`: before `withTransaction`, when `status === "won"`, load `const bonusUsers = (await allUsers()).map((u) => ({ id: u.id, name: u.name }));`. Inside the `patchQuote` callback, after `doc.status = status;`:
    ```ts
    if (status === "won") {
      const secs = (doc.spec as { sections?: SpecSection[] } | undefined)?.sections;
      if (isBonusEligibleQuote(doc) && Array.isArray(secs) && quoteHasBonusLines(secs)) {
        try {
          const alts = new Set(secs.filter((s) => s.alternate === true).map((s) => s.id));
          const taken = opts.alternatesTaken ? opts.alternatesTaken.filter((id) => alts.has(id)) : defaultAlternatesTaken(secs, doc.clientResponses);
          doc.bonusRecord = buildBonusRecord({ sections: secs, owner: doc.owner, preparedBy: doc.preparedBy, split: doc.estimatorBonusSplit, alternatesTaken: taken, users: bonusUsers, wonAt: t });
        } catch (e) {
          console.error("[bonus] record failed for", doc.id, e);
          doc.bonusRecord = null;
        }
      }
    } else if (doc.bonusRecord) {
      doc.bonusRecord = null;
    }
    ```
  - `setEstimatorBonusSplit(id, split)`: load users, then `patchQuote(id, (doc) => { doc.estimatorBonusSplit = normalizeSplit(split); if (doc.status === "won" && doc.bonusRecord) doc.bonusRecord = rebuild(doc, doc.bonusRecord.alternatesTaken, users); })` where `rebuild` calls `buildBonusRecord` keeping `wonAt`. Do not bump `updatedAt` and do not touch content fields (neither field is in `QUOTE_CONTENT_FIELDS`).
  - `setBonusAlternatesTaken(id, ids)`: same shape; only acts when `doc.status === "won" && doc.bonusRecord`; filters `ids` to the quote's alternate section ids.
  - Actions: `saveBonusSplitAction` / `saveBonusAlternatesAction` — `await requirePerm("approve")`, call the store writer, `revalidatePath("/estimator")`, return `{ ok: true }` (catch → `{ ok: false, error: String(e) }`). `setStatusAction`: add the optional `opts` param last and pass `{ ...existingOpts, alternatesTaken: opts?.alternatesTaken }` into `setStatus`.
  - Projects: as listed under Files.

- [ ] **Step 4: Chain + run.** Add `.then(() => bonusStoreChecks())` before `.finally(() => teardownFixtures())`. `npm run test:specs 2>&1 | grep -E "#bonus|FAIL|ALL PASSED|FAILED"` → PASS. tsc clean.

- [ ] **Step 5: Commit.** `git commit -am "feat(estimator): record the estimator bonus at Won; split + alternates writers; project bonus pool"`

---

### Task 6: Server canonicalization of saved sections

**Files:**
- Create: `src/lib/estimate-bonus/canonical.ts`
- Modify: `src/app/(app)/estimator/actions.ts` — `saveQuoteAction` (385; after step 2 at 440–441, before `settleRewardCredit` at 445) and `placeSystemInEstimate` (834; existing target 871–872, new target 896–903)
- Test: harness (append pure block)

**Interfaces:**
- Produces: `canonicalBonusSections(q: { source?: string | null; quoteType?: string | null; status?: string | null }, sections: SpecSection[]): SpecSection[]` — returns `withBonusLines(sections, idCounterFrom(sections))` when `bonusRulesApply(q, sections)`, else `sections` unchanged.

- [ ] **Step 1: Failing test.**

```ts
import { canonicalBonusSections as bnCanon } from "@/lib/estimate-bonus/canonical";
{
  const s = [{ id: "s1", name: "R", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "P", desc: "P", qty: 1, unit: "ea", cost: 100, price: 150 }] }] as EstimatorSpecSection[];
  ok(bnCanon({ source: "estimator", status: "draft" }, s)[0].items.some((x) => x.bonus === "estimator"), "#bonus canonical: draft save gains the 2% line");
  ok(bnCanon({ source: "estimator", status: "won" }, s) === s, "#bonus canonical: won save untouched");
  ok(bnCanon({ source: "portal-catalog", status: "draft" }, s) === s, "#bonus canonical: portal untouched");
  const tampered = bnCanon({ source: "estimator", status: "draft" }, s).map((x) => ({ ...x, items: x.items.map((i) => (i.bonus ? { ...i, price: 1 } : i)) }));
  ok(bnCanon({ source: "estimator", status: "draft" }, tampered)[0].items.find((x) => x.bonus === "estimator")!.price === 3, "#bonus canonical: a tampered bonus price is recomputed (2% of 150 = 3)");
}
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** `canonical.ts`:

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";
import { bonusRulesApply, idCounterFrom, withBonusLines } from "./rules";

/** Every server write of an Estimator quote's sections passes through here. */
export function canonicalBonusSections(
  q: { source?: string | null; quoteType?: string | null; status?: string | null },
  sections: SpecSection[],
): SpecSection[] {
  return bonusRulesApply(q, sections) ? withBonusLines(sections, idCounterFrom(sections)) : sections;
}
```

In `saveQuoteAction`, right after the sections are sanitized/normalized (before `settleRewardCredit`), apply it with `{ source: <the source this save will persist — the value from sourceForSave at line 401>, quoteType: prior?.quoteType, status: <the status this save persists, prior?.status for an existing quote, "draft" for a new one> }`. Read the surrounding code to use the exact local variable names. In `placeSystemInEstimate`, apply it to `mergedSections` with the target quote's `source/quoteType/status`, and to the new-target sections with `{ source: "estimator", status: "draft" }`.

- [ ] **Step 4: Run.** PASS; tsc clean.

- [ ] **Step 5: Commit.** `git commit -am "feat(estimator): server re-derives bonus lines on every estimator save"`

---

### Task 7: Estimator client — live lines, locked rows, cost summary

**Files:**
- Modify: `src/app/(app)/estimator/page.tsx` (`initialFrom()` 113–252) — add `bonusSource: q?.source ?? "estimator"` and `bonusQuoteType: q?.quoteType ?? "system"` to the initial props (and its type)
- Modify: `src/app/(app)/estimator/use-estimator-state.ts` — effect after the `sections` state (~line 233); guards in `patchItem` 1418, `setItemPrice` 1426, `setItemExtSell` 1433, `moveItem` 1438, `inc`/`dec`/`setQty` 1448–1454, `removeItem` 1455–1463, `setMarginAll` 1466, `setSystemMargin` 1476
- Modify: `src/app/(app)/estimator/section-card.tsx` — row loop 974–1444
- Modify: `src/app/(app)/estimator/review-cost-summary.tsx` — footer 72–74

**Interfaces:**
- Consumes: `bonusRulesApply`, `withBonusLines` (Task 1), `isBonusItem` (flags), the existing `nextId()` in the hook.

- [ ] **Step 1: Effect.** In `use-estimator-state.ts`, after the `sections` state and the `sectionsRef` sync, add:

```ts
  // Estimator bonuses: keep each system's 5% / 2% lines current. Runs after
  // every sections change (all writers, including setSectionsState callers);
  // withBonusLines returns the same array when nothing changes, so this
  // settles in one pass. Writes setSectionsState directly so it never
  // un-marks a built system.
  useEffect(() => {
    if (!bonusRulesApply({ source: initial.bonusSource, quoteType: initial.bonusQuoteType, status }, sections)) return;
    const next = withBonusLines(sections, nextId);
    if (next !== sections) setSectionsState(next);
  }, [sections, status]);
```

Use the hook's real `status` state and `nextId` names (search the file). If `nextId` is declared after this point, place the effect after it.

- [ ] **Step 2: Guards.** In each listed handler, make the operation a no-op for a bonus line: look the item up and `return` (or skip it inside the map) when `isBonusItem(item)`. `setMarginAll` / `setSystemMargin`: skip bonus lines in their reprice map (the effect recomputes them).

- [ ] **Step 3: Locked rows.** In `section-card.tsx`'s row loop, render a bonus line as a read-only row: same grid `cols`, greyed (`color: "#8c919c"`, `background: "#f7f8fa"`), a `🔒` before the description, a small tag `Internal — never shown to the customer`, qty/unit cost/unit sell/ext sell as plain text (`fmt(...)`), and an empty actions cell (no star, no ↑/↓, no ×). Implement as an early `if (isBonusItem(it)) return (<div key={it.id} …>…</div>);` at the top of the `visible.map` callback.

- [ ] **Step 4: Cost summary.** In `review-cost-summary.tsx`, compute `pkg = Σ sections' package-line sell` and `est = Σ estimator-line sell` over non-alternate sections (use `isPackageBonusItem` / `isEstimatorBonusItem`), and add a line under the existing footer: `5% package bonus {fmt(pkg)} · 2% estimator bonus {fmt(est)}`. Render only when either is > 0.

- [ ] **Step 5: Verify.** tsc clean; `npm run test:specs` ALL PASSED; `npx next build` succeeds (catches a client file importing a server module). Browser check is in Task 10.

- [ ] **Step 6: Commit.** `git commit -am "feat(estimator): live bonus lines in the Estimator; locked rows; cost summary"`

---

### Task 8: Send & track — bonus card (split + alternates + record)

**Files:**
- Create: `src/app/(app)/estimator/steps/bonus-card.tsx` (client component)
- Modify: `src/app/(app)/estimator/steps/send-step.tsx` — render `<BonusCard …/>` beside the status select block (72–127)
- Modify: `src/app/(app)/estimator/use-estimator-state.ts` — `changeStatus` (1233–1262) passes `{ alternatesTaken }` to `setStatusAction` when moving to `won`; hold `alternatesTaken` state seeded from `defaultAlternatesTaken(sections, initial.clientResponses)` (add `clientResponses` and `bonusRecord` and `estimatorBonusSplit` to `initial` in `page.tsx` if not already there)

**Interfaces:**
- Consumes: `saveBonusSplitAction`, `saveBonusAlternatesAction` (Task 5), `normalizeSplit`, `BonusRecord`, `BonusSplit` (Task 4); the hook's existing approver flag (search `QuoteNextStep` props for the `approve` permission boolean).

- [ ] **Step 1: Build the card.** Props: `{ quoteId: string | null; canApprove: boolean; owner: string; preparedBy: string; split: BonusSplit; onSplit(leadPct: number): void; alternates: { id: string; name: string }[]; taken: string[]; onTaken(ids: string[]): void; estimatorBonus: number; record: BonusRecord | null; status: string }`. Content (pk-card, title "Estimator bonus", subtitle "Internal — never shown to the customer"):
  - "2% on this estimate: {fmt(estimatorBonus)}" (Σ estimator-line sell over non-alternate sections + taken alternates).
  - Split row when owner and preparedBy differ (case-insensitive) and both are non-blank: `Lead {owner} [number input 0–100]% · Prepared by {preparedBy} {100 − lead}%`. Input disabled unless `canApprove && quoteId`; on blur/Enter call `onSplit`.
  - Alternates checklist when `alternates.length`: "Alternates the customer took" with one checkbox per alternate; disabled unless `canApprove` (before Won, anyone may tick — it's only applied when an approver marks Won; after Won, ticking calls `saveBonusAlternatesAction`).
  - When `record`: "Recorded at Won {date}: {fmt(record.estimatorBonus)}", one line per credit `{name} ({role}) {pct}% — {fmt(amount)}`, and `(removed user)` when `userId` is null and no user matches.
- [ ] **Step 2: Wire.** In the hook add `bonusSplit` state (from `initial.estimatorBonusSplit` via `normalizeSplit`), `onSplit` → optimistic set + `saveBonusSplitAction(loadedId, n)`; `taken` state; `changeStatus("won")` passes `{ alternatesTaken: taken }`. Render the card in `send-step.tsx` only when `bonusRulesApply`-eligible (`isBonusEligibleQuote({ source: initial.bonusSource, quoteType: initial.bonusQuoteType })`).
- [ ] **Step 3: Verify.** tsc, test:specs, `npx next build`.
- [ ] **Step 4: Commit.** `git commit -am "feat(estimator): Send & track bonus card — split, alternates taken, recorded credits"`

---

### Task 9: Reports → Estimator bonuses

**Files:**
- Create: `src/lib/estimate-bonus/report.ts` (pure)
- Create: `src/app/(app)/reports/estimator-bonuses/page.tsx`
- Create: `src/app/(app)/reports/estimator-bonuses/export/route.ts`
- Modify: `src/app/(app)/reports/page.tsx` — a link "Estimator bonuses →" in the page header
- Test: harness (append pure block)

**Interfaces:**
- Produces:
  ```ts
  export type BonusReportRow = { quoteId: string; number: string; name: string; customer: string; wonAt: number; month: string; person: string; role: "lead" | "prepared"; pct: number; sellTotal: number; amount: number };
  export function chicagoMonth(ms: number): string; // "2026-10"
  export function bonusReportRows(
    quotes: { id: string; estimateNumber?: string | null; name: string; customer?: string | null; status: string; bonusRecord?: BonusRecord | null }[],
    viewer: { id: string; name: string; isAdmin: boolean },
    filter: { from: number; to: number; person?: string | null },
  ): BonusReportRow[];               // sorted by person, then wonAt
  export function bonusReportCsv(rows: BonusReportRow[]): string;
  ```

- [ ] **Step 1: Failing test.**

```ts
import { bonusReportRows as bnRows, chicagoMonth as bnMonth, bonusReportCsv as bnCsv } from "@/lib/estimate-bonus/report";
{
  const rec = (credits: { name: string; userId: string | null; role: "lead" | "prepared"; pct: number; amount: number }[], wonAt: number) =>
    ({ wonAt, sellTotal: 10000, estimatorBonus: 200, packageBonusCost: 70, alternatesTaken: [], credits });
  const qs = [
    { id: "q1", estimateNumber: "EST-1001", name: "A", customer: "C", status: "won", bonusRecord: rec([{ name: "Jeff", userId: "u1", role: "lead", pct: 50, amount: 100 }, { name: "Sam", userId: "u2", role: "prepared", pct: 50, amount: 100 }], Date.UTC(2026, 9, 5)) },
    { id: "q2", name: "B", customer: "C", status: "won", bonusRecord: rec([{ name: "Sam", userId: null, role: "lead", pct: 100, amount: 200 }], Date.UTC(2026, 9, 6)) },
    { id: "q3", name: "C", status: "lost", bonusRecord: null },
  ];
  const all = { from: 0, to: Date.UTC(2027, 0, 1) };
  ok(bnRows(qs, { id: "u1", name: "Jeff", isAdmin: true }, all).length === 3, "#bonus report: admin sees every credit");
  const sam = bnRows(qs, { id: "u2", name: "Sam", isAdmin: false }, all);
  ok(sam.length === 2 && sam.every((r) => r.person === "Sam"), "#bonus report: non-admin sees own rows (by id, or by name when unresolved)");
  ok(bnRows(qs, { id: "u1", name: "Jeff", isAdmin: false }, { ...all, person: "Sam" }).every((r) => r.person === "Jeff"), "#bonus report: non-admin can't filter to someone else");
  ok(bnMonth(Date.UTC(2026, 9, 1, 3)) === "2026-09", "#bonus report: month is Chicago time");
  ok(bnCsv(sam).split("\n")[0].includes("Amount"), "#bonus report: CSV header");
}
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `report.ts`.** Rows: for each quote with `status === "won"` and a `bonusRecord` whose `wonAt` is within `[from, to)`, one row per credit. Visibility: admin → all (then apply `filter.person` by case-insensitive name); non-admin → credits where `userId === viewer.id || (!userId && name.trim().toLowerCase() === viewer.name.trim().toLowerCase())`, ignoring `filter.person`. `chicagoMonth`: `new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).format(ms)` → `"2026-09"`. CSV columns: Person, Role, Month, Estimate #, Estimate, Customer, Won, Split %, Estimate total, Amount — quote any field containing a comma, quote or newline.
- [ ] **Step 4: Page.** `requireUser()`; `isAdmin = can("manage_users", me.roles)`; date range from `searchParams` (`from`, `to` as `YYYY-MM-DD`, default Jan 1 this year → now, Chicago); person filter chips (admins only) built from the rows' distinct persons; load won quotes with the store's existing list function (search `src/lib/stores/quotes.ts` for a list/all export; filter `status === "won"`). Table grouped by person with per-person subtotal and per-month subtotals inside, styled like `src/app/(app)/rewards/page.tsx` (`pk-content`, `pk-card`, CSS-grid header). A "Download CSV" link to `export?from=…&to=…&person=…`.
- [ ] **Step 5: CSV route.** Same visibility rules, `text/csv` headers exactly like `src/app/(app)/catalog/rack-data/export/route.ts`, filename `estimator-bonuses.csv`, `cache-control: no-store`.
- [ ] **Step 6: Run + build.** test:specs ALL PASSED; tsc; `npx next build`.
- [ ] **Step 7: Commit.** `git commit -am "feat(reports): Estimator bonuses report + CSV"`

---

### Task 10: Docs, gates, browser check

**Files:**
- Modify: `DECISIONS.md` (append), `PUNCHLIST.md` (append item), `AGENTS.md` (phase status entry)

- [ ] **Step 1: Numbers.** `git fetch origin && git show origin/main:PUNCHLIST.md | grep -oE "^## [0-9]+\." | tail -1` and `git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+\." | sort -t D -k2 -n | tail -1`. Use the next free punch number and D-numbers.
- [ ] **Step 2: DECISIONS entries** (one each): rules + supersedes D136/D251's 5%; the "sent quotes already on the new rules keep updating, legacy sent / won / lost frozen" rule (spec said only "sent stay"; sent quotes remain editable today, so a frozen bonus would go stale); the 2% line is not `labor` and splits mat/lab like #267; locked rows at the end of the table stand in for the spec's footer line; `bonusRecord` written only when the quote carries bonus lines; names resolve to user ids by unique case-insensitive match; a project keeps its pool after the quote leaves Won.
- [ ] **Step 3: PUNCHLIST item** "Estimator bonuses — 5% package + 2% estimator" with Done notes and Jeff-gated follow-ups: check who holds `approve` (they edit splits), confirm a real estimate's new price on prod, decide later whether the rates belong in Settings.
- [ ] **Step 4: AGENTS.md** phase-status entry in the house style (one paragraph).
- [ ] **Step 5: Gates** (baseline first on origin/main per the verification-gate protocol): `npx tsc --noEmit -p .`; `npm run test:specs` (report PASS count); `npm run test:smoke` (dev server stopped first); `npx eslint` on changed files vs baseline. Report real numbers.
- [ ] **Step 6: Browser check** on a scratch datadir (never `.data/pglite`): create an estimate with a labor system and a materials-only system → both locked rows appear and update when a price changes; Customer review document shows no bonus row and the totals match; Send & track shows the card; mark Won → Reports → Estimator bonuses lists both people.
- [ ] **Step 7: Commit.** `git commit -am "docs: estimator bonuses (D…, #…)"`
