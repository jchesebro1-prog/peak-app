/** Portal unit pricing rules (#242, spec §2.1). Pure; sell-only outputs. */
export type PriceInput = { cost: number | null | undefined; list: number | null | undefined; note?: string | null; pricedAt?: number | null };
export type PriceRuleOpts = { margin: number; staleCostMonths: number; now: number };
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
  const m = o.margin > 0 && o.margin < 1 ? o.margin : 0;
  return { unitPrice: cost ? cents(cost / (1 - m)) : cents(list), por: false };
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
