"use client";

/* The assessment editor's scope rail (#340, Task 7): one row per scope that is on, with a progress ring and badges for
   open prompts and missing photos. The rail itself is the shared SectionRail (#344); this file adds the "Scopes…"
   panel that turns scopes on or off mid-visit (switching one off hides it and keeps its answers). */
import { useState } from "react";
import type { AssessmentDef, ScopeCode } from "@/lib/assessments/defs/types";
import type { ScopeSel } from "@/lib/assessments/evaluate";
import type { ScopeSummary } from "@/lib/assessments/editor-model";
import { SectionRail, type RailItem } from "@/components/section-rail/section-rail";

export default function ScopeRail({
  def, summaries, active, onPick, scopes, onToggle, disabled, offWithAnswers,
}: {
  def: AssessmentDef;
  summaries: ScopeSummary[];
  active: ScopeCode;
  onPick: (c: ScopeCode) => void;
  scopes: ScopeSel[];
  onToggle: (c: ScopeCode, on: boolean) => void;
  disabled: boolean;
  offWithAnswers: ScopeCode[];
}) {
  const [editing, setEditing] = useState(false);
  const items: RailItem[] = summaries.map((s) => ({
    key: s.code,
    label: s.title,
    done: s.done,
    total: s.total,
    badges: [
      { tone: "prompt", n: s.prompts, title: `${s.prompts} suggested finding${s.prompts === 1 ? "" : "s"} to review`, text: `${s.prompts} to review` },
      { tone: "photo", n: s.missingPhotos, title: `${s.missingPhotos} required photo${s.missingPhotos === 1 ? "" : "s"} missing`, text: `${s.missingPhotos} photo${s.missingPhotos === 1 ? "" : "s"}` },
    ],
  }));
  const footer = (
    <>
      {!disabled && (
        <div style={{ padding: "8px 10px 4px" }}>
          <button type="button" className="pk-btn-outline" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Scopes…"}</button>
        </div>
      )}
      {editing && (
        <div className="as-scope-edit">
          {def.scopes.map((s) => {
            const sel = scopes.find((x) => x.code === s.code);
            const on = s.code === "S0" || !!sel?.on;
            return (
              <label key={s.code} className="as-scope-opt">
                <input type="checkbox" checked={on} disabled={s.code === "S0"} onChange={(e) => onToggle(s.code, e.target.checked)} />
                <span>{s.title}{s.depths?.length ? <span className="as-mono-sm"> ({sel?.depth ?? s.depths[0]})</span> : null}</span>
                {!on && offWithAnswers.includes(s.code) && <span className="as-mono-sm" title="Answers are kept while the scope is off"> · answers kept</span>}
              </label>
            );
          })}
        </div>
      )}
    </>
  );
  return (
    <SectionRail
      items={items}
      active={active}
      onPick={(k) => onPick(k as ScopeCode)}
      ariaLabel="Scopes"
      sheetLabel="Scope"
      footer={footer}
      showEmpty
    />
  );
}
