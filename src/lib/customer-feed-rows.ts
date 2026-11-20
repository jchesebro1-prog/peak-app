/**
 * #21 customer Activity feed — PURE per-source row builders. Structural arg
 * types, ZERO store imports (every store module value-imports doc-store,
 * which must never reach this spec-tested / potentially-client-safe layer).
 * The ONE allowed import is VISIT_STAGE_META from @/lib/lead-thread — that
 * module is dependency-free by construction (plan 03) — and `@/lib/estimate-number`
 * (#223), which is pure by construction.
 *
 * Vocab mirrors (drift-guarded by exact-literal specs, see the #21 section
 * of the harness): QUOTE_VERB mirrors quotes.STAGE_LABEL's stage set;
 * SURVEY_STAGE_LABEL mirrors surveys.STAGES labels.
 */
import { VISIT_STAGE_META } from "@/lib/lead-thread";
import { displayQuoteNumber } from "@/lib/estimate-number";
// Type-only — erased at build time, so the zero-store-import / client-bundle
// rule still holds at runtime (no store code is ever pulled in here).
import type { QuoteStatus } from "@/lib/stores/quotes";
import type { SurveyStage } from "@/lib/stores/surveys";

export type FeedKind =
  | "note"
  | "quote"
  | "comm"
  | "visit"
  | "flame"
  | "inspection"
  | "survey"
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
  comm: { letter: "C", ink: "#7b3f8a", soft: "#f3eaf5" },
  visit: { letter: "V", ink: "#1f7a52", soft: "#eaf6ef" },
  flame: { letter: "F", ink: "#b4543a", soft: "#f8ece7" },
  inspection: { letter: "I", ink: "#b4543a", soft: "#f8ece7" },
  survey: { letter: "S", ink: "#3155a8", soft: "#e9eefb" },
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

export function commFeedRows(thread: {
  id: string;
  subject: string;
  status: string;
  /** Thread-level Deleted-folder flag — distinct from the row tombstone
   *  (which listDocs already excludes). */
  deleted?: boolean;
  messages: Array<{ id: string; at: number; direction: "in" | "out"; channel: string; author: string }>;
}): FeedRow[] {
  if (thread.status === "draft" || thread.deleted) return [];
  const href = "/inbox?thread=" + encodeURIComponent(thread.id);
  return (thread.messages || []).map((m) =>
    row(
      "comm",
      `comm:${thread.id}:${m.id}`,
      m.at,
      thread.subject || "Conversation",
      `${m.direction === "in" ? "Received" : "Sent"} · ${m.channel}`,
      href,
      m.author || ""
    )
  );
}

/**
 * #323 — one row per linked, visible Krisp meeting: "Met with Tom Ellis — Osakis PAC scope review", in the
 * comm family (the comms "meeting" channel's verb, comms.ts CHANNEL_META.meeting), opening the meeting reader.
 * Names are the attendees' display names, outside attendees (no team login) first; no summary text is copied.
 * `href` is the reader deep link the loader builds (format.ts meetingReaderHref).
 */
export function meetingFeedRows(m: {
  id: string;
  title: string;
  startedAt: number | null;
  durationLabel: string;
  href: string;
  attendees: Array<{ display: string; internal: boolean }>;
}): FeedRow[] {
  if (m.startedAt == null) return [];
  const names = [...m.attendees.filter((a) => !a.internal), ...m.attendees.filter((a) => a.internal)]
    .map((a) => a.display.trim())
    .filter(Boolean)
    .filter((n, i, all) => all.indexOf(n) === i)
    .slice(0, 2);
  const title = m.title || "Untitled meeting";
  return [
    row(
      "comm",
      `meeting:${m.id}`,
      m.startedAt,
      names.length ? `Met with ${names.join(", ")} — ${title}` : `Meeting — ${title}`,
      `Meeting · ${m.durationLabel}`,
      m.href,
      ""
    ),
  ];
}

export function visitFeedRows(v: {
  id: string;
  reason: string;
  stage: string;
  startAt: number | null;
  createdAt: number;
  assignedTo: string;
}): FeedRow[] {
  const meta = VISIT_STAGE_META[v.stage as keyof typeof VISIT_STAGE_META];
  return [
    row(
      "visit",
      `visit:${v.id}`,
      v.startAt ?? v.createdAt,
      `Site visit — ${v.reason}`,
      meta ? meta.label : v.stage,
      "/venue-assessments",
      v.assignedTo || ""
    ),
  ];
}

const JOB_NOUN = { flame: "Flame test", inspection: "Inspection" } as const;
const JOB_OPEN_VERB = { flame: "approved", inspection: "requested" } as const;
const JOB_HREF = { flame: "/flame-tests", inspection: "/inspections" } as const;

/**
 * Flame / repair / inspection point stamps. openedAt is approvedAt (flame,
 * repair — epoch-ms, always set) or requestedAt (inspection — epoch-ms
 * DEFAULTING TO 0 on legacy records, hence the falsy skip). completedAt is
 * epoch-ms for flame/repair; for inspections the loader precomputes it via
 * the store's completedAtOf (ISO surveyDate/reportDate → ms) — the pure
 * module never parses dates. The "scheduled" transition has NO ms stamp
 * anywhere (scheduledDate is a bare ISO day) — deliberately skipped.
 */
export function jobFeedRows(
  kind: "flame" | "inspection",
  job: {
    id: string;
    venue: string;
    openedAt: number | null;
    openedBy: string;
    completedAt: number | null;
    completedBy: string;
  }
): FeedRow[] {
  const rows: FeedRow[] = [];
  if (job.openedAt)
    rows.push(
      row(kind, `${kind}:${job.id}:open`, job.openedAt, `${JOB_NOUN[kind]} ${job.id} ${JOB_OPEN_VERB[kind]}`, job.venue, JOB_HREF[kind], job.openedBy || "")
    );
  if (job.completedAt != null)
    rows.push(
      row(kind, `${kind}:${job.id}:done`, job.completedAt, `${JOB_NOUN[kind]} ${job.id} completed`, job.venue, JOB_HREF[kind], job.completedBy || "")
    );
  return rows;
}

/** Mirrors surveys.STAGES labels (same drift guard as QUOTE_VERB). */
const SURVEY_STAGE_LABEL: Record<SurveyStage, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  onsite: "On-site",
  completed: "Completed",
};

/** One row per survey at updatedAt — surveys carry no completedAt. */
export function surveyFeedRows(s: { id: string; stage: string; venue: string; updatedAt: number }): FeedRow[] {
  return [
    row(
      "survey",
      `survey:${s.id}`,
      s.updatedAt,
      `Survey ${s.id} — ${SURVEY_STAGE_LABEL[s.stage as SurveyStage] ?? s.stage}`,
      s.venue || "",
      `/venue-assessments?id=${encodeURIComponent(s.id)}`,
      ""
    ),
  ];
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
