/**
 * #21 customer Activity feed — PURE per-source row builders. Structural arg
 * types, ZERO store imports (every store module value-imports doc-store,
 * which must never reach this spec-tested / potentially-client-safe layer).
 * The one import is `@/lib/estimate-number` (#223), pure by construction.
 *
 * QUOTE_VERB mirrors quotes.STAGE_LABEL's stage set (drift-guarded by an
 * exact-literal spec in the harness).
 */
import { displayQuoteNumber } from "@/lib/estimate-number";
// Type-only — erased at build time, so the zero-store-import / client-bundle
// rule still holds at runtime (no store code is ever pulled in here).
import type { QuoteStatus } from "@/lib/stores/quotes";

export type FeedKind =
  | "note"
  | "quote"
  ;

export type FeedRow = {
  /** Unique across the whole feed — "<kind>:<recordId>:<n>" shapes. */
  id: string;
  kind: FeedKind;
  /** epoch-ms — the merge/sort key. */
  ts: number;
  title: string;
  sub: string;
  ink: string; // letter-dot ink
  soft: string; // letter-dot background
  letter: string; // letter-dot glyph
  href: string | null; // null = plain row (no navigation)
  by: string; // actor when known; "" hides the segment in the UI
  /** Set only on a user-authored (non-system) NoteRecord row — the raw note
   *  id the UI's Delete control removes. Every other row kind is derived
   *  from another record and has nothing of its own to delete here. */
  deletableNoteId?: string;
};

/** Letter-dot families per kind (the app's chip color families). */
export const FEED_META: Record<FeedKind, { letter: string; ink: string; soft: string }> = {
  note: { letter: "N", ink: "#8a6d1f", soft: "#fbf3dd" },
  quote: { letter: "Q", ink: "#3155a8", soft: "#e9eefb" },
};

function row(
  kind: FeedKind,
  id: string,
  ts: number,
  title: string,
  sub: string,
  href: string | null,
  by: string
): FeedRow {
  const m = FEED_META[kind];
  return { id, kind, ts, title, sub, ink: m.ink, soft: m.soft, letter: m.letter, href, by };
}

/** Mirrors quotes.STAGE_LABEL's stage set as past-tense verbs ("Quote
 *  Q-2041 sent"); unknown stages fall through as the raw key. */
const QUOTE_VERB: Record<QuoteStatus, string> = {
  draft: "drafted",
  sent: "sent",
  won: "won",
  lost: "lost",
};

export function quoteFeedRows(q: {
  id: string;
  estNo?: number | null;
  estSuffix?: number | null;
  quoteType?: string | null;
  name: string;
  history: Array<{ at: number; to: string }>;
  /** setPoReceived writes NO history entry — this annex field is the record. */
  poReceivedAt?: number | null;
  portalAcceptance?: { at: number; by: string } | null;
}): FeedRow[] {
  const label = displayQuoteNumber(q);
  const href = "/quotes?id=" + encodeURIComponent(q.id);
  const rows = (q.history || []).map((h, i) =>
    row("quote", `quote:${q.id}:${i}`, h.at, `Quote ${label} ${QUOTE_VERB[h.to as QuoteStatus] ?? h.to}`, q.name, href, "")
  );
  if (q.poReceivedAt != null)
    rows.push(row("quote", `quote:${q.id}:po`, q.poReceivedAt, `Quote ${label} PO received`, q.name, href, ""));
  if (q.portalAcceptance)
    rows.push(
      row(
        "quote",
        `quote:${q.id}:portal`,
        q.portalAcceptance.at,
        `Quote ${label} accepted in portal`,
        q.name,
        href,
        q.portalAcceptance.by
      )
    );
  return rows;
}

/** Real NoteRecord rows — full text as title (the UI clamps display). A
 *  system-authored note (e.g. an automated log entry) has no deletableNoteId,
 *  so the UI never offers a Delete control for it — only for the notes a
 *  person actually wrote. */
export function noteFeedRows(n: { id: string; at: number; by: string; text: string; system?: boolean }): FeedRow[] {
  const r = row("note", `note:${n.id}`, n.at, n.text, "Note", null, n.by || "");
  if (!n.system) r.deletableNoteId = n.id;
  return [r];
}
