"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bidPanelAction, setBidDetailsAction } from "./bid-actions";
import type { BidAddendum } from "@/lib/parties/bids";
import type { BidPanelVM } from "@/lib/parties/bid-vm";

/*
 * #348 slice 2a — the Estimator header's Bid chip: "Bid · due Oct 21, 2:00 PM · 4 bidders · Add. 2" opens a dialog with the
 * due date and addenda. Bidders are managed on Send & track. Disabled until the estimate is saved.
 *
 * Dates: staff work in America/Chicago, and the browser's local zone is Chicago for them, so the datetime-local input is
 * read and written in the browser's local time. Received dates (date inputs) store noon local time so a DST shift or a
 * midnight edge never moves the day.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number | null): string => {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
const toDateInput = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromDateInput = (v: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getTime();
};

function chipLabel(p: BidPanelVM | null): string {
  if (!p || (p.bidders.length === 0 && !p.dueAt)) return "Bid…";
  const parts = ["Bid"];
  if (p.awardedPartyId) parts.push("Awarded");
  else if (p.dueText) parts.push(`due ${p.dueText}`);
  if (p.bidders.length) parts.push(`${p.bidders.length} bidder${p.bidders.length === 1 ? "" : "s"}`);
  if (p.addenda.length) parts.push(`Add. ${Math.max(...p.addenda.map((a) => a.no))}`);
  return parts.join(" · ");
}

export default function BidChip({ quoteId, canEdit }: { quoteId: string | null; canEdit: boolean }) {
  const [stored, setPanel] = useState<BidPanelVM | null>(null);
  // A panel for another estimate is never shown (the VM carries its quote id).
  const panel = stored && stored.quoteId === quoteId ? stored : null;
  const [open, setOpen] = useState(false);
  const [dueInput, setDueInput] = useState("");
  const [addenda, setAddenda] = useState<BidAddendum[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // Latest-response-wins: a slow reload for an old quote or an earlier request never overwrites a newer one.
  const seq = useRef(0);

  const reload = useCallback(() => {
    if (!quoteId) return Promise.resolve(null);
    const mine = ++seq.current;
    return bidPanelAction(quoteId)
      .then((r) => {
        if (mine !== seq.current) return null;
        if (r.ok) {
          setPanel(r.panel);
          return r.panel;
        }
        return null;
      })
      .catch(() => null);
  }, [quoteId]);

  useEffect(() => {
    if (quoteId) void reload();
  }, [quoteId, reload]);

  // The Bidders card (Send & track) changes the bid; refresh the label when the window regains focus.
  useEffect(() => {
    if (!quoteId) return;
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [quoteId, reload]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const openDialog = async () => {
    setError("");
    const fresh = (await reload()) ?? panel;
    setDueInput(toLocalInput(fresh?.dueAt ?? null));
    setAddenda(fresh?.addenda ?? []);
    setOpen(true);
  };

  const readOnly = !canEdit || (panel ? !panel.canEdit : false);

  const save = async () => {
    if (!quoteId || saving) return;
    const due = fromLocalInput(dueInput);
    if (dueInput && due == null) return setError("Pick a valid due date.");
    setSaving(true);
    setError("");
    try {
      const r = await setBidDetailsAction(quoteId, { dueAt: due, addenda });
      if (r.ok) {
        setPanel(r.panel);
        setOpen(false);
      } else setError(r.error);
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const addAddendum = () =>
    setAddenda((l) => [...l, { no: l.length ? Math.max(...l.map((a) => a.no)) + 1 : 1, receivedAt: fromDateInput(toDateInput(Date.now())) ?? Date.now(), note: "" }]);
  const editAddendum = (i: number, patch: Partial<BidAddendum>) => setAddenda((l) => l.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const small = { fontSize: 11.5, color: "#8c919c" } as const;
  const btn = { fontSize: 12, fontWeight: 600, border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "5px 10px", cursor: "pointer" } as const;

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        disabled={!quoteId}
        title={quoteId ? "Bid due date and addenda" : "Save the estimate first"}
        style={{
          fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#cfd3da", background: "transparent",
          border: "1px solid #3a3e46", borderRadius: 6, padding: "2px 8px", cursor: quoteId ? "pointer" : "not-allowed", whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        {chipLabel(panel)}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label="Bid details"
        style={{ width: "min(560px, calc(100vw - 32px))", margin: "auto", maxHeight: "calc(100vh - 64px)", overflow: "auto", border: "1px solid #e4e7ec", borderRadius: 12, padding: 0 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f0f1f4" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Bid details</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ border: 0, background: "transparent", fontSize: 16, cursor: "pointer" }}>
            ✕
          </button>
        </div>
        {open && (
          <div style={{ padding: "14px 18px 18px", display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
              Bid due
              <input type="datetime-local" value={dueInput} disabled={readOnly} onChange={(e) => setDueInput(e.target.value)} style={{ fontSize: 12.5, padding: "6px 8px", maxWidth: 260 }} />
            </label>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>Addenda</div>
              {addenda.length === 0 && <div style={small}>No addenda.</div>}
              {addenda.map((a, i) => (
                <div key={a.no} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 44 }}>Add. {a.no}</span>
                  <input
                    type="date"
                    aria-label={`Addendum ${a.no} received`}
                    value={toDateInput(a.receivedAt)}
                    disabled={readOnly}
                    onChange={(e) => {
                      const ms = fromDateInput(e.target.value);
                      if (ms != null) editAddendum(i, { receivedAt: ms });
                    }}
                    style={{ fontSize: 12.5, padding: "5px 6px" }}
                  />
                  <input
                    aria-label={`Addendum ${a.no} note`}
                    value={a.note}
                    maxLength={200}
                    disabled={readOnly}
                    placeholder="Note"
                    onChange={(e) => editAddendum(i, { note: e.target.value })}
                    style={{ fontSize: 12.5, padding: "5px 8px", flex: 1, minWidth: 120 }}
                  />
                  {!readOnly && (
                    <button type="button" aria-label={`Remove addendum ${a.no}`} onClick={() => setAddenda((l) => l.filter((_, j) => j !== i))} style={{ ...btn, padding: "2px 7px", color: "#8a2f22" }}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <button type="button" onClick={addAddendum} disabled={addenda.length >= 30} style={{ ...btn, marginTop: 6 }}>
                  + Addendum
                </button>
              )}
            </div>
            <div style={small}>Bidders are managed on Send &amp; track.</div>
            {error && (
              <div role="alert" style={{ fontSize: 12, color: "#8a2f22" }}>
                {error}
              </div>
            )}
            {!readOnly && (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => void save()} disabled={saving} style={{ ...btn, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setOpen(false)} disabled={saving} style={btn}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
