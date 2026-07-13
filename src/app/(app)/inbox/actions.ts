"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  addMessage,
  archive,
  assign,
  byCustomer,
  channelMeta,
  checkMail,
  compose,
  create,
  flushOutbox,
  get as getThread,
  markRead,
  reopen,
  reply,
  saveDraft,
  sendDraft,
  setLink,
  setStatus,
  statusMeta,
  timeAgo,
  timeFull,
  update,
  updateDraft,
  type CommLink,
  type Direction,
  type MailboxId,
} from "@/lib/stores/comms";
import { get as getCustomer, nameFor } from "@/lib/stores/customers";
import {
  byRenewalOf,
  getAll as getAllQuotes,
  setStatus as setQuoteStatus,
  STAGE_LABEL,
} from "@/lib/stores/quotes";
import {
  get as getFlameJob,
  getAll as getAllFlameJobs,
  renewalStatus,
  setRenewalOutreach as setFlameRenewalOutreach,
  RENEWAL_META,
} from "@/lib/stores/flame-jobs";
import {
  get as getInspectionRecord,
  setRenewalOutreach as setInspectionRenewalOutreach,
} from "@/lib/stores/inspections";
import { getAll as getAllRepairJobs } from "@/lib/stores/repair-jobs";
import { aiEnabled } from "@/lib/ai/config";
import { summarizeThread, summarizeCustomer } from "@/lib/ai/features";

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
  if (quote && quote.status === "draft") await setQuoteStatus(quote.id, "sent");
}

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
    await completeRenewalOutreach(id, me);
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

/* ---- AI summaries (D2) — read-only; never sends, writes, or revalidates ---- */

type SummaryResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Summarize the selected thread for a busy salesperson catching up before they
 * reply. Reads only — passes the thread's messages to the AI layer and returns
 * its 2–4 bullet lines. Gated by aiEnabled(); no revalidate (nothing changed).
 */
export async function summarizeThreadAction(
  threadId: string
): Promise<SummaryResult> {
  await requireUser();
  if (!aiEnabled()) return { ok: false, error: "AI features are not enabled." };
  const t = await getThread(threadId);
  if (!t) return { ok: false, error: "That conversation could not be found." };
  const messages = (t.messages || []).map((m) => ({
    direction: m.direction,
    author: m.author,
    when: timeFull(m.at),
    body: m.body,
  }));
  try {
    const text = await summarizeThread({
      subject: t.subject || "(no subject)",
      customer: t.customer || t.contactName || "Customer",
      messages,
    });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Brief the salesperson on a customer's whole history before they reply — quotes,
 * flame-test / repair jobs, and comms threads gathered into a compact factual
 * snapshot for the AI layer. Read-only; gated by aiEnabled(); no revalidate.
 */
export async function summarizeCustomerAction(
  customerId: string
): Promise<SummaryResult> {
  await requireUser();
  if (!aiEnabled()) return { ok: false, error: "AI features are not enabled." };
  const cust = await getCustomer(customerId);
  if (!cust) return { ok: false, error: "That customer could not be found." };

  const [quotes, flameJobs, repairJobs, threads] = await Promise.all([
    getAllQuotes(),
    getAllFlameJobs(),
    getAllRepairJobs(),
    byCustomer(customerId),
  ]);

  const myQuotes = quotes.filter((q) => q.customerId === customerId);
  const myFlame = flameJobs.filter((j) => j.customerId === customerId);
  const myRepairs = repairJobs.filter((j) => j.customerId === customerId);

  const usd = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const lines: string[] = [];

  lines.push(`Type: ${cust.type || "—"}`);
  if (cust.location) lines.push(`Location: ${cust.location}`);
  const primary =
    (cust.contacts || []).find((c) => c.primary) || (cust.contacts || [])[0];
  if (primary) {
    lines.push(
      `Primary contact: ${primary.name}` +
        (primary.role ? ` (${primary.role})` : "") +
        (primary.email ? ` <${primary.email}>` : "")
    );
  }

  if (myQuotes.length) {
    lines.push(`Quotes (${myQuotes.length}):`);
    for (const q of myQuotes) {
      lines.push(
        `  • ${q.id} "${q.name || "Quote"}" — ${STAGE_LABEL[q.status] || q.status}, ${usd(q.value)}`
      );
    }
  }

  if (myFlame.length) {
    lines.push(`Flame-test jobs (${myFlame.length}):`);
    for (const j of myFlame) {
      const r = renewalStatus(j);
      const renewal =
        r.state !== "none"
          ? `, renewal ${RENEWAL_META[r.state].label}` +
            (r.days ? ` (${r.days}d)` : "")
          : "";
      lines.push(
        `  • ${j.id} ${j.venue || "venue"} — ${j.stage}${renewal}`
      );
    }
  }

  if (myRepairs.length) {
    lines.push(`Repair jobs (${myRepairs.length}):`);
    for (const j of myRepairs) {
      lines.push(
        `  • ${j.id} "${j.title || "Repair"}" — ${j.category}, ${j.priority} priority, ${j.stage}`
      );
    }
  }

  if (threads.length) {
    lines.push(`Recent threads (${threads.length}):`);
    for (const t of threads.slice(0, 8)) {
      lines.push(
        `  • "${t.subject || "(no subject)"}" — ${statusMeta(t.status).label}, ${timeAgo(t.updatedAt)}`
      );
    }
  }

  if (!myQuotes.length && !myFlame.length && !myRepairs.length && !threads.length) {
    lines.push("No quotes, jobs, or prior threads on record yet.");
  }

  try {
    const text = await summarizeCustomer({ name: cust.name, facts: lines.join("\n") });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
