/**
 * Estimator handoff — the new-estimate adoption map (pure: no React, the Node checks import it). A new estimate's
 * history entries carry a session token (shims/next-navigation.ts TOKEN); its first save records token → minted id so
 * Back / Forward into a pre-save entry reopens the SAVED estimate. Kept in sessionStorage so it survives a reload of
 * the window; "Reset to production snapshot" clears it (runtime/reset.ts) — the saved estimates it points at are gone.
 */
export const ADOPTED_KEY = "peak-handoff-adopted";

export const adopted = new Map<string, string>();

function load(): void {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(ADOPTED_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) if (typeof v === "string") adopted.set(k, v);
  } catch {
    /* no sessionStorage — adoption lasts until the window closes */
  }
}
load();

export function adopt(token: string, id: string): void {
  adopted.set(token, id);
  try {
    sessionStorage.setItem(ADOPTED_KEY, JSON.stringify(Object.fromEntries(adopted)));
  } catch {
    /* in memory only */
  }
}

/** Forgets every adoption — the in-memory map and the sessionStorage copy. */
export function clearAdopted(): void {
  adopted.clear();
  try {
    sessionStorage.removeItem(ADOPTED_KEY);
  } catch {
    /* nothing stored */
  }
}
