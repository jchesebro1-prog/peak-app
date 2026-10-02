"use client";

import { useState } from "react";
import { readCsvFile } from "@/app/(app)/estimator/material-csv";
import { rackImportSummary, type RackImportResult, type RackImportStatus } from "@/lib/rack/part-facts-sheet";
import { applyRackDataAction, previewRackDataAction } from "./actions";

/**
 * Rack data sheet flow: pick the CSV → Preview (nothing written) → Import.
 * The file is read here as text (Excel's UTF-16 and Windows-1252 saves
 * included) and sent as one string.
 */

type Phase = "pick" | "working" | "preview" | "done";
const box: React.CSSProperties = { border: "1px solid #e6e8ee", borderRadius: 12, padding: 16, background: "#fff", marginBottom: 14 };
const STATUS_LABEL: Record<RackImportStatus, string> = { updated: "Will update", unchanged: "No change", "unknown-sku": "Unknown SKU", invalid: "Invalid" };
const STATUS_LABEL_DONE: Record<RackImportStatus, string> = { updated: "Updated", unchanged: "No change", "unknown-sku": "Unknown SKU", invalid: "Invalid" };
const CHIP: Record<RackImportStatus, { bg: string; fg: string }> = {
  updated: { bg: "#e4f4ea", fg: "#1f7a43" },
  unchanged: { bg: "#eef0f4", fg: "#5d6472" },
  "unknown-sku": { bg: "#fdf3df", fg: "#9a6b12" },
  invalid: { bg: "#fbe6e6", fg: "#b3261e" },
};
const msg = (e: unknown) => `The server didn't answer — try again.${e instanceof Error && e.message ? ` (${e.message})` : ""}`;

export default function RackDataClient() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<RackImportResult[]>([]);
  const [error, setError] = useState("");

  const reset = () => {
    setPhase("pick");
    setResults([]);
    setError("");
  };

  const onFile = async (file: File | undefined) => {
    reset();
    setText("");
    setFileName("");
    if (!file) return;
    try {
      setText(await readCsvFile(file));
      setFileName(file.name);
    } catch {
      setError("That file couldn't be read.");
    }
  };

  const run = async (kind: "preview" | "import") => {
    setError("");
    setPhase("working");
    try {
      const r = kind === "preview" ? await previewRackDataAction(text) : await applyRackDataAction(text);
      if (!r.ok) {
        setError(r.error);
        setPhase(kind === "preview" ? "pick" : "preview");
        return;
      }
      setResults(r.results);
      setPhase(kind === "preview" ? "preview" : "done");
    } catch (e) {
      setError(msg(e));
      setPhase(kind === "preview" ? "pick" : "preview");
    }
  };

  const invalid = results.filter((r) => r.status === "invalid").length;
  const updates = results.filter((r) => r.status === "updated").length;
  const canImport = phase === "preview" && invalid === 0 && updates > 0;
  const labels = phase === "done" ? STATUS_LABEL_DONE : STATUS_LABEL;

  return (
    <div>
      <div style={box}>
        <label htmlFor="rack-sheet" style={{ display: "block", fontSize: 12.5, fontWeight: 600, margin: "0 0 6px" }}>Filled sheet (.csv)</label>
        <input id="rack-sheet" type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} disabled={phase === "working"} />
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="pk-btn-outline" disabled={!text || phase === "working"} onClick={() => void run("preview")}>
            {phase === "working" ? "Working…" : "Preview"}
          </button>
          <button type="button" className="pk-btn-accent" disabled={!canImport} onClick={() => void run("import")}>Import</button>
        </div>
        {error && <p role="alert" style={{ color: "#b3261e", fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>}
        {phase === "preview" && invalid > 0 && (
          <p style={{ color: "#b3261e", fontSize: 12.5, margin: "10px 0 0" }}>
            Fix the invalid rows in the sheet and upload it again — Import stays off until every row is valid.
          </p>
        )}
        {phase === "preview" && invalid === 0 && updates === 0 && results.length > 0 && (
          <p style={{ color: "#8c919c", fontSize: 12.5, margin: "10px 0 0" }}>Nothing in this sheet would change a part.</p>
        )}
      </div>

      {(phase === "preview" || phase === "done") && (
        <div style={box}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{rackImportSummary(results)}</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>
            {fileName} · {phase === "done" ? "Imported. Blank cells left saved values alone." : "Preview only — nothing has been saved yet."}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#8c919c" }}>
                  <th style={{ padding: "4px 8px" }}>Line</th>
                  <th style={{ padding: "4px 8px" }}>SKU</th>
                  <th style={{ padding: "4px 8px" }}>Result</th>
                  <th style={{ padding: "4px 8px" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={`${r.line}-${i}`} style={{ borderTop: "1px solid #eef0f4" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono, monospace)" }}>{r.line}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono, monospace)" }}>{r.sku || "—"}</td>
                    <td style={{ padding: "5px 8px" }}>
                      <span style={{ background: CHIP[r.status].bg, color: CHIP[r.status].fg, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 600 }}>{labels[r.status]}</span>
                    </td>
                    <td style={{ padding: "5px 8px", color: "#5d6472" }}>{r.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
