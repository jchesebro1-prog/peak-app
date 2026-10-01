"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalSession } from "@/lib/portal";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { searchPortalCatalogFor, type SearchPortalCatalogResult } from "@/lib/portal-catalog-browse";
import {
  partDetailActionFor,
  priceCurtainOptionsFor,
  priceFixtureOptionsFor,
  type CurtainPriceResult,
  type FixturePriceResult,
  type PartDetailResult,
} from "@/lib/portal-part-detail";
import {
  addToCartFor,
  askAboutPartFor,
  removeCartLineFor,
  setCartVenueFor,
  updateCartLineFor,
  type AddToCartResult,
  type AskResult,
  type CartEditResult,
} from "@/lib/portal-cart-actions";
import { generatePortalQuote } from "@/lib/portal-quotes";
import type { SearchQuery } from "@/lib/portal-search";
import type { CurtainRequest } from "@/lib/portal-cart-types";

/**
 * Portal catalog actions (#245 Tasks 10–11, spec §3). SECURITY: these run
 * for anonymous visitors — the customer comes from `portalSession()` (the
 * grant cookie) only, never from the client; every result is sell-only.
 * Each export is a thin cookie-reading wrapper: the session-taking bodies
 * live in src/lib/ (a "use server" module can't expose them, or a client
 * could pass any customer).
 *
 * A session lookup that throws (no request scope, a failed grant read) fails
 * CLOSED to the expired-link refusal rather than surfacing an error.
 */

/** Catalog search — serves in-place lookups; the browse page itself
 *  navigates by URL. */
export async function searchPortalCatalog(q: SearchQuery): Promise<SearchPortalCatalogResult> {
  const session = await portalSession().catch(() => null);
  return searchPortalCatalogFor(session, q);
}

/** One part (SKU) or fixture (`fixture:<id>`) as the sidebar shows it. The
 *  page renders the open sidebar server-side; this serves in-place loads. */
export async function partDetail(key: string): Promise<PartDetailResult> {
  const session = await portalSession().catch(() => null);
  return partDetailActionFor(session, key);
}

/**
 * The fixture configurator's live price. A team preview passes its
 * `previewCid`: `resolvePortalViewer` honours it only for a signed-in team
 * member (anyone else falls back to their own grant cookie), so the price is
 * always the viewer's own customer's.
 */
export async function priceFixtureOptions(
  fixtureId: string,
  options: Record<string, number>,
  previewCid?: string
): Promise<FixturePriceResult> {
  const cid = typeof previewCid === "string" ? previewCid.slice(0, 200) : "";
  const viewer = await resolvePortalViewer(cid).catch(() => ({ session: null, preview: false }));
  return priceFixtureOptionsFor(viewer.session, viewer.preview, fixtureId, options);
}

/**
 * The curtain configurator's live price (#250, pattern: priceFixtureOptions).
 * A team preview passes its `previewCid`, resolved the same way.
 */
export async function priceCurtainOptions(input: unknown, previewCid?: string): Promise<CurtainPriceResult> {
  const cid = typeof previewCid === "string" ? previewCid.slice(0, 200) : "";
  const viewer = await resolvePortalViewer(cid).catch(() => ({ session: null, preview: false }));
  return priceCurtainOptionsFor(viewer.session, viewer.preview, input);
}

/** Add a part, a configured fixture or a curtain request to the grant's quote. */
export async function addToCart(
  input:
    | { kind: "part"; sku: string; qty: number }
    | { kind: "fixture"; fixtureId: string; options: Record<string, number>; qty: number }
    | { kind: "curtain"; curtain: CurtainRequest }
): Promise<AddToCartResult> {
  const session = await portalSession().catch(() => null);
  const r = await addToCartFor(session, input);
  if (r.ok) revalidatePath("/portal/catalog");
  return r;
}

/** "Ask a question about this part" → a lead in the Leads SLA queue. */
export async function askAboutPart(input: { sku: string; message: string; phone?: string }): Promise<AskResult> {
  const session = await portalSession().catch(() => null);
  return askAboutPartFor(session, input);
}

/* ---------------- the cart page — /portal/catalog/quote (#245 Task 12) ---------------- */

function cartChanged(r: { ok: boolean }) {
  if (r.ok) {
    revalidatePath("/portal/catalog/quote");
    revalidatePath("/portal/catalog");
  }
}

/** The venue this quote is for — one of the session customer's own venues. */
export async function setCartVenue(locationId: string): Promise<CartEditResult> {
  const session = await portalSession().catch(() => null);
  const r = await setCartVenueFor(session, locationId);
  cartChanged(r);
  return r;
}

export async function updateCartLine(lineId: string, qty: number): Promise<CartEditResult> {
  const session = await portalSession().catch(() => null);
  const r = await updateCartLineFor(session, lineId, qty);
  cartChanged(r);
  return r;
}

export async function removeCartLine(lineId: string): Promise<CartEditResult> {
  const session = await portalSession().catch(() => null);
  const r = await removeCartLineFor(session, lineId);
  cartChanged(r);
  return r;
}

/**
 * Generate quote (spec §4.2/§4.3): the SERVER prices the grant's cart and
 * makes the quote; on success the customer lands on /portal with a banner
 * naming its estimate number. Its saved PDF renders in after() — the cart
 * page exports `maxDuration = 120` for it (#222).
 */
export async function generateQuote(name?: unknown): Promise<{ ok: false; error: string }> {
  const session = await portalSession().catch(() => null);
  // #288: the customer's own name for the quote (blank → the default).
  const r = await generatePortalQuote(session, { name: typeof name === "string" ? name : undefined });
  if (!r.ok) return r;
  revalidatePath("/portal");
  revalidatePath("/portal/catalog/quote");
  revalidatePath("/portal/catalog");
  redirect(`/portal?generated=${r.mode}&q=${encodeURIComponent(r.quoteId)}`);
}
