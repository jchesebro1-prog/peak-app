"use client";

import { useEffect, useState, type CSSProperties } from "react";
import CompanySearch from "@/components/parties/company-search";
import type { BidderVM, BidPanelVM } from "@/lib/parties/bid-vm";
import {
  addBidderAction,
  awardBidAction,
  bidPanelAction,
  markSubmittedAction,
  undoAwardAction,
  updateBidderAction,
  type BidPanelResult,
} from "../bid-actions";
import { BidderRow, BTN } from "./bidder-row";

const CARD_LABEL = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" } as const;
const FIELD: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, padding: "4px 6px", border: "1px solid #dcdfe5", borderRadius: 6, background: "#fff" };

/**
 * #348 slice 2a — the Send & track step's Bidders card: the GCs / ECs this estimate goes to, each with how it is
 * submitted, whether the current revision went out, and Award / Undo. The owner stays the customer. Loads on
 * mount and when `refreshKey` changes; every mutation replaces the panel from the action's own result.
 */
export function BiddersCard({ quoteId, refreshKey }: { quoteId: string; refreshKey: number }) {
  const [panel, setPanel] = useState<BidPanelVM | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<"gc" | "ec">("gc");
  const [via, setVia] = useState<"email" | "website">("email");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    bidPanelAction(quoteId).then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setPanel(r.panel);
          setErr(null);
        } else setErr(r.error);
      },
      () => live && setErr("Couldn't load the bidders. Try again.")
    );
    return () => {
      live = false;
    };
  }, [quoteId, refreshKey]);

  async function run(call: () => Promise<BidPanelResult>): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      const r = await call();
      if (r.ok) {
        setPanel(r.panel);
        return true;
      }
      setErr(r.error);
    } catch {
      setErr("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
    return false;
  }

  const resetAdd = () => {
    setAdding(false);
    setCompany(null);
    setVia("email");
    setRole("gc");
  };
  const add = (input: { companyId: string; contactId?: string | null; role: "gc" | "ec" }) =>
    run(() => addBidderAction(quoteId, { ...input, submitVia: via })).then((ok) => ok && resetAdd());

  const onSubmitted = (b: BidderVM) => {
    const conf = window.prompt(`Confirmation # for ${b.companyName} (optional)`, "");
    if (conf === null) return;
    void run(() => markSubmittedAction(b.id, conf));
  };
  const onAward = (b: BidderVM) => {
    if (!panel) return;
    const owner = panel.ownerName || "the owner";
    if (!window.confirm(`Award this estimate to ${b.companyName}? The other pending bidders become 'Lost the award'. The customer stays ${owner}.`)) return;
    void run(() => awardBidAction(quoteId, b.id));
  };

  const edit = !!panel?.canEdit;
  const addendaText = panel?.addenda.length ? `Addenda: ${panel.addenda.map((a) => a.no).join(", ")}` : "";
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={CARD_LABEL}>Bidders{panel ? ` · ${panel.bidders.length}` : ""}</div>
        {panel?.dueText && <span style={{ fontSize: 11.5, color: "#5b616e" }}>Due {panel.dueText}</span>}
        {addendaText && <span style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: "#f1f2f5", color: "#5b616e" }}>{addendaText}</span>}
        {edit && panel?.canUndo && (
          <button type="button" disabled={busy} onClick={() => void run(() => undoAwardAction(quoteId))} style={{ ...BTN, marginLeft: "auto" }}>
            Undo award
          </button>
        )}
      </div>
      {!panel && !err && <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Loading…</div>}
      {panel && panel.bidders.length === 0 && <div style={{ fontSize: 12, color: "#5b616e" }}>Not a bid. Add the GCs or ECs this estimate goes to.</div>}
      {panel && panel.bidders.length > 0 && (
        <ul style={{ margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {panel.bidders.map((b) => (
            <BidderRow
              key={b.id}
              b={b}
              panel={panel}
              busy={busy}
              onPatch={(id, patch) => void run(() => updateBidderAction(id, patch))}
              onSubmitted={onSubmitted}
              onAward={onAward}
            />
          ))}
        </ul>
      )}
      {edit && panel && (
        <div style={{ marginTop: 10 }}>
          {!adding ? (
            <button type="button" disabled={busy} onClick={() => setAdding(true)} style={BTN}>
              + Add bidder
            </button>
          ) : (
            <div style={{ display: "grid", gap: 8, border: "1px solid #ececf0", borderRadius: 9, padding: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                  Role{" "}
                  <select aria-label="Bidder role" value={role} disabled={busy} onChange={(e) => setRole(e.target.value as "gc" | "ec")} style={FIELD}>
                    <option value="gc">GC</option>
                    <option value="ec">EC</option>
                  </select>
                </label>
                <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                  Submit via{" "}
                  <select aria-label="New bidder submit via" value={via} disabled={busy} onChange={(e) => setVia(e.target.value as "email" | "website")} style={FIELD}>
                    <option value="email">Email</option>
                    <option value="website">Their bid website</option>
                  </select>
                </label>
              </div>
              {panel.candidates.filter((c) => c.role === role).length > 0 && (
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 11.5, color: "#5b616e" }}>From the lead</div>
                  {panel.candidates
                    .filter((c) => c.role === role)
                    .map((c) => (
                      <button key={`${c.role}:${c.companyId}`} type="button" disabled={busy} onClick={() => void add({ companyId: c.companyId, contactId: c.contactId, role: c.role })} style={{ ...BTN, textAlign: "left" }}>
                        {c.companyName}
                      </button>
                    ))}
                </div>
              )}
              <div style={{ display: "grid", gap: 4, fontSize: 11.5, color: "#5b616e" }}>
                Or search companies
                {company ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#16181d" }}>{company.name}</span>
                    <button type="button" disabled={busy} onClick={() => setCompany(null)} style={BTN}>
                      Change
                    </button>
                  </div>
                ) : (
                  <CompanySearch placeholder="Search companies…" disabled={busy} onPick={setCompany} />
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={busy || !company} onClick={() => company && void add({ companyId: company.id, role })} style={{ ...BTN, background: "var(--accent)", color: "#fff" }}>
                  {busy ? "Adding…" : "Add"}
                </button>
                <button type="button" disabled={busy} onClick={resetAdd} style={BTN}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {err && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#8a2f22" }}>
          {err}
        </div>
      )}
    </div>
  );
}
