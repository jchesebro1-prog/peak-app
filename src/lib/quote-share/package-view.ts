import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { latestSentRevision, pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { ONLINE_COPY, sentDocumentStamp } from "./view";
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
  narrative: "Narrative",
  bom: "BOM",
  bomHead: ["Qty", "Manufacturer", "Part", "Description"],
  seeBom: "The full parts list for this scope is under BOM.",
  noParts: "No parts listed for this scope.",
  options: "Add options",
  notIncluded: "Not included",
  clientLink: "Client link",
  openedChip: "Opened",
} as const;

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

export function packageBanner(s: VisiblePackageState, currentHref: string | null): PackageBanner | null {
  if (s.kind === "superseded")
    return { tone: "info", text: `${PACKAGE_COPY.supersededLead} ${longDate(s.sentAt)}.`, href: currentHref, linkText: currentHref ? PACKAGE_COPY.viewCurrent : null };
  if (s.kind === "revising") return { tone: "warn", text: PACKAGE_COPY.revising, href: null, linkText: null };
  if (s.closed) return { tone: "warn", text: ONLINE_COPY.closed, href: null, linkText: null };
  return null;
}

export type OpensSource = { revisions?: QuoteRevision[] | null; shareOpens?: unknown };
export type SentRevRow = { rev: number; revNo: number; sentAt: number; latest: boolean; opens: ShareOpenStat | null; line: string };

/** Staff-side: every sent revision, newest first — "Rev 2 · opened 3× · …",
 *  "Rev 1 — superseded · not opened yet". Never carries a path. */
export function sentRevisionRows(q: OpensSource | null | undefined): SentRevRow[] {
  const revs = Array.isArray(q?.revisions) ? (q!.revisions as QuoteRevision[]) : [];
  const latest = latestSentRevision(revs);
  const rows: SentRevRow[] = [];
  for (const r of revs) {
    if (!r || r.reason !== "sent") continue;
    const { revNo, issuedAt } = sentDocumentStamp({ revisions: revs }, r);
    const opens = opensFor(q?.shareOpens, r.rev);
    const isLatest = r === latest;
    rows.push({ rev: r.rev, revNo, sentAt: issuedAt, latest: isLatest, opens, line: `Rev ${revNo}${isLatest ? "" : " — superseded"} · ${opensSummary(opens)}` });
  }
  return rows.reverse();
}

/** The Quotes hub chip: "Opened" once any sent revision's link was opened. */
export function opensChip(q: OpensSource | null | undefined): { label: string; title: string } | null {
  const opened = sentRevisionRows(q).filter((r) => r.opens);
  if (!opened.length) return null;
  return { label: PACKAGE_COPY.openedChip, title: `${PACKAGE_COPY.clientLink} — ${opened.map((r) => r.line).join("; ")}` };
}

/** The lead drawer's line: the latest revision's row, once anything was opened. */
export function latestOpensLine(q: OpensSource | null | undefined): string {
  const rows = sentRevisionRows(q);
  if (!rows.some((r) => r.opens)) return "";
  return `${PACKAGE_COPY.clientLink} — ${rows[0].line}`;
}
