"use client";

/* ============================================================
 * Site-conditions chip grid. Lifted out of controls.tsx verbatim.
 * ============================================================ */

import type { CSSProperties } from "react";
import type { Draft } from "./types";

export interface ConditionsProps {
  draft: Draft;
  conditions: string[];
  toggleCondition: (c: string) => void;
  chipStyle: (active: boolean) => CSSProperties;
}

export function ConditionsSection({ draft, conditions, toggleCondition, chipStyle }: ConditionsProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {conditions.map((c) => {
        const active = draft.conditions.indexOf(c) >= 0;
        return (
          <button key={c} onClick={() => toggleCondition(c)} style={chipStyle(active)}>{c}</button>
        );
      })}
    </div>
  );
}
