"use client";

/* The assessment editor's scope rail (#340, Task 7): one row per scope that is on, with a progress ring and badges for
   open prompts and missing photos. Below 760 px wide it collapses to a select at the top (the CSS in editor.tsx
   switches between the two). "Scopes…" turns scopes on or off mid-visit; switching one off hides it and keeps its
   answers. */
import { useState } from "react";
import type { AssessmentDef, ScopeCode } from "@/lib/assessments/defs/types";
import type { ScopeSel } from "@/lib/assessments/evaluate";
import type { ScopeSummary } from "@/lib/assessments/editor-model";

function Ring({ done, total }: { done: number; total: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r={r} fill="none" stroke="#e8eaef" strokeWidth="3" />
      <circle
        cx="12" cy="12" r={r} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

function Badge({ n, title, tone }: { n: number; title: string; tone: "prompt" | "photo" }) {
  if (!n) return null;
  const s = tone === "prompt" ? { color: "#9a5b12", background: "#fdf3e3", border: "1px solid #f1dcb6" } : { color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec" };
  return (
    <span title={title} style={{ ...s, fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {tone === "prompt" ? "!" : (
        <svg width="10" height="9" viewBox="0 0 10 9" aria-hidden="true" style={{ verticalAlign: "-1px" }}>
          <path d="M1 2.5h2l1-1.5h2l1 1.5h2v5.5H1z" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="5" cy="5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      )} {n}
    </span>
  );
}

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
  const label = (s: ScopeSummary) => `${s.title} — ${s.done}/${s.total}${s.prompts ? ` · ${s.prompts} to review` : ""}${s.missingPhotos ? ` · ${s.missingPhotos} photo${s.missingPhotos === 1 ? "" : "s"}` : ""}`;
  return (
    <>
      <div className="as-rail-sheet">
        <select className="pk-input" aria-label="Scope" value={active} onChange={(e) => onPick(e.target.value as ScopeCode)}>
          {summaries.map((s) => <option key={s.code} value={s.code}>{label(s)}</option>)}
        </select>
      </div>
      <nav className="as-rail pk-card" aria-label="Scopes">
        {summaries.map((s) => (
          <button key={s.code} type="button" className={`as-rail-row${s.code === active ? " on" : ""}`} aria-current={s.code === active} onClick={() => onPick(s.code)}>
            <Ring done={s.done} total={s.total} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="as-rail-title">{s.title}</span>
              <span className="as-mono-sm">{s.done}/{s.total}</span>
            </span>
            <Badge n={s.prompts} tone="prompt" title={`${s.prompts} suggested finding${s.prompts === 1 ? "" : "s"} to review`} />
            <Badge n={s.missingPhotos} tone="photo" title={`${s.missingPhotos} required photo${s.missingPhotos === 1 ? "" : "s"} missing`} />
          </button>
        ))}
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
      </nav>
    </>
  );
}
