# Project Discounts on Catalog Parts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an estimator record a vendor's project pricing as an extra % off Peak's cost for one catalog part on one estimate. Cost drops, sell never moves, and the discount shows in the Review spreadsheet and on the won project.

**Architecture:** One map on the estimate (`spec.projectDiscounts`, SKU → `{pct, note, by, at}`) is the source of truth. A pure, idempotent `applyProjectDiscounts` stamps `catalogCost` / `projectDiscountPct` and the discounted `cost` onto every matching line and assembly part. The client runs it after edits, and the server runs it on every save, move and copy. Freight, the 5% package bonus and tier reprice read `normalCostOf(item)`, so the customer's price is identical.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routes/actions), TypeScript, React client components, the tsx spec harness `scripts/test-review-and-spec.ts` (`ok(cond, label)`, run by `npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-10-22-project-discounts-design.md`. Punch item **#366**.

## Global Constraints

- Discount = **% off our normal cost**, `0 < pct < 100`, at most two decimals. 0, blank, or junk removes it.
- `note` ≤ 200 characters; `by` = user id, `at` = epoch ms, both stamped by the **server**.
- ≤ 200 entries per estimate.
- **Sell never changes**: `price`, `extSellOverride`, `sellOverride` and every customer-facing number are untouched.
- Freight base, package-bonus cost basis and tier reprice use **normal** cost (`catalogCost ?? cost`).
- Match on the trimmed real SKU; `isPlaceholderSku` SKUs (CUSTOM, AI, CURTAIN, CRT-n) never match.
- Lines never discounted: vendor-quote lines, allowances, curtains, labor / labor overhead / labor travel, bonus lines, the Rewards credit, and lines with cost ≤ 0.
- Internal only: no customer document, portal, share page, BOM or package page shows a discount.
- No migration (the quote is a JSONB doc). Comments carry `#366` tags like the existing `#363` ones.
- Never open `/Users/sm/Downloads/peak-app/.data/pglite` from a worktree; leave no `tsx` process running.

## File Structure

- Create `src/lib/project-discounts/rules.ts`: the pure core (types, sanitize, apply, normal cost, eligibility, hit counts, carry-over). Client-safe; no store or React imports.
- Modify `src/app/(app)/estimator/types.ts`: new optional fields on `SpecItem` and its `components` entries.
- Modify `src/app/(app)/estimator/pricing.ts`: freight base reads normal cost.
- Modify `src/lib/estimate-bonus/rules.ts`: package-bonus cost basis reads normal cost.
- Modify `src/app/(app)/estimator/tier-reprice.ts`: seed price and at-seed test read normal cost.
- Modify `src/app/(app)/estimator/actions.ts`: save sanitizes, stamps and applies; move / copy re-apply the target's map.
- Modify `src/app/(app)/estimator/page.tsx` + `estimator-data.ts` (whichever builds `initial`): load `projectDiscounts`.
- Modify `src/app/(app)/estimator/use-estimator-state.ts`: map state, set / remove actions, re-apply on line changes, include it in the save payload.
- Create `src/app/(app)/estimator/project-discounts-card.tsx`: the Build rail card + its popover editor.
- Modify `src/app/(app)/estimator/section-card.tsx`: a "−12% project" chip and a "% project" trigger on eligible catalog lines.
- Modify `src/app/(app)/estimator/parts-csv.ts`: price source + note for discounted rows.
- Modify `src/lib/stores/projects.ts` + `src/app/(app)/projects/view.tsx`: `projectPricing` snapshot at Won + a read-only card.
- Test: `scripts/test-review-and-spec.ts`, a `#366` block after the `#363` block (~line 37511) and an async check chained after `reviewSheet363Checks` (~line 11777) if it needs the DB.
- Docs: `DECISIONS.md` (from **D1280**; recompute, other branches use ≤ D1272), `PUNCHLIST.md` `## 366.`

---

### Task 1: Pure core — `src/lib/project-discounts/rules.ts`

**Files:**
- Create: `src/lib/project-discounts/rules.ts`
- Modify: `src/app/(app)/estimator/types.ts` (SpecItem ~line 60–160; `components` element type line 123)
- Test: `scripts/test-review-and-spec.ts` (new `#366 core` block)

**Interfaces — Produces:**
```ts
export type ProjectDiscount = { pct: number; note: string; by: string; at: number };
export type ProjectDiscounts = Record<string, ProjectDiscount>;   // key = trimmed real SKU
export const PROJECT_DISCOUNTS_MAX = 200;
export const PROJECT_DISCOUNT_NOTE_MAX = 200;
export function parseDiscountPct(raw: unknown): number | null;               // valid pct or null
export function sanitizeProjectDiscounts(raw: unknown): ProjectDiscounts;   // shape-clean, capped, no by/at trust issues
export function normalCostOf(it: { cost: number; catalogCost?: number }): number;
export function discountSkuOf(it: SpecItem): string;                       // "" when the line can't be discounted
export function applyProjectDiscounts(sections: SpecSection[], d: ProjectDiscounts): SpecSection[];
export function discountHits(sections: SpecSection[], d: ProjectDiscounts): Record<string, number>; // sku → lines + parts hit
export function discountableSkus(sections: SpecSection[]): { sku: string; label: string; where: string }[];
export function discountsForSections(sections: SpecSection[], d: ProjectDiscounts): ProjectDiscounts; // entries whose SKU appears
```

- [ ] **Step 1: Add the fields to `types.ts`.** On `SpecItem`:
```ts
  /** #366 — the line's normal (undiscounted) cost while a project discount applies; absent otherwise. Written only by applyProjectDiscounts. */
  catalogCost?: number;
  /** #366 — the project discount % applied to this line (mirror of spec.projectDiscounts[sku].pct). Written only by applyProjectDiscounts. */
  projectDiscountPct?: number;
```
On the `components` element type (line 123), append `catalogCost?: number; projectDiscountPct?: number`.

- [ ] **Step 2: Write the failing tests** (harness block after the `#363` block):
```ts
/* --- #366: project discounts on catalog parts (pure core) --- */
import {
  applyProjectDiscounts as pd366Apply, sanitizeProjectDiscounts as pd366Sanitize, parseDiscountPct as pd366Pct,
  normalCostOf as pd366Normal, discountHits as pd366Hits, discountableSkus as pd366Skus, discountsForSections as pd366For,
} from "@/lib/project-discounts/rules";
{
  const sec = (items: SpecItem[]): SpecSection => ({ id: "s1", name: "Lighting", items } as SpecSection);
  const line = (o: Partial<SpecItem>): SpecItem => ({ id: 1, sku: "ETC:CS40", desc: "ColorSource 40", qty: 2, unit: "ea", cost: 2000, price: 3000, ...o } as SpecItem);
  const d = { "ETC:CS40": { pct: 12, note: "Reg #4471", by: "u1", at: 1 } };

  ok(pd366Pct(12) === 12 && pd366Pct("12.5") === 12.5 && pd366Pct(0) === null && pd366Pct(100) === null && pd366Pct(-3) === null && pd366Pct("x") === null && pd366Pct(12.345) === 12.35,
    "#366 core: pct is 0 < pct < 100, two decimals; 0/100/negative/junk are null");

  const [a] = pd366Apply([sec([line({})])], d);
  ok(a.items[0].cost === 1760 && a.items[0].catalogCost === 2000 && a.items[0].projectDiscountPct === 12 && a.items[0].price === 3000,
    "#366 core: a matching line's cost drops 12% from its normal cost; catalogCost and pct stamped; price untouched");

  const twice = pd366Apply(pd366Apply([sec([line({})])], d), d);
  ok(twice[0].items[0].cost === 1760 && twice[0].items[0].catalogCost === 2000, "#366 core: applying twice is idempotent (discounts the normal cost, never the discounted one)");

  const [r] = pd366Apply([a], {});
  ok(r.items[0].cost === 2000 && !("catalogCost" in r.items[0]) && !("projectDiscountPct" in r.items[0]), "#366 core: removing the entry restores the normal cost and clears both fields");

  const skip = pd366Apply([sec([
    line({ id: 2, sku: "CUSTOM" }), line({ id: 3, vendorQuoteId: "vq1" }), line({ id: 4, allowance: true }),
    line({ id: 5, labor: true }), line({ id: 6, bonus: "package" }), line({ id: 7, curtain: true } as Partial<SpecItem>), line({ id: 8, cost: 0 }),
  ])], { ...d, CUSTOM: { pct: 50, note: "", by: "u1", at: 1 } });
  ok(skip[0].items.every((x) => !("catalogCost" in x) && (x.cost === 2000 || x.cost === 0)), "#366 core: placeholder, vendor-quote, allowance, labor, bonus, curtain and zero-cost lines are never discounted");

  const asm = line({ id: 9, sku: "fa-1", cost: 2600, fixture: true, components: [
    { sku: "ETC:CS40", label: "Console", role: "fixture", qty: 1, unit: "ea", cost: 2000, price: 0 },
    { sku: "ETC:CBL", label: "Cable", role: "accessory", qty: 2, unit: "ea", cost: 300, price: 0 },
  ] } as Partial<SpecItem>);
  const [as] = pd366Apply([sec([asm])], d);
  const c0 = as.items[0].components![0];
  ok(c0.cost === 1760 && c0.catalogCost === 2000 && as.items[0].cost === 2360 && as.items[0].catalogCost === 2600 && as.items[0].projectDiscountPct === undefined,
    "#366 core: a part inside an assembly is discounted; the line's cost drops by qty × Δ; line keeps its normal cost; no line pct");
  const [asR] = pd366Apply([as], {});
  ok(asR.items[0].cost === 2600 && !("catalogCost" in asR.items[0]) && !("catalogCost" in asR.items[0].components![0]), "#366 core: removing restores the assembly line and its part");

  ok(pd366Normal({ cost: 1760, catalogCost: 2000 }) === 2000 && pd366Normal({ cost: 50 }) === 50, "#366 core: normalCostOf = catalogCost ?? cost");

  const hits = pd366Hits([sec([line({}), line({ id: 2 }), asm])], d);
  ok(hits["ETC:CS40"] === 3, "#366 core: hits count lines and assembly parts");

  const skus = pd366Skus([sec([line({}), asm, line({ id: 10, sku: "CUSTOM" })])]);
  ok(skus.some((s) => s.sku === "ETC:CS40") && skus.some((s) => s.sku === "ETC:CBL") && !skus.some((s) => s.sku === "CUSTOM" || s.sku === "fa-1"),
    "#366 core: discountable SKUs list plain lines and assembly parts, never placeholders or the assembly's own id");

  const clean = pd366Sanitize({ "ETC:CS40": { pct: "12", note: "x".repeat(300), by: "u9", at: 5 }, "": { pct: 5 }, CUSTOM: { pct: 5 }, BAD: { pct: 0 }, __proto__: { pct: 5 } });
  ok(Object.keys(clean).join() === "ETC:CS40" && clean["ETC:CS40"].pct === 12 && clean["ETC:CS40"].note.length === 200,
    "#366 core: sanitize keeps valid entries only (blank/placeholder/zero/proto dropped), clips the note");

  ok(Object.keys(pd366For([sec([line({})])], { ...d, "X:OTHER": { pct: 5, note: "", by: "u1", at: 1 } })).join() === "ETC:CS40", "#366 core: discountsForSections keeps only SKUs the sections contain");
}
```
Note: import `SpecItem`/`SpecSection` types the way neighbouring blocks do (search the harness for `import type { SpecItem`). If a top-level `import` inside the block isn't allowed where you put it, hoist it beside the other `@/app/(app)/estimator/...` imports.

- [ ] **Step 3: Run and see them fail.** `npm run test:specs 2>&1 | grep -E "#366|Cannot find"` → module not found.

- [ ] **Step 4: Implement `rules.ts`.**
```ts
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { isPlaceholderSku } from "@/lib/specs/record-keys";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";

/** #366 — project discounts: a vendor's project pricing recorded as an extra % off Peak's
 *  normal cost for one catalog SKU on one estimate. Cost drops; sell never moves. Pure. */

export type ProjectDiscount = { pct: number; note: string; by: string; at: number };
export type ProjectDiscounts = Record<string, ProjectDiscount>;
export const PROJECT_DISCOUNTS_MAX = 200;
export const PROJECT_DISCOUNT_NOTE_MAX = 200;

const round2 = (n: number) => Math.round(n * 100) / 100;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function parseDiscountPct(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[%\s]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const v = round2(n);
  return v > 0 && v < 100 ? v : null;
}

function realSku(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s && s !== "__proto__" && !isPlaceholderSku(s) ? s : "";
}

export function sanitizeProjectDiscounts(raw: unknown): ProjectDiscounts {
  const out: ProjectDiscounts = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= PROJECT_DISCOUNTS_MAX) break;
    const sku = realSku(k);
    if (!sku || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const pct = parseDiscountPct(e.pct);
    if (pct == null) continue;
    out[sku] = {
      pct,
      note: typeof e.note === "string" ? e.note.trim().slice(0, PROJECT_DISCOUNT_NOTE_MAX) : "",
      by: typeof e.by === "string" ? e.by.slice(0, 64) : "",
      at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0,
    };
  }
  return out;
}

export function normalCostOf(it: { cost: number; catalogCost?: number }): number {
  return typeof it.catalogCost === "number" && Number.isFinite(it.catalogCost) ? it.catalogCost : it.cost;
}

/** The SKU a plain line is discounted under, or "" (never: vendor quote, allowance, curtain,
 *  labor of any kind, bonus, Rewards credit, an assembly / rack / track line itself). */
export function discountSkuOf(it: SpecItem): string {
  if (it.vendorQuoteId || it.allowance || it.curtain || it.labor || it.laborOverhead || it.laborTravel) return "";
  if (isBonusItem(it) || isRewardCreditItem(it)) return "";
  if ((it.components && it.components.length) || it.rackId || it.track || it.fixture) return "";
  return realSku(it.sku);
}

type Part = NonNullable<SpecItem["components"]>[number];

function stampPart<T extends { cost: number; catalogCost?: number; projectDiscountPct?: number }>(x: T, pct: number | null): T {
  const normal = normalCostOf(x);
  const { catalogCost: _c, projectDiscountPct: _p, ...rest } = x;
  void _c; void _p;
  if (pct == null || !(normal > 0)) return { ...(rest as T), cost: normal };
  return { ...(rest as T), catalogCost: normal, projectDiscountPct: pct, cost: round2(normal * (1 - pct / 100)) };
}

function pctFor(d: ProjectDiscounts, sku: string): number | null {
  return sku && own(d, sku) ? d[sku].pct : null;
}

export function applyProjectDiscounts(sections: SpecSection[], d: ProjectDiscounts): SpecSection[] {
  return sections.map((sec) => ({
    ...sec,
    items: sec.items.map((it) => {
      if (it.components && it.components.length && !isBonusItem(it)) {
        const normalLine = normalCostOf(it);
        let delta = 0;
        const comps = it.components.map((c: Part) => {
          const next = stampPart(c, c.qty > 0 ? pctFor(d, realSku(c.sku)) : null);
          delta += c.qty * (normalCostOf(c) - next.cost);
          return next;
        });
        const { catalogCost: _c, projectDiscountPct: _p, ...rest } = it;
        void _c; void _p;
        const d2 = round2(delta);
        return d2 > 0
          ? { ...rest, components: comps, catalogCost: normalLine, cost: round2(normalLine - d2) }
          : { ...rest, components: comps, cost: normalLine };
      }
      const sku = discountSkuOf(it);
      // A line that can't carry a discount is still restored if it once had one.
      return stampPart(it, sku ? pctFor(d, sku) : null);
    }),
  }));
}

export function discountHits(sections: SpecSection[], d: ProjectDiscounts): Record<string, number> {
  const out: Record<string, number> = {};
  const bump = (sku: string) => { if (sku && own(d, sku)) out[sku] = (out[sku] || 0) + 1; };
  for (const sec of sections) for (const it of sec.items) {
    if (it.components && it.components.length) { for (const c of it.components) if (c.qty > 0) bump(realSku(c.sku)); }
    else bump(discountSkuOf(it));
  }
  return out;
}

export function discountableSkus(sections: SpecSection[]): { sku: string; label: string; where: string }[] {
  const seen = new Map<string, { sku: string; label: string; where: string }>();
  for (const sec of sections) for (const it of sec.items) {
    if (it.components && it.components.length && !isBonusItem(it)) {
      for (const c of it.components) {
        const sku = realSku(c.sku);
        if (sku && c.cost > 0 && !seen.has(sku)) seen.set(sku, { sku, label: c.label || sku, where: `${sec.name} · in ${it.desc.split(" — ")[0]}` });
      }
      continue;
    }
    const sku = discountSkuOf(it);
    if (sku && normalCostOf(it) > 0 && !seen.has(sku)) seen.set(sku, { sku, label: it.desc || sku, where: sec.name });
  }
  return [...seen.values()];
}

export function discountsForSections(sections: SpecSection[], d: ProjectDiscounts): ProjectDiscounts {
  const hits = discountHits(sections, d);
  const out: ProjectDiscounts = {};
  for (const sku of Object.keys(hits)) out[sku] = d[sku];
  return out;
}
```
Check `SpecItem` really has `curtain`, `rackId`, `track`, `fixture`, `laborOverhead`, `laborTravel` (it does per types.ts; the `curtain` flag may be named differently — grep `curtain?:` in types.ts and use the real name).

- [ ] **Step 5: Run.** `npm run test:specs 2>&1 | grep -E "#366" ` → all PASS; `npx tsc --noEmit` → 0 errors.
- [ ] **Step 6: Commit.** `git add src/lib/project-discounts scripts/test-review-and-spec.ts "src/app/(app)/estimator/types.ts" && git commit -m "feat(estimator): #366 project discounts — pure core"`

---

### Task 2: Customer price never moves — freight, package bonus, tier reprice read normal cost

**Files:**
- Modify: `src/app/(app)/estimator/pricing.ts` (`systemFreightBase`, ~line 174)
- Modify: `src/lib/estimate-bonus/rules.ts` (`packageBonus`, ~line 45)
- Modify: `src/app/(app)/estimator/tier-reprice.ts` (`tierSeedPrice` ~106, `isAtTierSeed` ~123)
- Test: harness `#366 price` block

**Interfaces — Consumes:** `normalCostOf`, `applyProjectDiscounts` (Task 1).

- [ ] **Step 1: Failing tests.**
```ts
/* --- #366: the customer's price is identical with or without a project discount --- */
import { systemSellTotal as pd366Sell, systemFreight as pd366Freight, totals as pd366Totals, systemMargin as pd366Margin } from "@/app/(app)/estimator/pricing";
import { withBonusLines as pd366Bonus } from "@/lib/estimate-bonus/rules";
import { repriceForTier as pd366Reprice } from "@/app/(app)/estimator/tier-reprice";
{
  const mk = (round: boolean): SpecSection => ({
    id: "s1", name: "Lighting", freightPct: 3, ...(round ? { priceRound: 25 } : {}),
    items: [
      { id: 1, sku: "ETC:CS40", desc: "ColorSource 40", qty: 2, unit: "ea", cost: 2000, price: 2857.14 },
      { id: 2, sku: "LAB-INST", desc: "Install", qty: 8, unit: "hr", cost: 60, price: 95, labor: true },
    ],
  } as SpecSection);
  const d = { "ETC:CS40": { pct: 12, note: "", by: "u1", at: 1 } };
  for (const round of [false, true]) {
    const base = pd366Bonus([mk(round)]);           // check the real signature of withBonusLines and pass ids/rates the way callers do
    const disc = pd366Bonus(pd366Apply([mk(round)], d));
    ok(pd366Freight(base[0]) === pd366Freight(disc[0]), `#366 price: freight is unchanged (round ${round})`);
    ok(pd366Sell(base[0]) === pd366Sell(disc[0]), `#366 price: system sell total is unchanged (round ${round})`);
    const pb = (s: SpecSection) => s.items.find((x) => x.bonus === "package");
    const eb = (s: SpecSection) => s.items.find((x) => x.bonus === "estimator");
    ok(pb(base[0])?.price === pb(disc[0])?.price && eb(base[0])?.price === eb(disc[0])?.price, `#366 price: both bonus lines' sell unchanged (round ${round})`);
    ok(pd366Totals(base, 0).grand === pd366Totals(disc, 0).grand, `#366 price: grand total unchanged (round ${round})`);
    ok(Math.abs((pd366Totals(base, 0).cost - pd366Totals(disc, 0).cost) - 480) < 0.01, `#366 price: quote cost drops by exactly 2 × $240 (round ${round})`);
    ok(pd366Margin(disc[0]) > pd366Margin(base[0]), `#366 price: margin rises (round ${round})`);
  }
  // Tier reprice: a discounted line still sits at the seed of its NORMAL cost and re-prices from it.
  // Build a line priced at the 30% seed of its normal cost, discount it, then reprice to another tier;
  // expect the new price == the seed of 2000 at the new margin and kind "reprice", not "hand".
  // Use repriceForTier's real signature (read tier-reprice.ts) — assert result.repriced === 1 && result.handPriced === 0.
}
```
Read `withBonusLines` and `repriceForTier` signatures in their files and adapt the calls exactly. Keep every assertion.

- [ ] **Step 2: Run; expect the freight / bonus / tier assertions to FAIL.**
- [ ] **Step 3: Implement.**
  - `pricing.ts` `systemFreightBase`: `.reduce((a, x) => a + x.qty * normalCostOf(x), 0)` with a `#366` comment ("freight is figured on normal cost so a project discount never moves the customer's price"). Import `normalCostOf` from `@/lib/project-discounts/rules` (rules.ts imports only types from pricing-adjacent modules — confirm no import cycle: rules.ts must not import `pricing.ts`).
  - `estimate-bonus/rules.ts` `packageBonus`: `const cost = lines.reduce((a, it) => a + it.qty * normalCostOf(it), 0);`.
  - `tier-reprice.ts`: `tierSeedPrice` uses `sellAt(normalCostOf(it), …)`; widen the `Pick` types to include `catalogCost`.
- [ ] **Step 4: Run; all `#366` PASS; whole suite still green (`npm run test:specs | tail -3`).**
- [ ] **Step 5: Commit** `feat(estimator): #366 freight, package bonus and tier reprice read normal cost`.

---

### Task 3: Persist on the estimate — load, save, move, copy

**Files:**
- Modify: `src/app/(app)/estimator/actions.ts` — the save action (sections pipeline ~line 468–483, `spec:` write ~544), `moveSystemToEstimateAction` (~871; existing-estimate write ~983, new-estimate write ~1042), `copySystemToEstimateAction` (~1128), and the #357 line-move-to-another-estimate path (grep `moveLines` / `moveSystemToEstimateAction` callers in `move-lines-bar.tsx`).
- Modify: the estimator page loader (`page.tsx` / `estimator-data.ts`) so `initial.projectDiscounts` = `sanitizeProjectDiscounts(quote.spec.projectDiscounts)`.
- Test: harness `#366 save` block (source pins in the style of neighbouring blocks: `readFileSync` + regex) plus pure checks of a small exported helper.

**Interfaces — Produces:**
```ts
// in src/lib/project-discounts/rules.ts (add):
export function mergeDiscountsForSave(prior: ProjectDiscounts, posted: unknown, userId: string, now: number): ProjectDiscounts;
// keeps prior.by/at for unchanged entries (same pct + note), stamps userId/now on new or changed ones.
```
**Consumes:** Task 1 exports.

- [ ] **Step 1: Failing tests** — pure: `mergeDiscountsForSave({A:{pct:10,note:"",by:"u1",at:1}}, {A:{pct:10,note:""}, B:{pct:5,note:"n"}}, "u2", 99)` → A keeps `by:"u1", at:1`; B gets `by:"u2", at:99`; a posted `by`/`at` is ignored. Source pins: the save action calls `sanitizeProjectDiscounts`/`mergeDiscountsForSave` and runs `applyProjectDiscounts(` **before** `canonicalBonusSections(`; the `spec:` object includes `projectDiscounts`; `moveSystemToEstimateAction` and `copySystemToEstimateAction` call `applyProjectDiscounts(` with the **target's** map, and the new-estimate branch writes `discountsForSections(`.
- [ ] **Step 2: Run; FAIL.**
- [ ] **Step 3: Implement.**
  - Save: `const discounts = mergeDiscountsForSave(sanitizeProjectDiscounts(prior?.spec?.projectDiscounts), payload.projectDiscounts, user.id, Date.now());` then insert `.map` stage: `const discounted = Array.isArray(sellNormalized) ? applyProjectDiscounts(sellNormalized, discounts) : sellNormalized;` and feed `discounted` into `canonicalBonusSections`. Write `projectDiscounts: discounts` into `spec` only when non-empty (keep old docs byte-identical when unused). Add `projectDiscounts?: unknown` to the payload type.
  - Move/copy into an existing estimate: after the target's sections are merged, `applyProjectDiscounts(merged, sanitizeProjectDiscounts(existingSpec?.projectDiscounts))` before `canonicalBonusSections`.
  - Move to a new estimate (~1042): `const carried = discountsForSections(newSectionsRaw, sanitizeProjectDiscounts(sourceSpec?.projectDiscounts));` → `applyProjectDiscounts(…, carried)` and `spec: { …, ...(Object.keys(carried).length ? { projectDiscounts: carried } : {}) }`.
  - Loader: pass `projectDiscounts` into `initial`.
- [ ] **Step 4: Run; PASS; `npx tsc --noEmit` 0 errors.**
- [ ] **Step 5: Commit** `feat(estimator): #366 save, move and copy apply the estimate's project discounts`.

---

### Task 4: Estimator UI — state, line chip, Project discounts card

**Files:**
- Modify: `src/app/(app)/estimator/use-estimator-state.ts`
- Create: `src/app/(app)/estimator/project-discounts-card.tsx`
- Modify: `src/app/(app)/estimator/section-card.tsx` (catalog line cost cell ~line 1442–1455; new optional props)
- Modify: the Build rail that renders the Margin / Cost breakdown cards (grep `COST BREAKDOWN` / `Cost breakdown` under `src/app/(app)/estimator/steps/`) to mount the card under it.
- Test: harness `#366 ui` source pins + a static render of the card (`renderToStaticMarkup`, as other UI blocks in the harness do).

**Interfaces — Consumes:** Task 1 (`applyProjectDiscounts`, `discountHits`, `discountableSkus`, `parseDiscountPct`, `discountSkuOf`), Task 3 payload key `projectDiscounts`.
**Produces (hook):** `projectDiscounts: ProjectDiscounts`, `setProjectDiscount(sku: string, pct: number, note: string): void`, `removeProjectDiscount(sku: string): void`.

- [ ] **Step 1: Hook.** `const [projectDiscounts, setProjectDiscounts] = useState<ProjectDiscounts>(initial.projectDiscounts ?? {});`. `setProjectDiscount` writes `{pct, note, by: "", at: 0}` (server stamps) and `setSections((ss) => applyProjectDiscounts(ss, next))`; `removeProjectDiscount` deletes and re-applies. Re-apply after any line add / qty change / move inside the estimate: simplest correct hook is an effect keyed on a cheap signature of `sections` that calls `applyProjectDiscounts` only when the result differs (compare per-line `cost`), or call it inside the existing `pushItems` / add paths — pick the one that matches how `withBonusLines` is re-derived client-side (grep `withBonusLines(` in the hook and mirror it). Include `projectDiscounts` in the save payload and in whatever "unsaved changes" key Save uses (NOT `pdfDocKey` — the customer PDF doesn't change).
- [ ] **Step 2: Line chip + trigger (`section-card.tsx`).** For a line with `projectDiscountPct`, render after the cost figure: `<span title={`Normal ${fmt(it.catalogCost!)} → ${fmt(it.cost)}${note ? " · " + note : ""}`} style={chip}>−{pct}% project</span>`. For an eligible line (`discountSkuOf(it)` non-empty, `normalCostOf(it) > 0`) with no discount, a small text button `% project` (internal view only, `isInternal`) that calls `p.onProjectDiscount?.(sku)`. New optional props on the section card: `projectDiscounts?: ProjectDiscounts; onProjectDiscount?: (sku: string) => void`.
- [ ] **Step 3: Card + editor (`project-discounts-card.tsx`).** Hidden when the estimate has no discounts **and** no discountable SKU. Header "Project discounts". Rows: model/label, `pct%`, note, "N lines", Edit / Remove. "+ Add" opens the editor with a `<select>` of `discountableSkus(sections)` (label · where) — this is how a part inside an assembly gets a discount (Build lines don't list assembly parts). Editor: % input (validated with `parseDiscountPct`, inline error "Enter a % between 0 and 100"), Note (maxLength 200), Save / Cancel / Remove; Save shows "Applied to N lines" from `discountHits`. Opening from a line's `% project` pre-selects that SKU. Copy strings in one exported `PROJECT_DISCOUNT_COPY` object.
- [ ] **Step 4: Tests** — source pins: card imports nothing from `@/lib/stores/`; section-card renders `−` + `% project` chip only under `isInternal`; static render of the card with one entry shows the label, `12%`, the note and `1 line`; empty + nothing discountable renders nothing.
- [ ] **Step 5: Run gates for touched files** (`npx tsc --noEmit`, eslint on changed src files, `npm run test:specs`).
- [ ] **Step 6: Commit** `feat(estimator): #366 project discount chip, editor and Build card`.

---

### Task 5: Review spreadsheet — price source and note

**Files:** Modify `src/app/(app)/estimator/parts-csv.ts`; `src/app/(app)/estimator/use-estimator-state.ts` (`exportReviewSheet` passes the map); test harness `#366 sheet`.

- [ ] **Step 1: Failing tests.** A plain discounted line → row `source === "Catalog — project discount 12%"`, `unitCost === 1760`, notes include `"Project pricing: Reg #4471"`; an assembly part discounted → its row source is the same label; an undiscounted copy of the same SKU in the same system stays a separate row (source is in the merge key already).
- [ ] **Step 2: Implement.** `plainSource`: when `item.projectDiscountPct` is set and the base source would be `"Catalog"` or `"Catalog — sell edited"`, return `` `Catalog — project discount ${pct}%` `` (keep "sell edited" information by appending ` · sell edited` when it applies). Component rows: same label when `comp.projectDiscountPct`. Add an optional `discounts?: ProjectDiscounts` param to `partsListRows` / `reviewSheetModel` (default `{}`); when a row's SKU has a note, push `Project pricing: <note>` into `notes`. Pass `projectDiscounts` from `exportReviewSheet`.
- [ ] **Step 3: Run; PASS; all earlier #262/#363 tests unchanged.**
- [ ] **Step 4: Commit** `feat(estimator): #366 Review spreadsheet shows project discounts`.

---

### Task 6: Won project — "Project pricing to request"

**Files:** Modify `src/lib/stores/projects.ts` (`ProjectRecord` type, `fromQuote` ~line 711, `QuoteLike.spec`), `src/app/(app)/projects/view.tsx` (a card near the Bill-to block ~line 842); add a pure `projectPricingFrom(sections, discounts)` to `src/lib/project-discounts/rules.ts`; test harness `#366 project`.

**Interfaces — Produces:**
```ts
export type ProjectPricingRow = { sku: string; desc: string; qty: number; pct: number; normalCost: number; expectedCost: number; note: string };
export function projectPricingFrom(sections: SpecSection[], d: ProjectDiscounts): ProjectPricingRow[];
// one row per discounted SKU that hits ≥1 line/part; qty summed (line qty, or line qty × part qty);
// normalCost / expectedCost are per unit; skips option lines and alternate systems.
```

- [ ] **Step 1: Failing tests** for `projectPricingFrom` (two lines + one assembly part → one row, qty summed, costs per unit, note carried; an option line not counted) and a source pin that `fromQuote` sets `projectPricing` only when non-empty.
- [ ] **Step 2: Implement.** `ProjectRecord.projectPricing?: ProjectPricingRow[]`. In `fromQuote`: `const pricing = projectPricingFrom(sections, sanitizeProjectDiscounts(q.spec?.projectDiscounts)); ...(pricing.length ? { projectPricing: pricing } : {})`. Card "Project pricing to request" (internal, hidden when empty): columns Part · Qty · Discount · Normal · Expected · Note, plus one line of help: "Ask the vendor for this project pricing when ordering."
- [ ] **Step 3: Run; PASS; tsc 0.**
- [ ] **Step 4: Commit** `feat(projects): #366 project pricing to request on won projects`.

---

### Task 7: Docs, full gates, browser check

- [ ] **Step 1:** `DECISIONS.md` — from **D1280** (recompute: `git log --all -p -- DECISIONS.md | grep -o "D1[0-9]\{3\}" | sort -u | tail -1`; stay ≥ D1280). Log: the model (map + stamped lines), normal-cost readers, the "+ Add" picker as the way to discount assembly parts (spec said "on the line"; Build doesn't list assembly parts), "Unit cost on a catalog line isn't editable in Build, so the spec's Normal-cost label rule has nothing to attach to", move/copy rules.
- [ ] **Step 2:** `PUNCHLIST.md` `## 366. Project discounts on catalog parts — DONE 2026-10-22 on feat/366-project-discounts (D…)` with Built / Gates / Rollback (safe, no migration; an older build ignores the map but keeps the stamped lower `cost` — say so) / Remaining (Jeff: try one real vendor project price on production).
- [ ] **Step 3: Gates (real numbers):** `npx tsc --noEmit`; `npm run test:specs`; `npm run test:smoke`; eslint on changed src files; `npx next build`.
- [ ] **Step 4: Commit** `docs: D… / #366 — project discounts`.

---

## Self-review notes (plan author)

- Spec coverage: model/apply (T1), sell unchanged + freight/bonus/tier (T2), server re-stamp + move/copy (T3), line chip + list + editor (T4), Review spreadsheet (T5), won project card (T6), docs (T7). Customer documents need no change (they read sell only); T2's grand-total test pins it.
- Deviation logged in T7: assembly parts get discounts through the card's picker; Build has no editable Unit cost on catalog lines.
