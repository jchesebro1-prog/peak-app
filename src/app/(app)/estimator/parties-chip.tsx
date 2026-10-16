"use client";

import { useEffect, useRef, useState } from "react";
import PartiesEditor from "@/components/parties/parties-editor";
import { listPartiesAction } from "@/app/(app)/parties/actions";
import type { PartyVM } from "@/lib/parties/vm";

/** #348 — the Estimator header's Parties chip: "Parties · 3" opens a dialog with the shared editor. Disabled until saved. */
export default function PartiesChip({ quoteId, canEdit }: { quoteId: string | null; canEdit: boolean }) {
  const [parties, setParties] = useState<PartyVM[] | null>(null);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!quoteId) return;
    let live = true;
    listPartiesAction("quote", quoteId).then((p) => live && setParties(p)).catch(() => live && setParties([]));
    return () => {
      live = false;
    };
  }, [quoteId]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const n = parties?.length ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!quoteId}
        title={quoteId ? "Owner, GCs, ECs, architect, consultant, vendors on this estimate" : "Save the estimate first"}
        style={{
          fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#cfd3da", background: "transparent",
          border: "1px solid #3a3e46", borderRadius: 6, padding: "2px 8px", cursor: quoteId ? "pointer" : "not-allowed", whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        Parties{n ? ` · ${n}` : ""}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label="Companies on this estimate"
        style={{ width: "min(520px, calc(100vw - 32px))", margin: "auto", maxHeight: "calc(100vh - 64px)", overflow: "auto", border: "1px solid #e4e7ec", borderRadius: 12, padding: 0 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f0f1f4" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Companies on this estimate</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ border: 0, background: "transparent", fontSize: 16, cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: "14px 18px 18px" }}>
          {open && quoteId && parties && <PartiesEditor key={quoteId} recordType="quote" recordId={quoteId} initial={parties} canEdit={canEdit} onChange={setParties} />}
          {open && quoteId && !parties && <div style={{ fontSize: 12, color: "#8c919c" }}>Loading…</div>}
        </div>
      </dialog>
    </>
  );
}
