# Catalog photos — shrink on the way in + Peak Product Photos Drive sync

Date: 2026-10-01 · Punch #283 (renumber at merge if taken) · Owner approval: Jeff, 2026-10-01

## Why

Customer-portal product images (#245) arrive as full-size files (up to 10 MB) and would fill the Vercel Blob
store, which is on the free Hobby plan. The company already pays for Google Workspace Drive. Jeff wants photos
collected in Drive, with the app keeping only small web copies.

## Part 1 — every catalog image is shrunk on the way in

**One helper:** `src/lib/part-docs/shrink.ts` → `shrinkImage(bytes)`:

- `sharp` (made a direct dependency at the version already resolved under `next`, 0.35.x): `.rotate()` (EXIF
  orientation), `resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })`, `.webp({ quality: 80 })`.
- Output drops all metadata (EXIF/GPS), which is sharp's default.
- `limitInputPixels` guards decompression bombs.
- Returns `{ ok: true, bytes, contentType: "image/webp", width, height }` or `{ ok: false, error }`.
- An undecodable input refuses with `"Couldn't read this image — save it as JPEG, PNG or WebP."`. This covers HEIC from
  iPhones, which sharp's prebuilt binaries can't decode, and corrupt files.
- The output file name is the input's base name with a `.webp` extension.

**Applied at every image entry point** (kind `"image"` only — datasheets/spec sheets untouched):

1. **Browser direct-to-Blob uploads.** These cover Upload many, the Image drop zone and the part editor gallery,
   through `attachUploadedDocumentAction` / `replaceDocumentFileAction`. After `verifyUploadedBlob` passes:
   - Read the full blob with `getBlobStream` and shrink it.
   - `putBlob` the result under the same document's path and delete the uploaded original.
   - Store the shrunk file's key/name/type/size.
   - If the shrink fails, delete the uploaded blob and return the refusal. This matches verify's own refusal
     path; no document is created.
2. **Add image from URL** (`addImageFromUrlAction`) shrinks the fetched bytes before `putBlob`.
3. **Datasheet thumbnails** (`renderDatasheetThumbnail`) shrink the PNG screenshot to WebP before storing.
   Existing thumbnails are left as they are.
4. **Drive sync** (Part 2).

**Size cap:** `MAX_PART_IMAGE_BYTES` rises from 10 MB to 25 MB. The upload broker already allows 25 MB for every
kind. Originals are shrunk, so the cap only bounds what we read into memory. The Upload many hint text updates to
match.

**Not in scope:** re-encoding images already stored (they're small); a client-side pre-shrink.

## Part 2 — Peak Product Photos Drive folder → catalog images

**Permission.** Add a new scope constant `DRIVE_READONLY_SCOPE = ".../auth/drive.readonly"` with
`hasDriveReadScope()`. The existing `drive.file` scope only sees files the app created, so it can't see a
human-filled folder.

- The connect route gains `?drivephotos=1`, which appends that scope. It sits alongside `?drive=1` /
  `?calendar=1` and uses the same `include_granted_scopes` consent flow.
- Read-only: the sync never writes, moves or deletes anything in Drive.

**Which account.**

- A new setting `catalogPhotosMailbox: string | null`, admin-set in Settings → Mailboxes.
- The picker sits next to the Recordings archive picker and lists connected mailboxes.
- Each mailbox without the scope shows **Enable Drive photos** (→ `/api/gmail/connect?mailbox=…&drivephotos=1`).
- Saving refuses a mailbox that isn't connected. A mailbox without the scope saves, but the panel says to enable it.

**Folder.**

- On first sync the app searches for a folder named exactly **Peak Product Photos**:
  - Query: `mimeType = folder`, not trashed.
  - Flags: `corpora=allDrives`, `includeItemsFromAllDrives`, `supportsAllDrives`, so My Drive and Shared Drives
    both work.
- One hit is remembered (`folderId`, `driveId`, `webViewLink`) in the sync state.
- Zero hits gives "No folder named Peak Product Photos was found in that account's Drive."
- Several hits gives "Found N folders named Peak Product Photos — rename the extras", with links.
- A remembered folder that disappears (404 or trashed) is forgotten and searched for again next sync.
- Subfolders are walked recursively, so photos can be organized by manufacturer. A folder ever reached twice
  (Drive allows multiple parents) is walked once.

**Listing.** Each folder is listed with `'<id>' in parents and trashed = false`.

- Fields: `id, name, mimeType, md5Checksum, size, modifiedTime, webViewLink`.
- Page size 1000, all pages.
- Only `image/png`, `image/jpeg`, `image/webp` and `image/heic`/`heif` files are considered photos. HEIC is
  listed so it can be reported, not imported.
- Google Docs and other files are ignored.

**Matching.** Uses the same rule as Upload many: `matchFileRows(names, parts)` over the live catalog.

- Labor parts and deleted parts are never targets.
- `high` confidence attaches the photo to those SKUs.
- `ambiguous` / `none` go on the Couldn't-match list, with the reason ("matches several parts: …" /
  "no part number found in the name").
- A file larger than 25 MB is listed as "over 25 MB — export a smaller copy".
- HEIC is listed as "HEIC — save as JPEG".

**State.** One settings blob `drive_photo_sync` (`getBlob`/`setBlob` — no migration):

```ts
{
  folder: { id, driveId: string | null, name, webViewLink } | null,
  files: Record<driveFileId, { md5: string; documentId: string | null; skus: string[]; error?: string; at: number }>,
  lastRun: {
    at, imported, updated, relinked, failed,
    unmatched: { fileId, name, webViewLink, reason }[],
    complete: boolean,
  } | null,
}
```

**One sync call** (`syncDrivePhotos(deps, budget)`, server-only; the pure planner is separate):

1. Resolve the access token from `catalogPhotosMailbox`. If there's no account, no scope, or the token fails,
   return an `ok: false` reason the panel shows.
2. Resolve the folder, then list the tree.
3. **Plan** with a pure `planDrivePhotoSync(listing, state.files, matchesByName)`. It sorts each file into one of:
   - `import`: new file id, high match.
   - `update`: known id, md5 changed. Replace the document's file.
   - `relink`: known id, md5 same, matched SKU set changed because the file was renamed. Attach new SKUs and detach
     the ones no longer matched.
   - `skip`: known, unchanged.
   - `retry-later`: a previous error with the same md5. Not retried until the file changes.
   - `unmatched`: ambiguous, none, HEIC or too big. A KNOWN file that becomes unmatched (renamed to something
     that no longer matches) keeps its document and current links untouched; it is only listed.
4. **Execute** `import`/`update` in order under the shared 45 s `createFetchBudget`. Per file:
   - Download with `files/<id>?alt=media&supportsAllDrives=true`, then shrink, `putBlob`, and
     `createDocument({ kind: "image", source: "drive", sourceRef: fileId, sourceUrl: webViewLink })` +
     `attachDocument`.
   - An update uses `replaceDocumentFile`.
   - Relinks are cheap DB writes and are all done every call.
   - A per-file failure is recorded in `files[id].error` with its md5 and counted. It never stops the batch.
5. Save the state and return `{ imported, updated, relinked, failed, unmatched: count, remaining }`, where
   `remaining` is import/update work not reached in this call.
6. When anything changed, call `invalidatePortalIndex()` and revalidate `/catalog/documents` and `/catalog`.

**Deleted in Drive:** the app's copy stays. Drive is an inbox, and removing a photo from customers is the app's
**Hide from customers**. Its `files` entry is kept so a re-add of the same id isn't double-imported.

**Gallery order:** `PartDocumentSource` gains `"drive"`, ranked with `upload` (a real photo). It's added to
`IMAGE_SOURCE_RANK` and `IMAGE_SOURCE_LABEL` ("Drive"), so Drive photos sort ahead of datasheet renders (D410
unchanged).

**Triggers:**

- **Sync now** — admin `syncDrivePhotosAction()`. The client loops while `remaining > 0` and the call made
  progress, the same shape as the thumbnail button.
- **Daily** — a rider on the existing `/api/gmail/sync` cron, in its own try/catch.
  - It gets its own budget of `min(20 s, time left before 50 s)` and is skipped if under 10 s is left.
  - No new cron entry is needed, because Hobby crons run daily at most.

**Panel** (admin, Catalog → Datasheets, above the table): **Drive photos**.

- Not set up: one line linking to Settings → Mailboxes.
- Set up: account, folder link, last sync time + counts, **Sync now** with live progress, and a collapsible
  **Couldn't match (N)** list (file name → Drive link, reason).

## Errors

- Drive 401/403 says "Reconnect <account> with Enable Drive photos". This needs a photos-specific wording option
  on `driveErrorFor`, which today is worded for Recordings.
- A 429 or 5xx ends the call early with the work so far saved. The next Sync now / cron continues.
- Everything is per-file isolated; state is saved even when a call ends early.

## Testing (spec harness, PGlite, no network)

- **shrink**:
  - A 3000×2000 PNG comes out at 1600 px longest side as WebP.
  - A small image is not enlarged.
  - An EXIF-rotated JPEG comes out upright with no EXIF.
  - Garbage bytes are refused with the message.
- **planner** (pure): every bucket above, including a rename relink, retry-later, HEIC, too-big, ambiguous, Labor
  excluded, and a repeated folder walked once.
- **Drive client**: find folder (0 / 1 / many hits), recursive listing with paging, and the all-drives params
  present, all against a fake `DriveFetch`.
- **executor** against PGlite with a fake fetch + fake `putFile`:
  - Import creates an image document linked to the right SKUs.
  - A second run is a no-op.
  - An md5 change replaces the file.
  - A rename relinks.
  - A failure is recorded, then not retried until the md5 changes.
  - Budget exhaustion reports `remaining`.
- **upload path**: the shrink step replaces the stored file and a refusal deletes the blob (fake blob deps).
- **settings**: `catalogPhotosMailbox` save refuses an unknown mailbox.
- Existing #245/#207 checks stay green.

## Jeff-gated setup (after deploy)

1. Google Cloud → OAuth consent screen: add the `drive.readonly` scope. Recommended: switch user type to
   **Internal** (Workspace), which also stops 7-day refresh-token expiry under Testing.
2. Create the **Peak Product Photos** folder (a Shared Drive is best).
3. Settings → Mailboxes → **Enable Drive photos** on the chosen account and pick it as the photos account.
4. Catalog → Datasheets → **Sync now**.

## As built

Deviations from the design above:

- **Drive error wording:** errors use a photos-specific `photosDriveError` in `src/lib/google/drive-photos.ts`, not a
  wording option on `driveErrorFor`.
- **Transient vs per-file failures (added in review):** network/timeout/Blob/DB/401/408/429/5xx/rate-limit 403 stop the
  call and retry next run without marking the file; shrink refusal, size cap, download-restricted 403, 404 and other 4xx
  are recorded and skipped until the file changes in Drive.
- **Pending entries and a run lease (added in review):** a pending entry is saved before each create so a killed
  function cannot double-import; `runningUntil` (budget + 60 s) blocks overlapping runs.
- **Account page:** an "Enable Drive photos" button was added on the Account page as well as Settings → Mailboxes.
- **Cron rider budget:** min(20 s, time left before 50 s), skipped under 10 s or with no photos account.
- **Known follow-ups:** a file that fails transiently every time blocks the queue behind it; quota-style 403s are read
  from message text; the unmatched list is uncapped; `webpFileName` strips any short dotted suffix.
