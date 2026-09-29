"use client";

import type { CSSProperties } from "react";
import { LIFT_COUNT_MAX, fmtDollars, normalizeLift, type LiftDraft } from "@/lib/service-pricing";

/**
 * #275 — the optional Lift rental control shared by the three auto-priced
 * service quote builders (flame tests, inspections, repairs).
 *
 * Presentation only: the builder owns the draft and prices it through its
 * engine finish (the lift is margined with the job, on top of any floor,
 * inside the $25 rounding and a typed total). One rental = one lift for up to
 * a week — Estimator Labor's `ceil(days / 5)` unit. A blank rate prices at the
 * default (the live `EQP-LIFT` catalog cost), shown as the placeholder. The
 * customer sees one "Lift rental" line at the margined price.
 */

const LABEL: CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  marginBottom: 4,
};
const FIELD: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 8px",
  boxSizing: "border-box",
};

export function LiftRentalPanel({
  draft,
  onDraft,
  defaultRate,
  liftCost,
  liftLine,
}: {
  draft: LiftDraft;
  onDraft: (next: LiftDraft) => void;
  /** The live EQP-LIFT default ($/rental). */
  defaultRate: number;
  /** count × rate as priced (0 = no lift). */
  liftCost: number;
  /** The customer-facing line, margined. */
  liftLine: number;
}) {
  const set = (patch: Partial<LiftDraft>) => onDraft({ ...draft, ...patch });
  const lift = normalizeLift(draft, defaultRate);
  const typedCount = draft.count.trim();
  const badCount = typedCount !== "" && typedCount !== "0" && !lift;

  return (
    <div style={{ marginTop: 16 }} data-lift-panel>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e" }}>Lift rental</span>
        <span style={{ fontSize: 10.5, color: "#aab0bb" }}>{lift ? "" : "Off"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <label>
          <span style={LABEL}>Rentals</span>
          <input
            type="number"
            min={0}
            max={LIFT_COUNT_MAX}
            step={1}
            value={draft.count}
            placeholder="0"
            aria-label="Lift rentals"
            onChange={(e) => set({ count: e.target.value })}
            style={FIELD}
          />
        </label>
        <label>
          <span style={LABEL}>Rate / rental</span>
          <input
            type="number"
            min={0}
            step={25}
            value={draft.rate}
            placeholder={String(defaultRate)}
            aria-label="Lift rental rate"
            onChange={(e) => set({ rate: e.target.value })}
            style={FIELD}
          />
        </label>
      </div>
      {badCount && (
        <span style={{ display: "block", fontSize: 10, color: "#b4543a", marginTop: 3 }}>
          Enter a whole number of rentals (1–{LIFT_COUNT_MAX}).
        </span>
      )}
      {lift ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontSize: 12.5,
            marginTop: 8,
          }}
        >
          <span style={{ color: "#5b616e" }}>
            {lift.count} × {fmtDollars(lift.rate)} · prints {fmtDollars(liftLine)}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmtDollars(liftCost)}</span>
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 6, lineHeight: 1.45 }}>
          One rental = one lift for up to a week. Margined with the job; prints as its own “Lift rental” line.
        </div>
      )}
    </div>
  );
}
