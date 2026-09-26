/**
 * The Grid — Auto fill placement rules (#GEM, spec §5). Pure. Turns priced
 * Auto cards into placement specs on the GENERATED base sheet, using the same
 * venue geometry the sheet was drawn from (prosGeom / churchGeom, and for the
 * other kinds the fixed-fraction frame starterSpaces() in grid-projects.ts
 * already uses for Stage / Audience view / FOH·control).
 *
 * Rules (normalized 0..1, y grows downstage toward the house):
 *  - Lighting: pars / movers in rows on each electric (grid-seed's old row
 *    fractions); front lights in two rows front-of-house; cyc units along the
 *    cyc line; side lights alternating at the proscenium sides.
 *  - Audio: line-array boxes hung left / right of the proscenium; subs along
 *    the stage lip; mixer / DSP rack in the control booth.
 *  - Video: screen centred upstage; projector and processor in the booth.
 *  - Curtains: on their line-set positions (the old schematic fractions);
 *    legs at the stage-left edge; a pair lands as ONE drape of combined width.
 *  - Rigging: hoists / points / headblocks across the grid width on each set
 *    line; count or length hardware lands as ONE lot marker at the lock rail.
 *  - Anything else: spread along the lower margin of its scope's region.
 * Needs-a-part lines are never placed. Rows marked "lot", or any row with
 * qty > EACH_CAP, land as a single marker carrying `qty`.
 */
import { clamp01, type Point } from "@/lib/annotations";
import { venueOf, type AState, type SysKey, type TierKey } from "@/app/(app)/design/quick/engine";
import { churchGeom, prosGeom } from "@/app/(app)/design/quick/plan-svg";
import type { GridCurtain } from "./grid-bom";
import type { AutoTag } from "./grid-auto-model";
import type { AutoCard, AutoLine } from "./auto-estimate";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { allowancePartId, assemblyPartId } from "./grid-virtual-parts";

export type Rect = { x: number; y: number; w: number; h: number };
export type VenueFrame = { stage: Rect; audience: Rect; booth: Rect };
export const EACH_CAP = 120;

export function venueFrame(a: AState): VenueFrame {
  const kind = venueOf(a).kind || "proscenium";
  if (kind === "proscenium") {
    const G = prosGeom(a);
    const r = (x: number, y: number, w: number, h: number): Rect => ({ x: x / G.W, y: y / G.H, w: w / G.W, h: h / G.H });
    return {
      stage: r(G.stage.x, G.stage.y, G.stage.w, G.stage.h),
      audience: r(G.xAudL, G.yHouseFront, G.xAudR - G.xAudL, G.yBackWall - G.yHouseFront),
      booth: r(G.cx - G.boothW / 2, G.yBackWall, G.boothW, G.yBoothBottom - G.yBackWall),
    };
  }
  if (kind === "church") {
    const G = churchGeom(a);
    const r = (x: number, y: number, w: number, h: number): Rect => ({ x: x / G.W, y: y / G.H, w: w / G.W, h: h / G.H });
    return {
      stage: r(G.stage.x, G.stage.y, G.stage.w, G.stage.h),
      audience: r(G.x0, G.pBot, G.x1 - G.x0, G.seatBot - G.pBot),
      booth: r(G.cx - G.boothW / 2, G.y1, G.boothW, G.boothH),
    };
  }
  // flat / blackbox / gym / arena — starterSpaces()'s fixed-fraction frame.
  return {
    stage: { x: 0.2, y: 0.12, w: 0.6, h: 0.28 },
    audience: { x: 0.08, y: 0.58, w: 0.84, h: 0.32 },
    booth: { x: 0.38, y: 0.44, w: 0.24, h: 0.09 },
  };
}

/** The placement partId for a line: a catalog SKU, `asm:<id>`, `allow:<row>:<tier>` — null when it must not be placed. */
export function partIdForLine(line: Pick<AutoLine, "status" | "ref" | "rowKey" | "qty">, tier: TierKey): string | null {
  if (line.qty <= 0) return null;
  if (line.status === "part" && line.ref) return line.ref;
  if (line.status === "assembly" && line.ref) return assemblyPartId(line.ref);
  if (line.status === "allowance") return allowancePartId(line.rowKey, tier);
  return null;
}

export type AutoPlacementSpec = { x: number; y: number; partId: string; qty?: number; curtain?: GridCurtain; auto: AutoTag };

const round1 = (n: number) => Math.round(n * 10) / 10;

function spread(n: number, x0: number, x1: number, y: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: clamp01(x0 + ((i + 0.5) / n) * (x1 - x0)), y: clamp01(y) }));
}

/** n points round-robin across rows (one y per row), evenly across [x0, x1] within a row. */
function onRows(n: number, x0: number, x1: number, ys: number[]): Point[] {
  const rows = Math.max(1, ys.length);
  const perRow = Math.ceil(n / rows);
  return Array.from({ length: n }, (_, i) => {
    const row = i % rows;
    const col = Math.floor(i / rows);
    return { x: clamp01(x0 + ((col + 0.5) / perRow) * (x1 - x0)), y: clamp01(ys[row]) };
  });
}

/** Each electric's line, at the old seeder's row fractions ((E − j) / (E + 1) of the stage depth). */
function electricYs(S: Rect, electrics: number): number[] {
  const e = Math.max(1, electrics);
  return Array.from({ length: e }, (_, j) => S.y + ((e - j) / (e + 1)) * S.h);
}

/** k set lines evenly through the stage depth. */
function setLineYs(S: Rect, k: number): number[] {
  const n = Math.max(1, k);
  return Array.from({ length: n }, (_, i) => S.y + ((i + 0.5) / n) * S.h);
}

/** The old schematic's curtain fractions of stage depth (0 = upstage wall, 1 = plaster line). */
const CURTAIN_FRACS: Record<string, number[]> = {
  draw: [0.95, 0.5, 0.26],
  fullstage: [0.5, 0.3],
  border: [0.74, 0.48, 0.22],
  legs: [0.74, 0.48, 0.22],
};

function curtainPoints(itemKey: string, n: number, S: Rect): Point[] {
  const fracs = CURTAIN_FRACS[itemKey] ?? [0.5];
  return Array.from({ length: n }, (_, i) => {
    const frac = Math.max(0.02, fracs[i % fracs.length] - 0.04 * Math.floor(i / fracs.length));
    const x = itemKey === "legs" ? S.x - 0.03 * S.w : S.x + S.w / 2;
    return { x: clamp01(x), y: clamp01(S.y + frac * S.h) };
  });
}

function sidePoints(n: number, S: Rect): Point[] {
  const per = Math.max(1, Math.ceil(n / 2));
  return Array.from({ length: n }, (_, i) => {
    const k = Math.floor(i / 2);
    return { x: clamp01(i % 2 === 0 ? S.x - 0.02 : S.x + S.w + 0.02), y: clamp01(S.y + ((k + 0.5) / per) * S.h) };
  });
}

/** Line-array boxes: alternating left / right hangs just downstage of the proscenium, stacked. */
function clusterPoints(n: number, S: Rect): Point[] {
  const y0 = S.y + S.h + 0.02;
  return Array.from({ length: n }, (_, i) => ({
    x: clamp01(i % 2 === 0 ? S.x - 0.03 : S.x + S.w + 0.03),
    y: clamp01(y0 + 0.012 * Math.floor(i / 2)),
  }));
}

/** Where the k-th lot marker of a scope sits: rigging at the lock rail (stage right), others on their region's lower margin. */
function lotPoint(scope: SysKey, k: number, f: VenueFrame): Point {
  const S = f.stage;
  if (scope === "rigging") return { x: clamp01(S.x + S.w + 0.02), y: clamp01(S.y + (0.1 + 0.08 * k) * S.h) };
  const R = scope === "audio" ? f.audience : S;
  return { x: clamp01(R.x + 0.06 + 0.07 * k), y: clamp01(R.y + R.h - 0.03) };
}

function eachPoints(line: AutoLine, n: number, f: VenueFrame, opts: { electrics: number; sets: number }): Point[] {
  const { stage: S, audience: A, booth: B } = f;
  switch (line.rowKey) {
    case "lighting:par":
    case "lighting:automated":
      return onRows(n, S.x, S.x + S.w, electricYs(S, opts.electrics));
    case "lighting:front":
      return onRows(n, A.x, A.x + A.w, [A.y + 0.45 * A.h, A.y + 0.6 * A.h]);
    case "lighting:cyc":
      return spread(n, S.x, S.x + S.w, S.y + 0.05 * S.h);
    case "lighting:side":
      return sidePoints(n, S);
    case "audio:lineArray":
      return clusterPoints(n, S);
    case "audio:subwoofer":
      return spread(n, S.x, S.x + S.w, S.y + S.h - 0.01);
    case "audio:mixerDsp":
    case "video:processor":
    case "video:projector":
      return spread(n, B.x, B.x + B.w, B.y + B.h / 2);
    case "video:screen":
      return spread(n, S.x + 0.3 * S.w, S.x + 0.7 * S.w, S.y + 0.1 * S.h);
    case "rigging:electricHoist":
    case "rigging:lowCapHoist":
    case "rigging:highCapHoist":
    case "rigging:varSpeedHoist":
    case "rigging:riggingPoint":
    case "rigging:headblock":
      return onRows(n, S.x, S.x + S.w, setLineYs(S, Math.min(n, Math.max(1, opts.sets))));
    default: {
      const R = line.scope === "audio" ? A : S;
      return spread(n, R.x, R.x + R.w, R.y + R.h - 0.03);
    }
  }
}

/**
 * Placement specs for the given cards (spec §5). `a` is the geometry the base
 * sheet was drawn from (intake.autoConfig); `opts` are that design's electric
 * and set counts (compute()), plus `kept` — units per row already on the plan
 * by hand (keptUnitsByRow, D-GEM-20), subtracted before placing. Every spec
 * carries `auto: { scope, rowKey, tier }`.
 */
export function generateAutoLayout(
  a: AState,
  cards: AutoCard[],
  opts: { electrics: number; sets: number; kept?: Readonly<Record<string, number>> }
): AutoPlacementSpec[] {
  const f = venueFrame(a);
  const out: AutoPlacementSpec[] = [];
  const lots = new Map<SysKey, number>();
  for (const card of cards) {
    for (const rawLine of card.lines) {
      // D-GEM-20: units of this row kept by hand (hand-moved / edited devices
      // that still carry its autoOrigin) count toward the new quantity — only
      // the difference is placed, never below zero.
      const keptUnits = Math.max(0, Math.round(opts.kept?.[rawLine.rowKey] ?? 0));
      const line = keptUnits ? { ...rawLine, qty: Math.max(0, rawLine.qty - keptUnits) } : rawLine;
      const partId = partIdForLine(line, card.tier);
      if (!partId) continue;
      const def = EQUIPMENT_ROW_BY_KEY.get(line.rowKey);
      if (!def) continue;
      const auto: AutoTag = { scope: card.scope, rowKey: line.rowKey, tier: card.tier };
      if (def.curtain && line.drape && line.status === "part" && line.ref) {
        const drape = line.drape;
        const fabricSku = line.ref;
        const gridType = def.curtain.grid;
        curtainPoints(def.itemKey, line.qty, f.stage).forEach((pt, i) =>
          out.push({
            ...pt,
            partId: fabricSku,
            auto,
            curtain: {
              type: gridType,
              name: `${line.label} ${i + 1}`,
              widthFt: round1(drape.w * drape.qty),
              heightFt: round1(drape.h),
              fullnessPct: drape.fullness,
              fabricSku,
            },
          })
        );
        continue;
      }
      if (def.place === "lot" || line.qty > EACH_CAP) {
        const k = lots.get(card.scope) ?? 0;
        lots.set(card.scope, k + 1);
        out.push({ ...lotPoint(card.scope, k, f), partId, qty: line.qty, auto });
        continue;
      }
      for (const pt of eachPoints(line, line.qty, f, opts)) out.push({ ...pt, partId, auto });
    }
  }
  return out;
}
