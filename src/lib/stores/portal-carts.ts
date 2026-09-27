import { getDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import type { CartLine, CurtainRequest, PortalCart } from "@/lib/portal-cart-types";

/**
 * Portal carts (#245, Task 8) — one `portal_carts` document per portal
 * grant (`id` = the grant id), holding what a customer has put together in
 * Design a Space before they Generate a quote. This is NOT a quote row: no
 * estimate number is ever allocated here, and nothing here is priced —
 * `src/lib/portal-pricing.ts` (Task 7) re-prices the cart's lines from the
 * server-canonical catalog index every time it's read. `portal_carts` is
 * intentionally absent from SYNCABLE_COLLECTIONS (doc-tables.ts) — it is
 * written only through permission-checked portal server actions, never the
 * offline sync push endpoint.
 *
 * Types (`CartLine`, `CurtainRequest`, `PortalCart`) are the pure shapes
 * from Task 7's `src/lib/portal-cart-types.ts` — re-exported here so callers
 * only need one import for "the cart store".
 */
export type { CartLine, CurtainRequest, PortalCart };

/** A cart holds at most this many lines. */
export const MAX_CART_LINES = 200;
/** A line's qty is clamped to this ceiling. */
export const MAX_LINE_QTY = 10000;

function isFiniteInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n);
}

/** Round to the nearest integer, then clamp to 1..MAX_LINE_QTY. */
function clampQty(qty: number): number {
  return Math.min(MAX_LINE_QTY, Math.max(1, Math.round(qty)));
}

/**
 * Keep only finite-integer values in 0..MAX_LINE_QTY (Task 7 review
 * follow-up) — a bad add-on quantity from the client is dropped rather than
 * stored, never clamped into something misleading.
 */
function sanitizeFixtureOptions(
  opts: Record<string, number> | null | undefined
): Record<string, number> | undefined {
  if (!opts) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (isFiniteInt(value) && value >= 0 && value <= MAX_LINE_QTY) out[key] = value;
  }
  return out;
}

function emptyCart(grantId: string, customerId: string): PortalCart {
  return { id: grantId, customerId, locationId: null, lines: [], updatedAt: Date.now() };
}

/**
 * The cart for this grant — empty when the row is absent, OR when the
 * stored `customerId` doesn't match the caller's (a cart for customer A is
 * never returned, or mutated, for customer B; the next save simply
 * overwrites the row under the caller's own customerId).
 */
export async function getCart(grantId: string, customerId: string): Promise<PortalCart> {
  const doc = await getDoc<PortalCart>("portal_carts", grantId);
  if (!doc || doc.customerId !== customerId) return emptyCart(grantId, customerId);
  return { ...doc, lines: Array.isArray(doc.lines) ? doc.lines : [] };
}

/** Insert or fully replace the cart document. Stamps `updatedAt`. */
export async function saveCart(cart: PortalCart): Promise<PortalCart> {
  const stored: PortalCart = { ...cart, updatedAt: Date.now() };
  await upsertDoc("portal_carts", stored);
  return stored;
}

/**
 * Add a line. A `kind: "part"` line with a SKU that matches an existing
 * `part` line merges — qty adds to the existing line — rather than creating
 * a second line for the same SKU. Fixtures (which carry their own chosen
 * options) and curtains (always a fresh request) are always new lines.
 *
 * Throws when `qty` isn't a finite integer >= 1 ("Enter a quantity from 1 to
 * 10,000."), and when adding a genuinely new line would push the cart past
 * MAX_CART_LINES ("Your quote can hold up to 200 lines."). A valid qty above
 * MAX_LINE_QTY is clamped, not refused.
 */
export async function addLine(
  grantId: string,
  customerId: string,
  line: Omit<CartLine, "lineId">
): Promise<PortalCart> {
  if (!isFiniteInt(line.qty) || line.qty < 1) {
    throw new Error("Enter a quantity from 1 to 10,000.");
  }
  const qty = clampQty(line.qty);
  const cart = await getCart(grantId, customerId);

  if (line.kind === "part" && line.sku) {
    const existing = cart.lines.find((l) => l.kind === "part" && l.sku === line.sku);
    if (existing) {
      existing.qty = clampQty(existing.qty + qty);
      return saveCart(cart);
    }
  }

  if (cart.lines.length >= MAX_CART_LINES) {
    throw new Error("Your quote can hold up to 200 lines.");
  }

  const newLine: CartLine = {
    lineId: globalThis.crypto.randomUUID().slice(0, 8),
    kind: line.kind,
    sku: line.sku,
    fixtureId: line.fixtureId,
    fixtureOptions: sanitizeFixtureOptions(line.fixtureOptions),
    curtainInputs: line.curtainInputs,
    qty,
  };
  cart.lines.push(newLine);
  return saveCart(cart);
}

/**
 * Patch one line. `qty` <= 0 removes the line outright; a valid qty above
 * MAX_LINE_QTY clamps to it; a non-finite/non-numeric qty is ignored (the
 * rest of the patch, e.g. fixtureOptions, still applies). Missing lineId is
 * a no-op — returns the cart unchanged.
 */
export async function updateLine(
  grantId: string,
  customerId: string,
  lineId: string,
  patch: { qty?: number; fixtureOptions?: Record<string, number> }
): Promise<PortalCart> {
  const cart = await getCart(grantId, customerId);
  const idx = cart.lines.findIndex((l) => l.lineId === lineId);
  if (idx === -1) return cart;

  if (patch.qty !== undefined && Number.isFinite(patch.qty)) {
    if (patch.qty <= 0) {
      cart.lines.splice(idx, 1);
      return saveCart(cart);
    }
    cart.lines[idx] = { ...cart.lines[idx], qty: clampQty(patch.qty) };
  }
  if (patch.fixtureOptions !== undefined) {
    cart.lines[idx] = {
      ...cart.lines[idx],
      fixtureOptions: sanitizeFixtureOptions(patch.fixtureOptions),
    };
  }
  return saveCart(cart);
}

/** Remove one line by id. A missing lineId is a no-op. */
export async function removeLine(
  grantId: string,
  customerId: string,
  lineId: string
): Promise<PortalCart> {
  const cart = await getCart(grantId, customerId);
  cart.lines = cart.lines.filter((l) => l.lineId !== lineId);
  return saveCart(cart);
}

/** Set (or clear) the cart's venue/location. */
export async function setVenue(
  grantId: string,
  customerId: string,
  locationId: string | null
): Promise<PortalCart> {
  const cart = await getCart(grantId, customerId);
  cart.locationId = locationId;
  return saveCart(cart);
}

/** Soft-delete the cart row (e.g. after Generate spawns the real quote). */
export async function clearCart(grantId: string): Promise<void> {
  await softDeleteDoc("portal_carts", grantId);
}
