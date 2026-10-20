/**
 * AI daily brief — the Home card's view model (spec §4). The server card
 * (`src/components/brief/brief-card.tsx`) gathers the stored brief, the
 * slot's visible triage rows (marks and liveness applied, as Start here
 * shows them), which threads/quotes have a ready pre-draft, and each quiet
 * quote's builder link + nudge; this turns them into three blocks — Emails,
 * Estimates, Tasks (Jeff, 2026-10-15; `blocks.ts`) — of plain display strings
 * and links. The brief's Do-these-first picks render as ★ inside their own
 * block. Pure, client-safe.
 */
import { chicagoShortDate, chicagoTime } from "@/lib/triage/clock";
import { parseTriageKey } from "@/lib/triage/keys";
import { SOURCE_LABEL, type TriageSource } from "@/lib/triage/types";
import { BRIEF_BLOCK_TITLE, BRIEF_BLOCKS, capBlock, rowSource, starFirst, type BriefBlockId } from "./blocks";
import { driveLabel } from "./fallback";
import { briefId, briefTitle } from "./slots";
import { briefSpeech } from "./speech";
import type { Brief } from "./types";

/** One visible snapshot row (only what the card shows), in rank order. */
export type CardRow = { key: string; source?: string; title: string; href: string; reason?: string };
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
  /** The slot's visible triage rows in rank order; null = the snapshot couldn't be read — fail closed: no rows and no picks (#350 review). */
  rows: readonly CardRow[] | null;
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

/** A triage row in a block. */
export type BriefBlockRow = {
  kind: "row";
  key: string;
  /** "Email", "Quote", … — the row's chip. */
  source: string;
  title: string;
  href: string | null;
  /** One of the brief's Do-these-first picks. */
  star: boolean;
  /** The pick's reason (★ only) — small text under the title. */
  why: string;
  /** The row's own ranking reason — the title's tooltip. */
  hint: string;
  /** Email: "Draft reply ready · Use it" (a fresh pre-draft); quote: a ready nudge. */
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

export type BriefCardPromise = { taskId: string; title: string; dueLabel: string | null };

export type BriefBlockItem =
  | BriefBlockRow
  | ({ kind: "quiet" } & BriefCardQuiet)
  | ({ kind: "promise" } & BriefCardPromise)
  | { kind: "organize"; label: string; href: string }
  | { kind: "cleanup"; label: string; detail: string; href: string }
  | { kind: "line"; id: "approvals" | "today"; text: string };

export type BriefBlockVM = {
  id: BriefBlockId;
  title: string;
  items: BriefBlockItem[];
  /** "3 more · See all in Start here →" etc. — what the cap left out. */
  more: Array<{ label: string; href: string }>;
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
  /** Emails, Estimates, Tasks — always that order; an empty block is left out. */
  blocks: BriefBlockVM[];
  /** "5 emails to file · 3 noise" → Review (`/inbox?view=organize`) */
  organize: { label: string; href: string } | null;
  /** #345 — "Organize my inbox" offered while the 90-day cleanup was never run or isn't finished */
  organizeCleanup: { label: string; detail: string; href: string } | null;
  promises: BriefCardPromise[];
  today: string | null;
  approvals: string | null;
  quiet: BriefCardQuiet[];
  /** What Listen reads (`briefSpeech`). */
  speech: string;
};

export const ORGANIZE_HREF = "/inbox?view=organize";
/** #345 — Organize's To file tab with the "Organize my inbox" button called out (it never starts by itself). */
export const ORGANIZE_CLEANUP_HREF = "/inbox?view=organize&tab=to-file&cleanup=1";
/** Where a block's hidden triage rows are: the full Start here list. */
export const START_HERE_HREF = "/triage";
export const QUOTES_HREF = "/quotes";
export const QUEUE_HREF = "/queue";

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Send nudge: the Inbox reads the quote's stored nudge itself (inbox-compose-prefill.ts `nudgePrefill`) — only the id travels. */
export function nudgeComposeHref(quoteId: string): string {
  return `/inbox?nudge=${encodeURIComponent(quoteId)}`;
}

const isItemRow = (it: BriefBlockItem) => it.kind === "row" || it.kind === "quiet" || it.kind === "promise";

export function briefCardVM(input: BriefCardInput): BriefCardVM {
  const b = input.brief;
  const notes: string[] = [];
  if (input.stale === "yesterday-afternoon") notes.push("Yesterday’s afternoon brief — this morning’s builds at 6:45.");
  if (b.error) notes.push(b.error);

  const whyOf = new Map(b.doFirst.map((d) => [d.key, d.why]));
  const pickKeys = b.doFirst.map((d) => d.key);

  // The rows the blocks list: the visible snapshot rows only. Fail closed
  // (#350 review): with no snapshot (null) the blocks hold no triage rows and
  // no picks — a pick is never shown, or given a Draft / Tasks chip, without
  // its live row. A pick whose row is gone (done, snoozed, closed) is dropped
  // with it.
  const rowsIn: CardRow[] = (input.rows ?? []).filter((r) => r && typeof r.key === "string" && rowSource(r));

  const toRow = (r: CardRow): BriefBlockRow => {
    const parsed = parseTriageKey(r.key);
    const src: TriageSource | null = rowSource(r);
    const thread = parsed?.source === "email" ? input.threads[parsed.id] : undefined;
    const quote = parsed?.source === "quote" ? input.quotes[parsed.id] : undefined;
    const lead = parsed?.source === "lead" ? input.leads?.[parsed.id] : undefined;
    const star = whyOf.has(r.key);
    const why = whyOf.get(r.key) ?? "";
    return {
      kind: "row",
      key: r.key,
      source: src ? SOURCE_LABEL[src] : "",
      title: r.title || why || "An item on your list",
      href: r.href || null,
      star,
      why: r.title ? why : "", // an untitled row shows its why as the title, once
      hint: typeof r.reason === "string" ? r.reason : "",
      draftReady: !!thread?.draft || !!quote?.nudge,
      tasksReady: !!thread?.tasks,
      leadHref: parsed?.source === "lead" && r.href ? r.href : null,
      leadSuggest: parsed?.source === "lead" && lead ? { leadId: parsed.id, readyHref: lead.readyHref } : null,
    };
  };
  const bySource = (...sources: TriageSource[]) => starFirst(rowsIn.filter((r) => sources.includes(rowSource(r)!)), pickKeys).map(toRow);

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
  const promises: BriefCardPromise[] = b.newPromiseTasks.map((p) => ({ taskId: p.taskId, title: p.title, dueLabel: p.due ? chicagoShortDate(p.due) : null }));

  const since = b.slot === "midday" && b.since ? `Since this morning: ${b.since.done} done · ${b.since.open} still open · ${b.since.new} new` : null;

  // The three blocks. Inside each, Jeff's order; picks float to the top of their own group.
  const taskRows = bySource("task", "assignment", "call");
  const listed = new Set(rowsIn.map((r) => r.key));
  const items: Record<BriefBlockId, BriefBlockItem[]> = {
    emails: [
      ...bySource("email"),
      ...(organize ? [{ kind: "organize" as const, ...organize }] : []),
      ...(organizeCleanup ? [{ kind: "cleanup" as const, ...organizeCleanup }] : []),
    ],
    estimates: [
      ...(approvals ? [{ kind: "line" as const, id: "approvals" as const, text: approvals }] : []),
      ...bySource("quote"),
      ...quiet.map((q) => ({ kind: "quiet" as const, ...q })),
      ...bySource("lead"),
      ...bySource("renewal"),
    ],
    tasks: [
      ...taskRows,
      // a promise-task already on the list as a task row shows once, as the row
      ...promises.filter((p) => !listed.has(`task:${p.taskId}`)).map((p) => ({ kind: "promise" as const, ...p })),
      ...(today ? [{ kind: "line" as const, id: "today" as const, text: `Today: ${today}` }] : []),
      ...bySource("visit"),
    ],
  };

  const blocks: BriefBlockVM[] = [];
  for (const id of BRIEF_BLOCKS) {
    const all = items[id];
    if (!all.length) continue;
    const countable = all.filter(isItemRow);
    const { hidden } = capBlock(countable, (it) => it.kind === "row" && it.star);
    const hide = new Set<BriefBlockItem>(hidden);
    const more: BriefBlockVM["more"] = [];
    const hiddenRows = hidden.filter((it) => it.kind === "row").length;
    const hiddenQuiet = hidden.filter((it) => it.kind === "quiet").length;
    const hiddenPromises = hidden.filter((it) => it.kind === "promise").length;
    if (hiddenRows) more.push({ label: `${hiddenRows} more · See all in Start here →`, href: START_HERE_HREF });
    if (hiddenQuiet) more.push({ label: `${n(hiddenQuiet, "more quiet quote", "more quiet quotes")} →`, href: QUOTES_HREF });
    if (hiddenPromises) more.push({ label: `${n(hiddenPromises, "more task", "more tasks")} from promises →`, href: QUEUE_HREF });
    blocks.push({ id, title: BRIEF_BLOCK_TITLE[id], items: all.filter((it) => !hide.has(it)), more });
  }

  return {
    id: briefId(b.userId, b.day, b.slot),
    title: briefTitle(b.slot),
    builtLabel: `${b.builtBy === "rebuild" ? "rebuilt" : "built"} ${chicagoTime(b.builtAt)}${input.stale ? ` · ${chicagoShortDate(b.builtAt)}` : ""}`,
    notes,
    canRebuild: !input.stale,
    summary: b.summary,
    since,
    blocks,
    organize,
    organizeCleanup,
    promises,
    today,
    approvals,
    quiet,
    speech: briefSpeech(b, rowsIn),
  };
}
