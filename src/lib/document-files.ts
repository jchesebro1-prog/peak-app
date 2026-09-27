/**
 * Documents (#218) — file rules shared by the team and portal uploads.
 * Pure: no store, no `@/db`, no Node built-ins, so client components import
 * it freely. The browser's MIME type and the file's extension are only a
 * first filter; the finalize step (src/lib/documents-upload.ts) re-checks the
 * real bytes after the upload lands. Spec:
 * docs/superpowers/specs/2026-09-26-documents-design.md.
 */

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const MAX_DOCUMENT_LABEL = "100 MB";
/** Leading bytes the finalize step reads to spot a program or script. */
export const DOCUMENT_SNIFF_BYTES = 16;
/** Blob pathname prefix — every company document lives under it. */
export const DOCUMENT_BLOB_PREFIX = "documents/";

/** Programs and scripts — refused on every dot-separated segment of a name. */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "vbe", "js", "jse", "wsf", "wsh",
  "ps1", "psm1", "sh", "bash", "zsh", "app", "dmg", "pkg", "jar", "apk", "deb", "rpm",
  "dll", "so", "dylib",
]);

const MAGIC: ReadonlyArray<{ sig: readonly number[]; label: string }> = [
  { sig: [0x4d, 0x5a], label: "a Windows program" },
  { sig: [0x7f, 0x45, 0x4c, 0x46], label: "a Linux program" },
  { sig: [0xfe, 0xed, 0xfa, 0xce], label: "a Mac program" },
  { sig: [0xfe, 0xed, 0xfa, 0xcf], label: "a Mac program" },
  { sig: [0xce, 0xfa, 0xed, 0xfe], label: "a Mac program" },
  { sig: [0xcf, 0xfa, 0xed, 0xfe], label: "a Mac program" },
  { sig: [0xca, 0xfe, 0xba, 0xbe], label: "a Mac or Java program" },
  { sig: [0x23, 0x21], label: "a script" },
];

/** Drops C0 controls, DEL and lone surrogates (a lone surrogate would make
 *  `encodeURIComponent` throw in the download header). `for…of` yields a
 *  valid surrogate pair as one code point, so emoji survive. */
function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 32 || c === 127 || (c >= 0xd800 && c <= 0xdfff)) continue;
    out += ch;
  }
  return out;
}

/** Trims any of `chars` off the end — a loop, not `[…]+$`, which backtracks
 *  quadratically on a long run that isn't at the end. */
function trimEndChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

function trimStartChars(s: string, chars: string): string {
  let start = 0;
  while (start < s.length && chars.includes(s[start])) start++;
  return s.slice(start);
}

/** The last path segment of a name a browser (or a forged call) supplied. */
export function baseName(raw: unknown): string {
  const parts = String(raw ?? "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** The name we store and show: base name, no control characters (so it can
 *  never break a header), capped at 180. */
export function displayFileName(raw: unknown): string {
  return stripControl(baseName(raw)).trim().slice(0, 180) || "file";
}

/** A Blob pathname segment: letters, digits, `._-` only, no `..`, ≤ 80. */
export function safeFileName(raw: unknown): string {
  const folded = displayFileName(raw).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/\.{2,}/g, ".");
  return trimEndChars(trimStartChars(folded, "_."), "_").slice(0, 80) || "file";
}

/** Default title: the file name without its last extension. */
export function titleFromFileName(raw: unknown): string {
  const name = displayFileName(raw);
  return name.replace(/\.[^.\s]{1,10}$/, "").trim().slice(0, 200) || name;
}

/** The blocked extension this name carries, or null. Every dot-separated
 *  segment after the first counts, so `x.pdf.exe` and `x.exe.pdf` are both
 *  blocked; trailing dots and spaces are ignored the way Windows ignores them. */
export function blockedExtension(name: unknown): string | null {
  const base = trimEndChars(baseName(name), ". \t\r\n\f\v ");
  for (const seg of base.split(".").slice(1)) {
    const ext = seg.trim().toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) return ext;
  }
  return null;
}

/** Browser preflight (the server re-checks): refusal text or null. */
export function checkDocumentName(name: string, size: number): string | null {
  const shown = displayFileName(name);
  if (!(size > 0)) return `${shown} is empty.`;
  if (size > MAX_DOCUMENT_BYTES) return `${shown} is over ${MAX_DOCUMENT_LABEL}.`;
  const ext = blockedExtension(shown);
  if (ext) return `${shown} is a program or script (.${ext}) — those can't be uploaded.`;
  return null;
}

/** Refusal text when the leading bytes are a program or script, else null. */
export function checkDocumentBytes(bytes: Uint8Array): string | null {
  for (const m of MAGIC) {
    if (bytes.length < m.sig.length) continue;
    if (m.sig.every((v, i) => bytes[i] === v)) return `That file is ${m.label} — programs and scripts can't be uploaded.`;
  }
  return null;
}

/** `UP-` + 16 lowercase hex. Minted in the browser; keys the upload's path. */
export function newUploadKey(): string {
  return "UP-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function isUploadKey(v: unknown): v is string {
  return typeof v === "string" && /^UP-[0-9a-f]{16}$/.test(v);
}

/** One path segment for a company id (ids are slugs today; anything odd is
 *  folded to `_`). Access is by record, never by path, so a fold collision
 *  grants nothing. */
export function customerPathSegment(customerId: string): string {
  return String(customerId ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) || "_";
}

export function documentUploadPrefix(customerId: string, uploadKey: string): string {
  return `${DOCUMENT_BLOB_PREFIX}${customerPathSegment(customerId)}/${uploadKey}/`;
}

/** `documents/<customer>/<uploadKey>/<safe name>` — Blob appends a random suffix. */
export function documentBlobPath(customerId: string, uploadKey: string, fileName: string): string {
  return documentUploadPrefix(customerId, uploadKey) + safeFileName(fileName);
}

/** Does a CLIENT-SUPPLIED pathname sit directly under this company's upload
 *  key? Used by both token routes and by finalize — a client blobPath is
 *  untrusted input. */
export function blobPathInScope(pathname: unknown, customerId: string, uploadKey: string): pathname is string {
  if (typeof pathname !== "string" || !customerId || !isUploadKey(uploadKey)) return false;
  const prefix = documentUploadPrefix(customerId, uploadKey);
  if (!pathname.startsWith(prefix) || pathname.includes("..")) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && rest.length <= 200 && /^[A-Za-z0-9._-]+$/.test(rest);
}

/** Token-route refusal text, or null when the grant may be issued. */
export function uploadGrantError(pathname: string, customerId: string, uploadKey: string): string | null {
  return blobPathInScope(pathname, customerId, uploadKey)
    ? null
    : `pathname must be ${documentUploadPrefix(customerId, uploadKey)}<file>`;
}

/** The team token route's clientPayload: `{ customerId, uploadKey }`. */
export function parseUploadPayload(payload: string | null): { customerId: string; uploadKey: string } | null {
  try {
    const p = payload ? (JSON.parse(payload) as { customerId?: unknown; uploadKey?: unknown } | null) : null;
    if (!p || typeof p.customerId !== "string" || !p.customerId.trim() || p.customerId.length > 120) return null;
    if (!isUploadKey(p.uploadKey)) return null;
    return { customerId: p.customerId, uploadKey: p.uploadKey };
  } catch {
    return null;
  }
}

/** The portal token route reads only the upload key — the company comes
 *  from the portal session. */
export function parseUploadKey(payload: string | null): string | null {
  try {
    const p = payload ? (JSON.parse(payload) as { uploadKey?: unknown } | null) : null;
    return p && isUploadKey(p.uploadKey) ? p.uploadKey : null;
  } catch {
    return null;
  }
}

/** RFC 6266 attachment: an ASCII fallback plus the RFC 5987 UTF-8 name. */
export function attachmentDisposition(fileName: string): string {
  const name = displayFileName(fileName);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/** Every document download, team or portal: a file, never rendered. */
export function documentDownloadHeaders(fileName: string): Record<string, string> {
  return {
    "content-type": "application/octet-stream",
    "content-disposition": attachmentDisposition(fileName),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
