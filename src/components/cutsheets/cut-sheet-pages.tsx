import type { CSSProperties } from "react";
import { TitleBlock } from "@/components/drawing/title-block";
import { cutSheetCssVars, type CutSheetModel, type CutSheetStyle } from "@/lib/curtain-cut-sheets/model";
import { MOUNT_DETAIL_VIEWBOX } from "@/lib/curtain-cut-sheets/mount-details";
import { ShapeSvg } from "./shape-svg";

/** Submittal: one Letter-landscape sheet per page, edge to edge. */
export const SUBMITTAL_PRINT_CSS = `@media print { @page { size: 11in 8.5in; margin: 0; } html, body { background: #fff !important; margin: 0; } nextjs-portal { display: none !important; } .pk-no-print { display: none !important; } .pk-cs-set { zoom: 1 !important; display: block !important; padding: 0 !important; } }`;
/** Client: Letter portrait at the quote's own 0.6in margins (QUOTE_PRINT_CSS), so the pages can follow the estimate. */
export const CLIENT_PRINT_CSS = `@media print { @page { size: letter; margin: 0.6in; } html, body { background: #fff !important; margin: 0; } nextjs-portal { display: none !important; } .pk-no-print { display: none !important; } .pk-cs-set { display: block !important; padding: 0 !important; } .pk-cs-client { box-shadow: none !important; padding: 0 !important; width: auto !important; margin: 0 !important; } }`;

const detailBox = `0 0 ${MOUNT_DETAIL_VIEWBOX.w} ${MOUNT_DETAIL_VIEWBOX.h}`;

export function CutSheetPages({ models, style, photos }: { models: CutSheetModel[]; style: CutSheetStyle; photos: ReadonlyMap<string, string[]> }) {
  return (
    <div className="pk-cs-set" data-style={style}>
      {models.map((m) => (style === "submittal" ? <SubmittalSheet key={m.sheetNo} m={m} /> : <ClientSheet key={m.sheetNo} m={m} photos={photos.get(m.sheetNo) ?? []} />))}
    </div>
  );
}

function Elevation({ m, maxHeight }: { m: CutSheetModel; maxHeight: string }) {
  const { box } = m.elevation;
  return (
    <ShapeSvg idPrefix={`${m.sheetNo}-${m.style}-elev`} shapes={m.elevation.shapes} viewBox={`0 0 ${box.wIn} ${box.hIn}`} hatch={0.05} style={{ width: "100%", height: "auto", maxHeight }} title={`Elevation — ${m.title}`} />
  );
}

function SizeTable({ m }: { m: CutSheetModel }) {
  return (
    <table className="pk-dw-table">
      <thead>
        <tr><th>Finished size</th><th style={{ textAlign: "right" }}>Qty</th></tr>
      </thead>
      <tbody>
        {m.sizes.map((s) => (
          <tr key={s.size}><td>{s.size}</td><td style={{ textAlign: "right" }}>{s.qty}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function SubmittalSheet({ m }: { m: CutSheetModel }) {
  return (
    <section className="pk-drawing-sheet" data-sheet={m.sheetNo} style={cutSheetCssVars() as CSSProperties}>
      <div className="pk-drawing-frame">
        <div className="pk-drawing-area">
          <div className="pk-cs-grid">
            <div className="pk-cs-cell">
              <h2 className="pk-dw-h">{`Elevation — ${m.title}`}</h2>
              <Elevation m={m} maxHeight="3.9in" />
              <div className="pk-dw-mono">{`Elevation ${m.elevation.scale}`}</div>
            </div>
            <div className="pk-cs-cell">
              <h2 className="pk-dw-h">{`Mounting detail — ${m.mount.label}`}</h2>
              <ShapeSvg idPrefix={`${m.sheetNo}-detail`} shapes={m.mount.detail.shapes} labels={m.mount.detail.labels} viewBox={detailBox} hatch={6} style={{ width: "100%", height: "auto", maxHeight: "3.4in" }} title={m.mount.detail.title} />
              {m.mount.detail.note && <div style={{ fontStyle: "italic" }}>{m.mount.detail.note}</div>}
              <div className="pk-dw-mono">NTS</div>
            </div>
            <div className="pk-cs-cell">
              <h2 className="pk-dw-h">Materials</h2>
              <table className="pk-dw-table">
                <tbody>
                  {m.materials.map((r) => (
                    <tr key={r.label}><th style={{ textAlign: "left", width: "30%" }}>{r.label}</th><td>{r.value}</td></tr>
                  ))}
                </tbody>
              </table>
              {/* The Finished size row reads "See schedule" exactly when there are several sizes. */}
              {m.sizes.length > 1 && (
                <>
                  <h2 className="pk-dw-h" style={{ marginTop: "6pt" }}>Size schedule</h2>
                  <SizeTable m={m} />
                </>
              )}
            </div>
            <div className="pk-cs-cell">
              {m.hardware.length > 0 && (
                <>
                  <h2 className="pk-dw-h">Mounting hardware</h2>
                  <table className="pk-dw-table">
                    <thead>
                      <tr><th>Part</th><th>Description</th><th style={{ textAlign: "right" }}>Qty</th><th>Unit</th></tr>
                    </thead>
                    <tbody>
                      {m.hardware.map((h) => (
                        <tr key={h.sku}><td className="pk-dw-mono">{h.sku}</td><td>{h.desc}</td><td style={{ textAlign: "right" }}>{h.qty.toLocaleString("en-US")}</td><td>{h.unit}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
        {m.titleBlock && <TitleBlock data={m.titleBlock} />}
      </div>
    </section>
  );
}

function ClientSheet({ m, photos }: { m: CutSheetModel; photos: string[] }) {
  return (
    <section className="pk-cs-client" data-sheet={m.sheetNo}>
      <header className="pk-cs-head">
        {m.header.logoDark ? (
          // Data-URL brand mark from Settings → Branding (title-block idiom).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.header.logoDark} alt={m.header.companyName || "Company logo"} style={{ maxHeight: "0.5in", maxWidth: "2.2in" }} />
        ) : (
          <strong>{m.header.companyName}</strong>
        )}
        <span>{`Curtain cut sheet · ${m.header.estimateNo}`}</span>
      </header>
      <h1 className="pk-cs-title">{m.title}</h1>
      <Elevation m={m} maxHeight="3.6in" />
      <p className="pk-cs-desc">{m.description}</p>
      <div className="pk-cs-row">
        <div>
          <h2 className="pk-dw-h">How it hangs</h2>
          <ShapeSvg idPrefix={`${m.sheetNo}-client-detail`} shapes={m.mount.detail.shapes} labels={m.mount.detail.labels} viewBox={detailBox} hatch={6} style={{ width: "2.4in", height: "3in" }} title={m.mount.detail.title} />
        </div>
        <div style={{ flex: 1 }}>
          {/* "Size schedule" whenever there are several sizes — the elevation's "Typical — N sizes, see schedule" points here. */}
          <h2 className="pk-dw-h">{m.sizes.length > 1 ? "Size schedule" : "Sizes"}</h2>
          <SizeTable m={m} />
        </div>
      </div>
      {photos.length > 0 && (
        <div className="pk-cs-photos">
          {photos.map((src) => (
            // Part photos from the catalog (or inlined data: URLs on the print route).
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" />
          ))}
        </div>
      )}
    </section>
  );
}
