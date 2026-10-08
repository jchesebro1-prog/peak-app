"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  datasheetCell, frameKey, frameSrc, frameWidth, framedTab, REVIEW_DEVICE_LABEL, REVIEW_DEVICES, REVIEW_TAB_LABEL, REVIEW_TABS,
  REVIEW_UI_COPY as COPY, tabNeedsSave, type ReviewDevice, type ReviewTab,
} from "@/lib/estimate-review/review-ui";
import type { DocLinkView, ReviewDatasheetRow, ReviewDrawingRow } from "@/lib/estimate-output/package-preview";
import { PdfPreviewPane } from "../preview-doc";
import type { ReviewDocsResult } from "../review-actions";
import type { EstimatorState } from "../use-estimator-state";

const TAB_BTN = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: active ? "#16181d" : "#5b616e",
  background: active ? "#fff" : "transparent",
  border: active ? "1px solid #e4e7ec" : "1px solid transparent",
  borderRadius: 7,
  padding: "5px 11px",
  cursor: "pointer",
  whiteSpace: "nowrap",
});
const SEG_BTN = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: active ? "#fff" : "#5b616e",
  background: active ? "#2b2e35" : "transparent",
  border: "none",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
});
const NOTE: CSSProperties = { margin: "40px auto", maxWidth: 420, textAlign: "center", fontSize: 13, color: "#5b616e" };
const CELL: CSSProperties = { padding: "7px 10px", fontSize: 12.5, borderBottom: "1px solid #ececf0", verticalAlign: "top", textAlign: "left" };
const HEAD: CSSProperties = { ...CELL, fontSize: 11, fontWeight: 600, color: "#8c919c", textTransform: "uppercase", letterSpacing: ".04em" };
const LINK: CSSProperties = { color: "var(--accent)", textDecoration: "none", fontWeight: 600 };
const MONO: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c" };

/**
 * Estimator Phase 4 (spec §11.1) — the Customer review step's client's-eye
 * tabs, desktop only: Document (the saved estimate PDF, today's pane),
 * Package page / BOM / Cut sheets (the SAVED quote framed from the staff
 * preview route, full width or 390 px for Phone), Datasheets and Drawings
 * (reviewDocsAction, read by the step). Unsaved edits get the banner; the
 * framed tabs and the lists need a saved quote.
 */
export function ReviewTabs({ s, docs }: { s: EstimatorState; docs: ReviewDocsResult | null }) {
  const { doSave, loadedId, next, pdf, pdfDirty, phone, setPdf, statusChanging, tierResolving } = s;
  const [tab, setTab] = useState<ReviewTab>("document");
  const [device, setDevice] = useState<ReviewDevice>("desktop");
  const framed = framedTab(tab);
  const src = frameSrc(loadedId, tab);

  let body: ReactNode;
  if (tab === "document") {
    body = (
      <PdfPreviewPane
        phone={phone}
        canBuild={!phone}
        savedQuoteId={loadedId}
        pdf={pdf}
        onPdf={setPdf}
        dirty={pdfDirty}
        onSave={doSave}
        saveDisabled={statusChanging || tierResolving}
        actionsInline={!phone}
      />
    );
  } else if (tabNeedsSave(tab) && !loadedId) {
    body = <p style={NOTE}>{COPY.saveFirst}</p>;
  } else if (framed && src) {
    body = (
      <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#eef0f3", padding: device === "phone" ? "16px 0" : 0 }}>
        <iframe
          key={frameKey(tab, pdf?.savedAt, next?.asOf)}
          src={src}
          title={`${REVIEW_TAB_LABEL[tab]} — what the client sees`}
          style={{
            display: "block",
            width: frameWidth(device),
            maxWidth: "100%",
            height: "100%",
            boxSizing: "border-box",
            minHeight: 480,
            margin: "0 auto",
            border: device === "phone" ? "1px solid #d8dbe1" : "none",
            borderRadius: device === "phone" ? 14 : 0,
            background: "#fff",
          }}
        />
      </div>
    );
  } else {
    body = (
      <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 22px", background: "#fff" }}>
        {!docs ? (
          <p style={NOTE}>{COPY.checklistLoading}</p>
        ) : !docs.ok ? (
          <p style={NOTE}>{docs.error || COPY.docsError}</p>
        ) : tab === "datasheets" ? (
          <DatasheetsTable rows={docs.datasheets} />
        ) : (
          <DrawingsList rows={docs.drawings} />
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 14px", borderBottom: "1px solid #e4e7ec", background: "#f7f8fa" }}
      >
        <div role="tablist" aria-label="What the client sees" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {REVIEW_TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={TAB_BTN(tab === t)}>
              {REVIEW_TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {framed && (
          <div role="group" aria-label="Frame width" style={{ marginLeft: "auto", display: "flex", gap: 2, padding: 2, background: "#eceef2", borderRadius: 8 }}>
            {REVIEW_DEVICES.map((d) => (
              <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} style={SEG_BTN(device === d)}>
                {REVIEW_DEVICE_LABEL[d]}
              </button>
            ))}
          </div>
        )}
      </div>
      {pdfDirty && tab !== "document" && (
        <div
          role="status"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", fontSize: 12.5, color: "#7a5a12", background: "#fdf6e7", borderBottom: "1px solid #f0e2bf" }}
        >
          <span style={{ flex: 1 }}>{COPY.unsaved}</span>
          <button
            type="button"
            onClick={doSave}
            disabled={statusChanging || tierResolving}
            style={{ ...SEG_BTN(true), cursor: statusChanging || tierResolving ? "not-allowed" : "pointer", opacity: statusChanging || tierResolving ? 0.6 : 1 }}
          >
            {COPY.save}
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{body}</div>
    </div>
  );
}

const docLink = (d: DocLinkView | null) =>
  d ? (
    <a href={d.href} target="_blank" rel="noopener noreferrer" style={LINK}>
      {d.name} ↗
    </a>
  ) : (
    <span style={{ color: "#9aa0ab" }}>—</span>
  );

function DatasheetsTable({ rows }: { rows: ReviewDatasheetRow[] }) {
  if (!rows.length) return <p style={NOTE}>{COPY.noDatasheets}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={HEAD}>Part</th>
            <th style={HEAD}>Datasheet</th>
            <th style={HEAD}>Spec sheet</th>
            <th style={HEAD}>Manual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ds = datasheetCell(r);
            return (
              <tr key={r.sku}>
                <td style={CELL}>
                  <div>{r.label}</div>
                  <div style={MONO}>{r.sku}</div>
                </td>
                <td style={CELL}>
                  {ds.kind === "link" ? (
                    docLink({ href: ds.href, name: ds.name })
                  ) : ds.kind === "note" ? (
                    <span style={{ color: "#5b616e" }}>{ds.text}</span>
                  ) : (
                    <span style={{ color: "#9b3a2a", fontWeight: 600 }}>{ds.text}</span>
                  )}
                </td>
                <td style={CELL}>{docLink(r.specsheet)}</td>
                <td style={CELL}>{docLink(r.manual)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DrawingsList({ rows }: { rows: ReviewDrawingRow[] }) {
  if (!rows.length) return <p style={NOTE}>{COPY.noDrawings}</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((d) => (
        <li key={d.id} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 0", borderBottom: "1px solid #ececf0", fontSize: 13 }}>
          <a href={d.href} target="_blank" rel="noopener noreferrer" style={LINK}>
            {d.name} ↗
          </a>
          <span style={{ fontSize: 12, color: "#5b616e" }}>{d.kindLabel}</span>
          <span style={MONO}>{d.sizeLabel}</span>
        </li>
      ))}
    </ul>
  );
}
