// SERVER ONLY — Generate: a portal cart becomes a real quote (#245 Task 12,
// spec §4.2/§4.3/§8). The "use server" wrapper in
// src/app/portal/catalog/actions.ts reads the grant cookie and passes the
// session in; nothing here takes a customer id, a venue's owner or a price
// from the browser.
import { totals } from "@/app/(app)/estimator/pricing";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { loadPortalRules } from "@/lib/freight-rule-load";
import type { PortalSession } from "@/lib/portal";
import { PORTAL_EXPIRED_COPY } from "@/lib/portal-catalog-browse";
import { cartLinesFromSpec, priceCart, pricingContextFor } from "@/lib/portal-pricing";
import { canAcceptPortal, firmValidUntil, looksLikeCardNumber, PURCHASE_METHODS } from "@/lib/portal-quote-mode";
import { priceServiceRequest, type ServiceRequest } from "@/lib/portal-service-pricing";
import { copySentRevisionPdf } from "@/lib/quote-pdf/generate";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { rateLimit, rateLimitRefund } from "@/lib/rate-limit";
import { get as getCustomer } from "@/lib/stores/customers";
import { getDocument } from "@/lib/stores/documents";
import type { CartLine } from "@/lib/portal-cart-types";
import { addLine, clearCart, getCart, type PortalCart } from "@/lib/stores/portal-carts";
import {
  addQuoteRevision,
  create as createQuote,
  get as getQuote,
  portalListsQuote,
  setStatus,
  update as updateQuote,
  type Quote,
} from "@/lib/stores/quotes";

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
        // #245 final review: preparedBy is what quoteOwnerName() falls back
        // to (review-limits.ts, D396) when `owner` doesn't match an active
        // roster name — set it alongside owner so an unowned-company portal
        // quote's review-limit lookup has the same name to try. Left
        // untouched (buildQuote's own default) when the company has no
        // account owner, rather than writing another blank over it — note
        // the customer document's own "Prepared by" line is `ownerName`,
        // sourced from `owner` (quote-document-data.ts), not this field.
        ...(cust.owner ? { preparedBy: cust.owner } : {}),
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

/* ======================================================================
   Task 13 (spec §4.4–§4.6) — Accept, expiry/refresh, copy to new quote,
   staff decline. Shared refusal copy first; every function below re-checks
   portalListsQuote (never trusts an id belongs to this session's customer).
   ====================================================================== */

export const PORTAL_NOT_FOUND_COPY = "We couldn't find that quote.";
export const ACCEPT_ALREADY_COPY = "This quote was already accepted.";
export const ACCEPT_NOT_READY_COPY = "This quote isn't ready to accept yet.";
export const ACCEPT_EXPIRED_COPY = "This quote's pricing has expired — refresh it to get current pricing.";
export const ACCEPT_METHOD_COPY = "Pick how you'll purchase.";
export const ACCEPT_CARD_COPY = "Don't enter card numbers — we'll call you to take payment.";
export const ACCEPT_NOTES_LENGTH_COPY = "Keep purchasing notes under 1,000 characters.";
export const ACCEPT_PO_FILE_COPY = "That purchase order file couldn't be attached — try uploading it again.";
const ACCEPT_RATE_COPY = "You've tried to accept several times — try again later, or call us.";
const ACCEPT_FAIL_COPY = "Couldn't accept this quote — try again.";
export const ACCEPT_LIMIT = 10;
const ACCEPT_WINDOW_MS = 3_600_000;

/** #245 Task 13 (spec §4.4). Every guard refuses BEFORE any write; the card
 *  check runs even for a request that would otherwise be refused for
 *  another reason first, so callers always see the reason a human reads
 *  first (not-sent / accepted / expired take priority — a customer who
 *  can't accept at all doesn't need the card warning). */
export async function acceptPortal(
  session: PortalSession | null,
  input: { quoteId: string; purchaseMethod: string; notes: string; poDocumentId: string | null },
  now: number = Date.now()
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const q = await getQuote(input.quoteId);
  if (!q || !portalListsQuote(q, session.customerId)) return { ok: false, error: PORTAL_NOT_FOUND_COPY };

  const mode = canAcceptPortal(q, now);
  if (!mode.ok) {
    if (mode.reason === "accepted") return { ok: false, error: ACCEPT_ALREADY_COPY };
    if (mode.reason === "expired") return { ok: false, error: ACCEPT_EXPIRED_COPY };
    return { ok: false, error: ACCEPT_NOT_READY_COPY };
  }
  if (!(PURCHASE_METHODS as readonly string[]).includes(input.purchaseMethod)) {
    return { ok: false, error: ACCEPT_METHOD_COPY };
  }
  const notes = String(input.notes || "");
  // Fix round 1 (reviewer): a note over the limit is refused, not silently
  // cut — a truncated note could hide the very thing (e.g. a trailing card
  // number) the customer typed.
  if (notes.length > 1000) return { ok: false, error: ACCEPT_NOTES_LENGTH_COPY };
  if (looksLikeCardNumber(notes)) return { ok: false, error: ACCEPT_CARD_COPY };

  // Fix round 1 (reviewer): a poDocumentId is never trusted as-is — it must
  // resolve to a real, non-deleted, CUSTOMER-sourced document belonging to
  // THIS session's company, or acceptance is refused outright (never silently
  // dropped) so the customer knows to retry the upload.
  let poDocumentId: string | null = null;
  if (input.poDocumentId) {
    const doc = await getDocument(input.poDocumentId);
    if (!doc || doc.deleted || doc.customerId !== session.customerId || doc.source !== "customer") {
      return { ok: false, error: ACCEPT_PO_FILE_COPY };
    }
    poDocumentId = doc.id;
  }

  if (!rateLimit("portal-accept:" + session.grantId, ACCEPT_LIMIT, ACCEPT_WINDOW_MS).ok) {
    return { ok: false, error: ACCEPT_RATE_COPY };
  }
  try {
    await updateQuote(q.id, {
      portalAcceptance: {
        at: now,
        by: session.name,
        byEmail: session.email,
        purchaseMethod: input.purchaseMethod as (typeof PURCHASE_METHODS)[number],
        notes,
        poDocumentId,
      },
      portalDecline: null,
    });
    return { ok: true };
  } catch (e) {
    console.error("acceptPortal failed", q.id, e);
    return { ok: false, error: ACCEPT_FAIL_COPY };
  }
}

const REFRESH_NOT_EXPIRED_COPY = "This quote hasn't expired yet.";
const REFRESH_NOT_ELIGIBLE_COPY = "This quote can't be refreshed.";
const REFRESH_RATE_COPY = "You've refreshed pricing several times this hour — try again later, or call us.";
const REFRESH_FAIL_COPY = "Couldn't refresh this quote — try again.";
export const REFRESH_LIMIT = 10;
const REFRESH_WINDOW_MS = 3_600_000;

/**
 * Refresh pricing on an expired firm portal quote (#245 Task 13, spec §4.5).
 * Rebuilds a transient cart from the quote's OWN spec (cartLinesFromSpec —
 * the same mapping `copyToCart` uses) + its saved venue, re-prices every
 * line at current cost/tier/freight, and writes the result back as a new
 * revision.
 *
 * Firm (still every line priced): the quote stays `sent` — `setStatus`
 * treats a same-status call as a no-op (it exists to replay a `won` spawn,
 * not to cut a revision), so the "sent" revision here is cut by hand,
 * exactly the shape `setStatus`'s own send path cuts (`reason: "sent"`),
 * and `copySentRevisionPdf` is called directly rather than through
 * `setStatus` — the #222 portal PDF route (`portalQuotePdfSource`) reads
 * `latestSentRevision`, so this is what makes the refreshed price the one a
 * customer's Open PDF (once it renders) actually shows.
 *
 * Review (some line is now price-on-request): `resolveStatusGate` allows
 * `sent → draft` unconditionally (it only gates advancing TO `won`/`sent`),
 * so this recalls the quote to `draft` via the real `setStatus` — history,
 * pipeline stage and all — and stamps `portalReview`/clears `portalFirm`.
 * `canAcceptPortal`/`portalCanAcceptQuote` also refuse to accept while
 * `portalReview` is set, as a second gate independent of the status change.
 */
export async function refreshPortalQuote(
  session: PortalSession | null,
  quoteId: string,
  now: number = Date.now()
): Promise<{ ok: true; mode: "firm" | "review" } | { ok: false; error: string }> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const q = await getQuote(quoteId);
  if (!q || !portalListsQuote(q, session.customerId)) return { ok: false, error: PORTAL_NOT_FOUND_COPY };
  if (q.source !== "portal-catalog" && q.source !== "portal-service") return { ok: false, error: REFRESH_NOT_ELIGIBLE_COPY };

  const gate = canAcceptPortal(q, now);
  if (gate.ok) return { ok: false, error: REFRESH_NOT_EXPIRED_COPY };
  if (gate.reason !== "expired") return { ok: false, error: REFRESH_NOT_ELIGIBLE_COPY };

  if (!rateLimit("portal-refresh:" + session.grantId, REFRESH_LIMIT, REFRESH_WINDOW_MS).ok) {
    return { ok: false, error: REFRESH_RATE_COPY };
  }
  if (q.source === "portal-service") return refreshServicePortalQuote(q, now);
  try {
    const priorSections = ((q.spec as { sections?: SpecSection[] } | null)?.sections ?? []) as SpecSection[];
    const rawLines = cartLinesFromSpec(priorSections).map((l, i) => ({ ...l, lineId: "refresh-" + i }));
    const synthetic: PortalCart = { id: "", customerId: session.customerId, locationId: q.locationId ?? null, lines: rawLines, updatedAt: now };
    const ctx = await pricingContextFor(session);
    const p = await priceCart(synthetic, ctx);
    const t = totals(p.sections, 0);

    if (p.mode === "firm") {
      const rules = await loadPortalRules();
      await updateQuote(q.id, {
        spec: { sections: p.sections, mobs: [] },
        value: Math.round(t.grand),
        margin: t.margin,
        pricingTier: ctx.tier,
        tierMargin: ctx.tierMargin,
        portalFirm: { generatedAt: now, validUntil: firmValidUntil(now, rules.validityDays) },
        portalReview: null,
      });
      await scheduleQuotePdf(q.id);
      await addQuoteRevision(q.id, { by: "Customer portal", reason: "sent", note: "Portal price refresh" });
      await copySentRevisionPdf(q.id).catch((e) => console.error("refreshPortalQuote: sent-revision copy failed", q.id, e));
      return { ok: true, mode: "firm" };
    }

    await updateQuote(q.id, {
      spec: { sections: p.sections, mobs: [] },
      value: Math.round(t.grand),
      margin: t.margin,
      pricingTier: ctx.tier,
      tierMargin: ctx.tierMargin,
      portalFirm: null,
      portalReview: { requestedAt: now, reasons: p.reason ? [p.reason] : [] },
    });
    await setStatus(q.id, "draft", "Customer portal");
    return { ok: true, mode: "review" };
  } catch (e) {
    console.error("refreshPortalQuote failed", q.id, e);
    return { ok: false, error: REFRESH_FAIL_COPY };
  }
}

/** Minimal structural view of a saved flame-test / inspection quote subdoc's
 *  venue rows — enough to rebuild the `ServiceRequest` a refresh re-prices. */
type ServiceSubdocVenue = { id?: string | null; curtains?: number; lineSets?: number };
type ServiceSubdocLike = { level?: number | string; venues?: ServiceSubdocVenue[] };

/**
 * Refresh an expired firm portal-service quote (#248 Task 2, spec §3): re-
 * prices the STORED subdoc's own venues/counts (+ level, for an inspection)
 * through `priceServiceRequest` at today's rates — using the quote's own
 * `customerId`/`contactName`, not the caller's session, so the refreshed
 * price is exactly what a fresh Generate from this quote's saved scope would
 * produce. A service request is never price-on-request (the engines are
 * fully deterministic) — there's no review branch here, only the firm path:
 * write the new value + subdoc, cut a "sent" revision by hand (same shape
 * `setStatus`'s own send path cuts), and copy the sent-revision PDF so the
 * #222 portal PDF route reads the refreshed price, not the original.
 */
async function refreshServicePortalQuote(
  q: Quote,
  now: number
): Promise<{ ok: true; mode: "firm" } | { ok: false; error: string }> {
  if (!q.customerId) return { ok: false, error: REFRESH_NOT_ELIGIBLE_COPY };
  const quoteType = q.quoteType;
  const sub = (quoteType === "flame_test" ? q.flameTest : q.inspection) as ServiceSubdocLike | undefined;
  const rows = Array.isArray(sub?.venues) ? sub!.venues! : [];
  if (!rows.length) return { ok: false, error: REFRESH_NOT_ELIGIBLE_COPY };

  const req: ServiceRequest =
    quoteType === "flame_test"
      ? {
          service: { kind: "flame" },
          venues: rows.map((v) => ({ venueId: v.id || "", count: Number(v.curtains) || 0 })),
        }
      : {
          service: { kind: "inspection", level: Number(sub?.level) === 2 ? 2 : 1 },
          venues: rows.map((v) => ({ venueId: v.id || "", count: Number(v.lineSets) || 0 })),
        };

  try {
    const priced = await priceServiceRequest({ customerId: q.customerId, name: q.contactName || "" }, req);
    if (!priced.ok) return { ok: false, error: REFRESH_FAIL_COPY };

    const rules = await loadPortalRules();
    await updateQuote(q.id, {
      value: Math.round(priced.total),
      margin: priced.margin,
      pricingTier: priced.tier,
      tierMargin: priced.tierMargin,
      ...(quoteType === "flame_test" ? { flameTest: priced.subdoc } : { inspection: priced.subdoc }),
      portalFirm: { generatedAt: now, validUntil: firmValidUntil(now, rules.validityDays) },
    });
    await scheduleQuotePdf(q.id);
    await addQuoteRevision(q.id, { by: "Customer portal", reason: "sent", note: "Portal price refresh" });
    await copySentRevisionPdf(q.id).catch((e) => console.error("refreshServicePortalQuote: sent-revision copy failed", q.id, e));
    return { ok: true, mode: "firm" };
  } catch (e) {
    console.error("refreshServicePortalQuote failed", q.id, e);
    return { ok: false, error: REFRESH_FAIL_COPY };
  }
}

const COPY_FAIL_COPY = "Couldn't copy this quote — try again.";
export const COPY_LIMIT = 20;
const COPY_WINDOW_MS = 3_600_000;
const COPY_RATE_COPY = "You've copied several quotes this hour — try again later, or call us.";

/**
 * Copy to new quote (#245 Task 13, spec §4.6): rebuilds this quote's lines
 * (cartLinesFromSpec) and re-prices them (the same check `priceCart` uses
 * for "No longer available" on the cart page) so a line whose part is now
 * hidden/deleted is skipped — never added unpriceable. Appends to the
 * grant's existing cart; nothing already there is touched or replaced.
 * `addLine`'s own MAX_CART_LINES refusal simply stops that one line from
 * being added (a same-SKU part line still merges past the cap).
 */
export async function copyToCart(
  session: PortalSession | null,
  quoteId: string
): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const q = await getQuote(quoteId);
  if (!q || !portalListsQuote(q, session.customerId)) return { ok: false, error: PORTAL_NOT_FOUND_COPY };

  if (!rateLimit("portal-copy:" + session.grantId, COPY_LIMIT, COPY_WINDOW_MS).ok) {
    return { ok: false, error: COPY_RATE_COPY };
  }
  try {
    const sections = ((q.spec as { sections?: SpecSection[] } | null)?.sections ?? []) as SpecSection[];
    const rawLines = cartLinesFromSpec(sections).map((l, i) => ({ ...l, lineId: "copy-" + i }));
    if (!rawLines.length) return { ok: true, added: 0 };
    const ctx = await pricingContextFor(session);
    const synthetic: PortalCart = { id: "", customerId: session.customerId, locationId: q.locationId ?? null, lines: rawLines, updatedAt: Date.now() };
    const p = await priceCart(synthetic, ctx);
    const available = new Set(p.lines.filter((l) => !l.unavailable).map((l) => l.lineId));

    let added = 0;
    for (const l of rawLines) {
      if (!available.has(l.lineId)) continue;
      const line: Omit<CartLine, "lineId"> = {
        kind: l.kind,
        sku: l.sku,
        fixtureId: l.fixtureId,
        fixtureOptions: l.fixtureOptions,
        curtainInputs: l.curtainInputs,
        qty: l.qty,
      };
      try {
        await addLine(session.grantId, session.customerId, line);
        added++;
      } catch (e) {
        // MAX_CART_LINES ("Your quote can hold up to 200 lines.") or a bad
        // qty — neither stops the rest of the copy from being attempted (a
        // part SKU further down may still merge into an existing line).
        console.error("copyToCart: one line didn't add", q.id, l, e);
      }
    }
    return { ok: true, added };
  } catch (e) {
    console.error("copyToCart failed", q.id, e);
    return { ok: false, error: COPY_FAIL_COPY };
  }
}

const DECLINE_NOTE_COPY = "Enter a note (1–500 characters).";
export const DECLINE_NO_ACCEPTANCE_COPY = "This quote has no portal acceptance to decline.";
const DECLINE_FAIL_COPY = "Couldn't decline this quote — try again.";

/**
 * Staff decline (#245 Task 13, spec §4.4): clears the customer's acceptance
 * and stamps `portalDecline`, shown back to them in the portal; the quote
 * stays `sent` (never a fifth status) so they can simply accept again. Takes
 * no session — the caller (estimator/actions.ts declinePortalAcceptanceAction)
 * is the team-side `requireUser()` gate.
 *
 * Fix round 1 (reviewer): refuses outright — writes nothing — unless the
 * quote actually exists, is a portal-catalog quote, AND currently carries a
 * `portalAcceptance` to decline. Without this, declining a never-accepted
 * (or non-portal) quote would still stamp `portalDecline`, showing the
 * customer a decline note for something they never submitted.
 */
export async function declinePortalAcceptance(
  quoteId: string,
  by: string,
  note: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = String(note || "").trim();
  if (!trimmed || trimmed.length > 500) return { ok: false, error: DECLINE_NOTE_COPY };
  try {
    const q = await getQuote(quoteId);
    if (!q || (q.source !== "portal-catalog" && q.source !== "portal-service") || !q.portalAcceptance) {
      return { ok: false, error: DECLINE_NO_ACCEPTANCE_COPY };
    }
    await updateQuote(quoteId, { portalAcceptance: null, portalDecline: { at: Date.now(), by: by || "Staff", note: trimmed } });
    return { ok: true };
  } catch (e) {
    console.error("declinePortalAcceptance failed", quoteId, e);
    return { ok: false, error: DECLINE_FAIL_COPY };
  }
}
