/**
 * Pop-out windows — live-sync timing rules (spec §5). Pure.
 *
 * LiveSync owes a window a refresh for one of two reasons: another window
 * posted `changed` ("change"), or this window came back into view after more
 * than 30 s ("focus"). `nextRefreshStep` decides, every time a timer fires,
 * whether to refresh now, wait, park the refresh until the network is back,
 * or drop it.
 */

/** A change-driven refresh waits until this long after the last keystroke in an editable field. */
export const TYPING_QUIET_MS = 3000;
/** While an editable field stays focused, re-check this often. */
export const EDITABLE_RECHECK_MS = 3000;
/** Refresh on focus/visible only if the last refresh was longer ago than this. */
export const FOCUS_REFRESH_MS = 30_000;
/** A focus/visible refresh waits this long first (Wi-Fi is often still joining after a wake). */
export const FOCUS_SETTLE_MS = 1500;
/** After the network comes back, a parked refresh runs this long later. */
export const ONLINE_RETRY_MS = 2000;
/** Change-driven refreshes run at most this often per window (trailing: the last change is always honoured). */
export const CHANGE_THROTTLE_MS = 5000;

export type RefreshKind = "change" | "focus";

/** The typing guard (spec §5, D907/D913).
 *  - Any refresh waits while an editable field is focused (re-checked every 3 s).
 *  - A change-driven refresh also waits until 3 s after the last keystroke in
 *    an editable field, even once the field has lost focus.
 *  There is no reliable "unsaved input" signal for an arbitrary field
 *  (React keeps a controlled input's value attribute in sync), so a focused
 *  editable field counts as unsaved. */
export function shouldRefreshNow(i: {
  kind?: RefreshKind;
  lastKeyAt: number | null | undefined;
  now: number;
  activeIsEditable: boolean;
}): "now" | { deferMs: number } {
  const kind = i.kind ?? "change";
  let typingLeft = 0;
  if (kind === "change" && typeof i.lastKeyAt === "number") {
    const since = i.now - i.lastKeyAt;
    typingLeft = since < 0 ? TYPING_QUIET_MS : Math.max(0, TYPING_QUIET_MS - since);
  }
  if (typingLeft > 0) return { deferMs: typingLeft };
  if (i.activeIsEditable) return { deferMs: EDITABLE_RECHECK_MS };
  return "now";
}

/** The `activeIsEditable` the refresh guard uses: a caret left in a field of a
 *  window that is not focused (a background main window) does not block its
 *  refreshes. `canYieldToOpenInMain` keeps using the raw value (conservative). */
export function editableBlocksRefresh(windowHasFocus: boolean, activeIsEditable: boolean): boolean {
  return windowHasFocus && activeIsEditable;
}

/** True when more than 30 s have passed since the last refresh (or none yet). */
export function shouldFocusRefresh(lastRefreshAt: number | null | undefined, now: number): boolean {
  if (typeof lastRefreshAt !== "number") return true;
  return now - lastRefreshAt > FOCUS_REFRESH_MS;
}

/** The offline gate (D910). In Next 16 a `router.refresh()` whose fetch fails
 *  falls back to a full browser reload, which the service worker answers from
 *  its cache — in-memory edits are lost. Refresh only when the browser says it
 *  is online AND the sync engine is connected (online and not "Work offline").
 *  An unknown value (undefined) does not block. */
export function canRefreshOnline(i: { navigatorOnline?: boolean; engineConnected?: boolean }): boolean {
  return i.navigatorOnline !== false && i.engineConnected !== false;
}

/** Trailing throttle (D911): ms a change-driven refresh must still wait so
 *  refreshes are at least `CHANGE_THROTTLE_MS` apart (0 = may run now). */
export function throttleWaitMs(lastRefreshAt: number | null | undefined, now: number, minGapMs = CHANGE_THROTTLE_MS): number {
  if (typeof lastRefreshAt !== "number") return 0;
  const since = now - lastRefreshAt;
  if (since < 0) return minGapMs;
  return Math.max(0, minGapMs - since);
}

/** The delay to arm when a `changed` message arrives and no refresh timer is
 *  pending: the 1 s debounce, or longer if the throttle says so. (A pending
 *  timer is left alone — the refresh it runs fetches everything saved so far,
 *  so the latest change is still honoured.) */
export function changeDelayMs(lastRefreshAt: number | null | undefined, now: number, debounceMs: number): number {
  return Math.max(debounceMs, throttleWaitMs(lastRefreshAt, now));
}

export type RefreshStep =
  | { action: "refresh" }
  | { action: "wait"; ms: number }
  | { action: "offline" }
  | { action: "drop" }
  | { action: "idle" };

/** One decision for an owed refresh, made when its timer fires.
 *  Order: nothing owed → idle; offline → park until back online (D910);
 *  only a focus refresh owed and the page holds unsaved work → drop (D912);
 *  typing guard → wait; a change refresh inside the 5 s throttle → wait (D911);
 *  else refresh. A change owed wins over a focus owed (it is never dropped). */
export function nextRefreshStep(i: {
  owedChange: boolean;
  owedFocus: boolean;
  navigatorOnline?: boolean;
  engineConnected?: boolean;
  hold: boolean;
  lastKeyAt: number | null | undefined;
  activeIsEditable: boolean;
  lastRefreshAt: number | null | undefined;
  now: number;
}): RefreshStep {
  if (!i.owedChange && !i.owedFocus) return { action: "idle" };
  if (!canRefreshOnline(i)) return { action: "offline" };
  const kind: RefreshKind = i.owedChange ? "change" : "focus";
  if (kind === "focus" && i.hold) return { action: "drop" };
  const typing = shouldRefreshNow({ kind, lastKeyAt: i.lastKeyAt, now: i.now, activeIsEditable: i.activeIsEditable });
  if (typing !== "now") return { action: "wait", ms: typing.deferMs };
  if (kind === "change") {
    const t = throttleWaitMs(i.lastRefreshAt, i.now);
    if (t > 0) return { action: "wait", ms: t };
  }
  return { action: "refresh" };
}

/** "Open in main window" (D912): may this main window navigate away? Not
 *  while an editable field is focused, a key was typed in the last 3 s, or
 *  the page holds unsaved work — the pop-out then opens a new tab instead. */
export function canYieldToOpenInMain(i: {
  activeIsEditable: boolean;
  lastKeyAt: number | null | undefined;
  now: number;
  hold: boolean;
}): boolean {
  if (i.hold || i.activeIsEditable) return false;
  if (typeof i.lastKeyAt === "number") {
    const since = i.now - i.lastKeyAt;
    if (since < 0 || since < TYPING_QUIET_MS) return false;
  }
  return true;
}
