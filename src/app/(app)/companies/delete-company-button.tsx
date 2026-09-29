"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteCustomerAction } from "./actions";

/** #278 — two-step Delete on a directory row. Same soft delete as the Edit
 *  dialog (CustomerStore.remove); quotes keep their link. */
export function DeleteCompanyButton({ id, name, quoteCount }: { id: string; name: string; quoteCount: number }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Delete"
      confirmLabel="Confirm delete"
      style={{ fontSize: 11.5, padding: "4px 10px" }}
      ariaLabel={`Delete ${name}`}
      title={
        quoteCount > 0
          ? `Delete this company — it has ${quoteCount} quote${quoteCount === 1 ? "" : "s"}, which keep their link`
          : "Delete this company"
      }
      onConfirm={async () => {
        const res = await deleteCustomerAction(id);
        if (!res.ok) throw new Error(res.error);
        router.refresh();
      }}
    />
  );
}
