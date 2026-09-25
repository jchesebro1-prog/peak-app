import type { CSSProperties, ReactNode } from "react";
import {
  counts,
  severityMeta,
  statusMeta,
  conditionMeta,
  fmtLong,
  fmtShort,
  yearOf,
  boilerplate,
  SEVERITIES,
  RUBRIC_RATINGS,
  SYSTEM_FIELDS,
  MEASUREMENT_GROUPS,
  type InspectionRecord,
  type InspectionLog,
  type InspectionBoilerplate,
} from "@/lib/stores/inspections";
import type { Office } from "@/lib/settings";
import { RenovationQuoteButton } from "./controls";
import { INSPECTION_LIMITATION_NOTICE } from "@/lib/compliance-notices";
import peakLetterhead from "@/app/(app)/inspections/letter/peak-letterhead.jpg";

export type ReportLayout = "report" | "dossier" | "compact";

/* eslint-disable @next/next/no-img-element */

const STRIPE = "repeating-linear-gradient(45deg,#eef0f3,#eef0f3 11px,#e7eaef 11px,#e7eaef 22px)";

/* ============================================================
 * Print-pagination budget helpers
 * ------------------------------------------------------------
 * The report is printed as a stack of fixed 8.5x11in `.rp-sheet`s
 * (`overflow: hidden` on screen — see page.tsx for the `overflow: visible`
 * print safety net). Chunked sections (rubric, recommendations, the
 * rigging-log summary, and one-up detail-log sheets) need to know ahead of
 * render time whether a slice of rows will fit on one sheet, but there's no
 * DOM to measure at server-render time — so these estimate rendered height
 * from text length instead.
 *
 * Estimates are deliberately conservative: narrower columns and wider
 * average glyphs than the CSS actually renders, so a sheet chunks a little
 * early rather than overflows. Kept pure and exported so they're testable
 * independent of the JSX below.
 * ============================================================ */

/** Usable content height (px @ 96dpi) inside one `.rp-sheet`'s body: 11in
 *  page height minus the running head, the running foot, and the
 *  0.5in/0.7in body padding used throughout this file — rounded down for
 *  safety margin. */
export const SHEET_CONTENT_BUDGET_PX = 800;

/** Conservative characters-per-line for a column `colWidthIn` inches wide
 *  set in `fontSizePx`. Assumes an average glyph width of ~0.56x the font
 *  size (wider than most proportional fonts render), so this under-counts
 *  chars/line and correspondingly over-counts the resulting line/height
 *  estimate. */
export function estCharsPerLine(colWidthIn: number, fontSizePx: number): number {
  const widthPx = colWidthIn * 96;
  const avgGlyphPx = Math.max(1, fontSizePx * 0.56);
  return Math.max(8, Math.floor(widthPx / avgGlyphPx));
}

/** Estimated wrapped-line count for `text` in a column `colWidthIn` inches
 *  wide at `fontSizePx`. Empty text still costs 1 line (the "—" placeholder
 *  every section falls back to). */
export function estLineCount(text: string | null | undefined, colWidthIn: number, fontSizePx: number): number {
  const len = (text || "").trim().length || 1;
  return Math.max(1, Math.ceil(len / estCharsPerLine(colWidthIn, fontSizePx)));
}

/** Estimated rendered height (px) of a `numLines`-line text block at
 *  `fontSizePx` / `lineHeight`, plus any fixed chrome (label, padding,
 *  margins) passed in `chromePx`. */
export function estTextBlockPx(numLines: number, fontSizePx: number, lineHeight: number, chromePx = 0): number {
  return Math.round(numLines * fontSizePx * lineHeight) + chromePx;
}

/** Greedily packs `items` onto pages under `budgetPx`, charging `headerPx`
 *  against the first item on the first page and `continuationHeaderPx`
 *  against the first item on every later page (this only accounts for
 *  extra in-page chrome like a title or table header — the running
 *  head/foot are identical on every sheet regardless). Always makes
 *  forward progress: a single item taller than the whole budget still gets
 *  its own page rather than looping forever — the print-CSS
 *  `overflow: visible` safety net (page.tsx) covers that rare case. Pure,
 *  order-preserving. */
export function paginateByHeight<T>(
  items: T[],
  itemPx: (item: T) => number,
  budgetPx: number,
  headerPx: number,
  continuationHeaderPx: number = headerPx
): T[][] {
  const pages: T[][] = [];
  let cur: T[] = [];
  let used = headerPx;
  for (const item of items) {
    const h = itemPx(item);
    if (used + h > budgetPx && cur.length) {
      pages.push(cur);
      cur = [];
      used = continuationHeaderPx;
    }
    cur.push(item);
    used += h;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

export function InspectionReportSheets({
  record,
  accent,
  companyName,
  offices,
  layout,
  showBoiler,
  showClosed,
  showRubric,
  logoDark = null,
  boiler: boilerProp,
}: {
  record: InspectionRecord;
  accent: string;
  companyName: string;
  offices: Office[];
  layout: ReportLayout;
  showBoiler: boolean;
  showClosed: boolean;
  showRubric: boolean;
  /** Uploaded dark brand mark (Settings -> Branding) -- replaces the baked Peak letterhead. */
  logoDark?: string | null;
  /** Standing report prose, overlaid from the Templates store. Falls back to
   *  the built-in defaults when omitted. */
  boiler?: InspectionBoilerplate;
}) {
  const r = record;
  const isReport = layout === "report";
  const isDossier = layout === "dossier";
  const isCompact = layout === "compact";
  const oneUp = isReport || isDossier;
  const boiler = boilerProp ?? boilerplate();

  const accentInk = `color-mix(in srgb, ${accent} 72%, #000)`;
  const hq = offices[0] || ({} as Office);
  const officeLine = [hq.street, [hq.city, hq.state].filter(Boolean).join(", "), hq.zip].filter(Boolean).join(", ");

  /* ---- shared chrome ---- */
  const sheet: CSSProperties = {
    width: "8.5in",
    minHeight: "11in",
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    overflow: "hidden",
    color: "#16181d",
  };
  const headStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "0.32in 0.7in 0",
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "#aab0bb",
  };
  const footStyle: CSSProperties = {
    padding: "9px 0.7in 0.3in",
    fontFamily: "var(--font-mono)",
    fontSize: 8.5,
    letterSpacing: ".05em",
    color: "#c0c5ce",
    borderTop: "1px solid #f0f1f4",
    margin: "0 0.7in",
    textAlign: "center",
  };
  const h1: CSSProperties = { fontSize: 26, fontWeight: 800, letterSpacing: "-.015em", color: "#16181d" };
  const h2: CSSProperties = { fontSize: 15, fontWeight: 700, letterSpacing: ".01em", color: "#16181d", borderLeft: `3px solid ${accent}`, paddingLeft: 11 };
  const prose: CSSProperties = { fontSize: 13, lineHeight: 1.62, color: "#3a3f4a", margin: "10px 0 0" };

  const surveyDateLong = fmtLong(r.surveyDate);
  const reportDateLong = r.reportDate ? fmtLong(r.reportDate) : "Draft";
  const cond = conditionMeta(r.condition);
  const coverConditionStyle: CSSProperties = { display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700, letterSpacing: ".02em", color: cond.ink, background: cond.soft, border: `1px solid ${cond.bd}`, padding: "6px 13px", borderRadius: 20 };
  const conditionBigStyle: CSSProperties = { display: "inline-flex", alignItems: "center", fontSize: 15, fontWeight: 700, color: cond.ink, background: cond.soft, border: `1px solid ${cond.bd}`, padding: "8px 16px", borderRadius: 8 };

  const headerLeft = "Survey · " + (fmtShort(r.surveyDate) || "—");
  const headerCenter = (r.customer || "") + " · " + (r.venue || "");
  const headerRight = r.reportDate ? "Report · " + fmtShort(r.reportDate) : "Draft";
  const footerText = companyName + (officeLine ? "  |  " + officeLine : "");

  const c = counts(r);
  const docId = r.id;

  const head = (
    <div style={headStyle}>
      <span>{headerLeft}</span>
      <span>{headerCenter}</span>
      <span>{headerRight}</span>
    </div>
  );
  const foot = <div style={footStyle}>{footerText}</div>;
  const letterhead = (
    <img
      src={logoDark || peakLetterhead.src}
      alt={companyName}
      style={logoDark
        ? { display: "block", maxHeight: 60, maxWidth: "3.6in", objectFit: "contain" }
        : { display: "block", width: "100%", maxWidth: "4.6in", height: "auto" }}
    />
  );

  /* ---- which logs to show ---- */
  let logsAll = (r.logs || []).slice().sort((a, b) => a.id - b.id);
  if (!showClosed) logsAll = logsAll.filter((l) => l.status !== "closed");

  const statusPill = (st: string): CSSProperties => {
    const m = statusMeta(st);
    return { display: "inline-block", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: ".04em", color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, padding: "2px 7px", borderRadius: 4, flexShrink: 0 };
  };

  /* ---- tallies (about-your-venue page) ---- */
  const um = severityMeta("urgent");
  const nm = severityMeta("necessary");
  const bm = severityMeta("basic");
  const tallies = [
    { count: c.urgent.open, label: "Urgent", sub: "open repairs", ink: um.ink, bd: um.bd, soft: um.soft },
    { count: c.necessary.open, label: "Necessary", sub: "open repairs", ink: nm.ink, bd: nm.bd, soft: nm.soft },
    { count: c.basic.open, label: "Basic", sub: "improvements", ink: bm.ink, bd: bm.bd, soft: bm.soft },
    { count: c.closed, label: "Closed", sub: "resolved", ink: "#1f7a52", bd: "#cce9da", soft: "#eaf6ef" },
  ];
  const hasPrior = !!r.priorSurveyDate;
  const priorLine = hasPrior ? "Compared against the prior inspection of " + fmtLong(r.priorSurveyDate) + ". Open logs carried forward retain their first-noted date." : "";

  /* ---- summary groups ---- */
  const sevOrder: Array<"urgent" | "necessary" | "basic"> = ["urgent", "necessary", "basic"];
  const summaryGroups = sevOrder
    .map((sk) => {
      const m = severityMeta(sk);
      const rows = logsAll.filter((l) => l.severity === sk);
      if (!rows.length) return null;
      return { key: sk, label: m.long, bar: m.bar, ink: m.ink, rows };
    })
    .filter(Boolean) as Array<{ key: string; label: string; bar: string; ink: string; rows: InspectionLog[] }>;

  /* ---- detail log photo/section styles ---- */
  const sectionLabelStyle: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: accentInk };
  const textStyle: CSSProperties = { fontSize: 12.5, lineHeight: 1.6, color: "#3a3f4a", margin: "7px 0 0" };
  const stdPill: CSSProperties = { display: "inline-block", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "3px 8px", borderRadius: 4 };

  const photoBox = (kind: "before" | "after", dataUrl: string | null) => {
    const cap = kind === "after" ? "Photo · after" : "Photo · before";
    const label = kind === "after" ? "AFTER PHOTO" : "BEFORE PHOTO";
    const imgH = isDossier ? "2.7in" : "2.4in";
    return (
      <div className="rp-photo" style={{ display: "flex", flexDirection: "column", gap: 6, ...(isReport ? { flex: 1, minWidth: 0 } : {}) }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "#aab0bb" }}>{cap}</div>
        {dataUrl ? (
          <img src={dataUrl} alt={cap} style={{ width: "100%", height: imgH, objectFit: "cover", borderRadius: 4, border: "1px solid #e4e7ec", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: imgH, borderRadius: 4, border: "1px solid #e4e7ec", background: STRIPE, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".14em", color: "#a3a9b3" }}>{label}</span>
          </div>
        )}
      </div>
    );
  };

  /* ---- one-up detail-log overflow plan (bug #2) ----
   * report/dossier one-up sheets used to render explanation + solution/
   * work-performed uncapped, so a log with a lot of text could overflow
   * its 11in sheet. Estimate the rendered height of the photo column and
   * the text column and, when the full sheet wouldn't fit, drop the
   * work-performed/solution block (and the photos too, if it's still too
   * tall) onto a continuation sheet rather than letting the sheet grow. */
  const DETAIL_HEADER_PX = 130; // severity/status pills + title + location + border/padding
  const DETAIL_BODY_TOP_PAD = 20; // paddingTop above the photo/text area
  const DETAIL_TEXT_COL_IN = isDossier ? 6.9 : 3.9; // stacked full-width vs. grid's "1fr" column
  const detailPhotoPx = (l: InspectionLog): number => {
    const single = isDossier ? 276 : 247; // image height + label + gap, per photoBox()
    if (l.status !== "closed") return single;
    // closed logs show before + after: stacked (report/compact) sums the two; side-by-side (dossier) doesn't.
    return isDossier ? single : single * 2 + 12;
  };
  const detailTextPx = (l: InspectionLog, includeBody: boolean): number => {
    const explPx = estTextBlockPx(estLineCount(l.explanation, DETAIL_TEXT_COL_IN, 12.5), 12.5, 1.6, 12) + ((l.standards || []).length ? 28 : 0);
    if (!includeBody) return explPx;
    const bodyText = l.status === "closed" ? l.workPerformed || "—" : l.solution || "—";
    const bodyPx = estTextBlockPx(estLineCount(bodyText, DETAIL_TEXT_COL_IN, 12.5), 12.5, 1.6, 32);
    const fnYear = yearOf(l.firstNoted);
    const curYear = yearOf(r.surveyDate);
    const hasFirstNoted = !!l.firstNoted && !!fnYear && !!curYear && String(fnYear) !== String(curYear);
    return explPx + bodyPx + (hasFirstNoted ? 30 : 0);
  };
  const detailTotalPx = (l: InspectionLog, includeBody: boolean, includePhotos: boolean): number => {
    const photos = includePhotos ? detailPhotoPx(l) : 0;
    const text = detailTextPx(l, includeBody);
    // dossier stacks photos above text (sum); report/compact run them side
    // by side in a grid (row height = the taller of the two columns).
    const area = isDossier ? photos + text + (includePhotos ? 16 : 0) : Math.max(photos, text);
    return DETAIL_HEADER_PX + DETAIL_BODY_TOP_PAD + area;
  };
  const planDetailLog = (l: InspectionLog): { moveBody: boolean; movePhotos: boolean } => {
    if (detailTotalPx(l, true, true) <= SHEET_CONTENT_BUDGET_PX) return { moveBody: false, movePhotos: false };
    if (detailTotalPx(l, false, true) <= SHEET_CONTENT_BUDGET_PX) return { moveBody: true, movePhotos: false };
    // Still too tall with just the photos — move both. If explanation alone
    // is still too long (rare), the print-CSS overflow:visible safety net
    // (page.tsx) plus break-inside:avoid keep it from clipping mid-row.
    return { moveBody: true, movePhotos: true };
  };

  const detailLog = (l: InspectionLog, opts?: { hidePhotos?: boolean; hideBody?: boolean }) => {
    const hidePhotos = !!opts?.hidePhotos;
    const hideBody = !!opts?.hideBody;
    const m = severityMeta(l.severity);
    const isClosed = l.status === "closed";
    const bodyLabel = isClosed ? "Work performed" : "Recommended solution";
    const bodyText = isClosed ? l.workPerformed || "—" : l.solution || "—";
    const fnYear = yearOf(l.firstNoted);
    const curYear = yearOf(r.surveyDate);
    const hasFirstNoted = !!l.firstNoted && !!fnYear && !!curYear && String(fnYear) !== String(curYear);
    const firstNotedLine = hasFirstNoted
      ? "First noted during the " + fmtLong(l.firstNoted).replace(/ \d+,/, ",") + " inspection; still present as of " + fmtLong(r.surveyDate).replace(/ \d+,/, ",") + "."
      : "";
    return (
      <div key={l.id} className="rp-sheet" style={sheet}>
        {head}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0.5in 0.7in" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, paddingBottom: 16, borderBottom: isDossier ? "2px solid #16181d" : `4px solid ${m.bar}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, padding: "4px 11px", borderRadius: 20 }}>{m.long}</span>
                <span style={statusPill(l.status)}>{statusMeta(l.status).label}</span>
              </div>
              <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-.01em", lineHeight: 1.2, marginTop: 12 }}>{l.problem}</div>
              {(l.location || "").trim() && <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 5 }}>Location · {l.location}</div>}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>LOG</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 600, lineHeight: 1 }}>{l.id}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb", marginTop: 5 }}>SVID {l.svid}</div>
            </div>
          </div>

          <div style={isDossier ? { flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 18 } : { flex: 1, display: "grid", gridTemplateColumns: "2.9in 1fr", gap: 22, paddingTop: 20 }}>
            {!hidePhotos && (
              <div style={isDossier ? { display: "flex", gap: 12 } : { display: "flex", flexDirection: "column", gap: 12 }}>
                {photoBox("before", l.beforePhoto)}
                {isClosed && photoBox("after", l.afterPhoto)}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={sectionLabelStyle}>Explanation of problem</div>
              <p style={textStyle}>{l.explanation || "—"}</p>
              {(l.standards || []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                  {(l.standards || []).map((s, i) => (
                    <span key={i} style={stdPill}>{s}</span>
                  ))}
                </div>
              )}
              {!hideBody && (
                <>
                  <div style={{ ...sectionLabelStyle, marginTop: 20 }}>{bodyLabel}</div>
                  <p style={textStyle}>{bodyText}</p>
                  {hasFirstNoted && <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 14, fontStyle: "italic" }}>{firstNotedLine}</div>}
                </>
              )}
            </div>
          </div>
        </div>
        {foot}
      </div>
    );
  };

  /** Continuation sheet for whatever `detailLog` had to drop — same running
   *  head/foot, a small "(continued)" marker, and just the moved photos
   *  and/or body block. */
  const detailLogContinued = (l: InspectionLog, showPhotos: boolean, showBody: boolean) => {
    const m = severityMeta(l.severity);
    const isClosed = l.status === "closed";
    const bodyLabel = isClosed ? "Work performed" : "Recommended solution";
    const bodyText = isClosed ? l.workPerformed || "—" : l.solution || "—";
    return (
      <div key={l.id + "-cont"} className="rp-sheet" style={sheet}>
        {head}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0.5in 0.7in" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, borderBottom: `2px solid ${m.bar}` }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9aa0ab", flexShrink: 0 }}>LOG {l.id}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#16181d", minWidth: 0, flex: 1 }}>{l.problem}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", fontStyle: "italic", flexShrink: 0 }}>(continued)</span>
          </div>
          <div style={isDossier ? { display: "flex", flexDirection: "column", gap: 16, paddingTop: 18 } : { display: "flex", gap: 22, paddingTop: 20 }}>
            {showPhotos && (
              <div style={isDossier ? { display: "flex", gap: 12 } : { display: "flex", flexDirection: "column", gap: 12 }}>
                {photoBox("before", l.beforePhoto)}
                {isClosed && photoBox("after", l.afterPhoto)}
              </div>
            )}
            {showBody && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={sectionLabelStyle}>{bodyLabel}</div>
                <p style={textStyle}>{bodyText}</p>
              </div>
            )}
          </div>
        </div>
        {foot}
      </div>
    );
  };

  /** One-up detail sheet(s) for a single log — 1 sheet when it fits, 2 when
   *  `planDetailLog` had to move content off. */
  const detailLogSheets = (l: InspectionLog): ReactNode[] => {
    const plan = planDetailLog(l);
    if (!plan.moveBody && !plan.movePhotos) return [detailLog(l)];
    return [detailLog(l, { hidePhotos: plan.movePhotos, hideBody: plan.moveBody }), detailLogContinued(l, plan.movePhotos, plan.moveBody)];
  };

  /* ---- compact 2-up detail pages ----
   * Real-DOM measurement showed a fixed "6 logs/page" (3 grid-rows of 2)
   * routinely overflowed by 200px+ — each card runs ~330-360px tall once
   * its photo box + explanation + solution/work-performed text are
   * accounted for, and 3 rows of those don't fit one sheet. Pack cards two
   * at a time (matching the CSS grid's own row-pairing) by estimated
   * height instead of a fixed count. */
  const CARD_TEXT_COL_IN = 3.15; // inner card width (half the 2-col grid, minus card padding/gap), conservative
  const compactClip = (s: string | null | undefined, max: number): string => {
    const t = s || "";
    return t.length > max ? t.slice(0, max - 2).replace(/\s+\S*$/, "") + "…" : t || "—";
  };
  const compactCardPx = (l: InspectionLog): number => {
    const isClosed = l.status === "closed";
    const bodyText = isClosed ? l.workPerformed || "—" : l.solution || "—";
    const expShort = compactClip(l.explanation, 190);
    const bodyShort = compactClip(bodyText, 150);
    return (
      28 /* card padding(26) + border(2) */ +
      20 /* header row: dot + "LOG N" + status pill */ +
      estTextBlockPx(estLineCount(l.problem, CARD_TEXT_COL_IN, 14), 14, 1.5, 9) /* title, marginTop9 */ +
      122 /* photo box: 1.15in + label/marginTop + border */ +
      estTextBlockPx(estLineCount(expShort, CARD_TEXT_COL_IN, 11.5), 11.5, 1.5, 10) +
      24 /* "Work performed"/"Recommended solution" label, marginTop11 */ +
      estTextBlockPx(estLineCount(bodyShort, CARD_TEXT_COL_IN, 11.5), 11.5, 1.5, 3)
    );
  };
  const COMPACT_HEADER_PX = 55; // h1(39) + marginBottom16, page 1 only
  const compactPages: InspectionLog[][] = [];
  {
    let cur: InspectionLog[] = [];
    let used = COMPACT_HEADER_PX;
    for (let i = 0; i < logsAll.length; i += 2) {
      const pair = logsAll.slice(i, i + 2);
      const rowGap = cur.length > 0 ? 14 : 0;
      const rowPx = Math.max(...pair.map(compactCardPx));
      if (used + rowGap + rowPx > SHEET_CONTENT_BUDGET_PX && cur.length > 0) {
        compactPages.push(cur);
        cur = [];
        used = 0;
      }
      const gap = cur.length > 0 ? 14 : 0;
      cur.push(...pair);
      used += gap + rowPx;
    }
    if (cur.length) compactPages.push(cur);
  }

  /* ---- rubric appendix pagination ---- */
  const rub = r.rubric || [];
  const hasRubricData = rub.length > 0;
  const showRubricPage = hasRubricData && showRubric;
  type RubRow =
    | { kind: "group"; label: string }
    | { kind: "section"; title: string; meta: string; comments: string }
    | { kind: "item"; letter: string; label: string; rating: string | null };
  let rubRated = 0;
  let rubTotal = 0;
  const rubricPages: RubRow[][] = [];
  let rubricStandfirst = "";
  if (hasRubricData) {
    const rows: RubRow[] = [];
    let lastG: string | null = null;
    rub.forEach((sec) => {
      if (sec.group !== lastG) {
        rows.push({ kind: "group", label: sec.group });
        lastG = sec.group;
      }
      rows.push({ kind: "section", title: sec.n + ". " + sec.title, meta: sec.lineSet ? "Line set " + sec.lineSet : "", comments: (sec.comments || "").trim() });
      sec.items.forEach((it) => {
        rubTotal++;
        if (it.rating) rubRated++;
        rows.push({ kind: "item", letter: it.l, label: it.label, rating: it.rating });
      });
    });
    // Real px budgeting, calibrated against actual rendered heights (via a
    // Playwright probe against the dev server — see PR notes). The old
    // budget used an arbitrary "40 units" scale with flat per-row costs
    // that turned out far too generous relative to what a page actually
    // holds (real pages were overflowing by 200px+ regardless of comment
    // length), so this switches to the same px-estimate + paginateByHeight
    // machinery the other sections use.
    const RUBRIC_COMMENT_COL_IN = 6.9;
    const GROUP_ROW_PX = 30; // label line (fontSize10, default 1.5 line-height) + 15px marginTop
    const SECTION_BASE_PX = 33.5; // marginTop9 + padding/border4.5 + title/meta row (fontSize13, 1.5 line-height)
    const SECTION_COMMENT_CHROME_PX = 3; // marginTop above the comment line
    const SECTION_COMMENT_LINE_PX = 16.5; // comment line at fontSize11, default 1.5 line-height
    const ITEM_ROW_PX = 29; // padding 5px x2 + border1 + fontSize12, default 1.5 line-height
    const COLUMN_HEADER_PX = 38; // repeats on every page: own height(22) + marginTop16
    const rubricRowPx = (row: RubRow): number => {
      if (row.kind === "group") return GROUP_ROW_PX;
      if (row.kind === "item") return ITEM_ROW_PX;
      return row.comments
        ? SECTION_BASE_PX + SECTION_COMMENT_CHROME_PX + estLineCount(row.comments, RUBRIC_COMMENT_COL_IN, 11) * SECTION_COMMENT_LINE_PX
        : SECTION_BASE_PX;
    };
    rubricStandfirst = "Every rigging component was visually inspected and rated — " + rubRated + " of " + rubTotal + " items assessed. This log documents the full walkthrough for your reference.";
    const rubricStandfirstPx = estTextBlockPx(estLineCount(rubricStandfirst, 7.0, 12.5), 12.5, 1.55);
    // Page-1 overhead: h1(39) + marginTop6 + standfirst + marginTop12 +
    // ratings legend row(16) + the column-header row (which then repeats
    // on every page, incl. continuations, via COLUMN_HEADER_PX below).
    const RUBRIC_HEADER_PX = 39 + 6 + rubricStandfirstPx + 12 + 16 + COLUMN_HEADER_PX;
    rubricPages.push(...paginateByHeight(rows, rubricRowPx, SHEET_CONTENT_BUDGET_PX, RUBRIC_HEADER_PX, COLUMN_HEADER_PX));
  }

  /* ---- venue information ---- */
  const vi = r.venueInfo || {};
  const ms = r.measurements || {};
  const dash = (v: string | undefined) => (v && String(v).trim() ? v : "—");
  const venueRows: Array<{ k: string; v: string }> = [
    { k: "Customer", v: r.customer || "—" },
    { k: "Venue", v: (r.venue || "—") + (r.venueType ? " · " + r.venueType : "") },
    { k: "Address", v: r.address || "—" },
    { k: "Built / installed", v: dash(vi.yearBuilt) },
    { k: "Current use", v: dash(vi.currentUse) },
    { k: "On-site contact", v: (r.contact || "—") + (r.contactPhone ? " · " + r.contactPhone : "") },
    { k: "Inspector", v: r.inspector || "—" },
    { k: "Last inspection", v: r.priorSurveyDate ? fmtLong(r.priorSurveyDate) : "No prior on record" },
  ];
  if ((vi.ownerConcerns || "").trim()) venueRows.push({ k: "Owner concerns", v: vi.ownerConcerns });
  const systemRows = SYSTEM_FIELDS.filter((f) => (vi[f.key] || "").trim()).map((f) => ({ k: f.label, v: vi[f.key] }));
  const hasSystem = systemRows.length > 0;
  const measurementGroups = MEASUREMENT_GROUPS.map((g) => {
    const items = g.items.filter((it) => (ms[it.key] || "").trim()).map((it) => ({ label: it.label, value: ms[it.key] }));
    return items.length ? { group: g.group, items } : null;
  }).filter(Boolean) as Array<{ group: string; items: Array<{ label: string; value: string }> }>;
  const hasMeasurements = measurementGroups.length > 0;
  const venueStandfirst = "The physical facts of the venue and its rigging system" + (hasMeasurements ? ", with stage measurements recorded during the site visit." : ".");

  /* ---- venue information pagination ----
   * This page used to be a single always-one-sheet render. A fully filled
   * out record (kv table + system & equipment + stage measurements) is
   * routinely taller than one sheet on its own — not just with an unusually
   * long "Owner concerns" note — so it needs the same chunk-when-it-
   * overflows treatment as the other appendix sections. Rows, then the
   * system block, then the measurements block are packed in order (same
   * order they render in); a long kv table can itself spill across pages,
   * and the system/measurements blocks land wherever they fit. */
  type VenueItem = { kind: "row"; vr: { k: string; v: string } } | { kind: "system" } | { kind: "measurements" };
  const VENUE_ROW_VAL_COL_IN = 4.7; // value column: 2.1in-label kv box, minus padding
  const venueRowPx = (vr: { k: string; v: string }) => estTextBlockPx(estLineCount(vr.v, VENUE_ROW_VAL_COL_IN, 13.5), 13.5, 1.5, 21);
  const SYSTEM_VAL_COL_IN = 3.3; // half of the 2-col system grid, minus gap/padding
  const systemItemPx = (v: string) => estTextBlockPx(estLineCount(v, SYSTEM_VAL_COL_IN, 12.5), 12.5, 1.5, 15);
  // Grid rows pair 2 items per visual row (34px baseline each); a wrapped
  // value only grows its own pair, but summing the excess across all items
  // is a conservative stand-in for "which pair" without tracking pairing.
  const systemRowsPx = hasSystem ? Math.ceil(systemRows.length / 2) * 34 + systemRows.reduce((sum, sr) => sum + Math.max(0, systemItemPx(sr.v) - 34), 0) : 0;
  const systemBlockPx = hasSystem ? 26 /* marginTop */ + 23 /* h2 */ + 12 /* marginTop */ + systemRowsPx : 0;
  // measurementGroups render as a 3-col CSS grid — all columns stretch to
  // the tallest group's natural height, so the grid's height is that max.
  const measurementsGridPx = hasMeasurements ? Math.max(...measurementGroups.map((g) => 20 + g.items.length * 31)) : 0;
  const measurementsBlockPx = hasMeasurements ? 26 /* marginTop */ + 23 /* h2 */ + 14 /* marginTop */ + measurementsGridPx + 14 /* marginTop */ + 16 /* footnote */ : 0;
  const venueStandfirstPx = estTextBlockPx(estLineCount(venueStandfirst, 7.0, 12.5), 12.5, 1.55);
  const VENUE_HEADER_PX = 39 /* h1 */ + 6 /* marginTop */ + venueStandfirstPx + 20; /* marginTop before the kv box */
  const VENUE_CONT_HEADER_PX = 39 /* "(continued)" h1 */ + 20;
  const venueItems: VenueItem[] = venueRows.map((vr) => ({ kind: "row" as const, vr }));
  if (hasSystem) venueItems.push({ kind: "system" });
  if (hasMeasurements) venueItems.push({ kind: "measurements" });
  const venueItemPx = (item: VenueItem): number => (item.kind === "row" ? venueRowPx(item.vr) : item.kind === "system" ? systemBlockPx : measurementsBlockPx);
  const venuePages: VenueItem[][] = paginateByHeight(venueItems, venueItemPx, SHEET_CONTENT_BUDGET_PX, VENUE_HEADER_PX, VENUE_CONT_HEADER_PX);

  /* ---- recommendations ---- */
  const recRank: Record<string, number> = { urgent: 0, necessary: 1, basic: 2 };
  const recOpen = (r.logs || [])
    .filter((l) => l.status !== "closed")
    .slice()
    .sort((a, b) => (recRank[a.severity] - recRank[b.severity]) || a.id - b.id);
  const recRows = recOpen.map((l, i) => ({
    num: String(i + 1),
    sev: severityMeta(l.severity),
    problem: l.problem || "Untitled finding",
    text: (l.solution || "").trim() || "Corrective action to be determined on site.",
    logRef: "#" + l.id,
  }));
  const recEmpty = recRows.length === 0;
  // Column widths (in): full 7.1in content width minus the #/priority/log
  // columns and their gaps, minus the row's own right padding.
  const REC_TEXT_COL_IN = 4.9;
  const recRowPx = (rr: (typeof recRows)[number]) => {
    const titlePx = estTextBlockPx(estLineCount(rr.problem, REC_TEXT_COL_IN, 12.5), 12.5, 1.35);
    const bodyPx = estTextBlockPx(estLineCount(rr.text, REC_TEXT_COL_IN, 11.5), 11.5, 1.5, 2 /* marginTop */);
    return 21 /* row padding (20) + border (1) */ + titlePx + bodyPx;
  };
  // Header block: h1 + standfirst + marginTop to the table (page 1 only);
  // the column-header row itself repeats on every page (below).
  const REC_HEADER_PX = 90;
  const REC_CONT_HEADER_PX = 38;
  const recPages: typeof recRows[] = paginateByHeight(recRows, recRowPx, SHEET_CONTENT_BUDGET_PX, REC_HEADER_PX, REC_CONT_HEADER_PX);
  const recStandfirst = c.open + " open finding" + (c.open === 1 ? "" : "s") + " to address, prioritized Urgent → Necessary → Basic. Closed items are omitted.";
  const recBasis = "Recommendations are based on OSHA 1910 fall-protection standards, NFPA 80 & 101 life-safety codes, and the ANSI E1 entertainment-technology series (E1.4 counterweight rigging, E1.22 fire-safety curtain).";
  const renovationText = "The most effective way to resolve these findings is a renovation package that addresses the open Urgent and Necessary repairs together so the venue can operate safely. Because of the potential structural concerns noted above and the number of findings across the system, the logs above are not individually estimated — a consolidated renovation budget is prepared separately and can be started from this report.";

  /* ---- rigging log summary pagination ----
   * Bug #1: this used to render every open+closed log on one sheet with no
   * chunking at all, so a venue with a lot of findings would overflow the
   * page. Flatten group headers + log rows into one list (same pattern as
   * the rubric appendix above) and pack them by estimated height. When it
   * all fits on one sheet (the common case), we render the original
   * single-sheet, single-group-wrapper markup unchanged below so small
   * reports keep their exact look and page count. */
  type SummaryRow =
    | { kind: "group"; key: string; label: string; bar: string; ink: string; count: number; first: boolean }
    | { kind: "log"; log: InspectionLog };
  const summaryFlat: SummaryRow[] = [];
  summaryGroups.forEach((g, gi) => {
    summaryFlat.push({ kind: "group", key: g.key, label: g.label, bar: g.bar, ink: g.ink, count: g.rows.length, first: gi === 0 });
    g.rows.forEach((l) => summaryFlat.push({ kind: "log", log: l }));
  });
  // Problem-text column: 7.1in content width minus the id column, the
  // status pill, and the two 13px flex gaps between them.
  const SUMMARY_ROW_TEXT_COL_IN = 5.6;
  const summaryRowPx = (row: SummaryRow): number => {
    if (row.kind === "group") return (row.first ? 0 : 18) /* group gap */ + 33 /* header row + border */;
    return estTextBlockPx(estLineCount(row.log.problem, SUMMARY_ROW_TEXT_COL_IN, 13), 13, 1.35, 17 /* row padding + border */);
  };
  // Header block: h1 + standfirst + marginTop to the list (page 1 only).
  const SUMMARY_HEADER_PX = 72;
  const SUMMARY_CONT_HEADER_PX = 37; // h1 "(continued)" + marginTop to the list
  const summaryPages: SummaryRow[][] = paginateByHeight(summaryFlat, summaryRowPx, SHEET_CONTENT_BUDGET_PX, SUMMARY_HEADER_PX, SUMMARY_CONT_HEADER_PX);

  const wrap = (children: ReactNode, key?: string) => (
    <div key={key} className="rp-sheet" style={sheet}>
      {head}
      <div style={{ flex: 1, padding: "0.5in 0.7in" }}>{children}</div>
      {foot}
    </div>
  );

  return (
    <>
      {/* ============ COVER ============ */}
      {isReport && (
        <div className="rp-sheet" style={{ ...sheet }}>
          <div style={{ padding: "0.62in 0.7in 0.4in" }}>
            {letterhead}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0.66in 0.7in 0.62in" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
              <span style={coverConditionStyle}>{cond.label}</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, letterSpacing: ".34em", textTransform: "uppercase", color: accent }}>Rigging Inspection Report</div>
              <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.02, marginTop: 18, color: "#16181d" }}>{r.venue || "—"}</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: "#5b616e", marginTop: 12 }}>{r.customer || "—"}</div>
              <div style={{ fontSize: 14, color: "#8c919c", marginTop: 6 }}>{r.address}</div>
            </div>
            <div style={{ display: "flex", gap: 40, paddingTop: 22, borderTop: "1px solid #e4e7ec" }}>
              <CoverMeta label="Survey date" value={surveyDateLong} />
              <CoverMeta label="Report date" value={reportDateLong} />
              <CoverMeta label="Inspector" value={r.inspector || "—"} />
            </div>
          </div>
        </div>
      )}
      {isDossier && (
        <div className="rp-sheet" style={{ ...sheet, padding: "0.8in 0.8in" }}>
          <div style={{ borderBottom: "3px solid #16181d", paddingBottom: 12 }}>
            {letterhead}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 9 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c" }}>DOC {docId}</span>
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, letterSpacing: ".28em", textTransform: "uppercase", color: accent, marginTop: 54 }}>Rigging Inspection Report</div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.015em", lineHeight: 1.05, marginTop: 14 }}>{r.venue || "—"}</div>
          <div style={{ fontSize: 18, color: "#5b616e", marginTop: 8 }}>{(r.customer || "—") + " · " + (r.address || "")}</div>
          <div style={{ marginTop: 44, border: "1px solid #e4e7ec", borderRadius: 2 }}>
            {[
              { k: "Customer", v: r.customer || "—" },
              { k: "Venue", v: (r.venue || "—") + " · " + (r.venueType || "") },
              { k: "Address", v: r.address || "—" },
              { k: "Survey date", v: surveyDateLong },
              { k: "Report date", v: reportDateLong },
              { k: "Inspector", v: r.inspector || "—" },
              { k: "Condition", v: cond.label },
            ].map((row) => (
              <div key={row.k} className="rp-kv-row" style={{ display: "flex", borderBottom: "1px solid #eceef1" }}>
                <div style={{ width: "2.3in", flexShrink: 0, padding: "12px 15px", fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#8c919c", background: "#fafbfc", borderRight: "1px solid #eceef1" }}>{row.k}</div>
                <div style={{ flex: 1, padding: "12px 15px", fontSize: 14, fontWeight: 600 }}>{row.v}</div>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11.5, color: "#aab0bb", lineHeight: 1.5 }}>{footerText}</div>
        </div>
      )}
      {isCompact && (
        <div className="rp-sheet" style={{ ...sheet, padding: "1in 0.9in", alignItems: "stretch", textAlign: "center", justifyContent: "space-between" }}>
          <div style={{ position: "relative", zIndex: 1 }}>
            <img
              src={logoDark || peakLetterhead.src}
              alt={companyName}
              style={logoDark
                ? { display: "block", maxHeight: 72, maxWidth: "4.2in", objectFit: "contain", margin: "0 auto" }
                : { display: "block", width: "100%", maxWidth: "6.3in", height: "auto", margin: "0 auto" }}
            />
            <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 16, lineHeight: 1.55 }}>
              Consultation &nbsp;·&nbsp; Design &nbsp;·&nbsp; Installation
              <br />
              Audio, Video, Lighting, Rigging, and Curtains Systems
            </div>
          </div>
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: ".3em", textTransform: "uppercase", color: accent }}>Rigging Inspection Report</div>
            <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.04, marginTop: 14, color: "#16181d" }}>{r.venue || "—"}</div>
            <div style={{ fontSize: 18, color: "#5b616e", marginTop: 10 }}>{r.customer || "—"}</div>
            <span style={{ ...coverConditionStyle, margin: "22px auto 0" }}>{cond.label}</span>
          </div>
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
              <CoverMeta label="Surveyed" value={surveyDateLong} center />
              <CoverMeta label="Reported" value={reportDateLong} center />
              <CoverMeta label="Inspector" value={r.inspector || "—"} center />
            </div>
            <div style={{ borderTop: "1px solid #e4e7ec", marginTop: 22, paddingTop: 14, fontSize: 11, color: "#8c919c", lineHeight: 1.65 }}>
              {footerText}
            </div>
          </div>
        </div>
      )}

      {/* ============ BOILERPLATE ============ */}
      {showBoiler && (
        <>
          {wrap(
            <>
              <div style={h2}>About {companyName}</div>
              <p style={prose}>{boiler.about}</p>
              <div style={{ ...h2, marginTop: 26 }}>Our standards</div>
              <p style={prose}>{boiler.standardsIntro}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 14 }}>
                {boiler.standards.map((s) => (
                  <div key={s.name} style={{ display: "flex", gap: 13, alignItems: "baseline" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: accentInk, minWidth: "1.1in", flexShrink: 0 }}>{s.name}</span>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "#3a3f4a" }}>{s.desc}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...h2, marginTop: 26 }}>Our mission</div>
              <p style={prose}>{boiler.mission}</p>
            </>,
            "boiler-1"
          )}
          {wrap(
            <>
              <div style={h2}>The inspection</div>
              <p style={prose}>{boiler.inspectionPurpose}</p>
              <div style={{ ...h2, marginTop: 26 }}>How to use this report</div>
              <p style={prose}>{boiler.howToUse}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
                {SEVERITIES.map((sv) => {
                  const m = severityMeta(sv.key);
                  return (
                    <div key={sv.key} style={{ border: `1px solid ${m.bd}`, background: m.soft, borderRadius: 5, padding: 13 }}>
                      <div style={{ display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: ".02em", color: m.ink }}>{sv.long}</div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#3a3f4a", marginTop: 9 }}>{sv.blurb}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ ...h2, marginTop: 26 }}>Disclaimer</div>
              <p style={{ ...prose, color: "#5b616e", fontSize: 12 }}>{boiler.disclaimer}</p>
            </>,
            "boiler-2"
          )}
        </>
      )}

      {/* ============ VENUE INFORMATION ============ */}
      {venuePages.length <= 1 ? (
        // Everything fits on one sheet — render the original unchunked
        // markup verbatim so small/typical reports keep their exact look.
        wrap(
          <>
            <div style={h1}>Venue information</div>
            <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6, lineHeight: 1.55 }}>{venueStandfirst}</div>
            <div style={{ marginTop: 20, border: "1px solid #e4e7ec", borderRadius: 4 }}>
              {venueRows.map((vr) => (
                <div key={vr.k} className="rp-kv-row" style={{ display: "flex", borderBottom: "1px solid #eceef1" }}>
                  <div style={{ width: "2.1in", flexShrink: 0, padding: "10px 15px", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: "#8c919c", background: "#fafbfc", borderRight: "1px solid #eceef1" }}>{vr.k}</div>
                  <div style={{ flex: 1, padding: "10px 15px", fontSize: 13.5, fontWeight: 600 }}>{vr.v}</div>
                </div>
              ))}
            </div>
            {hasSystem && (
              <>
                <div style={{ ...h2, marginTop: 26 }}>System &amp; equipment</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 26px", marginTop: 12 }}>
                  {systemRows.map((sr) => (
                    <div key={sr.k} className="rp-kv-row" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #f0f1f4" }}>
                      <span style={{ fontSize: 11.5, color: "#8c919c", flexShrink: 0 }}>{sr.k}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>{sr.v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {hasMeasurements && (
              <>
                <div style={{ ...h2, marginTop: 26 }}>Stage measurements</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginTop: 14 }}>
                  {measurementGroups.map((mg) => (
                    <div key={mg.group}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: accentInk, paddingBottom: 6, borderBottom: "2px solid #16181d" }}>{mg.group}</div>
                      {mg.items.map((mi) => (
                        <div key={mi.label} className="rp-kv-row" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid #f4f5f7" }}>
                          <span style={{ fontSize: 11, color: "#5b616e", lineHeight: 1.3 }}>{mi.label}</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "#16181d", flexShrink: 0 }}>{mi.value}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 14, lineHeight: 1.5 }}>Field dimensions are approximate; verify against architectural drawings before fabrication.</div>
              </>
            )}
          </>,
          "venue-info"
        )
      ) : (
        // Overflowed one sheet — rows (then system, then measurements) packed
        // by estimated height; continuation sheets title " (continued)".
        venuePages.map((items, pi) =>
          wrap(
            <>
              <div style={h1}>{"Venue information" + (pi === 0 ? "" : " (continued)")}</div>
              {pi === 0 && <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6, lineHeight: 1.55 }}>{venueStandfirst}</div>}
              {(() => {
                const out: ReactNode[] = [];
                let i = 0;
                while (i < items.length) {
                  const item = items[i];
                  if (item.kind === "row") {
                    const rowsChunk: Array<{ k: string; v: string }> = [];
                    while (i < items.length && items[i].kind === "row") {
                      rowsChunk.push((items[i] as { kind: "row"; vr: { k: string; v: string } }).vr);
                      i++;
                    }
                    out.push(
                      <div key="kv" style={{ marginTop: 20, border: "1px solid #e4e7ec", borderRadius: 4 }}>
                        {rowsChunk.map((vr) => (
                          <div key={vr.k} className="rp-kv-row" style={{ display: "flex", borderBottom: "1px solid #eceef1" }}>
                            <div style={{ width: "2.1in", flexShrink: 0, padding: "10px 15px", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: "#8c919c", background: "#fafbfc", borderRight: "1px solid #eceef1" }}>{vr.k}</div>
                            <div style={{ flex: 1, padding: "10px 15px", fontSize: 13.5, fontWeight: 600 }}>{vr.v}</div>
                          </div>
                        ))}
                      </div>
                    );
                  } else if (item.kind === "system") {
                    out.push(
                      <div key="system" style={{ marginTop: 26 }}>
                        <div style={h2}>System &amp; equipment</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 26px", marginTop: 12 }}>
                          {systemRows.map((sr) => (
                            <div key={sr.k} className="rp-kv-row" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #f0f1f4" }}>
                              <span style={{ fontSize: 11.5, color: "#8c919c", flexShrink: 0 }}>{sr.k}</span>
                              <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>{sr.v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                    i++;
                  } else {
                    out.push(
                      <div key="measurements" style={{ marginTop: 26 }}>
                        <div style={h2}>Stage measurements</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginTop: 14 }}>
                          {measurementGroups.map((mg) => (
                            <div key={mg.group}>
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: accentInk, paddingBottom: 6, borderBottom: "2px solid #16181d" }}>{mg.group}</div>
                              {mg.items.map((mi) => (
                                <div key={mi.label} className="rp-kv-row" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid #f4f5f7" }}>
                                  <span style={{ fontSize: 11, color: "#5b616e", lineHeight: 1.3 }}>{mi.label}</span>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "#16181d", flexShrink: 0 }}>{mi.value}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 14, lineHeight: 1.5 }}>Field dimensions are approximate; verify against architectural drawings before fabrication.</div>
                      </div>
                    );
                    i++;
                  }
                }
                return out;
              })()}
            </>,
            "venue-info-" + pi
          )
        )
      )}

      {/* ============ ABOUT YOUR VENUE ============ */}
      {wrap(
        <>
          <div style={h1}>About your venue</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <span style={conditionBigStyle}>{cond.label}</span>
            <span style={{ fontSize: 13, color: "#8c919c" }}>as surveyed {surveyDateLong}</span>
          </div>
          <div style={{ marginTop: 22, padding: "16px 18px", background: "#fafbfc", border: "1px solid #eceef1", borderRadius: 4 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8c919c" }}>Scope of this inspection</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: "#2f333b", marginTop: 7 }}>{r.scope || "—"}</div>
          </div>
          <p style={{ ...prose, marginTop: 20 }}>{r.narrative || "A detailed condition narrative for this venue will appear here once the inspection is finalized."}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginTop: 26 }}>
            {tallies.map((t) => (
              <div key={t.label} style={{ border: `1px solid ${t.bd}`, background: t.soft, borderRadius: 6, padding: "15px 14px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 700, lineHeight: 1, color: t.ink }}>{t.count}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.ink, marginTop: 8 }}>{t.label}</div>
                <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 2 }}>{t.sub}</div>
              </div>
            ))}
          </div>
          {hasPrior && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 18, fontSize: 12, color: "#8c919c" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0 }} />
              <span>{priorLine}</span>
            </div>
          )}
        </>,
        "about-venue"
      )}

      {/* ============ COMPONENT CONDITION RUBRIC ============ */}
      {showRubricPage &&
        rubricPages.map((rows, pi) =>
          wrap(
            <>
              {pi === 0 && (
                <>
                  <div style={h1}>Component condition rubric</div>
                  <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6, lineHeight: 1.55 }}>{rubricStandfirst}</div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
                    {RUBRIC_RATINGS.map((rt) => (
                      <span key={rt.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#5b616e" }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, display: "inline-block", background: rt.bar }} />
                        {rt.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: "flex", alignItems: "center", marginTop: 16, padding: "0 0 6px", borderBottom: "2px solid #16181d", fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase", color: "#8c919c" }}>
                <span style={{ flex: 1 }}>Component</span>
                {RUBRIC_RATINGS.map((rt) => (
                  <span key={rt.key} style={{ width: 44, textAlign: "center" }}>{rt.label}</span>
                ))}
              </div>
              {rows.map((row, ri) => {
                if (row.kind === "group")
                  return (
                    <div key={ri} style={{ marginTop: 15, fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: accentInk }}>{row.label}</div>
                  );
                if (row.kind === "section")
                  return (
                    <div key={ri} style={{ marginTop: 9, paddingBottom: 4, borderBottom: "1px solid #eceef1" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#16181d" }}>{row.title}</span>
                        {row.meta && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9aa0ab" }}>{row.meta}</span>}
                      </div>
                      {row.comments && <div style={{ fontSize: 11, lineHeight: 1.5, color: "#5b616e", marginTop: 3 }}>{row.comments}</div>}
                    </div>
                  );
                return (
                  <div key={ri} className="rp-log-row" style={{ display: "flex", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #f4f5f7" }}>
                    <span style={{ flex: 1, fontSize: 12, color: "#3a3f4a" }}>
                      <b style={{ fontWeight: 600, color: "#aab0bb", fontFamily: "var(--font-mono)", fontSize: 10, marginRight: 8 }}>{row.letter}</b>
                      {row.label}
                    </span>
                    {RUBRIC_RATINGS.map((rt) => {
                      const on = row.rating === rt.key;
                      return (
                        <span key={rt.key} style={{ width: 44, flexShrink: 0, textAlign: "center", fontSize: on ? 12 : 11, fontWeight: on ? 700 : 400, color: on ? rt.ink : "#d0d4da" }}>{on ? "●" : "·"}</span>
                      );
                    })}
                  </div>
                );
              })}
            </>,
            "rubric-" + pi
          )
        )}

      {/* ============ RIGGING LOG SUMMARY ============ */}
      {summaryPages.length <= 1 ? (
        // Everything fits on one sheet — render the original unchunked
        // markup verbatim so small reports keep their exact look.
        wrap(
          <>
            <div style={h1}>Rigging log summary</div>
            <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6 }}>{c.open + " open · " + c.closed + " closed · " + c.total + " total findings"}</div>
            <div style={{ marginTop: 20 }}>
              {summaryGroups.map((g) => (
                <div key={g.key} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0 8px", borderBottom: `2px solid ${g.bar}` }}>
                    <span style={{ display: "inline-block", fontSize: 13, fontWeight: 800, letterSpacing: ".01em", color: g.ink }}>{g.label}</span>
                    <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>{g.rows.length + " log" + (g.rows.length === 1 ? "" : "s")}</span>
                  </div>
                  {g.rows.map((l) => (
                    <div key={l.id} className="rp-log-row" style={{ display: "flex", alignItems: "center", gap: 13, padding: "8px 2px", borderBottom: "1px solid #f0f1f4" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "#5b616e", width: 26, flexShrink: 0, textAlign: "right" }}>{l.id}</span>
                      <span style={statusPill(l.status)}>{statusMeta(l.status).label}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.35, flex: 1, minWidth: 0 }}>{l.problem}</span>
                    </div>
                  ))}
                </div>
              ))}
              {logsAll.length === 0 && <div style={{ padding: "40px 0", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>No logged findings in this inspection.</div>}
            </div>
          </>,
          "summary"
        )
      ) : (
        // Overflowed one sheet — same rows, chunked by estimated height.
        // Continuation sheets repeat the running head/foot (via `wrap`)
        // with the title suffixed " (continued)".
        summaryPages.map((rows, pi) =>
          wrap(
            <>
              <div style={h1}>{"Rigging log summary" + (pi === 0 ? "" : " (continued)")}</div>
              {pi === 0 && <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6 }}>{c.open + " open · " + c.closed + " closed · " + c.total + " total findings"}</div>}
              <div style={{ marginTop: 20 }}>
                {rows.map((row, ri) =>
                  row.kind === "group" ? (
                    <div key={"g" + row.key + pi} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0 8px", marginTop: ri === 0 ? 0 : 18, borderBottom: `2px solid ${row.bar}` }}>
                      <span style={{ display: "inline-block", fontSize: 13, fontWeight: 800, letterSpacing: ".01em", color: row.ink }}>{row.label}</span>
                      <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>{row.count + " log" + (row.count === 1 ? "" : "s")}</span>
                    </div>
                  ) : (
                    <div key={"l" + row.log.id} className="rp-log-row" style={{ display: "flex", alignItems: "center", gap: 13, padding: "8px 2px", borderBottom: "1px solid #f0f1f4" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "#5b616e", width: 26, flexShrink: 0, textAlign: "right" }}>{row.log.id}</span>
                      <span style={statusPill(row.log.status)}>{statusMeta(row.log.status).label}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.35, flex: 1, minWidth: 0 }}>{row.log.problem}</span>
                    </div>
                  )
                )}
              </div>
            </>,
            "summary-" + pi
          )
        )
      )}

      {/* ============ DETAIL LOGS ============ */}
      {oneUp && logsAll.flatMap((l) => detailLogSheets(l))}
      {isCompact &&
        compactPages.map((pageLogs, pi) =>
          wrap(
            <>
              {pi === 0 && <div style={{ ...h1, marginBottom: 16 }}>Rigging log detail</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {pageLogs.map((l) => {
                  const m = severityMeta(l.severity);
                  const isClosed = l.status === "closed";
                  const bodyText = isClosed ? l.workPerformed || "—" : l.solution || "—";
                  const expShort = compactClip(l.explanation, 190);
                  const bodyShort = compactClip(bodyText, 150);
                  return (
                    <div key={l.id} className="rp-log-row" style={{ border: "1px solid #e4e7ec", borderRadius: 5, borderTop: `4px solid ${m.bar}`, padding: "13px 14px", display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: m.bar }} />
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "#5b616e" }}>LOG {l.id}</span>
                        </div>
                        <span style={statusPill(l.status)}>{statusMeta(l.status).label}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, marginTop: 9 }}>{l.problem}</div>
                      <div style={{ marginTop: 10, height: "1.15in", borderRadius: 4, border: "1px solid #e4e7ec", overflow: "hidden", background: STRIPE, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {l.beforePhoto ? (
                          <img src={l.beforePhoto} alt="photo" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".1em", color: "#aab0bb" }}>{isClosed ? "BEFORE / AFTER" : "PHOTO"}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#3a3f4a", marginTop: 10 }}>{expShort}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#9aa0ab", marginTop: 11 }}>{isClosed ? "Work performed" : "Recommended solution"}</div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#3a3f4a", marginTop: 3 }}>{bodyShort}</div>
                    </div>
                  );
                })}
              </div>
            </>,
            "compact-" + pi
          )
        )}

      {/* ============ RECOMMENDATIONS ============ */}
      {recPages.map((rows, pi) =>
        wrap(
          <>
            {pi === 0 && (
              <>
                <div style={h1}>Recommendations</div>
                <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6, lineHeight: 1.55 }}>{recStandfirst}</div>
              </>
            )}
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", alignItems: "center", padding: "0 0 7px", borderBottom: "2px solid #16181d", fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase", color: "#8c919c" }}>
                <span style={{ width: 30, flexShrink: 0 }}>#</span>
                <span style={{ width: "1.15in", flexShrink: 0 }}>Priority</span>
                <span style={{ flex: 1 }}>Recommendation</span>
                <span style={{ width: "0.5in", flexShrink: 0, textAlign: "right" }}>Log</span>
              </div>
              {rows.map((rr) => (
                <div key={rr.num} className="rp-log-row" style={{ display: "flex", alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid #f0f1f4" }}>
                  <span style={{ width: 30, flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "#5b616e" }}>{rr.num}</span>
                  <span style={{ width: "1.15in", flexShrink: 0 }}>
                    <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: rr.sev.ink, background: rr.sev.soft, border: `1px solid ${rr.sev.bd}`, padding: "2px 8px", borderRadius: 5 }}>{rr.sev.label}</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{rr.problem}</span>
                    <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.5, color: "#3a3f4a", marginTop: 2 }}>{rr.text}</span>
                  </span>
                  <span style={{ width: "0.5in", flexShrink: 0, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>{rr.logRef}</span>
                </div>
              ))}
            </div>
          </>,
          "rec-" + pi
        )
      )}

      {/* ============ RECOMMENDATIONS · NEXT STEP ============ */}
      <div className="rp-sheet" style={sheet}>
        {head}
        <div style={{ flex: 1, padding: "0.5in 0.7in", display: "flex", flexDirection: "column" }}>
          {recEmpty ? (
            <>
              <div style={h1}>Recommendations</div>
              <p style={{ ...prose, marginTop: 12 }}>No open findings require corrective action at this time. Continue the annual inspection cycle to keep the system compliant.</p>
            </>
          ) : (
            <div style={h2}>Next step · renovation package</div>
          )}
          <p style={{ ...prose, marginTop: 12 }}>{renovationText}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13, marginTop: 20 }}>
            <div style={{ border: "1px solid #f0d6cd", background: "#fbf1ee", borderRadius: 5, padding: 16 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700, color: "#b4543a" }}>{c.urgent.open}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#b4543a", marginTop: 6 }}>Urgent repairs open</div>
            </div>
            <div style={{ border: "1px solid #f0e2bd", background: "#fdf8ea", borderRadius: 5, padding: 16 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700, color: "#9a6a1f" }}>{c.necessary.open}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#9a6a1f", marginTop: 6 }}>Necessary repairs open</div>
            </div>
          </div>
          <div className="pk-no-print" style={{ marginTop: 20, alignSelf: "flex-start" }}>
            <RenovationQuoteButton id={r.id} />
          </div>
          <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 22, lineHeight: 1.6 }}>{recBasis}</div>
          {/* Limitation notice (punch #73) — on this always-rendered closing
              page so it appears regardless of the Standards/boilerplate
              toggle (`showBoiler`) or report layout. Wording lives in ONE
              place (src/lib/compliance-notices.ts) — see the DRAFT WORDING
              comment there; not yet reviewed by counsel or signed off by
              product. */}
          <div style={{ fontSize: 11, color: "#8c919c", marginTop: 10, lineHeight: 1.6, borderTop: "1px solid #eceef1", paddingTop: 10 }}>
            {INSPECTION_LIMITATION_NOTICE}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ marginTop: 26, paddingTop: 16, borderTop: "1px solid #eceef1", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "#9aa0ab" }}>Prepared by</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{(r.inspector || "—") + " · " + companyName}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#9aa0ab" }}>Report</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, marginTop: 3 }}>{docId}</div>
            </div>
          </div>
        </div>
        {foot}
      </div>
    </>
  );
}

function CoverMeta({ label, value, center }: { label: string; value: string; center?: boolean }) {
  return (
    <div style={center ? { textAlign: "center" } : undefined}>
      <div style={{ fontSize: 10, letterSpacing: center ? ".1em" : ".12em", textTransform: "uppercase", color: center ? "#9aa0ab" : "#8c919c" }}>{label}</div>
      <div style={{ fontSize: center ? 14 : 16, fontWeight: 600, marginTop: center ? 4 : 5, color: "#16181d" }}>{value}</div>
    </div>
  );
}
