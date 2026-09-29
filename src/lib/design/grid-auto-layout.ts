/**
 * The Grid — Auto fill placement rules (#211, spec §5). Pure. Turns priced
 * Auto cards into placement specs on the GENERATED base sheet, using the same
 * venue geometry the sheet was drawn from — the stamped template's (prosGeom /
 * churchGeom), a pre-template sheet's legacy schematic (legacyProsGeom /
 * legacyChurchGeom), and for the other kinds the fixed-fraction frame
 * starterSpaces() in grid-projects.ts uses for Stage / Audience view /
 * FOH·control.
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
import { arenaGeom, blackboxGeom, churchGeom, planTemplate, prosGeom } from "@/app/(app)/design/quick/plan-svg";
import { templateEntry } from "@/lib/design/venue-templates";
import { legacyChurchGeom } from "./legacy-church-geom";
import { legacyProsGeom } from "./legacy-pros-geom";
import type { GridCurtain } from "./grid-bom";
import type { AutoTag } from "./grid-auto-model";
import type { AutoCard, AutoLine } from "./auto-estimate";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { allowancePartId, assemblyPartId } from "./grid-virtual-parts";

export type Rect = { x: number; y: number; w: number; h: number };
/**
 * Normalized to the base sheet. `catwalk` / `stageEdge` exist only where the drawing's template has them (#249 Auditorium).
 * `room` (#255 review, blackbox family only): the walls every point outside the Booth stays inside.
 */
export type VenueFrame = {
  stage: Rect;
  audience: Rect;
  booth: Rect;
  catwalk?: Rect;
  stageEdge?: Point[];
  room?: Rect;
  /** #255: an arena's movable stage — stage-relative placements turn by this (radians; 0 = facing down the sheet) about the stage's centre; aspect = sheet H / W. */
  stageAngle?: number;
  aspect?: number;
};
export const EACH_CAP = 120;

export function venueFrame(a: AState, opts: { legacy?: boolean; template?: string | null } = {}): VenueFrame {
  const kind = venueOf(a).kind || "proscenium";
  if (!opts.legacy) {
    // #249/#255: the frame of the drawing the sheet was drawn from — resolved exactly as buildPlan
    // draws it (planTemplate: a known id as named, else the kind default).
    const id = planTemplate(a, opts.template);
    const family = templateEntry(id)?.family;
    const W = (g: { W: number; H: number }) => (r: Rect): Rect => ({ x: r.x / g.W, y: r.y / g.H, w: r.w / g.W, h: r.h / g.H });
    if (family === "proscenium") {
      // The template's own House, Booth and Catwalk, and its stage-edge curve.
      const G = prosGeom(a, id);
      const n = W(G);
      return {
        stage: n(G.stage),
        audience: n(G.house),
        booth: n(G.booth),
        ...(G.catwalk ? { catwalk: n(G.catwalk) } : {}),
        ...(G.stageEdge.length > 1 ? { stageEdge: G.stageEdge.map((p) => ({ x: p.x / G.W, y: p.y / G.H })) } : {}),
      };
    }
    if (family === "church") {
      // The Platform's stage box (never its whole bounding box: Traditional's front step and Contemporary's
      // splays and pointed front reach past the rooms beside it), the Nave, and the booth room or FOH mix position.
      const G = churchGeom(a, id);
      const n = W(G);
      return { stage: n(G.stageBox), audience: n(G.nave), booth: n(G.booth) };
    }
    if (family === "blackbox") {
      const G = blackboxGeom(a, id);
      const n = W(G);
      const room = n(G.room);
      // Conference: the platform is the stage and the room behind it the audience; a black box plays in the whole room,
      // its stage frame inset from the walls (blackboxStage) so the rules that hang things beside or below it stay inside.
      const aud: Rect = kind === "flat" ? { x: G.room.x, y: G.platform.y + G.platform.h, w: G.room.w, h: G.room.y + G.room.h - (G.platform.y + G.platform.h) } : G.room;
      return { stage: kind === "flat" ? n(G.platform) : blackboxStage(room), audience: n(aud), booth: n(G.booth), room };
    }
    if (family === "arena") {
      // The end stage laid out as if at the top end (width across, depth down) about its centre, turned by stageAngle
      // into place (generateAutoLayout's `turn`); the floor is the audience; the Booth wherever it sits.
      const G = arenaGeom(a, id);
      const n = W(G);
      const st: Rect = { x: G.stageCentre.x - G.stageAlong / 2, y: G.stageCentre.y - G.stageDepth / 2, w: G.stageAlong, h: G.stageDepth };
      return { stage: n(st), audience: n(G.floor), booth: n(G.booth), ...(Math.abs(G.stageAngle) > 1e-9 ? { stageAngle: G.stageAngle, aspect: G.H / G.W } : {}) };
    }
  }
  if (kind === "proscenium") {
    // A base sheet no template drew (before #249) keeps the old schematic's frame, so a re-fill lands on the plan the design has.
    const G = legacyProsGeom(a);
    const r = (x: number, y: number, w: number, h: number): Rect => ({ x: x / G.W, y: y / G.H, w: w / G.W, h: h / G.H });
    return {
      stage: r(G.stage.x, G.stage.y, G.stage.w, G.stage.h),
      audience: r(G.xAudL, G.yHouseFront, G.xAudR - G.xAudL, G.yBackWall - G.yHouseFront),
      booth: r(G.cx - G.boothW / 2, G.yBackWall, G.boothW, G.yBoothBottom - G.yBackWall),
    };
  }
  if (kind === "church") {
    // A church sheet no template drew (before #255) keeps the old schematic's frame.
    const G = legacyChurchGeom(a);
    const r = (x: number, y: number, w: number, h: number): Rect => ({ x: x / G.W, y: y / G.H, w: w / G.W, h: h / G.H });
    return {
      stage: r(G.stage.x, G.stage.y, G.stage.w, G.stage.h),
      audience: r(G.x0, G.pBot, G.x1 - G.x0, G.seatBot - G.pBot),
      booth: r(G.cx - G.boothW / 2, G.y1, G.boothW, G.boothH),
    };
  }
  // flat / blackbox / arena sheets no template drew (before #255) — starterSpaces()'s fixed-fraction frame.
  return {
    stage: { x: 0.2, y: 0.12, w: 0.6, h: 0.28 },
    audience: { x: 0.08, y: 0.58, w: 0.84, h: 0.32 },
    booth: { x: 0.38, y: 0.44, w: 0.24, h: 0.09 },
  };
}

/** Line-array boxes stack two to a row, `CLUSTER_STEP` apart, starting `CLUSTER_GAP` below the stage frame (clusterPoints). */
const CLUSTER_GAP = 0.02;
const CLUSTER_STEP = 0.012;
/** The most boxes the equations call for (engine: width ÷ 3, 6–24). */
const CLUSTER_MAX_ROWS = 12;
/** How far inside the room's walls a clamped point stays (normalized). */
const ROOM_MARGIN = 0.01;

/**
 * #255 review: a black box's Auto-fill stage — the room inset 0.05 of the sheet's width from each side wall (side
 * lights hang 0.02 outside the stage frame, line arrays 0.03, the rigging lot 0.02, legs 0.03 of its width) and,
 * at the house end, by room for the deepest line-array stack the equations call for (12 rows) — never more than
 * 0.4 of the room's depth; a stack deeper than what is left closes up (clusterPoints).
 */
function blackboxStage(room: Rect): Rect {
  const side = 0.05;
  const bottom = Math.min(CLUSTER_GAP + CLUSTER_STEP * (CLUSTER_MAX_ROWS - 1) + 0.012, 0.4 * room.h);
  return { x: room.x + side, y: room.y, w: Math.max(0, room.w - 2 * side), h: Math.max(0, room.h - bottom) };
}

/** A point kept inside the room's walls (ROOM_MARGIN in from each). */
function inRoom(p: Point, r: Rect): Point {
  const m = (lo: number, hi: number, v: number) => (hi - lo > 2 * ROOM_MARGIN ? Math.min(hi - ROOM_MARGIN, Math.max(lo + ROOM_MARGIN, v)) : (lo + hi) / 2);
  return { x: m(r.x, r.x + r.w, p.x), y: m(r.y, r.y + r.h, p.y) };
}

/** #255: placements laid out relative to the stage — they turn with an arena's movable stage. */
const STAGE_ROWS = new Set(["lighting:par", "lighting:automated", "lighting:cyc", "lighting:side", "audio:lineArray", "audio:subwoofer", "video:screen", "rigging:electricHoist", "rigging:lowCapHoist", "rigging:highCapHoist", "rigging:varSpeedHoist", "rigging:riggingPoint", "rigging:headblock"]);

/** Rows that belong in the Booth room — the only points a blackbox-family fill may put outside the room. */
const BOOTH_ROWS = new Set(["audio:mixerDsp", "video:processor", "video:projector"]);

/**
 * #255: the geometry Auto fill lays out on — the intake's design, its movable rooms where the stamped sheet drew
 * them (never where the intake says now), or home when the sheet was stamped before rooms moved (a stamp with no
 * `baseSheetMovables`). An unstamped (pre-template) sheet keeps the intake as it is; `stamp` = the sheet's template.
 */
export function fillGeometry(intake: { autoConfig?: AState; baseSheetTemplate?: string; baseSheetMovables?: Record<string, { wall: string; t: number }> } | undefined): { a: AState | undefined; stamp: string | undefined } {
  const a0 = intake?.autoConfig;
  const stamp = intake?.baseSheetTemplate;
  return { a: a0 && stamp ? { ...a0, movables: intake?.baseSheetMovables ?? null } : a0, stamp };
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

/** n points evenly along a polyline (by length), each centred in its share. */
function alongPath(n: number, pts: Point[]): Point[] {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = seg.reduce((s, d) => s + d, 0);
  return Array.from({ length: n }, (_, i) => {
    let d = ((i + 0.5) / n) * total;
    for (let j = 0; j < seg.length; j++) {
      if (d <= seg[j] || j === seg.length - 1) {
        const t = seg[j] ? Math.min(1, d / seg[j]) : 0;
        return { x: clamp01(pts[j].x + (pts[j + 1].x - pts[j].x) * t), y: clamp01(pts[j].y + (pts[j + 1].y - pts[j].y) * t) };
      }
      d -= seg[j];
    }
    return pts[0];
  });
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

/**
 * Line-array boxes: alternating left / right hangs just downstage of the proscenium, stacked. Inside a `room`
 * (#255 review) a stack too deep for the space below the stage frame closes up so its last row stays inside.
 */
function clusterPoints(n: number, S: Rect, room?: Rect): Point[] {
  const y0 = S.y + S.h + CLUSTER_GAP;
  const rows = Math.ceil(n / 2);
  const step = room && rows > 1 ? Math.min(CLUSTER_STEP, Math.max(0, (room.y + room.h - ROOM_MARGIN - y0) / (rows - 1))) : CLUSTER_STEP;
  return Array.from({ length: n }, (_, i) => ({
    x: clamp01(i % 2 === 0 ? S.x - 0.03 : S.x + S.w + 0.03),
    y: clamp01(y0 + step * Math.floor(i / 2)),
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
      // #249: on the template plan, front lights hang on the catwalk.
      if (f.catwalk) return spread(n, f.catwalk.x + 0.06 * f.catwalk.w, f.catwalk.x + 0.94 * f.catwalk.w, f.catwalk.y + f.catwalk.h / 2);
      return onRows(n, A.x, A.x + A.w, [A.y + 0.45 * A.h, A.y + 0.6 * A.h]);
    case "lighting:cyc":
      return spread(n, S.x, S.x + S.w, S.y + 0.05 * S.h);
    case "lighting:side":
      return sidePoints(n, S);
    case "audio:lineArray":
      return clusterPoints(n, S, f.room);
    case "audio:subwoofer":
      // #249: subs sit along the stage-edge curve.
      if (f.stageEdge && f.stageEdge.length > 1) return alongPath(n, f.stageEdge);
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
 * by hand (keptUnitsByRow, D320), subtracted before placing — `template`,
 * the id the base sheet was stamped with (intake.baseSheetTemplate), and
 * `legacy`, true when no template drew the sheet (pre-#249 proscenium,
 * pre-#255 church), so the fill lands on the plan the design actually has.
 * Every spec carries `auto: { scope, rowKey, tier }`.
 */
export function generateAutoLayout(
  a: AState,
  cards: AutoCard[],
  opts: { electrics: number; sets: number; kept?: Readonly<Record<string, number>>; legacy?: boolean; template?: string | null }
): AutoPlacementSpec[] {
  const f = venueFrame(a, { legacy: opts.legacy, template: opts.template });
  // #255 review: on a blackbox-family plan nothing but the Booth's rows lands outside the room — a backstop for
  // quantities past what the rules lay out inside it (an edited count, a long run of lot markers).
  const room = f.room;
  const keep = (rowKey: string) => (p: Point): Point => (room && !BOOTH_ROWS.has(rowKey) ? inRoom(p, room) : p);
  // #255: stage-relative points turned with an arena's stage about its centre (in true proportions: y scaled by the
  // sheet's aspect first). No stageAngle — every other frame — leaves them exactly as laid out.
  const turn = (pts: Point[]): Point[] => {
    if (!f.stageAngle) return pts;
    const cx = f.stage.x + f.stage.w / 2, cy = f.stage.y + f.stage.h / 2, k = f.aspect ?? 1, c = Math.cos(f.stageAngle), s = Math.sin(f.stageAngle);
    return pts.map((p) => {
      const dx = p.x - cx, dy = (p.y - cy) * k;
      return { x: clamp01(cx + dx * c - dy * s), y: clamp01(cy + (dx * s + dy * c) / k) };
    });
  };
  const out: AutoPlacementSpec[] = [];
  const lots = new Map<SysKey, number>();
  for (const card of cards) {
    for (const rawLine of card.lines) {
      // D320: units of this row kept by hand (hand-moved / edited devices
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
        turn(curtainPoints(def.itemKey, line.qty, f.stage)).map(keep(line.rowKey)).forEach((pt, i) =>
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
        const lot = card.scope === "rigging" ? turn([lotPoint(card.scope, k, f)])[0] : lotPoint(card.scope, k, f);
        out.push({ ...keep(line.rowKey)(lot), partId, qty: line.qty, auto });
        continue;
      }
      const pts = eachPoints(line, line.qty, f, opts);
      for (const pt of (STAGE_ROWS.has(line.rowKey) ? turn(pts) : pts).map(keep(line.rowKey))) out.push({ ...pt, partId, auto });
    }
  }
  return out;
}
