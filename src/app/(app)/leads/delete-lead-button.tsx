"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteLeadAction } from "./actions";

/**
 * #280 — compact two-step Delete for a Table-view lead row. Soft delete; the
 * server action is gated on `create`, this button is only rendered for those users.
 */
export function DeleteLeadButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="pk-btn-danger"
      label="Delete"
      confirmLabel="Confirm"
      style={{ fontSize: 11, padding: "5px 9px" }}
      ariaLabel={`Delete ${name}`}
      title="Delete this lead"
      onConfirm={async () => {
        const res = await deleteLeadAction(id);
        if (!res.ok) throw new Error(res.error);
        router.refresh();
      }}
    />
  );
}
