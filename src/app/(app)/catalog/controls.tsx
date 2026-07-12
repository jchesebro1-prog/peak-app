"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseCatalog } from "./parse";
import { importCatalog } from "./actions";

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
          placeholder="Search parts, SKUs, manufacturers…"
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
        <option value="relevance">Catalog order</option>
        <option value="price">Highest price</option>
        <option value="alpha">Name A–Z</option>
      </select>
    </div>
  );
}

/**
 * Import-to-catalog side panel. Three methods like the prototype: Upload and
 * Connect are stubbed (no live file/API path in this build) and point users at
 * Paste, which is wired end-to-end: parse locally for the preview, submit the
 * raw text to `importCatalog` for the authoritative upsert.
 */
export function CatalogImportPanel({
  manufacturers,
  accent,
}: {
  manufacturers: string[];
  accent: string;
}) {
  const [method, setMethod] = useState<"upload" | "api" | "paste">("paste");
  const [mfrSel, setMfrSel] = useState(manufacturers[0] || "");
  const [adding, setAdding] = useState(manufacturers.length === 0);
  const [newMfr, setNewMfr] = useState("");
  const [text, setText] = useState("");

  const mfr = (adding ? newMfr : mfrSel).trim();
  const parsed = text.trim() ? parseCatalog(text) : null;
  const canImport = method === "paste" && !!parsed?.ok && parsed.stats.valid > 0;

  const methods = [
    { id: "upload" as const, icon: "↑", title: "Upload a price book", desc: "CSV or Excel list." },
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
            </>
          )}

          {/* UPLOAD — stubbed */}
          {method === "upload" && (
            <div
              style={{
                border: "1.5px dashed #cfd4dd",
                borderRadius: 11,
                background: "#fafbfc",
                padding: "24px 18px",
                textAlign: "center",
                marginTop: 12,
              }}
            >
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
              <div style={{ fontSize: 13, fontWeight: 600 }}>File upload is coming soon</div>
              <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3, lineHeight: 1.4 }}>
                For now, open your CSV/Excel price book, copy the rows, and use{" "}
                <button
                  type="button"
                  onClick={() => setMethod("paste")}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "color-mix(in srgb, var(--accent) 72%, #000)",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 11.5,
                  }}
                >
                  Paste a list
                </button>
                .
              </div>
            </div>
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
            <form action={importCatalog} style={{ marginTop: 12 }}>
              <input type="hidden" name="mfr" value={mfr} />
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
                disabled={!canImport || !mfr}
                style={{
                  width: "100%",
                  marginTop: 14,
                  fontSize: 13.5,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 9,
                  padding: 11,
                  ...(canImport && mfr
                    ? { color: "#fff", background: accent, cursor: "pointer" }
                    : { color: "#aab0bb", background: "#eef0f3", cursor: "not-allowed" }),
                }}
              >
                {!mfr
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
