"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  type AssignmentLink,
  createAssignment,
  setAssignmentDone,
  updateAssignment,
} from "@/lib/stores/assignments";

/**
 * My Queue actions (D93) — assignments only. Every other queue row is
 * derived from a real record and is completed by doing the real work on its
 * own screen, which is why there is no "complete queue item" action here.
 */

type Result = { ok: true } | { ok: false; error: string };

export async function createAssignmentAction(input: {
  title: string;
  assignee: string;
  dueDate?: number;
  link?: AssignmentLink;
  source?: string;
}): Promise<Result> {
  const user = await requireUser();
  const title = String(input?.title || "").trim();
  if (!title) return { ok: false, error: "The assignment needs a title." };
  const assignee = String(input?.assignee || "").trim() || user.name;
  try {
    await createAssignment({
      title,
      assignee,
      createdBy: user.name,
      dueDate: Number(input?.dueDate) || 0,
      link: input?.link || null,
      source: input?.source,
    });
  } catch (error) {
    console.error("createAssignmentAction: assignment mint failed", error);
    return { ok: false, error: "Couldn’t create the assignment — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setAssignmentDoneAction(
  id: string,
  done: boolean
): Promise<Result> {
  await requireUser();
  try {
    await setAssignmentDone(id, done, "app");
  } catch (error) {
    console.error("setAssignmentDoneAction: assignment update failed", error);
    return { ok: false, error: "Couldn’t update the assignment — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateAssignmentAction(
  id: string,
  patch: { title?: string; assignee?: string; dueDate?: number }
): Promise<Result> {
  await requireUser();
  try {
    await updateAssignment(id, patch);
  } catch (error) {
    console.error("updateAssignmentAction: assignment update failed", error);
    return { ok: false, error: "Couldn’t update the assignment — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
