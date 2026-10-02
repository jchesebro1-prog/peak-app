"use client";

import { useMemo, useState } from "react";
import { chunkImportRows, IMPORT_CHUNK_CHARS, MAX_SHEET_BYTES, toImportRows, type PhotoSheetRow } from "@/lib/part-docs/photo-sheet";
import { linkTotals, mergeOutcomes, planCounts, resultStatuses, type PhotoSheetPlan, type SheetDocOutcome } from "@/lib/part-docs/photo-sheet-plan";
import { uploadNewDocument } from "../upload-client";
import { importPhotoSheetBatchAction, photoSheetResultsAction, planPhotoSheetAction } from "./actions";

/**
 * Photo sheet flow: pick the sheet (+ photos) → Preview (nothing written) →
 * Import (server lane in budgeted batches, then dropped files straight to
 * Blob) → summary + results sheet. Only file NAMES leave the browser until
 * Import, and only the photos the plan will use are uploaded.
 */

type Phase = "pick" | "planning" | "preview" | "importing" | "done";
const box: React.CSSProperties = { border: "1px solid #e6e8ee", borderRadius: 12, padding: 16, background: "#fff", marginBottom: 14 };
const label: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, margin: "0 0 6px" };

const msg = (e: unknown) => `The server didn't answer — try again.${e instanceof Error && e.message ? ` (${e.message})` : ""}`;

export default function PhotoSheetClient() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [sheet, setSheet] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [rows, setRows] = useState<PhotoSheetRow[]>([]);
  const [plan, setPlan] = useState<PhotoSheetPlan | null>(null);
  const [outcomes, setOutcomes] = useState<SheetDocOutcome[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const counts = useMemo(() => (plan ? planCounts(plan) : null), [plan]);
  const dropped = () => photos.map((f) => ({ name: f.name, size: f.size }));

  const preview = async () => {
    if (!sheet) return;
    if (sheet.size > MAX_SHEET_BYTES) return setError(`That sheet is over ${Math.round(MAX_SHEET_BYTES / 1024)} KB — split it into smaller sheets.`);
    setError("");
    setPhase("planning");
    const form = new FormData();
    form.set("sheet", sheet);
    form.set("dropped", JSON.stringify(dropped()));
    let r;
    try {
      r = await planPhotoSheetAction(form);
    } catch (e) {
      setError(msg(e));
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
    setPhase("preview");
  };

  const runImport = async () => {
    if (!plan) return;
    setPhase("importing");
    setError("");
    const all: SheetDocOutcome[] = [];
    const failedKeys: string[] = [];
    const chunks = chunkImportRows(toImportRows(rows), IMPORT_CHUNK_CHARS);
    // A photo shared across chunks is safe: the server re-plans each call and
    // links an already-imported photo instead of fetching it again.
    chunkLoop: for (const importRows of chunks) {
      for (;;) {
        setProgress(`Fetching linked and Drive photos… ${all.filter((o) => o.ok).length} done`);
        let r;
        try {
          r = await importPhotoSheetBatchAction({ rows: importRows, dropped: dropped(), failedKeys });
        } catch (e) {
          setError(msg(e));
          break chunkLoop;
        }
        if (!r.ok) {
          setError(r.error);
          break chunkLoop;
        }
        all.push(...r.outcomes);
        failedKeys.push(...r.outcomes.filter((o) => !o.ok).map((o) => o.key));
        setOutcomes(mergeOutcomes(all));
        if (r.remaining === 0 || r.outcomes.length === 0) break;
      }
    }
    const byName = new Map(photos.map((f) => [f.name.toLowerCase(), f] as const));
    const droppedDocs = plan.docs.filter((d) => d.via === "dropped");
    for (const [i, d] of droppedDocs.entries()) {
      if (d.via !== "dropped") continue;
      setProgress(`Uploading dropped photos… ${i + 1} of ${droppedDocs.length}`);
      const file = byName.get(d.name.toLowerCase());
      if (!file) {
        all.push({ key: d.key, ok: false, error: "the file is no longer selected" });
        continue;
      }
      const skus = [...new Set(d.links.map((l) => l.sku))];
      const primarySkus = [...new Set(d.links.filter((l) => l.primary).map((l) => l.sku))];
      try {
        const r = await uploadNewDocument(file, "image", skus, { sheet: { fileName: d.name, primarySkus } });
        all.push(r.ok ? { key: d.key, ok: true, documentId: r.documentId } : { key: d.key, ok: false, error: r.error });
      } catch (e) {
        all.push({ key: d.key, ok: false, error: e instanceof Error && e.message ? e.message : "the upload didn't finish" });
      }
      setOutcomes(mergeOutcomes(all));
    }
    setOutcomes(mergeOutcomes(all));
    setProgress("");
    setPhase("done");
  };

  const downloadResults = async () => {
    if (!sheet || !plan) return;
    const form = new FormData();
    form.set("sheet", sheet);
    form.set("statuses", JSON.stringify([...resultStatuses(plan, outcomes)]));
    let r;
    try {
      r = await photoSheetResultsAction(form);
    } catch (e) {
      return setError(msg(e));
    }
    if (!r.ok) return setError(r.error);
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = r.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setPhase("pick");
    setPlan(null);
    setRows([]);
    setOutcomes([]);
    setError("");
  };

  const { added, failed } = plan ? linkTotals(plan, outcomes) : { added: 0, failed: 0 };

  return (
    <div>
      <div style={box}>
        <span style={label}>1. Get the sheet</span>
        <a href="/catalog/documents/photos/export" className="pk-btn-outline" style={{ textDecoration: "none" }}>Download photo sheet (.xlsx)</a>
      </div>

      <div style={box}>
        <span style={label}>2. Upload it, with any photos it names</span>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ fontSize: 12.5 }}>
            Filled sheet (.xlsx or .csv)
            <br />
            <input type="file" accept=".xlsx,.csv" disabled={phase === "planning" || phase === "importing"} onChange={(e) => { setSheet(e.target.files?.[0] ?? null); reset(); }} />
          </label>
          <label style={{ fontSize: 12.5 }}>
            Photos (optional — PNG, JPEG or WebP)
            <br />
            <input type="file" accept="image/png,image/jpeg,image/webp,.heic" multiple disabled={phase === "planning" || phase === "importing"} onChange={(e) => { setPhotos([...(e.target.files ?? [])]); reset(); }} />
          </label>
          <button type="button" className="pk-btn-accent" disabled={!sheet || phase === "planning" || phase === "importing"} onClick={preview}>
            {phase === "planning" ? "Checking…" : "Preview"}
          </button>
        </div>
        {!!photos.length && <p style={{ fontSize: 12, color: "#8c919c", margin: "8px 0 0" }}>{photos.length} photo{photos.length === 1 ? "" : "s"} selected — only the ones the sheet names are uploaded.</p>}
      </div>

      {error && <div style={{ ...box, background: "#fdecec", borderColor: "#f5c2c2", color: "#a12a2a", fontSize: 13 }}>{error}</div>}

      {plan && counts && (
        <div style={box}>
          <span style={label}>3. Review</span>
          <p style={{ fontSize: 13, margin: "0 0 10px" }}>
            <b>{counts.add}</b> photo{counts.add === 1 ? "" : "s"} to add · <b>{counts.skip}</b> already attached · <b>{counts.problems}</b> problem{counts.problems === 1 ? "" : "s"} · {plan.matched} of {rows.length} rows matched a part
          </p>
          {!!plan.problems.length && (
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #eef0f4", borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#8c919c" }}>
                    <th style={{ padding: "6px 8px" }}>Row</th><th style={{ padding: "6px 8px" }}>Slot</th><th style={{ padding: "6px 8px" }}>Value</th><th style={{ padding: "6px 8px" }}>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.problems.slice(0, 300).map((p, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f2f3f6" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{p.rowNumber}</td>
                      <td style={{ padding: "5px 8px" }}>{p.slot ? `Photo ${p.slot}` : "—"}</td>
                      <td style={{ padding: "5px 8px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.value}</td>
                      <td style={{ padding: "5px 8px" }}>{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {phase === "preview" && (
            <button type="button" className="pk-btn-accent" disabled={!counts.add} onClick={runImport}>
              Import {counts.add} photo{counts.add === 1 ? "" : "s"}
            </button>
          )}
          {phase === "importing" && <p style={{ fontSize: 13, margin: 0 }}>{progress || "Importing…"}</p>}
          {phase === "done" && (
            <div>
              <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                Added <b>{added}</b> photo link{added === 1 ? "" : "s"}{failed ? <> · <b>{failed}</b> didn&apos;t land</> : null}. The results sheet has a Status for every row — fix any problems and upload it again.
              </p>
              <button type="button" className="pk-btn-outline" onClick={downloadResults}>Download results sheet</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
