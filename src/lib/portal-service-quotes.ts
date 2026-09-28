// SERVER ONLY — Generate: a portal service request (flame test / inspection)
// becomes a real, firm quote (#246 Task 2, spec §3). Twin of #245's
// generatePortalQuote (src/lib/portal-quotes.ts) for the service side: same
// "use server" boundary (nothing here takes a customer id, a venue's owner
// or a price from the browser — the caller's cookie-reading wrapper passes
// the session in), same in-flight guard, same "once the quote exists, report
// success no matter what" rule, same rate-limit-only-spent-on-a-priced-
// request shape.
//
// Unlike the catalog cart, a service request is never price-on-request —
// priceServiceRequest always returns a number (the engines are fully
// deterministic) — so Generate here has no "review" mode: every generated
// service quote is sent at once, firm, for the Portal rules' validity.
import { loadPortalRules } from "@/lib/freight-rule-load";
import type { PortalSession } from "@/lib/portal";
import { PORTAL_EXPIRED_COPY } from "@/lib/portal-catalog-browse";
import { sendPortalFirm } from "@/lib/portal-quotes";
import { priceServiceRequest, type ServiceRequest } from "@/lib/portal-service-pricing";
import type { PortalService } from "@/lib/portal-service-scope";
import { rateLimit, rateLimitRefund } from "@/lib/rate-limit";
import { get as getCustomer, type CustomerDoc } from "@/lib/stores/customers";
import { create as createQuote, update as updateQuote } from "@/lib/stores/quotes";

export const GENERATE_LIMIT = 10;
const GENERATE_WINDOW_MS = 3_600_000;
export const GENERATE_RATE_COPY = "You've generated several quotes this hour — try again later, or call us.";
export const GENERATE_BUSY_COPY = "Your quote is already being generated — one moment.";
const GENERATE_FAIL_COPY = "Couldn't generate your quote — try again.";

export type GenerateServiceResult = { ok: true; quoteId: string } | { ok: false; error: string };

/** A preview (a team member looking as the customer) never writes — same
 *  rule as portal-quotes.ts's writable(), duplicated here because that one
 *  isn't exported (a "use server" module can only export async functions,
 *  and this pure guard is shared by value, not by import, across the two
 *  portal quote-writing modules). */
function writable(session: PortalSession | null): session is PortalSession {
  return !!session && session.grantId !== "preview" && !!session.grantId && !!session.customerId;
}

function venueLabel(cust: CustomerDoc | null, venueId: string): string {
  const loc = (cust?.locations || []).find((l) => l.id === venueId);
  return loc?.label || loc?.locationName || "Venue";
}

/** "Flame test — A, B" / "Inspection (Annual|Five-year) — A, B", truncated
 *  to 120 chars (controller decision). Pure. */
export function serviceQuoteName(service: PortalService, venueLabels: string[]): string {
  const joined = venueLabels.join(", ");
  const base =
    service.kind === "flame"
      ? `Flame test — ${joined}`
      : `Inspection (${service.level === 2 ? "Five-year" : "Annual"}) — ${joined}`;
  return base.length > 120 ? base.slice(0, 120) : base;
}

/** Grants with a Generate in flight in this process — a double click never
 *  makes two quotes from one request. Separate from the catalog's own
 *  in-flight set (src/lib/portal-quotes.ts) — a different feature, a
 *  different lock. */
const inFlight = new Set<string>();

/**
 * Generate a firm flame-test or inspection quote from the portal's scope
 * intake (#246 Task 2, spec §3). Guards → price → create → send, in that
 * order: a refusal (expired session, bad venues/counts, a venue that isn't
 * this customer's own) never spends a Generate token and never makes a
 * quote — only a request that actually prices does. `schedulePdf: false`
 * is for the spec harness (no request to render a PDF in).
 */
export async function generateServiceQuote(
  session: PortalSession | null,
  req: ServiceRequest,
  opts: { now?: number; schedulePdf?: boolean } = {}
): Promise<GenerateServiceResult> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const { grantId, customerId } = session;

  const cust = await getCustomer(customerId);
  if (!cust) return { ok: false, error: PORTAL_EXPIRED_COPY };

  if (inFlight.has(grantId)) return { ok: false, error: GENERATE_BUSY_COPY };
  inFlight.add(grantId);
  const rlKey = "portal-service-generate:" + grantId;
  let spent = false; // a Generate token is refunded only while no quote exists
  try {
    // Validation (empty venues, a foreign venue id, an out-of-range count)
    // happens inside priceServiceRequest via serviceRequestProblem — a
    // refusal here never touches the rate limit.
    const priced = await priceServiceRequest(session, req);
    if (!priced.ok) return { ok: false, error: priced.error };

    if (!rateLimit(rlKey, GENERATE_LIMIT, GENERATE_WINDOW_MS).ok) {
      return { ok: false, error: GENERATE_RATE_COPY };
    }
    spent = true;

    const now = opts.now ?? Date.now();
    const labels = req.venues.map((v) => venueLabel(cust, v.venueId));
    const name = serviceQuoteName(req.service, labels);
    const quoteType = req.service.kind === "flame" ? "flame_test" : "inspection";

    const created = await createQuote({
      name,
      customer: cust.name,
      customerId,
      locationId: req.venues[0]?.venueId ?? null,
      contactName: session.name,
      value: Math.round(priced.total),
      margin: priced.margin,
      pricingTier: priced.tier,
      tierMargin: priced.tierMargin,
      source: "portal-service",
      quoteType,
      ...(quoteType === "flame_test" ? { flameTest: priced.subdoc } : { inspection: priced.subdoc }),
    });
    // From here the quote exists (numbered on insert, #223): whatever
    // happens next, Generate must report success — a retry off a false
    // "try again" would re-price and mint a SECOND real quote.
    spent = false;
    try {
      await updateQuote(created.id, {
        owner: cust.owner || "",
        // Same review-limit fallback #245 final review set for portal-catalog
        // (D396) — an unowned company's quote still has a name a review-limit
        // lookup can try. Left untouched when the company has no owner.
        ...(cust.owner ? { preparedBy: cust.owner } : {}),
      });
      const rules = await loadPortalRules();
      await sendPortalFirm(created.id, rules.validityDays, now, { schedulePdf: opts.schedulePdf });
    } catch (e) {
      console.error("generateServiceQuote: finishing the quote failed", created.id, e);
    }
    return { ok: true, quoteId: created.id };
  } catch (e) {
    console.error("generateServiceQuote failed", e);
    if (spent) rateLimitRefund(rlKey);
    return { ok: false, error: GENERATE_FAIL_COPY };
  } finally {
    inFlight.delete(grantId);
  }
}
