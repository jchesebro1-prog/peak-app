"use client";

import { useState, type CSSProperties, type RefObject } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import type { RiserNote } from "@/lib/design/grid-riser-doc";
import { PLACEMENT_QTY_MAX } from "@/lib/design/grid-bom";

/** Riser editor tool panels (#209). Plain controlled forms; the editor owns
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
  lot = false,
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
  /** #211: the row holds a lot marker — its qty edits the lot, up to PLACEMENT_QTY_MAX. */
  lot?: boolean;
  devices: RiserPartOption[];
  busy: boolean;
  onSave: (partId: string, qty: number) => void;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [partId, setPartId] = useState(currentPart);
  const [qty, setQty] = useState(String(currentQty));
  const n = Math.floor(Number(qty));
  // A lot row (#211) can hold far more units than 200 markers — a 240 ft pipe
  // lot must stay editable and swappable.
  const maxQty = lot ? PLACEMENT_QTY_MAX : 200;
  const valid = Boolean(partId) && n >= 1 && n <= maxQty;
  const dirty = partId !== currentPart || n !== currentQty;
  return (
    <div style={PANEL}>
      <div style={TITLE}>{`${currentQty}× ${desc} — ${nodeName}`}</div>
      <PartPicker label="Part" options={devices} value={partId} onChange={setPartId} />
      <label style={FIELD}>
        Qty
        <input style={{ ...INPUT, width: 72 }} type="number" min={1} max={maxQty} value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!valid || !dirty || busy} onClick={() => onSave(partId, n)}>
        Save
      </button>
      <ConfirmButton label="Delete devices" confirmLabel={`Delete ${currentQty}`} disabled={busy} onConfirm={onDelete} />
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
      <div style={HINT}>
        {lot
          ? "Edits the lot on the plan — the qty changes the lot's count; no markers are added."
          : "Edits the placements on the plan — a lower qty removes the newest ones in this space."}
      </div>
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

/** Connect / Conduit, after both ends are picked. */
export function PairPanel({
  tool,
  kind,
  fromLabel,
  toLabel,
  cables,
  busy,
  onConnect,
  onConduit,
  onCancel,
}: {
  tool: "connect" | "conduit";
  kind: "route" | "link";
  fromLabel: string;
  toLabel: string;
  cables: RiserPartOption[];
  busy: boolean;
  onConnect: (partId: string, lengthFt: number | null) => void;
  onConduit: (label: string) => void;
  onCancel: () => void;
}) {
  const [partId, setPartId] = useState("");
  const [len, setLen] = useState("");
  const [label, setLabel] = useState('1" EMT (by EC)');
  const ft = Number(len);
  if (tool === "conduit") {
    return (
      <div style={PANEL}>
        <div style={TITLE}>{`Conduit: ${fromLabel} → ${toLabel}`}</div>
        <label style={FIELD}>
          Label
          <input style={{ ...INPUT, width: 240 }} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
        <button type="button" className="pk-btn-accent" disabled={!label.trim() || busy} onClick={() => onConduit(label.trim())}>
          Add conduit
        </button>
        <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <div style={HINT}>An annotation only — conduit is never priced and never on the BOM.</div>
      </div>
    );
  }
  const valid = Boolean(partId) && (kind === "route" || (ft > 0 && ft <= 5000));
  return (
    <div style={PANEL}>
      <div style={TITLE}>{`Connect: ${fromLabel} → ${toLabel}`}</div>
      <PartPicker label="Cable" options={cables} value={partId} onChange={setPartId} />
      {kind === "link" && (
        <label style={FIELD}>
          Length (ft)
          <input style={{ ...INPUT, width: 96 }} type="number" min={1} max={5000} step={1} value={len} onChange={(e) => setLen(e.target.value)} />
        </label>
      )}
      <button type="button" className="pk-btn-accent" disabled={!valid || busy} onClick={() => onConnect(partId, kind === "link" ? ft : null)}>
        {kind === "route" ? "Draw wire on the plan" : "Add link"}
      </button>
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <div style={HINT}>
        {kind === "route"
          ? "Both devices sit on the same calibrated page: this draws a straight wire run on the plan, priced by its measured length."
          : "The ends aren't two devices on one calibrated page: this records a riser link whose typed length prices like a wire run."}
      </div>
    </div>
  );
}

/** New level line, or edit an existing one. */
export function LevelPanel({
  title,
  initialLabel = "",
  initialElevation = "",
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  title: string;
  initialLabel?: string;
  initialElevation?: string;
  busy: boolean;
  onSave: (label: string, elevation: string) => void;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [elevation, setElevation] = useState(initialElevation);
  return (
    <div style={PANEL}>
      <div style={TITLE}>{title}</div>
      <label style={FIELD}>
        Label
        <input style={{ ...INPUT, width: 200 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Stage level" maxLength={60} />
      </label>
      <label style={FIELD}>
        Elevation (optional)
        <input style={{ ...INPUT, width: 140 }} value={elevation} onChange={(e) => setElevation(e.target.value)} placeholder={`EL 100'-0"`} maxLength={30} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!label.trim() || busy} onClick={() => onSave(label.trim(), elevation.trim())}>
        Save
      </button>
      {onDelete && <ConfirmButton label="Delete line" confirmLabel="Delete" disabled={busy} onConfirm={onDelete} />}
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
    </div>
  );
}

/** A selected wire run or riser link. */
export function EdgePanel({ title, detail, busy, onDelete, onCancel }: { title: string; detail: string; busy: boolean; onDelete: () => Promise<void>; onCancel: () => void }) {
  return (
    <div style={PANEL}>
      <div style={TITLE}>{title}</div>
      <div style={HINT}>{detail}</div>
      <ConfirmButton label="Delete connection" confirmLabel="Delete" disabled={busy} onConfirm={onDelete} />
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
    </div>
  );
}

/** A selected conduit annotation. */
export function ConduitPanel({
  label: initial,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onSave: (label: string) => void;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial);
  return (
    <div style={PANEL}>
      <div style={TITLE}>Conduit</div>
      <label style={FIELD}>
        Label
        <input style={{ ...INPUT, width: 240 }} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      </label>
      <button type="button" className="pk-btn-accent" disabled={!label.trim() || label.trim() === initial || busy} onClick={() => onSave(label.trim())}>
        Save
      </button>
      <ConfirmButton label="Delete conduit" confirmLabel="Delete" disabled={busy} onConfirm={onDelete} />
      <button type="button" className="pk-btn-outline" disabled={busy} onClick={onCancel}>
        Close
      </button>
    </div>
  );
}

/** Numbered riser notes: add, edit, delete (they print on E-501). */
export function NotesPanel({
  notes,
  busy,
  inputRef,
  onAdd,
  onSave,
  onDelete,
}: {
  notes: RiserNote[];
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdd: (text: string) => Promise<boolean>;
  onSave: (id: string, text: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  return (
    <div className="pk-card pk-no-print" style={{ padding: "12px 16px", marginTop: 12, fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Riser notes</div>
      {notes.map((n) =>
        editing?.id === n.id ? (
          <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ width: 22, color: "#8c919c" }}>{`${n.n}.`}</span>
            <input style={{ ...INPUT, flex: 1 }} value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} maxLength={500} />
            <button
              type="button"
              className="pk-btn-accent"
              disabled={!editing.text.trim() || busy}
              onClick={() => {
                onSave(n.id, editing.text.trim());
                setEditing(null);
              }}
            >
              Save
            </button>
            <button type="button" className="pk-btn-outline" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ width: 22, color: "#8c919c" }}>{`${n.n}.`}</span>
            <span style={{ flex: 1 }}>{n.text}</span>
            <button type="button" className="pk-btn-outline" style={{ fontSize: 11.5 }} disabled={busy} onClick={() => setEditing({ id: n.id, text: n.text })}>
              Edit
            </button>
            <ConfirmButton label="Delete" confirmLabel="Delete note" disabled={busy} onConfirm={() => onDelete(n.id)} />
          </div>
        )
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          ref={inputRef}
          style={{ ...INPUT, flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a numbered note — e.g. Conduit and boxes by electrical contractor."
          maxLength={500}
        />
        <button
          type="button"
          className="pk-btn-accent"
          disabled={!text.trim() || busy}
          onClick={async () => {
            if (await onAdd(text.trim())) setText("");
          }}
        >
          Add note
        </button>
      </div>
    </div>
  );
}
