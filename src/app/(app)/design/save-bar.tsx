"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDesignAction, deleteDesignAction } from "./studio-actions";
import type { StudioDesignKind } from "@/lib/stores/studio-designs";

export type SavedRef = { id: string; name: string; customer: string };

const field: React.CSSProperties = { border: "1px solid #dfe2e8", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "#fff", boxSizing: "border-box" };
const btn = (primary?: boolean): React.CSSProperties => ({ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "8px 14px", cursor: "pointer", border: primary ? "none" : "1px solid #dfe2e8", color: primary ? "#fff" : "#3a3e46", background: primary ? "var(--accent)" : "#fff", whiteSpace: "nowrap" });

/**
 * Shared save/load bar for the Design Studio tools. `getData` returns the
 * tool's current state at save time; `loadBase` is the route to reopen a
 * design (e.g. "/design/lineset?design=").
 */
export function SaveBar({
  kind,
  getData,
  customers,
  saved,
  loaded,
  loadBase,
}: {
  kind: StudioDesignKind;
  getData: () => unknown;
  customers: { id: string; name: string }[];
  saved: SavedRef[];
  loaded: { id: string; name: string; customerId: string | null } | null;
  loadBase: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(loaded?.name || "");
  const [customerId, setCustomerId] = useState(loaded?.customerId || "");
  const [id, setId] = useState<string | null>(loaded?.id || null);
  const [msg, setMsg] = useState<string | null>(null);

  function save(asNew: boolean) {
    startTransition(async () => {
      const res = await saveDesignAction({ id: asNew ? null : id, name, kind, customerId: customerId || null, data: getData() });
      if (res.ok) {
        setId(res.id);
        setMsg("Saved.");
        router.refresh();
        setTimeout(() => setMsg(null), 2000);
      } else setMsg(res.error);
    });
  }
  function del() {
    if (!id) return;
    startTransition(async () => {
      await deleteDesignAction(id);
      setId(null);
      setName("");
      setMsg("Deleted.");
      router.refresh();
      setTimeout(() => setMsg(null), 2000);
    });
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "12px 16px", boxShadow: "0 1px 2px rgba(0,0,0,.04)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#5b616e" }}>{id ? "Editing saved design" : "Save this design"}</span>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Design name" style={{ ...field, flex: "1 1 160px", minWidth: 130 }} />
      <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ ...field, flex: "1 1 150px" }}>
        <option value="">— No venue —</option>
        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button onClick={() => save(false)} disabled={pending || !name.trim()} style={btn(true)}>{pending ? "Saving…" : id ? "Update" : "Save"}</button>
      {id && <button onClick={() => save(true)} disabled={pending} style={btn()}>Save as new</button>}
      {id && <button onClick={del} disabled={pending} style={{ ...btn(), color: "#b4543a" }}>Delete</button>}
      {saved.length > 0 && (
        <select value="" onChange={(e) => e.target.value && router.push(loadBase + encodeURIComponent(e.target.value))} style={{ ...field, flex: "1 1 150px" }}>
          <option value="">Open saved… ({saved.length})</option>
          {saved.map((s) => <option key={s.id} value={s.id}>{s.name}{s.customer ? ` · ${s.customer}` : ""}</option>)}
        </select>
      )}
      {msg && <span style={{ fontSize: 12.5, fontWeight: 600, color: msg.includes(".") ? "#1f7a52" : "#b4543a" }}>{msg}</span>}
    </div>
  );
}
