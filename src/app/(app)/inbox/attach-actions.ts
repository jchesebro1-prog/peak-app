"use server";

import { requireUser } from "@/lib/session";
import { ownThread } from "@/lib/inbox-thread-guard";
import { getProject } from "@/lib/stores/projects";
import { documentsForCustomer } from "@/lib/stores/documents";
import { emailDocContext, finalizeMailUpload } from "@/lib/mail-attachments-server";
import { documentFitsEmail, mailAttachNameError, mailBlobPath } from "@/lib/mail-attachments";
import { newUploadKey } from "@/lib/document-files";

/**
 * Batch 6 / #64 — the Inbox composer's Attach button (lib/mail-attachments.ts).
 * No file bytes ever pass through these actions (the 1200 kb action limit):
 * the browser uploads straight to private Blob through /api/inbox/attach-upload.
 */

/** Where the browser may upload one file: a fresh key under the signed-in user's own folder (the token route grants
 *  only that path). Name and size are checked first — the server re-checks the real bytes after. */
export async function mailUploadTargetAction(fileName: string, size: number): Promise<{ ok: true; uploadKey: string; pathname: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const bad = mailAttachNameError(String(fileName ?? ""), Number(size));
  if (bad) return { ok: false, error: bad };
  const uploadKey = newUploadKey();
  return { ok: true, uploadKey, pathname: mailBlobPath(user.id, uploadKey, String(fileName)) };
}

/** A finished upload → the attachment chip's record, after the server re-checks its path, size and leading bytes. */
export async function finalizeMailUploadAction(input: { uploadKey: string; blobPath: string; fileName: string; mime?: string }) {
  const user = await requireUser();
  const r = await finalizeMailUpload(input, user.id);
  return r.ok ? { ok: true as const, attachment: { name: r.attachment.name, size: r.attachment.size, mime: r.attachment.mime, blobPath: r.attachment.blobPath! } } : r;
}

export type AttachableDoc = { id: string; title: string; fileName: string; size: number; category: string; project: boolean };

/**
 * The Documents the email may attach: its company's files and its project's.
 * An existing draft (`threadId`) reads its own company and work-link project —
 * only the thread's owner (#341/#349); a new message reads the company picked
 * in its Client row.
 */
export async function attachableDocumentsAction(input: { threadId?: string | null; customerId?: string | null }): Promise<{ ok: true; docs: AttachableDoc[] } | { ok: false; error: string }> {
  const user = await requireUser();
  let ctx: { customerId: string | null; projectId: string | null };
  if (input?.threadId) {
    const t = await ownThread(input.threadId, user);
    if (!t) return { ok: false, error: "Draft not found." };
    ctx = emailDocContext(t);
  } else {
    ctx = { customerId: typeof input?.customerId === "string" && input.customerId.trim() ? input.customerId.trim().slice(0, 120) : null, projectId: null };
  }
  const companies = new Set<string>();
  if (ctx.customerId) companies.add(ctx.customerId);
  if (ctx.projectId) {
    const p = await getProject(ctx.projectId);
    if (p?.customerId) companies.add(p.customerId);
  }
  if (!companies.size) return { ok: true, docs: [] };
  const rows = (await Promise.all([...companies].map((c) => documentsForCustomer(c)))).flat();
  const docs = rows
    .filter((d) => documentFitsEmail(d, ctx))
    .slice(0, 300)
    .map((d) => ({ id: d.id, title: d.title, fileName: d.fileName, size: d.size, category: d.category, project: !!ctx.projectId && d.projectId === ctx.projectId }));
  return { ok: true, docs };
}
