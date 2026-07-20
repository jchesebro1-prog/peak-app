import {
  getDoc,
  listDocs,
  nextPrefixedId,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";

/* ============================================================
   CommStore — server port of app/comm.js (localStorage key
   rss_comms_v2). The in-app EMAIL CLIENT + interaction log.
   Every customer touch is a MESSAGE inside a THREAD. Threads
   live in a MAILBOX:
     personal  — an individual's own inbox (keyed by mailboxUser)
     sales / installs / info — shared department mailboxes.
   Folders per mailbox: inbox · sent · drafts · outbox · archived.
   Cross-mailbox smart views: 'needs' (needs reply) and 'calls'
   (calls & meetings).

   A thread carries a STATUS  waiting_us | waiting_them | replied |
   closed  (drafts use status 'draft'). Unread is tracked per
   thread. Queued (offline) outbound messages sit in the Outbox
   until flushOutbox() delivers them.

   Server adaptations (field names/lifecycles unchanged):
   - Persistence is the "comms" doc collection via @/db/doc-store.
   - meName()/Team.CURRENT has no server ambient — every method that
     defaulted to the current user takes an optional `me` parameter,
     falling back to DEFAULT_USER exactly like the prototype did.
   - AppSettings.companyName()/Team.color() are other modules (banned
     imports here) — address helpers take an optional `domain` and
     mailbox helpers an optional `userColor`, defaulting to the
     prototype's fallbacks ('peaksystemsgroup.com', '#5b4b8a').
   - online() is true on the server (the server IS the authority);
     the queued/outbox mechanics are kept intact so docs pushed up by
     offline clients still flow through flushOutbox().
   - remove() is a soft delete (doc-store contract).
   - dirty() → touch(): stamps updatedAt/rev and records the doc as
     synced — a Postgres write IS the prototype's cloud push.
   - _setSync/resetToSeed (client sync + demo plumbing) are not
     ported; seeds live in src/db/seeds/comms.ts.

   Email reality (unchanged from the prototype): sending/receiving is
   SIMULATED. All outbound delivery funnels through deliverMessage()
   — the single function a real Gmail bridge replaces — and
   checkMail() drops canned inbound in until a real poll exists.
   ============================================================ */

const DAY = 86_400_000;
const HOUR = 3_600_000;
function now(): number {
  return Date.now();
}

/** Prototype meName() fallback (Team.CURRENT default). */
export const DEFAULT_USER = "Jeff Chesebro";
/** Prototype companyDomain() fallback — slug of 'Peak Systems Group'. */
export const DEFAULT_DOMAIN = "peaksystemsgroup.com";
/** Prototype personal-mailbox color fallback (Jeff's identity color). */
export const DEFAULT_USER_COLOR = "#5b4b8a";

/* ---- status machine ---------------------------------------------------- */

export const STATUSES = [
  "waiting_us",
  "waiting_them",
  "replied",
  "closed",
] as const;
export type ThreadStatus = (typeof STATUSES)[number] | "draft";

export type StatusMeta = {
  label: string;
  short: string;
  ink: string;
  soft: string;
  bd: string;
  dot: string;
};

export const STATUS_META: Record<ThreadStatus, StatusMeta> = {
  waiting_us:   { label: "Waiting on us",   short: "Needs reply", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4", dot: "#c85a3c" },
  waiting_them: { label: "Waiting on them", short: "Waiting",     ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", dot: "#3d6fd0" },
  replied:      { label: "Replied",         short: "Replied",     ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#2f9d6b" },
  closed:       { label: "Closed",          short: "Closed",      ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", dot: "#aab0bb" },
  draft:        { label: "Draft",           short: "Draft",       ink: "#8c6d1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c8a53c" },
};

export function statusMeta(k?: string | null): StatusMeta {
  return (
    (STATUS_META as Record<string, StatusMeta>)[k || ""] ||
    STATUS_META.waiting_them
  );
}

/* ---- channels ----------------------------------------------------------- */

export const CHANNELS = ["email", "call", "meeting"] as const;
export type Channel = (typeof CHANNELS)[number];

export type ChannelMeta = { label: string; verb: string; icon: string };

export const CHANNEL_META: Record<Channel, ChannelMeta> = {
  email:   { label: "Email",      verb: "Emailed",  icon: "mail" },
  call:    { label: "Phone call", verb: "Called",   icon: "phone" },
  meeting: { label: "Meeting",    verb: "Met with", icon: "calendar" },
};

export function channelMeta(k?: string | null): ChannelMeta {
  return (
    (CHANNEL_META as Record<string, ChannelMeta>)[k || ""] ||
    CHANNEL_META.email
  );
}

export type Direction = "in" | "out";

export function statusFromDirection(dir: Direction): ThreadStatus {
  return dir === "in" ? "waiting_us" : "waiting_them";
}

function asChannel(x: string | undefined, fallback: Channel): Channel {
  return (CHANNELS as readonly string[]).includes(x || "")
    ? (x as Channel)
    : fallback;
}

/* ---- records ------------------------------------------------------------ */

export type MailboxId = "personal" | "sales" | "installs" | "info";
export type SmartView = "needs" | "calls";
export type FolderId = "inbox" | "sent" | "drafts" | "outbox" | "archived";

export type CommLink = {
  type: string;
  id: string;
  label?: string;
  /** This thread IS the renewal outreach for the linked record (IDEAS #36) —
   *  sending it stamps the record's renewalOutreach (#37). */
  renewal?: boolean;
};

/** A real file riding on a message/draft (IDEAS #36). Small documents only —
 *  stored as a data-URL inside the thread doc, same approach as the D59
 *  logo uploads (generated quote PDFs run a few KB). */
export type CommAttachment = {
  name: string;
  mime: string;
  size: number; // bytes
  dataUrl: string;
};

export type CommMessage = {
  id: string; // mid() — 'm<n>-<rand4>'
  at: number; // epoch-ms
  direction: Direction;
  channel: Channel;
  author: string;
  body: string;
  attachments?: CommAttachment[];
  queued?: boolean; // offline outbox flag — cleared by deliverMessage()
  // Gmail bridge (Phase 7) — set once a message is delivered to / imported from
  // Gmail; absent in the simulated path and for calls/meetings.
  gmailId?: string; // Gmail message id (delivered/imported)
  gmailThreadId?: string; // Gmail thread id
  gmailMessageId?: string; // RFC-2822 Message-ID header (for reply threading)
};

export type CommDraft = {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  attachments?: CommAttachment[];
};

export type SyncState = "pending" | "syncing" | "synced" | "error";

export type CommThread = {
  id: string; // 'C-####', sequence base 1032
  mailbox: MailboxId;
  mailboxUser?: string | null; // set when mailbox === 'personal'
  unread: boolean;
  archived?: boolean;
  customerId: string | null;
  customer: string;
  contactName: string;
  contactEmail: string;
  cc?: string;
  subject: string;
  channel: Channel;
  status: ThreadStatus;
  assignedTo: string;
  link: CommLink | null;
  draft?: CommDraft | null; // present while status === 'draft'
  messages: CommMessage[];
  createdAt: number;
  updatedAt: number;
  syncState?: SyncState;
  syncedAt?: number | null;
  rev?: number;
  gmailThreadId?: string; // Gmail thread id, once any message is bridged (Phase 7)
  // Which connection key's Gmail ACCOUNT owns gmailThreadId (stamped at
  // import/send). Thread ids are per-account, so the reconcile scopes by this
  // rather than the display mailbox or a name-derived lookup (D73).
  gmailAccountKey?: string;
  // Gmail-side INBOX membership, maintained by the bridge reconcile
  // (PUNCHLIST #1). undefined = unknown / never bridged; false = archived or
  // filed on the Gmail side → hidden from the Peak inbox (shows in Archived).
  // Distinct from `archived`, which stays the user's local Peak flag.
  gmailInboxed?: boolean;
};

function mid(n: number): string {
  return "m" + n + "-" + Math.random().toString(36).slice(2, 6);
}

/** Prototype dirty(): stamp updatedAt + bump the doc rev. On the server the
 *  Postgres write IS the cloud push, so the record lands 'synced'. */
function touch(t: CommThread): void {
  t.updatedAt = now();
  t.rev = (t.rev || 1) + 1;
  t.syncState = "synced";
  t.syncedAt = now();
}

/* ---- mailboxes / addressing --------------------------------------------- */

export type SharedBoxMeta = {
  id: Exclude<MailboxId, "personal">;
  label: string;
  local: string;
  color: string;
  desc: string;
};

export const SHARED_BOXES: SharedBoxMeta[] = [
  { id: "sales",    label: "Sales",    local: "sales",    color: "#3155a8", desc: "Quotes, bids & customer questions" },
  { id: "installs", label: "Installs", local: "installs", color: "#2f6f4f", desc: "Projects, scheduling & field coordination" },
  { id: "info",     label: "Info",     local: "info",     color: "#8a6d1f", desc: "General inbound — the address on the website" },
];

function sharedMeta(id: string): SharedBoxMeta | null {
  return SHARED_BOXES.find((b) => b.id === id) || null;
}

/** Prototype companyDomain(): slug the company name, else the default. */
export function companyDomain(companyName?: string): string {
  const slug = (companyName || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
  return slug ? slug + ".com" : DEFAULT_DOMAIN;
}

/** Team.firstName, inlined (lib modules are off-limits to stores). */
function firstName(name: string): string {
  return (name || "").trim().split(/\s+/)[0] || name || "";
}

export function personalAddress(user?: string, domain = DEFAULT_DOMAIN): string {
  // derive the local part from the name, but always use the company domain so
  // personal and shared mailbox addresses stay consistent.
  const parts = (user || "").trim().split(/\s+/).filter(Boolean);
  const local =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1]).toLowerCase()
      : (parts[0] || "me").toLowerCase();
  return local + "@" + domain;
}

export function boxAddress(
  id: string,
  user?: string,
  domain = DEFAULT_DOMAIN
): string {
  if (id === "personal") return personalAddress(user || DEFAULT_USER, domain);
  const b = sharedMeta(id);
  return (b ? b.local : "team") + "@" + domain;
}

export function boxLabel(id: string, user?: string): string {
  if (id === "personal") return firstName(user || DEFAULT_USER);
  const b = sharedMeta(id);
  return b ? b.label : id;
}

/** The "forward-to-log" address customers' emails can be bounced into. */
export function forwardAddress(domain = DEFAULT_DOMAIN): string {
  return "log@" + domain;
}

// is a thread part of the mailbox `boxId` as seen by `me`?
function inBox(t: CommThread, boxId: string, me: string): boolean {
  if (boxId === "personal")
    return t.mailbox === "personal" && t.mailboxUser === me;
  return t.mailbox === boxId;
}

// every thread the current user can see: their own personal + all shared
function visibleTo(t: CommThread, me: string): boolean {
  return t.mailbox !== "personal" || t.mailboxUser === me;
}

export type MailboxInfo = {
  id: MailboxId;
  kind: "personal" | "shared";
  label: string;
  address: string;
  color: string;
  sub?: string; // 'me' | 'shared' (mailboxes() only)
  user?: string; // personal only
  name?: string; // personal only
  desc?: string; // shared only
};

export function mailboxes(
  me?: string,
  opts: { domain?: string; userColor?: string } = {}
): MailboxInfo[] {
  const user = me || DEFAULT_USER;
  const domain = opts.domain || DEFAULT_DOMAIN;
  const list: MailboxInfo[] = [
    {
      id: "personal",
      kind: "personal",
      user,
      name: user,
      label: firstName(user),
      sub: "me",
      address: personalAddress(user, domain),
      color: opts.userColor || DEFAULT_USER_COLOR,
    },
  ];
  SHARED_BOXES.forEach((b) =>
    list.push({
      id: b.id,
      kind: "shared",
      label: b.label,
      sub: "shared",
      address: b.local + "@" + domain,
      color: b.color,
      desc: b.desc,
    })
  );
  return list;
}

export function boxMeta(
  id: string,
  user?: string,
  opts: { domain?: string; userColor?: string } = {}
): MailboxInfo | null {
  const domain = opts.domain || DEFAULT_DOMAIN;
  if (id === "personal") {
    return {
      id: "personal",
      kind: "personal",
      label: boxLabel("personal", user),
      address: boxAddress("personal", user, domain),
      color: opts.userColor || DEFAULT_USER_COLOR,
    };
  }
  const b = sharedMeta(id);
  return b
    ? {
        id: b.id,
        kind: "shared",
        label: b.label,
        address: b.local + "@" + domain,
        color: b.color,
        desc: b.desc,
      }
    : null;
}

/** Address of the mailbox a thread lives in (our side of the conversation). */
export function mailboxAddressFor(
  t: CommThread | null | undefined,
  domain = DEFAULT_DOMAIN
): string {
  return t ? boxAddress(t.mailbox || "info", t.mailboxUser || undefined, domain) : "";
}

export function mailboxLabelFor(t: CommThread | null | undefined): string {
  return t ? boxLabel(t.mailbox || "info", t.mailboxUser || undefined) : "";
}

/** Per-message From / To, derived from direction + mailbox + contact. */
export function fromToFor(
  t: CommThread,
  m: CommMessage,
  domain = DEFAULT_DOMAIN
): { from: string; to: string } {
  const boxAddr = mailboxAddressFor(t, domain);
  const cAddr =
    t.contactEmail ||
    (t.contactName || "customer").toLowerCase().replace(/\s+/g, ".") +
      "@email.com";
  if (m.direction === "out") return { from: boxAddr, to: cAddr };
  return { from: cAddr, to: boxAddr };
}

/* ---- connectivity -------------------------------------------------------- */

/** The prototype consulted SyncEngine (browser connectivity). The server is
 *  the authority and is always "online"; real offline queueing lives in the
 *  client rebuild, whose queued messages still flow through flushOutbox(). */
export function online(): boolean {
  return true;
}

/* ------------------------------------------------------------------
 * >>> GMAIL BRIDGE SEAM <<<  (Phase 7 wired)
 * deliverMessage() is the SYNCHRONOUS local stamp — it runs inside the
 * doc-store mutate callbacks (which must stay sync) and marks a message
 * optimistically sent (at = now, queued cleared). This is the whole story
 * when the Gmail gate is OFF (dev + any deployment without credentials):
 * behaviour is identical to the prototype's simulation.
 *
 * The real NETWORK delivery is async, so it can't live in a sync mutate.
 * When gmailBridgeActive() is true, the async comms mutators (create /
 * addMessage / flushOutbox) call dispatchOutbound() AFTER the write, which
 * lazily loads lib/gmail/bridge and actually sends via Gmail, stamping the
 * Gmail ids back onto the message. checkMail() likewise delegates inbound to
 * the bridge's pollInbound(). The lazy import keeps the Gmail code out of the
 * simulated path entirely and avoids a static import cycle (bridge imports
 * comms). See DECISIONS D33.
 * ------------------------------------------------------------------ */
function deliverMessage(msg: CommMessage): void {
  msg.at = now();
  if (msg.queued) msg.queued = false;
}

/** Env gate — mirrors lib/gmail/config.gmailEnabled() without importing it
 *  (keeps this store dependency-light and cycle-free). */
function gmailBridgeActive(): boolean {
  return (
    !!process.env.AUTH_GOOGLE_ID &&
    !!process.env.AUTH_GOOGLE_SECRET &&
    process.env.GMAIL_ENABLED === "true"
  );
}

/** Post-write outbound delivery — no-op unless the Gmail gate is on. */
async function dispatchOutbound(threadId: string): Promise<void> {
  if (!gmailBridgeActive()) return;
  try {
    const { deliverThreadOutbound } = await import("@/lib/gmail/bridge");
    await deliverThreadOutbound(threadId);
  } catch (err) {
    console.error("[gmail] outbound dispatch failed:", err);
  }
}

/** Post-write two-way archive push (D74) — mirrors a Peak archive/unarchive
 *  onto the Gmail thread's INBOX label. No-op unless the gate is on; the
 *  bridge itself skips threads that aren't bridged and mailboxes whose grant
 *  lacks gmail.modify (they stay one-way until reconnected). Local state is
 *  already committed when this runs — a push failure just means Gmail catches
 *  up on the user's next action, never a lost local change. */
async function dispatchInboxState(threadId: string, inboxed: boolean): Promise<void> {
  if (!gmailBridgeActive()) return;
  try {
    const { pushInboxState } = await import("@/lib/gmail/bridge");
    await pushInboxState(threadId, inboxed);
  } catch (err) {
    console.error("[gmail] archive push failed:", err);
  }
}

/* ---- pure thread helpers -------------------------------------------------- */

export function lastMsg(t: CommThread): CommMessage | null {
  const m = t.messages || [];
  return m[m.length - 1] || null;
}

export function lastInbound(t: CommThread): CommMessage | null {
  const m = t.messages || [];
  for (let i = m.length - 1; i >= 0; i--)
    if (m[i].direction === "in") return m[i];
  return null;
}

export function hasQueued(t: CommThread): boolean {
  return (t.messages || []).some((m) => m.queued);
}

/** Prototype _snippet(): one-line list preview ("You: …" for outbound). */
export function snippet(t: CommThread): string {
  const m = lastMsg(t);
  if (!m) return t.draft?.body || "";
  const pfx = m.direction === "out" ? "You: " : "";
  return pfx + (m.body || "").replace(/\s+/g, " ").trim();
}

/** "Waiting on us since" — timestamp to measure response time from. */
export function waitingSince(t: CommThread | null | undefined): number | null {
  if (!t || t.status !== "waiting_us") return null;
  const m = lastInbound(t);
  return m ? m.at : t.updatedAt || null;
}

export function waitHours(t: CommThread): number {
  const ws = waitingSince(t);
  return ws ? (now() - ws) / HOUR : 0;
}

/* ---- reads ---------------------------------------------------------------- */

export async function getAll(): Promise<CommThread[]> {
  const list = await listDocs<CommThread>("comms");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<CommThread | null> {
  return getDoc<CommThread>("comms", id);
}

export async function byCustomer(customerId: string): Promise<CommThread[]> {
  return (await getAll()).filter((t) => t.customerId === customerId);
}

/** Client-sync bookkeeping filter (server writes land synced, so normally []). */
export async function pending(): Promise<CommThread[]> {
  const list = await listDocs<CommThread>("comms");
  return list.filter(
    (t) => t.syncState === "pending" || t.syncState === "syncing"
  );
}

/* ---- folder queries -------------------------------------------------------- */

/** Threads in a mailbox+folder (boxId may be a smart view: 'needs' | 'calls'). */
export async function threadsIn(
  boxId: MailboxId | SmartView,
  folder?: FolderId | null,
  me?: string,
  opts: { query?: string } = {}
): Promise<CommThread[]> {
  const user = me || DEFAULT_USER;
  const all = await listDocs<CommThread>("comms");
  let base: CommThread[];
  if (boxId === "needs")
    // gmailInboxed===false = the user already disposed of it on the Gmail
    // side — exactly the flow PUNCHLIST #1 reconciles, so don't keep nagging.
    // Archived threads (Peak-side too) also stop counting (S14, Jeff 7/19).
    base = all.filter(
      (t) =>
        visibleTo(t, user) &&
        t.status === "waiting_us" &&
        !t.archived &&
        t.gmailInboxed !== false
    );
  else if (boxId === "calls")
    base = all.filter(
      (t) => visibleTo(t, user) && t.status !== "draft" && t.channel !== "email"
    );
  else {
    base = all.filter((t) => inBox(t, boxId, user));
    if (folder === "inbox")
      base = base.filter(
        (t) => t.status !== "draft" && !t.archived && t.gmailInboxed !== false
      );
    else if (folder === "sent")
      base = base.filter(
        (t) =>
          t.status !== "draft" &&
          (t.messages || []).some((m) => m.direction === "out")
      );
    else if (folder === "drafts") base = base.filter((t) => t.status === "draft");
    else if (folder === "outbox") base = base.filter((t) => hasQueued(t));
    else if (folder === "archived")
      // Locally archived OR archived/filed on the Gmail side — either way the
      // thread left the inbox, and this is where it stays findable.
      base = base.filter((t) => !!t.archived || t.gmailInboxed === false);
  }
  const ql = (opts.query || "").trim().toLowerCase();
  if (ql)
    base = base.filter((t) =>
      [t.customer, t.subject, t.contactName, t.contactEmail, snippet(t)].some(
        (s) => (s || "").toLowerCase().includes(ql)
      )
    );
  const waitFirst = boxId === "needs" || folder === "inbox";
  if (waitFirst) {
    const w = base
      .filter((t) => t.status === "waiting_us")
      .sort((a, b) => waitHours(b) - waitHours(a));
    const rest = base
      .filter((t) => t.status !== "waiting_us")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return w.concat(rest);
  }
  return base.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export type FolderCounts = {
  inbox: number;
  inboxUnread: number;
  waiting: number;
  sent: number;
  drafts: number;
  outbox: number;
  archived: number;
};

export async function folderCounts(
  boxId: MailboxId,
  me?: string
): Promise<FolderCounts> {
  const user = me || DEFAULT_USER;
  const all = (await listDocs<CommThread>("comms")).filter((t) =>
    inBox(t, boxId, user)
  );
  const inbox = all.filter(
    (t) => t.status !== "draft" && !t.archived && t.gmailInboxed !== false
  );
  return {
    inbox: inbox.length,
    inboxUnread: inbox.filter((t) => t.unread).length,
    waiting: inbox.filter((t) => t.status === "waiting_us").length,
    sent: all.filter(
      (t) =>
        t.status !== "draft" &&
        (t.messages || []).some((m) => m.direction === "out")
    ).length,
    drafts: all.filter((t) => t.status === "draft").length,
    outbox: all.filter((t) => hasQueued(t)).length,
    archived: all.filter((t) => !!t.archived || t.gmailInboxed === false).length,
  };
}

/** Unread count from an already-loaded thread list — lets callers that have
 *  the comms array in hand (e.g. navData) avoid a second full-table scan. */
export function unreadCountFrom(list: CommThread[], me?: string): number {
  const user = me || DEFAULT_USER;
  return list.filter(
    (t) =>
      t.unread && visibleTo(t, user) && !t.archived && t.gmailInboxed !== false
  ).length;
}

export async function unreadCount(me?: string): Promise<number> {
  return unreadCountFrom(await listDocs<CommThread>("comms"), me);
}

export async function needsReplyCount(me?: string): Promise<number> {
  const user = me || DEFAULT_USER;
  const list = await listDocs<CommThread>("comms");
  return list.filter(
    (t) =>
      visibleTo(t, user) &&
      t.status === "waiting_us" &&
      !t.archived &&
      t.gmailInboxed !== false
  ).length;
}

export async function callsCount(me?: string): Promise<number> {
  const user = me || DEFAULT_USER;
  const list = await listDocs<CommThread>("comms");
  return list.filter(
    (t) => visibleTo(t, user) && t.status !== "draft" && t.channel !== "email"
  ).length;
}

export type CommCounts = Record<string, number> & {
  waiting_us: number;
  waiting_them: number;
  replied: number;
  closed: number;
  total: number;
  unassigned: number;
  mineWaiting: number;
  mineOpen: number;
};

export async function counts(opts: { me?: string } = {}): Promise<CommCounts> {
  const me = opts.me || DEFAULT_USER;
  const all = await listDocs<CommThread>("comms");
  const c: CommCounts = {
    waiting_us: 0,
    waiting_them: 0,
    replied: 0,
    closed: 0,
    total: all.length,
    unassigned: 0,
    mineWaiting: 0,
    mineOpen: 0,
  };
  all.forEach((t) => {
    c[t.status] = (c[t.status] || 0) + 1;
    if (!t.assignedTo) c.unassigned++;
    if (me && t.assignedTo === me) {
      if (t.status === "waiting_us") c.mineWaiting++;
      if (t.status !== "closed") c.mineOpen++;
    }
  });
  return c;
}

/* ---- read state ------------------------------------------------------------- */

export async function markRead(id: string): Promise<CommThread | null> {
  const t = await get(id);
  if (!t || !t.unread) return t; // prototype only wrote when unread
  return patchDoc<CommThread>("comms", id, (d) => {
    d.unread = false;
  });
}

export async function markUnread(id: string): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", id, (d) => {
    d.unread = true;
  });
}

export async function archive(id: string): Promise<CommThread | null> {
  const t = await patchDoc<CommThread>("comms", id, (d) => {
    d.archived = true;
    touch(d);
  });
  await dispatchInboxState(id, false); // two-way archive (D74)
  return t;
}

export async function unarchive(id: string): Promise<CommThread | null> {
  const t = await patchDoc<CommThread>("comms", id, (d) => {
    d.archived = false;
    touch(d);
  });
  await dispatchInboxState(id, true); // two-way archive (D74)
  return t;
}

/* ---- create / messages -------------------------------------------------------- */

export type CreateCommInput = {
  id?: string;
  mailbox?: MailboxId;
  mailboxUser?: string | null;
  unread?: boolean;
  customerId?: string | null;
  customer?: string;
  contactName?: string;
  contactEmail?: string;
  cc?: string;
  subject?: string;
  channel?: string;
  status?: ThreadStatus;
  assignedTo?: string;
  link?: CommLink | null;
  direction?: Direction;
  author?: string;
  body?: string;
  /** Server stand-in for Team.CURRENT (defaults to DEFAULT_USER). */
  me?: string;
};

/** Create a new thread from a first message (low-level). */
export async function create(
  partial: CreateCommInput = {}
): Promise<CommThread> {
  const id = partial.id || (await nextPrefixedId("comms", "C", 1032));
  const t = now();
  const dir: Direction = partial.direction === "in" ? "in" : "out";
  const channel = asChannel(partial.channel, "email");
  const me = partial.me || DEFAULT_USER;
  const firstAuthor =
    partial.author || (dir === "in" ? partial.contactName || "Customer" : me);
  const msg: CommMessage = {
    id: mid(1),
    at: t,
    direction: dir,
    channel,
    author: firstAuthor,
    body: partial.body || "",
  };
  if (dir === "out") {
    if (online()) deliverMessage(msg); // GMAIL BRIDGE SEAM
    else msg.queued = true; // offline → Outbox until flushOutbox()
  }
  const rec: CommThread = {
    id,
    mailbox: partial.mailbox || "personal",
    mailboxUser:
      partial.mailbox === "personal" || !partial.mailbox
        ? partial.mailboxUser || me
        : null,
    unread: partial.unread != null ? !!partial.unread : dir === "in",
    archived: false,
    customerId: partial.customerId || null,
    customer: partial.customer || "",
    contactName: partial.contactName || "",
    contactEmail: partial.contactEmail || "",
    cc: partial.cc || "",
    subject: partial.subject || "(no subject)",
    channel,
    status: partial.status || statusFromDirection(dir),
    assignedTo: partial.assignedTo != null ? partial.assignedTo : me,
    link: partial.link || null,
    messages: [msg],
    createdAt: t,
    updatedAt: t,
    syncState: "synced", // the Postgres write is the push
    syncedAt: t,
    rev: 1,
  };
  await upsertDoc<CommThread>("comms", rec);
  if (dir === "out" && !msg.queued) await dispatchOutbound(id); // GMAIL BRIDGE SEAM
  return rec;
}

/** Compose a brand-new email (convenience over create). */
export async function compose(p: CreateCommInput = {}): Promise<CommThread> {
  return create({ ...p, direction: "out", channel: "email" });
}

export type AddMessageInput = {
  direction?: Direction;
  channel?: string;
  author?: string;
  body?: string;
  attachments?: CommAttachment[];
  status?: ThreadStatus;
  /** Server stand-in for Team.CURRENT (defaults to DEFAULT_USER). */
  me?: string;
};

/** Append a message; status follows the message direction unless overridden. */
export async function addMessage(
  threadId: string,
  m: AddMessageInput = {}
): Promise<CommThread | null> {
  const dir: Direction = m.direction === "in" ? "in" : "out";
  let queued = false;
  const res = await patchDoc<CommThread>("comms", threadId, (t) => {
    const channel = asChannel(m.channel, t.channel || "email");
    const me = m.me || DEFAULT_USER;
    const author =
      m.author || (dir === "in" ? t.contactName || "Customer" : me);
    const msg: CommMessage = {
      id: mid((t.messages || []).length + 1),
      at: now(),
      direction: dir,
      channel,
      author,
      body: m.body || "",
    };
    if (m.attachments && m.attachments.length) msg.attachments = m.attachments;
    if (dir === "out") {
      if (online()) deliverMessage(msg); // GMAIL BRIDGE SEAM (local stamp)
      else {
        msg.queued = true;
        queued = true;
      }
    }
    t.messages = (t.messages || []).concat([msg]);
    t.status = m.status || statusFromDirection(dir);
    if (dir === "in") t.unread = true;
    else t.unread = false;
    if (t.status !== "draft") t.archived = false;
    touch(t);
  });
  // real Gmail send happens after the optimistic write (async, gated)
  if (res && dir === "out" && !queued && m.channel !== "call" && m.channel !== "meeting") {
    await dispatchOutbound(threadId);
  }
  return res;
}

/** Reply to a thread as an email (honours offline → Outbox). */
export async function reply(
  threadId: string,
  opts: { body?: string; status?: ThreadStatus; me?: string } = {}
): Promise<CommThread | null> {
  return addMessage(threadId, {
    direction: "out",
    channel: "email",
    body: opts.body || "",
    status: opts.status,
    me: opts.me,
  });
}

/** Reply-all — in the prototype this is a composer MODE over reply(): the Cc
 *  field is prefilled with the thread's own mailbox address but Cc is never
 *  persisted per-message. The stored effect is identical to reply(). */
export async function replyAll(
  threadId: string,
  opts: { body?: string; status?: ThreadStatus; me?: string } = {}
): Promise<CommThread | null> {
  return reply(threadId, opts);
}

/** Forward — prototype composer MODE: an outbound message on the SAME thread
 *  whose body carries the "---------- Forwarded ----------" quote; the typed
 *  To is not persisted (fromToFor derives addressing from mailbox+contact). */
export async function forward(
  threadId: string,
  opts: { body?: string; status?: ThreadStatus; me?: string } = {}
): Promise<CommThread | null> {
  return reply(threadId, opts);
}

/* ---- drafts ---------------------------------------------------------------- */

export type SaveDraftInput = {
  id?: string;
  mailbox?: MailboxId;
  mailboxUser?: string | null;
  customerId?: string | null;
  customer?: string;
  contactName?: string;
  contactEmail?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  link?: CommLink | null;
  attachments?: CommAttachment[];
  me?: string;
};

export async function saveDraft(p: SaveDraftInput = {}): Promise<CommThread> {
  const me = p.me || DEFAULT_USER;
  const rec = await create({
    id: p.id,
    mailbox: p.mailbox || "personal",
    mailboxUser: p.mailboxUser || me,
    customerId: p.customerId || null,
    customer: p.customer || "",
    contactName: p.contactName || "",
    contactEmail: p.contactEmail || p.to || "",
    subject: p.subject || "(no subject)",
    channel: "email",
    direction: "out",
    status: "draft",
    assignedTo: me,
    link: p.link || null,
    unread: false,
    me,
  });
  // a draft holds its editable fields and no real message yet
  const t = await patchDoc<CommThread>("comms", rec.id, (d) => {
    d.messages = [];
    d.draft = {
      to: p.to || p.contactEmail || "",
      cc: p.cc || "",
      subject: p.subject || "",
      body: p.body || "",
    };
    if (p.attachments && p.attachments.length)
      d.draft.attachments = p.attachments;
    d.status = "draft";
  });
  return t || rec;
}

/** Replace a draft's attachments (IDEAS #36 — e.g. attach the renewal quote
 *  PDF to an existing draft that was created without one). */
export async function setDraftAttachments(
  id: string,
  attachments: CommAttachment[]
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", id, (t) => {
    if (t.status !== "draft") return;
    t.draft = { ...(t.draft || {}), attachments };
    t.updatedAt = now();
  });
}

/** Newest un-sent draft thread linked to a given record (IDEAS #36 — clicking
 *  ✉ twice re-opens the same renewal draft instead of minting another). */
export async function findDraftByLink(
  type: string,
  id: string
): Promise<CommThread | null> {
  const list = await listDocs<CommThread>("comms");
  const matches = list.filter(
    (t) =>
      t.status === "draft" && !!t.link && t.link.type === type && t.link.id === id
  );
  matches.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return matches[0] || null;
}

export async function updateDraft(
  id: string,
  patch: Partial<CommDraft> = {}
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", id, (t) => {
    t.draft = { ...(t.draft || {}), ...patch };
    if (patch.subject != null) t.subject = patch.subject || "(no subject)";
    if (patch.to != null) t.contactEmail = patch.to;
    t.updatedAt = now(); // prototype updates the stamp without dirty()
  });
}

/** Send a draft: promote its fields onto the thread, drop out of Drafts
 *  (status leaves 'draft'), land in Sent via the outbound message — the
 *  prototype's simulated send. Delivery runs through deliverMessage(). */
export async function sendDraft(id: string): Promise<CommThread | null> {
  const t = await get(id);
  if (!t) return null;
  const d = t.draft || {};
  await patchDoc<CommThread>("comms", id, (rec) => {
    rec.subject = d.subject || rec.subject || "(no subject)";
    rec.contactEmail = d.to || rec.contactEmail || "";
    rec.cc = d.cc || "";
    rec.draft = null;
    rec.status = "waiting_them";
  });
  return addMessage(id, {
    direction: "out",
    channel: "email",
    body: d.body || "",
    attachments: d.attachments,
  });
}

/** The Phase-2 "send" — alias of sendDraft (real Gmail bridge lands inside
 *  deliverMessage(), not here). */
export { sendDraft as send };

export async function discard(id: string): Promise<void> {
  return remove(id);
}

/* ---- offline outbox + receiving ---------------------------------------------- */

/** Deliver every queued outbound message (offline → online catch-up). */
export async function flushOutbox(): Promise<number> {
  if (!online()) return 0;
  const list = await listDocs<CommThread>("comms");
  let n = 0;
  for (const t of list) {
    if (!hasQueued(t)) continue;
    await patchDoc<CommThread>("comms", t.id, (d) => {
      (d.messages || []).forEach((m) => {
        if (m.queued) {
          deliverMessage(m); // GMAIL BRIDGE SEAM (local stamp)
          n++;
        }
      });
      d.updatedAt = now();
    });
    await dispatchOutbound(t.id); // real send of the just-unqueued messages (gated)
  }
  return n;
}

/** Canned inbound the "Get mail" action pulls in, to demonstrate receiving.
 *  Module state only (the prototype's reset-on-reload queue) — the real
 *  Gmail poll replaces checkMail()'s use of this queue. */
type IncomingItem = {
  threadId?: string;
  message?: AddMessageInput;
  newThread?: CreateCommInput;
};

let _incoming: IncomingItem[] | null = null;

function incomingQueue(): IncomingItem[] {
  if (_incoming) return _incoming;
  _incoming = [
    {
      threadId: "C-1030",
      message: {
        direction: "in",
        channel: "email",
        author: "Priya Anand",
        body: "Perfect — 42 dBA is well within what we need. Please proceed; I’ll have our PO to you by Friday. Thank you!",
      },
    },
    {
      newThread: {
        mailbox: "info",
        unread: true,
        customerId: null,
        customer: "Aurora Playhouse",
        contactName: "Tom Reilly",
        contactEmail: "treilly@auroraplayhouse.org",
        subject: "Website inquiry — new stage curtains + track",
        channel: "email",
        status: "waiting_us",
        assignedTo: "",
        direction: "in",
        body: "Hello — we’re a 300-seat community house planning to replace our main and mid-stage curtains and add a new track this fall. Are you taking on projects that timeframe, and could we get a quote? Thanks, Tom.",
      },
    },
  ];
  return _incoming;
}

/** Simulate receiving mail: pull one canned inbound in.
 *  Returns the touched thread id or null. (Inbound half of the Gmail seam.) */
export async function checkMail(): Promise<string | null> {
  await flushOutbox();
  if (!online()) return null;
  // Real inbound poll when the Gmail gate is on; canned simulation otherwise.
  // (pollInbound claims each mailbox with a short 10s window — a click always
  // syncs unless the very same mailbox was started seconds ago.)
  if (gmailBridgeActive()) {
    try {
      const { pollInbound } = await import("@/lib/gmail/bridge");
      return (await pollInbound()).id;
    } catch (err) {
      console.error("[gmail] inbound poll failed:", err);
      return null;
    }
  }
  const q = incomingQueue();
  if (!q.length) return null;
  const item = q.shift();
  if (!item) return null;
  if (item.threadId && item.message) {
    const t = await addMessage(item.threadId, item.message);
    return t ? t.id : null;
  }
  if (item.newThread) {
    const rec = await create(item.newThread);
    return rec ? rec.id : null;
  }
  return null;
}

/**
 * Throttled background poll (PUNCHLIST #1 — "actively sync"). Per connected
 * mailbox, atomically CLAIMS a sync slot (a conditional start-stamp of
 * last_sync_at, older-than-maxAgeMs) and syncs only the mailboxes it won — so
 * any number of open clients can call this freely (mount + interval) without
 * overlapping syncs or hammering Gmail, and a failing mailbox still advances
 * its stamp instead of defeating the throttle. Mailboxes whose one-time
 * initial import hasn't run are SKIPPED: the (long) import belongs to the
 * manual Send/Receive button, per the connect flow's "runs lazily on the next
 * Get mail". `changed` is what callers should refresh on — a sync that found
 * nothing new returns changed:false. No-op in simulated mode: the canned
 * queue only moves on the manual button.
 */
export async function checkMailIfStale(
  maxAgeMs: number
): Promise<{ ran: boolean; changed: boolean; id: string | null }> {
  const none = { ran: false, changed: false, id: null };
  if (!gmailBridgeActive()) return none;
  try {
    const { listConnections } = await import("@/lib/gmail/connections");
    const eligible = (await listConnections())
      .filter((c) => c.initialImportDone)
      .map((c) => c.mailboxKey);
    if (!eligible.length) return none;
    await flushOutbox();
    // pollInbound claims each mailbox atomically right before syncing it,
    // with OUR staleness window — mailboxes synced more recently are skipped,
    // so overlapping clients/ticks are cheap and can't double-sync a slot.
    const { pollInbound } = await import("@/lib/gmail/bridge");
    const r = await pollInbound(eligible, maxAgeMs);
    return { ran: r.ran, changed: r.changed, id: r.id };
  } catch (err) {
    console.error("[gmail] background sync failed:", err);
    return none;
  }
}

export function hasIncoming(): boolean {
  return incomingQueue().length > 0;
}

/* ---- lifecycle / linking -------------------------------------------------------- */

export async function setStatus(
  threadId: string,
  status: string
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (t) => {
    t.status = (STATUSES as readonly string[]).includes(status)
      ? (status as ThreadStatus)
      : t.status;
    touch(t);
  });
}

export async function reopen(threadId: string): Promise<CommThread | null> {
  const t = await get(threadId);
  if (!t) return null;
  const lm = lastMsg(t);
  return setStatus(
    threadId,
    lm ? statusFromDirection(lm.direction) : "waiting_them"
  );
}

export async function assign(
  threadId: string,
  name?: string | null
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (t) => {
    t.assignedTo = name || "";
    touch(t);
  });
}

export async function setLink(
  threadId: string,
  link?: CommLink | null
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (t) => {
    t.link = link || null;
    touch(t);
  });
}

/** Move a thread to a different mailbox (e.g. claim an info@ note into Sales). */
export async function moveTo(
  threadId: string,
  mailbox: MailboxId,
  user?: string
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (t) => {
    t.mailbox = mailbox;
    t.mailboxUser = mailbox === "personal" ? user || DEFAULT_USER : null;
    touch(t);
  });
}

export async function update(
  threadId: string,
  patch: Partial<CommThread> = {}
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (t) => {
    Object.assign(t, patch);
    touch(t);
  });
}

/** Soft delete (doc-store contract; the prototype hard-removed from the list). */
export async function remove(threadId: string): Promise<void> {
  return softDeleteDoc("comms", threadId);
}

/** Resolve the customer a thread belongs to by contact email against the
 *  directory (port of the Comm Thread screen's _resolveCustomerId; since
 *  D85 the directory composes from the identity core's contact emails). */
export async function resolveCustomerId(
  t: CommThread | null | undefined
): Promise<string | null> {
  if (!t) return null;
  if (t.customerId) return t.customerId;
  const email = (t.contactEmail || "").trim().toLowerCase();
  if (!email) return null;
  const { all: allCustomerDocs } = await import("./customers");
  for (const c of await allCustomerDocs()) {
    const contacts = c.contacts || [];
    if (
      contacts.some((ct) => (ct.email || "").trim().toLowerCase() === email)
    )
      return c.id;
  }
  return null;
}

/* ---- time formatting -------------------------------------------------------------- */

export function timeAgo(ts?: number | null): string {
  if (!ts) return "—";
  const diff = now() - ts;
  if (diff < 60000) return "just now";
  if (diff < HOUR) return Math.floor(diff / 60000) + "m ago";
  if (diff < DAY) return Math.floor(diff / HOUR) + "h ago";
  const d = Math.floor(diff / DAY);
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function timeFull(ts?: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

export function waitLabel(ts?: number | null): string {
  if (!ts) return "";
  const diff = now() - ts;
  if (diff < HOUR) return Math.max(1, Math.floor(diff / 60000)) + "m";
  if (diff < DAY) return Math.floor(diff / HOUR) + "h";
  return Math.floor(diff / DAY) + "d";
}
