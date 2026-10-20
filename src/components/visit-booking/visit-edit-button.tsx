"use client";

import { useState } from "react";
import VisitEditDialog, { type VisitEditVM } from "./visit-edit-dialog";

/** Jeff 2026-10-15 #35 — `canEdit` false (not the lead, not an approver) renders a read-only, disabled control;
 *  the server refuses the edit either way. */
export function EditVisitButton({ visit, team, canEdit = true }: { visit: VisitEditVM; team: string[]; canEdit?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!canEdit)
    return (
      <button type="button" className="pk-btn-outline" disabled data-testid="visit-edit-readonly" title="Only the visit lead or an approver can change a scheduled visit" style={{ fontSize: 10.5, padding: "3px 8px", opacity: 0.5, cursor: "default" }}>
        Edit
      </button>
    );
  return (
    <>
      <button type="button" className="pk-btn-outline" style={{ fontSize: 10.5, padding: "3px 8px" }} onClick={() => setOpen(true)}>
        Edit
      </button>
      {open && <VisitEditDialog visit={visit} team={team} onClose={() => setOpen(false)} />}
    </>
  );
}
