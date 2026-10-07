"use client";

import { useEffect, useRef, useState } from "react";
import { ChangeTypeControl } from "@/components/quote-flow-controls";
import type { EstimatorState } from "./use-estimator-state";
import { DeleteQuoteButton } from "../quotes/delete-quote-button";

/** #304 — the header's ⋯ menu: actions used a few times per quote, not per minute. */
export function HeaderMoreMenu({ s }: { s: EstimatorState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = { display: "block", width: "100%", textAlign: "left" as const, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-ui)", background: "none", border: "none", color: "#e6e8ec", cursor: "pointer" };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} title="More actions" onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, lineHeight: 1, color: "#cfd3da", background: "#2b2e35", border: "none", borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
        ⋯
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 40, minWidth: 230, background: "#23262d", border: "1px solid #3a3e46", borderRadius: 8, boxShadow: "0 12px 28px rgba(0,0,0,.28)", padding: "4px 0" }}>
          {s.loadedId && (
            <div style={{ padding: "6px 12px" }}>
              <ChangeTypeControl quoteId={s.loadedId} status={s.status} tone="dark" />
            </div>
          )}
          {s.aiSource && (
            <button type="button" role="menuitem" style={item} onClick={() => { setOpen(false); s.openAiDraft(); }} title={"Assemble the scope of work from " + s.aiSource.label}>
              Draft from survey/inspection
            </button>
          )}
          <button type="button" role="menuitem" style={{ ...item, ...(s.partsBusy ? { opacity: 0.6, cursor: "not-allowed" } : {}) }} disabled={s.partsBusy} onClick={() => { setOpen(false); s.exportPartsList(); }}
            title="Model numbers, descriptions and cost for every part — assemblies broken into their parts. For purchasing.">
            Parts list (CSV)
          </button>
          {s.loadedId && (
            <button type="button" role="menuitem" style={item} onClick={() => { setOpen(false); void s.openCutSheets(); }}>
              Cut sheets
            </button>
          )}
          {s.loadedId && (
            <div style={{ padding: "6px 12px", borderTop: "1px solid #3a3e46", marginTop: 4 }}>
              <DeleteQuoteButton id={s.loadedId} won={s.status === "won"} redirectTo="/estimator" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
