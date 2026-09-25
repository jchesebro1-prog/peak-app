"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { deletePartAction } from "./actions";

/** Admin-only Delete control on the catalog part edit drawer. */
export function DeletePartButton({ sku }: { sku: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="pk-btn-danger"
      label="Delete part"
      confirmLabel="Confirm delete"
      style={{ fontSize: 12, padding: "7px 11px" }}
      onConfirm={async () => {
        const res = await deletePartAction(sku);
        if (!res.ok) throw new Error(res.error);
        router.push("/catalog");
      }}
    />
  );
}
