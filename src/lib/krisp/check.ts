import {
  getRecording,
  markKrispFailed,
  markKrispReady,
  markProcessing,
  touchChecked,
  type KrispStatus,
  type RecordingRecord,
} from "@/lib/stores/recordings";
import {
  createKrispClient,
  KRISP_MEETING_FIELDS,
  KrispAuthError,
  KrispNotReadyError,
  KrispRateLimitError,
  krispMeetingUrl,
  type KrispClient,
  type KrispMeeting,
} from "./client";
import { getKrispConnection, recordKrispError } from "./connections";
import { deriveSummary } from "./derive";
import { startKrispImport, type KrispImportDeps } from "./import";
import { onRecordingReady } from "./write-back";

/**
 * Poll-driven results (Recordings spec §3.1). One `checkRecording` is at most
 * two Krisp calls — `GET /import/{id}/status`, then `GET /meetings/{id}` once
 * the status reads `ready` — so the reconcile caps (≤ 5 per Krisp account
 * per pass) keep every pass under the 5 req/s account limit. Every path bumps
 * `lastCheckedAt` so the stale-check rotation moves on.
 *
 * A pending recording whose audio is already in Blob is started here first
 * (the relay may have been skipped by a missing key, a busy lock, or a dev
 * machine without the Blob webhook), then falls through to the poll.
 */

export type CheckResult = {
  status: KrispStatus;
  changed: boolean;
  /** Krisp answered 429 — the caller should stop polling this account for now. */
  rateLimited?: boolean;
};

/** The `markKrispReady` payload for a fetched meeting — pure, spec-tested. */
export function readyPayloadFromMeeting(meeting: KrispMeeting) {
  const derived = deriveSummary(meeting.notes);
  return {
    meetingId: meeting.id,
    meetingUrl: krispMeetingUrl(meeting.id),
    transcript: meeting.transcript,
    notes: meeting.notes,
    summary: derived.summary,
    keyPoints: derived.keyPoints,
    actionItems: derived.actionItems,
  };
}

export type PollOutcome =
  | { kind: "ready"; payload: ReturnType<typeof readyPayloadFromMeeting> }
  | { kind: "failed"; error: string }
  | { kind: "processing" }
  | { kind: "uploading" };

/**
 * The Krisp-facing half of a check, DB-free so the spec tests can drive it
 * with a fake transport: status → (meeting) → derived payload. Krisp errors
 * propagate to the caller, which owns the lifecycle mapping.
 */
export async function pollKrispImport(client: KrispClient, importId: string): Promise<PollOutcome> {
  const st = await client.importStatus(importId);
  if (st.status === "failed") return { kind: "failed", error: st.error || "Krisp reported the import failed." };
  if (st.status === "uploading") return { kind: "uploading" };
  if (st.status !== "ready" || !st.meetingId) return { kind: "processing" };
  const meeting = await client.meeting(st.meetingId, KRISP_MEETING_FIELDS);
  return { kind: "ready", payload: readyPayloadFromMeeting(meeting) };
}

export async function checkRecording(recId: string, deps: KrispImportDeps = {}): Promise<CheckResult> {
  let rec = await getRecording(recId);
  if (!rec) throw new Error("Recording not found.");
  const before = rec.krisp.status;

  if (before === "pending") {
    if (rec.audio.state !== "uploaded" || !rec.audio.blobPathname) return { status: before, changed: false };
    const started = await startKrispImport(recId, deps);
    rec = (await getRecording(recId)) ?? rec;
    if (!started.ok) return { status: rec.krisp.status, changed: rec.krisp.status !== before };
  }

  if (rec.krisp.status !== "importing" && rec.krisp.status !== "processing") {
    return { status: rec.krisp.status, changed: rec.krisp.status !== before };
  }
  return pollAndApply(rec, before, deps);
}

async function pollAndApply(
  rec: RecordingRecord,
  before: KrispStatus,
  deps: KrispImportDeps
): Promise<CheckResult> {
  const userId = rec.recordedByUserId;
  const importId = rec.krisp.importId;
  if (!importId) {
    await markKrispFailed(rec.id, "The Krisp import handle is missing — retry the import.");
    return { status: "failed", changed: true };
  }
  const conn = await getKrispConnection(userId);
  if (!conn) {
    // The import ran under a key that is gone; nothing to poll with. Leave it
    // for Retry once the rep reconnects (the record shows "Connect Krisp").
    await touchChecked(rec.id);
    return { status: rec.krisp.status, changed: false };
  }
  const client = createKrispClient(conn.apiKey, deps.transport);

  try {
    const outcome = await pollKrispImport(client, importId);
    switch (outcome.kind) {
      case "ready": {
        const updated = await markKrispReady(rec.id, outcome.payload);
        await recordKrispError(userId, null).catch(() => {});
        if (updated) {
          try {
            await onRecordingReady(updated);
          } catch (err) {
            // The status is already `ready`; Check now / Retry reruns the write-back (spec §4).
            console.error(`[krisp] write-back for ${rec.id} failed:`, err);
          }
        }
        return { status: "ready", changed: true };
      }
      case "failed":
        await markKrispFailed(rec.id, outcome.error);
        await recordKrispError(userId, outcome.error).catch(() => {});
        return { status: "failed", changed: true };
      case "processing":
        if (rec.krisp.status === "importing") {
          await markProcessing(rec.id);
          return { status: "processing", changed: before !== "processing" };
        }
        await touchChecked(rec.id);
        return { status: rec.krisp.status, changed: rec.krisp.status !== before };
      case "uploading":
      default:
        await touchChecked(rec.id);
        return { status: rec.krisp.status, changed: rec.krisp.status !== before };
    }
  } catch (err) {
    if (err instanceof KrispNotReadyError) {
      await touchChecked(rec.id);
      return { status: rec.krisp.status, changed: rec.krisp.status !== before };
    }
    if (err instanceof KrispRateLimitError) {
      await touchChecked(rec.id);
      return { status: rec.krisp.status, changed: rec.krisp.status !== before, rateLimited: true };
    }
    if (err instanceof KrispAuthError) {
      // Key revoked — the poll can never succeed under this key (spec §2.4 step 4).
      await markKrispFailed(rec.id, err.message);
      await recordKrispError(userId, err.message).catch(() => {});
      return { status: "failed", changed: true };
    }
    // Transient (5xx, network): keep polling next pass, surface the message on the connection.
    await touchChecked(rec.id);
    await recordKrispError(userId, (err as Error)?.message || "Krisp check failed.").catch(() => {});
    return { status: rec.krisp.status, changed: rec.krisp.status !== before };
  }
}
