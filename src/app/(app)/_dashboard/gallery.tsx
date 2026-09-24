"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { addWidget, type Surface } from "@/lib/dashboard/registry";
import { resetLayoutAction, saveLayoutAction } from "../dashboard-actions";

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8", background: "#fff", borderRadius: 8, padding: "6px 11px",
  fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit",
};

/** #43 — the "Add widget" gallery + Reset, rendered above the grid in
 *  ?customize=1. `available` is already role-gated and minus what's placed. */
export default function Gallery({
  surface, ids, customized, available,
}: { surface: Surface; ids: string[]; customized: boolean; available: Array<{ id: string; title: string; desc: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  return (
    <div className="pk-card" style={{ padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div className="pk-h3">Add widgets</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Use Up, Down and Remove on each widget to arrange the page.</div>
        </div>
        {customized && (
          <button type="button" style={BTN} disabled={pending} onClick={() => run(() => resetLayoutAction(surface))}>Reset to default</button>
        )}
      </div>
      {available.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Every widget you can see is already on this page.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {available.map((w) => (
            <div key={w.id} style={{ border: "1px solid #ececf0", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{w.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", flex: 1 }}>{w.desc}</div>
              <button type="button" style={{ ...BTN, alignSelf: "flex-start" }} disabled={pending} onClick={() => run(() => saveLayoutAction(surface, addWidget(ids, w.id)))}>Add</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
