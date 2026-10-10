import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getDoc, listDocs, patchDoc, upsertDoc } from "@/db/doc-store";
import { meetings as meetingsTable } from "@/db/doc-tables";
import type { MeetingRecord } from "@/lib/meetings/types";
import { emptyLinks } from "@/lib/meetings/types";
import { canSeeMeeting } from "@/lib/meetings/visibility";

const COLL = "meetings" as const;

export function normalizeMeeting(d: Partial<MeetingRecord> & { id: string }): MeetingRecord {
  const k = (d.krisp || {}) as Partial<MeetingRecord["krisp"]>;
  const l = (d.links || {}) as Partial<MeetingRecord["links"]>;
  return {
    id: d.id,
    krispMeetingId: d.krispMeetingId || d.id.replace(/^km-/, ""),
    seenBy: Array.isArray(d.seenBy) ? d.seenBy : [],
    ownerUserId: d.ownerUserId || "",
    recordingId: d.recordingId ?? null,
    krisp: {
      title: k.title || "", startedAt: k.startedAt ?? null, durationSec: k.durationSec ?? null,
      source: k.source ?? null, status: k.status || "", tags: Array.isArray(k.tags) ? k.tags : [],
      participants: Array.isArray(k.participants) ? k.participants : [],
      speakers: k.speakers && typeof k.speakers === "object" ? k.speakers : {},
      segments: Array.isArray(k.segments) ? k.segments : [],
      notes: k.notes ?? null, fetchedAt: k.fetchedAt ?? 0, detailFetchedAt: k.detailFetchedAt ?? null,
      removedAt: k.removedAt ?? null,
    },
    calendar: d.calendar ?? null,
    attendees: Array.isArray(d.attendees) ? d.attendees : [],
    speakerMap: d.speakerMap && typeof d.speakerMap === "object" ? d.speakerMap : {},
    links: {
      ...emptyLinks(),
      customerId: l.customerId ?? null, siteId: l.siteId ?? null,
      contactIds: Array.isArray(l.contactIds) ? l.contactIds : [],
      work: l.work ?? null,
      internalUserIds: Array.isArray(l.internalUserIds) ? l.internalUserIds : [],
    },
    filedAt: d.filedAt ?? null, filedBy: d.filedBy ?? null,
    suggestions: Array.isArray(d.suggestions) ? d.suggestions : [],
    noise: !!d.noise, noiseOverride: !!d.noiseOverride,
    todos: Array.isArray(d.todos) ? d.todos : [],
    share: d.share ?? null,
    createdAt: d.createdAt ?? 0, updatedAt: d.updatedAt ?? 0,
  };
}

export async function getMeeting(id: string): Promise<MeetingRecord | null> {
  const d = await getDoc<MeetingRecord>(COLL, id);
  return d ? normalizeMeeting(d) : null;
}

export async function saveMeeting(m: MeetingRecord): Promise<MeetingRecord> {
  const next = normalizeMeeting({ ...m, updatedAt: Date.now(), createdAt: m.createdAt || Date.now() });
  await upsertDoc(COLL, next);
  return next;
}

export async function patchMeeting(id: string, fn: (m: MeetingRecord) => MeetingRecord): Promise<MeetingRecord | null> {
  const res = await patchDoc<MeetingRecord>(COLL, id, (cur) => {
    return normalizeMeeting({ ...fn(normalizeMeeting(cur)), updatedAt: Date.now() });
  });
  return res ? normalizeMeeting(res) : null;
}

export async function allMeetings(): Promise<MeetingRecord[]> {
  const rows = await listDocs<MeetingRecord>(COLL);
  return rows.map(normalizeMeeting).sort((a, b) => (b.krisp.startedAt ?? 0) - (a.krisp.startedAt ?? 0));
}

export async function meetingsVisibleTo(userId: string): Promise<MeetingRecord[]> {
  return (await allMeetings()).filter((m) => canSeeMeeting(m, userId));
}

export async function meetingsLinkedTo(
  kind: "company" | "venue" | "contact" | "work", id: string, viewerId: string,
): Promise<MeetingRecord[]> {
  return (await meetingsVisibleTo(viewerId)).filter((m) =>
    kind === "company" ? m.links.customerId === id
    : kind === "venue" ? m.links.siteId === id
    : kind === "contact" ? m.links.contactIds.includes(id)
    : m.links.work?.id === id);
}

export type MeetingWindowRef = { id: string; krispMeetingId: string; ownerUserId: string; seenBy: string[]; removedAt: number | null };

/** #323 — the sync's removed-flag candidates: live meetings `userId` has seen that started at/after `fromMs`.
 *  Projects only the ids/owner/seenBy/removedAt (never transcripts), filtered in SQL. */
export async function meetingRefsSeenBy(userId: string, fromMs: number): Promise<MeetingWindowRef[]> {
  const db = await getDb();
  const t = meetingsTable;
  const rows = await db
    .select({
      id: t.id,
      krispMeetingId: sql<string | null>`${t.doc}->>'krispMeetingId'`,
      ownerUserId: sql<string | null>`${t.doc}->>'ownerUserId'`,
      seenBy: sql<unknown>`${t.doc}->'seenBy'`,
      removedAt: sql<string | null>`${t.doc}->'krisp'->>'removedAt'`,
    })
    .from(t)
    .where(and(
      eq(t.deleted, false),
      sql`${t.doc}->'seenBy' @> ${JSON.stringify([userId])}::jsonb`,
      sql`jsonb_typeof(${t.doc}->'krisp'->'startedAt') = 'number'`,
      sql`(${t.doc}->'krisp'->>'startedAt')::numeric >= ${fromMs}`,
    ));
  return rows.map((r) => ({
    id: r.id,
    krispMeetingId: r.krispMeetingId || r.id.replace(/^km-/, ""),
    ownerUserId: r.ownerUserId || "",
    seenBy: Array.isArray(r.seenBy) ? r.seenBy.filter((x): x is string => typeof x === "string") : [],
    removedAt: r.removedAt != null && Number.isFinite(Number(r.removedAt)) ? Number(r.removedAt) : null,
  }));
}

/** #323 — the Meetings box row: everything a list needs, never the transcript, notes, attendees or to-dos. */
export type MeetingListRow = Pick<
  MeetingRecord,
  "id" | "links" | "seenBy" | "ownerUserId" | "filedAt" | "noise" | "noiseOverride" | "share" | "suggestions"
> & { krisp: Pick<MeetingRecord["krisp"], "title" | "startedAt" | "durationSec" | "source" | "removedAt"> };

/** #323 — the Meetings box's list, as a narrow JSONB projection (no segments/notes), visibility-filtered in JS
 *  through canSeeMeeting; newest first. */
export async function meetingRowsVisibleTo(userId: string): Promise<MeetingListRow[]> {
  const db = await getDb();
  const t = meetingsTable;
  const rows = await db
    .select({
      id: t.id,
      links: sql<unknown>`${t.doc}->'links'`,
      seenBy: sql<unknown>`${t.doc}->'seenBy'`,
      ownerUserId: sql<string | null>`${t.doc}->>'ownerUserId'`,
      filedAt: sql<unknown>`${t.doc}->'filedAt'`,
      noise: sql<unknown>`${t.doc}->'noise'`,
      noiseOverride: sql<unknown>`${t.doc}->'noiseOverride'`,
      share: sql<unknown>`${t.doc}->'share'`,
      suggestions: sql<unknown>`${t.doc}->'suggestions'`,
      title: sql<unknown>`${t.doc}->'krisp'->'title'`,
      startedAt: sql<unknown>`${t.doc}->'krisp'->'startedAt'`,
      durationSec: sql<unknown>`${t.doc}->'krisp'->'durationSec'`,
      source: sql<unknown>`${t.doc}->'krisp'->'source'`,
      removedAt: sql<unknown>`${t.doc}->'krisp'->'removedAt'`,
    })
    .from(t)
    .where(eq(t.deleted, false));
  const out: MeetingListRow[] = [];
  for (const r of rows) {
    const m = normalizeMeeting({
      id: r.id,
      links: r.links as MeetingRecord["links"],
      seenBy: r.seenBy as string[],
      ownerUserId: r.ownerUserId ?? "",
      filedAt: r.filedAt as number | null,
      noise: r.noise as boolean,
      noiseOverride: r.noiseOverride as boolean,
      share: r.share as MeetingRecord["share"],
      suggestions: r.suggestions as MeetingRecord["suggestions"],
      krisp: {
        title: r.title, startedAt: r.startedAt, durationSec: r.durationSec, source: r.source, removedAt: r.removedAt,
      } as MeetingRecord["krisp"],
    });
    if (!canSeeMeeting(m, userId)) continue;
    out.push({
      id: m.id, links: m.links, seenBy: m.seenBy, ownerUserId: m.ownerUserId, filedAt: m.filedAt, noise: m.noise,
      noiseOverride: m.noiseOverride, share: m.share, suggestions: m.suggestions,
      krisp: { title: m.krisp.title, startedAt: m.krisp.startedAt, durationSec: m.krisp.durationSec, source: m.krisp.source, removedAt: m.krisp.removedAt },
    });
  }
  return out.sort((a, b) => (b.krisp.startedAt ?? 0) - (a.krisp.startedAt ?? 0));
}

/** #323 — Home + the Inbox view row: the viewer's own unfiled, non-noise meetings, as one SQL count
 *  (seenBy ∋ the viewer implies canSeeMeeting). Mirrors `!filedAt && !noise` on a normalized doc. */
export async function countToFile(userId: string): Promise<number> {
  const db = await getDb();
  const t = meetingsTable;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(
      eq(t.deleted, false),
      sql`${t.doc}->'seenBy' @> ${JSON.stringify([userId])}::jsonb`,
      sql`(${t.doc}->'filedAt' is null or ${t.doc}->'filedAt' in ('null'::jsonb, '0'::jsonb))`,
      sql`coalesce(${t.doc}->'noise', 'false'::jsonb) in ('false'::jsonb, 'null'::jsonb)`,
    ));
  return Number(r?.n ?? 0);
}

/** #323 — a record-page / customer-feed row: the header fields plus the attendee names, never the transcript,
 *  notes, to-dos or share text. */
export type MeetingLinkedRow = {
  id: string;
  title: string;
  startedAt: number | null;
  durationSec: number | null;
  filedAt: number | null;
  noise: boolean;
  links: MeetingRecord["links"];
  attendees: { name: string; contactId: string | null; userId: string | null }[];
};

export type MeetingLinkKind = "company" | "venue" | "contact" | "work";

/** #323 — visible meetings linked to one record (or a few: a survey + its site visits), newest first, filtered
 *  in SQL on the link field and through canSeeMeeting in JS. A narrow JSONB projection — Home, record pages and
 *  the customer feed never load a transcript. */
export async function meetingRowsLinkedTo(
  kind: MeetingLinkKind, ids: string | readonly string[], viewerId: string,
): Promise<MeetingLinkedRow[]> {
  const want = [...new Set(typeof ids === "string" ? [ids] : ids)].filter(Boolean);
  if (!want.length) return [];
  const db = await getDb();
  const t = meetingsTable;
  const link =
    kind === "contact"
      ? or(...want.map((id) => sql`${t.doc}->'links'->'contactIds' @> ${JSON.stringify([id])}::jsonb`))
      : inArray(
          kind === "company" ? sql<string>`${t.doc}->'links'->>'customerId'`
          : kind === "venue" ? sql<string>`${t.doc}->'links'->>'siteId'`
          : sql<string>`${t.doc}->'links'->'work'->>'id'`,
          want,
        );
  const rows = await db
    .select({
      id: t.id,
      links: sql<unknown>`${t.doc}->'links'`,
      seenBy: sql<unknown>`${t.doc}->'seenBy'`,
      filedAt: sql<unknown>`${t.doc}->'filedAt'`,
      noise: sql<unknown>`${t.doc}->'noise'`,
      attendees: sql<unknown>`${t.doc}->'attendees'`,
      title: sql<unknown>`${t.doc}->'krisp'->'title'`,
      startedAt: sql<unknown>`${t.doc}->'krisp'->'startedAt'`,
      durationSec: sql<unknown>`${t.doc}->'krisp'->'durationSec'`,
    })
    .from(t)
    .where(and(eq(t.deleted, false), link));
  const out: MeetingLinkedRow[] = [];
  for (const r of rows) {
    const m = normalizeMeeting({
      id: r.id,
      links: r.links as MeetingRecord["links"],
      seenBy: r.seenBy as string[],
      filedAt: r.filedAt as number | null,
      noise: r.noise as boolean,
      attendees: r.attendees as MeetingRecord["attendees"],
      krisp: { title: r.title, startedAt: r.startedAt, durationSec: r.durationSec } as MeetingRecord["krisp"],
    });
    if (!canSeeMeeting(m, viewerId)) continue;
    out.push({
      id: m.id, title: m.krisp.title, startedAt: m.krisp.startedAt, durationSec: m.krisp.durationSec,
      filedAt: m.filedAt, noise: m.noise, links: m.links,
      attendees: m.attendees.filter((a) => a && !a.removed)
        .map((a) => ({ name: String(a.name || ""), contactId: a.contactId ?? null, userId: a.userId ?? null })),
    });
  }
  return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/** #323 ⌘K — meetings whose title or raw Krisp notes contain `q` (ILIKE in SQL, newest first, capped), as
 *  normalized records WITHOUT segments: enough for canSeeMeeting + renderMeeting's summary. The caller filters
 *  visibility and re-checks the rendered summary text. */
export async function searchMeetingCandidates(q: string, limit: number): Promise<MeetingRecord[]> {
  const text = q.trim();
  if (!text) return [];
  const db = await getDb();
  const t = meetingsTable;
  const pattern = "%" + text.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = await db
    .select({
      id: t.id,
      links: sql<unknown>`${t.doc}->'links'`,
      seenBy: sql<unknown>`${t.doc}->'seenBy'`,
      filedAt: sql<unknown>`${t.doc}->'filedAt'`,
      noise: sql<unknown>`${t.doc}->'noise'`,
      speakerMap: sql<unknown>`${t.doc}->'speakerMap'`,
      title: sql<unknown>`${t.doc}->'krisp'->'title'`,
      startedAt: sql<unknown>`${t.doc}->'krisp'->'startedAt'`,
      durationSec: sql<unknown>`${t.doc}->'krisp'->'durationSec'`,
      speakers: sql<unknown>`${t.doc}->'krisp'->'speakers'`,
      notes: sql<unknown>`${t.doc}->'krisp'->'notes'`,
    })
    .from(t)
    .where(and(
      eq(t.deleted, false),
      or(
        sql`${t.doc}->'krisp'->>'title' ILIKE ${pattern}`,
        sql`(${t.doc}->'krisp'->'notes')::text ILIKE ${pattern}`,
      ),
    ))
    .orderBy(sql`case when jsonb_typeof(${t.doc}->'krisp'->'startedAt') = 'number' then (${t.doc}->'krisp'->>'startedAt')::numeric end desc nulls last`)
    .limit(limit);
  return rows.map((r) => normalizeMeeting({
    id: r.id,
    links: r.links as MeetingRecord["links"],
    seenBy: r.seenBy as string[],
    filedAt: r.filedAt as number | null,
    noise: r.noise as boolean,
    speakerMap: r.speakerMap as MeetingRecord["speakerMap"],
    krisp: {
      title: r.title, startedAt: r.startedAt, durationSec: r.durationSec, speakers: r.speakers, notes: r.notes,
    } as MeetingRecord["krisp"],
  }));
}

/** #323 portal — shared meetings for one customer (K3), filtered in SQL: header + the edited share summary only. */
export async function sharedMeetingRowsFor(customerId: string): Promise<Pick<MeetingRecord, "id" | "links" | "share" | "krisp">[]> {
  if (!customerId) return [];
  const db = await getDb();
  const t = meetingsTable;
  const rows = await db
    .select({
      id: t.id,
      links: sql<unknown>`${t.doc}->'links'`,
      share: sql<unknown>`${t.doc}->'share'`,
      title: sql<unknown>`${t.doc}->'krisp'->'title'`,
      startedAt: sql<unknown>`${t.doc}->'krisp'->'startedAt'`,
    })
    .from(t)
    .where(and(
      eq(t.deleted, false),
      sql`${t.doc}->'share' is not null and ${t.doc}->'share' <> 'null'::jsonb`,
      sql`${t.doc}->'links'->>'customerId' = ${customerId}`,
    ));
  return rows.map((r) => normalizeMeeting({
    id: r.id,
    links: r.links as MeetingRecord["links"],
    share: r.share as MeetingRecord["share"],
    krisp: { title: r.title, startedAt: r.startedAt } as MeetingRecord["krisp"],
  }));
}
