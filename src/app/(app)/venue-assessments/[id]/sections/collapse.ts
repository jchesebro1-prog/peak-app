"use client";

/* Per-viewer, per-survey collapsed sections (#344 A8). localStorage read through useSyncExternalStore so SSR and
   hydration agree (the plan-legend idiom). The snapshot is the raw string, so it stays referentially stable. */
import { useCallback, useMemo, useSyncExternalStore } from "react";

const EVT = "va-collapsed";

export const collapseStorageKey = (surveyId: string): string => `va:collapsed:${surveyId}`;

export function parseCollapsed(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, b]) => typeof b === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** A stored choice wins; otherwise "advanced" sections start collapsed (today's default). */
export function isCollapsed(map: Record<string, boolean>, sec: { id: string; advanced?: boolean }): boolean {
  return map[sec.id] ?? !!sec.advanced;
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}

export function useCollapsed(surveyId: string): [Record<string, boolean>, (id: string, collapsed: boolean) => void] {
  const key = collapseStorageKey(surveyId);
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => ""
  );
  const map = useMemo(() => parseCollapsed(raw), [raw]);
  const set = useCallback(
    (id: string, collapsed: boolean) => {
      const next = { ...parseCollapsed((() => { try { return window.localStorage.getItem(key); } catch { return null; } })()), [id]: collapsed };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode — the event still re-renders this view */
      }
      window.dispatchEvent(new Event(EVT));
    },
    [key]
  );
  return [map, set];
}
