"use client";

import { useRef, useState } from "react";
import { addBtnStyle, ConfigModal, FIELD, LBL } from "./est-ui";
import { parseSpecItemsCsv, specItemTemplateCsv, type ParsedSpecCsv } from "./csv-import";
import type { SpecSection } from "./types";

const NEW_SECTION = "__new__";

/**
 * Bulk-import estimate line items from a CSV file or paste (punch #93a).
 * Rows whose Category column matches an EXISTING system name (case-
 * insensitive) route there; everything else lands in the chosen target
 * system, which can be an existing one or a new one named on the spot.
 * Deliberately does NOT auto-create a section per unrecognized category
 * value — free-text category columns are noisy, and silently multiplying
 * systems from typos would be worse than routing to one predictable target.
 */
export default function CsvImportModal({
  sections,
  defaultTargetId,
  onImport,
  onClose,
}: {
  sections: SpecSection[];
  defaultTargetId: string | null;
  onImport: (parsed: ParsedSpecCsv, targetSectionId: string, newSectionName: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSpecCsv | null>(null);
  const [target, setTarget] = useState<string>(defaultTargetId || NEW_SECTION);
  const [newName, setNewName] = useState("Imported Items");
  const fileInput = useRef<HTMLInputElement | null>(null);

  const runParse = (raw: string) => {
    setText(raw);
    setParsed(raw.trim() ? parseSpecItemsCsv(raw) : null);
  };

  const onFile = (f: File) => {
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => runParse(String(reader.result || ""));
    reader.readAsText(f);
  };

  const downloadTemplate = () => {
    const blob = new Blob([specItemTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "estimate-line-items-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = parsed?.ok ? parsed.stats.valid : 0;
  const canImport = parsed?.ok === true && validCount > 0;

  return (
    <ConfigModal
      width={680}
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
        </svg>
      }
      title="Import CSV"
      sub="Bulk-add line items from a spreadsheet"
      onClose={onClose}
      footerLeft={
        <span style={{ fontSize: 11.5, color: "#8c919c" }}>
          {parsed?.ok
            ? `${parsed.stats.total} row${parsed.stats.total === 1 ? "" : "s"} · ${validCount} ready` +
              (parsed.stats.invalid ? ` · ${parsed.stats.invalid} skipped (no description)` : "")
            : parsed && !parsed.ok
              ? parsed.error
              : "Only Description is required — leave Cost/Price blank to price later."}
        </span>
      }
      footerRight={
        <button
          type="button"
          disabled={!canImport}
          onClick={() => parsed?.ok && onImport(parsed, target, newName)}
          style={addBtnStyle(canImport)}
        >
          Import {validCount || ""} item{validCount === 1 ? "" : "s"}
        </button>
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <label style={{ ...LBL, marginBottom: 0 }}>1. Get the format right</label>
        <button
          type="button"
          onClick={downloadTemplate}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            padding: "7px 12px",
            border: "1px solid #e4e7ec",
            background: "#fff",
            color: "#5b616e",
            cursor: "pointer",
          }}
        >
          ↓ Download example CSV
        </button>
      </div>

      <label style={LBL}>2. Upload or paste</label>
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 8,
            padding: "8px 13px",
            border: "1px solid #e4e7ec",
            background: "#fff",
            color: "#5b616e",
            cursor: "pointer",
          }}
        >
          Choose file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        {fileName && <span style={{ fontSize: 12, color: "#8c919c", alignSelf: "center" }}>{fileName}</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setFileName(null);
          runParse(e.target.value);
        }}
        placeholder="…or paste CSV/TSV text here, header row first"
        rows={4}
        style={{ ...FIELD, fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical", marginBottom: 16 }}
      />

      <label style={LBL}>3. Where do items with no matching category go?</label>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={{ ...FIELD, flex: 1 }}
        >
          <option value={NEW_SECTION}>+ New system…</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {target === NEW_SECTION && (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New system name"
            style={{ ...FIELD, flex: 1 }}
          />
        )}
      </div>

      {parsed?.ok && parsed.rows.length > 0 && (
        <>
          <label style={LBL}>Preview</label>
          <div style={{ border: "1px solid #ececf0", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#fafbfc", position: "sticky", top: 0 }}>
                    {["Category", "SKU", "Description", "Qty", "Unit", "Cost", "Price"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "7px 10px",
                          fontSize: 10.5,
                          color: "#9aa0ab",
                          textTransform: "uppercase",
                          letterSpacing: ".03em",
                          borderBottom: "1px solid #ececf0",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 25).map((r, i) => (
                    <tr key={i} style={{ opacity: r.valid ? 1 : 0.5 }}>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f4f5f7" }}>{r.category}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f4f5f7", fontFamily: "var(--font-mono)" }}>{r.sku}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f4f5f7" }}>
                        {r.desc || <span style={{ color: "#c0464b" }}>missing description</span>}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f4f5f7", fontFamily: "var(--font-mono)" }}>{r.qty || 1}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f4f5f7" }}>{r.unit || "ea"}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f4f5f7", fontFamily: "var(--font-mono)" }}>{r.cost || "—"}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f4f5f7", fontFamily: "var(--font-mono)" }}>{r.price || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {parsed.rows.length > 25 && (
            <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 6 }}>
              +{parsed.rows.length - 25} more row{parsed.rows.length - 25 === 1 ? "" : "s"} not shown in the preview.
            </div>
          )}
        </>
      )}
    </ConfigModal>
  );
}
