// SERVER ONLY — pdf-lib. Never import from a "use client" file.
/* #348 slice 5 — Read the PDF: how many pages a vendor's PDF has, before it is sent (the 100-page refusal). */
import { PDFDocument } from "pdf-lib";

/**
 * pdf-lib (ignoreEncryption, updateMetadata false) → getPageCount(); on a load/count throw — or a lenient load
 * that finds no pages — pageCountFromText on the latin1 bytes; null when neither knows (the API then decides).
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const n = doc.getPageCount();
    if (n > 0) return n;
  } catch {
    /* damaged / unusual file — fall through to the text scan */
  }
  return pageCountFromText(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1"));
}

const OBJ_RE = /\bobj\b([\s\S]*?)\bendobj\b/g;
const PAGES_RE = /\/Type\s*\/Pages(?![A-Za-z0-9])/;
const COUNT_RE = /\/Count\s+(\d+)/;
const PAGE_RE = /\/Type\s*\/Page(?![A-Za-z0-9])/g;

/** max(/Type /Pages … /Count N) over the file's objects if any, else the number of /Type /Page (not /Pages)
 *  objects; null when 0. Objects inside compressed object streams are invisible here (→ the API decides). */
export function pageCountFromText(s: string): number | null {
  let max = 0;
  for (const m of s.matchAll(OBJ_RE)) {
    const body = m[1];
    if (!PAGES_RE.test(body)) continue;
    const c = COUNT_RE.exec(body);
    if (c) max = Math.max(max, Number(c[1]));
  }
  if (max > 0 && Number.isFinite(max)) return max;
  const pages = (s.match(PAGE_RE) || []).length;
  return pages > 0 ? pages : null;
}
