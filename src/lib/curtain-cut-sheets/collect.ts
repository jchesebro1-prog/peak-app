/**
 * Curtain cut sheets (#292 §2.3) — one collector over the two adapters:
 * groups curtains into types (CS-n in first-appearance order), merges sizes,
 * sums hardware, and computes sewn area / weight through the SAME functions
 * the quote prices and the lineset tool weighs with (decision 2). DB-free,
 * but imports steel.ts — server and harness only, never a client component.
 */
import { curtainCost } from "@/lib/design/curtain-pricing";
import { CHAIN_JACK, CHAIN_NONE } from "@/lib/design/goods";
import { computeSetWeight, DEFAULT_WEIGHTS, fabricFromPart } from "@/lib/design/steel";
import { mountRowQty, type CurtainMountHardware } from "@/lib/curtain-mounts";
import type { TrackSeries } from "@/lib/track-series";
import type { SpecItem } from "@/app/(app)/estimator/types";
import { topMarks } from "./geometry";
import { curtainTypeKey, readCurtains, type CurtainFabricRow, type CurtainLineRef, type CutSheetCurtain, type GridProjectLite } from "./estimator-curtains";
import { DEFAULT_MARK_SPACING_IN, MOUNT_KEY_LABELS, isMountTypeId, type CurtainMountTypeId } from "./vocab";

export type CutSheetHardware = { sku: string; desc: string; qty: number; unit: string; from: "track" | "mount-rules" };
export type CurtainType = {
  key: string;
  sheetNo: string;
  title: string;
  /** Every member, in quote order. */
  curtains: CutSheetCurtain[];
  /** Merged by exact W × H, largest area first. */
  sizes: Array<{ widthFt: number; heightFt: number; qty: number }>;
  totalQty: number;
  markSpacingIn: number;
  hardware: CutSheetHardware[];
  sewnAreaSqftEach: number[];
  sewnAreaSqftTotal: number;
  weightLbEach: Array<number | null>;
  weightLbTotal: number | null;
  warnings: string[];
  /** Printed beside the weight; set when the weight leaves something out. */
  weightNote?: string;
};
export const PIPE_POCKET_WEIGHT_NOTE = "Bottom pipe not included";
export type CollectInput = {
  quote: { spec?: unknown };
  fabrics: readonly CurtainFabricRow[];
  trackSeries: readonly TrackSeries[];
  mounts: Partial<Record<CurtainMountTypeId, CurtainMountHardware>>;
  /** Live desc/unit for hardware SKUs (track components + mount rules). */
  partInfo: ReadonlyMap<string, { desc: string; unit: string }>;
  /** Loaded only for a grid quote. */
  grid: { project: GridProjectLite | null } | null;
};
export type CollectResult = {
  types: CurtainType[];
  unreadable: Array<CurtainLineRef & { reason: string }>;
  skippedOptional: CurtainLineRef[];
  notes: string[];
};

/** curtainCost(...).sewnAreaSqft for ONE curtain — only the area is read, no rate. */
export function sewnAreaEach(c: Pick<CutSheetCurtain, "widthFt" | "heightFt" | "fullnessPct">): number {
  return curtainCost({ finishedWidthFt: c.widthFt, finishedHeightFt: c.heightFt, fullnessPct: c.fullnessPct, qty: 1 }, { fabricRate: 0, sewingPct: 0 }).sewnAreaSqft;
}

/** computeSetWeight(...).goods for ONE curtain (fabric + 6" cut + chain + 0.5 lb/ft hardware); null when the fabric has no oz. */
export function weightEach(c: CutSheetCurtain): number | null {
  const fab = c.fabric ? fabricFromPart({ desc: c.fabric.name, oz: c.fabric.oz, ozBasis: c.fabric.ozBasis, boltWidthIn: c.fabric.boltWidthIn }) : null;
  if (!fab) return null;
  return computeSetWeight(
    { name: c.name, fabResolved: fab, w: c.widthFt, h: c.heightFt, full: c.fullnessPct, qty: 1, chain: c.bottomFinish === "chain" ? CHAIN_JACK : CHAIN_NONE, batten: 0, mode: "dead" },
    DEFAULT_WEIGHTS
  ).goods;
}

function trackHardware(curtains: CutSheetCurtain[], partInfo: CollectInput["partInfo"]): CutSheetHardware[] {
  const seen = new Set<SpecItem>();
  const out = new Map<string, CutSheetHardware>();
  for (const c of curtains) {
    const line = c.mount.track?.line;
    if (!line || seen.has(line)) continue;
    seen.add(line);
    // each component's qty already counts the line's config.qty tracks
    for (const comp of line.components || []) {
      if (!comp.sku || !(comp.qty > 0)) continue;
      const cur = out.get(comp.sku);
      if (cur) cur.qty += comp.qty;
      else out.set(comp.sku, { sku: comp.sku, desc: partInfo.get(comp.sku)?.desc || comp.label || comp.sku, qty: comp.qty, unit: comp.unit || partInfo.get(comp.sku)?.unit || "ea", from: "track" });
    }
  }
  return [...out.values()];
}

function ruleHardware(curtains: CutSheetCurtain[], spacingIn: number, input: CollectInput, warnings: string[]): CutSheetHardware[] {
  const key = curtains[0].mount.key;
  const rows = isMountTypeId(key) ? input.mounts[key]?.rows ?? [] : [];
  if (!rows.length) {
    warnings.push(`No hardware listed for ${MOUNT_KEY_LABELS[key]} — Estimating Rules → Curtain mounts`);
    return [];
  }
  const out = new Map<string, CutSheetHardware>();
  for (const row of rows) {
    let qty = 0;
    for (const c of curtains) {
      const marks = c.topFinish === "grommets" ? topMarks(c.widthFt, spacingIn).count : 0;
      qty += mountRowQty(row.rule, { widthFt: c.widthFt, marks }) * c.qty;
    }
    if (!(qty > 0)) continue;
    const info = input.partInfo.get(row.sku);
    const cur = out.get(row.sku);
    if (cur) cur.qty += qty;
    else out.set(row.sku, { sku: row.sku, desc: info?.desc || row.sku, qty, unit: info?.unit || "ea", from: "mount-rules" });
  }
  return [...out.values()];
}

export function collectCurtainTypes(input: CollectInput): CollectResult {
  const read = readCurtains(input.quote.spec, input.fabrics, input.trackSeries, input.grid?.project ?? null);
  const groups = new Map<string, CutSheetCurtain[]>();
  for (const c of read.curtains) {
    const k = curtainTypeKey(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const nameCount = new Map<string, number>();
  for (const cs of groups.values()) {
    const n = cs[0].name.trim().toLowerCase();
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const types = [...groups].map(([key, curtains], i): CurtainType => {
    const first = curtains[0];
    const fabricName = first.fabric?.name || first.fabricText || "fabric";
    const title = (nameCount.get(first.name.trim().toLowerCase()) ?? 0) > 1 ? `${first.name} (${fabricName})` : first.name;
    const bySize = new Map<string, { widthFt: number; heightFt: number; qty: number }>();
    for (const c of curtains) {
      const k = `${c.widthFt}x${c.heightFt}`;
      const s = bySize.get(k);
      if (s) s.qty += c.qty;
      else bySize.set(k, { widthFt: c.widthFt, heightFt: c.heightFt, qty: c.qty });
    }
    const sizes = [...bySize.values()].sort((a, b) => b.widthFt * b.heightFt - a.widthFt * a.heightFt || b.widthFt - a.widthFt);
    const totalQty = curtains.reduce((a, c) => a + c.qty, 0);
    const markSpacingIn = Math.min(...curtains.map((c) => c.mount.track?.carrierSpacingIn ?? DEFAULT_MARK_SPACING_IN));
    const warnings = [...new Set(curtains.flatMap((c) => c.warnings))];
    const hardware = first.mount.source === "track" ? trackHardware(curtains, input.partInfo) : ruleHardware(curtains, markSpacingIn, input, warnings);
    const sewnAreaSqftEach = curtains.map(sewnAreaEach);
    const sewnAreaSqftTotal = curtains.reduce((a, c, j) => a + sewnAreaSqftEach[j] * c.qty, 0);
    const weightLbEach = curtains.map(weightEach);
    const weightLbTotal = weightLbEach.some((w) => w == null) ? null : curtains.reduce((a, c, j) => a + (weightLbEach[j] as number) * c.qty, 0);
    if (!first.fabric) warnings.push(`Fabric not in the catalog: ${first.fabricText || "—"} — Catalog`);
    else {
      if (weightLbTotal == null) warnings.push(`Weight not set for ${first.fabric.name} — Catalog`);
      if (!first.fabric.flameRating) warnings.push(`Flame rating not set for ${first.fabric.name} — Catalog`);
    }
    if (curtains.some((c) => c.mount.source === "assumed")) warnings.push(`Mount assumed: ${MOUNT_KEY_LABELS[first.mount.key]} — pick one on the curtain`);
    // a pipe-pocket bottom weighs as no chain (the bottom pipe is not in computeSetWeight) — flag it, never invent a number
    const weightNote = first.bottomFinish === "pipe-pocket" ? PIPE_POCKET_WEIGHT_NOTE : undefined;
    return { key, sheetNo: `CS-${i + 1}`, title, curtains, sizes, totalQty, markSpacingIn, hardware, sewnAreaSqftEach, sewnAreaSqftTotal, weightLbEach, weightLbTotal, warnings, ...(weightNote ? { weightNote } : {}) };
  });
  return { types, unreadable: read.unreadable, skippedOptional: read.skippedOptional, notes: read.notes };
}
