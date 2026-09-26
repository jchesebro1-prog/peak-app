"use client";

import { useState, type CSSProperties } from "react";
import { ConfirmButton } from "@/components/confirm-button";

/** Riser editor tool panels (#GDS). Plain controlled forms; the editor owns
 *  every server call and passes busy/callbacks in. */

export type RiserPartOption = { id: string; label: string };

export const PANEL: CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 12,
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignItems: "flex-end",
  fontSize: 12.5,
};

export const INPUT: CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "6px 8px",
  fontSize: 12.5,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};

export const FIELD: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 600, color: "#5b616e" };
const TITLE: CSSProperties = { width: "100%", fontWeight: 700, fontSize: 13, color: "#16181d" };
const HINT: CSSProperties = { width: "100%", fontSize: 11.5, color: "#8c919c" };

/** Filterable select — the library can hold thousands of parts. */
export function PartPicker({ label, options, value, onChange }: { label: string; options: RiserPartOption[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = (needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options).slice(0, 200);
  const current = options.find((o) => o.id === value);
  const list = current && !shown.some((o) => o.id === current.id) ? [current, ...shown] : shown;
  return (
    <label style={FIELD}>
      {label}
      <input style={{ ...INPUT, width: 240 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`${label} filter`} />
      <select style={{ ...INPUT, width: 320 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Choose…</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DevicePanel({
  nodeName,
  devices,
  busy,
  onAdd,
  onCancel,
}: {
  nodeName: string;
  devices: RiserPartOption[];
  busy: boolean;
  onAdd: (partId: string, qty: number) => void;
  onCancel: () => void;
}) {
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const n = Math.floor(Number(qty));
  const valid = Boolean(partId) && n >= 1 && n <= 200;
  return (
    <div style={PANEL}>
      <div style={TITLE}>{`Add devices to ${nodeName}`}</div>
      <PartPicker label="Device" options={devices} value={partId} onChange={setPartId} />
      <label style={FIELD}>
        Qty
        <input style={{ ...INPUT, width: 72 }} type="number" min={1} max={200} value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!valid || busy} onClick={() => onAdd(partId, n)}>
        {busy ? "Adding…" : "Add to plan"}
      </button>
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <div style={HINT}>They land on the plan inside this space (the lower margin for Unassigned), spread so multiples don&apos;t stack.</div>
    </div>
  );
}

export function RowPanel({
  nodeName,
  partId: currentPart,
  desc,
  qty: currentQty,
  devices,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  nodeName: string;
  partId: string;
  desc: string;
  qty: number;
  devices: RiserPartOption[];
  busy: boolean;
  onSave: (partId: string, qty: number) => void;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [partId, setPartId] = useState(currentPart);
  const [qty, setQty] = useState(String(currentQty));
  const n = Math.floor(Number(qty));
  const valid = Boolean(partId) && n >= 1 && n <= 200;
  const dirty = partId !== currentPart || n !== currentQty;
  return (
    <div style={PANEL}>
      <div style={TITLE}>{`${currentQty}× ${desc} — ${nodeName}`}</div>
      <PartPicker label="Part" options={devices} value={partId} onChange={setPartId} />
      <label style={FIELD}>
        Qty
        <input style={{ ...INPUT, width: 72 }} type="number" min={1} max={200} value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!valid || !dirty || busy} onClick={() => onSave(partId, n)}>
        Save
      </button>
      <ConfirmButton label="Delete devices" confirmLabel={`Delete ${currentQty}`} disabled={busy} onConfirm={onDelete} />
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
      <div style={HINT}>Edits the placements on the plan — a lower qty removes the newest ones in this space.</div>
    </div>
  );
}

export function SpacePanel({
  sheets,
  busy,
  onAdd,
  onCancel,
}: {
  sheets: Array<{ id: string; name: string }>;
  busy: boolean;
  onAdd: (name: string, sheetId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [sheetId, setSheetId] = useState(sheets[0]?.id || "");
  if (!sheets.length) {
    return (
      <div style={PANEL}>
        <div style={TITLE}>Upload or generate a plan sheet first — a space lives on a plan.</div>
        <button type="button" className="pk-btn-outline" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }
  return (
    <div style={PANEL}>
      <div style={TITLE}>New space</div>
      <label style={FIELD}>
        Name
        <input style={{ ...INPUT, width: 220 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Amp room, Catwalk…" />
      </label>
      {sheets.length > 1 && (
        <label style={FIELD}>
          Sheet
          <select style={{ ...INPUT, width: 220 }} value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="pk-btn-accent" disabled={!name.trim() || !sheetId || busy} onClick={() => onAdd(name.trim(), sheetId)}>
        Add space
      </button>
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <div style={HINT}>A small rectangle on the plan&apos;s lower margin — open the plan to reshape it around the real room.</div>
    </div>
  );
}
