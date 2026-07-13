import { deflateSync } from "node:zlib";

/**
 * Minimal PDF letter renderer — zero dependencies, same rationale as the
 * fetch-only Gmail bridge (D36) and Anthropic client (D39): this machine has
 * no toolchain for native deps and the dependency surface stays tiny. We only
 * need one document shape — the one-page(ish) proposal letter that
 * /flame-tests/letter and /inspections/letter print — so this is a tailored
 * letter compositor over a hand-rolled PDF 1.4 writer, not a general library.
 *
 * Capabilities (all the letter needs, nothing more):
 * - US Letter pages, auto page-break, Helvetica / Helvetica-Bold (WinAnsi)
 * - wrapped paragraphs, label/value meta lines, bullet lists
 * - the grey NFPA-style quote panel (rect + left border)
 * - a JPEG letterhead image (DCTDecode pass-through — no decode needed);
 *   PNG logos are NOT embeddable without a decoder, callers fall back to the
 *   typographic letterhead (same fallback the on-screen documents use, D59)
 * - deflate-compressed content streams (node:zlib)
 */

/* ---------------- font metrics (standard 14 AFM widths, per-mille) -------- */

// prettier-ignore
const HELV: number[] = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278, // 32-47
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556, // 48-63
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778, // 64-79
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556, // 80-95
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556, // 96-111
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,      // 112-126
];
// prettier-ignore
const HELV_BOLD: number[] = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,
];

/** Common CP1252 punctuation the app copy uses (byte → approx width). */
const HIGH_WIDTHS: Record<number, number> = {
  0x85: 1000, // …
  0x91: 222, // ‘
  0x92: 222, // ’
  0x93: 333, // “
  0x94: 333, // ”
  0x95: 350, // •
  0x96: 556, // –
  0x97: 1000, // —
  0xa7: 556, // §
  0xb0: 400, // °
  0xb7: 278, // ·
};

/** Unicode → CP1252 byte for the punctuation WinAnsi actually has. */
const CP1252: Record<number, number> = {
  0x2026: 0x85, // …
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
};

/** Text → WinAnsi bytes as a latin1 string (unknown chars become '?'). */
function winAnsi(s: string): string {
  let out = "";
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0) || 63;
    if (c === 0x0a || c === 0x0d) continue; // callers split lines themselves
    if (c < 256) out += String.fromCharCode(c);
    else if (CP1252[c] != null) out += String.fromCharCode(CP1252[c]);
    else out += "?";
  }
  return out;
}

/** Escape a winAnsi string for a PDF literal string. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Width of a winAnsi string in points at the given size. */
function measure(s: string, size: number, bold: boolean): number {
  const table = bold ? HELV_BOLD : HELV;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 && c <= 126) w += table[c - 32];
    else w += HIGH_WIDTHS[c] ?? 556;
  }
  return (w / 1000) * size;
}

/** Greedy word wrap on winAnsi text; keeps words whole where possible. */
function wrap(s: string, size: number, bold: boolean, maxW: number): string[] {
  const words = s.split(/ +/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const cand = cur ? cur + " " + word : word;
    if (measure(cand, size, bold) <= maxW || !cur) cur = cand;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/* ---------------- colors --------------------------------------------------- */

function rgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0x16181d;
  const f = (x: number) => (x / 255).toFixed(3);
  return `${f((n >> 16) & 255)} ${f((n >> 8) & 255)} ${f(n & 255)}`;
}

/* ---------------- JPEG probe ----------------------------------------------- */

type JpegInfo = { w: number; h: number; components: number };

/** Read dimensions from a JPEG's SOF marker (null when not a JPEG). */
export function jpegInfo(buf: Buffer): JpegInfo | null {
  if (!buf || buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        h: buf.readUInt16BE(i + 5),
        w: buf.readUInt16BE(i + 7),
        components: buf[i + 9],
      };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/* ---------------- page geometry -------------------------------------------- */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_L = 72;
const MARGIN_R = 72;
const MARGIN_T = 64;
const MARGIN_B = 72;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

const INK = "#1a1c20";
const SOFT_INK = "#40454e";
const LABEL_INK = "#6b7079";

/* ---------------- the letter document shape -------------------------------- */

export type LetterBlock =
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "bullets"; heading: string; items: string[] };

export type LetterDoc = {
  companyName: string;
  /** Brand accent for the tag line under the letterhead rule. */
  accent: string;
  /** JPEG letterhead bytes; null → typographic letterhead (company name). */
  headerJpeg?: Buffer | null;
  /** true → span content width (baked letterhead); false → logo-sized. */
  headerFull?: boolean;
  /** e.g. "Flame Test Proposal" (+ optional grey note after it). */
  tag: string;
  tagNote?: string;
  meta: Array<{ label: string; value: string; strong?: boolean }>;
  re: string;
  /** Greeting name only — rendered as "Dear {greeting}," */
  greeting: string;
  blocks: LetterBlock[];
  /** Bold total line, e.g. "The above services will cost $1,234." */
  costLine: string;
  costTail: string;
  taxNote: string;
  signer: { name: string; title: string; email?: string };
};

/* ---------------- writer --------------------------------------------------- */

class Pdf {
  private objs: Array<Buffer | null> = [null]; // 1-indexed
  private pageIds: number[] = [];
  private ops: string[] = [];
  private extraResources = "";
  y = PAGE_H - MARGIN_T;

  alloc(): number {
    this.objs.push(null);
    return this.objs.length - 1;
  }

  set(id: number, body: string): void {
    this.objs[id] = Buffer.from(body, "latin1");
  }

  setStream(id: number, dict: string, data: Buffer): void {
    const head = Buffer.from(
      `<< ${dict} /Length ${data.length} >>\nstream\n`,
      "latin1"
    );
    const tail = Buffer.from("\nendstream", "latin1");
    this.objs[id] = Buffer.concat([head, data, tail]);
  }

  /** Register a JPEG as an image XObject; returns its resource name. */
  addJpeg(buf: Buffer, info: JpegInfo): string {
    const id = this.alloc();
    const cs =
      info.components === 1
        ? "/DeviceGray"
        : info.components === 4
          ? "/DeviceCMYK"
          : "/DeviceRGB";
    const decode =
      info.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
    this.setStream(
      id,
      `/Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} ` +
        `/ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${decode}`,
      buf
    );
    const name = `Im${id}`;
    this.extraResources += ` /${name} ${id} 0 R`;
    return name;
  }

  op(s: string): void {
    this.ops.push(s);
  }

  newPage(): void {
    this.flushPage();
    this.y = PAGE_H - MARGIN_T;
  }

  /** Break the page unless `h` points of vertical room remain. */
  ensure(h: number): void {
    if (this.y - h < MARGIN_B) this.newPage();
  }

  /** One text line at the cursor (no wrapping). */
  line(
    text: string,
    o: {
      size?: number;
      bold?: boolean;
      color?: string;
      x?: number;
      leading?: number;
      align?: "left" | "right";
    } = {}
  ): void {
    const size = o.size ?? 11.5;
    const leading = o.leading ?? size * 1.5;
    this.ensure(leading);
    const t = winAnsi(text);
    let x = o.x ?? MARGIN_L;
    if (o.align === "right")
      x = PAGE_W - MARGIN_R - measure(t, size, !!o.bold);
    this.y -= leading;
    this.op(
      `BT /${o.bold ? "F2" : "F1"} ${size} Tf ${rgb(o.color || INK)} rg ` +
        `1 0 0 1 ${x.toFixed(2)} ${this.y.toFixed(2)} Tm (${esc(t)}) Tj ET`
    );
  }

  /** Wrapped paragraph at the cursor. */
  para(
    text: string,
    o: {
      size?: number;
      bold?: boolean;
      color?: string;
      x?: number;
      width?: number;
      leadingMult?: number;
      after?: number;
    } = {}
  ): void {
    const size = o.size ?? 11.5;
    const x = o.x ?? MARGIN_L;
    const width = o.width ?? PAGE_W - MARGIN_R - x;
    const lines = wrap(winAnsi(text), size, !!o.bold, width);
    for (const l of lines)
      this.line(l, {
        size,
        bold: o.bold,
        color: o.color,
        x,
        leading: size * (o.leadingMult ?? 1.5),
      });
    if (o.after) this.y -= o.after;
  }

  space(pt: number): void {
    this.y -= pt;
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.op(`${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  hairline(y: number, color: string, weight = 2): void {
    this.rect(MARGIN_L, y, CONTENT_W, weight, color);
  }

  image(name: string, x: number, w: number, h: number): void {
    this.ensure(h);
    this.y -= h;
    this.op(
      `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${this.y.toFixed(2)} cm /${name} Do Q`
    );
  }

  private flushPage(): void {
    if (!this.ops.length) return;
    const contentId = this.alloc();
    this.setStream(
      contentId,
      "/Filter /FlateDecode",
      deflateSync(Buffer.from(this.ops.join("\n"), "latin1"))
    );
    const pageId = this.alloc();
    this.pageIds.push(pageId);
    this.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>` +
        (this.extraResources ? ` /XObject <<${this.extraResources} >>` : "") +
        ` >> /Contents ${contentId} 0 R >>`
    );
    this.ops = [];
  }

  build(): Buffer {
    this.flushPage();
    this.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
    this.set(
      2,
      `<< /Type /Pages /Kids [${this.pageIds.map((n) => `${n} 0 R`).join(" ")}] /Count ${this.pageIds.length} >>`
    );
    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    const offsets: number[] = [0];
    let pos = chunks[0].length;
    for (let i = 1; i < this.objs.length; i++) {
      offsets[i] = pos;
      const body = this.objs[i] || Buffer.from("null", "latin1");
      const head = Buffer.from(`${i} 0 obj\n`, "latin1");
      const tail = Buffer.from("\nendobj\n", "latin1");
      chunks.push(head, body, tail);
      pos += head.length + body.length + tail.length;
    }
    const xrefPos = pos;
    let xref = `xref\n0 ${this.objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objs.length; i++)
      xref += offsets[i].toString().padStart(10, "0") + " 00000 n \n";
    xref += `trailer\n<< /Size ${this.objs.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(chunks);
  }
}

/* ---------------- the letter compositor ------------------------------------ */

/** Render a proposal letter (the /flame-tests/letter · /inspections/letter
 *  layout) to PDF bytes. */
export function renderLetterPdf(doc: LetterDoc): Buffer {
  const pdf = new Pdf();
  // fixed ids: 1 catalog, 2 pages, 3+4 fonts
  pdf.alloc(); // 1
  pdf.alloc(); // 2
  pdf.alloc(); // 3
  pdf.alloc(); // 4
  pdf.set(
    3,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  );
  pdf.set(
    4,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  );

  /* letterhead */
  const jpeg = doc.headerJpeg || null;
  const info = jpeg ? jpegInfo(jpeg) : null;
  if (jpeg && info && info.w > 0 && info.h > 0) {
    const name = pdf.addJpeg(jpeg, info);
    if (doc.headerFull) {
      const h = (CONTENT_W * info.h) / info.w;
      pdf.image(name, MARGIN_L, CONTENT_W, Math.min(h, 160));
    } else {
      // uploaded logo — cap like the on-screen maxHeight:76px
      const h = Math.min(56, info.h);
      const w = Math.min((h * info.w) / info.h, CONTENT_W);
      pdf.image(name, MARGIN_L, w, h);
    }
  } else {
    pdf.space(6);
    pdf.line(doc.companyName, { size: 21, bold: true });
  }
  // rule + right-aligned tag (borderTop 2px #16181d, accent uppercase tag)
  pdf.space(9);
  pdf.ensure(24);
  pdf.hairline(pdf.y, "#16181d", 1.6);
  pdf.space(7);
  const tag = winAnsi(doc.tag.toUpperCase());
  const note = doc.tagNote ? winAnsi(" " + doc.tagNote.toUpperCase()) : "";
  const tagW = measure(tag, 9, true) + (note ? measure(note, 8.5, false) : 0);
  const tagX = PAGE_W - MARGIN_R - tagW;
  pdf.y -= 9;
  pdf.op(
    `BT /F2 9 Tf ${rgb(doc.accent)} rg 1 0 0 1 ${tagX.toFixed(2)} ${pdf.y.toFixed(2)} Tm (${esc(tag)}) Tj ET`
  );
  if (note)
    pdf.op(
      `BT /F1 8.5 Tf ${rgb("#aab0bb")} rg 1 0 0 1 ${(tagX + measure(tag, 9, true)).toFixed(2)} ${pdf.y.toFixed(2)} Tm (${esc(note)}) Tj ET`
    );
  pdf.space(20);

  /* meta lines (Date / Venue Name / Location) */
  for (const m of doc.meta) {
    pdf.ensure(17);
    const label = winAnsi(m.label + " ");
    pdf.y -= 17;
    pdf.op(
      `BT /F1 11.5 Tf ${rgb(LABEL_INK)} rg 1 0 0 1 ${MARGIN_L} ${pdf.y.toFixed(2)} Tm (${esc(label)}) Tj ET`
    );
    const vx = MARGIN_L + measure(label, 11.5, false);
    pdf.op(
      `BT /${m.strong ? "F2" : "F1"} 11.5 Tf ${rgb(INK)} rg 1 0 0 1 ${vx.toFixed(2)} ${pdf.y.toFixed(2)} Tm (${esc(winAnsi(m.value))}) Tj ET`
    );
  }
  pdf.space(14);

  /* RE + greeting */
  pdf.ensure(17);
  {
    const label = winAnsi("RE: ");
    pdf.y -= 17;
    pdf.op(
      `BT /F1 11.5 Tf ${rgb(LABEL_INK)} rg 1 0 0 1 ${MARGIN_L} ${pdf.y.toFixed(2)} Tm (${esc(label)}) Tj ET`
    );
    pdf.op(
      `BT /F1 11.5 Tf ${rgb(INK)} rg 1 0 0 1 ${(MARGIN_L + measure(label, 11.5, false)).toFixed(2)} ${pdf.y.toFixed(2)} Tm (${esc(winAnsi(doc.re))}) Tj ET`
    );
  }
  pdf.line(`Dear ${doc.greeting},`, { leading: 20 });
  pdf.space(10);

  /* body blocks */
  for (const b of doc.blocks) {
    if (b.kind === "p") {
      pdf.para(b.text, { after: 10 });
    } else if (b.kind === "quote") {
      const size = 10;
      const inset = 14;
      const pad = 10;
      const textW = CONTENT_W - inset - 12;
      const lines = wrap(winAnsi(b.text), size, false, textW);
      const boxH = lines.length * size * 1.5 + pad * 2 - 4;
      pdf.ensure(boxH + 12);
      pdf.rect(MARGIN_L, pdf.y - boxH, CONTENT_W, boxH, "#f6f7f9");
      pdf.rect(MARGIN_L, pdf.y - boxH, 2.5, boxH, "#d6d9e0");
      pdf.space(pad - 4);
      for (const l of lines)
        pdf.line(l, { size, color: SOFT_INK, x: MARGIN_L + inset, leading: size * 1.5 });
      pdf.space(pad - 2);
      pdf.space(12);
    } else {
      pdf.line(b.heading.toUpperCase(), {
        size: 9,
        bold: true,
        color: LABEL_INK,
        leading: 16,
      });
      pdf.space(2);
      for (const item of b.items)
        pdf.para("•  " + item, { after: 1 });
      pdf.space(10);
    }
  }

  /* cost + tax notes */
  {
    // bold sentence + regular tail flowing on (approximate the inline <strong>)
    pdf.para(doc.costLine, { bold: true, after: 0 });
    if (doc.costTail) pdf.para(doc.costTail, { after: 4 });
    pdf.para(doc.taxNote, { size: 10, color: SOFT_INK, after: 14 });
  }

  /* closing + signature */
  pdf.para("If you have any questions please contact me directly at:", { after: 10 });
  pdf.ensure(52);
  pdf.line("—" + doc.signer.name, { bold: true, leading: 17 });
  pdf.line(doc.signer.title, { color: SOFT_INK, leading: 16 });
  if (doc.signer.email) pdf.line(doc.signer.email, { color: SOFT_INK, leading: 16 });

  return pdf.build();
}

/** Decode a data-URL to bytes (null when it isn't one / mime mismatch). */
export function dataUrlBytes(
  dataUrl: string | null | undefined,
  mimePrefix: string
): Buffer | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl || "");
  if (!m || !m[1].startsWith(mimePrefix)) return null;
  try {
    return m[2]
      ? Buffer.from(m[3], "base64")
      : Buffer.from(decodeURIComponent(m[3]), "utf8");
  } catch {
    return null;
  }
}
