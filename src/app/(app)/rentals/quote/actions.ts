"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requirePerm } from "@/lib/session";
import { get as getCustomer, nameFor } from "@/lib/stores/customers";
import { create as createQuote, update as updateQuote, setStatus } from "@/lib/stores/quotes";
import { get as getEquipmentItem } from "@/lib/stores/equipment-items";
import { availableQty, createFromQuote } from "@/lib/stores/equipment-bookings";
import { priceRental } from "@/lib/pricing/rental";

/**
 * Rental quote mutations (rental twin of the repair/flame/inspection quote
 * actions — repairs/quote/actions.ts is the structural mirror). The client
 * builder previews pricing live with the same pure `priceRental()` this file
 * imports; the source of truth is here — a save/approve always re-prices
 * server-side from the equipment items' CURRENT rates rather than trusting
 * whatever the client posted, so a saved quote's value always matches the
 * catalog. The saved `rental` subdoc is shaped exactly as
 * equipment-bookings.ts's `createFromQuote` reads it: `{ lines: [{ itemId,
 * locationId, qty, startDate, endDate, rate }] }` — no extra fields, so line
 * item names/SKUs are re-resolved from `equipmentItems` on display rather
 * than denormalized onto the saved doc.
 *
 * `rate` on each line is the auto-priced total for ONE unit across the whole
 * booked date range (i.e. `priceRental(days, item.rates)`), not a per-day
 * figure — `qty * rate` is the line's sell price, and it's what
 * equipment-bookings.ts's `EquipmentBooking.rate` freezes at booking
 * creation (frozen at Won time, not live-looked-up later, same reasoning as
 * the design spec's "rate is frozen... same pattern other quote builders
 * already use so historical quotes don't drift when catalog rates change").
 */

const DAY = 86400000;

type PostedLine = { itemId: string; locationId: string; qty: number };

/** "YYYY-MM-DD" (from a date input) -> local midnight epoch ms. Mirrors the
 *  sod()/iso() date-string round-trip already used across the scheduling
 *  screens (e.g. schedule/page.tsx, inspections/scheduling/page.tsx). */
function dateMs(v: string): number {
  const [y, m, d] = String(v || "").split("-").map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getTime();
}

/** Inclusive day count between two local-midnight timestamps — same
 *  `Math.round((end - start) / DAY) + 1` convention schedule/page.tsx uses
 *  for its install-day counts, so a same-day rental bills as 1 day. */
function daysBetween(startDate: number, endDate: number): number {
  return Math.max(1, Math.round((endDate - startDate) / DAY) + 1);
}

/** Re-price + persist a rental quote; returns the saved quote id. */
async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const customerId = String(formData.get("customerId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const contactRole = String(formData.get("contactRole") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const startDateStr = String(formData.get("startDate") || "");
  const endDateStr = String(formData.get("endDate") || "");

  let postedLines: PostedLine[] = [];
  try {
    postedLines = JSON.parse(String(formData.get("lines") || "[]"));
  } catch {
    postedLines = [];
  }

  const startDate = dateMs(startDateStr);
  const endDate = dateMs(endDateStr);
  if (!customerId || !startDate || !endDate || endDate < startDate || !postedLines.length) {
    return null;
  }
  const days = daysBetween(startDate, endDate);

  const lines: Array<{
    itemId: string;
    locationId: string;
    qty: number;
    startDate: number;
    endDate: number;
    rate: number;
  }> = [];
  for (const pl of postedLines) {
    const qty = Math.max(1, Math.round(Number(pl.qty) || 0));
    if (!pl.itemId || !pl.locationId) continue;
    const item = await getEquipmentItem(pl.itemId);
    if (!item) continue;
    const rate = priceRental(days, {
      dayRate: item.dayRate,
      weekRate: item.weekRate,
      monthRate: item.monthRate,
    });
    lines.push({ itemId: pl.itemId, locationId: pl.locationId, qty, startDate, endDate, rate });
  }
  if (!lines.length) return null;

  const value = lines.reduce((sum, l) => sum + l.rate * l.qty, 0);

  const cust = await getCustomer(customerId);
  const custName = (await nameFor(customerId)) || cust?.name || "";
  const contact = contactName ? { name: contactName, role: contactRole, email: contactEmail } : null;
  const name = quoteName || custName + " — Rental";

  const payload = {
    name,
    customer: custName,
    customerId: customerId || null,
    locationId: null,
    value: Math.round(value),
    margin: 0,
    source: "rental",
    quoteType: "rental",
    owner: user.name,
    contact,
    rental: { lines },
  };

  const q = editingId ? await updateQuote(editingId, payload) : await createQuote(payload);
  return (q && q.id) || editingId || null;
}

export async function saveRentalQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  revalidatePath("/", "layout");
  if (id) redirect("/rentals/quote?id=" + encodeURIComponent(id) + "&saved=1");
}

export async function approveRentalQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  if (!id) {
    revalidatePath("/", "layout");
    return;
  }
  await requirePerm("send");
  // accept -> mark won, which spawns confirmed equipment bookings. Bypasses
  // the punch #60 approval gate: this screen IS the approval, same reasoning
  // as the repair/flame/inspection builders (see quotes.ts's
  // SetStatusOpts doc — "engine-owned-flow" names exactly these four
  // call sites).
  await setStatus(id, "won", undefined, { bypassApprovalGate: "engine-owned-flow" });
  await createFromQuote(id);
  revalidatePath("/", "layout");
  redirect("/rentals/quote?id=" + encodeURIComponent(id) + "&approved=1");
}

/** Availability for one item/location/date-range combo — wraps
 *  equipment-bookings.ts's `availableQty()` so the client picker can show a
 *  live WARNING (never a hard block, per the design spec's "let staff
 *  override with judgment" philosophy) as lines are added/edited. */
export async function checkRentalAvailabilityAction(
  itemId: string,
  locationId: string,
  startDate: number,
  endDate: number
): Promise<number | null> {
  await requireUser();
  if (!itemId || !locationId || !startDate || !endDate) return null;
  return availableQty(itemId, locationId, startDate, endDate);
}
