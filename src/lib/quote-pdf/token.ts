import { createHmac, timingSafeEqual } from "node:crypto";
import type { PdfKind } from "./state";

/**
 * Print-route tokens (#222). The headless browser that prints a quote has no
 * team session, so each print URL carries a short-lived HMAC of
 * "print:<kind>:<id>:<exp>" keyed by AUTH_SECRET. Pure: the secret and the
 * clock are parameters, so the harness tests expiry and tampering directly.
 * Server-only (node:crypto) — never import from a client component.
 */
export const PRINT_TOKEN_TTL_MS = 120_000;

/** Every print route this token can gate — the four quote/letter kinds
 *  (`PdfKind`, unwidened: other code still switches on it exhaustively) plus
 *  #245's datasheet-thumbnail render, #292's cut sheets and #296's rack
 *  sheets and #301's estimate cover and #301 slice C's Grid drawing set
 *  (one token for the page, one per asset it draws), none of which prints
 *  a quote document. */
export type PrintTokenKind = PdfKind | "part-thumb" | "cutsheets" | "rack" | "cover" | "grid-set";

function mac(secret: string, kind: PrintTokenKind, id: string, exp: number): string {
  return createHmac("sha256", secret).update(`print:${kind}:${id}:${exp}`).digest("base64url");
}

export function signPrintToken(secret: string, kind: PrintTokenKind, id: string, nowMs: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a print token.");
  const exp = nowMs + PRINT_TOKEN_TTL_MS;
  return `${exp}.${mac(secret, kind, id, exp)}`;
}

export function verifyPrintToken(secret: string, token: string, kind: PrintTokenKind, id: string, nowMs: number): boolean {
  if (!secret || typeof token !== "string") return false;
  // A NaN clock makes both expiry comparisons false — fail closed instead.
  if (!Number.isFinite(nowMs)) return false;
  // No leading zero on the expiry (#293 slice 3 final fix): one expiry has
  // exactly one spelling, so "0" + a valid token never verifies.
  const m = /^([1-9]\d{0,14})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || nowMs > exp || exp - nowMs > PRINT_TOKEN_TTL_MS) return false;
  const want = Buffer.from(mac(secret, kind, id, exp));
  const have = Buffer.from(m[2]);
  return want.length === have.length && timingSafeEqual(want, have);
}
