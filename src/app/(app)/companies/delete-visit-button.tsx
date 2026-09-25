"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { removeVisitAction } from "../venue-assessments/visit-actions";

/** Small icon-ish Delete control for a Site visits card row (customer
 *  record). Just refreshes in place — the row drops out of the list. */
export function DeleteVisitButton({ id }: { id: string }) {
  const router = useRouter();
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
