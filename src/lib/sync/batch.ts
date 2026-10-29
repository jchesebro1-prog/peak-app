/**
 * D1330 — split an outbox flush into request-sized pushes. Vercel refuses a request body over ~4.5 MB (413), and a
 * scanned booth capture carries a card image of up to ~335 KB base64, so a device with a dozen queued scans could
 * never push in one body — and one failed flush used to hold back every other field record on the device.
 *
 * Pure (no DOM / IndexedDB): the engine measures each entry and sends one POST per batch.
 */

/** Serialized bytes per push body, kept well under Vercel's ~4.5 MB request limit. */
export const PUSH_MAX_BYTES = 3_000_000;
/** Records per push body: the smaller of the push route's per-collection cap (1,000) and 200. */
export const PUSH_MAX_RECORDS = 200;

export const PUSH_TOO_LARGE_MESSAGE = "This item is too large to sync — remove its photo and save again.";

export type BatchItem = { collection: string; id: string; size: number };

/** Groups entries, in order, into batches of at most `maxRecords` entries whose summed `size` stays ≤ `maxBytes`. An
 *  entry larger than `maxBytes` on its own goes alone in its own batch (the server decides whether it fits). */
export function batchOutbox<T extends BatchItem>(entries: readonly T[], opts: { maxBytes: number; maxRecords: number }): T[][] {
  const maxRecords = Math.max(1, Math.floor(opts.maxRecords));
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const e of entries) {
    const size = Math.max(0, e.size || 0);
    if (cur.length && (bytes + size > opts.maxBytes || cur.length >= maxRecords)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += size;
    if (size > opts.maxBytes) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The byte size of one record's push shape (`{ id, rev, doc }`, as the engine sends it). */
export function pushRecordSize(rec: { id: string; rev: number; doc: Record<string, unknown> }): number {
  const json = JSON.stringify({ id: rec.id, rev: rec.rev, doc: rec.doc });
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(json).length : json.length;
}
