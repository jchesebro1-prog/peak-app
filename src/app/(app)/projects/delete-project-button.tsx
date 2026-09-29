"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { removeProjectAction } from "./actions";

/** Delete control (soft delete, #169-safe against the quote spawn sweep) —
 *  used in the detail header (navigates back to the book via `backHref`) and
 *  on the list cards (#277, `compact`; `backHref` only when deleting the
 *  project that's currently open). Always refreshes on success. */
export function DeleteProjectButton({
  id,
  backHref,
  compact,
  ariaLabel,
}: {
  id: string;
  backHref?: string;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Delete"
      confirmLabel="Confirm delete"
      ariaLabel={ariaLabel}
      style={compact ? { fontSize: 11.5, padding: "4px 10px" } : undefined}
      onConfirm={async () => {
        const res = await removeProjectAction(id);
        if (!res.ok) throw new Error(res.error);
        if (backHref) router.push(backHref);
        router.refresh();
      }}
    />
  );
}
