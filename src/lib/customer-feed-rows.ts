/**
 * #21 customer Activity feed — PURE per-source row builders. Structural arg
 * types, ZERO store imports (every store module value-imports doc-store,
 * which must never reach this spec-tested / potentially-client-safe layer).
 * The ONE allowed import is VISIT_STAGE_META from @/lib/lead-thread — that
 * module is dependency-free by construction (plan 03).
 *
 * Vocab mirrors (drift-guarded by exact-literal specs, see the #21 section
 * of the harness): QUOTE_VERB mirrors quotes.STAGE_LABEL's stage set;
 * SURVEY_STAGE_LABEL mirrors surveys.STAGES labels. Project stage labels
 * vary per kind (stagesFor) and are passed IN by the server loader.
 */
import { VISIT_STAGE_META } from "@/lib/lead-thread";

export type FeedKind =
  | "note"
  | "quote"
  | "comm"
  | "visit"
  | "flame"
  | "repair"
  | "inspection"
  | "survey"
  | "project-stage"
  | "project-note";

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
};

/** Letter-dot families per kind (the app's chip color families). */
export const FEED_META: Record<FeedKind, { letter: string; ink: string; soft: string }> = {
  note: { letter: "N", ink: "#8a6d1f", soft: "#fbf3dd" },
  quote: { letter: "Q", ink: "#3155a8", soft: "#e9eefb" },
  comm: { letter: "C", ink: "#7b3f8a", soft: "#f3eaf5" },
  visit: { letter: "V", ink: "#1f7a52", soft: "#eaf6ef" },
  flame: { letter: "F", ink: "#b4543a", soft: "#f8ece7" },
  repair: { letter: "R", ink: "#b4543a", soft: "#f8ece7" },
  inspection: { letter: "I", ink: "#b4543a", soft: "#f8ece7" },
  survey: { letter: "S", ink: "#3155a8", soft: "#e9eefb" },
  "project-stage": { letter: "P", ink: "#3155a8", soft: "#e9eefb" },
  "project-note": { letter: "P", ink: "#8a6d1f", soft: "#fbf3dd" },
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
const QUOTE_VERB: Record<string, string> = {
  draft: "drafted",
  sent: "sent",
  won: "won",
  lost: "lost",
};

export function quoteFeedRows(q: {
  id: string;
  name: string;
  history: Array<{ at: number; to: string }>;
  /** setPoReceived writes NO history entry — this annex field is the record. */
  poReceivedAt?: number | null;
  portalAcceptance?: { at: number; by: string } | null;
}): FeedRow[] {
  const href = "/quotes?id=" + encodeURIComponent(q.id);
  const rows = (q.history || []).map((h, i) =>
    row("quote", `quote:${q.id}:${i}`, h.at, `Quote ${q.id} ${QUOTE_VERB[h.to] ?? h.to}`, q.name, href, "")
  );
  if (q.poReceivedAt != null)
    rows.push(row("quote", `quote:${q.id}:po`, q.poReceivedAt, `Quote ${q.id} PO received`, q.name, href, ""));
  if (q.portalAcceptance)
    rows.push(
      row(
        "quote",
        `quote:${q.id}:portal`,
        q.portalAcceptance.at,
        `Quote ${q.id} accepted in portal`,
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
      "/field-survey",
      v.assignedTo || ""
    ),
  ];
}

const JOB_NOUN = { flame: "Flame test", repair: "Repair", inspection: "Inspection" } as const;
const JOB_OPEN_VERB = { flame: "approved", repair: "approved", inspection: "requested" } as const;
const JOB_HREF = { flame: "/flame-tests", repair: "/repairs", inspection: "/inspections" } as const;

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
  kind: "flame" | "repair" | "inspection",
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
const SURVEY_STAGE_LABEL: Record<string, string> = {
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
      `Survey ${s.id} — ${SURVEY_STAGE_LABEL[s.stage] ?? s.stage}`,
      s.venue || "",
      `/field-survey?id=${encodeURIComponent(s.id)}`,
      ""
    ),
  ];
}

/**
 * Project stage history (D83 — normalized to [] on read; anchored with an
 * opening from:null entry on post-D83 records, legitimately empty on legacy
 * ones) + embedded ProjectNotes. REMEMBER: notes[] is NEWEST-FIRST (addNote
 * unshifts) — order is NOT assumed here; the loader sorts the merged feed.
 * stageShort maps stage keys → display labels (built by the loader from
 * stagesFor(p.kind) — labels differ between projects and orders).
 */
export function projectFeedRows(
  p: {
    id: string;
    name: string;
    stageHistory: Array<{ at: number; to: string; by: string }>;
    notes: Array<{ id: string; at: number; by: string; text: string }>;
  },
  stageShort: Record<string, string>
): FeedRow[] {
  const href = "/projects?id=" + encodeURIComponent(p.id);
  const rows = (p.stageHistory || []).map((h, i) =>
    row("project-stage", `project:${p.id}:stage:${i}`, h.at, `Project ${p.id} → ${stageShort[h.to] ?? h.to}`, p.name, href, h.by || "")
  );
  for (const n of p.notes || [])
    rows.push(row("project-note", `project:${p.id}:note:${n.id}`, n.at, n.text.slice(0, 80), p.name, href, n.by || ""));
  return rows;
}

/** Real NoteRecord rows — full text as title (the UI clamps display). */
export function noteFeedRows(n: { id: string; at: number; by: string; text: string }): FeedRow[] {
  return [row("note", `note:${n.id}`, n.at, n.text, "Note", null, n.by || "")];
}
