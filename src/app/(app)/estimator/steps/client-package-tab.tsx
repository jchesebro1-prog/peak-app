"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clientPackageDocsAction } from "../client-package-actions";
import { PdfLineDetailGroup } from "../preview-doc";
import { PackageStaffPanel } from "../package-staff-panel";
import { PAYMENT_TERMS } from "../types";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";
import type { EstimatorState } from "../use-estimator-state";
import { bomProjectionKey, fitBomProjection, projectBom } from "@/lib/estimate-output/bom-projection";
import {
  bulkTargets,
  CLIENT_PACKAGE_ANCHOR_IDS,
  CLIENT_PACKAGE_ANCHORS as ANCHOR,
  CLIENT_PACKAGE_COPY as COPY,
  clientRowViews,
  DATASHEET_FILTER_LABEL,
  DATASHEET_FILTERS,
  datasheetCounts,
  datasheetCountsLine,
  datasheetListItems,
  filterRowViews,
  systemListItems,
  type DatasheetFilter,
} from "@/lib/estimate-output/client-package-ui";
import type { ClientDatasheetRow } from "@/lib/estimate-output/package-preview";
import { excludeRefusal, PACKAGE_SUMMARY_LABEL, packageSummaryLine, selectionKey } from "@/lib/estimate-output/package-selection";

const H2: CSSProperties = { margin: 0, fontSize: 11, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em" };
const CARD: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12 };
const HINT: CSSProperties = { fontSize: 11.5, color: "#8c919c", lineHeight: 1.45 };
const ROW_TITLE: CSSProperties = { fontSize: 13, fontWeight: 600, color: "#16181d" };
const LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none", fontSize: 12 };
const CHIP: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" };
const SMALL_BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" };
const seg = (on: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  padding: "4px 11px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  background: on ? "#fff" : "transparent",
  color: on ? "#16181d" : "#8c919c",
  boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
});
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

/** On / off switch (role="switch"), the accent when on. */
function Switch({ on, onChange, label, disabled, title }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        flexShrink: 0,
        width: 34,
        height: 20,
        borderRadius: 999,
        border: "none",
        padding: 2,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        background: on ? "var(--accent)" : "#d5d9e0",
        display: "flex",
        justifyContent: on ? "flex-end" : "flex-start",
      }}
    >
      <span style={{ width: 16, height: 16, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
    </button>
  );
}

function DocRow({ title, hint, on, onChange, disabled, disabledTitle, link, children }: {
  title: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledTitle?: string;
  link?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0", borderTop: "1px solid #f0f1f4" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Switch on={on} onChange={onChange} label={title} disabled={disabled} title={disabled ? disabledTitle : undefined} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={ROW_TITLE}>{title}</span>
          <span style={HINT}>{disabled && disabledTitle ? disabledTitle : hint}</span>
        </div>
        {link}
      </div>
      {children}
    </div>
  );
}

type RowsState = { key: string | null; rows: ClientDatasheetRow[] | null; error: boolean; truncated: number };

/**
 * #333 (spec 2026-10-12 §4.4) — Build package → Client package: one checklist
 * of everything the client gets on this project. Documents (estimate / cover
 * PDF attachment defaults, the BOM appendix, cut sheets, drawings + their
 * management), Systems (the ONE presentation editor, D-TBD-b), the estimate
 * PDF's line detail, package tools, and per-product Datasheets built from the
 * UNSAVED BOM (clientPackageDocsAction, debounced while this tab shows). The
 * package selection autosaves through the hook (latest wins); presentation and
 * line detail ride Save, as before. Rules: client-package-ui.ts.
 */
export default function ClientPackageTab({ s, active }: { s: EstimatorState; active: boolean }) {
  const {
    loadedId,
    sections,
    groups,
    packageSelection: sel,
    setPackageSwitch,
    setDatasheetsIncluded,
    selectionSaving,
    selectionError,
    retrySelection,
    setSystemPresentation,
    pdfItemizedAppendix,
    pdfCutSheets,
    cutSheetCount,
    togglePdf,
    status,
    revNum,
    setPdf,
  } = s;

  /* ---- datasheet rows: the unsaved BOM, debounced 800 ms, latest wins, only while shown ----
     #333 review: the projection and its key are built only while the tab shows
     (H); it is fitted to a byte budget, and what it or the server's caps drop
     is counted and shown (J); every run bumps seq first, so a read still in
     flight for an older BOM is dropped (I). */
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

  /* ---- drawings count (from the staff panel) + its refresh once a selection write lands ---- */
  const [drawingCount, setDrawingCount] = useState<number | null>(null);
  const liveKey = selectionKey(sel);
  const [panelKey, setPanelKey] = useState(liveKey);
  if (!selectionSaving && panelKey !== liveKey) setPanelKey(liveKey);

  const systems = useMemo(() => systemListItems(sections, groups), [sections, groups]);
  const summary = packageSummaryLine({
    sel,
    pdfItemizedAppendix,
    pdfCutSheets,
    cutSheetCount,
    drawingCount: drawingCount ?? 0,
    datasheets: rs.rows ? counts : null,
  });

  // Arriving with #systems (the narrative column's / Build card's link) scrolls there.
  useEffect(() => {
    if (!active) return;
    const id = window.location.hash.slice(1);
    if (CLIENT_PACKAGE_ANCHOR_IDS.includes(id)) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [active]);

  /* #333 review (D): a toggle that would pass a cap is blocked with its reason. */
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const setIncluded = (skus: string[], included: boolean) => setLimitMsg(setDatasheetsIncluded(skus, included));
  const leaveOutTargets = bulkTargets(filtered, "leaveOut");
  const leaveOutRefusal = leaveOutTargets.length ? excludeRefusal(sel.excludedDatasheets, leaveOutTargets) : null;

  /* #333 review (E): a failed write shows by the Documents switches and the Datasheets header, with Retry. */
  const selectionAlert = (
    <span role="alert" style={{ ...HINT, color: "#a33a2b" }}>
      {COPY.selectionFailed} {selectionError}{" "}
      <button type="button" onClick={retrySelection} style={{ ...SMALL_BTN, padding: "2px 8px" }}>
        {COPY.retry}
      </button>
    </span>
  );

  const sent = status === "sent" || status === "won" || status === "lost";
  const saveTick = !loadedId ? COPY.ridesSave : selectionSaving ? COPY.saving : selectionError ? COPY.saveFailed : COPY.saved;

  return (
    <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#f7f8fa" }}>
      <style>{`.cpk-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}@media (min-width:1200px){.cpk-grid{grid-template-columns:minmax(360px,460px) minmax(0,1fr)}}`}</style>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "16px 18px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div data-testid="client-package-summary" style={{ fontSize: 13, color: "#3a3f4a", lineHeight: 1.5 }}>
          <strong style={{ color: "#16181d" }}>{PACKAGE_SUMMARY_LABEL}</strong> {summary}
        </div>
        {sent && (
          <div role="note" style={{ fontSize: 12, color: "#7a5a12", background: "#fdf6e7", border: "1px solid #f0e2bf", borderRadius: 8, padding: "7px 12px" }}>
            {COPY.sentNote(revNum)}
          </div>
        )}
        <div className="cpk-grid">
          {/* Left: the checklist */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <section id={ANCHOR.documents} aria-labelledby="cpk-documents" style={CARD}>
              <h2 id="cpk-documents" style={H2}>
                {COPY.documents}
              </h2>
              {selectionError && selectionAlert}
              <DocRow title={COPY.estimatePdf} hint={COPY.estimatePdfHint} on={sel.estimatePdf} onChange={(v) => setPackageSwitch("estimatePdf", v)} />
              <DocRow
                title={COPY.coverPdf}
                hint={COPY.coverPdfHint}
                on={sel.coverPdf}
                onChange={(v) => setPackageSwitch("coverPdf", v)}
                link={
                  loadedId ? (
                    <a href={`/api/quotes/${encodeURIComponent(loadedId)}/cover-pdf`} target="_blank" rel="noopener noreferrer" style={LINK}>
                      {COPY.download}
                    </a>
                  ) : undefined
                }
              />
              <DocRow title={COPY.appendix} hint={COPY.appendixHint} on={pdfItemizedAppendix} onChange={() => togglePdf("pdfItemizedAppendix")} />
              <DocRow
                title={COPY.cutSheets(cutSheetCount)}
                hint={COPY.cutSheetsHint}
                on={pdfCutSheets && cutSheetCount > 0}
                onChange={() => togglePdf("pdfCutSheets")}
                disabled={cutSheetCount === 0}
                disabledTitle={COPY.noCurtains}
                link={
                  loadedId && cutSheetCount > 0 ? (
                    <a href={`/estimator/cut-sheets?id=${encodeURIComponent(loadedId)}&style=client`} target="_blank" rel="noreferrer" style={LINK}>
                      {COPY.viewCutSheets}
                    </a>
                  ) : undefined
                }
              />
              <DocRow title={COPY.drawings(loadedId ? drawingCount : null)} hint={COPY.drawingsHint} on={sel.drawings} onChange={(v) => setPackageSwitch("drawings", v)}>
                <div style={{ paddingLeft: 44 }}>
                  {loadedId ? (
                    <PackageStaffPanel quoteId={loadedId} section="documents" refreshKey={panelKey} onFiles={setDrawingCount} onPdf={setPdf} />
                  ) : (
                    <span style={HINT}>{COPY.saveForDrawings}</span>
                  )}
                </div>
              </DocRow>
            </section>

            <section id={ANCHOR.systems} aria-labelledby="cpk-systems" style={CARD}>
              <h2 id="cpk-systems" style={H2}>
                {COPY.systems}
              </h2>
              {systems.length === 0 && <span style={HINT}>{COPY.noSystems}</span>}
              {systems.map((it) =>
                it.kind === "group" ? (
                  <div key={it.key} style={{ fontSize: 11.5, fontWeight: 700, color: "#5b616e", paddingTop: 4 }}>
                    {it.name}
                  </div>
                ) : (
                  <div key={it.key} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ flex: "1 1 140px", minWidth: 0, fontSize: 13, color: "#16181d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                    {it.alternate && <span style={{ ...CHIP, color: "#5b616e", background: "#f1f2f5", borderColor: "#e4e7ec" }}>{COPY.alternate}</span>}
                    {it.noIntro && <span style={CHIP}>{COPY.noIntro}</span>}
                    {it.unpriced && <span style={{ ...CHIP, color: "#5b616e", background: "#f1f2f5", borderColor: "#e4e7ec" }}>{COPY.unpriced}</span>}
                    <div role="group" aria-label={`${it.name} prints as`} style={{ display: "flex", background: "#f1f2f5", borderRadius: 8, padding: 2 }}>
                      <button type="button" aria-pressed={it.presentation === "narrative"} onClick={() => setSystemPresentation(it.id, "narrative")} style={seg(it.presentation === "narrative")}>
                        {COPY.narrative}
                      </button>
                      <button type="button" aria-pressed={it.presentation === "itemized"} onClick={() => setSystemPresentation(it.id, "itemized")} style={seg(it.presentation === "itemized")}>
                        {COPY.itemized}
                      </button>
                    </div>
                  </div>
                )
              )}
            </section>

            <section id={ANCHOR.lineDetail} aria-labelledby="cpk-line-detail" style={CARD}>
              <h2 id="cpk-line-detail" style={H2}>
                {COPY.lineDetail}
              </h2>
              <PdfLineDetailGroup
                detail={s.detail}
                setDetail={s.setDetail}
                pdfQty={s.pdfQty}
                pdfNotes={s.pdfNotes}
                pdfPrices={s.pdfPrices}
                pdfCover={s.pdfCover}
                pdfTerms={s.pdfTerms}
                pdfOptions={s.pdfOptions}
                paymentTerms={s.paymentTerms}
                paymentTermsOptions={PAYMENT_TERMS}
                setPaymentTerms={s.setPaymentTerms}
                togglePdf={togglePdf}
              />
            </section>
          </div>

          {/* Right: Datasheets */}
          <section id={ANCHOR.datasheets} aria-labelledby="cpk-datasheets" style={{ ...CARD, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h2 id="cpk-datasheets" style={{ ...H2, marginRight: "auto" }}>
                {COPY.datasheets}
              </h2>
              <span role="status" style={{ ...HINT, color: selectionError ? "#a33a2b" : "#8c919c" }}>
                {saveTick}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              {rs.rows && <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", marginRight: "auto" }}>{datasheetCountsLine(counts)}</span>}
              <div role="group" aria-label="Show" style={{ display: "flex", gap: 4 }}>
                {DATASHEET_FILTERS.map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={filterChip(filter === f)}>
                    {DATASHEET_FILTER_LABEL[f]}
                  </button>
                ))}
              </div>
              <button type="button" style={SMALL_BTN} disabled={!bulkTargets(filtered, "include").length} onClick={() => setIncluded(bulkTargets(filtered, "include"), true)}>
                {COPY.includeAll}
              </button>
              <button
                type="button"
                style={SMALL_BTN}
                disabled={!leaveOutTargets.length || !!leaveOutRefusal}
                title={leaveOutRefusal ?? undefined}
                onClick={() => setIncluded(leaveOutTargets, false)}
              >
                {COPY.leaveAllOut}
              </button>
            </div>
            {selectionError && selectionAlert}
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
                    <li
                      key={it.key}
                      style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", paddingLeft: it.indent ? 18 : 0, borderTop: "1px solid #f0f1f4", opacity: it.view.checked || !it.view.selectable ? 1 : 0.7 }}
                    >
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
          </section>
        </div>
      </div>
    </div>
  );
}
