"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Suggestion } from "@/lib/part-docs/suggest";
import { attachExistingDocumentAction, suggestAlsoCoversAction } from "./actions";

/**
 * The "Also covers…" step (#207, spec §3): right after a file lands on one
 * part, offer the parts it likely also describes — the part's accessories
 * first (pre-ticked), then its model family (unticked). Confirm attaches the
 * same shared document to the ticked parts.
 */
export default function AlsoCovers({
  sku,
  documentId,
  fileName,
  onDone,
}: {
  sku: string;
  documentId: string;
  fileName: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    suggestAlsoCoversAction(sku, documentId).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setError(r.error);
        setItems([]);
        return;
      }
      setItems(r.suggestions);
      setPicked(new Set(r.suggestions.filter((s) => s.reason === "accessory").map((s) => s.sku)));
    });
    return () => {
      live = false;
    };
  }, [sku, documentId]);

  const toggle = (s: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const confirm = async () => {
    setBusy(true);
    const r = await attachExistingDocumentAction(documentId, [...picked]);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
    onDone();
  };

  return (
    <div className="pk-card" style={{ padding: 14, marginBottom: 14, borderColor: "var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 650 }}>
          Also covers… <span style={{ fontWeight: 400, color: "#8c919c" }}>{fileName} is on {sku}. Tick the other parts it describes.</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pk-btn-outline" onClick={onDone}>Done</button>
          <button type="button" className="pk-btn-accent" disabled={busy || !picked.size} onClick={confirm}>
            {busy ? "Attaching…" : `Attach to ${picked.size} part${picked.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      {items === null && <div style={{ marginTop: 8, fontSize: 12, color: "#8c919c" }}>Looking for related parts…</div>}
      {items && !items.length && !error && <div style={{ marginTop: 8, fontSize: 12, color: "#8c919c" }}>No related parts found — attach more from the list below.</div>}
      {!!items?.length && (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
          {items.map((s) => (
            <label key={s.sku} style={{ display: "flex", gap: 7, alignItems: "baseline", fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(s.sku)} onChange={() => toggle(s.sku)} />
              <span style={{ minWidth: 0 }}>
                <b>{s.sku}</b> <span style={{ color: "#6b7079" }}>{s.desc}</span>
                <span style={{ marginLeft: 6, fontSize: 10.5, color: s.reason === "accessory" ? "#3a5fb4" : "#8c919c" }}>
                  {s.reason === "accessory" ? "accessory" : "same family"}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}
