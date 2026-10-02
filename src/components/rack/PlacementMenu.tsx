"use client";
/**
 * #296 — the placement popover (right-click, long-press or the slot's ⋯ button):
 * face, width + lane, per-placement overrides, optional, replace part, notes,
 * duplicate ×N and remove. Every change is one engine edit through `onEdit`, so
 * each is one undo step; a refused edit shows the engine's reason inline.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { slotAriaLabel } from "@/lib/rack/geometry";
import { move, remove, update } from "@/lib/rack/layout";
import { duplicatePlacement, setPlacementOverride, type OverrideNumberKey } from "@/lib/rack/rules";
import type { RackEdit, RackFace, RackLayout, RackPartLookup, RackPlacement } from "@/lib/rack/types";

export type PlacementMenuProps = {
  placement: RackPlacement;
  layout: RackLayout;
  lookup: RackPartLookup;
  at: { x: number; y: number };
  onEdit: (edit: (l: RackLayout) => RackEdit) => boolean;
  onReplace: (id: string) => void;
  onClose: () => void;
  newId: () => string;
  /** Focus goes back here when the menu closes (the slot that opened it). */
  returnFocusTo?: HTMLElement | null;
};

const WIDTHS = [
  { n: 1, label: "Full" },
  { n: 2, label: "Half" },
  { n: 3, label: "Third" },
] as const;
const LANE_NAMES: Record<2 | 3, string[]> = { 2: ["Left", "Right"], 3: ["Left", "Center", "Right"] };
const DUP_MAX = 50;
const NOTES_MAX = 200;

export function PlacementMenu(props: PlacementMenuProps) {
  const { placement: p, layout, lookup, at, onEdit, onReplace, newId } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onClose);
  const returnRef = useRef(props.returnFocusTo);
  useEffect(() => {
    closeRef.current = props.onClose;
    returnRef.current = props.returnFocusTo;
  });
  const [msg, setMsg] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [dupN, setDupN] = useState("1");

  // Keep the popover on screen.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;
  }, [at.x, at.y]);

  // Focus in on open, back to the opener on close; Escape or a click outside closes.
  useEffect(() => {
    const el = boxRef.current;
    el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    const onDown = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    const ret = returnRef;
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      ret.current?.focus();
    };
  }, []);

  /** One engine edit; on refusal show its reason. */
  const run = (edit: (l: RackLayout) => RackEdit): boolean => {
    const fail = { reason: "" };
    const ok = onEdit((l) => {
      const r = edit(l);
      if (!r.ok) fail.reason = r.reason;
      return r;
    });
    setMsg(ok ? null : { tone: "error", text: fail.reason || "That change wasn't made." });
    return ok;
  };

  const info = p.sku ? lookup(p.sku) : undefined;
  const isChild = !!p.shelfId;
  const reserved = p.kind === "reserved";
  const n = p.laneCount ?? 1;
  const lane = p.lane ?? 0;
  const title = slotAriaLabel(p, info, layout.config, layout);

  const setWidth = (next: 1 | 2 | 3) =>
    run((l) => update(l, p.id, next === 1 ? { laneCount: undefined, lane: undefined } : { laneCount: next, lane: Math.min(lane, next - 1) as 0 | 1 | 2 }));

  const duplicate = () => {
    const want = Math.max(1, Math.min(DUP_MAX, Math.floor(Number(dupN)) || 1));
    const res = { placed: 0 };
    const ok = run((l) => {
      const d = duplicatePlacement(l, p.id, want, newId);
      res.placed = d.placed;
      return d;
    });
    if (!ok) return;
    setMsg({
      tone: "info",
      text: res.placed === want ? `Placed ${want} ${want === 1 ? "copy" : "copies"}.` : `Placed ${res.placed} of ${want} — the rack is full.`,
    });
  };

  const removeIt = () => {
    if (run((l) => remove(l, p.id))) closeRef.current();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={`Options for ${title}`}
      className="pk-card"
      style={{
        position: "fixed",
        left: at.x,
        top: at.y,
        zIndex: 70,
        width: 300,
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        padding: 12,
        background: "#fff",
        border: "1px solid var(--card-border)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        color: "var(--ink)",
        fontSize: 13,
      }}
    >
      <div className="mb-2 text-xs font-semibold" style={{ color: "var(--muted)" }}>
        {title}
      </div>

      <fieldset className="mb-2" disabled={isChild}>
        <legend className="pk-field-label">Face</legend>
        <div className="flex gap-3">
          {(["front", "rear"] as RackFace[]).map((f) => (
            <label key={f} className="flex items-center gap-1">
              <input type="radio" name={`face-${p.id}`} checked={p.face === f} onChange={() => run((l) => move(l, p.id, { face: f }))} />
              {f === "front" ? "Front" : "Rear"}
            </label>
          ))}
        </div>
        {isChild ? <div className="text-xs" style={{ color: "var(--muted)" }}>On a shelf — it faces the way the shelf does.</div> : null}
      </fieldset>

      <div className="mb-2 flex gap-2">
        <label className="flex-1">
          <span className="pk-field-label">Width</span>
          <select className="pk-input" value={n} onChange={(e) => setWidth(Number(e.target.value) as 1 | 2 | 3)}>
            {WIDTHS.map((w) => (
              <option key={w.n} value={w.n}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        {n > 1 ? (
          <label className="flex-1">
            <span className="pk-field-label">Lane</span>
            <select className="pk-input" value={lane} onChange={(e) => run((l) => update(l, p.id, { lane: Number(e.target.value) as 0 | 1 | 2 }))}>
              {LANE_NAMES[n as 2 | 3].map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <OverrideField label="Height (RU)" field="ruHeight" step={1} placement={p} catalog={reserved ? p.ruHeight : info?.ruHeight} run={run} lookup={lookup} />
        {!reserved ? (
          <>
            <OverrideField label="Depth (in)" field="depthIn" step={0.25} placement={p} catalog={info?.depthIn} run={run} lookup={lookup} />
            <OverrideField label="Weight (lb)" field="weightLb" step={0.1} placement={p} catalog={info?.weightLb} run={run} lookup={lookup} />
            <OverrideField label="Watts" field="powerWatts" step={1} placement={p} catalog={info?.powerWatts} run={run} lookup={lookup} />
          </>
        ) : null}
      </div>

      <label className="mb-2 flex items-center gap-2">
        <input type="checkbox" checked={!!p.optional} onChange={(e) => run((l) => update(l, p.id, { optional: e.target.checked ? true : undefined }))} />
        Optional (priced as an add-on)
      </label>

      <label className="mb-2 block">
        <span className="pk-field-label">Notes</span>
        <textarea
          key={`${p.id}-${p.notes ?? ""}`}
          className="pk-input"
          rows={2}
          maxLength={NOTES_MAX}
          defaultValue={p.notes ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (p.notes ?? "")) run((l) => update(l, p.id, { notes: v || undefined }));
          }}
        />
      </label>

      <div className="mb-2 flex items-end gap-2">
        <label>
          <span className="pk-field-label">Copies</span>
          <input className="pk-input" type="number" min={1} max={DUP_MAX} step={1} value={dupN} onChange={(e) => setDupN(e.target.value)} style={{ width: 72 }} />
        </label>
        <button type="button" className="pk-btn-outline" onClick={duplicate}>
          Duplicate
        </button>
      </div>

      {msg ? (
        <div role="status" className="mb-2 text-xs" style={{ color: msg.tone === "error" ? "var(--red)" : "var(--muted)" }}>
          {msg.text}
        </div>
      ) : null}

      <div className="flex justify-between gap-2">
        {!reserved ? (
          <button
            type="button"
            className="pk-btn-outline"
            onClick={() => {
              onReplace(p.id);
              closeRef.current();
            }}
          >
            Replace part…
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="pk-btn-danger" onClick={removeIt}>
          Remove
        </button>
      </div>
    </div>,
    document.body
  );
}

/** One numeric override. Blank = use the catalog value; commits on blur or Enter. */
function OverrideField(props: {
  label: string;
  field: OverrideNumberKey;
  step: number;
  placement: RackPlacement;
  catalog: number | undefined;
  lookup: RackPartLookup;
  run: (edit: (l: RackLayout) => RackEdit) => boolean;
}) {
  const { label, field, step, placement: p, catalog, lookup, run } = props;
  const reservedHeight = field === "ruHeight" && !p.sku;
  const current = reservedHeight ? p.ruHeight : p.override?.[field];
  const shown = current === undefined ? "" : String(current);
  const commit = (raw: string) => {
    const v = raw.trim();
    if (v === shown) return;
    if (v === "") {
      if (!reservedHeight) run((l) => setPlacementOverride(l, p.id, field, undefined, lookup));
      return;
    }
    run((l) => setPlacementOverride(l, p.id, field, Number(v), lookup));
  };
  return (
    <label>
      <span className="pk-field-label">{label}</span>
      <input
        key={`${p.id}-${field}-${shown}`}
        className="pk-input"
        type="number"
        min={field === "ruHeight" ? 1 : 0}
        step={step}
        defaultValue={shown}
        placeholder={reservedHeight ? undefined : catalog === undefined ? "Catalog: unknown" : `Catalog: ${catalog}`}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          }
        }}
      />
    </label>
  );
}
