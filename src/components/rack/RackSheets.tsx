import type { CSSProperties } from "react";
import { TitleBlock } from "@/components/drawing/title-block";
import { cutSheetCssVars } from "@/lib/curtain-cut-sheets/model";
import { titleBlockData } from "@/lib/design/grid-drawing-set";
import { emptyRackLayout } from "@/lib/rack/layout";
import type { LoadedRackSheets } from "@/lib/rack/load";
import {
  RACK_SHEET_NOTE,
  rackCell,
  rackIssuesForSheet,
  rackMissingLine,
  rackSheetFooter,
  rackText,
  rackTotalsRows,
  type RackSheetKind,
} from "@/lib/rack/sheet-format";
import { elevationSvgFor } from "@/lib/rack/svg";
import type { RackFace } from "@/lib/rack/types";

/**
 * #296 — the printed rack submittal sheets: the elevation (Letter landscape,
 * title block), the equipment schedule (Letter landscape) and the power/heat
 * summary (Letter portrait). Server-renderable, never a client module; the CSS
 * lives in `rack-sheet-css.ts`. The elevation draws through `elevationSvgFor`,
 * the same call the builder sidebar makes, so screen and paper match.
 * Text a harness matches is one template string (React's server renderer
 * puts <!-- --> between adjacent text nodes).
 */
export type RackSheetsData = Pick<LoadedRackSheets, "rec" | "lookup" | "submittal" | "dateLabel" | "now" | "company">;

export function RackSheets({ sheet, data }: { sheet: RackSheetKind | "all"; data: RackSheetsData }) {
  const footer = rackSheetFooter(data.company.name, data.rec.label, data.dateLabel);
  return (
    <div className="rk-set">
      {(sheet === "all" || sheet === "elevation") && <ElevationSheet data={data} footer={footer} />}
      {(sheet === "all" || sheet === "schedule") && <ScheduleSheet data={data} footer={footer} />}
      {(sheet === "all" || sheet === "power") && <PowerSheet data={data} footer={footer} />}
    </div>
  );
}

function SheetHead({ data, title }: { data: RackSheetsData; title: string }) {
  const { company } = data;
  return (
    <header className="rk-head">
      {company.logoDark ? (
        // Data-URL brand mark from Settings → Branding (title-block idiom).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={company.logoDark} alt={company.name || "Company logo"} />
      ) : (
        <strong style={{ color: "#16181d" }}>{company.name}</strong>
      )}
      <span>{title}</span>
    </header>
  );
}

function metaLine(data: RackSheetsData): string {
  const s = data.submittal;
  return [s.scope, `${s.ruCount} RU`, data.dateLabel].filter(Boolean).join(" · ");
}

/* ---------- elevation ---------- */

function ElevationSheet({ data, footer }: { data: RackSheetsData; footer: string }) {
  const { rec, lookup } = data;
  const layout = rec.rack ?? emptyRackLayout();
  const faces: RackFace[] = layout.placements.some((p) => p.face === "rear") ? ["front", "rear"] : ["front"];
  const tb = titleBlockData({
    company: data.company,
    project: { id: rec.id, name: rec.label, customer: "", siteName: data.submittal.scope || "", intake: null, createdBy: rec.createdBy || "" },
    option: { name: "", quoteId: null },
    optionCount: 1,
    revisions: [],
    set: undefined,
    sheet: { number: "R-1", title: "Rack elevation", scale: "NTS" },
    index: 1,
    total: 1,
    now: data.now,
  });
  return (
    <section className="pk-drawing-sheet rk-sheet" data-sheet="elevation" style={cutSheetCssVars() as CSSProperties}>
      <div className="pk-drawing-frame">
        <div className="pk-drawing-area">
          <div className="rk-elev">
            <div>
              <h2 className="pk-dw-h">{`Rack elevation — ${rec.label}`}</h2>
              <div className="rk-meta" style={{ margin: 0 }}>{`${metaLine(data)} · ${layout.config.widthIn} in rack`}</div>
            </div>
            <div className="rk-elev-figs">
              {faces.map((face) => (
                <figure key={face} className="rk-elev-fig">
                  <figcaption>{face === "front" ? "Front" : "Rear"}</figcaption>
                  {/* dangerouslySetInnerHTML is safe: svg.ts is our own serializer and escapes every text and attribute value. */}
                  <div className="rk-elev-svg" dangerouslySetInnerHTML={{ __html: elevationSvgFor(layout, lookup, face, { idPrefix: `rk-print-${face}` }) }} />
                </figure>
              ))}
            </div>
            <Legend rear={faces.length > 1} />
            <div className="rk-note">{RACK_SHEET_NOTE}</div>
            <div className="rk-foot">{footer}</div>
          </div>
        </div>
        <TitleBlock data={tb} />
      </div>
    </section>
  );
}

const SW = { width: 26, height: 14 } as const;

function Legend({ rear }: { rear: boolean }) {
  return (
    <div className="rk-legend" aria-label="Legend">
      <span>
        <svg viewBox="0 0 26 14" style={SW} aria-hidden>
          <rect x="1" y="1" width="24" height="12" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" />
        </svg>
        Dashed — optional
      </span>
      <span>
        <svg viewBox="0 0 26 14" style={SW} aria-hidden>
          <defs>
            <pattern id="rk-legend-hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="0.8" />
            </pattern>
          </defs>
          <rect x="1" y="1" width="24" height="12" fill="url(#rk-legend-hatch)" stroke="currentColor" strokeWidth="1" />
        </svg>
        Hatched — reserved for future
      </span>
      <span>
        <svg viewBox="0 0 26 14" style={SW} aria-hidden>
          <rect x="1" y="1" width="24" height="12" fill="#00000014" stroke="currentColor" strokeWidth="1" />
        </svg>
        Toned — blank, vent or shelf
      </span>
      {rear && <span>Thin dashed on the rear — deep front gear seen from behind</span>}
    </div>
  );
}

/* ---------- equipment schedule ---------- */

function ScheduleSheet({ data, footer }: { data: RackSheetsData; footer: string }) {
  const s = data.submittal;
  return (
    <section className="rk-sheet rk-paper" data-sheet="schedule" data-orientation="landscape">
      <SheetHead data={data} title="Equipment schedule" />
      <h1 className="rk-title">{`Equipment schedule — ${data.rec.label}`}</h1>
      <p className="rk-meta">{metaLine(data)}</p>
      {s.schedule.length === 0 ? (
        <p>Nothing is placed in this rack yet.</p>
      ) : (
        <table className="rk-table">
          <colgroup>
            <col style={{ width: "8%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "19%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>RU</th>
              <th>Face</th>
              <th className="rk-num">Qty</th>
              <th>Manufacturer</th>
              <th>Model/SKU</th>
              <th>Description</th>
              <th className="rk-num">Depth (in)</th>
              <th className="rk-num">Weight (lb)</th>
              <th className="rk-num">Watts</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {s.schedule.map((r, i) => (
              <tr key={i} className={r.optional ? "rk-opt" : r.reserved ? "rk-res" : undefined}>
                <td>{r.ru}</td>
                <td>{rackText(r.face)}</td>
                <td className="rk-num">{r.qty}</td>
                <td>{rackText(r.mfr)}</td>
                <td>{rackText(r.sku)}</td>
                <td>{rackText(r.desc)}</td>
                <td className="rk-num">{rackCell(r.depthIn)}</td>
                <td className="rk-num">{rackCell(r.weightLb)}</td>
                <td className="rk-num">{rackCell(r.watts)}</td>
                <td>{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 className="rk-h">Rack-level parts</h2>
      {s.rackLevel.length === 0 ? (
        <p>No rack-level parts.</p>
      ) : (
        <table className="rk-table">
          <colgroup>
            <col style={{ width: "6%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "40%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="rk-num">Qty</th>
              <th>Manufacturer</th>
              <th>Model/SKU</th>
              <th>Description</th>
              <th className="rk-num">Weight (lb)</th>
              <th className="rk-num">Watts</th>
            </tr>
          </thead>
          <tbody>
            {s.rackLevel.map((r, i) => (
              <tr key={i}>
                <td className="rk-num">{r.qty}</td>
                <td>{rackText(r.mfr)}</td>
                <td>{rackText(r.sku)}</td>
                <td>{rackText(r.desc)}</td>
                <td className="rk-num">{rackCell(r.weightLb)}</td>
                <td className="rk-num">{rackCell(r.watts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="rk-foot">{footer}</div>
    </section>
  );
}

/* ---------- power / heat ---------- */

function PowerSheet({ data, footer }: { data: RackSheetsData; footer: string }) {
  const s = data.submittal;
  const issues = rackIssuesForSheet(s.issues);
  const missing = s.totals.missingData;
  return (
    <section className="rk-sheet rk-paper" data-sheet="power" data-orientation="portrait">
      <SheetHead data={data} title="Power and heat" />
      <h1 className="rk-title">{`Power and heat — ${data.rec.label}`}</h1>
      <p className="rk-meta">{metaLine(data)}</p>
      <div className="rk-totals">
        {rackTotalsRows(s).map((r) => (
          <div key={r.label} className="rk-total">
            <div className="rk-total-label">{r.label}</div>
            <div className="rk-total-value">{r.value}</div>
          </div>
        ))}
      </div>
      <h2 className="rk-h">Summary</h2>
      <ul className="rk-list">
        {s.power.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <h2 className="rk-h">Warnings</h2>
      {issues.length === 0 ? (
        <p>No warnings.</p>
      ) : (
        <ul className="rk-list">
          {issues.map((iss, i) => (
            <li key={`${iss.code}-${i}`}>
              <span className={iss.level === "error" ? "rk-err" : "rk-warn"}>{iss.level === "error" ? "Error: " : "Warning: "}</span>
              {iss.message}
            </li>
          ))}
        </ul>
      )}
      <h2 className="rk-h">Parts missing data</h2>
      {missing.length === 0 ? (
        <p>Every part has RU height, depth, weight and power data.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 4pt" }}>Totals that depend on these read “at least”.</p>
          <ul className="rk-list">
            {missing.map((m) => (
              <li key={m.sku}>{rackMissingLine(m)}</li>
            ))}
          </ul>
        </>
      )}
      <div className="rk-foot">{footer}</div>
    </section>
  );
}
