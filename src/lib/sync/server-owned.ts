/**
 * #351 review — fields of offline-synced documents that only the server
 * writes. `/api/sync/push` takes whole documents from any active user's
 * browser, so these are never accepted from a push: stripped on insert, and
 * carried over from the stored copy on update. Pure.
 *
 * Add a field here whenever a synced collection gains a server-owned one.
 */
export const SERVER_OWNED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // booth_captures never take the generic push path (pushBoothCapture records them); this is defence in depth.
  booth_captures: ["leadId", "outcome", "cardImagePath", "claimUntil"],
};

/** Fields not carried back onto a document the push revives from Deleted. */
const DROP_ON_REVIVE: Readonly<Record<string, readonly string[]>> = {
};

/**
 * The document to store for a push into `coll`: `incoming` with every
 * server-owned field removed, then (on update) the stored values put back.
 * `stored` is null on insert.
 */
export function sanitizePushedDoc(
  coll: string,
  incoming: Record<string, unknown>,
  stored: { doc: unknown; deleted: boolean } | null
): Record<string, unknown> {
  const fields = SERVER_OWNED_FIELDS[coll];
  if (!fields?.length) return incoming;
  const out: Record<string, unknown> = { ...incoming };
  for (const f of fields) delete out[f];
  const prev = stored && stored.doc && typeof stored.doc === "object" ? (stored.doc as Record<string, unknown>) : null;
  if (prev) {
    const drop = stored!.deleted ? DROP_ON_REVIVE[coll] ?? [] : [];
    for (const f of fields) if (f in prev && prev[f] !== undefined && !drop.includes(f)) out[f] = prev[f];
  }
  return out;
}
