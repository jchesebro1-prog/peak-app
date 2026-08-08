import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import { qtyOwned } from "./equipment-items";

/**
 * Rentals module — equipment bookings (the reservation/checkout records
 * against equipment-items.ts stock). Doc-store collection
 * "equipment_bookings", matching the catalog_parts/repair_jobs pattern
 * (D129) — no prototype ancestor.
 *
 * No "reserved" status: per the design spec, editing/quoting a rental does
 * not lock stock, so no booking row exists until a quote is Won, at which
 * point it's created directly as "confirmed" (mirrors repair-jobs.ts's
 * quote→job pattern, where a job doesn't exist until the quote is won).
 */

export type BookingStatus = "confirmed" | "out" | "returned" | "cancelled";

export type EquipmentBooking = {
  id: string;
  itemId: string;
  locationId: string;
  qty: number;
  quoteId: string;
  startDate: number;
  endDate: number;
  status: BookingStatus;
  /** Total price for ONE unit across the line's full [startDate, endDate]
   *  range (i.e. `priceRental(days, item.rates)`) — NOT a per-day rate.
   *  `qty * rate` is the line's sell price. Frozen at booking creation
   *  (Won time), not re-derived later. */
  rate: number;
};

const COLLECTION = "equipment_bookings";

/** Inclusive range overlap — a booking that starts exactly when another ends
 *  still contends for the same unit that day, so the shared boundary counts
 *  as overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

export async function list(): Promise<EquipmentBooking[]> {
  return listDocs<EquipmentBooking>(COLLECTION);
}

export async function byQuote(quoteId: string): Promise<EquipmentBooking[]> {
  const all = await list();
  return all.filter((b) => b.quoteId === quoteId);
}

/** Units of `itemId` free at `locationId` for the [start, end] window: owned
 *  stock minus everything already committed (confirmed or out) that overlaps
 *  the window. Cancelled/returned bookings never count against availability. */
export async function availableQty(
  itemId: string,
  locationId: string,
  start: number,
  end: number
): Promise<number> {
  const owned = await qtyOwned(itemId, locationId);
  const all = await list();
  const committed = all
    .filter(
      (b) =>
        b.itemId === itemId &&
        b.locationId === locationId &&
        (b.status === "confirmed" || b.status === "out") &&
        overlaps(b.startDate, b.endDate, start, end)
    )
    .reduce((sum, b) => sum + b.qty, 0);
  return owned - committed;
}

export async function create(
  booking: Omit<EquipmentBooking, "id">
): Promise<EquipmentBooking> {
  const all = await list();
  const id = `bk-${all.length + 1}`;
  const doc: EquipmentBooking = { ...booking, id };
  await upsertDoc(COLLECTION, doc);
  return doc;
}

export async function setStatus(id: string, status: BookingStatus): Promise<void> {
  const booking = await getDoc<EquipmentBooking>(COLLECTION, id);
  if (!booking) return;
  await upsertDoc(COLLECTION, { ...booking, status });
}

/** Minimal structural view of a rental quote doc (collection "quotes") —
 *  `rental` is written by the rentals quote builder (a later task); read
 *  structurally here the same way repair-jobs.ts reads RepairQuoteLike. */
type RentalQuoteLike = {
  id: string;
  quoteType?: string;
  status?: string;
  rental?: {
    lines: Array<{
      itemId: string;
      locationId: string;
      qty: number;
      startDate: number;
      endDate: number;
      rate: number;
    }>;
  };
};

/** Reads quote.rental (written by the rentals/quote builder) and creates one
 *  booking per line, each `confirmed`. Mirrors repair-jobs.ts's createFromQuote. */
export async function createFromQuote(quoteId: string): Promise<EquipmentBooking[]> {
  const existing = await byQuote(quoteId);
  if (existing.length) return existing;
  const q = await getDoc<RentalQuoteLike>("quotes", quoteId);
  if (!q || q.quoteType !== "rental" || !q.rental) return [];
  const created: EquipmentBooking[] = [];
  for (const line of q.rental.lines) {
    created.push(
      await create({
        itemId: line.itemId,
        locationId: line.locationId,
        qty: line.qty,
        quoteId,
        startDate: line.startDate,
        endDate: line.endDate,
        status: "confirmed",
        rate: line.rate,
      })
    );
  }
  return created;
}

/** Idempotent sweep — scan won rental quotes, create bookings for any not yet
 *  made. Safe to call alongside the other four sync* functions in
 *  quotes/actions.ts. */
export async function syncFromQuotes(): Promise<number> {
  const quotes = await listDocs<RentalQuoteLike>("quotes");
  let made = 0;
  for (const q of quotes) {
    if (q.quoteType !== "rental" || q.status !== "won") continue;
    const existing = await byQuote(q.id);
    if (existing.length) continue;
    const created = await createFromQuote(q.id);
    made += created.length;
  }
  return made;
}
