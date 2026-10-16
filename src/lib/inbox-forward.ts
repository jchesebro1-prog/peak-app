/**
 * #356 review (Critical 1) — Forward is a real new message. It used to be a
 * reply on the SAME thread, so the bridge sent the body (and any attachment)
 * to the thread's customer contact instead of the address the rep typed.
 *
 * Now a forward is its own outbound thread in the same mailbox, addressed to
 * the typed To / Cc only, subject "Fwd: …", body = the rep's text with the
 * quoted original. It may carry the original email's attachments (copied by
 * reference: a Gmail attachment is read from its source message, same mailbox
 * only) plus the rep's own picks, resolved against the source thread's
 * company / project — but only when that link was deliberate (#341): a forward
 * of a private email stays private (no company, no work link), so it can't
 * become visible to teammates through the copy. Server-only; the caller has
 * already run the owner check on the source thread.
 */
import { hasDeliberateLink, saveDraft, sendDraft, type CommAttachment, type CommThread, type MailboxId } from "@/lib/stores/comms";
import { emailDocContext, resolveComposeAttachments, type MailAttachDeps } from "@/lib/mail-attachments-server";
import { attachLimitError, type ComposeAttachments } from "@/lib/mail-attachments";

export type ForwardInput = {
  to: string;
  cc?: string;
  subject?: string;
  body: string;
  /** Carry the forwarded message's own attachments (default on in the composer). */
  includeOriginal?: boolean;
  attachments?: ComposeAttachments | null;
};

/** One address-list header value: no CR/LF, trimmed, capped. Pure. */
export function cleanAddressList(v: unknown): string {
  return String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 1000);
}

/** "Fwd: <subject>" once. Pure. */
export function forwardSubject(subject: string): string {
  const s = String(subject || "").trim() || "(no subject)";
  return /^fwd?:/i.test(s) ? s : `Fwd: ${s}`;
}

/** The message being forwarded — the thread's newest (the one the composer quotes). */
export function forwardedMessage(t: Pick<CommThread, "messages">): CommThread["messages"][number] | null {
  const ms = t.messages || [];
  return ms.length ? ms[ms.length - 1] : null;
}

/**
 * The original's attachments, copied by reference for the forward thread (pure). A stored file (data-URL, a quote /
 * report PDF, a composer upload) keeps its reference; a Gmail attachment points back at its source message; a
 * document only rides when the forward keeps the company (`keepCompany`), since the bridge re-checks it against the
 * forward's own company. Anything with no readable reference is left out.
 */
export function forwardableAttachments(source: Pick<CommThread, "id" | "messages">, keepCompany: boolean): CommAttachment[] {
  const m = forwardedMessage(source);
  const out: CommAttachment[] = [];
  for (const a of m?.attachments || []) {
    const base = { name: a.name, mime: a.mime, size: a.size };
    if (a.dataUrl) out.push({ ...base, dataUrl: a.dataUrl });
    else if (a.pdfPath) out.push({ ...base, pdfPath: a.pdfPath, ...(a.href ? { href: a.href } : {}) });
    else if (a.blobPath) out.push({ ...base, blobPath: a.blobPath });
    else if (a.documentId) {
      if (keepCompany) out.push({ ...base, documentId: a.documentId });
    } else if (a.gmailPartId && m) out.push({ ...base, gmailPartId: a.gmailPartId, fwdFrom: { threadId: source.id, messageId: m.id } });
  }
  return out;
}

export type ForwardResult = { ok: true; id: string } | { ok: false; error: string };

export async function forwardThread(
  source: CommThread,
  input: ForwardInput,
  me: { id: string; name: string },
  deps?: MailAttachDeps,
): Promise<ForwardResult> {
  const to = cleanAddressList(input.to);
  if (!to) return { ok: false, error: "Add who to forward it to." };
  const cc = cleanAddressList(input.cc);
  const keepCompany = hasDeliberateLink(source);
  const ctx = keepCompany ? emailDocContext(source) : { customerId: null, projectId: null };
  const picked = await resolveComposeAttachments([], input.attachments ?? null, { userId: me.id, ...ctx }, deps);
  if (!picked.ok) return picked;
  const attachments = [...(input.includeOriginal === false ? [] : forwardableAttachments(source, keepCompany)), ...picked.attachments];
  const over = attachLimitError(attachments);
  if (over) return { ok: false, error: over };
  const draft = await saveDraft({
    mailbox: (source.mailbox || "personal") as MailboxId,
    owner: me, // #349 — the forwarding user owns the new thread
    to,
    cc,
    subject: forwardSubject(input.subject || source.subject),
    body: input.body || "",
    ...(keepCompany ? { customerId: source.customerId, customer: source.customer, link: source.link } : {}),
    contactName: "",
    ...(attachments.length ? { attachments } : {}),
  });
  const sent = await sendDraft(draft.id, me.name, { stampAddresses: true });
  return { ok: true, id: sent?.id ?? draft.id };
}
