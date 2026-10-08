import Link from "next/link";
import type { CSSProperties } from "react";
import QuoteDocument, { QUOTE_WEB_CSS, type QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { bomViewProps, offersBomView } from "@/app/(app)/estimator/quote-document-view";
import { ONLINE_COPY } from "@/lib/quote-share/view";

/**
 * #293 slice 3 — the online estimate, shared by the portal page and the share
 * page (spec §5.2–§5.3, §5.7). Server components only: the document is
 * QuoteDocument (layout="web"), the Narrative / BOM toggle is two plain links
 * whose BOM transform runs here on the server, and no client component ever
 * receives the quote's data.
 */

const seg: CSSProperties = { display: "inline-flex", background: "#e4e7ec", borderRadius: 8, padding: 2 };
const segItem = (on: boolean): CSSProperties => ({
  fontSize: 12.5,
  fontWeight: 600,
  padding: "6px 14px",
  borderRadius: 6,
  textDecoration: "none",
  color: on ? "#16181d" : "#5b616e",
  background: on ? "#fff" : "transparent",
  boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
});
const plainLink: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" };

export function OnlineEstimateView({
  docProps,
  view,
  headerLine,
  closed,
  narrativeHref,
  bomHref,
  pdfHref,
  backHref,
}: {
  docProps: QuoteDocumentProps;
  view: "narrative" | "bom";
  headerLine: string;
  closed: boolean;
  narrativeHref: string;
  bomHref: string;
  pdfHref: string | null;
  backHref: string | null;
}) {
  const offers = offersBomView(docProps.sections, docProps.detail, docProps.document);
  const showBom = offers && view === "bom";
  const shown = showBom ? bomViewProps(docProps) : docProps;
  return (
    <div>
      <style>{QUOTE_WEB_CSS}</style>
      <div className="pk-no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minWidth: 0 }}>
          {backHref && (
            <Link href={backHref} prefetch={false} style={plainLink}>
              ← Back
            </Link>
          )}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e" }}>{headerLine}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {offers && (
            <nav aria-label="Estimate view" style={seg}>
              <Link href={narrativeHref} prefetch={false} aria-current={!showBom ? "page" : undefined} style={segItem(!showBom)}>
                Narrative
              </Link>
              <Link href={bomHref} prefetch={false} aria-current={showBom ? "page" : undefined} style={segItem(showBom)}>
                BOM
              </Link>
            </nav>
          )}
          {pdfHref && (
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={plainLink}>
              Download PDF
            </a>
          )}
        </div>
      </div>
      {closed && (
        <div role="status" style={{ marginBottom: 14, padding: "11px 16px", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#8a6d1f" }}>
          {ONLINE_COPY.closed}
        </div>
      )}
      <QuoteDocument {...shown} layout="web" />
    </div>
  );
}

/** The one 200 card for every non-document outcome. */
export function OnlineEstimateCard({ title, pdfHref = null, backHref = null }: { title: string; pdfHref?: string | null; backHref?: string | null }) {
  return (
    <div style={{ maxWidth: 460, margin: "48px auto 0", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 14, padding: "30px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{title}</div>
      {(pdfHref || backHref) && (
        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 14 }}>
          {pdfHref && (
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={plainLink}>
              Open PDF ↗
            </a>
          )}
          {backHref && (
            <Link href={backHref} prefetch={false} style={plainLink}>
              ← Back
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
