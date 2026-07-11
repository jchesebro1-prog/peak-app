"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  addMessage,
  archive,
  assign,
  channelMeta,
  checkMail,
  compose,
  create,
  flushOutbox,
  markRead,
  reopen,
  reply,
  saveDraft,
  sendDraft,
  setLink,
  setStatus,
  update,
  updateDraft,
  type CommLink,
  type Direction,
  type MailboxId,
} from "@/lib/stores/comms";
import { nameFor } from "@/lib/stores/customers";

/**
 * Inbox server actions — thin wrappers over the comms store (the prototype's
 * CommStore calls, 1:1). Every mutation revalidates the whole layout so the
 * nav unread badge and the bell stay in step, like the prototype's rss-comm
 * event fan-out.
 */

const MAILBOXES: readonly string[] = ["personal", "sales", "installs", "info"];

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

/* ---- reader: reply / forward / call log ---- */

export async function replyAction(id: string, body: string) {
  const user = await requireUser();
  const b = (body || "").trim();
  if (!b) return { ok: false as const };
  await reply(id, { body: b, me: user.name });
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

export async function composeSendAction(d: ComposePayload) {
  const user = await requireUser();
  const me = user.name;
  if (!(d.to || "").trim() || !((d.subject || "").trim() || (d.body || "").trim())) {
    return { ok: false as const, id: null };
  }
  const customer = d.customerId ? await nameFor(d.customerId) : "";
  let id: string | null = null;
  if (d.id) {
    await updateDraft(d.id, { to: d.to, cc: d.cc, subject: d.subject, body: d.body });
    const rec = await sendDraft(d.id);
    id = rec ? rec.id : d.id;
  } else {
    const rec = await compose({
      mailbox: asMailbox(d.mailbox),
      mailboxUser: me,
      cc: d.cc,
      subject: (d.subject || "").trim() || "(no subject)",
      body: d.body,
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
  const rec = await create({
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
