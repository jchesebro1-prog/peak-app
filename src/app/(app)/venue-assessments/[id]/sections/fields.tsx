"use client";

/* ============================================================
 * Field renderer for the assessment editor's `fields` sections. Lifted out of
 * controls.tsx verbatim — everything it used to close over arrives as props.
 * ============================================================ */

import type { CSSProperties, ChangeEvent } from "react";
import type { Draft, FieldDef } from "./types";
import type { DisciplineKey, DisciplineValue } from "@/lib/stores/survey-intake";
import { inpStyle, labelStyle, measStyle, selStyle, taStyle } from "./styles";

export interface FieldRenderProps {
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  mv: (k: string) => string | boolean;
  setMeasure: (key: string, val: string | boolean) => void;
  toggleMeasure: (key: string) => void;
  toggleBtn: (active: boolean) => CSSProperties;
  boxStyle: (checked: boolean) => CSSProperties;
  /** discipline-bound selects (`disc` set) read and write through these */
  dv?: (disc: DisciplineKey, key: string) => DisciplineValue;
  setDisc?: (disc: DisciplineKey, key: string, val: DisciplineValue | undefined) => void;
}

const hintStyle: CSSProperties = { fontSize: 12, color: "#7a808c", marginTop: 5 };

export function renderField(f: FieldDef, p: FieldRenderProps) {
  const { draft, patchDraft, mv, setMeasure, toggleMeasure, toggleBtn, boxStyle, dv, setDisc } = p;
  const setField = <K extends keyof Draft>(key: K, val: Draft[K]) => patchDraft({ [key]: val } as Partial<Draft>);
  const wrap: CSSProperties | undefined =
    "full" in f && f.full ? { gridColumn: "1 / -1" } : undefined;
  if (f.kind === "textarea") {
    return (
      <div key={f.key} style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>{f.label}</label>
        <textarea value={String(draft[f.key as keyof Draft] ?? "")} onChange={(e) => setField(f.key as keyof Draft, e.target.value as never)} placeholder={f.placeholder} style={taStyle} />
      </div>
    );
  }
  if (f.kind === "sub") {
    // fields living one level down on the draft (lifeSafety.*), not at top level
    const bag = (draft[f.obj] || {}) as Record<string, string>;
    return (
      <div key={f.obj + "." + f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <input
          type="text"
          value={String(bag[f.key] ?? "")}
          onChange={(e) => patchDraft({ [f.obj]: { ...bag, [f.key]: e.target.value } } as Partial<Draft>)}
          placeholder={f.placeholder}
          style={inpStyle}
        />
      </div>
    );
  }
  if (f.kind === "checkTop") {
    const c = !!draft[f.key as keyof Draft];
    return (
      <div key={f.key} style={{ gridColumn: "1 / -1" }}>
        <div onClick={() => setField(f.key as keyof Draft, !c as never)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", border: "1px solid #e4e7ec", borderRadius: 10, cursor: "pointer", background: "#fff" }}>
          <span style={boxStyle(c)}>{c ? "✓" : ""}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a" }}>{f.label}</span>
        </div>
      </div>
    );
  }
  if (f.kind === "checkMeasure") {
    const c = !!mv(f.key);
    return (
      <div key={f.key} style={{ gridColumn: "1 / -1" }}>
        <div onClick={() => toggleMeasure(f.key)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", border: "1px solid #e4e7ec", borderRadius: 10, cursor: "pointer", background: "#fff" }}>
          <span style={boxStyle(c)}>{c ? "✓" : ""}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a" }}>{f.label}</span>
        </div>
      </div>
    );
  }
  if (f.kind === "note") {
    return (
      <div key={f.key} style={{ gridColumn: "1 / -1", fontSize: 13, color: "#5b616e", padding: "10px 13px", background: "#f6f7f9", borderRadius: 10 }}>
        {f.text}
      </div>
    );
  }
  if (f.kind === "choice") {
    const cur = String(draft[f.key as keyof Draft] ?? "");
    return (
      <div key={f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <div role="group" aria-label={f.label} style={{ display: "flex", gap: 8 }}>
          {f.options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={cur === o.value}
              onClick={() => setField(f.key as keyof Draft, (cur === o.value ? "" : o.value) as never)}
              style={toggleBtn(cur === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (f.kind === "toggle") {
    const yes = draft[f.key as keyof Draft] === true;
    const no = draft[f.key as keyof Draft] === false;
    return (
      <div key={f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setField(f.key as keyof Draft, true as never)} style={toggleBtn(yes)}>Yes</button>
          <button onClick={() => setField(f.key as keyof Draft, false as never)} style={toggleBtn(no)}>No</button>
        </div>
      </div>
    );
  }
  if (f.kind === "select") {
    const disc = f.disc && dv && setDisc ? f.disc : null;
    const val = disc ? String(dv!(disc, f.key) ?? "") : f.measure ? String(mv(f.key) ?? "") : String(draft[f.key as keyof Draft] ?? "");
    const onChange = (e: ChangeEvent<HTMLSelectElement>) =>
      disc
        ? setDisc!(disc, f.key, e.target.value)
        : f.measure ? setMeasure(f.key, e.target.value) : setField(f.key as keyof Draft, e.target.value as never);
    return (
      <div key={f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <select value={val} onChange={onChange} style={selStyle}>
          <option value="">— Select —</option>
          {f.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
          {/* a stored value outside the list (an older answer, e.g. a lift supplier) still shows and can be changed */}
          {val && !f.options.includes(val) && <option value={val}>{val}</option>}
        </select>
      </div>
    );
  }
  if (f.kind === "measure") {
    return (
      <div key={f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <input inputMode="text" value={String(mv(f.key) ?? "")} onChange={(e) => setMeasure(f.key, e.target.value)} placeholder="ft-in or ft" style={measStyle} />
      </div>
    );
  }
  // text
  return (
    <div key={f.key} style={wrap}>
      <label style={labelStyle}>{f.label}</label>
      <input type={f.type || "text"} inputMode={f.inputMode as never} value={String(draft[f.key as keyof Draft] ?? "")} onChange={(e) => setField(f.key as keyof Draft, e.target.value as never)} placeholder={f.placeholder} style={inpStyle} />
      {f.hint ? <div style={hintStyle}>{f.hint}</div> : null}
    </div>
  );
}

export function FieldsSection({ fields, ...p }: FieldRenderProps & { fields: FieldDef[] }) {
  return <div className="sv-grid">{fields.map((f) => renderField(f, p))}</div>;
}
