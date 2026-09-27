// SERVER ONLY — reads the portal catalog index (whose parts carry cost) and
// prices through portal-pricing.ts. Never import into a client component; it
// hands the browser sell-only `PartDetail`s (see portal-part-view.ts).
import type { PortalSession } from "@/lib/portal";
import { fixtureComponentPart, portalIndex, type PortalIndex } from "@/lib/portal-catalog-index";
import { PORTAL_EXPIRED_COPY, portalBrowseAllowed, PORTAL_BROWSE_RATE_COPY, tilesFor } from "@/lib/portal-catalog-browse";
import {
  cleanFixtureOptions,
  GOES_WITH_MAX,
  PART_UNAVAILABLE_COPY,
  toFixtureDetailVM,
  toPartDetailVM,
  type PartDetail,
  type PartDocVM,
} from "@/lib/portal-part-view";
import { priceFixture, priceSku, pricingContextFor, type PortalPricingContext } from "@/lib/portal-pricing";
import type { SearchEntry } from "@/lib/portal-search";
import { rateLimit } from "@/lib/rate-limit";
import { unitPriceFor } from "@/lib/portal-price-rules";

/**
 * The part sidebar's data (#242 Task 11, spec §3.2). `partDetailFor` takes a
 * pricing context the CALLER resolved — the page from `resolvePortalViewer`
 * (so a team preview works), the action from `portalSession()` — never a
 * customer id from the browser.
 */

function docsFor(ix: PortalIndex, ids: readonly string[]): PartDocVM[] {
  const out: PartDocVM[] = [];
  for (const id of ids) {
    const m = ix.docMeta.get(id);
    if (m) out.push({ id, kind: m.kind, title: m.title || (m.kind === "specsheet" ? "Spec sheet" : "Datasheet"), pdf: m.pdf });
  }
  return out;
}

/** A part SKU or `fixture:<id>` → its sidebar detail at `ctx`'s prices, or
 *  null when the customer can't see it (hidden, labor, deleted, unknown). */
export async function partDetailFor(ctx: PortalPricingContext, key: string): Promise<PartDetail | null> {
  if (typeof key !== "string" || !key || key.length > 200) return null;
  const ix = await portalIndex();

  if (key.startsWith("fixture:")) {
    const fx = ix.fixtures.get(key.slice("fixture:".length));
    if (!fx) return null;
    const engine = ix.parts.get(fx.lightEngineSku);
    const o = { margin: ctx.margin, staleCostMonths: ctx.staleCostMonths, now: ctx.now };
    const docIds = [...new Set(fx.lines.filter((l) => l.required).flatMap((l) => ix.parts.get(l.sku)?.datasheetIds ?? []))];
    return toFixtureDetailVM(
      fx,
      engine?.mfr ?? "",
      await priceFixture(fx.id, {}, ctx),
      (sku) => {
        const p = fixtureComponentPart(ix, sku);
        return p ? unitPriceFor(p, o) : null;
      },
      { images: engine?.imageIds ?? [], docs: docsFor(ix, docIds) }
    );
  }

  const part = ix.parts.get(key);
  if (!part) return null;
  const accessories: SearchEntry[] = [];
  for (const sku of part.accessories) {
    const a = ix.parts.get(sku);
    if (!a || sku === part.sku) continue;
    accessories.push({ key: a.sku, kind: "part", title: a.desc || a.sku, sku: a.sku, mfr: a.mfr, category: a.category, haystack: "", browsable: true, rank: 0 });
    if (accessories.length >= GOES_WITH_MAX) break;
  }
  const [price, goesWith] = await Promise.all([priceSku(part.sku, ctx), tilesFor(accessories, ix, ctx)]);
  return toPartDetailVM(part, price, docsFor(ix, part.datasheetIds), goesWith);
}

export type PartDetailResult = { ok: true; detail: PartDetail } | { ok: false; error: string };

/** The `partDetail` action's body — `session` MUST come from `portalSession()`. */
export async function partDetailActionFor(session: PortalSession | null, key: unknown): Promise<PartDetailResult> {
  if (!session) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!portalBrowseAllowed(session, false)) return { ok: false, error: PORTAL_BROWSE_RATE_COPY };
  const detail = await partDetailFor(await pricingContextFor(session), typeof key === "string" ? key : "");
  return detail ? { ok: true, detail } : { ok: false, error: PART_UNAVAILABLE_COPY };
}

export type FixturePriceResult = { ok: true; unitPrice: number | null; por: boolean; unavailable: boolean } | { ok: false; error: string };

const PRICE_LIMIT = 240;
const PRICE_WINDOW_MS = 60_000;

/**
 * The live configurator price (`priceFixtureOptions` action body). `session`
 * comes from `resolvePortalViewer` (the grant cookie, or a signed-in team
 * member's preview — `preview` true). Options are cleaned against the
 * fixture's own add-ons; the price runs the same path as the cart.
 */
export async function priceFixtureOptionsFor(
  session: PortalSession | null,
  preview: boolean,
  fixtureId: unknown,
  options: unknown
): Promise<FixturePriceResult> {
  if (!session) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const key = preview ? "portal-price:preview:" + session.customerId : "portal-price:" + session.grantId;
  if (!rateLimit(key, PRICE_LIMIT, PRICE_WINDOW_MS).ok) return { ok: false, error: PORTAL_BROWSE_RATE_COPY };
  const ix = await portalIndex();
  const fx = typeof fixtureId === "string" ? ix.fixtures.get(fixtureId) : undefined;
  if (!fx) return { ok: false, error: PART_UNAVAILABLE_COPY };
  const p = await priceFixture(fx.id, cleanFixtureOptions(fx, options), await pricingContextFor(session));
  if (!p) return { ok: true, unitPrice: null, por: false, unavailable: true };
  const unitPrice = !p.por && typeof p.unitPrice === "number" ? p.unitPrice : null;
  return { ok: true, unitPrice, por: unitPrice == null, unavailable: false };
}
