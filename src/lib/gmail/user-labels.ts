/**
 * #347 — apply the person's own Gmail labels from the reader's Labels card.
 *
 * - The mailbox's labels come from the existing `gmail_labels` cache
 *   (refreshed on every mailbox sync); the picker refreshes it from Gmail
 *   (`users.labels.list`) when it is more than five minutes old.
 * - Apply / remove is Gmail `threads.modify` on the thread's Gmail thread
 *   (the connection must hold gmail.modify — the scope two-way archive
 *   already asks for). Then the card's operation is stamped per label
 *   (`userLabelOps`, so the history import ignores Gmail's echo of it) and
 *   the stored `gmailLabelIds` of every Gmail message on the thread follow
 *   — written by compare-and-set on the thread's `messages` key, so a
 *   message the import appends meanwhile is never lost.
 * - Create is `users.labels.create` (name rules in user-label-rules.ts),
 *   then apply.
 *
 * Only the person's own Gmail thread: in their mailbox (`ownThread`, #341)
 * AND bridged through their own Gmail connection (`gmailAccountKey` ===
 * `personalKey(me.id)` — the token and label cache are that key's). A
 * legacy shared box never reaches here. `Peak/*` labels are never added,
 * removed or created (they follow filing and status). Results are typed —
 * `{ ok: false, error, message }`, never a throw. The Gmail calls go
 * through a small client interface so tests can fake Gmail.
 */
import { casDocKey, getDoc } from "@/db/doc-store";
import type { CommMessage, CommThread } from "@/lib/stores/comms";
import { ownThread } from "@/lib/inbox-thread-guard";
import { createLabel, listLabels, modifyThread, type GmailLabelMeta } from "./api";
import { getConnectionInfo, listCachedLabels, replaceLabels } from "./connections";
import { GMAIL_MODIFY_SCOPE, gmailEnabled, isRateLimit, personalKey } from "./config";
import { isPickableLabel, pickerLabels, USER_LABEL_ECHO_MS, validateLabelName, type LabelLike, type PickerLabel } from "./user-label-rules";

/** The label cache is refreshed from Gmail when older than this. */
export const LABEL_CACHE_MS = 5 * 60_000;

export { USER_LABEL_ECHO_MS };

export type GmailLabelClient = {
  /** Gmail is wired and on (GMAIL_ENABLED) */
  enabled: () => boolean;
  /** the mailbox is connected with gmail.modify */
  canModify: (key: string) => Promise<boolean>;
  listLabels: (key: string) => Promise<GmailLabelMeta[]>;
  createLabel: (key: string, name: string) => Promise<{ id: string; name: string }>;
  modifyThread: (key: string, gmailThreadId: string, change: { addLabelIds?: string[]; removeLabelIds?: string[] }) => Promise<void>;
};

export const realGmailLabelClient: GmailLabelClient = {
  enabled: gmailEnabled,
  canModify: async (key) => {
    const c = await getConnectionInfo(key);
    return !!c && (c.scope || "").includes(GMAIL_MODIFY_SCOPE);
  },
  listLabels,
  createLabel,
  modifyThread,
};

export type LabelError = "not-found" | "no-gmail" | "no-scope" | "label-missing" | "thread-missing" | "bad-name" | "quota" | "failed";
export type LabelFail = { ok: false; error: LabelError; message: string };

const fail = (error: LabelError, message: string): LabelFail => ({ ok: false, error, message });

const MESSAGES: Record<Exclude<LabelError, "bad-name">, string> = {
  "not-found": "Thread not found.",
  "no-gmail": "This email isn't in your connected Gmail, so Gmail labels can't be changed here.",
  "no-scope": "Your Gmail connection can't change labels yet — reconnect it in Settings → Mailboxes.",
  "label-missing": "That label no longer exists in Gmail — the list has been refreshed.",
  "thread-missing": "That email is no longer in Gmail.",
  quota: "Gmail is busy (rate limit) — try again in a minute.",
  failed: "Gmail didn't accept the change — try again.",
};

const failWith = (e: Exclude<LabelError, "bad-name">): LabelFail => fail(e, MESSAGES[e]);

type Me = { id: string; name: string };

const toLike = (l: GmailLabelMeta): LabelLike => ({ labelId: l.id, name: l.name, type: l.type, textColor: l.color?.textColor ?? null, backgroundColor: l.color?.backgroundColor ?? null });

/** Write the label cache; a failed write is logged, never thrown (the
 *  caller already has what Gmail said). */
async function writeCache(key: string, labels: GmailLabelMeta[]): Promise<void> {
  try {
    await replaceLabels(key, labels);
  } catch (err) {
    console.error("[gmail] label cache write failed for", key, err);
  }
}

/** The mailbox's labels: the cache, refreshed from Gmail when stale (or
 *  forced) and Gmail can be reached; a failed refresh keeps the cache. */
export async function mailboxLabels(
  key: string,
  client: GmailLabelClient = realGmailLabelClient,
  opts: { now?: number; force?: boolean } = {}
): Promise<LabelLike[]> {
  const now = opts.now ?? Date.now();
  const rows = await listCachedLabels(key);
  const newest = rows.reduce((m, r) => Math.max(m, r.updatedAt || 0), 0);
  if ((opts.force || !rows.length || newest < now - LABEL_CACHE_MS) && client.enabled()) {
    let fresh: GmailLabelMeta[] | null = null;
    try {
      fresh = await client.listLabels(key);
    } catch (err) {
      console.error("[gmail] label list refresh failed for", key, err);
    }
    if (fresh) {
      await writeCache(key, fresh);
      return fresh.map(toLike);
    }
  }
  return rows.map((r) => ({ labelId: r.labelId, name: r.name, type: r.type, textColor: r.textColor, backgroundColor: r.backgroundColor }));
}

/** My own Gmail thread and my own mailbox key, or why not. The key is
 *  `personalKey(me.id)` and the thread must have been bridged through it —
 *  a thread whose Gmail account is anyone else's (or unstamped) is refused,
 *  whatever its display mailbox says. */
async function myGmailThread(threadId: string, me: Me): Promise<{ t: CommThread; key: string } | LabelFail> {
  const t = await ownThread(threadId, me);
  if (!t || t.deleted || t.status === "draft") return failWith("not-found");
  const key = personalKey(me.id);
  if (t.mailbox !== "personal" || !t.gmailThreadId || t.gmailAccountKey !== key) return failWith("no-gmail");
  return { t, key };
}

/** The picker: the mailbox's pickable labels (Starred, Important, the
 *  person's own — never Peak/*). Listed even while Gmail is off, from the
 *  cache; applying then says why it can't. */
export async function labelPicker(
  threadId: string,
  me: Me,
  client: GmailLabelClient = realGmailLabelClient,
  now: number = Date.now()
): Promise<{ ok: true; labels: PickerLabel[] } | LabelFail> {
  const g = await myGmailThread(threadId, me);
  if (!("t" in g)) return g;
  return { ok: true, labels: pickerLabels(await mailboxLabels(g.key, client, { now })) };
}

/** Gmail's refusal → a typed error. A 404 means the label only on a labels
 *  endpoint; on a thread it means the email is gone from Gmail. */
export function gmailError(err: unknown): Exclude<LabelError, "bad-name"> {
  if (isRateLimit(err)) return "quota";
  const m = err instanceof Error ? err.message : String(err);
  const path = /Gmail API (\S+)/.exec(m)?.[1] || "";
  if (/\b404\b/.test(m)) return path.startsWith("/labels") ? "label-missing" : path.startsWith("/threads") ? "thread-missing" : "failed";
  if (/Invalid label/i.test(m)) return "label-missing";
  if (/\b(401|403)\b/.test(m) || /not connected/i.test(m)) return "no-scope";
  return "failed";
}

const CAS_TRIES = 5;

/** Pure: the messages with `labelId` added to / removed from every Gmail
 *  message (Gmail applies a thread change to each one); null = no change. */
export function withLabel(messages: CommMessage[], labelId: string, on: boolean): CommMessage[] | null {
  let changed = false;
  const out = messages.map((m) => {
    if (!m.gmailId) return m;
    const ids = m.gmailLabelIds || [];
    const has = ids.includes(labelId);
    if (has === on) return m;
    changed = true;
    return { ...m, gmailLabelIds: on ? [...ids, labelId] : ids.filter((x) => x !== labelId) };
  });
  return changed ? out : null;
}

/** Stamp the card's operation on `labelId` (pruning stale entries), then
 *  record the label on the messages — each a compare-and-set on its own key
 *  (`userLabelOps`, `messages`), re-read on conflict, so neither a message
 *  the import appends nor another write meanwhile is lost. */
async function storeLabelChange(threadId: string, labelId: string, on: boolean, now: number): Promise<CommThread | null> {
  for (let i = 0; i < CAS_TRIES; i++) {
    const t = await getDoc<CommThread>("comms", threadId);
    if (!t) return null;
    const prev = t.userLabelOps;
    const ops: Record<string, { on: boolean; at: number }> = {};
    for (const [k, v] of Object.entries(prev || {})) if (v && v.at > now - USER_LABEL_ECHO_MS) ops[k] = v;
    ops[labelId] = { on, at: now };
    if (await casDocKey("comms", threadId, "userLabelOps", prev, ops)) break;
  }
  for (let i = 0; i < CAS_TRIES; i++) {
    const t = await getDoc<CommThread>("comms", threadId);
    if (!t) return null;
    const next = withLabel(t.messages || [], labelId, on);
    if (!next) return t;
    if (await casDocKey("comms", threadId, "messages", t.messages, next)) return { ...t, messages: next };
  }
  console.error("[gmail] storing the label change kept conflicting for", threadId);
  return getDoc<CommThread>("comms", threadId);
}

/** Change one label already known to be pickable. */
async function applyLabel(
  g: { t: CommThread; key: string },
  labelId: string,
  on: boolean,
  client: GmailLabelClient,
  now: number
): Promise<{ ok: true; thread: CommThread | null } | LabelFail> {
  try {
    await client.modifyThread(g.key, g.t.gmailThreadId!, on ? { addLabelIds: [labelId] } : { removeLabelIds: [labelId] });
  } catch (err) {
    const e = gmailError(err);
    if (e === "label-missing") await mailboxLabels(g.key, client, { now, force: true });
    console.error("[gmail] label change failed for", g.t.id, err);
    return failWith(e);
  }
  return { ok: true, thread: await storeLabelChange(g.t.id, labelId, on, now) };
}

/** Add (`on`) or remove one label on my own Gmail thread. */
export async function setThreadLabel(
  threadId: string,
  labelId: string,
  on: boolean,
  me: Me,
  client: GmailLabelClient = realGmailLabelClient,
  now: number = Date.now()
): Promise<{ ok: true; thread: CommThread | null } | LabelFail> {
  const g = await myGmailThread(threadId, me);
  if (!("t" in g)) return g;
  if (!client.enabled()) return failWith("no-gmail");
  if (!(await client.canModify(g.key))) return failWith("no-scope");
  const labels = await mailboxLabels(g.key, client, { now });
  const l = labels.find((x) => x.labelId === labelId);
  if (!l) {
    await mailboxLabels(g.key, client, { now, force: true });
    return failWith("label-missing");
  }
  if (!isPickableLabel(l)) return fail("bad-name", "Labels under “Peak/” follow the filing — change the filing instead.");
  return applyLabel(g, labelId, on, client, now);
}

/** Create a label in my Gmail (or reuse one with the same name) and apply it. */
export async function createThreadLabel(
  threadId: string,
  rawName: string,
  me: Me,
  client: GmailLabelClient = realGmailLabelClient,
  now: number = Date.now()
): Promise<{ ok: true; label: PickerLabel; created: boolean } | LabelFail> {
  const v = validateLabelName(rawName);
  if (!v.ok) return fail("bad-name", v.message);
  const g = await myGmailThread(threadId, me);
  if (!("t" in g)) return g;
  if (!client.enabled()) return failWith("no-gmail");
  if (!(await client.canModify(g.key))) return failWith("no-scope");
  const same = (n: string) => n.toLowerCase() === v.name.toLowerCase();
  let existing = (await mailboxLabels(g.key, client, { now, force: true })).find((l) => l.type === "user" && same(l.name));
  let created = false;
  if (!existing) {
    try {
      const c = await client.createLabel(g.key, v.name);
      existing = { labelId: c.id, name: c.name || v.name, type: "user" };
      created = true;
    } catch (err) {
      // lost a race (409 — it exists now): re-read and use it
      existing = (await mailboxLabels(g.key, client, { now, force: true })).find((l) => l.type === "user" && same(l.name));
      if (!existing) {
        const e = gmailError(err);
        console.error("[gmail] label create failed for", threadId, err);
        return failWith(e === "label-missing" ? "failed" : e);
      }
    }
    // the new label joins the cache now (a fresh list may lag the create);
    // a cache failure here is logged — the label exists in Gmail either way
    if (created) {
      try {
        const cur = await listCachedLabels(g.key);
        await writeCache(g.key, [
          ...cur.filter((r) => r.labelId !== existing!.labelId).map((r) => ({ id: r.labelId, name: r.name, type: r.type, color: { textColor: r.textColor ?? undefined, backgroundColor: r.backgroundColor ?? undefined } })),
          { id: existing.labelId, name: existing.name, type: "user" as const },
        ]);
      } catch (err) {
        console.error("[gmail] label cache read failed for", g.key, err);
      }
    }
  }
  // applied directly (not looked up again in the cache, which may have
  // failed to take the new label)
  if (!isPickableLabel(existing)) return fail("bad-name", "Labels under “Peak/” follow the filing — pick another name.");
  const r = await applyLabel(g, existing.labelId, true, client, now);
  if (!r.ok) return r;
  return { ok: true, created, label: { id: existing.labelId, name: existing.name, textColor: existing.textColor ?? null, backgroundColor: existing.backgroundColor ?? null } };
}
