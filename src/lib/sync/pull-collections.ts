import { SYNCABLE_COLLECTIONS, SYNCABLE_SET, type CollectionName } from "@/db/doc-tables";
import { withoutSaveFields } from "@/lib/field-files/save-stamp";

/**
 * #323 final review — the collections GET /api/sync/pull may serve: the offline
 * field set only (SYNCABLE_COLLECTIONS, which the client engine's
 * FIELD_COLLECTIONS mirrors — the only thing it ever asks for). Anything else
 * a browser names is dropped, so the open pull endpoint can never hand a
 * signed-in user another rep's private Krisp meetings (transcripts included)
 * or any other server-authoritative collection. No `collections` param → the
 * field set, never every DOC_TABLES key.
 */
export function pullCollections(param: string | null | undefined): CollectionName[] {
  if (param == null) return [...SYNCABLE_COLLECTIONS];
  const asked = param.split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set(asked)].filter((c): c is CollectionName => SYNCABLE_SET.has(c));
}

/** #344 C-final D — what GET /api/sync/pull serves for one collection's changes: a survey's server-only save-order map
 *  (`_saveSeqs`, random editor ids + seqs) and any stray save stamp are stripped before the device caches the doc
 *  (pushes ignore them anyway); every other collection passes through unchanged. */
export function pulledChanges<C extends { doc: Record<string, unknown> }>(coll: string, changes: C[]): C[] {
  if (coll !== "surveys") return changes;
  return changes.map((c) => ({ ...c, doc: withoutSaveFields(c.doc) }));
}
