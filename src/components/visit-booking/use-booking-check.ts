"use client";

import { useEffect, useState } from "react";
import type { BookingCheckResult } from "@/lib/visit-plan/types";

/** Spec 2026-10-09 site-visit scheduling — the booking screen's live check.
 *  Debounced: a calendar read + routing per call, never per keystroke. A GET
 *  route (/api/visits/check), not a server action, so Save / Schedule never
 *  queue behind it; a superseded check is aborted. */
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
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/visits/check?input=" + encodeURIComponent(sig), { signal: ctl.signal, cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error("check " + res.status);
          return (await res.json()) as BookingCheckResult | { error: string };
        })
        .then((r) => {
          if (!ctl.signal.aborted) setState("error" in r ? { forSig: sig, result: null, error: r.error } : { forSig: sig, result: r, error: "" });
        })
        .catch(() => {
          if (!ctl.signal.aborted) setState({ forSig: sig, result: null, error: FAILED });
        });
    }, BOOKING_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [sig]);
  // The last answer stays on screen (dimmed) while a newer one is on its way;
  // a failure belongs to the inputs it was for, so it never lingers over a new check.
  return { loading: state.forSig !== sig, result: state.result, error: state.forSig === sig ? state.error : "" };
}
