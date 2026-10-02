"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import { ShapeSvg } from "@/components/cutsheets/shape-svg";
import { MOUNT_RULE_LABELS, validateMountRows, type CurtainMountHardware, type MountQtyRule } from "@/lib/curtain-mounts";
import { mountDetail, MOUNT_DETAIL_VIEWBOX } from "@/lib/curtain-cut-sheets/mount-details";
import { CURTAIN_MOUNT_TYPES, type CurtainMountTypeId } from "@/lib/curtain-cut-sheets/vocab";
import { saveCurtainMountAction } from "./actions";

export type MountPartInfo = { desc: string; cost: number; unit: string };
type Draft = { sku: string; kind: MountQtyRule["kind"]; qty: string; everyFt: string };

const INPUT: CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };

const toDraft = (hw: CurtainMountHardware | undefined): Draft[] =>
  (hw?.rows ?? []).map((r) => ({ sku: r.sku, kind: r.rule.kind, qty: String(r.rule.qty), everyFt: r.rule.kind === "perFtWidth" ? String(r.rule.everyFt) : "" }));
const toRows = (d: Draft[]) =>
  d.map((r) => ({ sku: r.sku, rule: r.kind === "perFtWidth" ? { kind: r.kind, qty: r.qty, everyFt: r.everyFt } : { kind: r.kind, qty: r.qty } }));

export default function CurtainMountsClient({ mounts, parts }: { mounts: Partial<Record<CurtainMountTypeId, CurtainMountHardware>>; parts: Record<string, MountPartInfo> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {CURTAIN_MOUNT_TYPES.map((t) => (
        <MountCard key={t.id} id={t.id} label={t.label} initial={toDraft(mounts[t.id])} parts={parts} />
      ))}
    </div>
  );
}

function MountCard({ id, label, initial, parts }: { id: CurtainMountTypeId; label: string; initial: Draft[]; parts: Record<string, MountPartInfo> }) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>(initial);
  const [known, setKnown] = useState<Record<string, MountPartInfo>>(parts);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const detail = mountDetail(id);
  const set = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => {
    const submitted = toRows(rows);
    const checked = validateMountRows(submitted);
    if (!checked.ok) {
      setMsg({ ok: false, text: checked.error });
      return;
    }
    start(async () => {
      const r = await saveCurtainMountAction(id, submitted);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return;
      }
      // The draft becomes exactly what was stored.
      setRows(checked.rows.map((x) => ({ sku: x.sku, kind: x.rule.kind, qty: String(x.rule.qty), everyFt: x.rule.kind === "perFtWidth" ? String(x.rule.everyFt) : "" })));
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    });
  };
  return (
    <div className="pk-card" style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "120px 1fr", gap: 16 }}>
      <ShapeSvg idPrefix={`mount-${id}`} shapes={detail.shapes} labels={[]} viewBox={`0 0 ${MOUNT_DETAIL_VIEWBOX.w} ${MOUNT_DETAIL_VIEWBOX.h}`} hatch={6} style={{ width: 120, height: 150 }} title={detail.title} />
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>{label}</div>
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: "#9aa0ab", marginBottom: 10 }}>No hardware yet — cut sheets for this mount print without a hardware table.</div>}
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 70px 90px 28px", gap: 8, alignItems: "start", marginBottom: 8 }}>
            <div>
              <PartPicker sku={r.sku} showSku={false} onPick={(sku, hit) => { set(i, { sku }); setKnown((k) => ({ ...k, [sku]: { desc: hit.desc, cost: hit.cost, unit: hit.unit } })); }} />
              <div style={{ fontSize: 11.5, color: r.sku && !known[r.sku] ? "#a0442b" : "#8c919c", marginTop: 3 }}>
                {r.sku ? (known[r.sku] ? `${r.sku} · ${known[r.sku].desc}` : `${r.sku} — no longer in the catalog`) : "Pick a part"}
              </div>
            </div>
            <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Draft["kind"] })} style={INPUT} aria-label="Quantity rule">
              {(Object.keys(MOUNT_RULE_LABELS) as Draft["kind"][]).map((k) => (
                <option key={k} value={k}>{MOUNT_RULE_LABELS[k]}</option>
              ))}
            </select>
            <input value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="decimal" placeholder="Qty" aria-label="Qty" style={INPUT} />
            {r.kind === "perFtWidth" ? (
              <input value={r.everyFt} onChange={(e) => set(i, { everyFt: e.target.value })} inputMode="decimal" placeholder="every ft" aria-label="Every N feet" style={INPUT} />
            ) : (
              <span />
            )}
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} style={{ ...BTN, padding: "6px 8px" }} aria-label="Remove row">×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button type="button" style={BTN} onClick={() => setRows((rs) => [...rs, { sku: "", kind: "perCurtain", qty: "1", everyFt: "" }])}>+ Add part</button>
          <button type="button" style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }} disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
          {msg && <span style={{ fontSize: 12, color: msg.ok ? "#2f7a4a" : "#a0442b" }}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}
