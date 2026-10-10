"use client";

import { useMemo, useState } from "react";
import { MAX_RISER_SHEET_BYTES, RISER_SHEET_TOO_BIG, type RiserPreview } from "@/lib/riser-data-preview";
import { applyRiserDataBatchAction, previewRiserDataAction } from "./actions";

/**
 * Riser data flow: pick the filled .xlsx → Preview (nothing written) → Apply
 * (server batches under a 45 s budget until nothing remains) → summary. The
 * sheet is re-sent on every call; the server re-plans against the live catalog.
 */

type Phase = "pick" | "planning" | "preview" | "applying" | "done";
const box: React.CSSProperties = { border: "1px solid #e6e8ee", borderRadius: 12, padding: 16, background: "#fff", marginBottom: 14 };
const th: React.CSSProperties = { padding: "4px 8px" };
const td: React.CSSProperties = { padding: "5px 8px", verticalAlign: "top" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)" };
const msg = (e: unknown) => `The server didn't answer — try again.${e instanceof Error && e.message ? ` (${e.message})` : ""}`;

type Outcome = { applied: number; failed: { sku: string; error: string }[] };

export default function RiserDataClient() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [sheet, setSheet] = useState<File | null>(null);
  const [preview, setPreview] = useState<RiserPreview | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const form = () => {
    const f = new FormData();
    if (sheet) f.set("sheet", sheet);
    return f;
  };

  const onFile = (file: File | undefined) => {
    setPhase("pick");
    setPreview(null);
    setOutcome(null);
    setError("");
    setShowUnchanged(false);
    if (file && file.size > MAX_RISER_SHEET_BYTES) {
      setSheet(null);
      setError(RISER_SHEET_TOO_BIG);
      return;
    }
    setSheet(file ?? null);
  };

  const runPreview = async () => {
    if (!sheet) return;
    setError("");
    setPhase("planning");
    try {
      const r = await previewRiserDataAction(form());
      if (!r.ok) {
        setError(r.error);
        setPhase("pick");
        return;
      }
      setPreview(r.preview);
      setPhase("preview");
    } catch (e) {
      setError(msg(e));
      setPhase("pick");
    }
  };

  const runApply = async () => {
    if (!sheet) return;
    setError("");
    setPhase("applying");
    let applied = 0;
    const failed: Outcome["failed"] = [];
    for (;;) {
      setProgress(`Saving parts… ${applied} done`);
      const f = form();
      f.set("failedSkus", JSON.stringify(failed.map((x) => x.sku)));
      let r;
      try {
        r = await applyRiserDataBatchAction(f);
      } catch (e) {
        setError(msg(e));
        break;
      }
      if (!r.ok) {
        setError(r.error);
        break;
      }
      applied += r.applied;
      failed.push(...r.failed);
      if (r.remaining === 0 || (r.applied === 0 && r.failed.length === 0)) break;
    }
    setOutcome({ applied, failed });
    setProgress("");
    setPhase("done");
  };

  const counts = useMemo(
    () =>
      preview
        ? { changed: preview.changed.length, unchanged: preview.unchanged.length, unknown: preview.unknown.length, errors: preview.errors.length }
        : null,
    [preview]
  );
  const busy = phase === "planning" || phase === "applying";

  return (
    <div>
      <div style={box}>
        <label htmlFor="riser-sheet" style={{ display: "block", fontSize: 12.5, fontWeight: 600, margin: "0 0 6px" }}>Filled sheet (.xlsx)</label>
        <input id="riser-sheet" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="pk-btn-outline" disabled={!sheet || busy} onClick={() => void runPreview()}>
            {phase === "planning" ? "Reading…" : "Preview"}
          </button>
          <button type="button" className="pk-btn-accent" disabled={phase !== "preview" || !counts || counts.changed === 0} onClick={() => void runApply()}>
            {phase === "applying" ? "Applying…" : counts && counts.changed ? `Apply ${counts.changed} part${counts.changed === 1 ? "" : "s"}` : "Apply"}
          </button>
        </div>
        {progress && <p style={{ color: "#5d6472", fontSize: 12.5, margin: "10px 0 0" }}>{progress}</p>}
        {error && <p role="alert" style={{ color: "#b3261e", fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>}
      </div>

      {preview && phase !== "done" && (
        <div style={box}>
          {preview.notes.length > 0 && (
            <div role="note" style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 9, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
              {preview.notes.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
            {counts!.changed} part{counts!.changed === 1 ? "" : "s"} will change · {counts!.unchanged} unchanged
            {counts!.unknown > 0 && ` · ${counts!.unknown} unknown SKU`}
            {counts!.errors > 0 && ` · ${counts!.errors} refused`}
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>
            {sheet?.name} · Preview only — nothing has been saved yet.
            {counts!.errors + counts!.unknown > 0 && " Refused and unknown rows write nothing; Apply saves the rest."}
          </div>
          {counts!.unchanged > 0 && (
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 10 }}>
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
              Show unchanged ({counts!.unchanged})
            </label>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#8c919c" }}>
                  <th style={th}>Row</th>
                  <th style={th}>Part</th>
                  <th style={th}>SKU</th>
                  <th style={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.errors.map((e, i) => (
                  <tr key={`e${i}`} style={{ borderTop: "1px solid #eef0f4" }}>
                    <td style={{ ...td, ...mono }}>{e.row}</td>
                    <td style={td}>{e.tab === "Cables" ? <TabTag /> : "—"}</td>
                    <td style={td}>—</td>
                    <td style={td}>
                      <Chip bg="#fbe6e6" fg="#b3261e">Refused</Chip> <span style={{ color: "#5d6472" }}>{e.message}</span>
                    </td>
                  </tr>
                ))}
                {preview.unknown.map((u, i) => (
                  <tr key={`u${i}`} style={{ borderTop: "1px solid #eef0f4" }}>
                    <td style={{ ...td, ...mono }}>{u.row}</td>
                    <td style={td}>{u.tab === "Cables" ? <TabTag /> : "—"}</td>
                    <td style={{ ...td, ...mono }}>{u.sku}</td>
                    <td style={td}>
                      <Chip bg="#fdf3df" fg="#9a6b12">Unknown SKU</Chip> <span style={{ color: "#5d6472" }}>Not in the catalog.</span>
                    </td>
                  </tr>
                ))}
                {preview.changed.map((c) => (
                  <tr key={`c${c.tab}${c.row}`} style={{ borderTop: "1px solid #eef0f4" }}>
                    <td style={{ ...td, ...mono }}>{c.row}</td>
                    <td style={td}>{c.label}{c.tab === "Cables" && <> <TabTag /></>}</td>
                    <td style={{ ...td, ...mono }}>
                      {c.sku}
                      {c.renamedTo && <div style={{ color: "#8c919c" }}>→ {c.renamedTo}</div>}
                    </td>
                    <td style={td}>
                      {c.changes.map((f) => (
                        <div key={f.label}>
                          <span style={{ color: "#5d6472" }}>{f.label}:</span> <span style={mono}>{f.from || "—"}</span> → <span style={{ ...mono, fontWeight: 600 }}>{f.to || "cleared"}</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
                {showUnchanged &&
                  preview.unchanged.map((u, i) => (
                    <tr key={`n${i}`} style={{ borderTop: "1px solid #eef0f4", color: "#8c919c" }}>
                      <td style={{ ...td, ...mono }}>{u.row}</td>
                      <td style={td}>{u.label}{u.tab === "Cables" && <> <TabTag /></>}</td>
                      <td style={{ ...td, ...mono }}>{u.sku}{u.renamedTo && <div>→ {u.renamedTo}</div>}</td>
                      <td style={td}><Chip bg="#eef0f4" fg="#5d6472">No change</Chip></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {phase === "done" && outcome && (
        <div style={box}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
            Applied {outcome.applied} part{outcome.applied === 1 ? "" : "s"}
            {outcome.failed.length > 0 && ` · ${outcome.failed.length} failed`}
            {preview && preview.errors.length + preview.unknown.length > 0 && ` · ${preview.errors.length + preview.unknown.length} row${preview.errors.length + preview.unknown.length === 1 ? "" : "s"} refused or unknown (nothing written)`}
          </div>
          <div style={{ fontSize: 12, color: "#8c919c" }}>Only the designator code, riser tag defaults and cable outside diameters were saved. Upload again to see the parts as they are now.</div>
          {outcome.failed.map((f) => (
            <p key={f.sku} style={{ color: "#b3261e", fontSize: 12.5, margin: "8px 0 0" }}>
              <span style={mono}>{f.sku}</span> — {f.error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function TabTag() {
  return <span style={{ ...mono, fontSize: 10.5, color: "#5d6472", background: "#eef0f4", borderRadius: 4, padding: "1px 5px" }}>Cables</span>;
}

function Chip({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 600 }}>{children}</span>;
}
