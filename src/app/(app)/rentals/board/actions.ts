"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { list, setStatus, type BookingStatus } from "@/lib/stores/equipment-bookings";

/**
 * Booking board mutation (Task 8). The board only ever offers two buttons —
 * "Mark out" (confirmed → out) and "Mark returned" (out → returned) — but a
 * hand-crafted request could still post any `status` value for any booking
 * id, so the transition is re-checked server-side against the booking's
 * *current* stored status (not whatever the client claims it is) before
 * `setStatus` runs. Anything outside this map (skipping straight to
 * "returned", reviving a "cancelled" booking, re-confirming an "out" one) is
 * silently rejected.
 */
const ALLOWED_NEXT: Record<BookingStatus, BookingStatus | null> = {
  confirmed: "out",
  out: "returned",
  returned: null,
  cancelled: null,
};

export async function toggleBookingStatus(formData: FormData): Promise<void> {
  await requirePerm("create");
  const id = String(formData.get("id") || "");
  const next = String(formData.get("status") || "") as BookingStatus;
  if (!id) return;

  const booking = (await list()).find((b) => b.id === id);
  if (!booking) return;
  if (ALLOWED_NEXT[booking.status] !== next) return;

  await setStatus(id, next);
  revalidatePath("/rentals/board");
}
