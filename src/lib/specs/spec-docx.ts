import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  LevelFormat,
  LevelSuffix,
  Packer,
  PageNumber,
  Paragraph,
  Tab,
  TableLayoutType,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
  type IParagraphStyleOptions,
} from "docx";
import type { AssembledSection, EquipmentRow } from "@/lib/specs/assemble-section";
import type { OutlineLine } from "@/lib/specs/outline";
import { longDate } from "@/lib/specs/spec-file-name";

/* ------------------------------------------------------------------ *
 * The spec builder's Word writer (#205 Phase B, design §4).
 *
 * Renders one AssembledSection — the same object the builder's preview
 * draws — as a real .docx in the architect's (Bray) MasterSpec house
 * format: Letter, Times New Roman 10 pt, MasterSpec paragraph styles
 * (SCT, PRT, ART, PR1–PR5, EOS, HDR, FTR — plus PR6 for our sixth outline
 * level), running header, "<number> - <page>" footer.
 *
 * Numbering is Word's OWN multi-level list, never typed-in labels: one
 * abstract list (PART %1 - → %1.%2 → A. → 1. → a. → 1) → a) → (1)) and
 * ONE list instance for the whole section. Exactly as in MasterSpec, every
 * outline paragraph carries only its style (PRT/ART/PR1…); the STYLE links
 * to its list level, so a paragraph Jeff adds in Word by picking the style
 * numbers itself, and inserting or deleting one renumbers everything after
 * it. Deeper levels restart under each new higher-level item by Word's
 * default. This is deliberately unlike D94's bid-spec-docx.ts, which types
 * its numbers because those sections are pasted into someone else's
 * manual.
 *
 * Times New Roman is written explicitly on docDefaults, on every custom
 * style and on every list level's run, so a label and its text can never
 * land in different fonts in any viewer.
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
/** Explicit on every side (ascii/hAnsi/cs/eastAsia) — see the header comment. */
const FONTS = { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT };
/** Half-points: body text 10 pt, header/footer 11 pt. */
const BODY_SIZE = 20;
const HF_SIZE = 22;
const BODY_RUN = { font: FONTS, size: BODY_SIZE };

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

/** A list level's hanging indent + its matching left tab stop (MasterSpec's layout). */
const hang = (left: number, hanging: number) => ({ indent: { left, hanging }, leftTabStop: left });

/*
 * The MasterSpec list, compressed to consecutive levels: MasterSpec's own
 * levels 1–2 (SUT / DST) have no counterpart here, so ART sits at level 1
 * and PR1…PR5 at 2…6; level 7 is our sixth outline level (PR6). Level
 * indents live on the list levels, as in the template; label runs carry the
 * body font and size explicitly.
 */
const LEVELS: ILevelsOptions[] = [
  { level: 0, format: LevelFormat.DECIMAL, text: "PART %1 - ", alignment: AlignmentType.LEFT, suffix: LevelSuffix.NOTHING, style: { run: BODY_RUN } },
  { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: BODY_RUN, paragraph: hang(864, 864) } },
  { level: 2, format: LevelFormat.UPPER_LETTER, text: "%3.", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: BODY_RUN, paragraph: hang(864, 576) } },
  { level: 3, format: LevelFormat.DECIMAL, text: "%4.", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: BODY_RUN, paragraph: hang(1440, 576) } },
  { level: 4, format: LevelFormat.LOWER_LETTER, text: "%5.", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: BODY_RUN, paragraph: hang(2016, 576) } },
  { level: 5, format: LevelFormat.DECIMAL, text: "%6)", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: BODY_RUN, paragraph: hang(2592, 576) } },
  { level: 6, format: LevelFormat.LOWER_LETTER, text: "%7)", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: BODY_RUN, paragraph: hang(3168, 576) } },
  { level: 7, format: LevelFormat.DECIMAL, text: "(%8)", alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: BODY_RUN, paragraph: hang(3744, 576) } },
];

/**
 * A style's link to its list level. `custom` stops docx writing
 * `pStyle ListParagraph` into the style's own pPr (invalid there). The
 * reverse link (`w:pStyle` on the level) is deliberately left out: docx 9.7
 * writes it after `w:lvlJc`, out of CT_Lvl's schema order, which Word can
 * reject as unreadable content.
 */
const styleNumbered = (level: number) => ({ reference: REF, level, instance: INSTANCE, custom: true });

/** Outline item levels 2…7 → PR1…PR6. */
const PR_STYLES = ["PR1", "PR2", "PR3", "PR4", "PR5", "PR6"] as const;

/** A MasterSpec custom paragraph style: based on Normal, justified, TNR. */
function specStyle(
  id: string,
  opts: { next?: string; size?: number; paragraph?: IParagraphStyleOptions["paragraph"] } = {}
): IParagraphStyleOptions {
  return {
    id,
    name: id,
    basedOn: "Normal",
    ...(opts.next ? { next: opts.next } : {}),
    run: { font: FONTS, size: opts.size ?? BODY_SIZE },
    paragraph: { alignment: AlignmentType.BOTH, ...opts.paragraph },
  };
}

const PARAGRAPH_STYLES: IParagraphStyleOptions[] = [
  specStyle("SCT", { next: "PRT", paragraph: { spacing: { before: 240 } } }),
  specStyle("PRT", { next: "ART", paragraph: { keepNext: true, spacing: { before: 480 }, outlineLevel: 0, numbering: styleNumbered(0) } }),
  specStyle("ART", { next: "PR1", paragraph: { keepNext: true, spacing: { before: 480 }, outlineLevel: 1, numbering: styleNumbered(1) } }),
  specStyle("PR1", { paragraph: { spacing: { before: 240 }, outlineLevel: 2, numbering: styleNumbered(2) } }),
  specStyle("PR2", { paragraph: { outlineLevel: 3, numbering: styleNumbered(3) } }),
  specStyle("PR3", { paragraph: { outlineLevel: 4, numbering: styleNumbered(4) } }),
  specStyle("PR4", { paragraph: { outlineLevel: 5, numbering: styleNumbered(5) } }),
  specStyle("PR5", { paragraph: { outlineLevel: 6, numbering: styleNumbered(6) } }),
  specStyle("PR6", { paragraph: { outlineLevel: 7, numbering: styleNumbered(7) } }),
  specStyle("EOS", { paragraph: { spacing: { before: 480 } } }),
  specStyle("HDR", { size: HF_SIZE, paragraph: { rightTabStop: TEXT_WIDTH } }),
  specStyle("FTR", { size: HF_SIZE, paragraph: { rightTabStop: TEXT_WIDTH } }),
];

/** Text in a MasterSpec style — the style supplies font, size and number. */
function styled(style: string, text: string, keepNext = false): Paragraph {
  return new Paragraph({ style, ...(keepNext ? { keepNext: true } : {}), children: [new TextRun(xmlSafe(text))] });
}

const partHeading = (title: string) => styled("PRT", title);
const articleHeading = (title: string) => styled("ART", title);

/** An outline line's TEXT only — its label is Word's to draw. Level 2 → PR1 … 7 → PR6. */
function item(level: number, text: string, keepNext = false): Paragraph {
  return styled(PR_STYLES[Math.min(7, Math.max(2, level)) - 2], text, keepNext);
}

/** Article-context lines start at depth 0 → level 2 (A.); entry-context lines already start at depth 1. */
const lines = (ls: OutlineLine[]) => ls.map((l) => item(2 + l.depth, l.text));

const RULE = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
const CELL_BORDERS = { top: RULE, bottom: RULE, left: RULE, right: RULE };

function cell(text: string, width: number, bold = false): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    children: [new Paragraph({ children: [new TextRun({ text: xmlSafe(text), bold, font: FONTS, size: BODY_SIZE })] })],
  });
}

function equipmentTable(rows: EquipmentRow[], showQty: boolean): Table {
  const head = [...(showQty ? ["Qty"] : []), "Mfr", "Model", "Description"];
  const widths = showQty ? [828, 1422, 2520, 4590] : [1422 + 828, 2520, 4590];
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    borders: { ...CELL_BORDERS, insideHorizontal: RULE, insideVertical: RULE },
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map((r) => {
        const texts = [...(showQty ? [r.qty != null ? String(r.qty) : ""] : []), r.mfr, r.model, r.description];
        return new TableRow({ children: texts.map((t, i) => cell(t, widths[i])) });
      }),
    ],
  });
}

function body(a: AssembledSection): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [styled("SCT", `SECTION ${a.number} – ${a.title.toUpperCase()}`)];

  out.push(partHeading("GENERAL"));
  for (const art of a.part1) out.push(articleHeading(art.title), ...lines(art.lines));

  out.push(partHeading("PRODUCTS"));
  for (const art of a.part2.articles) {
    out.push(articleHeading(art.title), ...lines(art.general));
    // A product heading sits at level 2 (PR1) in the same list, so its
    // letter continues after the article's General clauses (B., C.…) by itself.
    for (const p of art.products) out.push(item(2, p.heading, true), ...lines(p.lines));
  }
  if (a.part2.style === "table" && a.part2.rows.length > 0) {
    out.push(new Paragraph({ spacing: { after: 0 }, children: [] }), equipmentTable(a.part2.rows, a.part2.showQty));
  }
  // ITEMS NOT SPECIFIED follows the schedule, never precedes it.
  if (a.part2.style === "table" && a.part2.trailing) {
    out.push(articleHeading(a.part2.trailing.title), ...lines(a.part2.trailing.general));
  }

  out.push(partHeading("EXECUTION"));
  for (const art of a.part3) out.push(articleHeading(art.title), ...lines(art.lines));

  out.push(styled("EOS", `END OF SECTION ${a.number}`));
  return out;
}

/** The header's tabs, written on each header paragraph (a style can't carry a center tab through docx). */
const HDR_TABS = [
  { type: TabStopType.CENTER, position: TEXT_WIDTH / 2 },
  { type: TabStopType.RIGHT, position: TEXT_WIDTH },
];

/**
 * The MasterSpec running header: one HDR line — issue date at the left
 * margin, project name centered, "Project No. <n>" flush right — then the
 * phase on a second line, tabbed to the same center stop so it sits under
 * the project name. A blank piece drops its text but keeps its tab, so the
 * others hold their positions.
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
      new Paragraph({ style: "HDR", tabStops: HDR_TABS, children: [new TextRun({ children: line, font: FONTS, size: HF_SIZE })] }),
      ...(h.phase
        ? [new Paragraph({ style: "HDR", tabStops: HDR_TABS, children: [new TextRun({ children: [new Tab(), xmlSafe(h.phase)], font: FONTS, size: HF_SIZE })] })]
        : []),
    ],
  });
}

function runningFooter(a: AssembledSection): Footer {
  return new Footer({
    children: [
      new Paragraph({
        style: "FTR",
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
        children: [
          new TextRun({ text: xmlSafe(a.title.toUpperCase()), font: FONTS, size: HF_SIZE }),
          new TextRun({ children: [new Tab(), xmlSafe(`${a.number} - `), PageNumber.CURRENT], font: FONTS, size: HF_SIZE }),
        ],
      }),
    ],
  });
}

export async function buildSectionDocx(a: AssembledSection): Promise<Buffer> {
  const doc = new Document({
    creator: "Quartzite",
    title: xmlSafe(`Section ${a.number} – ${a.title}`),
    styles: {
      default: { document: { run: { font: FONTS, size: BODY_SIZE } } },
      paragraphStyles: PARAGRAPH_STYLES,
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
