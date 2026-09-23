"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DIMSCHEMA,
  LIM,
  SIZES,
  VENUES,
  defaultAState,
  sizedDims,
  type AState,
  type DimField,
} from "@/app/(app)/design/quick/engine";
import { saveGridIntakeAction } from "./actions";

/**
 * Grid intake (Spec 1) — two steps before the editor opens:
 *   1. Venue type, size, dimensions (the same presets/sliders Quick Design
 *      uses; they drive the generated base sheet and the Scope targets).
 *   2. How to design it — Manual placement (enabled) or Auto-estimate
 *      (shown, disabled until Spec 2) — plus the cover-page fields.
 * Systems and tier are NOT asked here any more: systems live in the Scope
 * panel, and the base sheet is always generated from the dimensions.
 */

type Mode = "manual" | "auto";

function initialState(value?: AState): AState {
  return value ? { ...value, sys: { ...value.sys } } : defaultAState(0);
}

const input = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff" };
const section = { borderTop: "1px solid #ececf0", paddingTop: 18, marginTop: 20 };
const label = { display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase" as const, marginBottom: 7, letterSpacing: ".06em" };
const card = (on: boolean, disabled = false): React.CSSProperties => ({
  textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
  background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : disabled ? "#f7f8fa" : "#fff",
  border: `1.5px solid ${on ? "var(--accent)" : "#e8eaee"}`, opacity: disabled ? 0.6 : 1,
});
const primary = (busy: boolean): React.CSSProperties => ({ border: "none", borderRadius: 9, padding: "12px 16px", background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: busy ? "wait" : "pointer" });
const ghost: React.CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 9, padding: "12px 16px", background: "#fff", color: "#3a3f4a", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };

export default function GridIntake({
  projectId,
  projectName,
  initialAutoConfig,
}: {
  projectId: string;
  projectName: string;
  initialAutoConfig?: AState;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode>("manual");
  const [venueName, setVenueName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [a, setA] = useState<AState>(() => initialState(initialAutoConfig));
  const [error, setError] = useState("");
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const update = (patch: Partial<AState>) => setA((current) => ({ ...current, ...patch }));
  const setVenue = (key: string) => {
    const next = VENUES.find((v) => v.key === key) || VENUES[0];
    update({ venue: next.key, sys: { ...next.sys }, ...sizedDims(next, a.size) });
  };
  const setDimension = (field: DimField, raw: string) => {
    const [min, max] = LIM[field];
    const value = Math.max(min, Math.min(max, Number(raw) || min));
    update({ [field]: value } as Partial<AState>);
  };
  const save = () => startTransition(async () => {
    setError("");
    const saved = await saveGridIntakeAction({ projectId, mode: "manual", venueName, locationName, address, notes, autoConfig: a });
    if (!saved.ok) setError(saved.error);
    else router.refresh();
  });

  return <div style={{ minHeight: "100%", background: "#f7f8fa", padding: "42px 22px" }}>
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)" }}>Design · New system design · Step {step} of 2</div>
      <h1 style={{ margin: "10px 0 8px", fontSize: 30, letterSpacing: "-.025em" }}>{projectName}</h1>
      <p style={{ margin: 0, color: "#737985", fontSize: 14, lineHeight: 1.55, maxWidth: 700 }}>
        {step === 1
          ? "Venue type and measurements draw the plan sheet to scale and set the Good / Better / Best targets in the Scope panel. You can revise them later."
          : "Choose how to design this venue, then add the cover-page details."}
      </p>
      <div style={{ marginTop: 26, background: "#fff", border: "1px solid #ececf0", borderRadius: 14, padding: 22, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
        {step === 1 && <>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22 }}>
            <div>
              <div style={label}>Venue type</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {VENUES.map((item) => <button key={item.key} type="button" onClick={() => setVenue(item.key)} style={card(item.key === a.venue)}><span style={{ display: "block", fontSize: 13, fontWeight: 650 }}>{item.label}</span><span style={{ display: "block", color: "#9aa0ab", fontSize: 11, marginTop: 2 }}>{item.sub}</span></button>)}
              </div>
              <div style={section}><div style={label}>Size of venue</div><div style={{ display: "flex", gap: 8 }}>{SIZES.map(([key, text]) => <button key={key} type="button" onClick={() => update({ size: key, ...sizedDims(venue, key) })} style={{ ...card(key === a.size), flex: 1, textAlign: "center", fontWeight: 600 }}>{text}</button>)}</div></div>
            </div>
            <div>
              <div style={label}>Stage dimensions</div>
              <div style={{ display: "grid", gap: 13 }}>{(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map((d) => <label key={d.field}><span style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600 }}><span>{d.label}</span><span style={{ fontFamily: "var(--font-mono)", color: "#737985" }}>{a[d.field]} ft</span></span><span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{d.note}</span><input type="range" min={LIM[d.field][0]} max={LIM[d.field][1]} step={2} value={a[d.field]} onChange={(e) => setDimension(d.field, e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} /></label>)}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
            <button type="button" onClick={() => setStep(2)} style={primary(false)}>Next: how to design it →</button>
          </div>
        </>}

        {step === 2 && <>
          <div style={label}>How do you want to design it?</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button type="button" onClick={() => setMode("manual")} style={card(mode === "manual")}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Manual placement</span>
              <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>Start on a scaled plan and place catalog devices yourself. Scope targets track what you place.</span>
            </button>
            <button type="button" disabled aria-disabled title="Auto-estimate lands in the next release" style={card(false, true)}>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700 }}>Auto-estimate <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: "#8c919c", border: "1px solid #dfe2e8", borderRadius: 999, padding: "2px 7px" }}>NEXT RELEASE</span></span>
              <span style={{ display: "block", color: "#9aa0ab", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>Good / Better / Best generated from your measurements, refined line by line, then placed for you.</span>
            </button>
          </div>

          <div style={section}><div style={{ ...label, marginBottom: 12 }}>Venue cover page</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label><span style={label}>Location / campus</span><input value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="High School" style={input} /></label>
              <label><span style={label}>Venue / space</span><input value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="Main space" style={input} /></label>
            </div>
            <label style={{ display: "block", marginTop: 14 }}><span style={label}>Address</span><input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, state" style={input} /></label>
            <label style={{ display: "block", marginTop: 14 }}><span style={label}>Design notes</span><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Audience, stage, access, existing system notes…" style={{ ...input, minHeight: 78, resize: "vertical" }} /></label>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: "#737985" }}>{venue.label} · {a.width}&apos; × {a.depth}&apos; × {a.grid}&apos; · {a.size}</div>
          {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button type="button" onClick={() => setStep(1)} disabled={busy} style={ghost}>← Back</button>
            <button type="button" onClick={save} disabled={busy || mode !== "manual"} style={{ ...primary(busy), flex: 1 }}>{busy ? "Setting up your plan…" : "Continue to The Grid →"}</button>
          </div>
        </>}
      </div>
    </div>
  </div>;
}
