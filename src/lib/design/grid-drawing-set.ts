/**
 * The Grid — drawing set model (drawing set spec 2026-09-25, #GDS).
 *
 * Pure and dependency-free (the grid-bom rule): the set page (server), the
 * title block, the plan-sheet figure (a client component) and the spec
 * harness all import it. No doc-store, no DB.
 *
 * One table (SHEET_SIZES + the three inch constants) is the single source of
 * truth for sheet geometry: DrawingSheet turns it into CSS variables, the
 * set page turns it into @page, and the plan figure fits the plan into the
 * same drawing area — so screen, print and PDF can never disagree.
 */

import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import {
  DRAWING_SYSTEMS,
  drawingSystemOf,
  scopeOfPart,
  type DrawingSystemKey,
  type GridLayer,
  type ScopedPartLite,
} from "./grid-scopes";

/* ------------------------------ sheet sizes ------------------------------ */

/** 11×17 (ANSI B) is the default; 24×36 (ARCH D) is the same layout scaled
 *  by k (the title strip, borders and type all multiply by k). */
export const SHEET_SIZES = {
  b: { key: "b", label: "11×17 (ANSI B)", w: 17, h: 11, k: 1, screenZoom: 0.6 },
  d: { key: "d", label: "24×36 (ARCH D)", w: 36, h: 24, k: 36 / 17, screenZoom: 0.28 },
} as const;

export type SheetSizeKey = keyof typeof SHEET_SIZES;

/** Paper edge → border frame, in inches at k = 1. */
export const SHEET_MARGIN_IN = 0.375;
/** Title strip width, in inches at k = 1. */
export const TITLE_STRIP_IN = 2.5;
/** Frame → drawing content padding, in inches at k = 1. */
export const AREA_PAD_IN = 0.2;
/** Border hairlines, so a fitted figure never spills a pixel past the frame. */
const BORDER_ALLOW_IN = 0.05;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function isSheetSize(v: unknown): v is SheetSizeKey {
  return v === "b" || v === "d";
}

/** `?size=` wins, then the project's saved size, then 11×17. */
export function resolveSheetSize(requested: string | null | undefined, saved: SheetSizeKey | null | undefined): SheetSizeKey {
  if (isSheetSize(requested)) return requested;
  if (isSheetSize(saved)) return saved;
  return "b";
}

/** The drawing area inside the frame and left of the strip, in inches. */
export function drawingArea(size: SheetSizeKey): { w: number; h: number } {
  const s = SHEET_SIZES[size];
  const m = SHEET_MARGIN_IN * s.k;
  const strip = TITLE_STRIP_IN * s.k;
  const pad = AREA_PAD_IN * s.k;
  const allow = BORDER_ALLOW_IN * s.k;
  return { w: r3(s.w - 2 * m - strip - 2 * pad - allow), h: r3(s.h - 2 * m - 2 * pad - allow) };
}

/** CSS custom properties DrawingSheet sets on `.pk-drawing-sheet`. */
export function sheetCssVars(size: SheetSizeKey): Record<string, string> {
  const s = SHEET_SIZES[size];
  return {
    "--dw-w": `${s.w}in`,
    "--dw-h": `${s.h}in`,
    "--dw-k": String(r3(s.k)),
    "--dw-m": `${r3(SHEET_MARGIN_IN * s.k)}in`,
    "--dw-strip": `${r3(TITLE_STRIP_IN * s.k)}in`,
    "--dw-pad": `${r3(AREA_PAD_IN * s.k)}in`,
  };
}

/** The set page's print rule: one sheet per page, edge to edge, landscape. */
export function printPageCss(size: SheetSizeKey): string {
  const s = SHEET_SIZES[size];
  return `@media print { @page { size: ${s.w}in ${s.h}in; margin: 0; } }`;
}

/** Largest box of the given aspect (height ÷ width) that fits the area. */
export function fitBox(areaW: number, areaH: number, aspect: number): { w: number; h: number } {
  if (!(aspect > 0) || !(areaW > 0) || !(areaH > 0)) return { w: 0, h: 0 };
  const w = Math.min(areaW, areaH / aspect);
  return { w: r3(w), h: r3(w * aspect) };
}

/**
 * Printed scale for a plan: the calibration says how many real units span the
 * full page width (lib/annotations calibrationScale), and the page prints
 * `printedWidthIn` wide — so one printed inch is scale ÷ printedWidthIn.
 * "NTS" whenever the page is uncalibrated (a scale must never be guessed).
 */
export function scaleNote(cal: { scale: number; unit: MeasureUnit } | null | undefined, printedWidthIn: number): string {
  if (!cal || !(cal.scale > 0) || !(printedWidthIn > 0)) return "NTS";
  return `1" = ${formatMeasure(cal.scale / printedWidthIn, cal.unit)}`;
}

/* ------------------------------- revisions ------------------------------- */

/** 0 → A … 25 → Z, 26 → AA, 27 → AB … */
export function revLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** The slice of GridRevision the title block needs. */
export type RevisionLite = { rev: number; at: number; note: string; reason: "manual" | "quote" | "restore" };

export type RevisionRow = { rev: number; letter: string; date: number; label: string };

const REASON_LABEL: Record<RevisionLite["reason"], string> = {
  manual: "Design saved",
  quote: "Issued with quote",
  restore: "Earlier revision recalled",
};

/** How many revision rows the title strip prints (newest first). */
export const REV_ROWS = 6;

/**
 * Every revision, lettered in cut order. Label = the revision's own note,
 * else the set's editable label for it, else a plain-English reason.
 */
export function revisionRows(revisions: RevisionLite[] | undefined, labels?: Record<string, string>): RevisionRow[] {
  return [...(revisions || [])]
    .sort((a, b) => a.rev - b.rev)
    .map((r, i) => ({
      rev: r.rev,
      letter: revLetter(i),
      date: r.at,
      label: (r.note || "").trim() || (labels?.[String(r.rev)] || "").trim() || REASON_LABEL[r.reason] || "Revision",
    }));
}

/** "Rev C" — or "— Preliminary" for a design never snapshotted. */
export function revisionStatus(rows: RevisionRow[]): string {
  return rows.length ? `Rev ${rows[rows.length - 1].letter}` : "— Preliminary";
}

/* ----------------------------- set settings ----------------------------- */

/** Saved on the Grid project (`drawingSet`). Every key optional. */
export type DrawingSetSettings = {
  size?: SheetSizeKey;
  drawnBy?: string;
  checkedBy?: string;
  /** Sheet exclusion keys (sheetExclusionKey). */
  excluded?: string[];
  /** Present (even "") = this set's own notes; absent = the standard notes. */
  generalNotes?: string;
  /** Labels for revisions that have no note, keyed by rev number. */
  revisionLabels?: Record<string, string>;
};

export const GENERAL_NOTES_MAX = 4000;

export function cleanDrawingSet(raw: unknown): DrawingSetSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: DrawingSetSettings = {};
  if (isSheetSize(r.size)) out.size = r.size;
  if (typeof r.drawnBy === "string") out.drawnBy = r.drawnBy.trim().slice(0, 60);
  if (typeof r.checkedBy === "string") out.checkedBy = r.checkedBy.trim().slice(0, 60);
  if (Array.isArray(r.excluded)) {
    const keys = r.excluded.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 160);
    out.excluded = Array.from(new Set(keys)).slice(0, 100);
  }
  if (typeof r.generalNotes === "string") out.generalNotes = r.generalNotes.replace(/\r\n/g, "\n").slice(0, GENERAL_NOTES_MAX);
  if (r.revisionLabels && typeof r.revisionLabels === "object" && !Array.isArray(r.revisionLabels)) {
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.revisionLabels as Record<string, unknown>)) {
      if (!/^\d{1,5}$/.test(k) || typeof v !== "string") continue;
      const t = v.trim().slice(0, 80);
      if (t) labels[k] = t;
    }
    out.revisionLabels = labels;
  }
  return out;
}

/** Grid Settings → "Standard general notes"; blank clears to null. */
export function cleanStandardNotes(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim().slice(0, GENERAL_NOTES_MAX) : "";
  return t || null;
}

/** One note per non-blank line; a typed leading "1." / "2)" is stripped
 *  because the sheet numbers them itself. */
export function resolveGeneralNotes(set: DrawingSetSettings | undefined, standard: string | null | undefined): string[] {
  const text = set && typeof set.generalNotes === "string" ? set.generalNotes : standard || "";
  return text
    .split("\n")
    .map((l) => l.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean);
}

/* ------------------------------ title block ------------------------------ */

export type TitleBlockData = {
  company: { name: string; addressLines: string[]; phone: string; logoDark: string | null };
  project: { id: string; name: string; customer: string; venue: string; address: string };
  /** null when the design has a single option. */
  optionName: string | null;
  quoteId: string | null;
  /** Newest first, at most REV_ROWS. */
  revisions: RevisionRow[];
  /** How many older rows didn't fit. */
  earlierRevisions: number;
  /** "Rev C" | "— Preliminary". */
  status: string;
  drawnBy: string;
  checkedBy: string;
  scale: string;
  /** Print date (epoch ms). */
  date: number;
  sheet: { number: string; title: string; index: number; total: number };
};

export type TitleBlockInput = {
  company: {
    name: string;
    logoDark?: string | null;
    offices?: Array<{ street?: string; city?: string; state?: string; zip?: string; phone?: string; quoteDefault?: boolean }>;
  };
  project: {
    id: string;
    name: string;
    customer: string;
    siteName?: string;
    intake?: { venueName?: string; address?: string } | null;
    createdBy: string;
  };
  option: { name: string; quoteId: string | null };
  optionCount: number;
  /** revisionRows(...) output, oldest first. */
  revisions: RevisionRow[];
  set: DrawingSetSettings | undefined;
  sheet: { number: string; title: string; scale: string };
  index: number;
  total: number;
  now: number;
};

export function titleBlockData(input: TitleBlockInput): TitleBlockData {
  const offices = input.company.offices || [];
  const office = offices.find((o) => o.quoteDefault) || offices[0];
  const stateZip = office ? [office.state, office.zip].filter((s) => (s || "").trim()).join(" ") : "";
  const cityLine = office ? [office.city || "", stateZip].map((s) => s.trim()).filter(Boolean).join(", ") : "";
  const addressLines = office ? [office.street || "", cityLine].map((s) => s.trim()).filter(Boolean) : [];
  const rows = input.revisions;
  return {
    company: {
      name: input.company.name || "",
      addressLines,
      phone: (office?.phone || "").trim(),
      logoDark: input.company.logoDark || null,
    },
    project: {
      id: input.project.id,
      name: input.project.name,
      customer: input.project.customer || "",
      venue: input.project.siteName || input.project.intake?.venueName || "",
      address: input.project.intake?.address || "",
    },
    optionName: input.optionCount > 1 ? input.option.name : null,
    quoteId: input.option.quoteId,
    revisions: [...rows].reverse().slice(0, REV_ROWS),
    earlierRevisions: Math.max(0, rows.length - REV_ROWS),
    status: revisionStatus(rows),
    drawnBy: input.set?.drawnBy ?? input.project.createdBy ?? "",
    checkedBy: input.set?.checkedBy ?? "",
    scale: input.sheet.scale,
    date: input.now,
    sheet: { number: input.sheet.number, title: input.sheet.title, index: input.index, total: input.total },
  };
}

/* ---------------------------- plan sheets ---------------------------- */

export type PlanPlacementLite = { id: string; sheetId: string; page: number; partId: string; curtain?: unknown };
export type PlanRouteLite = {
  id: string;
  sheetId: string;
  page: number;
  partId: string;
  fromPlacementId?: string;
  toPlacementId?: string;
};

/** A placement's Grid scope — curtains are Curtains whatever their fabric row
 *  (the bomBySpace rule). */
export function placementScope(
  pl: { partId: string; curtain?: unknown },
  partById: ReadonlyMap<string, ScopedPartLite>
): GridLayer {
  return pl.curtain ? "Curtains" : scopeOfPart(partById.get(pl.partId));
}

export function placementSystem(
  pl: { partId: string; curtain?: unknown },
  partById: ReadonlyMap<string, ScopedPartLite>
): DrawingSystemKey {
  return drawingSystemOf(placementScope(pl, partById));
}

/** A wire belongs to the system of the device it was drawn from (else to),
 *  and only a free wire falls back to its cable part's own scope — cable is
 *  usually Unscoped, which would strand every speaker run on the G sheet. */
export function routeSystem(
  r: PlanRouteLite,
  placementById: ReadonlyMap<string, PlanPlacementLite>,
  partById: ReadonlyMap<string, ScopedPartLite>
): DrawingSystemKey {
  const end =
    (r.fromPlacementId ? placementById.get(r.fromPlacementId) : undefined) ||
    (r.toPlacementId ? placementById.get(r.toPlacementId) : undefined);
  return end ? placementSystem(end, partById) : drawingSystemOf(scopeOfPart(partById.get(r.partId)));
}

export type PlanGroup = { system: DrawingSystemKey; sheetId: string; page: number };

/** One plan sheet per (system × source sheet page) that holds anything of
 *  that system, in system order, then sheet order, then page. */
export function planSheetGroups(input: {
  sheetOrder: string[];
  placements: PlanPlacementLite[];
  routes: PlanRouteLite[];
  partById: ReadonlyMap<string, ScopedPartLite>;
}): PlanGroup[] {
  const placementById = new Map(input.placements.map((p) => [p.id, p]));
  const seen = new Map<string, PlanGroup>();
  const add = (system: DrawingSystemKey, sheetId: string, page: number) => {
    const k = `${system}|${sheetId}|${page}`;
    if (!seen.has(k)) seen.set(k, { system, sheetId, page });
  };
  for (const pl of input.placements) add(placementSystem(pl, input.partById), pl.sheetId, pl.page);
  for (const r of input.routes) add(routeSystem(r, placementById, input.partById), r.sheetId, r.page);
  const sysIdx = (k: DrawingSystemKey) => DRAWING_SYSTEMS.findIndex((s) => s.key === k);
  const sheetIdx = (id: string) => input.sheetOrder.indexOf(id);
  return [...seen.values()]
    .filter((g) => sheetIdx(g.sheetId) >= 0)
    .sort((a, b) => sysIdx(a.system) - sysIdx(b.system) || sheetIdx(a.sheetId) - sheetIdx(b.sheetId) || a.page - b.page);
}

/** What one system's plan sheet draws. */
export function planContent<
  P extends PlanPlacementLite,
  R extends PlanRouteLite,
  S extends { sheetId: string; page: number },
>(input: {
  group: PlanGroup;
  placements: P[];
  routes: R[];
  spaces: S[];
  partById: ReadonlyMap<string, ScopedPartLite>;
}): { placements: P[]; routes: R[]; spaces: S[] } {
  const { group } = input;
  const placementById = new Map<string, PlanPlacementLite>(input.placements.map((p) => [p.id, p]));
  const here = (x: { sheetId: string; page: number }) => x.sheetId === group.sheetId && x.page === group.page;
  return {
    placements: input.placements.filter((p) => here(p) && placementSystem(p, input.partById) === group.system),
    routes: input.routes.filter((r) => here(r) && routeSystem(r, placementById, input.partById) === group.system),
    spaces: input.spaces.filter(here),
  };
}

/* ------------------------------ sheet list ------------------------------ */

export type DrawingSheetKind = "cover" | "plan" | "riser" | "schedule";

export type DrawingSheetDef = {
  /** Stable identity: "cover" | "plan:<system>:<sheetId>:<page>" | "riser" | "schedule" | "schedule:<n>". */
  key: string;
  kind: DrawingSheetKind;
  number: string;
  title: string;
  system?: DrawingSystemKey;
  sheetId?: string;
  page?: number;
  /** 0-based schedule page. */
  schedulePage?: number;
};

/** All schedule pages share one include/exclude switch. */
export function sheetExclusionKey(d: DrawingSheetDef): string {
  return d.kind === "schedule" ? "schedule" : d.key;
}

/**
 * The numbered set. Numbers are assigned BEFORE exclusion so excluding L-101
 * never renumbers L-102 (a sheet number is a reference people write down);
 * the index and "n of N" count only what is included.
 */
export function buildSheetList(input: {
  planGroups: PlanGroup[];
  sourceNames: Readonly<Record<string, string>>;
  schedulePages: number;
  excluded?: readonly string[];
}): { all: DrawingSheetDef[]; included: DrawingSheetDef[] } {
  const all: DrawingSheetDef[] = [{ key: "cover", kind: "cover", number: "T-001", title: "Cover sheet" }];
  for (const sys of DRAWING_SYSTEMS) {
    const mine = input.planGroups.filter((g) => g.system === sys.key);
    mine.forEach((g, i) => {
      const src = input.sourceNames[g.sheetId] || "Plan";
      all.push({
        key: `plan:${sys.key}:${g.sheetId}:${g.page}`,
        kind: "plan",
        number: `${sys.prefix}-${101 + i}`,
        title: mine.length > 1 ? `${sys.title} — ${src}${g.page > 1 ? `, p. ${g.page}` : ""}` : sys.title,
        system: sys.key,
        sheetId: g.sheetId,
        page: g.page,
      });
    });
  }
  all.push({ key: "riser", kind: "riser", number: "E-501", title: "System riser" });
  const n = Math.max(1, Math.floor(input.schedulePages) || 1);
  for (let i = 0; i < n; i++) {
    all.push({
      key: i === 0 ? "schedule" : `schedule:${i + 1}`,
      kind: "schedule",
      number: `E-${601 + i}`,
      title: n > 1 ? `Equipment schedules (${i + 1} of ${n})` : "Equipment schedules",
      schedulePage: i,
    });
  }
  const ex = new Set(input.excluded || []);
  return { all, included: all.filter((d) => !ex.has(sheetExclusionKey(d))) };
}

/** The set settings' include/exclude checklist. */
export function toggleableSheets(all: DrawingSheetDef[]): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  const scheduleCount = all.filter((d) => d.kind === "schedule").length;
  for (const d of all) {
    const key = sheetExclusionKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label:
        d.kind === "schedule"
          ? `${d.number}${scheduleCount > 1 ? `–E-${600 + scheduleCount}` : ""} Equipment schedules`
          : `${d.number} ${d.title}`,
    });
  }
  return out;
}
