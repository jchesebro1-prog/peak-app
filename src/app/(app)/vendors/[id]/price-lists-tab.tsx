"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { VENDOR_STATUS_META, type PriceListEntry, type VendorStatusKey } from "@/lib/vendor-status";
import { dateYear } from "@/lib/format";
import { fromDateInput } from "../dates";
import { logPriceListAction } from "../actions";

/**
 * #122 — Price lists: the ledger (received, effective, note, logged by) and
 * the "Log price list" form. Saving re-evaluates the status and the owner
 * task server-side (logPriceListAction → ensureVendorAssignments) and
 * router.refresh() re-renders the header chip. Date rule only — no file.
 */

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 18, overflow: "hidden" };
const LBL: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 5 };
const IN: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 11px", outline: "none", background: "#fff", boxSizing: "border-box" };
const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "110px 110px minmax(0,1fr) 140px", gap: 10, alignItems: "center" };

export default function PriceListsTab({
  vendorId,
  priceLists,
  status,
  catalogEffectiveAt,
  todayInput,
}: {
  vendorId: string;
  priceLists: PriceListEntry[];
  status: VendorStatusKey;
  catalogEffectiveAt: number | null;
  /** server-rendered "today" as YYYY-MM-DD (the received-date default) */
  todayInput: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [received, setReceived] = useState(todayInput);
  const [effective, setEffective] = useState(todayInput);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const sm = VENDOR_STATUS_META[status];

  const submit = () =>
    start(async () => {
      setErr("");
      const receivedAt = fromDateInput(received);
      const effectiveAt = fromDateInput(effective);
      if (receivedAt == null || effectiveAt == null) {
        setErr("Both dates are required.");
        return;
      }
      const res = await logPriceListAction(vendorId, { receivedAt, effectiveAt, note });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setNote("");
      router.refresh();
    });

  return (
    <>
      <div style={{ ...CARD, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Log price list</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "3px 10px", borderRadius: 20 }}>{sm.label}</span>
          <span style={{ fontSize: 12, color: "#8c919c" }}>Catalog priced {dateYear(catalogEffectiveAt)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "160px 160px minmax(0,1fr)", gap: 12 }}>
          <div>
            <label style={LBL}>Received</label>
            <input type="date" value={received} onChange={(e) => setReceived(e.target.value)} style={IN} />
          </div>
          <div>
            <label style={LBL}>Effective</label>
            <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} style={IN} />
          </div>
          <div>
            <label style={LBL}>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2027 dealer list, +4% across velours" style={IN} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={submit} style={{ opacity: pending ? 0.55 : 1 }}>
            {pending ? "Logging…" : "Log price list"}
          </button>
          <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Logging a list newer than the catalog creates the catalog owner’s task right away.</span>
          {err && <span style={{ fontSize: 12, color: "#b4543a" }}>{err}</span>}
        </div>
      </div>

      <div style={CARD}>
        <div style={{ ...GRID, padding: "9px 18px", fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span>Received</span>
          <span>Effective</span>
          <span>Note</span>
          <span>Logged by</span>
        </div>
        {priceLists.map((e) => (
          <div key={e.id} style={{ ...GRID, padding: "11px 18px", borderBottom: "1px solid #f5f6f8", fontSize: 12.5 }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>{dateYear(e.receivedAt)}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{dateYear(e.effectiveAt)}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note || "—"}</span>
            <span style={{ color: "#8c919c" }}>{e.loggedBy || "—"}</span>
          </div>
        ))}
        {priceLists.length === 0 && (
          <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No price list logged yet.
          </div>
        )}
      </div>
    </>
  );
}
