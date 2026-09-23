# Native Shell Phase 2 Implementation Plan (PUNCHLIST #30, #31, #33)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 1 Capacitor shell (D174) field-ready: native camera into assessment and inspection photos, a Bluetooth laser (Leica DISTO) that fills measurement fields with a manual fallback everywhere, push notifications for the to-do bell, the #33 readability pass on the field screens, and a TestFlight-ready iOS project whose signing/upload steps are handed to Jeff.

**Architecture:** Every native call sits behind `src/lib/platform.ts` (`hasNativeCapability`) and a hydration-safe hook, so SSR and the first client paint are unchanged on the web. Three seams: `src/lib/capture/*` (photos), `src/lib/measure/*` (laser; Web Bluetooth on Android/desktop Chrome, `@capacitor-community/bluetooth-le` in the shell), `src/lib/push/*` (FCM HTTP v1 sender + cron sweep over the derived bell). Readability is a pure `DISCLOSURE` table plus adoption of the existing `useBreakpoint` / `--pk-h*` foundation. Spec: `docs/superpowers/specs/2026-09-21-native-shell-phase-2-design.md`.

**Tech Stack:** Next.js 16 App Router (server actions, route handlers), Drizzle on Postgres/PGlite (`db:generate`), Capacitor 8.5 remote/hybrid shell, `@capacitor/camera`, `@capacitor-community/bluetooth-le`, `@capacitor/push-notifications`, FCM HTTP v1 via `node:crypto`, `tsx` harnesses (`test:specs` pure, `test:review:regressions` scratch DB, `test:smoke` real server).

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **PGlite is single-process.** `test:specs` is pure. `test:review:regressions` and `test:smoke` each open their own throwaway DB — run them one at a time, never alongside `next dev` or any other `tsx` script; `ps aux | grep -E 'tsx|next dev'` must be empty first.
- After editing `src/db/schema.ts`: `npm run db:generate`, commit the new `drizzle/00NN_*.sql` + `drizzle/meta/*`. `push_devices` and `push_cursors` are plain tables, not `docTable()`s — no `_seq_bump` trigger. Write DDL `IF NOT EXISTS` (D140).
- **Native-only code lives behind `src/lib/platform.ts`.** Plugin packages are imported only with dynamic `import()` inside a branch guarded by `hasNativeCapability(...)` or `isNativePlatform()`; never at module top level in a file the web bundle loads. Browser builds must be unchanged: the web `<input type="file" capture>` markup is kept byte-for-byte.
- **Version skew:** the Vercel deploy and the installed binary ship separately. Call a plugin only after `Capacitor.isPluginAvailable(name)`; degrade to the web path, never throw.
- No emoji in UI copy (#3). No hardcoded accent: `var(--accent)` / the `ACCENT*` constants in `sections/styles.ts`.
- Timestamps epoch-ms. Ids: users `u1`, surveys `FS-####`, tasks as in `stores/tasks.ts`. Keep prototype field names.
- Do NOT run `npx cap sync`, `cap open`, Xcode, gradle or any device command in an automated task; those are explicit human steps in Tasks 11–12. Tasks 1–10 are complete when `tsc`, `eslint`, `test:specs`, `test:review:regressions` and `test:smoke` pass on the web build.
- `git add` only the files each task names.
- Spec harness: `ok(cond, msg)` in `scripts/test-review-and-spec.ts`; pure synchronous modules in the top section, anything `await`ing inside `asyncChecks()`. Regression harness: `assert` in `scripts/test-review-regressions.ts` `main()`, against the `PGLITE_PATH` scratch DB.
- Next 16: before touching routing or route handlers, read `node_modules/next/dist/docs/` for the current conventions (the `/api/push/sweep` handler copies `/api/gmail/sync/route.ts`, which is already Next-16 shaped).

---

## Wave A — seams that work on the web build

### Task 1: Platform capabilities, hydration-safe hook, NativeBridge mount

**Files:**
- Modify: `src/lib/platform.ts`
- Create: `src/lib/use-native.ts`
- Create: `src/components/native/NativeBridge.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (platform.ts, pure apart from `Capacitor`): `type NativeCapability = "camera" | "ble" | "push"`, `PLUGIN_FOR: Record<NativeCapability, string>`, `hasNativeCapability(cap): boolean`.
- Produces (use-native.ts, client): `useNativeCapability(cap): boolean` (false until mounted).
- Produces (NativeBridge.tsx, client): default export renders `null`; on native runs `bootNative(router)` once (filled in by Task 8; this task ships the shell with a no-op).

- [ ] **Step 1: Failing spec test** (synchronous section; add `import { PLUGIN_FOR, hasNativeCapability } from "@/lib/platform";`)

```ts
/* ---- native shell phase 2 §1 — capability map ---- */
ok(PLUGIN_FOR.camera === "Camera" && PLUGIN_FOR.ble === "BluetoothLe" && PLUGIN_FOR.push === "PushNotifications", "PLUGIN_FOR names the Capacitor plugins");
ok(hasNativeCapability("camera") === false, "hasNativeCapability: false outside the shell (node)");
```

- [ ] **Step 2: Run** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → import error for `PLUGIN_FOR`.

- [ ] **Step 3: platform.ts** — append:

```ts
/* ---- Phase 2 (spec 2026-09-21) — per-plugin capability gate ---- */

export type NativeCapability = "camera" | "ble" | "push";

/** Capacitor plugin registration names, as reported by isPluginAvailable(). */
export const PLUGIN_FOR: Record<NativeCapability, string> = {
  camera: "Camera",
  ble: "BluetoothLe",
  push: "PushNotifications",
};

/**
 * True only inside the shell AND when the installed binary carries the plugin.
 * The web bundle deploys independently of the app binary, so an older binary
 * must degrade to the web path rather than throw (version-skew rule).
 */
export function hasNativeCapability(cap: NativeCapability): boolean {
  return isNativePlatform() && Capacitor.isPluginAvailable(PLUGIN_FOR[cap]);
}
```

- [ ] **Step 4: use-native.ts**

```ts
"use client";
import { useEffect, useState } from "react";
import { hasNativeCapability, type NativeCapability } from "./platform";

/**
 * False on the server and on the first client render so hydration matches
 * SSR; the real answer arrives after mount. On the web it is always false,
 * which keeps browser markup identical to today.
 */
export function useNativeCapability(cap: NativeCapability): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(hasNativeCapability(cap));
  }, [cap]);
  return on;
}
```

- [ ] **Step 5: NativeBridge.tsx**

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativePlatform } from "@/lib/platform";

/**
 * Mounted once in the app shell. Renders nothing. Inside the native shell it
 * runs the launch-time hooks (push re-registration, notification tap routing —
 * Task 8). Every plugin import is dynamic so the web bundle never loads them.
 */
export default function NativeBridge() {
  const router = useRouter();
  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    (async () => {
      const { bootNative } = await import("@/lib/push/client");
      if (!cancelled) await bootNative((href) => router.push(href));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // router is stable; run once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
```

Until Task 8 exists, create `src/lib/push/client.ts` with only `export async function bootNative(_go: (href: string) => void): Promise<void> {}` so the import resolves.

- [ ] **Step 6: layout.tsx** — `import NativeBridge from "@/components/native/NativeBridge";` and render `<NativeBridge />` as the first child inside `<SyncProvider>`.

- [ ] **Step 7: Verify** `npx tsx scripts/test-review-and-spec.ts | grep -E 'PLUGIN_FOR|hasNativeCapability|ALL PASSED'` → 2 PASS + ALL PASSED; `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 8: Commit**

```bash
git add src/lib/platform.ts src/lib/use-native.ts src/components/native/NativeBridge.tsx src/lib/push/client.ts "src/app/(app)/layout.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(native): per-plugin capability gate, hydration-safe hook, NativeBridge mount (phase 2 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared photo downscale pipeline

**Files:**
- Create: `src/lib/capture/downscale.ts`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx` (`readPhoto`, ~line 326)
- Modify: `src/app/(app)/inspections/[id]/controls.tsx` (`readPhoto`, ~line 543)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `fitWithin(w, h, max): { w; h }` (pure), `fileToDataUrl(file: File): Promise<string>`, `downscaleDataUrl(dataUrl, { max = 1200, quality = 0.7 }): Promise<string>` (resolves to the input when canvas fails or the image will not load, matching today's fallbacks).

- [ ] **Step 1: Failing spec test** (`import { fitWithin } from "@/lib/capture/downscale";`)

```ts
/* ---- phase 2 §2 — photo downscale ---- */
ok(JSON.stringify(fitWithin(4000, 3000, 1200)) === JSON.stringify({ w: 1200, h: 900 }), "fitWithin: landscape scales by width");
ok(JSON.stringify(fitWithin(600, 800, 1200)) === JSON.stringify({ w: 600, h: 800 }), "fitWithin: small image untouched");
ok(fitWithin(3000, 4000, 1200).h === 1200, "fitWithin: portrait scales by height");
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: downscale.ts**

```ts
/**
 * One photo pipeline for every capture editor (assessment photos, inspection
 * rubric/before/after) and for native camera shots (Task 3). Ported from the
 * two identical readPhoto() helpers the editors carried.
 */

export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h };
  const r = Math.min(max / w, max / h);
  return { w: Math.round(w * r), h: Math.round(h * r) };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export function downscaleDataUrl(
  dataUrl: string,
  opts: { max?: number; quality?: number } = {}
): Promise<string> {
  const max = opts.max ?? 1200;
  const quality = opts.quality ?? 0.7;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { w, h } = fitWithin(img.width, img.height, max);
      try {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
```

- [ ] **Step 4: venue-assessments controls.tsx** — replace the body of `readPhoto(file)` with:

```ts
  async function readPhoto(file: File): Promise<SurveyPhoto | null> {
    try {
      const url = await downscaleDataUrl(await fileToDataUrl(file), { max: 1200, quality: 0.7 });
      return { id: newPhotoId(), name: file.name || "photo.jpg", dataUrl: url };
    } catch {
      return null;
    }
  }
```
Add `import { downscaleDataUrl, fileToDataUrl } from "@/lib/capture/downscale";`.

- [ ] **Step 5: inspections controls.tsx** — replace `readPhoto(file, cb)`:

```ts
  function readPhoto(file: File | undefined, cb: (url: string) => void) {
    if (!file) return;
    fileToDataUrl(file)
      .then((raw) => downscaleDataUrl(raw, { max: 1200, quality: 0.72 }))
      .then(cb)
      .catch(() => {});
  }
```

- [ ] **Step 6: Verify** specs (3 PASS), `tsc`, then `npm run test:smoke` (nothing else running) → `/venue-assessments` and `/inspections` still 200.

- [ ] **Step 7: Commit**

```bash
git add src/lib/capture/downscale.ts "src/app/(app)/venue-assessments/[id]/controls.tsx" "src/app/(app)/inspections/[id]/controls.tsx" scripts/test-review-and-spec.ts
git commit -m "refactor(capture): one photo downscale pipeline for both editors (phase 2 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Native camera behind `PhotoAddButton`

**Files:**
- Modify: `package.json` (add `@capacitor/camera`)
- Create: `src/lib/capture/photos.ts`
- Create: `src/components/capture/PhotoAddButton.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/sections/photos.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx` (add `addNativePhoto`)
- Modify: `src/app/(app)/inspections/[id]/controls.tsx` (three photo inputs)
- Modify: `ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Produces: `captureNativePhoto(): Promise<CapturedPhoto | null>`; `<PhotoAddButton label multiple? onFiles onNative style />`.
- Consumes: `hasNativeCapability("camera")` via `useNativeCapability`, `downscaleDataUrl`.

- [ ] **Step 1: Install** `npm install @capacitor/camera@^8` (verify `npm view @capacitor/camera peerDependencies` lists `@capacitor/core ^8`). Do not run `cap sync` here.

- [ ] **Step 2: photos.ts**

```ts
"use client";
import { hasNativeCapability } from "@/lib/platform";
import { downscaleDataUrl } from "./downscale";

export type CapturedPhoto = { dataUrl: string; name: string };

/**
 * Native only: opens the OS prompt (Camera / Photos). Resolves null when the
 * user cancels. Throws when called outside the shell — callers gate on
 * hasNativeCapability("camera") first.
 */
export async function captureNativePhoto(): Promise<CapturedPhoto | null> {
  if (!hasNativeCapability("camera")) throw new Error("camera plugin unavailable");
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  try {
    const shot = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt,
      quality: 80,
      width: 1600,
      correctOrientation: true,
    });
    if (!shot.dataUrl) return null;
    const dataUrl = await downscaleDataUrl(shot.dataUrl, { max: 1200, quality: 0.7 });
    return { dataUrl, name: `photo-${Date.now()}.jpg` };
  } catch (e) {
    const msg = String((e as Error)?.message || e).toLowerCase();
    if (msg.includes("cancel")) return null;
    throw e;
  }
}
```

- [ ] **Step 3: PhotoAddButton.tsx**

```tsx
"use client";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { useNativeCapability } from "@/lib/use-native";
import { captureNativePhoto, type CapturedPhoto } from "@/lib/capture/photos";

export interface PhotoAddButtonProps {
  children: ReactNode;
  multiple?: boolean;
  onFiles: (e: ChangeEvent<HTMLInputElement>) => void;
  onNative: (photo: CapturedPhoto) => void;
  style?: CSSProperties;
  className?: string;
}

/**
 * Web: exactly the <label><input type=file capture> the editors always used.
 * Native shell with the Camera plugin: a button that opens the OS camera prompt.
 * The first client render is always the web markup (hydration-safe).
 */
export function PhotoAddButton({ children, multiple, onFiles, onNative, style, className }: PhotoAddButtonProps) {
  const native = useNativeCapability("camera");
  if (native) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        onClick={async () => {
          const p = await captureNativePhoto().catch(() => null);
          if (p) onNative(p);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <label className={className} style={style}>
      {children}
      <input type="file" accept="image/*" capture="environment" multiple={multiple} onChange={onFiles} style={{ display: "none" }} />
    </label>
  );
}
```

- [ ] **Step 4: sections/photos.tsx** — add `addNativePhoto: (p: { dataUrl: string; name: string }) => void` to `PhotosProps`; replace the `<label>...<input .../></label>` with:

```tsx
<PhotoAddButton multiple onFiles={onPhotos} onNative={addNativePhoto} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 40 }}>
  Add photo
</PhotoAddButton>
```

- [ ] **Step 5: venue-assessments controls.tsx** — next to `removePhoto`:

```ts
  const addNativePhoto = (p: { dataUrl: string; name: string }) => {
    if (draft.photos.length >= 8) {
      setSaveError("Up to 8 photos per survey. Remove one to add another.");
      return;
    }
    setSaveError("");
    patchDraft({ photos: draft.photos.concat([{ id: newPhotoId(), name: p.name, dataUrl: p.dataUrl }]) });
  };
```
Pass `addNativePhoto={addNativePhoto}` to `<PhotosSection>`.

- [ ] **Step 6: inspections controls.tsx** — the three `<label style={photoDrop}>Add photo<input .../></label>` blocks (rubric ~1138, before ~1271, after ~1287) become `<PhotoAddButton style={photoDrop} onFiles={(e) => onPickFile(e, (f) => setRubricPhoto(sec.s.key, f))} onNative={(p) => updateRubricSection(sec.s.key, { photo: p.dataUrl })}>Add photo</PhotoAddButton>` (and `updateLog(l._uid, { beforePhoto: p.dataUrl })` / `afterPhoto`). `photoDrop` is a `CSSProperties`; if it relies on `label` display semantics add `display: "flex"` explicitly so the button renders the same.

- [ ] **Step 7: Native permission strings.** `ios/App/App/Info.plist` — inside the top `<dict>`:

```xml
	<key>NSCameraUsageDescription</key>
	<string>Quartzite uses the camera to attach site photos to venue assessments and inspections.</string>
	<key>NSPhotoLibraryUsageDescription</key>
	<string>Quartzite lets you attach existing photos to venue assessments and inspections.</string>
	<key>NSPhotoLibraryAddUsageDescription</key>
	<string>Quartzite can save photos you take on site to your library.</string>
```
`AndroidManifest.xml` — after the INTERNET permission: `<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />`.

- [ ] **Step 8: Verify** `tsc`, `npx eslint src/components/capture src/lib/capture "src/app/(app)/venue-assessments" "src/app/(app)/inspections"` → 0 errors; `npm run test:smoke` → 200s. Open `/venue-assessments/<id>` in the browser pane at 375 px: the Add photo control is still a `<label>` wrapping a file input (inspect the DOM).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/capture/photos.ts src/components/capture/PhotoAddButton.tsx "src/app/(app)/venue-assessments/[id]/sections/photos.tsx" "src/app/(app)/venue-assessments/[id]/controls.tsx" "src/app/(app)/inspections/[id]/controls.tsx" ios/App/App/Info.plist android/app/src/main/AndroidManifest.xml
git commit -m "feat(native): camera capture behind PhotoAddButton; web file input unchanged (phase 2 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: DISTO protocol + measurement formatting (pure)

**Files:**
- Create: `src/lib/measure/types.ts`, `src/lib/measure/disto.ts`, `src/lib/measure/format.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `DISTO.service / distance / unit / command` UUID constants, `parseDistoDistance(view: DataView): number | null`, `metersToFieldString(m: number): string`, `roundToEighthInch(inches: number): number`, `Reading`, `MeasureConnection`, `MeasureDriver`.

- [ ] **Step 1: Failing spec tests** (synchronous; `import { parseDistoDistance, DISTO } from "@/lib/measure/disto"; import { metersToFieldString, roundToEighthInch } from "@/lib/measure/format";`)

```ts
/* ---- phase 2 §3 — DISTO protocol + formatting ---- */
{
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, 3.048, true); // 10 ft in metres, little-endian
  ok(Math.abs((parseDistoDistance(new DataView(buf)) ?? 0) - 3.048) < 1e-6, "parseDistoDistance: float32 LE metres");
  ok(parseDistoDistance(new DataView(new ArrayBuffer(2))) === null, "parseDistoDistance: short frame → null");
  ok(DISTO.service === "3ab10100-f831-4395-b29d-570977d5bf94", "DISTO service UUID");
}
ok(metersToFieldString(3.048) === "10'", "metersToFieldString: exact feet");
ok(metersToFieldString(1) === "3'-3.375\"", "metersToFieldString: 1 m → 3'-3.375\" (1/8 in rounding)");
ok(metersToFieldString(0.3048 * 12.5) === "12'-6\"", "metersToFieldString: whole inches keep no decimals");
ok(roundToEighthInch(3.3701) === 3.375, "roundToEighthInch");
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: types.ts**

```ts
export type Reading = { meters: number; at: number };

export interface MeasureConnection {
  name: string;
  onReading(cb: (r: Reading) => void): () => void;
  /** Ask the device to take a measurement (DISTO command char). Optional per device. */
  trigger?(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface MeasureDriver {
  kind: "web-bluetooth" | "capacitor-ble";
  /** Must be called from a user gesture (both Web Bluetooth and iOS require it). */
  connect(): Promise<MeasureConnection>;
}
```

- [ ] **Step 4: disto.ts**

```ts
/**
 * Leica DISTO BLE profile (D2 / D510 / X3 / X4 / D5). Public, reverse-engineered,
 * used by several open-source Web Bluetooth clients. Confirm on the real unit
 * at first pairing (plan Task 12); this is the only file that knows the UUIDs.
 */
export const DISTO = {
  service: "3ab10100-f831-4395-b29d-570977d5bf94",
  distance: "3ab10101-f831-4395-b29d-570977d5bf94", // notify, float32 LE metres
  unit: "3ab10102-f831-4395-b29d-570977d5bf94", // read, uint16 (ignored)
  command: "3ab10109-f831-4395-b29d-570977d5bf94", // write 0x67 ("g") = measure
} as const;

export const DISTO_MEASURE_CMD = new Uint8Array([0x67]);

export function parseDistoDistance(view: DataView): number | null {
  if (view.byteLength < 4) return null;
  const m = view.getFloat32(0, true);
  return Number.isFinite(m) && m >= 0 ? m : null;
}
```

- [ ] **Step 5: format.ts**

```ts
/**
 * A reading becomes the same free-string the surveyor would type. Decimal
 * inches (not fractions) so parseFeet() in venue-3d.tsx keeps parsing.
 */
const IN_PER_M = 1 / 0.0254;

export function roundToEighthInch(inches: number): number {
  return Math.round(inches * 8) / 8;
}

export function metersToFieldString(meters: number): string {
  const totalIn = roundToEighthInch(meters * IN_PER_M);
  const ft = Math.floor(totalIn / 12);
  const rem = Math.round((totalIn - ft * 12) * 1000) / 1000;
  if (rem === 0) return `${ft}'`;
  if (rem >= 12) return `${ft + 1}'`;
  return `${ft}'-${String(rem)}"`;
}
```

- [ ] **Step 6: Verify** specs (7 PASS), `tsc`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/measure/types.ts src/lib/measure/disto.ts src/lib/measure/format.ts scripts/test-review-and-spec.ts
git commit -m "feat(measure): DISTO BLE profile + metres→ft-in field string (phase 2 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Measure drivers (Web Bluetooth, Capacitor BLE) + picker

**Files:**
- Modify: `package.json` (add `@capacitor-community/bluetooth-le`)
- Create: `src/lib/measure/web-bluetooth.ts`, `src/lib/measure/capacitor-ble.ts`, `src/lib/measure/index.ts`
- Modify: `ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `pickMeasureDriver(env?: { native: boolean; webBluetooth: boolean }): MeasureDriver | null` (the `env` parameter exists so the choice is spec-testable in node).

- [ ] **Step 1: Install** `npm install @capacitor-community/bluetooth-le` (verify `npm view @capacitor-community/bluetooth-le peerDependencies` accepts `@capacitor/core ^8`; if only `^7`, pin the newest major that does and note it in the commit).

- [ ] **Step 2: Failing spec test** (`import { pickMeasureDriver } from "@/lib/measure";`)

```ts
ok(pickMeasureDriver({ native: true, webBluetooth: false })?.kind === "capacitor-ble", "driver: shell → capacitor-ble");
ok(pickMeasureDriver({ native: false, webBluetooth: true })?.kind === "web-bluetooth", "driver: Chrome → web-bluetooth");
ok(pickMeasureDriver({ native: false, webBluetooth: false }) === null, "driver: iOS Safari → manual only");
```

- [ ] **Step 3: web-bluetooth.ts**

```ts
"use client";
import { DISTO, DISTO_MEASURE_CMD, parseDistoDistance } from "./disto";
import type { MeasureConnection, MeasureDriver } from "./types";

/** Android Chrome / desktop Chrome+Edge. Not available in any WebView or in Safari. */
export const webBluetoothDriver: MeasureDriver = {
  kind: "web-bluetooth",
  async connect(): Promise<MeasureConnection> {
    const nav = navigator as Navigator & { bluetooth?: any };
    const device = await nav.bluetooth.requestDevice({ filters: [{ services: [DISTO.service] }], optionalServices: [DISTO.service] });
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(DISTO.service);
    const dist = await svc.getCharacteristic(DISTO.distance);
    const cmd = await svc.getCharacteristic(DISTO.command).catch(() => null);
    await dist.startNotifications();
    const listeners = new Set<(r: { meters: number; at: number }) => void>();
    const handler = (ev: Event) => {
      const v = (ev.target as { value?: DataView }).value;
      const m = v ? parseDistoDistance(v) : null;
      if (m != null) listeners.forEach((cb) => cb({ meters: m, at: Date.now() }));
    };
    dist.addEventListener("characteristicvaluechanged", handler);
    return {
      name: device.name || "DISTO",
      onReading: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      trigger: cmd ? async () => { await cmd.writeValue(DISTO_MEASURE_CMD); } : undefined,
      disconnect: async () => { dist.removeEventListener("characteristicvaluechanged", handler); device.gatt?.disconnect(); },
    };
  },
};
```

- [ ] **Step 4: capacitor-ble.ts**

```ts
"use client";
import { DISTO, DISTO_MEASURE_CMD, parseDistoDistance } from "./disto";
import type { MeasureConnection, MeasureDriver } from "./types";

/** iOS + Android shell. Dynamic import keeps the plugin out of the web bundle. */
export const capacitorBleDriver: MeasureDriver = {
  kind: "capacitor-ble",
  async connect(): Promise<MeasureConnection> {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    await BleClient.initialize({ androidNeverForLocation: true });
    const device = await BleClient.requestDevice({ services: [DISTO.service] });
    const listeners = new Set<(r: { meters: number; at: number }) => void>();
    await BleClient.connect(device.deviceId, () => listeners.clear());
    await BleClient.startNotifications(device.deviceId, DISTO.service, DISTO.distance, (v: DataView) => {
      const m = parseDistoDistance(v);
      if (m != null) listeners.forEach((cb) => cb({ meters: m, at: Date.now() }));
    });
    return {
      name: device.name || "DISTO",
      onReading: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      trigger: async () => { await BleClient.write(device.deviceId, DISTO.service, DISTO.command, new DataView(DISTO_MEASURE_CMD.buffer)); },
      disconnect: async () => { await BleClient.stopNotifications(device.deviceId, DISTO.service, DISTO.distance).catch(() => {}); await BleClient.disconnect(device.deviceId).catch(() => {}); },
    };
  },
};
```

- [ ] **Step 5: index.ts**

```ts
import { hasNativeCapability } from "@/lib/platform";
import type { MeasureDriver } from "./types";
import { webBluetoothDriver } from "./web-bluetooth";
import { capacitorBleDriver } from "./capacitor-ble";

export type { MeasureConnection, MeasureDriver, Reading } from "./types";

function detect(): { native: boolean; webBluetooth: boolean } {
  const webBluetooth = typeof navigator !== "undefined" && "bluetooth" in navigator;
  return { native: hasNativeCapability("ble"), webBluetooth };
}

/** Shell → Capacitor BLE; Chrome → Web Bluetooth; otherwise null (manual entry only). */
export function pickMeasureDriver(env: { native: boolean; webBluetooth: boolean } = detect()): MeasureDriver | null {
  if (env.native) return capacitorBleDriver;
  if (env.webBluetooth) return webBluetoothDriver;
  return null;
}
```
(The driver modules only touch `navigator`/plugins inside `connect()`, so importing them in node is safe.)

- [ ] **Step 6: Native permissions.** `Info.plist`: `NSBluetoothAlwaysUsageDescription` = "Quartzite connects to a Bluetooth laser measure to fill in site dimensions." `AndroidManifest.xml`:

```xml
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
```

- [ ] **Step 7: Verify** specs (3 PASS), `tsc`, eslint on `src/lib/measure`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/measure/web-bluetooth.ts src/lib/measure/capacitor-ble.ts src/lib/measure/index.ts ios/App/App/Info.plist android/app/src/main/AndroidManifest.xml scripts/test-review-and-spec.ts
git commit -m "feat(measure): Web Bluetooth + Capacitor BLE drivers, runtime picker (phase 2 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `useLaser` + LaserBar + armed measure fields in the assessment editor

**Files:**
- Create: `src/lib/measure/use-laser.ts`, `src/lib/measure/sequence.ts`
- Create: `src/app/(app)/venue-assessments/[id]/sections/laser-bar.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/sections/fields.tsx` (`FieldRenderProps` gains `armedKey?`, `onArm?`)
- Modify: `src/app/(app)/venue-assessments/[id]/sections/types.ts` (no change unless `FieldDef` needs a `key` union; verify)
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (sequence.ts, pure): `nextEmptyMeasureKey(fields: FieldDef[], current: string, values: Record<string, string | boolean>): string | null` — the next `kind: "measure"` field after `current` whose value is blank, wrapping not allowed.
- Produces (use-laser.ts): `useLaser(opts: { onFill: (key, value) => void; nextKey: (key) => string | null }): { state; deviceName; lastReading; armed; arm; connect; disconnect; trigger; available }`.

- [ ] **Step 1: Failing spec test** (`import { nextEmptyMeasureKey } from "@/lib/measure/sequence";`)

```ts
{
  const fields = [
    { kind: "measure", key: "proW", label: "Proscenium width" },
    { kind: "select", key: "beamType", label: "Beam type", options: [] },
    { kind: "measure", key: "proH", label: "Proscenium height" },
    { kind: "measure", key: "stageDepth", label: "Stage depth" },
  ] as const;
  ok(nextEmptyMeasureKey(fields as never, "proW", {}) === "proH", "sequence: skips non-measure fields");
  ok(nextEmptyMeasureKey(fields as never, "proW", { proH: "12'" }) === "stageDepth", "sequence: skips filled fields");
  ok(nextEmptyMeasureKey(fields as never, "stageDepth", {}) === null, "sequence: no wrap at the end");
}
```

- [ ] **Step 2: sequence.ts**

```ts
import type { FieldDef } from "@/app/(app)/venue-assessments/[id]/sections/types";

export function nextEmptyMeasureKey(
  fields: FieldDef[],
  current: string,
  values: Record<string, string | boolean>
): string | null {
  const i = fields.findIndex((f) => "key" in f && f.key === current);
  for (let j = i + 1; j < fields.length; j++) {
    const f = fields[j];
    if (f.kind !== "measure") continue;
    const v = values[f.key];
    if (v == null || v === "" || v === false) return f.key;
  }
  return null;
}
```
(`types.ts` is type-only and already imported by client code, so this import is bundle-safe.)

- [ ] **Step 3: use-laser.ts**

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { pickMeasureDriver, type MeasureConnection, type Reading } from "./index";
import { metersToFieldString } from "./format";

export type LaserState = "unavailable" | "idle" | "connecting" | "connected" | "error";

export function useLaser(opts: { onFill: (key: string, value: string) => void; nextKey: (key: string) => string | null }) {
  const [state, setState] = useState<LaserState>("unavailable");
  const [deviceName, setDeviceName] = useState("");
  const [lastReading, setLastReading] = useState<Reading | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const conn = useRef<MeasureConnection | null>(null);
  const armedRef = useRef<string | null>(null);
  armedRef.current = armed;

  useEffect(() => {
    // after mount only, so SSR and the first paint never show the bar
    setState(pickMeasureDriver() ? "idle" : "unavailable");
  }, []);

  const connect = useCallback(async () => {
    const driver = pickMeasureDriver();
    if (!driver) return;
    setState("connecting");
    try {
      const c = await driver.connect();
      conn.current = c;
      setDeviceName(c.name);
      c.onReading((r) => {
        setLastReading(r);
        const key = armedRef.current;
        if (!key) return;
        opts.onFill(key, metersToFieldString(r.meters));
        setArmed(opts.nextKey(key));
      });
      setState("connected");
    } catch {
      setState("error");
    }
  }, [opts]);

  const disconnect = useCallback(async () => {
    await conn.current?.disconnect();
    conn.current = null;
    setArmed(null);
    setState("idle");
  }, []);

  const trigger = useCallback(() => conn.current?.trigger?.(), []);
  useEffect(() => () => { conn.current?.disconnect().catch(() => {}); }, []);

  return { state, deviceName, lastReading, armed, arm: setArmed, connect, disconnect, trigger, canTrigger: !!conn.current?.trigger };
}
```

- [ ] **Step 4: laser-bar.tsx** — a client component taking the hook's return plus `armedLabel: string | null`. Renders nothing when `state === "unavailable"`. Layout: one row, `ACCENT_SOFT` background, `ACCENT_BORDER_LT` border; left: "Laser" label + status text (`Not connected` / `Connecting…` / `deviceName` / `Could not connect — try again`); middle: last reading as `metersToFieldString` in `var(--font-mono)`; right: Connect / Disconnect button (`ACCENT` background when idle), a "Measure" button when `canTrigger`, and the chip `Next: {armedLabel}` with a small "×" that calls `arm(null)`. All buttons `minHeight: 40`. No emoji.

- [ ] **Step 5: fields.tsx** — extend `FieldRenderProps` with `armedKey?: string | null; onArm?: (key: string) => void;`. In the `kind === "measure"` branch:

```tsx
  if (f.kind === "measure") {
    const armed = p.armedKey === f.key;
    return (
      <div key={f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input inputMode="text" value={String(mv(f.key) ?? "")} onChange={(e) => setMeasure(f.key, e.target.value)} placeholder="ft-in or ft" style={armed ? { ...measStyle, borderColor: "var(--accent)", boxShadow: "0 0 0 2px color-mix(in srgb, var(--accent) 25%, #fff)" } : measStyle} />
          {p.onArm && (
            <button type="button" onClick={() => p.onArm!(f.key)} aria-label={`Fill ${f.label} from laser`} title="Fill from laser" style={{ flexShrink: 0, width: 44, borderRadius: 10, border: `1px solid ${armed ? "var(--accent)" : "#e4e7ec"}`, background: armed ? "var(--accent)" : "#fff", color: armed ? "#fff" : "#5b616e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {armed ? "ON" : "L"}
            </button>
          )}
        </div>
      </div>
    );
  }
```
`onArm` is only passed when the laser is connected, so the web editor without a driver renders exactly today's input.

- [ ] **Step 6: controls.tsx** — after `setMeasure`:

```ts
  const measureFieldsFlat = useMemo(() => sections.flatMap((s) => (s.kind === "fields" ? s.fields : [])), [sections]);
  const laser = useLaser({
    onFill: (key, value) => setMeasure(key, value),
    nextKey: (key) => nextEmptyMeasureKey(measureFieldsFlat, key, draft.measurements),
  });
```
(`sections` is defined above the render; move this below the `sections` memo.) Render `<LaserBar {...laser} armedLabel={...} />` immediately before the first section whose `id === "mQuick"`; pass `armedKey={laser.armed}` and `onArm={laser.state === "connected" ? laser.arm : undefined}` into every `FieldsSection`. `armedLabel` = the label of `measureFieldsFlat.find(f => f.key === laser.armed)`.

- [ ] **Step 7: Verify** specs (3 PASS), `tsc`, eslint, `npm run test:smoke`. Browser pane on `/venue-assessments/<id>` in desktop Chrome: the LaserBar appears (Chrome has `navigator.bluetooth`); clicking Connect opens the Chrome device chooser (cancel it → state `error`, message shown, manual entry still works). In Safari the bar is absent.

- [ ] **Step 8: Commit**

```bash
git add src/lib/measure/use-laser.ts src/lib/measure/sequence.ts "src/app/(app)/venue-assessments/[id]/sections/laser-bar.tsx" "src/app/(app)/venue-assessments/[id]/sections/fields.tsx" "src/app/(app)/venue-assessments/[id]/controls.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(assessments): laser bar + armed measure fields with sequential fill; manual entry unchanged (#30)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Push data model, FCM sender, bell-delta sweep route

**Files:**
- Modify: `src/db/schema.ts` (after `customerDomains`)
- Create: `drizzle/0020_*.sql` (generated; edit to `IF NOT EXISTS`)
- Create: `src/lib/push/fcm.ts`, `src/lib/push/delta.ts`, `src/lib/push/devices.ts`, `src/lib/push/sweep.ts`
- Create: `src/app/api/push/sweep/route.ts`
- Modify: `src/middleware.ts` (matcher exempts `api/push/sweep`), `vercel.json`
- Test: `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`

**Interfaces:**
- Produces (delta.ts, pure): `bellKeys(groups: BellGroup[]): string[]`, `newSince(current, seen): string[]`, `composeBody(groups, newKeys): { title; body; href } | null`.
- Produces (fcm.ts): `serviceAccountJwt(sa, nowMs): string` (pure given a key), `fcmAccessToken(sa): Promise<string>`, `sendFcm(sa, token, msg): Promise<"ok" | "unregistered" | "error">`, `pushConfigured(): boolean`.
- Produces (devices.ts): `registerDevice(userId, token, platform, appVersion)`, `unregisterDevice(token)`, `activeDevicesByUser(): Promise<Map<string, string[]>>`, `disableToken(token)`, `readCursor(userId)`, `writeCursor(userId, seen)`.
- Produces (sweep.ts): `sweepPush(deps: { send: (token, msg) => Promise<...>; bellFor: (userName) => Promise<BellGroup[]> }): Promise<{ users: number; sent: number }>`.

- [ ] **Step 1: Failing spec tests** (synchronous; `import { bellKeys, newSince, composeBody } from "@/lib/push/delta"; import { serviceAccountJwt } from "@/lib/push/fcm"; import { generateKeyPairSync, createVerify } from "node:crypto";`)

```ts
/* ---- phase 2 §4 — push delta + FCM JWT ---- */
{
  const groups = [
    { key: "tasks", label: "Tasks needing attention", items: [{ id: "T-1", title: "Order lift", sub: "Overdue", href: "/field-work", letter: "T", color: "#000" }] },
    { key: "leads", label: "Leads needing follow-up", items: [{ id: "L-9", title: "Lakefront ISD", sub: "", href: "/leads", letter: "L", color: "#000" }] },
  ];
  const keys = bellKeys(groups);
  ok(keys.join(",") === "tasks:T-1,leads:L-9", "bellKeys: group:id");
  ok(newSince(keys, ["tasks:T-1"]).join(",") === "leads:L-9", "newSince: only unseen");
  const msg = composeBody(groups, ["tasks:T-1", "leads:L-9"]);
  ok(msg?.title === "Tasks needing attention" && msg.body === "Order lift and 1 more" && msg.href === "/field-work", "composeBody: first item + count");
  ok(composeBody(groups, []) === null, "composeBody: nothing new → null");
}
{
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const jwt = serviceAccountJwt({ client_email: "svc@x.iam.gserviceaccount.com", private_key: pem, project_id: "x" }, 1_700_000_000_000);
  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  ok(claims.iss === "svc@x.iam.gserviceaccount.com" && claims.scope === "https://www.googleapis.com/auth/firebase.messaging" && claims.exp === claims.iat + 3600, "FCM JWT claims");
  ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url")), "FCM JWT signature verifies");
}
```

- [ ] **Step 2: schema.ts** — after `customerDomains`:

```ts
/** Phase 2 push — one row per device token; disabled when FCM reports UNREGISTERED. */
export const pushDevices = pgTable(
  "push_devices",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull(),
    platform: text("platform", { enum: ["ios", "android"] }).notNull(),
    appVersion: text("app_version"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
    disabledAt: bigint("disabled_at", { mode: "number" }),
  },
  (t) => [index("push_devices_user_idx").on(t.userId)]
);

/** Per-user set of bell item keys already notified (`group:id`). */
export const pushCursors = pgTable("push_cursors", {
  userId: text("user_id").primaryKey(),
  seen: jsonb("seen").$type<string[]>().notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
```
Run `npm run db:generate`; open the new `drizzle/0020_*.sql` and rewrite `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX` → `CREATE INDEX IF NOT EXISTS` (D140).

- [ ] **Step 3: delta.ts**

```ts
import type { BellGroup } from "@/components/nav/nav-data";

export function bellKeys(groups: BellGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => `${g.key}:${i.id}`));
}

export function newSince(current: string[], seen: string[]): string[] {
  const s = new Set(seen);
  return current.filter((k) => !s.has(k));
}

export function composeBody(groups: BellGroup[], newKeys: string[]): { title: string; body: string; href: string } | null {
  if (!newKeys.length) return null;
  const first = newKeys[0];
  const [gk, id] = [first.slice(0, first.indexOf(":")), first.slice(first.indexOf(":") + 1)];
  const g = groups.find((x) => x.key === gk);
  const item = g?.items.find((i) => i.id === id);
  if (!g || !item) return null;
  const more = newKeys.length - 1;
  return { title: g.label, body: more > 0 ? `${item.title} and ${more} more` : item.title, href: item.href };
}
```

- [ ] **Step 4: fcm.ts**

```ts
import { createSign } from "node:crypto";

export type ServiceAccount = { client_email: string; private_key: string; project_id: string };

export function pushConfigured(): boolean {
  return process.env.PUSH_ENABLED === "true" && !!process.env.FCM_SERVICE_ACCOUNT_JSON;
}

export function serviceAccount(): ServiceAccount {
  return JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON || "{}") as ServiceAccount;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** RS256 service-account assertion; pure given the key, so spec-testable. */
export function serviceAccountJwt(sa: ServiceAccount, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${b64url(sig)}`;
}

let cached: { token: string; exp: number } | null = null;
export async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountJwt(sa, Date.now()) }),
  });
  if (!r.ok) throw new Error(`fcm token ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export type PushMessage = { title: string; body: string; href: string };

export async function sendFcm(sa: ServiceAccount, token: string, msg: PushMessage): Promise<"ok" | "unregistered" | "error"> {
  const access = await fcmAccessToken(sa);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: { href: msg.href }, apns: { payload: { aps: { sound: "default" } } } } }),
  });
  if (r.ok) return "ok";
  const text = await r.text();
  return r.status === 404 || text.includes("UNREGISTERED") ? "unregistered" : "error";
}
```

- [ ] **Step 5: devices.ts** — Drizzle CRUD over the two tables, mirroring `src/lib/gmail/domains.ts` style: `registerDevice` upserts (`onConflictDoUpdate` sets `userId`, `lastSeenAt`, clears `disabledAt`) and, when no cursor row exists for the user, writes one seeded from `bellKeys(await navData(userName).bell)` — the caller passes `seedKeys: string[]` so this module stays free of nav-counts. `activeDevicesByUser()` returns `Map<userId, token[]>` where `disabledAt IS NULL`.

- [ ] **Step 6: sweep.ts**

```ts
import { bellKeys, composeBody, newSince } from "./delta";
import { activeDevicesByUser, disableToken, readCursor, writeCursor } from "./devices";
import type { PushMessage } from "./fcm";
import type { BellGroup } from "@/components/nav/nav-data";

export type SweepDeps = {
  send: (token: string, msg: PushMessage) => Promise<"ok" | "unregistered" | "error">;
  bellFor: (userId: string) => Promise<BellGroup[]>;
};

export async function sweepPush(deps: SweepDeps): Promise<{ users: number; sent: number }> {
  const byUser = await activeDevicesByUser();
  let sent = 0;
  for (const [userId, tokens] of byUser) {
    const groups = await deps.bellFor(userId);
    const keys = bellKeys(groups);
    const seen = await readCursor(userId);
    const fresh = newSince(keys, seen);
    const msg = composeBody(groups, fresh);
    if (msg) {
      for (const t of tokens) {
        const r = await deps.send(t, msg);
        if (r === "ok") sent++;
        else if (r === "unregistered") await disableToken(t);
      }
    }
    await writeCursor(userId, keys);
  }
  return { users: byUser.size, sent };
}
```
`bellFor` in production is `async (userId) => (await navData((await userById(userId)).name)).bell` — `navData` keys by user NAME (prototype convention); look up the name via `src/lib/users.ts`.

- [ ] **Step 7: route.ts** (`src/app/api/push/sweep/route.ts`) — copy `/api/gmail/sync/route.ts`: `maxDuration = 60`; 503 when `!pushConfigured()` or no `CRON_SECRET`; 401 on bearer mismatch; else `sweepPush({ send: (t, m) => sendFcm(serviceAccount(), t, m), bellFor })` and return the counts. Middleware matcher: add `api/push/sweep` to the exclusion group. `vercel.json`: add `{ "path": "/api/push/sweep", "schedule": "*/15 * * * *" }` (rejected on Hobby — see Blocked on Jeff; keep it in the file so Pro picks it up).

- [ ] **Step 8: Regression test** — in `main()` of `scripts/test-review-regressions.ts`:

```ts
  // phase 2 §4 — push sweep over the derived bell
  {
    const { registerDevice, readCursor, activeDevicesByUser } = await import("@/lib/push/devices");
    const { sweepPush } = await import("@/lib/push/sweep");
    await registerDevice("u1", "tok-1", "ios", "1.0", ["tasks:T-seed"]);
    assert.deepEqual(await readCursor("u1"), ["tasks:T-seed"], "registering seeds the cursor");
    const sent: string[] = [];
    const groups = [{ key: "tasks", label: "Tasks needing attention", items: [{ id: "T-seed", title: "old", sub: "", href: "/field-work", letter: "T", color: "#000" }, { id: "T-new", title: "Order lift", sub: "", href: "/field-work", letter: "T", color: "#000" }] }];
    const r1 = await sweepPush({ send: async (t, m) => { sent.push(`${t}:${m.body}`); return "ok"; }, bellFor: async () => groups });
    assert.equal(r1.sent, 1, "first sweep sends once");
    assert.equal(sent[0], "tok-1:Order lift", "body is the new item");
    const r2 = await sweepPush({ send: async () => "ok", bellFor: async () => groups });
    assert.equal(r2.sent, 0, "second sweep is quiet");
    await sweepPush({ send: async () => "unregistered", bellFor: async () => [{ ...groups[0], items: [...groups[0].items, { id: "T-3", title: "x", sub: "", href: "/", letter: "T", color: "#000" }] }] });
    assert.equal((await activeDevicesByUser()).size, 0, "unregistered token is disabled");
  }
```

- [ ] **Step 9: Verify** `npx tsx scripts/test-review-and-spec.ts | grep -E 'bellKeys|newSince|composeBody|FCM|ALL PASSED'`; then, alone, `npm run test:review:regressions`; `tsc`; `npm run test:smoke` (add `/api/push/sweep` expecting 401 or 503 if the smoke list is status-strict — check `scripts/smoke-routes.ts` for how non-2xx expectations are declared and follow it).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts drizzle/ src/lib/push/fcm.ts src/lib/push/delta.ts src/lib/push/devices.ts src/lib/push/sweep.ts src/app/api/push/sweep/route.ts src/middleware.ts vercel.json scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(push): device registry, FCM v1 sender, bell-delta cron sweep (phase 2 §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Push client — registration, tap routing, Account toggle

**Files:**
- Modify: `package.json` (add `@capacitor/push-notifications`)
- Modify: `src/lib/push/client.ts` (replace the Task 1 stub)
- Create: `src/app/(app)/account/push-actions.ts`, `src/app/(app)/account/push-toggle.tsx`
- Modify: `src/app/(app)/account/page.tsx`
- Modify: `src/components/nav/Nav.tsx` (one-time prompt line in the bell dropdown, native only)
- Modify: `ios/App/App/Info.plist` (`UIBackgroundModes` → `remote-notification`), `android/app/src/main/AndroidManifest.xml` (`POST_NOTIFICATIONS`)

**Interfaces:**
- Produces (client.ts): `bootNative(go)`, `enablePush(): Promise<"granted" | "denied" | "unavailable">`, `disablePush()`, `pushEnabledLocally(): boolean` (`localStorage.qz_push_token`).
- Produces (push-actions.ts, `"use server"`): `registerPushDeviceAction(token, platform, appVersion)`, `unregisterPushDeviceAction(token)` — both `requireUser()`; register seeds the cursor with `bellKeys((await navData(user.name)).bell)`.

- [ ] **Step 1: Install** `npm install @capacitor/push-notifications@^8`.

- [ ] **Step 2: client.ts**

```ts
"use client";
import { hasNativeCapability, platformName } from "@/lib/platform";
import { registerPushDeviceAction, unregisterPushDeviceAction } from "@/app/(app)/account/push-actions";

const TOKEN_KEY = "qz_push_token";
export const pushEnabledLocally = () => typeof localStorage !== "undefined" && !!localStorage.getItem(TOKEN_KEY);

async function plugin() {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  return PushNotifications;
}

/** Wire registration + tap listeners; re-register a previously opted-in device (tokens rotate). */
export async function bootNative(go: (href: string) => void): Promise<void> {
  if (!hasNativeCapability("push")) return;
  const P = await plugin();
  await P.addListener("registration", async ({ value }) => {
    localStorage.setItem(TOKEN_KEY, value);
    const plat = platformName();
    if (plat !== "web") await registerPushDeviceAction(value, plat, "1.0");
  });
  await P.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const href = (notification.data as { href?: string })?.href;
    if (href && href.startsWith("/")) go(href);
  });
  if (pushEnabledLocally()) await P.register();
}

export async function enablePush(): Promise<"granted" | "denied" | "unavailable"> {
  if (!hasNativeCapability("push")) return "unavailable";
  const P = await plugin();
  const perm = await P.requestPermissions();
  if (perm.receive !== "granted") return "denied";
  await P.register(); // token arrives on the "registration" listener from bootNative
  return "granted";
}

export async function disablePush(): Promise<void> {
  const t = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  if (t) await unregisterPushDeviceAction(t);
}
```

- [ ] **Step 3: push-actions.ts** — `"use server"`; `requireUser()`; `pushConfigured()` guard (no-op when off); `registerDevice(user.id, token, platform, appVersion, bellKeys((await navData(user.name)).bell))`; `unregisterDevice(token)`.

- [ ] **Step 4: push-toggle.tsx** — client component; renders `null` until mounted and unless `hasNativeCapability("push")`; then a row styled like the existing `notif-controls.tsx` rows: label "Notifications on this device", sub "Get the to-do bell as a push notification about every 15 minutes.", a toggle bound to `pushEnabledLocally()`; on → `enablePush()` (show "Allow notifications in Settings to turn this on." when denied); off → `disablePush()`. Account `page.tsx` renders `<PushToggle configured={pushConfigured()} />` under the notification categories; the component hides itself when `!configured`.

- [ ] **Step 5: Nav.tsx** — inside the bell dropdown, native only and once: a single muted line "Get these as notifications — turn on in Account" linking to `/account`, shown when `isNativePlatform() && !pushEnabledLocally() && !localStorage.qz_push_prompted`; clicking or dismissing sets `qz_push_prompted`. Guard all of it inside a `useEffect`-set boolean so SSR is unchanged.

- [ ] **Step 6: Native config.** `Info.plist`: add `<key>UIBackgroundModes</key><array><string>remote-notification</string></array>`. The Push Notifications *capability* (entitlements + `project.pbxproj` `SystemCapabilities`) is signing-bound — leave for Task 11. `AndroidManifest.xml`: `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`. Do not add `google-services.json` (Jeff supplies it; the gradle already applies the plugin conditionally).

- [ ] **Step 7: Verify** `tsc`, eslint, `npm run test:smoke` (`/account` 200). In the browser pane `/account` shows no new row (web).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/push/client.ts "src/app/(app)/account/push-actions.ts" "src/app/(app)/account/push-toggle.tsx" "src/app/(app)/account/page.tsx" src/components/nav/Nav.tsx ios/App/App/Info.plist android/app/src/main/AndroidManifest.xml
git commit -m "feat(push): native registration + tap routing, Account per-device toggle (phase 2 §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Wave B — readability (#33)

### Task 9: Disclosure table, CSS utilities, shared breakpoints in Nav / Inbox / Estimator

**Files:**
- Create: `src/lib/disclosure.ts`
- Modify: `src/app/globals.css`, `src/lib/use-breakpoint.ts` (export `tierFor`)
- Modify: `src/components/nav/Nav.tsx`, `src/app/(app)/inbox/inbox-shell.tsx`, `src/app/(app)/estimator/estimator-client.tsx`
- Modify: page titles in `src/app/(app)/venue-assessments/page.tsx`, `src/app/(app)/inspections/page.tsx`, `src/app/(app)/field-work/page.tsx`, `src/app/(app)/page.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (use-breakpoint.ts): `tierFor(width: number): Breakpoint` (extracted from `current()`).
- Produces (disclosure.ts, pure): `DISCLOSURE` table and `disclose(screen, setting, tier)`.

- [ ] **Step 1: Failing spec tests** (`import { tierFor } from "@/lib/use-breakpoint"; import { DISCLOSURE, TIERS } from "@/lib/disclosure";`)

```ts
/* ---- #33 — tiers + disclosure table ---- */
ok(tierFor(639) === "mobile" && tierFor(640) === "tablet" && tierFor(1023) === "tablet" && tierFor(1024) === "desktop", "tierFor at the edges");
{
  const rank = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? v : 0);
  let complete = true, monotone = true;
  for (const [screen, settings] of Object.entries(DISCLOSURE)) {
    for (const [name, byTier] of Object.entries(settings)) {
      for (const t of TIERS) if (!(t in byTier)) { complete = false; console.log("missing", screen, name, t); }
      const m = rank((byTier as Record<string, unknown>).mobile), tb = rank((byTier as Record<string, unknown>).tablet), d = rank((byTier as Record<string, unknown>).desktop);
      if (typeof (byTier as Record<string, unknown>).mobile !== "string" && !(m <= tb && tb <= d)) { monotone = false; console.log("non-monotone", screen, name); }
    }
  }
  ok(complete, "DISCLOSURE: every setting has all three tiers");
  ok(monotone, "DISCLOSURE: mobile ≤ tablet ≤ desktop for boolean/number settings");
}
```

- [ ] **Step 2: use-breakpoint.ts** — export `tierFor` and have `current()` call it.

- [ ] **Step 3: disclosure.ts**

```ts
import type { Breakpoint } from "./use-breakpoint";

export const TIERS: Breakpoint[] = ["mobile", "tablet", "desktop"];
type PerTier<T> = Record<Breakpoint, T>;

/**
 * #33 — what each screen shows per device tier. Data, not code, so the
 * choices are reviewable in one place and spec-tested for monotonicity
 * (a phone never shows more than a tablet, a tablet never more than a desktop).
 */
export const DISCLOSURE = {
  nav:              { drawer: { mobile: true, tablet: true, desktop: false } as PerTier<boolean> },
  inbox:            { splitPane: { mobile: false, tablet: false, desktop: true } as PerTier<boolean> },
  estimator:        { phoneMode: { mobile: true, tablet: false, desktop: false } as PerTier<boolean> },
  assessmentEditor: {
    defaultLayout:       { mobile: "wizard", tablet: "long", desktop: "long" } as PerTier<"long" | "wizard" | "accordion">,
    advancedOpen:        { mobile: false, tablet: false, desktop: true } as PerTier<boolean>,
    headerButtonsInline: { mobile: false, tablet: true, desktop: true } as PerTier<boolean>,
  },
  inspectionEditor: {
    rubricDescriptions: { mobile: false, tablet: true, desktop: true } as PerTier<boolean>,
    gridColumns:        { mobile: 1, tablet: 2, desktop: 2 } as PerTier<number>,
  },
  fieldWork: {
    columns:   { mobile: 1, tablet: 2, desktop: 3 } as PerTier<number>,
    crewChips: { mobile: false, tablet: true, desktop: true } as PerTier<boolean>,
    todayOnly: { mobile: true, tablet: false, desktop: false } as PerTier<boolean>, // inverted meaning: documented exception, tested as string below
  },
  assessmentList: { kpiStrip: { mobile: false, tablet: true, desktop: true } as PerTier<boolean>, filters: { mobile: false, tablet: false, desktop: true } as PerTier<boolean> },
  inspectionList: { columns: { mobile: 2, tablet: 3, desktop: 4 } as PerTier<number> },
  home:           { kpiPerRow: { mobile: 2, tablet: 3, desktop: 4 } as PerTier<number> },
} as const;

export function disclose<S extends keyof typeof DISCLOSURE, K extends keyof (typeof DISCLOSURE)[S]>(screen: S, setting: K, tier: Breakpoint) {
  return (DISCLOSURE[screen][setting] as PerTier<unknown>)[tier] as (typeof DISCLOSURE)[S][K] extends PerTier<infer T> ? T : never;
}
```
Rename `todayOnly` to `showOtherDays: { mobile: false, tablet: true, desktop: true }` so the monotonicity test holds without an exception; the comment above is a reminder, delete it.

- [ ] **Step 4: globals.css** — after the "Mobile foundation" block:

```css
/* #33 — per-tier disclosure utilities. Tiers mirror BREAKPOINTS in src/lib/use-breakpoint.ts. */
.pk-tap { min-height: 44px; }
@media (max-width: 639px) {
  .pk-mobile-hide { display: none !important; }
  .pk-stack-mobile { grid-template-columns: 1fr !important; }
}
@media (min-width: 640px) { .pk-mobile-only { display: none !important; } }
@media (max-width: 1023px) { .pk-tablet-hide { display: none !important; } }
```

- [ ] **Step 5: Adopt the hook.** `Nav.tsx`: replace the `window.innerWidth <= 860` effect with `const bp = useBreakpoint(); const narrow = disclose("nav", "drawer", bp);` (delete `setNarrow` state). `inbox-shell.tsx`: `setNarrow(window.innerWidth <= 960)` → `const narrow = !disclose("inbox", "splitPane", useBreakpoint());` and change its `@media (max-width: 960px)` rule (~line 399 comment) to `1023px`. `estimator-client.tsx`: `setPhone(window.innerWidth <= 700)` → `disclose("estimator", "phoneMode", bp)`; its `@media (max-width: 860px)` block → `1023px`.

- [ ] **Step 6: Titles.** Replace `style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}` on the four page titles with `className="pk-h1" style={{ letterSpacing: "-.015em" }}`. In the assessment editor sticky header the title `div` gets `className="pk-h3"` (keep the ellipsis styles).

- [ ] **Step 7: Verify** specs (3 PASS), `tsc`, eslint, `npm run test:smoke`. Browser pane: `/` at 375, 820, 1440 — the nav drawer appears at 375 and 820, inline at 1440; `/inbox` single pane at 820.

- [ ] **Step 8: Commit**

```bash
git add src/lib/disclosure.ts src/lib/use-breakpoint.ts src/app/globals.css src/components/nav/Nav.tsx "src/app/(app)/inbox/inbox-shell.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/venue-assessments/page.tsx" "src/app/(app)/inspections/page.tsx" "src/app/(app)/field-work/page.tsx" "src/app/(app)/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(#33): disclosure table, tier utilities, shared breakpoints in nav/inbox/estimator, fluid titles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Per-screen disclosure — assessment editor, inspection capture, field work, two lists

**Files:**
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`
- Modify: `src/app/(app)/inspections/[id]/controls.tsx`
- Modify: `src/app/(app)/field-work/page.tsx`, `src/app/(app)/field-work/controls.tsx`
- Modify: `src/app/(app)/venue-assessments/page.tsx`, `src/app/(app)/inspections/page.tsx`

- [ ] **Step 1: Assessment editor.** `const bp = useBreakpoint();` Initial `layoutMode` = `disclose("assessmentEditor", "defaultLayout", bp)` applied once after mount (`useEffect` on first non-default `bp`, only if the user has not toggled — track `userPickedLayout` state). `isCollapsible` stays; the initial open-set for `advanced` sections = `disclose("assessmentEditor", "advancedOpen", bp)`. When `!disclose(..., "headerButtonsInline", bp)`, render Print sheet and Delete inside a single "More" button that toggles a small menu (absolute-positioned `div`, same button styles) — Save changes stays visible. Add `className="pk-tap"` to the stage pills and header buttons.

- [ ] **Step 2: Inspection capture.** Rubric section descriptions wrap in `{disclose("inspectionEditor", "rubricDescriptions", bp) ? <p>…</p> : <details><summary>What to check</summary>…</details>}`. The `ie-grid` rule already goes 1-col at 640; leave it (matches `gridColumns.mobile = 1`).

- [ ] **Step 3: Field Work.** In `page.tsx` (server): keep data as is. In `controls.tsx`: wrap crew/stage chips in `className="pk-mobile-hide"`; the day-switcher shows only Today plus a "Other days" link when `!disclose("fieldWork", "showOtherDays", bp)`; the hours KPI row gets `className="pk-stack-mobile"` replaced by a 2-up grid on mobile (`gridTemplateColumns: bp === "mobile" ? "1fr 1fr" : …`).

- [ ] **Step 4: Venue Assessments list.** The KPI strip container gets `className="pk-mobile-hide"`; the filter row `className="pk-tablet-hide"` with a compact select shown via `pk-mobile-only`… keep it simple: filters hidden below desktop, the stage pill row stays (it is the primary filter). Cards already `auto-fill minmax(300px)`, which yields one column on phones.

- [ ] **Step 5: Inspections inbox.** The 4-column grid header and rows (`"minmax(0,1fr) 110px 96px 78px"`) become `className="ins-row"` with a `<style>` block: `@media (max-width:639px){ .ins-row{ grid-template-columns:minmax(0,1fr) 78px !important; } .ins-col-mid{ display:none !important; } } @media (max-width:1023px){ .ins-col-date{ display:none !important; } }` — tag the two middle cells `ins-col-mid` / `ins-col-date` so mobile shows name + status, tablet adds one more, desktop all four (matches `columns: 2/3/4`).

- [ ] **Step 6: Verify** `tsc`, eslint, `npm run test:smoke`. Browser pane checklist (record results in the commit body):
  - 375×812: `/venue-assessments/<id>` opens in Stepped layout, header shows Save + More; `/inspections/<id>` rubric text collapsed; `/field-work` single column, no crew chips; `/inspections` two columns.
  - 820×1180: Long layout with advanced sections collapsed; `/inspections` three columns.
  - 1440: unchanged from before this task.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/venue-assessments/[id]/controls.tsx" "src/app/(app)/inspections/[id]/controls.tsx" "src/app/(app)/field-work/page.tsx" "src/app/(app)/field-work/controls.tsx" "src/app/(app)/venue-assessments/page.tsx" "src/app/(app)/inspections/page.tsx"
git commit -m "feat(#33): per-tier disclosure on the field screens (editor layout defaults, collapsed advanced, list columns)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Wave C — human-gated: native sync, TestFlight, device verification

### Task 11: Native project sync + release checklist (human on the Mac; Jeff for signing)

**Files:**
- Create: `docs/reference/native-release-checklist.md`
- Modify (by `cap sync`, then committed): `ios/App/CapApp-SPM/Package.swift`, `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`
- Modify: `DEPLOY.md` (env: `PUSH_ENABLED`, `FCM_SERVICE_ACCOUNT_JSON`; cron plan note)

**What the agent does:** writes the checklist below into `docs/reference/native-release-checklist.md` and the DEPLOY.md env rows. Does NOT run `cap sync`, Xcode or gradle.

**What a human on the build Mac does, in order:**

- [ ] **Step 1:** `export PATH=$HOME/.local/node/bin:$PATH && npm install && npx cap sync` — installs the three plugins into both native projects. Confirm `ios/App/CapApp-SPM/Package.swift` now lists `CapacitorCamera`, `CapacitorCommunityBluetoothLe`, `CapacitorPushNotifications`. Commit those generated files with `git add ios/App/CapApp-SPM/Package.swift android/app/capacitor.build.gradle android/capacitor.settings.gradle`.
- [ ] **Step 2 (Jeff, or with Jeff's Apple account):** `npx cap open ios`; Signing & Capabilities → select the team, automatic signing; add capability **Push Notifications**; confirm **Background Modes → Remote notifications** is ticked (from the plist edit). Drop `GoogleService-Info.plist` into `ios/App/App/` (not required for FCM-via-APNs token delivery, but needed if Firebase SDK is ever added; skip if absent).
- [ ] **Step 3 (Jeff):** Product → Archive → Distribute → TestFlight (internal). Add testers in App Store Connect.
- [ ] **Step 4 (Jeff, Vercel):** set `PUSH_ENABLED=true`, `FCM_SERVICE_ACCOUNT_JSON`, confirm `CRON_SECRET`; if on Hobby, either upgrade or create an external 15-minute pinger `GET https://quartzite-six.vercel.app/api/push/sweep` with `Authorization: Bearer <CRON_SECRET>`.
- [ ] **Step 5 (Android, after iOS):** place `google-services.json` in `android/app/`; `npx cap open android`; Build → Generate Signed Bundle with Jeff's upload keystore; Play Console internal testing.

Blocked-on-Jeff items are exactly the spec's section 6 list; the checklist file repeats them verbatim with checkboxes.

- [ ] **Commit (agent, docs only):**

```bash
git add docs/reference/native-release-checklist.md DEPLOY.md
git commit -m "docs(native): release checklist + push env (phase 2 §6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Device verification — camera, DISTO, push (human with the phone and the laser)

**Files:**
- Modify: `src/lib/measure/disto.ts` only if the real unit's UUIDs differ
- Modify: `DECISIONS.md` (next free D-number; D142 is the #96 Wave B decision — use the next one), `PUNCHLIST.md` (#30 → DONE-native / #31 → DONE-phase-2 / #33 → program status with the six screens listed)

**Human steps (on the TestFlight build, signed in):**

- [ ] **Camera:** open a venue assessment → Photos → Add photo → the OS sheet offers Camera / Photos; a shot appears in the grid; Save with Wi-Fi off shows "Saved on this device — will sync when you're back online"; back online the photo is on the office copy.
- [ ] **DISTO:** power on the laser, Bluetooth icon lit. Measurements → Laser bar → Connect → pick the DISTO in the system sheet. Press the laser's measure key: the reading shows in the bar; tap the "L" button on Proscenium width, measure again → the field fills as `ft'-in"`, and the chip reads "Next: Proscenium height". Tap "Measure" in the bar → the DISTO fires. If Connect never finds the device, run a BLE scanner app (e.g. nRF Connect) and report the advertised service UUID; the agent updates `disto.ts`.
- [ ] **Push:** Account → Notifications on this device → Allow. On the web, assign a task to this user. Within one sweep (≤15 min, or hit the route with the bearer) the phone shows "Tasks needing attention — <task title>"; tapping opens `/field-work`.
- [ ] **Android Chrome (no shell) sanity:** open the hosted site on an Android phone in Chrome, same assessment → the Laser bar appears and Connect uses the Chrome device chooser.

**Agent steps after the human reports:**

- [ ] Record outcomes and any UUID change; write the DECISIONS entry (protocol choice, field-string format, push provider + sweep, opt-in rule, tiers, editor defaults, version-skew rule) and update PUNCHLIST.
- [ ] Full gate one at a time: `npx tsc --noEmit -p .`, `npx eslint .`, `npm run test:specs`, `npm run test:review:regressions`, `npm run test:smoke`.

```bash
git add DECISIONS.md PUNCHLIST.md src/lib/measure/disto.ts
git commit -m "docs: native shell phase 2 decisions; #30 laser on device, #31 TestFlight, #33 field screens

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

> Decision numbering (assigned 2026-09-21 by the controller): #96 Wave B = D142, #44 = D143, #43 = D144, #40 = D145, this plan = **D146**.
