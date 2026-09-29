"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteSpecDocumentAction } from "./builder-actions";

/** Delete a saved spec from the Specs list — arm, then confirm in place. */
export function DeleteSpecButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Delete"
      confirmLabel="Delete spec"
      style={{ fontSize: 12 }}
      ariaLabel={`Delete ${id}`}
      onConfirm={async () => {
        const r = await deleteSpecDocumentAction(id);
        if (!r.ok) throw new Error(r.error);
        router.refresh();
      }}
    />
  );
}
