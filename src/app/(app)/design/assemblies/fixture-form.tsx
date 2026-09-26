"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  FIXTURE_BOXES,
  FIXTURE_BOX_LABEL,
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
} from "@/lib/fixture-assemblies";
import { dateYear } from "@/lib/format";
import { Typeahead } from "@/components/search/typeahead";
import { catalogFilter, catalogRank } from "@/lib/search/typeahead-rank";
import { pairKey, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import MemberCoverageChip from "./member-coverage";

/** The catalog slice the builder searches and prices from (#FXB). Cost is
 *  included: the footer shows the live included cost, as Subassemblies did. */
export type PartHit = { sku: string; desc: string; category: string; mfr: string; unit: string; list: number; cost: number; pricedAt?: number };

export type Draft = {
  id: string | null;
  kind: FixtureKind;
  label: string;
  description: string;
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
};

export function emptyDraft(kind: FixtureKind): Draft {
  return {
    id: null, kind, label: "", description: "", scope: "",
    lightEngineSku: "", lightEngineLine: {}, lensSku: "", lensLine: {},
    lamp: "", position: "", circuit: "",
    lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [],
  };
}

export function draftFromRecord(r: FixtureRecord): Draft {
  return {
    id: r.id, kind: r.kind, label: r.label, description: r.description || "", scope: r.scope || "",
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
  };
}

export function draftToInput(d: Draft): FixtureInput {
  return {
    id: d.id, kind: d.kind, label: d.label, description: d.description, scope: d.scope || undefined,
    lightEngineSku: d.lightEngineSku, lensSku: d.lensSku || null, lightEngineLine: d.lightEngineLine, lensLine: d.lensLine,
    lamp: d.lamp, position: d.position, circuit: d.circuit, lines: d.lines, parts: d.parts,
  };
}

export function draftResolvable(d: Draft): FixtureResolvable {
  return {
    id: d.id || "draft", kind: d.kind, label: d.label,
    lightEngineSku: d.lightEngineSku, lensSku: d.lensSku || null,
    lightEngineLine: d.lightEngineLine, lensLine: d.lensLine, lines: d.lines, parts: d.parts,
    ...(d.legacy ? { legacy: d.legacy } : {}),
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

/** Catalog part picker (#121): results list inline while you type.
 *  `clearOnPick` is the add-another mode the line boxes use. */
function PartPicker({ label, parts, value, onChange, clearOnPick = false }: { label: string; parts: PartHit[]; value: string; onChange: (sku: string) => void; clearOnPick?: boolean }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      <Typeahead
        items={parts}
        keyOf={partKey}
        filter={catalogFilter}
        rank={catalogRank}
        render={(p) => <PartRow part={p} />}
        onPick={(p) => onChange(p.sku)}
        labelOf={clearOnPick ? undefined : partLabel}
        selectedKey={clearOnPick ? null : value}
        placeholder="Search name, manufacturer, or part #"
        ariaLabel={label}
        inputStyle={FIELD}
      />
    </div>
  );
}

/** One part line: part, label, qty (0 = optional), cost override, ↑ ↓ ×, and
 *  the datasheet coverage chip/toggle. */
function LineRow({ line, part, fallbackName, onChange, onUp, onDown, onRemove, chip }: {
  line: FixtureLine;
  part?: PartHit;
  fallbackName?: string;
  onChange: (next: FixtureLine) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
  chip?: ReactNode;
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
        <input aria-label={`Quantity for ${line.sku}`} type="number" min={0} step={1} value={line.qty} onChange={(e) => onChange({ ...line, qty: Math.max(0, Number(e.target.value) || 0) })} style={{ ...FIELD, padding: "6px 6px", fontSize: 12 }} />
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

function LineBox({ title, lines, onLines, parts, bySku, names, chipFor }: {
  title: string;
  lines: FixtureLine[];
  onLines: (next: FixtureLine[]) => void;
  parts: PartHit[];
  bySku: ReadonlyMap<string, PartHit>;
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
        <PartPicker label="Add a part" parts={parts} value="" clearOnPick onChange={(sku) => onLines([...lines, { sku, qty: 1 }])} />
      </div>
    </div>
  );
}

export default function FixtureForm({ draft, onChange, parts, bySku, live, coverage, busy, error, onSave, onCancel }: {
  draft: Draft;
  onChange: (next: Draft) => void;
  parts: PartHit[];
  bySku: ReadonlyMap<string, PartHit>;
  live: ResolvedFixture;
  coverage: Record<string, MemberCoverage>;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const names = draft.legacy?.names || {};
  const isSystem = draft.kind === "system";
  const noun = isSystem ? "system" : "fixture";
  const engine = draft.lightEngineSku;
  const chipFor = !isSystem && engine
    ? (sku: string) => (sku === engine ? null : <MemberCoverageChip parentSku={engine} accessorySku={sku} coverage={coverage[pairKey(engine, sku)]} />)
    : undefined;
  const optional = live.parts.filter((p) => !p.included).length;
  return (
    <section className="pk-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 17, margin: 0 }}>{draft.id ? `Edit ${noun}` : `New ${noun}`}</h2>
          <p style={{ margin: "5px 0 18px", color: "#737985", fontSize: 12.5 }}>
            {isSystem
              ? "A bundle of catalog parts under one scope — a mixer, DSP & amps; a video switcher; a distro system."
              : "Pick the light engine (and lens), then what ships with it. A quantity of 0 makes a part a compatible optional add-on."}
          </p>
        </div>
        <button type="button" onClick={onCancel} style={{ border: 0, background: "transparent", color: "#737985", cursor: "pointer", fontSize: 12 }}>Cancel</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        <label style={LABEL}>Label<input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder={isSystem ? "e.g. Digital mixer, DSP & amplifiers" : "e.g. ETC Source Four LED Series 3"} style={{ ...FIELD, marginTop: 5 }} /></label>
        <label style={LABEL}>Description<textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Customer-facing description" rows={2} style={{ ...FIELD, marginTop: 5, resize: "vertical" }} /></label>
        {isSystem ? (
          <label style={LABEL}>Scope
            <select value={draft.scope} onChange={(e) => set({ scope: e.target.value as SystemScope | "" })} style={{ ...FIELD, marginTop: 5 }}>
              <option value="">— Pick a scope —</option>
              {SYSTEM_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        ) : (
          <>
            <PartPicker label="Light engine" parts={parts} value={draft.lightEngineSku} onChange={(sku) => set({ lightEngineSku: sku })} />
            <PartPicker label="Lens (optional)" parts={parts} value={draft.lensSku} onChange={(sku) => set({ lensSku: sku })} />
            <label style={LABEL}>Lamp / wattage<input value={draft.lamp} onChange={(e) => set({ lamp: e.target.value })} placeholder="e.g. LED" style={{ ...FIELD, marginTop: 5 }} /></label>
            <label style={LABEL}>Default hang position<input value={draft.position} onChange={(e) => set({ position: e.target.value })} placeholder="e.g. FOH truss 1" style={{ ...FIELD, marginTop: 5 }} /></label>
            <label style={LABEL}>Default circuit<input value={draft.circuit} onChange={(e) => set({ circuit: e.target.value })} placeholder="e.g. 12" style={{ ...FIELD, marginTop: 5 }} /></label>
          </>
        )}
      </div>
      {!isSystem && (draft.lightEngineSku || draft.lensSku) && (
        <div style={{ marginTop: 16, border: "1px solid #eef0f3", borderRadius: 9, padding: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Light engine &amp; lens</div>
          {draft.lightEngineSku && (
            <LineRow
              line={headAsLine(draft.lightEngineSku, draft.lightEngineLine)}
              part={bySku.get(draft.lightEngineSku)}
              fallbackName={names[draft.lightEngineSku]}
              onChange={(l) => set({ lightEngineLine: lineAsHead(l) })}
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
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: isSystem ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {isSystem ? (
          <LineBox title="Parts" lines={draft.parts} onLines={(next) => set({ parts: next })} parts={parts} bySku={bySku} names={names} />
        ) : (
          FIXTURE_BOXES.map((box) => (
            <LineBox
              key={box}
              title={FIXTURE_BOX_LABEL[box]}
              lines={draft.lines[box]}
              onLines={(next) => set({ lines: { ...draft.lines, [box]: next } })}
              parts={parts}
              bySku={bySku}
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
    </section>
  );
}
