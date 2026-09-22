"use server";

import { revalidatePath } from "next/cache";
import { checkRecording } from "@/lib/krisp/check";
import { startKrispImport } from "@/lib/krisp/import";
import { acceptActionItem, dismissActionItem, insertPrefill, postFeedNote } from "@/lib/krisp/write-back";
import { requireUser } from "@/lib/session";
import { getRecording, setKrispPendingForRetry, type KrispStatus, type RecordingRecord } from "@/lib/stores/recordings";

/**
 * Recording detail actions (Recordings spec §6 `/recordings/[id]` buttons +
 * §4 write-back gates). Capture-side actions (create / markUploaded) live in
 * ./capture-actions.ts. Every action is session-gated and ends with a
 * revalidate of the detail page; Accept also refreshes Home + My Queue since
 * the new assignment shows there.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const recPath = (id: string) => `/recordings/${id}`;

function errorText(err: unknown, fallback: string): string {
  const m = (err as Error)?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}

async function loadRecording(id: string): Promise<RecordingRecord> {
  const rec = await getRecording(id);
  if (!rec) throw new Error("Recording not found.");
  return rec;
}

/** "Check now" — one poll of Krisp for this recording (spec §3.1). */
export async function checkRecordingAction(
  id: string
): Promise<{ ok: boolean; status: KrispStatus | null; error?: string }> {
  await requireUser();
  try {
    const r = await checkRecording(id);
    revalidatePath(recPath(id));
    return { ok: true, status: r.status };
  } catch (err) {
    return { ok: false, status: null, error: errorText(err, "Could not check Krisp.") };
  }
}

/** "Retry import" — back to pending, then relay the Blob copy again (spec §2.4 step 4 / §3.3). */
export async function retryImportAction(id: string): Promise<ActionResult> {
  await requireUser();
  try {
    const rec = await loadRecording(id);
    if (rec.krisp.status === "ready") return { ok: false, error: "This recording is already transcribed." };
    if (rec.audio.state !== "uploaded" || !rec.audio.blobPathname) {
      return {
        ok: false,
        error:
          rec.audio.state === "archived"
            ? "The audio was archived to Drive before Krisp finished — nothing left in Blob to resend."
            : "The audio has not finished uploading yet.",
      };
    }
    await setKrispPendingForRetry(id);
    const r = await startKrispImport(id);
    revalidatePath(recPath(id));
    if (r.ok) return { ok: true };
    switch (r.reason) {
      case "no-connection":
        return { ok: false, error: r.message || "Connect Krisp in Account to transcribe." };
      case "no-blob":
        return { ok: false, error: r.message || "The audio is not in Blob storage." };
      case "busy":
        return {
          ok: false,
          error: "A Krisp import for this account is already in progress — it will be retried automatically.",
        };
      default:
        return { ok: false, error: r.message || "Krisp import failed." };
    }
  } catch (err) {
    return { ok: false, error: errorText(err, "Retry failed.") };
  }
}

/** Accept one action item into the Home Queue (spec §4.2). */
export async function acceptActionItemAction(
  id: string,
  key: string,
  assigneeUserId: string | null,
  dueAt: number | null
): Promise<{ ok: boolean; assignmentId?: string; error?: string }> {
  const user = await requireUser();
  try {
    const rec = await loadRecording(id);
    const r = await acceptActionItem(rec, key, assigneeUserId, dueAt, user.name);
    revalidatePath(recPath(id));
    revalidatePath("/");
    revalidatePath("/queue");
    return { ok: true, assignmentId: r.assignmentId };
  } catch (err) {
    return { ok: false, error: errorText(err, "Could not accept the action item.") };
  }
}

export async function dismissActionItemAction(id: string, key: string): Promise<ActionResult> {
  await requireUser();
  try {
    const rec = await loadRecording(id);
    await dismissActionItem(rec, key);
    revalidatePath(recPath(id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "Could not dismiss the action item.") };
  }
}

/** "Post to customer feed" — for a recording that skipped the note (no customer at ready time, spec §4.3). */
export async function postFeedNoteAction(id: string): Promise<{ ok: boolean; noteId?: string; error?: string }> {
  await requireUser();
  try {
    const rec = await loadRecording(id);
    if (!rec.customerId) return { ok: false, error: "This recording has no customer yet — link the visit to a customer first." };
    const r = await postFeedNote(rec);
    revalidatePath(recPath(id));
    revalidatePath(`/customers/${rec.customerId}`);
    return r.noteId ? { ok: true, noteId: r.noteId } : { ok: false, error: "The note could not be posted." };
  } catch (err) {
    return { ok: false, error: errorText(err, "Could not post the note.") };
  }
}

/** "Insert" one summary section into the linked Survey / Inspection (spec §4.4). */
export async function insertPrefillAction(id: string, sectionKey: string): Promise<ActionResult> {
  await requireUser();
  try {
    const rec = await loadRecording(id);
    const r = await insertPrefill(rec, sectionKey);
    revalidatePath(recPath(id));
    revalidatePath(r.target.kind === "survey" ? `/venue-assessments/${r.target.id}` : `/inspections/${r.target.id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "Could not insert the section.") };
  }
}
