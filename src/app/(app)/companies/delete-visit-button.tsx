"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { removeVisitAction } from "../venue-assessments/visit-actions";

/** Small icon-ish Delete control for a Site visits card row (customer
 *  record). Just refreshes in place — the row drops out of the list. */
export function DeleteVisitButton({ id, canDelete = true }: { id: string; canDelete?: boolean }) {
  const router = useRouter();
  // Jeff 2026-10-15 #35 — a scheduled visit someone else leads is read-only here (the server refuses too).
  if (!canDelete)
    return (
      <button type="button" className="pk-btn-danger" disabled title="Only the visit lead or an approver can change a scheduled visit" style={{ fontSize: 10.5, padding: "3px 8px", opacity: 0.5, cursor: "default" }}>
        Delete
      </button>
    );
  return (
    <ConfirmButton
      label="Delete"
      confirmLabel="Confirm"
      className="pk-btn-danger"
      style={{ fontSize: 10.5, padding: "3px 8px" }}
      onConfirm={async () => {
        const res = await removeVisitAction(id);
        if (!res.ok) throw new Error(res.error);
        router.refresh();
      }}
    />
  );
}
