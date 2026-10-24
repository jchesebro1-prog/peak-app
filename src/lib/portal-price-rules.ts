/** Portal unit pricing rules (#245, spec §2.1). Pure; sell-only outputs. */
import { sellAt } from "@/lib/markup";

/** `pricedAt` = the part's own latest price date (catalog-books effectivePriceDate without the book date: when the
 *  price moved, or a priced import last confirmed it — #354 review), the clock the stale-cost rule reads. */
export type PriceInput = { cost: number | null | undefined; list: number | null | undefined; note?: string | null; pricedAt?: number | null };
/** `markup` = the customer's tier markup on cost (#367). */
export type PriceRuleOpts = { markup: number; staleCostMonths: number; now: number };
export type UnitPrice = { unitPrice: number | null; por: boolean; porReason?: "no-price" | "verify-price" | "stale-cost" };

const cents = (n: number) => Math.round(n * 100) / 100;
const pos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
const MONTH_MS = 30.4375 * 86400000;

export function unitPriceFor(p: PriceInput, o: PriceRuleOpts): UnitPrice {
  const cost = pos(p.cost);
  const list = pos(p.list);
  if (!cost && !list) return { unitPrice: null, por: true, porReason: "no-price" };
  if ((p.note || "").trim()) return { unitPrice: null, por: true, porReason: "verify-price" };
  if (o.staleCostMonths > 0 && typeof p.pricedAt === "number" && o.now - p.pricedAt > o.staleCostMonths * MONTH_MS)
    return { unitPrice: null, por: true, porReason: "stale-cost" };
  const k = Number.isFinite(o.markup) && o.markup > 0 ? o.markup : 0;
  return { unitPrice: cost ? cents(sellAt(cost, k)) : cents(list), por: false };
}

export type FixtureComponentInput = PriceInput & { sku: string; qty: number; quotable: boolean; required: boolean };

export function fixtureUnitPrice(components: FixtureComponentInput[], o: PriceRuleOpts): { unitPrice: number | null; por: boolean; unavailable: boolean; cost: number } {
  let total = 0, cost = 0, por = false, unavailable = false;
  for (const c of components) {
    if (c.qty <= 0) continue;
    if (!c.quotable) { if (c.required) unavailable = true; continue; }
    const u = unitPriceFor(c, o);
    cost += pos(c.cost) * c.qty;
    if (u.por || u.unitPrice == null) { por = true; continue; }
    total += u.unitPrice * c.qty;
  }
  return { unitPrice: por || unavailable ? null : cents(total), por, unavailable, cost: cents(cost) };
}
