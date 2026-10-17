import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Spec 2026-10-16 §5 — the permanent per-datasheet link printed on the
 * estimate PDF's last page: `/d/ds/<quoteId>/<docId>/<sig>`, `sig` =
 * base64url(HMAC-SHA256(key, "est-datasheet:<quoteId>:<docId>")) cut to 22
 * chars (132 bits), `key` = HMAC-SHA256(AUTH_SECRET, a fixed label) — its own
 * key, domain-separated from the print and share tokens. No expiry, no
 * nonce: revoking the client link never touches it (Jeff). It dies when the
 * quote is deleted or stops listing the datasheet (the route checks), or
 * when AUTH_SECRET rotates. Pure apart from node:crypto; server-only.
 */

export const DATASHEET_LINK_PREFIX = "/d/ds/";
export const DATASHEET_SIG_RE = /^[A-Za-z0-9_-]{22}$/;
export const DATASHEET_LINK_QUOTE_MAX = 128;
const KEY_LABEL = "quartzite:est-datasheet-link:v1";

function keyOf(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

export function datasheetLinkSig(secret: string, quoteId: string, docId: string): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a datasheet link.");
  return createHmac("sha256", keyOf(secret)).update(`est-datasheet:${quoteId}:${docId}`).digest("base64url").slice(0, 22);
}

export function verifyDatasheetLinkSig(secret: string, quoteId: string, docId: string, sig: string): boolean {
  if (!secret || typeof quoteId !== "string" || !quoteId || typeof docId !== "string" || !docId || typeof sig !== "string" || !DATASHEET_SIG_RE.test(sig)) return false;
  const want = Buffer.from(datasheetLinkSig(secret, quoteId, docId));
  const have = Buffer.from(sig);
  return want.length === have.length && timingSafeEqual(want, have);
}

export function datasheetLinkPath(secret: string, quoteId: string, docId: string): string {
  return `${DATASHEET_LINK_PREFIX}${encodeURIComponent(quoteId)}/${encodeURIComponent(docId)}/${datasheetLinkSig(secret, quoteId, docId)}`;
}
