"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { visitConflictSummariesAction } from "@/app/(app)/visit-booking-actions";
import type { Conflict } from "@/lib/visit-plan/check";
import ConflictBadge from "./conflict-badge";

const ConflictsCtx = createContext<Record<string, Conflict[]> | null>(null);

/** Loads conflict badges for a list of visits once, after the page renders.
 *  `version` re-asks after the list's visits changed (an edit saved) without
 *  remounting the list. */
export function VisitConflictProvider({ ids, version = "", children }: { ids: string[]; version?: string; children: ReactNode }) {
  const [map, setMap] = useState<Record<string, Conflict[]> | null>(null);
  const sig = ids.join("|");
  useEffect(() => {
    if (!sig) return;
    let live = true;
    visitConflictSummariesAction(sig.split("|"))
      .then((m) => {
        if (live) setMap(m);
      })
      // Badges are advisory: a failure just shows none (never a stale set).
      .catch(() => {
        if (live) setMap(null);
      });
    return () => {
      live = false;
    };
  }, [sig, version]);
  return <ConflictsCtx.Provider value={map}>{children}</ConflictsCtx.Provider>;
}

export function VisitConflictChip({ id }: { id: string }) {
  const map = useContext(ConflictsCtx);
  const list = map?.[id];
  return list?.length ? <ConflictBadge conflicts={list} compact /> : null;
}
