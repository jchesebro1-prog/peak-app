import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import type { AssembledSpec } from "@/lib/bid-spec";

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

export async function buildSpecDocx(spec: AssembledSpec): Promise<Buffer> {
  const dateStr = new Date(spec.date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const children: Paragraph[] = [
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

  if (!spec.sections.length) {
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
