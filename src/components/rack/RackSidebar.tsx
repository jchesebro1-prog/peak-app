"use client";
/**
 * #296 — the Assembly Builder's rack sidebar: header (rack name, RU count,
 * face and numbering toggles), the part picker + Rack hardware tray, the
 * shared RackElevation, undo/redo, Fill blanks and the totals/issues footer.
 *
 * Every change is one engine edit through the form's `useRackEditor`, which
 * writes the layout back into the form draft — Save sends it. Collapsible;
 * open state and width are a per-viewer convenience in localStorage.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { newPlacementId, place, placementNamer, reparent } from "@/lib/rack/layout";
import { rackDataCoverage, rackPartInfo } from "@/lib/rack/part-facts";
import { totals as rackTotals, validate } from "@/lib/rack/rules";
import { rackGeometry } from "@/lib/rack/geometry";
import {
  armFromPart,
  armPanel,
  armReserved,
  copyOf,
  coverageSkus,
  fillBlanksEdit,
  keyEdit,
  liveSelection,
  pickKeepsArmed,
  placementFromArmed,
  RACK_SIDEBAR_KEY,
  readSidebarPrefs,
  replacePart,
  setRackConfig,
  SIDEBAR_WIDTH,
  type SidebarArmed,
  type SidebarPrefs,
} from "@/lib/rack/sidebar";
import type { RackDefaults } from "@/lib/rack/defaults";
import type { RackFace, RackPartLookup } from "@/lib/rack/types";
import { RACK_PART_MIME, RackElevation } from "./RackElevation";
import { PlacementMenu } from "./PlacementMenu";
import { RackPartTray, type RackPickerHit, type TrayMode } from "./RackPartTray";
import { RackTotalsPanel } from "./RackTotalsPanel";
import type { RackEditor } from "./useRackEditor";

export type { RackPickerHit } from "./RackPartTray";

export type RackSidebarProps<H extends RackPickerHit> = {
  /** The form's editor (its onChange writes the draft): undo history lives with the open form. */
  editor: RackEditor;
  newId: () => string;
  title: string;
  /** An error the form already shows beside its own fields (a refused rack-size change) — not repeated here. */
  shownElsewhere?: string | null;
  lookup: RackPartLookup;
  partSearch: (q: string) => Promise<H[]>;
  /** A picker hit was used — merge it into the builder's parts so it prices and looks up. */
  onPickPart?: (hit: H) => void;
  defaults: RackDefaults;
  onSaveDefaults: (d: RackDefaults) => Promise<{ ok: true; value: RackDefaults } | { ok: false; error: string }>;
  /** The rack-level parts list (they take no RU but count in weight/power totals). */
  rackParts: { sku: string; qty: number }[];
};

type View = RackFace | "both";
/** px per inch at most: a 42U rack is ~900 px tall — legible labels, and its own scroll area keeps the rest in reach. */
const DEFAULT_SCALE = 12;
type Menu = { id: string; at: { x: number; y: number }; ret: HTMLElement | SVGElement | null };

const inField = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, select, textarea");
const infoOf = (hit: RackPickerHit) => rackPartInfo({ sku: hit.sku, desc: hit.desc, ...(hit.mfr ? { mfr: hit.mfr } : {}), ...(hit.rack ?? {}) }, hit.sku);

function loadPrefs(): SidebarPrefs {
  try {
    return readSidebarPrefs(window.localStorage.getItem(RACK_SIDEBAR_KEY));
  } catch {
    return readSidebarPrefs(null);
  }
}
function savePrefs(p: SidebarPrefs) {
  try {
    window.localStorage.setItem(RACK_SIDEBAR_KEY, JSON.stringify(p));
  } catch {
    /* private window or blocked storage — the default comes back next time */
  }
}

export function RackSidebar<H extends RackPickerHit>(props: RackSidebarProps<H>) {
  const { editor, lookup, newId } = props;
  const layout = editor.layout;
  // The form opens on a click, never on the server render, so reading storage here can't mismatch hydration.
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => (typeof window === "undefined" ? readSidebarPrefs(null) : loadPrefs()));
  const [view, setView] = useState<View>("front");
  const [rawSelection, setSelection] = useState<string[]>([]);
  const selection = liveSelection(layout, rawSelection);
  const [armed, setArmed] = useState<(SidebarArmed & { byDrag?: boolean }) | null>(null);
  const [mode, setMode] = useState<TrayMode>({ kind: "device" });
  const [menu, setMenu] = useState<Menu | null>(null);
  const [defs, setDefs] = useState<RackDefaults>(props.defaults);
  const [prevDefaults, setPrevDefaults] = useState(props.defaults);
  if (props.defaults !== prevDefaults) {
    setPrevDefaults(props.defaults);
    setDefs(props.defaults);
  }
  const [defsBusy, setDefsBusy] = useState(false);
  const [defsError, setDefsError] = useState<string | null>(null);

  const totals = useMemo(() => rackTotals(layout, lookup, props.rackParts), [layout, lookup, props.rackParts]);
  const issues = useMemo(() => validate(layout, lookup), [layout, lookup]);
  const coverage = useMemo(() => rackDataCoverage(coverageSkus(layout), lookup), [layout, lookup]);
  // Refusals name parts by label → catalog name → SKU.
  const names = useMemo(() => ({ nameOf: placementNamer(lookup) }), [lookup]);
  const vbw = useMemo(() => rackGeometry(layout, lookup, { face: "front" }).viewBox.w, [layout, lookup]);
  const inner = prefs.width - 34;
  const scale = Math.max(5, Math.min(DEFAULT_SCALE, (view === "both" ? (inner - 16) / 2 : inner) / vbw));

  // Keep the selected placement in view inside the elevation's scroll area (no page jump).
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusId = selection.length === 1 ? selection[0] : null;
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !focusId) return;
    const el = box.querySelector(`[data-placement-id="${CSS.escape(focusId)}"]`);
    if (!el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top + 8;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
  }, [focusId, layout]);

  const setPrefsAndSave = (p: SidebarPrefs) => {
    setPrefs(p);
    savePrefs(p);
  };

  // Esc disarms (or leaves a picker mode); with nothing armed it clears the selection.
  useEffect(() => {
    if (!armed && !selection.length && mode.kind === "device") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || menu || inField(e.target)) return;
      if (armed) setArmed(null);
      else if (mode.kind !== "device") setMode({ kind: "device" });
      else setSelection([]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed, selection.length, mode.kind, menu]);

  const arm = (a: SidebarArmed, byDrag = false) => {
    setArmed(byDrag ? { ...a, byDrag } : a);
    if (a.rearOnly && view === "front") setView("rear");
  };

  const saveDefault = async (patch: RackDefaults) => {
    setDefsBusy(true);
    setDefsError(null);
    try {
      const r = await props.onSaveDefaults({ ...defs, ...patch });
      if (r.ok) setDefs(r.value);
      else setDefsError(r.error);
    } catch {
      setDefsError("Could not save the default — try again.");
    } finally {
      setDefsBusy(false);
    }
  };

  const onPick = (hit: H) => {
    props.onPickPart?.(hit);
    // A double-click on the hit just armed (e.g. as a shelf) keeps it armed as it is.
    if (pickKeepsArmed(armed, mode.kind, hit.sku)) return;
    const info = infoOf(hit);
    switch (mode.kind) {
      case "device":
        arm(armFromPart(info, view));
        return;
      case "shelf":
        arm(armFromPart(info, view, "shelf"));
        break;
      case "set-blank":
        void saveDefault({ blankSku: hit.sku });
        break;
      case "set-vent":
        void saveDefault({ ventSku: hit.sku });
        break;
      case "replace": {
        const id = mode.id;
        editor.apply((l) => replacePart(l, id, info, hit.sku, names));
        break;
      }
    }
    setMode({ kind: "device" });
  };

  const onDragHit = (hit: H, e: React.DragEvent) => {
    props.onPickPart?.(hit);
    const a = armFromPart(infoOf(hit), view);
    e.dataTransfer.setData(RACK_PART_MIME, JSON.stringify({ sku: a.sku, ruHeight: a.ruHeight, width: a.width, kind: a.kind, label: a.label }));
    e.dataTransfer.effectAllowed = "copy";
    arm(a, true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (inField(e.target)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    const edit = keyEdit(layout, selection, e.key, names);
    if (!edit) return;
    e.preventDefault();
    if (editor.apply(edit) && (e.key === "Delete" || e.key === "Backspace")) setSelection([]);
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = prefs.width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let w = w0;
    const onMove = (ev: PointerEvent) => {
      w = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, w0 + (x0 - ev.clientX))));
      setPrefs((p) => ({ ...p, width: w }));
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      savePrefs({ open: true, width: w });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  const menuPlacement = menu ? layout.placements.find((p) => p.id === menu.id) : undefined;
  const ruCount = layout.config.ruCount;

  if (!prefs.open) {
    return (
      <aside className="pk-card flex items-center justify-between gap-2 lg:sticky lg:top-4 lg:flex-col lg:justify-start" style={{ padding: 10 }}>
        <button type="button" className="pk-btn-outline" onClick={() => setPrefsAndSave({ ...prefs, open: true })} aria-expanded={false}>
          Show rack
        </button>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {totals.ruUsed}/{ruCount} RU
        </span>
      </aside>
    );
  }

  return (
    <aside
      id="rack-sidebar"
      aria-label="Rack layout"
      className="pk-card relative w-full lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[var(--rk-w)] lg:overflow-y-auto"
      data-rack-sidebar=""
      style={{ padding: 16, ...({ "--rk-w": `${prefs.width}px` } as React.CSSProperties) }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the rack panel"
        title="Drag to resize"
        onPointerDown={startResize}
        className="absolute inset-y-0 left-0 hidden w-1.5 cursor-col-resize hover:bg-[#eef0f3] lg:block"
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{props.title || "New rack"}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            {ruCount}U · {layout.config.widthIn} in
            {layout.config.depthIn ? ` · ${layout.config.depthIn} in deep` : ""}
          </div>
        </div>
        <button type="button" onClick={() => setPrefsAndSave({ ...prefs, open: false })} aria-expanded aria-controls="rack-sidebar" className="text-xs" style={{ border: 0, background: "transparent", color: "var(--muted-2)", cursor: "pointer" }}>
          Hide
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Face"
          value={view}
          options={[
            { value: "front", label: "Front" },
            { value: "rear", label: "Rear" },
            { value: "both", label: "Both" },
          ]}
          onChange={(v) => setView(v as View)}
        />
        <Segmented
          label="Numbering"
          value={layout.config.numbering}
          options={[
            { value: "bottom-up", label: "Bottom-up" },
            { value: "top-down", label: "Top-down" },
          ]}
          onChange={(v) => editor.apply((l) => setRackConfig(l, { numbering: v === "top-down" ? "top-down" : "bottom-up" }))}
        />
      </div>

      <RackPartTray
        mode={mode}
        onMode={(m) => {
          setMode(m);
          if (m.kind !== "device") setArmed(null);
        }}
        partSearch={props.partSearch}
        onPick={onPick}
        onDragHit={onDragHit}
        onDragEnd={() => setArmed((a) => (a?.byDrag ? null : a))}
        defaults={defs}
        defaultsBusy={defsBusy}
        defaultsError={defsError}
        ruCount={ruCount}
        onArmPanel={(kind) => {
          const sku = kind === "blank" ? defs.blankSku : defs.ventSku;
          if (sku) arm(armPanel(kind, sku, lookup(sku), view));
        }}
        onArmReserved={(h) => arm(armReserved(h, ruCount, view))}
        armedKind={armed && !armed.byDrag ? armed.kind : null}
      />

      <div className="my-3 text-xs" role="status" style={{ color: "var(--muted-2)", minHeight: 16 }}>
        {armed && !armed.byDrag
          ? `Armed: ${armed.kind === "reserved" ? `reserved ${armed.ruHeight} RU` : armed.label || armed.sku} — click a slot to place it. Esc disarms.`
          : selection.length
            ? `${selection.length} selected — arrows move 1 RU, Delete removes, Esc clears.`
            : "Pick a part, then click a slot — or drag it onto the rack."}
      </div>

      {/* Its own scroll area on lg+, so the header, tray and totals stay reachable beside a 42U drawing. */}
      <div ref={scrollRef} className="overflow-x-auto lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto" data-rack-scroll="">
        <RackElevation
          layout={layout}
          lookup={lookup}
          face={view}
          mode="edit"
          selection={selection}
          armed={armed}
          issues={issues}
          scale={scale}
          onPlace={(drop) => {
            if (!armed) return;
            const p = placementFromArmed(armed, drop, newId());
            editor.apply((l) => place(l, p, names));
          }}
          onMove={(id, to, copy) =>
            editor.apply((l) => {
              if (!copy) return reparent(l, id, to, names);
              const p = l.placements.find((q) => q.id === id);
              return p ? place(l, copyOf(p, to, newId()), names) : { ok: false, reason: "That placement isn't in the rack." };
            })
          }
          onSelect={setSelection}
          onMenu={(id, at) => setMenu({ id, at, ret: document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null })}
          onKey={onKey}
        />
      </div>

      {editor.error && editor.error !== props.shownElsewhere ? (
        <div role="alert" className="mt-2 text-xs" style={{ color: "var(--red)" }}>
          {editor.error}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button type="button" className="pk-btn-outline" onClick={editor.undo} disabled={!editor.canUndo} title="Undo (Cmd/Ctrl+Z)">
          Undo
        </button>
        <button type="button" className="pk-btn-outline" onClick={editor.redo} disabled={!editor.canRedo} title="Redo (Shift+Cmd/Ctrl+Z)">
          Redo
        </button>
        <button
          type="button"
          className="pk-btn-outline"
          disabled={!defs.blankSku}
          title={defs.blankSku ? `Fill every empty front RU with ${defs.blankSku}` : "Set a default blank panel first."}
          onClick={() => {
            const sku = defs.blankSku;
            if (sku) editor.apply((l) => fillBlanksEdit(l, sku, (i) => newPlacementId(Date.now(), i)));
          }}
        >
          Fill blanks
        </button>
        {!defs.blankSku ? (
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            Set a default blank panel first.
          </span>
        ) : null}
      </div>

      <RackTotalsPanel totals={totals} coverage={coverage} issues={issues} onSelectIssue={setSelection} />

      {menu && menuPlacement ? (
        <PlacementMenu
          key={menu.id}
          placement={menuPlacement}
          layout={layout}
          lookup={lookup}
          at={menu.at}
          onEdit={editor.apply}
          onReplace={(id) => {
            const p = layout.placements.find((q) => q.id === id);
            setArmed(null);
            setMode({ kind: "replace", id, label: p?.label || (p?.sku ? lookup(p.sku)?.desc : "") || p?.sku || "this part" });
          }}
          onClose={() => setMenu(null)}
          newId={newId}
          returnFocusTo={menu.ret}
        />
      ) : null}
    </aside>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg p-0.5" style={{ background: "#f1f2f5" }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="rounded-md px-2.5 py-1 text-xs font-semibold"
          style={{ border: 0, cursor: "pointer", background: value === o.value ? "#fff" : "transparent", color: value === o.value ? "#16181d" : "#8c919c", boxShadow: value === o.value ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
