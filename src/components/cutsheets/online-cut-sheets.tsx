import type { LoadedCutSheets } from "@/lib/curtain-cut-sheets/load";
import { CutSheetPages } from "./cut-sheet-pages";

/**
 * Jeff 2026-10-15 #22 — the Client-style curtain cut sheets under an online
 * estimate, the same sheets the PDF appends (CutSheetPages, Client style,
 * photos inlined). Each sheet keeps its Letter width, so the block scrolls
 * sideways on a phone instead of squeezing the drawing. A server component:
 * the page loads the sheets (onlineCutSheets) and passes the baked
 * letterhead's src.
 */
export function OnlineCutSheets({ loaded, letterheadSrc }: { loaded: LoadedCutSheets; letterheadSrc: string }) {
  const n = loaded.models.client.length;
  return (
    <section aria-label="Curtain cut sheets" className="pk-online-cutsheets" style={{ marginTop: 22, breakBefore: "page" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Curtain cut sheets</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#5b616e" }}>
        {n === 1 ? "One sheet" : `${n} sheets`} — the same pages the PDF includes.
      </p>
      <div style={{ overflowX: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <CutSheetPages models={loaded.models.client} style="client" photos={loaded.photos} letterheadSrc={letterheadSrc} />
      </div>
    </section>
  );
}
