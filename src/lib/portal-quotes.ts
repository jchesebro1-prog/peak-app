// SERVER ONLY — Generate: a portal cart becomes a real quote (#242 Task 12,
// spec §4.2/§4.3/§8). The "use server" wrapper in
// src/app/portal/catalog/actions.ts reads the grant cookie and passes the
// session in; nothing here takes a customer id, a venue's owner or a price
// from the browser.
import { totals } from "@/app/(app)/estimator/pricing";
import { loadPortalRules } from "@/lib/freight-rule-load";
import type { PortalSession } from "@/lib/portal";
import { PORTAL_EXPIRED_COPY } from "@/lib/portal-catalog-browse";
import { priceCart, pricingContextFor } from "@/lib/portal-pricing";
import { firmValidUntil } from "@/lib/portal-quote-mode";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { rateLimit, rateLimitRefund } from "@/lib/rate-limit";
import { get as getCustomer } from "@/lib/stores/customers";
import { clearCart, getCart } from "@/lib/stores/portal-carts";
import { create as createQuote, setStatus, update as updateQuote } from "@/lib/stores/quotes";

/** Guard copy (verbatim, controller decision 8) — the cart page shows the same. */
export const GENERATE_EMPTY_COPY = "Your quote is empty.";
export const GENERATE_NO_VENUE_COPY = "Pick the venue this is for.";
export const GENERATE_UNAVAILABLE_COPY = "None of these items can be quoted right now.";
export const GENERATE_RATE_COPY = "You've generated several quotes this hour — try again later, or call us.";
export const GENERATE_BUSY_COPY = "Your quote is already being generated — one moment.";
const GENERATE_FAIL_COPY = "Couldn't generate your quote — try again.";

/** Generate is limited per grant (controller decision 10). */
export const GENERATE_LIMIT = 10;
const GENERATE_WINDOW_MS = 3_600_000;

export type GenerateResult = { ok: true; quoteId: string; mode: "firm" | "review" } | { ok: false; error: string };

/** Test seam (fix round 1): lets a DB check force the post-creation cart
 *  clear to fail, without touching any other dependency. Defaults to the
 *  real store. */
export type GeneratePortalQuoteDeps = { clearCart?: typeof clearCart };

/** Grants with a Generate in flight in this process — a double click never
 *  makes two quotes from one cart. */
const inFlight = new Set<string>();

/**
 * Send a firm portal quote (spec §4.2, §8.4): stamp `portalFirm`, schedule
 * its saved PDF, then send through the named `"portal-firm"` gate bypass.
 * Shared by Generate and (Task 13) Refresh. Same order as the Estimator's
 * save-then-send (estimator/actions.ts saveQuoteAction): every content write
 * first, then `scheduleQuotePdf`, then `setStatus` — so #222's sent-revision
 * copy takes the PDF of exactly what was sent. `schedulePdf: false` is for the
 * spec harness (no request to render in).
 */
export async function sendPortalFirm(
  quoteId: string,
  validityDays: number,
  now: number,
  opts: { schedulePdf?: boolean } = {}
): Promise<void> {
  await updateQuote(quoteId, {
    portalFirm: { generatedAt: now, validUntil: firmValidUntil(now, validityDays) },
    portalReview: null,
  });
  if (opts.schedulePdf !== false) await scheduleQuotePdf(quoteId);
  await setStatus(quoteId, "sent", "Customer portal", { bypassApprovalGate: "portal-firm" });
}

/** A preview (a team member looking as the customer) never writes. */
function writable(session: PortalSession | null): session is PortalSession {
  return !!session && session.grantId !== "preview" && !!session.grantId && !!session.customerId;
}

/**
 * Generate (spec §4.2/§4.3). Firm (every line priced) → a numbered quote,
 * sent at once, good for the Portal rules' validity (default 30 days), with
 * its saved PDF. Review (any price-on-request line — every curtain) → a
 * numbered draft stamped `portalReview`, waiting on Peak; no lead or queue
 * record (§8.2 — the staff bell derives it). Either way the quote is owned by
 * the company's account owner ("" = unassigned) and the cart empties.
 * "No longer available" lines are left out.
 */
export async function generatePortalQuote(
  session: PortalSession | null,
  opts: { now?: number; schedulePdf?: boolean; deps?: GeneratePortalQuoteDeps } = {}
): Promise<GenerateResult> {
  const clearCartImpl = opts.deps?.clearCart ?? clearCart;
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const { grantId, customerId } = session;

  const [cart, cust] = await Promise.all([getCart(grantId, customerId), getCustomer(customerId)]);
  if (!cust) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!cart.lines.length) return { ok: false, error: GENERATE_EMPTY_COPY };
  const venue = cart.locationId ? (cust.locations || []).find((l) => l.id === cart.locationId) : undefined;
  if (!venue) return { ok: false, error: GENERATE_NO_VENUE_COPY };

  if (inFlight.has(grantId)) return { ok: false, error: GENERATE_BUSY_COPY };
  inFlight.add(grantId);
  const rlKey = "portal-generate:" + grantId;
  let spent = false; // a Generate token is refunded only while no quote exists
  try {
    const ctx = await pricingContextFor(session);
    const p = await priceCart(cart, ctx);
    if (!p.lines.some((l) => !l.unavailable)) return { ok: false, error: GENERATE_UNAVAILABLE_COPY };

    if (!rateLimit(rlKey, GENERATE_LIMIT, GENERATE_WINDOW_MS).ok) return { ok: false, error: GENERATE_RATE_COPY };
    spent = true;

    const now = opts.now ?? Date.now();
    const t = totals(p.sections, 0);
    const created = await createQuote({
      name: "Portal quote — " + (venue.label || venue.locationName || "Venue"),
      customer: cust.name,
      customerId,
      locationId: venue.id,
      contactName: session.name,
      value: p.total,
      margin: t.margin,
      pricingTier: ctx.tier,
      tierMargin: ctx.tierMargin,
      source: "portal-catalog",
      spec: { sections: p.sections, mobs: [] },
    });
    // From here the quote exists (numbered on insert, #223): whatever happens
    // next, the cart empties and the customer gets their number — a retry
    // must never mint a second quote from the same cart.
    spent = false;
    let mode = p.mode;
    try {
      await updateQuote(created.id, {
        owner: cust.owner || "",
        portalReview: mode === "review" ? { requestedAt: now, reasons: p.reason ? [p.reason] : [] } : null,
      });
      if (mode === "firm") {
        const rules = await loadPortalRules();
        await sendPortalFirm(created.id, rules.validityDays, now, { schedulePdf: opts.schedulePdf });
      } else if (opts.schedulePdf !== false) {
        // #222: the customer can open their review quote's PDF from the portal.
        await scheduleQuotePdf(created.id);
      }
    } catch (e) {
      // A firm quote that couldn't be sent falls back to Peak review.
      console.error("generatePortalQuote: finishing the quote failed", created.id, e);
      if (mode === "firm") {
        mode = "review";
        await updateQuote(created.id, {
          portalFirm: null,
          portalReview: { requestedAt: now, reasons: ["Couldn't be sent automatically"] },
        }).catch((err) => console.error("generatePortalQuote: review fallback failed", created.id, err));
      }
    }
    // Once the quote exists, Generate must report success no matter what —
    // a customer who got their number back must never be told to retry (a
    // retry would re-read the still-full cart and mint a SECOND real quote).
    // clearCart is therefore its own try/catch, off the outer one: its
    // failure is logged, never refunds the rate-limit token (a quote WAS
    // made), and never turns this into a reported failure.
    try {
      await clearCartImpl(grantId);
    } catch (e) {
      console.error("generatePortalQuote: clearing the cart failed (quote already made)", created.id, e);
    }
    return { ok: true, quoteId: created.id, mode };
  } catch (e) {
    console.error("generatePortalQuote failed", e);
    // Nothing was created — give the Generate back.
    if (spent) rateLimitRefund(rlKey);
    return { ok: false, error: GENERATE_FAIL_COPY };
  } finally {
    inFlight.delete(grantId);
  }
}
