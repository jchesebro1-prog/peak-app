"use client";

import { useState, useTransition } from "react";
import { importSurveyCsv } from "./actions";

/**
 * Header "Upload CSV" control (punch #111). A button-styled <label> over a
 * hidden file input replaces the bare native picker, the chosen filename is
 * echoed beside it, and the submit runs through a transition so the button
 * reads "Uploading…" instead of looking frozen while the server action runs.
 * Styled to sit beside the "↓ Blank CSV" link.
 */
export default function CsvUploadForm() {
  const [fileName, setFileName] = useState("");
  const [pending, startTransition] = useTransition();
  const canUpload = !!fileName && !pending;

  const btn: React.CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#3a3f4a",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 9,
    padding: "10px 12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canUpload) return;
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          await importSurveyCsv(fd);
        });
      }}
      style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}
    >
      <label style={{ ...btn, display: "inline-flex", alignItems: "center", ...(pending ? { color: "#aab0bb", cursor: "not-allowed" } : {}) }}>
        {fileName ? "Change file" : "Select CSV file"}
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          disabled={pending}
          style={{ display: "none" }}
          onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
        />
      </label>
      {fileName && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "#3a3f4a",
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={fileName}
        >
          {fileName}
        </span>
      )}
      <button
        type="submit"
        disabled={!canUpload}
        style={{
          ...btn,
          ...(canUpload ? {} : { color: "#aab0bb", background: "#f7f8fa", cursor: "not-allowed" }),
        }}
      >
        {pending ? "Uploading…" : "↑ Upload CSV"}
      </button>
    </form>
  );
}
