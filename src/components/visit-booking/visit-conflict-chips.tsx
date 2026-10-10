"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Conflict } from "@/lib/visit-plan/check";
import ConflictBadge from "./conflict-badge";

type Fetched = { key: string; map: Record<string, Conflict[]> };
const ConflictsCtx = createContext<Record<string, Conflict[]> | null>(null);

/** Loads conflict badges for a list of visits once, after the page renders —
 *  from a GET route (/api/visits/conflicts), never a server action: Next runs
 *  a page's actions one at a time, so a slow badge load would queue Edit's
 *  booking check, Save and Delete behind it. `version` re-asks after the
 *  list's visits changed (an edit saved) without remounting the list. */
export function VisitConflictProvider({ ids, version = "", children }: { ids: string[]; version?: string; children: ReactNode }) {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const sig = ids.join("|");
  const key = `${sig}§${version}`;
  useEffect(() => {
    if (!sig) return;
    const ctl = new AbortController();
    const qs = sig.split("|").map((id) => `ids=${encodeURIComponent(id)}`).join("&");
    fetch(`/api/visits/conflicts?${qs}`, { signal: ctl.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, Conflict[]>>) : Promise.reject(new Error(String(r.status)))))
      .then((map) => {
        if (!ctl.signal.aborted) setFetched({ key, map });
      })
      // Badges are advisory: a failure just shows none.
      .catch(() => {});
    return () => ctl.abort();
  }, [sig, key]);
  // A map only counts for the ids + version it was fetched for: an emptied
  // list or an edited visit never shows the previous answer.
  const map = sig && fetched?.key === key ? fetched.map : null;
  return <ConflictsCtx.Provider value={map}>{children}</ConflictsCtx.Provider>;
}

export function VisitConflictChip({ id }: { id: string }) {
  const map = useContext(ConflictsCtx);
  const list = map?.[id];
  return list?.length ? <ConflictBadge conflicts={list} compact /> : null;
}
