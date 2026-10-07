/**
 * Curtain cut sheets (#292 §2.3) — the two adapters that read curtains off a
 * quote, and the key that groups them into types. Pure and client-safe with
 * NO weight math: the Estimator preview counts sheets through
 * countCutSheetTypes without bundling steel.ts. collect.ts adds weights,
 * areas and hardware on the server. A quote is read by exactly one adapter:
 * non-empty spec.sections → Estimator; else spec.kind === "grid" → Grid.
 */
import { ensureOptions, hasOption, optionSlice, type GridOption } from "@/lib/design/grid-options";
import type { GridCurtain, GridCurtainType } from "@/lib/design/grid-bom";
import { quoteBuilderHref } from "@/lib/quote-links";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import type { TrackOperation, TrackSeries } from "@/lib/track-series";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { parseEstimatorCurtainDesc, parseGridCurtainDesc } from "./parse";
import { linkCurtainTracks } from "./track-link";
import {
  ASSUMED_MOUNT, DEFAULT_BOTTOM_FINISH, DEFAULT_MARK_SPACING_IN, DEFAULT_TOP_FINISH, GRID_CURTAIN_DEFAULTS,
  isBottomFinish, isMountTypeId, isTopFinish, mountTypeForTrackMounting,
  type CurtainBottomFinish, type CurtainMountKey, type CurtainTopFinish,
} from "./vocab";

export const CURTAIN_UNREADABLE = "Can't read size — edit the curtain";
export const CURTAIN_ZERO_SIZE = "Size is 0 — edit the curtain";
export const GRID_DESIGN_GONE = "The Grid design behind this quote no longer exists — sheets read the quoted lines.";
export const TRACK_SERIES_GONE_WARNING = "Track series no longer exists — hardware as quoted.";

/** The catalog fabric row slice the cut sheets read (fabricParts()). */
export type CurtainFabricRow = { sku: string; desc: string; oz?: number; ozBasis?: "lin-yd" | "sq-yd"; boltWidthIn?: number; flameRating?: string };
export type CutSheetFabric = { sku: string; name: string; oz?: number; ozBasis?: "lin-yd" | "sq-yd"; boltWidthIn?: number; flameRating?: string };
export type CutSheetMount = {
  key: CurtainMountKey;
  source: "track" | "picked" | "assumed";
  track?: { line: SpecItem; seriesId: string; seriesName: string; seriesGone: boolean; operation: TrackOperation; carrierSpacingIn: number };
};
/** Where a line sits — staff warnings and "Edit the curtain →" only. */
export type CurtainLineRef = { ref: string; where: string; desc: string; sectionId?: string; lineId?: number };
export type CutSheetCurtain = CurtainLineRef & {
  name: string;
  gridType?: GridCurtainType;
  color?: string;
  fabric: CutSheetFabric | null;
  /** What the line says — printed when `fabric` is null. */
  fabricText: string;
  /** Staff-only, never printed: the SKU a Grid curtain names when its fabric left the catalog — keeps two such fabrics apart in the type key and names it in the staff warning. */
  fabricRef?: string;
  widthFt: number;
  heightFt: number;
  fullnessPct: number;
  qty: number;
  topFinish: CurtainTopFinish;
  bottomFinish: CurtainBottomFinish;
  mount: CutSheetMount;
  warnings: string[];
};
export type CurtainsRead = {
  curtains: CutSheetCurtain[];
  unreadable: Array<CurtainLineRef & { reason: string }>;
  skippedOptional: CurtainLineRef[];
  notes: string[];
};
/** The Grid project slice the adapter needs (stores/grid-projects GridProject satisfies it). */
export type GridProjectLite = {
  /** A pre-options project's own quote — ensureOptions gives its one option this quoteId. */
  quoteId?: string | null;
  options?: GridOption[];
  placements?: Array<{ id: string; optionId?: string; curtain?: GridCurtain | null }>;
};

const empty = (): CurtainsRead => ({ curtains: [], unreadable: [], skippedOptional: [], notes: [] });

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}
function positiveOr(v: unknown, fallback: number): number {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
/** A line's qty: ≤ 0 → null (left out, never printed as 1); fractional rounds but never below 1; unreadable → 1. */
function lineQty(v: unknown): number | null {
  const n = num(v);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return null;
  return Math.max(1, Math.round(n));
}
function fabricOf(row: CurtainFabricRow | null | undefined): CutSheetFabric | null {
  if (!row) return null;
  return { sku: row.sku, name: row.desc, oz: row.oz, ozBasis: row.ozBasis, boltWidthIn: row.boltWidthIn, flameRating: (row.flameRating || "").trim() || undefined };
}
function sizeProblem(w: number, h: number): string | null {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return CURTAIN_UNREADABLE;
  if (w <= 0 || h <= 0) return CURTAIN_ZERO_SIZE;
  return null;
}

export function estimatorCurtains(sections: readonly SpecSection[], fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[]): CurtainsRead {
  const bySku = new Map(fabrics.map((f) => [f.sku, f]));
  const byName = new Map(fabrics.map((f) => [f.desc, f]));
  const names = new Set(fabrics.map((f) => f.desc));
  const { links, duplicates } = linkCurtainTracks(sections);
  const dup = new Set(duplicates);
  const read = empty();
  for (const sec of sections) {
    for (const it of sec.items || []) {
      if (!it.curtain || isRewardCreditItem(it)) continue;
      const lineRef: CurtainLineRef = { ref: `${sec.id}/line-${it.id}`, where: sec.name || "System", desc: it.desc || "", sectionId: sec.id, lineId: it.id };
      const qty = lineQty(it.qty);
      // Phase 2b: an Alternate group's systems are out of the base bid, like option lines
      if (it.option || sec.alternate || qty == null) {
        read.skippedOptional.push(lineRef);
        continue;
      }
      const ci = it.curtainInputs;
      let name: string;
      let fabricRow: CurtainFabricRow | undefined;
      let fabricText: string;
      let w: number;
      let h: number;
      let full: number;
      if (ci) {
        name = ci.name || "";
        w = num(ci.width);
        h = num(ci.height);
        full = num(ci.fullness);
        fabricRow = (ci.fabricSku ? bySku.get(ci.fabricSku) : undefined) ?? (ci.fabricName ? byName.get(ci.fabricName) : undefined);
        fabricText = (ci.fabricName || ci.fabricSku || "").trim();
      } else {
        const p = parseEstimatorCurtainDesc(it.desc || "", names);
        if (!p) {
          read.unreadable.push({ ...lineRef, reason: CURTAIN_UNREADABLE });
          continue;
        }
        ({ name, fabricName: fabricText, widthFt: w, heightFt: h, fullnessPct: full } = p);
        fabricRow = byName.get(p.fabricName);
      }
      const problem = sizeProblem(w, h);
      if (problem) {
        read.unreadable.push({ ...lineRef, reason: problem });
        continue;
      }
      const label = name.trim() || "Curtain";
      const warnings: string[] = [];
      if (dup.has(it)) warnings.push(`${label}: its track is already linked to another curtain — mount from the curtain's own pick.`);
      const trackLine = links.get(it);
      let mount: CutSheetMount;
      if (trackLine?.track) {
        const cfg = trackLine.track;
        const series = trackSeries.find((s) => s.id === cfg.seriesId);
        if (!series) warnings.push(TRACK_SERIES_GONE_WARNING);
        mount = {
          key: mountTypeForTrackMounting(String(cfg.mounting)),
          source: "track",
          track: {
            line: trackLine,
            seriesId: cfg.seriesId,
            seriesName: series?.name || "",
            seriesGone: !series,
            operation: cfg.operation,
            carrierSpacingIn: positiveOr(cfg.carrierSpacingIn, positiveOr(series?.carrierSpacingIn, DEFAULT_MARK_SPACING_IN)),
          },
        };
      } else if (ci && isMountTypeId(ci.mountType)) mount = { key: ci.mountType, source: "picked" };
      else mount = { key: ASSUMED_MOUNT, source: "assumed" };
      read.curtains.push({
        ...lineRef,
        name: label,
        fabric: fabricOf(fabricRow),
        fabricText,
        widthFt: w,
        heightFt: h,
        fullnessPct: Number.isFinite(full) && full > 0 ? full : 0,
        qty,
        topFinish: ci && isTopFinish(ci.topFinish) ? ci.topFinish : DEFAULT_TOP_FINISH,
        bottomFinish: ci && isBottomFinish(ci.bottomFinish) ? ci.bottomFinish : DEFAULT_BOTTOM_FINISH,
        mount,
        warnings,
      });
    }
  }
  return read;
}

/** A copy of the project (ensureOptions normalizes IN PLACE — an orphan placement joins the first option), so the reader never mutates the caller's. */
function gridDoc(project: GridProjectLite | null) {
  return project ? { quoteId: project.quoteId ?? null, options: project.options ? [...project.options] : undefined, placements: (project.placements || []).map((p) => ({ ...p })) } : null;
}

/**
 * The Grid option a quote reads: its `gridOptionId` when that option still
 * exists; for a quote saved before `gridOptionId` existed, the option whose
 * quoteId is this quote (final review #6). "" = read the quoted lines.
 */
function gridOptionIdFor(spec: { gridOptionId?: unknown }, doc: ReturnType<typeof gridDoc>, quoteId: string | undefined): string {
  if (!doc) return "";
  if (typeof spec.gridOptionId === "string" && spec.gridOptionId) return hasOption(doc, spec.gridOptionId) ? spec.gridOptionId : "";
  if (!quoteId) return "";
  return ensureOptions(doc).options.find((o) => o.quoteId === quoteId)?.id ?? "";
}

type QuotedCurtainLine = { parsed: NonNullable<ReturnType<typeof parseGridCurtainDesc>>; used: boolean };

/**
 * The fabric name a Grid curtain's own quoted line printed — "" when that
 * line printed the SKU (the fabric was already gone at quote time) or no line
 * matches. Never a SKU: a line printing this curtain's SKU is taken as its own
 * (→ ""); a line printing any other known SKU, or a current catalog fabric's
 * name (another, live curtain's line), is skipped. Each line answers once.
 */
function quotedGridFabricName(c: GridCurtain, lines: QuotedCurtainLine[], notNames: ReadonlySet<string>): string {
  const same = (l: QuotedCurtainLine) =>
    !l.used && l.parsed.name === (c.name || "").trim() && l.parsed.gridType === c.type && l.parsed.widthFt === Number(c.widthFt)
    && l.parsed.heightFt === Number(c.heightFt) && l.parsed.fullnessPct === (c.fullnessPct > 0 ? c.fullnessPct : 0);
  const own = lines.find((l) => same(l) && l.parsed.fabricName === c.fabricSku);
  const hit = own ?? lines.find((l) => same(l) && !notNames.has(l.parsed.fabricName));
  if (!hit) return "";
  hit.used = true;
  return hit === own ? "" : hit.parsed.fabricName;
}

export function gridCurtains(spec: { gridOptionId?: unknown; lines?: unknown }, project: GridProjectLite | null, fabrics: readonly CurtainFabricRow[], quoteId?: string): CurtainsRead {
  const bySku = new Map(fabrics.map((f) => [f.sku, f]));
  const byName = new Map(fabrics.map((f) => [f.desc, f]));
  const read = empty();
  const doc = gridDoc(project);
  const optionId = gridOptionIdFor(spec, doc, quoteId);
  if (doc && optionId) {
    const placements = optionSlice(doc, optionId).placements;
    const quoted: QuotedCurtainLine[] = (Array.isArray(spec.lines) ? spec.lines : []).flatMap((raw) => {
      const l = (raw && typeof raw === "object" ? raw : {}) as { sku?: unknown; desc?: unknown };
      const parsed = l.sku === "CURTAIN" && typeof l.desc === "string" ? parseGridCurtainDesc(l.desc) : null;
      return parsed ? [{ parsed, used: false }] : [];
    });
    const notNames = new Set([...placements.map((p) => p.curtain?.fabricSku || ""), ...fabrics.map((f) => f.sku), ...fabrics.map((f) => f.desc)].filter(Boolean));
    for (const pl of placements) {
      const c = pl.curtain;
      if (!c) continue;
      const lineRef: CurtainLineRef = { ref: `placement-${pl.id}`, where: "Grid design", desc: c.name || "" };
      const problem = sizeProblem(Number(c.widthFt), Number(c.heightFt));
      if (problem) {
        read.unreadable.push({ ...lineRef, reason: problem });
        continue;
      }
      const d = GRID_CURTAIN_DEFAULTS[c.type] ?? GRID_CURTAIN_DEFAULTS.Full;
      const fabric = fabricOf(bySku.get(c.fabricSku));
      read.curtains.push({
        ...lineRef,
        name: (c.name || "").trim() || "Curtain",
        gridType: c.type,
        color: (c.color || "").trim() || undefined,
        fabric,
        // A fabric gone from the catalog prints the name its quoted line printed, else nothing — never the SKU (final review #5).
        fabricText: fabric ? fabric.name : quotedGridFabricName(c, quoted, notNames),
        ...(fabric || !c.fabricSku ? {} : { fabricRef: c.fabricSku }),
        widthFt: c.widthFt,
        heightFt: c.heightFt,
        fullnessPct: c.fullnessPct > 0 ? c.fullnessPct : 0,
        qty: 1,
        topFinish: isTopFinish(c.topFinish) ? c.topFinish : d.top,
        bottomFinish: isBottomFinish(c.bottomFinish) ? c.bottomFinish : d.bottom,
        mount: isMountTypeId(c.mountType) ? { key: c.mountType, source: "picked" } : { key: d.mount, source: "assumed" },
        warnings: [],
      });
    }
    return read;
  }
  read.notes.push(GRID_DESIGN_GONE);
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  lines.forEach((raw, i) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as { sku?: unknown; desc?: unknown; qty?: unknown };
    if (l.sku !== "CURTAIN") return;
    const desc = typeof l.desc === "string" ? l.desc : "";
    const lineRef: CurtainLineRef = { ref: `line-${i + 1}`, where: "Quoted lines", desc };
    const p = parseGridCurtainDesc(desc);
    const problem = p ? sizeProblem(p.widthFt, p.heightFt) : CURTAIN_UNREADABLE;
    if (!p || problem) {
      read.unreadable.push({ ...lineRef, reason: problem || CURTAIN_UNREADABLE });
      return;
    }
    const qty = lineQty(l.qty);
    if (qty == null) {
      read.skippedOptional.push(lineRef);
      return;
    }
    const d = GRID_CURTAIN_DEFAULTS[p.gridType];
    read.curtains.push({
      ...lineRef,
      name: p.name,
      gridType: p.gridType,
      fabric: fabricOf(byName.get(p.fabricName) ?? bySku.get(p.fabricName)),
      fabricText: p.fabricName,
      widthFt: p.widthFt,
      heightFt: p.heightFt,
      fullnessPct: p.fullnessPct,
      qty,
      topFinish: d.top,
      bottomFinish: d.bottom,
      mount: { key: d.mount, source: "assumed" },
      warnings: [],
    });
  });
  return read;
}

export function readCurtains(spec: unknown, fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[], project: GridProjectLite | null, quoteId?: string): CurtainsRead {
  const s = (spec && typeof spec === "object" ? spec : {}) as { sections?: unknown; kind?: unknown; gridOptionId?: unknown; lines?: unknown };
  if (Array.isArray(s.sections) && s.sections.length) return estimatorCurtains(s.sections as SpecSection[], fabrics, trackSeries);
  if (s.kind === "grid") return gridCurtains(s, project, fabrics, quoteId);
  return empty();
}

/**
 * Which fabric rows readCurtains needs (final review #2), so the loader reads
 * only those by SKU instead of the whole catalog. `byName` = some line can
 * only be matched by its printed fabric NAME (a legacy Estimator desc, a
 * Grid quote's quoted lines, a curtainInputs with a name but no SKU);
 * `byNameIfMissing` = SKUs whose line falls back to its name when the SKU
 * isn't a fabric row. Mirrors readCurtains' adapter choice exactly.
 */
export function curtainFabricLookups(spec: unknown, project: GridProjectLite | null, quoteId?: string): { skus: string[]; byName: boolean; byNameIfMissing: string[] } {
  const s = (spec && typeof spec === "object" ? spec : {}) as { sections?: unknown; kind?: unknown; gridOptionId?: unknown; lines?: unknown };
  const skus = new Set<string>();
  const ifMissing = new Set<string>();
  let byName = false;
  if (Array.isArray(s.sections) && s.sections.length) {
    for (const sec of s.sections as SpecSection[]) {
      for (const it of sec?.items || []) {
        if (!it?.curtain || isRewardCreditItem(it)) continue;
        const ci = it.curtainInputs;
        if (!ci) byName = true;
        else if (ci.fabricSku) {
          skus.add(ci.fabricSku);
          if (ci.fabricName) ifMissing.add(ci.fabricSku);
        } else if (ci.fabricName) byName = true;
      }
    }
  } else if (s.kind === "grid") {
    const doc = gridDoc(project);
    const optionId = gridOptionIdFor(s, doc, quoteId);
    if (doc && optionId) {
      for (const pl of optionSlice(doc, optionId).placements) if (pl.curtain?.fabricSku) skus.add(pl.curtain.fabricSku);
    } else {
      byName = (Array.isArray(s.lines) ? s.lines : []).some((l) => !!l && typeof l === "object" && (l as { sku?: unknown }).sku === "CURTAIN");
    }
  }
  return { skus: [...skus], byName, byNameIfMissing: [...ifMissing] };
}

/**
 * lower(trim(name)) | fabric sku-or-text | fullness | top | bottom | mountKey | hardware source.
 * The last element is `track:<seriesId>:<carrierSpacingIn>` for a track-backed mount and "" for the
 * mount-rules path, so every type has exactly one hardware source and one spacing (an empty-seriesId
 * track never collides with a picked mount). Size is NOT part of the type.
 */
export function curtainTypeKey(c: CutSheetCurtain): string {
  return [
    c.name.trim().toLowerCase(),
    c.fabric ? c.fabric.sku : c.fabricRef ? `ref:${c.fabricRef}` : `text:${c.fabricText.trim().toLowerCase()}`,
    c.fullnessPct,
    c.topFinish,
    c.bottomFinish,
    c.mount.key,
    c.mount.track ? `track:${c.mount.track.seriesId}:${c.mount.track.carrierSpacingIn}` : "",
  ].join("|");
}

/** The number of cut sheets a quote will print, counted from the Estimator quote's sections (or, for a Grid quote, its quoted CURTAIN lines — project: null) — the Estimator preview's chip and hint card. */
export function countCutSheetTypes(spec: unknown, fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[]): number {
  return new Set(readCurtains(spec, fabrics, trackSeries, null).curtains.map(curtainTypeKey)).size;
}

/**
 * Where a staff "edit" link on the Cut sheets page goes (final review #4). An
 * Estimator line (it has a sectionId) opens the Estimator. A Grid placement
 * opens its Grid design — saving a Grid quote in the Estimator would convert
 * it to sections. Anything else (a Grid quote's quoted lines) opens the
 * quote's own builder.
 */
export function curtainEditLink(row: Pick<CurtainLineRef, "ref" | "sectionId">, quote: { id: string; quoteType?: string | null; spec?: unknown }): { href: string; label: string } {
  if (row.sectionId) return { href: `/estimator?id=${encodeURIComponent(quote.id)}`, label: "Edit the curtain →" };
  const spec = (quote.spec && typeof quote.spec === "object" ? quote.spec : {}) as { gridProjectId?: unknown; gridOptionId?: unknown };
  if (row.ref.startsWith("placement-") && typeof spec.gridProjectId === "string" && spec.gridProjectId) {
    const option = typeof spec.gridOptionId === "string" && spec.gridOptionId ? `?option=${encodeURIComponent(spec.gridOptionId)}` : "";
    return { href: `/design/grid/${encodeURIComponent(spec.gridProjectId)}${option}`, label: "Edit in the Grid design →" };
  }
  return { href: quoteBuilderHref(quote), label: "Open the quote →" };
}

/** The Grid editor's staff note after a client package (final review #10): curtains the cut sheets couldn't read (the per-row reasons ride in its tooltip). */
export function cutSheetsUnreadableNote(n: number): string {
  return `${n} curtain${n === 1 ? "" : "s"} couldn't be read for cut sheets — edit ${n === 1 ? "it" : "them"}, then rebuild`;
}
