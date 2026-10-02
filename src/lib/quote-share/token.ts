import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * #293 slice 3 — the client share-link token (spec §2.6, §7). Modeled on the
 * print token (src/lib/quote-pdf/token.ts), domain-separated ("share:" vs
 * "print:") and keyed to a per-quote nonce stored on the quote
 * (Quote.shareLink): `<exp>.<base64url HMAC-SHA256(secret,
 * "share:quote:<id>:<nonce>:<exp>")>`. The nonce is stored on the quote doc
 * — never sent to the Client link panel, but /api/sync/pull ships whole quote
 * docs (nonce included) to active team users. That is not a credential: a
 * token can't be made without AUTH_SECRET. A token dies the moment the
 * nonce rotates (Revoke) or the stored expiry changes. Pure: the secret and
 * the clock are parameters. Server-only (node:crypto) — never import from a
 * client component.
 */
export const SHARE_DEFAULT_TTL_MS = 60 * 86_400_000;
export const SHARE_MAX_TTL_MS = 366 * 86_400_000;
/** No leading zero on the expiry: one expiry has exactly one spelling, so
 *  "0" + a valid token never verifies. */
export const SHARE_TOKEN_RE = /^([1-9]\d{0,14})\.([A-Za-z0-9_-]{43})$/;

/** 32 random bytes, base64url (43 chars). Rotated on every revoke. */
export function newShareNonce(): string {
  return randomBytes(32).toString("base64url");
}

function mac(secret: string, quoteId: string, nonce: string, exp: number): string {
  return createHmac("sha256", secret).update(`share:quote:${quoteId}:${nonce}:${exp}`).digest("base64url");
}

export function signShareToken(secret: string, quoteId: string, nonce: string, exp: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a share token.");
  if (!nonce || !Number.isSafeInteger(exp) || exp <= 0) throw new Error("A share token needs a nonce and a positive expiry.");
  return `${exp}.${mac(secret, quoteId, nonce, exp)}`;
}

/** Fails closed on anything but a valid, unexpired MAC for exactly this
 *  quote id + stored nonce + stored expiry (spec §2.6). */
export function verifyShareToken(
  secret: string,
  token: string,
  quoteId: string,
  stored: { nonce: string; expiresAt: number } | null | undefined,
  nowMs: number
): boolean {
  if (!secret || typeof token !== "string" || typeof quoteId !== "string" || !quoteId) return false;
  if (!stored || typeof stored.nonce !== "string" || !stored.nonce || typeof stored.expiresAt !== "number") return false;
  if (!(stored.expiresAt > 0)) return false; // revoked, or never created
  // A NaN clock makes both expiry comparisons false — fail closed instead.
  if (!Number.isFinite(nowMs)) return false;
  const m = SHARE_TOKEN_RE.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp !== stored.expiresAt) return false;
  if (nowMs > exp || exp - nowMs > SHARE_MAX_TTL_MS) return false;
  const want = Buffer.from(mac(secret, quoteId, stored.nonce, exp));
  const have = Buffer.from(m[2]);
  return want.length === have.length && timingSafeEqual(want, have);
}
