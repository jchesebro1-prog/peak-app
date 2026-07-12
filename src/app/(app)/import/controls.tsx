"use client";

import { useState } from "react";
import { autoMap, parseCsv, prepareRows, type FieldDef } from "./parse";
import { importRecords, extractRowsAction } from "./actions";

/**
 * Paste → live preview → confirm, the client leaf of the import flow. It parses
 * the pasted text locally only to render the preview + stats; the authoritative
 * write re-parses the same text server-side in `importRecords`. Drag-drop file
 * upload is stubbed (see the note in the flow header) and funnels users here.
 */
export function PastePreview({
  typeKey,
  fields,
  dedupeLabel,
  accent,
  aiEnabled = false,
}: {
  typeKey: string;
  fields: FieldDef[];
  dedupeLabel: string;
  accent: string;
  aiEnabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"skip" | "update" | "create">("skip");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  /**
   * Extract-with-AI (D3): send the messy pasted text to the server action,
   * then convert the drafted rows into a clean CSV block (header = field labels,
   * one line per record, values in field order) and drop it back into the SAME
   * textarea. That re-runs parseCsv below, so the existing preview → auto-map →
   * prepare → confirm → commit pipeline consumes the drafted rows unchanged and
   * a human still reviews/edits before importing (D6 guardrail).
   */
  async function runExtract() {
    if (!text.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    try {
      const res = await extractRowsAction(typeKey, text);
      if (!res.ok) {
        setAiError(res.error);
        return;
      }
      if (!res.rows.length) {
        setAiError("Couldn’t find any records in that text.");
        return;
      }
      setText(rowsToCsv(res.rows, fields));
    } catch (e) {
      setAiError((e as Error).message || "Extraction failed.");
    } finally {
      setAiBusy(false);
    }
  }

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

      {/* Extract with AI (D3) — only when the gate is on and there's text to work on */}
      {aiEnabled && trimmed && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={runExtract}
              disabled={aiBusy}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12.5,
                fontWeight: 600,
                border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
                borderRadius: 9,
                padding: "8px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                color: "color-mix(in srgb, var(--accent) 70%, #000)",
                background: "var(--accent-soft)",
                cursor: aiBusy ? "wait" : "pointer",
                opacity: aiBusy ? 0.7 : 1,
              }}
            >
              {aiBusy ? (
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    border: "2px solid color-mix(in srgb, var(--accent) 40%, #fff)",
                    borderTopColor: "var(--accent)",
                    display: "inline-block",
                    animation: "pk-spin 0.7s linear infinite",
                  }}
                />
              ) : (
                <span aria-hidden>✨</span>
              )}
              {aiBusy ? "Extracting…" : "Extract with AI"}
            </button>
            <span style={{ fontSize: 11.5, color: "#aab0bb", lineHeight: 1.4 }}>
              Not a clean table? Turn a price list, an emailed spec or copied notes into rows to
              review.
            </span>
          </div>
          <style>{"@keyframes pk-spin{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}
      {aiError && (
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
          {aiError}
        </div>
      )}

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

/**
 * Serialize AI-drafted row objects (keyed by field key) into a clean CSV block
 * whose header row is the field LABELS in field order. parseCsv then rebuilds
 * the exact ParsedTable, and because the headers equal the field labels autoMap
 * lines every column up 1:1 — so the drafted rows flow through the unchanged
 * preview/commit pipeline just like a pasted spreadsheet.
 */
function rowsToCsv(rows: Record<string, string>[], fields: FieldDef[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = fields.map((f) => esc(f.label)).join(",");
  const lines = rows.map((r) => fields.map((f) => esc(r[f.key] ?? "")).join(","));
  return [header, ...lines].join("\n");
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
