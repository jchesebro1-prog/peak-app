import { getDoc, listDocs, nextPrefixedId, patchDoc, upsertDoc } from "@/db/doc-store";
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
  IMPORT_WINDOW_DAYS,
  isPersonalKey,
  userIdOfKey,
  type MailboxKey,
} from "./config";
import {
  connectedMailboxKeys,
  getConnectionInfo,
  updateSyncState,
} from "./connections";
import { getMessage, getProfile, listHistory, listMessageIds, sendRaw } from "./api";
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

/** The connection key for the mailbox a thread lives in, or null (personal
 *  box whose user has no connection / unknown name). */
async function keyForThread(t: CommThread): Promise<MailboxKey | null> {
  if (t.mailbox && t.mailbox !== "personal") return t.mailbox; // shared box
  const name = t.mailboxUser || "";
  if (!name) return null;
  const users = await allUsers();
  const u = users.find((x) => x.name === name);
  return u ? "personal:" + u.id : null;
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
      const raw = buildRaw({
        from: fromAddr,
        to: toAddr,
        cc: t.cc || undefined,
        subject: t.subject || "(no subject)",
        body: m.body || "",
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
 *  the touched thread id (or null if it was a duplicate). */
async function recordMessage(
  key: MailboxKey,
  p: ParsedInbound
): Promise<string | null> {
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
      if (dir === "in") d.unread = true;
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
    syncState: "synced",
    syncedAt: Date.now(),
    rev: 1,
  };
  await upsertDoc<CommThread>("comms", rec);
  return id;
}

async function userNameOfKey(key: MailboxKey): Promise<string | null> {
  const uid = userIdOfKey(key);
  if (!uid) return null;
  const users = await allUsers();
  return users.find((u) => u.id === uid)?.name ?? null;
}

/** Import + poll a single mailbox. Returns the last touched thread id. */
async function syncMailbox(key: MailboxKey): Promise<string | null> {
  const info = await getConnectionInfo(key);
  if (!info) return null;
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

/** Poll every connected mailbox. Returns the most-recent touched thread id
 *  (mirrors the simulated checkMail() contract). */
export async function pollInbound(): Promise<string | null> {
  const keys = await connectedMailboxKeys();
  let last: string | null = null;
  for (const key of keys) {
    try {
      const touched = await syncMailbox(key);
      if (touched) last = touched;
    } catch (err) {
      console.error("[gmail] mailbox sync failed for", key, err);
    }
  }
  return last;
}

export { DEFAULT_DOMAIN };
