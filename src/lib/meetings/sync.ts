/**
 * #323 — the Krisp meeting sync (spec "## Sync"). Server-only (DB, Krisp key):
 * never import from a "use client" module (pinned in scripts/test-meetings-323.ts).
 *
 * `syncRepMeetings` is the engine, every side effect injected (`SyncDeps`) so
 * the spec tests run it against a fake Krisp client. Concurrency: a meeting
 * that already exists is written through `patchMeeting` with a PURE callback
 * over the latest doc, and every slow call (detail, calendar, email lookups)
 * happens before it — so a rep's filing, links, speaker map, attendee edits,
 * to-do decisions or share made while a batch runs are never overwritten.
 */
import { deriveSummary } from "@/lib/krisp/derive";
import {
  KrispApiError,
  KrispAuthError,
  KrispForbiddenError,
  KrispRateLimitError,
} from "@/lib/krisp/errors";
import {
  createKrispClient,
  krispPersonFrom,
  type KrispClient,
  type KrispListedMeeting,
  type KrispListQuery,
  type KrispMeetingPage,
} from "@/lib/krisp/client";
import { getKrispConnection, listKrispConnections } from "@/lib/krisp/connections";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getEvent, listUpcomingEvents } from "@/lib/google/calendar";
import { contactsByEmails } from "@/lib/identity/lookup";
import { activeUsers } from "@/lib/users";
import { allRecordings, setRecordingMeeting, type KrispNoteBlock, type RecordingRecord } from "@/lib/stores/recordings";
import * as MS from "@/lib/stores/meetings";
import { buildMatchIndex, siteIdForDocLoc } from "./index-build";
import { matchMeeting, type MatchIndex } from "./match";
import { mergeAttendees, relabel, resolveAttendees, speakerLabel } from "./render";
import { EMPTY_SYNC_STATE, getSyncState, setSyncState, type SyncState } from "./sync-state";
import { mergeTodos, suggestTodoKind } from "./todos";
import type { KrispPerson, MeetingCalendar, MeetingRecord, MeetingSegment } from "./types";
import {
  BACKFILL_STEP_MS,
  DETAIL_RETRY_MS,
  HOME_STALE_MS,
  NOISE_MAX_SEC,
  ROLLING_WINDOW_MS,
  SYNC_BUDGET_MS,
  emptyLinks,
  meetingIdFor,
} from "./types";

export type EmailHit = { contactId?: string; userId?: string };

export type SyncDeps = {
  now: () => number;
  client: Pick<KrispClient, "meeting"> & { listMeetings: (q: KrispListQuery) => Promise<KrispMeetingPage> };
  calendar: (startMs: number, endMs: number) => Promise<MeetingCalendar | null>;
  buildIndex: () => Promise<MatchIndex>;
  lookupEmails: (emails: string[]) => Promise<Map<string, EmailHit>>;
  /** a recording's `(customerId, locationId)` doc reference → `sites.id` */
  siteIdFor: (customerId: string | null, locationId: string | null) => Promise<string | null>;
  getState: () => Promise<SyncState>;
  setState: (patch: Partial<SyncState>) => Promise<void>;
  recordings: () => Promise<RecordingRecord[]>;
  onRecordingAttached: (recordingId: string, meetingId: string) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  budgetMs: number;
};

export type SyncResult = { listed: number; created: number; detailed: number; complete: boolean; error: string | null };

const PACE_MS = 220; // ≤ 5 req/s per Krisp account

/** Recompute suggestions + noise for an unfiled meeting; a filed one comes back as-is. */
export function rematchMeeting(m: MeetingRecord, index: MatchIndex): MeetingRecord {
  if (m.filedAt) return m;
  const d = deriveSummary(m.krisp.notes as { blocks: KrispNoteBlock[] } | null);
  const summaryText = [...d.summary.map((s) => `${s.title} ${s.description}`), ...d.keyPoints].join(" ");
  const r = matchMeeting({
    title: m.krisp.title,
    calendarTitle: m.calendar?.title ?? null,
    summaryText,
    attendees: m.attendees.filter((a) => !a.removed).map((a) => ({ name: a.name, email: a.email })),
    speakerNames: Object.keys(m.krisp.speakers).map((i) => speakerLabel(m, i)),
    startMs: m.krisp.startedAt,
    endMs: m.krisp.startedAt != null && m.krisp.durationSec != null ? m.krisp.startedAt + m.krisp.durationSec * 1000 : null,
    durationSec: m.krisp.durationSec,
    ownerUserId: m.ownerUserId,
  }, index);
  return { ...m, suggestions: r.suggestions, noise: m.noiseOverride ? false : r.noise };
}

function blankMeeting(l: KrispListedMeeting, userId: string, now: number): MeetingRecord {
  return {
    id: meetingIdFor(l.id), krispMeetingId: l.id, seenBy: [userId], ownerUserId: userId, recordingId: null,
    krisp: {
      title: l.title, startedAt: l.startedAt, durationSec: l.durationSec, source: l.source, status: l.status, tags: l.tags,
      participants: l.participants, speakers: {}, segments: [], notes: null, fetchedAt: now, detailFetchedAt: null, removedAt: null,
    },
    calendar: null, attendees: [], speakerMap: {}, links: emptyLinks(), filedAt: null, filedBy: null, suggestions: [],
    noise: false, noiseOverride: false, todos: [], share: null, createdAt: now, updatedAt: now,
  };
}

/** Everything slow, fetched before the write. */
type Prefetched = {
  detail: { speakers: Record<string, KrispPerson>; segments: MeetingSegment[]; notes: { blocks: unknown[] } | null } | null;
  calendar: MeetingCalendar | null;
  recording: { rec: RecordingRecord; siteId: string | null } | null;
  emails: Map<string, EmailHit>;
};

/** A recording made from a parent record pre-files the meeting (spec §Sync 5) —
 *  unless the rep already filed it, in which case only the pointer is set. */
function attachRecording(m: MeetingRecord, rec: RecordingRecord, siteId: string | null, now: number): MeetingRecord {
  if (m.filedAt) return { ...m, recordingId: rec.id };
  const links = { ...m.links };
  if (rec.customerId) links.customerId = rec.customerId;
  if (siteId) links.siteId = siteId;
  if (rec.parentKind === "site_visit" || rec.parentKind === "survey" || rec.parentKind === "project" || rec.parentKind === "engagement") {
    links.work = { type: rec.parentKind, id: rec.parentId, label: rec.title || rec.parentId };
  }
  return { ...m, recordingId: rec.id, links, filedAt: now, filedBy: "Recording" };
}

/** The pure sync step over the LATEST doc: header refresh, detail, seenBy/owner,
 *  calendar (once), recording (once), attendees, to-dos, then rematch. */
function applySync(
  cur: MeetingRecord, l: KrispListedMeeting, userId: string, now: number, pre: Prefetched, index: MatchIndex,
): { next: MeetingRecord; attached: string | null } {
  let m: MeetingRecord = {
    ...cur,
    krisp: {
      ...cur.krisp,
      title: l.title, startedAt: l.startedAt, durationSec: l.durationSec, source: l.source, status: l.status, tags: l.tags,
      participants: l.participants, fetchedAt: now, removedAt: null,
      ...(pre.detail ? { ...pre.detail, detailFetchedAt: now } : {}),
    },
    seenBy: cur.seenBy.includes(userId) ? cur.seenBy : [...cur.seenBy, userId],
    // the Krisp account that owns the meeting wins; a shared copy never takes it over
    ownerUserId: l.ownership === "owned" ? userId : cur.ownerUserId || userId,
    calendar: cur.calendar ?? pre.calendar,
  };
  let attached: string | null = null;
  if (pre.recording && !m.recordingId) {
    m = attachRecording(m, pre.recording.rec, pre.recording.siteId, now);
    attached = pre.recording.rec.id;
  }
  m.attendees = resolveAttendees(mergeAttendees(m.attendees, m.krisp.participants, m.calendar), pre.emails);
  const pairs: [string, string][] = Object.entries(m.speakerMap).map(([idx, ref]) => [speakerLabel(m, idx), ref.name]);
  const people = {
    users: index.users.map((u) => ({ id: u.id, name: u.name })),
    contacts: index.contacts.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() })),
  };
  m.todos = mergeTodos(m.todos, deriveSummary(m.krisp.notes as { blocks: KrispNoteBlock[] } | null).actionItems,
    (a) => suggestTodoKind(a ? relabel(a, pairs) : null, people));
  return { next: rematchMeeting(m, index), attached };
}

export async function syncRepMeetings(userId: string, mode: "recent" | "backfill", deps: SyncDeps): Promise<SyncResult> {
  const started = deps.now();
  const res: SyncResult = { listed: 0, created: 0, detailed: 0, complete: false, error: null };
  const st = await deps.getState();
  const now = deps.now();
  const backfillFrom = st.backfillFrom ?? now - BACKFILL_STEP_MS;
  const window = mode === "recent"
    ? { from: now - (st.syncedAt == null ? BACKFILL_STEP_MS : ROLLING_WINDOW_MS), to: null as number | null, cursor: null as string | null }
    : { from: backfillFrom - BACKFILL_STEP_MS, to: backfillFrom as number | null, cursor: st.backfillCursor };
  const overBudget = () => deps.now() - started > deps.budgetMs;
  const stopEarly = async (cursor: string | null) => {
    if (mode === "backfill") await deps.setState({ backfillCursor: cursor });
    return res;
  };
  const index = await deps.buildIndex();
  const recs = await deps.recordings();
  const seen = new Set<string>();
  let cursor = window.cursor;
  try {
    for (;;) {
      if (overBudget()) return stopEarly(cursor);
      const page = await deps.client.listMeetings({
        from: new Date(window.from).toISOString(),
        to: window.to != null ? new Date(window.to).toISOString() : undefined,
        cursor, limit: 100,
      });
      await deps.pause(PACE_MS);
      for (const l of page.meetings) {
        // resume re-reads this page; meetings already detailed are cheap the second time
        if (overBudget()) return stopEarly(cursor);
        res.listed++;
        seen.add(l.id);
        const id = meetingIdFor(l.id);
        const snap = await MS.getMeeting(id);
        if (!snap) res.created++;

        const pre: Prefetched = { detail: null, calendar: null, recording: null, emails: new Map() };
        const tooShort = (l.durationSec ?? Infinity) < NOISE_MAX_SEC && !snap?.noiseOverride;
        const notesEmpty = !snap?.krisp.notes || !(snap.krisp.notes.blocks || []).length;
        const young = (l.startedAt ?? 0) > now - DETAIL_RETRY_MS;
        if (!tooShort && (!snap?.krisp.detailFetchedAt || (notesEmpty && young))) {
          try {
            const d = await deps.client.meeting(l.id);
            await deps.pause(PACE_MS);
            const speakers: Record<string, KrispPerson> = {};
            for (const [k, v] of Object.entries(d.transcript?.speakers || {})) {
              if (v && typeof v === "object") speakers[k] = krispPersonFrom(v as Record<string, unknown>);
            }
            pre.detail = {
              speakers,
              segments: (d.transcript?.segments || []).map((s) => ({ speaker: String(s.speaker), text: s.text, start: s.start, end: s.end })),
              notes: d.notes ?? null,
            };
            res.detailed++;
          } catch (e) {
            // 409 still processing, or a one-off API failure on this meeting → retry next sync.
            // Auth / forbidden / rate limit end the batch below.
            if (e instanceof KrispAuthError || e instanceof KrispForbiddenError || e instanceof KrispRateLimitError) throw e;
            if (!(e instanceof KrispApiError)) throw e; // KrispNotReadyError (409) is a KrispApiError
          }
        }
        if (!snap && l.startedAt != null) {
          pre.calendar = await deps.calendar(l.startedAt, l.startedAt + (l.durationSec ?? 1800) * 1000);
        }
        const rec = recs.find((r) => r.krisp?.meetingId === l.id);
        if (rec && !snap?.recordingId) pre.recording = { rec, siteId: await deps.siteIdFor(rec.customerId, rec.locationId) };
        const emails = [
          ...l.participants.map((p) => p.email),
          ...(snap?.calendar ?? pre.calendar)?.attendees.map((a) => a.email) ?? [],
          ...(snap?.attendees || []).map((a) => a.email),
        ].filter((e): e is string => !!e).map((e) => e.toLowerCase());
        pre.emails = emails.length ? await deps.lookupEmails([...new Set(emails)]) : new Map();

        const out: { attached: string | null } = { attached: null };
        const step = (cur: MeetingRecord) => {
          const r = applySync(cur, l, userId, now, pre, index);
          out.attached = r.attached;
          return r.next;
        };
        // existing doc (or one another rep's sync created meanwhile) → patch the latest; else create
        const patched = await MS.patchMeeting(id, step);
        if (!patched) await MS.saveMeeting(step(blankMeeting(l, userId, now)));
        if (out.attached) await deps.onRecordingAttached(out.attached, id);
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch (e) {
    if (e instanceof KrispRateLimitError) return stopEarly(cursor);
    if (e instanceof KrispAuthError || e instanceof KrispForbiddenError) {
      res.error = e.message || "Krisp key rejected";
      await deps.setState({ lastError: res.error });
      return res;
    }
    throw e;
  }
  if (mode === "recent") {
    // a meeting in this rep's window that Krisp no longer lists is flagged, never deleted
    for (const m of await MS.allMeetings()) {
      if (m.seenBy.includes(userId) && !seen.has(m.krispMeetingId) && (m.krisp.startedAt ?? 0) >= window.from && !m.krisp.removedAt) {
        await MS.patchMeeting(m.id, (x) => (x.krisp.removedAt ? x : { ...x, krisp: { ...x.krisp, removedAt: now } }));
      }
    }
    await deps.setState({ syncedAt: now, lastError: null, ...(st.backfillFrom == null ? { backfillFrom: window.from } : {}) });
  } else {
    await deps.setState({ backfillFrom: window.from, backfillCursor: null, lastError: null });
  }
  res.complete = true;
  return res;
}

/* ---------- real dependencies ---------- */

async function calendarFor(userId: string, startMs: number, endMs: number): Promise<MeetingCalendar | null> {
  try {
    const key = personalKey(userId);
    const info = await getConnectionInfo(key);
    if (!info || !hasCalendarScope(info.scope)) return null;
    const evs = (await listUpcomingEvents(key, { timeMinMs: startMs - 15 * 60_000, timeMaxMs: endMs + 15 * 60_000, maxResults: 10 }))
      .filter((e) => !e.allDay);
    const overlap = (e: { startMs: number; endMs: number }) => Math.max(0, Math.min(e.endMs, endMs) - Math.max(e.startMs, startMs));
    const best = evs.sort((a, b) => overlap(b) - overlap(a))[0];
    if (!best || overlap(best) <= 0) return null;
    const det = await getEvent(key, best.id);
    return {
      eventId: best.id,
      title: det.title || best.title,
      attendees: det.attendees.filter((a) => a.email).map((a) => ({ email: a.email.toLowerCase(), name: a.name || null })),
    };
  } catch {
    return null;
  }
}

/** Email → Peak user (email / googleEmail) else → contact. Users load once per run. */
function emailLookup(): (emails: string[]) => Promise<Map<string, EmailHit>> {
  let users: Awaited<ReturnType<typeof activeUsers>> | null = null;
  return async (emails) => {
    const out = new Map<string, EmailHit>();
    const lower = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!lower.length) return out;
    users ??= await activeUsers();
    for (const e of lower) {
      const u = users.find((x) => x.email.toLowerCase() === e || (x.googleEmail || "").toLowerCase() === e);
      if (u) out.set(e, { userId: u.id });
    }
    const rest = lower.filter((e) => !out.has(e));
    if (rest.length) {
      for (const [e, r] of await contactsByEmails(rest)) if (r && "contactId" in r) out.set(e.toLowerCase(), { contactId: r.contactId });
    }
    return out;
  };
}

export async function runMeetingsSync(
  userId: string, mode: "recent" | "backfill" = "recent", budgetMs: number = SYNC_BUDGET_MS,
): Promise<SyncResult> {
  const conn = await getKrispConnection(userId);
  if (!conn) return { listed: 0, created: 0, detailed: 0, complete: true, error: "Krisp isn't connected" };
  return syncRepMeetings(userId, mode, {
    now: Date.now,
    client: createKrispClient(conn.apiKey),
    calendar: (s, e) => calendarFor(userId, s, e),
    buildIndex: buildMatchIndex,
    lookupEmails: emailLookup(),
    siteIdFor: siteIdForDocLoc,
    getState: async () => (await getSyncState(userId)) ?? EMPTY_SYNC_STATE,
    setState: (p) => setSyncState(userId, p),
    recordings: allRecordings,
    // keep the recording → meeting back-pointer (spec §Sync step 5)
    onRecordingAttached: (recId, meetingId) => setRecordingMeeting(recId, meetingId),
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    budgetMs: Math.min(SYNC_BUDGET_MS, budgetMs),
  });
}

const lastRun = new Map<string, number>();

/** Home-load trigger: a recent sync when > 10 min since the last one (null = skipped / no connection). */
export async function syncMeetingsIfStale(userId: string): Promise<SyncResult | null> {
  const st = await getSyncState(userId);
  if (!st) return null;
  const at = Date.now();
  if ((st.syncedAt && at - st.syncedAt < HOME_STALE_MS) || at - (lastRun.get(userId) ?? 0) < HOME_STALE_MS) return null;
  lastRun.set(userId, at);
  return runMeetingsSync(userId, "recent").catch(() => null);
}

const MIN_REP_BUDGET_MS = 5_000;

/** Cron rider: a recent sync for every connected rep, sharing one overall time budget. */
export async function syncAllMeetings(budgetMs: number = SYNC_BUDGET_MS): Promise<Record<string, SyncResult>> {
  const deadline = Date.now() + budgetMs;
  const out: Record<string, SyncResult> = {};
  for (const c of await listKrispConnections()) {
    const left = deadline - Date.now();
    if (left < MIN_REP_BUDGET_MS) {
      out[c.userId] = { listed: 0, created: 0, detailed: 0, complete: false, error: null };
      continue;
    }
    out[c.userId] = await runMeetingsSync(c.userId, "recent", left).catch((e: unknown) => ({
      listed: 0, created: 0, detailed: 0, complete: false, error: String((e as Error)?.message || e),
    }));
  }
  return out;
}
