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
  venueOf,
  type AState,
  type DimField,
} from "@/app/(app)/design/quick/engine";
import { intakeScopeInputs } from "@/lib/design/grid-intake";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import { saveGridIntakeAction } from "./actions";
import ScopePicker from "./scope-picker";
import { EquipmentCards, useAutoPreview } from "./equipment-card";

/**
 * The one Grid intake (#GEM, spec §5 — replaces Spec 1's Manual-only intake):
 *   1. Start from — Auto (equations) or Blank.
 *   2. Venue — type, size, dimensions, scopes (the five Grid scopes with their
 *      sub-configuration), cover-page fields.
 *   3. (Auto only) Equipment — per scope Good / Better / Best, swaps, qty.
 * Blank opens the canvas on the generated base sheet; Auto also fills it.
 * Everything lands as ordinary, fully editable placements.
 */

type Start = "auto" | "blank";

function initialState(value?: AState): AState {
  if (value) return { ...value, sys: { ...value.sys } };
  const base = defaultAState(0);
  return { ...base, sys: { ...venueOf(base).sys } };
}

const input = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff" };
const section = { borderTop: "1px solid #ececf0", paddingTop: 18, marginTop: 20 };
const label = { display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase" as const, marginBottom: 7, letterSpacing: ".06em" };
const card = (on: boolean): React.CSSProperties => ({
  textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: "pointer",
  background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
  border: `1.5px solid ${on ? "var(--accent)" : "#e8eaee"}`,
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [start, setStart] = useState<Start>("auto");
  const [venueName, setVenueName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [a, setA] = useState<AState>(() => initialState(initialAutoConfig));
  const [estimate, setEstimate] = useState<AutoEstimate>({ tierByScope: {}, overrides: {} });
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const preview = useAutoPreview();
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const scopeInputs = intakeScopeInputs(a);
  const chosen = TRACKABLE_SYS_KEYS.filter((k) => scopeInputs.sys[k]);
  const steps = start === "auto" ? 3 : 2;

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
  const changeEstimate = (next: AutoEstimate, delay = 0) => {
    setEstimate(next);
    preview.run(scopeInputs, next, delay);
  };
  const save = () =>
    startTransition(async () => {
      setError("");
      const saved = await saveGridIntakeAction({
        projectId,
        mode: start === "auto" ? "auto" : "manual",
        venueName,
        locationName,
        address,
        notes,
        autoConfig: a,
        ...(start === "auto" ? { estimate } : {}),
      });
      if (!saved.ok) setError(saved.error);
      else if (saved.warning) setWarning(saved.warning);
      else router.refresh();
    });
  const nextFromVenue = () => {
    setError("");
    if (!venueName.trim() && !locationName.trim()) return setError("Add a venue or location to continue.");
    if (start === "blank") return save();
    if (!chosen.length) return setError("Pick at least one scope for Auto to fill.");
    const est: AutoEstimate = {
      tierByScope: Object.fromEntries(chosen.map((k) => [k, estimate.tierByScope[k] ?? "better"])),
      overrides: estimate.overrides,
    };
    setEstimate(est);
    preview.run(scopeInputs, est);
    setStep(3);
  };

  const subtitle =
    step === 1
      ? "Start from the equations (Auto) or a blank plan. Either way you end up on the canvas, free to move, edit and delete anything."
      : step === 2
        ? "Venue type and measurements draw the plan sheet to scale; the scopes set what Auto fills and what the Scope panel tracks."
        : "Pick Good / Better / Best per scope. Swap any part for a catalog part or an assembly, and adjust quantities.";

  return (
    <div style={{ minHeight: "100%", background: "#f7f8fa", padding: "42px 22px" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)" }}>
          Design · New system design · Step {step} of {steps}
        </div>
        <h1 style={{ margin: "10px 0 8px", fontSize: 30, letterSpacing: "-.025em" }}>{projectName}</h1>
        <p style={{ margin: 0, color: "#737985", fontSize: 14, lineHeight: 1.55, maxWidth: 720 }}>{subtitle}</p>
        <div style={{ marginTop: 26, background: "#fff", border: "1px solid #ececf0", borderRadius: 14, padding: 22, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
          {step === 1 && (
            <>
              <div style={label}>Start from</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button type="button" onClick={() => setStart("auto")} style={card(start === "auto")}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Auto (equations)</span>
                  <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                    Good / Better / Best equipment per scope from the Equipment map, sized by your measurements and placed on the plan for you.
                  </span>
                </button>
                <button type="button" onClick={() => setStart("blank")} style={card(start === "blank")}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Blank</span>
                  <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                    Start on the scaled plan and place catalog devices yourself. The Scope panel tracks placed $ against targets.
                  </span>
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
                <button type="button" onClick={() => setStep(2)} style={primary(false)}>Next: the venue →</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22 }}>
                <div>
                  <div style={label}>Venue type</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {VENUES.map((item) => (
                      <button key={item.key} type="button" onClick={() => setVenue(item.key)} style={card(item.key === a.venue)}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 650 }}>{item.label}</span>
                        <span style={{ display: "block", color: "#9aa0ab", fontSize: 11, marginTop: 2 }}>{item.sub}</span>
                      </button>
                    ))}
                  </div>
                  <div style={section}>
                    <div style={label}>Size of venue</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {SIZES.map(([key, text]) => (
                        <button key={key} type="button" onClick={() => update({ size: key, ...sizedDims(venue, key) })} style={{ ...card(key === a.size), flex: 1, textAlign: "center", fontWeight: 600 }}>
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={section}>
                    <div style={label}>Scopes</div>
                    <ScopePicker value={a} onChange={update} />
                  </div>
                </div>
                <div>
                  <div style={label}>Stage dimensions</div>
                  <div style={{ display: "grid", gap: 13 }}>
                    {(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map((d) => (
                      <label key={d.field}>
                        <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600 }}>
                          <span>{d.label}</span>
                          <span style={{ fontFamily: "var(--font-mono)", color: "#737985" }}>{a[d.field]} ft</span>
                        </span>
                        <span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{d.note}</span>
                        <input type="range" min={LIM[d.field][0]} max={LIM[d.field][1]} step={2} value={a[d.field]} onChange={(e) => setDimension(d.field, e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
                      </label>
                    ))}
                  </div>
                  <div style={section}>
                    <div style={{ ...label, marginBottom: 12 }}>Venue cover page</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <label><span style={label}>Location / campus</span><input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="High School" style={input} /></label>
                      <label><span style={label}>Venue / space</span><input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Main space" style={input} /></label>
                    </div>
                    <label style={{ display: "block", marginTop: 14 }}><span style={label}>Address</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, state" style={input} /></label>
                    <label style={{ display: "block", marginTop: 14 }}><span style={label}>Design notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Audience, stage, access, existing system notes…" style={{ ...input, minHeight: 78, resize: "vertical" }} /></label>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "#737985" }}>
                {venue.label} · {a.width}&apos; × {a.depth}&apos; × {a.grid}&apos; · {a.size} · {chosen.length} scope{chosen.length === 1 ? "" : "s"}
              </div>
              {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                <button type="button" onClick={() => setStep(1)} disabled={busy} style={ghost}>← Back</button>
                <button type="button" onClick={nextFromVenue} disabled={busy} style={{ ...primary(busy), flex: 1 }}>
                  {start === "auto" ? "Next: equipment →" : busy ? "Setting up your plan…" : "Continue to The Grid →"}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <EquipmentCards cards={preview.cards} estimate={estimate} onChange={changeEstimate} loading={preview.loading} error={preview.error} />
              {preview.error && !preview.loading && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => preview.run(scopeInputs, estimate)} style={ghost}>
                    Retry
                  </button>
                </div>
              )}
              {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
              {warning ? (
                <div style={{ marginTop: 16, border: "1px solid #f0dcbb", background: "#fdf4e7", borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: "#7a5a1c" }}>
                  {warning}
                  <div style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => router.refresh()} style={primary(false)}>Open the plan →</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                  <button type="button" onClick={() => setStep(2)} disabled={busy} style={ghost}>← Back</button>
                  <button type="button" onClick={save} disabled={busy || !preview.cards} style={{ ...primary(busy), flex: 1 }}>
                    {busy ? "Building your plan…" : "Build the plan →"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
