/**
 * #323 — server loaders for the Inbox Meetings box and the meeting reader.
 * Every read goes through `meetingsVisibleTo` / `canSeeMeeting`: a meeting the
 * viewer can't see is absent from every list and its reader is null (never
 * its title). The client components get plain view models only — no store,
 * db or sync import crosses into the client bundle.
 *
 * Not `import "server-only"`: the package isn't installed in this repo; the
 * `next build` gate catches a client import of this module instead.
 */
import { getDoc } from "@/db/doc-store";
import type { CollectionName } from "@/db/doc-tables";
import * as MS from "@/lib/stores/meetings";
import { canSeeMeeting, meetingScope, type MeetingScope } from "@/lib/meetings/visibility";
import { renderMeeting } from "@/lib/meetings/render";
import { noteParentFor } from "@/lib/meetings/todos";
import { getSyncState } from "@/lib/meetings/sync-state";
import { getKrispConnectionInfo } from "@/lib/krisp/connections";
import { krispMeetingUrl } from "@/lib/krisp/client";
import { allContacts, displayName } from "@/lib/identity/contacts";
import { getCompany } from "@/lib/identity/companies";
import { getSite } from "@/lib/identity/sites";
import { activeUsers } from "@/lib/users";
import { can } from "@/lib/team";
import { getTask } from "@/lib/stores/tasks";
import { getNote } from "@/lib/stores/notes";
import { taskHref } from "@/lib/calendar-tasks";
import { getAll as allLeads, isOpen as leadIsOpen } from "@/lib/stores/leads";
import { allVisits } from "@/lib/stores/site-visits";
import { getAll as allSurveys } from "@/lib/stores/surveys";
import { getAllProjects } from "@/lib/stores/projects";
import { allEngagements } from "@/lib/stores/engagements";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";
import {
  NOISE_MAX_SEC,
  WORK_TYPES,
  type AttendeeSource,
  type MeetingPersonRef,
  type MeetingRecord,
  type MeetingSuggestion,
  type TodoKind,
  type WorkType,
} from "@/lib/meetings/types";

export type MeetingsTab = "to-file" | "filed" | "noise";

export const MEETINGS_TABS: MeetingsTab[] = ["to-file", "filed", "noise"];

export function meetingsTabOf(v: string | null | undefined): MeetingsTab {
  return v === "filed" || v === "noise" ? v : "to-file";
}

export type MeetingRowVM = {
  id: string;
  title: string;
  startedAt: number | null;
  /** "Thu, Oct 9 · 2:30 PM" (Chicago) — formatted on the server so it never mismatches on hydration */
  when: string;
  durationSec: number | null;
  length: string;
  source: string;
  scope: MeetingScope;
  shared: boolean;
  top: MeetingSuggestion | null;
  strongCount: number;
  removed: boolean;
};

export type MeetingsBoxVM = {
  tab: MeetingsTab;
  thisWeek: MeetingRowVM[];
  older: MeetingRowVM[];
  /** Filed / Noise tabs (one list) */
  rows: MeetingRowVM[];
  counts: { toFile: number; filed: number; noise: number };
  sync: { syncedAt: number | null; syncedAgo: string | null; lastError: string | null; backfillFrom: number | null; backfillLabel: string | null; connected: boolean };
};

export type LinkChipVM = { id: string; label: string; href: string | null; removed: boolean };

export type MeetingReaderVM = {
  id: string;
  title: string;
  when: string;
  length: string;
  source: string;
  krispUrl: string;
  removed: boolean;
  noise: boolean;
  /** "Mark as noise" only does something on a short meeting a rep marked "Not noise" */
  canMarkNoise: boolean;
  filed: boolean;
  filedLabel: string | null;
  scope: MeetingScope;
  share: { summary: string; label: string } | null;
  canShare: boolean;
  canCreate: boolean;
  shareDraft: string;
  attendees: {
    key: string; display: string; email: string | null; sources: AttendeeSource[];
    contactId: string | null; userId: string | null; href: string | null;
  }[];
  speakers: { idx: string; label: string; mapped: string | null; mappedValue: string | null }[];
  /** attendee picks for a speaker: value → the ref setSpeakerAction takes */
  speakerOptions: { value: string; label: string; ref: MeetingPersonRef }[];
  summary: { title: string; description: string }[];
  keyPoints: string[];
  todos: {
    key: string; title: string; owner: string | null; due: string | null; suggested: TodoKind;
    decision: null | { kind: TodoKind; label: string; href: string | null };
  }[];
  segments: { speakerName: string; text: string }[];
  suggestions: (MeetingSuggestion & { companyId: string | null; linked: boolean })[];
  links: {
    company: LinkChipVM | null;
    venue: LinkChipVM | null;
    people: LinkChipVM[];
    work: (LinkChipVM & { type: WorkType; typeLabel: string }) | null;
    internal: LinkChipVM[];
    contactIds: string[];
    internalUserIds: string[];
  };
  workOptions: Record<WorkType, { id: string; label: string }[]>;
  team: { id: string; name: string }[];
  /** "+ New contact" defaults to the linked company, else the top company suggestion */
  defaultCompany: { id: string; name: string } | null;
};

/* ---------- formatting (Chicago, server-side) ---------- */

const TZ = "America/Chicago";
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const WHEN_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const WEEK_MS = 7 * 86_400_000;

function whenLabel(ms: number | null, now: number): string {
  if (ms == null) return "—";
  return (Math.abs(now - ms) < 300 * 86_400_000 ? WHEN : WHEN_YEAR).format(ms);
}

export function lengthLabel(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.max(0, Math.round(sec))} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export function agoLabel(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function sourceLabel(s: string | null): string {
  if (!s) return "Krisp";
  const t = s.replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Krisp";
}

/* ---------- the box ---------- */

function rowOf(m: MeetingRecord, now: number): MeetingRowVM {
  return {
    id: m.id,
    title: m.krisp.title || "Untitled meeting",
    startedAt: m.krisp.startedAt,
    when: whenLabel(m.krisp.startedAt, now),
    durationSec: m.krisp.durationSec,
    length: lengthLabel(m.krisp.durationSec),
    source: sourceLabel(m.krisp.source),
    scope: meetingScope(m),
    shared: !!m.share,
    top: m.suggestions[0] ?? null,
    strongCount: m.suggestions.filter((s) => s.strength === "strong").length,
    removed: m.krisp.removedAt != null,
  };
}

const isToFile = (m: MeetingRecord) => !m.filedAt && !m.noise;
const isNoise = (m: MeetingRecord) => m.noise && !m.filedAt;

/** Home + the Inbox view row: the viewer's own unfiled, non-noise meetings. */
export async function toFileCount(userId: string): Promise<number> {
  return (await MS.meetingsVisibleTo(userId)).filter((m) => isToFile(m) && m.seenBy.includes(userId)).length;
}

export async function loadMeetingsBox(me: { id: string }, tab: MeetingsTab): Promise<MeetingsBoxVM> {
  const now = Date.now();
  const [all, sync, conn] = await Promise.all([
    MS.meetingsVisibleTo(me.id),
    getSyncState(me.id).catch(() => null),
    getKrispConnectionInfo(me.id).catch(() => null),
  ]);
  const toFile = all.filter(isToFile);
  const filed = all.filter((m) => !!m.filedAt);
  const noise = all.filter(isNoise);
  const weekAgo = now - WEEK_MS;
  return {
    tab,
    thisWeek: tab === "to-file" ? toFile.filter((m) => (m.krisp.startedAt ?? 0) >= weekAgo).map((m) => rowOf(m, now)) : [],
    older: tab === "to-file" ? toFile.filter((m) => (m.krisp.startedAt ?? 0) < weekAgo).map((m) => rowOf(m, now)) : [],
    rows: tab === "filed" ? filed.slice(0, 200).map((m) => rowOf(m, now)) : tab === "noise" ? noise.map((m) => rowOf(m, now)) : [],
    counts: { toFile: toFile.length, filed: filed.length, noise: noise.length },
    sync: {
      syncedAt: sync?.syncedAt ?? null,
      syncedAgo: sync?.syncedAt ? agoLabel(sync.syncedAt, now) : null,
      lastError: sync?.lastError ?? null,
      backfillFrom: sync?.backfillFrom ?? null,
      backfillLabel: sync?.backfillFrom ? DAY.format(sync.backfillFrom) : null,
      connected: !!conn,
    },
  };
}

/* ---------- the reader ---------- */

const WORK_COLLECTION: Record<WorkType, CollectionName> = {
  lead: "leads", site_visit: "site_visits", survey: "surveys", project: "projects",
  engagement: "consulting_engagements", quote: "quotes",
};

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  lead: "Lead", site_visit: "Site visit", survey: "Survey", project: "Project", engagement: "Engagement", quote: "Quote",
};

function workHref(type: WorkType, id: string): string {
  const e = encodeURIComponent(id);
  switch (type) {
    case "lead": return `/leads?lead=${e}`;
    case "quote": return `/quotes?id=${e}`;
    case "survey": return `/venue-assessments/${e}`;
    case "project": return `/projects/${e}`;
    case "engagement": return `/design/engagements/${e}`;
    case "site_visit": return `/venue-assessments`;
  }
}

function noteHref(kind: string, id: string): string | null {
  const e = encodeURIComponent(id);
  switch (kind) {
    case "customer": return `/companies/${e}`;
    case "site": return `/venues/${e}`;
    case "lead": return `/leads?lead=${e}`;
    case "project": return `/projects/${e}`;
    case "engagement": return `/design/engagements/${e}`;
    case "quote": return `/quotes?id=${e}`;
    default: return null;
  }
}

const REMOVED = "(removed)";
const CAP = 200;

async function workOptionsFor(companyId: string | null): Promise<MeetingReaderVM["workOptions"]> {
  const out = Object.fromEntries(WORK_TYPES.map((t) => [t, [] as { id: string; label: string }[]])) as MeetingReaderVM["workOptions"];
  if (!companyId) return out;
  const [leads, visits, surveys, projects, engagements, quotes] = await Promise.all([
    allLeads(), allVisits(), allSurveys(), getAllProjects(), allEngagements(), allQuotes(),
  ]);
  out.lead = leads.filter((l) => l.customerId === companyId && leadIsOpen(l))
    .map((l) => ({ id: l.id, label: `${displayLeadNumber(l)} · ${l.org || l.contact || "Lead"}` })).slice(0, CAP);
  out.site_visit = visits.filter((v) => v.customerId === companyId)
    .sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))
    .map((v) => ({ id: v.id, label: `${v.id} · ${v.venue || v.reason || "Site visit"}${v.startAt ? ` · ${DAY.format(v.startAt)}` : ""}` })).slice(0, CAP);
  out.survey = surveys.filter((s) => s.customerId === companyId)
    .map((s) => ({ id: s.id, label: `${s.id} · ${s.venue || s.venueType || "Survey"}` })).slice(0, CAP);
  out.project = projects.filter((p) => p.customerId === companyId)
    .map((p) => ({ id: p.id, label: `${p.id} · ${p.name || "Project"}` })).slice(0, CAP);
  out.engagement = engagements.filter((e) => e.companyId === companyId)
    .map((e) => ({ id: e.id, label: e.name || e.id })).slice(0, CAP);
  out.quote = quotes.filter((q) => q.customerId === companyId)
    .map((q) => ({ id: q.id, label: `${displayQuoteNumber(q)} · ${q.name || "Quote"}` })).slice(0, CAP);
  return out;
}

async function decisionOf(m: MeetingRecord, d: NonNullable<MeetingRecord["todos"][number]["decision"]>): Promise<{ kind: TodoKind; label: string; href: string | null }> {
  if (d.kind === "dismiss") return { kind: d.kind, label: "Dismissed", href: null };
  if (!d.createdId) return { kind: d.kind, label: REMOVED, href: null };
  if (d.kind === "note") {
    const n = await getNote(d.createdId).catch(() => null);
    if (!n) return { kind: d.kind, label: `Note ${REMOVED}`, href: null };
    const parent = noteParentFor(m.links);
    return { kind: d.kind, label: "Note filed", href: noteHref(n.parentKind, n.parentId) ?? (parent ? noteHref(parent.parentKind, parent.parentId) : null) };
  }
  const t = await getTask(d.createdId).catch(() => null);
  if (!t) return { kind: d.kind, label: `Task ${REMOVED}`, href: null };
  const label = d.kind === "waiting"
    ? `Waiting on ${t.waitingOn?.name || "customer"}`
    : `Task for ${t.assigneeName || "no one yet"}`;
  return { kind: d.kind, label, href: taskHref(t) || "/calendar" };
}

/** null when the meeting is gone or the viewer can't see it — the reader shows its empty state, never the title. */
export async function loadMeetingReader(
  me: { id: string; roles: string[] }, id: string,
): Promise<MeetingReaderVM | null> {
  if (!id) return null;
  const m = await MS.getMeeting(id).catch(() => null);
  if (!m || !canSeeMeeting(m, me.id)) return null;
  const now = Date.now();
  const [contacts, users] = await Promise.all([allContacts(), activeUsers()]);
  const contactName = new Map(contacts.map((c) => [c.id, displayName(c)]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const r = renderMeeting(m, { contact: (cid) => contactName.get(cid) ?? null, user: (uid) => userName.get(uid) ?? null });

  const L = m.links;
  const [company, site, workDoc] = await Promise.all([
    L.customerId ? getCompany(L.customerId).catch(() => null) : Promise.resolve(null),
    L.siteId ? getSite(L.siteId).catch(() => null) : Promise.resolve(null),
    L.work ? getDoc(WORK_COLLECTION[L.work.type], L.work.id).catch(() => null) : Promise.resolve(null),
  ]);

  // a venue suggestion carries its company: the core refuses a venue without it
  const venueCompany = new Map<string, string | null>();
  await Promise.all(m.suggestions.filter((s) => s.kind === "venue").map(async (s) => {
    venueCompany.set(s.id, (await getSite(s.id).catch(() => null))?.companyId ?? null);
  }));
  const isLinked = (s: MeetingSuggestion): boolean =>
    s.kind === "company" ? L.customerId === s.id
    : s.kind === "venue" ? L.siteId === s.id
    : s.kind === "contact" ? L.contactIds.includes(s.id)
    : s.kind === "work" ? L.work?.id === s.id
    : L.internalUserIds.includes(s.id);

  const topCompany = m.suggestions.find((s) => s.kind === "company") ?? null;
  const defaultCompany = L.customerId && company
    ? { id: L.customerId, name: company.name }
    : topCompany ? { id: topCompany.id, name: topCompany.label } : null;

  // speaker picks: each live attendee, as the person it resolves to
  const speakerOptions: MeetingReaderVM["speakerOptions"] = r.attendees.map((a) => ({
    value: `a:${a.key}`,
    label: a.display + (a.email && a.display !== a.email ? ` · ${a.email}` : ""),
    ref: { name: a.display, ...(a.contactId ? { contactId: a.contactId } : {}), ...(a.userId ? { userId: a.userId } : {}) },
  }));
  const optionFor = (ref: MeetingPersonRef | undefined): string | null => {
    if (!ref) return null;
    const hit = speakerOptions.find((o) =>
      (ref.contactId && o.ref.contactId === ref.contactId) || (ref.userId && o.ref.userId === ref.userId) ||
      (!ref.contactId && !ref.userId && !o.ref.contactId && !o.ref.userId && o.ref.name === ref.name));
    return hit ? hit.value : "custom";
  };

  const summaryText = [
    ...r.summary.map((s) => [s.title, s.description].filter(Boolean).join("\n")),
    r.keyPoints.length ? ["Key points:", ...r.keyPoints.map((k) => `• ${k}`)].join("\n") : "",
  ].filter(Boolean).join("\n\n");

  const short = m.krisp.durationSec != null && m.krisp.durationSec < NOISE_MAX_SEC;

  return {
    id: m.id,
    title: m.krisp.title || "Untitled meeting",
    when: whenLabel(m.krisp.startedAt, now),
    length: lengthLabel(m.krisp.durationSec),
    source: sourceLabel(m.krisp.source),
    krispUrl: krispMeetingUrl(m.krispMeetingId),
    removed: m.krisp.removedAt != null,
    noise: m.noise,
    canMarkNoise: !m.noise && short && m.noiseOverride,
    filed: !!m.filedAt,
    filedLabel: m.filedAt ? `Filed${m.filedBy ? ` by ${m.filedBy}` : ""} · ${DAY.format(m.filedAt)}` : null,
    scope: meetingScope(m),
    share: m.share ? { summary: m.share.summary, label: `Shared by ${m.share.sharedBy} · ${DAY.format(m.share.sharedAt)}` } : null,
    canShare: can("create", me.roles) && !!L.customerId,
    canCreate: can("create", me.roles),
    shareDraft: m.share?.summary || summaryText,
    attendees: r.attendees.map((a) => ({
      key: a.key, display: a.display, email: a.email, sources: a.sources, contactId: a.contactId, userId: a.userId,
      href: a.contactId ? `/people/${encodeURIComponent(a.contactId)}` : null,
    })),
    speakers: r.speakers.map((s) => ({ ...s, mappedValue: optionFor(m.speakerMap[s.idx]) })),
    speakerOptions,
    summary: r.summary,
    keyPoints: r.keyPoints,
    todos: await Promise.all(r.todos.map(async (t) => ({
      key: t.key, title: t.title, owner: t.assigneeDisplay, due: t.dueDate, suggested: t.suggested,
      decision: t.decision ? await decisionOf(m, t.decision) : null,
    }))),
    segments: r.segments.map((s) => ({ speakerName: s.speakerName, text: s.text })),
    suggestions: m.suggestions.map((s) => ({
      ...s,
      companyId: s.kind === "venue" ? venueCompany.get(s.id) ?? null : s.kind === "company" ? s.id : null,
      linked: isLinked(s),
    })),
    links: {
      company: L.customerId ? {
        id: L.customerId, label: company?.name ?? REMOVED, removed: !company,
        href: company ? `/companies/${encodeURIComponent(L.customerId)}` : null,
      } : null,
      venue: L.siteId ? {
        id: L.siteId, label: site?.name ?? REMOVED, removed: !site,
        href: site ? `/venues/${encodeURIComponent(L.siteId)}` : null,
      } : null,
      people: L.contactIds.map((cid) => {
        const nm = contactName.get(cid);
        return { id: cid, label: nm ?? REMOVED, removed: !nm, href: nm ? `/people/${encodeURIComponent(cid)}` : null };
      }),
      work: L.work ? {
        id: L.work.id, type: L.work.type, typeLabel: WORK_TYPE_LABEL[L.work.type],
        label: workDoc ? L.work.label || L.work.id : REMOVED, removed: !workDoc,
        href: workDoc ? workHref(L.work.type, L.work.id) : null,
      } : null,
      internal: L.internalUserIds.map((uid) => {
        const nm = userName.get(uid);
        return { id: uid, label: nm ?? REMOVED, removed: !nm, href: null };
      }),
      contactIds: L.contactIds,
      internalUserIds: L.internalUserIds,
    },
    workOptions: await workOptionsFor(company ? L.customerId : null),
    team: users.map((u) => ({ id: u.id, name: u.name })),
    defaultCompany,
  };
}
