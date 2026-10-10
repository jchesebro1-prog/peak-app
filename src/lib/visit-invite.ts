import { buildIcs } from "@/lib/ics";
import { visitPeople } from "@/lib/drive-plan/stops";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { invitesOn } from "@/lib/stores/notif-prefs";
import { setVisitInvites, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";
import {
  normalizeInvites,
  planInviteChanges,
  withGmailId,
  visitUid,
  type InviteChannel,
  type InviteStatus,
  type RecipientResult,
  type VisitInviteRecipient,
} from "@/lib/visit-invite-plan";

/**
 * Site-visit invite delivery (D76/D77; per recipient since spec 2026-10-09
 * site-visit scheduling). Every person on the visit — lead + attendees — gets
 * it on their own calendar: a direct Google Calendar event when their mailbox
 * has the Calendar grant (D77), else an emailed .ics (UID sv-<id>@peak-app).
 * Adding a person invites them, removing one cancels theirs (calendar delete /
 * METHOD:CANCEL), moving the visit updates everyone — a calendar copy through
 * writeVisitCalendarEvent (update in place, re-confirmed; replaced if gone).
 * The customer is never emailed (D76-B). Never throws: the visit is saved
 * whatever the invites do.
 */

export type { InviteStatus, RecipientResult } from "@/lib/visit-invite-plan";
export type InviteReport = { status: InviteStatus; recipients: RecipientResult[] };

type VisitEventWrite = { title: string; startMs: number; endMs: number; description?: string; location?: string; status?: "confirmed" };
export type VisitCalendarApi = {
  insertEvent(key: string, ev: VisitEventWrite): Promise<{ id: string }>;
  updateEvent(key: string, id: string, ev: VisitEventWrite): Promise<{ id: string; status?: string }>;
  deleteEvent(key: string, id: string): Promise<void>;
  /** where a replaced-copy warning goes (default console.error) */
  log?: (msg: string, err?: unknown) => void;
};

/**
 * The visit's Google copy. A visit that already has one (a reschedule)
 * updates it in place — inserting a second copy would leave the old one
 * behind as a ghost stop that the drive sync then routes to. The update
 * sends status "confirmed" (a rep-deleted copy comes back); if it fails or
 * answers with any other status (deleted in Google, or on another calendar), the old copy is removed
 * (best effort) before a fresh insert. Throws only if the insert fails.
 */
export async function writeVisitCalendarEvent(
  key: string,
  existingId: string | null | undefined,
  ev: VisitEventWrite,
  cal: VisitCalendarApi
): Promise<{ id: string }> {
  const log = cal.log ?? ((msg: string, err?: unknown) => console.error(msg, err));
  if (existingId) {
    try {
      // status "confirmed": a copy the rep deleted in Google is only
      // cancelled there, and a PATCH without it would "update" an invisible
      // event. Anything but a confirmed answer falls through to a fresh insert.
      const r = await cal.updateEvent(key, existingId, { ...ev, status: "confirmed" });
      if (r.status === "confirmed") return { id: r.id || existingId };
      throw new Error("event status after update: " + (r.status ?? "none"));
    } catch (err) {
      log("[site-visit] calendar update failed — replacing the event:", err);
      try {
        await cal.deleteEvent(key, existingId);
      } catch (e) {
        log("[site-visit] old calendar event not removed:", e);
      }
    }
  }
  const r = await cal.insertEvent(key, ev);
  return { id: r.id };
}

export type InviteDeps = {
  now(): number;
  gmailEnabled(): boolean;
  users(): Promise<Array<{ id: string; name: string; email: string }>>;
  invitesOn(name: string): Promise<boolean>;
  calendarKeyFor(userId: string): Promise<string | null>;
  insertEvent: VisitCalendarApi["insertEvent"];
  updateEvent: VisitCalendarApi["updateEvent"];
  deleteEvent: VisitCalendarApi["deleteEvent"];
  sendIcs(opts: {
    siteVisitId: string;
    schedulerUserId: string | null;
    toAddr: string;
    subject: string;
    body: string;
    /** an update / cancellation: the mailbox that sent this person's invite
     *  (used while still connected, so the ORGANIZER never changes) */
    preferMailbox?: string | null;
    /** builds the .ics once the sending mailbox (its ORGANIZER) is known */
    ics: (organizerAddr: string) => string;
  }): Promise<{ gmailId: string; gmailThreadId: string; fromMailbox: string } | null>;
  /** `retiredGmailIds`: Gmail ids sent to people whose entry is gone (kept on
   *  the visit so the Gmail import never re-fetches them) */
  saveInvites(id: string, invites: VisitInviteRecipient[], lead: VisitInviteRecipient | null, retiredGmailIds?: string[]): Promise<void>;
  log(msg: string, err?: unknown): void;
};

function defaultDeps(): InviteDeps {
  return {
    now: Date.now,
    gmailEnabled,
    users: async () => (await allUsers()).map((u) => ({ id: u.id, name: u.name, email: u.email })),
    invitesOn,
    calendarKeyFor: async (userId) => {
      const key = personalKey(userId);
      const info = await getConnectionInfo(key);
      return info && hasCalendarScope(info.scope) ? key : null;
    },
    insertEvent: async (key, ev) => (await import("@/lib/google/calendar")).insertEvent(key, ev),
    updateEvent: async (key, id, ev) => (await import("@/lib/google/calendar")).updateEvent(key, id, ev),
    deleteEvent: async (key, id) => (await import("@/lib/google/calendar")).deleteEvent(key, id),
    sendIcs: async (opts) => (await import("@/lib/gmail/bridge")).sendSiteVisitInvite(opts),
    saveInvites: setVisitInvites,
    log: (msg, err) => console.error(msg, err),
  };
}

function details(rec: SiteVisit, me: { name: string }) {
  // Event title = venue + reason (the punch-list formatter).
  const title = `${rec.venue || rec.customer} — ${rec.reason}`;
  const team = visitPeople(rec);
  const body = [
    `Site visit: ${rec.reason}`,
    `Customer: ${rec.customer}`,
    rec.venue ? `Venue: ${rec.venue}` : "",
    rec.address ? `Address: ${rec.address}` : "",
    rec.contactName
      ? `Contact: ${rec.contactName}` + (rec.contactPhone ? ` · ${rec.contactPhone}` : "") + (rec.contactEmail ? ` · ${rec.contactEmail}` : "")
      : "",
    team.length > 1 ? `Team: ${team[0]} (lead), ${team.slice(1).join(", ")}` : "",
    rec.notes ? `Notes: ${rec.notes}` : "",
    `Scheduled by ${me.name} in Peak (${rec.id}).`,
  ]
    .filter(Boolean)
    .join("\n");
  const location = rec.address || [rec.venue, rec.customer].filter(Boolean).join(", ");
  return { title, body, location };
}

/** The lead's outcome; a visit being cancelled (deleted / unscheduled) has
 *  only cancellations, so the lead's cancellation is its status. */
function leadStatus(rec: SiteVisit, results: RecipientResult[]): InviteStatus {
  return (
    results.find((r) => r.name === rec.assignedTo && r.action !== "cancel")?.status ??
    results.find((r) => r.action !== "cancel")?.status ??
    results.find((r) => r.name === rec.assignedTo)?.status ??
    results[0]?.status ??
    "failed"
  );
}

type Target = { people: string[]; startAt: number | null; endAt: number | null } | null;
type Change = { status: InviteStatus; ok: boolean; gmailId: string | null; eventId: string | null; fromMailbox: string | null; drop?: boolean };
type SendIcs = InviteDeps["sendIcs"];

async function syncInvites(rec: SiteVisit, target: Target, me: { id: string; name: string }, deps?: Partial<InviteDeps>): Promise<InviteReport> {
  const d: InviteDeps = { ...defaultDeps(), ...deps };
  const plan = planInviteChanges(normalizeInvites(rec), target);
  const results: RecipientResult[] = plan.keep.map((e) => ({ name: e.name, action: "keep", status: e.channel === "calendar" ? "calendar" : "sent" }));
  if (!plan.add.length && !plan.update.length && !plan.cancel.length) return { status: leadStatus(rec, results), recipients: results };

  // Every send is persisted as soon as it is made (after each person, so a
  // drive sync running mid-dispatch sees the new event ids), and once more in
  // `finally` as the safety net: an update / cancel not yet attempted keeps
  // its old entry, so the next save retries it and never repeats a send.
  const next: VisitInviteRecipient[] = [...plan.keep];
  const pending = new Set<VisitInviteRecipient>([...plan.update, ...plan.cancel]);
  const retired: string[] = [];
  let dirty = false;
  let savedOnce = false;
  const persist = async () => {
    if (!dirty) return;
    dirty = false;
    const saved = [...next, ...pending];
    const lead = target ? saved.find((e) => e.name === rec.assignedTo) ?? null : null;
    try {
      await d.saveInvites(rec.id, saved, lead, [...retired]);
      savedOnce = true;
    } catch (err) {
      dirty = true; // the finally tries again
      d.log("[site-visit] invite stamp failed:", err);
    }
  };
  try {
    const users = await d.users();
    const userOf = (name: string) => users.find((u) => u.name === name) ?? null;
    // Throws when the grant lookup itself fails (a retryable error, never
    // "no grant"); null = this person has no connected calendar.
    const strictKeyOf = async (name: string): Promise<string | null> => {
      const u = userOf(name);
      if (!u || !d.gmailEnabled()) return null;
      return await d.calendarKeyFor(u.id);
    };
    const keyOf = async (name: string): Promise<string | null> => {
      try {
        return await strictKeyOf(name);
      } catch {
        return null;
      }
    };
    const cal: VisitCalendarApi = { insertEvent: d.insertEvent, updateEvent: d.updateEvent, deleteEvent: d.deleteEvent, log: d.log };
    const { title, body, location } = details(rec, me);
    const now = d.now();
    const uid = visitUid(rec.id);
    const startAt = target?.startAt ?? 0;
    const endAt = target?.endAt ?? 0;
    const write: VisitEventWrite = { title, startMs: startAt, endMs: endAt, description: body, location };
    // The .ics names the sending mailbox as ORGANIZER and the person as
    // ATTENDEE (RFC 5546 — required on a CANCEL); PUBLISH output is unchanged.
    const icsFor = (toAddr: string, method: "PUBLISH" | "CANCEL", sequence: number, s: number, e: number) => (organizer: string) =>
      buildIcs({ uid, title, description: body, location, start: s, end: e, stampAt: now, method, sequence, organizer, attendee: toAddr });
    const email = (toAddr: string, subject: string, ics: Parameters<SendIcs>[0]["ics"], preferMailbox: string | null = null) =>
      d.sendIcs({ siteVisitId: rec.id, schedulerUserId: me.id, toAddr, subject, body, ics, ...(preferMailbox ? { preferMailbox } : {}) });

    for (const name of plan.add) {
      let status: InviteStatus = "failed";
      let channel: InviteChannel | undefined;
      try {
        const toAddr = userOf(name)?.email || "";
        if (!d.gmailEnabled()) status = "gmail-off";
        else if (!toAddr) status = "no-email";
        else if (!(await d.invitesOn(name))) status = "invites-off";
        else {
          let placed = false;
          const key = await keyOf(name);
          if (key) {
            try {
              const ev = await d.insertEvent(key, write);
              next.push({ name, to: toAddr, channel: "calendar", eventId: ev.id, sentAt: now, startAt, endAt, sequence: 0, fromMailbox: key, gmailId: null, gmailIds: [] });
              dirty = true;
              status = "calendar";
              channel = "calendar";
              placed = true;
            } catch (err) {
              d.log("[site-visit] calendar write failed:", err);
            }
          }
          if (!placed) {
            channel = "ics";
            const sent = await email(toAddr, title, icsFor(toAddr, "PUBLISH", 0, startAt, endAt));
            if (sent) {
              next.push({ name, to: toAddr, channel: "ics", eventId: null, sentAt: now, startAt, endAt, sequence: 0, fromMailbox: sent.fromMailbox, gmailId: sent.gmailId, gmailIds: [sent.gmailId] });
              dirty = true;
              status = "sent";
            } else status = "no-mailbox";
          }
        }
      } catch (err) {
        d.log("[site-visit] invite send failed:", err);
        status = "failed"; // not recorded — the next save retries this person
      }
      results.push({ name, action: "invite", status, ...(channel ? { channel } : {}) });
      await persist();
    }

    // Update / cancel go to people already invited — no invites-toggle check:
    // they hold a copy that must not go stale.
    const change = async (e: VisitInviteRecipient, kind: "update" | "cancel"): Promise<Change> => {
      const fail = (status: InviteStatus): Change => ({ status, ok: false, gmailId: null, eventId: null, fromMailbox: null });
      try {
        if (!d.gmailEnabled()) return fail("gmail-off");
        if (e.channel === "calendar") {
          const key = await strictKeyOf(e.name);
          if (!key) {
            // Their calendar grant is gone. An update waits for a reconnect
            // (entry kept, retried); a removed person's copy can never be
            // deleted by Peak now, so that entry is dropped and the summary says so.
            return kind === "cancel" ? { ...fail("reconnect"), drop: true } : fail("reconnect");
          }
          if (!e.eventId) return fail("failed");
          if (kind === "cancel") {
            await d.deleteEvent(key, e.eventId);
            return { status: "calendar", ok: true, gmailId: null, eventId: null, fromMailbox: key };
          }
          // Main's reschedule rule, per person: PATCH in place (re-confirmed);
          // a copy deleted in Google is replaced, never doubled.
          const ev = await writeVisitCalendarEvent(key, e.eventId, write, cal);
          return { status: "calendar", ok: true, gmailId: null, eventId: ev.id, fromMailbox: key };
        }
        const toAddr = e.to || userOf(e.name)?.email || "";
        if (!toAddr) return fail("no-email");
        // From the mailbox that sent the invite while it is still connected —
        // the ORGANIZER of an update / CANCEL must match the original.
        const sent =
          kind === "cancel"
            ? await email(toAddr, `Cancelled: ${title}`, icsFor(toAddr, "CANCEL", e.sequence + 1, e.startAt, e.endAt), e.fromMailbox)
            : await email(toAddr, `Updated: ${title}`, icsFor(toAddr, "PUBLISH", e.sequence + 1, startAt, endAt), e.fromMailbox);
        return sent ? { status: "sent", ok: true, gmailId: sent.gmailId, eventId: null, fromMailbox: sent.fromMailbox } : fail("no-mailbox");
      } catch (err) {
        d.log(`[site-visit] ${e.channel === "calendar" ? "calendar" : "invite"} ${kind} failed:`, err);
        return fail("failed");
      }
    };

    for (const e of plan.update) {
      const r = await change(e, "update");
      pending.delete(e);
      next.push(
        r.ok
          ? {
              ...e,
              startAt,
              endAt,
              sentAt: now,
              sequence: e.sequence + 1,
              gmailId: r.gmailId ?? e.gmailId,
              gmailIds: withGmailId(e.gmailIds, r.gmailId),
              eventId: r.eventId ?? e.eventId,
              fromMailbox: r.fromMailbox ?? e.fromMailbox,
            }
          : e // kept as last told, so the next save retries the update
      );
      if (r.ok) dirty = true;
      results.push({ name: e.name, action: "update", status: r.status, channel: e.channel });
      await persist();
    }
    for (const e of plan.cancel) {
      const r = await change(e, "cancel");
      pending.delete(e);
      if (!r.ok && !r.drop) next.push(e); // kept, so the next save retries the cancellation
      else {
        // The entry goes; every Gmail id ever sent this person stays on the visit.
        for (const id of withGmailId(e.gmailIds, r.gmailId)) if (!retired.includes(id)) retired.push(id);
        dirty = true;
      }
      results.push({ name: e.name, action: "cancel", status: r.status, channel: e.channel });
      await persist();
    }
  } finally {
    if (!savedOnce) dirty = true; // always written at least once
    await persist();
  }
  return { status: leadStatus(rec, results), recipients: results };
}

/** Bring every person's calendar in line with the saved visit: invite the
 *  new, update the moved, cancel the removed. Pass the FRESH record. */
export async function dispatchVisitInvite(rec: SiteVisit, me: { id: string; name: string }, deps?: Partial<InviteDeps>): Promise<InviteReport> {
  try {
    const scheduled = rec.stage === "scheduled" || rec.stage === "done";
    return await syncInvites(rec, scheduled ? { people: visitPeople(rec), startAt: rec.startAt, endAt: rec.endAt } : null, me, deps);
  } catch (err) {
    (deps?.log ?? defaultDeps().log)("[site-visit] invite dispatch failed:", err);
    return { status: "failed", recipients: [] };
  }
}

/** The visit is being deleted: everyone invited gets a cancellation — unless
 *  the visit is already over (D782): a past visit stays in people's calendar
 *  history, and no one is emailed about deleting something that happened. */
export async function cancelVisitInvites(rec: SiteVisit, me: { id: string; name: string }, deps?: Partial<InviteDeps>): Promise<InviteReport> {
  try {
    const now = (deps?.now ?? Date.now)();
    if ((rec.endAt ?? rec.startAt ?? 0) < now) {
      const recipients: RecipientResult[] = normalizeInvites(rec).map((e) => ({ name: e.name, action: "keep", status: e.channel === "calendar" ? "calendar" : "sent", channel: e.channel }));
      return { status: leadStatus(rec, recipients), recipients };
    }
    return await syncInvites(rec, null, me, deps);
  } catch (err) {
    (deps?.log ?? defaultDeps().log)("[site-visit] invite cancel failed:", err);
    return { status: "failed", recipients: [] };
  }
}
