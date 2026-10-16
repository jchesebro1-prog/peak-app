/**
 * Batch 6 / #64 (Jeff 2026-10-15) — the Inbox composer's Attach button. Pure
 * and client-safe (no store, no `@/db`, no Node built-ins).
 *
 * Two kinds of new attachment, both BY REFERENCE (a comms doc never holds the
 * bytes — navData reads every comms doc on every page):
 *  - a file from the computer, uploaded straight to private Blob at
 *    `mail-attachments/<user>/<uploadKey>/<name>` through the token route
 *    /api/inbox/attach-upload (no bytes through a server action or function
 *    body), then checked by finalizeMailUploadAction (size, program bytes);
 *  - a Documents record (#218) of the email's linked company or project,
 *    read at send time.
 * Together with any file already on the draft, at most 18 MB of files and 20
 * files: Gmail's 25 MB limit counts the ENCODED message, and base64 grows the
 * files by a third (#356 review). The bridge also refuses a built message over
 * 25 MB (comms-attachments messageTooLargeError).
 * The Gmail bridge reads the bytes when it sends (comms-attachments.ts).
 */
import { blockedExtension, customerPathSegment, displayFileName, isUploadKey, safeFileName } from "@/lib/document-files";

export const MAIL_ATTACH_MAX_BYTES = 18 * 1024 * 1024;
export const MAIL_ATTACH_MAX_LABEL = "18 MB";
/** The rep's message when the files are over the cap (#356 review). */
export const MAIL_ATTACH_TOO_LARGE = "Attachments too large for Gmail — 18 MB max.";
export const MAIL_ATTACH_MAX_FILES = 20;
export const MAIL_ATTACH_PREFIX = "mail-attachments/";

/** `mail-attachments/<user>/<uploadKey>/` — one folder per upload, under the uploader. */
export function mailUploadPrefix(userId: string, uploadKey: string): string {
  return `${MAIL_ATTACH_PREFIX}${customerPathSegment(userId)}/${uploadKey}/`;
}

/** Where the browser uploads a file (Blob appends a random suffix). */
export function mailBlobPath(userId: string, uploadKey: string, fileName: string): string {
  return mailUploadPrefix(userId, uploadKey) + safeFileName(fileName);
}

const REST_RE = /^[A-Za-z0-9._-]{1,200}$/;

/** Is a CLIENT-SUPPLIED pathname this user's upload (under one upload key)? With `uploadKey`, under that key only. */
export function mailBlobPathInScope(pathname: unknown, userId: string, uploadKey?: string): pathname is string {
  if (typeof pathname !== "string" || !userId || pathname.includes("..")) return false;
  const base = `${MAIL_ATTACH_PREFIX}${customerPathSegment(userId)}/`;
  if (!pathname.startsWith(base)) return false;
  const [key, rest, ...more] = pathname.slice(base.length).split("/");
  if (more.length || !isUploadKey(key) || (uploadKey !== undefined && key !== uploadKey)) return false;
  return REST_RE.test(rest || "");
}

/** Any well-formed composer upload path (the bridge's defence in depth: never a quote PDF, a document, a photo). */
export function isMailBlobPath(pathname: unknown): pathname is string {
  if (typeof pathname !== "string" || !pathname.startsWith(MAIL_ATTACH_PREFIX) || pathname.includes("..")) return false;
  const [user, key, rest, ...more] = pathname.slice(MAIL_ATTACH_PREFIX.length).split("/");
  return !more.length && /^[A-Za-z0-9_-]{1,64}$/.test(user || "") && isUploadKey(key) && REST_RE.test(rest || "");
}

/** The user segment of a composer upload path, or null. */
export function mailBlobOwnerSegment(pathname: unknown): string | null {
  return isMailBlobPath(pathname) ? pathname.slice(MAIL_ATTACH_PREFIX.length).split("/")[0] : null;
}

/** The token route's clientPayload: `{ uploadKey }`. */
export function parseMailUploadPayload(payload: string | null): { uploadKey: string } | null {
  try {
    const p = payload ? (JSON.parse(payload) as { uploadKey?: unknown } | null) : null;
    return p && isUploadKey(p.uploadKey) ? { uploadKey: p.uploadKey } : null;
  } catch {
    return null;
  }
}

/** A new attachment the composer asks for. */
export type AttachRef = { kind: "upload"; blobPath: string; name: string; mime?: string } | { kind: "document"; documentId: string };

/** What the composer sends on save / send: which of the draft's files stay (by key) and what's added. */
export type ComposeAttachments = { keep: string[]; add: AttachRef[] };

type Keyable = { blobPath?: string; documentId?: string; pdfPath?: string; name?: string };

/** A stable key for an attachment already on a draft — the composer keeps or drops files by it. */
export function attachKey(a: Keyable, index: number): string {
  if (a.blobPath) return `blob:${a.blobPath}`;
  if (a.documentId) return `doc:${a.documentId}`;
  if (a.pdfPath) return `pdf:${a.pdfPath}`;
  return `old:${index}:${a.name || ""}`;
}

/** A browser-sent `{ keep, add }`, shape-checked (contents are re-checked on the server). Null = not sent (keep everything). */
export function parseComposeAttachments(raw: unknown): ComposeAttachments | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { keep?: unknown; add?: unknown };
  const keep = Array.isArray(r.keep) ? r.keep.filter((k): k is string => typeof k === "string" && k.length <= 600).slice(0, 50) : [];
  const add: AttachRef[] = [];
  for (const x of Array.isArray(r.add) ? r.add.slice(0, 50) : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (o.kind === "upload" && typeof o.blobPath === "string" && typeof o.name === "string") {
      add.push({ kind: "upload", blobPath: o.blobPath, name: o.name, ...(typeof o.mime === "string" ? { mime: o.mime } : {}) });
    } else if (o.kind === "document" && typeof o.documentId === "string" && /^DOC-\d{1,9}$/.test(o.documentId)) {
      add.push({ kind: "document", documentId: o.documentId });
    }
  }
  return { keep, add };
}

/** Browser / pre-upload check of one file: refusal text or null (the server re-checks the bytes after). */
export function mailAttachNameError(name: string, size: number): string | null {
  const shown = displayFileName(name);
  if (!(size > 0)) return `${shown} is empty.`;
  if (size > MAIL_ATTACH_MAX_BYTES) return `${shown}: ${MAIL_ATTACH_TOO_LARGE}`;
  const ext = blockedExtension(shown);
  return ext ? `${shown} is a program or script (.${ext}) — those can't be attached.` : null;
}

/** Refusal text when the list is over the caps, else null. */
export function attachLimitError(list: ReadonlyArray<{ size?: number }>): string | null {
  if (list.length > MAIL_ATTACH_MAX_FILES) return `At most ${MAIL_ATTACH_MAX_FILES} attachments on one email.`;
  const total = list.reduce((s, a) => s + Math.max(0, Number(a.size) || 0), 0);
  return total > MAIL_ATTACH_MAX_BYTES ? MAIL_ATTACH_TOO_LARGE : null;
}

/** May a document be attached to an email for this company / project? (its own company's files, or the project's) */
export function documentFitsEmail(
  doc: { customerId: string; projectId?: string | null },
  ctx: { customerId?: string | null; projectId?: string | null },
): boolean {
  if (ctx.projectId && doc.projectId === ctx.projectId) return true;
  return !!ctx.customerId && doc.customerId === ctx.customerId;
}
