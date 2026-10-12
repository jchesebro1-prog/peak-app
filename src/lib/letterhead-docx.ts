import { ImageRun, Paragraph, TextRun, type IRunOptions } from "docx";
import { letterheadBoxPx, type Letterhead } from "@/lib/letterhead";

/**
 * Grid notes #9 — the letterhead as one Word paragraph, for a document's
 * FIRST-PAGE header (`titlePage` + `headers.first`): the letterhead image
 * sized like the letters print it, or the company name set bold when there
 * is no image. Server-only (docx is a Node builder).
 */
/** Characters XML 1.0 can't carry (as spec-docx's xmlSafe — not imported, to keep this module cycle-free). */
const clean = (t: string) => String(t ?? "").replace(/\x0B/g, " ").replace(/[\x00-\x08\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");

export function letterheadParagraph(lh: Letterhead, font?: IRunOptions["font"]): Paragraph {
  if (!lh.image) {
    return new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: clean(lh.companyName), bold: true, size: 32, ...(font ? { font } : {}) })],
    });
  }
  const box = letterheadBoxPx(lh.image);
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new ImageRun({
        ...(lh.image.png ? { type: "png" as const, data: lh.image.png } : { type: "jpg" as const, data: lh.image.jpeg }),
        transformation: box,
        altText: { name: "Letterhead", title: clean(lh.companyName), description: `${clean(lh.companyName)} letterhead` },
      }),
    ],
  });
}
