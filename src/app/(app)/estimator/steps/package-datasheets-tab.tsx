"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { clientPackageDocsAction } from "../client-package-actions";
import letterhead from "../peak-letterhead.jpg";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";
import type { EstimatorState } from "../use-estimator-state";
import { bomProjectionKey, fitBomProjection, projectBom } from "@/lib/estimate-output/bom-projection";
import {
  bulkTargets,
  CLIENT_PACKAGE_COPY as COPY,
  clientRowViews,
  DATASHEET_FILTER_LABEL,
  DATASHEET_FILTERS,
  datasheetCounts,
  datasheetCountsLine,
  datasheetListItems,
  filterRowViews,
  type DatasheetFilter,
} from "@/lib/estimate-output/client-package-ui";
import { DATASHEETS_TAB_COPY as TAB, datasheetPreview } from "@/lib/estimate-output/datasheet-preview";
import type { ClientDatasheetRow } from "@/lib/estimate-output/package-preview";
import { excludeRefusal } from "@/lib/estimate-output/package-selection";
import { BOOK_COVER_COPY, quoteDatasheetsPdfPath } from "@/lib/part-docs/datasheet-book-cover";

const H2: CSSProperties = { margin: 0, fontSize: 11, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em" };
const HINT: CSSProperties = { fontSize: 11.5, color: "#8c919c", lineHeight: 1.45 };
const LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none", fontSize: 12 };
const SMALL_BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" };
const PAGE: CSSProperties = { background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "28px 32px" };
const TH: CSSProperties = { padding: "6px 8px", fontSize: 11, fontWeight: 600, color: "#8c919c", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", borderBottom: "1px solid #e4e7ec" };
const TD: CSSProperties = { padding: "7px 8px", fontSize: 12.5, borderBottom: "1px solid #f0f1f4", verticalAlign: "top" };
const filterChip = (on: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
  cursor: "pointer",
  border: "1px solid " + (on ? "var(--accent)" : "#e4e7ec"),
  background: on ? ACCENT_SOFT : "#fff",
  color: on ? ACCENT_INK : "#5b616e",
});

type RowsState = { key: string | null; rows: ClientDatasheetRow[] | null; error: boolean; truncated: number };

/**
 * #379 (Jeff 2026-11-24) — Build package → Datasheets: the datasheet package
 * as a live preview. Left, the settings: every catalog product on the UNSAVED
 * BOM with a tick for "send its datasheet" (#333's rows, rules and autosave —
 * clientPackageDocsAction, client-package-ui.ts, the hook's package
 * selection). Right, the preview: the package's cover, its index and then each
 * included datasheet's own pages, re-drawn on every tick (datasheet-preview.ts).
 * The downloadable PDF is still built from the SAVED estimate.
 */
export default function PackageDatasheetsTab({ s, active }: { s: EstimatorState; active: boolean }) {
  const { loadedId, sections, packageSelection: sel, setDatasheetsIncluded, selectionSaving, selectionError, retrySelection, status, revNum, contentUnsaved, projectName, docCustName, quoteId, companyName } = s;

  /* ---- datasheet rows: the unsaved BOM, debounced 800 ms, latest wins, only while shown (#333 review H, I, J) ---- */
  const fitted = useMemo(() => (active ? fitBomProjection(projectBom(sections)) : null), [active, sections]);
  const projKey = useMemo(() => (fitted ? bomProjectionKey(fitted.projection) : null), [fitted]);
  const [rs, setRs] = useState<RowsState>({ key: null, rows: null, error: false, truncated: 0 });
  const [retryTick, setRetryTick] = useState(0);
  const seq = useRef(0);
  const firstLoad = rs.rows === null;
  // The read keys on projKey, not the projection's identity — a price edit
  // rebuilds the projection but must not restart (and drop) a read in flight.
  const fittedRef = useRef(fitted);
  useEffect(() => {
    fittedRef.current = fitted;
  }, [fitted]);
  useEffect(() => {
    // Every run bumps seq FIRST, the early return included: a read still in
    // flight for an older BOM (e.g. edited away and back) is then dropped.
    const my = ++seq.current;
    const req = fittedRef.current;
    if (!active || !req || rs.key === projKey) return;
    const timer = setTimeout(
      () => {
        clientPackageDocsAction({ sections: req.projection })
          .then((r) => {
            if (my !== seq.current) return;
            setRs((prev) => (r.ok ? { key: projKey, rows: r.rows, error: false, truncated: req.dropped + r.truncated } : { ...prev, error: true }));
          })
          .catch(() => {
            if (my === seq.current) setRs((prev) => ({ ...prev, error: true }));
          });
      },
      firstLoad ? 0 : 800
    );
    return () => clearTimeout(timer);
    // retryTick re-runs a failed read; rs.key / firstLoad are read, not reacted to beyond the key check.
  }, [active, projKey, retryTick, rs.key, firstLoad]);
  const checking = active && rs.key !== projKey && !rs.error;
  const retry = () => {
    setRs((prev) => ({ ...prev, error: false }));
    setRetryTick((n) => n + 1);
  };

  const views = useMemo(() => (rs.rows ? clientRowViews(rs.rows, sel.excludedDatasheets) : []), [rs.rows, sel.excludedDatasheets]);
  const [filter, setFilter] = useState<DatasheetFilter>("all");
  const filtered = useMemo(() => filterRowViews(views, filter), [views, filter]);
  const counts = useMemo(() => datasheetCounts(views), [views]);
  const items = useMemo(() => datasheetListItems(filtered), [filtered]);
  const preview = useMemo(() => datasheetPreview(views), [views]);
  const [showPages, setShowPages] = useState(true);

  /* #333 review (D): a toggle that would pass a cap is blocked with its reason. */
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const setIncluded = (skus: string[], included: boolean) => setLimitMsg(setDatasheetsIncluded(skus, included));
  const leaveOutTargets = bulkTargets(filtered, "leaveOut");
  const leaveOutRefusal = leaveOutTargets.length ? excludeRefusal(sel.excludedDatasheets, leaveOutTargets) : null;

  const sent = status === "sent" || status === "won" || status === "lost";
  const saveTick = !loadedId ? COPY.ridesSave : selectionSaving ? COPY.saving : selectionError ? COPY.saveFailed : COPY.saved;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "#f7f8fa" }}>
      {/* Left: the settings */}
      <aside aria-label={TAB.settings} className="est-scroll" style={{ width: 400, flexShrink: 0, overflowY: "auto", background: "#fff", borderRight: "1px solid #e4e7ec", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ ...H2, marginRight: "auto" }}>{TAB.settings}</h2>
          <span role="status" style={{ ...HINT, color: selectionError ? "#a33a2b" : "#8c919c" }}>
            {saveTick}
          </span>
        </div>
        <span style={HINT}>{TAB.settingsHint}</span>
        {sent && (
          <div role="note" style={{ fontSize: 12, color: "#7a5a12", background: "#fdf6e7", border: "1px solid #f0e2bf", borderRadius: 8, padding: "7px 12px" }}>
            {COPY.sentNote(revNum)}
          </div>
        )}
        {rs.rows && <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a" }}>{datasheetCountsLine(counts)}</span>}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <div role="group" aria-label="Show" style={{ display: "flex", gap: 4, marginRight: "auto" }}>
            {DATASHEET_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={filterChip(filter === f)}>
                {DATASHEET_FILTER_LABEL[f]}
              </button>
            ))}
          </div>
          <button type="button" style={SMALL_BTN} disabled={!bulkTargets(filtered, "include").length} onClick={() => setIncluded(bulkTargets(filtered, "include"), true)}>
            {COPY.includeAll}
          </button>
          <button type="button" style={SMALL_BTN} disabled={!leaveOutTargets.length || !!leaveOutRefusal} title={leaveOutRefusal ?? undefined} onClick={() => setIncluded(leaveOutTargets, false)}>
            {COPY.leaveAllOut}
          </button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
          <input type="checkbox" checked={showPages} onChange={(e) => setShowPages(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
          {TAB.showPages}
        </label>
        {selectionError && (
          <span role="alert" style={{ ...HINT, color: "#a33a2b" }}>
            {COPY.selectionFailed} {selectionError}{" "}
            <button type="button" onClick={retrySelection} style={{ ...SMALL_BTN, padding: "2px 8px" }}>
              {COPY.retry}
            </button>
          </span>
        )}
        {(limitMsg || leaveOutRefusal) && (
          <span role="alert" style={{ ...HINT, color: "#a33a2b" }}>
            {limitMsg || leaveOutRefusal}
          </span>
        )}
        {rs.rows && rs.truncated > 0 && (
          <span role="note" style={{ ...HINT, color: "#8a6d1f", fontWeight: 600 }}>
            {COPY.truncated(rs.truncated)}
          </span>
        )}
        {checking && <span style={HINT}>{COPY.checking}</span>}
        {rs.error && (
          <span role="alert" style={{ ...HINT, color: "#a33a2b" }}>
            {COPY.loadFailed}{" "}
            <button type="button" onClick={retry} style={{ ...SMALL_BTN, padding: "2px 8px" }}>
              {COPY.retry}
            </button>
          </span>
        )}
        {rs.rows && rs.rows.length === 0 && <span style={HINT}>{COPY.noRows}</span>}
        {rs.rows && rs.rows.length > 0 && filtered.length === 0 && <span style={HINT}>{COPY.noFiltered}</span>}
        {items.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {items.map((it) =>
              it.kind === "header" ? (
                <li key={it.key} style={{ fontSize: 11.5, fontWeight: 700, color: "#5b616e", padding: "8px 0 2px" }}>
                  {it.text}
                </li>
              ) : (
                <li key={it.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", paddingLeft: it.indent ? 18 : 0, borderTop: "1px solid #f0f1f4", opacity: it.view.checked || !it.view.selectable ? 1 : 0.7 }}>
                  {it.view.row.state === "not-needed" ? (
                    <span aria-hidden="true" style={{ width: 15, flexShrink: 0 }} />
                  ) : (
                    <input
                      type="checkbox"
                      checked={it.view.checked}
                      disabled={!it.view.selectable}
                      title={it.view.lockReason ?? undefined}
                      aria-label={`Send the ${it.view.row.model || it.view.row.sku} datasheet`}
                      onChange={(e) => setIncluded([it.view.row.sku], e.target.checked)}
                      style={{ marginTop: 2, accentColor: "var(--accent)", flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 12.5, color: "#16181d" }}>
                      {[it.view.row.mfr, it.view.row.model].filter(Boolean).join(" · ")}
                      <span style={{ color: "#8c919c" }}> · {it.view.row.label}</span>
                    </span>
                    <span style={{ fontSize: 11.5, color: "#5b616e", display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                      {it.view.status.kind === "link" ? (
                        <a href={it.view.status.href} target="_blank" rel="noopener noreferrer" style={{ ...LINK, fontSize: 11.5 }}>
                          {it.view.status.name} ↗
                        </a>
                      ) : (
                        <span style={it.view.row.state === "missing" && !it.view.effect ? { color: "#8a6d1f", fontWeight: 600 } : undefined}>{it.view.status.text}</span>
                      )}
                      {it.view.effect && <span style={{ fontWeight: 600, color: "#a33a2b" }}>{it.view.effect}</span>}
                    </span>
                  </div>
                </li>
              )
            )}
          </ul>
        )}
      </aside>

      {/* Right: the live preview */}
      <div className="est-scroll" data-testid="datasheets-preview" style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "18px 16px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div role="note" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", fontSize: 12, color: "#5b616e", lineHeight: 1.45 }}>
            <span>
              <strong style={{ color: "#16181d" }}>{TAB.live}</strong> — {TAB.liveNote}
            </span>
            {loadedId ? (
              <>
                <a href={quoteDatasheetsPdfPath(loadedId)} download data-testid="datasheets-pdf" style={LINK}>
                  {BOOK_COVER_COPY.estimateButton}
                </a>
                {(contentUnsaved || selectionSaving) && <span style={{ color: "#8a6d1f" }}>{TAB.saveFirst}</span>}
              </>
            ) : (
              <span aria-disabled="true" style={{ color: "#9aa0ab", fontWeight: 600 }}>
                {BOOK_COVER_COPY.estimateButton} — {TAB.saveToCreate}
              </span>
            )}
          </div>

          {/* Cover */}
          <section aria-label={TAB.cover} style={{ ...PAGE, display: "flex", flexDirection: "column", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={letterhead.src} alt={companyName} style={{ width: "100%", height: "auto", display: "block" }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".08em" }}>{TAB.coverTitle}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#16181d", marginTop: 4 }}>{projectName.trim() || TAB.untitled}</div>
              <div style={{ fontSize: 13, color: "#5b616e", marginTop: 6, fontFamily: "var(--font-mono)" }}>{[quoteId, `Rev ${revNum}`].filter(Boolean).join(" · ")}</div>
            </div>
            {docCustName.trim() && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em" }}>{BOOK_COVER_COPY.preparedFor}</div>
                <div style={{ fontSize: 14, color: "#16181d", marginTop: 2 }}>{docCustName}</div>
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "#5b616e" }}>{rs.rows ? TAB.coverCount(preview.sheets.length) : COPY.checking}</div>
          </section>

          {/* Index */}
          <section aria-label={TAB.index} style={PAGE}>
            <h2 style={{ ...H2, marginBottom: 10 }}>{TAB.index}</h2>
            {!rs.rows ? (
              <span style={HINT}>{rs.error ? COPY.loadFailed : COPY.checking}</span>
            ) : preview.sheets.length === 0 ? (
              <span style={HINT}>{TAB.nothing}</span>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...TH, width: 34 }}>#</th>
                    <th scope="col" style={TH}>Manufacturer</th>
                    <th scope="col" style={TH}>Model</th>
                    <th scope="col" style={TH}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sheets.map((d, i) => (
                    <tr key={d.sku}>
                      <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "#8c919c" }}>{i + 1}</td>
                      <td style={TD}>{d.mfr}</td>
                      <td style={TD}>
                        <a href={`#${d.anchor}`} style={LINK}>
                          {d.model || d.sku}
                        </a>
                      </td>
                      <td style={{ ...TD, color: "#5b616e" }}>{d.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.missing.length > 0 && (
              <div role="note" style={{ marginTop: 12, fontSize: 12, color: "#7a5a12", background: "#fdf6e7", border: "1px solid #f0e2bf", borderRadius: 8, padding: "8px 12px" }}>
                <strong>{TAB.missing(preview.missing.length)}</strong> {preview.missing.map((m) => m.model || m.sku).join(", ")}
              </div>
            )}
          </section>

          {/* Pages */}
          {showPages &&
            preview.sheets.map((d, i) => (
              <section key={d.sku} id={d.anchor} aria-label={`${d.model || d.sku} datasheet`} style={{ ...PAGE, padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 16px", borderBottom: "1px solid #e4e7ec" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#8c919c" }}>{i + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#16181d", flex: 1, minWidth: 0 }}>{[d.mfr, d.model || d.sku].filter(Boolean).join(" · ")}</span>
                  <a href={d.href} target="_blank" rel="noopener noreferrer" style={LINK}>
                    {TAB.open}
                  </a>
                </div>
                {d.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.href} alt={`${d.model || d.sku} datasheet`} loading="lazy" style={{ width: "100%", height: "auto", display: "block" }} />
                ) : (
                  <iframe src={d.href} title={`${d.model || d.sku} datasheet`} loading="lazy" style={{ display: "block", width: "100%", height: 1000, border: "none", background: "#fff" }} />
                )}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
