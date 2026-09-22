"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type SessionUser } from "@/lib/session";
import { softDeleteDoc } from "@/db/doc-store";
import { addNoteRecord, type FileRef } from "@/lib/stores/notes";
import { createTask } from "@/lib/stores/tasks";
import { getEngagement } from "@/lib/stores/engagements";
import { activeUsers } from "@/lib/users";

/**
 * #145 D170 — the unified composer's server action. One capture writes a
 * note plus the (optional) tasks it spawned, linked to each other, in one
 * action: `addNoteRecord`'s `taskIds` carries the tasks this note spawned,
 * so a task's origin stays answerable from the feed.
 *
 * A hand-entered task is `handScheduled: true` with no template provenance
 * (`schedule: null`) — a later milestone-shift (`shiftForMilestone`,
 * lib/consulting-schedule.ts) must never sweep it (D168): that flag is the
 * whole point.
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

export async function captureAction(input: CaptureInput): Promise<CaptureResult> {
  const me = await requireUser();
  return performCapture(input, me);
}

/**
 * The writer core, split out from `captureAction` so it can be exercised
 * directly by the spec harness without a request context (`requireUser()`
 * needs one; this doesn't — it takes `me` as a plain argument instead).
 * `captureAction` above is the only production caller.
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

  // TODO (#145 D171, blocking on Task 9): validate `attachments` against
  // this engagement BEFORE any write, so a hand-built FileRef the caller
  // was never issued (e.g. `{kind:"drive", fileId:"<any id>"}`) can't be
  // planted here for the download proxy to later trust. Task 9 is adding
  // `validateFileRefsForEngagement(refs, engagementId): Promise<FileRef[]>`
  // (throws on the first invalid ref) to a new server-only module,
  // `src/lib/consulting-files-server.ts` — call it first thing inside the
  // try below once that module lands:
  //
  //   const { validateFileRefsForEngagement } = await import("@/lib/consulting-files-server");
  //   let validatedAttachments: FileRef[];
  //   try {
  //     validatedAttachments = await validateFileRefsForEngagement(attachments, engagementId);
  //   } catch (err) {
  //     return { ok: false, error: err instanceof Error ? err.message : "Invalid attachment." };
  //   }
  //   // ...then use validatedAttachments in place of `attachments` below.
  //
  // Do not invent a different shape here — the module doesn't exist yet in
  // this worktree (checked: absent both here and on Task 9's own branch as
  // of this fix), so wiring it now would mean guessing its contract. Left
  // as this exact call site instead of skipped, so it's a one-line swap
  // once Task 9 lands and this comment can go.

  const createdTaskIds: string[] = [];
  try {
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
        attachments,
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
