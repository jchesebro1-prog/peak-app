import { notesForCustomer } from "@/lib/stores/notes";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { noteFeedRows, quoteFeedRows, type FeedRow } from "@/lib/customer-feed-rows";

/**
 * #21 customer Activity feed loader — SERVER-ONLY (fans out over the doc
 * stores; never import from a "use client" file). Read-time aggregation over
 * the customer's notes and quotes. Tombstones are already excluded by listDocs.
 */

/** Feed cap — "Show more" is deferred (product flag, D121). */
export const FEED_CAP = 60;

export async function loadCustomerFeed(cust: { id: string; name: string }): Promise<FeedRow[]> {
  const [notes, quotes] = await Promise.all([notesForCustomer(cust.id), getAllQuotes()]);

  const rows: FeedRow[] = [];

  for (const n of notes) rows.push(...noteFeedRows(n));

  // The SAME rule the customer page's rollups use (companies/[id]/page.tsx):
  // canonical id link, denormalized-name fallback for unlinked quotes.
  for (const q of quotes.filter((qt) => (qt.customerId ? qt.customerId === cust.id : qt.customer === cust.name)))
    rows.push(...quoteFeedRows(q));

  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, FEED_CAP);
}
