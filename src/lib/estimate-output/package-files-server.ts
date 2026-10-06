import { createHash } from "node:crypto";
import { deleteBlob, getBlobHead, getBlobStream } from "@/lib/blob";
import { cleanText, displayFileName, isUploadKey } from "@/lib/document-files";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { addPackageFile, get as getQuote, removePackageFile, type QuoteRevision } from "@/lib/stores/quotes";
import {
  cleanPackageFiles, isPackageFileId, isPackageFileKind, MAX_PACKAGE_FILE_BYTES, newPackageFileId, PACKAGE_FILE_SNIFF_BYTES, PACKAGE_FILE_TYPES, PACKAGE_FILES_COPY,
  packageBlobReferenced, packageFileName, packageFilePathInScope, sniffPackageFile, visiblePackageFiles, type PackageFile,
} from "./package-files";

/**
 * #301 slice C (D-j, R13) — the server half of an estimate's drawings.
 * finalize turns a browser upload into a PackageFile (the documents
 * collection's order: path scope → never a recorded blob → the head Blob
 * really holds → record); remove drops the record and the blob only when no
 * revision still lists it; the share route reads the PINNED revision's
 * frozen list (R12). Server-only. `deps` exists for the spec harness.
 */

type FileDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
  stream: (pathname: string) => Promise<ReadableStream | null>;
  now: () => number;
  newId: () => string;
};

const liveDeps: FileDeps = { head: getBlobHead, remove: deleteBlob, stream: (p) => getBlobStream(p), now: Date.now, newId: newPackageFileId };

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function finalizePackageFileUpload(quoteId: string, input: unknown, by: string, deps: Partial<FileDeps> = {}): Promise<Result<{ file: PackageFile }>> {
  const d: FileDeps = { ...liveDeps, ...deps };
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const q = await getQuote(String(quoteId || ""));
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: ONLINE_COPY.gone };
  const uploadKey = inp.uploadKey;
  if (!isUploadKey(uploadKey) || !packageFilePathInScope(inp.blobPath, q.id, uploadKey)) return { ok: false, error: PACKAGE_FILES_COPY.notThisQuote };
  const blobPath = inp.blobPath;
  // A path any list already holds may be someone's real file (a replay or a retry) — never touch it.
  if (packageBlobReferenced(q, blobPath)) return { ok: false, error: PACKAGE_FILES_COPY.alreadySaved };

  const refuse = async (error: string): Promise<Result<{ file: PackageFile }>> => {
    try {
      const cur = await getQuote(q.id);
      if (!cur || !packageBlobReferenced(cur, blobPath)) await d.remove(blobPath);
    } catch {
      /* best effort — the refusal stands either way */
    }
    return { ok: false, error };
  };

  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await d.head(blobPath, PACKAGE_FILE_SNIFF_BYTES);
  } catch {
    return { ok: false, error: PACKAGE_FILES_COPY.unreadable };
  }
  if (!head) return { ok: false, error: PACKAGE_FILES_COPY.noArrival };
  if (!(head.size > 0)) return refuse(PACKAGE_FILES_COPY.empty);
  if (head.size > MAX_PACKAGE_FILE_BYTES) return refuse(PACKAGE_FILES_COPY.tooBig);
  const type = sniffPackageFile(head.bytes);
  if (!type) return refuse(PACKAGE_FILES_COPY.wrongType);

  const file: PackageFile = {
    id: d.newId(),
    kind: isPackageFileKind(inp.kind) ? inp.kind : "drawing",
    name: packageFileName(inp.fileName, type),
    blobPath,
    contentType: type,
    size: head.size,
    source: "upload",
    addedAt: d.now(),
    addedBy: cleanText(by, 120),
  };
  const res = await addPackageFile(q.id, file);
  if (!res.ok) return refuse(res.reason === "full" ? PACKAGE_FILES_COPY.full : ONLINE_COPY.gone);
  return { ok: true, file };
}

export async function removePackageFileAndBlob(quoteId: string, fileId: string, deps: Partial<Pick<FileDeps, "remove">> = {}): Promise<Result<object>> {
  const remove = deps.remove ?? liveDeps.remove;
  if (!isPackageFileId(fileId)) return { ok: false, error: PACKAGE_FILES_COPY.gone };
  const res = await removePackageFile(String(quoteId || ""), fileId);
  if (!res.ok) return { ok: false, error: res.reason === "gone" ? ONLINE_COPY.gone : PACKAGE_FILES_COPY.gone };
  if (!packageBlobReferenced(res.quote, res.file.blobPath)) {
    try {
      await remove(res.file.blobPath);
    } catch (e) {
      console.warn("[package] drawing blob not deleted", e instanceof Error ? e.message : e);
    }
  }
  return { ok: true };
}

/** R12 — the pinned revision's frozen, VISIBLE files only (never the live list). */
export function packageFileForRevision(rev: Pick<QuoteRevision, "docFields">, fileId: string): PackageFile | null {
  if (!isPackageFileId(fileId)) return null;
  return visiblePackageFiles(cleanPackageFiles(rev.docFields?.packageFiles)).find((f) => f.id === fileId) ?? null;
}

const notFound = () => new Response("Not found", { status: 404 });
const FILE_CACHE = "private, max-age=3600";

/** `inline` with an ASCII fallback and an RFC 5987 name — control characters, quotes and bidi marks never reach a header. */
function inlineDisposition(name: string): string {
  const clean = displayFileName(name);
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const star = encodeURIComponent(clean).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `inline; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/**
 * Inline (PDF / image — the only types finalize records), served under the
 * STORED type only (one of the four allowed — anything else is a 404),
 * nosniff, a locked-down CSP, a private cache, an ETag on id + path and a
 * sanitized file name. A vendor error never reaches the browser.
 */
export async function servePackageFile(req: Request, file: PackageFile, deps: Partial<Pick<FileDeps, "stream">> = {}): Promise<Response> {
  if (!(PACKAGE_FILE_TYPES as readonly string[]).includes(file.contentType)) return notFound();
  const read = deps.stream ?? liveDeps.stream;
  const etag = `"${file.id}-${createHash("sha1").update(file.blobPath).digest("hex").slice(0, 16)}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": FILE_CACHE } });
  let stream: ReadableStream | null;
  try {
    stream = await read(file.blobPath);
  } catch {
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  return new Response(stream, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": inlineDisposition(file.name),
      "cache-control": FILE_CACHE,
      etag,
      "x-content-type-options": "nosniff",
      // Never script, frame or embed anything from a served drawing (a browser's own PDF/image viewer is unaffected).
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    },
  });
}
