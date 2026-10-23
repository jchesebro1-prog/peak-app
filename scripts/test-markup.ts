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
import { finishPrice, sellAtMarkup, sliderPct, typedPriceWarning } from "../src/lib/service-pricing";
import { knobPctFrom } from "../src/lib/tier-seed";
import { sellFromCost } from "../src/lib/design/equipment-map";
import { curtainPrice } from "../src/lib/design/curtain-pricing";
import { unitPriceFor } from "../src/lib/portal-price-rules";
import { convertProjectDoc, convertQuoteDoc, hydrateDoc } from "../src/lib/markup/doc-basis";
import { markupSettingsPatch, withoutBasisKeys } from "../src/lib/markup/settings";
import baseline from "../docs/markup/parity-baseline.json";
import {
  CASE_COSTS, CASE_MARGINS, CURTAIN_CASES, FLAME_CASES, INSPECTION_CASES, LABOR_DRAFT, LABOR_DRAFT_22, REPAIR_CASES, SECTIONS, laborRate,
} from "./markup-parity-cases";

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
  // Task 5 — curtains, the Grid / Equipment map and the portal.
  ok(sellFromCost(100, 0.43) === 143 && sellFromCost(100, 25) === 143 && curtainPrice(100, 0.25) === 125,
    "markup: sellFromCost guard falls back to 43 %; curtains price at their markup");
  ok(unitPriceFor({ cost: 100, list: 0 }, { markup: 0.25, staleCostMonths: 0, now: 0 }).unitPrice === 125, "markup: portal unit price");
  // Task 7 — review carry-over: a service save with no `markup` field falls back to the service markup, never the 5 % clamp.
  {
    const { readFileSync } = await import("node:fs");
    const files = ["flame-tests", "repairs", "inspections"].map((d) => readFileSync(`src/app/(app)/${d}/quote/actions.ts`, "utf8"));
    ok(files.every((f) => /const rawMarkup = formData\.get\("markup"\);\s*const markupPts = rawMarkup == null \|\| rawMarkup === "" \? NaN : Number\(rawMarkup\);/.test(f)
      && !f.includes('Number(formData.get("markup"))')), "markup: a missing markup field on a service save is NaN (falls back), not 0 (5 %)");
  }
  // Task 7 — doc conversion
  const legacy = {
    id: "Q-1", margin: 0.3, tierMargin: 0.2, value: 1000,
    spec: { sections: [{ id: "s", items: [{ id: 1, cost: 70, price: 100 }], laborGroups: { g1: { lines: 1, draft: { margin: "30" } } } }] },
    flameTest: { rates: { margin: 0.3 }, total: 825 },
    repair: { rates: { margin: 0.3, partsMargin: 0.25 }, partsMargin: 0.25, total: 875 },
    revisions: [{ rev: 1, margin: 0.3, tierMargin: 0.3, value: 900, flameTest: { rates: { margin: 0.3 } } }],
  };
  const q = convertQuoteDoc(legacy) as typeof legacy & { pricingBasis: string };
  ok(q.pricingBasis === "markup" && near(q.margin, 0.3 / 0.7) && near(q.tierMargin, 0.25), "markup: a legacy quote converts margin + tierMargin exactly and is stamped");
  ok(q.spec.sections[0].laborGroups.g1.draft.margin === "42.8571" && near(q.flameTest.rates.margin, 0.3 / 0.7) && near(q.repair.rates.partsMargin, 1 / 3) && near(q.repair.partsMargin, 1 / 3),
    "markup: labor drafts, service rates and repair parts markup convert");
  ok(near(q.revisions[0].margin, 0.3 / 0.7) && near(q.revisions[0].flameTest.rates.margin, 0.3 / 0.7), "markup: frozen revisions convert too");
  ok(q.value === 1000 && q.spec.sections[0].items[0].price === 100 && q.flameTest.total === 825 && q.revisions[0].value === 900, "markup: no sell amount moves");
  ok(legacy.margin === 0.3, "markup: conversion never mutates its input");
  ok(convertQuoteDoc(q) === q, "markup: a stamped doc is returned as-is (never converted twice)");
  ok(near((convertProjectDoc({ id: "P-1", margin: 0.36 }) as { margin: number }).margin, 0.36 / 0.64), "markup: a legacy project converts its margin");
  ok(hydrateDoc("leads", { id: "L-1", margin: 0.3 }).margin === 0.3, "markup: other collections are untouched");
  const inPlace = { id: "Q-2", margin: 0.2 };
  ok(hydrateDoc("quotes", inPlace) === inPlace && near(inPlace.margin, 0.25), "markup: the doc-store hook converts in place (no per-read clone)");
  // Task 7 — settings conversion
  const p1 = markupSettingsPatch({ "tiers.base": 30, "tiers.gold": 20, "system.freightPct": 5 }, ["tiers.base", "tiers.gold", "tiers.copper"], true);
  ok(!!p1 && p1["tiers.base"] === 43 && p1["tiers.gold"] === 25 && !("tiers.copper" in p1) && !("system.freightPct" in p1) && p1._pricingBasis === "markup",
    "markup: a whole-percent rules blob converts and rounds only the stored margin keys");
  ok(JSON.stringify((p1 as Record<string, unknown>)._marginBackup) === JSON.stringify({ "tiers.base": 30, "tiers.gold": 20 }), "markup: the old values are kept as a backup");
  const p2 = markupSettingsPatch({ margin: 0.3, partsMargin: 0.27, laborRate: 75 }, ["margin", "partsMargin"], false);
  ok(!!p2 && p2.margin === 0.43 && p2.partsMargin === 0.37 && !("laborRate" in p2), "markup: a fraction blob converts and rounds");
  ok(markupSettingsPatch({ _pricingBasis: "markup", margin: 0.43 }, ["margin"], false) === null, "markup: a stamped blob is left alone");
  const p3 = markupSettingsPatch({}, ["margin"], false);
  ok(!!p3 && Object.keys(p3).join() === "_pricingBasis", "markup: an empty blob still gets the stamp (so a later admin edit is never re-converted)");
  ok(JSON.stringify(withoutBasisKeys({ margin: 0.43, _pricingBasis: "markup", _marginBackup: { margin: 0.3 } })) === JSON.stringify({ margin: 0.43 }), "markup: getters strip the stamp + backup");
}

export async function markupDbChecks(ok: Ok) {
  const { getDb } = await import("../src/db");
  const { DOC_TABLES } = await import("../src/db/doc-tables");
  const { getDoc, patchDoc, listDocsFiltered } = await import("../src/db/doc-store");
  const { eq, inArray } = await import("drizzle-orm");
  const quotes = await import("../src/lib/stores/quotes");
  const { getFlametestRates, value } = await import("../src/lib/stores/pricing");
  const { resolveTier } = await import("../src/lib/pricing-tiers");
  const db = await getDb();
  const t = DOC_TABLES.quotes;
  const id = "Q-TESTmarkup-1";
  const flameId = "Q-TESTmarkup-2";
  const now = Date.now();
  const rawDoc = async (qid: string) => (await db.select().from(t).where(eq(t.id, qid)))[0].doc as Record<string, unknown>;
  // A margin-era row written raw (bypassing every store), exactly as production holds it.
  await db.insert(t).values({ id, doc: { id, name: "markup legacy", status: "sent", value: 1000, margin: 0.3, tierMargin: 0.2,
    spec: { sections: [{ id: "s", items: [{ id: 1, cost: 70, price: 100, qty: 10 }] }] } }, rev: 1, updatedAt: now, receivedAt: now, review: { state: "new" }, deleted: false })
    .onConflictDoNothing();
  const read = await quotes.get(id);
  ok(!!read && read.pricingBasis === "markup" && Math.abs(read.margin - 0.3 / 0.7) < 1e-12 && read.value === 1000, "markup db: a raw margin-era quote reads as markup, sell unchanged");
  const raw1 = await rawDoc(id);
  ok(raw1.margin === 0.3 && !("pricingBasis" in raw1), "markup db: a read alone writes nothing");
  await patchDoc("quotes", id, (d: Record<string, unknown>) => { d.name = "markup legacy (touched)"; });
  const raw2 = await rawDoc(id);
  ok(raw2.pricingBasis === "markup" && Math.abs((raw2.margin as number) - 0.3 / 0.7) < 1e-12 && raw2.value === 1000, "markup db: the next write stores it stamped, converted once");
  const again = await getDoc<Record<string, unknown> & { id: string }>("quotes", id);
  ok(Math.abs((again!.margin as number) - 0.3 / 0.7) < 1e-12, "markup db: a stamped doc is never converted twice");
  const proj = await listDocsFiltered<Record<string, unknown> & { id: string }>("quotes", { fields: ["margin"] });
  ok(proj.some((r) => r.id === id && Math.abs((r.margin as number) - 0.3 / 0.7) < 1e-12), "markup db: a field projection carries the stamp (no double conversion)");
  // Review carry-over: the service builders spot an untouched knob with samePts(saved, stamp) — the quote's
  // tierMargin and its frozen rates.margin must convert to the SAME float.
  await db.insert(t).values({ id: flameId, doc: { id: flameId, name: "markup legacy flame", status: "draft", quoteType: "flame_test", value: 825, margin: 0.3,
    tierMargin: 0.3, flameTest: { rates: { margin: 0.3, laborRate: 75 }, total: 825 } }, rev: 1, updatedAt: now, receivedAt: now, review: { state: "new" }, deleted: false })
    .onConflictDoNothing();
  const fl = (await quotes.get(flameId)) as unknown as { tierMargin: number; flameTest: { rates: { margin: number }; total: number } } | null;
  ok(!!fl && fl.tierMargin === marginToMarkup(0.3) && fl.flameTest.rates.margin === fl.tierMargin && Math.abs(fl.tierMargin - 0.3 / 0.7) < 1e-15 && fl.flameTest.total === 825,
    "markup db: a legacy flame quote's tierMargin and rates.margin convert to the same float (samePts stays untouched)");
  const fresh = await quotes.create({ name: "markup new", margin: 0.43 });
  ok(fresh.pricingBasis === "markup" && (await quotes.get(fresh.id))!.margin === 0.43, "markup db: a new quote is born stamped");
  ok((await rawDoc(fresh.id)).pricingBasis === "markup", "markup db: the stamp is stored with a new quote");
  const fr = await getFlametestRates();
  ok(fr.margin === 0.43 && !("_pricingBasis" in fr), "markup db: flame default is 43 % markup and the getter strips the stamp");
  ok((await value("tiers.gold")) === 25 && (await resolveTier(null)).markup === 0.43, "markup db: tier defaults are markup");
  await db.delete(t).where(inArray(t.id, [id, flameId, fresh.id]));
}

/* ---- Price parity (#367 Task 8): every margin-era output in docs/markup/parity-baseline.json, reproduced by the
   markup engines with each margin input converted by marginToMarkup. Same dollars to the cent, with ONE exception
   (see tieOk): a 1-unit drift where the margin-era unrounded value sat on an exact half. ---- */
type Path = Array<string | number>;
type Raw = { raw: number; unit: number } | null;
type Diff = { group: string; path: Path; got: unknown; want: unknown };

/** Leaf-wise comparison of what the engine returned against the baseline (only the baseline's keys are checked). */
function walkDiffs(group: string, got: unknown, want: unknown, path: Path, out: Diff[]) {
  if (want && typeof want === "object") {
    const g = (got && typeof got === "object" ? got : {}) as Record<string, unknown>;
    for (const k of Object.keys(want as object)) walkDiffs(group, g[k], (want as Record<string, unknown>)[k], [...path, Array.isArray(want) ? Number(k) : k], out);
    return;
  }
  if (typeof want === "number" && typeof got === "number") { if (Math.abs(got - want) > 1e-6) out.push({ group, path, got, want }); return; }
  if (got !== want) out.push({ group, path, got, want });
}

/** A drift is a tie only if it is exactly one `unit` and the margin-era unrounded value sat within 1e-6 of a half unit. */
function tieOk(d: Diff, r: Raw): boolean {
  if (!r || typeof d.got !== "number" || typeof d.want !== "number") return false;
  if (Math.abs(Math.abs(d.got - d.want) - r.unit) > 1e-9) return false;
  const half = (Math.floor(r.raw / r.unit) + 0.5) * r.unit;
  return Math.abs(r.raw - half) <= 1e-6;
}

export async function markupParityChecks(ok: Ok) {
  const B = baseline.cases as unknown as Record<string, unknown>;
  const { catalogAddPrice, customPartSell, repriceForTier } = await import("../src/app/(app)/estimator/tier-reprice");
  const { repriceAtMarkup, computeLabor, buildLaborItems, totals, systemMarkup } = await import("../src/app/(app)/estimator/pricing");
  const { compute: flame } = await import("../src/lib/flametest-engine");
  const { computeEstimate: repair } = await import("../src/lib/repair-engine");
  const { computeEstimate: inspection } = await import("../src/lib/inspection-engine");
  const { curtainCost, fabricSellPerSqft } = await import("../src/lib/curtain-pricing");
  const { travelLineAmount } = await import("../src/lib/travel-plan");
  const { printedLift, travelLineShare } = await import("../src/lib/service-pricing");
  const mk = marginToMarkup;
  ok(tieOk({ group: "t", path: [], got: 133.71, want: 133.7 }, { raw: 133.705, unit: 0.01 }) && !tieOk({ group: "t", path: [], got: 133.71, want: 133.7 }, { raw: 133.7123, unit: 0.01 })
    && !tieOk({ group: "t", path: [], got: 133.72, want: 133.7 }, { raw: 133.705, unit: 0.01 }), "markup parity: the tie rule allows only an exact one-cent drift at an exact half");
  const diffs: Diff[] = [];
  const ties: string[] = [];
  const drift: string[] = [];
  const nAllowed = { n: 0 };
  /** Compare a group; `rawFor` names the margin-era unrounded value behind a drifting leaf (tie rule). */
  const same = (group: string, got: unknown, want: unknown, rawFor?: (path: Path) => { raw: Raw; why: string } | null) => {
    const out: Diff[] = [];
    walkDiffs(group, got, want, [], out);
    for (const d of out) {
      const r = rawFor ? rawFor(d.path) : null;
      const name = `${group}${d.path.map((p) => `[${p}]`).join("")}`;
      if (r && tieOk(d, r.raw)) { ties.push(`${name}: ${r.why} → ${d.want} became ${d.got} (unrounded ${r.raw!.raw})`); nAllowed.n++; continue; }
      diffs.push(d);
      drift.push(`${name}: got ${JSON.stringify(d.got)} want ${JSON.stringify(d.want)}`);
    }
  };
  const near1 = (name: string, got: number, want: number) => { if (Math.abs(got - want) > 1e-9) drift.push(`${name}: ${got} vs ${want}`); };

  // ---- the cost × margin grid (7 costs × 8 margins) ----
  const grid = (f: (c: number, k: number) => unknown) => CASE_COSTS.map((c) => CASE_MARGINS.map((m) => f(c, mk(m))));
  const gridRaw = (scale: number, unit: number) => (p: Path) => {
    const c = CASE_COSTS[Number(p[0])], m = CASE_MARGINS[Number(p[1])];
    return c == null || m == null ? null : { raw: { raw: (c * scale) / (1 - m), unit }, why: `cost ${c}${scale === 1 ? "" : ` ×${scale}`} at margin ${m}` };
  };
  same("catalogAddPrice", grid((c, k) => catalogAddPrice(c, 0, k)), B.catalogAddPrice, gridRaw(1, 0.01));
  // customPartSell is not asserted: it now prices at the fixed 43 % default (153.85 → 154 at $100), listed below as an expected move.
  same("repriceAt", grid((c, k) => repriceAtMarkup(c, k).price), B.repriceAt, gridRaw(1, 0.01));
  same("sellFromCost", grid((c, k) => sellFromCost(c, k)), B.sellFromCost, gridRaw(1, 0.01));
  same("portalUnit", grid((c, k) => unitPriceFor({ cost: c, list: 0 }, { markup: k, staleCostMonths: 0, now: 0 }).unitPrice), B.portalUnit, gridRaw(1, 0.01));
  same("curtainPrice", grid((c, k) => curtainPrice(c, k)), B.curtainPrice, gridRaw(1, 0.01));
  same("travelLine", grid((c, k) => travelLineAmount(c * 10, k)), B.travelLine, gridRaw(10, 1));
  same("travelShareLegacy", grid((c, k) => travelLineShare({ flightTotal: c * 10, total: c * 30, margin: k })), B.travelShareLegacy, gridRaw(10, 1));
  same("printedLift", CASE_MARGINS.map((m) => printedLift({ lift: { count: 2, rate: 450 } }, mk(m))), B.printedLift, (p) => {
    const m = CASE_MARGINS[Number(p[0])]; return m == null ? null : { raw: { raw: 900 / (1 - m), unit: 1 }, why: `lift 2 × 450 at margin ${m}` };
  });
  const curtainGot = CURTAIN_CASES.map((k) => ({ id: k.id, cost: curtainCost(k.spec as never, k.rates, mk(k.margin)), perSqft: fabricSellPerSqft(k.rates, mk(k.margin)) }));
  same("curtains", curtainGot, B.curtains, (p) => {
    const i = Number(p[0]); const k = CURTAIN_CASES[i]; const want = (B.curtains as Array<{ cost: { costEach: number } }>)[i];
    return p[1] === "cost" && p[2] === "priceEach" && k && want ? { raw: { raw: want.cost.costEach / (1 - k.margin), unit: 0.01 }, why: `${k.id}, cost each ${want.cost.costEach} at margin ${k.margin}` } : null;
  });

  // ---- the three service engines ----
  const svcRates = (r: Record<string, number>) => ({ ...r, margin: mk(r.margin), ...(r.partsMargin != null ? { partsMargin: mk(r.partsMargin) } : {}) });
  const pick = (r: Record<string, unknown>) => ({
    totalRaw: r.totalRaw, autoTotal: r.autoTotal, total: r.total, cost: r.cost, marginAmount: r.marginAmount, partsSell: r.partsSell, liftSell: r.liftSell, liftLine: r.liftLine,
    baseApplied: r.baseApplied, minApplied: r.minApplied, calloutApplied: r.calloutApplied,
  });
  type Case = { id: string; opts: unknown; rates: Record<string, number> };
  const engines: Array<[string, Case[], (o: never, r: never) => unknown, string]> = [
    ["flame", FLAME_CASES as Case[], flame as never, "flame"],
    ["repair", REPAIR_CASES as Case[], repair as never, "repair"],
    ["inspection", INSPECTION_CASES as Case[], inspection as never, "inspection"],
  ];
  for (const [grp, cases, run] of engines) {
    const want = B[grp] as Array<Record<string, unknown> & { id: string; effectiveMargin: number; serviceMargin?: number; totalRaw: number }>;
    ok(want.length === cases.length, `markup parity: ${grp} baseline has one row per case`);
    const results = cases.map((k) => run(k.opts as never, svcRates(k.rates) as never) as Record<string, unknown>);
    same(grp, results.map((r, i) => ({ id: cases[i].id, ...pick(r) })), want.map(({ effectiveMargin: _e, serviceMargin: _s, ...rest }) => rest), (p) => {
      // The only unrounded dollar value behind a drifting cent is the baseline's own totalRaw; the engine cases' cents are
      // derived from it. A tie needs a raw that sits on a half cent — none of the baseline rows do, so this stays strict.
      const w = want[Number(p[0])]; return w ? { raw: { raw: w.totalRaw, unit: 0.01 }, why: `${w.id} ${String(p[1])}` } : null;
    });
    want.forEach((b, i) => {
      near1(`${grp}[${b.id}] effectiveMarkup`, (results[i].effectiveMarkup as number), mk(b.effectiveMargin));
      if (b.serviceMargin != null) near1(`${grp}[${b.id}] serviceMarkup`, (results[i].serviceMarkup as number), mk(b.serviceMargin));
    });
  }

  // ---- Estimator labor, totals, system markup, tier re-price ----
  const laborGot = (draft: Record<string, unknown>, pct: number) => {
    const l = computeLabor({ ...draft, margin: String(mk(pct) * 100) } as never, laborRate);
    let n = 100;
    return { totalPrice: l.totalPrice, items: buildLaborItems(l, "Rigging", () => n++).map((it) => ({ cost: it.cost, price: it.price })) };
  };
  const laborRaw = (pct: number, want: unknown) => (p: Path) => {
    const it = p[0] === "items" ? (want as { items: Array<{ cost: number }> }).items[Number(p[1])] : null;
    return it && p[2] === "price" ? { raw: { raw: it.cost / (1 - pct), unit: 0.01 }, why: `labor item cost ${it.cost} at margin ${pct}` } : null;
  };
  same("labor", laborGot(LABOR_DRAFT, 0.3), B.labor, laborRaw(0.3, B.labor));
  same("labor22", laborGot(LABOR_DRAFT_22, 0.22), B.labor22, laborRaw(0.22, B.labor22));
  const secs = SECTIONS as never;
  const t = totals(secs, 0) as unknown as Record<string, number>;
  const bt = B.totals as Record<string, number>;
  same("totals$", { mat: t.mat, lab: t.lab, fr: t.fr, rev: t.rev, cost: t.cost, grand: t.grand }, { mat: bt.mat, lab: bt.lab, fr: bt.fr, rev: bt.rev, cost: bt.cost, grand: bt.grand });
  near1("totals markup", t.markup, mk(bt.margin));
  (B.systemMargin as number[]).forEach((m, i) => near1(`systemMarkup[${i}]`, systemMarkup((SECTIONS as never[])[i]), mk(m)));
  same("tierReprice", repriceForTier(secs, mk(0.3), mk(0.2)).sections.map((s: { items: Array<{ price: number }> }) => s.items.map((it) => it.price)), B.tierReprice, (p) => {
    const it = SECTIONS[Number(p[0])]?.items[Number(p[1])]; return it ? { raw: { raw: it.cost / (1 - 0.2), unit: 0.01 }, why: `tier re-price of cost ${it.cost} to margin 0.2` } : null;
  });

  ok(drift.length === 0, `markup parity: every margin-era price reproduces to the cent under markup${drift.length ? " — " + drift.slice(0, 8).join(" | ") : ""}`);
  if (drift.length > 8) console.log("markup parity — ALL drifts:\n  " + drift.join("\n  "));

  // The knob shows the markup as a whole-percent string. A saved quote re-saved without touching the knob must not change
  // its price: the round trip may differ by a float ulp, but never by a cent. So check closeness plus price parity.
  const knobKs = [0.43, 0.37, 0.28, 0.25, 0.18, 0.11, 0.05, 0.3 / 0.7, 0.27 / 0.73, 0.22 / 0.78];
  const knobCosts = [99.99, 575, 2515, 10000, 123456.78];
  const knobBad = knobKs.filter((k) => {
    const k2 = Number(String(knobPctFrom(k))) / 100;
    if (!(Math.abs(k2 - k) < 1e-12)) return true;
    return knobCosts.some((cost) => {
      const a = finishPrice(sellAtMarkup(cost, k), cost);
      const b = finishPrice(sellAtMarkup(cost, k2), cost);
      return a.total !== b.total || a.autoTotal !== b.autoTotal;
    });
  });
  ok(knobBad.length === 0, `markup parity: knobPctFrom round-trips through its string within 1e-12 with identical prices${knobBad.length ? " — fails for " + knobBad.join(", ") : ""}`);

  // Expected, listed (never asserted equal): what new pricing does at the ROUNDED settings, and each allowed half-cent tie.
  const listed = [
    `Base $1,000 cost: ${Math.round((1000 / 0.7) * 100) / 100} → ${catalogAddPrice(1000, 0, 0.43)}`,
    `Custom part $100: 153.85 → ${customPartSell(100)}`,
    ...ties.map((x) => `float tie (exactly one cent/dollar off, margin-era value on an exact half): ${x}`),
  ];
  console.log("markup parity — expected rounding moves:\n  " + listed.join("\n  "));
  console.log(`markup parity — ${diffs.length} drift(s), ${nAllowed.n} allowed tie(s)`);
}

if (require.main === module) {
  let fails = 0;
  const ok: Ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
  markupPureChecks(ok).then(() => markupParityChecks(ok)).then(() => { console.log(fails ? `${fails} FAIL` : "markup pure: ALL PASSED"); process.exit(fails ? 1 : 0); });
}
