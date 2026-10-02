"use client";
/**
 * #296 — the rack sidebar's part picker and "Rack hardware" tray. Search hits
 * are click-to-arm and draggable onto the elevation; the picker also serves
 * the Shelf button ("pick a shelf part"), setting a default blank or vent, and
 * Replace part. What a pick does is the sidebar's call (`onPick`).
 */
import { useState } from "react";
import { usePartSearch } from "@/app/(app)/design/assemblies/use-part-search";
import type { RackDefaults } from "@/lib/rack/defaults";
import type { RackPartFacts } from "@/lib/rack/types";

export type RackPickerHit = { sku: string; desc: string; mfr?: string; category?: string; rack?: RackPartFacts };

export type TrayMode =
  | { kind: "device" }
  | { kind: "shelf" }
  | { kind: "set-blank" }
  | { kind: "set-vent" }
  | { kind: "replace"; id: string; label: string };

const MODE_PROMPT: Record<Exclude<TrayMode["kind"], "device">, string> = {
  shelf: "Pick a shelf part.",
  "set-blank": "Pick the default blank panel.",
  "set-vent": "Pick the default vent panel.",
  replace: "Pick the replacement part.",
};

export function RackPartTray<H extends RackPickerHit>(props: {
  mode: TrayMode;
  onMode: (m: TrayMode) => void;
  partSearch: (q: string) => Promise<H[]>;
  onPick: (hit: H) => void;
  /** Device mode only: the hit being dragged onto the elevation (arm it). */
  onDragHit: (hit: H, e: React.DragEvent) => void;
  onDragEnd: () => void;
  defaults: RackDefaults;
  defaultsBusy: boolean;
  defaultsError: string | null;
  ruCount: number;
  onArmPanel: (kind: "blank" | "vent") => void;
  onArmReserved: (height: number) => void;
  /** Armed tray item (shows which button is active), or null. */
  armedKind: string | null;
}) {
  const { mode, onMode, defaults } = props;
  const { query, setQuery, items, emptyText } = usePartSearch(props.partSearch);
  const [reservedH, setReservedH] = useState("1");
  const draggable = mode.kind === "device";
  const prompt = mode.kind === "device" ? null : mode.kind === "replace" ? `${MODE_PROMPT.replace} Replacing ${mode.label}.` : MODE_PROMPT[mode.kind];

  return (
    <div className="grid gap-3">
      <div>
        <label className="pk-field-label" htmlFor="rack-part-search">
          {mode.kind === "device" ? "Add a device" : "Find a part"}
        </label>
        {prompt ? (
          <div className="mb-1 flex items-center justify-between gap-2 text-xs" role="status">
            <span style={{ color: "var(--ink)", fontWeight: 600 }}>{prompt}</span>
            <button type="button" className="text-xs" style={{ border: 0, background: "transparent", color: "var(--muted-2)", cursor: "pointer" }} onClick={() => onMode({ kind: "device" })}>
              Cancel
            </button>
          </div>
        ) : null}
        <input
          id="rack-part-search"
          className="pk-input"
          type="search"
          value={query}
          placeholder="Search name, manufacturer, or part #"
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <ul className="m-0 mt-1 grid max-h-44 list-none gap-0.5 overflow-y-auto p-0" aria-label="Matching parts">
          {items.length === 0 ? (
            <li className="px-1 py-1 text-xs" style={{ color: "var(--muted)" }}>
              {emptyText}
            </li>
          ) : (
            items.slice(0, 40).map((hit) => (
              <li key={hit.sku}>
                <button
                  type="button"
                  draggable={draggable}
                  onDragStart={draggable ? (e) => props.onDragHit(hit, e) : undefined}
                  onDragEnd={draggable ? props.onDragEnd : undefined}
                  onClick={() => props.onPick(hit)}
                  title={draggable ? "Click to arm, then click a slot — or drag it onto the rack" : undefined}
                  className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-[#f2f4f7]"
                  style={{ border: 0, background: "transparent", cursor: draggable ? "grab" : "pointer", color: "var(--ink)" }}
                >
                  <span className="block font-mono text-[11px]" style={{ color: "#5b616e" }}>
                    {hit.sku}
                    {hit.rack?.ruHeight !== undefined ? ` · ${hit.rack.ruHeight}U` : ""}
                  </span>
                  <span className="block truncate">{hit.desc}</span>
                  {hit.mfr ? (
                    <span className="block" style={{ color: "var(--muted-2)" }}>
                      {hit.mfr}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div>
        <div className="pk-field-label">Rack hardware</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PanelButton kind="blank" sku={defaults.blankSku} active={props.armedKind === "blank"} onArm={() => props.onArmPanel("blank")} onSet={() => onMode({ kind: "set-blank" })} />
          <PanelButton kind="vent" sku={defaults.ventSku} active={props.armedKind === "vent"} onArm={() => props.onArmPanel("vent")} onSet={() => onMode({ kind: "set-vent" })} />
          <button type="button" className="pk-btn-outline" aria-pressed={mode.kind === "shelf" || props.armedKind === "shelf"} onClick={() => onMode({ kind: "shelf" })}>
            Shelf
          </button>
          <span className="inline-flex items-center gap-1">
            <button type="button" className="pk-btn-outline" aria-pressed={props.armedKind === "reserved"} onClick={() => props.onArmReserved(Number(reservedH) || 1)}>
              Reserved
            </button>
            <input
              aria-label="Reserved height (RU)"
              className="pk-input"
              type="number"
              min={1}
              max={props.ruCount}
              step={1}
              value={reservedH}
              onChange={(e) => setReservedH(e.target.value)}
              style={{ width: 56 }}
            />
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              RU
            </span>
          </span>
        </div>
        {defaults.blankSku || defaults.ventSku ? (
          <div className="mt-1 text-xs" style={{ color: "var(--muted-2)" }}>
            {defaults.blankSku ? (
              <>
                Default blank <span className="font-mono">{defaults.blankSku}</span>{" "}
                <LinkButton onClick={() => onMode({ kind: "set-blank" })}>Change</LinkButton>
              </>
            ) : null}
            {defaults.blankSku && defaults.ventSku ? " · " : null}
            {defaults.ventSku ? (
              <>
                Default vent <span className="font-mono">{defaults.ventSku}</span>{" "}
                <LinkButton onClick={() => onMode({ kind: "set-vent" })}>Change</LinkButton>
              </>
            ) : null}
          </div>
        ) : null}
        {props.defaultsBusy ? (
          <div className="mt-1 text-xs" role="status" style={{ color: "var(--muted)" }}>
            Saving the default…
          </div>
        ) : null}
        {props.defaultsError ? (
          <div className="mt-1 text-xs" role="alert" style={{ color: "var(--red)" }}>
            {props.defaultsError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PanelButton({ kind, sku, active, onArm, onSet }: { kind: "blank" | "vent"; sku?: string; active: boolean; onArm: () => void; onSet: () => void }) {
  const name = kind === "blank" ? "Blank" : "Vent";
  if (!sku)
    return (
      <button type="button" className="pk-btn-outline" onClick={onSet}>
        Set default {kind}…
      </button>
    );
  return (
    <button type="button" className="pk-btn-outline" aria-pressed={active} onClick={onArm} title={`Arm a ${kind} panel (${sku})`}>
      {name}
    </button>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-xs underline" style={{ border: 0, background: "transparent", padding: 0, color: "var(--muted-2)", cursor: "pointer" }}>
      {children}
    </button>
  );
}
