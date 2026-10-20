/**
 * Batch 6 / #64 — the server half of the Inbox composer's Attach button
 * (rules in lib/mail-attachments.ts). Server-only.
 *
 *  - finalizeMailUpload: a browser upload that landed in Blob becomes an
 *    attachment only after its path, size and leading bytes check out; a
 *    refused upload is deleted.
 *  - resolveComposeAttachments: the list a save / send stores on the draft —
 *    the draft's own files the composer kept (by key; a browser can only keep
 *    or drop, never invent one), plus each new upload (re-checked: the
 *    caller's own path, its real size) and each new document (its own
 *    company's or project's, name and size from the record). 18 MB / 20 files.
 *  - readMailRefForThread: the bytes of a by-reference upload or document at
 *    send / download time, re-checked against the thread.
 */
import { deleteBlob, getBlobBytes, getBlobHead } from "@/lib/blob";
import { getDocument } from "@/lib/stores/documents";
import type { DocumentRecord } from "@/lib/document-rules";
import { get as getThread, type CommAttachment, type CommThread } from "@/lib/stores/comms";
import { blockedExtension, checkDocumentBytes, displayFileName, DOCUMENT_SNIFF_BYTES, customerPathSegment } from "@/lib/document-files";
import {
  attachKey,
  attachLimitError,
  documentFitsEmail,
  isMailBlobPath,
  mailBlobOwnerSegment,
  mailBlobPathInScope,
  MAIL_ATTACH_MAX_BYTES,
  MAIL_ATTACH_MAX_LABEL,
  type ComposeAttachments,
} from "@/lib/mail-attachments";

export type MailAttachDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
  document: (id: string) => Promise<Pick<DocumentRecord, "id" | "fileName" | "mime" | "size" | "customerId" | "projectId" | "blobPath"> | null>;
};

const liveDeps: MailAttachDeps = { head: getBlobHead, remove: deleteBlob, document: getDocument };

const cleanMime = (m: unknown): string => {
  const s = typeof m === "string" ? m.trim().toLowerCase() : "";
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(s) && s.length <= 100 ? s : "application/octet-stream";
};

export type MailUploadResult = { ok: true; attachment: CommAttachment } | { ok: false; error: string };

/** A finished browser upload → an attachment (`{ name, mime, size, blobPath }`), or a refusal (the blob is deleted). */
export async function finalizeMailUpload(
  input: { uploadKey?: unknown; blobPath?: unknown; fileName?: unknown; mime?: unknown },
  userId: string,
  deps: MailAttachDeps = liveDeps,
): Promise<MailUploadResult> {
  const uploadKey = typeof input?.uploadKey === "string" ? input.uploadKey : "";
  if (!mailBlobPathInScope(input?.blobPath, userId, uploadKey)) return { ok: false, error: "That upload isn’t yours." };
  const blobPath = input.blobPath as string;
  const name = displayFileName(input.fileName);
  const refuse = async (error: string): Promise<MailUploadResult> => {
    try {
      await deps.remove(blobPath);
    } catch {
      /* best effort */
    }
    return { ok: false, error };
  };
  if (blockedExtension(name)) return refuse(`${name} is a program or script — those can’t be attached.`);
  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await deps.head(blobPath, DOCUMENT_SNIFF_BYTES);
  } catch {
    return { ok: false, error: "Couldn’t read the uploaded file — try again." };
  }
  if (!head) return { ok: false, error: "The upload didn’t arrive — try again." };
  if (!(head.size > 0)) return refuse(`${name} is empty.`);
  if (head.size > MAIL_ATTACH_MAX_BYTES) return refuse(`${name} is over ${MAIL_ATTACH_MAX_LABEL}.`);
  const magic = checkDocumentBytes(head.bytes);
  if (magic) return refuse(magic);
  return { ok: true, attachment: { name, mime: cleanMime(input.mime), size: head.size, blobPath } };
}

export type ResolveResult = { ok: true; attachments: CommAttachment[] } | { ok: false; error: string };

/** The attachments a save / send stores. `input` null = the composer didn't touch them: the stored list stands. */
export async function resolveComposeAttachments(
  stored: readonly CommAttachment[],
  input: ComposeAttachments | null,
  ctx: { userId: string; customerId?: string | null; projectId?: string | null },
  deps: MailAttachDeps = liveDeps,
): Promise<ResolveResult> {
  if (!input) return { ok: true, attachments: [...stored] };
  const keep = new Set(input.keep);
  const out: CommAttachment[] = stored.filter((a, i) => keep.has(attachKey(a, i)));
  const have = new Set(out.map((a, i) => attachKey(a, i)));
  for (const ref of input.add) {
    if (ref.kind === "upload") {
      if (have.has(`blob:${ref.blobPath}`)) continue;
      if (!mailBlobPathInScope(ref.blobPath, ctx.userId)) return { ok: false, error: "An attachment isn’t yours — attach it again." };
      let head: { bytes: Uint8Array; size: number } | null = null;
      try {
        head = await deps.head(ref.blobPath, DOCUMENT_SNIFF_BYTES);
      } catch {
        head = null;
      }
      if (!head || !(head.size > 0)) return { ok: false, error: `${displayFileName(ref.name)} didn’t upload — attach it again.` };
      if (checkDocumentBytes(head.bytes) || blockedExtension(ref.name)) return { ok: false, error: `${displayFileName(ref.name)} can’t be attached.` };
      out.push({ name: displayFileName(ref.name), mime: cleanMime(ref.mime), size: head.size, blobPath: ref.blobPath });
      have.add(`blob:${ref.blobPath}`);
    } else {
      if (have.has(`doc:${ref.documentId}`)) continue;
      const doc = await deps.document(ref.documentId);
      if (!doc || !documentFitsEmail(doc, ctx)) return { ok: false, error: "A document isn’t one of this company’s or project’s files." };
      out.push({ name: displayFileName(doc.fileName), mime: cleanMime(doc.mime), size: Number(doc.size) || 0, documentId: doc.id });
      have.add(`doc:${doc.id}`);
    }
  }
  const over = attachLimitError(out);
  return over ? { ok: false, error: over } : { ok: true, attachments: out };
}

/** Two threads in one mailbox: the same personal owner, or the same shared box (no personal owner). Pure. */
export function sameMailbox(a: Pick<CommThread, "mailbox" | "mailboxOwnerId">, b: Pick<CommThread, "mailbox" | "mailboxOwnerId">): boolean {
  if (a.mailboxOwnerId || b.mailboxOwnerId) return !!a.mailboxOwnerId && a.mailboxOwnerId === b.mailboxOwnerId;
  return !!a.mailbox && a.mailbox !== "personal" && a.mailbox === b.mailbox;
}

/** The thread's company and (work-link) project — what a document must belong to. */
export function emailDocContext(t: Pick<CommThread, "customerId" | "link">): { customerId: string | null; projectId: string | null } {
  return { customerId: t.customerId || null, projectId: t.link?.type === "project" ? t.link.id : null };
}

/**
 * The bytes of a by-reference composer upload or document on this thread, or null (refused / missing — the caller
 * treats null as "can't send"). An upload must be a composer path, and the thread owner's own when the thread has one;
 * a document must still exist and belong to the thread's company or project.
 */
export async function readMailRefForThread(a: Pick<CommAttachment, "blobPath" | "documentId" | "gmailPartId" | "fwdFrom">, t: CommThread): Promise<Buffer | null> {
  if (a.fwdFrom && a.gmailPartId) {
    // #356 review — a forwarded Gmail attachment: read from its source message, only when the source thread sits in
    // the same mailbox as the forward (the same owner, or the same shared box).
    const src = await getThread(a.fwdFrom.threadId);
    if (!src || !sameMailbox(src, t)) return null;
    const { fetchMessageAttachment } = await import("@/lib/gmail/bridge");
    const r = await fetchMessageAttachment(src.id, a.fwdFrom.messageId, a.gmailPartId, MAIL_ATTACH_MAX_BYTES);
    return Buffer.isBuffer(r) ? r : null;
  }
  if (a.blobPath) {
    if (!isMailBlobPath(a.blobPath)) return null;
    if (t.mailboxOwnerId && mailBlobOwnerSegment(a.blobPath) !== customerPathSegment(t.mailboxOwnerId)) return null;
    const r = await getBlobBytes(a.blobPath, MAIL_ATTACH_MAX_BYTES);
    return r.ok ? r.bytes : null;
  }
  if (a.documentId) {
    const doc = await getDocument(a.documentId);
    if (!doc || !documentFitsEmail(doc, emailDocContext(t))) return null;
    const r = await getBlobBytes(doc.blobPath, MAIL_ATTACH_MAX_BYTES);
    return r.ok ? r.bytes : null;
  }
  return null;
}
