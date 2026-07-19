import {
  getDoc,
  insertDocIfAbsent,
  listDocs,
  nextPrefixedId,
  patchDoc,
} from "@/db/doc-store";
import { allUsers } from "@/lib/users";
import {
  DEFAULT_DOMAIN,
  boxAddress,
  lastInbound,
  type CommMessage,
  type CommThread,
  type Direction,
  type MailboxId,
} from "@/lib/stores/comms";
import {
  GMAIL_MODIFY_SCOPE,
  IMPORT_WINDOW_DAYS,
  isPersonalKey,
  userIdOfKey,
  type MailboxKey,
} from "./config";
import {
  claimSyncSlot,
  connectedMailboxKeys,
  getConnectionInfo,
  updateSyncState,
} from "./connections";
import {
  getMessage,
  getProfile,
  listHistory,
  listMessageIds,
  listThreadIds,
  modifyThread,
  sendRaw,
} from "./api";
import { buildRaw, parseInbound, type ParsedInbound } from "./mime";

/**
 * The real Gmail bridge (Phase 7). comms.ts delegates here — but ONLY when the
 * env gate is on (comms guards every call with gmailBridgeActive()), so this
 * module is never loaded in the simulated path. Two responsibilities:
 *   - deliverThreadOutbound(): send any not-yet-sent outbound messages on a
 *     thread through the mailbox's Gmail account, and stamp back the Gmail ids.
 *   - pollInbound(): pull new inbound mail (and the 90-day history on first
 *     connect) into the comms threads, mapping Gmail messages 1:1.
 *
 * It writes to the "comms" collection directly through doc-store (not the
 * comms mutators) so it can dedupe on the Gmail message id and attach the
 * Gmail ids atomically — comms's public API is unchanged.
 */

/* ---- mailbox resolution --------------------------------------------------- */

/** Pure lookup half of keyForThread — takes an already-loaded user list so
 *  per-thread loops (the reconcile sweep) don't refetch users N times. */
function keyForThreadWith(
  t: CommThread,
  users: Awaited<ReturnType<typeof allUsers>>
): MailboxKey | null {
  if (t.mailbox && t.mailbox !== "personal") return t.mailbox; // shared box
  const name = t.mailboxUser || "";
  if (!name) return null;
  const u = users.find((x) => x.name === name);
  return u ? "personal:" + u.id : null;
}

/** The connection key for the mailbox a thread lives in, or null (personal
 *  box whose user has no connection / unknown name). */
async function keyForThread(t: CommThread): Promise<MailboxKey | null> {
  return keyForThreadWith(t, await allUsers());
}

/** The mailbox a NEW inbound thread should land in, derived from the key. */
function mailboxOfKey(key: MailboxKey): { mailbox: MailboxId; userName: string | null } {
  if (isPersonalKey(key)) return { mailbox: "personal", userName: null };
  return { mailbox: key as MailboxId, userName: null };
}

/* ---- outbound ------------------------------------------------------------- */

/**
 * Send every outbound message on the thread that hasn't been handed to Gmail
 * yet. Idempotent: a message carries `gmailId` once sent, so re-runs skip it.
 * A queued (offline) message is left alone — flushOutbox() clears the queue
 * flag first, then dispatches.
 */
export async function deliverThreadOutbound(threadId: string): Promise<void> {
  const t = await getDoc<CommThread>("comms", threadId);
  if (!t) return;
  const key = await keyForThread(t);
  if (!key) return; // mailbox not connected → stays locally "sent" (graceful)
  const info = await getConnectionInfo(key);
  if (!info) return;

  const pending = (t.messages || []).filter(
    (m) => m.direction === "out" && m.channel === "email" && !m.queued && !m.gmailId
  );
  if (!pending.length) return;

  const fromAddr = info.address || boxAddress(t.mailbox || "info", t.mailboxUser || undefined);
  const toAddr =
    t.contactEmail ||
    (t.contactName || "customer").toLowerCase().replace(/\s+/g, ".") + "@email.com";
  const lastIn = lastInbound(t);
  const inReplyTo = lastIn?.gmailMessageId || undefined;

  for (const m of pending) {
    try {
      // data-URL attachments → raw base64 MIME parts (IDEAS #36)
      const attachments = (m.attachments || [])
        .map((a) => {
          const comma = (a.dataUrl || "").indexOf(",");
          if (comma < 0 || !/;base64,/.test(a.dataUrl)) return null;
          return {
            name: a.name || "attachment",
            mime: a.mime || "application/octet-stream",
            dataBase64: a.dataUrl.slice(comma + 1),
          };
        })
        .filter((a): a is NonNullable<typeof a> => !!a);
      const raw = buildRaw({
        from: fromAddr,
        to: toAddr,
        cc: t.cc || undefined,
        subject: t.subject || "(no subject)",
        body: m.body || "",
        attachments,
        inReplyTo,
        references: inReplyTo,
      });
      const sent = await sendRaw(key, raw, t.gmailThreadId || undefined);
      // stamp the ids back atomically
      await patchDoc<CommThread>("comms", threadId, (d) => {
        const target = (d.messages || []).find((x) => x.id === m.id);
        if (target) {
          target.gmailId = sent.id;
          target.gmailThreadId = sent.threadId;
        }
        if (!d.gmailThreadId) d.gmailThreadId = sent.threadId;
        if (!d.gmailAccountKey) d.gmailAccountKey = key;
      });
    } catch (err) {
      console.error("[gmail] send failed for", threadId, m.id, err);
      // leave the message locally sent; a later flush retries it
    }
  }
}

/* ---- inbound -------------------------------------------------------------- */

function threadStatusFor(dir: Direction): CommThread["status"] {
  return dir === "in" ? "waiting_us" : "waiting_them";
}

/** Record one Gmail message into comms, deduped by Gmail message id. Returns
 *  the touched thread id (or null if it was a duplicate). `attempt` guards the
 *  id-collision redo (D73): concurrent syncs can compute the same
 *  nextPrefixedId, so creation inserts-if-absent and re-runs the whole dedup
 *  on collision rather than clobbering the other writer's thread. */
async function recordMessage(
  key: MailboxKey,
  p: ParsedInbound,
  attempt = 0
): Promise<string | null> {
  // The app's own site-visit .ics invites (D76-F) — self-addressed mail that
  // would otherwise reappear as stray inbox threads. Recognized by the
  // X-Peak-Site-Visit header, which survives the Gmail round-trip.
  if (p.siteVisitId) return null;
  const all = await listDocs<CommThread>("comms");
  // already imported?
  for (const t of all) {
    if ((t.messages || []).some((m) => m.gmailId === p.gmailId)) return null;
  }
  const dir: Direction = p.isOutbound ? "out" : "in";
  const msg: CommMessage = {
    id: "gm-" + p.gmailId,
    at: p.at,
    direction: dir,
    channel: "email",
    author: dir === "in" ? p.from.name || p.from.email : p.from.name || "",
    body: p.body,
    gmailId: p.gmailId,
    gmailThreadId: p.gmailThreadId,
    gmailMessageId: p.messageId || undefined,
  };

  // attach to an existing thread sharing the Gmail thread id
  const existing = all.find((t) => t.gmailThreadId === p.gmailThreadId);
  if (existing) {
    await patchDoc<CommThread>("comms", existing.id, (d) => {
      d.messages = (d.messages || []).concat([msg]);
      d.updatedAt = Math.max(d.updatedAt || 0, p.at);
      d.status = threadStatusFor(dir);
      // Which Gmail account owns this thread id — reconcile scopes by this
      // (thread ids are per-account; display-name lookups can misattribute).
      if (!d.gmailAccountKey) d.gmailAccountKey = key;
      // New inbound resurfaces an archived thread — mirrors Gmail (a reply
      // puts the thread back in the inbox) and addMessage()'s semantics.
      if (dir === "in") {
        d.unread = true;
        d.archived = false;
      }
    });
    return existing.id;
  }

  // otherwise open a new thread in the mailbox that received it
  const box = mailboxOfKey(key);
  const contactEmail = dir === "in" ? p.from.email : "";
  const id = await nextPrefixedId("comms", "C", 1032);
  const rec: CommThread = {
    id,
    mailbox: box.mailbox,
    mailboxUser: isPersonalKey(key) ? await userNameOfKey(key) : null,
    unread: dir === "in",
    archived: false,
    customerId: null,
    customer: "",
    contactName: p.from.name || "",
    contactEmail,
    cc: "",
    subject: p.subject,
    channel: "email",
    status: threadStatusFor(dir),
    assignedTo: "",
    link: null,
    messages: [msg],
    createdAt: p.at,
    updatedAt: p.at,
    gmailThreadId: p.gmailThreadId,
    gmailAccountKey: key,
    syncState: "synced",
    syncedAt: Date.now(),
    rev: 1,
  };
  const inserted = await insertDocIfAbsent<CommThread>("comms", rec);
  if (!inserted) {
    // A concurrent sync won this id. Redo from the top with fresh state: the
    // other writer may have recorded this very message (dedup catches it) or
    // created this Gmail thread under another id (attach path catches it).
    if (attempt >= 3) {
      // Needs a new thread created between max-scan and insert on FOUR
      // consecutive tries — vanishingly unlikely. Skipped for this sync
      // (the cursor moves past it); a manual re-import recovers it.
      console.error("[gmail] id collision persisted for", p.gmailId);
      return null;
    }
    return recordMessage(key, p, attempt + 1);
  }
  return id;
}

async function userNameOfKey(key: MailboxKey): Promise<string | null> {
  const uid = userIdOfKey(key);
  if (!uid) return null;
  const users = await allUsers();
  return users.find((u) => u.id === uid)?.name ?? null;
}

/* ---- inbox reconcile (PUNCHLIST #1) --------------------------------------- */

/** Safety cap on the ids-only in:inbox listing (500 ids/page = 10k threads).
 *  If a mailbox somehow exceeds it we still re-inbox threads we found, but
 *  never hide anything based on a partial listing. */
const MAX_INBOX_PAGES = 20;

/**
 * Mirror Gmail's INBOX membership onto this mailbox's comms threads.
 * Archiving OR filing into a label on the Gmail side removes the INBOX label —
 * those threads get gmailInboxed=false and drop out of the Peak inbox (they
 * stay findable under Archived). Gmail putting a thread back (new inbound,
 * manual move-to-inbox) flips it to true on the next sync. The local
 * `archived` flag stays user-owned — this never writes it, so Peak-side
 * archive behaves identically with the gate off.
 *
 * State truth comes from one ids-only threads.list ("in:inbox") rather than
 * replaying history label events: it is 1 API call per 500 threads, immune to
 * event-ordering bugs, and also covers the two cases history can't — the
 * initial 90-day import (which has no label filter, so Gmail-archived mail
 * lands in the Peak inbox) and a reset/expired history cursor.
 */
async function reconcileInboxState(key: MailboxKey): Promise<number> {
  const inboxIds = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  let complete = true;
  do {
    const page = await listThreadIds(key, "in:inbox", pageToken);
    for (const th of page.threads) inboxIds.add(th.id);
    pageToken = page.nextPageToken;
    if (pageToken && ++pages >= MAX_INBOX_PAGES) {
      complete = false; // truncated — only ever re-inbox below
      break;
    }
  } while (pageToken);

  const users = await allUsers();
  const all = await listDocs<CommThread>("comms");
  let flips = 0;
  for (const t of all) {
    if (!t.gmailThreadId) continue; // never bridged: calls, drafts, local-only
    // Scope to the Gmail ACCOUNT that owns the thread id (stamped at import/
    // send). Thread ids are per-account, so judging by the display mailbox —
    // or a display-name user lookup — can compare against the wrong account's
    // inbox and hide live mail. Legacy threads without the stamp fall back to
    // the name-derived key.
    if ((t.gmailAccountKey ?? keyForThreadWith(t, users)) !== key) continue;
    const desired = inboxIds.has(t.gmailThreadId);
    if (!desired && !complete) continue; // don't hide on a partial listing
    // A pure-outbound thread (composed in Peak / sent-only import) was never
    // in Gmail's INBOX — absence from in:inbox carries no "archived" signal,
    // so never demote it. Once the customer replies it gains INBOX and
    // reconciles normally; a previous explicit true may still flip to false.
    if (
      !desired &&
      t.gmailInboxed !== true &&
      !(t.messages || []).some((m) => m.direction === "in")
    )
      continue;
    if (t.gmailInboxed !== desired) {
      await patchDoc<CommThread>("comms", t.id, (d) => {
        d.gmailInboxed = desired;
      });
      flips++;
    }
  }
  return flips;
}

/* ---- site-visit invites (D76) --------------------------------------------- */

/**
 * Email a site-visit .ics invite to the assignee (D76 decisions B/E: the
 * scheduler's own connected mailbox sends it; no customer is ever an
 * attendee). Sender preference: the scheduler's personal mailbox, else the
 * first connected shared box. Returns the sent ids for stamping on the visit
 * record (D76-I), or null when no mailbox can send. The X-Peak-Site-Visit
 * header keeps the import poll from re-recording the mail as an inbox thread.
 */
export async function sendSiteVisitInvite(opts: {
  siteVisitId: string;
  schedulerUserId: string | null;
  toAddr: string;
  subject: string;
  body: string;
  icsText: string;
}): Promise<{ gmailId: string; gmailThreadId: string; fromMailbox: string } | null> {
  const keys = await connectedMailboxKeys();
  const personal = opts.schedulerUserId ? "personal:" + opts.schedulerUserId : null;
  const key =
    personal && keys.includes(personal)
      ? personal
      : keys.find((k) => !isPersonalKey(k)) ?? null;
  if (!key) return null;
  const info = await getConnectionInfo(key);
  if (!info) return null;
  const raw = buildRaw({
    from: info.address,
    to: opts.toAddr,
    subject: opts.subject,
    body: opts.body,
    attachments: [
      {
        name: "site-visit.ics",
        mime: "text/calendar",
        dataBase64: Buffer.from(opts.icsText, "utf8").toString("base64"),
      },
    ],
    extraHeaders: { "X-Peak-Site-Visit": opts.siteVisitId },
  });
  const sent = await sendRaw(key, raw);
  return { gmailId: sent.id, gmailThreadId: sent.threadId, fromMailbox: key };
}

/* ---- two-way archive (D74) ------------------------------------------------ */

/**
 * Push a Peak archive/unarchive to Gmail: remove or add the thread's INBOX
 * label so both inboxes agree (Jeff, 2026-07-19). No-ops gracefully when the
 * thread isn't bridged or the connection's grant predates gmail.modify (those
 * mailboxes stay one-way until reconnected — Settings flags them). Also stamps
 * gmailInboxed locally so the UI is right immediately, without waiting for the
 * next reconcile.
 */
export async function pushInboxState(
  threadId: string,
  inboxed: boolean
): Promise<void> {
  const t = await getDoc<CommThread>("comms", threadId);
  if (!t?.gmailThreadId) return; // never bridged — purely local thread
  const key = t.gmailAccountKey ?? (await keyForThread(t));
  if (!key) return;
  const info = await getConnectionInfo(key);
  if (!info || !info.scope.includes(GMAIL_MODIFY_SCOPE)) return;
  await modifyThread(key, t.gmailThreadId, {
    [inboxed ? "addLabelIds" : "removeLabelIds"]: ["INBOX"],
  });
  await patchDoc<CommThread>("comms", threadId, (d) => {
    d.gmailInboxed = inboxed;
  });
}

/** Import + poll a single mailbox's messages. Returns the last touched thread
 *  id. (Label/INBOX state is reconciled separately by syncMailbox.) */
async function syncMailboxMessages(
  key: MailboxKey,
  info: NonNullable<Awaited<ReturnType<typeof getConnectionInfo>>>
): Promise<string | null> {
  let last: string | null = null;

  if (!info.initialImportDone) {
    // one-time 90-day history import
    let pageToken: string | undefined;
    const query = "newer_than:" + IMPORT_WINDOW_DAYS + "d";
    do {
      const page = await listMessageIds(key, query, pageToken);
      for (const meta of page.messages) {
        const full = await getMessage(key, meta.id);
        const touched = await recordMessage(key, parseInbound(full));
        if (touched) last = touched;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    const profile = await getProfile(key);
    await updateSyncState(key, {
      initialImportDone: true,
      historyId: profile.historyId,
      lastSyncAt: Date.now(),
    });
    return last;
  }

  // incremental: changes since the stored cursor
  const stored = await currentHistoryId(key);
  if (!stored) {
    const profile = await getProfile(key);
    await updateSyncState(key, { historyId: profile.historyId, lastSyncAt: Date.now() });
    return last;
  }
  try {
    let pageToken: string | undefined;
    let newestHistoryId = stored;
    do {
      const page = await listHistory(key, stored, pageToken);
      if (page.historyId) newestHistoryId = page.historyId;
      for (const meta of page.added) {
        const full = await getMessage(key, meta.id);
        const touched = await recordMessage(key, parseInbound(full));
        if (touched) last = touched;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    await updateSyncState(key, { historyId: newestHistoryId, lastSyncAt: Date.now() });
  } catch (err) {
    // cursor too old (404) → reset baseline to now; a manual re-import can
    // widen the window later.
    console.error("[gmail] history sync failed for", key, err);
    const profile = await getProfile(key);
    await updateSyncState(key, { historyId: profile.historyId, lastSyncAt: Date.now() });
  }
  return last;
}

/** Import + poll one mailbox, then reconcile Gmail-side INBOX state onto its
 *  threads. Reconcile runs on EVERY sync — including right after the initial
 *  import (which pulls in Gmail-archived mail) and after a cursor reset
 *  (whose gap would otherwise lose label changes) — and never fails the
 *  message sync. Returns the last touched thread id + whether anything
 *  actually changed (new mail OR reconcile flips), so callers can skip
 *  no-op refreshes. */
async function syncMailbox(
  key: MailboxKey,
  claimMinAgeMs: number
): Promise<{ ran: boolean; last: string | null; changed: boolean }> {
  const info = await getConnectionInfo(key);
  if (!info) return { ran: false, last: null, changed: false };
  // Atomically CLAIM the slot immediately before syncing (D73): the claim
  // START-stamps last_sync_at, so concurrent callers back off for the given
  // window and a failing run still advances the gate (no hammering a dead
  // connection). Claiming here — not batched upfront — keeps the claim→start
  // gap at ~0 so a slow earlier mailbox can't let the slot be re-won mid-run.
  if (!(await claimSyncSlot(key, claimMinAgeMs)))
    return { ran: false, last: null, changed: false };
  const last = await syncMailboxMessages(key, info);
  let flips = 0;
  try {
    flips = await reconcileInboxState(key);
  } catch (err) {
    console.error("[gmail] inbox reconcile failed for", key, err);
  }
  return { ran: true, last, changed: last !== null || flips > 0 };
}

/** Read the persisted Gmail history cursor for a mailbox. */
async function currentHistoryId(key: MailboxKey): Promise<string | null> {
  const { getDb } = await import("@/db");
  const { gmailConnections } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  const rows = await db
    .select({ h: gmailConnections.historyId })
    .from(gmailConnections)
    .where(eq(gmailConnections.mailboxKey, key))
    .limit(1);
  return rows[0]?.h ?? null;
}

/** Guard for the MANUAL Send/Receive path: short enough to never frustrate a
 *  user's click, long enough that it skips a mailbox an auto tick (or another
 *  user's click) started syncing seconds ago instead of racing it. */
const MANUAL_CLAIM_AGE_MS = 10_000;

/** Poll connected mailboxes — all of them (manual path, 10s claim guard) or a
 *  given subset with a caller-chosen claim window (the auto path passes its
 *  staleness threshold, D73). Each mailbox is claimed atomically right before
 *  it syncs; unclaimed ones are skipped. Returns the most-recent touched
 *  thread id (mirrors the simulated checkMail() contract), whether any
 *  mailbox actually ran, and whether anything changed. */
export async function pollInbound(
  onlyKeys?: MailboxKey[],
  claimMinAgeMs: number = MANUAL_CLAIM_AGE_MS
): Promise<{ ran: boolean; id: string | null; changed: boolean }> {
  const keys = onlyKeys ?? (await connectedMailboxKeys());
  let ran = false;
  let last: string | null = null;
  let changed = false;
  for (const key of keys) {
    try {
      const r = await syncMailbox(key, claimMinAgeMs);
      if (r.ran) ran = true;
      if (r.last) last = r.last;
      if (r.changed) changed = true;
    } catch (err) {
      console.error("[gmail] mailbox sync failed for", key, err);
    }
  }
  return { ran, id: last, changed };
}

export { DEFAULT_DOMAIN };
