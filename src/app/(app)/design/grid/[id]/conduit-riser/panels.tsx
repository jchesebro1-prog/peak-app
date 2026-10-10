"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { FIELD, INPUT, PartPicker, type RiserPartOption } from "../riser/riser-panels";
import { BRAY_POWER_TYPES, MAX_RUN_FT, type ConduitRiserDefaults, type PowerType, type RiserDetail, type RiserNote, type RiserStub } from "@/lib/design/conduit-riser/model";
import { TAG_LIMITS, tagPanelPatch, type EffectiveTag, type PlacementTag, type TagPatch } from "@/lib/design/conduit-riser/tags";
import type { CRBoxType, CRDevice, CRWireType } from "@/lib/design/conduit-riser/input";
import type { ViewRun } from "@/lib/design/conduit-riser/derive";
import type { GridLevel } from "@/lib/design/grid-levels";

/**
 * Lighting control riser panels (#321). Plain controlled forms; the editor
 * owns every server call and passes busy + callbacks in. Each panel is
 * keyed by its data in the editor, so a refresh resets its fields.
 *
 * On a phone the riser is fully read-only (#321 polish, Jeff 2026-10-10):
 * each editing panel has a `…View` twin that shows the same values as
 * text — no inputs, no buttons beyond closing the card.
 */

export const NOTHING_NEW = "Nothing new to accept";
export const SIZE_LIST_ID = "cr-conduit-sizes";
export const BOX_LIST_ID = "cr-box-types";

const BOX: CSSProperties = { background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, marginBottom: 10, fontSize: 12.5 };
const BODY: CSSProperties = { padding: "4px 14px 12px", display: "flex", flexDirection: "column", gap: 8 };
const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" };
const HINT: CSSProperties = { fontSize: 11.5, color: "#8c919c" };
const SMALL: CSSProperties = { fontSize: 11.5, padding: "3px 8px" };
const SUMMARY: CSSProperties = { cursor: "pointer", padding: "9px 14px", fontWeight: 650, fontSize: 13, color: "#16181d", listStyle: "revert" };
const BADGE: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", borderRadius: 5, padding: "1px 6px", background: "#eef1f6", color: "#5b616e" };

/** A collapsible side-panel section. */
export function Section({ title, aside, open = false, children }: { title: string; aside?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} style={BOX}>
      <summary style={SUMMARY}>
        {title}
        {aside !== undefined && <span style={{ marginLeft: 8, fontWeight: 500, color: "#8c919c", fontSize: 12 }}>{aside}</span>}
      </summary>
      <div style={BODY}>{children}</div>
    </details>
  );
}

/** The selected object's panel — always open, above the sections. */
export function Card({ title, onClose, children }: { title: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <div style={{ ...BOX, borderColor: "var(--accent)", boxShadow: "0 1px 0 rgba(0,0,0,.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 4px" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#16181d", flex: 1, minWidth: 0 }}>{title}</div>
        {onClose && (
          <button type="button" className="pk-btn-outline" style={SMALL} onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <div style={BODY}>{children}</div>
    </div>
  );
}

/** A signal bubble, as the sheet draws it. */
export function Bubble({ symbol }: { symbol: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 3px",
        borderRadius: 9,
        border: "1px solid #3b404a",
        fontSize: 9.5,
        fontWeight: 700,
        fontFamily: "var(--font-mono, monospace)",
        color: "#16181d",
        background: "#fff",
      }}
    >
      {symbol}
    </span>
  );
}

function Text({ label, value, onChange, width = 120, max, list, placeholder }: { label: string; value: string; onChange: (v: string) => void; width?: number; max?: number; list?: string; placeholder?: string }) {
  return (
    <label style={FIELD}>
      {label}
      <input style={{ ...INPUT, width }} value={value} maxLength={max} list={list} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** One read-only value with its label — the phone views. A blank shows as "—". */
function Val({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "#8c919c" }}>{label}</span>
      <span style={{ color: "#16181d", overflowWrap: "anywhere" }}>{value === "" || value === null || value === undefined ? "—" : value}</span>
    </div>
  );
}

const yesNo = (v: boolean) => (v ? "Yes" : "No");

/* ------------------------------- tag -------------------------------- */

const TAG_FIELDS: { key: keyof EffectiveTag; label: string; width: number; list?: string; placeholder?: string }[] = [
  { key: "location", label: "Location", width: 150, placeholder: "Space name" },
  { key: "box", label: "Box", width: 64, list: BOX_LIST_ID },
  { key: "face", label: "Face", width: 80 },
  { key: "mount", label: "Mount", width: 64 },
  { key: "height", label: "Height", width: 70, placeholder: '18"' },
];

export function TagPanel({
  device,
  overrides,
  powerTypes,
  pinned,
  planHref,
  busy,
  onSave,
  onUnpin,
  onClose,
}: {
  device: CRDevice;
  /** The placement's own tag fields — what a save compares against. */
  overrides: PlacementTag | undefined;
  powerTypes: PowerType[];
  pinned: boolean;
  planHref: string;
  busy: boolean;
  onSave: (patch: TagPatch) => void;
  onUnpin: () => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<EffectiveTag>(device.tag);
  const set = (k: keyof EffectiveTag, x: string) => setV((cur) => ({ ...cur, [k]: x }));
  // A cleared field reverts (null); retyping what it inherits sets nothing.
  const patch = tagPanelPatch(v, device.tag, overrides);
  const dirty = Object.keys(patch).length > 0;
  const letters = powerTypes.map((p) => p.letter);
  if (v.power && !letters.includes(v.power)) letters.push(v.power);
  return (
    <Card title={<>Tag · {device.label}</>} onClose={onClose}>
      <div style={HINT}>
        {device.desc}
        {device.model ? ` · ${device.model}` : ""} · designator set on the plan —{" "}
        <a href={planHref} style={{ color: "var(--accent)" }}>
          Show on plan
        </a>
      </div>
      <div style={ROW}>
        {TAG_FIELDS.map((f) => (
          <Text key={f.key} label={f.label} value={v[f.key]} width={f.width} max={TAG_LIMITS[f.key as keyof typeof TAG_LIMITS]} list={f.list} placeholder={f.placeholder} onChange={(x) => set(f.key, x)} />
        ))}
        <label style={FIELD}>
          P/D
          <select style={INPUT} value={v.pd} onChange={(e) => set("pd", e.target.value)}>
            <option value="">—</option>
            <option value="P">P</option>
            <option value="D">D</option>
            <option value="P/D">P/D</option>
          </select>
        </label>
        <label style={FIELD}>
          Power type
          <select style={INPUT} value={v.power} onChange={(e) => set("power", e.target.value)}>
            <option value="">None</option>
            {letters.map((l) => (
              <option key={l} value={l}>
                {l}
                {powerTypes.find((p) => p.letter === l) ? ` — ${powerTypes.find((p) => p.letter === l)!.type}` : ""}
              </option>
            ))}
          </select>
        </label>
        <Text label="Power controls contents" value={v.contents} width={200} max={TAG_LIMITS.contents} placeholder="(6) LED10" onChange={(x) => set("contents", x)} />
      </div>
      {powerTypes.length === 0 && <div style={HINT}>Add power types below to give this tag a power letter.</div>}
      <div style={ROW}>
        <button type="button" className="pk-btn-accent" disabled={!dirty || busy} onClick={() => onSave(patch)}>
          Save tag
        </button>
        <button
          type="button"
          className="pk-btn-outline"
          disabled={busy}
          title="Clear this device's own values — the part's defaults and the space name show again"
          onClick={() => onSave({ box: null, face: null, mount: null, height: null, pd: null, location: null, power: null, contents: null })}
        >
          Use part defaults
        </button>
        {pinned && (
          <button type="button" className="pk-btn-outline" disabled={busy} onClick={onUnpin}>
            Back to auto position
          </button>
        )}
      </div>
    </Card>
  );
}

/** The tag, read-only (phone). */
export function TagView({ device, powerTypes, planHref, onClose }: { device: CRDevice; powerTypes: PowerType[]; planHref: string; onClose: () => void }) {
  const t = device.tag;
  const power = t.power ? `${t.power}${powerTypes.find((p) => p.letter === t.power) ? ` — ${powerTypes.find((p) => p.letter === t.power)!.type}` : ""}` : "None";
  return (
    <Card title={<>Tag · {device.label}</>} onClose={onClose}>
      <div style={HINT}>
        {device.desc}
        {device.model ? ` · ${device.model}` : ""} —{" "}
        <a href={planHref} style={{ color: "var(--accent)" }}>
          Show on plan
        </a>
      </div>
      <div style={{ ...ROW, alignItems: "flex-start", rowGap: 6 }}>
        {TAG_FIELDS.map((f) => (
          <Val key={f.key} label={f.label} value={t[f.key]} />
        ))}
        <Val label="P/D" value={t.pd} />
        <Val label="Power type" value={power} />
        <Val label="Power controls contents" value={t.contents} />
      </div>
    </Card>
  );
}

/* -------------------------------- run -------------------------------- */

export type RunSave = {
  size: string;
  style: "conduit" | "cableMgmt";
  lengthFt: number | null;
  priceWire?: boolean | null;
  priceConduit?: boolean | null;
  signals?: string[];
};

type Tri = "default" | "yes" | "no";
const triOf = (v: boolean | undefined): Tri => (v === undefined ? "default" : v ? "yes" : "no");
const triVal = (t: Tri): boolean | null => (t === "default" ? null : t === "yes");

function TriSelect({ label, value, fallback, onChange }: { label: string; value: Tri; fallback: boolean; onChange: (t: Tri) => void }) {
  return (
    <label style={FIELD}>
      {label}
      <select style={INPUT} value={value} onChange={(e) => onChange(e.target.value as Tri)}>
        <option value="default">Default ({fallback ? "yes" : "no"})</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

/** The wires a run carries (or the empty-conduit note). */
function RunMembers({ vr }: { vr: ViewRun }) {
  return vr.members.length > 0 ? (
    <div>
      <div style={{ ...FIELD, marginBottom: 4 }}>Wires in this conduit</div>
      {vr.members.map((m) => (
        <div key={`${m.kind}:${m.id}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
          <Bubble symbol={m.signal?.symbol || "?"} />
          <span style={{ flex: 1 }}>{m.cable}</span>
          <span style={{ color: "#8c919c", fontVariantNumeric: "tabular-nums" }}>{m.lengthFt !== null ? `${Math.round(m.lengthFt * 10) / 10} ft` : "unmeasured"}</span>
        </div>
      ))}
    </div>
  ) : vr.empty ? (
    <div style={{ ...HINT, color: "#8a6a1f" }}>No wires in this conduit — it prints as an empty conduit with its size.</div>
  ) : null;
}

const measuredFt = (vr: ViewRun) =>
  vr.members.length && vr.members.every((m) => m.lengthFt !== null) ? vr.members.reduce((s, m) => s + (m.lengthFt || 0), 0) : null;

export function RunPanel({
  vr,
  aLabel,
  bLabel,
  wireTypes,
  defaults,
  estimateOwned,
  busy,
  onSave,
  onRemove,
  onClose,
}: {
  vr: ViewRun;
  aLabel: string;
  bLabel: string;
  wireTypes: CRWireType[];
  defaults: ConduitRiserDefaults;
  estimateOwned: boolean;
  busy: boolean;
  onSave: (v: RunSave) => void;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const run = vr.run;
  const stubRun = run.a.kind === "stub" || run.b.kind === "stub";
  const [size, setSize] = useState(run.size);
  const [style, setStyle] = useState(run.style);
  const [length, setLength] = useState(run.lengthFt !== undefined ? String(run.lengthFt) : "");
  const [pw, setPw] = useState<Tri>(triOf(run.priceWire));
  const [pc, setPc] = useState<Tri>(triOf(run.priceConduit));
  const [signals, setSignals] = useState<string[]>(run.signals || []);
  const measured = measuredFt(vr);
  const ft = length.trim() ? Number(length) : null;
  const lengthOk = ft === null || (Number.isFinite(ft) && ft > 0 && ft <= MAX_RUN_FT);
  const save = () =>
    onSave({
      size: size.trim(),
      style,
      lengthFt: ft,
      ...(estimateOwned ? {} : { priceWire: triVal(pw), priceConduit: triVal(pc) }),
      ...(stubRun ? { signals } : {}),
    });
  return (
    <Card title={<>Run · {aLabel} → {bLabel}</>} onClose={onClose}>
      <div style={ROW}>
        <Text label="Size" value={size} width={80} max={12} list={SIZE_LIST_ID} onChange={setSize} />
        <label style={FIELD}>
          Line
          <select style={INPUT} value={style} onChange={(e) => setStyle(e.target.value === "cableMgmt" ? "cableMgmt" : "conduit")}>
            <option value="conduit">Conduit</option>
            <option value="cableMgmt">Cable management</option>
          </select>
        </label>
        <label style={FIELD}>
          Length (ft)
          <input
            style={{ ...INPUT, width: 120 }}
            type="number"
            min={0}
            max={MAX_RUN_FT}
            step="0.1"
            value={length}
            placeholder={measured !== null ? `${Math.round(measured * 10) / 10} measured` : "measured"}
            onChange={(e) => setLength(e.target.value)}
          />
        </label>
        {!estimateOwned && (
          <>
            <TriSelect label="Price wire" value={pw} fallback={defaults.priceWire} onChange={setPw} />
            <TriSelect label="Price conduit" value={pc} fallback={defaults.priceConduit} onChange={setPc} />
          </>
        )}
      </div>
      <div style={HINT}>Leave the length blank to use the wires&apos; measured footage.</div>
      <RunMembers vr={vr} />
      {stubRun && (
        <div>
          <div style={{ ...FIELD, marginBottom: 4 }}>Signals shown on this run</div>
          {wireTypes.length === 0 && <div style={HINT}>No wire types have a symbol yet — set them in Settings → Wire types.</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {wireTypes.map((t) => (
              <label key={t.id} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={signals.includes(t.id)}
                  onChange={(e) => setSignals((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                />
                <Bubble symbol={t.symbol} /> {t.signal}
              </label>
            ))}
          </div>
          <div style={HINT}>For a run to a stub (e.g. &quot;wire pull by others&quot;) — shown only, never priced.</div>
        </div>
      )}
      <div style={ROW}>
        <button type="button" className="pk-btn-accent" disabled={busy || !size.trim() || !lengthOk} onClick={save}>
          Save run
        </button>
        <ConfirmButton label="Remove from riser" confirmLabel="Remove run" disabled={busy} onConfirm={onRemove} />
      </div>
      <div style={HINT}>Removing a run leaves its wires on the plan; they show again under From the plan.</div>
    </Card>
  );
}

/** The run, read-only (phone). */
export function RunView({
  vr,
  aLabel,
  bLabel,
  wireTypes,
  defaults,
  estimateOwned,
  onClose,
}: {
  vr: ViewRun;
  aLabel: string;
  bLabel: string;
  wireTypes: CRWireType[];
  defaults: ConduitRiserDefaults;
  estimateOwned: boolean;
  onClose: () => void;
}) {
  const run = vr.run;
  const stubRun = run.a.kind === "stub" || run.b.kind === "stub";
  const measured = measuredFt(vr);
  const tri = (v: boolean | undefined, fallback: boolean) => (v === undefined ? `Default (${fallback ? "yes" : "no"})` : yesNo(v));
  const shown = wireTypes.filter((t) => (run.signals || []).includes(t.id));
  return (
    <Card title={<>Run · {aLabel} → {bLabel}</>} onClose={onClose}>
      <div style={{ ...ROW, alignItems: "flex-start", rowGap: 6 }}>
        <Val label="Size" value={run.size} />
        <Val label="Line" value={run.style === "cableMgmt" ? "Cable management" : "Conduit"} />
        <Val label="Length" value={run.lengthFt !== undefined ? `${run.lengthFt} ft` : measured !== null ? `${Math.round(measured * 10) / 10} ft measured` : "measured"} />
        {!estimateOwned && (
          <>
            <Val label="Price wire" value={tri(run.priceWire, defaults.priceWire)} />
            <Val label="Price conduit" value={tri(run.priceConduit, defaults.priceConduit)} />
          </>
        )}
      </div>
      <RunMembers vr={vr} />
      {stubRun && (
        <div>
          <div style={{ ...FIELD, marginBottom: 4 }}>Signals shown on this run</div>
          {shown.length === 0 ? (
            <span style={HINT}>None</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {shown.map((t) => (
                <span key={t.id} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <Bubble symbol={t.symbol} /> {t.signal}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------ stubs -------------------------------- */

export function StubPanel({ stub, busy, onRename, onRemove, onClose }: { stub: RiserStub; busy: boolean; onRename: (label: string) => void; onRemove: () => Promise<void>; onClose: () => void }) {
  const [label, setLabel] = useState(stub.label);
  return (
    <Card title={<>Stub · {stub.label}</>} onClose={onClose}>
      <div style={ROW}>
        <Text label="Label" value={label} width={200} max={60} onChange={setLabel} />
        <button type="button" className="pk-btn-accent" disabled={busy || !label.trim() || label === stub.label} onClick={() => onRename(label)}>
          Save
        </button>
        <ConfirmButton label="Remove stub" confirmLabel="Remove stub and its runs" disabled={busy} onConfirm={onRemove} />
      </div>
      <div style={HINT}>A stub is a line ending in a label, like &quot;TO FACP&quot;. Use Connect to run conduit to it.</div>
    </Card>
  );
}

/** The stub, read-only (phone). */
export function StubView({ stub, onClose }: { stub: RiserStub; onClose: () => void }) {
  return (
    <Card title={<>Stub · {stub.label}</>} onClose={onClose}>
      <div style={HINT}>A stub is a line ending in a label, like &quot;TO FACP&quot;.</div>
    </Card>
  );
}

export function NewStubPanel({ busy, onAdd, onClose }: { busy: boolean; onAdd: (label: string) => void; onClose: () => void }) {
  const [label, setLabel] = useState("TO ");
  const ok = label.trim().length > 0 && label.trim() !== "TO";
  return (
    <Card title="New stub" onClose={onClose}>
      <div style={ROW}>
        <Text label="Label" value={label} width={200} max={60} placeholder="TO FACP" onChange={setLabel} />
        <button type="button" className="pk-btn-accent" disabled={busy || !ok} onClick={() => onAdd(label.trim())}>
          Add stub
        </button>
      </div>
      <div style={HINT}>It lands in this detail; drag it where it belongs, then Connect a tag to it.</div>
    </Card>
  );
}

/* ------------------------------ connect ------------------------------ */

export function PairPanel({
  aLabel,
  bLabel,
  canWire,
  kind,
  cables,
  busy,
  onConduit,
  onWire,
  onClose,
}: {
  aLabel: string;
  bLabel: string;
  /** Both ends are devices — a stub can take a conduit, not a plan wire. */
  canWire: boolean;
  kind: "route" | "link";
  cables: RiserPartOption[];
  busy: boolean;
  onConduit: () => void;
  onWire: (partId: string, lengthFt: number | null) => void;
  onClose: () => void;
}) {
  const [wire, setWire] = useState(false);
  const [partId, setPartId] = useState("");
  const [length, setLength] = useState("");
  const ft = Number(length);
  const valid = Boolean(partId) && (kind === "route" || (Number.isFinite(ft) && ft > 0 && ft <= MAX_RUN_FT));
  return (
    <Card title={<>Connect {aLabel} → {bLabel}</>} onClose={onClose}>
      {!wire ? (
        <div style={ROW}>
          <button type="button" className="pk-btn-accent" disabled={busy} onClick={onConduit}>
            Conduit only
          </button>
          <button type="button" className="pk-btn-outline" disabled={busy || !canWire} onClick={() => setWire(true)} title={canWire ? undefined : "A stub isn't on the plan — run a conduit to it instead"}>
            With wire…
          </button>
        </div>
      ) : (
        <>
          <PartPicker label="Cable" options={cables} value={partId} onChange={setPartId} />
          {kind === "link" && (
            <label style={FIELD}>
              Length (ft)
              <input style={{ ...INPUT, width: 90 }} type="number" min={1} max={MAX_RUN_FT} value={length} onChange={(e) => setLength(e.target.value)} />
            </label>
          )}
          <div style={HINT}>
            {kind === "route"
              ? "Both devices are on the same scaled page — the wire is drawn on the plan and measured."
              : "The devices are on different pages, or the page has no scale — type the cable length."}
          </div>
          <div style={ROW}>
            <button type="button" className="pk-btn-accent" disabled={busy || !valid} onClick={() => onWire(partId, kind === "route" ? null : ft)}>
              Add wire and conduit
            </button>
            <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => setWire(false)}>
              Back
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

export function LevelLinePanel({ label, moved, busy, onReset, onClose }: { label: string; moved: boolean; busy: boolean; onReset: () => void; onClose: () => void }) {
  return (
    <Card title={<>Level line · {label}</>} onClose={onClose}>
      <div style={HINT}>Drag the dashed line to move it in this detail. Rename levels under Levels below.</div>
      {moved && (
        <div style={ROW}>
          <button type="button" className="pk-btn-outline" disabled={busy} onClick={onReset}>
            Back to auto position
          </button>
        </div>
      )}
    </Card>
  );
}

/** A level line, read-only (phone). */
export function LevelLineView({ label, elevation, onClose }: { label: string; elevation?: string; onClose: () => void }) {
  return (
    <Card title={<>Level line · {label}</>} onClose={onClose}>
      <Val label="Elevation" value={elevation} />
    </Card>
  );
}

/* --------------------------- from the plan ---------------------------- */

export type SuggestionRow = {
  key: string;
  kind: "new" | "join";
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  symbols: string[];
  wires: number;
};

export function SuggestionsPanel({
  rows,
  loose,
  planHref,
  busy,
  readOnly = false,
  onAccept,
  onDismiss,
}: {
  rows: SuggestionRow[];
  loose: { id: string; cable: string }[];
  planHref: string;
  busy: boolean;
  /** Phone: the rows show, Accept / Accept all / Dismiss don't. */
  readOnly?: boolean;
  onAccept: (keys: string[] | "all") => void;
  onDismiss: (key: string) => void;
}) {
  return (
    <Section title="From the plan" aside={rows.length ? `${rows.length} new` : undefined} open={rows.length > 0 || loose.length > 0}>
      {rows.length === 0 ? (
        <div style={HINT}>{NOTHING_NEW} — every lighting wire between two devices is on the riser.</div>
      ) : (
        <>
          {readOnly ? null : (
            <div style={ROW}>
              <button type="button" className="pk-btn-accent" style={SMALL} disabled={busy} onClick={() => onAccept("all")}>
                Accept all
              </button>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.key} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #f0f2f5", paddingTop: 6 }}>
              <span style={{ fontWeight: 600 }}>
                {r.aLabel} → {r.bLabel}
              </span>
              {r.symbols.map((s) => (
                <Bubble key={s} symbol={s} />
              ))}
              {r.kind === "join" && <span style={BADGE}>joins run</span>}
              {readOnly ? null : (
                <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button type="button" className="pk-btn-outline" style={SMALL} disabled={busy} onClick={() => onAccept([r.key])}>
                    Accept
                  </button>
                  {r.kind === "new" && (
                    <button type="button" className="pk-btn-outline" style={SMALL} disabled={busy} onClick={() => onDismiss(r.key)}>
                      Dismiss
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </>
      )}
      {loose.length > 0 && (
        <div style={{ borderTop: "1px solid #f0f2f5", paddingTop: 6 }}>
          <div style={{ ...FIELD, marginBottom: 4 }}>Not connected to two devices</div>
          {loose.map((w) => (
            <div key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
              <span style={{ flex: 1 }}>{w.cable}</span>
              <a href={planHref} style={{ color: "var(--accent)", fontSize: 12 }}>
                Show on plan
              </a>
            </div>
          ))}
          <div style={HINT}>Snap both ends of these wires to devices on the plan to put them on the riser.</div>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------ details ------------------------------- */

export function DetailPanel({
  detail,
  spaces,
  detailCount,
  busy,
  onSave,
  onAdd,
  onRemove,
}: {
  detail: RiserDetail;
  spaces: { id: string; name: string }[];
  detailCount: number;
  busy: boolean;
  onSave: (v: { name: string; n: string; allSpaces: boolean; spaceIds: string[] }) => void;
  onAdd: (name: string) => void;
  onRemove: () => Promise<void>;
}) {
  const [name, setName] = useState(detail.name);
  const [n, setN] = useState(detail.n);
  const [all, setAll] = useState(detail.allSpaces);
  const [ids, setIds] = useState<string[]>(detail.spaceIds);
  const [newName, setNewName] = useState("");
  // One radio group per detail — the two scope choices exclude each other.
  const scopeName = `cr-detail-scope-${detail.id}`;
  return (
    <Section title="Detail" aside={`${detail.n} · ${detail.name}`}>
      <div style={ROW}>
        <Text label="Number" value={n} width={56} max={8} onChange={setN} />
        <Text label="Name" value={name} width={180} max={60} onChange={setName} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name={scopeName} checked={all} onChange={() => setAll(true)} /> All spaces
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name={scopeName} checked={!all} onChange={() => setAll(false)} /> Only these spaces
        </label>
        {!all && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 20, maxHeight: 180, overflowY: "auto" }}>
            {spaces.length === 0 && <span style={HINT}>No spaces on the plan yet.</span>}
            {spaces.map((s) => (
              <label key={s.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={ids.includes(s.id)} onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <div style={HINT}>A device lands in the first detail (by number) that covers its space.</div>
      <div style={ROW}>
        <button type="button" className="pk-btn-accent" style={SMALL} disabled={busy || !name.trim() || !n.trim()} onClick={() => onSave({ name: name.trim(), n: n.trim(), allSpaces: all, spaceIds: all ? [] : ids })}>
          Save detail
        </button>
        {detailCount > 1 && <ConfirmButton label="Delete detail" confirmLabel="Delete detail" disabled={busy} onConfirm={onRemove} style={SMALL} />}
      </div>
      <div style={{ ...ROW, borderTop: "1px solid #f0f2f5", paddingTop: 8 }}>
        <Text label="New detail" value={newName} width={180} max={60} placeholder="e.g. Lobby" onChange={setNewName} />
        <button
          type="button"
          className="pk-btn-outline"
          style={SMALL}
          disabled={busy || !newName.trim()}
          onClick={() => {
            onAdd(newName.trim());
            setNewName("");
          }}
        >
          + Detail
        </button>
      </div>
    </Section>
  );
}

/** The detail, read-only (phone). */
export function DetailView({ detail, spaces }: { detail: RiserDetail; spaces: { id: string; name: string }[] }) {
  const names = detail.spaceIds.map((id) => spaces.find((s) => s.id === id)?.name).filter((n): n is string => !!n);
  return (
    <Section title="Detail" aside={`${detail.n} · ${detail.name}`}>
      <div style={{ ...ROW, alignItems: "flex-start" }}>
        <Val label="Number" value={detail.n} />
        <Val label="Name" value={detail.name} />
      </div>
      <Val label="Covers" value={detail.allSpaces ? "All spaces" : names.length ? names.join(", ") : "No spaces"} />
    </Section>
  );
}

/* ------------------------------- levels ------------------------------- */

type LevelRow = { id?: string; label: string; elevation: string };

export function LevelsPanel({ levels, busy, onSave }: { levels: GridLevel[]; busy: boolean; onSave: (rows: LevelRow[]) => void }) {
  const [rows, setRows] = useState<LevelRow[]>(levels.map((l) => ({ id: l.id, label: l.label, elevation: l.elevation || "" })));
  const edit = (i: number, patch: Partial<LevelRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <Section title="Levels" aside={`${levels.length}`}>
      <div style={HINT}>Shared by the whole design. Top to bottom is how the bands stack on the riser.</div>
      {rows.map((r, i) => (
        <div key={r.id || `new-${i}`} style={{ ...ROW, alignItems: "center" }}>
          <input style={{ ...INPUT, width: 130 }} value={r.label} maxLength={40} placeholder="Catwalk" aria-label="Level name" onChange={(e) => edit(i, { label: e.target.value })} />
          <input style={{ ...INPUT, width: 80 }} value={r.elevation} maxLength={20} placeholder={"+24'-0\""} aria-label="Elevation" onChange={(e) => edit(i, { elevation: e.target.value })} />
          <button type="button" className="pk-btn-outline" style={SMALL} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="pk-btn-outline" style={SMALL} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
            ↓
          </button>
          <button type="button" className="pk-btn-outline" style={SMALL} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove level">
            ✕
          </button>
        </div>
      ))}
      <div style={ROW}>
        <button type="button" className="pk-btn-outline" style={SMALL} disabled={rows.length >= 30} onClick={() => setRows((cur) => [...cur, { label: "", elevation: "" }])}>
          + Level
        </button>
        <button type="button" className="pk-btn-accent" style={SMALL} disabled={busy} onClick={() => onSave(rows)}>
          Save levels
        </button>
      </div>
      <div style={HINT}>Give each space or sheet its level on the plan; removing a level clears it there too.</div>
    </Section>
  );
}

/** Levels, read-only (phone). */
export function LevelsView({ levels }: { levels: GridLevel[] }) {
  return (
    <Section title="Levels" aside={`${levels.length}`}>
      {levels.length === 0 && <div style={HINT}>No levels yet.</div>}
      {levels.map((l) => (
        <div key={l.id} style={{ display: "flex", gap: 8 }}>
          <span style={{ flex: 1 }}>{l.label || "—"}</span>
          <span style={{ color: "#8c919c" }}>{l.elevation || ""}</span>
        </div>
      ))}
    </Section>
  );
}

/* ---------------------------- power types ----------------------------- */

export function PowerTypesPanel({ rows: initial, busy, onSave }: { rows: PowerType[]; busy: boolean; onSave: (rows: PowerType[]) => void }) {
  const [rows, setRows] = useState<PowerType[]>(initial);
  const edit = (i: number, patch: Partial<PowerType>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Section title="Power types" aside={`${initial.length}`}>
      {initial.length === 0 && rows.length === 0 && (
        <div style={ROW}>
          <button type="button" className="pk-btn-outline" style={SMALL} disabled={busy} onClick={() => onSave(BRAY_POWER_TYPES.map((p) => ({ ...p })))}>
            Start from Bray&apos;s A–E
          </button>
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} style={{ ...ROW, alignItems: "center" }}>
          <input style={{ ...INPUT, width: 38 }} value={r.letter} maxLength={2} aria-label="Symbol" onChange={(e) => edit(i, { letter: e.target.value.toUpperCase() })} />
          <input style={{ ...INPUT, width: 84 }} value={r.type} maxLength={40} placeholder="Normal" aria-label="Type" onChange={(e) => edit(i, { type: e.target.value })} />
          <input style={{ ...INPUT, width: 120 }} value={r.config} maxLength={60} placeholder="3Ø, 4 wire+GND" aria-label="Configuration" onChange={(e) => edit(i, { config: e.target.value })} />
          <input style={{ ...INPUT, width: 120 }} value={r.input} maxLength={60} placeholder="120V / 20A / 60Hz" aria-label="Input" onChange={(e) => edit(i, { input: e.target.value })} />
          <button type="button" className="pk-btn-outline" style={SMALL} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove power type">
            ✕
          </button>
        </div>
      ))}
      <div style={ROW}>
        <button type="button" className="pk-btn-outline" style={SMALL} disabled={rows.length >= 20} onClick={() => setRows((cur) => [...cur, { letter: "", type: "", config: "", input: "" }])}>
          + Power type
        </button>
        <button type="button" className="pk-btn-accent" style={SMALL} disabled={busy} onClick={() => onSave(rows)}>
          Save power types
        </button>
      </div>
      <div style={HINT}>A tag&apos;s power letter prints in the diamond under it; this table prints on the sheet.</div>
    </Section>
  );
}

/** Power types, read-only (phone). */
export function PowerTypesView({ rows }: { rows: PowerType[] }) {
  return (
    <Section title="Power types" aside={`${rows.length}`}>
      {rows.length === 0 && <div style={HINT}>None yet.</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, width: 22 }}>{r.letter}</span>
          <span>{r.type || "—"}</span>
          <span style={{ color: "#8c919c" }}>{[r.config, r.input].filter(Boolean).join(" · ")}</span>
        </div>
      ))}
    </Section>
  );
}

/* ---------------------------- always show ----------------------------- */

export function AlwaysShowPanel({ types, selected, busy, onSave }: { types: { key: string; label: string }[]; selected: string[]; busy: boolean; onSave: (keys: string[]) => void }) {
  return (
    <Section title="Always show" aside={`${selected.length}`}>
      <div style={HINT}>Devices of these types get a tag even before any conduit reaches them.</div>
      {types.map((t) => (
        <label key={t.key} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            disabled={busy}
            checked={selected.includes(t.key)}
            onChange={(e) => onSave(e.target.checked ? [...selected, t.key] : selected.filter((k) => k !== t.key))}
          />
          {t.label}
        </label>
      ))}
    </Section>
  );
}

/** Always show, read-only (phone). */
export function AlwaysShowView({ types, selected }: { types: { key: string; label: string }[]; selected: string[] }) {
  const on = types.filter((t) => selected.includes(t.key));
  return (
    <Section title="Always show" aside={`${selected.length}`}>
      <div>{on.length ? on.map((t) => t.label).join(", ") : "None"}</div>
    </Section>
  );
}

/* ------------------------------ defaults ------------------------------ */

export function DefaultsPanel({
  defaults,
  estimateOwned,
  busy,
  onSave,
}: {
  defaults: ConduitRiserDefaults;
  estimateOwned: boolean;
  busy: boolean;
  onSave: (v: { size: string; priceWire?: boolean; priceConduit?: boolean }) => void;
}) {
  const [size, setSize] = useState(defaults.size);
  const [pw, setPw] = useState(defaults.priceWire);
  const [pc, setPc] = useState(defaults.priceConduit);
  return (
    <Section title="Defaults" aside={defaults.size}>
      <div style={ROW}>
        <Text label="Conduit size for new runs" value={size} width={90} max={12} list={SIZE_LIST_ID} onChange={setSize} />
      </div>
      {estimateOwned ? (
        <div style={HINT}>This design belongs to an estimate, so the riser never prices wire or conduit — the estimate does.</div>
      ) : (
        <>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={pw} onChange={(e) => setPw(e.target.checked)} /> Price wire in conduit
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={pc} onChange={(e) => setPc(e.target.checked)} /> Price conduit
          </label>
          <div style={HINT}>Each run can override these under its own panel.</div>
        </>
      )}
      <div style={ROW}>
        <button
          type="button"
          className="pk-btn-accent"
          style={SMALL}
          disabled={busy || !size.trim()}
          onClick={() => onSave(estimateOwned ? { size: size.trim() } : { size: size.trim(), priceWire: pw, priceConduit: pc })}
        >
          Save defaults
        </button>
      </div>
    </Section>
  );
}

/** Defaults, read-only (phone). */
export function DefaultsView({ defaults, estimateOwned }: { defaults: ConduitRiserDefaults; estimateOwned: boolean }) {
  return (
    <Section title="Defaults" aside={defaults.size}>
      <div style={{ ...ROW, alignItems: "flex-start" }}>
        <Val label="Conduit size for new runs" value={defaults.size} />
        {!estimateOwned && (
          <>
            <Val label="Price wire in conduit" value={yesNo(defaults.priceWire)} />
            <Val label="Price conduit" value={yesNo(defaults.priceConduit)} />
          </>
        )}
      </div>
      {estimateOwned && <div style={HINT}>This design belongs to an estimate, so the riser never prices wire or conduit — the estimate does.</div>}
    </Section>
  );
}

/* -------------------------------- notes ------------------------------- */

function NoteRow({ note, busy, onSave, onRemove }: { note: RiserNote; busy: boolean; onSave: (text: string) => void; onRemove: () => Promise<void> }) {
  const [text, setText] = useState(note.text);
  return (
    <div style={{ ...ROW, alignItems: "center" }}>
      <span style={{ width: 18, textAlign: "right", color: "#8c919c" }}>{note.n}.</span>
      <input style={{ ...INPUT, flex: 1, minWidth: 140 }} value={text} maxLength={500} aria-label={`Note ${note.n}`} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="pk-btn-outline" style={SMALL} disabled={busy || !text.trim() || text === note.text} onClick={() => onSave(text)}>
        Save
      </button>
      <ConfirmButton label="✕" confirmLabel="Delete" disabled={busy} onConfirm={onRemove} style={SMALL} ariaLabel={`Delete note ${note.n}`} />
    </div>
  );
}

export function NotesPanel({
  notes,
  busy,
  onAdd,
  onSave,
  onRemove,
}: {
  notes: RiserNote[];
  busy: boolean;
  onAdd: (text: string) => Promise<boolean>;
  onSave: (id: string, text: string) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  return (
    <Section title="Notes" aside={`${notes.length}`}>
      {notes.map((n) => (
        <NoteRow key={`${n.id}:${n.text}`} note={n} busy={busy} onSave={(t) => onSave(n.id, t)} onRemove={() => onRemove(n.id)} />
      ))}
      <div style={ROW}>
        <input style={{ ...INPUT, flex: 1, minWidth: 160 }} value={text} maxLength={500} placeholder="Wire pull from fire alarm panel by others." aria-label="New note" onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className="pk-btn-outline"
          style={SMALL}
          disabled={busy || !text.trim()}
          onClick={async () => {
            if (await onAdd(text.trim())) setText("");
          }}
        >
          + Note
        </button>
      </div>
      <div style={HINT}>Numbered notes print as General notes on the riser sheet.</div>
    </Section>
  );
}

/** Notes, read-only (phone). */
export function NotesView({ notes }: { notes: RiserNote[] }) {
  return (
    <Section title="Notes" aside={`${notes.length}`}>
      {notes.length === 0 && <div style={HINT}>No notes.</div>}
      {notes.map((n) => (
        <div key={n.id} style={{ display: "flex", gap: 8 }}>
          <span style={{ width: 18, textAlign: "right", color: "#8c919c" }}>{n.n}.</span>
          <span style={{ flex: 1, overflowWrap: "anywhere" }}>{n.text}</span>
        </div>
      ))}
    </Section>
  );
}

export function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <Section title="Warnings" aside={`${warnings.length}`} open>
      <ul style={{ margin: 0, paddingLeft: 18, color: "#8a4b2a", display: "flex", flexDirection: "column", gap: 3 }}>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </Section>
  );
}

/** Datalists the size and box inputs share. */
export function SharedLists({ sizes, boxTypes }: { sizes: string[]; boxTypes: CRBoxType[] }) {
  return (
    <>
      <datalist id={SIZE_LIST_ID}>
        {sizes.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id={BOX_LIST_ID}>
        {boxTypes.map((b) => (
          <option key={b.code} value={b.code}>
            {b.description}
          </option>
        ))}
      </datalist>
    </>
  );
}
