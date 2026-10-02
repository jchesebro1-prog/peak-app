import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import type { AssembledSpec, RackSpecSection } from "@/lib/bid-spec";
import { pngSize } from "@/lib/rack/png-size";
import { xmlSafe } from "@/lib/specs/spec-docx";

/* ------------------------------------------------------------------ *
 * Real .docx generation (D94 upgrade, 2026-07-20).
 * Design: docs/superpowers/specs/2026-07-19-bid-spec-generator-design.md
 *
 * Replaces the shipping-day Word-openable HTML with a genuine OOXML
 * document: architects paste these sections into a project manual, and a
 * true .docx carries real styles and outline structure that survive that
 * paste. `AssembledSpec` was deliberately kept format-agnostic, so this is
 * an additive renderer — renderSpecHtml still backs the print/PDF view.
 *
 * Server-only: Packer runs in Node and the module is imported by a route
 * handler, never by a client component.
 * ------------------------------------------------------------------ */

/** Blank-line-separated blocks — how spec paragraphs are actually written. */
function points(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A numbered spec point: "2.01<tab>text", hanging-indented like a real
 *  project manual rather than relying on Word's list numbering (which
 *  renumbers unpredictably once pasted into someone else's document). */
function point(num: string, runs: TextRun[]): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.LEFT, position: 720 }],
    indent: { left: 720, hanging: 720 },
    spacing: { after: 120 },
    children: [new TextRun({ text: num, bold: true }), new TextRun({ text: "\t" }), ...runs],
  });
}

function sub(letter: string, text: string): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.LEFT, position: 1440 }],
    indent: { left: 1440, hanging: 720 },
    spacing: { after: 100 },
    children: [new TextRun({ text: `${letter}.` }), new TextRun({ text: "\t" }), new TextRun(text)],
  });
}

function partHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true })],
  });
}

/* ---------- #296 — Equipment Racks (D573, D577) ---------- */

export const RACK_SECTION_HEADING = "27 11 16 — Communications Racks, Frames and Enclosures";
/** Word's px are 1/96 in (docx converts transformation px to EMU at 9525). */
const PX_PER_IN = 96;
const IMAGE_MAX_W_IN = 6.5;
const IMAGE_MAX_H_IN = 8.5;
const RACK_COLS = ["RU", "Face", "Qty", "Manufacturer", "Model/SKU", "Description", "Watts"];
/** DXA; sums to the 6.5 in text width (9,360). */
const RACK_COL_W = [1000, 760, 560, 1600, 1700, 2900, 840];
const RULE = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const CELL_BORDERS = { top: RULE, bottom: RULE, left: RULE, right: RULE };

function rackCell(text: string, width: number, bold = false): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    children: [new Paragraph({ children: [new TextRun({ text: xmlSafe(text), bold, size: 18 })] })],
  });
}

const wattsText = (w: number | null) => (w === null ? "—" : (Math.round(w * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 }));

function rackTable(rack: RackSpecSection): Table {
  return new Table({
    width: { size: RACK_COL_W.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: RACK_COL_W,
    borders: { ...CELL_BORDERS, insideHorizontal: RULE, insideVertical: RULE },
    rows: [
      new TableRow({ tableHeader: true, children: RACK_COLS.map((h, i) => rackCell(h, RACK_COL_W[i], true)) }),
      ...rack.schedule.map(
        (r) => new TableRow({ children: [r.ru, r.face, String(r.qty), r.mfr, r.sku, r.desc, wattsText(r.watts)].map((t, i) => rackCell(t, RACK_COL_W[i])) })
      ),
    ],
  });
}

/** The PNG scaled to fit 6.5 × 8.5 in, keeping its aspect; null when the bytes aren't a PNG. */
function elevationImage(png: Buffer): Paragraph | null {
  const size = pngSize(png);
  if (!size) return null;
  const scale = Math.min((IMAGE_MAX_W_IN * PX_PER_IN) / size.width, (IMAGE_MAX_H_IN * PX_PER_IN) / size.height);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [
      new ImageRun({
        type: "png",
        data: png,
        transformation: { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) },
        altText: { name: "Rack elevation", title: "Rack elevation", description: "Front elevation of the rack" },
      }),
    ],
  });
}

function rackSection(racks: RackSpecSection[]): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 160 },
      border: { bottom: { style: "single", size: 6, color: "000000", space: 2 } },
      children: [new TextRun({ text: RACK_SECTION_HEADING, bold: true, size: 24 })],
    }),
  ];
  for (const rack of racks) {
    out.push(partHeading(xmlSafe(rack.scope ? `${rack.title} — ${rack.scope}` : rack.title)));
    const image = rack.elevationPng ? elevationImage(rack.elevationPng) : null;
    if (image) out.push(image);
    else {
      const pointer = rack.elevationPdfMissing
        ? "Elevation drawing available on request."
        : `Elevation: see racks/${rack.folder}/elevation.pdf in this package.`;
      out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: xmlSafe(pointer), italics: true })] }));
    }
    out.push(rackTable(rack), new Paragraph({ spacing: { after: 240 }, children: [] }));
  }
  return out;
}

export async function buildSpecDocx(spec: AssembledSpec): Promise<Buffer> {
  const dateStr = new Date(spec.date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: spec.projectName, bold: true, size: 32 })],
    }),
    new Paragraph({
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: [spec.customer, spec.engagementId].filter(Boolean).join(" · "),
          size: 20,
          color: "444444",
        }),
        new TextRun({ break: 1, text: `Specification prepared by ${spec.preparedBy} · ${dateStr}`, size: 20, color: "444444" }),
      ],
    }),
  ];

  for (const s of spec.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 160 },
        border: { bottom: { style: "single", size: 6, color: "000000", space: 2 } },
        children: [
          new TextRun({ text: `SECTION ${s.number} — ${s.title.toUpperCase()}`, bold: true, size: 24 }),
        ],
      })
    );

    children.push(partHeading("PART 1 — GENERAL"));
    const p1 = points(s.part1);
    if (p1.length) {
      p1.forEach((t, i) => children.push(point(`1.${two(i + 1)}`, [new TextRun(t)])));
    } else {
      children.push(
        point("1.01", [new TextRun({ text: "No general requirements recorded for this section.", italics: true })])
      );
    }

    children.push(partHeading("PART 2 — PRODUCTS"));
    s.parts.forEach((part, i) => {
      const head: TextRun[] = [new TextRun({ text: part.desc, bold: true })];
      if (part.sku) head.push(new TextRun({ text: `  (${part.sku})`, font: "Courier New", size: 19 }));
      if (part.qty) head.push(new TextRun({ text: ` — quantity ${part.qty}` }));
      children.push(point(`2.${two(i + 1)}`, head));
      points(part.body).forEach((t, j) => children.push(sub(LETTERS[j] || "•", t)));
    });

    children.push(partHeading("PART 3 — EXECUTION"));
    const p3 = points(s.part3);
    if (p3.length) {
      p3.forEach((t, i) => children.push(point(`3.${two(i + 1)}`, [new TextRun(t)])));
    } else {
      children.push(
        point("3.01", [new TextRun({ text: "No execution requirements recorded for this section.", italics: true })])
      );
    }
  }

  // #296 — a section of its own, before the record of what was left unspecified.
  if (spec.racks?.length) children.push(...rackSection(spec.racks));

  if (spec.waived.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 160 },
        children: [new TextRun({ text: "ITEMS NOT SPECIFIED", bold: true, size: 24 })],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun(
            "The following equipment appeared on the bill of materials and was intentionally omitted from this specification:"
          ),
        ],
      })
    );
    for (const w of spec.waived) {
      children.push(
        new Paragraph({
          indent: { left: 720 },
          spacing: { after: 80 },
          children: [
            new TextRun({ text: `${w.sku} `.trim(), font: "Courier New", size: 19 }),
            new TextRun({ text: ` ${w.desc}${w.reason ? ` — ${w.reason}` : ""}` }),
          ],
        })
      );
    }
  }

  if (!spec.sections.length && !spec.racks?.length) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun("No sections could be assembled from this equipment list.")],
      })
    );
  }

  const doc = new Document({
    creator: "Peak Systems Group",
    title: `${spec.projectName} — Specification`,
    description: `Bid specification for ${spec.customer || spec.projectName}`,
    styles: {
      default: {
        document: { run: { font: "Times New Roman", size: 22 } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
