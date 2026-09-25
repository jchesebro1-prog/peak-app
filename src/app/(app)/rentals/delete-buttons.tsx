"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteEquipmentItemAction, deleteEquipmentLocationAction } from "./actions";

/** Delete control on the rental item edit drawer's header. */
export function DeleteEquipmentItemButton({ id, redirectTo }: { id: string; redirectTo: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="pk-btn-danger"
      label="Delete"
      confirmLabel="Confirm delete"
      style={{ fontSize: 12, padding: "7px 11px" }}
      onConfirm={async () => {
        const res = await deleteEquipmentItemAction(id);
        if (!res.ok) throw new Error(res.error);
        router.push(redirectTo);
      }}
    />
  );
}

/** Delete control on a row in the Locations list. */
export function DeleteEquipmentLocationButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="pk-btn-danger"
      label="Delete"
      confirmLabel="Confirm"
      style={{ fontSize: 11, padding: "5px 9px" }}
      onConfirm={async () => {
        const res = await deleteEquipmentLocationAction(id);
        if (!res.ok) throw new Error(res.error);
        router.refresh();
      }}
    />
  );
}
