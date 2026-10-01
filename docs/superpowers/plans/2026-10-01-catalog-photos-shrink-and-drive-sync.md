# Catalog photos — shrink + Peak Product Photos Drive sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every catalog image is shrunk to a ≤1600 px WebP on the way in, and photos dropped in a Google Drive folder named
"Peak Product Photos" sync into the catalog as part images.

**Architecture:**
- One sharp-based `shrinkImage` helper is called at every image entry point.
- A Drive read-only client (`drive-photos.ts`) lists the folder tree. A pure planner decides import / update / relink /
  unmatched, and a budgeted executor applies it. State lives in one settings blob.
- Triggers:
  - an admin "Sync now" panel on Catalog → Datasheets;
  - a rider on the existing daily `/api/gmail/sync` cron.

**Tech Stack:** Next.js 16 App Router (server actions), TypeScript, sharp 0.35.x, Google Drive v3 REST, Vercel Blob,
Drizzle/PGlite doc-store. Tests live in the spec harness `scripts/test-review-and-spec.ts` (`npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-10-01-catalog-photos-shrink-and-drive-sync-design.md`

## Global Constraints

- Shrink: longest side ≤ 1600 px (never enlarge), `.rotate()` for EXIF, WebP quality 80, metadata stripped,
  `limitInputPixels` 100 000 000.
- Refusal text, verbatim: `Couldn't read this image — save it as JPEG, PNG or WebP.`
- `MAX_PART_IMAGE_BYTES` = 25 MB. Applies only to kind `"image"`; datasheets/spec sheets are never shrunk.
- Folder name, verbatim: `Peak Product Photos`.
- Drive scope: `https://www.googleapis.com/auth/drive.readonly`. The sync never writes to Drive.
- Every Drive call passes `supportsAllDrives=true`. Every list call passes `includeItemsFromAllDrives=true&corpora=allDrives`.
- New `PartDocumentSource` value: `"drive"`, label `"Drive"`, rank equal to `upload` (0).
- Settings blob id: `drive_photo_sync`. New app setting: `catalogPhotosMailbox: string | null`.
- Labor-category parts are never match targets.
- A Drive file deleted later keeps its app copy. A known file renamed into "unmatched" keeps its links (it's only listed).
- Never run `next dev`, db scripts or `git stash`. Gates: `npx tsc --noEmit -p .`, `npm run test:specs`, `npx eslint
  <changed files>` (0 errors), and in the last task `npx next build` + `npm run test:smoke`.
- After any `test:specs` run: `for d in $TMPDIR/tmp.*(N); do [ -f "$d/PG_VERSION" ] && rm -rf "$d"; done`.
- Node: `export PATH=~/.local/node/bin:$PATH`. Harness async suites are `async function xxxAsyncChecks(): Promise<void>`,
  added to the `.then(() => …)` chain just before `.finally(() => teardownFixtures())` (~L10685). `ok(cond, msg)` is
  global (L340). Prefix every new check message with `#283 `.
- Commit after each task on branch `feat/283-catalog-photos-drive`. Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: `shrinkImage` + sharp as a direct dependency

**Files:**
- Create: `src/lib/part-docs/shrink.ts`
- Modify: `package.json` / `package-lock.json` (sharp direct dep), `next.config.ts` (`serverExternalPackages` += `"sharp"`)
- Test: `scripts/test-review-and-spec.ts` (new `shrink283AsyncChecks`)

**Interfaces — Produces:**
- `shrinkImage(input: Uint8Array): Promise<ShrinkResult>`
- `type ShrinkResult = { ok: true; bytes: Buffer; contentType: "image/webp"; width: number; height: number } | { ok: false; error: string }`
- `webpFileName(name: string): string`
- `SHRINK_MAX_EDGE = 1600`, `SHRINK_UNREADABLE` (the refusal text)

- [ ] **Step 1: Add the dependency.** Run `npm install sharp@0.35.4 --save`. Use whatever 0.35.x `node_modules/sharp/package.json` reports.
  Confirm `package.json` now lists `"sharp"` under `dependencies` and that `git diff package-lock.json` only promotes sharp
  (no unrelated upgrades). Add `"sharp"` to `serverExternalPackages` in `next.config.ts`.

- [ ] **Step 2: Write the failing harness block.** Append near the end of the harness (aliased import + async suite) and
  chain `.then(() => shrink283AsyncChecks())` before `.finally`:

```ts
// ---------------------------------------------------------------------------
// #283 — shrinkImage: every catalog image becomes a ≤1600 px WebP.
// ---------------------------------------------------------------------------
import { shrinkImage as s283Shrink, webpFileName as s283Name, SHRINK_UNREADABLE as s283Unreadable } from "@/lib/part-docs/shrink";
import s283Sharp from "sharp";
async function shrink283AsyncChecks(): Promise<void> {
  const big = await s283Sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  const a = await s283Shrink(big);
  ok(a.ok && a.width === 1600 && a.height === 1067 && a.contentType === "image/webp", "#283 shrink: a 3000×2000 PNG comes out 1600 px wide WebP");
  ok(a.ok && (await s283Sharp(a.bytes).metadata()).format === "webp", "#283 shrink: the bytes really are WebP");

  const small = await s283Sharp({ create: { width: 400, height: 300, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  const b = await s283Shrink(small);
  ok(b.ok && b.width === 400 && b.height === 300, "#283 shrink: a small image is never enlarged");

  const rotated = await s283Sharp({ create: { width: 200, height: 100, channels: 3, background: "#000" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const c = await s283Shrink(rotated);
  const cMeta = c.ok ? await s283Sharp(c.bytes).metadata() : null;
  ok(c.ok && c.width === 100 && c.height === 200, "#283 shrink: an EXIF-rotated photo comes out upright");
  ok(!!cMeta && !cMeta.exif && !cMeta.orientation, "#283 shrink: EXIF (incl. GPS/orientation) is stripped");

  const bad = await s283Shrink(new Uint8Array(Buffer.from("definitely not an image")));
  ok(!bad.ok && bad.error === s283Unreadable, "#283 shrink: garbage bytes refuse with the save-as-JPEG message");

  ok(s283Name("S4LED-S3 front.JPG") === "S4LED-S3 front.webp" && s283Name("photo") === "photo.webp" && s283Name("") === "image.webp",
    "#283 webpFileName: swaps or adds the .webp extension");
}
```

- [ ] **Step 3: Run it and watch it fail.** Run `npm run test:specs 2>&1 | grep -E "#283|Cannot find|ALL PASSED|FAILED"`.
  Expected: a module-not-found error for `@/lib/part-docs/shrink`.

- [ ] **Step 4: Implement `src/lib/part-docs/shrink.ts`:**

```ts
// SERVER ONLY — imports sharp (native). Never import from a "use client" file.
/**
 * #283 — every catalog image is shrunk on the way in (spec Part 1): EXIF
 * orientation applied, longest side ≤ 1600 px (never enlarged), re-encoded
 * as WebP q80. sharp drops all metadata (EXIF/GPS) unless asked to keep it.
 * HEIC (iPhone) can't be decoded by sharp's prebuilt binaries and, like any
 * corrupt file, refuses with SHRINK_UNREADABLE.
 */
import sharp from "sharp";

export const SHRINK_MAX_EDGE = 1600;
export const SHRINK_WEBP_QUALITY = 80;
export const SHRINK_MAX_INPUT_PIXELS = 100_000_000;
export const SHRINK_UNREADABLE = "Couldn't read this image — save it as JPEG, PNG or WebP.";

export type ShrinkResult =
  | { ok: true; bytes: Buffer; contentType: "image/webp"; width: number; height: number }
  | { ok: false; error: string };

export async function shrinkImage(input: Uint8Array): Promise<ShrinkResult> {
  try {
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: SHRINK_MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: SHRINK_MAX_EDGE, height: SHRINK_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: SHRINK_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, bytes: data, contentType: "image/webp", width: info.width, height: info.height };
  } catch {
    return { ok: false, error: SHRINK_UNREADABLE };
  }
}

/** "front.JPG" → "front.webp"; no extension → appended; empty → "image.webp". */
export function webpFileName(name: string): string {
  const base = String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, "") || "image";
  return `${base}.webp`;
}
```

- [ ] **Step 5: Run the checks and watch them pass.** Run `npm run test:specs 2>&1 | grep -E "#283|ALL PASSED|FAILED"`.
  Expected: every `#283 shrink` line PASS and `ALL PASSED`. If `c.width` is 200 (orientation not applied), confirm that
  `.rotate()` comes before `.resize` with no arguments. Then clean up the temp dirs (see Global Constraints).

- [ ] **Step 6: Commit.** Commit `feat(catalog): shrinkImage — every catalog image becomes a ≤1600 px WebP (#283)` with the
  package files, next.config, shrink.ts and the harness.

---

### Task 2: Shrink at every image entry point + 25 MB cap

**Files:**
- Create: `src/lib/part-docs/shrink-upload.ts`
- Modify:
  - `src/lib/part-docs/types.ts:127`: `MAX_PART_IMAGE_BYTES = 25 * 1024 * 1024`, comment updated.
  - `src/app/(app)/catalog/documents/actions.ts`: `attachUploadedDocumentAction` ~L121, `replaceDocumentFileAction` ~L159,
    `addImageFromUrlAction` ~L424.
  - `src/lib/part-docs/thumbnail.ts` ~L128-150.
  - `src/app/(app)/catalog/documents/upload/bulk-drop.tsx:148` (hint text).
- Test: harness `shrinkUpload283AsyncChecks`. Also update any existing check that asserts the old 10 MB image cap or the
  "images up to 10 MB" text: grep the harness for `MAX_PART_IMAGE_BYTES`, `10 MB` and `10 * 1024 * 1024`.

**Interfaces:**
- Consumes: `shrinkImage`, `webpFileName` (Task 1); `StoredFile` from `@/lib/stores/part-documents` (confirm it's
  exported; if not, export the type); `partDocBlobPath` from `./types`; `getBlobStream`, `putBlob`, `deleteBlob` from
  `@/lib/blob`.
- Produces:
  - `shrinkStoredImage(documentId: string, file: StoredFile, deps?: ShrinkUploadDeps): Promise<{ ok: true; file: StoredFile } | { ok: false; error: string }>`
  - `type ShrinkUploadDeps = { read(pathname: string): Promise<Uint8Array | null>; put(pathname: string, bytes: Buffer, contentType: string): Promise<{ pathname: string }>; remove(pathname: string): Promise<void> }`

- [ ] **Step 1: Write the failing harness block.**

```ts
// ---------------------------------------------------------------------------
// #283 — an uploaded image is swapped for its shrunk copy; a bad one is deleted.
// ---------------------------------------------------------------------------
import { shrinkStoredImage as su283 } from "@/lib/part-docs/shrink-upload";
async function shrinkUpload283AsyncChecks(): Promise<void> {
  const photo = await s283Sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#369" } }).jpeg().toBuffer();
  const store = new Map<string, Uint8Array>([["part-docs/PD-283aaaaaaaaa/orig.jpg", photo]]);
  const removed: string[] = [];
  const deps = {
    read: async (p: string) => store.get(p) ?? null,
    put: async (p: string, bytes: Buffer) => { store.set(p, bytes); return { pathname: p }; },
    remove: async (p: string) => { removed.push(p); store.delete(p); },
  };
  const file = { blobKey: "part-docs/PD-283aaaaaaaaa/orig.jpg", fileName: "orig.jpg", contentType: "image/jpeg", size: photo.byteLength };
  const r = await su283("PD-283aaaaaaaaa", file, deps);
  ok(r.ok && r.file.contentType === "image/webp" && r.file.fileName === "orig.webp" && r.file.size < photo.byteLength,
    "#283 upload: the stored file becomes a smaller WebP");
  ok(r.ok && r.file.blobKey !== file.blobKey && removed.includes(file.blobKey) && store.has(r.file.blobKey),
    "#283 upload: the shrunk copy is stored and the original upload deleted");

  const badKey = "part-docs/PD-283bbbbbbbbb/x.png";
  store.set(badKey, new Uint8Array(Buffer.from("nope")));
  const bad = await su283("PD-283bbbbbbbbb", { ...file, blobKey: badKey, fileName: "x.png" }, deps);
  ok(!bad.ok && removed.includes(badKey), "#283 upload: an unreadable upload is refused and its blob deleted");

  const gone = await su283("PD-283cccccccccc", { ...file, blobKey: "part-docs/PD-283cccccccccc/missing.jpg" }, deps);
  ok(!gone.ok && !removed.includes("part-docs/PD-283cccccccccc/missing.jpg"), "#283 upload: a blob that can't be read is refused without deleting");
}
```

Check `partDocBlobPath`'s real prefix in `src/lib/part-docs/types.ts` and make the fake keys match its format. The
checks only need the keys to round-trip through the fake store. Chain `.then(() => shrinkUpload283AsyncChecks())`.

- [ ] **Step 2: Run it and watch it fail** (module not found).

- [ ] **Step 3: Implement `src/lib/part-docs/shrink-upload.ts`:**

```ts
// SERVER ONLY — Blob + sharp.
/**
 * #283 — a browser upload lands in Blob at full size (direct-to-Blob, the
 * bytes never pass through a function), so after verifyUploadedBlob accepts
 * it, the server reads the whole file, shrinks it (shrink.ts), stores the
 * WebP under the same document's path and deletes the original. A refusal
 * deletes the upload, like verifyUploadedBlob's own refusal path. A read
 * failure does NOT delete: that is "try again", not "bad file".
 */
import { deleteBlob, getBlobStream, putBlob } from "@/lib/blob";
import type { StoredFile } from "@/lib/stores/part-documents";
import { shrinkImage, webpFileName } from "./shrink";
import { partDocBlobPath } from "./types";

export type ShrinkUploadDeps = {
  read(pathname: string): Promise<Uint8Array | null>;
  put(pathname: string, bytes: Buffer, contentType: string): Promise<{ pathname: string }>;
  remove(pathname: string): Promise<void>;
};

async function readWhole(pathname: string): Promise<Uint8Array | null> {
  const stream = await getBlobStream(pathname);
  if (!stream) return null;
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const liveDeps: ShrinkUploadDeps = { read: readWhole, put: putBlob, remove: deleteBlob };

export async function shrinkStoredImage(
  documentId: string,
  file: StoredFile,
  deps: ShrinkUploadDeps = liveDeps
): Promise<{ ok: true; file: StoredFile } | { ok: false; error: string }> {
  const removeQuietly = async (pathname: string) => {
    try {
      await deps.remove(pathname);
    } catch {
      /* best effort — the outcome stands either way */
    }
  };
  let bytes: Uint8Array | null = null;
  try {
    bytes = await deps.read(file.blobKey);
  } catch {
    bytes = null;
  }
  if (!bytes) return { ok: false, error: "Couldn't read the uploaded file — try again" };
  const shrunk = await shrinkImage(bytes);
  if (!shrunk.ok) {
    await removeQuietly(file.blobKey);
    return shrunk;
  }
  const fileName = webpFileName(file.fileName);
  let stored: { pathname: string };
  try {
    stored = await deps.put(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType);
  } catch {
    await removeQuietly(file.blobKey);
    return { ok: false, error: "Could not store the file." };
  }
  await removeQuietly(file.blobKey);
  return { ok: true, file: { blobKey: stored.pathname, fileName, contentType: shrunk.contentType, size: shrunk.bytes.byteLength } };
}
```

- [ ] **Step 4: Wire it into the actions** in `src/app/(app)/catalog/documents/actions.ts`. Add
  `import { shrinkStoredImage } from "@/lib/part-docs/shrink-upload";` and
  `import { shrinkImage, webpFileName } from "@/lib/part-docs/shrink";`.

In `attachUploadedDocumentAction`, right after `if (!checked.ok) return checked;`:

```ts
  // #283 — images are stored shrunk (≤1600 px WebP); the full-size upload is deleted.
  let file = checked.file;
  if (input.kind === "image") {
    const shrunk = await shrinkStoredImage(input.documentId, file);
    if (!shrunk.ok) return shrunk;
    file = shrunk.file;
  }
```

…and change `...checked.file,` in its `createDocument` call to `...file,`.

In `replaceDocumentFileAction`, replace `await replaceDocumentFile(doc.id, checked.file, user.name);` with:

```ts
  let file = checked.file;
  if (doc.kind === "image") {
    const shrunk = await shrinkStoredImage(doc.id, file);
    if (!shrunk.ok) return shrunk;
    file = shrunk.file;
  }
  await replaceDocumentFile(doc.id, file, user.name);
```

In `addImageFromUrlAction`, right after the `if (!imageType) return …` line, shrink the fetched bytes and store the
WebP instead:

```ts
  const shrunk = await shrinkImage(got.file.bytes);
  if (!shrunk.ok) return { ok: false, error: shrunk.error };
  const documentId = newDocumentId();
  const fileName = webpFileName(fileNameForFetched(got.file.contentDisposition, got.file.finalUrl, "image", imageType === "image/png" ? "png" : imageType === "image/jpeg" ? "jpeg" : "webp"));
  let stored: { pathname: string };
  try {
    stored = await putBlob(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType);
  } catch {
    return { ok: false, error: "Could not store the file." };
  }
```

The existing `documentId`/`fileName`/`stored` declarations are replaced by these. In its `createDocument` call, set
`contentType: shrunk.contentType` and `size: shrunk.bytes.byteLength`. Update the function's doc comment: "…the
tighter 10 MB image cap…" → "…the 25 MB image cap, then shrunk to a ≤1600 px WebP (#283)…".

- [ ] **Step 5: Shrink the datasheet thumbnail** in `src/lib/part-docs/thumbnail.ts`. Import `shrinkImage` from
  `./shrink`. Replace the block that names and stores the PNG:

```ts
  // #283 — store the thumbnail as WebP like every other image; a shrink
  // failure (never expected for Chrome's own PNG) falls back to the PNG.
  const shrunk = await shrinkImage(png);
  const outBytes = shrunk.ok ? shrunk.bytes : png;
  const outType = shrunk.ok ? shrunk.contentType : "image/png";
  const newId = newDocumentId();
  const fileName = `${safeDocFileName(datasheet.title || "datasheet")}-thumb.${shrunk.ok ? "webp" : "png"}`;
  let stored: { pathname: string };
  try {
    stored = await putFile(partDocBlobPath(newId, fileName), outBytes, outType);
  } catch {
    return { ok: false, error: "Could not store the file." };
  }
```

…and in its `createDocument`, set `contentType: outType` and `size: outBytes.byteLength`. The existing #245 thumbnail
checks pass a tiny fake PNG. If it's not a real PNG, the fallback keeps them green. If a check asserts
`contentType === "image/png"`, update it to accept `image/webp` when the fake is a real PNG.

- [ ] **Step 6: Raise the cap and the hint.** In `types.ts`:
  `/** Image cap (#245; #283 raised 10 → 25 MB — images are shrunk on the way in, so this only bounds what's read into memory). */ export const MAX_PART_IMAGE_BYTES = 25 * 1024 * 1024;`.
  In `bulk-drop.tsx:148`, change the text to
  `PDF, DOC, DOCX, PNG, JPEG, WebP · up to 25 MB each · photos are shrunk to web size automatically`.

- [ ] **Step 7: Run the gates.** Run `npx tsc --noEmit -p .`, then `npm run test:specs 2>&1 | grep -E "FAIL|#283|ALL PASSED"`.
  Every `#283` line must PASS. For any older check that FAILs on the 10 MB → 25 MB cap or on PNG → WebP, update its
  expectation and say so in your report. Clean up the temp dirs. Run eslint on the changed files.

- [ ] **Step 8: Commit** `feat(catalog): images are shrunk at every entry point; image cap 25 MB (#283)`.

---

### Task 3: Drive read-only photo client

**Files:**
- Create: `src/lib/google/drive-photos.ts`
- Test: harness `drivePhotos283AsyncChecks` (fake `DriveFetch`, no network)

**Interfaces:**
- Consumes: `DRIVE_API_BASE`, `DRIVE_FOLDER_MIME`, `DriveApiError`, `driveQuote`, `type DriveFetch` from `./drive`.
- Produces:
  - `PHOTOS_FOLDER_NAME = "Peak Product Photos"`
  - `PHOTO_MIME_TYPES: readonly string[]`, `HEIC_MIME_TYPES: readonly string[]`
  - `type DriveFolderRef = { id: string; driveId: string | null; name: string; webViewLink: string }`
  - `type DriveListedPhoto = { id: string; name: string; mimeType: string; md5: string; size: number; webViewLink: string }`
  - `findPhotosFolder(token: string, f?: DriveFetch): Promise<{ ok: true; folder: DriveFolderRef } | { ok: false; error: string }>`
  - `getDriveFolder(token: string, id: string, f?: DriveFetch): Promise<DriveFolderRef | null>` (null = gone/trashed/not a folder)
  - `listPhotoTree(token: string, rootId: string, f?: DriveFetch): Promise<DriveListedPhoto[]>`
  - `downloadDriveFile(token: string, id: string, maxBytes: number, f?: DriveFetch): Promise<Uint8Array>`
  - `photosDriveError(status: number, what: string, detail: string): DriveApiError`

- [ ] **Step 1: Write the failing harness block:**

```ts
// ---------------------------------------------------------------------------
// #283 — Drive photo client: folder lookup, recursive listing, all-drives params.
// ---------------------------------------------------------------------------
import { findPhotosFolder as dp283Find, listPhotoTree as dp283List, getDriveFolder as dp283Get, downloadDriveFile as dp283Download } from "@/lib/google/drive-photos";
async function drivePhotos283AsyncChecks(): Promise<void> {
  const seen: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const folderHit = { id: "F1", name: "Peak Product Photos", driveId: "SD1", webViewLink: "https://drive/F1" };
  const one = async (url: string) => { seen.push(url); return json({ files: [folderHit] }); };
  const r1 = await dp283Find("tok", one);
  ok(r1.ok && r1.folder.id === "F1" && r1.folder.driveId === "SD1", "#283 drive: one folder named Peak Product Photos is found");
  ok(seen.some((u) => u.includes("corpora=allDrives") && u.includes("includeItemsFromAllDrives=true") && u.includes("supportsAllDrives=true")),
    "#283 drive: the folder search covers My Drive and Shared Drives");
  const none = await dp283Find("tok", async () => json({ files: [] }));
  ok(!none.ok && /No folder named Peak Product Photos/.test(none.error), "#283 drive: no folder → a clear message");
  const many = await dp283Find("tok", async () => json({ files: [folderHit, { ...folderHit, id: "F2", webViewLink: "https://drive/F2" }] }));
  ok(!many.ok && /Found 2 folders named Peak Product Photos/.test(many.error) && many.error.includes("https://drive/F2"), "#283 drive: several folders → rename the extras, with links");

  // Tree: F1 → (a.jpg, Sub [page 1: b.png, page 2: c.heic + doc], F1 again via a second parent)
  const pages: Record<string, unknown> = {
    "F1|": { files: [
      { id: "a", name: "S4LED-S3.jpg", mimeType: "image/jpeg", md5Checksum: "m-a", size: "1000", webViewLink: "https://drive/a" },
      { id: "SUB", name: "ETC", mimeType: "application/vnd.google-apps.folder" },
      { id: "F1", name: "loop", mimeType: "application/vnd.google-apps.folder" },
    ] },
    "SUB|": { files: [{ id: "b", name: "x.png", mimeType: "image/png", md5Checksum: "m-b", size: "20", webViewLink: "https://drive/b" }], nextPageToken: "P2" },
    "SUB|P2": { files: [
      { id: "c", name: "y.heic", mimeType: "image/heic", md5Checksum: "m-c", size: "30", webViewLink: "https://drive/c" },
      { id: "d", name: "notes", mimeType: "application/vnd.google-apps.document" },
    ] },
  };
  const tree = async (url: string) => {
    const u = new URL(url);
    const q = u.searchParams.get("q") || "";
    const parent = (q.match(/'([^']+)' in parents/) || [])[1] || "";
    return json(pages[`${parent}|${u.searchParams.get("pageToken") || ""}`] ?? { files: [] });
  };
  const listed = await dp283List("tok", "F1", tree);
  ok(listed.map((p) => p.id).sort().join(",") === "a,b,c", "#283 drive: photos are listed recursively across pages; docs ignored; a repeated folder is walked once");
  ok(listed.find((p) => p.id === "a")?.size === 1000 && listed.find((p) => p.id === "a")?.md5 === "m-a", "#283 drive: size and md5 come through");

  const gone = await dp283Get("tok", "F9", async () => json({ error: { message: "nf" } }, 404));
  const trashed = await dp283Get("tok", "F1", async () => json({ ...folderHit, mimeType: "application/vnd.google-apps.folder", trashed: true }));
  ok(gone === null && trashed === null, "#283 drive: a vanished or trashed folder reads as null");

  const bytes = await dp283Download("tok", "a", 10, async () => new Response(new Uint8Array([1, 2, 3])));
  ok(bytes.byteLength === 3, "#283 drive: download returns the bytes");
  let tooBig = false;
  try { await dp283Download("tok", "a", 2, async () => new Response(new Uint8Array([1, 2, 3]))); } catch { tooBig = true; }
  ok(tooBig, "#283 drive: a download over the cap throws");
  let denied = "";
  try { await dp283List("tok", "F1", async () => json({ error: { message: "insufficient" } }, 403)); } catch (e) { denied = (e as Error).message; }
  ok(/Enable Drive photos/.test(denied), "#283 drive: a 403 tells the admin to use Enable Drive photos");
}
```

Chain `.then(() => drivePhotos283AsyncChecks())`.

- [ ] **Step 2: Run it and watch it fail** (module not found).

- [ ] **Step 3: Implement `src/lib/google/drive-photos.ts`:**

```ts
// SERVER ONLY — Google Drive v3 REST, read-only (#283).
/**
 * The Peak Product Photos folder, read with drive.readonly. Only reads are
 * made: find the folder, walk its tree, download a file. Every call passes
 * supportsAllDrives (the folder may live in a Shared Drive); list calls also
 * pass includeItemsFromAllDrives + corpora=allDrives. `f` is the test seam.
 */
import { DRIVE_API_BASE, DRIVE_FOLDER_MIME, DriveApiError, driveQuote, type DriveFetch } from "./drive";

export const PHOTOS_FOLDER_NAME = "Peak Product Photos";
export const PHOTO_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
export const HEIC_MIME_TYPES: readonly string[] = ["image/heic", "image/heif"];
const LIST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** A runaway tree (or a shortcut loop Drive somehow allows) stops here. */
const MAX_FOLDERS = 500;

export type DriveFolderRef = { id: string; driveId: string | null; name: string; webViewLink: string };
export type DriveListedPhoto = { id: string; name: string; mimeType: string; md5: string; size: number; webViewLink: string };

const realFetch: DriveFetch = (url, init) => fetch(url, init);

export function photosDriveError(status: number, what: string, detail: string): DriveApiError {
  if (status === 401) return new DriveApiError(401, `Google rejected the photos account's token (401) while ${what} — reconnect it in Settings → Mailboxes with "Enable Drive photos".`);
  if (status === 403) return new DriveApiError(403, `The photos account can't read Drive (403) while ${what} — use "Enable Drive photos" on it in Settings → Mailboxes.` + (detail ? ` Google said: ${detail}` : ""));
  if (status === 404) return new DriveApiError(404, `Not found in Drive (404) while ${what}.`);
  if (status === 429) return new DriveApiError(429, `Drive is rate-limiting (429) while ${what} — the rest will sync next time.`);
  return new DriveApiError(status, `Drive API ${status} while ${what}${detail ? `: ${detail}` : ""}`);
}

async function detailOf(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j?.error?.message || "";
  } catch {
    return "";
  }
}

async function getJson<T>(f: DriveFetch, token: string, url: string, what: string): Promise<T> {
  const res = await f(url, { method: "GET", signal: AbortSignal.timeout(LIST_TIMEOUT_MS), headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (!res.ok) throw photosDriveError(res.status, what, await detailOf(res));
  return (await res.json()) as T;
}

function listUrl(params: Record<string, string>): string {
  const u = new URL(`${DRIVE_API_BASE}/files`);
  for (const [k, v] of Object.entries({ ...params, corpora: "allDrives", includeItemsFromAllDrives: "true", supportsAllDrives: "true" })) u.searchParams.set(k, v);
  return u.toString();
}

type RawFile = { id: string; name?: string; mimeType?: string; md5Checksum?: string; size?: string; webViewLink?: string; driveId?: string; trashed?: boolean };

export async function findPhotosFolder(token: string, f: DriveFetch = realFetch): Promise<{ ok: true; folder: DriveFolderRef } | { ok: false; error: string }> {
  const q = `name = ${driveQuote(PHOTOS_FOLDER_NAME)} and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`;
  const j = await getJson<{ files?: RawFile[] }>(f, token, listUrl({ q, fields: "files(id,name,driveId,webViewLink)", pageSize: "10" }), "looking for the Peak Product Photos folder");
  const hits = j.files || [];
  if (!hits.length) return { ok: false, error: `No folder named ${PHOTOS_FOLDER_NAME} was found in that account's Drive.` };
  if (hits.length > 1) {
    return { ok: false, error: `Found ${hits.length} folders named ${PHOTOS_FOLDER_NAME} — rename the extras: ${hits.map((h) => h.webViewLink || h.id).join(", ")}` };
  }
  const h = hits[0];
  return { ok: true, folder: { id: h.id, driveId: h.driveId ?? null, name: h.name || PHOTOS_FOLDER_NAME, webViewLink: h.webViewLink || "" } };
}

export async function getDriveFolder(token: string, id: string, f: DriveFetch = realFetch): Promise<DriveFolderRef | null> {
  const u = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("fields", "id,name,driveId,webViewLink,trashed,mimeType");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await f(u.toString(), { method: "GET", signal: AbortSignal.timeout(LIST_TIMEOUT_MS), headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw photosDriveError(res.status, "checking the photos folder", await detailOf(res));
  const h = (await res.json()) as RawFile;
  if (h.trashed || h.mimeType !== DRIVE_FOLDER_MIME) return null;
  return { id: h.id, driveId: h.driveId ?? null, name: h.name || PHOTOS_FOLDER_NAME, webViewLink: h.webViewLink || "" };
}

export async function listPhotoTree(token: string, rootId: string, f: DriveFetch = realFetch): Promise<DriveListedPhoto[]> {
  const out = new Map<string, DriveListedPhoto>();
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length && visited.size < MAX_FOLDERS) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    let pageToken = "";
    do {
      const params: Record<string, string> = {
        q: `${driveQuote(folderId)} in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,md5Checksum,size,webViewLink)",
        pageSize: "1000",
      };
      if (pageToken) params.pageToken = pageToken;
      const j = await getJson<{ files?: RawFile[]; nextPageToken?: string }>(f, token, listUrl(params), "listing the photos folder");
      for (const file of j.files || []) {
        if (file.mimeType === DRIVE_FOLDER_MIME) {
          if (!visited.has(file.id)) queue.push(file.id);
          continue;
        }
        if (!file.mimeType || !PHOTO_MIME_TYPES.includes(file.mimeType)) continue;
        out.set(file.id, {
          id: file.id,
          name: file.name || file.id,
          mimeType: file.mimeType,
          md5: file.md5Checksum || "",
          size: Number(file.size || 0),
          webViewLink: file.webViewLink || "",
        });
      }
      pageToken = j.nextPageToken || "";
    } while (pageToken);
  }
  return [...out.values()];
}

export async function downloadDriveFile(token: string, id: string, maxBytes: number, f: DriveFetch = realFetch): Promise<Uint8Array> {
  const u = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("alt", "media");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await f(u.toString(), { method: "GET", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw photosDriveError(res.status, "downloading a photo", await detailOf(res));
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("over the size cap");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("over the size cap");
  return bytes;
}
```

Check `DriveApiError`'s constructor signature in `drive.ts` (`new DriveApiError(status, message)`) and match it. If
`driveQuote` isn't exported, export it (it is, at L99).

- [ ] **Step 4: Run the checks** (all `#283 drive` lines PASS). Clean up temp dirs, then tsc and eslint.
- [ ] **Step 5: Commit** `feat(google): read-only Drive client for the Peak Product Photos folder (#283)`.

---

### Task 4: Pure sync planner

**Files:**
- Create: `src/lib/part-docs/drive-photo-plan.ts` (pure, no imports from stores/blob/sharp)
- Test: harness pure block `drivePhotoPlan283` (a bare `{ … }` block, not async)

**Interfaces:**
- Consumes: `type DriveListedPhoto` from `@/lib/google/drive-photos`. Import it with `import type` so this file stays pure.
- Produces:

```ts
export type DrivePhotoFileState = { md5: string; documentId: string | null; skus: string[]; error?: string; at: number };
export type PhotoMatch = { confidence: "high" | "ambiguous" | "none"; skus: string[] };
export type UnmatchedPhoto = { fileId: string; name: string; webViewLink: string; reason: string };
export type PlannedImport = DriveListedPhoto & { skus: string[] };
export type PlannedUpdate = DriveListedPhoto & { skus: string[]; documentId: string; add: string[]; remove: string[] };
export type PlannedRelink = { fileId: string; md5: string; documentId: string; skus: string[]; add: string[]; remove: string[] };
export type DrivePhotoPlan = { imports: PlannedImport[]; updates: PlannedUpdate[]; relinks: PlannedRelink[]; unmatched: UnmatchedPhoto[]; retryLater: number; unchanged: number };
export function planDrivePhotoSync(listing: readonly DriveListedPhoto[], files: Readonly<Record<string, DrivePhotoFileState>>, matchOf: (name: string) => PhotoMatch, maxBytes: number): DrivePhotoPlan;
```

- [ ] **Step 1: Write the failing harness block:**

```ts
// ---------------------------------------------------------------------------
// #283 — Drive photo sync planner (pure).
// ---------------------------------------------------------------------------
import { planDrivePhotoSync as pp283 } from "@/lib/part-docs/drive-photo-plan";
{
  const photo = (id: string, name: string, md5 = "m-" + id, extra: Partial<{ mimeType: string; size: number }> = {}) =>
    ({ id, name, mimeType: extra.mimeType ?? "image/jpeg", md5, size: extra.size ?? 100, webViewLink: "https://drive/" + id });
  const match = (name: string) =>
    name.startsWith("AMB") ? { confidence: "ambiguous" as const, skus: ["P1", "P2"] }
    : name.startsWith("NONE") ? { confidence: "none" as const, skus: [] }
    : { confidence: "high" as const, skus: name.startsWith("TWO") ? ["P1", "P2"] : ["P1"] };
  const at = 1;
  const plan = pp283(
    [
      photo("new", "S4.jpg"),
      photo("same", "S4.jpg", "m-same"),
      photo("changed", "S4.jpg", "m-new"),
      photo("renamed", "TWO.jpg", "m-renamed"),
      photo("failed", "S4.jpg", "m-failed"),
      photo("failedChanged", "S4.jpg", "m-fixed"),
      photo("amb", "AMB.jpg"),
      photo("none", "NONE.jpg"),
      photo("heic", "S4.heic", "m-h", { mimeType: "image/heic" }),
      photo("big", "S4.jpg", "m-big", { size: 999 }),
      photo("knownNowNone", "NONE-renamed.jpg", "m-k"),
      photo("new", "S4.jpg"),
    ],
    {
      same: { md5: "m-same", documentId: "PD-1", skus: ["P1"], at },
      changed: { md5: "m-old", documentId: "PD-2", skus: ["P1", "P9"], at },
      renamed: { md5: "m-renamed", documentId: "PD-3", skus: ["P1"], at },
      failed: { md5: "m-failed", documentId: null, skus: [], error: "bad", at },
      failedChanged: { md5: "m-broken", documentId: null, skus: [], error: "bad", at },
      knownNowNone: { md5: "m-k", documentId: "PD-4", skus: ["P7"], at },
    },
    match,
    500
  );
  ok(plan.imports.map((p) => p.id).sort().join(",") === "failedChanged,new", "#283 plan: new files (and a failed file that changed) import, a listing duplicate once");
  ok(plan.updates.length === 1 && plan.updates[0].id === "changed" && plan.updates[0].documentId === "PD-2" && plan.updates[0].remove.join() === "P9",
    "#283 plan: a changed file updates its document and drops parts it no longer matches");
  ok(plan.relinks.length === 1 && plan.relinks[0].fileId === "renamed" && plan.relinks[0].add.join() === "P2" && plan.relinks[0].remove.length === 0,
    "#283 plan: a renamed-but-unchanged file relinks");
  ok(plan.retryLater === 1 && plan.unchanged === 1, "#283 plan: a failed unchanged file waits; an unchanged file is skipped");
  const reasons = Object.fromEntries(plan.unmatched.map((u) => [u.fileId, u.reason]));
  ok(/several parts: P1, P2/.test(reasons.amb) && /no part number/.test(reasons.none), "#283 plan: ambiguous and no-match files are listed with reasons");
  ok(/HEIC/.test(reasons.heic) && /over 25 MB/.test(reasons.big), "#283 plan: HEIC and over-cap files are listed, not imported");
  ok(!!reasons.knownNowNone && !plan.relinks.some((r) => r.fileId === "knownNowNone") && !plan.updates.some((u) => u.id === "knownNowNone"),
    "#283 plan: a known file renamed to something unmatched is only listed — its links stay");
}
```

The "over 25 MB" reason text comes from `Math.round(maxBytes / 1048576)`. The test passes `maxBytes = 500`, so to keep the
check meaningful, word the reason as `over 25 MB — export a smaller copy` using a constant
`OVER_CAP_REASON = "over 25 MB — export a smaller copy"`. The cap is fixed by the Global Constraints.

- [ ] **Step 2: Run it and watch it fail** (module not found).

- [ ] **Step 3: Implement `src/lib/part-docs/drive-photo-plan.ts`:**

```ts
/**
 * #283 — what one Drive photo sync should do, decided purely from the
 * folder listing, the remembered per-file state and a name → parts matcher
 * (the Upload-many filename rule). The executor (drive-photo-sync.ts) only
 * carries the plan out. Per file, first rule wins:
 *  1. HEIC / over the cap / ambiguous / no match → unmatched (listed with a
 *     reason). A KNOWN file that is now unmatched keeps its document and
 *     links untouched — it is only listed.
 *  2. Same md5 as last time and a recorded error → retry later (a broken
 *     file isn't re-downloaded every run; changing it in Drive retries).
 *  3. Never seen, or seen but never imported → import.
 *  4. md5 changed and it has a document → update (replace the file) +
 *     re-point its parts to the current match.
 *  5. md5 same, matched parts changed (renamed) → relink.
 *  6. Otherwise unchanged.
 * A file listed twice (two parent folders) is planned once.
 */
import type { DriveListedPhoto } from "@/lib/google/drive-photos";

export type DrivePhotoFileState = { md5: string; documentId: string | null; skus: string[]; error?: string; at: number };
export type PhotoMatch = { confidence: "high" | "ambiguous" | "none"; skus: string[] };
export type UnmatchedPhoto = { fileId: string; name: string; webViewLink: string; reason: string };
export type PlannedImport = DriveListedPhoto & { skus: string[] };
export type PlannedUpdate = DriveListedPhoto & { skus: string[]; documentId: string; add: string[]; remove: string[] };
export type PlannedRelink = { fileId: string; md5: string; documentId: string; skus: string[]; add: string[]; remove: string[] };
export type DrivePhotoPlan = {
  imports: PlannedImport[];
  updates: PlannedUpdate[];
  relinks: PlannedRelink[];
  unmatched: UnmatchedPhoto[];
  retryLater: number;
  unchanged: number;
};

export const HEIC_REASON = "HEIC — save it as JPEG (iPhone: Settings → Camera → Formats → Most Compatible)";
export const OVER_CAP_REASON = "over 25 MB — export a smaller copy";
export const NO_MATCH_REASON = "no part number found in the name";
const HEIC = new Set(["image/heic", "image/heif"]);

function diff(next: readonly string[], prev: readonly string[]): { add: string[]; remove: string[] } {
  const p = new Set(prev);
  const n = new Set(next);
  return { add: next.filter((s) => !p.has(s)), remove: prev.filter((s) => !n.has(s)) };
}

export function planDrivePhotoSync(
  listing: readonly DriveListedPhoto[],
  files: Readonly<Record<string, DrivePhotoFileState>>,
  matchOf: (name: string) => PhotoMatch,
  maxBytes: number
): DrivePhotoPlan {
  const plan: DrivePhotoPlan = { imports: [], updates: [], relinks: [], unmatched: [], retryLater: 0, unchanged: 0 };
  const seen = new Set<string>();
  const sorted = [...listing].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const photo of sorted) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    const unmatched = (reason: string) => plan.unmatched.push({ fileId: photo.id, name: photo.name, webViewLink: photo.webViewLink, reason });
    if (HEIC.has(photo.mimeType)) { unmatched(HEIC_REASON); continue; }
    if (photo.size > maxBytes) { unmatched(OVER_CAP_REASON); continue; }
    const m = matchOf(photo.name);
    if (m.confidence === "ambiguous") { unmatched(`matches several parts: ${m.skus.slice(0, 5).join(", ")}${m.skus.length > 5 ? ", …" : ""}`); continue; }
    if (m.confidence !== "high" || !m.skus.length) { unmatched(NO_MATCH_REASON); continue; }

    const prev = files[photo.id];
    if (prev && prev.md5 === photo.md5 && prev.error) { plan.retryLater++; continue; }
    if (!prev || !prev.documentId) { plan.imports.push({ ...photo, skus: [...m.skus] }); continue; }
    const d = diff(m.skus, prev.skus);
    if (prev.md5 !== photo.md5) { plan.updates.push({ ...photo, skus: [...m.skus], documentId: prev.documentId, ...d }); continue; }
    if (d.add.length || d.remove.length) {
      plan.relinks.push({ fileId: photo.id, md5: photo.md5, documentId: prev.documentId, skus: [...m.skus], ...d });
      continue;
    }
    plan.unchanged++;
  }
  return plan;
}
```

- [ ] **Step 4: Run the checks** (all `#283 plan` lines PASS). Clean up temp dirs; run tsc and eslint.
- [ ] **Step 5: Commit** `feat(catalog): pure Drive photo sync planner (#283)`.

---

### Task 5: Drive photo source + state + sync executor

**Files:**
- Modify:
  - `src/lib/part-docs/types.ts:49`: `PartDocumentSource` += `"drive"`; `IMAGE_SOURCE_RANK` += `drive: 0`, with its doc comment
    updated ("upload/drive, fetch, …").
  - `src/app/(app)/catalog/part-documents-section.tsx:17`: `IMAGE_SOURCE_LABEL` += `drive: "Drive"`.
  - `src/lib/settings.ts` (`AppSettingsData`): `catalogPhotosMailbox: string | null;`, documented as "#283 — connection key of the
    mailbox whose Google account can read the Peak Product Photos folder (drive.readonly); null = not set".
  - `src/db/seed-data.ts:56` area: default `catalogPhotosMailbox: null,`.
  - `src/lib/gmail/config.ts`: `DRIVE_READONLY_SCOPE` + `hasDriveReadScope`.
- Create: `src/lib/part-docs/drive-photo-sync.ts`
- Test: harness `drivePhotoSync283AsyncChecks` (PGlite, fakes)

**Interfaces:**
- Consumes: Task 1 `shrinkImage`/`webpFileName`; Task 3 client functions + types; Task 4 planner + types;
  `matchFileRows` from `./filename-match`; `listCatalog` (`list` from `@/lib/stores/catalog`);
  `createDocument`/`replaceDocumentFile`/`attachDocument`/`detachDocument` from `@/lib/stores/part-documents`;
  `getBlob`/`setBlob` from `@/db/doc-store`; `getSettings`/`setSettings` from `@/lib/settings`;
  `getConnectionInfo`/`accessTokenFor` from `@/lib/gmail/connections`; `putBlob`/`blobEnabled` from `@/lib/blob`;
  `invalidatePortalIndex` from `@/lib/portal-catalog-index`; `newDocumentId`/`partDocBlobPath`/`MAX_PART_IMAGE_BYTES`
  from `./types`.
- Produces:

```ts
export const DRIVE_PHOTO_SYNC_BLOB = "drive_photo_sync";
export type DrivePhotoLastRun = { at: number; imported: number; updated: number; relinked: number; failed: number; unmatched: UnmatchedPhoto[]; complete: boolean; error?: string };
export type DrivePhotoSyncState = { folder: DriveFolderRef | null; files: Record<string, DrivePhotoFileState>; lastRun: DrivePhotoLastRun | null };
export async function getDrivePhotoSyncState(): Promise<DrivePhotoSyncState>;
export type DrivePhotoSyncDeps = { token?: string; fetch?: DriveFetch; putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>; now?: () => number };
export type DrivePhotoSyncResult =
  | { ok: true; imported: number; updated: number; relinked: number; failed: number; unmatched: number; remaining: number; changed: boolean }
  | { ok: false; error: string };
export async function syncDrivePhotos(budgetMs: number, deps?: DrivePhotoSyncDeps): Promise<DrivePhotoSyncResult>;
export async function saveCatalogPhotosMailbox(mailboxKey: string | null): Promise<{ ok: true } | { ok: false; error: string }>;
// config.ts
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export function hasDriveReadScope(scope: string | null | undefined): boolean;
```

- [ ] **Step 1: Add the source, label, scope and setting** (the type-level edits listed above). In `config.ts`, next to
  `DRIVE_SCOPE`:

```ts
/** #283 — read-only Drive for the Peak Product Photos sync. drive.file
 *  (above) only sees files the app itself created, so it can't read a
 *  folder people fill by hand. Opt-in per mailbox via ?drivephotos=1. */
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Does a stored grant include drive.readonly? */
export function hasDriveReadScope(scope: string | null | undefined): boolean {
  return (scope || "").split(/\s+/).includes(DRIVE_READONLY_SCOPE);
}
```

Run `npx tsc --noEmit -p .` and fix every exhaustive `Record<PartDocumentSource, …>` it flags. The known ones are
`IMAGE_SOURCE_RANK` and `IMAGE_SOURCE_LABEL`; add `drive` to any others tsc finds.

- [ ] **Step 2: Write the failing harness block.** This one is DB-backed. It needs real catalog parts, so look at how
  `portal245ThumbnailsAsyncChecks` (~L29615) seeds parts with `registerFixture` and copy that. Then:

```ts
// ---------------------------------------------------------------------------
// #283 — Drive photo sync executor (PGlite + fake Drive + fake Blob).
// ---------------------------------------------------------------------------
import { syncDrivePhotos as ds283Sync, getDrivePhotoSyncState as ds283State, saveCatalogPhotosMailbox as ds283SaveMailbox, DRIVE_PHOTO_SYNC_BLOB as ds283Blob } from "@/lib/part-docs/drive-photo-sync";
import { hasDriveReadScope as ds283HasRead } from "@/lib/gmail/config";
async function drivePhotoSync283AsyncChecks(): Promise<void> {
  // Seed two parts whose SKUs match file names: "T283-ALPHA" and "T283-BRAVO" (category "Lighting"),
  // plus a Labor part "T283-LABOR" — using the same part-upsert + registerFixture pattern as the #245 block.
  // ...seed code copied from portal245ThumbnailsAsyncChecks, adjusted to these SKUs...
  const jpeg = await s283Sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#0a0" } }).jpeg().toBuffer();
  let files: Array<Record<string, unknown>> = [
    { id: "dA", name: "T283-ALPHA front.jpg", mimeType: "image/jpeg", md5Checksum: "m1", size: String(jpeg.byteLength), webViewLink: "https://drive/dA" },
    { id: "dL", name: "T283-LABOR.jpg", mimeType: "image/jpeg", md5Checksum: "mL", size: String(jpeg.byteLength), webViewLink: "https://drive/dL" },
    { id: "dX", name: "random.jpg", mimeType: "image/jpeg", md5Checksum: "mX", size: "10", webViewLink: "https://drive/dX" },
  ];
  let mediaBytes: Uint8Array = jpeg;
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  const fakeDrive = async (url: string) => {
    const u = new URL(url);
    if (u.searchParams.get("alt") === "media") return new Response(mediaBytes);
    const q = u.searchParams.get("q") || "";
    if (q.startsWith("name =")) return json({ files: [{ id: "ROOT", name: "Peak Product Photos", webViewLink: "https://drive/ROOT" }] });
    if (u.pathname.endsWith("/files/ROOT")) return json({ id: "ROOT", name: "Peak Product Photos", mimeType: "application/vnd.google-apps.folder", webViewLink: "https://drive/ROOT" });
    return json({ files });
  };
  const stored: string[] = [];
  const deps = { token: "tok", fetch: fakeDrive, putFile: async (p: string) => { stored.push(p); return { pathname: p }; }, now: () => 1_700_000_000_000 };
  try {
    const r1 = await ds283Sync(45_000, deps);
    const st1 = await ds283State();
    ok(r1.ok && r1.imported === 1 && r1.unmatched === 2, "#283 sync: a matched photo imports; Labor and nameless files are listed");
    ok(!!st1.folder && st1.folder.id === "ROOT" && st1.files.dA?.documentId != null, "#283 sync: the folder and the imported file are remembered");
    const docId = st1.files.dA!.documentId!;
    // read the document + links via the part-documents store (getDocument / linked images for T283-ALPHA)
    // ok(doc.kind === "image" && doc.source === "drive" && doc.sourceRef === "dA" && doc.contentType === "image/webp", "#283 sync: the image document is a shrunk Drive-sourced WebP");
    // ok(links for T283-ALPHA include docId, "#283 sync: it is linked to the matched part");

    const r2 = await ds283Sync(45_000, deps);
    ok(r2.ok && r2.imported === 0 && r2.updated === 0 && r2.relinked === 0 && stored.length === 1, "#283 sync: a second run with nothing changed does nothing");

    files = files.map((f) => (f.id === "dA" ? { ...f, md5Checksum: "m2" } : f));
    const r3 = await ds283Sync(45_000, deps);
    ok(r3.ok && r3.updated === 1 && (await ds283State()).files.dA.documentId === docId, "#283 sync: a changed photo replaces the same document's file");

    files = files.map((f) => (f.id === "dA" ? { ...f, name: "T283-BRAVO.jpg" } : f));
    const r4 = await ds283Sync(45_000, deps);
    ok(r4.ok && r4.relinked === 1 && (await ds283State()).files.dA.skus.join() === "T283-BRAVO", "#283 sync: a renamed photo moves to the newly matched part");

    files = [...files, { id: "dBad", name: "T283-ALPHA back.jpg", mimeType: "image/jpeg", md5Checksum: "mb", size: "8", webViewLink: "https://drive/dBad" }];
    mediaBytes = new Uint8Array(Buffer.from("not an image"));
    const r5 = await ds283Sync(45_000, deps);
    const r6 = await ds283Sync(45_000, deps);
    ok(r5.ok && r5.failed === 1 && r6.ok && r6.failed === 0, "#283 sync: a broken file fails once and isn't retried until it changes");
    mediaBytes = jpeg;

    const tight = await ds283Sync(0, { ...deps });
    ok(tight.ok, "#283 sync: a zero budget still answers");

    ok((await ds283SaveMailbox("nope@example.com")).ok === false, "#283 settings: an unknown mailbox can't be the photos account");
    ok(ds283HasRead("a https://www.googleapis.com/auth/drive.readonly b") && !ds283HasRead("https://www.googleapis.com/auth/drive.file"),
      "#283 scope: drive.readonly is detected, drive.file is not");
  } finally {
    // registerFixture the created part_documents / links (or delete the docs) and reset the blob:
    // await setBlob(ds283Blob, { folder: null, files: {}, lastRun: null });
  }
}
```

The implementer completes the four commented spots:
- **seed**: copy the #245 seed pattern.
- **document asserts**: `getDocument` from `@/lib/stores/part-documents` plus `linkedDocumentsForParts(["T283-ALPHA"], "image")`.
- **teardown**: `registerFixture("part_documents", docId)` for every created document id. Created ids are in
  `(await ds283State()).files`. Also delete their links, using the same approach #245 uses, and reset the
  `drive_photo_sync` blob to empty.

Leave no `//` placeholder lines. Every one of these checks must be live. Chain the suite.

- [ ] **Step 3: Run it and watch it fail** (module not found).

- [ ] **Step 4: Implement `src/lib/part-docs/drive-photo-sync.ts`:**

```ts
// SERVER ONLY — Drive (read-only) → Blob → part_documents (#283).
/**
 * One Peak Product Photos sync call (spec Part 2): resolve the account's
 * token, find (or re-find) the folder, list the tree, plan
 * (drive-photo-plan.ts), apply relinks, then download → shrink → store →
 * record each import/update under the wall-clock budget. State (folder,
 * per-file md5/document/parts, last run) is one settings blob, saved after
 * every file so a killed function loses nothing. Never writes to Drive.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { blobEnabled, putBlob } from "@/lib/blob";
import { hasDriveReadScope } from "@/lib/gmail/config";
import { accessTokenFor, getConnectionInfo } from "@/lib/gmail/connections";
import { DriveApiError, type DriveFetch } from "@/lib/google/drive";
import { downloadDriveFile, findPhotosFolder, getDriveFolder, listPhotoTree, type DriveFolderRef } from "@/lib/google/drive-photos";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { getSettings, setSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { attachDocument, createDocument, detachDocument, replaceDocumentFile } from "@/lib/stores/part-documents";
import { planDrivePhotoSync, type DrivePhotoFileState, type PhotoMatch, type UnmatchedPhoto } from "./drive-photo-plan";
import { matchFileRows } from "./filename-match";
import { shrinkImage, webpFileName } from "./shrink";
import { MAX_PART_IMAGE_BYTES, newDocumentId, partDocBlobPath } from "./types";

export const DRIVE_PHOTO_SYNC_BLOB = "drive_photo_sync";
const SYNC_BY = "Drive photos sync";
/** A download + shrink + store rarely takes more than a few seconds; don't
 *  START another one with less than this left (the first always runs). */
const PER_FILE_WORST_MS = 12_000;

export type DrivePhotoLastRun = { at: number; imported: number; updated: number; relinked: number; failed: number; unmatched: UnmatchedPhoto[]; complete: boolean; error?: string };
export type DrivePhotoSyncState = { folder: DriveFolderRef | null; files: Record<string, DrivePhotoFileState>; lastRun: DrivePhotoLastRun | null };
export type DrivePhotoSyncDeps = {
  token?: string;
  fetch?: DriveFetch;
  putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
  now?: () => number;
};
export type DrivePhotoSyncResult =
  | { ok: true; imported: number; updated: number; relinked: number; failed: number; unmatched: number; remaining: number; changed: boolean }
  | { ok: false; error: string };

export async function getDrivePhotoSyncState(): Promise<DrivePhotoSyncState> {
  const raw = await getBlob<Record<string, unknown>>(DRIVE_PHOTO_SYNC_BLOB, {});
  return {
    folder: (raw.folder as DriveFolderRef | null) ?? null,
    files: (raw.files as Record<string, DrivePhotoFileState>) ?? {},
    lastRun: (raw.lastRun as DrivePhotoLastRun | null) ?? null,
  };
}

async function saveState(state: DrivePhotoSyncState): Promise<void> {
  await setBlob(DRIVE_PHOTO_SYNC_BLOB, { folder: state.folder, files: state.files, lastRun: state.lastRun });
}

/** Settings → Mailboxes picker save (the action wraps this with requirePerm).
 *  The key must be a connected mailbox; the scope may be granted after.
 *  Changing the account forgets the remembered folder (another Drive). */
export async function saveCatalogPhotosMailbox(mailboxKey: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = (mailboxKey || "").trim() || null;
  if (clean && !(await getConnectionInfo(clean))) return { ok: false, error: "That mailbox isn't connected." };
  const current = await getSettings();
  await setSettings({ catalogPhotosMailbox: clean });
  if (clean !== (current.catalogPhotosMailbox ?? null)) await setBlob(DRIVE_PHOTO_SYNC_BLOB, { folder: null });
  return { ok: true };
}

async function resolveToken(): Promise<{ token: string } | { error: string }> {
  const key = (await getSettings()).catalogPhotosMailbox ?? null;
  if (!key) return { error: "No Drive photos account is set — pick one in Settings → Mailboxes." };
  const info = await getConnectionInfo(key);
  if (!info) return { error: "The Drive photos account isn't connected any more — reconnect it in Settings → Mailboxes." };
  if (!hasDriveReadScope(info.scope)) return { error: `${info.address} needs Drive photo access — use "Enable Drive photos" on it in Settings → Mailboxes.` };
  const token = await accessTokenFor(key);
  return token ? { token } : { error: `Couldn't get a Google token for ${info.address} — reconnect it in Settings → Mailboxes.` };
}

/** Errors that end the whole call (auth / rate limit / Google down) — the
 *  rest are per-file. */
function isFatal(e: unknown): boolean {
  return e instanceof DriveApiError && (e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500);
}

export async function syncDrivePhotos(budgetMs: number, deps: DrivePhotoSyncDeps = {}): Promise<DrivePhotoSyncResult> {
  const now = deps.now ?? Date.now;
  const deadline = Date.now() + Math.max(0, budgetMs);
  const f = deps.fetch;
  const put = deps.putFile ?? putBlob;
  if (!deps.putFile && !blobEnabled()) return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — photos can't be stored on this deployment." };

  const state = await getDrivePhotoSyncState();
  const fail = async (error: string): Promise<DrivePhotoSyncResult> => {
    state.lastRun = { at: now(), imported: 0, updated: 0, relinked: 0, failed: 0, unmatched: state.lastRun?.unmatched ?? [], complete: false, error };
    await saveState(state);
    return { ok: false, error };
  };

  let token = deps.token;
  if (!token) {
    const t = await resolveToken();
    if ("error" in t) return fail(t.error);
    token = t.token;
  }

  let listing;
  try {
    if (state.folder) state.folder = await getDriveFolder(token, state.folder.id, f);
    if (!state.folder) {
      const found = await findPhotosFolder(token, f);
      if (!found.ok) return fail(found.error);
      state.folder = found.folder;
    }
    listing = await listPhotoTree(token, state.folder.id, f);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't read the Drive folder.");
  }

  const parts = (await listCatalog()).filter((p) => p.category !== "Labor");
  const names = [...new Set(listing.map((p) => p.name))];
  const matchByName = new Map<string, PhotoMatch>(matchFileRows(names, parts).map((r) => [r.fileName, { confidence: r.confidence, skus: r.skus }]));
  const plan = planDrivePhotoSync(listing, state.files, (name) => matchByName.get(name) ?? { confidence: "none", skus: [] }, MAX_PART_IMAGE_BYTES);

  let relinked = 0;
  for (const r of plan.relinks) {
    if (r.add.length) await attachDocument(r.documentId, r.add, SYNC_BY);
    for (const sku of r.remove) await detachDocument(r.documentId, sku);
    state.files[r.fileId] = { md5: r.md5, documentId: r.documentId, skus: r.skus, at: now() };
    relinked++;
  }
  if (relinked) await saveState(state);

  const work = [...plan.updates.map((u) => ({ kind: "update" as const, ...u })), ...plan.imports.map((i) => ({ kind: "import" as const, ...i }))];
  let imported = 0, updated = 0, failed = 0, processed = 0, stopError = "";
  for (const item of work) {
    if (processed > 0 && deadline - Date.now() < PER_FILE_WORST_MS) break;
    processed++;
    const prev = state.files[item.id];
    const recordError = (error: string) => {
      state.files[item.id] = { md5: item.md5, documentId: prev?.documentId ?? null, skus: prev?.skus ?? [], error, at: now() };
      failed++;
    };
    try {
      const bytes = await downloadDriveFile(token, item.id, MAX_PART_IMAGE_BYTES, f);
      const shrunk = await shrinkImage(bytes);
      if (!shrunk.ok) { recordError(shrunk.error); await saveState(state); continue; }
      const fileName = webpFileName(item.name);
      const docId = item.kind === "update" ? item.documentId : newDocumentId();
      const stored = await put(partDocBlobPath(docId, fileName), shrunk.bytes, shrunk.contentType);
      const file = { blobKey: stored.pathname, fileName, contentType: shrunk.contentType, size: shrunk.bytes.byteLength };
      let documentId = docId;
      const replaced = item.kind === "update" ? await replaceDocumentFile(docId, file, SYNC_BY) : null;
      if (item.kind === "update" && replaced) {
        if (item.add.length) await attachDocument(docId, item.add, SYNC_BY);
        for (const sku of item.remove) await detachDocument(docId, sku);
        updated++;
      } else {
        // An import — or an update whose document was removed in the app: start a fresh document.
        documentId = item.kind === "update" ? newDocumentId() : docId;
        const blobKey = documentId === docId ? stored.pathname : (await put(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType)).pathname;
        const created = await createDocument({
          id: documentId,
          kind: "image",
          title: item.name.replace(/\.[A-Za-z0-9]{1,5}$/, ""),
          fileName,
          contentType: shrunk.contentType,
          size: shrunk.bytes.byteLength,
          blobKey,
          sourceUrl: item.webViewLink || null,
          source: "drive",
          sourceRef: item.id,
          by: SYNC_BY,
        });
        if (!created) { recordError("Could not record the document."); await saveState(state); continue; }
        await attachDocument(created.id, item.skus, SYNC_BY);
        imported++;
      }
      state.files[item.id] = { md5: item.md5, documentId, skus: item.skus, at: now() };
      await saveState(state);
    } catch (e) {
      if (isFatal(e)) { stopError = (e as Error).message; processed--; break; }
      recordError(e instanceof Error ? e.message : "Couldn't import this photo.");
      await saveState(state);
    }
  }

  const remaining = work.length - processed;
  state.lastRun = { at: now(), imported, updated, relinked, failed, unmatched: plan.unmatched, complete: remaining === 0 && !stopError, ...(stopError ? { error: stopError } : {}) };
  await saveState(state);
  const changed = imported + updated + relinked > 0;
  if (changed) invalidatePortalIndex();
  if (stopError && processed === 0 && !changed) return { ok: false, error: stopError };
  return { ok: true, imported, updated, relinked, failed, unmatched: plan.unmatched.length, remaining, changed };
}
```

Fix to whatever the real signatures turn out to be:
- `DriveApiError` exposes its status as `.status` (check `drive.ts:40`).
- `replaceDocumentFile` returns the updated doc or null/false.
- `createDocument` accepts `title`.
- `matchFileRows` returns `{ fileName, confidence, skus }`, and takes `MatchablePart[]`, which catalog parts satisfy.

If `setBlob` merges top-level keys, `saveState` writes all three, which is correct.

- [ ] **Step 5: Run the checks.** Every `#283 sync`, `#283 settings` and `#283 scope` line PASSes, and earlier suites stay
  green. Clean up temp dirs; run tsc and eslint.
- [ ] **Step 6: Commit** `feat(catalog): Peak Product Photos sync executor + drive source + drive.readonly scope (#283)`.

---

### Task 6: Settings → Mailboxes — Enable Drive photos + photos-account picker

**Files:**
- Modify:
  - `src/app/api/gmail/connect/route.ts` ~L79-84 (`?drivephotos=1`).
  - `src/app/(app)/settings/actions.ts` (new `setCatalogPhotosMailboxAction`, next to `setRecordingsArchiveMailboxAction` ~L769).
  - `src/app/(app)/settings/page.tsx` ~L100-116 (`catalogPhotos` view model passed to the client).
  - `src/app/(app)/settings/settings-client.tsx`: props type + a "Catalog photos (Google Drive)" block right after the
    Recordings archive block (~L1590-1645).
  - `src/app/(app)/account/page.tsx`: only if non-admins connect their own mailboxes there and should see the button.
    Otherwise leave it alone.
- Test: harness pure check that the connect route maps `drivephotos=1` → `DRIVE_READONLY_SCOPE`. It reads the route
  source text, the same way the #245 middleware check reads `src/middleware.ts`.

**Interfaces:**
- Consumes: `DRIVE_READONLY_SCOPE`, `hasDriveReadScope` (Task 5), `saveCatalogPhotosMailbox` (Task 5).
- Produces: `setCatalogPhotosMailboxAction(mailboxKey: string | null): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: Write the failing harness check:**

```ts
// ---------------------------------------------------------------------------
// #283 — ?drivephotos=1 asks Google for drive.readonly.
// ---------------------------------------------------------------------------
import { readFileSync as c283Read } from "node:fs";
{
  const src = c283Read("src/app/api/gmail/connect/route.ts", "utf8");
  ok(/searchParams\.get\("drivephotos"\)\s*===\s*"1"\)\s*extraScopes\.push\(DRIVE_READONLY_SCOPE\)/.test(src),
    "#283 connect: ?drivephotos=1 adds drive.readonly to the consent request");
}
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Edit the connect route.** Import `DRIVE_READONLY_SCOPE` alongside `DRIVE_SCOPE`. After the `?drive=1`
  line, add:

```ts
  // ?drivephotos=1 — "Enable Drive photos" (#283): read-only Drive so the
  // Peak Product Photos sync can see files people drop in that folder.
  if (req.nextUrl.searchParams.get("drivephotos") === "1") extraScopes.push(DRIVE_READONLY_SCOPE);
```

Update the comment above `extraScopes` to mention `?drivephotos=1`.

- [ ] **Step 4: Add the settings action:**

```ts
/** #283 — pick the mailbox whose Google account reads Peak Product Photos.
 *  Must be connected; drive.readonly may be granted before or after. */
export async function setCatalogPhotosMailboxAction(mailboxKey: string | null) {
  await requirePerm("manage_users");
  const { saveCatalogPhotosMailbox } = await import("@/lib/part-docs/drive-photo-sync");
  const r = await saveCatalogPhotosMailbox(mailboxKey);
  if (!r.ok) return { ok: false as const, error: r.error };
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

- [ ] **Step 5: Build the page view model** in `settings/page.tsx`. Import `hasDriveReadScope`. Next to `recordings`:

```ts
  // #283 — Catalog photos: the photos-account picklist over every connected
  // mailbox, flagged by whether its grant carries drive.readonly.
  const catalogPhotos = {
    mailbox: settings.catalogPhotosMailbox ?? null,
    mailboxes: connections.map((c) => ({ key: c.mailboxKey, address: c.address, connectedBy: c.connectedBy, readOn: hasDriveReadScope(c.scope) })),
  };
```

Pass `catalogPhotos={catalogPhotos}` wherever `recordings={recordings}` is passed to the client component.

- [ ] **Step 6: Build the client block.** In `settings-client.tsx`:
  - Add `catalogPhotos: { mailbox: string | null; mailboxes: { key: string; address: string; connectedBy: string | null; readOn: boolean }[] }`
    to the props type. Match the real `connectedBy` type used by `recordings.mailboxes`.
  - Add state `const [photosMailbox, setPhotosMailbox] = useState(catalogPhotos.mailbox ?? "");` and
    `const photosDirty = (photosMailbox || null) !== (catalogPhotos.mailbox ?? null);`.
  - Import `setCatalogPhotosMailboxAction` next to `setRecordingsArchiveMailboxAction`.
  - Right after the Recordings archive block's closing (after the "Enable Drive archive" list), insert:

```tsx
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
          <label style={labelStyle}>Catalog photos account (Google Drive)</label>
          <div style={{ fontSize: 12, color: "#8c919c", lineHeight: 1.5, marginBottom: 8 }}>
            Photos in this account&apos;s <b>Peak Product Photos</b> folder (and its subfolders) sync into the catalog,
            matched by part number in the file name. Read-only — nothing in Drive is ever changed.
          </div>
          {catalogPhotos.mailboxes.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9aa0ab", lineHeight: 1.5 }}>
              No connected mailboxes yet — connect one under Mailboxes above, then pick it here.
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <select value={photosMailbox} onChange={(e) => setPhotosMailbox(e.target.value)} style={{ ...inputStyle, maxWidth: 420, cursor: "pointer" }}>
                <option value="">— not configured —</option>
                {catalogPhotos.mailboxes.map((mb) => (
                  <option key={mb.key} value={mb.key}>
                    {mb.address}
                    {mb.connectedBy ? ` (${mb.connectedBy})` : ""}
                    {mb.readOn ? " · Drive photos on" : " · needs Drive photos"}
                  </option>
                ))}
              </select>
              <button
                className="pk-btn-accent"
                disabled={!photosDirty}
                style={!photosDirty ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                onClick={() => run(() => setCatalogPhotosMailboxAction(photosMailbox || null))}
              >
                Save
              </button>
            </div>
          )}
          {catalogPhotos.mailboxes.some((mb) => !mb.readOn) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {catalogPhotos.mailboxes.filter((mb) => !mb.readOn).map((mb) => (
                <div key={mb.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#8c919c" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{mb.address}</span>
                  <span>needs read-only Drive access before it can sync photos</span>
                  <a
                    className="pk-btn-outline"
                    href={"/api/gmail/connect?mailbox=" + encodeURIComponent(mb.key) + "&drivephotos=1"}
                    title="Re-runs the Google consent with read-only Drive added"
                    style={{ flexShrink: 0, textDecoration: "none" }}
                  >
                    Enable Drive photos
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
```

Use the same `run`, `labelStyle` and `inputStyle` helpers the Recordings block uses (they're in scope there). If the
Recordings block lives inside a sub-component, put this block in the same sub-component and thread `catalogPhotos` to it.

- [ ] **Step 7: Run the gates.** Run tsc, `npm run test:specs` (the `#283 connect` check PASSes) and eslint. Clean up temp
  dirs.
- [ ] **Step 8: Commit** `feat(settings): Enable Drive photos + catalog photos account picker (#283)`.

---

### Task 7: Sync now panel + daily cron rider

**Files:**
- Create:
  - `src/lib/part-docs/drive-photo-view.ts` (pure: panel view model + cron budget)
  - `src/app/(app)/catalog/documents/drive-photos-panel.tsx` (`"use client"`)
- Modify:
  - `src/app/(app)/catalog/documents/actions.ts`: `syncDrivePhotosAction`.
  - `src/app/(app)/catalog/documents/page.tsx`: load the view and render the panel for admins, above the filters.
  - `src/app/api/gmail/sync/route.ts`: the rider.
- Test: harness pure block for `drivePhotosPanelView` + `cronPhotoBudgetMs`.

**Interfaces:**
- Consumes: Task 5 `syncDrivePhotos`, `getDrivePhotoSyncState`, `DrivePhotoSyncState`; `hasDriveReadScope`.
- Produces:

```ts
// drive-photo-view.ts (pure)
export type DrivePhotosPanelView = {
  configured: boolean;            // an account is picked
  account: string | null;         // its address (or the raw key if the connection is gone)
  problem: string | null;         // "not connected" / "needs Drive photos" text, else null
  folder: { name: string; webViewLink: string } | null;
  lastRun: { at: number; imported: number; updated: number; relinked: number; failed: number; complete: boolean; error: string | null } | null;
  unmatched: { name: string; webViewLink: string; reason: string }[];
  synced: number;                 // files with a document
};
export function drivePhotosPanelView(input: { mailboxKey: string | null; connection: { address: string; scope: string | null } | null; state: Pick<DrivePhotoSyncState, "folder" | "files" | "lastRun"> }): DrivePhotosPanelView;
export function cronPhotoBudgetMs(msLeft: number): number; // < 10 000 → 0, else min(20 000, msLeft)
// actions.ts
export async function syncDrivePhotosAction(): Promise<DrivePhotoSyncResult>;
```

`drive-photo-view.ts` must import `hasDriveReadScope` from `@/lib/gmail/config` (pure constants). It may only
`import type` from `./drive-photo-sync`, because that module imports stores. Confirm `@/lib/gmail/config` has no
store/DB imports. If it does, inline the `drive.readonly` check.

- [ ] **Step 1: Write the failing harness block:**

```ts
// ---------------------------------------------------------------------------
// #283 — Drive photos panel view + cron budget (pure).
// ---------------------------------------------------------------------------
import { drivePhotosPanelView as pv283, cronPhotoBudgetMs as cb283 } from "@/lib/part-docs/drive-photo-view";
{
  const empty = { folder: null, files: {}, lastRun: null };
  const a = pv283({ mailboxKey: null, connection: null, state: empty });
  ok(!a.configured && a.problem === null && a.lastRun === null, "#283 panel: no account → not configured");
  const b = pv283({ mailboxKey: "shared:x", connection: null, state: empty });
  ok(b.configured && /isn't connected/.test(b.problem || ""), "#283 panel: a disconnected account is flagged");
  const c = pv283({ mailboxKey: "personal:u1", connection: { address: "jeff@peak.com", scope: "https://www.googleapis.com/auth/drive.file" }, state: empty });
  ok(c.account === "jeff@peak.com" && /Enable Drive photos/.test(c.problem || ""), "#283 panel: an account without drive.readonly is flagged");
  const d = pv283({
    mailboxKey: "personal:u1",
    connection: { address: "jeff@peak.com", scope: "https://www.googleapis.com/auth/drive.readonly" },
    state: {
      folder: { id: "F", driveId: null, name: "Peak Product Photos", webViewLink: "https://drive/F" },
      files: { a: { md5: "1", documentId: "PD-1", skus: ["X"], at: 1 }, b: { md5: "2", documentId: null, skus: [], error: "bad", at: 1 } },
      lastRun: { at: 5, imported: 1, updated: 0, relinked: 0, failed: 1, unmatched: [{ fileId: "u", name: "u.jpg", webViewLink: "https://drive/u", reason: "no part number found in the name" }], complete: true },
    },
  });
  ok(d.problem === null && d.folder?.webViewLink === "https://drive/F" && d.synced === 1 && d.unmatched.length === 1 && d.lastRun?.error === null,
    "#283 panel: a working setup shows the folder, synced count and couldn't-match list");
  ok(cb283(5_000) === 0 && cb283(15_000) === 15_000 && cb283(45_000) === 20_000, "#283 cron: the photo rider gets min(20 s, time left), none under 10 s");
}
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement `src/lib/part-docs/drive-photo-view.ts`:**

```ts
/**
 * #283 — pure view model for the Catalog → Datasheets "Drive photos" panel,
 * and the daily cron rider's budget rule. No stores, no network.
 */
import { hasDriveReadScope } from "@/lib/gmail/config";
import type { DrivePhotoSyncState } from "./drive-photo-sync";

export type DrivePhotosPanelView = {
  configured: boolean;
  account: string | null;
  problem: string | null;
  folder: { name: string; webViewLink: string } | null;
  lastRun: { at: number; imported: number; updated: number; relinked: number; failed: number; complete: boolean; error: string | null } | null;
  unmatched: { name: string; webViewLink: string; reason: string }[];
  synced: number;
};

export function drivePhotosPanelView(input: {
  mailboxKey: string | null;
  connection: { address: string; scope: string | null } | null;
  state: Pick<DrivePhotoSyncState, "folder" | "files" | "lastRun">;
}): DrivePhotosPanelView {
  const { mailboxKey, connection, state } = input;
  const problem = !mailboxKey
    ? null
    : !connection
      ? "The photos account isn't connected any more — reconnect it in Settings → Mailboxes."
      : !hasDriveReadScope(connection.scope)
        ? `${connection.address} needs read-only Drive access — use "Enable Drive photos" in Settings → Mailboxes.`
        : null;
  const lr = state.lastRun;
  return {
    configured: !!mailboxKey,
    account: connection?.address ?? mailboxKey,
    problem,
    folder: state.folder ? { name: state.folder.name, webViewLink: state.folder.webViewLink } : null,
    lastRun: lr ? { at: lr.at, imported: lr.imported, updated: lr.updated, relinked: lr.relinked, failed: lr.failed, complete: lr.complete, error: lr.error ?? null } : null,
    unmatched: (lr?.unmatched ?? []).map((u) => ({ name: u.name, webViewLink: u.webViewLink, reason: u.reason })),
    synced: Object.values(state.files).filter((f) => !!f.documentId).length,
  };
}

/** Daily cron rider budget: what's left before ~50 s, capped at 20 s;
 *  skipped entirely under 10 s (one photo needs a few seconds). */
export function cronPhotoBudgetMs(msLeft: number): number {
  if (msLeft < 10_000) return 0;
  return Math.min(20_000, msLeft);
}
```

- [ ] **Step 4: Add the action** to `catalog/documents/actions.ts`:

```ts
/** Admin "Sync now" (#283): one budgeted Peak Product Photos pass; the panel
 *  loops while `remaining > 0` and a call made progress. */
export async function syncDrivePhotosAction(): Promise<DrivePhotoSyncResult> {
  await requirePerm("manage_users");
  const r = await syncDrivePhotos(FETCH_ACTION_BUDGET_MS);
  revalidate();
  revalidatePath("/catalog");
  return r;
}
```

Import `syncDrivePhotos` and `type DrivePhotoSyncResult` from `@/lib/part-docs/drive-photo-sync`. `FETCH_ACTION_BUDGET_MS`
is already imported in this file (it's used by the thumbnail action). Check, and import it if not.

- [ ] **Step 5: Create the panel** `src/app/(app)/catalog/documents/drive-photos-panel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DrivePhotosPanelView } from "@/lib/part-docs/drive-photo-view";
import { syncDrivePhotosAction } from "./actions";

/**
 * Admin "Drive photos" panel (#283): the Peak Product Photos account/folder,
 * last sync, Sync now (looping the budgeted action like the thumbnail
 * buttons), and the files that couldn't be matched to a part.
 */
export default function DrivePhotosPanel({ view }: { view: DrivePhotosPanelView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sync = () =>
    start(async () => {
      setMsg(null);
      let imported = 0, updated = 0, relinked = 0, failed = 0;
      for (;;) {
        const r = await syncDrivePhotosAction();
        if (!r.ok) { setMsg({ ok: false, text: r.error }); break; }
        imported += r.imported; updated += r.updated; relinked += r.relinked; failed += r.failed;
        const progressed = r.imported + r.updated + r.failed > 0;
        if (r.remaining <= 0 || !progressed) {
          setMsg({ ok: true, text: `${imported} new · ${updated} updated · ${relinked} moved${failed ? ` · ${failed} couldn't be read` : ""}${r.unmatched ? ` · ${r.unmatched} couldn't be matched` : ""}.` });
          break;
        }
        setMsg({ ok: true, text: `Syncing… ${imported + updated} done, ${r.remaining} to go` });
      }
      router.refresh();
    });

  const box: React.CSSProperties = { border: "1px solid #e3e5ea", borderRadius: 10, padding: "12px 14px", margin: "0 0 14px", background: "#fff" };
  if (!view.configured) {
    return (
      <div style={{ ...box, fontSize: 12.5, color: "#5b616e" }}>
        <b>Drive photos</b> — not set up. Pick the Google account that holds <b>Peak Product Photos</b> in{" "}
        <Link href="/settings" style={{ color: "var(--accent)" }}>Settings → Mailboxes</Link>.
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "#3a3f4a" }}>
          <b>Drive photos</b> · {view.account}
          {view.folder && (
            <> · <a href={view.folder.webViewLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{view.folder.name}</a></>
          )}
          {" · "}{view.synced} synced
          {view.lastRun && <> · last sync {new Date(view.lastRun.at).toLocaleString()}</>}
        </div>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="pk-btn-outline" disabled={pending || !!view.problem} onClick={sync}>
            {pending ? "Syncing…" : "Sync now"}
          </button>
        </span>
      </div>
      {view.problem && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{view.problem}</div>}
      {!view.problem && view.lastRun?.error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{view.lastRun.error}</div>}
      {msg && <div role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, marginTop: 6, color: msg.ok ? "#1f7a52" : "#b4543a" }}>{msg.text}</div>}
      {view.unmatched.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: "#5b616e", cursor: "pointer" }}>Couldn&apos;t match ({view.unmatched.length}) — rename in Drive, then Sync now</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#5b616e", maxHeight: 220, overflowY: "auto" }}>
            {view.unmatched.map((u) => (
              <li key={u.webViewLink || u.name}>
                <a href={u.webViewLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{u.name}</a> — {u.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Render the panel from `page.tsx`.** Inside the admin check, load:

```ts
  // #283 — Drive photos panel (admins only).
  let drivePhotos: DrivePhotosPanelView | null = null;
  if (can("manage_users", user.roles)) {
    const [settings, syncState] = await Promise.all([getSettings(), getDrivePhotoSyncState()]);
    const key = settings.catalogPhotosMailbox ?? null;
    const info = key ? await getConnectionInfo(key) : null;
    drivePhotos = drivePhotosPanelView({ mailboxKey: key, connection: info ? { address: info.address, scope: info.scope ?? null } : null, state: syncState });
  }
```

Render `{drivePhotos && <DrivePhotosPanel view={drivePhotos} />}` immediately after the header row `</div>` and before the
filters. Add imports: `getSettings` (`@/lib/settings`), `getDrivePhotoSyncState` (`@/lib/part-docs/drive-photo-sync`),
`getConnectionInfo` (`@/lib/gmail/connections`), `drivePhotosPanelView` + `type DrivePhotosPanelView`
(`@/lib/part-docs/drive-photo-view`), and `DrivePhotosPanel`. Use the real `ConnectionInfo` field names (`address`, `scope`).

- [ ] **Step 7: Add the cron rider** in `src/app/api/gmail/sync/route.ts`. Add `const started = Date.now();` as the first
  line of `GET` (before the secret check is fine). After the vendors rider, add:

```ts
  // #283 — Peak Product Photos: one budgeted pass on this daily trigger,
  // skipped if the Gmail/riders above left under 10 s of the 60 s ceiling
  // (cronPhotoBudgetMs keeps a ~10 s margin under 50 s), and skipped quietly
  // when no photos account is set. Own try/catch like the other riders.
  let drivePhotos: unknown;
  try {
    const { getSettings } = await import("@/lib/settings");
    if (!(await getSettings()).catalogPhotosMailbox) drivePhotos = { skipped: "no photos account" };
    else {
      const budget = cronPhotoBudgetMs(50_000 - (Date.now() - started));
      drivePhotos = budget > 0 ? await syncDrivePhotos(budget) : { skipped: "no time left" };
    }
  } catch (err) {
    drivePhotos = { error: (err as Error).message };
  }
```

Add the static imports `syncDrivePhotos` (`@/lib/part-docs/drive-photo-sync`) and `cronPhotoBudgetMs`
(`@/lib/part-docs/drive-photo-view`). A static import of `getSettings` is fine too. Include `drivePhotos` in the
response JSON. Append one sentence to the route's doc comment: "#283 adds the Peak Product Photos sync the same way."

- [ ] **Step 8: Run all the gates:**
  - `npx tsc --noEmit -p .`
  - `npm run test:specs`: all PASS. Then clean up temp dirs.
  - eslint on every changed or created file: 0 errors.
  - `env -u DATABASE_URL npx next build`: succeeds. This catches a client file pulling in server code. If it fails on
    `drive-photos-panel.tsx`, check that it only `import type`s from `drive-photo-view`, and that `drive-photo-view`
    only `import type`s from `drive-photo-sync`.
  - `npm run test:smoke`: ALL PASSED. `/catalog/documents` and `/settings` must render with the panel and block.
- [ ] **Step 9: Commit** `feat(catalog): Drive photos panel with Sync now + daily cron rider (#283)`.

---

### Task 8: Docs

**Files:** `DECISIONS.md`, `PUNCHLIST.md`, `docs/superpowers/specs/2026-10-01-catalog-photos-shrink-and-drive-sync-design.md`
(the as-built note).

- [ ] **Step 1: Recompute the numbers.** Run `git fetch -q && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | sort -t D -k2 -n | tail -1`
  and the same for `PUNCHLIST.md` (`^## [0-9]+\.`). Use the next free numbers. If #283 is taken, renumber every
  `#283` in this branch (code comments, harness messages, commit-free docs) to the free number.
- [ ] **Step 2: Add the DECISIONS entries** (one each, 3–5 sentences, in the file's style):
  1. Images are shrunk to ≤1600 px WebP q80 at every entry point; the image cap rises to 25 MB; HEIC refuses.
  2. Peak Product Photos syncs read-only via drive.readonly on a chosen mailbox. It's a separate scope because drive.file
     can't see human-added files.
  3. Sync semantics: the Upload-many filename rule; Labor excluded; unmatched listed, not guessed; a Drive delete keeps
     the app copy; a renamed-to-unmatched file keeps its links; failed files wait for a change.
  4. Triggers: Sync now plus a rider on the existing daily cron (Hobby: daily) with a min(20 s, time left) budget.
- [ ] **Step 3: Add the PUNCHLIST entry** `## 283. Catalog photos — shrink on the way in + Peak Product Photos Drive sync — DONE 2026-10-01 (D…)`.
  Write a short what-shipped paragraph, then **Remaining (Jeff-gated)**:
  1. Add drive.readonly to the OAuth consent screen (and ideally switch it to Internal).
  2. Create the folder.
  3. Enable Drive photos + pick the account in Settings → Mailboxes.
  4. Sync now.
- [ ] **Step 4: Add an as-built note to the spec.** Append `## As built` with any deviations. One known deviation:
  Drive errors use a photos-specific `photosDriveError` in `drive-photos.ts` instead of a wording option on
  `driveErrorFor`.
- [ ] **Step 5: Commit** `docs: #283 catalog photos shrink + Drive sync (D…)`.
