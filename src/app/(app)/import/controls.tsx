"use client";

import { useState } from "react";
import { autoMap, parseCsv, prepareRows, type FieldDef } from "./parse";
import { importRecords } from "./actions";

/**
 * Paste → live preview → confirm, the client leaf of the import flow. It parses
 * the pasted text locally only to render the preview + stats; the authoritative
 * write re-parses the same text server-side in `importRecords`. An `.xlsx` file
 * picker posts to `/api/import/xlsx`, which converts the file to CSV server-side,
 * and the result lands in the same `text` state the textarea binds to — so it
 * funnels through this same paste flow unchanged.
 */
export function PastePreview({
  typeKey,
  fields,
  dedupeLabel,
  accent,
}: {
  typeKey: string;
  fields: FieldDef[];
  dedupeLabel: string;
  accent: string;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"skip" | "update" | "create">("skip");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [uploadNote, setUploadNote] = useState("");

  const trimmed = text.trim();
  const parsed = trimmed ? parseCsv(text) : null;
  const mapping = parsed && parsed.ok ? autoMap(parsed.headers, fields) : null;
  const prep = parsed && parsed.ok && mapping ? prepareRows(parsed.rows, mapping, fields) : null;

  const mappedFields = mapping
    ? fields.filter((f) => mapping[f.key] != null && mapping[f.key] >= 0)
    : [];
  const reqMissing = mapping
    ? fields.filter((f) => f.required && !(mapping[f.key] >= 0)).map((f) => f.label)
    : [];
  const previewFields = (mappedFields.length ? mappedFields : fields.slice(0, 3)).slice(0, 4);
  const previewRows = (prep?.rows || []).slice(0, 5);

  const canImport = !!prep && prep.stats.valid > 0 && reqMissing.length === 0;

  const modeTabs: Array<{ id: "skip" | "update" | "create"; label: string }> = [
    { id: "skip", label: "Skip duplicates" },
    { id: "update", label: "Update existing" },
    { id: "create", label: "Create new" },
  ];

  /* punch #81 — .xlsx upload. The file is converted to CSV server-side
     (exceljs is server-only; importing it here would drag Node stream
     internals into the client bundle and 500 the page, per #78) and the
     result lands in the same `text` state the textarea binds to, so preview,
     mapping and commit all run unchanged from here. */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a failure
    if (!file) return;
    setUploading(true);
    setUploadErr("");
    setUploadNote("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/xlsx", { method: "POST", body: fd });
      const data = (await res.json()) as
        | { ok: true; csv: string; rows: number; sheetName: string }
        | { ok: false; error: string };
      if (!data.ok) {
        setUploadErr(data.error);
        return;
      }
      setText(data.csv);
      setUploadNote(
        `Read ${data.rows} row${data.rows === 1 ? "" : "s"} from “${data.sheetName}” in ${file.name}. Check the preview below before importing.`
      );
    } catch {
      setUploadErr("That upload didn’t go through. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={importRecords}>
      <input type="hidden" name="type" value={typeKey} />
      <input type="hidden" name="mode" value={mode} />

      <div
        style={{
          fontSize: 12,
          color: "#8c919c",
          margin: "0 0 8px",
          lineHeight: 1.5,
        }}
      >
        Paste rows from a spreadsheet or a CSV export — include the header row.
        Columns are auto-matched to fields; duplicates are handled on import,
        matched on {dedupeLabel}.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px", flexWrap: "wrap" }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            border: "1px solid #e4e7ec",
            borderRadius: 9,
            padding: "7px 11px",
            fontSize: 12,
            cursor: uploading ? "default" : "pointer",
            background: uploading ? "#f4f5f7" : "#fff",
            color: uploading ? "#aab0bb" : "#16181d",
          }}
        >
          <input
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
            disabled={uploading}
            style={{ display: "none" }}
          />
          {uploading ? "Reading…" : "Choose an Excel file"}
        </label>
        <span style={{ fontSize: 11.5, color: "#aab0bb" }}>
          .xlsx — first sheet, header row required. Or paste below.
        </span>
      </div>

      {uploadNote && (
        <div style={{ margin: "0 0 10px", padding: "9px 11px", borderRadius: 9, background: "#eef4f8", border: "1px solid #d5e3ec", fontSize: 12, color: "#2f6f8f" }}>
          {uploadNote}
        </div>
      )}
      {uploadErr && (
        <div style={{ margin: "0 0 10px", padding: "9px 11px", borderRadius: 9, background: "#f9ece8", border: "1px solid #f0d6cd", fontSize: 12.5, color: "#a0442b" }}>
          {uploadErr}
        </div>
      )}

      <textarea
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder={fields.map((f) => f.header).join(",")}
        style={{
          width: "100%",
          height: 150,
          resize: "vertical",
          border: "1px solid #e4e7ec",
          borderRadius: 10,
          padding: "11px 12px",
          fontSize: 11.5,
          lineHeight: 1.7,
          fontFamily: "var(--font-mono)",
          color: "#16181d",
          background: "#fafbfc",
          outline: "none",
        }}
      />

      {/* stats */}
      {prep && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 12,
          }}
        >
          <span style={pillStyle("#1f7a52", "#eaf6ef", "#cce9da")}>{prep.stats.valid} ready</span>
          {prep.stats.invalid > 0 && (
            <span style={pillStyle("#b4543a", "#f7e9e5", "#f0d6cd")}>
              {prep.stats.invalid} need attention
            </span>
          )}
          <span style={{ fontSize: 11.5, color: "#aab0bb" }}>of {prep.stats.total} rows</span>
        </div>
      )}
      {parsed && !parsed.ok && trimmed && (
        <div
          style={{
            marginTop: 12,
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            borderRadius: 9,
            padding: "10px 12px",
            fontSize: 12.5,
            color: "#a0442b",
          }}
        >
          {parsed.error}
        </div>
      )}
      {reqMissing.length > 0 && (
        <div
          style={{
            marginTop: 12,
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            borderRadius: 9,
            padding: "10px 12px",
            fontSize: 12,
            color: "#a0442b",
            lineHeight: 1.45,
          }}
        >
          Couldn’t find a column for {reqMissing.join(" and ")} — it’s required. Add a header row
          named like “{reqMissing[0]}”.
        </div>
      )}

      {/* dedupe mode */}
      {prep && prep.stats.valid > 0 && (
        <>
          <div
            style={{
              marginTop: 16,
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            If a record already exists
          </div>
          <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 9, padding: 3 }}>
            {modeTabs.map((m) => {
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  style={{
                    flex: 1,
                    fontFamily: "var(--font-ui)",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "8px 8px",
                    borderRadius: 7,
                    border: "none",
                    cursor: "pointer",
                    background: on ? "#fff" : "transparent",
                    color: on ? "#16181d" : "#8c919c",
                    boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* preview */}
      {previewRows.length > 0 && (
        <>
          <div
            style={{
              marginTop: 16,
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Preview
          </div>
          <div
            style={{
              border: "1px solid #eef0f3",
              borderRadius: 10,
              overflowX: "auto",
            }}
          >
            <div style={{ minWidth: Math.max(320, previewFields.length * 130) }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols(previewFields.length),
                  gap: 10,
                  padding: "8px 12px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  background: "#fbfbfc",
                  borderBottom: "1px solid #f0f1f4",
                }}
              >
                {previewFields.map((f) => (
                  <span
                    key={f.key}
                    style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {f.label}
                  </span>
                ))}
              </div>
              {previewRows.map((r) => (
                <div
                  key={r.i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols(previewFields.length),
                    gap: 10,
                    padding: "9px 12px",
                    fontSize: 12,
                    alignItems: "center",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  {previewFields.map((f, ci) => {
                    const raw = r.values[f.key];
                    const txt = raw === "" || raw == null ? "—" : String(raw);
                    const mono = f.kind === "number" || f.kind === "date";
                    return (
                      <span
                        key={f.key}
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontFamily: mono ? "var(--font-mono)" : undefined,
                          fontWeight: ci === 0 ? 600 : 400,
                          color: ci === 0 ? (r.valid ? "#16181d" : "#b4543a") : "#5b616e",
                        }}
                      >
                        {txt}
                      </span>
                    );
                  })}
                </div>
              ))}
              {prep && prep.stats.total > previewRows.length && (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "#aab0bb" }}>
                  + {prep.stats.total - previewRows.length} more rows
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button
          type="submit"
          disabled={!canImport}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            borderRadius: 9,
            padding: "10px 18px",
            ...(canImport
              ? { color: "#fff", background: accent, cursor: "pointer" }
              : { color: "#aab0bb", background: "#eef0f3", cursor: "not-allowed" }),
          }}
        >
          {canImport
            ? `Import ${prep!.stats.valid} record${prep!.stats.valid === 1 ? "" : "s"} →`
            : "Paste rows to import"}
        </button>
      </div>
    </form>
  );
}

function gridCols(n: number): string {
  return Array.from({ length: n }, (_, i) => (i === 0 ? "minmax(120px,1.4fr)" : "minmax(80px,1fr)")).join(
    " "
  );
}

function pillStyle(ink: string, soft: string, bd: string): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 600,
    color: ink,
    background: soft,
    border: `1px solid ${bd}`,
    padding: "3px 9px",
    borderRadius: 20,
  };
}
