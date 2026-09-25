"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { removeCustomerNoteAction } from "../actions";

/** Delete control for one user-authored note in a customer's Activity feed. */
export default function NoteDeleteButton({ customerId, noteId }: { customerId: string; noteId: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="pk-btn-danger"
      label="Delete"
      confirmLabel="Confirm"
      style={{ fontSize: 10.5, padding: "4px 8px", flexShrink: 0 }}
      onConfirm={async () => {
        await removeCustomerNoteAction(customerId, noteId);
        router.refresh();
      }}
    />
  );
}
