"use client";

import type { CSSProperties } from "react";
import {
  autoSwitchNote,
  type TravelDraft,
  type TravelModeChoice,
  type TravelPlan,
} from "@/lib/travel-plan";

/**
 * Flights over drive — the travel control shared by the three auto-priced
 * service quote builders (flame tests, repairs, inspections; spec
 * docs/superpowers/specs/2026-09-25-travel-flights-design.md §5).
 *
 * Presentation only: the builder owns the draft, re-prices through
 * planTravel() and hands the plan back in. Renders the Auto · Drive · Fly
 * switch, the auto-switch note, and — when the plan flies — the crew /
 * nights / airfare inputs (blank = the default, shown as the placeholder)
 * and the itemized flight costs. The itemization is builder-only; customers
 * see one "Travel (air, lodging & per diem)" line.
 */

const CHOICES: Array<{ key: TravelModeChoice; label: string }> = [
  { key: "auto", label: "Auto" },
  { key: "drive", label: "Drive" },
  { key: "fly", label: "Fly" },
];

function money(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
function count(n: number, one: string, many: string): string {
  return n + " " + (n === 1 ? one : many);
}

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

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontSize: 12.5,
        marginBottom: 6,
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span style={{ color: strong ? "#16181d" : "#5b616e", minWidth: 0 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flexShrink: 0 }}>{value}</span>
    </div>
  );
}

export function TravelModePanel({
  plan,
  draft,
  onDraft,
  accent,
}: {
  plan: TravelPlan | null;
  draft: TravelDraft;
  onDraft: (next: TravelDraft) => void;
  accent: string;
}) {
  const flight = plan?.flight ?? null;
  const set = (patch: Partial<TravelDraft>) => onDraft({ ...draft, ...patch });

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e" }}>Travel</span>
        <div
          role="radiogroup"
          aria-label="Travel mode"
          style={{ display: "inline-flex", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}
        >
          {CHOICES.map((c) => {
            const on = draft.mode === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ mode: c.key })}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: "5px 11px",
                  border: "none",
                  cursor: "pointer",
                  background: on ? accent : "#fff",
                  color: on ? "#fff" : "#5b616e",
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {plan && plan.choice === "auto" && plan.mode === "fly" && (
        <div style={{ fontSize: 10.5, color: "#b4543a", marginTop: 7, lineHeight: 1.45 }}>
          {autoSwitchNote(plan.driveTotal, plan.threshold)}
        </div>
      )}

      {plan && flight && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            <label>
              <span style={LABEL}>Crew</span>
              <input
                type="number"
                min={1}
                step={1}
                value={draft.crew}
                placeholder={String(plan.defaults.crew)}
                onChange={(e) => set({ crew: e.target.value })}
                style={FIELD}
              />
            </label>
            <label>
              <span style={LABEL}>Nights</span>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.nights}
                placeholder={String(plan.defaults.nights)}
                onChange={(e) => set({ nights: e.target.value })}
                style={FIELD}
              />
            </label>
            <label>
              <span style={LABEL}>Airfare / pp</span>
              <input
                type="number"
                min={0}
                step={10}
                value={draft.airfare}
                placeholder={String(plan.defaults.airfarePerPerson)}
                onChange={(e) => set({ airfare: e.target.value })}
                style={FIELD}
              />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <Row label={"Airfare · " + count(flight.crew, "person", "people")} value={money(flight.airfare)} />
            <Row
              label={"Lodging · " + count(flight.crew, "room", "rooms") + " × " + count(flight.nights, "night", "nights")}
              value={money(flight.lodging)}
            />
            <Row
              label={"Per diem · " + count(flight.crew, "person", "people") + " × " + count(flight.tripDays, "day", "days")}
              value={money(flight.perDiem)}
            />
            <Row
              label={"Rental car · " + count(Math.ceil(flight.crew / 2), "car", "cars") + " × " + count(flight.tripDays, "day", "days")}
              value={money(flight.car)}
            />
            <Row
              label={"Travel labor · " + Math.round(flight.travelHours * 10) / 10 + " h"}
              value={money(flight.travelLabor)}
            />
            <Row label="Flights total" value={money(flight.total)} strong />
          </div>
        </>
      )}
    </div>
  );
}
