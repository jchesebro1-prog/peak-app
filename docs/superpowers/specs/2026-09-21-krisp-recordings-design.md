# Recordings: in-app site-visit capture → Krisp transcription → write-back → Drive archive

Status: approved by Jeff (brainstorming session 2026-09-21). Source brief: "Krisp API
Integration Brief — Peak App Site Visits" (Jeff, 2026-09-21). Build is gated on Jeff
generating a Krisp Write key on a Core/Advanced seat and on `BLOB_READ_WRITE_TOKEN` in
production (D116 seam). Vercel is on Hobby today; Jeff will upgrade if the pilot works,
which only shortens the cron cadence — nothing in this design depends on the upgrade.

## Context

Reps walk venues (site surveys, inspections, flame tests, repairs, install check-ins) and
today dictate into Krisp's mobile app by hand; the "Hortonville High School Site Visit"
recording in Jeff's Krisp (2026-09) is a solo walkthrough whose Krisp summary already breaks
into sections like "Rigging System", "Stage and Room Measurements", "Next Steps". None of
that reaches the Peak App record.

What exists to build on:

- `site_visits` (D76, #34) with `surveyId` → the auto-linked Survey; Survey/Inspection/Flame/
  Repair capture editors; Field Work day view; Engagement Oversight tab (D90/D91 has a
  `recordingUrl` *link* field — left untouched).
- Vercel Blob seam `src/lib/blob.ts` (D116): private store, authenticated proxy routes,
  but every caller uploads via an ≤8 MB data-URL server action — too small for audio.
- Personal Google connection (`gmail_connections`) with incremental scopes: Calendar (D77)
  and Tasks (D146) added via `?calendar=1` / `?tasks=1` on `/api/gmail/connect`,
  `hasXScope()` checks in `src/lib/gmail/config.ts`, `accessTokenFor()` for a fresh token,
  AES-GCM `encryptToken()` for secrets.
- Home Queue assignments (`src/lib/stores/assignments.ts`) with a free-text `source`
  provenance and downstream Google Tasks (D146) + Apple Reminders (D93/#115) sync.
- Notes (`src/lib/stores/notes.ts`, parentKind `customer`) feeding the customer activity
  feed (D121).
- The daily cron route `/api/gmail/sync` (D74) already hosts a second job (Google Tasks
  sync, D146); Home load runs a stale-check so sync happens while a tab is open.
- Capacitor shell (`src/capacitor.config.ts`, `com.peaksystemsgroup.quartzite`, ios/ +
  android/) with `isNativePlatform()` in `src/lib/platform.ts`; no native plugins yet.
- The app is deterministic (D89): no LLM calls. Krisp does the summarisation externally;
  everything the app does with the result is rules-based.

### Krisp API facts (verified 2026-09-21 against meeting-api-docs.krisp.ai + the Krisp MCP)

- Base `https://meeting-api.krisp.ai/v1`, `Authorization: Bearer krsp_u_…`. Keys are
  **personal** (one Krisp user), scope Read or Write, Core/Advanced plans only. Rate limit
  5 req/s sustained / 25 per 5 s burst **per Krisp account** across all its keys.
- `POST /import` `{title?, language?, size?, duration?}` → `201 {import_id, url, expires_at}`.
  The client `PUT`s raw bytes to `url` (pre-signed S3, set `Content-Type`); **the PUT alone
  creates the meeting and starts transcription**. `400 "Action is still in process"` = only
  one import start per user may be in flight. `403` = storage full or Read-only key.
- `GET /import/{id}/status` → `{import_id, status: uploading|processing|ready|failed,
  meeting_id (null until ready), error}`.
- `GET /meetings/{id}?fields=title,started_at,duration,status,participants,transcript,notes`.
  `transcript = {language, speakers{idx→Participant}, segments[{speaker, text, start, end}]}`.
  `notes = {blocks: NoteBlock[]}`, `NoteBlock = {type, text?, completed?, assignee?,
  due_date?, children?}` — the `type` enum is **not published**. `409` while processing.
- `GET /action-items` (read-only), `GET /me` (`id, email, first_name, last_name, team_id`).
- No REST field exposes the audio file. Webhooks are a Krisp-UI feature (per user, static
  custom header only, no signature, undocumented payload/retries) — **not used in v1**.

## Decisions taken in the brainstorm

| # | Decision | Why |
|---|---|---|
| 1 | Rep records **inside the Peak App** (Capacitor native build) | Krisp can't be triggered remotely; the recording must start from the record so matching is by id, not title |
| 2 | **Any field record** can carry a recording (generic parent pointer) | Same room, same walkthrough — Survey/Inspection/Flame/Repair/Field Work/Engagement/Site visit |
| 3 | **Per-rep Krisp keys** (Account page), no shared key | Keys are personal; rate limit + one-import-in-flight are per account; meetings stay in the rep's Krisp |
| 4 | **Approach A**: Blob-staged single upload, server relays to Krisp, **poll-driven** results | One cellular upload, key never leaves the server, no per-rep Krisp webhook setup, works on Hobby |
| 5 | Blob is **staging**, not retention: a daily job archives audio to **Google Drive**, saves the link, deletes the Blob | Jeff: minimise Blob storage; Drive is the long-term copy |
| 6 | Archive Drive defaults to the **shared sales mailbox**'s account (configurable) | Recordings stay company-owned if a rep leaves |
| 7 | Utilisation, all four: record view + ⌘K, action items → Home Queue **confirm-first**, summary → customer feed note, summary sections → Survey/Inspection **insert-on-tap** prefill | Jeff picked all four; confirm/insert gates keep Krisp output from writing silently |

## 1. Data model

### 1.1 `recordings` — new doc collection (`REC-####`, base 9000)

```ts
type RecordingParentKind =
  | "site_visit" | "survey" | "inspection" | "flame_job" | "repair_job" | "project" | "engagement";

type AudioState = "on_device" | "uploaded" | "archived";
type KrispStatus = "pending" | "importing" | "processing" | "ready" | "failed";

type RecordingRecord = {
  id: string;                         // "REC-####"
  parentKind: RecordingParentKind;
  parentId: string;                   // SV-…, FS-…, INS-…, FT-…, R-…, P-…, E-…
  // denormalised from the parent at creation — no joins for feed/search/detail
  customerId: string | null;
  customer: string;
  locationId: string | null;
  venue: string;
  title: string;                      // what Krisp shows: "SV-5012 · Hortonville HS · Site survey · 2026-09-21"

  recordedByUserId: string;           // users.id
  recordedByName: string;
  startedAt: number; endedAt: number; durationS: number;
  mime: string;                       // "audio/mp4" | "audio/wav" | "audio/webm" (web fallback)
  sizeBytes: number;

  audio: {
    state: AudioState;
    blobPathname: string | null;      // set at "uploaded", cleared at "archived"
    uploadError: string | null;
    driveFileId: string | null;
    driveLink: string | null;         // webViewLink
    archivedAt: number | null;
    archiveError: string | null;
  };

  krisp: {
    status: KrispStatus;
    krispUserId: number | null;       // whose account it was imported under
    importId: string | null;
    meetingId: string | null;
    meetingUrl: string | null;        // https://app.krisp.ai/m/<id>
    error: string | null;
    lastCheckedAt: number | null;
    readyAt: number | null;
  };

  transcript: { language: string; speakers: Record<string, KrispParticipant>;
                segments: { speaker: number; text: string; start: number; end: number }[] } | null;
  notes: { blocks: KrispNoteBlock[] } | null;          // stored RAW, never reshaped
  summary: { title: string; description: string }[];   // derived (deriveSummary)
  keyPoints: string[];                                 // derived

  actionItems: {
    key: string;                      // stable hash of (title, index) — Krisp notes blocks have no id
    title: string;
    assigneeName: string | null;      // as Krisp wrote it
    dueDate: string | null;
    disposition: "pending" | "accepted" | "dismissed";
    assignmentId: string | null;      // set on accept
  }[];
  feedNoteId: string | null;
  prefill: { insertedKeys: string[] };                 // summary section keys already inserted

  createdAt: number; updatedAt: number;
};
```

Audio and Krisp lifecycles are **independent** fields: audio can be `archived` while Krisp
is `failed`; Krisp can be `ready` while audio is still `uploaded` awaiting the nightly job.

Registration follows the `task_templates` (D151, migration 0020) pattern: `docTable`
export + `DOC_TABLES` entry in `src/db/doc-tables.ts`, migration with `seq_idx`,
`deleted_idx` and the `seq_bump` trigger. The collection is **syncable** (it participates
in `/api/sync/push|pull`) so an offline device can create the doc; the audio bytes never
travel through the doc sync.

### 1.2 `krisp_connections` — new table (mirrors `gmail_connections`)

| column | notes |
|---|---|
| `user_id` (PK) | `users.id` |
| `api_key` | `encryptToken()` AES-GCM, same helper as Gmail |
| `krisp_user_id`, `krisp_email`, `krisp_name` | from `GET /me` at connect |
| `connected_at`, `last_used_at`, `last_error` | |

Connect = paste key → server calls `GET /me`; a key that fails, or that can't `POST /import`
(Read-only scope → `403`), is rejected with the Krisp error text. Disconnect deletes the row.
The import lock lives on this row: `import_claimed_at` (nullable). `withKrispImportLock(userId,
fn)` atomically sets it when null or older than 5 minutes (same atomic-claim style as the
per-mailbox sync claims, D74), runs `fn`, and clears it in `finally`. A second concurrent
import for the same user gets "busy" and is requeued rather than sent to Krisp.

### 1.3 Settings additions (`AppSettingsData`)

- `recordingsArchiveMailbox: string | null` — connection key of the mailbox whose Google
  account owns the Drive archive. Default `null` = "not configured" (archive waits).
- `recordingsArchiveFolderId: string | null` — cached Drive id of the root
  `Peak Recordings` folder; per-customer subfolder ids cached in
  `recordingsArchiveFolders: Record<customerId, driveFolderId>`.
- `recordingsBetaUsers: string[]` — user ids allowed to see the Record button; empty =
  everyone (the pilot gate, Settings → Beta).

## 2. Capture and upload (device side)

### 2.1 Recorder seam — `src/lib/recorder/`

```ts
interface RecorderPort {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<{ file: RecordedFile; mime: string; durationS: number }>;
  state(): "idle" | "recording" | "paused";
}
type RecordedFile = { kind: "native"; path: string } | { kind: "web"; blob: Blob };
```

- `nativeRecorder.ts` — Capacitor plugin. **Hard requirements** (verified in the plan
  phase, not assumed): writes to a file on device (no in-memory base64 for a 45-minute
  take), AAC/m4a or WAV output, iOS `UIBackgroundModes: audio` so recording survives screen
  lock and app backgrounding, Android foreground-service notification. Candidate plugins are
  evaluated against these in the implementation plan; if none pass, v1 ships web-only on
  native with the "keep the screen on" caveat and the seam stays.
- `webRecorder.ts` — `MediaRecorder` (`audio/webm;codecs=opus`), desktop testing and the
  fallback above.
- `pickRecorder()` chooses by `isNativePlatform()`.

### 2.2 Recorder page — `/recordings/new?parent=<kind>:<id>`

Full-screen, client component: parent label + venue, big Record/Pause button, elapsed
timer, one optional "what to remember" text line (prepended to `title`), Stop. Stop:

1. `createRecordingAction(parentKind, parentId, meta)` — server action resolves the parent,
   denormalises customer/venue/location, mints `REC-####`, `audio.state: on_device`,
   `krisp.status: pending`. Offline: the create goes through the existing doc-sync outbox
   with a client-minted `rec-<uuid>` id, the same convention field-created tasks use
   (`tk-…`); the id is kept as-is, never renumbered to `REC-####`.
2. The file is registered in the **device upload queue** (§2.3).
3. Navigate to `/recordings/REC-####`.

### 2.3 Device upload queue — `src/lib/recorder/upload-queue.ts`

Separate from the doc-sync outbox (payloads are tens of MB). Persistence: Capacitor
`Preferences` (native) / IndexedDB (web) list of `{recordingId, file, mime, sizeBytes,
attempts, lastError}`. Drains on app foreground, on `online`, and after each Stop:

1. `POST /api/recordings/upload` (session-authenticated route, **not** in the middleware
   exemption list) with `{recordingId}` → the route checks the recording belongs to the
   caller and returns a **Vercel Blob client-upload token** via `handleUpload` from
   `@vercel/blob/client`, restricted to pathname `recordings/<REC-id>/<safeName>`, allowed
   content types = the Krisp-supported audio types, `maximumSizeInBytes` 1 GB, `access:
   private`.
2. Device uploads directly to Blob with `upload()` from `@vercel/blob/client` (multipart for
   large files; the token, not the session, authorises the bytes).
3. `handleUpload`'s `onUploadCompleted` callback patches the doc: `audio.state: uploaded`,
   `blobPathname`, `sizeBytes`; then calls `startKrispImport(recId)` (§2.4). Because Vercel
   calls this webhook from its own infra, dev machines (no public URL) fall back to the client
   calling `markUploadedAction(recId, pathname)` after `upload()` resolves — both paths are
   idempotent.
4. The device file is deleted **only after** the doc reads `uploaded`.

Gates: no `BLOB_READ_WRITE_TOKEN` → the upload route answers `503 {reason:"blob-disabled"}`
and the record shows "Upload unavailable on this server"; there is deliberately **no**
data-URL fallback (a 40 MB row must never land in Postgres).

### 2.4 Krisp relay — `src/lib/krisp/import.ts`

`startKrispImport(recId)` runs server-side under the **recorder's** key:

1. No `krisp_connections` row → leave `pending`, record shows "Connect Krisp in Account to
   transcribe" (recording + archive still work).
2. `withKrispImportLock(userId)`: `POST /import {title, language:"auto", size}` →
   `importId`, status `importing`.
3. Stream the Blob (`getBlobStream`) to the pre-signed `url` with `PUT`, `Content-Type:
   mime`. On 2xx → status `processing`, `lastCheckedAt: now`. The route/action declares
   `maxDuration = 60`; server→S3 throughput makes a 50 MB relay comfortably fit.
4. Errors map to `failed` with Krisp's message (`storage full`, `401 key revoked`, `400
   still in process` → **not** failed: requeue with backoff). Retry button re-runs from
   step 2 using the Blob copy — which is why Blob is retained until Krisp is `ready`.

## 3. Results: poll-driven

### 3.1 `checkRecording(recId)` — `src/lib/krisp/check.ts`

`GET /import/{importId}/status`; on `ready` → `GET /meetings/{meetingId}?fields=title,
started_at,duration,status,participants,transcript,notes` → store `transcript`, raw `notes`,
`meetingId`, `meetingUrl`, `readyAt`, run `deriveSummary` (§4.1) and `onRecordingReady`
(§4). On `failed` → store error. Always bumps `lastCheckedAt`.

### 3.2 Triggers

| trigger | scope | cadence |
|---|---|---|
| **Client poll** — recording detail page or a parent with a `processing` recording open | that recording | every 20 s, capped to the caller's 5 most recent `processing` recordings |
| **Home-load stale check** — `reconcileRecordingsIfStale()` next to `checkMailIfStale` | all `processing` with `lastCheckedAt` > 2 min | on Home render, ≤ 5 per Krisp account per pass |
| **Cron** — extra step in `/api/gmail/sync` (own try/catch like Google Tasks) | same | daily on Hobby; every few minutes after the Vercel upgrade, no code change |

Budget: each check is ≤ 2 Krisp calls; caps keep any pass under the 5 req/s account limit.

### 3.3 Stalls

A `processing` recording untouched for 24 h shows **Stalled** with Retry (re-import from
Blob). A `failed` recording keeps its Blob until archived (§5) so audio is never lost.

## 4. Write-back — `onRecordingReady(rec)` (idempotent, safe to rerun)

### 4.1 Summary on the record — `deriveSummary(blocks)`

Pure walker over Krisp's block tree, spec-tested against a fixture captured from the
Hortonville recording: heading-like blocks with text children → `summary[{title,
description}]`; bullet lists under a "Key points"-titled heading → `keyPoints`; blocks with
`completed !== undefined` or under an "Action items" heading → `actionItems` (key = stable
hash of title + ordinal; existing dispositions are preserved by key on rerun). **Unknown
`type` values are treated as prose and never throw** — Krisp doesn't publish the enum.

### 4.2 Action items → Home Queue, confirm first

Items land `pending`. The detail page's Action items tab shows each with Accept / Dismiss
and an assignee picker prefilled by `matchAssignee(name, activeUsers)` — the same
first-word/whole-name match the Peak/Assign label interpreter uses (#96) — defaulting to
the recorder. **Accept** → `createAssignment({ title, assigneeUserId, source: "Krisp
REC-#### · <title>", link: { kind: "company", id: customerId } | null, due })`, stores
`assignmentId`. Existing Google Tasks / Reminders syncs pick it up unchanged. Nothing
reaches the queue without a tap; `AssignmentLink` kinds are **not** extended in v1.

### 4.3 Summary → customer feed note

If `customerId` is set and `feedNoteId` is null: `createNote({ parentKind: "customer",
parentId: customerId, by: recordedByName, text })` where `text` = header line
`Recorded <parent label> · REC-#### · <venue> · <date>` + each summary section as
`Title: description` + `→ /recordings/REC-####`. Lead-borne visits without a customer skip
this; when the visit later gains a `customerId` (#34 flow), the next `onRecordingReady`
rerun (triggered by Retry/Check now) posts it.

### 4.4 Prefill into Survey / Inspection — insert-on-tap

Applies when `parentKind ∈ {survey, inspection}` or `parentKind = site_visit` with
`surveyId`. The capture editor gains a **"From recording"** panel listing each summary
section with its routed target and an **Insert** button. Routing is a deterministic table
`PREFILL_RULES: { match: RegExp; survey: SurveyTarget; inspection: InspectionTarget }`
evaluated against the section title:

| title matches | Survey target | Inspection target |
|---|---|---|
| `/measure|dimension|size|height|width|depth|proscenium|grid/i` | `measurements["From recording · <title>"]` | `measurements[…]` |
| `/rigging|lineset|line set|batten|arbor|fly/i` | `notes` | `narrative` |
| `/curtain|drape|soft goods|track|border|valance/i` | `scopeOfWork` | `narrative` |
| `/access|dock|elevator|door|lift|parking|hours|badge/i` | `notes` (v1; typed access fields are follow-up) | `venueInfo["Access"]` |
| `/next step|follow.?up|action/i` | *(skipped — handled by §4.2)* | *(skipped)* |
| anything else | `notes` | `narrative` |

Insert appends `\n\n[from REC-####] <title>: <description>` to the target (map entries
are created if absent) and records the section key in `prefill.insertedKeys` so the row
greys out. **No silent writes, no numeric extraction** in v1.

### 4.5 ⌘K search

`recordings` joins `/api/search`: `searchDocs("recordings", q, 100)` filtered on `id`,
`title`, `customer`, `venue`, and joined summary text; result label = title, snippet = first
matching summary section. Transcript text is in the JSONB substring candidate scan but never
shown as the snippet.

## 5. Drive archive — nightly

### 5.1 Scope

`DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"` (files the app created only),
`?drive=1` on `/api/gmail/connect`, `hasDriveScope()` beside Calendar/Tasks. Account page
and Settings → Mailboxes show **Enable Drive archive** on connected accounts lacking it.
Settings → Integrations → Recordings: picklist `recordingsArchiveMailbox` over connected
mailboxes **with** the Drive scope; recommended default when Jeff sets it: the shared sales
box.

### 5.2 `archiveRecordings()` — extra cron step

Selects recordings with `audio.state: uploaded` AND (`krisp.status ∈ {ready, failed}`)
AND `readyAt|updatedAt` older than 6 h (room for same-day retries), oldest first, **≤ 5 per
run** (60 s function budget; the rest go next run). Per recording:

1. `accessTokenFor(recordingsArchiveMailbox)`; none/no scope → record `archiveError:
   "Archive not configured"`, stop the pass.
2. Ensure folders: `Peak Recordings/` (cached root id) → `<Customer>/` (cached per
   `customerId`; recordings with no customer go under `Unfiled/`).
3. Drive **resumable upload**: `getBlobStream(blobPathname)` piped in, name
   `<YYYY-MM-DD> <parentId> <venue>.<ext>`, `mimeType: mime`, `parents: [folderId]`,
   `fields: id,webViewLink`.
4. Only after Drive returns an `id`: `del(blobPathname)` from `@vercel/blob`, set
   `driveFileId`, `driveLink`, `archivedAt`, `state: archived`, `blobPathname: null`.
5. Any failure leaves the Blob untouched and stores `archiveError` (visible on the record;
   retried next run).

## 6. UI surfaces

- **`<RecordControl parentKind parentId>`** — links to `/recordings/new?parent=…`. Shown
  when the viewer passes the beta gate (§1.3) **and** (has a Krisp connection **or** the
  parent already has recordings). Placed on: Venue Assessments worklist row, Home agenda
  visit item, Survey capture editor header, Inspection capture editor header, Flame results
  and Repair results editors, Field Work day view, Engagement Oversight tab.
- **`<RecordingsCard parentKind parentId>`** — list of recordings with status chip
  (On device · Uploading · Transcribing · Ready · Failed · Stalled · Archived), duration,
  recorder, link. Same parents as above; the customer record's Site visits card shows a
  per-visit recording count.
- **`/recordings/[id]`** — header (parent link, title, status timeline for both
  lifecycles), tabs **Summary** (sections + key points), **Action items** (§4.2), **Transcript**
  (speaker · mm:ss · text), **Audio** (Krisp link; Drive link once archived). Buttons where
  the state allows: **Check now**, **Retry import**, **Post to customer feed** (if skipped).
- **Account page** — Krisp card mirroring the Gmail card: paste key → Connect; shows Krisp
  email + connected date; Disconnect. Plus **Enable Drive archive** on the Google card.
- **Settings → Integrations → Recordings** — archive account picklist, archive folder
  status, last run + error. **Settings → Beta** — `recordingsBetaUsers` multi-select.
- **Nav** — no new top-level item; recordings are reached via parents and ⌘K.

## 7. Error handling, limits, tests

- **Gates, each with its own message on the record:** no Blob token → upload unavailable;
  no Krisp key → transcription unavailable; no archive account → archive waiting; Read-only
  key → refused at connect.
- **Idempotency keys:** `feedNoteId`, `actionItems[].assignmentId`, `prefill.insertedKeys`,
  `driveFileId`, `importId`. Blob delete strictly after Drive `id`. Device file delete
  strictly after doc `uploaded`.
- **Rate/size limits:** one import in flight per Krisp user (lock); reconcile ≤ 5 per
  account per pass; archive ≤ 5 per run; client-upload token capped at 1 GB and audio types.
- **Secrets:** Krisp key encrypted at rest, server-only; Blob token server-only (the client
  gets a scoped upload token); Drive via existing encrypted refresh tokens.
- **Tests (`npm run test:specs` harness, fake transports for Krisp/Blob/Drive):**
  `deriveSummary` on the Hortonville-shaped fixture + unknown block types + empty notes;
  `PREFILL_RULES` routing for ~12 titles; `matchAssignee`; both lifecycles' legal
  transitions incl. Retry from `failed` and the `400 still in process` requeue;
  `onRecordingReady` run twice → no duplicate note/assignment; `archiveRecordings` leaves
  Blob on Drive failure. Smoke: `/recordings/[id]` and the upload route's 503 gate.
- **Pilot gate:** `recordingsBetaUsers` limits the Record button to named users until a
  handful of real visits complete capture → upload → Krisp → write-back → archive.

## Out of scope (follow-ups to log in MASTER-QUESTIONS when built)

Krisp webhooks as a delivery accelerator; numeric extraction from summaries into typed
Survey fields; in-app audio playback (would need the Blob/Drive proxy); backfilling Jeff's
existing Krisp mobile recordings onto records (pull-and-match UI); per-rep Drive archives;
extending `AssignmentLink` kinds with `recording`/`site_visit`.

## Open items for Jeff (not blocking the plan)

1. Confirm the Krisp workspace seats are on Core/Advanced for every rep who will record.
2. Generate a **Write**-scope key on your own seat for the pilot.
3. Confirm `BLOB_READ_WRITE_TOKEN` is set in Vercel production (D116 was env-gated).
4. Pick the archive account (recommended: the shared sales mailbox) and grant it the Drive
   scope once the connect route ships.
