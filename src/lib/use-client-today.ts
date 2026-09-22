"use client";
import { useSyncExternalStore } from "react";
import { isoDateOf } from "./catalog-books";

const emptySubscribe = () => () => {};

/**
 * The BROWSER's calendar day as `YYYY-MM-DD`, for date inputs that default
 * to "today" (the importers' "price list effective" fields, #133).
 *
 * The server renders its own `today` (Vercel runs in UTC, so from ~6 pm US
 * time its "today" is already tomorrow); handing that straight to the input
 * shows the wrong day, and reading the clock during render would hydrate
 * mismatched. useSyncExternalStore's server snapshot is the repo's
 * lint-clean answer (home-calendar.tsx): SSR and hydration use `serverToday`
 * so the markup matches, then React re-renders once with the client snapshot
 * — the browser's day — with no state set from an effect
 * (react-hooks/set-state-in-effect is an error here).
 */
export function useClientToday(serverToday: string): string {
  return useSyncExternalStore(
    emptySubscribe,
    () => isoDateOf(Date.now()),
    () => serverToday
  );
}
