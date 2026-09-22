# Quartzite native shell, Phase 2: field-ready mobile (camera, laser, push, readability, TestFlight)

Status: draft for Jeff (2026-09-21). Builds on D132 (second entry, "Quartzite native shell — Capacitor
remote/hybrid Phase 1") which shipped the iOS/Android projects, `capacitor.config.ts` and
`src/lib/platform.ts` with no device features. Nothing in this spec runs until Jeff completes the
"Blocked on Jeff" list at the end; everything that does not need a device or an account is buildable
and testable now, on the web build, with the browser paths unchanged.

## Decisions taken (defaults Jeff can veto)

1. **Laser protocol: Leica DISTO BLE profile first; Bosch GLM later.** The DISTO family (D2, D510, X3, X4,
   D5) exposes one documented, notify-based GATT characteristic carrying a float32 distance in metres;
   open-source Web Bluetooth clients already speak it. Bosch GLM (50 C / 100 C) is a checksummed,
   framed protocol with no public spec. One file (`src/lib/measure/disto.ts`) holds the UUIDs, so a
   Bosch driver is additive.
2. **A laser reading lands as the existing free-string measurement (`42'-6.125"`), no schema change.**
   Inches are rounded to the nearest 1/8 and written as decimal inches so `parseFeet` in
   `venue-3d.tsx` keeps parsing them. Metres are not stored.
3. **Native camera is one shot per tap through the OS prompt (Camera or Photos).** The web
   `<input type="file" accept="image/*" capture="environment">` markup is untouched; native only swaps
   the click handler.
4. **Push provider: Firebase Cloud Messaging HTTP v1, called directly from the server with a zero-dependency
   service-account JWT.** APNs is fronted by Firebase (Jeff uploads the APNs key once). No OneSignal, no
   `firebase-admin` dependency. Alternatives listed in section 4 for Jeff.
5. **Push content is the to-do bell delta, computed by a cron sweep** (`/api/push/sweep`, `CRON_SECRET`),
   one notification per user per sweep, honouring the same `notif_prefs` mutes as the bell. No per-event
   hooks in stores.
6. **Push is opt-in per device from Account, plus a one-time contextual prompt when the bell is first
   opened in the native app.** Registering a device seeds its cursor with the current bell so it never
   replays the backlog.
7. **Three readability tiers are `BREAKPOINTS` in `src/lib/use-breakpoint.ts`: mobile < 640, tablet
   640–1023, desktop >= 1024.** Nav drawer below desktop (was 860), Inbox single-pane below desktop
   (was 960), Estimator phone mode on mobile only (was 700).
8. **Venue Assessment editor defaults to the Stepped layout on mobile and Long elsewhere; advanced
   sections start collapsed below desktop.** The layout toggle stays so a surveyor can override.
9. **After a laser fill the next empty measure field in the same section arms automatically** (sequential
   mode), with a visible "Next: <label>" chip and a tap to disarm.
10. **iOS/TestFlight first; Android stays building but Play Store internal testing follows iOS.**
11. **Version-skew rule: the deployed web bundle calls a native plugin only after
    `Capacitor.isPluginAvailable(name)` is true.** The Vercel deploy and the installed binary ship
    separately; an older binary must degrade to the web path, never throw.
12. **The push sweep is scheduled every 15 minutes in `vercel.json`.** Vercel Hobby only allows daily
    crons (the existing Gmail cron is daily for that reason); Jeff either upgrades to Pro or points an
    external pinger at the route with the bearer secret.

## Context

Phase 1 (D132) made the app open inside WKWebView / Android WebView by loading the hosted Vercel app
(`server.url`). Next server components, server actions, Auth.js cookies and the Phase 6 offline outbox
(`src/lib/sync/**`, `public/sw.js`) all work unchanged because the WebView is just another browser.
The Capacitor bridge is injected into the remote page at document start (`JSExport.swift`,
`WKUserScript ... atDocumentStart`), so `@capacitor/core` in the web bundle can reach native plugins
installed in the binary.

Jeff's asks that this phase serves:

- **#30** — quick-measure with a Bluetooth laser: point, read, the number drops into the focused
  measurement field. The target already exists: `classMeasureFields(venueClass)` and `MEASURE_GROUPS` in
  `src/lib/stores/surveys.ts` / `venue-classes.ts`, rendered by `renderField` (`kind: "measure"`) in
  `src/app/(app)/venue-assessments/[id]/sections/fields.tsx`, stored as free strings in
  `draft.measurements`. iOS Safari has no Web Bluetooth, which is why the shell exists.
- **#31** — "a real app": TestFlight/App Store distribution. Apple guideline 4.2 (minimum functionality)
  is cleared by shipping genuine device integration (camera, BLE, push), which is this phase.
- **#33** — mobile readability as a program: one breakpoint definition, fluid titles, and per-device
  progressive disclosure (less on a phone, more on a tablet, everything on a computer). The foundation
  (`useBreakpoint`, `--pk-h1/2/3`) landed but nothing has adopted it yet; the three ad-hoc thresholds
  (700/860/960) are still live.
- The mobile-transition brief cited by D132: full offline-first field capture, TestFlight/App Store
  distribution, mobile work in parallel with the web roadmap.

Capture editors in scope: Venue Assessments (`venue-assessments/[id]/controls.tsx` + `sections/photos.tsx`,
`sections/fields.tsx`), Inspections capture (`inspections/[id]/controls.tsx` rubric photo, before/after
photos), Field Work day view (`field-work/controls.tsx`, already a 560px column and photo-free; it gets
the readability pass only).

Constraints carried from Phase 1 and AGENTS.md: native-only code lives behind `src/lib/platform.ts`;
browser builds are unchanged; no emoji; accent only via `var(--accent)`; Next 16 App Router; PGlite is
single-process for every harness.

## 1. Platform seam additions

`src/lib/platform.ts` gains, without importing any plugin package:

```ts
export type NativeCapability = "camera" | "ble" | "push";
/** True only inside the native shell AND when the installed binary has the plugin. */
export function hasNativeCapability(cap: NativeCapability): boolean;
```

`hasNativeCapability` maps `camera -> "Camera"`, `ble -> "BluetoothLe"`, `push -> "PushNotifications"` and
returns `isNativePlatform() && Capacitor.isPluginAvailable(pluginName)`. This is the version-skew rule
(decision 11) in one place.

`src/lib/use-native.ts` (client): `useNativeCapability(cap)` returns `false` on the server and on the
first client render, then the real value after mount. The first client paint therefore matches SSR
exactly (same technique as `SyncProvider`'s `initialStatus`), and on the web it is always `false`, so
web markup is byte-identical to today.

`src/components/native/NativeBridge.tsx` is a client component mounted once in `src/app/(app)/layout.tsx`
inside `SyncProvider`. It renders nothing. On native it (a) re-registers a previously opted-in push
device on launch, (b) routes a tapped notification to its `href`. All plugin imports inside it are
dynamic (`await import("@capacitor/push-notifications")`) so the web bundle never loads them.

Permissions-Policy header in `next.config.ts` (`camera=()`) is left alone: `<input type=file capture>`
is not gated by it, native plugins bypass it, and Web Bluetooth's default allowlist is `self`.

## 2. Camera capture (`@capacitor/camera`)

**Shared photo pipeline.** Both editors carry a near-identical `readPhoto` (FileReader, Image, canvas,
1200px max, JPEG 0.7/0.72). It moves to `src/lib/capture/downscale.ts`:

```ts
export function fitWithin(w: number, h: number, max: number): { w: number; h: number }; // pure
export function fileToDataUrl(file: File): Promise<string>;
export function downscaleDataUrl(dataUrl: string, opts?: { max?: number; quality?: number }): Promise<string>;
```

Both editors call `downscaleDataUrl(await fileToDataUrl(file))`. Behaviour is unchanged; the native path
now enters the same pipeline.

**Native capture.** `src/lib/capture/photos.ts`:

```ts
export type CapturedPhoto = { dataUrl: string; name: string };
/** Native only: opens the OS camera/library prompt. Returns null when cancelled. Throws when not native. */
export async function captureNativePhoto(): Promise<CapturedPhoto | null>;
```

Implementation: `Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Prompt,
quality: 80, width: 1600, correctOrientation: true })`, then `downscaleDataUrl` so native photos match the
web size budget. Cancellation (the plugin rejects with "User cancelled photos app") resolves to `null`.

**UI.** `src/components/capture/PhotoAddButton.tsx`:

```tsx
<PhotoAddButton label="Add photo" multiple onFiles={(files) => ...} onNative={(photo) => ...} style={...} />
```

- Web (and native without the plugin): renders exactly today's `<label><input type="file" accept="image/*"
  capture="environment" [multiple] onChange /></label>`.
- Native with `hasNativeCapability("camera")`: renders a `<button>` with the same styling that calls
  `captureNativePhoto()` and hands the result to `onNative`.

Call sites: `sections/photos.tsx` (survey photo grid, 8-photo cap enforced in the editor's handler as
now), inspection rubric photo, inspection log before/after photos. The `SurveyPhoto` shape
(`{ id, name, dataUrl }`) and the inspection `photo: string | null` fields are untouched, so the offline
outbox (`saveThroughOutbox`, whole-document upsert) carries native photos exactly as it carries web ones.

**Native permissions.** iOS `Info.plist`: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
`NSPhotoLibraryAddUsageDescription`. Android: `@capacitor/camera` needs no manifest change for the camera
(the FileProvider from Phase 1 is already present); `READ_MEDIA_IMAGES` is added for library picks on
Android 13+.

## 3. Laser measure (#30)

### 3.1 Device protocol: Leica DISTO

The DISTO BLE profile (public, reverse-engineered, used by several open-source Web Bluetooth clients):

| Item | UUID | Notes |
|---|---|---|
| Service | `3ab10100-f831-4395-b29d-570977d5bf94` | advertised; used as the scan filter |
| Distance | `3ab10101-f831-4395-b29d-570977d5bf94` | notify; float32 little-endian, metres |
| Distance unit | `3ab10102-f831-4395-b29d-570977d5bf94` | read; uint16, ignored (we always use metres) |
| Command | `3ab10109-f831-4395-b29d-570977d5bf94` | write `0x67` ("g") to trigger a measurement from the app |

These live in `src/lib/measure/disto.ts` and are confirmed against the real unit on first pairing
(Task 12). If the unit Jeff buys speaks a different profile, only that file changes.

Why DISTO first: documented profile, one notify characteristic, works from a web page on Android
Chrome without the shell, and Leica publishes an SDK if we ever need more. Bosch GLM's app-to-device
protocol is framed and checksummed with no public document; it is a follow-up driver, not a redesign.

### 3.2 The `measure` seam

```
src/lib/measure/
  types.ts          MeasureDriver / MeasureConnection / Reading
  disto.ts          UUIDs, parseDistoDistance(DataView) -> metres | null        (pure)
  format.ts         metersToFieldString(m) -> "42'-6.125\"", roundToEighthInch  (pure)
  web-bluetooth.ts  driver for navigator.bluetooth (Android Chrome, desktop Chrome/Edge)
  capacitor-ble.ts  driver for @capacitor-community/bluetooth-le (iOS + Android shell)
  index.ts          pickMeasureDriver(): MeasureDriver | null
  use-laser.ts      React hook: connection state machine + armed field + fill callback
```

```ts
export type Reading = { meters: number; at: number };
export interface MeasureConnection {
  name: string;
  onReading(cb: (r: Reading) => void): () => void;
  trigger?(): Promise<void>;          // DISTO command char; optional per device
  disconnect(): Promise<void>;
}
export interface MeasureDriver {
  kind: "web-bluetooth" | "capacitor-ble";
  connect(): Promise<MeasureConnection>;   // must be called from a user gesture
}
```

`pickMeasureDriver()`:

| Runtime | Driver |
|---|---|
| Native shell, `hasNativeCapability("ble")` | `capacitor-ble` (both platforms; Android WebView has no Web Bluetooth) |
| Browser with `navigator.bluetooth` (Android Chrome, desktop Chrome/Edge) | `web-bluetooth` |
| iOS Safari, Firefox, anything else | `null` — manual entry only, no laser affordance rendered |

Web Bluetooth requires HTTPS and a user gesture; the Vercel origin satisfies the first, the Connect
button the second. `@capacitor-community/bluetooth-le` is imported dynamically inside `capacitor-ble.ts`.

### 3.3 Editor behaviour

`useLaser({ onFill })` exposes `{ state: "unavailable" | "idle" | "connecting" | "connected" | "error",
deviceName, lastReading, armed, arm(key | null), connect(), disconnect(), trigger() }`. When a reading
arrives and a field is armed: `onFill(armedKey, metersToFieldString(meters))`, then sequential mode arms
the next empty `kind: "measure"` field in the same section (decision 9).

`LaserBar` renders above the first measurement section in the assessment editor, only when
`pickMeasureDriver() !== null`: Connect/Disconnect, device name, last reading, "Next: Proscenium width"
chip, and a "Measure" button when the connection supports `trigger`. Each measure input gains a small
target button (only while connected) that arms it; the armed input gets a `var(--accent)` border. The
input itself is unchanged, so typing always works — the manual fallback is the existing field.

Nothing about `draft.measurements` or `saveThroughOutbox` changes. A reading taken offline is just a
string in the draft; the outbox syncs it as before.

### 3.4 Native permissions

iOS `Info.plist`: `NSBluetoothAlwaysUsageDescription`. Android manifest: `BLUETOOTH_SCAN`
(`usesPermissionFlags="neverForLocation"`), `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION` limited to
`maxSdkVersion="30"`, and `<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />`.

## 4. Push notifications for the to-do bell

### 4.1 Provider (Jeff decision, default FCM HTTP v1 direct)

| Option | Cost | Server work | Notes |
|---|---|---|---|
| **FCM HTTP v1, called directly (default)** | free | ~80 lines: service-account JWT (`node:crypto`), one POST per token | one provider for iOS (via APNs key in Firebase) and Android; no SaaS account beyond Firebase |
| OneSignal | free tier | REST call with an app key | extra vendor, user-level targeting for free |
| Direct APNs + FCM | free | two senders, HTTP/2 to APNs | most code, least dependency |

`@capacitor/push-notifications` is provider-agnostic; on iOS it hands back the APNs token, on Android the
FCM token. With the default, the iOS APNs token is sent to FCM as an APNs token only if Firebase is
configured with the APNs key — this is the one-time upload in the Blocked-on-Jeff list.

### 4.2 What gets sent

The bell is derived, not stored (`navData(me)` in `src/lib/nav-counts.ts` builds `BellGroup[]` per
request from eleven stores, filtered by `notif_prefs`). Push follows the same derivation:

```
keys(user)   = navData(user).bell.flatMap(g => g.items.map(i => `${g.key}:${i.id}`))
new          = keys(user) - push_cursors[user].seen
if new.length: send one notification: title = first new item's group label,
               body = first item title (+ " and N more"), data.href = first item href
push_cursors[user].seen = keys(user)            // always, so cleared items can re-notify later
```

Runs from `GET /api/push/sweep` guarded by `CRON_SECRET` exactly like `/api/gmail/sync` (middleware
exemption added). `UNREGISTERED` from FCM disables that token. `PUSH_ENABLED=true` plus
`FCM_SERVICE_ACCOUNT_JSON` gate the whole feature; without them the route returns 503 and the Account
toggle is hidden.

### 4.3 Client

Account page gains "Notifications on this device" (native only): on -> `requestPermissions()` ->
`register()` -> `registration` event token -> `registerPushDeviceAction(token, platform)`; off ->
`unregisterPushDeviceAction(token)`. The token is remembered in `localStorage` (`qz_push_token`) so
`NativeBridge` can re-register on launch (tokens rotate) and so the toggle reflects state without a
round-trip. First open of the bell on native shows a one-line prompt linking to Account (once, flag in
`localStorage`). `pushNotificationActionPerformed` -> `router.push(data.href)`.

iOS needs the Push Notifications capability and `remote-notification` background mode in the Xcode
project (Jeff, signing-bound). Android needs `android/app/google-services.json` (the Phase 1 gradle
already applies the plugin when the file exists) and `POST_NOTIFICATIONS` on Android 13+.

## 5. Readability pass (#33): per-device progressive disclosure

**Tiers.** `mobile` (< 640, phones), `tablet` (640–1023, iPad portrait, small landscape), `desktop`
(>= 1024). One source: `BREAKPOINTS` + `useBreakpoint()`; CSS mirrors them in `globals.css`.

**Foundation (Task 9).**
- `globals.css`: `.pk-mobile-hide` (display:none below 640), `.pk-tablet-hide` (below 1024),
  `.pk-mobile-only`, `.pk-stack-mobile` (grid -> one column below 640), `.pk-tap` (min-height 44px below 1024).
- `src/lib/disclosure.ts`: a pure table `DISCLOSURE[screen][setting][tier]` so what collapses is data,
  spec-tested for monotonicity (mobile never shows more than tablet, tablet never more than desktop).
- Adopt the hook where thresholds are hand-rolled: `Nav.tsx` (860 -> drawer when tier !== desktop),
  `inbox-shell.tsx` (960 -> single pane when tier !== desktop), `estimator-client.tsx` (700 -> phone
  mode when tier === mobile). The estimator's `@media (max-width: 860px)` block moves to 1024.
- Titles: `.pk-h1` replaces the fixed `fontSize: 23` page titles on Venue Assessments, Inspections, Field
  Work, Home; the assessment editor's sticky title becomes `.pk-h3` with ellipsis kept.

**Screens (Task 10), what each tier shows.**

| Screen | Mobile | Tablet | Desktop (as today) |
|---|---|---|---|
| Assessment editor (`venue-assessments/[id]`) | Stepped layout by default; Print + Delete move into a "More" menu; stage rail scrolls; advanced sections collapsed; 1-col fields (exists) | Long layout; advanced collapsed; header buttons inline | Long; advanced open; all buttons |
| Inspection capture (`inspections/[id]`) | Rubric descriptions behind a tap ("What to check"); one photo column; findings list as cards | 2-col grid; descriptions visible | full |
| Field Work day view (`field-work`) | Today only, single column, crew and stage chips hidden, hours KPIs 2-up | 2 columns, chips shown | full |
| Venue Assessments list (`venue-assessments`) | Card list: customer, venue, stage, date; KPI strip hidden | Cards + KPI strip | Cards + KPIs + filters (today's grid) |
| Inspections inbox (`inspections`) | Rows collapse to name + status; the 110/96/78 columns hidden | Name + status + date | full 4-column grid |
| Home | KPI strip 2-up, one tab visible at a time | KPI 3-up | full |

The assessment editor already has the machinery (`layoutMode`, `advanced`, `isCollapsible`); the
readability work is choosing defaults per tier, not new components.

## 6. Distribution (TestFlight / App Store) — human steps only

The agent prepares the project (bundle id already `com.peaksystemsgroup.quartzite`, version 1.0 build
1, usage strings, capabilities in `project.pbxproj` where they are plain edits, a `docs/reference/`
release checklist) and never signs, uploads or submits. Jeff, or a human on the Mac with Jeff's Apple
account, does:

**Blocked on Jeff**

1. Enrol in the Apple Developer Program (organisation, needs a D-U-N-S number) — $99/year.
2. In App Store Connect create the app record: name "Quartzite", bundle id
   `com.peaksystemsgroup.quartzite`, SKU, primary language.
3. Add the team to Xcode on the build Mac (Xcode > Settings > Accounts) and turn on automatic signing
   for the App target; confirm a device build runs on Jeff's iPhone.
4. Create an APNs Auth Key (.p8) in the developer portal; note Key ID and Team ID.
5. Create a Firebase project, add the iOS app (same bundle id) and Android app
   (`com.peaksystemsgroup.quartzite`), upload the APNs key, download `GoogleService-Info.plist` and
   `google-services.json`, and create a service-account JSON for FCM.
6. Set Vercel env: `PUSH_ENABLED=true`, `FCM_SERVICE_ACCOUNT_JSON` (the JSON, single line), `CRON_SECRET`
   (already required by the Gmail cron), and decide the cron plan (Pro for `*/15`, or an external pinger).
7. Buy or borrow a Bluetooth Leica DISTO (D2, D510, X3, X4 or D5) and say which model.
8. Provide a privacy-policy URL and answer the App Privacy questionnaire (data collected: name, email,
   photos the user attaches, no tracking).
9. Name the TestFlight internal testers (Apple IDs) and, later, whether the listing is public or
   unlisted.
10. Android, after iOS: Google Play Console ($25 one-time), an upload keystore Jeff keeps, and the
    internal testing track.
11. Decide platform order (default: iOS first) and whether Android ships at all this phase.

## 7. Data model

- **new table `push_devices`**: `token` (pk), `user_id`, `platform` (`ios` | `android`), `app_version`,
  `created_at`, `last_seen_at`, `disabled_at` (nullable). Plain table, not a `docTable`, no `_seq_bump`.
- **new table `push_cursors`**: `user_id` (pk), `seen` (JSONB `string[]` of `group:id` keys), `updated_at`.
- No change to `surveys`, `inspections`, `notif_prefs` documents or the sync allowlist.
- Env: `PUSH_ENABLED`, `FCM_SERVICE_ACCOUNT_JSON` (server only). Client: `localStorage` keys
  `qz_push_token`, `qz_push_prompted`.
- Dependencies: `@capacitor/camera`, `@capacitor-community/bluetooth-le`, `@capacitor/push-notifications`,
  all at the Capacitor 8 majors; `npx cap sync` updates `ios/App/CapApp-SPM/Package.swift` and the
  Android gradle plugin list, which are committed.

## 8. Testing

- `test:specs` (pure): `fitWithin`; `parseDistoDistance` on a float32 LE buffer and on a short buffer;
  `metersToFieldString` (1 m -> `3'-3.375"`, exact feet -> `10'`, 1/8 rounding); `bellKeys` /
  `newSince` / `composeBody`; the FCM JWT claims (decode, `iss`/`scope`/`aud`, signature verifies with
  a key pair generated in the test); `DISCLOSURE` monotonicity and completeness; `tierFor(width)` at
  639/640/1023/1024.
- `test:review:regressions` (scratch DB): register a device seeds a cursor equal to the current bell;
  a sweep with a fake `send` after a task is assigned to that user sends exactly one message and
  advances the cursor; a second sweep sends nothing; `unregistered` from the sender disables the token.
- `test:smoke`: `/account`, `/venue-assessments`, `/inspections`, `/field-work`, `/api/push/sweep`
  without a bearer -> 401 (503 when unconfigured).
- Browser check at 375, 820 and 1440 px on the six screens in section 5 (manual, using the browser
  pane; recorded as a checklist in the plan).
- Device (Task 12, human): TestFlight build opens the hosted app and keeps the session across relaunch;
  Google sign-in opens the Safari sheet and returns through quartzite://auth (D150);
  Add photo opens the camera; DISTO pairs and a reading fills the armed field; a push arrives within
  one sweep of a task assignment and tapping it opens `/field-work`.

## Out of scope

- Bosch GLM driver and any second laser protocol.
- Web push (browser notifications) — the web bell already exists; VAPID is a later phase.
- Per-event push fast path (notify at `assign()` time) — the sweep is enough until latency hurts.
- Photo upload to Vercel Blob (photos stay downscaled data URLs in the document, as today).
- Static export / bundling the app into the binary (D132 rules it out).
- Deep links / universal links, biometric lock, background sync.
- Every screen not named in section 5; the readability program continues as per-screen sub-items.
