"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { removeProjectAction } from "./actions";

/** Detail-header Delete control (soft delete, #169-safe against the quote
 *  spawn sweep) — navigates back to the book on success. */
export function DeleteProjectButton({ id, backHref }: { id: string; backHref: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Delete"
      confirmLabel="Confirm delete"
      onConfirm={async () => {
        const res = await removeProjectAction(id);
        if (!res.ok) throw new Error(res.error);
        router.push(backHref);
        router.refresh();
      }}
    />
  );
}
