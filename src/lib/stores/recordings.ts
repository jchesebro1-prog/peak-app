import { getDoc, insertWithPrefixedId, listDocs, patchDoc, softDeleteDoc } from "@/db/doc-store";

/**
 * Recordings (Krisp recordings spec §1.1 —
 * docs/superpowers/specs/2026-09-21-krisp-recordings-design.md). One doc per
 * in-app audio capture against a field record: the rep records inside the
 * Peak App, the file is staged in Vercel Blob, the server relays it to the
 * recorder's own Krisp account, results are polled back, and the audio is
 * archived to Google Drive nightly. `REC-####`, base 9000; migration 0021.
 *
 * The two lifecycles — `audio` (on_device → uploaded → archived) and
 * `krisp` (pending → importing → processing → ready | failed) — are
 * INDEPENDENT fields: audio can be archived while Krisp failed, and Krisp
 * can be ready while the audio still awaits the nightly archive job.
 *
 * `notes` is Krisp's block tree stored RAW (the `type` enum is unpublished);
 * `summary` / `keyPoints` / `actionItems` are derived from it by
 * `lib/krisp/derive.ts` and re-derived on every rerun — except that action
 * items keep their disposition/assignmentId by `key` (mergeActionItems),
 * which is what makes `onRecordingReady` idempotent (spec §4, §7).
 */

export type RecordingParentKind =
  | "site_visit"
  | "survey"
  | "inspection"
  | "flame_job"
  | "repair_job"
  | "project"
  | "engagement";

export const RECORDING_PARENT_KINDS: RecordingParentKind[] = [
  "site_visit",
  "survey",
  "inspection",
  "flame_job",
  "repair_job",
  "project",
  "engagement",
];

export type AudioState = "on_device" | "uploaded" | "archived";
export type KrispStatus = "pending" | "importing" | "processing" | "ready" | "failed";

/** Krisp `Participant` — the published fields plus whatever else Krisp sends. */
export type KrispParticipant = {
  name?: string;
  email?: string;
  [k: string]: unknown;
};

/** Krisp `NoteBlock` — `type` is an UNPUBLISHED enum; never branch on it exhaustively. */
export type KrispNoteBlock = {
  type: string;
  text?: string;
  completed?: boolean;
  assignee?: unknown;
  due_date?: string | null;
  children?: KrispNoteBlock[];
  [k: string]: unknown;
};

export type RecordingTranscript = {
  language: string;
  speakers: Record<string, KrispParticipant>;
  segments: { speaker: number; text: string; start: number; end: number }[];
};

export type ActionItemDisposition = "pending" | "accepted" | "dismissed";

export type RecordingActionItem = {
  /** stable hash of (normalized title, ordinal) — Krisp blocks have no id (derive.ts). */
  key: string;
  title: string;
  /** as Krisp wrote it; matched to a Peak user at accept time (matchAssignee). */
  assigneeName: string | null;
  dueDate: string | null;
  disposition: ActionItemDisposition;
  /** set on accept (spec §4.2) — the idempotency key against the Home Queue. */
  assignmentId: string | null;
};

export type RecordingSummarySection = { title: string; description: string };

export type RecordingAudio = {
  state: AudioState;
  blobPathname: string | null; // set at "uploaded", cleared at "archived"
  uploadError: string | null;
  driveFileId: string | null;
  driveLink: string | null; // webViewLink
  archivedAt: number | null;
  archiveError: string | null;
};

export type RecordingKrisp = {
  status: KrispStatus;
  krispUserId: number | null; // whose account it was imported under
  importId: string | null;
  meetingId: string | null;
  meetingUrl: string | null;
  error: string | null;
  lastCheckedAt: number | null;
  readyAt: number | null;
};

export type RecordingRecord = {
  id: string; // "REC-####" (or a client-minted "rec-<uuid>" from the offline outbox)
  parentKind: RecordingParentKind;
  parentId: string; // SV-…, FS-…, INS-…, FT-…, R-…, P-…, E-…
  // denormalised from the parent at creation — no joins for feed/search/detail
  customerId: string | null;
  customer: string;
  locationId: string | null;
  venue: string;
  title: string; // what Krisp shows: "SV-5012 · Hortonville HS · Site survey · 2026-09-21"

  recordedByUserId: string; // users.id
  recordedByName: string;
  startedAt: number;
  endedAt: number;
  durationS: number;
  mime: string; // "audio/mp4" | "audio/wav" | "audio/webm" (web fallback)
  sizeBytes: number;

  audio: RecordingAudio;
  krisp: RecordingKrisp;

  transcript: RecordingTranscript | null;
  notes: { blocks: KrispNoteBlock[] } | null; // stored RAW, never reshaped
  summary: RecordingSummarySection[]; // derived (deriveSummary)
  keyPoints: string[]; // derived

  actionItems: RecordingActionItem[];
  feedNoteId: string | null;
  prefill: { insertedKeys: string[] }; // summary section keys already inserted

  createdAt: number;
  updatedAt: number;
};

const now = () => Date.now();

/* ---------- normalize-on-read ---------- */

const AUDIO_STATES: AudioState[] = ["on_device", "uploaded", "archived"];
const KRISP_STATUSES: KrispStatus[] = ["pending", "importing", "processing", "ready", "failed"];
const DISPOSITIONS: ActionItemDisposition[] = ["pending", "accepted", "dismissed"];

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function blankAudio(): RecordingAudio {
  return {
    state: "on_device",
    blobPathname: null,
    uploadError: null,
    driveFileId: null,
    driveLink: null,
    archivedAt: null,
    archiveError: null,
  };
}

export function blankKrisp(): RecordingKrisp {
  return {
    status: "pending",
    krispUserId: null,
    importId: null,
    meetingId: null,
    meetingUrl: null,
    error: null,
    lastCheckedAt: null,
    readyAt: null,
  };
}

function normalizeActionItem(raw: unknown): RecordingActionItem | null {
  const a = (raw && typeof raw === "object" ? raw : {}) as Partial<RecordingActionItem>;
  if (typeof a.key !== "string" || !a.key || typeof a.title !== "string") return null;
  return {
    key: a.key,
    title: a.title,
    assigneeName: strOrNull(a.assigneeName),
    dueDate: strOrNull(a.dueDate),
    disposition: DISPOSITIONS.includes(a.disposition as ActionItemDisposition)
      ? (a.disposition as ActionItemDisposition)
      : "pending",
    assignmentId: strOrNull(a.assignmentId),
  };
}

/**
 * Backfill on read (the normalizeVisit idiom): a doc minted offline by the
 * outbox, or written by an older build, still reads with every subobject
 * and array present so screens never null-check the shape.
 */
export function normalizeRecording(
  raw: Partial<RecordingRecord> & { id: string }
): RecordingRecord {
  const at = raw.createdAt ?? now();
  const audioRaw = (raw.audio && typeof raw.audio === "object" ? raw.audio : {}) as Partial<RecordingAudio>;
  const krispRaw = (raw.krisp && typeof raw.krisp === "object" ? raw.krisp : {}) as Partial<RecordingKrisp>;
  const audio: RecordingAudio = {
    ...blankAudio(),
    ...audioRaw,
    state: AUDIO_STATES.includes(audioRaw.state as AudioState) ? (audioRaw.state as AudioState) : "on_device",
  };
  const krisp: RecordingKrisp = {
    ...blankKrisp(),
    ...krispRaw,
    status: KRISP_STATUSES.includes(krispRaw.status as KrispStatus) ? (krispRaw.status as KrispStatus) : "pending",
  };
  const prefillRaw = (raw.prefill && typeof raw.prefill === "object" ? raw.prefill : {}) as Partial<
    RecordingRecord["prefill"]
  >;
  return {
    id: raw.id,
    parentKind: RECORDING_PARENT_KINDS.includes(raw.parentKind as RecordingParentKind)
      ? (raw.parentKind as RecordingParentKind)
      : "site_visit",
    parentId: raw.parentId ?? "",
    customerId: raw.customerId ?? null,
    customer: raw.customer ?? "",
    locationId: raw.locationId ?? null,
    venue: raw.venue ?? "",
    title: raw.title ?? raw.id,
    recordedByUserId: raw.recordedByUserId ?? "",
    recordedByName: raw.recordedByName ?? "",
    startedAt: numOrNull(raw.startedAt) ?? at,
    endedAt: numOrNull(raw.endedAt) ?? numOrNull(raw.startedAt) ?? at,
    durationS: numOrNull(raw.durationS) ?? 0,
    mime: raw.mime ?? "audio/mp4",
    sizeBytes: numOrNull(raw.sizeBytes) ?? 0,
    audio,
    krisp,
    transcript: raw.transcript && typeof raw.transcript === "object" ? raw.transcript : null,
    notes:
      raw.notes && typeof raw.notes === "object" && Array.isArray(raw.notes.blocks) ? raw.notes : null,
    summary: Array.isArray(raw.summary)
      ? raw.summary
          .filter((s) => s && typeof s === "object")
          .map((s) => ({ title: String(s.title ?? ""), description: String(s.description ?? "") }))
      : [],
    keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints.filter((k) => typeof k === "string") : [],
    actionItems: Array.isArray(raw.actionItems)
      ? (raw.actionItems.map(normalizeActionItem).filter(Boolean) as RecordingActionItem[])
      : [],
    feedNoteId: raw.feedNoteId ?? null,
    prefill: {
      insertedKeys: Array.isArray(prefillRaw.insertedKeys)
        ? prefillRaw.insertedKeys.filter((k) => typeof k === "string")
        : [],
    },
    createdAt: at,
    updatedAt: raw.updatedAt ?? at,
  };
}

/* ---------- reads ---------- */

export async function allRecordings(): Promise<RecordingRecord[]> {
  const list = await listDocs<RecordingRecord>("recordings");
  return list.map(normalizeRecording).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getRecording(id: string): Promise<RecordingRecord | null> {
  const doc = await getDoc<RecordingRecord>("recordings", id);
  return doc ? normalizeRecording(doc) : null;
}

export async function recordingsForParent(
  kind: RecordingParentKind,
  parentId: string
): Promise<RecordingRecord[]> {
  return (await allRecordings()).filter((r) => r.parentKind === kind && r.parentId === parentId);
}

export async function recordingsForCustomer(customerId: string): Promise<RecordingRecord[]> {
  return (await allRecordings()).filter((r) => r.customerId === customerId);
}

/** Pure predicate behind processingRecordings — exported for the spec tests. */
export function needsKrispCheck(
  rec: Pick<RecordingRecord, "krisp">,
  olderThanMs?: number,
  at: number = now()
): boolean {
  const s = rec.krisp.status;
  if (s !== "importing" && s !== "processing") return false;
  if (olderThanMs === undefined) return true;
  const last = rec.krisp.lastCheckedAt;
  return last === null || last < at - olderThanMs;
}

/**
 * Recordings the poller should ask Krisp about (spec §3.2): importing or
 * processing, and — when `olderThanMs` is given — not checked within that
 * window (never-checked counts as stale). Oldest check first so a capped
 * pass (≤ 5 per Krisp account) rotates through them.
 */
export async function processingRecordings(opts: { olderThanMs?: number } = {}): Promise<RecordingRecord[]> {
  const at = now();
  return (await allRecordings())
    .filter((r) => needsKrispCheck(r, opts.olderThanMs, at))
    .sort((a, b) => (a.krisp.lastCheckedAt ?? 0) - (b.krisp.lastCheckedAt ?? 0));
}

/** Pure predicate behind archivableRecordings — exported for the spec tests. */
export function isArchivable(
  rec: Pick<RecordingRecord, "audio" | "krisp" | "updatedAt">,
  olderThanMs: number,
  at: number = now()
): boolean {
  if (rec.audio.state !== "uploaded") return false;
  if (rec.krisp.status !== "ready" && rec.krisp.status !== "failed") return false;
  const settled = rec.krisp.readyAt ?? rec.updatedAt;
  return settled < at - olderThanMs;
}

/**
 * Nightly archive candidates (spec §5.2): audio still in Blob, Krisp settled
 * (ready OR failed — a failed import keeps its audio), settled longer than
 * `olderThanMs` ago (room for same-day retries). Oldest first; the caller caps.
 */
export async function archivableRecordings(olderThanMs: number): Promise<RecordingRecord[]> {
  const at = now();
  return (await allRecordings())
    .filter((r) => isArchivable(r, olderThanMs, at))
    .sort((a, b) => (a.krisp.readyAt ?? a.updatedAt) - (b.krisp.readyAt ?? b.updatedAt));
}

/* ---------- create ---------- */

export type CreateRecordingInput = {
  parentKind: RecordingParentKind;
  parentId: string;
  customerId: string | null;
  customer: string;
  locationId: string | null;
  venue: string;
  title: string;
  recordedByUserId: string;
  recordedByName: string;
  startedAt: number;
  endedAt: number;
  durationS: number;
  mime: string;
  sizeBytes: number;
};

/** Mint `REC-####` with audio on_device / Krisp pending (spec §2.2 step 1). */
export async function createRecording(input: CreateRecordingInput): Promise<RecordingRecord> {
  const at = now();
  return insertWithPrefixedId<RecordingRecord>("recordings", "REC", 9000, (id) =>
    normalizeRecording({
      id,
      parentKind: input.parentKind,
      parentId: input.parentId,
      customerId: input.customerId,
      customer: input.customer,
      locationId: input.locationId,
      venue: input.venue,
      title: input.title,
      recordedByUserId: input.recordedByUserId,
      recordedByName: input.recordedByName,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationS: input.durationS,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      audio: blankAudio(),
      krisp: blankKrisp(),
      transcript: null,
      notes: null,
      summary: [],
      keyPoints: [],
      actionItems: [],
      feedNoteId: null,
      prefill: { insertedKeys: [] },
      createdAt: at,
      updatedAt: at,
    })
  );
}

/**
 * Delete a recording (soft delete — the RECORD only). Deliberately does not
 * touch the audio: Blob storage (audio.blobPathname) or the Drive archive
 * (audio.driveFileId) are left exactly as they are — Krisp import/transcript
 * state is likewise untouched, since a poller catching a still-"importing"
 * row mid-delete must not error, it should just find the tombstone on its
 * next read and stop. Nothing spawns or sweeps recordings from another
 * record, so there is no tombstone-coverage concern here (unlike the
 * flame/repair/inspection job stores).
 */
export async function removeRecording(id: string): Promise<void> {
  await softDeleteDoc("recordings", id);
}

/* ---------- mutations (each bumps updatedAt) ---------- */

async function patch(
  id: string,
  mutate: (r: RecordingRecord) => void
): Promise<RecordingRecord | null> {
  return patchDoc<RecordingRecord>("recordings", id, (doc) => {
    const r = normalizeRecording(doc);
    mutate(r);
    r.updatedAt = now();
    return r;
  });
}

/* audio lifecycle */

export async function markUploaded(id: string, blobPathname: string, sizeBytes: number) {
  return patch(id, (r) => {
    // idempotent: the Blob webhook and the client fallback may both land (spec §2.3)
    if (r.audio.state === "archived") return;
    r.audio.state = "uploaded";
    r.audio.blobPathname = blobPathname;
    r.audio.uploadError = null;
    if (sizeBytes > 0) r.sizeBytes = sizeBytes;
  });
}

export async function markUploadError(id: string, message: string) {
  return patch(id, (r) => {
    r.audio.uploadError = message;
  });
}

export async function markArchived(id: string, drive: { driveFileId: string; driveLink: string }) {
  return patch(id, (r) => {
    r.audio.state = "archived";
    r.audio.driveFileId = drive.driveFileId;
    r.audio.driveLink = drive.driveLink;
    r.audio.archivedAt = now();
    r.audio.archiveError = null;
    r.audio.blobPathname = null; // Blob deleted strictly after Drive returned an id (spec §5.2)
  });
}

export async function markArchiveError(id: string, message: string) {
  return patch(id, (r) => {
    r.audio.archiveError = message;
  });
}

/* krisp lifecycle */

export async function markImporting(id: string, info: { importId: string; krispUserId: number | null }) {
  return patch(id, (r) => {
    r.krisp.status = "importing";
    r.krisp.importId = info.importId;
    r.krisp.krispUserId = info.krispUserId;
    r.krisp.error = null;
    r.krisp.lastCheckedAt = now();
  });
}

export async function markProcessing(id: string) {
  return patch(id, (r) => {
    r.krisp.status = "processing";
    r.krisp.error = null;
    r.krisp.lastCheckedAt = now();
  });
}

export async function markKrispFailed(id: string, error: string) {
  return patch(id, (r) => {
    r.krisp.status = "failed";
    r.krisp.error = error;
    r.krisp.lastCheckedAt = now();
  });
}

/** Incoming action items from deriveSummary — no disposition yet. */
export type IncomingActionItem = Pick<RecordingActionItem, "key" | "title" | "assigneeName" | "dueDate">;

/**
 * Merge freshly-derived action items over the stored ones BY KEY (spec §4.1:
 * "existing dispositions are preserved by key on rerun"). Incoming order
 * wins; an existing item that vanished from the rerun is kept only if it
 * already carries state (accepted/dismissed) — dropping an accepted item
 * would orphan its Home Queue assignment link.
 */
export function mergeActionItems(
  existing: RecordingActionItem[],
  incoming: IncomingActionItem[]
): RecordingActionItem[] {
  const byKey = new Map(existing.map((a) => [a.key, a]));
  const seen = new Set<string>();
  const out: RecordingActionItem[] = incoming.map((n) => {
    seen.add(n.key);
    const prev = byKey.get(n.key);
    return {
      key: n.key,
      title: n.title,
      assigneeName: n.assigneeName ?? null,
      dueDate: n.dueDate ?? null,
      disposition: prev?.disposition ?? "pending",
      assignmentId: prev?.assignmentId ?? null,
    };
  });
  for (const a of existing) {
    if (!seen.has(a.key) && a.disposition !== "pending") out.push(a);
  }
  return out;
}

export async function markKrispReady(
  id: string,
  result: {
    meetingId: string;
    meetingUrl: string;
    transcript: RecordingTranscript | null;
    notes: { blocks: KrispNoteBlock[] } | null;
    summary: RecordingSummarySection[];
    keyPoints: string[];
    actionItems: IncomingActionItem[];
  }
) {
  return patch(id, (r) => {
    r.krisp.status = "ready";
    r.krisp.meetingId = result.meetingId;
    r.krisp.meetingUrl = result.meetingUrl;
    r.krisp.error = null;
    r.krisp.lastCheckedAt = now();
    r.krisp.readyAt = r.krisp.readyAt ?? now(); // first-ready wins (archive timer, spec §5.2)
    r.transcript = result.transcript;
    r.notes = result.notes;
    r.summary = result.summary;
    r.keyPoints = result.keyPoints;
    r.actionItems = mergeActionItems(r.actionItems, result.actionItems);
  });
}

export async function touchChecked(id: string) {
  return patch(id, (r) => {
    r.krisp.lastCheckedAt = now();
  });
}

/** Retry (spec §2.4 step 4 / §3.3): back to pending, clear the import handle + error. */
export async function setKrispPendingForRetry(id: string) {
  return patch(id, (r) => {
    r.krisp.status = "pending";
    r.krisp.importId = null;
    r.krisp.error = null;
  });
}

/* write-back bookkeeping */

export async function setActionItemDisposition(
  id: string,
  key: string,
  disposition: ActionItemDisposition,
  assignmentId?: string | null
) {
  return patch(id, (r) => {
    const item = r.actionItems.find((a) => a.key === key);
    if (!item) return;
    item.disposition = disposition;
    if (assignmentId !== undefined) item.assignmentId = assignmentId;
    if (disposition !== "accepted" && assignmentId === undefined) item.assignmentId = null;
  });
}

export async function setFeedNoteId(id: string, noteId: string | null) {
  return patch(id, (r) => {
    r.feedNoteId = noteId;
  });
}

export async function addPrefillInserted(id: string, key: string) {
  return patch(id, (r) => {
    if (!r.prefill.insertedKeys.includes(key)) r.prefill.insertedKeys.push(key);
  });
}

/* ---------- labels ---------- */

export const RECORDING_PARENT_LABEL: Record<RecordingParentKind, string> = {
  site_visit: "Site visit",
  survey: "Field survey",
  inspection: "Inspection",
  flame_job: "Flame test",
  repair_job: "Repair",
  project: "Project",
  engagement: "Engagement",
};

export function recordingParentLabel(kind: RecordingParentKind): string {
  return RECORDING_PARENT_LABEL[kind] ?? "Record";
}

export type RecordingStatusChip =
  | "On device"
  | "Uploading"
  | "Transcribing"
  | "Ready"
  | "Failed"
  | "Stalled"
  | "Archived";

export const RECORDING_STALL_MS = 24 * 60 * 60_000;

/**
 * One chip over both lifecycles (spec §6 RecordingsCard). Precedence:
 * Archived (audio archived AND Krisp ready) > Failed (Krisp failed) >
 * On device / Uploading (audio still on the device — "On device" once an
 * upload attempt has errored, "Uploading" while the queue is draining) >
 * Stalled (processing, untouched for 24 h — spec §3.3) > Transcribing
 * (importing / processing, or pending after upload while the relay starts)
 * > Ready. Audio archived with Krisp never started reads Archived.
 */
export function recordingStatusChip(
  rec: Pick<RecordingRecord, "audio" | "krisp" | "updatedAt">,
  at: number = now()
): RecordingStatusChip {
  const { audio, krisp } = rec;
  if (audio.state === "archived" && krisp.status === "ready") return "Archived";
  if (krisp.status === "failed") return "Failed";
  if (audio.state === "on_device") return audio.uploadError ? "On device" : "Uploading";
  if (krisp.status === "processing" || krisp.status === "importing") {
    const touched = krisp.lastCheckedAt ?? rec.updatedAt;
    if (krisp.status === "processing" && touched < at - RECORDING_STALL_MS) return "Stalled";
    return "Transcribing";
  }
  if (krisp.status === "ready") return "Ready";
  // pending after upload: the relay hasn't started (or no Krisp key yet)
  return audio.state === "archived" ? "Archived" : "Transcribing";
}
