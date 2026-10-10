/**
 * #323 — every meeting mutation (spec "## Visibility", "## To-dos (K6)",
 * "## Permissions", "## UI → Sidebar"). Server-only (DB): the "use server"
 * wrappers live in src/app/(app)/inbox/meetings/actions.ts; the spec harness
 * calls these directly.
 *
 * Concurrency: the sync writes meetings while a rep edits them, so every
 * write goes through `MS.patchMeeting` with a pure callback over the LATEST
 * doc — never a get-then-save. Anything slow or record-creating (the match
 * index, id checks, users, createTaskOnce, addNoteRecord) happens before the
 * patch, and the access check runs again inside it on the doc being written.
 *
 * Errors: `MeetingUserError` (and its subclasses) carry a message meant for
 * the rep; anything else is a bug and the action layer hides its message.
 */
import { getDoc } from "@/db/doc-store";
import type { CollectionName } from "@/db/doc-tables";
import { matchAssignee, shortHash } from "@/lib/krisp/derive";
import { activeUsers } from "@/lib/users";
import { docLocId, getSite } from "@/lib/identity/sites";
import { getCompany } from "@/lib/identity/companies";
import { getContact, saveContact, setEmails } from "@/lib/identity/contacts";
import { mintId } from "@/lib/identity/ids";
import { contactsByEmails } from "@/lib/identity/lookup";
import { createTaskOnce } from "@/lib/stores/tasks";
import { addNoteRecord } from "@/lib/stores/notes";
import * as MS from "@/lib/stores/meetings";
import { chicagoAt } from "./chicago-day";
import { buildMatchIndex } from "./index-build";
import { normalizeText } from "./names";
import { attendeeKey, relabel, speakerIndexes, speakerLabel } from "./render";
import { refreshMeetingDetail, rematchMeeting } from "./sync";
import { noteParentFor } from "./todos";
import {
  MAX_CONTACT_LINKS,
  NOISE_MAX_SEC,
  WORK_TYPES,
  type MeetingLinks,
  type MeetingPersonRef,
  type MeetingRecord,
  type MeetingSuggestion,
  type MeetingTodo,
  type SuggestionKind,
  type TodoKind,
  type WorkType,
} from "./types";
import { canSeeMeeting, hasExternalLink } from "./visibility";

export type Me = { id: string; name: string };

/** A refusal whose message is meant for the rep. */
export class MeetingUserError extends Error {}
export class MeetingAccessError extends MeetingUserError {}
export class MeetingShareGuardError extends MeetingUserError {}
/** decideAllTodos: some to-dos were filed, these weren't. */
export class MeetingPartialError extends MeetingUserError {}
/** Refresh from Krisp: a sync for that Krisp account is already running. */
export class MeetingBusyError extends MeetingUserError {}

export const SHARE_SUMMARY_MAX = 8000;
const WAITING_DEFAULT_MS = 7 * 86_400_000;
const DUE_HOUR = 17; // a Krisp due date is a day; the task is due 17:00 Chicago that day
const ID_MAX = 120;

const WORK_COLLECTION: Record<WorkType, CollectionName> = {
  lead: "leads", site_visit: "site_visits", survey: "surveys", project: "projects",
  engagement: "consulting_engagements", quote: "quotes",
};

/* ---------- plumbing ---------- */

async function load(id: string, me: Me): Promise<MeetingRecord> {
  const m = await MS.getMeeting(id);
  if (!m || !canSeeMeeting(m, me.id)) throw new MeetingAccessError("Meeting not found");
  return m;
}

/** Read-modify-write over the latest doc; the viewer must be able to see the doc being written. */
async function mutate(id: string, me: Me, fn: (cur: MeetingRecord) => MeetingRecord): Promise<MeetingRecord> {
  const out = await MS.patchMeeting(id, (cur) => {
    if (!canSeeMeeting(cur, me.id)) throw new MeetingAccessError("Meeting not found");
    return fn(cur);
  });
  if (!out) throw new MeetingAccessError("Meeting not found");
  return out;
}

function cleanId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= ID_MAX ? s : null;
}

function cleanIds(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.map(cleanId).filter((x): x is string => !!x))] : [];
}

function filed(m: MeetingRecord, me: Me, now: number): MeetingRecord {
  return { ...m, filedAt: m.filedAt ?? now, filedBy: m.filedBy ?? me.name };
}

/** "Speaker N" → the mapped name, as the reader renders it. */
function speakerPairs(m: MeetingRecord): [string, string][] {
  return Object.entries(m.speakerMap).filter(([, ref]) => ref?.name).map(([idx, ref]) => [speakerLabel(m, idx), ref.name]);
}

/* ---------- id checks (client ids are never trusted) ---------- */

async function activeUserIds(): Promise<Set<string>> {
  return new Set((await activeUsers()).map((u) => u.id));
}

async function checkContact(id: string): Promise<void> {
  if (!(await getContact(id))) throw new MeetingUserError("That person isn't in Contacts any more");
}

async function checkUser(id: string, active?: Set<string>): Promise<void> {
  if (!(active ?? (await activeUserIds())).has(id)) throw new MeetingUserError("That person isn't on the team");
}

/** Validates what changed between `prev` and `next` (a link to a since-deleted record that stays put is left alone). */
async function checkLinks(next: MeetingLinks, prev: MeetingLinks): Promise<void> {
  if (next.customerId && next.customerId !== prev.customerId && !(await getCompany(next.customerId))) {
    throw new MeetingUserError("That company no longer exists");
  }
  if (next.siteId && (next.siteId !== prev.siteId || next.customerId !== prev.customerId)) {
    const site = await getSite(next.siteId);
    if (!site) throw new MeetingUserError("That venue no longer exists");
    if (!next.customerId) throw new MeetingUserError("Link the venue's company first");
    if (site.companyId !== next.customerId) throw new MeetingUserError("That venue belongs to a different company");
  }
  const newContacts = next.contactIds.filter((c) => !prev.contactIds.includes(c));
  await Promise.all(newContacts.map(checkContact));
  const newUsers = next.internalUserIds.filter((u) => !prev.internalUserIds.includes(u));
  if (newUsers.length) {
    const active = await activeUserIds();
    for (const u of newUsers) await checkUser(u, active);
  }
  const w = next.work;
  if (w && (w.id !== prev.work?.id || w.type !== prev.work?.type) && !(await getDoc(WORK_COLLECTION[w.type], w.id))) {
    throw new MeetingUserError("That record no longer exists");
  }
}

async function checkPersonRef(ref: { contactId?: string | null; userId?: string | null }): Promise<void> {
  if (ref.contactId) await checkContact(ref.contactId);
  if (ref.userId) await checkUser(ref.userId);
}

/** The share guard (spec §Visibility): a shared meeting that loses its last external link, or is re-pointed at
 *  another company (the portal keys on customerId), stops being shared — only with `confirmUnshare`. */
function guardShare(cur: MeetingRecord, links: MeetingLinks, confirmUnshare: boolean | undefined): MeetingRecord["share"] {
  if (!cur.share || (hasExternalLink(links) && links.customerId === cur.links.customerId)) return cur.share;
  if (!confirmUnshare) throw new MeetingShareGuardError("This meeting is shared with the customer — this change stops sharing it");
  return null;
}

/* ---------- linking ---------- */

function applySuggestions(links: MeetingLinks, picks: MeetingSuggestion[]): MeetingLinks {
  const next: MeetingLinks = { ...links, contactIds: [...links.contactIds], internalUserIds: [...links.internalUserIds] };
  // company first: a different company drops the old company's venue and work, then this pick set's own apply
  for (const s of picks) {
    if (s.kind !== "company" || s.id === next.customerId) continue;
    if (next.customerId) { next.siteId = null; next.work = null; }
    next.customerId = s.id;
  }
  for (const s of picks) {
    if (s.kind === "venue") next.siteId = s.id;
    else if (s.kind === "contact" && !next.contactIds.includes(s.id) && next.contactIds.length < MAX_CONTACT_LINKS) next.contactIds.push(s.id);
    else if (s.kind === "work" && s.workType) next.work = { type: s.workType, id: s.id, label: s.label };
    else if (s.kind === "internal" && !next.internalUserIds.includes(s.id)) next.internalUserIds.push(s.id);
  }
  return next;
}

function chooseSuggestions(m: MeetingRecord, picks: { kind: SuggestionKind; id: string }[] | "strong"): MeetingSuggestion[] {
  return picks === "strong"
    ? m.suggestions.filter((s) => s.strength === "strong")
    : picks.map((p) => m.suggestions.find((s) => s.kind === p.kind && s.id === p.id)).filter((s): s is MeetingSuggestion => !!s);
}

/** Apply the picked suggestions (or every strong one) and file the meeting. Picks no longer suggested are ignored;
 *  a suggestion whose record has since gone is refused. Same share guard as setLinks. */
export async function confirmSuggestions(
  id: string, picks: { kind: SuggestionKind; id: string }[] | "strong", me: Me, opts: { confirmUnshare?: boolean } = {},
): Promise<MeetingRecord> {
  const snap = await load(id, me);
  const chosen = chooseSuggestions(snap, picks);
  if (chosen.length) await checkLinks(applySuggestions(snap.links, chosen), snap.links);
  const now = Date.now();
  return mutate(id, me, (cur) => {
    const sel = chooseSuggestions(cur, picks);
    if (!sel.length) return cur;
    const links = applySuggestions(cur.links, sel);
    return filed({ ...cur, links, share: guardShare(cur, links, opts.confirmUnshare) }, me, now);
  });
}

/** Most ids one Confirm all reads (the To file list it comes from is far shorter). */
export const CONFIRM_ALL_MAX = 200;

/** Confirm all: every unfiled, non-noise meeting whose TOP suggestion is strong gets its strong suggestions.
 *  A row that can't be confirmed (a record gone, a share to protect, a meeting the rep can no longer see or that
 *  is gone) is skipped, never the whole batch. Ids are loaded one by one, at most CONFIRM_ALL_MAX of them. */
export async function confirmAllStrong(ids: string[] | "all-visible", me: Me): Promise<{ filed: number }> {
  let list: MeetingRecord[];
  if (ids === "all-visible") list = await MS.meetingsVisibleTo(me.id);
  else {
    list = [];
    for (const id of cleanIds(ids).slice(0, CONFIRM_ALL_MAX)) {
      try {
        list.push(await load(id, me));
      } catch (e) {
        if (!(e instanceof MeetingAccessError)) throw e;
      }
    }
  }
  let n = 0;
  for (const m of list) {
    if (m.filedAt || m.noise || m.suggestions[0]?.strength !== "strong") continue;
    try {
      const after = await confirmSuggestions(m.id, "strong", me);
      if (after.filedAt) n++;
    } catch (e) {
      if (!(e instanceof MeetingUserError)) throw e;
    }
  }
  return { filed: n };
}

/** `patch` over `links`: a different company drops the old company's venue and work unless the patch sets them. */
function mergeLinks(links: MeetingLinks, patch: Partial<MeetingLinks>): MeetingLinks {
  const next: MeetingLinks = { ...links, ...patch };
  if ("customerId" in patch && links.customerId && patch.customerId !== links.customerId) {
    if (!("siteId" in patch)) next.siteId = null;
    if (!("work" in patch)) next.work = null;
  }
  return next;
}

/** Manual linking. Refuses > 25 contacts and ids that don't resolve; the share guard as above. */
export async function setLinks(
  id: string, patch: Partial<MeetingLinks>, me: Me, opts: { confirmUnshare?: boolean } = {},
): Promise<MeetingRecord> {
  const clean: Partial<MeetingLinks> = {};
  if ("customerId" in patch) clean.customerId = cleanId(patch.customerId);
  if ("siteId" in patch) clean.siteId = cleanId(patch.siteId);
  if ("contactIds" in patch) {
    clean.contactIds = cleanIds(patch.contactIds);
    if (clean.contactIds.length > MAX_CONTACT_LINKS) throw new MeetingUserError(`A meeting can link at most ${MAX_CONTACT_LINKS} people`);
  }
  if ("internalUserIds" in patch) clean.internalUserIds = cleanIds(patch.internalUserIds);
  if ("work" in patch) {
    const w = patch.work;
    if (w == null) clean.work = null;
    else {
      const wid = cleanId(w.id);
      if (!wid || !WORK_TYPES.includes(w.type)) throw new MeetingUserError("Pick a lead, visit, survey, project, engagement or quote");
      clean.work = { type: w.type, id: wid, label: String(w.label || wid).slice(0, 200) };
    }
  }
  const snap = await load(id, me);
  await checkLinks(mergeLinks(snap.links, clean), snap.links);
  const now = Date.now();
  return mutate(id, me, (cur) => {
    const links = mergeLinks(cur.links, clean);
    const next = { ...cur, links, share: guardShare(cur, links, opts.confirmUnshare) };
    const anyLink = hasExternalLink(links) || links.internalUserIds.length > 0;
    return anyLink ? filed(next, me, now) : next;
  });
}

/* ---------- speakers + attendees ---------- */

export async function setSpeaker(id: string, idx: string, ref: MeetingPersonRef | null, me: Me): Promise<MeetingRecord> {
  const key = String(idx);
  const clean: MeetingPersonRef | null = ref ? {
    name: String(ref.name || "").trim().slice(0, 200),
    ...(cleanId(ref.contactId) ? { contactId: cleanId(ref.contactId)! } : {}),
    ...(cleanId(ref.userId) ? { userId: cleanId(ref.userId)! } : {}),
  } : null;
  if (clean && !clean.name) throw new MeetingUserError("Pick who this speaker is");
  await load(id, me);
  if (clean) await checkPersonRef(clean);
  return mutate(id, me, (cur) => {
    if (!speakerIndexes(cur).includes(key)) throw new MeetingUserError("No such speaker in this meeting");
    const speakerMap = { ...cur.speakerMap };
    if (clean) speakerMap[key] = clean;
    else delete speakerMap[key];
    return { ...cur, speakerMap };
  });
}

/** A manual attendee; re-adding a removed one restores it. */
export async function addAttendee(
  id: string, a: { name: string; email: string | null; contactId?: string; userId?: string }, me: Me,
): Promise<MeetingRecord> {
  const name = String(a.name || "").trim().slice(0, 200);
  const email = String(a.email || "").trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new MeetingUserError("That email doesn't look right");
  const key = attendeeKey(name || email || "", email);
  if (key === "name:") throw new MeetingUserError("An attendee needs a name or an email");
  const contactId = cleanId(a.contactId), userId = cleanId(a.userId);
  await load(id, me);
  await checkPersonRef({ contactId, userId });
  return mutate(id, me, (cur) => {
    const hit = cur.attendees.find((x) => x.key === key);
    if (hit) {
      return { ...cur, attendees: cur.attendees.map((x) => x !== hit ? x : {
        ...x, removed: false, contactId: contactId ?? x.contactId, userId: userId ?? x.userId,
        sources: x.sources.includes("manual") ? x.sources : [...x.sources, "manual"],
      }) };
    }
    return { ...cur, attendees: [...cur.attendees, { key, name: name || email || "", email, sources: ["manual"], removed: false, contactId, userId }] };
  });
}

/** Flags the attendee removed (never deletes — a later sync merge would only re-add it). */
export async function removeAttendee(id: string, key: string, me: Me): Promise<MeetingRecord> {
  await load(id, me);
  return mutate(id, me, (cur) => {
    if (!cur.attendees.some((x) => x.key === key)) throw new MeetingUserError("Attendee not found");
    return { ...cur, attendees: cur.attendees.map((x) => (x.key === key ? { ...x, removed: true } : x)) };
  });
}

/** Points an attendee at a contact (the "+ New contact" flow). */
export async function setAttendeeContact(id: string, key: string, contactId: string, me: Me): Promise<MeetingRecord> {
  const cid = cleanId(contactId);
  if (!cid) throw new MeetingUserError("Pick a contact");
  await load(id, me);
  await checkContact(cid);
  return mutate(id, me, (cur) => {
    if (!cur.attendees.some((x) => x.key === key)) throw new MeetingUserError("Attendee not found");
    return { ...cur, attendees: cur.attendees.map((x) => (x.key === key ? { ...x, contactId: cid } : x)) };
  });
}

/** "+ New contact" at a company for an unresolved attendee. An address that already belongs to a contact links
 *  that contact instead of making a duplicate. The caller checks the `create` permission. */
export async function newContactFromAttendee(id: string, key: string, companyId: string, me: Me): Promise<MeetingRecord> {
  const m = await load(id, me);
  const att = m.attendees.find((x) => x.key === key);
  if (!att) throw new MeetingUserError("Attendee not found");
  if (att.contactId) throw new MeetingUserError("That attendee is already a contact");
  const company = await getCompany(cleanId(companyId));
  if (!company) throw new MeetingUserError("Pick the company this person works for");
  const known = att.email ? (await contactsByEmails([att.email])).get(att.email) : undefined;
  let cid = known && "contactId" in known ? known.contactId : null;
  if (!cid) {
    const nm = att.name && att.name.toLowerCase() !== att.email ? att.name.trim() : "";
    const sp = nm.lastIndexOf(" ");
    cid = mintId("ct");
    await saveContact({
      id: cid,
      firstName: sp > 0 ? nm.slice(0, sp) : nm || (att.email || "").split("@")[0],
      lastName: sp > 0 ? nm.slice(sp + 1) : "",
      homeCompanyId: company.id,
      title: "", pricingTier: null, status: "active", userId: null, ownerUserId: me.id, isPrimary: false,
      createdAt: Date.now(),
    });
    if (att.email) await setEmails(cid, [{ value: att.email, label: "work", isPrimary: true }]);
  }
  return setAttendeeContact(id, key, cid, me);
}

/* ---------- to-dos ---------- */

/** One decide at a time per (meeting, to-do) in this process: a double click waits, re-reads, and finds the decision.
 *  Across processes the deterministic record ids below make a second create a no-op. */
const todoChains = new Map<string, Promise<unknown>>();

async function withTodoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = todoChains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  todoChains.set(key, run);
  try {
    return await run;
  } finally {
    if (todoChains.get(key) === run) todoChains.delete(key);
  }
}

/** The record a (meeting, to-do) decision creates always has the same id. */
export function todoRecordId(kind: "task" | "note", meetingId: string, key: string): string {
  return `${kind === "task" ? "T" : "N"}-mtg-${shortHash(`${meetingId}|${key}`)}`;
}

function dueFrom(todo: MeetingTodo): number | null {
  if (!todo.dueDate) return null;
  const at = chicagoAt(todo.dueDate, DUE_HOUR);
  if (at != null) return at;
  const parsed = Date.parse(todo.dueDate);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The contact a "waiting" label names: a speaker-map or attendee contact whose name matches (exact, else a unique first name). */
function waitingContactId(m: MeetingRecord, label: string): string | null {
  const want = normalizeText(label);
  if (!want) return null;
  const people = [
    ...Object.values(m.speakerMap).filter((r) => r.contactId).map((r) => ({ id: r.contactId!, name: r.name })),
    ...m.attendees.filter((a) => !a.removed && a.contactId).map((a) => ({ id: a.contactId!, name: a.name })),
  ];
  const exact = people.find((p) => normalizeText(p.name) === want);
  if (exact) return exact.id;
  const first = want.split(" ")[0];
  const byFirst = [...new Set(people.filter((p) => normalizeText(p.name).split(" ")[0] === first).map((p) => p.id))];
  return byFirst.length === 1 ? byFirst[0] : null;
}

/** Krisp's fallback for a voice it couldn't name ("Speaker 3", "Speaker_3"). */
const UNNAMED_SPEAKER = /^Speaker[ _]\d+$/i;

/** Who a "waiting" to-do waits on: the (relabelled) assignee — unless it is an unmapped Speaker N, which names
 *  nobody; then the linked company, else "Customer". */
async function waitingName(m: MeetingRecord, label: string): Promise<string> {
  if (label && !UNNAMED_SPEAKER.test(label)) return label;
  const co = m.links.customerId ? await getCompany(m.links.customerId).catch(() => null) : null;
  return co?.name?.trim() || "Customer";
}

/** The default assignee: a speaker mapped to a Peak user is that user; else the (relabelled) name, matched. */
function defaultAssignee<U extends { id: string; name: string }>(m: MeetingRecord, todo: MeetingTodo, label: string, users: U[]): U | null {
  const raw = (todo.assigneeLabel || "").trim();
  if (raw) {
    for (const [idx, ref] of Object.entries(m.speakerMap)) {
      if (!ref.userId) continue;
      if (normalizeText(speakerLabel(m, idx)) === normalizeText(raw) || normalizeText(ref.name) === normalizeText(label)) {
        const u = users.find((x) => x.id === ref.userId);
        if (u) return u;
      }
    }
  }
  return matchAssignee(label, users);
}

/** Decide one Krisp to-do. Needs a filed meeting; idempotent on `decision.createdId` (a dismissal can be re-decided). */
export async function decideTodo(
  id: string, key: string, kind: TodoKind, opts: { assigneeUserId?: string; dueAt?: number | null }, me: Me,
): Promise<MeetingRecord> {
  if (!["task", "waiting", "note", "dismiss"].includes(kind)) throw new MeetingUserError("Unknown to-do kind");
  if (opts.dueAt !== undefined && opts.dueAt !== null && !(typeof opts.dueAt === "number" && Number.isFinite(opts.dueAt))) {
    throw new MeetingUserError("That due date isn't a date");
  }
  return withTodoLock(`${id}|${key}`, async () => {
    const m = await load(id, me);
    const todo = m.todos.find((t) => t.key === key);
    if (!todo) throw new MeetingUserError("To-do not found");
    if (todo.decision?.createdId) return m;
    if (!m.filedAt) throw new MeetingUserError("File the meeting before its to-dos");

    const pairs = speakerPairs(m);
    const title = relabel(todo.title, pairs).trim() || "Meeting follow-up";
    const label = todo.assigneeLabel ? relabel(todo.assigneeLabel, pairs).trim() : "";
    const due = opts.dueAt !== undefined ? opts.dueAt : dueFrom(todo);
    const work = m.links.work;
    const site = m.links.siteId ? await getSite(m.links.siteId) : null;
    const base = {
      section: "Meeting",
      customerId: m.links.customerId,
      // a task's siteId is the venue's directory (CustomerLocation) id, as a thread-made task stores it
      siteId: site ? docLocId(site) : m.links.siteId,
      contactIds: m.links.contactIds,
      leadId: work?.type === "lead" ? work.id : null,
      projectId: work?.type === "project" ? work.id : null,
      engagementId: work?.type === "engagement" ? work.id : null,
      quoteId: work?.type === "quote" ? work.id : null,
      meetingId: m.id,
    };

    let createdId: string | null = null;
    if (kind === "task") {
      const users = await activeUsers();
      let assignee: { id: string; name: string } | null = null;
      if (opts.assigneeUserId) {
        assignee = users.find((u) => u.id === opts.assigneeUserId) ?? null;
        if (!assignee) throw new MeetingUserError("Pick someone on the team");
      } else {
        assignee = defaultAssignee(m, todo, label, users);
      }
      const t = await createTaskOnce({
        id: todoRecordId("task", m.id, key),
        title, ...base, assigneeUserId: assignee?.id ?? null, assigneeName: assignee?.name ?? "",
        dueAt: due ?? null, notes: `From meeting: ${m.krisp.title}`,
      }, me);
      createdId = t.id;
    } else if (kind === "waiting") {
      const t = await createTaskOnce({
        id: todoRecordId("task", m.id, key),
        title, ...base, assigneeUserId: me.id, assigneeName: me.name, dueAt: due ?? Date.now() + WAITING_DEFAULT_MS,
        waitingOn: { contactId: waitingContactId(m, label), name: await waitingName(m, label) },
        notes: `Waiting on customer — from meeting: ${m.krisp.title}`,
      }, me);
      createdId = t.id;
    } else if (kind === "note") {
      const parent = noteParentFor(m.links);
      if (!parent) throw new MeetingUserError("Link the meeting to a company or venue first");
      const n = await addNoteRecord({ ...parent, customerId: m.links.customerId, text: `${title}\n\nFrom meeting: ${m.krisp.title}` },
        me.name, { id: todoRecordId("note", m.id, key) });
      createdId = n.id;
    }

    const decision = { kind, createdId, decidedAt: Date.now(), decidedBy: me.name };
    return mutate(id, me, (cur) => {
      const curTodo = cur.todos.find((t) => t.key === key);
      if (curTodo?.decision?.createdId) return cur;
      // a sync dropped the (undecided) to-do meanwhile: keep it, decided, so the record it made stays accounted for
      if (!curTodo) return { ...cur, todos: [...cur.todos, { ...todo, decision }] };
      return { ...cur, todos: cur.todos.map((t) => (t.key === key ? { ...t, decision } : t)) };
    });
  });
}

/** Confirm all to-dos: each undecided one takes its suggested kind. The rest still apply when one fails;
 *  then a MeetingPartialError names the ones that didn't. */
export async function decideAllTodos(id: string, me: Me): Promise<MeetingRecord> {
  const m = await load(id, me);
  if (!m.filedAt) throw new MeetingUserError("File the meeting before its to-dos");
  const failed: string[] = [];
  let last = m;
  for (const t of m.todos) {
    if (t.decision) continue;
    try {
      last = await decideTodo(id, t.key, t.suggested, {}, me);
    } catch (e) {
      if (e instanceof MeetingAccessError || !(e instanceof MeetingUserError)) throw e;
      failed.push(`${t.title}: ${e.message}`);
    }
  }
  if (failed.length) throw new MeetingPartialError(`${failed.length} to-do${failed.length === 1 ? "" : "s"} not filed — ${failed.join("; ")}`);
  return last;
}

/* ---------- share ---------- */

export async function shareWithCustomer(id: string, summary: string, me: Me): Promise<MeetingRecord> {
  const text = String(summary ?? "").trim();
  if (!text) throw new MeetingUserError("Write the summary the customer will see");
  if (text.length > SHARE_SUMMARY_MAX) throw new MeetingUserError(`Keep the summary under ${SHARE_SUMMARY_MAX} characters`);
  await load(id, me);
  return mutate(id, me, (cur) => {
    if (!cur.links.customerId) throw new MeetingUserError("Link the meeting to a company before sharing it");
    return { ...cur, share: { sharedAt: Date.now(), sharedBy: me.name, summary: text } };
  });
}

export async function stopSharing(id: string, me: Me): Promise<MeetingRecord> {
  await load(id, me);
  return mutate(id, me, (cur) => ({ ...cur, share: null }));
}

/* ---------- noise + refresh ---------- */

/** "Not noise" overrides the < 3 min rule (and the meeting is matched again); "noise" drops the override. */
export async function setNoise(id: string, noise: boolean, me: Me): Promise<MeetingRecord> {
  await load(id, me);
  const index = await buildMatchIndex();
  return mutate(id, me, (cur) => {
    const next = { ...cur, noiseOverride: !noise };
    const out = rematchMeeting(next, index);
    if (!cur.filedAt) return out;
    // a filed meeting keeps its suggestions; only the noise flag follows
    const short = cur.krisp.durationSec != null && cur.krisp.durationSec < NOISE_MAX_SEC;
    return { ...out, noise: next.noiseOverride ? false : short };
  });
}

/** Refresh from Krisp: one detail re-fetch of THIS meeting (any age) through its owner's Krisp account. */
export async function refreshFromKrisp(id: string, me: Me): Promise<MeetingRecord> {
  await load(id, me);
  const r = await refreshMeetingDetail(id);
  if (r.busy) throw new MeetingBusyError("Sync already running — try again in a moment");
  if (r.error) throw new MeetingUserError(r.error);
  return load(id, me);
}
