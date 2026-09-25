"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { removeNoteAction } from "./actions";

/** Delete control for one field note on a project record (soft delete —
 *  flags the embedded entry; see removeNote, lib/stores/projects.ts).
 *  Mirrors companies/[id]/note-delete-button.tsx for the customer-notes
 *  collection, but calls the project-scoped action since ProjectNote lives
 *  embedded on the project doc rather than in its own collection. */
export function NoteDeleteButton({ projectId, noteId }: { projectId: string; noteId: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="pk-btn-danger"
      label="Delete"
      confirmLabel="Confirm"
      style={{ fontSize: 10.5, padding: "3px 7px", flexShrink: 0 }}
      onConfirm={async () => {
        await removeNoteAction(projectId, noteId);
        router.refresh();
      }}
    />
  );
}
