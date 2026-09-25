"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteQuoteAction } from "./actions";

/**
 * Hub + builder-header delete control for a single quote (any type/status).
 * Kept as its own tiny component so other quote-detail screens (Estimator,
 * flame/repair/inspection/consulting/rental/grid builders) can drop it in
 * without importing the rest of the hub's client actions.
 */
export function DeleteQuoteButton({
  id,
  won,
  redirectTo,
}: {
  id: string;
  won?: boolean;
  /** Where to navigate after delete — omit to just refresh the current (list) view. */
  redirectTo?: string;
}) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="pk-btn-danger"
      label="Delete"
      confirmLabel={won ? "Delete quote (its project/jobs stay)" : "Confirm delete"}
      onConfirm={async () => {
        await deleteQuoteAction(id);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      }}
    />
  );
}
