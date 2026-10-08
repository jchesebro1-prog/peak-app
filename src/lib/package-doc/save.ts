import { sanitizePackageDoc } from "./sanitize";
import type { PackageDoc } from "./types";

/**
 * Estimator Phase 5 — what a Save stores at spec.document (saveQuoteAction):
 *  - the payload carries no document (key absent or undefined — an older
 *    client): keep the stored one (re-validated);
 *  - `document: null`: remove it (Remove document);
 *  - anything else: the sanitized document; a posted document that sanitizes
 *    to null (over the caps, or not a document at all) REFUSES the whole save
 *    with PACKAGE_DOC_TOO_LARGE — the stored document is never wiped.
 * `document: null` in the result = store none. Pure; client-safe.
 */

export const PACKAGE_DOC_TOO_LARGE = "The document is too large to save — shorten it.";

export type PackageDocSave = { ok: true; document: PackageDoc | null } | { ok: false; error: string };

export function packageDocForSave(posted: unknown, stored: unknown): PackageDocSave {
  if (posted === undefined) return { ok: true, document: sanitizePackageDoc(stored) };
  if (posted === null) return { ok: true, document: null };
  const clean = sanitizePackageDoc(posted);
  return clean ? { ok: true, document: clean } : { ok: false, error: PACKAGE_DOC_TOO_LARGE };
}
