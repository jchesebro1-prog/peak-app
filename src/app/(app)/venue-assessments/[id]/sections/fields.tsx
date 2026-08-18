"use client";

/* ============================================================
 * Field renderer for the assessment editor's `fields` sections. Lifted out of
 * controls.tsx verbatim — everything it used to close over arrives as props.
 * ============================================================ */

import type { CSSProperties, ChangeEvent } from "react";
import type { Draft, FieldDef } from "./types";
import { inpStyle, labelStyle, measStyle, selStyle, taStyle } from "./styles";

export interface FieldRenderProps {
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  mv: (k: string) => string | boolean;
  setMeasure: (key: string, val: string | boolean) => void;
  toggleMeasure: (key: string) => void;
  toggleBtn: (active: boolean) => CSSProperties;
  boxStyle: (checked: boolean) => CSSProperties;
}

export function renderField(f: FieldDef, p: FieldRenderProps) {
  const { draft, patchDraft, mv, setMeasure, toggleMeasure, toggleBtn, boxStyle } = p;
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
    const val = f.measure ? String(mv(f.key) ?? "") : String(draft[f.key as keyof Draft] ?? "");
    const onChange = (e: ChangeEvent<HTMLSelectElement>) =>
      f.measure ? setMeasure(f.key, e.target.value) : setField(f.key as keyof Draft, e.target.value as never);
    return (
      <div key={f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <select value={val} onChange={onChange} style={selStyle}>
          <option value="">— Select —</option>
          {f.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
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
    </div>
  );
}

export function FieldsSection({ fields, ...p }: FieldRenderProps & { fields: FieldDef[] }) {
  return <div className="sv-grid">{fields.map((f) => renderField(f, p))}</div>;
}
