# Native shell: Google sign-in via Safari hand-off and `quartzite://` return

Status: approved by Jeff 2026-09-21 (design presented in session; "Approved, go").
Builds on D132 (Capacitor remote/hybrid shell, Phase 1). Unblocks the first thing the shell
cannot do today: sign in.

## Problem

The shell loads `https://quartzite-six.vercel.app` in a WKWebView. Capacitor only lets that WebView
navigate to the app's own host; any other host is handed to the system browser
(`WebViewDelegationHandler.swift:102-117`). So "Continue with Google" inside the app:

1. runs Auth.js `signIn("google")` in the WebView, which sets the `state`/`pkce` cookies in the
   **WebView's** cookie jar and 302s to `accounts.google.com`;
2. Capacitor opens that URL in **Safari**, which has none of those cookies;
3. Google returns to `/api/auth/callback/google` in Safari, where Auth.js rejects the missing state,
   or, if it somehow passed, sets the session cookie in Safari while the app stays logged out.

Verified on the iOS 27 simulator on 2026-09-21: the Google page opened in Safari with the
"◀ Quartzite" back-to-app affordance.

Jeff chose (over keeping OAuth inside the WebView with a spoofed user agent) to keep the sign-in in a
real browser context and bring the session back into the app with a custom URL scheme.

## Decisions taken (defaults Jeff can veto)

1. **The entire OAuth round trip runs in one browser context: an in-app Safari sheet opened with the
   official `@capacitor/browser` plugin (SFSafariViewController).** Start, Google, callback and the
   hand-off page all happen there, so Auth.js's state/PKCE/session cookies are never split across
   jars. Google treats SFSafariViewController as Safari, so no user-agent games.
2. **The session moves by copying the Auth.js session cookie verbatim**, not by re-encoding a JWT.
   The hand-off route (running with the fresh session) reads its own request's
   `__Secure-authjs.session-token` (or `authjs.session-token` on http, including any `.0`/`.1` chunk
   cookies) and the exchange route sets exactly those name/value pairs in the WebView. Expiry and the
   per-request role refresh in `auth.ts` behave exactly as on the web.
3. **The hand-off code is stateless: an AES-256-GCM blob from the existing `lib/gmail/crypto.ts`
   helper (key derived from `AUTH_SECRET`), valid for 60 seconds, and bound to a PKCE-style
   challenge.** The app generates a random verifier before opening the sheet, keeps it in the WebView's
   `localStorage`, and sends `sha256(verifier)` as the challenge. The code carries the challenge; the
   exchange requires the verifier. A code seen by anyone else (URL logs, another app registering the
   scheme) is useless. No table, no migration, no new env var.
4. **Custom URL scheme `quartzite://auth?code=…`.** Universal Links need the paid Apple team and an
   `apple-app-site-association` file; they are the later upgrade, not this slice.
5. **Every native call sits behind `src/lib/platform.ts` and `Capacitor.isPluginAvailable`.** An
   installed binary without the `App` or `Browser` plugin degrades to today's behaviour (the
   in-WebView `signIn`), never throws. The browser build is byte-for-byte unchanged in behaviour.
6. **Route handlers redirect rather than 4xx on bad GET input** so `test:smoke` (which fails on any
   non-2xx/3xx) can cover them and a human landing on one by accident ends at `/login`. Only the
   POST exchange returns JSON error statuses.
7. **Android gets the manifest intent-filter in the same change** (it is three lines) but is not
   built or tested in this slice.

## Flow

```
WebView (login page, native)                Safari sheet (SFSafariViewController)            App
────────────────────────────                ─────────────────────────────────────            ───
verifier = random(32B) → localStorage
challenge = b64url(sha256(verifier))
Browser.open(/api/native/auth/start
   ?next=/&challenge=…)  ──────────────►    GET start: signIn("google",
                                               redirectTo=/api/native/auth/handoff?next&challenge)
                                            → Google → /api/auth/callback/google
                                            → GET handoff (session cookie now present)
                                               code = encrypt({cookies, challenge, next, exp})
                                               HTML page: location.replace(quartzite://auth?code=…)
                                                          + "Return to Quartzite" button
                                                                      ──────────────────────►  iOS opens app
appUrlOpen / getLaunchUrl → quartzite://auth?code=…
Browser.close()
POST /api/native/auth/exchange {code, verifier}
   → decrypt, exp check, sha256(verifier) == challenge
   → Set-Cookie: <same name/value pairs>, JSON {next}
location.replace(next)  → signed in; WKWebView persists cookies across relaunch
```

## Components

### `src/lib/native-auth.ts` (pure, server-safe, no env access)

- `SESSION_COOKIE_BASES = ["__Secure-authjs.session-token", "authjs.session-token"]`.
- `pickSessionCookies(all: {name,value}[]): {name,value}[]` — the base cookie plus any `base.N`
  chunks, preferring the `__Secure-` family when both exist. Empty array when none.
- `challengeFor(verifier: string): string` — `b64url(sha256(verifier))` via `node:crypto`.
- `isChallenge(s): boolean` — 43 chars of `[A-Za-z0-9_-]`.
- `mintHandoffCode(p: {cookies, challenge, next, now?: number, ttlMs?: number}, secret: string): string`
  — JSON `{v:1, c: cookies, ch: challenge, n: next, exp}` → `encryptWith(secret)`.
- `redeemHandoffCode(code, verifier, secret, now?): {ok:true, cookies, next} | {ok:false, reason:
  "malformed" | "expired" | "mismatch"}` — constant-time challenge compare.
- `encryptWith` / `decryptWith` are the `lib/gmail/crypto.ts` primitives refactored to take the key
  material as a parameter; `encryptToken`/`decryptToken` keep their signatures and behaviour by
  delegating (so no Gmail code changes).

### Route handlers (`src/app/api/native/auth/*/route.ts`, Next 16 shape as `api/gmail/callback`)

- `GET start?next&challenge` — `next` through `safeCallbackPath`; if `challenge` invalid or Google not
  configured → 302 `/login?error=native`. Else
  `await signIn("google", { redirectTo: "/api/native/auth/handoff?next=…&challenge=…" })`
  (`signIn` from `@/auth`; it sets the Auth.js cookies via `cookies()` and throws the Next redirect,
  which works in a Route Handler).
- `GET handoff?next&challenge` — `auth()`; no active session → 302 `/login?callbackUrl=<this URL>`
  (the login page's redirect-if-signed-in then bounces back here after sign-in, which also covers a
  user who dismissed Google). Else `pickSessionCookies(req.cookies.getAll())`; empty → 302
  `/login?error=native`. Mint code, respond `text/html`, `Cache-Control: no-store`: a minimal page
  (no app chrome) that runs `location.replace("quartzite://auth?code=…")` on load and shows a
  "Return to Quartzite" anchor with the same href for browsers that block script-initiated scheme
  navigation.
- `POST exchange` JSON `{code, verifier}` — 400 `{error:"malformed"}` on bad body/malformed code,
  401 `{error:"expired"|"mismatch"}`, else `Set-Cookie` for each pair with
  `{httpOnly, sameSite:"lax", path:"/", secure: name.startsWith("__Secure-"), maxAge: 30d}` (Auth.js
  default; `auth.config.ts` sets no `session.maxAge`) and 200 `{next}`. Any other method → 405.
- `src/middleware.ts` matcher gains `api/native/auth` in the exemption list (start and exchange run
  without a session).

### Client

- `src/lib/native-auth-client.ts` (client-only): `startNativeGoogleSignIn(next): Promise<boolean>` —
  returns false (caller falls back to `signIn`) unless `isNativePlatform()` and
  `Capacitor.isPluginAvailable("Browser")`. Generates the verifier with `crypto.getRandomValues`,
  stores it under `localStorage["qz_native_verifier"]`, computes the challenge with
  `crypto.subtle.digest`, `Browser.open({ url: origin + "/api/native/auth/start?…" })`.
  `handleNativeAuthUrl(url): Promise<"ignored" | "done" | "failed">` — parses `quartzite://auth`,
  POSTs to exchange with the stored verifier, closes the sheet when the plugin is available, and on
  success `location.replace(next)`. The verifier is cleared only once the exchange settles with a 200
  or a 401 (code consumed or definitively dead); a network error or unexpected status leaves it in
  place so a retry of the same `quartzite://` URL can still work.
- `src/app/login/login-buttons.tsx`: the Google button's handler becomes
  `if (!(await startNativeGoogleSignIn(next))) signIn("google", …)`.
- `src/app/login/native-auth-return.tsx` (`"use client"`, renders `null` or one status line):
  mounted from `login/page.tsx`. On native with the `App` plugin available it registers
  `App.addListener("appUrlOpen")` and checks `App.getLaunchUrl()` once (cold start), routing both to
  `handleNativeAuthUrl`. Shows "Signing you in…" while exchanging and "Sign-in could not be
  completed. Try again." on failure. Listener removed on unmount.

### Native projects

- `ios/App/App/Info.plist`: `CFBundleURLTypes` with `CFBundleURLName com.peaksystemsgroup.quartzite`
  and scheme `quartzite`.
- `android/app/src/main/AndroidManifest.xml`: second `<intent-filter>` on the main activity with
  `VIEW` / `DEFAULT` / `BROWSABLE` and `<data android:scheme="quartzite" />`.
- `package.json`: `@capacitor/app`, `@capacitor/browser` at the Capacitor 8 majors. `npx cap sync`
  rewrites `ios/App/CapApp-SPM/Package.swift` (committed) and the Android plugin gradle list.

### Docs

- `DECISIONS.md` D153 (next free number after D152) recording decisions 1–7 above and why the
  in-WebView alternative was rejected.
- `PUNCHLIST.md` #31 gains a line: native sign-in works via Safari hand-off; TestFlight remains.
- `docs/superpowers/specs/2026-09-21-native-shell-phase-2-design.md` §6 device check list gains
  "sign in through the Safari sheet, return by `quartzite://`, session survives relaunch".

## Security

- The code is `AES-256-GCM(key = sha256(AUTH_SECRET))` over the session cookie, 60 s TTL, bound to
  a challenge whose verifier never leaves the WebView. Replaying the URL without the verifier fails
  with `mismatch`; after 60 s it fails with `expired`; tampering fails GCM auth as `malformed`.
- Nothing is logged: routes never write the code or cookie values to the console.
- `next` is always passed through `safeCallbackPath`, so the post-exchange navigation is same-origin.
- The hand-off page carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- The exchange is POST with a JSON body; a `quartzite://` URL alone cannot set a cookie.
- The hand-off is bound to a flow that started at `/api/native/auth/start`: start sets a 5-minute
  `qz_native_challenge` cookie in the sheet's jar and handoff mints only when it matches, so a
  drive-by link to handoff with an attacker's challenge mints nothing. The exchange requires
  `Content-Type: application/json` and a same-origin `Origin` header, so a cross-site form cannot
  set a session cookie. Universal Links (later) remove the duplicate-scheme risk entirely.

## Version skew

The Vercel deploy and the installed binary ship separately. A new web bundle on an old binary (no
`App`/`Browser` plugin) falls back to the in-WebView `signIn` (today's behaviour). An old web bundle
on a new binary never calls the new routes. Neither combination throws.

## Testing

- `test:specs` (pure section): `pickSessionCookies` (secure preferred; chunks included and ordered;
  none → `[]`); `challengeFor` length/charset and determinism; `mintHandoffCode` →
  `redeemHandoffCode` round trip returns the same cookies and `next`; wrong verifier → `mismatch`;
  `now` past `exp` → `expired`; a flipped byte → `malformed`; a different secret → `malformed`.
  The secret is injected, so the harness needs no `AUTH_SECRET`.
- `test:smoke`: `/api/native/auth/start` (no params → 302 `/login?error=native`) and
  `/api/native/auth/handoff` (signed-in dev session but no challenge → 302). Both must never 500.
- `tsc` and `eslint`: no new errors versus the origin/main baseline (106 tsc errors in the #96
  inbox-linking files pre-exist and are out of scope).
- Simulator, human step: build `App` scheme, tap "Continue with Google", the Safari sheet opens on
  Google, Jeff signs in, the sheet shows "Return to Quartzite" and closes, the app lands on Home;
  relaunch the app and it is still signed in.

## Out of scope

- Universal Links / `apple-app-site-association`; ASWebAuthenticationSession (no official plugin).
- Android build and test.
- Sign-out from the native app clearing the Safari sheet's cookies (the sheet is ephemeral per
  SFSafariViewController on iOS 11+; not a concern for sign-out correctness in the WebView).
- Everything in Phase 2 (camera, BLE, push, readability, TestFlight).
