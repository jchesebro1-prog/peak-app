"use client";

import { useState, type CSSProperties } from "react";
import {
  discountableSkus,
  discountHits,
  normalCostOf,
  parseDiscountPct,
  PROJECT_DISCOUNT_NOTE_MAX,
  type ProjectDiscount,
  type ProjectDiscounts,
} from "@/lib/project-discounts/rules";
import { fmt } from "./pricing";
import type { SpecSection } from "./types";
import { ACCENT_INK } from "./est-ui";

/**
 * #366 — project discounts on Build: a vendor's project pricing recorded as an
 * extra % off OUR cost for one catalog SKU, everywhere it appears on this
 * estimate (lines and parts inside assemblies). Internal only: the customer's
 * price never moves and no customer surface shows any of this.
 *
 * `ProjectDiscountEditor` is the one small form (% + note, Save / Remove) —
 * opened from a line's "% project" (section-card.tsx) or from the rail card
 * below, whose "+ Add" picker is also how a part INSIDE an assembly gets a
 * discount (Build lists assembly lines, not their parts).
 */

export const PROJECT_DISCOUNT_COPY = {
  title: "Project discounts",
  add: "+ Add",
  pick: "Part",
  pickPlaceholder: "Choose a part…",
  pct: "% off our cost",
  note: "Note",
  notePlaceholder: "e.g. ETC project registration #",
  save: "Save",
  cancel: "Cancel",
  remove: "Remove",
  edit: "Edit",
  done: "Done",
  badPct: "Enter a % between 0 and 100",
  noCost: "This part has no cost — nothing to discount.",
  lineTrigger: "% project",
  triggerTitle: "Project discount… — % off our cost for this part, everywhere on this estimate",
  partsChip: (n: number) => `${n} parts project`,
  help: "Our cost only — the customer's price never changes.",
  chip: (pct: number) => `−${pct}% project`,
  lines: (n: number) => `${n} ${n === 1 ? "line" : "lines"}`,
  applied: (n: number) => `Applied to ${n} ${n === 1 ? "line" : "lines"}`,
  normal: (normal: number, cost: number) => `Normal ${fmt(normal)} → ${fmt(cost)}`,
} as const;

const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#8c919c", marginBottom: 3, display: "block" };
const INPUT: CSSProperties = { width: "100%", height: 28, border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12.5, padding: "0 8px", background: "#fff", color: "#16181d", boxSizing: "border-box" };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 6, border: "1px solid #e4e7ec", background: "#fff", color: "#5b616e", cursor: "pointer" };
const BTN_PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
const LINK: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)" };

/** How many lines / assembly parts carry `sku` on these sections (whether or not it has a discount yet). */
export function linesForSku(sections: SpecSection[], sku: string): number {
  return discountHits(sections, { [sku]: { pct: 1, note: "", by: "", at: 0 } })[sku] || 0;
}

/** The normal unit cost of the first line / part carrying `sku` (0 = none, or no cost). */
export function normalCostForSku(sections: SpecSection[], sku: string): number {
  for (const sec of sections) {
    for (const it of sec.items) {
      if (Array.isArray(it.components) && it.components.length) {
        for (const c of it.components) if ((c.sku || "").trim() === sku && c.qty > 0) return normalCostOf(c);
      } else if ((it.sku || "").trim() === sku) return normalCostOf(it);
    }
  }
  return 0;
}

export function ProjectDiscountEditor(p: {
  sku: string;
  /** The part's label (description / model), shown above the fields. */
  label: string;
  /** The current entry, if any (prefills; enables Remove). */
  entry?: ProjectDiscount;
  /** The part's normal unit cost — 0 means nothing to discount (no Save). */
  normalCost: number;
  /** Lines / parts this SKU appears on — the "Applied to N lines" count. */
  hits: number;
  onSave: (pct: number, note: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [pct, setPct] = useState(p.entry ? String(p.entry.pct) : "");
  const [note, setNote] = useState(p.entry?.note || "");
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const parsed = parseDiscountPct(pct);
  if (applied != null) {
    return (
      <div data-testid="project-discount-editor" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
        <span role="status" style={{ color: "#1f7a52", fontWeight: 600 }}>{PROJECT_DISCOUNT_COPY.applied(applied)}</span>
        <button type="button" style={BTN} onClick={p.onClose}>{PROJECT_DISCOUNT_COPY.done}</button>
      </div>
    );
  }
  const save = () => {
    if (parsed == null) {
      setErr(PROJECT_DISCOUNT_COPY.badPct);
      return;
    }
    setErr(null);
    p.onSave(parsed, note);
    setApplied(p.hits);
  };
  return (
    <div data-testid="project-discount-editor" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 600, color: "#16181d", lineHeight: 1.3 }}>
        {p.label}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", fontWeight: 400 }}>{p.sku}</div>
      </div>
      {!(p.normalCost > 0) ? (
        <div style={{ color: "#8c919c" }}>{PROJECT_DISCOUNT_COPY.noCost}</div>
      ) : (
        <>
          <label>
            <span style={LABEL}>{PROJECT_DISCOUNT_COPY.pct}</span>
            <input
              style={INPUT}
              inputMode="decimal"
              autoFocus
              value={pct}
              aria-invalid={!!err}
              onChange={(e) => {
                setPct(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") p.onClose();
              }}
            />
          </label>
          {err && <div role="alert" style={{ color: "#b4543a", fontSize: 11 }}>{err}</div>}
          {parsed != null && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#5b616e" }}>
              {PROJECT_DISCOUNT_COPY.normal(p.normalCost, Math.round(p.normalCost * (1 - parsed / 100) * 100) / 100)}
            </div>
          )}
          <label>
            <span style={LABEL}>{PROJECT_DISCOUNT_COPY.note}</span>
            <input
              style={INPUT}
              value={note}
              maxLength={PROJECT_DISCOUNT_NOTE_MAX}
              placeholder={PROJECT_DISCOUNT_COPY.notePlaceholder}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") p.onClose();
              }}
            />
          </label>
        </>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {p.normalCost > 0 && <button type="button" style={BTN_PRIMARY} onClick={save}>{PROJECT_DISCOUNT_COPY.save}</button>}
        <button type="button" style={BTN} onClick={p.onClose}>{PROJECT_DISCOUNT_COPY.cancel}</button>
        {p.entry && (
          <button
            type="button"
            style={{ ...BTN, color: "#b4543a" }}
            onClick={() => {
              p.onRemove();
              p.onClose();
            }}
          >
            {PROJECT_DISCOUNT_COPY.remove}
          </button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: "#9aa0ab" }}>{PROJECT_DISCOUNT_COPY.help}</div>
    </div>
  );
}

/** The Build rail card: every discount on the estimate (part, %, note, lines hit) with Edit / Remove, and "+ Add".
 *  Hidden when the estimate has no discount and nothing that could carry one. */
export function ProjectDiscountsCard(p: {
  sections: SpecSection[];
  discounts: ProjectDiscounts;
  onSet: (sku: string, pct: number, note: string) => void;
  onRemove: (sku: string) => void;
}) {
  const [open, setOpen] = useState(true);
  /** "" = the + Add picker; a SKU = editing that entry; null = no editor. */
  const [editing, setEditing] = useState<string | null>(null);
  const [pickSku, setPickSku] = useState("");
  const skus = discountableSkus(p.sections);
  const entries = Object.entries(p.discounts || {});
  if (!entries.length && !skus.length) return null;
  const hits = discountHits(p.sections, p.discounts || {});
  const labelOf = (sku: string) => skus.find((s) => s.sku === sku)?.label || sku;
  const header: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" };
  const editorFor = (sku: string) => (
    <ProjectDiscountEditor
      key={sku}
      sku={sku}
      label={labelOf(sku)}
      entry={p.discounts[sku]}
      normalCost={normalCostForSku(p.sections, sku)}
      hits={linesForSku(p.sections, sku)}
      onSave={(pct, note) => p.onSet(sku, pct, note)}
      onRemove={() => p.onRemove(sku)}
      onClose={() => {
        setEditing(null);
        setPickSku("");
      }}
    />
  );
  return (
    <div data-testid="project-discounts-card" style={{ margin: "6px 14px", padding: 13, background: "#f7f8fa", borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: open ? 9 : 0 }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{ ...header, background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          {PROJECT_DISCOUNT_COPY.title}
          {entries.length > 0 && <span style={{ fontFamily: "var(--font-mono)", color: ACCENT_INK }}>{entries.length}</span>}
        </button>
        {open && editing == null && skus.length > 0 && (
          <button type="button" style={LINK} onClick={() => setEditing("")}>{PROJECT_DISCOUNT_COPY.add}</button>
        )}
      </div>
      {open && (
        <>
          {entries.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {entries.map(([sku, e]) =>
                editing === sku ? (
                  <li key={sku} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 10 }}>{editorFor(sku)}</li>
                ) : (
                  <li key={sku} data-sku={sku} style={{ fontSize: 12, lineHeight: 1.35 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#16181d" }} title={`${labelOf(sku)} · ${sku}`}>
                        {labelOf(sku)}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#1f7a52", flexShrink: 0 }}>{e.pct}%</span>
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>{sku}</div>
                    {e.note && <div style={{ fontSize: 11, color: "#5b616e" }}>{e.note}</div>}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 2, fontSize: 11, color: "#8c919c" }}>
                      <span>{PROJECT_DISCOUNT_COPY.lines(hits[sku] || 0)}</span>
                      <button type="button" style={LINK} onClick={() => setEditing(sku)}>{PROJECT_DISCOUNT_COPY.edit}</button>
                      <button type="button" style={{ ...LINK, color: "#b4543a" }} onClick={() => p.onRemove(sku)}>{PROJECT_DISCOUNT_COPY.remove}</button>
                    </div>
                  </li>
                )
              )}
            </ul>
          )}
          {editing === "" && (
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 10, marginTop: entries.length ? 8 : 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <label>
                <span style={LABEL}>{PROJECT_DISCOUNT_COPY.pick}</span>
                <select style={INPUT} value={pickSku} onChange={(e) => setPickSku(e.target.value)}>
                  <option value="">{PROJECT_DISCOUNT_COPY.pickPlaceholder}</option>
                  {skus.map((s) => (
                    <option key={s.sku} value={s.sku}>
                      {s.label} · {s.where}
                      {p.discounts[s.sku] ? ` (${p.discounts[s.sku].pct}%)` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {pickSku ? editorFor(pickSku) : (
                <div>
                  <button type="button" style={BTN} onClick={() => setEditing(null)}>{PROJECT_DISCOUNT_COPY.cancel}</button>
                </div>
              )}
            </div>
          )}
          {!entries.length && editing == null && <div style={{ fontSize: 11, color: "#9aa0ab" }}>{PROJECT_DISCOUNT_COPY.help}</div>}
        </>
      )}
    </div>
  );
}
