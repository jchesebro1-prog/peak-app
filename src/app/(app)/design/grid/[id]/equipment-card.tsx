"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import type { QuickScopeInputs, TierKey } from "@/app/(app)/design/quick/engine";
import type { SellCard, SellLine } from "@/lib/design/auto-estimate";
import { mergeScopeEstimate, reconcileQtyDraft, type AutoEstimate, type AutoOverride } from "@/lib/design/grid-auto-model";
import { previewAutoEstimateAction, searchAutoEquipmentAction, type AutoEquipHit } from "./actions";

/**
 * The Auto Equipment step (#GEM, spec §5) — shared by the intake and the
 * Scope panel's "Change equipment…". Cards arrive SELL-ONLY from
 * previewAutoEstimateAction; every change re-prices on the server (debounced).
 * No effects: previews run from event handlers.
 */

const TIERS: Array<{ key: TierKey; label: string }> = [
  { key: "good", label: "Good" },
  { key: "better", label: "Better" },
  { key: "best", label: "Best" },
];
const SCOPE_LABEL: Record<string, string> = { rigging: "Rigging", curtains: "Curtains", lighting: "Lighting", audio: "Audio", video: "Video" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const INPUT: CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 7, padding: "5px 7px", fontSize: 12.5, fontFamily: "var(--font-mono)", background: "#fff", boxSizing: "border-box" };
const TAG: CSSProperties = { marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 6px" };
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const unitMoney = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The Equipment map row an unmapped line should be mapped on (Grid Settings → Equipment map). */
export const mapHref = (rowKey: string) => `/design/grid/settings/equipment-map#row-${rowKey.replace(":", "-")}`;

/** Server preview of the cards (sell-only), debounced. */
export function useAutoPreview(initial: SellCard[] | null = null) {
  const [cards, setCards] = useState<SellCard[] | null>(initial);
  const [error, setError] = useState("");
  const [loading, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = (inputs: QuickScopeInputs, estimate: AutoEstimate, delay = 0) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        start(async () => {
          const r = await previewAutoEstimateAction({ inputs, estimate });
          if (r.ok) {
            setCards(r.cards);
            setError("");
          } else setError(r.error);
        }),
      delay
    );
  };
  return { cards, error, loading, run };
}

export function EquipmentPicker({
  rowKey,
  onPick,
  onClose,
}: {
  rowKey: string;
  onPick: (hit: AutoEquipHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AutoEquipHit[]>([]);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        start(async () => {
          const r = await searchAutoEquipmentAction(v, rowKey);
          setHits(r.hits);
        }),
      250
    );
  };
  return (
    <div style={{ gridColumn: "1 / -1", border: "1px solid #eef0f3", borderRadius: 9, padding: 8, background: "#fafbfc", display: "grid", gap: 5 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input autoFocus value={q} onChange={(e) => change(e.target.value)} placeholder="Search catalog parts and assemblies…" style={{ ...INPUT, flex: 1, fontFamily: "inherit" }} />
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
      </div>
      {pending && <div style={{ fontSize: 11, color: "#8c919c" }}>Searching…</div>}
      {!pending && q.trim().length >= 2 && hits.length === 0 && <div style={{ fontSize: 11, color: "#8c919c" }}>No matches.</div>}
      {hits.map((h) => (
        <button key={`${h.kind}:${h.ref}`} type="button" onClick={() => onPick(h)} style={{ ...BTN, textAlign: "left", fontWeight: 500 }}>
          <span style={{ fontFamily: "var(--font-mono)" }}>{h.kind === "assembly" ? "Assembly" : h.ref}</span> — {h.desc}
          <span style={{ color: "#8c919c" }}> · {unitMoney(h.unitSell)}/{h.unit}</span>
        </button>
      ))}
    </div>
  );
}

export function EquipmentCard({
  card,
  estimate,
  onChange,
}: {
  card: SellCard;
  estimate: AutoEstimate;
  onChange: (next: AutoEstimate, delay?: number) => void;
}) {
  const [swapping, setSwapping] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Reconcile the qty draft against a fresh server re-price (#GEM fix wave 1,
  // M7) — comparing against the previous card's lines during render (the
  // "adjusting state when a prop changes" pattern, not an effect: this file
  // runs no effects). `card.lines` is a fresh array from every preview
  // response, so this runs on every re-price; reconcileQtyDraft is a no-op
  // (same reference back) unless a draft actually went stale.
  const [seenLines, setSeenLines] = useState(card.lines);
  if (seenLines !== card.lines) {
    setSeenLines(card.lines);
    setDraft((d) => reconcileQtyDraft(d, card.lines));
  }
  const writeRow = (rowKey: string, o: AutoOverride, delay = 0) => {
    const overrides = { ...estimate.overrides };
    if (o.sku || o.assemblyId || o.qty !== undefined) overrides[rowKey] = o;
    else delete overrides[rowKey];
    onChange({ ...estimate, overrides }, delay);
  };
  const setTier = (tier: TierKey) => {
    setDraft({});
    // A tier pre-fills the whole card, so it resets this scope's swaps and qty edits (D-GEM-7).
    onChange(mergeScopeEstimate(estimate, card.scope, tier, {}));
  };
  const swap = (line: SellLine, hit: AutoEquipHit) => {
    const cur = estimate.overrides[line.rowKey];
    writeRow(line.rowKey, { ...(hit.kind === "part" ? { sku: hit.ref } : { assemblyId: hit.ref }), ...(cur?.qty !== undefined ? { qty: cur.qty } : {}) });
    setSwapping(null);
  };
  const setQty = (line: SellLine, raw: string) => {
    setDraft((d) => ({ ...d, [line.rowKey]: raw }));
    const n = Math.max(0, Math.round(Number(raw) || 0));
    const cur = estimate.overrides[line.rowKey] || {};
    const next: AutoOverride = {};
    if (cur.sku) next.sku = cur.sku;
    if (cur.assemblyId) next.assemblyId = cur.assemblyId;
    if (n !== line.eqQty) next.qty = n;
    writeRow(line.rowKey, next, 350);
  };
  const reset = (line: SellLine) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[line.rowKey];
      return next;
    });
    writeRow(line.rowKey, {});
  };

  return (
    <section style={{ border: "1px solid #ececf0", borderRadius: 12, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{SCOPE_LABEL[card.scope] ?? card.scope}</div>
        <div style={{ display: "flex", gap: 4 }}>
          {TIERS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTier(t.key)}
              style={{
                ...BTN,
                background: card.tier === t.key ? "var(--accent)" : "#fff",
                borderColor: card.tier === t.key ? "var(--accent)" : "#dfe2e8",
                color: card.tier === t.key ? "#fff" : "#3d424e",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700 }}>{money(card.total)}</span>
      </div>
      <div style={{ display: "grid", gap: 3, marginTop: 10 }}>
        {card.lines.map((l) => {
          const needs = l.status === "needs-part";
          const edited = l.swapped || l.qty !== l.eqQty;
          return (
            <div key={l.rowKey} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 118px 92px 92px auto", gap: 8, alignItems: "center", fontSize: 12.5, padding: "6px 8px", borderRadius: 8, background: needs ? "#fdf4e7" : "transparent" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {l.label}
                  {l.status === "allowance" && <span style={TAG}>Allowance</span>}
                </div>
                <div style={{ fontSize: 11, color: needs ? "#a0442b" : "#8c919c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {needs ? (
                    <>
                      Needs a part — {l.reason ?? "not mapped yet"} ·{" "}
                      <a href={mapHref(l.rowKey)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                        Map it
                      </a>
                    </>
                  ) : (
                    `${l.refDesc ?? l.ref ?? ""}${l.swapped ? " · swapped for this design" : ""}`
                  )}
                </div>
              </div>
              <span style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                <input
                  type="number"
                  min={0}
                  value={draft[l.rowKey] ?? String(l.qty)}
                  onChange={(e) => setQty(l, e.target.value)}
                  aria-label={`${l.label} quantity`}
                  style={{ ...INPUT, width: 70, textAlign: "right", borderColor: l.qty !== l.eqQty ? "var(--accent)" : "#e4e7ec" }}
                />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb" }}>{l.unit}</span>
              </span>
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#5b616e" }}>{needs ? "—" : unitMoney(l.unitSell)}</span>
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}>{needs ? "—" : money(l.total)}</span>
              <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setSwapping(swapping === l.rowKey ? null : l.rowKey)} style={BTN}>Swap…</button>
                {edited && <button type="button" onClick={() => reset(l)} title="Back to the equation and the map" style={BTN}>↺</button>}
              </span>
              {swapping === l.rowKey && <EquipmentPicker rowKey={l.rowKey} onPick={(hit) => swap(l, hit)} onClose={() => setSwapping(null)} />}
            </div>
          );
        })}
      </div>
      {card.needsPart > 0 && (
        <div style={{ fontSize: 11.5, color: "#a0442b", marginTop: 8 }}>
          {card.needsPart} line{card.needsPart === 1 ? "" : "s"} need{card.needsPart === 1 ? "s" : ""} a part: left off the plan and out of this total.
        </div>
      )}
    </section>
  );
}

export function EquipmentCards({
  cards,
  estimate,
  onChange,
  loading,
  error,
}: {
  cards: SellCard[] | null;
  estimate: AutoEstimate;
  onChange: (next: AutoEstimate, delay?: number) => void;
  loading: boolean;
  error: string;
}) {
  if (!cards) return <div style={{ fontSize: 13, color: error ? "#a0442b" : "#8c919c" }}>{error || "Pricing your equipment from the catalog…"}</div>;
  const grand = cards.reduce((s, c) => s + c.total, 0);
  const needs = cards.reduce((s, c) => s + c.needsPart, 0);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {cards.map((c) => (
        <EquipmentCard key={c.scope} card={c} estimate={estimate} onChange={onChange} />
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "4px 2px" }}>
        <span style={{ color: needs ? "#a0442b" : "#1f7a52" }}>
          {needs ? `${needs} line${needs === 1 ? "" : "s"} still need a part (left off the plan)` : "Every line is priced from the catalog"}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
          Total {money(grand)}
          {loading ? " · updating…" : ""}
        </span>
      </div>
      {error && <div style={{ color: "#a0442b", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
