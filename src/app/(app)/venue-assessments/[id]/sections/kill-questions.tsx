"use client";

/* Kill questions (#342, notes 13/14) — the gate before the discipline intakes. Venue, contact name and email are
   answered in Customer & venue (their chips jump there); Scope, the Rigging system and stage width/depth are answered
   right here. Stage width/depth write the same measurement keys the Measurements card edits, so it stays one value. */
import type { CSSProperties, ReactNode } from "react";
import { TIER1_DEPTH_BY_CLASS, TIER1_WIDTH_BY_CLASS, classMeasureFields } from "@/lib/stores/venue-classes";
import type { DisciplineKey, Tier1Item } from "@/lib/stores/survey-intake";
import { RIG_SYSTEMS, SCOPE_KEYS, SCOPE_LABEL } from "@/lib/survey-flow";
import { labelStyle, measStyle } from "./styles";
import type { Draft } from "./types";

export function KillQuestions({
  draft, items, onJump, onScope, onRigSystems, mv, setMeasure, chipStyle, footer,
}: {
  draft: Draft;
  items: Tier1Item[];
  onJump: (sectionId: string) => void;
  onScope: (next: string[]) => void;
  onRigSystems: (next: string[]) => void;
  mv: (k: string) => string | boolean;
  setMeasure: (key: string, val: string) => void;
  chipStyle: (active: boolean) => CSSProperties;
  footer: ReactNode;
}) {
  const scope = draft.scope.filter((k): k is DisciplineKey => (SCOPE_KEYS as readonly string[]).includes(k));
  const rigRaw = draft.disciplines.rigging?.present;
  const rig = Array.isArray(rigRaw) ? rigRaw : [];
  const widthKey = TIER1_WIDTH_BY_CLASS[draft.venueClass];
  const depthKey = TIER1_DEPTH_BY_CLASS[draft.venueClass];
  const quick = classMeasureFields(draft.venueClass);
  const labelOf = (key: string, fallback: string) => quick.find((f) => f.key === key)?.label || fallback;

  const toggleScope = (k: DisciplineKey) =>
    onScope(scope.includes(k) ? scope.filter((x) => x !== k) : SCOPE_KEYS.filter((x) => x === k || scope.includes(x)));
  const toggleRig = (opt: string) => {
    if (rig.includes(opt)) return onRigSystems(rig.filter((x) => x !== opt));
    onRigSystems(opt === "None" ? ["None"] : [...rig.filter((x) => x !== "None"), opt]);
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => (item.section === "tier1" ? undefined : onJump(item.section))}
            title={item.done ? "Answered" : item.section === "tier1" ? "Answer it below" : "Missing — tap to jump to the field"}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
              padding: "9px 13px", borderRadius: 20, cursor: item.section === "tier1" ? "default" : "pointer", minHeight: 40,
              border: `1px solid ${item.done ? "#cce9da" : "#f0e2bd"}`,
              background: item.done ? "#eaf6ef" : "#fbf3dd",
              color: item.done ? "#1f7a52" : "#8a6d1f",
            }}
          >
            <span style={{ fontSize: 12 }}>{item.done ? "✓" : "○"}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Scope — what does this visit cover?</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SCOPE_KEYS.map((k) => (
            <button type="button" key={k} aria-pressed={scope.includes(k)} onClick={() => toggleScope(k)} style={chipStyle(scope.includes(k))}>
              {SCOPE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {(scope.length === 0 || scope.includes("rigging")) && (
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Rigging system</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {RIG_SYSTEMS.map((opt) => (
              <button type="button" key={opt} aria-pressed={rig.includes(opt)} onClick={() => toggleRig(opt)} style={chipStyle(rig.includes(opt))}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sv-grid" style={{ marginTop: 14 }}>
        {[
          { key: widthKey, fallback: "Stage width" },
          { key: depthKey, fallback: "Stage depth" },
        ].map(({ key, fallback }) => (
          <div key={key}>
            <label style={labelStyle}>{labelOf(key, fallback)}</label>
            <input
              value={String(mv(key) ?? "")}
              onChange={(e) => setMeasure(key, e.target.value)}
              placeholder="ft-in or decimal"
              inputMode="decimal"
              style={measStyle}
            />
          </div>
        ))}
      </div>

      {footer}
    </div>
  );
}
