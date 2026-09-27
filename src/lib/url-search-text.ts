/**
 * #243 — the one decision behind useUrlSearchText (use-url-search-text.ts),
 * kept pure so the spec harness can check it without React.
 *
 * A URL-as-state search box re-syncs its draft from the URL's `q` whenever
 * that `q` changes. It must NOT do so when the new `q` is just its own
 * (slow) navigation landing: by then the user has usually typed on, and
 * adopting the older, trimmed `q` wipes out what they typed.
 *
 * @param urlQ       the `q` the server just rendered with
 * @param lastPushed the trimmed `q` this box itself last navigated to, or
 *                   null when it has not navigated (or has since adopted an
 *                   outside change)
 * @param draft      what the box currently shows
 * @returns true when the box should replace its draft with `urlQ`
 */
export function shouldAdoptUrlQ(urlQ: string, lastPushed: string | null, draft: string): boolean {
  const u = urlQ.trim();
  // Already showing it — keep the draft as typed (a trailing space the URL
  // trimmed off stays put).
  if (u === draft.trim()) return false;
  // Our own navigation landing while the user kept typing.
  if (lastPushed !== null && u === lastPushed) return false;
  // Anything else came from outside this box: Back, a "clear" link, a reset.
  return true;
}
