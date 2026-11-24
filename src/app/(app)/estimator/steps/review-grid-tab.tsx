"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { REVIEW_UI_COPY as COPY } from "@/lib/estimate-review/review-ui";
import { resolveCatalogSkusAction } from "../actions";
import { partsListSkus, reviewSheetModel, type PartInfo } from "../parts-csv";
import { REVIEW_GRID_COLUMNS, REVIEW_GRID_NUMERIC, reviewGrid, reviewGridCells } from "../review-grid";
import type { EstimatorState } from "../use-estimator-state";

const CELL: CSSProperties = { padding: "6px 10px", fontSize: 12.5, borderBottom: "1px solid #ececf0", verticalAlign: "top", textAlign: "left" };
const NUM: CSSProperties = { ...CELL, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" };
const HEAD: CSSProperties = {
  ...CELL,
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "#f7f8fa",
  fontSize: 11,
  fontWeight: 600,
  color: "#8c919c",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #e4e7ec",
};
const NOTE: CSSProperties = { margin: "40px auto", maxWidth: 420, textAlign: "center", fontSize: 13, color: "#5b616e" };
/** Minimum widths, by column — the spreadsheet's own proportions. */
const MIN_WIDTH = [120, 130, 260, 90, 120, 50, 80, 80, 90, 90, 64, 150, 60, 220];
const DESC_COL = 2;
const EXT_SELL_COL = 9;
const LINK_COL = 12;
const NOTES_COL = 13;

/**
 * Internal review's Review tab (#378, Jeff 2026-11-23) — the Review
 * spreadsheet on screen: every part and labor row with its cost, sell and
 * markup, then each system's five closing rows. It reads the LIVE estimate
 * (the screen's systems, saved or not), exactly as the download does, and
 * never shows anything to the client.
 */
export function ReviewGridTab({ s }: { s: EstimatorState }) {
  const { exportReviewSheet, projectDiscounts, reviewBusy, sections, vendorQuotes, venueRoomName } = s;
  // Catalog facts (manufacturer, model number) for the SKUs on the estimate; re-read only when that list changes.
  const skuKey = useMemo(() => partsListSkus(sections).join("\n"), [sections]);
  const [info, setInfo] = useState<{ key: string; parts: Record<string, PartInfo> } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const skus = skuKey ? skuKey.split("\n") : [];
    (skus.length ? resolveCatalogSkusAction(skus) : Promise.resolve({})).then(
      (resolved) => {
        if (!live) return;
        const parts: Record<string, PartInfo> = {};
        for (const [sku, r] of Object.entries(resolved as Record<string, PartInfo>)) {
          parts[sku] = { desc: r.desc, mfr: r.mfr, manufacturerPartNumber: r.manufacturerPartNumber, manufacturerModelNumber: r.manufacturerModelNumber };
        }
        setInfo({ key: skuKey, parts });
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      }
    );
    return () => {
      live = false;
    };
  }, [skuKey]);

  const blocks = useMemo(
    () => (info ? reviewGrid(reviewSheetModel(sections, vendorQuotes, info.parts, venueRoomName, projectDiscounts)) : []),
    [info, sections, vendorQuotes, venueRoomName, projectDiscounts]
  );
  const hasAlternates = sections.some((sec) => sec.alternate === true);

  let body;
  if (!info) body = <p style={NOTE}>{failed ? COPY.gridError : COPY.gridLoading}</p>;
  else if (!blocks.length) body = <p style={NOTE}>{COPY.gridEmpty}</p>;
  else
    body = (
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          <tr>
            {REVIEW_GRID_COLUMNS.map((h, c) => (
              <th key={h} scope="col" style={{ ...HEAD, minWidth: MIN_WIDTH[c], textAlign: REVIEW_GRID_NUMERIC.has(c) ? "right" : "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {blocks.map((block) => (
          <tbody key={block.sectionId}>
            {block.rows.map((r) => (
              <tr key={r.key}>
                {reviewGridCells(r).map((v, c) => (
                  <td key={c} style={REVIEW_GRID_NUMERIC.has(c) ? NUM : { ...CELL, overflowWrap: "anywhere" }}>
                    {c === LINK_COL && v ? (
                      <a href={v} target="_blank" rel="noopener noreferrer" title={v} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}>
                        Open ↗
                      </a>
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {block.closing.map((row, i) => {
              const edge: CSSProperties = { fontWeight: 700, background: "#fafbfc", ...(row.rule ? { borderTop: "1px solid #c9cdd6" } : {}), ...(i === block.closing.length - 1 ? { borderBottom: "2px solid #d8dbe1" } : {}) };
              return (
                <tr key={row.key}>
                  {REVIEW_GRID_COLUMNS.map((_, c) => (
                    <td key={c} style={{ ...(c === EXT_SELL_COL ? NUM : CELL), ...edge }}>
                      {c === DESC_COL ? row.label : c === EXT_SELL_COL ? row.amount : c === NOTES_COL ? row.notes : ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid #ececf0", fontSize: 12, color: "#5b616e" }}>
        <span style={{ flex: 1 }}>
          {COPY.gridHint}
          {hasAlternates ? " " + COPY.gridAlternates : ""}
          {info && failed ? " " + COPY.gridStale : ""}
        </span>
        <button
          type="button"
          onClick={() => void exportReviewSheet()}
          disabled={reviewBusy}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#16181d", background: "#f1f2f5", border: "none", borderRadius: 7, padding: "5px 11px", cursor: reviewBusy ? "not-allowed" : "pointer", opacity: reviewBusy ? 0.6 : 1, whiteSpace: "nowrap" }}
        >
          {COPY.gridDownload}
        </button>
      </div>
      <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {body}
      </div>
    </div>
  );
}
