/**
 * Curtain cut sheets (#292 §2.3) — the two adapters that read curtains off a
 * quote, and the key that groups them into types. Pure and client-safe with
 * NO weight math: the Estimator preview counts sheets through
 * countCutSheetTypes without bundling steel.ts. collect.ts adds weights,
 * areas and hardware on the server. A quote is read by exactly one adapter:
 * non-empty spec.sections → Estimator; else spec.kind === "grid" → Grid.
 */
import { hasOption, optionSlice, type GridOption } from "@/lib/design/grid-options";
import type { GridCurtain, GridCurtainType } from "@/lib/design/grid-bom";
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
      if (it.option || qty == null) {
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

export function gridCurtains(spec: { gridOptionId?: unknown; lines?: unknown }, project: GridProjectLite | null, fabrics: readonly CurtainFabricRow[]): CurtainsRead {
  const bySku = new Map(fabrics.map((f) => [f.sku, f]));
  const byName = new Map(fabrics.map((f) => [f.desc, f]));
  const read = empty();
  const optionId = typeof spec.gridOptionId === "string" ? spec.gridOptionId : "";
  // ensureOptions normalizes IN PLACE (an orphan placement joins the first option) —
  // read a copy so the collector never mutates the caller's project.
  const doc = project ? { options: project.options ? [...project.options] : undefined, placements: (project.placements || []).map((p) => ({ ...p })) } : null;
  if (doc && optionId && hasOption(doc, optionId)) {
    for (const pl of optionSlice(doc, optionId).placements) {
      const c = pl.curtain;
      if (!c) continue;
      const lineRef: CurtainLineRef = { ref: `placement-${pl.id}`, where: "Grid design", desc: c.name || "" };
      const problem = sizeProblem(Number(c.widthFt), Number(c.heightFt));
      if (problem) {
        read.unreadable.push({ ...lineRef, reason: problem });
        continue;
      }
      const d = GRID_CURTAIN_DEFAULTS[c.type] ?? GRID_CURTAIN_DEFAULTS.Full;
      read.curtains.push({
        ...lineRef,
        name: (c.name || "").trim() || "Curtain",
        gridType: c.type,
        color: (c.color || "").trim() || undefined,
        fabric: fabricOf(bySku.get(c.fabricSku)),
        fabricText: c.fabricSku,
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

export function readCurtains(spec: unknown, fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[], project: GridProjectLite | null): CurtainsRead {
  const s = (spec && typeof spec === "object" ? spec : {}) as { sections?: unknown; kind?: unknown; gridOptionId?: unknown; lines?: unknown };
  if (Array.isArray(s.sections) && s.sections.length) return estimatorCurtains(s.sections as SpecSection[], fabrics, trackSeries);
  if (s.kind === "grid") return gridCurtains(s, project, fabrics);
  return empty();
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
    c.fabric ? c.fabric.sku : `text:${c.fabricText.trim().toLowerCase()}`,
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
