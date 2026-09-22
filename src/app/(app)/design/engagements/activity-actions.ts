"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { softDeleteDoc } from "@/db/doc-store";
import { addNoteRecord, type FileRef } from "@/lib/stores/notes";
import { createTask } from "@/lib/stores/tasks";
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

export async function captureAction(input: CaptureInput): Promise<CaptureResult> {
  const me = await requireUser();
  const engagementId = input.engagementId;
  const text = (input.text || "").trim();
  const attachments = input.attachments || [];
  const tasks = (input.tasks || []).filter((t) => t.title.trim());

  if (!engagementId) return { ok: false, error: "No engagement to capture against." };
  if (!text && attachments.length === 0 && tasks.length === 0) {
    return { ok: false, error: "Nothing to capture." };
  }

  const createdTaskIds: string[] = [];
  try {
    let roster: Awaited<ReturnType<typeof activeUsers>> = [];
    if (tasks.some((t) => t.assigneeUserId)) roster = await activeUsers();

    for (const t of tasks) {
      const assigneeUserId = t.assigneeUserId || null;
      const assigneeName = assigneeUserId
        ? roster.find((u) => u.id === assigneeUserId)?.name || ""
        : "";
      const created = await createTask(
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

    const note = await addNoteRecord(
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
      await softDeleteDoc("tasks", id).catch(() => {});
    }
    throw err;
  }
}
