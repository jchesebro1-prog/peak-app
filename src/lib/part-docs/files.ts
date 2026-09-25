import type { PartDocKind } from "./types";

/**
 * File-type rules for part documents (#DOC, spec §6). Pure — the upload
 * route, the attach actions and the fetcher all call `sniffDocumentType` on
 * the real bytes; the extension and the browser's MIME are never trusted.
 */

export type SniffedType = "pdf" | "doc" | "docx";

export const CONTENT_TYPES: Record<SniffedType, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** What each slot accepts: a datasheet is a PDF; a spec sheet is PDF or Word (§2.2). */
export const ALLOWED_TYPES: Record<PartDocKind, readonly SniffedType[]> = {
  datasheet: ["pdf"],
  specsheet: ["pdf", "doc", "docx"],
};

/** The `accept` attribute for a slot's file input. */
export function acceptFor(kind: PartDocKind): string {
  return kind === "datasheet" ? ".pdf,application/pdf" : ".pdf,.doc,.docx,application/pdf,application/msword," + CONTENT_TYPES.docx;
}

/** Every content type the upload token may be issued for (the bytes are checked after). */
export const UPLOAD_CONTENT_TYPES: readonly string[] = [...Object.values(CONTENT_TYPES), "application/octet-stream"];

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

function indexOfAscii(bytes: Uint8Array, text: string, limit: number): number {
  const codes = [...text].map((c) => c.charCodeAt(0));
  const end = Math.min(bytes.length, limit) - codes.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * What the bytes really are. PDF: `%PDF-` within the first 1,024 bytes (the
 * PDF spec allows leading junk there). DOC: the OLE2 compound-file magic.
 * DOCX: a ZIP whose entry names include BOTH `[Content_Types].xml` (every
 * OOXML package — .docx, .xlsx, .pptx — lists this at the archive root)
 * AND `word/` (only a Word part) in the first 64 KB. Requiring both closes
 * a gap where a ZIP that merely names a `word/` path somewhere (but isn't
 * an OOXML package at all) would otherwise sniff as a .docx; a plain ZIP
 * or an .xlsx (which has `[Content_Types].xml` but no `word/`) still fails.
 */
export function sniffDocumentType(bytes: Uint8Array): SniffedType | null {
  if (indexOfAscii(bytes, "%PDF-", 1024) >= 0) return "pdf";
  if (startsWith(bytes, OLE2)) return "doc";
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    indexOfAscii(bytes, "[Content_Types].xml", 64 * 1024) >= 0 &&
    indexOfAscii(bytes, "word/", 64 * 1024) >= 0
  ) {
    return "docx";
  }
  return null;
}

/** How many leading bytes sniffing needs. */
export const SNIFF_BYTES = 64 * 1024;

/** Refusal text for bytes a slot does not accept, or null when they fit. */
export function checkDocumentBytes(kind: PartDocKind, bytes: Uint8Array): { ok: true; type: SniffedType; contentType: string } | { ok: false; error: string } {
  const type = sniffDocumentType(bytes);
  if (!type) return { ok: false, error: kind === "datasheet" ? "That file is not a PDF." : "That file is not a PDF or Word document." };
  if (!ALLOWED_TYPES[kind].includes(type)) return { ok: false, error: "Datasheets must be PDF files." };
  return { ok: true, type, contentType: CONTENT_TYPES[type] };
}

export function contentTypeForFileName(fileName: string): string {
  const n = fileName.toLowerCase();
  if (n.endsWith(".docx")) return CONTENT_TYPES.docx;
  if (n.endsWith(".doc")) return CONTENT_TYPES.doc;
  return CONTENT_TYPES.pdf;
}

/** Make a file name end in the extension its bytes actually have. */
export function withExtension(fileName: string, type: SniffedType): string {
  const base = fileName.replace(/\.(pdf|docx?|aspx|php|html?)$/i, "");
  return `${base || "document"}.${type}`;
}

/** RFC 6266 inline disposition: an ASCII fallback plus the UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * The name to store a fetched file under: the server's Content-Disposition
 * name, else the URL's last path segment when it looks like a document, else
 * `fallback` (the document title). Always ends in the sniffed extension.
 */
export function fileNameForFetched(contentDisposition: string | null, url: string, fallback: string, type: SniffedType): string {
  let name = "";
  const cd = contentDisposition || "";
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      name = "";
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    if (plain) name = plain[1].trim();
  }
  if (!name) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
      if (/\.(pdf|docx?)$/i.test(last)) name = last;
    } catch {
      /* unparsable URL — fall through */
    }
  }
  name = (name || fallback || "document").split(/[\\/]/).pop()!.trim().slice(0, 180) || "document";
  return withExtension(name, type);
}
