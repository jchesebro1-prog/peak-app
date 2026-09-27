"use client";

import { GRID_LAYERS, categoryLayerKey, scopeLayerKey, typeLayerKey, type GridLayer } from "@/lib/design/grid-scopes";
import type { TypeLayerRow } from "@/lib/design/device-types";

/**
 * Layer visibility (punch #48) - the actual ask behind Jeff's "if we don't
 * allow different filters then it is going to get busy quick": these toggles
 * show and hide what is ALREADY PLACED on the plan, per scope, per device
 * type within a scope (#226 — never per raw catalog category: an unmapped
 * item's raw/seeded category is only a sub-label on the Unmapped row), and
 * per user-defined category.
 *
 * Deliberately NOT the palette filter. The palette filter answers "what can I
 * arm"; this answers "what do I want to look at". Turning a layer off never
 * disarms a part, and arming a part never turns a layer on - the two controls
 * share the taxonomy and nothing else. Visibility is a view state and is not
 * persisted: it is how one person is reading the drawing right now, not a
 * property of the design.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

export type LayerCount = { key: string; count: number };

function Row({
  label,
  sub,
  count,
  hidden,
  swatch,
  indent = false,
  onToggle,
}: {
  label: string;
  sub?: string;
  count: number;
  hidden: boolean;
  swatch?: string;
  indent?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={hidden ? `Show ${label}` : `Hide ${label}`}
      style={{
        ...BTN,
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontWeight: 500,
        padding: indent ? "3px 8px" : "4px 8px",
        marginLeft: indent ? 14 : 0,
        fontSize: indent ? 11.5 : 12,
        opacity: hidden ? 0.5 : 1,
        background: hidden ? "#f5f6f8" : "#fff",
      }}
    >
      <span
        aria-hidden
        style={{
          width: indent ? 9 : 11, height: indent ? 9 : 11, borderRadius: 3, flex: "0 0 auto",
          background: hidden ? "transparent" : swatch || "#5b616e",
          borderWidth: 1, borderStyle: "solid", borderColor: swatch || "#5b616e",
        }}
      />
      <span
        style={{
          flex: 1, textAlign: "left", whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis",
          textDecoration: hidden ? "line-through" : "none",
        }}
      >
        {label}
        {sub && <span style={{ color: "#9aa0ab" }}> · {sub}</span>}
      </span>
      <span style={{ fontSize: 11, color: "#8c919c" }}>{count}</span>
    </button>
  );
}

export default function LayersPanel({
  scopeCounts,
  typeRows,
  categoryCounts,
  hidden,
  scopeColor,
  onToggle,
  onShowAll,
}: {
  /** Placed-item count per scope, whole project. */
  scopeCounts: Map<GridLayer, number>;
  /** #226: per scope, placed-item count per device type (Unmapped last). */
  typeRows: Map<GridLayer, TypeLayerRow[]>;
  /** Placed-item count per user-defined category, whole project. */
  categoryCounts: LayerCount[];
  hidden: ReadonlySet<string>;
  scopeColor: (scope: GridLayer) => string;
  onToggle: (key: string) => void;
  onShowAll: () => void;
}) {
  const anyHidden = hidden.size > 0;
  const scopes = GRID_LAYERS.filter((s) => (scopeCounts.get(s) || 0) > 0);

  return (
    <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 7 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab" }}>
          Layers
        </div>
        <span style={{ flex: 1 }} />
        {anyHidden && (
          <button
            onClick={onShowAll}
            style={{ ...BTN, padding: "1px 7px", fontSize: 10.5, borderColor: "transparent", color: "var(--accent)" }}
          >
            Show all
          </button>
        )}
      </div>

      {scopes.length === 0 && categoryCounts.length === 0 ? (
        <div style={{ fontSize: 11, color: "#8c919c" }}>
          Place something and its scope shows up here to hide or show.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 3 }}>
          {scopes.map((s) => (
            <div key={s} style={{ display: "grid", gap: 3 }}>
              <Row
                label={s}
                count={scopeCounts.get(s) || 0}
                hidden={hidden.has(scopeLayerKey(s))}
                swatch={scopeColor(s)}
                onToggle={() => onToggle(scopeLayerKey(s))}
              />
              {(typeRows.get(s) || []).map((t) => (
                <Row
                  key={t.key}
                  indent
                  label={t.label}
                  sub={t.subs.length ? t.subs.join(", ") : undefined}
                  count={t.count}
                  hidden={hidden.has(typeLayerKey(s, t.key))}
                  swatch={scopeColor(s)}
                  onToggle={() => onToggle(typeLayerKey(s, t.key))}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {categoryCounts.length > 0 && (
        <div style={{ marginTop: 9, borderTop: "1px solid #edeff3", paddingTop: 8, display: "grid", gap: 3 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>
            Your categories
          </div>
          {categoryCounts.map((c) => (
            <Row
              key={c.key}
              label={c.key}
              count={c.count}
              hidden={hidden.has(categoryLayerKey(c.key))}
              swatch="#8a6d3b"
              onToggle={() => onToggle(categoryLayerKey(c.key))}
            />
          ))}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 7, lineHeight: 1.45 }}>
        Hiding a layer only hides it on the plan: a hidden marker can&apos;t be
        clicked or dragged, and nothing leaves the BOM.
      </div>
    </div>
  );
}
