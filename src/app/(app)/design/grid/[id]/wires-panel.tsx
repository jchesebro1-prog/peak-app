"use client";

import { useState } from "react";
import Link from "next/link";
import type { Calibration } from "@/lib/annotations";
import { formatMeasure } from "@/lib/annotations";
import type { GridRoute } from "@/lib/stores/grid-projects";
import { routeLengthFt, type PartLite } from "@/lib/design/grid-bom";
import { removeRouteAction } from "./actions";

/**
 * Wires sidebar panel (D110) — pick a per-length catalog part, route it on
 * the plan, see each run's measured length. Routing is gated on the page
 * being calibrated: an unmeasurable wire is a lie in a BOM.
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

/** Grid notes #5: a cable with neither a cost nor a list price would land on
 *  the quote at $0 (the tier fallback only warns after Add to Quotes), so the
 *  pane flags it before it is routed. UI only — quote rules are unchanged. */
export const needsWirePrice = (p: Pick<PartLite, "list" | "cost">) => !(p.list > 0) && !(p.cost > 0);

const NEEDS_PRICE: React.CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 700,
  color: "#9a5b13",
  background: "#fdf3e3",
  border: "1px solid #f2dcb6",
  borderRadius: 999,
  padding: "1px 7px",
  whiteSpace: "nowrap",
};

const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

export default function WiresPanel({
  wireParts,
  pageRoutes,
  calibrations,
  calibrated,
  wiring,
  wirePartId,
  selectedRouteId,
  unmeasured,
  busy,
  onPickPart,
  onStartDraw,
  onCancelDraw,
  onSelect,
}: {
  /** Catalog parts priced per length — the only legal wire types. */
  wireParts: PartLite[];
  /** Routes on the active sheet+page. */
  pageRoutes: GridRoute[];
  calibrations: Calibration[];
  calibrated: boolean;
  wiring: boolean;
  wirePartId: string | null;
  selectedRouteId: string | null;
  /** Whole-project routes whose page calibration has gone missing. */
  unmeasured: number;
  busy: boolean;
  onPickPart: (id: string | null) => void;
  onStartDraw: () => void;
  onCancelDraw: () => void;
  onSelect: (id: string | null) => void;
}) {

  return (
    <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 7 }}>
        Wires
      </div>
      {wireParts.length === 0 ? (
        <div style={{ fontSize: 11, color: "#8c919c", lineHeight: 1.45 }}>
          No per-foot cable in the Grid library yet — an admin can load starter cables in{" "}
          <Link href="/design/grid/settings#wire-types" style={{ color: "var(--accent)", fontWeight: 600 }}>
            Grid Settings → Wire types
          </Link>{" "}
          (then set their prices in the Catalog).
        </div>
      ) : (
        <>
          <select
            value={wirePartId || ""}
            onChange={(e) => onPickPart(e.target.value || null)}
            style={INPUT}
          >
            <option value="">Pick a wire type…</option>
            {wireParts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.desc} ({needsWirePrice(p) ? "needs price" : `$${p.list}/${p.unit}`})
              </option>
            ))}
          </select>
          {(() => {
            const picked = wirePartId ? wireParts.find((p) => p.id === wirePartId) : undefined;
            const unpriced = wireParts.filter(needsWirePrice).length;
            if (picked && needsWirePrice(picked)) {
              return (
                <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={NEEDS_PRICE}>Needs price</span>
                  <span>No cost or list in the Catalog yet — this run would quote at $0.</span>
                </div>
              );
            }
            return unpriced > 0 ? (
              <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 5 }}>
                <span style={NEEDS_PRICE}>Needs price</span> {unpriced} cable{unpriced === 1 ? " has" : "s have"} no price in the Catalog yet.
              </div>
            ) : null;
          })()}
          <button
            style={{
              ...BTN,
              width: "100%",
              marginTop: 6,
              background: wiring ? "#16181d" : "#fff",
              color: wiring ? "#fff" : "#3d424e",
              borderColor: wiring ? "#16181d" : "#dfe2e8",
              opacity: calibrated && wirePartId ? 1 : 0.55,
            }}
            disabled={busy || !calibrated || !wirePartId}
            onClick={wiring ? onCancelDraw : onStartDraw}
          >
            {wiring ? "Click waypoints · click the last one again to finish" : "Route wire"}
          </button>
          {!calibrated && (
            <div style={{ fontSize: 10.5, color: "#a0442b", marginTop: 5 }}>
              Calibrate this page first — wire lengths need a scale.
            </div>
          )}
        </>
      )}

      {pageRoutes.length > 0 && (
        <div style={{ marginTop: 9, display: "grid", gap: 3 }}>
          {pageRoutes.map((r) => {
            const ft = routeLengthFt(r, calibrations);
            const cal = calibrations.find((c) => c.docId === r.sheetId && c.page === r.page);
            const on = r.id === selectedRouteId;
            return (
              <button
                key={r.id}
                onClick={() => onSelect(on ? null : r.id)}
                style={{
                  ...BTN,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontWeight: 500,
                  padding: "5px 8px",
                  background: on ? "#eef2f9" : "#fff",
                  borderColor: on ? "#b9c6de" : "#dfe2e8",
                }}
              >
                <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.partId}
                </span>
                {(() => {
                  const wp = wireParts.find((p) => p.id === r.partId);
                  return wp && needsWirePrice(wp) ? <span style={NEEDS_PRICE}>Needs price</span> : null;
                })()}
                <span style={{ fontSize: 11, color: "#5b616e" }}>
                  {ft !== null && cal ? formatMeasure(ft, cal.unit) : "unmeasured"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {unmeasured > 0 && (
        <div style={{ fontSize: 10.5, color: "#a0442b", marginTop: 8 }}>
          {unmeasured} wire run{unmeasured === 1 ? "" : "s"} lost their page scale —
          recalibrate to price them.
        </div>
      )}
    </div>
  );
}

/**
 * The selected run's Remove (D110) — the Property Editor's "one wire" mode
 * (#299). Keyed by the route id at the call site, so picking another run
 * disarms the confirm.
 */
export function RouteEditor({
  projectId,
  selected,
  busy,
  onSelect,
  onChanged,
  onError,
}: {
  projectId: string;
  selected: GridRoute;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [armDelete, setArmDelete] = useState(false);
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid #edeff3", paddingTop: 8 }}>
      {!armDelete ? (
        <button style={{ ...BTN, width: "100%", padding: "4px 8px", fontSize: 11, color: "#a0442b" }} onClick={() => setArmDelete(true)}>
          Remove wire run
        </button>
      ) : (
        <button
          style={{ ...BTN, width: "100%", padding: "4px 8px", fontSize: 11, background: "#a0442b", color: "#fff", borderColor: "#a0442b" }}
          disabled={busy}
          onClick={async () => {
            const res = await removeRouteAction(projectId, selected.id);
            setArmDelete(false);
            onSelect(null);
            if (!res.ok) onError(res.error);
            else onChanged();
          }}
        >
          Really remove
        </button>
      )}
    </div>
  );
}
