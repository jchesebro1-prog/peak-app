// SERVER ONLY — the bodies of the portal catalog's mutating actions (#245
// Task 11). The "use server" wrappers in src/app/portal/catalog/actions.ts
// read the grant cookie and pass the session in; nothing here takes a
// customer id, a price or a fabric name from the browser.
import type { PortalSession } from "@/lib/portal";
import { portalIndex, portalPart } from "@/lib/portal-catalog-index";
import { PORTAL_EXPIRED_COPY } from "@/lib/portal-catalog-browse";
import { cartAddProblem, cleanCurtainRequest, NOT_QUOTABLE_COPY, QTY_COPY } from "@/lib/portal-cart-rules";
import { buildPartQuestionLead, partQuestionProblem } from "@/lib/portal-leads";
import { cleanFixtureOptions, FIXTURE_UNAVAILABLE_COPY, PART_UNAVAILABLE_COPY } from "@/lib/portal-part-view";
import { priceFixture, pricingContextFor } from "@/lib/portal-pricing";
import { rateLimit, rateLimitRefund } from "@/lib/rate-limit";
import { get as getCustomer } from "@/lib/stores/customers";
import { create as createLead } from "@/lib/stores/leads";
import { addLine, removeLine, setVenue, updateLine } from "@/lib/stores/portal-carts";

export type AddToCartInput =
  | { kind: "part"; sku: string; qty: number }
  | { kind: "fixture"; fixtureId: string; options: Record<string, number>; qty: number }
  | { kind: "curtain"; curtain: unknown };

export type AddToCartResult = { ok: true; count: number } | { ok: false; error: string };
export type AskResult = { ok: true } | { ok: false; error: string };

export const CART_RATE_COPY = "Too many changes at once — wait a moment and try again.";
export const ASK_RATE_COPY = "You've sent several questions this hour — we'll get back to you soon, or call us.";
const ADD_FAIL_COPY = "Couldn't add that — try again.";
const ASK_FAIL_COPY = "Couldn't send your question — try again.";
/** The two messages `addLine` throws — safe to show; anything else isn't. */
const STORE_COPY = new Set([QTY_COPY, "Your quote can hold up to 200 lines."]);

/** A preview session (a team member looking as the customer) never writes. */
function writable(session: PortalSession | null): session is PortalSession {
  return !!session && session.grantId !== "preview" && !!session.grantId && !!session.customerId;
}

/** The `addToCart` action's body. Every add re-checks the item against the
 *  portal index (hidden/labor/unknown → refused) and never reads a price. */
export async function addToCartFor(session: PortalSession | null, input: unknown): Promise<AddToCartResult> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!rateLimit("portal-cart:" + session.grantId, 120, 60_000).ok) return { ok: false, error: CART_RATE_COPY };
  const r = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const ix = await portalIndex();

  let line: Parameters<typeof addLine>[2];
  if (r.kind === "part") {
    // #302: a former SKU (an old bookmark) adds the live part under its live SKU.
    const part = typeof r.sku === "string" && r.sku ? portalPart(ix, r.sku) : undefined;
    const problem = cartAddProblem(!!part, r.qty as number);
    if (problem) return { ok: false, error: problem };
    line = { kind: "part", sku: part!.sku, qty: r.qty as number };
  } else if (r.kind === "fixture") {
    const fx = typeof r.fixtureId === "string" ? ix.fixtures.get(r.fixtureId) : undefined;
    const problem = cartAddProblem(!!fx, r.qty as number);
    if (problem) return { ok: false, error: problem === NOT_QUOTABLE_COPY ? PART_UNAVAILABLE_COPY : problem };
    const options = cleanFixtureOptions(fx!, r.options);
    if (!(await priceFixture(fx!.id, options, await pricingContextFor(session)))) return { ok: false, error: FIXTURE_UNAVAILABLE_COPY };
    line = { kind: "fixture", fixtureId: fx!.id, fixtureOptions: options, qty: r.qty as number };
  } else if (r.kind === "curtain") {
    const c = cleanCurtainRequest(r.curtain, ix.fabrics);
    if (!c.ok) return c;
    // The line qty is the single source; curtainInputs.qty is stamped from
    // it here and is informational only (see CurtainRequest.qty).
    line = { kind: "curtain", curtainInputs: { ...c.curtain, qty: String(c.qty) }, qty: c.qty };
  } else {
    return { ok: false, error: ADD_FAIL_COPY };
  }

  try {
    const cart = await addLine(session.grantId, session.customerId, line);
    return { ok: true, count: cart.lines.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (STORE_COPY.has(msg)) return { ok: false, error: msg };
    console.error("addToCart failed", e);
    return { ok: false, error: ADD_FAIL_COPY };
  }
}

const ASK_LIMIT = 5;
const ASK_WINDOW_MS = 3_600_000;

/**
 * The `askAboutPart` action's body — a lead in the Leads SLA queue (source
 * "existing", no owner) linked to the SESSION's customer, its message headed
 * `[Portal question — <SKU>]`. `sku` may be a part SKU or `fixture:<id>`
 * (headed by the fixture's light-engine SKU). 5 questions an hour per grant;
 * an invalid question or a failed write doesn't spend one.
 */
export async function askAboutPartFor(session: PortalSession | null, input: unknown): Promise<AskResult> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const r = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const problem = partQuestionProblem(r.message, r.phone);
  if (problem) return { ok: false, error: problem };

  const key = typeof r.sku === "string" ? r.sku : "";
  const ix = await portalIndex();
  let part: { sku: string; title: string } | null = null;
  if (key.startsWith("fixture:")) {
    const fx = ix.fixtures.get(key.slice("fixture:".length));
    if (fx) part = { sku: fx.lightEngineSku, title: fx.label };
  } else {
    const p = key ? portalPart(ix, key) : undefined;
    if (p) part = { sku: p.sku, title: p.desc || p.sku };
  }
  if (!part) return { ok: false, error: PART_UNAVAILABLE_COPY };

  const cust = await getCustomer(session.customerId);
  if (!cust) return { ok: false, error: PORTAL_EXPIRED_COPY };

  const rlKey = "portal-ask:" + session.grantId;
  if (!rateLimit(rlKey, ASK_LIMIT, ASK_WINDOW_MS).ok) return { ok: false, error: ASK_RATE_COPY };
  try {
    await createLead(
      buildPartQuestionLead(session, cust.name, part, r.message as string, typeof r.phone === "string" ? r.phone : ""),
      session.name
    );
  } catch (e) {
    rateLimitRefund(rlKey);
    console.error("askAboutPart: lead mint failed", e);
    return { ok: false, error: ASK_FAIL_COPY };
  }
  return { ok: true };
}

/* ---------------- the cart page (#245 Task 12, spec §3.4) ---------------- */

export type CartEditResult = { ok: true } | { ok: false; error: string };
const CART_EDIT_FAIL_COPY = "Couldn't update your quote — try again.";
const VENUE_COPY = "Pick one of your venues.";

/** The cart page's venue picker. Only one of the SESSION customer's own
 *  venues (or "" to clear) — never a location id taken on trust. */
export async function setCartVenueFor(session: PortalSession | null, locationId: unknown): Promise<CartEditResult> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!rateLimit("portal-cart:" + session.grantId, 120, 60_000).ok) return { ok: false, error: CART_RATE_COPY };
  const id = typeof locationId === "string" ? locationId : "";
  let loc: string | null = null;
  if (id) {
    const cust = await getCustomer(session.customerId);
    if (!cust) return { ok: false, error: PORTAL_EXPIRED_COPY };
    if (!(cust.locations || []).some((l) => l.id === id)) return { ok: false, error: VENUE_COPY };
    loc = id;
  }
  try {
    await setVenue(session.grantId, session.customerId, loc);
    return { ok: true };
  } catch (e) {
    console.error("setCartVenue failed", e);
    return { ok: false, error: CART_EDIT_FAIL_COPY };
  }
}

/** Qty stepper: a whole number 1..10,000 (removing is its own action). */
export async function updateCartLineFor(session: PortalSession | null, lineId: unknown, qty: unknown): Promise<CartEditResult> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!rateLimit("portal-cart:" + session.grantId, 120, 60_000).ok) return { ok: false, error: CART_RATE_COPY };
  if (typeof lineId !== "string" || !lineId) return { ok: false, error: CART_EDIT_FAIL_COPY };
  const problem = cartAddProblem(true, qty as number);
  if (problem) return { ok: false, error: problem };
  try {
    await updateLine(session.grantId, session.customerId, lineId, { qty: qty as number });
    return { ok: true };
  } catch (e) {
    console.error("updateCartLine failed", e);
    return { ok: false, error: CART_EDIT_FAIL_COPY };
  }
}

export async function removeCartLineFor(session: PortalSession | null, lineId: unknown): Promise<CartEditResult> {
  if (!writable(session)) return { ok: false, error: PORTAL_EXPIRED_COPY };
  if (!rateLimit("portal-cart:" + session.grantId, 120, 60_000).ok) return { ok: false, error: CART_RATE_COPY };
  if (typeof lineId !== "string" || !lineId) return { ok: false, error: CART_EDIT_FAIL_COPY };
  try {
    await removeLine(session.grantId, session.customerId, lineId);
    return { ok: true };
  } catch (e) {
    console.error("removeCartLine failed", e);
    return { ok: false, error: CART_EDIT_FAIL_COPY };
  }
}
