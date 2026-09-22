"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { checkSize } from "@/lib/catalog-import-guard";
import { parseCatalog } from "./parse";
import { importCatalog, removePartDatasheetAction, uploadPartDatasheetAction } from "./actions";

const fieldLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".05em",
  marginBottom: 7,
};
const dateInput: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "8px 12px",
  outline: "none",
  background: "#fff",
};

/** Search box + sort select for the catalog table; both drive URL state. */
export function CatalogControls({
  q,
  mfr,
  cat,
  sort,
}: {
  q: string;
  mfr: string;
  cat: string;
  sort: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const first = useRef(true);

  const push = (over: { q?: string; sort?: string }) => {
    const qs = new URLSearchParams();
    if (mfr && mfr !== "all") qs.set("mfr", mfr);
    if (cat && cat !== "all") qs.set("cat", cat);
    const nq = over.q ?? text;
    const ns = over.sort ?? sort;
    if (nq.trim()) qs.set("q", nq.trim());
    if (ns && ns !== "relevance") qs.set("sort", ns);
    const s = qs.toString();
    router.push("/catalog" + (s ? "?" + s : ""), { scroll: false });
  };

  // debounce the search input
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => push({ q: text }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: 9 }}>
      <div
        style={{
          flex: 1,
          minWidth: 170,
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "#f7f8fa",
          border: "1px solid #e4e7ec",
          borderRadius: 9,
          padding: "9px 12px",
        }}
      >
        <span style={{ color: "#aab0bb", fontSize: 14, lineHeight: 1 }}>⌕</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search manufacturer, model #, description, category…"
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            fontSize: 13.5,
            fontFamily: "var(--font-ui)",
            color: "#16181d",
            outline: "none",
          }}
        />
        {text.trim() && (
          <button
            type="button"
            onClick={() => {
              setText("");
              push({ q: "" });
            }}
            style={{
              border: "none",
              background: "transparent",
              color: "#aab0bb",
              fontSize: 15,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
      <select
        className="ct-sel"
        value={sort}
        onChange={(e) => push({ sort: e.target.value })}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12.5,
          fontWeight: 500,
          color: "#3a3f4a",
          border: "1px solid #e4e7ec",
          borderRadius: 9,
          padding: "9px 28px 9px 11px",
          background: "#fff",
          cursor: "pointer",
          outline: "none",
          flexShrink: 0,
        }}
      >
        <option value="relevance">Master list</option>
        <option value="price">Highest price</option>
        <option value="alpha">Name A–Z</option>
      </select>
    </div>
  );
}

/**
 * Import-to-catalog side panel. Upload and paste share the same parser and
 * authoritative server action, including MFR PN files exported by design tools.
 */
export function CatalogImportPanel({
  manufacturers,
  accent,
  today,
}: {
  manufacturers: string[];
  accent: string;
  /** Local YYYY-MM-DD from the server — the effective-date default; passed
   *  in so the server render and the client agree (no hydration drift). */
  today: string;
}) {
  const [method, setMethod] = useState<"upload" | "api" | "paste">("upload");
  const [mfrSel, setMfrSel] = useState(manufacturers[0] || "");
  const [adding, setAdding] = useState(manufacturers.length === 0);
  const [newMfr, setNewMfr] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mfr = (adding ? newMfr : mfrSel).trim();
  const parsed = text.trim() ? parseCatalog(text) : null;
  // #134 — the paste box is capped like a file; bytes, not characters.
  const pasteSize = checkSize(new TextEncoder().encode(text).length);
  const canImport = method === "paste" && !!parsed?.ok && parsed.stats.valid > 0 && pasteSize.ok;
  const canUpload = !!mfr && !!fileName && !fileError && !pending;

  const methods = [
    { id: "upload" as const, icon: "↑", title: "Import CSV / TSV", desc: "Upload a manufacturer or design-program export." },
    { id: "api" as const, icon: "⇄", title: "Connect a manufacturer", desc: "Live pricing via a dealer account." },
    { id: "paste" as const, icon: "☰", title: "Paste a list", desc: "Rows straight from a spreadsheet." },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Import to catalog</div>
        <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2, lineHeight: 1.4 }}>
          Add a manufacturer price book — it lands in the shared database for every quote.
        </div>
      </div>

      <div style={{ padding: 16, overflowY: "auto" }}>
        {/* method picker */}
        {methods.map((m) => {
          const active = method === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                background: "#fff",
                border: `1.5px solid ${active ? accent : "#ececf0"}`,
                borderRadius: 11,
                padding: 12,
                marginBottom: 8,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: active ? "var(--accent-soft)" : "#f1f2f5",
                  color: active ? "color-mix(in srgb, var(--accent) 72%, #000)" : "#5b616e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {m.icon}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: "block" }}>{m.title}</span>
                <span style={{ fontSize: 11.5, color: "#8c919c", lineHeight: 1.4, display: "block", marginTop: 1 }}>
                  {m.desc}
                </span>
              </span>
              <span
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: "50%",
                  border: `1.7px solid ${active ? accent : "#cfd4dd"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {active && <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />}
              </span>
            </button>
          );
        })}

        <div style={{ marginTop: 14 }}>
          {/* manufacturer picker (shared by upload + paste) */}
          {method !== "api" && (
            <>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "#9aa0ab",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 7,
                }}
              >
                Manufacturer
              </div>
              <select
                className="ct-sel"
                value={adding ? "__add_new__" : mfrSel}
                onChange={(e) => {
                  if (e.target.value === "__add_new__") setAdding(true);
                  else {
                    setAdding(false);
                    setMfrSel(e.target.value);
                  }
                }}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#16181d",
                  border: "1px solid #e4e7ec",
                  borderRadius: 8,
                  padding: "9px 30px 9px 12px",
                  background: "#fff",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {manufacturers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__add_new__">+ Add new manufacturer…</option>
              </select>
              {adding && (
                <input
                  value={newMfr}
                  onChange={(e) => setNewMfr(e.target.value)}
                  placeholder="New manufacturer name"
                  required
                  style={{
                    width: "100%",
                    marginTop: 8,
                    fontSize: 13,
                    fontFamily: "var(--font-ui)",
                    color: "#16181d",
                    border: "1px solid #cfd4dd",
                    borderRadius: 8,
                    padding: "9px 12px",
                    outline: "none",
                  }}
                />
              )}
              {/* #133 — the price list's effective date, stamped on every row
                  whose price changes and recorded as the manufacturer's
                  price-list date. */}
              <div style={{ ...fieldLabel, marginTop: 12 }}>Price list effective</div>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value || today)}
                style={dateInput}
              />
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 4 }}>
                Defaults to today. Stamped on every part whose price changes.
              </div>
            </>
          )}

          {/* UPLOAD — CSV / TSV for prebuilt systems and design-program exports */}
          {method === "upload" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!canUpload) return;
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  await importCatalog(fd);
                });
              }}
              style={{
                border: "1.5px dashed #cfd4dd",
                borderRadius: 11,
                background: "#fafbfc",
                padding: "24px 18px",
                textAlign: "center",
                marginTop: 12,
              }}
            >
              <input type="hidden" name="mfr" value={mfr} />
              <input type="hidden" name="prebuilt" value="1" />
              <input type="hidden" name="effectiveDate" value={effectiveDate} />
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 11,
                  background: "var(--accent-soft)",
                  color: "color-mix(in srgb, var(--accent) 72%, #000)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  margin: "0 auto 10px",
                }}
              >
                ↑
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Upload prebuilt systems or parts</div>
              <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3, lineHeight: 1.4 }}>
                Match rows by Manufacturer Part # (MFR PN). Include Description, plus optional Category, Unit, List, and Cost columns.
              </div>
              <a
                href="/api/catalog/template.csv"
                download="catalog-import-template.csv"
                style={{
                  display: "inline-block",
                  marginTop: 10,
                  color: accent,
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                ↓ Download CSV template
              </a>
              {/* button-style picker over a hidden input (punch #111) — the
                  native file input read as a bare text field with no obvious
                  click target */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 7,
                    padding: "8px 13px",
                    background: pending ? "#eef0f3" : accent,
                    color: pending ? "#aab0bb" : "#fff",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: pending ? "not-allowed" : "pointer",
                  }}
                >
                  {fileName ? "Choose a different file" : "Select CSV / TSV file"}
                  <input
                    name="file"
                    type="file"
                    accept=".csv,.tsv,text/csv,text/tab-separated-values"
                    required
                    disabled={pending}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) {
                        setFileName("");
                        setFileError(null);
                        return;
                      }
                      // #134 — refuse over-size files here, before any upload.
                      const size = checkSize(f.size);
                      if (!size.ok) {
                        setFileError(size.error);
                        setFileName("");
                        e.target.value = "";
                        return;
                      }
                      setFileError(null);
                      setFileName(f.name);
                    }}
                  />
                </label>
                {fileName && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "#3a3f4a",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fileName}
                  </span>
                )}
              </div>
              {fileError && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{fileError}</div>
              )}
              <button
                type="submit"
                disabled={!canUpload}
                style={{
                  width: "100%",
                  marginTop: 14,
                  border: "none",
                  borderRadius: 9,
                  padding: 11,
                  color: canUpload ? "#fff" : "#aab0bb",
                  background: canUpload ? accent : "#eef0f3",
                  cursor: canUpload ? "pointer" : "not-allowed",
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
              >
                {pending
                  ? "Importing…"
                  : !mfr
                    ? "Name the manufacturer"
                    : !fileName
                      ? "Select a file to import"
                      : "Import MFR PN file →"}
              </button>
              {pending && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: "#8c919c", lineHeight: 1.4 }}>
                  Reading and matching rows — large price books can take a minute. You will land on the imported list when it finishes.
                </div>
              )}
            </form>
          )}

          {/* API — stubbed */}
          {method === "api" && (
            <div
              style={{
                border: "1px solid #f0f1f4",
                borderRadius: 11,
                padding: "14px 13px",
                fontSize: 12,
                color: "#7a5f18",
                background: "#fbf3dd",
                lineHeight: 1.5,
              }}
            >
              Live dealer-account pricing is on the roadmap. Export a price book from your dealer
              portal and use <b style={{ color: "#5b4a12" }}>Paste a list</b> — it imports right away.
            </div>
          )}

          {/* PASTE — wired */}
          {method === "paste" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  await importCatalog(fd);
                });
              }}
              style={{ marginTop: 12 }}
            >
              <input type="hidden" name="mfr" value={mfr} />
              <input type="hidden" name="effectiveDate" value={effectiveDate} />
              <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 8, lineHeight: 1.4 }}>
                One part per line: <span style={{ fontFamily: "var(--font-mono)" }}>SKU, Description, Category, Unit, List, Cost</span>.
                A header row is auto-detected.
              </div>
              <textarea
                name="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                placeholder={"CL-HB3, Head block 3-groove, Rigging, ea, 680, 469"}
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
              {parsed && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 10,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: "#1f7a52",
                      background: "#eaf6ef",
                      border: "1px solid #cce9da",
                      padding: "3px 9px",
                      borderRadius: 20,
                    }}
                  >
                    {parsed.stats.valid} ready
                  </span>
                  {parsed.stats.invalid > 0 && (
                    <span
                      style={{
                        fontWeight: 600,
                        color: "#b4543a",
                        background: "#f7e9e5",
                        border: "1px solid #f0d6cd",
                        padding: "3px 9px",
                        borderRadius: 20,
                      }}
                    >
                      {parsed.stats.invalid} skipped
                    </span>
                  )}
                  <span style={{ color: "#aab0bb", fontFamily: "var(--font-ui)" }}>
                    of {parsed.stats.total} lines
                  </span>
                </div>
              )}
              {!pasteSize.ok && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{pasteSize.error}</div>
              )}

              {/* preview */}
              {parsed?.ok && parsed.rows.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    border: "1px solid #eef0f3",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "70px 1fr 58px",
                      gap: 8,
                      padding: "7px 11px",
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: "#aab0bb",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      background: "#fbfbfc",
                      borderBottom: "1px solid #f0f1f4",
                    }}
                  >
                    <span>SKU</span>
                    <span>Description</span>
                    <span style={{ textAlign: "right" }}>List</span>
                  </div>
                  {parsed.rows.slice(0, 5).map((r, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "70px 1fr 58px",
                        gap: 8,
                        padding: "8px 11px",
                        fontSize: 11.5,
                        alignItems: "center",
                        borderBottom: "1px solid #f5f6f8",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: r.valid ? "#5b616e" : "#b4543a",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.sku || "—"}
                      </span>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.desc || "—"}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", textAlign: "right" }}>
                        {r.list ? "$" + r.list.toLocaleString("en-US") : "—"}
                      </span>
                    </div>
                  ))}
                  {parsed.rows.length > 5 && (
                    <div style={{ padding: "7px 11px", fontSize: 11, color: "#aab0bb" }}>
                      + {parsed.rows.length - 5} more
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={!canImport || !mfr || pending}
                style={{
                  width: "100%",
                  marginTop: 14,
                  fontSize: 13.5,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 9,
                  padding: 11,
                  ...(canImport && mfr && !pending
                    ? { color: "#fff", background: accent, cursor: "pointer" }
                    : { color: "#aab0bb", background: "#eef0f3", cursor: "not-allowed" }),
                }}
              >
                {pending
                  ? `Importing ${parsed?.stats.valid ?? 0} row${parsed?.stats.valid === 1 ? "" : "s"}…`
                  : !mfr
                    ? "Name the manufacturer"
                    : canImport
                      ? `Import ${parsed!.stats.valid} part${parsed!.stats.valid === 1 ? "" : "s"} →`
                      : "Paste rows to import"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const dsLinkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--accent)",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
  fontFamily: "var(--font-ui)",
};

/**
 * Attach/replace/remove control for a part's datasheet PDF (punch #39,
 * Task 5, D116). Admin-gated by the caller (catalog page only mounts this
 * for `isAdmin`) — this is the one place that calls
 * uploadPartDatasheetAction/removePartDatasheetAction. Styled as plain text
 * links throughout, per spec (no paperclip/emoji glyphs).
 */
export function PartDatasheetControl({
  sku,
  datasheetName,
}: {
  sku: string;
  /** Present only when the part already has a datasheet attached. */
  datasheetName?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const hasDatasheet = !!datasheetName;

  const onFile = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      startTransition(async () => {
        const r = await uploadPartDatasheetAction(sku, file.name, dataUrl);
        if (!r.ok) setError(r.error);
        else router.refresh();
      });
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsDataURL(file);
  };

  const onRemove = () => {
    setError(null);
    startTransition(async () => {
      const r = await removePartDatasheetAction(sku);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "#9aa0ab",
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 6,
        }}
      >
        Datasheet
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {hasDatasheet && (
          <a
            href={`/api/part-datasheet/${encodeURIComponent(sku)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
          >
            {datasheetName}
          </a>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
        <button type="button" disabled={pending} onClick={() => fileRef.current?.click()} style={dsLinkStyle}>
          {pending ? "Uploading…" : hasDatasheet ? "Replace" : "Attach datasheet"}
        </button>
        {hasDatasheet && (
          <button type="button" disabled={pending} onClick={onRemove} style={dsLinkStyle}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "#b4543a" }}>{error}</div>
      )}
      <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 6 }}>
        PDF only, up to 8 MB. Removing clears the attachment but keeps the
        file in storage.
      </div>
    </div>
  );
}
