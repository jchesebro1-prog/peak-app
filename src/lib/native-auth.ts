import crypto from "node:crypto";
import { decryptWith, encryptWith } from "@/lib/gmail/crypto";

/**
 * Native sign-in hand-off (spec docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md).
 *
 * The Capacitor shell cannot complete Google OAuth inside its WebView, so the
 * round trip runs in an in-app Safari sheet and the resulting Auth.js session
 * cookie is carried back into the WebView as a short-lived, PKCE-bound,
 * AES-GCM "hand-off code" on a quartzite://auth URL. This module is pure:
 * no env, no request objects, no logging — the routes own those.
 */

export type HandoffCookie = { name: string; value: string };

/** Auth.js session cookie names, secure family first (https deployments). */
export const SESSION_COOKIE_BASES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
] as const;

export const HANDOFF_TTL_MS = 60_000;

/**
 * The session cookie(s) to copy: the base cookie and/or its `.N` chunks
 * (Auth.js chunks JWTs over ~4 KB). Prefers the __Secure- family when both
 * exist so an http twin never shadows the real one. Chunks are ordered by
 * index so they re-assemble in the WebView exactly as Auth.js expects.
 */
export function pickSessionCookies(all: HandoffCookie[]): HandoffCookie[] {
  for (const base of SESSION_COOKIE_BASES) {
    const matches = all.filter((c) => c.name === base || c.name.startsWith(base + "."));
    if (matches.length === 0) continue;
    return matches
      .map((c) => ({ ...c, idx: c.name === base ? -1 : Number(c.name.slice(base.length + 1)) }))
      .filter((c) => c.idx === -1 || Number.isInteger(c.idx))
      .sort((a, b) => a.idx - b.idx)
      .map(({ name, value }) => ({ name, value }));
  }
  return [];
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url(sha256(verifier)) — the same digest the WebView computes with SubtleCrypto. */
export function challengeFor(verifier: string): string {
  return b64url(crypto.createHash("sha256").update(verifier, "utf8").digest());
}

export function isChallenge(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
}

type Payload = { v: 1; c: HandoffCookie[]; ch: string; n: string; exp: number };

export function mintHandoffCode(
  p: { cookies: HandoffCookie[]; challenge: string; next: string; now?: number; ttlMs?: number },
  secret: string
): string {
  const now = p.now ?? Date.now();
  const payload: Payload = {
    v: 1,
    c: p.cookies,
    ch: p.challenge,
    n: p.next,
    exp: now + (p.ttlMs ?? HANDOFF_TTL_MS),
  };
  return encryptWith(JSON.stringify(payload), secret);
}

export type RedeemResult =
  | { ok: true; cookies: HandoffCookie[]; next: string }
  | { ok: false; reason: "malformed" | "expired" | "mismatch" };

export function redeemHandoffCode(
  code: string,
  verifier: string,
  secret: string,
  now: number = Date.now()
): RedeemResult {
  let payload: Payload;
  try {
    payload = JSON.parse(decryptWith(code, secret)) as Payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !payload ||
    payload.v !== 1 ||
    !Array.isArray(payload.c) ||
    typeof payload.ch !== "string" ||
    typeof payload.n !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (now > payload.exp) return { ok: false, reason: "expired" };
  const expected = Buffer.from(payload.ch, "utf8");
  const actual = Buffer.from(challengeFor(verifier), "utf8");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, cookies: payload.c, next: payload.n };
}
