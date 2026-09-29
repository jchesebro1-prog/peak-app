"use client";

import type * as React from "react";
import type { AState } from "@/app/(app)/design/quick/engine";
import { movableOptions, movablePatch, wallChangeT } from "@/lib/design/venue-templates/movable-options";
import FeetInput from "./feet-input";

type MovableValue = Parameters<typeof movableOptions>[0];

/** A run length for the "of N" note — whole feet, or feet and inches ("28'-6\""). */
const runLabel = (ft: number) => {
  const inches = Math.round(ft * 12);
  return inches % 12 ? `${Math.floor(inches / 12)}'-${inches % 12}"` : `${inches / 12}'`;
};

/** #255: one row per movable room — which wall it sits on, and how far along it (whole feet). */
export default function MovableFields({ value, tpl, onChange }: { value: MovableValue; tpl: string | null; onChange: (patch: Partial<AState>) => void }) {
  const opts = tpl ? movableOptions(value, tpl) : null;
  if (!opts || !opts.items.length) return null;
  const field: React.CSSProperties = { fontSize: 12.5, padding: "5px 8px", border: "1px solid #e4e7ec", borderRadius: 7, background: "#fff" };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {opts.items.map((m) => (
        <div key={m.id}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>{m.label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              aria-label={`${m.label} wall`}
              value={m.wall}
              onChange={(e) => {
                const w = m.walls.find((x) => x.id === e.target.value);
                // A whole foot on the new wall: the one nearest its middle.
                onChange(movablePatch(value, m.id, { wall: e.target.value, t: wallChangeT(w?.lenFt ?? 0) }));
              }}
              style={field}
            >
              {m.walls.map((w) => (
                <option key={w.id} value={w.id} disabled={!w.fits}>
                  {w.label} wall{w.fits ? "" : " (too short)"}
                </option>
              ))}
            </select>
            {/* Commits on Enter / blur, clamped — a cleared field keeps the room where it is. */}
            <FeetInput
              label={`${m.label} position`}
              min={0}
              max={Math.ceil(m.maxFt)}
              value={m.ft}
              onCommit={(n) => onChange(movablePatch(value, m.id, { wall: m.wall, t: m.maxFt > 0 ? Math.min(m.maxFt, n) / m.maxFt : 0.5 }))}
            />
            <span style={{ fontSize: 11, color: "#9aa0ab" }}>from the {m.from} (of {runLabel(m.maxFt)})</span>
          </div>
        </div>
      ))}
      {opts.warnings.map((w) => (
        <div key={w} style={{ fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{w}</div>
      ))}
    </div>
  );
}
