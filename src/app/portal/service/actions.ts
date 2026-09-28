"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalSession } from "@/lib/portal";
import { PORTAL_EXPIRED_COPY } from "@/lib/portal-catalog-browse";
import { priceServiceRequest, type ServiceCustomerView, type ServiceRequest } from "@/lib/portal-service-pricing";
import { generateServiceQuote } from "@/lib/portal-service-quotes";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Portal SERVICE actions (#246 Task 3, spec §2, §6). SECURITY: same shape as
 * ../catalog/actions.ts — every export is a thin cookie-reading wrapper
 * around `portalSession()`; the session-taking bodies (`priceServiceRequest`,
 * `generateServiceQuote`) live in src/lib/ and never trust a client-posted
 * customer id. A team preview (`resolvePortalViewer`'s `?preview=`) never
 * reaches these — the page prices a preview's initial view server-side at
 * render time instead (spec §2's "Preview mode" note) and renders the form
 * read-only, so preview never calls priceServiceAction/generateServiceAction.
 */

export type PriceServiceActionResult = { ok: true; view: ServiceCustomerView } | { ok: false; error: string };

const PRICE_LIMIT = 240;
const PRICE_WINDOW_MS = 60_000;
// A "use server" file may only export async functions (not this constant) —
// same reason ../catalog/actions.ts inlines its own copy instead of
// exporting one.
const PRICE_RATE_COPY = "Too many price checks — wait a moment and try again.";

/** Live price (spec §2): the client debounces 300 ms and discards stale
 *  responses on its own — every call here still fully re-validates and
 *  re-prices, so a request that lands out of order can never show a price
 *  the server didn't just compute for those exact inputs. */
export async function priceServiceAction(req: ServiceRequest): Promise<PriceServiceActionResult> {
  const session = await portalSession().catch(() => null);
  if (!session) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!rateLimit("portal-service-price:" + session.grantId, PRICE_LIMIT, PRICE_WINDOW_MS).ok) {
    return { ok: false, error: PRICE_RATE_COPY };
  }
  const r = await priceServiceRequest(session, req);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, view: r.view };
}

/** Generate (spec §2, §3): on success redirects to the #245 banner
 *  (`/portal?generated=firm&q=<id>`); only a refusal comes back. */
export async function generateServiceAction(req: ServiceRequest): Promise<{ ok: false; error: string }> {
  const session = await portalSession().catch(() => null);
  const r = await generateServiceQuote(session, req);
  if (!r.ok) return r;
  revalidatePath("/portal");
  revalidatePath("/portal/service");
  redirect(`/portal?generated=firm&q=${encodeURIComponent(r.quoteId)}`);
}
