import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { latestSentRevision, pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { ONLINE_COPY, ONLINE_VIEW_LABELS, sentDocumentStamp } from "./view";
import { ALTERNATES_NOTE, ALTERNATES_TITLE } from "@/lib/estimate-output/alternates-copy";
import { opensFor, opensSummary, type ShareOpenStat } from "@/lib/estimate-output/opens";

/**
 * #301 slice B — the estimate package's pure rules (spec §2, D-h, R11):
 * which state a rev-pinned (v2) link is in, whether its page may take client
 * actions (Slice C), the banner, and the staff-side per-revision rows with
 * their opens. Client-safe: value imports only quote-pdf/state, ./view and
 * estimate-output/opens.
 */

export const PACKAGE_COPY = {
  titleFallback: "Estimate",
  revising: "Peak is revising this estimate.",
  supersededLead: "A newer version of this estimate was sent",
  viewCurrent: "View the current version",
  summary: "Summary",
  goals: "Your goals",
  /** Batch 5 #63 — the toggle reads Overview / Itemized. */
  narrative: ONLINE_VIEW_LABELS.narrative,
  bom: ONLINE_VIEW_LABELS.bom,
  bomHead: ["Qty", "Manufacturer", "Model", "Description"],
  seeBom: `The full parts list for this scope is under ${ONLINE_VIEW_LABELS.bom}.`,
  noParts: "No parts listed for this scope.",
  options: "Add options",
  /** Estimator Phase 2b — the Alternates card; the cover's own shared copy (alternates-copy.ts). */
  alternates: ALTERNATES_TITLE,
  alternatesNote: ALTERNATES_NOTE,
  notIncluded: "Not included",
  clientLink: "Client link",
  openedChip: "Opened",
  /** Batch 5 #58 — staff only (Client link panel, Quotes hub tooltip); never on a customer page. */
  viewed: "Viewed",
  /** #348 2b-ii — a bidder's v3 link once the bid is no longer live; says nothing about the award. */
  bidClosed: "This bid is closed.",
} as const;

/** A bidder's link may act only while their bid is pending or awarded; the owner's v2 (no bidder) always may. */
export function bidderCanAct(result: string | null | undefined): boolean {
  return result == null || result === "pending" || result === "awarded";
}

export type PackageState =
  | { kind: "ok"; rev: QuoteRevision; closed: boolean; won: boolean }
  | { kind: "superseded"; rev: QuoteRevision; latestRev: number; sentAt: number }
  | { kind: "revising"; rev: QuoteRevision }
  | { kind: "inactive" };
export type VisiblePackageState = Exclude<PackageState, { kind: "inactive" }>;

const SHOWN_STATUSES = new Set(["sent", "won", "lost", "draft"]);

/** D-h. Precedence: inactive (not a system quote, the pinned rev isn't one of
 *  this quote's SENT revisions, or an unknown status) → superseded (a newer
 *  send exists) → revising (recalled to draft) → ok (closed = lost). */
export function packageState(q: Pick<Quote, "quoteType" | "status" | "revisions">, pinnedRev: number): PackageState {
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { kind: "inactive" };
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  const rev = revs.find((r) => !!r && r.rev === pinnedRev && r.reason === "sent");
  const latest = latestSentRevision(revs);
  if (!rev || !latest || !SHOWN_STATUSES.has(q.status)) return { kind: "inactive" };
  if (latest !== rev) return { kind: "superseded", rev, latestRev: latest.rev, sentAt: sentDocumentStamp({ revisions: revs }, latest).issuedAt };
  if (q.status === "draft") return { kind: "revising", rev };
  return { kind: "ok", rev, closed: q.status === "lost", won: q.status === "won" };
}

/** Slice C's client actions: only the current version of an open (sent) estimate. */
export function canAct(s: PackageState): boolean {
  return s.kind === "ok" && !s.closed && !s.won;
}

export type PackageBanner = { tone: "info" | "warn"; text: string; href: string | null; linkText: string | null };

const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

export function packageBanner(s: VisiblePackageState, currentHref: string | null, bidClosed = false): PackageBanner | null {
  if (bidClosed) return { tone: "info", text: PACKAGE_COPY.bidClosed, href: null, linkText: null };
  if (s.kind === "superseded")
    return { tone: "info", text: `${PACKAGE_COPY.supersededLead} ${longDate(s.sentAt)}.`, href: currentHref, linkText: currentHref ? PACKAGE_COPY.viewCurrent : null };
  if (s.kind === "revising") return { tone: "warn", text: PACKAGE_COPY.revising, href: null, linkText: null };
  if (s.closed) return { tone: "warn", text: ONLINE_COPY.closed, href: null, linkText: null };
  return null;
}

/** "Oct 5, 10:42 PM" in Chicago time (ICU's narrow no-break space normalised). */
const sentStamp = (ms: number) =>
  new Date(ms)
    .toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
    .replace(/[\u202f\u00a0]/g, " ");

export type OpensSource = { revisions?: QuoteRevision[] | null; shareOpens?: unknown };
export type SentRevRow = { rev: number; revNo: number; sentAt: number; latest: boolean; opens: ShareOpenStat | null; line: string };

/** Staff-side: every sent revision, newest first — "Rev 2 · sent Oct 6, 10:00 AM · opened 3× · …",
 *  "Rev 1 — superseded · sent Oct 5, 9:58 PM · not opened yet". Never carries a path. */
export function sentRevisionRows(q: OpensSource | null | undefined): SentRevRow[] {
  const revs = Array.isArray(q?.revisions) ? (q!.revisions as QuoteRevision[]) : [];
  const latest = latestSentRevision(revs);
  const rows: SentRevRow[] = [];
  for (const r of revs) {
    if (!r || r.reason !== "sent") continue;
    const { revNo, issuedAt } = sentDocumentStamp({ revisions: revs }, r);
    const opens = opensFor(q?.shareOpens, r.rev);
    const isLatest = r === latest;
    // The row's own send time (r.at, never the frozen PDF stamp): two sends can print the same Rev N (D567).
    rows.push({ rev: r.rev, revNo, sentAt: issuedAt, latest: isLatest, opens,
      line: `Rev ${revNo}${isLatest ? "" : " — superseded"} · sent ${sentStamp(r.at)} · ${opensSummary(opens)}` });
  }
  return rows.reverse();
}

/** Batch 5 #58 (Jeff, 2026-10-15) — staff only: the latest time the client
 *  opened ANY sent revision's package link (the #301 beacon's `last`), or
 *  null when it was never opened. Never shown to the customer. */
export function lastViewedAt(q: OpensSource | null | undefined): number | null {
  let last = 0;
  for (const r of sentRevisionRows(q)) if (r.opens && r.opens.last > last) last = r.opens.last;
  return last > 0 ? last : null;
}

/** "Viewed Oct 6, 10:42 AM" (Chicago) — the staff stamp; "" when never opened. */
export function viewedStamp(q: OpensSource | null | undefined): string {
  const at = lastViewedAt(q);
  return at ? `${PACKAGE_COPY.viewed} ${sentStamp(at)}` : "";
}

/** The Quotes hub chip: "Opened" once any sent revision's link was opened;
 *  its tooltip leads with the latest open's date and time (Batch 5 #58). */
export function opensChip(q: OpensSource | null | undefined): { label: string; title: string } | null {
  const opened = sentRevisionRows(q).filter((r) => r.opens);
  if (!opened.length) return null;
  return { label: PACKAGE_COPY.openedChip, title: `${viewedStamp(q)} — ${PACKAGE_COPY.clientLink} — ${opened.map((r) => r.line).join("; ")}` };
}

/** The lead drawer's line: the latest revision's row, once anything was opened. */
export function latestOpensLine(q: OpensSource | null | undefined): string {
  const rows = sentRevisionRows(q);
  if (!rows.some((r) => r.opens)) return "";
  return `${PACKAGE_COPY.clientLink} — ${rows[0].line}`;
}
