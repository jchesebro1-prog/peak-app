/**
 * AI daily brief — the Home card's view model (spec §4). The server card
 * (`src/components/brief/brief-card.tsx`) gathers the stored brief, the
 * snapshot rows its Do-these-first keys point at, which threads/quotes have
 * a ready pre-draft, and each quiet quote's builder link + nudge; this turns
 * them into plain display strings and links. Pure, client-safe.
 */
import { chicagoShortDate, chicagoTime } from "@/lib/triage/clock";
import { parseTriageKey } from "@/lib/triage/keys";
import { SOURCE_LABEL } from "@/lib/triage/types";
import { driveLabel } from "./fallback";
import { briefId, briefTitle } from "./slots";
import { briefSpeech } from "./speech";
import type { Brief } from "./types";

/** A Do-these-first key's snapshot row (only what the card shows). */
export type CardRow = { title: string; href: string };
/** A thread's ready pre-draft parts (server: `readerPreDraft`). */
export type CardThreadReady = { draft: boolean; tasks: boolean };
/** A quote the card mentions: its builder link, and a fresh, usable nudge (else null). */
export type CardQuoteInfo = {
  href: string;
  nudge: { note: string } | null;
};
/** A lead row's estimate suggestion (spec 2026-10-13 §3): its latest suggestion's Estimator link, else null. */
export type CardLeadSuggest = { readyHref: string | null };

export type BriefCardInput = {
  brief: Brief;
  stale: "yesterday-afternoon" | null;
  transient: boolean;
  rows: Readonly<Record<string, CardRow>>;
  threads: Readonly<Record<string, CardThreadReady>>;
  quotes: Readonly<Record<string, CardQuoteInfo>>;
  /** Lead id → its suggestion state — present only when Suggest estimate is
   *  on for this user (pilot + `estimate`); absent = the old "Open lead" cue. */
  leads?: Readonly<Record<string, CardLeadSuggest>>;
  /** #345 — Organize's availability (everyone unless INBOX_ORG_DISABLED; absent = available) and the
   *  90-day cleanup's state for "Organize my inbox" — null when the user can't run it (not pilot +
   *  Inbox organization), else "never" run, "unfinished" or "done". */
  organizeEntry?: { available: boolean; cleanup: "never" | "unfinished" | "done" | null };
  /** #346 — the live To file / Noise counts (the Inbox banner's own
   *  `organizeEntryCounts`), laid over the stored brief's so an Archive or a
   *  filing since the brief was built shows at once; absent / null = the
   *  brief's stored counts (the live read failed). */
  organizeLive?: { toFile: number; strong: number; noise: number } | null;
};

export type BriefCardDoFirst = {
  key: string;
  title: string;
  href: string | null;
  why: string;
  source: string;
  draftReady: boolean;
  tasksReady: boolean;
  /** A lead row: "Ready to quote? → Open lead" (the lead's own page, where it converts); null otherwise. */
  leadHref: string | null;
  /** A lead row with Suggest estimate on: the cue becomes "Suggest estimate"
   *  (or "Suggestion ready → Open" + "Suggest again"); null otherwise — the
   *  view then falls back to `leadHref`. */
  leadSuggest: { leadId: string; readyHref: string | null } | null;
};

export type BriefCardQuiet = {
  quoteId: string;
  /** "EST-1001 · Stage · North HS" */
  label: string;
  /** "6 business days, no reply" */
  daysLabel: string;
  note: string | null;
  /** `/inbox?nudge=<quoteId>` — the composer prefilled server-side with the nudge (nothing sends by itself); null without a ready nudge. */
  nudgeHref: string | null;
  openHref: string;
};

export type BriefCardVM = {
  /** The brief's blob id — the collapse toggle remembers per id. */
  id: string;
  title: string;
  builtLabel: string;
  notes: string[];
  /** Rebuild only for the current slot (before 6:45 there is nothing to rebuild). */
  canRebuild: boolean;
  summary: string;
  since: string | null;
  doFirst: BriefCardDoFirst[];
  /** "5 emails to file · 3 noise" → Review (`/inbox?view=organize`) */
  organize: { label: string; href: string } | null;
  /** #345 — "Organize my inbox" offered while the 90-day cleanup was never run or isn't finished */
  organizeCleanup: { label: string; detail: string; href: string } | null;
  promises: Array<{ taskId: string; title: string; dueLabel: string | null }>;
  today: string | null;
  approvals: string | null;
  quiet: BriefCardQuiet[];
  /** The big-text (phone) variant's count lines — no drafts there. */
  counts: string[];
  /** What Listen reads (`briefSpeech`). */
  speech: string;
};

export const ORGANIZE_HREF = "/inbox?view=organize";
/** #345 — Organize's To file tab with the "Organize my inbox" button called out (it never starts by itself). */
export const ORGANIZE_CLEANUP_HREF = "/inbox?view=organize&tab=to-file&cleanup=1";

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Send nudge: the Inbox reads the quote's stored nudge itself (inbox-compose-prefill.ts `nudgePrefill`) — only the id travels. */
export function nudgeComposeHref(quoteId: string): string {
  return `/inbox?nudge=${encodeURIComponent(quoteId)}`;
}

export function briefCardVM(input: BriefCardInput): BriefCardVM {
  const b = input.brief;
  const notes: string[] = [];
  if (input.stale === "yesterday-afternoon") notes.push("Yesterday’s afternoon brief — this morning’s builds at 6:45.");
  if (b.error) notes.push(b.error);

  const titles: Record<string, string> = {};
  const doFirst: BriefCardDoFirst[] = b.doFirst.map((d) => {
    const row = input.rows[d.key];
    const parsed = parseTriageKey(d.key);
    const thread = parsed?.source === "email" ? input.threads[parsed.id] : undefined;
    const quote = parsed?.source === "quote" ? input.quotes[parsed.id] : undefined;
    const lead = parsed?.source === "lead" ? input.leads?.[parsed.id] : undefined;
    if (row?.title) titles[d.key] = row.title;
    return {
      key: d.key,
      title: row?.title || d.why || "An item on your list",
      href: row?.href || null,
      why: row?.title ? d.why : "",
      source: parsed ? SOURCE_LABEL[parsed.source] : "",
      draftReady: !!thread?.draft || !!quote?.nudge,
      tasksReady: !!thread?.tasks,
      leadHref: parsed?.source === "lead" && row?.href ? row.href : null,
      leadSuggest: parsed?.source === "lead" && lead && row ? { leadId: parsed.id, readyHref: lead.readyHref } : null,
    };
  });

  // #345 — one clear action: "N emails to file · M noise — Review"
  const o = input.organizeLive ?? b.organize;
  const entry = input.organizeEntry ?? { available: true, cleanup: null };
  const organize =
    entry.available && (o.toFile > 0 || o.noise > 0)
      ? { label: [o.toFile > 0 ? `${n(o.toFile, "email", "emails")} to file` : "", o.noise > 0 ? `${o.noise} noise` : ""].filter(Boolean).join(" · "), href: ORGANIZE_HREF }
      : null;
  const organizeCleanup =
    entry.available && (entry.cleanup === "never" || entry.cleanup === "unfinished")
      ? {
          label: entry.cleanup === "never" ? "Organize my inbox" : "Finish organizing my inbox",
          detail:
            entry.cleanup === "never"
              ? "Suggests a filing for the last 90 days of mail — nothing is filed until you approve it."
              : "The 90-day cleanup stopped part-way — it picks up where it left off.",
          href: ORGANIZE_CLEANUP_HREF,
        }
      : null;

  const t = b.today;
  const todayBits: string[] = [];
  if (t.visits > 0) todayBits.push(`${n(t.visits, "visit", "visits")}${t.firstVisitAt ? ` (first at ${chicagoTime(t.firstVisitAt)})` : ""}`);
  if (t.driveMin && t.driveMin > 0) todayBits.push(`${driveLabel(t.driveMin)} driving`);
  if (t.tasksDue > 0) todayBits.push(`${n(t.tasksDue, "task", "tasks")} on today’s plan`);
  const today = todayBits.length ? todayBits.join(" · ") : null;
  const approvals = b.approvals > 0 ? `${n(b.approvals, "quote", "quotes")} waiting on your approval` : null;

  const quiet: BriefCardQuiet[] = b.quiet.map((q) => {
    const info = input.quotes[q.quoteId];
    const nudge = info?.nudge ?? null;
    return {
      quoteId: q.quoteId,
      label: [q.number, q.name, q.customer].filter(Boolean).join(" · "),
      daysLabel: `${n(q.days, "business day", "business days")}, no reply`,
      note: nudge?.note || null,
      nudgeHref: nudge ? nudgeComposeHref(q.quoteId) : null,
      openHref: info?.href || `/estimator?id=${encodeURIComponent(q.quoteId)}`,
    };
  });

  const since = b.slot === "midday" && b.since ? `Since this morning: ${b.since.done} done · ${b.since.open} still open · ${b.since.new} new` : null;

  const counts: string[] = [];
  if (organize) counts.push(`Inbox: ${organize.label}`);
  if (today) counts.push(`Today: ${today}`);
  if (approvals) counts.push(approvals);
  if (quiet.length) counts.push(`${n(quiet.length, "sent quote has", "sent quotes have")} gone quiet`);
  if (b.newPromiseTasks.length) counts.push(n(b.newPromiseTasks.length, "new task from a promise", "new tasks from promises"));

  return {
    id: briefId(b.userId, b.day, b.slot),
    title: briefTitle(b.slot),
    builtLabel: `${b.builtBy === "rebuild" ? "rebuilt" : "built"} ${chicagoTime(b.builtAt)}${input.stale ? ` · ${chicagoShortDate(b.builtAt)}` : ""}`,
    notes,
    canRebuild: !input.stale,
    summary: b.summary,
    since,
    doFirst,
    organize,
    organizeCleanup,
    promises: b.newPromiseTasks.map((p) => ({ taskId: p.taskId, title: p.title, dueLabel: p.due ? chicagoShortDate(p.due) : null })),
    today,
    approvals,
    quiet,
    counts,
    speech: briefSpeech(b, titles),
  };
}
