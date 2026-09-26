"use client";

import type { CSSProperties } from "react";
import { SUBCFG, type AState } from "@/app/(app)/design/quick/engine";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";

/** The intake's scope list (#211, spec §5): the five Grid scopes, each with its sub-configuration. */
const LABEL: Record<string, string> = { rigging: "Rigging", curtains: "Curtains", lighting: "Lighting", audio: "Audio", video: "Video" };
const chip = (sel: boolean): CSSProperties => ({
  border: `1px solid ${sel ? "var(--accent)" : "#e4e7ec"}`,
  background: sel ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
  borderRadius: 7,
  padding: "5px 9px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
});

export default function ScopePicker({ value, onChange }: { value: AState; onChange: (patch: Partial<AState>) => void }) {
  const bag = value as unknown as Record<string, unknown>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {TRACKABLE_SYS_KEYS.map((k) => {
        const on = !!value.sys[k];
        const cfg = SUBCFG[k];
        return (
          <div key={k} style={{ border: "1px solid #e8eaee", borderRadius: 10, padding: "10px 12px", background: on ? "color-mix(in srgb, var(--accent) 5%, #fff)" : "#fff" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 650, cursor: "pointer" }}>
              <input type="checkbox" checked={on} onChange={(e) => onChange({ sys: { ...value.sys, [k]: e.target.checked } })} style={{ accentColor: "var(--accent)" }} />
              {LABEL[k] ?? k}
            </label>
            {on && cfg && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {cfg.options.map(([optKey, optLabel]) => {
                  const current = bag[cfg.stateKey];
                  const sel = cfg.mode === "single" ? current === optKey : !!(current as Record<string, boolean> | undefined)?.[optKey];
                  const pick = () =>
                    cfg.mode === "single"
                      ? onChange({ [cfg.stateKey]: optKey } as Partial<AState>)
                      : onChange({ [cfg.stateKey]: { ...((current as Record<string, boolean>) || {}), [optKey]: !sel } } as Partial<AState>);
                  return (
                    <button key={optKey} type="button" onClick={pick} style={chip(sel)}>
                      {optLabel}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
