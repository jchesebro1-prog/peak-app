/* ONE-SHOT (#367 Task 2): records margin-era prices into docs/markup/parity-baseline.json. Run once on the
   untouched engines, commit the JSON; Task 3 deletes this script (the names it imports are renamed there). */
import { mkdirSync, writeFileSync } from "node:fs";
import { catalogAddPrice, customPartSell, repriceForTier } from "../src/app/(app)/estimator/tier-reprice";
import { buildLaborItems, computeLabor, repriceAtMargin, systemMargin, totals } from "../src/app/(app)/estimator/pricing";
import type { LaborDraft, SpecSection } from "../src/app/(app)/estimator/types";
import { compute as flame } from "../src/lib/flametest-engine";
import { computeEstimate as repair } from "../src/lib/repair-engine";
import { computeEstimate as inspection } from "../src/lib/inspection-engine";
import { curtainCost, fabricSellPerSqft } from "../src/lib/curtain-pricing";
import { curtainPrice } from "../src/lib/design/curtain-pricing";
import { sellFromCost } from "../src/lib/design/equipment-map";
import { unitPriceFor } from "../src/lib/portal-price-rules";
import { travelLineAmount } from "../src/lib/travel-plan";
import { printedLift, travelLineShare } from "../src/lib/service-pricing";
import { CASE_COSTS, CASE_MARGINS, CURTAIN_CASES, FLAME_CASES, INSPECTION_CASES, LABOR_DRAFT, LABOR_DRAFT_22, REPAIR_CASES, SECTIONS, laborRate } from "./markup-parity-cases";

const cases: Record<string, unknown> = {};
const grid = (f: (c: number, m: number) => unknown) => CASE_COSTS.map((c) => CASE_MARGINS.map((m) => f(c, m)));

cases.catalogAddPrice = grid((c, m) => catalogAddPrice(c, 0, m));
cases.customPartSell = CASE_COSTS.map((c) => customPartSell(c));
cases.repriceAt = grid((c, m) => repriceAtMargin(c, m).price);
cases.sellFromCost = grid((c, m) => sellFromCost(c, m));
cases.portalUnit = grid((c, m) => unitPriceFor({ cost: c, list: 0 }, { margin: m, staleCostMonths: 0, now: 0 }).unitPrice);
cases.curtainPrice = grid((c, m) => curtainPrice(c, m));
cases.travelLine = grid((c, m) => travelLineAmount(c * 10, m));
cases.travelShareLegacy = grid((c, m) => travelLineShare({ flightTotal: c * 10, total: c * 30, margin: m }));
cases.printedLift = CASE_MARGINS.map((m) => printedLift({ lift: { count: 2, rate: 450 } }, m));
cases.curtains = CURTAIN_CASES.map((k) => ({ id: k.id, cost: curtainCost(k.spec as never, k.rates, k.margin), perSqft: fabricSellPerSqft(k.rates, k.margin) }));
const pick = (r: Record<string, unknown>) => ({ totalRaw: r.totalRaw, autoTotal: r.autoTotal, total: r.total, cost: r.cost, marginAmount: r.marginAmount, effectiveMargin: r.effectiveMargin, serviceMargin: r.serviceMargin, partsSell: r.partsSell, liftSell: r.liftSell, liftLine: r.liftLine, baseApplied: r.baseApplied, minApplied: r.minApplied, calloutApplied: r.calloutApplied });
cases.flame = FLAME_CASES.map((k) => ({ id: k.id, ...pick(flame(k.opts as never, k.rates) as never) }));
cases.repair = REPAIR_CASES.map((k) => ({ id: k.id, ...pick(repair(k.opts as never, k.rates) as never) }));
cases.inspection = INSPECTION_CASES.map((k) => ({ id: k.id, ...pick(inspection(k.opts as never, k.rates) as never) }));
const laborCase = (draft: unknown) => {
  const l = computeLabor(draft as LaborDraft, laborRate);
  let n = 100;
  return { totalPrice: l.totalPrice, items: buildLaborItems(l, "Rigging", () => n++).map((it) => ({ cost: it.cost, price: it.price })) };
};
cases.labor = laborCase(LABOR_DRAFT);
cases.labor22 = laborCase(LABOR_DRAFT_22);
const secs = SECTIONS as unknown as SpecSection[];
cases.totals = totals(secs, 0);
cases.systemMargin = secs.map((s) => systemMargin(s));
cases.tierReprice = repriceForTier(secs, 0.3, 0.2).sections.map((s) => s.items.map((it) => it.price));

mkdirSync("docs/markup", { recursive: true });
writeFileSync("docs/markup/parity-baseline.json", JSON.stringify({ capturedAt: new Date().toISOString(), commit: process.env.CAPTURE_COMMIT || "", cases }, null, 2) + "\n");
console.log("wrote docs/markup/parity-baseline.json", Object.keys(cases).length, "case groups");
