"use client";

import { useState } from "react";
import { deleteCatalogPriceListAction } from "./actions";

export default function CatalogDangerZone({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  return <div style={{ marginTop: 18, border: "1px solid #f0d6cd", borderRadius: 12, background: "#fffafa", padding: "15px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><div style={{ fontSize: 13.5, fontWeight: 700, color: "#8a2f22" }}>Reset current price list</div><div style={{ marginTop: 3, color: "#9a5a4e", fontSize: 11.5 }}>Permanently remove {count.toLocaleString()} catalog part records. Grid symbols, labor rates, and other data are not affected.</div></div>
      <button type="button" onClick={() => setOpen(!open)} style={{ border: "1px solid #e9c6bc", borderRadius: 8, background: "#fff", color: "#8a2f22", padding: "8px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{open ? "Cancel" : "Delete price list"}</button>
    </div>
    {open && <form action={deleteCatalogPriceListAction} style={{ marginTop: 14, borderTop: "1px solid #f3ddd8", paddingTop: 13 }}>
      <div style={{ fontSize: 12, color: "#5b3b36", lineHeight: 1.5 }}>This cannot be undone. Type <b>DELETE</b> to clear the current list before importing the new one.</div>
      <div style={{ display: "flex", gap: 8, marginTop: 9, maxWidth: 420 }}><input name="confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="DELETE" style={{ flex: 1, border: "1px solid #e9c6bc", borderRadius: 8, padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 12 }} /><button type="submit" disabled={confirmation !== "DELETE"} style={{ border: "none", borderRadius: 8, padding: "8px 12px", background: confirmation === "DELETE" ? "#8a2f22" : "#eadbd7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: confirmation === "DELETE" ? "pointer" : "not-allowed" }}>Delete all parts</button></div>
    </form>}
  </div>;
}
