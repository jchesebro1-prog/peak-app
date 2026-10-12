"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadWireStarterAction, syncWireLibraryAction } from "./actions";

/**
 * Starter cables (Grid notes #5) — sits right above the Wire types card.
 * "Load starter cables" adds ~20 common cables to the Catalog at $0, links
 * each to its wire type where that type's cable / symbol / signal is blank,
 * and puts every per-foot cable in the Grid library. "Sync per-foot cables"
 * does only the last step. Both are additive and idempotent; the server
 * re-checks manage_users. Kept apart from the Wire types card because that
 * card remounts (keyed on the saved list) when a load links wire types,
 * which would wipe this card's result line.
 */

const BTN: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, background: "transparent", border: "none", cursor: "pointer", padding: 0 };

export function WireStarterCard({ starterTotal, starterInCatalog, perFootMissing }: { starterTotal: number; starterInCatalog: number; perFootMissing: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    if (!window.confirm(`Adds ~${starterTotal} common cables to the Catalog at $0 for you to price, links each to its wire type, and puts every per-foot cable in the Grid library. Never changes a part or wire type you've already set.`)) return;
    setNote(null);
    startTransition(async () => {
      const r = await loadWireStarterAction();
      if (!r.ok) return setNote({ ok: false, text: r.error });
      const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
      setNote({
        ok: true,
        text:
          `Added ${s(r.partsAdded, "cable")} to the Catalog (${r.partsExisting} already there), ` +
          `${s(r.libraryAdded, "per-foot cable")} to the Grid library, linked ${s(r.wireTypesLinked, "wire type")}.` +
          (r.partsAdded ? " Set their cost and sell per ft in the Catalog." : ""),
      });
      router.refresh();
    });
  };

  const sync = () => {
    setNote(null);
    startTransition(async () => {
      const r = await syncWireLibraryAction();
      if (!r.ok) return setNote({ ok: false, text: r.error });
      setNote({ ok: true, text: r.libraryAdded ? `Added ${r.libraryAdded} per-foot cable${r.libraryAdded === 1 ? "" : "s"} to the Grid library.` : "Every per-foot cable is already in the Grid library." });
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ padding: "14px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10 }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Starter cables</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            {starterInCatalog} of {starterTotal} common cables (DMX, Cat5e/Cat6, speaker, 70V, audio, SDI, fiber, SOOW power, 0-10V, EchoConnect) are in
            the Catalog.{" "}
            {perFootMissing > 0
              ? `${perFootMissing} per-foot cable${perFootMissing === 1 ? " isn't" : "s aren't"} in the Grid library yet, so the Wires pane can't route ${perFootMissing === 1 ? "it" : "them"}.`
              : "Every per-foot cable is in the Grid library."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <button type="button" onClick={sync} disabled={pending} style={{ ...BTN, color: "#5b616e" }} title="Puts every per-foot (ft) catalog cable in the Grid library, so it shows in the Wires pane">
            Sync per-foot cables to the Grid
          </button>
          <button type="button" className="pk-btn-accent" onClick={load} disabled={pending} style={{ fontSize: 13 }}>
            {pending ? "Working…" : "Load starter cables"}
          </button>
        </div>
      </div>
      {note && (
        <div style={{ marginTop: 10, fontSize: 11.5, fontWeight: 600, color: note.ok ? "#1f7a52" : "#b4543a" }} role="status">
          {note.ok ? "✓ " : ""}
          {note.text}
        </div>
      )}
    </div>
  );
}
