"use client";

import { useState } from "react";
import {
  saveConsultingAssumptionsAction,
  saveConsultingDisciplinesAction,
  saveConsultingPhasesAction,
  saveConsultingPhaseWeightsAction,
} from "../actions";
import { inputStyle, type Run } from "./shared";

/**
 * Settings → Consulting (settings cleanup): the phase menu (+ phase weights),
 * the discipline vocabulary and the assumptions library. Cards moved verbatim
 * from the old settings-client.tsx Company section.
 */
export function ConsultingGroup({
  consultingPhases,
  consultingAssumptions,
  phaseWeights,
  consultingDisciplines,
  run,
}: {
  consultingPhases: string[];
  consultingAssumptions: string[];
  /** #145 D165/D166 — one weight per CURRENT phase. */
  phaseWeights: Array<{ phaseId: string; name: string; weight: number }>;
  /** #145 D165 — the discipline vocabulary (mergedConsultingDisciplines). */
  consultingDisciplines: string[];
  run: Run;
}) {
  /* ---- consulting phase menu (D90, one phase per line) ---- */
  const [phasesDraft, setPhasesDraft] = useState(consultingPhases.join("\n"));
  const [phasesDirty, setPhasesDirty] = useState(false);
  const [phasesSaved, setPhasesSaved] = useState(false);
  const savePhases = () =>
    run(async () => {
      const res = await saveConsultingPhasesAction(
        phasesDraft
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (res.ok) {
        setPhasesDirty(false);
        setPhasesSaved(true);
      }
      return res;
    });
  /* ---- consulting assumptions library (#35, one per line) ---- */
  const [assumpDraft, setAssumpDraft] = useState(consultingAssumptions.join("\n"));
  const [assumpDirty, setAssumpDirty] = useState(false);
  const [assumpSaved, setAssumpSaved] = useState(false);
  const saveAssumptions = () =>
    run(async () => {
      const res = await saveConsultingAssumptionsAction(
        assumpDraft
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (res.ok) {
        setAssumpDirty(false);
        setAssumpSaved(true);
      }
      return res;
    });
  /* ---- consulting phase weights (#145 D165/D166) — one number input per
     CURRENT phase, keyed by phase NAME; full replacement on save. */
  const [weightsDraft, setWeightsDraft] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    phaseWeights.forEach((w) => {
      o[w.name] = String(w.weight);
    });
    return o;
  });
  const [weightsDirty, setWeightsDirty] = useState(false);
  const [weightsSaved, setWeightsSaved] = useState(false);
  const setWeight = (name: string, value: string) => {
    setWeightsDraft((d) => ({ ...d, [name]: value }));
    setWeightsDirty(true);
    setWeightsSaved(false);
  };
  const saveWeights = () =>
    run(async () => {
      const payload: Record<string, number> = {};
      phaseWeights.forEach((w) => {
        const n = Number(weightsDraft[w.name]);
        payload[w.name] = Number.isFinite(n) && n > 0 ? n : 1;
      });
      const res = await saveConsultingPhaseWeightsAction(payload);
      if (res.ok) {
        setWeightsDirty(false);
        setWeightsSaved(true);
      }
      return res;
    });
  /* ---- consulting discipline vocabulary (#145 D165, one per line) ---- */
  const [disciplinesDraft, setDisciplinesDraft] = useState(consultingDisciplines.join("\n"));
  const [disciplinesDirty, setDisciplinesDirty] = useState(false);
  const [disciplinesSaved, setDisciplinesSaved] = useState(false);
  const saveDisciplines = () =>
    run(async () => {
      const res = await saveConsultingDisciplinesAction(
        disciplinesDraft
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (res.ok) {
        setDisciplinesDirty(false);
        setDisciplinesSaved(true);
      }
      return res;
    });

  return (
    <>
      {/* ---- Consulting phase menu (D90) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Consulting — phase menu</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The phases offered when building a consulting quote and on the
              engagement’s Phases tab. One per line — engagements pick any
              mix, so keep these generic.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {phasesSaved && !phasesDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={savePhases}
              disabled={!phasesDirty}
              style={{ opacity: phasesDirty ? 1 : 0.5, cursor: phasesDirty ? "pointer" : "default" }}
            >
              Save phases
            </button>
          </div>
        </div>
        <textarea
          value={phasesDraft}
          onChange={(e) => {
            setPhasesDraft(e.target.value);
            setPhasesDirty(true);
            setPhasesSaved(false);
          }}
          spellCheck={false}
          style={{
            ...inputStyle,
            marginTop: 14,
            minHeight: 130,
            maxWidth: 420,
            resize: "vertical",
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
          }}
        />

        {/* ---- phase weights (#145 D165/D166) — beside the phase list: one
            number input per CURRENT phase, sizing its proportional window
            in the scheduling engine. Renaming a phase above needs a Save
            there first; this row always reflects the saved phase list. ---- */}
        <div style={{ marginTop: 20, borderTop: "1px solid #f0f1f4", paddingTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Phase weights</div>
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
                Relative size of each phase&rsquo;s window when a template&rsquo;s
                schedule is generated. A phase left at 1 gets an equal share;
                a heavier phase gets a longer window.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {weightsSaved && !weightsDirty && (
                <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
              )}
              <button
                className="pk-btn-accent"
                onClick={saveWeights}
                disabled={!weightsDirty}
                style={{ opacity: weightsDirty ? 1 : 0.5, cursor: weightsDirty ? "pointer" : "default" }}
              >
                Save weights
              </button>
            </div>
          </div>
          {phaseWeights.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#9aa0ab", marginTop: 10 }}>
              Add at least one phase above to set weights.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, marginTop: 12, maxWidth: 420 }}>
              {phaseWeights.map((w) => (
                <div key={w.phaseId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 13, color: "#3a3f4a" }}>{w.name}</span>
                  <input
                    type="number"
                    min={0.01}
                    step="0.1"
                    value={weightsDraft[w.name] ?? "1"}
                    onChange={(e) => setWeight(w.name, e.target.value)}
                    style={{ ...inputStyle, width: 90, padding: "7px 9px", fontSize: 13 }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- Consulting disciplines (#145 D165) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Consulting — disciplines</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The disciplines offered as a checkbox row when building a
              consulting quote. A template line naming one of these only
              expands for an engagement that bought it; a blank line matches
              every discipline. One per line.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {disciplinesSaved && !disciplinesDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={saveDisciplines}
              disabled={!disciplinesDirty}
              style={{ opacity: disciplinesDirty ? 1 : 0.5, cursor: disciplinesDirty ? "pointer" : "default" }}
            >
              Save disciplines
            </button>
          </div>
        </div>
        <textarea
          value={disciplinesDraft}
          onChange={(e) => {
            setDisciplinesDraft(e.target.value);
            setDisciplinesDirty(true);
            setDisciplinesSaved(false);
          }}
          spellCheck={false}
          style={{
            ...inputStyle,
            marginTop: 14,
            minHeight: 100,
            maxWidth: 420,
            resize: "vertical",
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
          }}
        />
      </section>

      {/* ---- Consulting assumptions library (#35) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Consulting — assumptions library</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The standard assumptions offered as a checklist when building a
              consulting proposal. One per line; the lines TICKED on a
              proposal print on its letter. Draft seed — replace with the
              lines from Peak&rsquo;s real consulting letter.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {assumpSaved && !assumpDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={saveAssumptions}
              disabled={!assumpDirty}
              style={{ opacity: assumpDirty ? 1 : 0.5, cursor: assumpDirty ? "pointer" : "default" }}
            >
              Save assumptions
            </button>
          </div>
        </div>
        <textarea
          value={assumpDraft}
          onChange={(e) => {
            setAssumpDraft(e.target.value);
            setAssumpDirty(true);
            setAssumpSaved(false);
          }}
          spellCheck={false}
          style={{
            ...inputStyle,
            marginTop: 14,
            minHeight: 170,
            maxWidth: 640,
            resize: "vertical",
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
          }}
        />
      </section>
    </>
  );
}
