"use client";

import { useState } from "react";
import type { CrosswalkRow, RenameOutcome, RenamePlan } from "@/lib/catalog-rename/plan";
import { REF_STEPS, RENAME_OUTCOME_LABEL, RENAME_STEP_LABEL, type RenameStep } from "@/lib/catalog-rename/steps";
import { MAX_SHEET_BYTES, SHEET_TOO_BIG } from "@/lib/part-docs/photo-sheet";
import { planModelNumbersAction, runModelNumbersBatchAction } from "./actions";

/**
 * #304 Model numbers flow: pick the crosswalk → Preview (nothing written) →
 * Apply (one server step per call, under the action's budget, until done).
 * A failed or unreachable call keeps the step it stopped on, so pressing the
 * same button again resumes there. The server re-plans from the sheet's rows
 * on the parts step — this preview is only what the person reviews.
 */

type Phase = "pick" | "planning" | "preview" | "running" | "done";
type Resume = { step: RenameStep; refsOnly: boolean };
const box: React.CSSProperties = { border: "1px solid #e6e8ee", borderRadius: 12, padding: 16, background: "#fff", marginBottom: 14, minWidth: 0 };
const label: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, margin: "0 0 6px" };
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "5px 8px", verticalAlign: "top", wordBreak: "break-word" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };
const UNREACHABLE = "Could not reach the server. Try again.";
/** #304: a step that returns unchanged and incomplete this many times in a row has stalled. */
const STALL_LIMIT = 3;
const NO_PROGRESS = "No progress — try again.";
/** Rows drawn in each preview table; the counts above always cover the whole sheet. */
const SHOW_ROWS = 1000;
const OUTCOMES = Object.keys(RENAME_OUTCOME_LABEL) as RenameOutcome[];

export default function ModelNumbersClient() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [sheet, setSheet] = useState<File | null>(null);
  const [rows, setRows] = useState<CrosswalkRow[]>([]);
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [stepLabel, setStepLabel] = useState("");
  const [totals, setTotals] = useState({ renamed: 0, changed: 0 });
  const [doneMode, setDoneMode] = useState<"apply" | "refs" | null>(null);
  const [error, setError] = useState("");

  const busy = phase === "planning" || phase === "running";

  const preview = async () => {
    if (!sheet) return;
    if (sheet.size > MAX_SHEET_BYTES) return setError(SHEET_TOO_BIG);
    setError("");
    setPhase("planning");
    const form = new FormData();
    form.set("sheet", sheet);
    let r;
    try {
      r = await planModelNumbersAction(form);
    } catch {
      setError(UNREACHABLE);
      setPhase("pick");
      return;
    }
    if (!r.ok) {
      setError(r.error);
      setPhase("pick");
      return;
    }
    setRows(r.rows);
    setPlan(r.plan);
    setResume(null);
    setDoneMode(null);
    setPhase("preview");
  };

  const run = async (refsOnly: boolean) => {
    const resuming = resume && resume.refsOnly === refsOnly ? resume : null;
    let step: RenameStep = resuming?.step ?? (refsOnly ? REF_STEPS[0] : "parts");
    // Only the parts step reads the sheet; the planner never needs the order # or notes.
    const sendRows = rows.map((r) => ({ ...r, mfrPart: "", notes: "" }));
    const sum = resuming ? { ...totals } : { renamed: 0, changed: 0 };
    const back: Phase = plan ? "preview" : "pick";
    setError("");
    setDoneMode(null);
    setTotals(sum);
    setPhase("running");
    // Stall guard: a step that keeps coming back unchanged and incomplete
    // (nothing written, same step) is not progressing — stop after
    // STALL_LIMIT in a row, keeping the resume point.
    let stalled = 0;
    for (;;) {
      setStepLabel(RENAME_STEP_LABEL[step]);
      let r;
      try {
        r = await runModelNumbersBatchAction({ rows: step === "parts" ? sendRows : [], step, refsOnly });
      } catch {
        setError(UNREACHABLE);
        setResume({ step, refsOnly });
        setPhase(back);
        return;
      }
      if (!r.ok) {
        setError(r.error);
        setResume({ step, refsOnly });
        setPhase(back);
        return;
      }
      sum.renamed += r.renamed;
      if (step !== "parts") sum.changed += r.changed;
      setTotals({ ...sum });
      stalled = !r.complete && r.step === step && r.changed === 0 ? stalled + 1 : 0;
      step = r.step;
      setResume({ step, refsOnly });
      if (r.complete) break;
      if (stalled >= STALL_LIMIT) {
        setError(NO_PROGRESS);
        setStepLabel("");
        setPhase(back);
        return;
      }
    }
    setResume(null);
    setStepLabel("");
    setDoneMode(refsOnly ? "refs" : "apply");
    setPhase("done");
  };

  const pick = (f: File | null) => {
    setSheet(f);
    setPlan(null);
    setRows([]);
    setResume(null);
    setDoneMode(null);
    setError("");
    setPhase("pick");
  };

  const renameRows = plan ? plan.rows.filter((r) => r.outcome === "rename") : [];
  const movesMfr = renameRows.some((r) => !!r.mfr);
  const otherRows = plan ? plan.rows.filter((r) => r.outcome !== "rename") : [];
  const n = plan?.counts.rename ?? 0;
  const applyResume = resume && !resume.refsOnly ? resume : null;
  const refsResume = resume && resume.refsOnly ? resume : null;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={box}>
        <span style={label}>1. Upload the filled crosswalk</span>
        <p style={{ fontSize: 12, color: "#8c919c", margin: "0 0 10px" }}>
          The &ldquo;Crosswalk&rdquo; sheet (or the first sheet) with Manufacturer, SKU and Model # columns. Up to 5,000 rows, 800 KB.
          An optional &ldquo;New manufacturer&rdquo; column also moves that part to the manufacturer you name.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="file" accept=".xlsx,.csv" disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} style={{ fontSize: 12.5, maxWidth: "100%" }} />
          <button type="button" className="pk-btn-accent" disabled={!sheet || busy} onClick={preview}>
            {phase === "planning" ? "Checking…" : "Preview"}
          </button>
        </div>
      </div>

      {error && <div style={{ ...box, background: "#fdecec", borderColor: "#f5c2c2", color: "#a12a2a", fontSize: 13 }}>{error}</div>}

      {plan && (
        <div style={box}>
          <span style={label}>2. Review</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
            {OUTCOMES.filter((o) => plan.counts[o] > 0).map((o) => (
              <span
                key={o}
                style={{
                  fontSize: 12,
                  padding: "3px 10px",
                  borderRadius: 999,
                  border: `1px solid ${o === "rename" ? "var(--accent)" : "#e6e8ee"}`,
                  color: o === "rename" ? "var(--accent)" : "#4b505b",
                  background: o === "rename" ? "#fff" : "#f6f7f9",
                }}
              >
                {RENAME_OUTCOME_LABEL[o]} <b style={mono}>{plan.counts[o].toLocaleString()}</b>
              </span>
            ))}
          </div>

          {renameRows.length > 0 ? (
            <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid #eef0f4", borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: "100%", minWidth: 520, fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#8c919c" }}>
                    <th style={th}>Row</th><th style={th}>Old SKU</th><th style={th}>New SKU</th><th style={th}>Model #</th>
                    {movesMfr && <th style={th}>New manufacturer</th>}
                  </tr>
                </thead>
                <tbody>
                  {renameRows.slice(0, SHOW_ROWS).map((r) => (
                    <tr key={r.row.rowNumber} style={{ borderTop: "1px solid #f2f3f6" }}>
                      <td style={{ ...td, ...mono, color: "#8c919c" }}>{r.row.rowNumber}</td>
                      <td style={{ ...td, ...mono }}>{r.from}</td>
                      <td style={{ ...td, ...mono }}>→ {r.to}</td>
                      <td style={td}>{r.model}</td>
                      {movesMfr && <td style={td}>{r.mfr ?? ""}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {renameRows.length > SHOW_ROWS && <p style={{ fontSize: 12, color: "#8c919c", margin: 8 }}>…and {(renameRows.length - SHOW_ROWS).toLocaleString()} more.</p>}
            </div>
          ) : (
            <p style={{ fontSize: 13, margin: "0 0 12px" }}>Nothing on this sheet can be renamed.</p>
          )}

          {otherRows.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ fontSize: 12.5, cursor: "pointer" }}>Not renamed ({otherRows.length.toLocaleString()})</summary>
              <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #eef0f4", borderRadius: 8, marginTop: 8 }}>
                <table style={{ width: "100%", minWidth: 480, fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#8c919c" }}>
                      <th style={th}>Row</th><th style={th}>SKU</th><th style={th}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherRows.slice(0, SHOW_ROWS).map((r) => (
                      <tr key={r.row.rowNumber} style={{ borderTop: "1px solid #f2f3f6" }}>
                        <td style={{ ...td, ...mono, color: "#8c919c" }}>{r.row.rowNumber}</td>
                        <td style={{ ...td, ...mono }}>{r.from || "—"}</td>
                        <td style={td}>{r.reason}{r.to && r.outcome !== "already" ? <> (<span style={mono}>{r.to}</span>)</> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {otherRows.length > SHOW_ROWS && <p style={{ fontSize: 12, color: "#8c919c", margin: 8 }}>…and {(otherRows.length - SHOW_ROWS).toLocaleString()} more.</p>}
              </div>
            </details>
          )}

          <button type="button" className="pk-btn-accent" disabled={busy || doneMode === "apply" || (!n && !applyResume)} onClick={() => run(false)}>
            Apply {n.toLocaleString()} rename{n === 1 ? "" : "s"}
          </button>
          {applyResume && phase !== "running" && (
            <p style={{ fontSize: 12.5, color: "#8c919c", margin: "8px 0 0" }}>Stopped at: {RENAME_STEP_LABEL[applyResume.step]}. Press Apply again to continue from there.</p>
          )}
        </div>
      )}

      {phase === "running" && (
        <div style={box}>
          <p style={{ fontSize: 13, margin: 0 }}>
            <b>{stepLabel}…</b> {totals.renamed.toLocaleString()} part{totals.renamed === 1 ? "" : "s"} renamed · {totals.changed.toLocaleString()} record{totals.changed === 1 ? "" : "s"} updated
          </p>
        </div>
      )}

      {phase === "done" && (
        <div style={box}>
          <p style={{ fontSize: 13, margin: 0 }}>
            Done. {doneMode === "apply" && <>Renamed <b>{totals.renamed.toLocaleString()}</b> part{totals.renamed === 1 ? "" : "s"} · </>}
            <b>{totals.changed.toLocaleString()}</b> record{totals.changed === 1 ? "" : "s"} updated to the new SKUs.
            {doneMode === "apply" && " Preview again to check the sheet now reads as already renamed."}
          </p>
        </div>
      )}

      <div style={box}>
        <span style={label}>Fix references</span>
        <p style={{ fontSize: 12, color: "#8c919c", margin: "0 0 10px" }}>
          Re-checks quotes, assemblies, Grid designs, documents and photos against every rename made so far and moves anything still on an old SKU. No sheet needed; safe to run any time.
        </p>
        <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => run(true)}>
          Fix references
        </button>
        {refsResume && phase !== "running" && (
          <p style={{ fontSize: 12.5, color: "#8c919c", margin: "8px 0 0" }}>Stopped at: {RENAME_STEP_LABEL[refsResume.step]}. Press Fix references again to continue from there.</p>
        )}
      </div>
    </div>
  );
}
