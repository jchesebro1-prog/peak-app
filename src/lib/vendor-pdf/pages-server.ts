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

const PAGES_RE = /\/Type\s*\/Pages(?![A-Za-z0-9])/;
const COUNT_RE = /\/Count\s+(\d+)/;
const PAGE_RE = /\/Type\s*\/Page(?![A-Za-z0-9])/g;

const isWordChar = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
/** The next `word` at or after `from` that stands alone (\b on both sides, as a regex would), or -1. */
function nextWord(s: string, word: string, from: number): number {
  for (let i = s.indexOf(word, from); i !== -1; i = s.indexOf(word, i + 1)) {
    const before = i === 0 ? false : isWordChar(s.charCodeAt(i - 1));
    const after = i + word.length < s.length && isWordChar(s.charCodeAt(i + word.length));
    if (!before && !after) return i;
  }
  return -1;
}

/** max(/Type /Pages … /Count N) over the file's objects if any, else the number of /Type /Page (not /Pages)
 *  objects; null when 0. Objects inside compressed object streams are invisible here (→ the API decides).
 *  Linear in the file: each object body runs from a standalone `obj` to the next standalone `endobj`, and the
 *  scan resumes after it — a hostile file of `obj` tokens with no `endobj` costs one pass, not one per token. */
export function pageCountFromText(s: string): number | null {
  let max = 0;
  for (let pos = 0; ; ) {
    const start = nextWord(s, "obj", pos);
    if (start === -1) break;
    const end = nextWord(s, "endobj", start + 3);
    if (end === -1) break;
    const body = s.slice(start + 3, end);
    pos = end + 6;
    if (!PAGES_RE.test(body)) continue;
    const c = COUNT_RE.exec(body);
    if (c) max = Math.max(max, Number(c[1]));
  }
  if (max > 0 && Number.isFinite(max)) return max;
  const pages = (s.match(PAGE_RE) || []).length;
  return pages > 0 ? pages : null;
}
