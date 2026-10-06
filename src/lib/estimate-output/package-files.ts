import { cleanText, displayFileName, formatBytes, isUploadKey, safeFileName } from "@/lib/document-files";
import { sniffDocumentType, sniffImageType } from "@/lib/part-docs/files";

/**
 * #301 slice C (D-j, R13) — the drawings an estimate package shows under
 * "Plans & risers": uploads (PDF / PNG / JPEG / WebP ≤ 25 MB, magic-byte
 * checked, private Blob, direct from the browser like the documents
 * collection) and the linked Grid design's drawing set. Pure and
 * client-safe. `Quote.packageFiles` is store-owned (addPackageFile /
 * removePackageFile); every reader goes through cleanPackageFiles. The
 * client page never sees a record — only `/share/.../file/<id>` links.
 */

export type PackageFileKind = "plan" | "riser" | "drawing";
export type PackageFileSource = "upload" | "grid";
export const PACKAGE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type PackageFileType = (typeof PACKAGE_FILE_TYPES)[number];

export type PackageFile = {
  id: string;
  kind: PackageFileKind;
  name: string;
  /** Private Blob pathname — server-only, never sent to a client page. */
  blobPath: string;
  contentType: PackageFileType;
  size: number;
  source: PackageFileSource;
  addedAt: number;
  addedBy: string;
};

/** Upload select order: Drawing set first (it replaces a Grid set — Slice C adaptation 5). */
export const PACKAGE_FILE_KINDS: readonly PackageFileKind[] = ["drawing", "plan", "riser"];
export const PACKAGE_FILE_KIND_LABEL: Record<PackageFileKind, string> = { drawing: "Drawing set", plan: "Plan", riser: "Riser" };
export const MAX_PACKAGE_FILES = 12;
export const MAX_PACKAGE_FILE_BYTES = 25 * 1024 * 1024;
export const PACKAGE_FILE_SNIFF_BYTES = 1024;
export const PACKAGE_FILE_PREFIX = "estimate-files/";
export const PACKAGE_FILE_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp";

export const PACKAGE_FILES_COPY = {
  wrongType: "Drawings must be PDF, PNG, JPEG or WebP files.",
  tooBig: "That file is over 25 MB.",
  empty: "That file is empty.",
  full: `An estimate holds at most ${MAX_PACKAGE_FILES} drawings — remove one first.`,
  notThisQuote: "That upload does not belong to this quote.",
  alreadySaved: "That file is already saved.",
  noStorage: "File storage isn’t configured on this server.",
  noArrival: "The upload didn’t arrive — try again.",
  unreadable: "Couldn’t read the uploaded file — try again.",
  gone: "That drawing is already gone.",
  failed: "Couldn’t save the drawing — try again.",
} as const;

const EXT: Record<PackageFileType, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ID_RE = /^PF-[0-9a-f]{12}$/;

export function isPackageFileId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

export function isPackageFileKind(v: unknown): v is PackageFileKind {
  return v === "plan" || v === "riser" || v === "drawing";
}

/** `PF-` + 12 lowercase hex (Web Crypto — works in Node and the browser). */
export function newPackageFileId(): string {
  return "PF-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** One path segment for a quote id (ids are `Q-####` today; anything odd folds to `_`). */
export function quotePathSegment(quoteId: string): string {
  return String(quoteId ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) || "_";
}

export function packageFileUploadPrefix(quoteId: string, uploadKey: string): string {
  return `${PACKAGE_FILE_PREFIX}${quotePathSegment(quoteId)}/${uploadKey}/`;
}

/** `estimate-files/<quote>/<uploadKey>/<safe name>` — Blob appends a random suffix. */
export function packageFileBlobPath(quoteId: string, uploadKey: string, fileName: string): string {
  return packageFileUploadPrefix(quoteId, uploadKey) + safeFileName(fileName);
}

/** Does a CLIENT-SUPPLIED pathname sit directly under this quote's upload key? */
export function packageFilePathInScope(pathname: unknown, quoteId: string, uploadKey: string): pathname is string {
  if (typeof pathname !== "string" || !quoteId || !isUploadKey(uploadKey)) return false;
  const prefix = packageFileUploadPrefix(quoteId, uploadKey);
  if (!pathname.startsWith(prefix) || pathname.includes("..")) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && rest.length <= 200 && /^[A-Za-z0-9._-]+$/.test(rest);
}

/** The Grid-generated set's pathname (putBlob adds a random suffix). */
export function gridSetBlobPath(quoteId: string): string {
  return `${PACKAGE_FILE_PREFIX}${quotePathSegment(quoteId)}/grid/drawing-set.pdf`;
}

/** What the bytes really are — the four accepted types, else null (SVG,
 *  HTML, programs and anything unknown are refused). */
export function sniffPackageFile(bytes: Uint8Array): PackageFileType | null {
  const img = sniffImageType(bytes);
  if (img) return img;
  return sniffDocumentType(bytes) === "pdf" ? "application/pdf" : null;
}

/** The user's file name with an extension that matches the bytes. */
export function packageFileName(raw: unknown, type: PackageFileType): string {
  const name = displayFileName(raw);
  const ext = EXT[type];
  const matches = type === "image/jpeg" ? /\.jpe?g$/i.test(name) : new RegExp(`\\.${ext}$`, "i").test(name);
  return matches ? name : `${name.replace(/\.(pdf|png|jpe?g|webp)$/i, "")}.${ext}`;
}

function fileOf(v: unknown): PackageFile | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isPackageFileId(o.id) || !isPackageFileKind(o.kind)) return null;
  if (typeof o.blobPath !== "string" || !o.blobPath.startsWith(PACKAGE_FILE_PREFIX) || o.blobPath.includes("..")) return null;
  if (!(PACKAGE_FILE_TYPES as readonly string[]).includes(o.contentType as string)) return null;
  if (o.source !== "upload" && o.source !== "grid") return null;
  const size = Number(o.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PACKAGE_FILE_BYTES) return null;
  const addedAt = Number(o.addedAt);
  return {
    id: o.id,
    kind: o.kind,
    name: cleanText(o.name, 180) || "file",
    blobPath: o.blobPath,
    contentType: o.contentType as PackageFileType,
    size,
    source: o.source,
    addedAt: Number.isFinite(addedAt) ? addedAt : 0,
    addedBy: cleanText(o.addedBy, 120),
  };
}

/** Every read of a stored list: junk rows and duplicate ids dropped, at most 12. */
export function cleanPackageFiles(raw: unknown): PackageFile[] {
  if (!Array.isArray(raw)) return [];
  const out: PackageFile[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const file = fileOf(v);
    if (!file || seen.has(file.id)) continue;
    seen.add(file.id);
    out.push(file);
    if (out.length >= MAX_PACKAGE_FILES) break;
  }
  return out;
}

/** The list with `file` appended, or null (full, or the id is already there). */
export function appendPackageFile(list: unknown, file: PackageFile): PackageFile[] | null {
  const cur = cleanPackageFiles(list);
  if (cur.length >= MAX_PACKAGE_FILES || cur.some((f) => f.id === file.id)) return null;
  return [...cur, file];
}

/** Decision 9 / D-j: an uploaded file of a kind hides Grid files of that kind. */
export function visiblePackageFiles(files: readonly PackageFile[]): PackageFile[] {
  const uploaded = new Set(files.filter((f) => f.source === "upload").map((f) => f.kind));
  return files.filter((f) => f.source === "upload" || !uploaded.has(f.kind));
}

type RefSource = { packageFiles?: unknown; revisions?: Array<{ docFields?: { packageFiles?: unknown } | null } | null> | null };

/** Still listed anywhere — the quote's own list or any revision's frozen one
 *  (a superseded link keeps showing what it was sent). */
export function packageBlobReferenced(q: RefSource, blobPath: string): boolean {
  if (cleanPackageFiles(q.packageFiles).some((f) => f.blobPath === blobPath)) return true;
  return (q.revisions || []).some((r) => cleanPackageFiles(r?.docFields?.packageFiles).some((f) => f.blobPath === blobPath));
}

export type PackageFileRow = {
  id: string;
  kind: PackageFileKind;
  kindLabel: string;
  name: string;
  sizeLabel: string;
  source: PackageFileSource;
  sourceLabel: string;
  /** True for a Grid file an upload of the same kind hides from the client. */
  hidden: boolean;
};

/** The staff Drawings list — never a blob path. */
export function packageFileRows(files: readonly PackageFile[]): PackageFileRow[] {
  const shown = new Set(visiblePackageFiles(files).map((f) => f.id));
  return files.map((f) => ({
    id: f.id,
    kind: f.kind,
    kindLabel: PACKAGE_FILE_KIND_LABEL[f.kind],
    name: f.name,
    sizeLabel: formatBytes(f.size),
    source: f.source,
    sourceLabel: f.source === "grid" ? "From the Grid" : "Uploaded",
    hidden: !shown.has(f.id),
  }));
}
