/**
 * Per-recipient site-visit invites (spec 2026-10-09 site-visit scheduling,
 * Part 1 "Invites"). Pure and client-safe: the record shape, the legacy read,
 * and the add / update / cancel plan. Delivery lives in src/lib/visit-invite.ts.
 *
 * Every person on a visit (lead + attendees) gets it on their calendar: a
 * direct Google Calendar event when their mailbox has the Calendar grant
 * (D77), else an emailed .ics whose UID is always sv-<id>@peak-app.
 */
export type InviteStatus = "calendar" | "sent" | "invites-off" | "gmail-off" | "no-mailbox" | "no-email" | "reconnect" | "failed";
export type InviteChannel = "calendar" | "ics";

/** What one person was last sent: startAt/endAt are the times THEY were told,
 *  so a later save can tell a move (update) from no change (keep). */
export type VisitInviteRecipient = {
  name: string;
  to: string;
  channel: InviteChannel;
  /** the person's own Google event id (channel "calendar") */
  eventId: string | null;
  sentAt: number;
  startAt: number;
  endAt: number;
  /** .ics SEQUENCE last sent (0 for the first invite) */
  sequence: number;
  fromMailbox: string | null;
  /** the latest sent email's Gmail id (channel "ics") */
  gmailId: string | null;
  /** every Gmail id sent to this person for this visit — invite, updates and
   *  cancellations — so the Gmail import (#97) never re-fetches them */
  gmailIds: string[];
};

/** Most Gmail ids kept per recipient (the latest win). */
export const MAX_RECIPIENT_GMAIL_IDS = 50;

/** ids appended, de-duplicated, capped to the latest MAX_RECIPIENT_GMAIL_IDS. */
export function withGmailId(ids: readonly string[], id: string | null | undefined): string[] {
  const out = ids.filter((x) => x !== id);
  if (id) out.push(id);
  return out.slice(-MAX_RECIPIENT_GMAIL_IDS);
}

export type RecipientResult = {
  name: string;
  action: "invite" | "update" | "cancel" | "keep";
  status: InviteStatus;
  /** how the person holds (or was to get) the visit, when known */
  channel?: InviteChannel;
};

export type InviteVisitShape = {
  id: string;
  assignedTo: string;
  attendees?: readonly string[] | null;
  startAt: number | null;
  endAt: number | null;
  invites?: readonly unknown[] | null;
  invite?: { sentAt?: number; to?: string; fromMailbox?: string; gmailId?: string } | null;
  googleEventId?: string | null;
  /** Gmail ids of invite mail whose recipient entry is gone (a cancelled person) */
  inviteGmailIds?: readonly unknown[] | null;
};

export function visitUid(id: string): string {
  return `sv-${id}@peak-app`;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function readRecipient(raw: unknown): VisitInviteRecipient | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name).trim();
  const channel: InviteChannel | null = r.channel === "calendar" || r.channel === "ics" ? r.channel : null;
  if (!name || !channel) return null;
  const eventId = str(r.eventId) || null;
  if (channel === "calendar" && !eventId) return null;
  const gmailId = str(r.gmailId) || null;
  let gmailIds: string[] = [];
  for (const id of Array.isArray(r.gmailIds) ? r.gmailIds : []) if (typeof id === "string" && id) gmailIds = withGmailId(gmailIds, id);
  if (gmailId && !gmailIds.includes(gmailId)) gmailIds = withGmailId(gmailIds, gmailId);
  return {
    name,
    to: str(r.to),
    channel,
    eventId,
    sentAt: num(r.sentAt),
    startAt: num(r.startAt),
    endAt: num(r.endAt),
    sequence: Math.max(0, Math.round(num(r.sequence))),
    fromMailbox: str(r.fromMailbox) || null,
    gmailId,
    gmailIds,
  };
}

/** The visit's recipients. A visit saved before spec 2 has at most the old
 *  single stamp (`googleEventId` or `invite`) — it reads as one entry for the
 *  lead, told the visit's current times. */
export function normalizeInvites(v: InviteVisitShape): VisitInviteRecipient[] {
  if (Array.isArray(v.invites)) {
    const out: VisitInviteRecipient[] = [];
    for (const raw of v.invites) {
      const r = readRecipient(raw);
      if (r && !out.some((e) => e.name === r.name)) out.push(r);
    }
    return out;
  }
  const lead = (v.assignedTo || "").trim();
  if (!lead) return [];
  const startAt = v.startAt ?? 0;
  const endAt = v.endAt ?? 0;
  if (v.googleEventId)
    return [{ name: lead, to: str(v.invite?.to), channel: "calendar", eventId: v.googleEventId, sentAt: num(v.invite?.sentAt), startAt, endAt, sequence: 0, fromMailbox: null, gmailId: null, gmailIds: [] }];
  if (v.invite && str(v.invite.to))
    return [{ name: lead, to: str(v.invite.to), channel: "ics", eventId: null, sentAt: num(v.invite.sentAt), startAt, endAt, sequence: 0, fromMailbox: str(v.invite.fromMailbox) || null, gmailId: str(v.invite.gmailId) || null, gmailIds: str(v.invite.gmailId) ? [str(v.invite.gmailId)] : [] }];
  return [];
}

export type InvitePlan = { add: string[]; update: VisitInviteRecipient[]; cancel: VisitInviteRecipient[]; keep: VisitInviteRecipient[] };

/** target null (deleted) or untimed (unscheduled) → cancel everyone invited. */
export function planInviteChanges(
  current: readonly VisitInviteRecipient[],
  target: { people: readonly string[]; startAt: number | null; endAt: number | null } | null
): InvitePlan {
  const timed = !!target && target.startAt != null && target.endAt != null && target.endAt > target.startAt;
  const people = timed && target ? target.people : [];
  const plan: InvitePlan = { add: [], update: [], cancel: [], keep: [] };
  for (const e of current) {
    if (!people.includes(e.name)) plan.cancel.push(e);
    else if (e.startAt !== target!.startAt || e.endAt !== target!.endAt) plan.update.push(e);
    else plan.keep.push(e);
  }
  for (const n of people) if (!current.some((e) => e.name === n)) plan.add.push(n);
  return plan;
}

/** Every Google event id that IS this visit on someone's calendar. */
export function visitEventIds(v: InviteVisitShape): string[] {
  const out: string[] = [];
  for (const id of [v.googleEventId ?? "", ...normalizeInvites(v).map((e) => e.eventId ?? "")]) if (id && !out.includes(id)) out.push(id);
  return out;
}

/** Every Gmail id of invite mail sent for this visit (a raw or normalized
 *  doc): the old single stamp, each recipient's sends, and the sends to
 *  people since removed. The Gmail import (#97) seeds its dedup with these. */
export function visitInviteGmailIds(v: InviteVisitShape): string[] {
  const out = new Set<string>();
  if (v.invite?.gmailId) out.add(v.invite.gmailId);
  for (const e of normalizeInvites(v)) for (const id of e.gmailIds) out.add(id);
  for (const id of Array.isArray(v.inviteGmailIds) ? v.inviteGmailIds : []) if (typeof id === "string" && id) out.add(id);
  return [...out];
}

/**
 * Which connected mailbox sends a site-visit invite. An update or
 * cancellation prefers the mailbox that sent that person's original invite
 * (its ORGANIZER must not change mid-series) while it is still connected;
 * otherwise the scheduler's personal mailbox, else the first shared box.
 */
export function pickInviteMailbox(keys: readonly string[], opts: { preferMailbox?: string | null; schedulerUserId: string | null }): string | null {
  if (opts.preferMailbox && keys.includes(opts.preferMailbox)) return opts.preferMailbox;
  const personal = opts.schedulerUserId ? "personal:" + opts.schedulerUserId : null;
  if (personal && keys.includes(personal)) return personal;
  return keys.find((k) => !k.startsWith("personal:")) ?? null;
}

export function recipientLine(r: RecipientResult): string {
  if (r.action === "keep") return "";
  const noun = r.action === "cancel" ? "cancellation" : r.action === "update" ? "update" : "invite";
  switch (r.status) {
    case "calendar":
      return r.action === "cancel" ? `Removed from ${r.name}'s Google Calendar` : r.action === "update" ? `Updated on ${r.name}'s Google Calendar` : `Added to ${r.name}'s Google Calendar`;
    case "sent":
      return `${noun[0].toUpperCase()}${noun.slice(1)} emailed to ${r.name}`;
    case "invites-off":
      return `${r.name} has calendar-invite emails turned off`;
    case "gmail-off":
      return `${r.channel === "calendar" ? "Calendar" : "Email"} ${noun}s need Gmail connected`;
    case "no-mailbox":
      return `No connected mailbox to send ${r.name}'s ${noun}`;
    case "no-email":
      return `${r.name} has no email on the team roster`;
    case "reconnect":
      return r.action === "cancel"
        ? `${r.name}'s calendar is disconnected — remove the visit from it by hand (Peak won't retry)`
        : `${r.name}'s calendar is disconnected — reconnect it to update their copy`;
    case "failed":
      return `${r.name}'s ${noun} failed — save again to retry`;
  }
}

export function inviteSummary(rs: readonly RecipientResult[]): string {
  const lines = [...new Set(rs.map(recipientLine).filter(Boolean))];
  return lines.length ? lines.join(". ") + "." : "";
}
