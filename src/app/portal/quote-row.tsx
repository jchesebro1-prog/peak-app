import Link from "next/link";
import type { CSSProperties } from "react";
import { displayQuoteNumber } from "@/lib/estimate-number";
import type { Quote } from "@/lib/stores/quotes";
import { canAcceptPortal } from "@/lib/portal-quote-mode";
import { portalQuoteTypeLabel } from "@/lib/portal-my-quotes";
import { portalQuoteDate } from "@/lib/portal-quote-names";
import { portalQuotePdfPreparing, portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { latestSentRevision, pdfView } from "@/lib/quote-pdf/state";
import { copyQuoteToCart } from "./actions";
import { AcceptDialog } from "./accept-dialog";
import { RefreshPricingButton } from "./refresh-pricing-button";
import { RenameQuote } from "./rename-quote";

/**
 * One portal quote row (#220/#222/#245/#248) — shared by Home (Peak-sent
 * estimates) and My quotes (customer-built quotes, #288 spec §1.5), so both
 * carry the same chips, PDF link, Accept dialog, Refresh pricing, Copy to
 * new quote and Quote again. Server component; the interactive bits are the
 * small client children (AcceptDialog, RefreshPricingButton, RenameQuote).
 *
 * `mine` (My quotes) adds the type label to the meta line, the ✎ Rename
 * inline edit while renamable, and lands Accept / a Copy refusal back on My
 * quotes. A team preview (`preview`) hides every action.
 */

export function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type ChipStyle = { label: string; ink: string; soft: string; bd: string };

/** Customer-facing quote status (published pipeline states only). */
const QUOTE_CHIP: Record<string, ChipStyle> = {
  sent: { label: "Awaiting your review", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  won: { label: "Accepted", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  lost: { label: "Declined", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
};

export function Chip({ c }: { c: ChipStyle }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: c.ink,
        background: c.soft,
        border: `1px solid ${c.bd}`,
        padding: "2px 8px",
        borderRadius: 5,
        whiteSpace: "nowrap",
      }}
    >
      {c.label}
    </span>
  );
}

/**
 * #222: whether a row with no PDF to open says "Document being prepared" —
 * only while a copy can still arrive: a sent revision awaiting its copy
 * (portalQuotePdfPreparing, the same predicate the PDF route uses), or a
 * never-sent estimate whose render is still in flight (not stale). Anything
 * else reads "PDF not available — contact your rep".
 */
function pdfPreparing(q: Quote, cid: string): boolean {
  if (portalQuotePdfPreparing(q, cid)) return true;
  return !latestSentRevision(q.revisions) && pdfView(q.pdf, Date.now())?.status === "pending";
}

/** #245: a firm portal quote's validity date while it lasts (sent, not yet
 *  accepted, not past `validUntil`); null otherwise. */
function firmValidUntil(q: Quote): number | null {
  if (q.status !== "sent" || q.portalAcceptance || !q.portalFirm) return null;
  return Date.now() <= q.portalFirm.validUntil ? q.portalFirm.validUntil : null;
}

const ROW_LINK: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--accent)",
  textDecoration: "underline",
};

export function PortalQuoteRow({
  q,
  cid,
  preview,
  acceptCategories,
  mine,
}: {
  q: Quote;
  cid: string;
  preview: boolean;
  acceptCategories: Array<{ key: string; label: string }>;
  /** My quotes (#288): `renamable` from the view model. */
  mine?: { renamable: boolean };
}) {
  const isDraft = q.status === "draft"; // only the customer's own self-serve drafts reach here
  // #248 Task 3: "Quote again" replaces "Copy to new quote" for any listed
  // flame_test/inspection quote of this customer, any source (spec §1, §3)
  // — /portal/service?from=<id> re-checks portalListsQuote itself.
  const isServiceQuote = q.quoteType === "flame_test" || q.quoteType === "inspection";
  const pendingAccept = q.status === "sent" && !!q.portalAcceptance;
  const acceptGate = canAcceptPortal(q, Date.now());
  const isExpired = q.status === "sent" && !q.portalAcceptance && acceptGate.reason === "expired";
  const canAccept = acceptGate.ok && !preview;
  const firmUntil = firmValidUntil(q);
  const chip = isDraft
    ? q.source === "portal-catalog" && q.portalReview
      ? { label: "In review — Peak will confirm pricing", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
      : { label: "In review with our team", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
    : isExpired
    ? { label: "Pricing expired", ink: "#a33a2b", soft: "#fdf0ee", bd: "#f3d2cc" }
    : firmUntil != null
    ? { label: "Valid until " + fmtDate(firmUntil), ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" }
    : pendingAccept
    ? { label: "Accepted — awaiting confirmation", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
    : QUOTE_CHIP[q.status] || QUOTE_CHIP.sent;
  // #222: the saved PDF (latest sent revision's copy, else the ready file).
  const pdfHref = portalQuotePdfSource(q, cid)
    ? `/portal/quotes/${encodeURIComponent(q.id)}/pdf` + (preview ? `?preview=${encodeURIComponent(cid)}` : "")
    : null;
  const title = pdfHref ? (
    <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
      {q.name}
    </a>
  ) : (
    q.name
  );
  const meta = mine
    ? displayQuoteNumber(q) + " · " + portalQuoteTypeLabel(q) + " · " + portalQuoteDate(q.createdAt || q.updatedAt)
    : displayQuoteNumber(q) + " · " + fmtDate(q.updatedAt);
  return (
    <div style={{ borderBottom: "1px solid #f5f6f8" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 96px auto",
          gap: 12,
          alignItems: "center",
          padding: "13px 20px 8px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {mine?.renamable && !preview ? (
            <div style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>
              <RenameQuote quoteId={q.id} name={q.name}>
                {title}
              </RenameQuote>
            </div>
          ) : (
            <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          )}
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>{meta}</div>
          <div style={{ fontSize: 11.5, marginTop: 3 }}>
            {pdfHref ? (
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                Open PDF ↗
              </a>
            ) : pdfPreparing(q, cid) ? (
              <span style={{ color: "#9aa0ab" }}>Document being prepared</span>
            ) : (
              <span style={{ color: "#9aa0ab" }}>PDF not available — contact your rep</span>
            )}
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{money(q.value)}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <Chip c={chip} />
            {canAccept && (
              <AcceptDialog
                quoteId={q.id}
                customerId={cid}
                categories={acceptCategories}
                disabled={preview}
                doneHref={mine ? "/portal/my-quotes?show=accepted" : "/portal"}
              />
            )}
          </div>
          {isExpired && !preview && <RefreshPricingButton quoteId={q.id} />}
        </div>
      </div>
      {(q.portalDecline || q.source === "portal-catalog" || isServiceQuote) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "0 20px 12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, color: "#8c919c" }}>{q.portalDecline ? "Peak: " + q.portalDecline.note : ""}</div>
          {q.source === "portal-catalog" && !preview && (
            <form action={mine ? copyQuoteToCart.bind(null, q.id, "my-quotes") : copyQuoteToCart.bind(null, q.id)}>
              <button
                type="submit"
                style={{ ...ROW_LINK, background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                Copy to new quote
              </button>
            </form>
          )}
          {isServiceQuote && (
            <Link
              href={`/portal/service?from=${encodeURIComponent(q.id)}` + (preview ? `&preview=${encodeURIComponent(cid)}` : "")}
              style={ROW_LINK}
            >
              Quote again
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
