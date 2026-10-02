/**
 * Curtain cut sheets (#292 §2.6) — one view model per sheet, two styles from
 * one data source. Pure and client-safe. The Submittal title block reuses the
 * drawing set's titleBlockData (#209); revisions come from the QUOTE.
 *
 * Two rules run through every string here: a blank fact prints nothing (never
 * stand-in text), and a fact that members of a merged type can disagree on
 * (track operation, Grid color) prints only when they all agree.
 */
import { revLetter, titleBlockData, type RevisionRow, type TitleBlockData, type TitleBlockInput } from "@/lib/design/grid-drawing-set";
import type { QuoteRevision } from "@/lib/stores/quotes";
import type { CurtainType } from "./collect";
import { elevation, ftIn, inchLabel } from "./geometry";
import { mountDetail, type MountDetail } from "./mount-details";
import type { Shape } from "./shapes";
import { BOTTOM_FINISH_LABELS, MOUNT_KEY_LABELS, TOP_FINISH_LABELS, type CurtainMountKey } from "./vocab";

export type CutSheetStyle = "submittal" | "client";
export const CUT_SHEETS_NO_QUOTE = "Quote not found.";
export const CUT_SHEETS_WRONG_TYPE = "Cut sheets are for system quotes.";
export const CUT_SHEETS_NONE = "This quote has no curtains.";
/** Elevation boxes in paper inches: Letter landscape drawing area (60 % × 55 %) and Letter portrait at 0.6in margins. */
export const SUBMITTAL_ELEV_BOX = { wIn: 4.6, hIn: 3.9 } as const;
export const CLIENT_ELEV_BOX = { wIn: 7.3, hIn: 3.6 } as const;

export function isCutSheetQuoteType(t: string | null | undefined): boolean {
  return !t || t === "system";
}

export type CutSheetModel = {
  style: CutSheetStyle;
  sheetNo: string;
  title: string;
  /** Submittal only. */
  titleBlock: TitleBlockData | null;
  header: { companyName: string; logoDark: string | null; estimateNo: string };
  elevation: { scale: string; shapes: Shape[]; box: { wIn: number; hIn: number } };
  mount: { label: string; detail: MountDetail };
  /** Submittal only ([] for Client). */
  materials: Array<{ label: string; value: string }>;
  sizes: Array<{ size: string; qty: number }>;
  /** Submittal only. */
  hardware: Array<{ sku: string; desc: string; qty: number; unit: string }>;
  /** Client only ("" for Submittal). */
  description: string;
};

export type CutSheetContext = {
  style: CutSheetStyle;
  quote: { id: string; number: string; name: string; customer: string; venue: string; revisions?: ReadonlyArray<Pick<QuoteRevision, "rev" | "at" | "reason" | "note">> };
  company: TitleBlockInput["company"];
  preparedBy: string;
  index: number;
  total: number;
  now: number;
};

/** QuoteRevision → the drawing set's RevisionRow: note, else "Issued to customer" (sent), else "Pricing snapshot". */
export function quoteRevisionRows(revs: CutSheetContext["quote"]["revisions"] | undefined): RevisionRow[] {
  return [...(revs || [])]
    .sort((a, b) => a.rev - b.rev)
    .map((r, i) => ({
      rev: r.rev,
      letter: revLetter(i),
      date: r.at,
      label: (r.note || "").trim() || (r.reason === "sent" ? "Issued to customer" : "Pricing snapshot"),
    }));
}

/** `.pk-drawing-sheet` variables for Letter landscape (SheetSizeKey is NOT widened — the drawing set switches on it). */
export function cutSheetCssVars(): Record<string, string> {
  return { "--dw-w": "11in", "--dw-h": "8.5in", "--dw-k": "0.85", "--dw-m": "0.3in", "--dw-strip": "2.1in", "--dw-pad": "0.15in" };
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);
const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
/** Where a mount lands. `track-other` has no place — an unknown mounting is never described. */
const MOUNT_PLACE: Partial<Record<CurtainMountKey, string>> = {
  "track-batten": "a pipe batten",
  "track-ceiling": "the ceiling",
  "track-structure": "the building structure (drop kit)",
  "tie-batten": "a pipe batten",
  "wall-hookloop": "a wall header",
};
const fmt1 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fullnessFactor = (pct: number) => Number((1 + pct / 100).toFixed(2));
const fabricName = (type: CurtainType): string => (type.curtains[0].fabric?.name || type.curtains[0].fabricText || "").trim();

/** One deterministic sentence from the type (Client style). Blank facts are left out, never replaced. */
export function plainDescription(type: CurtainType): string {
  const c = type.curtains[0];
  const n = type.totalQty;
  const size =
    type.sizes.length === 1
      ? `, ${n > 1 ? "each " : ""}${ftIn(type.sizes[0].widthFt)} wide × ${ftIn(type.sizes[0].heightFt)} tall finished`
      : type.sizes.length > 1
        ? ` in ${type.sizes.length} sizes`
        : "";
  const fabric = fabricName(type);
  const fullness = c.fullnessPct > 0 ? `${c.fullnessPct}% fullness` : "no fullness (flat)";
  const first = `${countWord(n)} ${type.title} ${n === 1 ? "panel" : "panels"}${size}, ${fabric ? `sewn from ${fabric} with ${fullness}` : `with ${fullness}`}.`;
  const top =
    c.topFinish === "grommets"
      ? `The top has webbing with grommets every ${inchLabel(type.markSpacingIn)}`
      : c.topFinish === "pipe-pocket"
        ? "The top has a pipe pocket"
        : "The top has a hook-and-loop strip";
  const place = MOUNT_PLACE[c.mount.key];
  const mountedTo = place ? ` mounted to ${place}` : "";
  const t = c.mount.track;
  const hang = t
    ? t.seriesName
      ? `, hung from carriers on ${aOrAn(t.seriesName)} ${t.seriesName} track${mountedTo}`
      : `, hung from carriers on a track${mountedTo}`
    : c.mount.key === "tie-batten"
      ? `, tied to ${place}`
      : c.mount.key === "wall-hookloop"
        ? `, fastened to ${place}`
        : `, hung on a track${mountedTo}`;
  const bottom =
    c.bottomFinish === "chain"
      ? "the bottom has a chain pocket so the curtain hangs straight."
      : c.bottomFinish === "pipe-pocket"
        ? "the bottom has a pipe pocket for a bottom pipe."
        : "the bottom has a plain hem.";
  return `${first} ${top}${hang}; ${bottom}`;
}

/** The fabric name plus whichever catalog facts are known; "" when the fabric is blank. */
function fabricValue(type: CurtainType): string {
  const name = fabricName(type);
  const f = type.curtains[0].fabric;
  if (!name) return "";
  const facts: string[] = [];
  if (f?.oz) facts.push(`${f.oz} oz/${f.ozBasis === "sq-yd" ? "sq yd" : "lin yd"}`);
  if (f?.boltWidthIn) facts.push(`${f.boltWidthIn}" bolt`);
  return facts.length ? `${name} · ${facts.join(", ")}` : name;
}

function eachTotal(each: ReadonlyArray<number>, total: number, unit: string, fmt: (n: number) => string): string {
  const distinct = new Set(each.map(fmt));
  return distinct.size === 1 ? `${[...distinct][0]} ${unit} each · ${fmt(total)} ${unit} total` : `${fmt(total)} ${unit} total`;
}

/**
 * Fabric, Flame rating (if set), Color (Grid, if every member agrees), Fullness, Finished size,
 * Top, Bottom, Sewn area, Weight (only when known — with the type's weight note), Qty.
 */
export function materialRows(type: CurtainType): Array<{ label: string; value: string }> {
  const c = type.curtains[0];
  const rows: Array<{ label: string; value: string }> = [];
  const fabric = fabricValue(type);
  if (fabric) rows.push({ label: "Fabric", value: fabric });
  if (c.fabric?.flameRating) rows.push({ label: "Flame rating", value: c.fabric.flameRating });
  const colors = new Set(type.curtains.map((x) => (x.color || "").trim()));
  if (colors.size === 1 && [...colors][0]) rows.push({ label: "Color", value: [...colors][0] });
  rows.push({ label: "Fullness", value: c.fullnessPct > 0 ? `${c.fullnessPct}% (${fullnessFactor(c.fullnessPct)}×)` : "Flat" });
  if (type.sizes.length) rows.push({ label: "Finished size", value: type.sizes.length === 1 ? `${ftIn(type.sizes[0].widthFt)} W × ${ftIn(type.sizes[0].heightFt)} H` : "See schedule" });
  rows.push({ label: "Top finish", value: TOP_FINISH_LABELS[c.topFinish] + (c.topFinish === "grommets" ? ` @ ${inchLabel(type.markSpacingIn)} o.c. max` : "") });
  rows.push({ label: "Bottom finish", value: BOTTOM_FINISH_LABELS[c.bottomFinish] });
  rows.push({ label: "Sewn area", value: eachTotal(type.sewnAreaSqftEach, type.sewnAreaSqftTotal, "sq ft", fmt1) });
  if (type.weightLbTotal != null) {
    const w = eachTotal(type.weightLbEach as number[], type.weightLbTotal, "lb", fmt0);
    rows.push({ label: "Weight", value: type.weightNote ? `${w} (${type.weightNote})` : w });
  }
  rows.push({ label: "Qty", value: String(type.totalQty) });
  return rows;
}

export function cutSheetModel(type: CurtainType, ctx: CutSheetContext): CutSheetModel {
  const c = type.curtains[0];
  const submittal = ctx.style === "submittal";
  const box = submittal ? SUBMITTAL_ELEV_BOX : CLIENT_ELEV_BOX;
  const elev = elevation({
    sizes: type.sizes,
    fullnessPct: c.fullnessPct,
    top: c.topFinish,
    bottom: c.bottomFinish,
    markSpacingIn: type.markSpacingIn,
    markLabel: c.mount.source === "track" ? "Carriers" : "Grommets",
    box,
  });
  const t = c.mount.track;
  const mountLabel = t && t.seriesName ? `${MOUNT_KEY_LABELS[c.mount.key]} (${t.seriesName})` : MOUNT_KEY_LABELS[c.mount.key];
  return {
    style: ctx.style,
    sheetNo: type.sheetNo,
    title: type.title,
    titleBlock: submittal
      ? titleBlockData({
          company: ctx.company,
          project: { id: ctx.quote.number, name: ctx.quote.name, customer: ctx.quote.customer, siteName: ctx.quote.venue, intake: null, createdBy: ctx.preparedBy },
          option: { name: "", quoteId: ctx.quote.number },
          optionCount: 1,
          revisions: quoteRevisionRows(ctx.quote.revisions),
          set: { drawnBy: ctx.preparedBy, checkedBy: "" },
          sheet: { number: type.sheetNo, title: type.title, scale: `Elev ${elev.scale} · Detail NTS` },
          index: ctx.index,
          total: ctx.total,
          now: ctx.now,
        })
      : null,
    header: { companyName: ctx.company.name || "", logoDark: ctx.company.logoDark || null, estimateNo: ctx.quote.number },
    elevation: { scale: elev.scale, shapes: elev.shapes, box: { wIn: box.wIn, hIn: box.hIn } },
    mount: { label: mountLabel, detail: mountDetail(c.mount.key) },
    materials: submittal ? materialRows(type) : [],
    sizes: type.sizes.map((s) => ({ size: `${ftIn(s.widthFt)} W × ${ftIn(s.heightFt)} H`, qty: s.qty })),
    hardware: submittal ? type.hardware.map(({ sku, desc, qty, unit }) => ({ sku, desc, qty, unit })) : [],
    description: submittal ? "" : plainDescription(type),
  };
}
