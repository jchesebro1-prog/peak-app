"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { patchDoc } from "@/db/doc-store";
import { AUTO_SYNC_MIN_AGE_MS } from "@/lib/gmail/config";
import {
  addMessage,
  archive,
  assign,
  channelMeta,
  checkMail,
  checkMailIfStale,
  compose,
  create,
  flushOutbox,
  get as getThread,
  folderOf,
  mailboxLabelFor,
  markRead,
  markUnread,
  reopen,
  reply,
  restore,
  saveDraft,
  searchThreads,
  sendDraft,
  setCategory,
  setFlag,
  setLink,
  setPin,
  setStatus,
  snippet,
  softDelete,
  timeAgo,
  unarchive,
  update,
  updateDraft,
  type CommLink,
  type CommThread,
  type CommSearchScope,
  type Direction,
  type FolderId,
  type MailboxId,
} from "@/lib/stores/comms";
import { nameFor } from "@/lib/stores/customers";
import type { LabelOpt } from "./types";
import { setCrmMode } from "@/lib/stores/notif-prefs";
import { getUser } from "@/lib/users";
import { withEmailSignature } from "@/lib/email-signature";
import {
  byRenewalOf,
  setStatus as setQuoteStatus,
  statusFailureMessage,
} from "@/lib/stores/quotes";
import {
  get as getFlameJob,
  setRenewalOutreach as setFlameRenewalOutreach,
} from "@/lib/stores/flame-jobs";
import {
  get as getInspectionRecord,
  setRenewalOutreach as setInspectionRenewalOutreach,
} from "@/lib/stores/inspections";

/**
 * Inbox server actions — thin wrappers over the comms store (the prototype's
 * CommStore calls, 1:1). Every mutation revalidates the whole layout so the
 * nav unread badge and the bell stay in step, like the prototype's rss-comm
 * event fan-out.
 */

// Shared mailboxes were retired — everything lands in the signed-in user's own
// box, so anything else coerces back to "personal".
const MAILBOXES: readonly string[] = ["personal"];

function asMailbox(x: string | undefined | null): MailboxId {
  return (MAILBOXES.includes(x || "") ? x : "personal") as MailboxId;
}

function revalidate() {
  revalidatePath("/", "layout");
}

/* ---- read state / lifecycle ---- */

export async function markReadAction(id: string) {
  await requireUser();
  await markRead(id);
  revalidate();
}

export async function archiveAction(id: string) {
  await requireUser();
  await archive(id);
  revalidate();
}

export async function unarchiveAction(id: string) {
  await requireUser();
  await unarchive(id);
  revalidate();
}

export async function markUnreadAction(id: string) {
  await requireUser();
  await markUnread(id);
  revalidate();
}

/* ---- flag / pin / category (Outlook parity) ---- */

export async function flagAction(id: string, on: boolean) {
  await requireUser();
  await setFlag(id, on);
  revalidate();
}

export async function pinAction(id: string, on: boolean) {
  await requireUser();
  await setPin(id, on);
  revalidate();
}

export async function categoryAction(id: string, key: string | null) {
  await requireUser();
  await setCategory(id, key);
  revalidate();
}

/* ---- delete / restore (recoverable — the Deleted folder) ---- */

export async function deleteAction(id: string) {
  await requireUser();
  await softDelete(id);
  revalidate();
}

export async function restoreAction(id: string) {
  await requireUser();
  await restore(id);
  revalidate();
}

/* ---- bulk actions (command bar) ------------------------------------------
 * Each loops the per-thread store mutator, then revalidates once. Volumes are
 * small (a selection is a handful of threads), so a simple sequential loop is
 * fine and keeps the store's per-write invariants intact. */

function ids(list: string[]): string[] {
  return Array.isArray(list) ? list.filter((s) => typeof s === "string" && s) : [];
}

export async function bulkArchiveAction(list: string[]) {
  await requireUser();
  for (const id of ids(list)) await archive(id);
  revalidate();
}

export async function bulkDeleteAction(list: string[]) {
  await requireUser();
  for (const id of ids(list)) await softDelete(id);
  revalidate();
}

export async function bulkRestoreAction(list: string[]) {
  await requireUser();
  for (const id of ids(list)) await restore(id);
  revalidate();
}

export async function bulkMarkReadAction(list: string[], read: boolean) {
  await requireUser();
  for (const id of ids(list)) await (read ? markRead(id) : markUnread(id));
  revalidate();
}

export async function bulkFlagAction(list: string[], on: boolean) {
  await requireUser();
  for (const id of ids(list)) await setFlag(id, on);
  revalidate();
}

export async function bulkCategoryAction(list: string[], key: string | null) {
  await requireUser();
  for (const id of ids(list)) await setCategory(id, key);
  revalidate();
}

/* ---- global search (all mailboxes + folders) ------------------------------
 * Returns lightweight rows the list pane renders in "search results" mode.
 * Server-side so it finds mail not currently loaded. */

export type SearchRow = {
  id: string;
  name: string;
  subject: string;
  snippet: string;
  time: string;
  unread: boolean;
  flagged: boolean;
  chan: "mail" | "phone" | "calendar";
  where: string; // "Sales · Archived"
};

const FOLDER_LABEL: Record<FolderId, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  outbox: "Outbox",
  archived: "Archived",
  deleted: "Deleted",
};

/** Gmail labels available to filter by, for whichever mailbox `box` resolves
 *  to for the signed-in user. Empty when that mailbox isn't connected yet —
 *  the label cache only exists after at least one sync (gmail/bridge.ts
 *  syncLabels). Real-life gate is env/connection state, not a permission. */
export async function getLabelsAction(box: MailboxId): Promise<LabelOpt[]> {
  const user = await requireUser();
  const { personalKey } = await import("@/lib/gmail/config");
  const { listCachedLabels } = await import("@/lib/gmail/connections");
  const key = box === "personal" ? personalKey(user.id) : box;
  const rows = await listCachedLabels(key);
  return rows
    .map((r) => ({
      id: r.labelId,
      name: r.name,
      type: r.type,
      textColor: r.textColor,
      backgroundColor: r.backgroundColor,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function searchInboxAction(
  query: string,
  scope: CommSearchScope,
  labelId?: string | null
): Promise<{ rows: SearchRow[] }> {
  const user = await requireUser();
  const hits = await searchThreads(query, scope, user.name, labelId);
  const rows: SearchRow[] = hits.slice(0, 100).map((t) => {
    const icon = channelMeta(t.channel).icon;
    return {
      id: t.id,
      name: t.contactName || t.customer || t.contactEmail || "(unknown)",
      subject: t.subject || "(no subject)",
      snippet: snippet(t),
      time: timeAgo(t.updatedAt || 0),
      unread: !!t.unread,
      flagged: !!t.flagged,
      chan: icon === "phone" ? "phone" : icon === "calendar" ? "calendar" : "mail",
      where: `${mailboxLabelFor(t)} · ${FOLDER_LABEL[folderOf(t)]}`,
    };
  });
  return { rows };
}

export async function setStatusAction(id: string, status: string) {
  await requireUser();
  await setStatus(id, status);
  revalidate();
}

export async function reopenAction(id: string) {
  await requireUser();
  await reopen(id);
  revalidate();
}

export async function assignAction(id: string, name: string) {
  await requireUser();
  await assign(id, name || "");
  revalidate();
}

/* ---- inbox display prefs (punch #42) ---- */

/** Per-user toggle for CRM mode (the waiting-first inbox sort). Task 2 wires
 *  up the UI control that calls this. */
export async function setInboxModeAction(on: boolean): Promise<void> {
  const user = await requireUser();
  await setCrmMode(on, user.name);
  revalidate();
}

/* ---- linking (IDEAS #26) ---- */

export async function setLinkAction(
  id: string,
  link: CommLink | null,
  adopt?: { customerId: string; customer: string } | null
) {
  await requireUser();
  // picking a record on an unlinked thread also adopts the resolved customer
  // (port of Comm Thread onLinkRec)
  if (adopt && adopt.customerId) {
    await update(id, { customerId: adopt.customerId, customer: adopt.customer });
  }
  await setLink(id, link);
  revalidate();
}

/** Link one inbound or outbound message without changing the thread's broad
 * CRM link. */
export async function setMessageLinkAction(
  threadId: string,
  messageId: string,
  link: CommLink | null,
) {
  await requireUser();
  const thread = await getThread(threadId);
  if (!thread) return { ok: false as const, error: "Thread not found." };
  if (!(thread.messages || []).some((m) => m.id === messageId))
    return { ok: false as const, error: "Message not found." };
  await patchDoc<CommThread>("comms", threadId, (d) => {
    const message = (d.messages || []).find((m) => m.id === messageId);
    if (message) message.link = link;
  });
  revalidate();
  return { ok: true as const };
}

/* ---- reader: reply / forward / call log ---- */

export async function replyAction(id: string, body: string) {
  const user = await requireUser();
  const b = (body || "").trim();
  if (!b) return { ok: false as const };
  const profile = await getUser(user.id);
  await reply(id, { body: withEmailSignature(b, profile || { name: user.name, email: user.email }), me: user.name });
  revalidate();
  return { ok: true as const };
}

export async function logNoteAction(
  id: string,
  direction: Direction,
  channel: string,
  body: string
) {
  const user = await requireUser();
  const b = (body || "").trim();
  if (!b) return { ok: false as const };
  await addMessage(id, {
    direction,
    channel,
    body: b,
    me: user.name,
  });
  revalidate();
  return { ok: true as const };
}

/* ---- compose modal ---- */

export type ComposePayload = {
  id?: string | null; // existing draft id (Edit draft)
  mailbox: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  customerId: string;
  contactName: string;
};

/**
 * A renewal-outreach draft just went out (IDEAS #36) → stamp this cycle's
 * "reached out" on the linked job/record (the #37 worklist moves the venue to
 * "Reached out — awaiting") and move the attached renewal quote to Sent.
 * No-ops on ordinary threads: only links flagged `renewal` qualify.
 */
async function completeRenewalOutreach(
  threadId: string,
  me: string
): Promise<void> {
  const t = await getThread(threadId);
  const link = t?.link;
  if (!link || !link.renewal) return;
  if (link.type === "flame_job") {
    const job = await getFlameJob(link.id);
    if (job && job.stage === "completed" && !job.renewalOutreach)
      await setFlameRenewalOutreach(link.id, me);
  } else if (link.type === "inspection") {
    const rec = await getInspectionRecord(link.id);
    if (rec && rec.stage === "completed" && !rec.renewalOutreach)
      await setInspectionRenewalOutreach(link.id, me);
  } else {
    return;
  }
  const quote = await byRenewalOf(link.id);
  if (quote && quote.status === "draft") {
    // Punch #60: setQuoteStatus (quotes.setStatus) now throws when a quote
    // being advanced to "sent" has no approval record. This side effect runs
    // AFTER the outreach email has already been sent (sendDraft above already
    // succeeded) — a renewal quote that happens to lack an approval must not
    // turn a successful send into a thrown-exception failure here. Swallow
    // and leave the quote in draft; the team still sees it needs approval
    // before it can actually go out.
    //
    // #174: still swallowed for the user — but no longer silent. The shared
    // branch logs anything that is NOT the approval gate's own refusal, so a
    // spawn defect on this path leaves a stack in the operator's log instead
    // of disappearing. The returned sentence is deliberately unused: nothing
    // on this code path has a screen to show it on.
    try {
      await setQuoteStatus(quote.id, "sent");
    } catch (e) {
      statusFailureMessage(
        e,
        "inbox/actions completeRenewalOutreach: renewal quote -> sent failed after the email was already sent"
      );
    }
  }
}

export async function composeSendAction(d: ComposePayload) {
  const user = await requireUser();
  const me = user.name;
  const profile = await getUser(user.id);
  const body = withEmailSignature(d.body || "", profile || { name: me, email: user.email });
  if (!(d.to || "").trim() || !((d.subject || "").trim() || (d.body || "").trim())) {
    return { ok: false as const, id: null };
  }
  const customer = d.customerId ? await nameFor(d.customerId) : "";
  let id: string | null = null;
  if (d.id) {
    await updateDraft(d.id, { to: d.to, cc: d.cc, subject: d.subject, body });
    const rec = await sendDraft(d.id);
    id = rec ? rec.id : d.id;
    await completeRenewalOutreach(id, me);
  } else {
    const rec = await compose({
      mailbox: asMailbox(d.mailbox),
      mailboxUser: me,
      cc: d.cc,
      subject: (d.subject || "").trim() || "(no subject)",
      body,
      customerId: d.customerId || null,
      customer,
      contactName: d.contactName,
      contactEmail: d.to,
      assignedTo: me,
      me,
    });
    id = rec.id;
  }
  revalidate();
  return { ok: true as const, id };
}

export async function saveDraftAction(d: ComposePayload) {
  const user = await requireUser();
  const me = user.name;
  if (d.id) {
    await updateDraft(d.id, { to: d.to, cc: d.cc, subject: d.subject, body: d.body });
    revalidate();
    return { ok: true as const, id: d.id };
  }
  const customer = d.customerId ? await nameFor(d.customerId) : "";
  const rec = await saveDraft({
    mailbox: asMailbox(d.mailbox),
    mailboxUser: me,
    to: d.to,
    cc: d.cc,
    subject: d.subject,
    body: d.body,
    customerId: d.customerId || null,
    customer,
    contactName: d.contactName,
    me,
  });
  revalidate();
  return { ok: true as const, id: rec.id };
}

/* ---- log call / meeting modal ---- */

export type LogPayload = {
  channel: string; // 'call' | 'meeting'
  direction: Direction;
  customerId: string;
  contactName: string;
  contactEmail: string;
  subject: string;
  body: string;
  assignedTo: string;
};

export async function logInteractionAction(d: LogPayload) {
  const user = await requireUser();
  const me = user.name;
  if (!d.customerId || !((d.subject || "").trim() || (d.body || "").trim())) {
    return { ok: false as const, id: null };
  }
  const customer = await nameFor(d.customerId);
  // #80: insertWithPrefixedId THROWS once an id collision outlasts its retry
  // budget (doc-store.ts). Rare, but this is a Log button — report it through
  // the failure shape this action already has instead of letting a raw
  // exception escape as a 500.
  let rec: Awaited<ReturnType<typeof create>>;
  try {
    rec = await create({
      mailbox: "personal",
      mailboxUser: me,
      customerId: d.customerId,
      customer,
      contactName: d.contactName,
      contactEmail: d.contactEmail,
      subject: (d.subject || "").trim() || "(" + channelMeta(d.channel).label + ")",
      channel: d.channel,
      direction: d.direction,
      body: d.body,
      assignedTo: d.assignedTo || me,
      me,
    });
  } catch (err) {
    console.error("logInteractionAction: comm mint failed", err);
    return { ok: false as const, id: null };
  }
  revalidate();
  return { ok: true as const, id: rec.id };
}

/* ---- send / receive ---- */

export async function sendReceiveAction() {
  await requireUser();
  await flushOutbox();
  const id = await checkMail();
  revalidate();
  return { ok: true as const, id };
}

// (AUTO_SYNC_MIN_AGE_MS — the shared staleness window — is imported above.)

/** Background send/receive — same sync as the manual button, but claimed
 *  per-mailbox and throttled server-side (D73). Deliberately does NOT
 *  revalidate: revalidatePath inside a server action applies the re-rendered
 *  tree in the SAME roundtrip, which would swap the auto-selected reader
 *  while the user is typing. The client decides when to surface the change
 *  (router.refresh() at the next non-typing moment). */
export async function autoSyncAction() {
  await requireUser();
  const r = await checkMailIfStale(AUTO_SYNC_MIN_AGE_MS);
  return { ok: true as const, ran: r.ran, changed: r.changed, id: r.id };
}
