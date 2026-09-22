# Native Auth Hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google sign-in work inside the Capacitor iOS shell by running OAuth in an in-app Safari sheet and handing the resulting Auth.js session cookie back to the WebView through a `quartzite://auth?code=…` deep link.

**Architecture:** A pure module (`src/lib/native-auth.ts`) mints and redeems a 60-second, PKCE-bound, AES-GCM hand-off code that carries the Auth.js session cookie verbatim. Three Next 16 route handlers under `/api/native/auth/` (`start` → Auth.js `signIn`, `handoff` → mint code + scheme page, `exchange` → set the cookie). A client helper opens the sheet with `@capacitor/browser` and a login-page listener catches the scheme URL with `@capacitor/app`. Every native call is gated by `isNativePlatform()` and `Capacitor.isPluginAvailable`. Spec: `docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md`.

**Tech Stack:** Next.js 16 App Router route handlers, next-auth v5 (`signIn`/`auth` from `@/auth`), `node:crypto` AES-256-GCM (existing `lib/gmail/crypto.ts`), Capacitor 8.5 (`@capacitor/core`, `@capacitor/app`, `@capacitor/browser`), `tsx` harnesses (`test:specs` pure, `test:smoke` real server).

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first. Work in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/native-auth-handoff` (branch `worktree-native-auth-handoff`); `node_modules` is a symlink to the main checkout.
- **Baseline is already red on origin/main** (763febd): `tsc` has 106 errors, all in `src/app/(app)/inbox/link-actions.ts`, `link-sidebar.tsx`, `src/lib/gmail/{domains,label-interpret,label-sync,linking,resolve}.ts`; `test:specs` is 986 PASS / 5 FAIL plus a TypeError in the seed checks. Do not touch those files. A gate passes when it adds **no new** errors/failures: compare `npx tsc --noEmit 2>&1 | grep -c 'error TS'` (baseline 106) and the `FAIL` count of `test:specs` (baseline 5).
- **PGlite is single-process.** `test:specs` is pure. `test:smoke` boots its own dev server on a throwaway DB — never run it alongside `next dev` or another `tsx`; `ps aux | grep -E 'tsx|next dev' | grep -v grep` must be empty first. There is no `timeout` binary on this Mac; don't use it.
- **Native-only code lives behind `src/lib/platform.ts`.** `@capacitor/app` and `@capacitor/browser` are imported only with dynamic `import()` inside a branch guarded by `isNativePlatform()` and `Capacitor.isPluginAvailable(...)`; never at module top level. The browser behaviour of the login page must be unchanged.
- **Version skew:** the Vercel deploy and the installed binary ship separately. A missing plugin must degrade to the web path, never throw.
- No emoji in UI copy. No hardcoded accent colours. Timestamps epoch-ms.
- Route handlers follow `src/app/api/gmail/callback/route.ts` (Next 16 shape: `export async function GET(req: NextRequest)`, `NextResponse.redirect(new URL(path, req.nextUrl.origin))`). Before touching a route handler, skim `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- **Never log the hand-off code or cookie values.**
- Spec harness: `ok(cond, msg)` in `scripts/test-review-and-spec.ts`; pure synchronous checks go in the top section (before `async function asyncChecks()` at ~line 3012). Imports use the `@/` alias.
- Do NOT run `npx cap sync`, `cap open`, Xcode, gradle or any simulator command inside a subagent task. Task 4 and Task 6 are executed by the main session (human-in-the-loop).
- `git add` only the files each task names. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Map

| File | Responsibility |
|---|---|
| `src/lib/gmail/crypto.ts` (modify) | Expose `encryptWith(plain, secret)` / `decryptWith(blob, secret)`; `encryptToken`/`decryptToken` delegate with `AUTH_SECRET` |
| `src/lib/native-auth.ts` (create) | Pure: cookie picking, challenge, mint/redeem hand-off code |
| `src/app/api/native/auth/start/route.ts` (create) | Begin Auth.js Google sign-in with the hand-off redirect |
| `src/app/api/native/auth/handoff/route.ts` (create) | Mint the code from the live session, serve the `quartzite://` page |
| `src/app/api/native/auth/exchange/route.ts` (create) | Redeem the code, set the session cookie in the WebView |
| `src/middleware.ts` (modify) | Exempt `api/native/auth` from the session gate |
| `src/lib/native-auth-client.ts` (create) | Client: open the sheet, handle the returned scheme URL |
| `src/app/login/login-buttons.tsx` (modify) | Google button tries the native path first |
| `src/app/login/native-auth-return.tsx` (create) | Client listener for `appUrlOpen` / launch URL on the login page |
| `src/app/login/page.tsx` (modify) | Mount `NativeAuthReturn` |
| `ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml` (modify) | Register the `quartzite` scheme |
| `package.json`, `package-lock.json`, `ios/App/CapApp-SPM/Package.swift`, `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle` (modify) | Add `@capacitor/app` + `@capacitor/browser`; `cap sync` output |
| `scripts/test-review-and-spec.ts`, `scripts/smoke-routes.ts` (modify) | Tests |
| `DECISIONS.md`, `PUNCHLIST.md`, `docs/superpowers/specs/2026-09-21-native-shell-phase-2-design.md` (modify) | D153, #31 note, device checklist line |

---

### Task 1: Pure hand-off module + crypto refactor

**Files:**
- Modify: `src/lib/gmail/crypto.ts`
- Create: `src/lib/native-auth.ts`
- Test: `scripts/test-review-and-spec.ts` (pure section, insert just above `async function asyncChecks()`)

**Interfaces:**
- Produces (`crypto.ts`): `encryptWith(plain: string, secret: string): string`, `decryptWith(blob: string, secret: string): string`. Existing `encryptToken`/`decryptToken` keep their signatures.
- Produces (`native-auth.ts`):
  - `type HandoffCookie = { name: string; value: string }`
  - `SESSION_COOKIE_BASES: readonly ["__Secure-authjs.session-token", "authjs.session-token"]`
  - `pickSessionCookies(all: HandoffCookie[]): HandoffCookie[]`
  - `challengeFor(verifier: string): string`
  - `isChallenge(s: unknown): s is string`
  - `HANDOFF_TTL_MS = 60_000`
  - `mintHandoffCode(p: { cookies: HandoffCookie[]; challenge: string; next: string; now?: number; ttlMs?: number }, secret: string): string`
  - `type RedeemResult = { ok: true; cookies: HandoffCookie[]; next: string } | { ok: false; reason: "malformed" | "expired" | "mismatch" }`
  - `redeemHandoffCode(code: string, verifier: string, secret: string, now?: number): RedeemResult`

- [ ] **Step 1: Write the failing spec tests.** Add the import near the other `@/lib` imports at the top of `scripts/test-review-and-spec.ts`:

```ts
import {
  pickSessionCookies,
  challengeFor,
  isChallenge,
  mintHandoffCode,
  redeemHandoffCode,
  HANDOFF_TTL_MS,
} from "@/lib/native-auth";
```

Insert this block immediately above the line `async function asyncChecks(): Promise<void> {`:

```ts
/* ---- native auth hand-off (spec 2026-09-21-native-auth-handoff) ---- */
{
  const secret = "spec-secret-not-real";
  const secureSet = [
    { name: "__Secure-authjs.callback-url", value: "x" },
    { name: "__Secure-authjs.session-token.1", value: "part1" },
    { name: "authjs.session-token", value: "insecure" },
    { name: "__Secure-authjs.session-token.0", value: "part0" },
  ];
  const picked = pickSessionCookies(secureSet);
  ok(
    picked.map((c) => c.name).join(",") === "__Secure-authjs.session-token.0,__Secure-authjs.session-token.1",
    "pickSessionCookies: prefers the __Secure- family, includes chunks in order, drops the insecure twin"
  );
  ok(
    pickSessionCookies([{ name: "authjs.session-token", value: "v" }]).length === 1,
    "pickSessionCookies: falls back to the plain family on http"
  );
  ok(pickSessionCookies([{ name: "other", value: "v" }]).length === 0, "pickSessionCookies: none -> []");

  const verifier = "verifier-abc-123";
  const challenge = challengeFor(verifier);
  ok(challenge.length === 43 && /^[A-Za-z0-9_-]+$/.test(challenge), "challengeFor: 43-char base64url");
  ok(challengeFor(verifier) === challenge, "challengeFor: deterministic");
  ok(isChallenge(challenge) && !isChallenge("short") && !isChallenge(42), "isChallenge: shape check");

  const cookies = [{ name: "__Secure-authjs.session-token", value: "eyJ.session" }];
  const now = 1_800_000_000_000;
  const code = mintHandoffCode({ cookies, challenge, next: "/field-work", now }, secret);
  ok(!code.includes("eyJ.session"), "mintHandoffCode: cookie value is not visible in the code");
  const good = redeemHandoffCode(code, verifier, secret, now + 5_000);
  ok(good.ok && good.cookies[0].value === "eyJ.session" && good.next === "/field-work", "redeem: round trip returns cookies + next");
  const wrong = redeemHandoffCode(code, "not-the-verifier", secret, now + 5_000);
  ok(!wrong.ok && wrong.reason === "mismatch", "redeem: wrong verifier -> mismatch");
  const late = redeemHandoffCode(code, verifier, secret, now + HANDOFF_TTL_MS + 1);
  ok(!late.ok && late.reason === "expired", "redeem: past ttl -> expired");
  const flipped = code.slice(0, -2) + (code.endsWith("A") ? "B" : "A") + code.slice(-1);
  ok(!redeemHandoffCode(flipped, verifier, secret, now).ok, "redeem: tampered code -> not ok");
  const otherKey = redeemHandoffCode(code, verifier, "another-secret", now);
  ok(!otherKey.ok && otherKey.reason === "malformed", "redeem: different secret -> malformed");
  ok(!redeemHandoffCode("garbage", verifier, secret, now).ok, "redeem: garbage -> not ok");
}
```

- [ ] **Step 2: Run to verify it fails.** `export PATH=$HOME/.local/node/bin:$PATH; npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → an import error mentioning `@/lib/native-auth`.

- [ ] **Step 3: Refactor `src/lib/gmail/crypto.ts`.** Replace the whole file with:

```ts
import crypto from "node:crypto";

/**
 * At-rest encryption for OAuth refresh/access tokens stored in the
 * gmail_connections table, and (spec 2026-09-21-native-auth-handoff) the
 * short-lived native sign-in hand-off code. AES-256-GCM with a key derived
 * from the given secret via SHA-256. Format:
 * base64(iv).base64(authTag).base64(ciphertext).
 *
 * encryptToken/decryptToken keep the original AUTH_SECRET-bound behaviour;
 * encryptWith/decryptWith take the secret explicitly so pure code (and its
 * tests) never touch process.env. If AUTH_SECRET is missing we throw: a real
 * deployment always has it, so this only fires in a misconfigured setup —
 * better loud than silently storing plaintext tokens.
 */

function keyFor(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is required to encrypt Gmail tokens (set it in the environment)."
    );
  }
  return secret;
}

export function encryptWith(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptWith(blob: string, secret: string): string {
  const [ivB64, tagB64, dataB64] = (blob || "").split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFor(secret),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function encryptToken(plain: string): string {
  return encryptWith(plain, authSecret());
}

export function decryptToken(blob: string): string {
  return decryptWith(blob, authSecret());
}
```

- [ ] **Step 4: Create `src/lib/native-auth.ts`:**

```ts
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
```

- [ ] **Step 5: Run the spec harness.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E "native|pickSession|challenge|redeem|mint"` → every listed line starts with `PASS`. Then `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -c '^FAIL'` → `5` (baseline, unchanged).

- [ ] **Step 6: Typecheck.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` → `106` (baseline). `npx tsc --noEmit 2>&1 | grep -E "native-auth|gmail/crypto"` → nothing.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/gmail/crypto.ts src/lib/native-auth.ts scripts/test-review-and-spec.ts
git commit -m "feat(native): pure hand-off code mint/redeem + injectable-secret crypto

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Route handlers + middleware exemption + smoke coverage

**Files:**
- Create: `src/app/api/native/auth/start/route.ts`
- Create: `src/app/api/native/auth/handoff/route.ts`
- Create: `src/app/api/native/auth/exchange/route.ts`
- Modify: `src/middleware.ts:17-19`
- Test: `scripts/smoke-routes.ts` (ROUTES array, after `"/design/engagements"` at ~line 87)

**Interfaces:**
- Consumes (Task 1): `pickSessionCookies`, `isChallenge`, `mintHandoffCode`, `redeemHandoffCode`, `HandoffCookie`.
- Consumes (existing): `signIn`, `auth`, `googleConfigured` from `@/auth`; `safeCallbackPath(raw, origin)` from `@/lib/auth-redirect`.
- Produces: `GET /api/native/auth/start?next&challenge`, `GET /api/native/auth/handoff?next&challenge`, `POST /api/native/auth/exchange` `{code, verifier}` → `200 {next}` | `400 {error:"malformed"}` | `401 {error:"expired"|"mismatch"}`. The scheme URL shape `quartzite://auth?code=<urlencoded>` is what Task 3's client parses.

- [ ] **Step 1: Add smoke routes (they will fail until the routes exist).** In `scripts/smoke-routes.ts`, after the line `"/design/engagements",` add:

```ts
  // native sign-in hand-off (spec 2026-09-21-native-auth-handoff): bad GET
  // input redirects to /login rather than 4xx, so both must stay 3xx here.
  "/api/native/auth/start",
  "/api/native/auth/handoff",
```

- [ ] **Step 2: Middleware.** In `src/middleware.ts` change the matcher string so `api/auth|` becomes `api/auth|api/native/auth|`:

```ts
    "/((?!api/auth|api/native/auth|api/leads/intake|api/gmail/sync|login|lead-intake|portal|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icons|images).*)",
```

Also extend the doc comment above it with one sentence: `/api/native/auth/* (start, exchange) run before a session exists in the WebView — see docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md.`

- [ ] **Step 3: `src/app/api/native/auth/start/route.ts`:**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { googleConfigured, signIn } from "@/auth";
import { safeCallbackPath } from "@/lib/auth-redirect";
import { isChallenge } from "@/lib/native-auth";

/**
 * GET /api/native/auth/start?next=&challenge=
 * Opened by the Capacitor shell in an in-app Safari sheet. Kicks off the
 * normal Auth.js Google sign-in with the hand-off route as the destination,
 * so state/PKCE/session cookies all live in the sheet's cookie jar.
 * Spec: docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const challenge = req.nextUrl.searchParams.get("challenge");
  if (!isChallenge(challenge) || !googleConfigured()) {
    return NextResponse.redirect(new URL("/login?error=native", origin));
  }
  const next = safeCallbackPath(req.nextUrl.searchParams.get("next") ?? undefined, origin);
  const handoff = new URL("/api/native/auth/handoff", origin);
  handoff.searchParams.set("next", next);
  handoff.searchParams.set("challenge", challenge);
  // signIn sets the Auth.js cookies via cookies() and throws Next's redirect
  // to Google; both are supported inside a Route Handler.
  await signIn("google", { redirectTo: handoff.pathname + handoff.search });
}
```

- [ ] **Step 4: `src/app/api/native/auth/handoff/route.ts`:**

```ts
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeCallbackPath } from "@/lib/auth-redirect";
import { isChallenge, mintHandoffCode, pickSessionCookies } from "@/lib/native-auth";

export const dynamic = "force-dynamic";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * GET /api/native/auth/handoff?next=&challenge=
 * Runs in the Safari sheet after Google. With a live session it wraps the
 * Auth.js session cookie into a 60 s, challenge-bound code and serves a
 * minimal page that opens quartzite://auth?code=… (auto + button).
 * Never logs the code or the cookie. Spec: 2026-09-21-native-auth-handoff.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const challenge = req.nextUrl.searchParams.get("challenge");
  if (!isChallenge(challenge)) {
    return NextResponse.redirect(new URL("/login?error=native", origin));
  }
  const session = await auth();
  if (!session?.user?.active) {
    const login = new URL("/login", origin);
    login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  const cookies = pickSessionCookies(req.cookies.getAll().map(({ name, value }) => ({ name, value })));
  const secret = process.env.AUTH_SECRET;
  if (cookies.length === 0 || !secret) {
    return NextResponse.redirect(new URL("/login?error=native", origin));
  }
  const next = safeCallbackPath(req.nextUrl.searchParams.get("next") ?? undefined, origin);
  const code = mintHandoffCode({ cookies, challenge, next }, secret);
  const target = "quartzite://auth?code=" + encodeURIComponent(code);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Return to Quartzite</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,system-ui,sans-serif;background:#0f1115;color:#e8eaee}
  main{text-align:center;padding:32px}
  a{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:10px;
    background:#fff;color:#111;text-decoration:none;font-weight:600}
  p{color:#9aa0ab;font-size:14px}
</style></head>
<body><main>
  <div style="font-size:18px;font-weight:600">Signed in</div>
  <p>Returning you to the Quartzite app.</p>
  <a href="${escapeHtml(target)}">Return to Quartzite</a>
  <script>location.replace(${JSON.stringify(target)});</script>
</main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
```

- [ ] **Step 5: `src/app/api/native/auth/exchange/route.ts`:**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { redeemHandoffCode } from "@/lib/native-auth";

const THIRTY_DAYS_S = 30 * 24 * 60 * 60; // Auth.js default session maxAge

/**
 * POST /api/native/auth/exchange  { code, verifier }
 * Called by the WebView after the quartzite://auth deep link. Redeems the
 * hand-off code and sets the very same Auth.js session cookie(s) here, so
 * the WebView is signed in exactly as the Safari sheet was.
 * Spec: docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md
 */
export async function POST(req: NextRequest) {
  let body: { code?: unknown; verifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  const { code, verifier } = body ?? {};
  const secret = process.env.AUTH_SECRET;
  if (typeof code !== "string" || typeof verifier !== "string" || !secret) {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  const result = redeemHandoffCode(code, verifier, secret);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "malformed" ? 400 : 401 }
    );
  }
  const res = NextResponse.json({ next: result.next });
  for (const c of result.cookies) {
    res.cookies.set(c.name, c.value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: c.name.startsWith("__Secure-"),
      maxAge: THIRTY_DAYS_S,
    });
  }
  return res;
}

export function GET() {
  return NextResponse.json({ error: "method" }, { status: 405 });
}
```

- [ ] **Step 6: Typecheck.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` → `106`. `npx tsc --noEmit 2>&1 | grep native` → nothing.

- [ ] **Step 7: Smoke.** Confirm nothing else is running: `ps aux | grep -E 'tsx|next dev' | grep -v grep` → empty. Then `npm run -s test:smoke 2>&1 | tail -8`. Expected: the two new routes report ok (both are 302 → `/login…`), overall summary matches the pre-task run except for the two added lines. If `/api/native/auth/start` shows a 5xx, `signIn` threw outside a redirect: check the server log lines above the summary and fix before continuing.

- [ ] **Step 8: Commit.**

```bash
git add src/app/api/native/auth/start/route.ts src/app/api/native/auth/handoff/route.ts src/app/api/native/auth/exchange/route.ts src/middleware.ts scripts/smoke-routes.ts
git commit -m "feat(native): /api/native/auth start, handoff and exchange routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Client helper, login button branch, login-page listener

**Files:**
- Create: `src/lib/native-auth-client.ts`
- Modify: `src/app/login/login-buttons.tsx` (the Google button `onClick`)
- Create: `src/app/login/native-auth-return.tsx`
- Modify: `src/app/login/page.tsx` (import + mount)

Before starting: `npm install @capacitor/app@^8 @capacitor/browser@^8` has already been run by the main session in Task 4 if `ls node_modules/@capacitor/app node_modules/@capacitor/browser` lists both. If they are missing, run `export PATH=$HOME/.local/node/bin:$PATH; npm install @capacitor/app@^8 @capacitor/browser@^8` (this edits `package.json` + `package-lock.json`; include them in this task's commit) — it does NOT run `cap sync`.

**Interfaces:**
- Consumes (Task 2): the three routes and the `quartzite://auth?code=` URL shape.
- Consumes (existing): `isNativePlatform()` from `@/lib/platform`; `Capacitor.isPluginAvailable(name)` from `@capacitor/core`.
- Produces (`native-auth-client.ts`): `startNativeGoogleSignIn(next: string): Promise<boolean>`, `handleNativeAuthUrl(url: string): Promise<"ignored" | "done" | "failed">`, `NATIVE_AUTH_SCHEME_PREFIX = "quartzite://auth"`.
- Produces (`native-auth-return.tsx`): default export `NativeAuthReturn` (client component, no props).

- [ ] **Step 1: Create `src/lib/native-auth-client.ts`:**

```ts
"use client";

import { Capacitor } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";

/**
 * Client side of the native sign-in hand-off
 * (docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md).
 * Only ever active inside the Capacitor shell with the Browser/App plugins
 * present; every other combination returns false/"ignored" so callers fall
 * back to the plain web flow (version-skew rule, D174).
 */

export const NATIVE_AUTH_SCHEME_PREFIX = "quartzite://auth";
const VERIFIER_KEY = "qz_native_verifier";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

/** True when the sheet was opened; false means "use the web sign-in". */
export async function startNativeGoogleSignIn(next: string): Promise<boolean> {
  if (!isNativePlatform() || !Capacitor.isPluginAvailable("Browser")) return false;
  try {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem(VERIFIER_KEY, verifier);
    const url = new URL("/api/native/auth/start", window.location.origin);
    url.searchParams.set("next", next);
    url.searchParams.set("challenge", await challengeFor(verifier));
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: url.toString() });
    return true;
  } catch {
    return false;
  }
}

async function closeSheet(): Promise<void> {
  if (!Capacitor.isPluginAvailable("Browser")) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    // Already closed (the user may have dismissed it) — nothing to do.
  }
}

/**
 * Handle a URL the OS delivered to the app. Non-auth URLs are "ignored".
 * On "done" the page has been navigated to `next`; on "failed" the caller
 * shows a retry message.
 */
export async function handleNativeAuthUrl(url: string): Promise<"ignored" | "done" | "failed"> {
  if (!url.startsWith(NATIVE_AUTH_SCHEME_PREFIX)) return "ignored";
  let code: string | null = null;
  try {
    code = new URL(url).searchParams.get("code");
  } catch {
    return "failed";
  }
  const verifier = localStorage.getItem(VERIFIER_KEY);
  localStorage.removeItem(VERIFIER_KEY);
  void closeSheet();
  if (!code || !verifier) return "failed";
  try {
    const res = await fetch("/api/native/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
      credentials: "same-origin",
    });
    if (!res.ok) return "failed";
    const { next } = (await res.json()) as { next?: string };
    window.location.replace(typeof next === "string" && next.startsWith("/") ? next : "/");
    return "done";
  } catch {
    return "failed";
  }
}
```

- [ ] **Step 2: Login button branch.** In `src/app/login/login-buttons.tsx` add the import `import { startNativeGoogleSignIn } from "@/lib/native-auth-client";` under the `signIn` import, and change the Google button's `onClick` from

```tsx
          onClick={() =>
            signIn("google", { callbackUrl: window.location.origin + next })
          }
```

to

```tsx
          onClick={async () => {
            // Inside the Capacitor shell the OAuth round trip runs in a Safari
            // sheet and returns via quartzite://auth (spec 2026-09-21-native-
            // auth-handoff); anywhere else this is the unchanged web flow.
            if (await startNativeGoogleSignIn(next)) return;
            signIn("google", { callbackUrl: window.location.origin + next });
          }}
```

- [ ] **Step 3: Create `src/app/login/native-auth-return.tsx`:**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";
import { handleNativeAuthUrl } from "@/lib/native-auth-client";

/**
 * Mounted on the login page. Inside the Capacitor shell it listens for the
 * quartzite://auth deep link (warm: appUrlOpen; cold: getLaunchUrl) and
 * finishes the sign-in hand-off. Renders nothing on the web.
 */
export default function NativeAuthReturn() {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  useEffect(() => {
    if (!isNativePlatform() || !Capacitor.isPluginAvailable("App")) return;
    let remove: (() => Promise<void>) | undefined;
    let cancelled = false;

    const handle = async (url: string) => {
      setState("busy");
      const result = await handleNativeAuthUrl(url);
      if (cancelled) return;
      if (result === "failed") setState("failed");
      else if (result === "ignored") setState("idle");
    };

    (async () => {
      const { App } = await import("@capacitor/app");
      const listener = await App.addListener("appUrlOpen", ({ url }) => void handle(url));
      remove = () => listener.remove();
      const launch = await App.getLaunchUrl();
      if (launch?.url) void handle(launch.url);
    })().catch(() => {
      /* plugin missing at runtime — web flow still works */
    });

    return () => {
      cancelled = true;
      void remove?.();
    };
  }, []);

  if (state === "idle") return null;
  return (
    <div style={{ textAlign: "center", marginTop: 12, fontSize: 12.5, color: "#9aa0ab" }}>
      {state === "busy" ? "Signing you in…" : "Sign-in could not be completed. Try again."}
    </div>
  );
}
```

- [ ] **Step 4: Mount it.** In `src/app/login/page.tsx` add `import NativeAuthReturn from "./native-auth-return";` after the `LoginButtons` import, and render `<NativeAuthReturn />` immediately after the closing `</div>` of `.pk-login-card` (i.e. before the `Need access?` block).

- [ ] **Step 5: Typecheck + lint.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` → `106`; `npx tsc --noEmit 2>&1 | grep -E "login|native-auth"` → nothing. `npx eslint src/lib/native-auth-client.ts src/app/login` → no errors.

- [ ] **Step 6: Web behaviour unchanged (spec harness is enough here; smoke ran in Task 2).** `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -c '^FAIL'` → `5`.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/native-auth-client.ts src/app/login/login-buttons.tsx src/app/login/native-auth-return.tsx src/app/login/page.tsx
# plus package.json package-lock.json if this task ran npm install
git commit -m "feat(native): login page opens Google in a Safari sheet and finishes via quartzite://auth

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Native project registration (main session, not a subagent)

**Files:**
- Modify: `package.json`, `package-lock.json` (if not already done in Task 3)
- Modify: `ios/App/App/Info.plist`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify (by `cap sync`): `ios/App/CapApp-SPM/Package.swift`, `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`

- [ ] **Step 1: Dependencies.** `export PATH=$HOME/.local/node/bin:$PATH; npm install @capacitor/app@^8 @capacitor/browser@^8` (skip if `package.json` already lists both).

- [ ] **Step 2: iOS scheme.** In `ios/App/App/Info.plist` insert before the final `</dict>`:

```xml
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>com.peaksystemsgroup.quartzite</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>quartzite</string>
			</array>
		</dict>
	</array>
```

- [ ] **Step 3: Android scheme.** In `android/app/src/main/AndroidManifest.xml`, inside the `MainActivity` `<activity>` after the existing LAUNCHER `</intent-filter>`, add:

```xml
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="quartzite" />
            </intent-filter>
```

- [ ] **Step 4: Sync.** `npx cap sync ios && npx cap sync android` → both list `App` and `Browser` under "Updating iOS/Android plugins". `git status --short` shows the Package.swift and gradle plugin lists changed.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json ios/App/App/Info.plist android/app/src/main/AndroidManifest.xml ios/App/CapApp-SPM/Package.swift android/app/capacitor.build.gradle android/capacitor.settings.gradle
git commit -m "feat(native): register quartzite:// scheme; add @capacitor/app + @capacitor/browser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Decisions, punchlist, phase-2 checklist

**Files:**
- Modify: `DECISIONS.md` (append after D149)
- Modify: `PUNCHLIST.md` (item `## 31.` at ~line 2519)
- Modify: `docs/superpowers/specs/2026-09-21-native-shell-phase-2-design.md` (§8 Testing, the `Device (Task 12, human)` bullet at ~line 364)

- [ ] **Step 1: DECISIONS.md.** Append at the end of the file:

```markdown
## D153. Native shell signs in through a Safari sheet and returns by `quartzite://auth` (2026-09-21)

The Capacitor shell (D174) could not sign in: Capacitor hands any non-app host to the system
browser, so Auth.js's state/PKCE cookies were set in the WebView while Google's callback landed in
Safari. Verified on the iOS 27 simulator. Jeff chose to keep OAuth in a real browser context rather
than spoof the WebView's user agent to satisfy Google's embedded-browser check.

- **The whole round trip runs in an in-app Safari sheet** (`@capacitor/browser`,
  SFSafariViewController): `GET /api/native/auth/start` calls Auth.js `signIn("google")` with the
  hand-off route as `redirectTo`, so every Auth.js cookie lives in one jar.
- **The session moves by copying the Auth.js session cookie verbatim**, chunks included, never by
  re-encoding a JWT. `GET /api/native/auth/handoff` reads its own session cookie, wraps it in a
  60-second AES-256-GCM code bound to a PKCE-style challenge, and serves a page that opens
  `quartzite://auth?code=…`. `POST /api/native/auth/exchange` verifies the app-held verifier and sets
  the same cookie in the WebView. Expiry and the per-request role refresh are unchanged.
- **Stateless by design:** the code is encrypted with the existing `lib/gmail/crypto.ts` primitive
  (key from `AUTH_SECRET`); no table, no migration, no new env var. `encryptWith`/`decryptWith`
  now take the secret explicitly so the pure module is testable without env.
- **Custom scheme, not Universal Links** — those need the paid Apple team; they are the upgrade path.
- **Degrades, never throws:** every native call sits behind `isNativePlatform()` and
  `Capacitor.isPluginAvailable`; an old binary falls back to the in-WebView `signIn`.
- Bad GET input redirects to `/login?error=native` (so `test:smoke` covers the routes and a stray
  visitor lands somewhere sensible); only the POST exchange returns JSON 400/401.
- Android gets the manifest intent-filter in the same change but is not built or tested yet.

Spec: `docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md`.
```

- [ ] **Step 2: PUNCHLIST.md.** Under `## 31.` add, as the last bullet of that item:

```markdown
- **2026-09-21 — native sign-in works (D153).** Xcode 27 + iOS 27 simulator on the build Mac; the
  shell opens the hosted app, Google sign-in runs in a Safari sheet and returns via
  `quartzite://auth`. Still open for "a real app": Apple Developer Program, TestFlight, Phase 2 device
  features (`docs/superpowers/specs/2026-09-21-native-shell-phase-2-design.md`).
```

- [ ] **Step 3: Phase 2 spec.** In `docs/superpowers/specs/2026-09-21-native-shell-phase-2-design.md`, extend the `Device (Task 12, human)` bullet: after `keeps the session across relaunch;` insert `Google sign-in opens the Safari sheet and returns through quartzite://auth (D153);`.

- [ ] **Step 4: Commit.**

```bash
git add DECISIONS.md PUNCHLIST.md docs/superpowers/specs/2026-09-21-native-shell-phase-2-design.md
git commit -m "docs: D153 native sign-in hand-off; punchlist #31 + phase-2 device checklist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Gates, simulator build, human sign-in (main session)

- [ ] **Step 1: Four gates vs baseline.** With nothing else running:
  - `npx tsc --noEmit 2>&1 | grep -c 'error TS'` → `106`, and `grep -E "native|login|middleware|crypto"` on that output → nothing.
  - `npx eslint src/lib/native-auth.ts src/lib/native-auth-client.ts src/lib/gmail/crypto.ts src/app/login src/app/api/native src/middleware.ts` → clean.
  - `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -c '^FAIL'` → `5`; the `native`/`redeem`/`pickSession` lines all `PASS`.
  - `npm run -s test:smoke` → both `/api/native/auth/*` routes ok, no 5xx anywhere.
- [ ] **Step 2: Build for the booted iPhone 18 Pro** with the iOS Simulator build tool (`project_path` = `<worktree>/ios/App/App.xcodeproj`, scheme `App`, udid `62BC4F82-8A2A-40B4-891B-5F0AD175810E`), then launch the resulting `App.app`.
- [ ] **Step 3: Human step (Jeff).** In the simulator tap "Continue with Google"; the Safari sheet opens on Google; Jeff signs in; the sheet shows "Signed in / Return to Quartzite" and closes; the app lands on Home. Screenshot as proof.
- [ ] **Step 4: Relaunch check.** Terminate and relaunch the app: it opens on Home without the login page.
- [ ] **Step 5: Hand-off to `superpowers:finishing-a-development-branch`** (PR against `main`; note the pre-existing red baseline in the PR body).
