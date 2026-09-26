"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importProductSpecsAction, previewProductSpecsAction } from "../../actions";
import type { PlanRow, ProductSpecCounts, TokenResult } from "@/lib/specs/product-spec-import";

/**
 * #205 — the product spec import screen: pick the filled template, preview
 * every row's matches, then import. The server re-reads and re-plans the
 * same file on import (never a plan from here), so this component holds the
 * File and the checkbox and nothing else authoritative. Imports only the two
 * actions and pure types — no stores, no exceljs (a client import of either
 * breaks `next build`, not tsc).
 */

/** Mirrors the server's guard so a too-large file never makes the trip. */
const MAX_PRODUCT_SPEC_BYTES = 900_000;

const TH: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
};
const CELL: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a" };
const MONO: React.CSSProperties = { fontFamily: "var(--font-mono)" };
const COLS = "130px minmax(0,1.1fr) minmax(0,0.8fr) minmax(0,2.1fr)";

type Tone = "good" | "info" | "warn" | "bad" | "muted";
const TONE: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: "#1f7a52", bg: "#e8f5ee" },
  info: { fg: "#3a5fb4", bg: "#eaf0fb" },
  warn: { fg: "#9a6b12", bg: "#fdf3df" },
  bad: { fg: "#b4543a", bg: "#fbeae5" },
  muted: { fg: "#5b616e", bg: "#f1f2f5" },
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: t.fg, background: t.bg, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

type Preview = { rows: PlanRow[]; counts: ProductSpecCounts; sheets: string[] };

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** A ready row that still needs a look: a token that didn't land, a loose
 *  or manufacturer-mismatched match, or a part it could not write. */
function needsLook(r: PlanRow): boolean {
  return r.tokens.some(
    (t) => t.status !== "matched" || t.loose || !!t.mfrWarning || t.action === "skip-existing"
  );
}

function TokenLine({ t, holderSku }: { t: TokenResult; holderSku?: string }) {
  const row: React.CSSProperties = { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", ...CELL };
  const tok = <span style={{ ...MONO, color: "#8c919c" }}>{t.token}</span>;
  if (t.status === "not-found") {
    return (
      <div style={row}>
        {tok} <Badge tone="bad">No part</Badge>
      </div>
    );
  }
  if (t.status === "claimed") {
    return (
      <div style={row}>
        {tok} → <span style={{ ...MONO, fontWeight: 600 }}>{t.sku}</span>
        <Badge tone="warn">Already matched by {t.bySpecId}</Badge>
      </div>
    );
  }
  if (t.status === "ambiguous") {
    return (
      <div style={row}>
        {tok} <Badge tone="warn">{t.total} parts match</Badge>
        {t.loose && <Badge tone="warn">Loose match</Badge>}
        <span style={{ ...MONO, fontSize: 11.5, color: "#5b616e" }}>
          {t.candidates.join(", ")}
          {t.total > t.candidates.length ? ", …" : ""}
        </span>
      </div>
    );
  }
  return (
    <div style={row}>
      {tok} → <span style={{ ...MONO, fontWeight: 600 }}>{t.sku}</span>
      {t.desc && <span style={{ color: "#8c919c" }}>{t.desc}</span>}
      {t.role === "holder" && <Badge tone="info">Holds the text</Badge>}
      {t.role === "same-as" && holderSku && <Badge tone="info">Same as {holderSku}</Badge>}
      {t.action === "write" && <Badge tone="good">Will write</Badge>}
      {t.action === "unchanged" && <Badge tone="muted">Unchanged</Badge>}
      {t.action === "skip-existing" && <Badge tone="warn">Has its own text — skipped</Badge>}
      {t.loose && <Badge tone="warn">Loose match</Badge>}
      {t.mfrWarning && <Badge tone="warn">{t.mfrWarning}</Badge>}
    </div>
  );
}

function RowGroup({ label, rows }: { label: string; rows: PlanRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <div style={{ padding: "8px 18px", background: "#fbfbfd", borderBottom: "1px solid #f5f6f8", fontSize: 11.5, fontWeight: 600, color: "#5b616e" }}>
        {label} <span style={{ ...MONO, color: "#9aa0ab", fontWeight: 500 }}>{rows.length}</span>
      </div>
      {rows.map((r) => (
        <div
          key={`${r.sheet}:${r.line}`}
          style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", alignItems: "start" }}
        >
          <span style={{ ...CELL, ...MONO }} title={`${r.sheet}, row ${r.line}`}>
            {r.specId || "—"}
          </span>
          <span style={{ ...CELL, fontWeight: 600 }}>{r.title || "—"}</span>
          <span style={{ ...CELL, ...MONO, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.mfr || "—"}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {r.error && <div style={{ ...CELL, color: "#b4543a" }}>{r.error}</div>}
            {r.tokens.map((t, i) => (
              <TokenLine key={i} t={t} holderSku={r.holderSku} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductSpecsImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const formFor = (f: File) => {
    const fd = new FormData();
    fd.set("file", f);
    if (replaceExisting) fd.set("replaceExisting", "1");
    return fd;
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setPreview(null);
    setMsg("");
    setErr("");
    if (f && f.size > MAX_PRODUCT_SPEC_BYTES) {
      setErr("That file is too large — the product spec import limit is 900 KB.");
      setFile(null);
      e.target.value = "";
      return;
    }
    setFile(f);
  };

  const runPreview = () => {
    if (!file) {
      setErr("Choose a file first.");
      return;
    }
    start(async () => {
      setErr("");
      setMsg("");
      const res = await previewProductSpecsAction(formFor(file));
      if (!res.ok) {
        setPreview(null);
        setErr(res.error);
        return;
      }
      setPreview({ rows: res.rows, counts: res.counts, sheets: res.sheets });
    });
  };

  const runImport = () => {
    if (!file) return;
    start(async () => {
      setErr("");
      setMsg("");
      const res = await importProductSpecsAction(formFor(file));
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const failed = res.failed > 0 ? ` ${plural(res.failed, "part")} could not be written${res.firstError ? ` (${res.firstError})` : ""}.` : "";
      setMsg(`Wrote spec text to ${plural(res.written, "part")} (${res.sameAs} linked as same-as).${failed}`);
      setPreview(null);
      router.refresh();
    });
  };

  const c = preview?.counts;
  const rows = preview?.rows || [];
  const groups: Array<{ label: string; rows: PlanRow[] }> = [
    { label: "Errors", rows: rows.filter((r) => r.status === "error") },
    { label: "No part matched", rows: rows.filter((r) => r.status === "unmatched") },
    { label: "Ready — needs a look", rows: rows.filter((r) => r.status === "ready" && needsLook(r)) },
    { label: "Ready", rows: rows.filter((r) => r.status === "ready" && !needsLook(r)) },
  ];
  const blankRows = rows.filter((r) => r.status === "blank");

  const chips: Array<{ label: string; n: number; tone: Tone }> = c
    ? [
        { label: "ready rows", n: c.readyRows, tone: "good" },
        { label: "parts to write", n: c.partsToWrite, tone: "good" },
        { label: "same-as links", n: c.sameAsLinks, tone: "info" },
        { label: "unchanged", n: c.unchanged, tone: "muted" },
        { label: "already have text (skipped)", n: c.skippedExisting, tone: "warn" },
        { label: "not found", n: c.notFound, tone: "bad" },
        { label: "ambiguous", n: c.ambiguous, tone: "warn" },
        { label: "claimed twice", n: c.claimed, tone: "warn" },
        { label: "blank rows", n: c.blankRows, tone: "muted" },
        { label: "errors", n: c.errorRows, tone: "bad" },
      ]
    : [];

  return (
    <>
      <div className="pk-card" style={{ padding: "16px 18px", marginBottom: 22 }}>
        <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 12 }}>
          An .xlsx (every sheet with a Spec ID and an MFR # column is read) or a .csv, up to 900 KB. Rows with a
          blank MFR # are skipped. Import the spec library first — each row&apos;s Article ID must already exist.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => fileRef.current?.click()}>
            Choose file
          </button>
          <span style={{ ...CELL, ...MONO, color: file ? "#3a3f4a" : "#aab0bb" }}>{file ? file.name : "No file chosen"}</span>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: "none" }} onChange={onFile} />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "#5b616e", marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => {
                setReplaceExisting(e.target.checked);
                // The preview was planned under the other setting.
                setPreview(null);
              }}
            />
            Replace spec text a part already has
          </label>
          <button type="button" className="pk-btn-outline" disabled={pending || !file} onClick={runPreview}>
            {pending && !preview ? "Reading…" : "Preview"}
          </button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: 12, color: "#1f7a52" }}>{msg}</div>}
        {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
      </div>

      {preview && c && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {chips.map((ch) => (
              <Badge key={ch.label} tone={ch.n ? ch.tone : "muted"}>
                <span style={MONO}>{ch.n}</span> {ch.label}
              </Badge>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <button type="button" className="pk-btn-accent" disabled={pending || c.partsToWrite === 0} onClick={runImport}>
              {pending ? "Importing…" : `Import ${plural(c.partsToWrite, "part")}`}
            </button>
            <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>
              Read {preview.sheets.join(" · ")}. The import re-reads this file and writes only the parts marked “Will
              write”.
            </span>
          </div>

          <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
              <span style={TH}>Spec ID</span>
              <span style={TH}>Title</span>
              <span style={TH}>MFR #</span>
              <span style={TH}>Result</span>
            </div>
            {groups.map((g) => (
              <RowGroup key={g.label} label={g.label} rows={g.rows} />
            ))}
            {rows.length === blankRows.length && (
              <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                No row has an MFR # yet — fill the MFR # column and preview again.
              </div>
            )}
            {blankRows.length > 0 && (
              <details style={{ padding: "10px 18px", fontSize: 12, color: "#8c919c" }}>
                <summary style={{ cursor: "pointer" }}>{plural(blankRows.length, "row")} with a blank MFR # (skipped)</summary>
                <div style={{ ...MONO, marginTop: 6, lineHeight: 1.6 }}>{blankRows.map((r) => r.specId || `row ${r.line}`).join(", ")}</div>
              </details>
            )}
          </div>
        </>
      )}
    </>
  );
}
