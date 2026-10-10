"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import { CONDUIT_SIZES_MAX, CONDUIT_SIZE_MAX, validateConduitSizeRows } from "@/lib/conduit-sizes";
import type { ConduitSize } from "@/lib/design/conduit-riser/pricing";
import { saveConduitSizesAction, searchConduitPartsAction } from "./actions";

export type ConduitPartInfo = { desc: string; cost: number; unit: string };
type Draft = { size: string; partId: string };

const INPUT: CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };

const toDraft = (sizes: readonly ConduitSize[]): Draft[] => sizes.map((s) => ({ size: s.size, partId: s.partId ?? "" }));
const toRows = (d: Draft[]) => d.map((r) => (r.partId ? { size: r.size, partId: r.partId } : { size: r.size }));
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ConduitSizesClient({ sizes, parts }: { sizes: ConduitSize[]; parts: Record<string, ConduitPartInfo> }) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>(() => toDraft(sizes));
  const [saved, setSaved] = useState(() => JSON.stringify(toDraft(sizes)));
  const [known, setKnown] = useState<Record<string, ConduitPartInfo>>(parts);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(rows) !== saved;
  const set = (i: number, patch: Partial<Draft>) => {
    setMsg(null);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const save = () => {
    const submitted = toRows(rows);
    const checked = validateConduitSizeRows(submitted);
    if (!checked.ok) {
      setMsg({ ok: false, text: checked.error });
      return;
    }
    start(async () => {
      const r = await saveConduitSizesAction(submitted);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return;
      }
      // The draft becomes exactly what was stored.
      const next = toDraft(r.sizes);
      setRows(next);
      setSaved(JSON.stringify(next));
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ padding: "16px 18px" }}>
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: "#9aa0ab", marginBottom: 10 }}>No sizes — a priced conduit run has nothing to buy and stops the quote.</div>}
      {rows.map((r, i) => {
        const info = r.partId ? known[r.partId] : undefined;
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 80px", gap: 10, alignItems: "start", marginBottom: 10 }}>
            <input value={r.size} onChange={(e) => set(i, { size: e.target.value })} maxLength={CONDUIT_SIZE_MAX} placeholder='Size (e.g. 1")' aria-label="Conduit size" style={{ ...INPUT, fontWeight: 600 }} />
            <div>
              <PartPicker
                sku={r.partId}
                showSku={false}
                search={searchConduitPartsAction}
                onPick={(sku, hit) => {
                  set(i, { partId: sku });
                  setKnown((k) => ({ ...k, [sku]: { desc: hit.desc, cost: hit.cost, unit: hit.unit } }));
                }}
              />
              <div style={{ fontSize: 11.5, color: r.partId && !info ? "#a0442b" : "#8c919c", marginTop: 3 }}>
                {r.partId ? (info ? `${r.partId} · ${info.desc} · ${money(info.cost)}/${info.unit}` : `${r.partId} — no longer in the catalog`) : "No part yet — pick one sold by the foot"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {r.partId && (
                <button type="button" style={{ ...BTN, padding: "6px 8px" }} onClick={() => set(i, { partId: "" })} aria-label="Clear part" title="Clear the part">
                  Clear
                </button>
              )}
              <button type="button" style={{ ...BTN, padding: "6px 9px" }} onClick={() => { setMsg(null); setRows((rs) => rs.filter((_, j) => j !== i)); }} aria-label="Remove size">
                ×
              </button>
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
        <button type="button" style={BTN} disabled={rows.length >= CONDUIT_SIZES_MAX} onClick={() => { setMsg(null); setRows((rs) => [...rs, { size: "", partId: "" }]); }}>
          + Add size
        </button>
        <button type="button" style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }} disabled={pending || !dirty} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        {dirty && !pending && <span style={{ fontSize: 12, color: "#8a6d1f", fontWeight: 600 }}>● Unsaved changes</span>}
        {msg && (
          <span role={msg.ok ? undefined : "alert"} style={{ fontSize: 12, color: msg.ok ? "#2f7a4a" : "#a0442b" }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
