import { revalidatePath } from "next/cache";
import type { SessionUser } from "@/lib/session";
import { softDeleteDoc } from "@/db/doc-store";
import { addNoteRecord } from "@/lib/stores/notes";
import type { FileRef } from "@/lib/consulting-files";
import { createTask } from "@/lib/stores/tasks";
import { getEngagement } from "@/lib/stores/engagements";
import { activeUsers } from "@/lib/users";
import { validateFileRefsForEngagement } from "@/lib/consulting-files-server";

/**
 * #145 D170/D171 — the unified composer's writer core. SERVER-ONLY (touches
 * the DB directly; never import from a "use client" file — same lesson as
 * `customer-feed.ts`). Deliberately NOT in the `"use server"` actions file
 * either: every function exported from a `"use server"` module is
 * reachable via a direct POST request regardless of whether the app's own
 * UI ever calls it (Next 16 docs, data-security.md:279-291) — obscurity of
 * the name is explicitly called out there as insufficient. `performCapture`
 * takes the caller's identity as a plain `me` argument and never
 * authenticates on its own, so it must never itself be a POST-reachable
 * entry point. `src/app/(app)/design/engagements/activity-actions.ts`'s
 * `captureAction` is the ONLY authenticated entry point (it calls
 * `requireUser()` first, then delegates here) and the ONLY thing exported
 * from that file. This is the Data Access Layer pattern those same docs
 * recommend (data-security.md:396-433).
 *
 * One capture writes a note plus the (optional) tasks it spawned, linked
 * to each other: `addNoteRecord`'s `taskIds` carries the tasks this note
 * spawned, so a task's origin stays answerable from the feed.
 *
 * A hand-entered task is `handScheduled: true` with no template provenance
 * (`schedule: null`) — a later milestone-shift (`shiftForMilestone`,
 * lib/consulting-schedule.ts) must never sweep it (D168): that flag is the
 * whole point.
 *
 * Attachment validation: every `FileRef` must be PROVEN to belong to this
 * engagement (`validateFileRefsForEngagement`, D171) before anything is
 * persisted — a client-supplied ref is otherwise a way to plant a ref the
 * download proxy will later trust. Runs first, inside the same `try` as
 * the writes, so a refusal rolls back cleanly (nothing has been created
 * yet). The refusal returned to the caller is generic on purpose: the
 * real validator's per-kind messages name storage paths / Drive folder
 * internals a caller has no business seeing.
 *
 * Rollback: if the note write throws after one or more tasks were already
 * created, those tasks are deleted before the error is rethrown — a
 * half-written capture must never leave orphan tasks pointing at a note
 * that doesn't exist.
 */

export type CaptureTaskInput = {
  title: string;
  assigneeUserId: string | null;
  dueAt: number | null;
};

export type CaptureInput = {
  engagementId: string;
  text: string;
  attachments: FileRef[];
  tasks: CaptureTaskInput[];
};

export type CaptureResult =
  | { ok: true; noteId: string; taskIds: string[] }
  | { ok: false; error: string };

/** The store calls `performCapture` writes through — swappable so the spec
 *  harness can force a mid-capture failure (a real DB write for the first
 *  task, a thrown error on the second) and verify the rollback actually
 *  deletes what it created, rather than only reading correct-looking code.
 *  Defaults to the real store functions; `captureAction` never overrides
 *  this — only the test harness does. */
export type CaptureDeps = {
  createTask: typeof createTask;
  addNoteRecord: typeof addNoteRecord;
  softDeleteDoc: typeof softDeleteDoc;
};

/**
 * The writer core, callable directly (with injected `deps` and a plain
 * `me`) by the spec harness — an ordinary module import, not an RPC entry
 * point, so this stays testable without a request context even though it
 * is no longer reachable from a client at all. `captureAction` is the
 * only production caller.
 */
export async function performCapture(
  input: CaptureInput,
  me: Pick<SessionUser, "id" | "name">,
  deps: CaptureDeps = { createTask, addNoteRecord, softDeleteDoc }
): Promise<CaptureResult> {
  const engagementId = input.engagementId;
  const text = (input.text || "").trim();
  const attachments = input.attachments || [];
  const tasks = (input.tasks || []).filter((t) => t.title.trim());

  if (!engagementId) return { ok: false, error: "No engagement to capture against." };
  if (!(await getEngagement(engagementId))) {
    return { ok: false, error: "Engagement not found." };
  }
  if (!text && attachments.length === 0 && tasks.length === 0) {
    return { ok: false, error: "Nothing to capture." };
  }

  const createdTaskIds: string[] = [];
  try {
    let validatedAttachments: FileRef[];
    try {
      validatedAttachments = await validateFileRefsForEngagement(attachments, engagementId);
    } catch {
      return { ok: false, error: "One or more attachments couldn't be verified for this engagement and were rejected." };
    }

    let roster: Awaited<ReturnType<typeof activeUsers>> = [];
    if (tasks.some((t) => t.assigneeUserId)) roster = await activeUsers();

    for (const t of tasks) {
      const assigneeUserId = t.assigneeUserId || null;
      const assigneeName = assigneeUserId
        ? roster.find((u) => u.id === assigneeUserId)?.name || ""
        : "";
      const created = await deps.createTask(
        {
          title: t.title.trim(),
          engagementId,
          assigneeUserId,
          assigneeName,
          dueAt: t.dueAt ?? null,
          schedule: null,
          handScheduled: true,
        },
        me
      );
      createdTaskIds.push(created.id);
    }

    const note = await deps.addNoteRecord(
      {
        parentKind: "engagement",
        parentId: engagementId,
        customerId: null,
        text,
        attachments: validatedAttachments,
        taskIds: createdTaskIds,
      },
      me.name
    );

    revalidatePath(`/design/engagements/${encodeURIComponent(engagementId)}`);
    revalidatePath("/schedule");
    return { ok: true, noteId: note.id, taskIds: createdTaskIds };
  } catch (err) {
    for (const id of createdTaskIds) {
      await deps.softDeleteDoc("tasks", id).catch(() => {});
    }
    throw err;
  }
}
