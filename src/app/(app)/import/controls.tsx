"use client";

import { useEffect, useState } from "react";
import { checkSize, type GroupCheck } from "@/lib/catalog-import-guard";
import { useClientToday } from "@/lib/use-client-today";
import { autoMap, parseCsv, prepareRows, visibleColumns, type FieldDef } from "./parse";
import { linksCustomer, previewLinks, type CustomerRef, type RowLink } from "./link";
import { catalogGroups } from "./catalog-groups";
import { checkCatalogImportAction, importRecords } from "./actions";

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 8,
};
const errorBox: React.CSSProperties = {
  marginTop: 12,
  background: "#f9ece8",
  border: "1px solid #f0d6cd",
  borderRadius: 9,
  padding: "10px 12px",
  fontSize: 12,
  color: "#a0442b",
  lineHeight: 1.45,
};

/**
 * Paste → live preview → confirm, the client leaf of the import flow. It parses
 * the pasted text locally only to render the preview + stats; the authoritative
 * write re-parses the same text server-side in `importRecords`. An `.xlsx` file
 * picker posts to `/api/import/xlsx`, which converts the file to CSV server-side,
 * and the result lands in the same `text` state the textarea binds to — so it
 * funnels through this same paste flow unchanged.
 *
 * #137: for the types whose rows link back to a customer (contacts, venues)
 * the preview also resolves each row against `customerIndex` — the same rule
 * the commit runs — and lists the customers the import will create.
 */
export function PastePreview({
  typeKey,
  fields,
  dedupeLabel,
  accent,
  today,
  customerIndex,
}: {
  typeKey: string;
  /** EVERY field of the type, hidden ones included: auto-mapping must still
   *  absorb a legacy file's columns. Only what the user is SHOWN is filtered
   *  (visibleColumns — the placeholder). */
  fields: FieldDef[];
  dedupeLabel: string;
  accent: string;
  /** Local YYYY-MM-DD from the server — the catalog type's effective-date
   *  default during SSR/hydration; after mount the input shows the BROWSER's
   *  day (useClientToday — a UTC server's "today" runs a day ahead of a US
   *  user's evening). */
  today: string;
  /** #137 — every customer already in Peak ({id, name}), for the Customer
   *  column. Empty for the types that don't link back. */
  customerIndex: CustomerRef[];
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"skip" | "update" | "create">("skip");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [guard, setGuard] = useState<GroupCheck[] | null>(null);
  // #133 — "" = untouched → today (the browser's, once mounted); a cleared
  // input falls back to today too.
  const clientToday = useClientToday(today);
  const [pickedDate, setPickedDate] = useState("");
  const effectiveDate = pickedDate || clientToday;

  const isCatalog = typeKey === "catalog";
  const trimmed = text.trim();
  const parsed = trimmed ? parseCsv(text) : null;
  const mapping = parsed && parsed.ok ? autoMap(parsed.headers, fields) : null;
  const prep = parsed && parsed.ok && mapping ? prepareRows(parsed.rows, mapping, fields) : null;

  // #137 — the preview draws VISIBLE columns only. A hidden field is still
  // mapped and still imported (that's the point of keeping it), but the
  // preview is the same advertisement the template and the placeholder are,
  // and those don't carry hidden columns either.
  const mappedFields = mapping
    ? visibleColumns(fields).filter((f) => mapping[f.key] != null && mapping[f.key] >= 0)
    : [];
  const reqMissing = mapping
    ? fields
        .filter(
          (f) =>
            f.required &&
            !(mapping[f.key] >= 0) &&
            // #137 — `Customer` is satisfied by a `Customer ID` column.
            !(f.requiredUnless && mapping[f.requiredUnless] >= 0)
        )
        .map((f) => f.label)
    : [];
  const previewFields = (
    mappedFields.length ? mappedFields : visibleColumns(fields).slice(0, 3)
  ).slice(0, 4);
  const previewRows = (prep?.rows || []).slice(0, 5);

  // #137 — link-back preview for contacts / venues, resolved over the WHOLE
  // table (a create on row 40 still belongs in the "will create" list) even
  // though only the first rows are drawn.
  const linkable = linksCustomer(fields);
  const links = linkable && prep ? previewLinks(prep.rows, customerIndex) : null;
  const willCreate = links?.willCreate ?? [];
  const linkText = (l: RowLink | undefined): { text: string; color: string } => {
    if (!l || l.how === "skip") return { text: "—", color: "#aab0bb" };
    if (l.how === "create") return { text: "will create", color: "color-mix(in srgb, var(--accent) 70%, #000)" };
    if (l.how === "missing") return { text: "no customer", color: "#b4543a" };
    return { text: "linked", color: "#5b616e" };
  };
  const previewCols = previewFields.length + (linkable ? 1 : 0);

  // #134 — the catalog type is capped at 1 MB of pasted/converted text.
  const size = isCatalog ? checkSize(new TextEncoder().encode(text).length) : ({ ok: true } as const);
  // #132 — wrong-manufacturer findings from the server-side preview check.
  // Treated as empty once the catalog type isn't active, the box is empty,
  // or the paste is over the 1 MB cap — the effect below stops scheduling
  // checks in those cases too, so deriving it here (rather than an effect
  // calling setGuard(null)) keeps stale results from an emptied textarea
  // off the screen without setting state synchronously from inside an
  // effect body.
  const guardFailures = !isCatalog || !trimmed || !size.ok ? [] : (guard || []).filter((g) => !g.result.ok);

  const canImport = !!prep && prep.stats.valid > 0 && reqMissing.length === 0 && size.ok && guardFailures.length === 0;

  /* #132 — debounce the pasted table into {mfr, skus} groups and ask the
     server whether each manufacturer checks out; the same guard runs again
     on commit, this is the early warning. An over-cap paste (#134) is
     neither parsed client-side nor sent — the size error already blocks the
     button. The `cancelled` flag drops a response that lands after the text
     changed again (a slower earlier RPC must not overwrite a newer result).
     */
  useEffect(() => {
    if (!isCatalog || !trimmed || !size.ok) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const p = parseCsv(text);
      if (!p.ok) return;
      const pr = prepareRows(p.rows, autoMap(p.headers, fields), fields);
      const groups = catalogGroups(pr.rows);
      if (!groups.length) {
        setGuard(null);
        return;
      }
      checkCatalogImportAction(groups)
        .then((r) => {
          if (!cancelled) setGuard(r);
        })
        .catch(() => {
          if (!cancelled) setGuard(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, trimmed, isCatalog, fields, size.ok]);

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
    if (isCatalog) {
      // #134 — refuse over-size workbooks here, before any upload.
      const fileSize = checkSize(file.size);
      if (!fileSize.ok) {
        setUploadErr(fileSize.error);
        setUploadNote("");
        return;
      }
    }
    setUploading(true);
    setUploadErr("");
    setUploadNote("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", typeKey);
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
        placeholder={visibleColumns(fields).map((f) => f.header).join(",")}
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
      {!size.ok && <div style={errorBox}>{size.error}</div>}
      {guardFailures.length > 0 && (
        <div style={errorBox}>
          {guardFailures.map((g) => (
            <div key={g.mfr || "(blank)"}>
              <b>{g.mfr || "No manufacturer"}</b> — {g.result.ok ? "" : g.result.detail}
            </div>
          ))}
        </div>
      )}

      {/* #133 — the price list's effective date (catalog only) */}
      {isCatalog && (
        <div style={{ marginTop: 16 }}>
          <div style={sectionLabel}>Price list effective</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input
              type="date"
              name="effectiveDate"
              value={effectiveDate}
              onChange={(e) => setPickedDate(e.target.value)}
              style={{
                border: "1px solid #e4e7ec",
                borderRadius: 9,
                padding: "8px 11px",
                fontSize: 12.5,
                fontFamily: "var(--font-ui)",
                color: "#16181d",
                background: "#fff",
              }}
            />
            <span style={{ fontSize: 11.5, color: "#aab0bb" }}>
              Defaults to today. Stamped on every part whose price changes.
            </span>
          </div>
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
            <div style={{ minWidth: Math.max(320, previewCols * 130) }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols(previewCols),
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
                {linkable && (
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Customer
                  </span>
                )}
              </div>
              {previewRows.map((r) => {
                const link = linkText(links?.links[r.i]);
                return (
                  <div
                    key={r.i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridCols(previewCols),
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
                      const mono = f.kind === "number" || f.kind === "date" || f.kind === "zip";
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
                    {linkable && (
                      <span
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontSize: 11,
                          fontWeight: 600,
                          color: link.color,
                        }}
                      >
                        {link.text}
                      </span>
                    )}
                  </div>
                );
              })}
              {prep && prep.stats.total > previewRows.length && (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "#aab0bb" }}>
                  + {prep.stats.total - previewRows.length} more rows
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* #137 — customers this file will create (listed before commit) */}
      {willCreate.length > 0 && (
        <div
          style={{
            marginTop: 12,
            background: "var(--accent-soft)",
            border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
            borderRadius: 9,
            padding: "10px 12px",
            fontSize: 12,
            color: "color-mix(in srgb, var(--accent) 70%, #000)",
            lineHeight: 1.45,
          }}
        >
          Will create {willCreate.length} new customer{willCreate.length === 1 ? "" : "s"}:{" "}
          {willCreate.slice(0, 6).join(", ")}
          {willCreate.length > 6 ? ` and ${willCreate.length - 6} more` : ""}
          . Rows whose customer isn’t in Peak yet link to these; fix the spelling in your source
          first if one of them should be an existing customer.
        </div>
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
