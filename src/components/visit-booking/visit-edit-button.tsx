"use client";

import { useState } from "react";
import VisitEditDialog, { type VisitEditVM } from "./visit-edit-dialog";

export function EditVisitButton({ visit, team }: { visit: VisitEditVM; team: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pk-btn-outline" style={{ fontSize: 10.5, padding: "3px 8px" }} onClick={() => setOpen(true)}>
        Edit
      </button>
      {open && <VisitEditDialog visit={visit} team={team} onClose={() => setOpen(false)} />}
    </>
  );
}
