/**
 * Pop-out windows — live-sync timing rules (spec §5). Pure.
 */

/** A refresh waits until this long after the last keystroke in an editable field. */
export const TYPING_QUIET_MS = 3000;
/** Refresh on focus/visible only if the last refresh was longer ago than this. */
export const FOCUS_REFRESH_MS = 30_000;

/** Never overwrite unsaved typing: while the focused element is editable and a
 *  key was pressed in the last 3 s, defer until 3 s after that keystroke. */
export function shouldRefreshNow(i: {
  lastKeyAt: number | null | undefined;
  now: number;
  activeIsEditable: boolean;
}): "now" | { deferMs: number } {
  if (!i.activeIsEditable || typeof i.lastKeyAt !== "number") return "now";
  const since = i.now - i.lastKeyAt;
  if (since < 0) return { deferMs: TYPING_QUIET_MS };
  if (since >= TYPING_QUIET_MS) return "now";
  return { deferMs: TYPING_QUIET_MS - since };
}

/** True when more than 30 s have passed since the last refresh (or none yet). */
export function shouldFocusRefresh(lastRefreshAt: number | null | undefined, now: number): boolean {
  if (typeof lastRefreshAt !== "number") return true;
  return now - lastRefreshAt > FOCUS_REFRESH_MS;
}
