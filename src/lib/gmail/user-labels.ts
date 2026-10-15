/**
 * #347 — apply the person's own Gmail labels from the reader's Labels card.
 *
 * - The mailbox's labels come from the existing `gmail_labels` cache
 *   (refreshed on every mailbox sync); the picker refreshes it from Gmail
 *   (`users.labels.list`) when it is more than five minutes old.
 * - Apply / remove is Gmail `threads.modify` on the thread's Gmail thread
 *   (the connection must hold gmail.modify — the scope two-way archive
 *   already asks for), then the stored `gmailLabelIds` of every Gmail
 *   message on the thread are updated so the card changes at once, and
 *   `userLabelsAppliedAt` is stamped so the history import skips its echo.
 * - Create is `users.labels.create` (name rules in user-label-rules.ts),
 *   then apply.
 *
 * Only the person's own Gmail thread (`ownThread`, #341; the personal
 * mailbox — a legacy shared box never reaches here). `Peak/*` labels are
 * never added, removed or created (they follow filing and status).
 * Results are typed — `{ ok: false, error, message }`, never a throw. The
 * Gmail calls go through a small client interface so tests can fake Gmail.
 */
import { patchDoc } from "@/db/doc-store";
import type { CommThread } from "@/lib/stores/comms";
import { ownThread } from "@/lib/inbox-thread-guard";
import { createLabel, listLabels, modifyThread, type GmailLabelMeta } from "./api";
import { getConnectionInfo, listCachedLabels, replaceLabels } from "./connections";
import { GMAIL_MODIFY_SCOPE, gmailEnabled, isRateLimit, personalKey } from "./config";
import { isPickableLabel, pickerLabels, validateLabelName, type LabelLike, type PickerLabel } from "./user-label-rules";

/** The label cache is refreshed from Gmail when older than this. */
export const LABEL_CACHE_MS = 5 * 60_000;

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

export type LabelError = "not-found" | "no-gmail" | "no-scope" | "label-missing" | "bad-name" | "quota" | "failed";
export type LabelFail = { ok: false; error: LabelError; message: string };

const fail = (error: LabelError, message: string): LabelFail => ({ ok: false, error, message });

const MESSAGES: Record<Exclude<LabelError, "bad-name">, string> = {
  "not-found": "Thread not found.",
  "no-gmail": "This email isn't in a connected Gmail mailbox, so Gmail labels can't be changed here.",
  "no-scope": "Your Gmail connection can't change labels yet — reconnect it in Settings → Mailboxes.",
  "label-missing": "That label no longer exists in Gmail — the list has been refreshed.",
  quota: "Gmail is busy (rate limit) — try again in a minute.",
  failed: "Gmail didn't accept the change — try again.",
};

type Me = { id: string; name: string };

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
    try {
      const fresh = await client.listLabels(key);
      await replaceLabels(key, fresh);
      return fresh.map((l) => ({ labelId: l.id, name: l.name, type: l.type, textColor: l.color?.textColor ?? null, backgroundColor: l.color?.backgroundColor ?? null }));
    } catch (err) {
      console.error("[gmail] label list refresh failed for", key, err);
    }
  }
  return rows.map((r) => ({ labelId: r.labelId, name: r.name, type: r.type, textColor: r.textColor, backgroundColor: r.backgroundColor }));
}

/** My own Gmail thread and its mailbox key, or why not. */
async function myGmailThread(threadId: string, me: Me): Promise<{ t: CommThread; key: string } | LabelFail> {
  const t = await ownThread(threadId, me.name);
  if (!t || t.deleted || t.status === "draft") return fail("not-found", MESSAGES["not-found"]);
  if (t.mailbox !== "personal" || !t.gmailThreadId) return fail("no-gmail", MESSAGES["no-gmail"]);
  return { t, key: t.gmailAccountKey || personalKey(me.id) };
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

function gmailError(err: unknown): LabelError {
  if (isRateLimit(err)) return "quota";
  const m = err instanceof Error ? err.message : String(err);
  if (/\b404\b/.test(m) || /Invalid label/i.test(m)) return "label-missing";
  if (/\b(401|403)\b/.test(m) || /not connected/i.test(m)) return "no-scope";
  return "failed";
}

/** Record Gmail's new label set on every Gmail message of the thread (Gmail
 *  applies a thread change to each message) and stamp the echo window. */
async function storeLabelChange(threadId: string, add: string[], remove: string[], now: number): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (d) => {
    d.messages = (d.messages || []).map((m) =>
      m.gmailId
        ? { ...m, gmailLabelIds: Array.from(new Set([...(m.gmailLabelIds || []).filter((id) => !remove.includes(id)), ...add])) }
        : m
    );
    d.userLabelsAppliedAt = now;
  });
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
  if (!client.enabled()) return fail("no-gmail", MESSAGES["no-gmail"]);
  if (!(await client.canModify(g.key))) return fail("no-scope", MESSAGES["no-scope"]);
  const labels = await mailboxLabels(g.key, client, { now });
  const l = labels.find((x) => x.labelId === labelId);
  if (!l) {
    await mailboxLabels(g.key, client, { now, force: true });
    return fail("label-missing", MESSAGES["label-missing"]);
  }
  if (!isPickableLabel(l)) return fail("bad-name", "Labels under “Peak/” follow the filing — change the filing instead.");
  try {
    await client.modifyThread(g.key, g.t.gmailThreadId!, on ? { addLabelIds: [labelId] } : { removeLabelIds: [labelId] });
  } catch (err) {
    const e = gmailError(err);
    if (e === "label-missing") await mailboxLabels(g.key, client, { now, force: true });
    console.error("[gmail] label change failed for", threadId, err);
    return fail(e, MESSAGES[e as Exclude<LabelError, "bad-name">]);
  }
  return { ok: true, thread: await storeLabelChange(g.t.id, on ? [labelId] : [], on ? [] : [labelId], now) };
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
  if (!client.enabled()) return fail("no-gmail", MESSAGES["no-gmail"]);
  if (!(await client.canModify(g.key))) return fail("no-scope", MESSAGES["no-scope"]);
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
        return fail(e === "label-missing" ? "failed" : e, MESSAGES[(e === "label-missing" ? "failed" : e) as Exclude<LabelError, "bad-name">]);
      }
    }
    // the new label joins the cache now (a fresh list may lag the create)
    if (created) {
      const cur = await listCachedLabels(g.key);
      await replaceLabels(g.key, [
        ...cur.filter((r) => r.labelId !== existing!.labelId).map((r) => ({ id: r.labelId, name: r.name, type: r.type, color: { textColor: r.textColor ?? undefined, backgroundColor: r.backgroundColor ?? undefined } })),
        { id: existing.labelId, name: existing.name, type: "user" as const },
      ]);
    }
  }
  const r = await setThreadLabel(threadId, existing.labelId, true, me, client, now);
  if (!r.ok) return r;
  return { ok: true, created, label: { id: existing.labelId, name: existing.name, textColor: existing.textColor ?? null, backgroundColor: existing.backgroundColor ?? null } };
}
