import type { RecordingRecord } from "@/lib/stores/recordings";
import { matchAssignee } from "@/lib/krisp/derive";
import { sameName } from "@/lib/quote-approval-rules";
import { chicagoShortDate } from "../clock";
import { triageKey } from "../keys";
import { clipLine, matchTranscriptLine, type TranscriptSegment } from "../transcript-match";
import type { CallLine, TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

const DAY = 86_400_000;
export const CALL_WINDOW_MS = 7 * DAY;

/** One undecided call to-do, whatever system it came from. */
export type CallTodo = {
  meetingId: string;
  itemKey: string;
  title: string;
  dueDate: string | null;
  assigneeIsMe: boolean;
  meetingTitle: string;
  meetingAt: number;
  segments: readonly TranscriptSegment[];
  speakerNames: Readonly<Record<string, string>>;
  meetingHref: string;
  segmentHref: (index: number) => string;
};

/**
 * A source of call to-dos. Recordings (`src/lib/stores/recordings.ts`) is
 * the one on main; when Krisp #323 meetings land, a second source reading
 * `MeetingTodo`s with no decision is added to CALL_SOURCES with this shape.
 */
export interface CallTodoSource {
  id: string;
  load(ctx: FeedCtx): Promise<CallTodo[]>;
}

export function speakerNamesOf(rec: RecordingRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, p] of Object.entries(rec.transcript?.speakers ?? {})) {
    const n = (p?.name && String(p.name).trim()) || (p?.email && String(p.email)) || "";
    if (n) out[k] = n;
  }
  return out;
}

/**
 * Pending action items from recordings in the last 7 days that are mine:
 * the item names me (matchAssignee — the same matcher Accept uses), or I
 * recorded the meeting and the item names nobody on the team.
 */
export function recordingTodos(recs: readonly RecordingRecord[], ctx: Pick<FeedCtx, "me" | "now" | "users">): CallTodo[] {
  const out: CallTodo[] = [];
  for (const rec of recs) {
    const at = rec.startedAt || rec.createdAt || 0;
    if (!at || ctx.now - at > CALL_WINDOW_MS || at > ctx.now + DAY) continue;
    const recordedByMe = rec.recordedByUserId === ctx.me.id || sameName(rec.recordedByName, ctx.me.name);
    const segments = Array.isArray(rec.transcript?.segments) ? rec.transcript.segments : [];
    const enc = encodeURIComponent(rec.id);
    for (const item of rec.actionItems) {
      if (item.disposition !== "pending") continue;
      const who = matchAssignee(item.assigneeName, ctx.users);
      const assigneeIsMe = who?.id === ctx.me.id;
      if (!assigneeIsMe && !(recordedByMe && !who)) continue;
      out.push({
        meetingId: rec.id,
        itemKey: item.key,
        title: item.title,
        dueDate: item.dueDate,
        assigneeIsMe,
        meetingTitle: rec.title || rec.customer || rec.id,
        meetingAt: at,
        segments,
        speakerNames: speakerNamesOf(rec),
        meetingHref: `/recordings/${enc}?tab=actions`,
        segmentHref: (i) => `/recordings/${enc}?tab=transcript&seg=${i}`,
      });
    }
  }
  return out;
}

export function selectCalls(todos: readonly CallTodo[]): TriageCandidate[] {
  return todos.map((t) => {
    const facts: TriageFact[] = [{ kind: "call_todo" }];
    if (t.assigneeIsMe) facts.push({ kind: "call_names_me" });
    const m = matchTranscriptLine(t.title, t.segments);
    const callLine: CallLine = m
      ? { found: true, speaker: t.speakerNames[String(m.speaker)] || `Speaker ${m.speaker + 1}`, text: clipLine(m.text), start: m.start, href: t.segmentHref(m.index) }
      : { found: false, href: t.meetingHref };
    return {
      key: triageKey.call(t.meetingId, t.itemKey),
      source: "call",
      title: t.title,
      sub: [`From ${t.meetingTitle}`, t.dueDate ? `due ${t.dueDate}` : ""].filter(Boolean).join(" · "),
      href: callLine.href,
      since: t.meetingAt,
      facts,
      callLine,
      mention: `${t.meetingTitle} (${chicagoShortDate(t.meetingAt)})`,
    };
  });
}

export const recordingsCallSource: CallTodoSource = {
  id: "recordings",
  async load(ctx) {
    return recordingTodos(await ctx.data.recordings(), ctx);
  },
};

export const CALL_SOURCES: readonly CallTodoSource[] = [recordingsCallSource];

export const callsFeed: TriageFeed = {
  source: "call",
  async load(ctx) {
    const lists = await Promise.all(CALL_SOURCES.map((s) => s.load(ctx)));
    return { candidates: selectCalls(lists.flat()) };
  },
};
