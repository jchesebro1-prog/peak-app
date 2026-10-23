/* Markup pricing (docs/superpowers/specs/2026-10-23-markup-pricing-design.md) — harness checks.
   `markupPureChecks` needs no database; `markupDbChecks` needs the test DB (test:specs runs both).
   Pure half alone: `npx tsx scripts/test-markup.ts`. */
import type { Ok } from "./test-inbox-org";
import {
  DEFAULT_MARKUP, MARKUP_MAX, PRICING_BASIS, costFromSell, fmtMarkupPct, legacyTwinOf, marginToMarkup,
  markupOf, markupPctString, markupToMargin, roundMarkupPct, sameWholeMarkup, sellAt,
} from "../src/lib/markup";
import { catalogAddPrice, customPartSell, isAtTierSeed, repriceForTier } from "../src/app/(app)/estimator/tier-reprice";
import { copySectionForTarget } from "../src/app/(app)/estimator/copy-system";
import { sliderPct, typedPriceWarning } from "../src/lib/service-pricing";
import { knobPctFrom } from "../src/lib/tier-seed";

const near = (a: number | null | undefined, b: number, eps = 1e-9) => a != null && Math.abs(a - b) <= eps;

export async function markupPureChecks(ok: Ok) {
  ok(PRICING_BASIS === "markup" && MARKUP_MAX === 19 && DEFAULT_MARKUP === 0.43, "markup: constants");
  ok(near(marginToMarkup(0.3), 0.3 / 0.7) && near(marginToMarkup(0.2), 0.25) && near(marginToMarkup(0), 0), "markup: margin → markup (30 % = 42.857 %, 20 % = 25 %)");
  ok(marginToMarkup(0.95) === 19 && marginToMarkup(1) === 19 && marginToMarkup(Number.NaN) === 0, "markup: margin ≥ 0.95 clamps to 19, junk → 0");
  ok(near(marginToMarkup(-0.1), -0.1 / 1.1), "markup: a negative margin (priced below cost) stays negative");
  ok(near(markupToMargin(0.25), 0.2) && near(markupToMargin(marginToMarkup(0.37)), 0.37) && markupToMargin(Number.NaN) === 0, "markup: markup → margin round-trips");
  ok(Number.isFinite(markupToMargin(-5)), "markup: markupToMargin never returns a non-finite number");
  for (const m of [0.05, 0.1, 0.15, 0.2, 0.22, 0.27, 0.3, 0.35, 0.42]) {
    for (const cost of [0.01, 1, 9.99, 100, 1234.56, 99999.99]) {
      const a = Math.round((cost / (1 - m)) * 100) / 100;
      const b = Math.round(sellAt(cost, marginToMarkup(m)) * 100) / 100;
      if (a !== b) ok(false, `markup: sellAt parity at cost ${cost}, margin ${m}: ${a} vs ${b}`);
    }
  }
  ok(true, "markup: sellAt(cost, marginToMarkup(m)) rounds to the same cent as cost ÷ (1 − m) across the tier grid");
  ok(sellAt(100, 0.43) === 143 && sellAt(100, Number.NaN) === 100, "markup: sellAt = cost × (1 + k); junk markup sells at cost");
  ok(near(markupOf(100, 143), 0.43) && markupOf(0, 50) === null && markupOf(100, Number.NaN) === null, "markup: markupOf back-solves; no cost → null");
  ok(near(costFromSell(143, 0.43), 100) && costFromSell(50, -1) === 50, "markup: costFromSell is the inverse; 1 + k ≤ 0 → sell");
  ok(roundMarkupPct(0.428571) === 0.43 && roundMarkupPct(0.1111) === 0.11 && roundMarkupPct(0.0526) === 0.05, "markup: whole-% rounding");
  ok(sameWholeMarkup(0.428571, 0.43) && !sameWholeMarkup(0.42, 0.43), "markup: sameWholeMarkup compares whole percents");
  ok(near(legacyTwinOf(0.43), 0.3 / 0.7) && near(legacyTwinOf(0.37), 0.27 / 0.73) && near(legacyTwinOf(0.11), 0.1 / 0.9), "markup: a rounded tier's legacy twin is the exact markup it rounded from");
  ok(legacyTwinOf(0.25) === null && legacyTwinOf(0) === null && legacyTwinOf(Number.NaN) === null, "markup: an exact conversion (Gold 25 %) has no twin; 0 / junk → null");
  ok(fmtMarkupPct(0.428571) === "42.9%" && fmtMarkupPct(0.43) === "43%", "markup: one-decimal percent display");
  ok(markupPctString(0.3 / 0.7) === "42.8571" && markupPctString(0.43) === "43", "markup: labor-draft percent string (4 dp)");

  // Task 3 — legacy twin keeps old lines at the seed after the 43 % rounding.
  const old = { cost: 100, price: 142.86, labor: false } as never;
  ok(isAtTierSeed(old, 0.43) && isAtTierSeed(old, 0.3 / 0.7) && !isAtTierSeed({ cost: 100, price: 150, labor: false } as never, 0.43),
    "markup: a line priced at the old 30 % margin is still 'at the seed' for a 43 % stamp (legacy twin)");
  ok(customPartSell(100) === 154 && catalogAddPrice(100, 0, null) === 143 && catalogAddPrice(0, 75, 0.25) === 75,
    "markup: custom part 54 %, no-stamp fallback 43 %, list-only part keeps its list");
  // Fix round 1 — a converted stamp meeting its own rounded tier is the same tier (whole-percent compare).
  const oldSecs = [{ id: "s1", name: "Sys", items: [
    { id: 1, sku: "A", desc: "Material", qty: 1, cost: 100, price: 142.86 },
    { id: 2, desc: "Labor", labor: true, qty: 1, cost: 100, price: 143 },
  ] }] as never as Parameters<typeof repriceForTier>[0];
  const noop = repriceForTier(oldSecs, 0.3 / 0.7, 0.43);
  ok(noop.sections === oldSecs && noop.repriced === 0, "markup: a converted stamp (0.428571) meeting its rounded tier (0.43) is a no-op, same array");
  const moved = repriceForTier(oldSecs, 0.3 / 0.7, 0.25);
  ok(moved.sections !== oldSecs && moved.sections[0].items.find((i) => i.id === 1)?.price === 125 && moved.repriced >= 1,
    "markup: a real tier change from a converted stamp still re-prices via the legacy twin (142.86 → 125)");
  ok(isAtTierSeed({ cost: 100, price: 125, labor: false } as never, 0.25) && !isAtTierSeed({ cost: 100, price: 125.02, labor: false } as never, 0.25),
    "markup: isAtTierSeed at an exact conversion (0.25) holds at 125, fails at 125.02");
  ok(legacyTwinOf(0.25) === null, "markup: an exact conversion has no twin");
  const copied = copySectionForTarget((oldSecs as never as Array<{ items: unknown[] }>)[0] as never, {
    newSectionId: "s2", catalog: new Map(), fixtures: new Map(), sourceTierMargin: 0.3 / 0.7, targetTierMargin: 0.43,
  });
  const cm = copied.section.items.find((i) => i.id === 1);
  ok(copied.tierRepriced === 0 && copied.handPriced === 0 && cm?.price === 142.86, "markup: copying from a converted stamp to its rounded tier moves no tier and keeps every price");
  ok(typedPriceWarning(1090, 1000, 0.09)?.kind === "low-markup" && typedPriceWarning(1200, 1000, 0.2) === null,
    "markup: a typed service total under 11 % markup warns");
  ok(sliderPct(0.428571) === 43 && sliderPct(2) === 100 && sliderPct(0.01) === 10, "markup: service slider clamps 10–100");
  ok(knobPctFrom(0.3 / 0.7) === (0.3 / 0.7) * 100 && knobPctFrom(0) === null, "markup: the knob keeps a saved quote's exact points");
}

export async function markupDbChecks(_ok: Ok) {
  /* Task 7 fills this in. */
}

if (require.main === module) {
  let fails = 0;
  const ok: Ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
  markupPureChecks(ok).then(() => { console.log(fails ? `${fails} FAIL` : "markup pure: ALL PASSED"); process.exit(fails ? 1 : 0); });
}
