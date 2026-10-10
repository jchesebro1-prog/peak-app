"use client";

import { useEffect, useState } from "react";
import { bookingCheckAction } from "@/app/(app)/visit-booking-actions";
import type { BookingCheckResult } from "@/lib/visit-plan/types";

/** Spec 2026-10-09 site-visit scheduling — the booking screen's live check.
 *  Debounced: a calendar read + routing per call, never per keystroke. */
export const BOOKING_CHECK_DEBOUNCE_MS = 800;
const FAILED = "Couldn't check conflicts — you can still schedule.";

export type BookingCheckArgs = {
  visitId: string | null;
  customerId: string | null;
  locationId: string | null;
  address: string;
  startAt: number | null;
  endAt: number | null;
  lead: string;
  attendees: string[];
};

export function useBookingCheck(args: BookingCheckArgs): { loading: boolean; result: BookingCheckResult | null; error: string } {
  const sig = JSON.stringify(args);
  const [state, setState] = useState<{ forSig: string; result: BookingCheckResult | null; error: string }>({ forSig: "", result: null, error: "" });
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      bookingCheckAction(JSON.parse(sig) as BookingCheckArgs)
        .then((r) => {
          if (live) setState("error" in r ? { forSig: sig, result: null, error: r.error } : { forSig: sig, result: r, error: "" });
        })
        .catch(() => {
          if (live) setState({ forSig: sig, result: null, error: FAILED });
        });
    }, BOOKING_CHECK_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sig]);
  // The last answer stays on screen (dimmed) while a newer one is on its way.
  return { loading: state.forSig !== sig, result: state.result, error: state.error };
}
