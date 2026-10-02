"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  FIXTURE_BOXES,
  FIXTURE_BOX_LABEL,
  headLineForPick,
  SYSTEM_SCOPES,
  type FixtureBox,
  type FixtureInput,
  type FixtureKind,
  type FixtureLine,
  type FixtureRecord,
  type FixtureResolvable,
  type HeadLine,
  type ResolvedFixture,
  type SystemScope,
  PORTAL_CATEGORY_MAX,
} from "@/lib/fixture-assemblies";
import { dateYear } from "@/lib/format";
import { emptyRackLayout, newPlacementId } from "@/lib/rack/layout";
import { lookupFromHits, setRackConfig, type RackConfigPatch } from "@/lib/rack/sidebar";
import type { RackDefaults } from "@/lib/rack/defaults";
import { RACK_RU_MAX, RACK_RU_MIN, type RackLayout, type RackPartFacts } from "@/lib/rack/types";
import { RackSidebar } from "@/components/rack/RackSidebar";
import { useRackEditor } from "@/components/rack/useRackEditor";
import { Typeahead } from "@/components/search/typeahead";
import { passAllFilter, stableRank } from "@/lib/search/typeahead-rank";
import { pairKey, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import MemberCoverageChip from "./member-coverage";
import { searchAssemblyPartsAction } from "./actions";
import { usePartSearch } from "./use-part-search";

/** The catalog slice the builder searches and prices from (#210). Cost is
 *  included: the footer shows the live included cost, as Subassemblies did. */
export type PartHit = { sku: string; desc: string; category: string; mfr: string; unit: string; list: number; cost: number; pricedAt?: number; rack?: RackPartFacts };

export type Draft = {
  id: string | null;
  kind: FixtureKind;
  label: string;
  description: string;
  /** #289 — fixture kind only; blank = "Other packages" in the portal. */
  portalCategory: string;
  scope: SystemScope | "";
  lightEngineSku: string;
  lightEngineLine: HeadLine;
  lensSku: string;
  lensLine: HeadLine;
  lamp: string;
  position: string;
  circuit: string;
  lines: Record<FixtureBox, FixtureLine[]>;
  parts: FixtureLine[];
  /** A converted record's stored names — fallback display for a missing part. */
  legacy?: FixtureRecord["legacy"];
  /** #296 — rack kind only: the RU layout the sidebar edits. */
  rack?: RackLayout;
};

export function emptyDraft(kind: FixtureKind): Draft {
  return {
    id: null, kind, label: "", description: "", portalCategory: "", scope: "",
    lightEngineSku: "", lightEngineLine: {}, lensSku: "", lensLine: {},
    lamp: "", position: "", circuit: "",
    lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [],
    ...(kind === "rack" ? { rack: emptyRackLayout() } : {}),
  };
}

export function draftFromRecord(r: FixtureRecord): Draft {
  return {
    id: r.id, kind: r.kind, label: r.label, description: r.description || "", portalCategory: r.portalCategory || "", scope: r.scope || "",
    lightEngineSku: r.lightEngineSku || "", lightEngineLine: r.lightEngineLine || {},
    lensSku: r.lensSku || "", lensLine: r.lensLine || {},
    lamp: r.lamp || "", position: r.position || "", circuit: r.circuit || "",
    lines: {
      data: [...(r.lines?.data || [])],
      power: [...(r.lines?.power || [])],
      mounting: [...(r.lines?.mounting || [])],
      accessories: [...(r.lines?.accessories || [])],
    },
    parts: [...(r.parts || [])],
    ...(r.legacy ? { legacy: r.legacy } : {}),
    ...(r.kind === "rack" ? { rack: r.rack ?? emptyRackLayout() } : {}),
  };
}

export function draftToInput(d: Draft): FixtureInput {
  return {
    id: d.id, kind: d.kind, label: d.label, description: d.description, portalCategory: d.portalCategory, scope: d.scope || undefined,
    lightEngineSku: d.lightEngineSku, lensSku: d.lensSku || null, lightEngineLine: d.lightEngineLine, lensLine: d.lensLine,
    lamp: d.lamp, position: d.position, circuit: d.circuit, lines: d.lines, parts: d.parts,
    ...(d.kind === "rack" ? { rack: d.rack ?? emptyRackLayout() } : {}),
  };
}

export function draftResolvable(d: Draft): FixtureResolvable {
  return {
    id: d.id || "draft", kind: d.kind, label: d.label,
    lightEngineSku: d.lightEngineSku, lensSku: d.lensSku || null,
    lightEngineLine: d.lightEngineLine, lensLine: d.lensLine, lines: d.lines, parts: d.parts,
    ...(d.legacy ? { legacy: d.legacy } : {}),
    ...(d.kind === "rack" ? { rack: d.rack ?? emptyRackLayout(), ...(d.scope ? { scope: d.scope } : {}) } : {}),
  };
}

export const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
export const pricesNote = (at: number | null) => (at == null ? "prices as of: unknown" : `prices as of ${dateYear(at)}`);

const FIELD: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #dfe2e8", borderRadius: 8, padding: "9px 10px", font: "inherit", fontSize: 13, color: "#16181d", background: "#fff" };
const LABEL: CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#737985", marginBottom: 5 };
const SMALL_BTN: CSSProperties = { padding: "3px 8px", fontSize: 12, lineHeight: 1.2 };
const partKey = (p: PartHit) => p.sku;
const partLabel = (p: PartHit) => `${p.desc} · ${p.sku}`;

const headAsLine = (sku: string, h: HeadLine): FixtureLine => ({
  sku,
  ...(h.label ? { label: h.label } : {}),
  qty: h.qty ?? 1,
  ...(h.costOverride !== undefined ? { costOverride: h.costOverride } : {}),
});
const lineAsHead = (l: FixtureLine): HeadLine => ({
  ...(l.label ? { label: l.label } : {}),
  qty: l.qty,
  ...(l.costOverride !== undefined ? { costOverride: l.costOverride } : {}),
});

/** One results row — SKU · description · manufacturer · list price (#121). */
function PartRow({ part }: { part: PartHit }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", flexShrink: 0 }}>{part.sku}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{part.desc}</span>
      <span style={{ fontSize: 11.5, color: "#8c919c", flexShrink: 0 }}>{part.mfr || "—"} · {money(part.list)}</span>
    </span>
  );
}

/** The pickers' server search (#210 fix wave 1, I1). */
export const searchAssemblyHits = (q: string): Promise<PartHit[]> => searchAssemblyPartsAction(q).then((r) => r.hits);

/** Catalog part picker (#121, I1): a debounced server search
 *  (searchAssemblyPartsAction) over the live catalog, never a client-side
 *  filter over the whole book. `clearOnPick` is the add-another mode the
 *  line boxes use; `bySku` resolves the current selection's label even
 *  though it may not be among the latest search results. */
function PartPicker({ label, bySku, value, onPick, clearOnPick = false }: {
  label: string;
  bySku: ReadonlyMap<string, PartHit>;
  value: string;
  onPick: (hit: PartHit) => void;
  clearOnPick?: boolean;
}) {
  const { setQuery, items, emptyText } = usePartSearch(searchAssemblyHits);
  const resolveSelected = (key: string) => bySku.get(key) ?? null;
  return (
    <div>
      <label style={LABEL}>{label}</label>
      <Typeahead
        items={items}
        keyOf={partKey}
        filter={passAllFilter}
        rank={stableRank}
        render={(p) => <PartRow part={p} />}
        onPick={onPick}
        labelOf={clearOnPick ? undefined : partLabel}
        selectedKey={clearOnPick ? null : value}
        resolveSelected={resolveSelected}
        placeholder="Search name, manufacturer, or part #"
        ariaLabel={label}
        inputStyle={FIELD}
        emptyText={emptyText}
        onQueryChange={setQuery}
      />
    </div>
  );
}

/** One part line: part, label, qty (0 = optional), cost override, ↑ ↓ ×, and
 *  the datasheet coverage chip/toggle. `minQty` (M2) raises the floor for
 *  the light engine's own line — every other line stays 0-floored (a 0 qty
 *  line is a compatible optional add-on). */
function LineRow({ line, part, fallbackName, onChange, onUp, onDown, onRemove, chip, minQty = 0 }: {
  line: FixtureLine;
  part?: PartHit;
  fallbackName?: string;
  onChange: (next: FixtureLine) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
  chip?: ReactNode;
  minQty?: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) 64px 104px auto", gap: 6, alignItems: "start", padding: "7px 0", borderTop: "1px solid #f2f3f6" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#5b616e" }}>{line.sku}</div>
        <div style={{ fontSize: 11.5, color: part ? "#737985" : "#a0442b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {part ? part.desc : `${fallbackName ? `${fallbackName} — ` : ""}not in the catalog (prices as $0)`}
        </div>
        {chip}
      </div>
      <input aria-label={`Label for ${line.sku}`} title="Name used in the Estimator and BOM (blank = catalog description)" value={line.label ?? ""} placeholder={part?.desc || "catalog description"} onChange={(e) => onChange({ ...line, label: e.target.value || undefined })} style={{ ...FIELD, padding: "6px 8px", fontSize: 12 }} />
      <div>
        <input aria-label={`Quantity for ${line.sku}`} type="number" min={minQty} step={1} value={line.qty} onChange={(e) => onChange({ ...line, qty: Math.max(minQty, Number(e.target.value) || 0) })} style={{ ...FIELD, padding: "6px 6px", fontSize: 12 }} />
        {line.qty === 0 && <div style={{ fontSize: 10, color: "#8c919c", marginTop: 2 }}>optional</div>}
      </div>
      <input aria-label={`Cost override for ${line.sku}`} type="number" min={0} step="0.01" placeholder={part ? `cost ${money(part.cost)}` : "cost override"} value={line.costOverride ?? ""} onChange={(e) => onChange({ ...line, costOverride: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })} style={{ ...FIELD, padding: "6px 6px", fontSize: 12 }} />
      <div style={{ display: "flex", gap: 3 }}>
        {(onUp || onDown) && <button type="button" aria-label={`Move ${line.sku} up`} className="pk-btn-outline" style={SMALL_BTN} disabled={!onUp} onClick={onUp}>↑</button>}
        {(onUp || onDown) && <button type="button" aria-label={`Move ${line.sku} down`} className="pk-btn-outline" style={SMALL_BTN} disabled={!onDown} onClick={onDown}>↓</button>}
        {onRemove && <button type="button" aria-label={`Remove ${line.sku}`} className="pk-btn-outline" style={SMALL_BTN} onClick={onRemove}>×</button>}
      </div>
    </div>
  );
}

function LineBox({ title, lines, onLines, bySku, onPickPart, names, chipFor }: {
  title: string;
  lines: FixtureLine[];
  onLines: (next: FixtureLine[]) => void;
  bySku: ReadonlyMap<string, PartHit>;
  onPickPart: (hit: PartHit) => void;
  names: Record<string, string>;
  chipFor?: (sku: string) => ReactNode;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const next = [...lines];
    const j = i + dir;
    [next[i], next[j]] = [next[j], next[i]];
    onLines(next);
  };
  return (
    <div style={{ border: "1px solid #eef0f3", borderRadius: 9, padding: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {lines.map((line, i) => (
        <LineRow
          key={`${line.sku}-${i}`}
          line={line}
          part={bySku.get(line.sku)}
          fallbackName={names[line.sku]}
          onChange={(next) => onLines(lines.map((l, k) => (k === i ? next : l)))}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < lines.length - 1 ? () => move(i, 1) : undefined}
          onRemove={() => onLines(lines.filter((_, k) => k !== i))}
          chip={chipFor?.(line.sku)}
        />
      ))}
      <div style={{ marginTop: 8 }}>
        <PartPicker
          label="Add a part"
          bySku={bySku}
          value=""
          clearOnPick
          onPick={(hit) => { onPickPart(hit); onLines([...lines, { sku: hit.sku, qty: 1 }]); }}
        />
      </div>
    </div>
  );
}

/** Stable identity: the sidebar re-syncs its copy when this prop changes. */
export const NO_RACK_DEFAULTS: RackDefaults = {};
const RACK_SIZES = Array.from({ length: RACK_RU_MAX - RACK_RU_MIN + 1 }, (_, k) => RACK_RU_MIN + k);
const RACK_HELP = "Lay out devices in the rack on the right. Rack-level parts (frame, rails, PDUs, casters, fans, cable management, labor) go in the parts list — they take no RU.";

export default function FixtureForm({ draft, onChange, bySku, onPickPart, live, coverage, busy, error, onSave, onCancel, portalCategories = [], rackDefaults = NO_RACK_DEFAULTS, onSaveRackDefaults }: {
  draft: Draft;
  onChange: (next: Draft) => void;
  bySku: ReadonlyMap<string, PartHit>;
  /** A picker turned up a part not yet in `bySku` — merge it upstream so
   *  live pricing works for the new line (I1). */
  onPickPart: (hit: PartHit) => void;
  live: ResolvedFixture;
  coverage: Record<string, MemberCoverage>;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  /** #289 — the portal categories already used across fixtures (sorted, unique) — the Portal category datalist. */
  portalCategories?: string[];
  /** #296 (D579) — the rack tray's default blank / vent SKUs and how to change them. */
  rackDefaults?: RackDefaults;
  onSaveRackDefaults?: (d: RackDefaults) => Promise<{ ok: true; value: RackDefaults } | { ok: false; error: string }>;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const names = draft.legacy?.names || {};
  const isSystem = draft.kind === "system";
  const isHardware = draft.kind === "hardware";
  const isRack = draft.kind === "rack";
  /** #228: a system and a hardware assembly are one parts list; only a fixture has a light engine and boxes. #296: so is a rack's rack-level parts. */
  const isParts = draft.kind !== "fixture";
  const noun = isSystem ? "system" : isHardware ? "hardware assembly" : isRack ? "rack" : "fixture";
  const engine = draft.lightEngineSku;
  const chipFor = !isParts && engine
    ? (sku: string) => (sku === engine ? null : <MemberCoverageChip parentSku={engine} accessorySku={sku} coverage={coverage[pairKey(engine, sku)]} />)
    : undefined;
  const optional = live.parts.filter((p) => !p.included).length;

  // #296 — the rack layout's undo history lives with this open form (the
  // builder keys the form per open); every committed edit writes the draft.
  const seq = useRef(0);
  const newId = () => newPlacementId(Date.now(), seq.current++);
  const rackEditor = useRackEditor(draft.rack ?? emptyRackLayout(), { onChange: (l) => set({ rack: l }), newId });
  const rackLookup = useMemo(() => lookupFromHits(bySku), [bySku]);
  const rackParts = useMemo(() => draft.parts.map((l) => ({ sku: l.sku, qty: l.qty })), [draft.parts]);
  const [rackFieldError, setRackFieldError] = useState<string | null>(null);
  const rackConfig = rackEditor.layout.config;
  const changeRack = (patch: RackConfigPatch) => {
    const fail = { reason: "" };
    const ok = rackEditor.apply((l) => {
      const r = setRackConfig(l, patch);
      if (!r.ok) fail.reason = r.reason;
      return r;
    });
    setRackFieldError(ok ? null : fail.reason || "That change wasn't made.");
  };
  // Shown once, beside the fields; it goes away with the editor's error (any later successful edit, undo or redo).
  const rackConfigError = rackFieldError && rackFieldError === rackEditor.error ? rackFieldError : null;

  const body = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>{draft.id ? `Edit ${noun}` : `New ${noun}`}</h2>
          <p style={{ margin: "5px 0 18px", color: "#737985", fontSize: 12.5 }}>
            {isSystem
              ? "A bundle of catalog parts under one scope — a mixer, DSP & amps; a video switcher; a distro system."
              : isHardware
                ? "A bundle of catalog hardware — a chain wrap, a batten or beginning termination. It has no scope of its own: on the plan it follows the Equipment map row it is mapped on (Rigging by default)."
                : isRack
                  ? RACK_HELP
                  : "Pick the light engine (and lens), then what ships with it. A quantity of 0 makes a part a compatible optional add-on."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexShrink: 0 }}>
          {isRack && draft.id && (
            // A new tab, so the open draft survives; the sheets print the saved rack.
            <Link href={`/design/assemblies/rack/${encodeURIComponent(draft.id)}`} target="_blank" rel="noopener" title="Opens the saved rack's submittal sheets in a new tab" style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none" }}>Submittal</Link>
          )}
          <button type="button" onClick={onCancel} style={{ border: 0, background: "transparent", color: "#737985", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>Cancel</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        <label style={LABEL}>Label<input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder={isSystem ? "e.g. Digital mixer, DSP & amplifiers" : isHardware ? "e.g. Chain wrap" : isRack ? "e.g. AV head-end rack" : "e.g. ETC Source Four LED Series 3"} style={{ ...FIELD, marginTop: 5 }} /></label>
        <label style={LABEL}>Description<textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Customer-facing description" rows={2} style={{ ...FIELD, marginTop: 5, resize: "vertical" }} /></label>
        {!isParts && (
          <label style={LABEL}>Portal category
            <input
              value={draft.portalCategory}
              onChange={(e) => set({ portalCategory: e.target.value })}
              list="portal-category-options"
              maxLength={PORTAL_CATEGORY_MAX}
              placeholder="e.g. Lighting packages"
              style={{ ...FIELD, marginTop: 5 }}
            />
            <datalist id="portal-category-options">
              {portalCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
        )}
        {(isSystem || isRack) && (
          <label style={LABEL}>Scope
            <select value={draft.scope} required onChange={(e) => set({ scope: e.target.value as SystemScope | "" })} style={{ ...FIELD, marginTop: 5 }}>
              <option value="">— Pick a scope —</option>
              {SYSTEM_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {isRack && (
          <>
            <label style={LABEL}>Rack size
              <select value={rackConfig.ruCount} onChange={(e) => changeRack({ ruCount: Number(e.target.value) })} style={{ ...FIELD, marginTop: 5 }}>
                {RACK_SIZES.map((n) => <option key={n} value={n}>{n} RU</option>)}
              </select>
            </label>
            <label style={LABEL}>Rack depth (in, optional)
              <input
                key={`depth-${rackConfig.depthIn ?? ""}`}
                type="number"
                min={0}
                step={0.25}
                defaultValue={rackConfig.depthIn ?? ""}
                placeholder="e.g. 30"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v === String(rackConfig.depthIn ?? "")) return;
                  changeRack({ depthIn: v === "" ? null : Number(v) });
                }}
                style={{ ...FIELD, marginTop: 5 }}
              />
            </label>
            <label style={LABEL}>RU numbering
              <select value={rackConfig.numbering} onChange={(e) => changeRack({ numbering: e.target.value === "top-down" ? "top-down" : "bottom-up" })} style={{ ...FIELD, marginTop: 5 }}>
                <option value="bottom-up">Bottom-up (RU 1 at the bottom)</option>
                <option value="top-down">Top-down (RU 1 at the top)</option>
              </select>
            </label>
            {rackConfigError && <div role="alert" style={{ gridColumn: "1 / -1", color: "#a0442b", fontSize: 12 }}>{rackConfigError}</div>}
          </>
        )}
        {draft.kind === "fixture" && (
          <>
            <PartPicker
              label="Light engine"
              bySku={bySku}
              value={draft.lightEngineSku}
              onPick={(hit) => {
                onPickPart(hit);
                // M1: a different light engine starts its head line fresh —
                // the old part's label/qty/cost override don't carry over.
                set({ lightEngineSku: hit.sku, lightEngineLine: headLineForPick(draft.lightEngineSku, hit.sku, draft.lightEngineLine) });
              }}
            />
            <PartPicker
              label="Lens (optional)"
              bySku={bySku}
              value={draft.lensSku}
              onPick={(hit) => {
                onPickPart(hit);
                set({ lensSku: hit.sku, lensLine: headLineForPick(draft.lensSku, hit.sku, draft.lensLine) });
              }}
            />
            <label style={LABEL}>Lamp / wattage<input value={draft.lamp} onChange={(e) => set({ lamp: e.target.value })} placeholder="e.g. LED" style={{ ...FIELD, marginTop: 5 }} /></label>
            <label style={LABEL}>Default hang position<input value={draft.position} onChange={(e) => set({ position: e.target.value })} placeholder="e.g. FOH truss 1" style={{ ...FIELD, marginTop: 5 }} /></label>
            <label style={LABEL}>Default circuit<input value={draft.circuit} onChange={(e) => set({ circuit: e.target.value })} placeholder="e.g. 12" style={{ ...FIELD, marginTop: 5 }} /></label>
          </>
        )}
      </div>
      {!isParts && (draft.lightEngineSku || draft.lensSku) && (
        <div style={{ marginTop: 16, border: "1px solid #eef0f3", borderRadius: 9, padding: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Light engine &amp; lens</div>
          {draft.lightEngineSku && (
            <LineRow
              line={headAsLine(draft.lightEngineSku, draft.lightEngineLine)}
              part={bySku.get(draft.lightEngineSku)}
              fallbackName={names[draft.lightEngineSku]}
              onChange={(l) => set({ lightEngineLine: lineAsHead(l) })}
              minQty={1}
              chip={<div style={{ fontSize: 11, color: "#999fa9" }}>Fixture — its datasheet covers the parts below</div>}
            />
          )}
          {draft.lensSku && (
            <LineRow
              line={headAsLine(draft.lensSku, draft.lensLine)}
              part={bySku.get(draft.lensSku)}
              fallbackName={names[draft.lensSku]}
              onChange={(l) => set({ lensLine: lineAsHead(l) })}
              onRemove={() => set({ lensSku: "", lensLine: {} })}
              chip={chipFor?.(draft.lensSku)}
            />
          )}
        </div>
      )}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: isParts ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {isParts ? (
          <LineBox title={isRack ? "Rack-level parts" : "Parts"} lines={draft.parts} onLines={(next) => set({ parts: next })} bySku={bySku} onPickPart={onPickPart} names={names} />
        ) : (
          FIXTURE_BOXES.map((box) => (
            <LineBox
              key={box}
              title={FIXTURE_BOX_LABEL[box]}
              lines={draft.lines[box]}
              onLines={(next) => set({ lines: { ...draft.lines, [box]: next } })}
              bySku={bySku}
              onPickPart={onPickPart}
              names={names}
              chipFor={chipFor}
            />
          ))
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef0f3", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "#5b616e" }}>
          Included: cost <strong>{money(live.cost)}</strong> · sell <strong>{money(live.sell)}</strong>
          <span style={{ marginLeft: 8, color: "#9aa0ab", fontSize: 11.5 }}>{pricesNote(live.pricesAsOf)}</span>
          {optional > 0 && <div style={{ color: "#8c919c", fontSize: 11.5, marginTop: 3 }}>{optional} optional add-on{optional === 1 ? "" : "s"} — offered, off by default</div>}
          {live.missing.length > 0 && <div style={{ color: "#a0442b", fontSize: 11.5, marginTop: 3 }}>Not in the catalog (priced as $0): {live.missing.join(", ")}</div>}
        </div>
        <button type="button" onClick={onSave} disabled={busy} style={{ border: 0, borderRadius: 8, padding: "9px 15px", background: busy ? "#c7cad1" : "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Saving…" : draft.id ? `Save ${noun}` : `Build ${noun}`}
        </button>
      </div>
      {error && <div role="alert" style={{ marginTop: 10, color: "#a0442b", fontSize: 12 }}>{error}</div>}
    </>
  );

  if (!isRack) return <section className="pk-card" style={{ padding: 20, marginBottom: 20 }}>{body}</section>;
  return (
    <div className="mb-5 grid items-start gap-5 lg:grid-cols-[1fr_auto]">
      <section className="pk-card min-w-0" style={{ padding: 20 }}>{body}</section>
      <RackSidebar
        editor={rackEditor}
        newId={newId}
        title={draft.label}
        shownElsewhere={rackConfigError}
        lookup={rackLookup}
        partSearch={searchAssemblyHits}
        onPickPart={onPickPart}
        defaults={rackDefaults}
        onSaveDefaults={onSaveRackDefaults ?? (async () => ({ ok: false as const, error: "Defaults can't be changed here." }))}
        rackParts={rackParts}
      />
    </div>
  );
}
