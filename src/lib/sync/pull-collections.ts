import { SYNCABLE_COLLECTIONS, SYNCABLE_SET, type CollectionName } from "@/db/doc-tables";
import { withoutSaveFields } from "@/lib/field-files/save-stamp";
import { can } from "@/lib/team";

/**
 * Jeff 2026-10-15 #39 — only field roles pull the offline field set:
 * estimators, managers and admins, i.e. whoever holds `create` (ROLE_PERMS:
 * Admin / Manager / Estimator all do, a Reviewer-only user does not). Anyone
 * else gets 403 and the client engine stops pulling for the page's life.
 */
export function mayPullFieldData(roles: string[] | null | undefined): boolean {
  return can("create", roles);
}

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
  if (coll === "booth_captures") {
    // An inline card image (local dev without Blob) and the server's claim stamp are never sent to a device; a Blob path is a reference and stays.
    return changes.map((c) => {
      if (!("cardImage" in c.doc) && !("claimUntil" in c.doc)) return c;
      const doc = { ...c.doc };
      delete doc.cardImage;
      delete doc.claimUntil;
      return { ...c, doc };
    });
  }
  if (coll !== "surveys") return changes;
  return changes.map((c) => ({ ...c, doc: withoutSaveFields(c.doc) }));
}
