// SERVER ONLY — prices portal carts from the cached catalog index, whose parts
// carry cost; resolves the customer's tier + margin. Never import into a client
// component. No "server-only" package in this repo (same comment-only
// convention as src/lib/curtain-pricing.ts).
import { totals } from "@/app/(app)/estimator/pricing";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import type { AssemblyRole } from "@/lib/fixture-assemblies";
import { freightPctForMiles } from "@/lib/freight-rule";
import { loadFreightRule, loadPortalRules } from "@/lib/freight-rule-load";
import type { CartLine, PortalCart } from "@/lib/portal-cart-types";
import { fixtureComponentPart, portalIndex, type IndexedFixture, type IndexedPart, type PortalIndex } from "@/lib/portal-catalog-index";
import { fixtureUnitPrice, unitPriceFor, type FixtureComponentInput, type PriceRuleOpts } from "@/lib/portal-price-rules";
import { quoteMode } from "@/lib/portal-quote-mode";
import { resolveTier } from "@/lib/pricing-tiers";
import { travelForId } from "@/lib/stores/customers";

/**
 * Server-canonical portal pricing (#242, spec §2 + §8). The browser never
 * computes or submits a price: every cart view, generate, accept and refresh
 * re-prices here. `PricedCart.sections` is the staff-side Estimator spec
 * (it carries cost) and is NEVER sent to the client — pages send
 * `sellView(priced)` only.
 *
 * Freight uses the Estimator's own math (§8.1): the distance rule sets each
 * section's `freightPct`, and `totals()` charges it on the section's cost
 * base, so the same quote opened in the Estimator shows the same freight.
 */

/** Internal — never serialized to a customer. */
export type PortalPricingContext = {
  customerId: string;
  margin: number;
  tier: string;
  tierMargin: number;
  staleCostMonths: number;
  now: number;
};

export async function pricingContextFor(session: { customerId: string; name: string }): Promise<PortalPricingContext> {
  const [t, rules] = await Promise.all([resolveTier(session.customerId, session.name), loadPortalRules()]);
  return {
    customerId: session.customerId,
    margin: t.margin,
    tier: t.tier,
    tierMargin: t.margin,
    staleCostMonths: rules.staleCostMonths,
    now: Date.now(),
  };
}

export type SellLine = {
  lineId: string;
  kind: "part" | "fixture" | "curtain";
  title: string;
  sku: string | null;
  qty: number;
  unit: string;
  unitPrice: number | null;
  extPrice: number | null;
  por: boolean;
  porReason?: string;
  unavailable: boolean;
  detail?: string;
};

export type PricedCart = {
  lines: SellLine[];
  subtotal: number;
  freight: { amount: number; miles: number | null; pct: number; unknown: boolean };
  total: number;
  mode: "firm" | "review";
  reason: string | null;
  /** Staff-side spec (carries cost) — NEVER sent to the client. */
  sections: SpecSection[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

function ruleOpts(ctx: PortalPricingContext): PriceRuleOpts {
  return { margin: ctx.margin, staleCostMonths: ctx.staleCostMonths, now: ctx.now };
}

/** A positive, finite line quantity; anything else prices as 1. */
function lineQty(q: unknown): number {
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function freightFor(
  customerId: string,
  locationId: string | null
): Promise<{ pct: number; miles: number | null; unknown: boolean }> {
  const rule = await loadFreightRule();
  if (!locationId) return { pct: rule.capPct, miles: null, unknown: true };
  const t = await travelForId(customerId, locationId);
  const miles = t && t.source !== "none" && typeof t.miles === "number" ? t.miles : null;
  const f = freightPctForMiles(miles, rule);
  return { pct: f.pct, miles, unknown: f.atCapUnknown };
}

/** Unit sell for one part a customer can quote; null = not quotable (hidden,
 *  deleted, or unknown). */
export async function priceSku(
  sku: string,
  ctx: PortalPricingContext
): Promise<{ unitPrice: number | null; por: boolean; porReason?: string } | null> {
  const part = (await portalIndex()).parts.get(sku);
  if (!part) return null;
  const u = unitPriceFor(part, ruleOpts(ctx));
  return u.porReason ? { unitPrice: u.unitPrice, por: u.por, porReason: u.porReason } : { unitPrice: u.unitPrice, por: u.por };
}

const SLOT_ROLE: Record<string, AssemblyRole> = {
  lightEngine: "fixture",
  lens: "lens",
  mounting: "mount",
  power: "power",
  data: "data",
  accessories: "accessory",
};

function unavailableLine(l: CartLine, qty: number, sku: string | null): SellLine {
  return { lineId: l.lineId, kind: l.kind, title: "No longer available", sku, qty, unit: "ea", unitPrice: null, extPrice: null, por: false, unavailable: true };
}

type Priced = { sell: SellLine; item: Omit<SpecItem, "id"> | null; section: "equip" | "fixt" | "drape" };

function pricePart(l: CartLine, qty: number, ix: PortalIndex, o: PriceRuleOpts): Priced {
  const part: IndexedPart | undefined = l.sku ? ix.parts.get(l.sku) : undefined;
  if (!part) return { sell: unavailableLine(l, qty, l.sku ?? null), item: null, section: "equip" };
  const u = unitPriceFor(part, o);
  const sell: SellLine = {
    lineId: l.lineId,
    kind: "part",
    title: part.desc || part.sku,
    sku: part.sku,
    qty,
    unit: part.unit,
    unitPrice: u.unitPrice,
    extPrice: u.unitPrice == null ? null : cents(u.unitPrice * qty),
    por: u.por,
    ...(u.porReason ? { porReason: u.porReason } : {}),
    unavailable: false,
  };
  const item: Omit<SpecItem, "id"> = {
    sku: part.sku,
    desc: part.desc || part.sku,
    qty,
    unit: part.unit,
    cost: part.cost,
    price: u.unitPrice ?? 0,
    ...(part.mfr ? { manufacturer: part.mfr } : {}),
    ...(part.mpn ? { manufacturerPartNumber: part.mpn } : {}),
    ...(u.por ? { por: true } : {}),
  };
  return { sell, item, section: "equip" };
}

function optionQty(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function withQty(label: string, qty: number): string {
  return qty === 1 ? label : `${label} ×${qty}`;
}

function priceFixtureLine(l: CartLine, qty: number, ix: PortalIndex, o: PriceRuleOpts): Priced {
  const fx: IndexedFixture | undefined = l.fixtureId ? ix.fixtures.get(l.fixtureId) : undefined;
  if (!fx) return { sell: unavailableLine(l, qty, null), item: null, section: "fixt" };
  const opts = l.fixtureOptions ?? {};
  const chosen = fx.lines.map((line) => ({ line, qty: line.required ? line.qty : optionQty(opts[`${line.slot}:${line.sku}`]) }));
  const components: FixtureComponentInput[] = chosen.map(({ line, qty: q }) => {
    const part = fixtureComponentPart(ix, line.sku);
    return {
      sku: line.sku,
      qty: q,
      required: line.required,
      quotable: !!part,
      cost: part?.cost ?? 0,
      list: part?.list ?? 0,
      note: part?.note ?? "",
      pricedAt: part?.pricedAt ?? null,
    };
  });
  const priced = fixtureUnitPrice(components, o);
  if (priced.unavailable) return { sell: unavailableLine(l, qty, fx.lightEngineSku), item: null, section: "fixt" };

  const included = chosen.filter((c) => c.line.required && c.qty > 0).map((c) => withQty(c.line.label, c.qty));
  const addOns = chosen.filter((c) => !c.line.required && c.qty > 0 && !!fixtureComponentPart(ix, c.line.sku)).map((c) => withQty(c.line.label, c.qty));
  const detail = [included.length ? `Included: ${included.join(", ")}` : "", addOns.length ? `Add-ons: ${addOns.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");

  const sell: SellLine = {
    lineId: l.lineId,
    kind: "fixture",
    title: fx.label,
    sku: fx.lightEngineSku,
    qty,
    unit: "ea",
    unitPrice: priced.unitPrice,
    extPrice: priced.unitPrice == null ? null : cents(priced.unitPrice * qty),
    por: priced.por,
    ...(priced.por ? { porReason: "component" } : {}),
    unavailable: false,
    ...(detail ? { detail } : {}),
  };
  const engine = ix.parts.get(fx.lightEngineSku);
  const item: Omit<SpecItem, "id"> = {
    sku: fx.lightEngineSku,
    desc: fx.label,
    qty,
    unit: "ea",
    cost: priced.cost,
    price: priced.unitPrice ?? 0,
    fixture: true,
    // #242 Task 13: carried so Copy to new quote / a firm refresh can rebuild
    // this line's cart entry (cartLinesFromSpec) — a fixture's SpecItem.sku is
    // its light engine's, not the fixture record's own id.
    fixtureId: fx.id,
    ...(l.fixtureOptions ? { fixtureOptions: { ...l.fixtureOptions } } : {}),
    ...(engine?.mfr ? { manufacturer: engine.mfr } : {}),
    components: chosen
      .filter((c) => c.qty > 0 && !!fixtureComponentPart(ix, c.line.sku))
      .map((c) => {
        const part = fixtureComponentPart(ix, c.line.sku)!;
        const u = unitPriceFor(part, o);
        return { sku: part.sku, label: c.line.label, role: SLOT_ROLE[c.line.slot] ?? "other", qty: c.qty, unit: part.unit, cost: part.cost, price: u.unitPrice ?? 0 };
      }),
    ...(priced.por ? { por: true } : {}),
  };
  return { sell, item, section: "fixt" };
}

/** Unit sell for one fixture assembly with the given add-on quantities
 *  (keyed `slot:sku`, as on a cart line; `{}` = included parts only — the
 *  catalog tile's price). The same code path `priceCart` prices a fixture
 *  line with. null = the fixture isn't offered (unknown, or a required
 *  component is no longer quotable). */
export async function priceFixture(
  fixtureId: string,
  options: Record<string, number>,
  ctx: PortalPricingContext
): Promise<{ unitPrice: number | null; por: boolean } | null> {
  const ix = await portalIndex();
  const line: CartLine = { lineId: "", kind: "fixture", fixtureId, fixtureOptions: options, qty: 1 };
  const p = priceFixtureLine(line, 1, ix, ruleOpts(ctx));
  if (p.sell.unavailable) return null;
  return { unitPrice: p.sell.unitPrice, por: p.sell.por };
}

function priceCurtain(l: CartLine, qty: number): Priced {
  const c = l.curtainInputs;
  if (!c) return { sell: unavailableLine(l, qty, null), item: null, section: "drape" };
  const name = (c.name || "").trim() || "Curtain";
  const fabric = (c.fabricName || "").trim() || "Fabric to confirm";
  const size = `${c.width || "?"}'W × ${c.height || "?"}'H, ${c.fullness || "0"}% fullness`;
  const spec = `${fabric}, ${size}`;
  const sell: SellLine = {
    lineId: l.lineId,
    kind: "curtain",
    title: name,
    sku: null,
    qty,
    unit: "ea",
    unitPrice: null,
    extPrice: null,
    por: true,
    porReason: "curtain",
    unavailable: false,
    // The cart's curtain summary (#242 Task 12): "30'W × 18'H, 50% fullness — IFR Velour".
    detail: `${size} — ${fabric}`,
  };
  const item: Omit<SpecItem, "id"> = {
    sku: "CRT-REQ",
    desc: `${name} — ${spec} (customer request — price on request)`,
    qty,
    unit: "ea",
    cost: 0,
    price: 0,
    curtain: true,
    por: true,
    // #242 Task 13: the raw request, carried so Copy to new quote / a
    // refresh can rebuild this line's cart entry (cartLinesFromSpec) — the
    // formatted `desc` above is customer copy, not machine-readable.
    curtainInputs: { ...c },
  };
  return { sell, item, section: "drape" };
}

const SECTIONS = [
  { key: "equip", id: "SEC-EQUIP", name: "Equipment & supplies" },
  { key: "fixt", id: "SEC-FIXT", name: "Fixtures" },
  { key: "drape", id: "SEC-DRAPE", name: "Drapery & soft goods" },
] as const;

export async function priceCart(cart: PortalCart, ctx: PortalPricingContext): Promise<PricedCart> {
  const [ix, freight] = await Promise.all([portalIndex(), freightFor(cart.customerId, cart.locationId)]);
  const o = ruleOpts(ctx);

  const lines: SellLine[] = [];
  const buckets: Record<(typeof SECTIONS)[number]["key"], SpecItem[]> = { equip: [], fixt: [], drape: [] };
  let nextId = 1;
  for (const l of cart.lines ?? []) {
    const qty = lineQty(l.qty);
    const p = l.kind === "fixture" ? priceFixtureLine(l, qty, ix, o) : l.kind === "curtain" ? priceCurtain(l, qty) : pricePart(l, qty, ix, o);
    lines.push(p.sell);
    if (p.item) buckets[p.section].push({ id: nextId++, ...p.item });
  }

  const sections: SpecSection[] = SECTIONS.filter((s) => buckets[s.key].length).map((s) => ({
    id: s.id,
    name: s.name,
    kind: "materials",
    mfr: "",
    freightPct: freight.pct,
    freightAuto: false,
    freightMiles: freight.miles,
    items: buckets[s.key],
  }));

  // `mat` = sell of non-labor, non-option lines — the materials subtotal
  // before freight. Labor rides only INSIDE a fixture item (its components),
  // never as a labor item of its own, so it equals `rev`.
  const t = totals(sections, 0);
  const subtotal = cents(t.mat);
  const amount = cents(t.fr);
  const m = quoteMode(lines.filter((x) => !x.unavailable));
  return {
    lines,
    subtotal,
    freight: { amount, miles: freight.miles, pct: freight.pct, unknown: freight.unknown },
    total: cents(subtotal + amount),
    mode: m.mode,
    reason: m.reason,
    sections,
  };
}

/**
 * What a customer may see of a priced cart. Freight is amount + miles ONLY:
 * the amount is `pct` × the section's COST base (Estimator math, spec §8.1),
 * so exposing the % (or the at-cap "unknown" flag that pins it) would let a
 * customer back out cost and margin. `pct`/`unknown` stay on the staff-side
 * `PricedCart`.
 */
export type CustomerQuoteView = {
  lines: SellLine[];
  subtotal: number;
  freight: { amount: number; miles: number | null };
  total: number;
  mode: "firm" | "review";
  reason: string | null;
};

/** The customer-facing view: an explicit whitelist, so nothing staff-side
 *  (sections, cost, freight %) can ride along by accident. */
export function sellView(p: PricedCart): CustomerQuoteView {
  return {
    lines: p.lines.map((l) => ({ ...l })),
    subtotal: p.subtotal,
    freight: { amount: p.freight.amount, miles: p.freight.miles },
    total: p.total,
    mode: p.mode,
    reason: p.reason,
  };
}

/**
 * Rebuild cart lines from a portal-catalog quote's saved spec (#242 Task 13,
 * spec §4.4/§4.5/§4.6) — the one mapping Copy to new quote and a pricing
 * refresh both use. Reads exactly what priceCart wrote onto each SpecItem
 * (fixtureId/fixtureOptions, curtainInputs) — an item missing what it needs
 * (a pre-#242-Task-13 fixture/curtain line saved before these fields
 * existed) is dropped rather than guessed at. Availability (hidden/deleted
 * part, unknown fixture) is NOT checked here — callers re-price the result
 * through `priceCart` and read `unavailable` off the priced lines, so there
 * is exactly one place that decides what's still quotable.
 */
export function cartLinesFromSpec(sections: readonly SpecSection[]): Array<Omit<CartLine, "lineId">> {
  const out: Array<Omit<CartLine, "lineId">> = [];
  for (const s of sections) {
    for (const it of s.items) {
      if (it.fixture) {
        if (it.fixtureId) out.push({ kind: "fixture", fixtureId: it.fixtureId, fixtureOptions: it.fixtureOptions, qty: it.qty });
      } else if (it.curtain) {
        if (it.curtainInputs) out.push({ kind: "curtain", curtainInputs: it.curtainInputs, qty: it.qty });
      } else if (it.sku) {
        out.push({ kind: "part", sku: it.sku, qty: it.qty });
      }
    }
  }
  return out;
}
