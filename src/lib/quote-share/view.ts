import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { latestSentRevision, pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { displayQuoteNumber } from "@/lib/estimate-number";

/**
 * #293 slice 3 — the online estimate's pure rules (spec §2.7, decision 16):
 * the one state rule both web pages use, the sent version of a quote, the
 * share path, and every customer-facing string. Client-safe: value imports
 * only quote-pdf/state and estimate-number.
 */

export const ONLINE_COPY = {
  closed: "This estimate is closed.",
  revising: "This estimate is being revised — your Peak rep will send the updated version.",
  portalUnavailable: "This estimate isn’t available online.",
  shareInactive: "This link isn’t active. Ask your Peak rep for a new one.",
  tooMany: "Too many requests — try again in a minute.",
  notSent: "Send the quote first — the link shows the version you sent.",
  revisingStaff: "The quote is back in draft — send it again to share it.",
  notShareable: "Only system estimates can be shared online.",
  needsSend: "Needs the Send permission.",
  revokeConfirm: "Anyone with the current link will lose access.",
  gone: "That quote no longer exists.",
  noSecret: "Client links aren’t set up on this server (AUTH_SECRET is missing).",
  copied: "Link copied.",
  copyManual: "Copy this link:",
  revoked: "Link revoked — the old link no longer opens.",
} as const;

export type OnlineEstimateState =
  | { kind: "ok"; rev: QuoteRevision; closed: boolean }
  | { kind: "revising" }
  | { kind: "unavailable" };

type StateFields = Pick<Quote, "quoteType" | "status" | "revisions">;

/** ok = a system quote with a sent revision, status sent / won / lost (lost
 *  = closed); revising = back in draft after a send (no content shown);
 *  anything else is unavailable. */
export function onlineEstimateState(q: StateFields): OnlineEstimateState {
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { kind: "unavailable" };
  const rev = latestSentRevision(q.revisions);
  if (!rev) return { kind: "unavailable" };
  if (q.status === "draft") return { kind: "revising" };
  if (q.status === "sent" || q.status === "won" || q.status === "lost") return { kind: "ok", rev, closed: q.status === "lost" };
  return { kind: "unavailable" };
}

export type ShareEligibility = "ok" | "revising" | "not-sent" | "not-shareable";

/** Whether staff may create a link now (only "ok"), and why not. */
export function shareEligibility(q: StateFields): ShareEligibility {
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return "not-shareable";
  const s = onlineEstimateState(q);
  return s.kind === "ok" ? "ok" : s.kind === "revising" ? "revising" : "not-sent";
}

/** The quote as it was sent (spec §5.1): the revision's priced payload, its
 *  frozen header (docFields; the live header on revisions cut before #293),
 *  its date as the document date, and the revision list cut at it so the
 *  document's Rev N is the revision's. Never mutates `q`. */
export function quoteAsOfRevision(q: Quote, rev: QuoteRevision): Quote {
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  const idx = revs.findIndex((r) => r.rev === rev.rev);
  return {
    ...q,
    ...(rev.docFields ?? {}),
    name: rev.name,
    spec: rev.spec ?? null,
    vendorQuotes: rev.vendorQuotes ?? null,
    value: rev.value,
    updatedAt: rev.at,
    revisions: idx >= 0 ? revs.slice(0, idx + 1) : revs,
    shareLink: null,
  } as unknown as Quote;
}

const chicagoDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

/** "EST-1005 · Rev 2 · sent Oct 1, 2026". */
export function onlineHeaderLine(q: Pick<Quote, "id" | "estNo" | "estSuffix" | "quoteType">, rev: Pick<QuoteRevision, "rev" | "at">): string {
  return `${displayQuoteNumber(q)} · Rev ${rev.rev} · sent ${chicagoDate(rev.at)}`;
}

export function sharePath(quoteId: string, token: string): string {
  return `/share/quote/${encodeURIComponent(quoteId)}/${token}`;
}

/** `?view=bom` → the BOM; anything else → the narrative (the default). */
export function onlineView(raw: string | string[] | undefined): "narrative" | "bom" {
  return (Array.isArray(raw) ? raw[0] : raw) === "bom" ? "bom" : "narrative";
}

/** What a browser learns about a link — never the nonce. `path` only while
 *  active, and only for a `send` holder. */
export type ShareLinkView = {
  active: boolean;
  path: string | null;
  expiresAt: number;
  createdAt: number;
  createdBy: string;
  revokedAt: number | null;
  revokedBy: string | null;
};

export type ShareLinkStatus = { state: ShareEligibility; canSend: boolean; link: ShareLinkView | null };
