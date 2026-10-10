/**
 * #323 final review — a meetings read on a page that could not fail before
 * #323 (Home, the Inbox count, record-page cards, the company feed, ⌘K):
 * a meetings-table error (e.g. a deploy whose migration hasn't run yet)
 * degrades to `fallback` and is logged, instead of a 500. Pure plumbing; no DB.
 */
export async function meetingsReadOr<T>(p: Promise<T>, fallback: T, where: string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error(`[meetings] ${where}: read failed, showing none —`, (e as Error)?.message || e);
    return fallback;
  }
}
