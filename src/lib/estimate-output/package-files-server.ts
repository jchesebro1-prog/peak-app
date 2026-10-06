import { createHash } from "node:crypto";
import { blobEnabled, deleteBlob, getBlobHead, getBlobStream, putBlob } from "@/lib/blob";
import { GRID_SET_COPY, GRID_SET_DEADLINE_MS, GRID_SET_FAIL_IF, GRID_SET_STEP_MS, GRID_SET_WAIT_FOR, gridSetFileName, gridSetId, gridSetPrintUrl } from "@/lib/design/grid-set-print";
import { cleanText, displayFileName, isUploadKey } from "@/lib/document-files";
import { PdfRenderUnavailable, PrintFigureFailed, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { gridProjectForQuote, type GridProject } from "@/lib/stores/grid-projects";
import { addPackageFile, get as getQuote, removePackageFile, type QuoteRevision } from "@/lib/stores/quotes";
import {
  cleanPackageFiles, gridSetBlobPath, isPackageFileId, isPackageFileKind, MAX_PACKAGE_FILE_BYTES, MAX_PACKAGE_FILES, newPackageFileId, PACKAGE_FILE_SNIFF_BYTES, PACKAGE_FILE_TYPES, PACKAGE_FILES_COPY,
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

type GridDeps = {
  secret: string;
  blobOn: boolean;
  now: () => number;
  newId: () => string;
  find: (quoteId: string) => Promise<{ project: GridProject; optionId: string } | null>;
  render: (url: string, opts: { timeoutMs?: number; waitFor?: string; failIf?: string; signal?: AbortSignal }) => Promise<Buffer>;
  signal: (ms: number) => AbortSignal;
  put: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ url: string; pathname: string }>;
  remove: (pathname: string) => Promise<void>;
};

/**
 * #301 slice C (D-j, R8) — "Generate from Grid": render the linked design's
 * drawing set (cover, plans, riser, schedules at 11×17) through the signed
 * print route to ONE PDF (adaptation 5) and store it as a `drawing`, source
 * `grid`. An earlier Grid set is replaced. The token is signed right before
 * the render (120 s life). `origin` is the request's own (printOriginFor).
 */
export async function generateGridDrawingSet(quoteId: string, by: string, origin: string, deps: Partial<GridDeps> = {}): Promise<Result<{ file: PackageFile }>> {
  const d: GridDeps = {
    secret: process.env.AUTH_SECRET || "",
    blobOn: blobEnabled(),
    now: Date.now,
    newId: newPackageFileId,
    find: gridProjectForQuote,
    render: renderPrintRouteToPdf,
    signal: (ms) => AbortSignal.timeout(ms),
    put: putBlob,
    remove: deleteBlob,
    ...deps,
  };
  if (!d.secret) return { ok: false, error: GRID_SET_COPY.noSecret };
  if (!d.blobOn) return { ok: false, error: PACKAGE_FILES_COPY.noStorage };
  const q = await getQuote(String(quoteId || ""));
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: ONLINE_COPY.gone };
  const hit = await d.find(q.id);
  if (!hit) return { ok: false, error: GRID_SET_COPY.noGrid };
  const current = cleanPackageFiles(q.packageFiles);
  const old = current.filter((f) => f.source === "grid");
  // The new record is added BEFORE the old Grid set goes, so a full list refuses up front (nothing rendered, the old set kept).
  if (current.length >= MAX_PACKAGE_FILES) return { ok: false, error: PACKAGE_FILES_COPY.full };
  const setId = gridSetId(hit.project.id, hit.optionId);
  let pdf: Buffer;
  try {
    const t = signPrintToken(d.secret, "grid-set", setId, d.now());
    // Dev compiles /print on first hit (renderPrintRouteToPdf's own 90 s default); production keeps the 25 s steps.
    const dev = process.env.NODE_ENV === "development";
    pdf = await d.render(gridSetPrintUrl(origin, setId, t), {
      timeoutMs: dev ? undefined : GRID_SET_STEP_MS,
      waitFor: GRID_SET_WAIT_FOR,
      failIf: GRID_SET_FAIL_IF,
      // Bounds the queue wait too (a render queued behind others can't outrun the step budget).
      signal: d.signal(dev ? 360_000 : GRID_SET_DEADLINE_MS),
    });
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, error: e.message };
    console.error("[package] grid drawing set render failed", e);
    return { ok: false, error: e instanceof PrintFigureFailed ? GRID_SET_COPY.figureFailed : GRID_SET_COPY.renderFailed };
  }
  if (pdf.length > MAX_PACKAGE_FILE_BYTES) return { ok: false, error: GRID_SET_COPY.tooBig };
  let stored: { url: string; pathname: string };
  try {
    stored = await d.put(gridSetBlobPath(q.id), pdf, "application/pdf");
  } catch (e) {
    console.error("[package] grid drawing set store failed", e);
    return { ok: false, error: GRID_SET_COPY.storeFailed };
  }
  const file: PackageFile = {
    id: d.newId(),
    kind: "drawing",
    name: gridSetFileName(hit.project.name),
    blobPath: stored.pathname,
    contentType: "application/pdf",
    size: pdf.length,
    source: "grid",
    addedAt: d.now(),
    addedBy: cleanText(by, 120),
  };
  let res: Awaited<ReturnType<typeof addPackageFile>>;
  try {
    res = await addPackageFile(q.id, file);
  } catch (e) {
    console.error("[package] grid drawing set record failed", e);
    res = { ok: false, reason: "gone" };
  }
  if (!res.ok) {
    // Only the NEW blob goes; the earlier Grid set (record and blob) is untouched.
    try {
      await d.remove(stored.pathname);
    } catch {
      /* best effort */
    }
    return { ok: false, error: res.reason === "full" ? PACKAGE_FILES_COPY.full : ONLINE_COPY.gone };
  }
  // Only now do the older Grid records go (a blob a revision still lists is kept).
  for (const f of old) await removePackageFileAndBlob(q.id, f.id, { remove: d.remove });
  return { ok: true, file };
}
