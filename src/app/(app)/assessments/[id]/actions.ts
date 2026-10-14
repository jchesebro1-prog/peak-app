"use server";

import { revalidatePath } from "next/cache";
import { getOptionalUser, requirePerm } from "@/lib/session";
import { can } from "@/lib/team";
import { clearSyncRejects, completeAssessment, reopenAssessment, saveAssessment, type Assessment } from "@/lib/stores/assessments";
import type { SavePatch, SyncRejectVM } from "@/lib/assessments/editor-model";

/**
 * The editor's server actions (#337, Task 7). Saves never throw on a refusal and never redirect: the editor saves
 * through `saveThroughOutbox`, which counts a resolved promise as synced unless it is `{ ok: false, error }` (the
 * `ServerSaveResult` shape), and a redirect mid-visit would drop the answers still on screen. A missing session or
 * permission therefore comes back as `{ ok: false }` too. Every success carries the stored `rev` for the editor to
 * adopt (the rev contract).
 */

export type SaveReply = { ok: true; rev: number; dropped?: string[] } | { ok: false; error: string };
export type RejectsReply = { ok: true; rev: number; syncRejects: SyncRejectVM[] } | { ok: false; error: string };
export type CompleteReply = { ok: true } | { ok: false; gaps: string[]; uploading: number; error?: string };

async function editor(): Promise<{ id: string } | { error: string }> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in again to save. Your answers are still on this screen." };
  if (!can("create", user.roles)) return { error: "You don't have permission to edit assessments." };
  return { id: user.id };
}

export async function saveAssessmentAction(id: string, patch: SavePatch): Promise<SaveReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  if (!patch || typeof patch !== "object") return { ok: false, error: "Nothing to save" };
  const incoming: Partial<Assessment> = {};
  if (typeof patch.rev === "number") incoming.rev = patch.rev;
  if (patch.answers !== undefined) incoming.answers = patch.answers;
  if (patch.scopes !== undefined) incoming.scopes = patch.scopes;
  if (patch.spaceLabel !== undefined) incoming.spaceLabel = patch.spaceLabel;
  if (patch.accompanying !== undefined) incoming.accompanying = patch.accompanying;
  if (patch.photos !== undefined) incoming.photos = patch.photos;
  if (patch.dismissedPrompts !== undefined) incoming.dismissedPrompts = patch.dismissedPrompts;
  let r: Awaited<ReturnType<typeof saveAssessment>>;
  try {
    r = await saveAssessment(id, incoming, u, { mode: "action" });
  } catch {
    return { ok: false, error: "The assessment couldn't be saved. Try again." };
  }
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/assessments/${id}`);
  return r.dropped?.length ? { ok: true, rev: r.doc.rev, dropped: r.dropped } : { ok: true, rev: r.doc.rev };
}

/** The editor has shown or re-entered these sync rejects: remove them. */
export async function clearSyncRejectsAction(id: string, keys: string[]): Promise<RejectsReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  const r = await clearSyncRejects(id, Array.isArray(keys) ? keys.filter((k) => typeof k === "string").slice(0, 100) : [], u);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/assessments/${id}`);
  return { ok: true, rev: r.doc.rev, syncRejects: r.doc.syncRejects ?? [] };
}

/** Mark complete. Gaps refuse unless `override`; photos still uploading always refuse. */
export async function completeAssessmentAction(id: string, override: boolean): Promise<CompleteReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, gaps: [], uploading: 0, error: u.error };
  const r = await completeAssessment(id, u, override === true);
  if (r.ok) {
    revalidatePath(`/assessments/${id}`);
    revalidatePath("/assessments");
  }
  return r;
}

/** Completed → on site again. Needs `approve`. */
export async function reopenAssessmentAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePerm("approve");
  try {
    await reopenAssessment(id, user);
  } catch {
    return { ok: false, error: "Assessment not found" };
  }
  revalidatePath(`/assessments/${id}`);
  revalidatePath("/assessments");
  return { ok: true };
}
