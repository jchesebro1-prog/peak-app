import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  LevelSuffix,
  Packer,
  PageNumber,
  Paragraph,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
} from "docx";
import type { AssembledSection, EquipmentRow } from "@/lib/specs/assemble-section";
import type { OutlineLine } from "@/lib/specs/outline";
import { longDate } from "@/lib/specs/spec-file-name";

/* ------------------------------------------------------------------ *
 * The spec builder's Word writer (#205 Phase B, design §4).
 *
 * Renders one AssembledSection — the same object the builder's preview
 * draws — as a real .docx in the North HS house format: Letter, Times New
 * Roman, running header, "<number> - <page>" footer.
 *
 * Numbering is Word's OWN multi-level list, never typed-in labels: one
 * abstract list (PART %1 – → %1.%2 → A. → 1. → a. → 1) → a)) and ONE
 * list instance for the whole section. Jeff edits these files in Word
 * (his question 6), so inserting or deleting a paragraph must renumber
 * everything after it; deeper levels restart under each new higher-level
 * item by Word's default. This is deliberately unlike D94's
 * bid-spec-docx.ts, which types its numbers because those sections are
 * pasted into someone else's manual.
 *
 * Server-only: Packer runs in Node; imported by a route handler, never by
 * a client component.
 * ------------------------------------------------------------------ */

const REF = "spec-outline";
/** One list instance for the whole document — see the header comment. */
const INSTANCE = 1;
/** Letter, 1" margins → 6.5" of text. */
const TEXT_WIDTH = 9360;
const FONT = "Times New Roman";

/**
 * Text that is safe inside a Word XML run: XML 1.0 forbids most C0 control
 * characters, and one in document.xml makes Word refuse the whole file. A
 * vertical tab (\x0B — what Word itself puts on the clipboard for a manual
 * line break) becomes a space; the rest are dropped. Every string this
 * writer puts in a run goes through here (#205 spec builder final fix 5).
 */
export function xmlSafe(text: string): string {
  return String(text ?? "")
    .replace(/\x0B/g, " ")
    .replace(/[\x00-\x08\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");
}

const indent = (left: number) => ({ indent: { left, hanging: 720 } });

const LEVELS: ILevelsOptions[] = [
  {
    level: 0,
    format: LevelFormat.DECIMAL,
    text: "PART %1 –",
    alignment: AlignmentType.LEFT,
    suffix: LevelSuffix.SPACE,
    style: { run: { bold: true }, paragraph: { indent: { left: 0, hanging: 0 } } },
  },
  { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { paragraph: indent(720) } },
  { level: 2, format: LevelFormat.UPPER_LETTER, text: "%3.", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { paragraph: indent(1440) } },
  { level: 3, format: LevelFormat.DECIMAL, text: "%4.", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { paragraph: indent(2160) } },
  { level: 4, format: LevelFormat.LOWER_LETTER, text: "%5.", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { paragraph: indent(2880) } },
  { level: 5, format: LevelFormat.DECIMAL, text: "%6)", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { paragraph: indent(3600) } },
  { level: 6, format: LevelFormat.LOWER_LETTER, text: "%7)", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { paragraph: indent(4320) } },
];

const numbered = (level: number) => ({ reference: REF, level: Math.min(6, Math.max(0, level)), instance: INSTANCE });
/** In a STYLE, `custom` stops docx writing `pStyle ListParagraph` into the style's own pPr (invalid there). */
const styleNumbered = (level: number) => ({ ...numbered(level), custom: true });

/**
 * PART and article paragraphs take their number from their STYLE, not a
 * direct numPr: Heading 1's pPr carries level 0 of the list and Heading 2's
 * level 1, so a heading Jeff adds in Word by picking the style numbers
 * itself. The reverse link (`w:pStyle` on the level) is deliberately left
 * out: docx 9.7 writes it after `w:lvlJc`, out of CT_Lvl's schema order,
 * which Word can reject as unreadable content.
 */
function partHeading(title: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(xmlSafe(title))] });
}

function articleHeading(title: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(xmlSafe(title))] });
}

/** An outline line's TEXT only — its label is Word's to draw. */
function item(level: number, text: string, keepNext = false): Paragraph {
  return new Paragraph({ numbering: numbered(level), keepNext, spacing: { after: 120 }, children: [new TextRun(xmlSafe(text))] });
}

/** Article-context lines start at depth 0 → level 2 (A.); entry-context lines already start at depth 1. */
const lines = (ls: OutlineLine[]) => ls.map((l) => item(2 + l.depth, l.text));

function cell(text: string, bold = false): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: xmlSafe(text), bold })] })] });
}

function equipmentTable(rows: EquipmentRow[], showQty: boolean): Table {
  const head = [...(showQty ? ["Qty"] : []), "Mfr", "Model", "Description"];
  const widths = showQty ? [720, 1800, 2160, TEXT_WIDTH - 4680] : [1800, 2160, TEXT_WIDTH - 3960];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h) => cell(h, true)) }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: [...(showQty ? [cell(r.qty != null ? String(r.qty) : "")] : []), cell(r.mfr), cell(r.model), cell(r.description)],
          })
      ),
    ],
  });
}

function body(a: AssembledSection): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: xmlSafe(`SECTION ${a.number} – ${a.title.toUpperCase()}`), bold: true })],
    }),
  ];

  out.push(partHeading("GENERAL"));
  for (const art of a.part1) out.push(articleHeading(art.title), ...lines(art.lines));

  out.push(partHeading("PRODUCTS"));
  for (const art of a.part2.articles) {
    out.push(articleHeading(art.title), ...lines(art.general));
    // A product heading sits at level 2 in the same list, so its letter
    // continues after the article's General clauses (B., C.…) by itself.
    for (const p of art.products) out.push(item(2, p.heading, true), ...lines(p.lines));
  }
  if (a.part2.style === "table" && a.part2.rows.length > 0) {
    out.push(new Paragraph({ spacing: { after: 0 }, children: [] }), equipmentTable(a.part2.rows, a.part2.showQty));
  }

  out.push(partHeading("EXECUTION"));
  for (const art of a.part3) out.push(articleHeading(art.title), ...lines(art.lines));

  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 360 },
      children: [new TextRun({ text: xmlSafe(`END OF SECTION ${a.number}`), bold: true })],
    })
  );
  return out;
}

/**
 * The North HS originals' running header: one line — issue date at the left
 * margin, project name centered, "Project No. <n>" flush right — then the
 * phase centered beneath. A blank piece drops its text but keeps its tab, so
 * the others hold their positions.
 */
function runningHeader(a: AssembledSection): Header {
  const h = a.header;
  const pieces = [longDate(h.issueDate), h.projectName, h.projectNumber ? `Project No. ${h.projectNumber}` : ""];
  const line: Array<string | Tab> = [];
  pieces.forEach((text, i) => {
    if (i > 0) line.push(new Tab());
    if (text) line.push(xmlSafe(text));
  });
  return new Header({
    children: [
      new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: TEXT_WIDTH / 2 },
          { type: TabStopType.RIGHT, position: TEXT_WIDTH },
        ],
        children: [new TextRun({ children: line, size: 20 })],
      }),
      ...(h.phase
        ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: xmlSafe(h.phase), size: 20 })] })]
        : []),
    ],
  });
}

function runningFooter(a: AssembledSection): Footer {
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
        children: [
          new TextRun({ text: xmlSafe(a.title.toUpperCase()), size: 20 }),
          new TextRun({ children: [new Tab(), xmlSafe(`${a.number} - `), PageNumber.CURRENT], size: 20 }),
        ],
      }),
    ],
  });
}

export async function buildSectionDocx(a: AssembledSection): Promise<Buffer> {
  const heading = { font: FONT, size: 22, bold: true, color: "000000" };
  const doc = new Document({
    creator: "Quartzite",
    title: xmlSafe(`Section ${a.number} – ${a.title}`),
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 } },
        heading1: {
          run: heading,
          paragraph: { outlineLevel: 0, keepNext: true, spacing: { before: 360, after: 120 }, numbering: styleNumbered(0) },
        },
        heading2: {
          run: heading,
          paragraph: { outlineLevel: 1, keepNext: true, spacing: { before: 240, after: 120 }, numbering: styleNumbered(1) },
        },
      },
    },
    numbering: { config: [{ reference: REF, levels: LEVELS }] },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 },
          },
        },
        headers: { default: runningHeader(a) },
        footers: { default: runningFooter(a) },
        children: body(a),
      },
    ],
  });
  return Packer.toBuffer(doc);
}
