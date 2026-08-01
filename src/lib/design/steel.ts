/**
 * Structural steel + rigging engine — native port of the Peak Structural
 * Steel Calculator (the uploaded standalone tool). Pure functions + data, no
 * DOM. Powers the Design → Steel Calculator tools.
 *
 * Faithful to the source: AISC ASD flexure/shear (F2/G), the 848-section
 * property database, the ETC Prodigy hoist table, batten/bridle statics, and
 * the lineset weight / counterweight math. Units follow the source: forces in
 * lb, lengths in ft (converted to in where the formulas need it), section
 * properties in the AISC in-based units, E and Fy in ksi.
 */

import shapesData from "./steel-shapes.json";
import { battenLenFt, DEFAULT_VENUE_DIMS } from "./venue-dims";

export type SteelShape = {
  id: string;
  type: string; // W,S,C,MC,L,HSS,HSS-R,PIPE,HP,M
  grade: string;
  Fy: number;
  Fu: number;
  wt: number; // lb/ft
  A: number;
  d: number;
  b: number;
  tw: number;
  tf: number | null;
  Ix: number;
  Sx: number;
  Zx: number;
  rx: number;
  Iy: number;
  Sy: number;
  Zy: number;
  ry: number;
  J: number;
  Cw: number | null;
  rts: number | null;
  ho: number | null;
  OD: number | null;
  tdes: number | null;
};

export const SHAPES = shapesData as SteelShape[];

/* ------------------------------ constants ------------------------------ */

export const E = 29000; // ksi
export const OMEGA_B = 1.67; // ASD flexure
export function omegaV(t: string): number {
  return t === "W" || t === "S" || t === "HP" || t === "M" ? 1.5 : 1.67;
}

export const FAM_ORDER = ["W", "S", "C", "MC", "L", "HSS", "HSS-R", "PIPE"] as const;
export const FAM_LABEL: Record<string, string> = {
  W: "W — Wide flange",
  S: "S — Std I-beam",
  C: "C — Channel",
  MC: "MC — Channel",
  L: "L — Angle",
  HSS: "HSS — Rect/Square tube",
  "HSS-R": "HSS — Round",
  PIPE: "Pipe (Sch-40)",
};

/** Families actually present in the database, in canonical order. */
export function familiesPresent(): string[] {
  const set = new Set(SHAPES.map((s) => s.type));
  return FAM_ORDER.filter((f) => set.has(f));
}

export function shapeById(id: string): SteelShape | undefined {
  return SHAPES.find((s) => s.id === id);
}

/* ------------------------------ flexure/shear ------------------------------ */

export type Flexure = { Mn: number; Mp: number; mode: string; Lp?: number; Lr?: number };

/** AISC F2 flexural nominal strength (kip-in), with LTB for open sections.
 *  Lb in inches. */
export function flexure(s: SteelShape, Lb: number, Cb = 1): Flexure {
  const Fy = s.Fy;
  const Zx = s.Zx;
  const Sx = s.Sx;
  const Mp = Fy * Zx;
  const openI = ["W", "S", "C", "MC", "HP", "M"].includes(s.type);
  if (openI && s.ry && s.rts && s.ho && s.J) {
    let c = 1;
    if ((s.type === "C" || s.type === "MC") && s.Cw && s.Iy) c = (s.ho / 2) * Math.sqrt(s.Iy / s.Cw);
    const Lp = 1.76 * s.ry * Math.sqrt(E / Fy);
    const jc = (s.J * c) / (Sx * s.ho);
    const Lr =
      1.95 * s.rts * (E / (0.7 * Fy)) *
      Math.sqrt(jc + Math.sqrt(jc * jc + 6.76 * Math.pow((0.7 * Fy) / E, 2)));
    let Mn: number;
    let mode: string;
    if (Lb <= Lp) {
      Mn = Mp;
      mode = "Yielding (Lb ≤ Lp)";
    } else if (Lb <= Lr) {
      Mn = Math.min(Cb * (Mp - (Mp - 0.7 * Fy * Sx) * ((Lb - Lp) / (Lr - Lp))), Mp);
      mode = "Inelastic LTB";
    } else {
      const Fcr =
        ((Cb * Math.PI * Math.PI * E) / Math.pow(Lb / s.rts, 2)) *
        Math.sqrt(1 + 0.078 * jc * Math.pow(Lb / s.rts, 2));
      Mn = Math.min(Fcr * Sx, Mp);
      mode = "Elastic LTB";
    }
    return { Mn, Mp, mode, Lp, Lr };
  }
  if (s.type === "L") return { Mn: Fy * Sx, Mp, mode: "Angle ≈ Fy·Sx (approx — verify F10)" };
  return { Mn: Mp, Mp, mode: "Yielding (Mp, closed section)" };
}

export type Shear = { Vn: number; omega: number };

/** AISC G shear nominal strength (kips). */
export function shear(s: SteelShape): Shear {
  const Fy = s.Fy;
  if (["W", "S", "C", "MC", "HP", "M"].includes(s.type)) {
    const Aw = s.d * s.tw;
    return { Vn: 0.6 * Fy * Aw, omega: omegaV(s.type) };
  }
  if (s.type === "HSS") {
    const t = s.tdes || 0;
    const h = s.d - 3 * t;
    return { Vn: 0.6 * Fy * 2 * h * t, omega: 1.67 };
  }
  if (s.type === "HSS-R" || s.type === "PIPE") return { Vn: 0.6 * Fy * (s.A / 2), omega: 1.67 };
  if (s.type === "L") return { Vn: 0.6 * Fy * (s.b * s.tw), omega: 1.67 };
  return { Vn: 0.6 * Fy * s.A * 0.5, omega: 1.67 };
}

export type LoadType = "uniform" | "point";
export type BeamCapacity = {
  fx: Flexure;
  sh: Shear;
  Ma: number;
  Va: number;
  Mp: number;
  asd: { bend: number; shear: number; defl: number; gov: number; govBy: string };
  rig: { bend: number; shear: number; gov: number; govBy: string };
  /** Deflection (in) at a given total load in lb. */
  deflAt: (Wlb: number) => number;
};

/** Allowable load by limit state, ASD + rigging WLL. Returns loads in lb.
 *  L_ft = span, Lb_ft = unbraced length (defaults to span). */
export function beamCapacity(
  s: SteelShape,
  L_ft: number,
  loadType: LoadType,
  Cb: number,
  DF: number,
  deflRatio: number,
  Lb_ft?: number
): BeamCapacity {
  const L = L_ft * 12;
  const fx = flexure(s, (Lb_ft != null ? Lb_ft : L_ft) * 12, Cb);
  const sh = shear(s);
  const Ma = fx.Mn / OMEGA_B;
  const Va = sh.Vn / sh.omega;
  const I = s.Ix;
  const dLim = L / deflRatio;
  const a: { bend: number; shear: number; defl: number } = { bend: 0, shear: 0, defl: 0 };
  const r: { bend: number; shear: number } = { bend: 0, shear: 0 };
  if (loadType === "uniform") {
    a.bend = (8 * Ma) / L;
    a.shear = 2 * Va;
    a.defl = (dLim * 384 * E * I) / (5 * L * L * L);
    r.bend = (8 * (fx.Mp / DF)) / L;
    r.shear = 2 * (sh.Vn / DF);
  } else {
    a.bend = (4 * Ma) / L;
    a.shear = 2 * Va;
    a.defl = (48 * E * I * dLim) / (L * L * L);
    r.bend = (4 * (fx.Mp / DF)) / L;
    r.shear = 2 * (sh.Vn / DF);
  }
  const aGov = Math.min(a.bend, a.shear, a.defl);
  const govBy = ["bending", "shear", "deflection"][[a.bend, a.shear, a.defl].indexOf(aGov)];
  const rGov = Math.min(r.bend, r.shear);
  const k = (x: number) => x * 1000; // kips → lb
  return {
    fx,
    sh,
    Ma,
    Va,
    Mp: fx.Mp,
    asd: { bend: k(a.bend), shear: k(a.shear), defl: k(a.defl), gov: k(aGov), govBy },
    rig: { bend: k(r.bend), shear: k(r.shear), gov: k(rGov), govBy: r.bend < r.shear ? "bending" : "shear" },
    deflAt: (Wlb: number) => {
      const W = Wlb / 1000;
      return loadType === "uniform"
        ? (5 * W * L * L * L) / (384 * E * I)
        : (W * L * L * L) / (48 * E * I);
    },
  };
}

/* ------------------------------ rigging statics ------------------------------ */

export type BattenPoint = { x: number; w: number }; // x in ft from left, w in lb

/** Batten / beam reactions for two pickups + self weight + point loads. */
export function battenReactions(
  L: number,
  selfPlf: number,
  x1: number,
  x2: number,
  pts: BattenPoint[]
) {
  const loads = pts.filter((l) => l.w > 0);
  const Wself = selfPlf * L;
  const Wpts = loads.reduce((a, l) => a + l.w, 0);
  const Wtot = Wself + Wpts;
  const span = x2 - x1;
  if (span <= 0) return null;
  let M1 = Wself * (L / 2 - x1);
  loads.forEach((l) => (M1 += l.w * (l.x - x1)));
  const R2 = M1 / span;
  const R1 = Wtot - R2;
  const cg = (Wself * (L / 2) + loads.reduce((a, l) => a + l.w * l.x, 0)) / Wtot;
  let maxM = 0;
  let maxMx = 0;
  for (let x = 0; x <= L; x += Math.max(L / 400, 0.05)) {
    let M = 0;
    if (x > x1) M += R1 * (x - x1);
    if (x > x2) M += R2 * (x - x2);
    M -= (selfPlf * x * x) / 2;
    loads.forEach((l) => {
      if (l.x < x) M -= l.w * (x - l.x);
    });
    if (Math.abs(M) > Math.abs(maxM)) {
      maxM = M;
      maxMx = x;
    }
  }
  return { Wself, Wpts, Wtot, R1, R2, cg, maxM, maxMx, maxLine: Math.max(R1, R2) };
}

/** Two-leg bridle leg tensions from run/rise geometry. */
export function twoLegBridle(
  W: number,
  aRun: number,
  aRise: number,
  bRun: number,
  bRise: number
) {
  if (aRise <= 0 || bRise <= 0) return null;
  const a1 = Math.atan2(aRise, aRun);
  const a2 = Math.atan2(bRise, bRun);
  const denom = Math.sin(a1 + a2);
  const T_A = (W * Math.cos(a2)) / denom;
  const T_B = (W * Math.cos(a1)) / denom;
  return {
    T_A,
    T_B,
    degA: (a1 * 180) / Math.PI,
    degB: (a2 * 180) / Math.PI,
    lenA: Math.hypot(aRun, aRise),
    lenB: Math.hypot(bRun, bRise),
    hThrustA: T_A * Math.cos(a1),
    hThrustB: T_B * Math.cos(a2),
  };
}

/* ------------------------------ hoists & goods data ------------------------------ */

export type Hoist = {
  id: string;
  name: string;
  fam: string;
  cap: number;
  pw: number;
  perMin: number;
  perMax: number;
  speed: string;
};

export const PRODIGY_HOISTS: Hoist[] = [
  { id: "P900", name: "P1 · P650E/P800G/P900G — 900 lb", fam: "P1", cap: 900, pw: 395, perMin: 25, perMax: 420, speed: "30 fpm" },
  { id: "P1400", name: "P1 · P1000E/P1300G/P1400G — 1400 lb", fam: "P1", cap: 1400, pw: 395, perMin: 25, perMax: 420, speed: "30 fpm" },
  { id: "P2000", name: "P1 · P1500E/P1900G/P2000G — 2000 lb", fam: "P1", cap: 2000, pw: 580, perMin: 25, perMax: 420, speed: "30 fpm" },
  { id: "V1200", name: "P1 · V1000S/V1200S variable — 1200 lb", fam: "P1", cap: 1200, pw: 500, perMin: 25, perMax: 420, speed: "0–180 fpm" },
  { id: "P2-650", name: "P2 · P2-650LB — 650 lb", fam: "P2", cap: 650, pw: 300, perMin: 25, perMax: 420, speed: "25 fpm" },
  { id: "P2-650CT", name: "P2 · P2-650LB-CT — 650 lb", fam: "P2", cap: 650, pw: 350, perMin: 25, perMax: 420, speed: "25 fpm" },
  { id: "P75-2000", name: "P75 · P75-2000G/GS — 2000 lb", fam: "P75", cap: 2000, pw: 875, perMin: 30, perMax: 700, speed: "20 fpm" },
  { id: "P75-3300", name: "P75 · P75-3300GS — 3300 lb", fam: "P75", cap: 3300, pw: 1070, perMin: 30, perMax: 700, speed: "15 fpm" },
  { id: "P75-SC", name: "P75 · P75-SC SoftLift — 3300 lb", fam: "P75", cap: 3300, pw: 1105, perMin: 30, perMax: 700, speed: "15 fpm" },
  { id: "P75-V1200", name: "P75 · P75-V1200S variable — 1200 lb", fam: "P75", cap: 1200, pw: 875, perMin: 30, perMax: 700, speed: "0–180 fpm" },
];

export const FAM_NOTES: Record<string, string> = {
  P1: "Prodigy P1 (rev B) — 25–420 lb / line",
  P2: "Prodigy P2 (rev D) — 25–420 lb / line",
  P75: "Prodigy P75 (rev D) — 30–700 lb / line · heavy capacity",
};

export const PRODIGY_MAXLINES = 8;
export const PRODIGY_MAXLINES_CM = 7;
export const PRODIGY_PERLINE_MIN = 25;
export const PRODIGY_PERLINE_MAX = 420;

export function hoistById(id: string): Hoist {
  return PRODIGY_HOISTS.find((h) => h.id === id) || PRODIGY_HOISTS[0];
}

export type Batten = SteelShape & { label: string; ladder?: boolean };

const SCH40_15: Batten = {
  label: '1½″ Sch-40 pipe',
  id: 'Pipe 1-1/2" Sch40',
  type: "PIPE",
  grade: "A53 Gr.B",
  Fy: 35,
  Fu: 60,
  wt: 2.72,
  A: 0.799,
  d: 1.9,
  b: 1.9,
  tw: 0.145,
  tf: null,
  Ix: 0.31,
  Sx: 0.326,
  Zx: 0.448,
  rx: 0.623,
  Iy: 0.31,
  Sy: 0.326,
  Zy: 0.448,
  ry: 0.623,
  J: 0.62,
  Cw: null,
  rts: null,
  ho: null,
  OD: 1.9,
  tdes: 0.145,
};

export const BATTENS: Batten[] = [
  SCH40_15,
  { label: '1½″ Sch-80 pipe (x-strong)', id: 'Pipe 1-1/2" Sch80', type: "PIPE", grade: "A53 Gr.B", Fy: 35, Fu: 60, wt: 3.63, A: 1.0, d: 1.9, b: 1.9, tw: 0.186, tf: null, Ix: 0.372, Sx: 0.392, Zx: 0.549, rx: 0.61, Iy: 0.372, Sy: 0.392, Zy: 0.549, ry: 0.61, J: 0.744, Cw: null, rts: null, ho: null, OD: 1.9, tdes: 0.186 },
  { label: "Ladder batten (2× 1½″ Sch-40)", id: "Ladder 1-1/2 Sch40 x2", type: "PIPE", grade: "A53 Gr.B", Fy: 35, Fu: 60, wt: 6.0, A: 1.498, d: 1.9, b: 1.9, tw: 0.135, tf: null, Ix: 0.586, Sx: 0.618, Zx: 0.842, rx: 0.625, Iy: 0.586, Sy: 0.618, Zy: 0.842, ry: 0.625, J: 1.172, Cw: null, rts: null, ho: null, OD: 1.9, tdes: 0.135, ladder: true },
];

export function battenById(id: string): Batten {
  return BATTENS.find((s) => s.id === id) || BATTENS[0];
}

export const CHAINS = [
  { name: "None", lb: 0 },
  { name: "Jack chain light ~0.10 lb/ft", lb: 0.1 },
  { name: "Jack chain ~0.14 lb/ft", lb: 0.14 },
  { name: "Med chain ~0.16 lb/ft", lb: 0.16 },
  { name: "Heavy chain ~0.25 lb/ft", lb: 0.25 },
];

export const TRACKS = [
  { name: "Light-duty track (~1.0 lb/ft)", lbft: 1.0 },
  { name: "Standard traveler track (~1.75 lb/ft)", lbft: 1.75 },
  { name: "Heavy-duty track (~3.0 lb/ft)", lbft: 3.0 },
];

export type Fabric = { name: string; oz: number; basis: string; width: number };
export const FABLIB: Fabric[] = [
  { name: "Encore Velour 22 oz", oz: 22, basis: "lin-yd", width: 54 },
  { name: "Charisma Velour 25 oz", oz: 25, basis: "lin-yd", width: 54 },
  { name: "Prestige Velour 25 oz", oz: 25, basis: "lin-yd", width: 54 },
  { name: "Encore Velour 15 oz", oz: 15, basis: "lin-yd", width: 54 },
  { name: "Crescent Velour 20 oz", oz: 20, basis: "lin-yd", width: 54 },
  { name: "Memorable Velour 25 oz", oz: 25, basis: "lin-yd", width: 54 },
  { name: "Imperial Velour 32 oz", oz: 32, basis: "lin-yd", width: 54 },
  { name: "Muslin, seamless (approx)", oz: 6, basis: "sq-yd", width: 120 },
  { name: "Sharkstooth Scrim (approx)", oz: 7, basis: "sq-yd", width: 120 },
];

export function fabByName(n: string): Fabric | undefined {
  return FABLIB.find((f) => f.name === n);
}
export function trackByName(n: string) {
  return TRACKS.find((t) => t.name === n);
}

/** Fabric weight lb/ft² from its bolt basis. */
export function ozPerFt2(f: Fabric): number {
  return f.basis === "sq-yd" ? f.oz / 9 : f.oz / ((f.width / 12) * 3);
}

/** Resolve a catalog Fabric row into the `Fabric` shape the weight math uses.
 *  Returns null when the row carries no numeric weight, so a missing oz fails
 *  loudly at the call site instead of silently weighing zero. */
export function fabricFromPart(p: {
  desc: string;
  oz?: number;
  ozBasis?: "lin-yd" | "sq-yd";
  boltWidthIn?: number;
}): Fabric | null {
  if (typeof p.oz !== "number" || p.oz <= 0) return null;
  return {
    name: p.desc,
    oz: p.oz,
    basis: p.ozBasis || "lin-yd",
    width: p.boltWidthIn || 54,
  };
}

export const BRICK_LG = 25;
export const BRICK_SM = 10;

/** Best counterweight brick combination (large + small) to reach a load. */
export function brickCombo(load: number, big = BRICK_LG, small = BRICK_SM) {
  if (load <= 0) return { big: 0, small: 0, loaded: 0, resid: 0 };
  big = big > 0 ? big : 25;
  small = small > 0 ? small : 10;
  const hi = big >= small ? big : small;
  const lo = big >= small ? small : big;
  let best: { hi: number; lo: number; loaded: number; resid: number; score: number[] } | null = null;
  const maxHi = Math.ceil(load / hi) + 1;
  for (let nb = 0; nb <= maxHi; nb++) {
    const rem = load - hi * nb;
    for (const ns of [Math.floor(Math.max(0, rem) / lo), Math.ceil(Math.max(0, rem) / lo)]) {
      if (ns < 0) continue;
      const loaded = hi * nb + lo * ns;
      const resid = loaded - load;
      const score = [Math.abs(resid), resid < 0 ? 1 : 0, nb + ns];
      if (
        !best ||
        score[0] < best.score[0] ||
        (score[0] === best.score[0] &&
          (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])))
      ) {
        best = { hi: nb, lo: ns, loaded, resid, score };
      }
    }
  }
  const bigIsHi = big >= small;
  return {
    big: bigIsHi ? best!.hi : best!.lo,
    small: bigIsHi ? best!.lo : best!.hi,
    loaded: best!.loaded,
    resid: best!.resid,
  };
}

/* ------------------------------ lineset weights ------------------------------ */

export type LinesetMode = "motor" | "dead" | "cw";

/** Schedule-level defaults for the lineset weights tool. */
export type WeightDefaults = {
  full: number; // % fullness
  cut: number; // added cut height (in)
  hwPerFt: number; // hardware lb/ft of width
  defl: number; // deflection L/ ratio
  df: number; // design factor
  cwBat: boolean; // counterweight the batten too
  wll: number; // per-line hardware WLL
  mode: LinesetMode;
  cableMgmt: boolean;
  hoist: string; // default hoist id
  beamspace: number; // max beam spacing (ft)
  pipe: string; // default batten id
  /** Default batten length (ft). DERIVED, not typed in: every live caller sets
   *  this to battenLenFt(proWidthFt) (venue-dims.ts) before computing a line.
   *  It stays on the defaults record so a per-line blank still has something to
   *  inherit, and so computeSetWeight() keeps working standalone. */
  battenlen: number;
  lines: number; // default lift lines
};

export const DEFAULT_WEIGHTS: WeightDefaults = {
  full: 50, cut: 6, hwPerFt: 0.5, defl: 120, df: 1, cwBat: false, wll: 0,
  mode: "motor", cableMgmt: false, hoist: "P1400", beamspace: 14,
  pipe: 'Pipe 1-1/2" Sch40',
  // Was a hardcoded 44. Same number, but now stated as what it actually is:
  // the default 40 ft proscenium plus 2 ft of overhang each side (punch #50).
  battenlen: battenLenFt(DEFAULT_VENUE_DIMS.proWidthFt),
  lines: 6,
};

/** One curtain/electric line in the weights schedule. Blank per-line values
 *  inherit the schedule defaults. */
export type WeightLine = {
  name: string;
  fab?: string; // fabric name (— none — for gear-only lines)
  /** A fabric resolved from the parts catalog, which wins over the `fab`
   *  name lookup. Catalog descriptions do not match FABLIB display names, so
   *  a name-only lookup silently weighs zero — this is the join. */
  fabResolved?: Fabric;
  w?: number; // finished width (ft)
  h?: number; // finished height (ft)
  full?: number | null;
  qty?: number;
  chain?: string;
  gear?: number; // extra fixed weight (lb), e.g. electrics
  pipe?: string; // per-line batten id
  batten?: number | null; // per-line batten length (ft)
  track?: string;
  lines?: number | null; // per-line lift-line count
  mode?: LinesetMode;
  hoist?: string;
};

/**
 * A line with a finished footprint (w × h) is a soft-goods line — it MUST
 * resolve a fabric to weigh anything. `w`/`h` alone (no `rule`, no catalog
 * needed) is a self-contained signal computeSetWeight can check without
 * importing goods.ts (steel.ts must not depend on goods.ts — goods.ts already
 * depends on steel.ts, and a back-import would cycle). Kept in sync with
 * lineFabricIssue()'s `expectsFabric` in goods.ts.
 */
function expectsFabricWeight(L: Pick<WeightLine, "w" | "h">): boolean {
  return (L.w || 0) > 0 && (L.h || 0) > 0;
}

/**
 * Weight + capacity breakdown for one line. Faithful port of computeLine(),
 * plus the F1 hard-fail (punch #64): a line that expects a fabric but can't
 * resolve one no longer contributes goods=0/trackWt=0 to a plausible-looking
 * total. It reports `fabricUnresolved: true` and every weight/capacity field
 * that depends on the unresolved goods figure (onBatten, setTotal, cwLoad,
 * combo, the utilization checks, beamLoad) comes back `null` — never a wrong
 * LOW number. Callers must check `fabricUnresolved` before trusting any of
 * those fields; `fmt()` already renders null as "—", but a null total must
 * still be surfaced as UNAVAILABLE, not silently summed as zero (see
 * lineset-builder.tsx's `totals`).
 */
export function computeSetWeight(L: WeightLine, def: WeightDefaults) {
  const pipe = battenById(L.pipe || def.pipe);
  const full = (L.full == null ? def.full : L.full) / 100;
  const f = L.fabResolved || (L.fab ? fabByName(L.fab) : undefined);
  const qty = L.qty || 1;
  const fabricUnresolved = expectsFabricWeight(L) && !f;
  let goods = 0;
  if (f && (L.w || 0) > 0 && (L.h || 0) > 0) {
    const flatW = (L.w || 0) * (1 + full);
    const cutH = (L.h || 0) + def.cut / 12; // def.cut is inches; L.h is feet
    const fab = (flatW * cutH * ozPerFt2(f)) / 16;
    const chain = (CHAINS.find((c) => c.name === L.chain) || CHAINS[0]).lb * (L.w || 0);
    const hw = def.hwPerFt * (L.w || 0);
    goods = (fab + chain + hw) * qty;
  }
  const gear = L.gear || 0;
  const battenLen = L.batten != null ? L.batten : def.battenlen;
  const battenWt = battenLen * (pipe ? pipe.wt : 0);
  const trackObj = f ? trackByName(L.track || "") : null;
  const trackWt = trackObj ? trackObj.lbft * battenLen : 0;
  // Raw internal total — still computed so every downstream check below runs
  // its normal math (this is what the OLD code returned directly). The public
  // return at the bottom masks this to null when fabricUnresolved, so a
  // caller can never mistake "goods happened to compute as 0" for "goods+gear
  // legitimately sum to a small number" (F1: those are different facts).
  const onBatten = goods + gear + battenWt + trackWt;
  const nLines = Math.max(1, L.lines != null ? L.lines : def.lines);
  const mode: LinesetMode = L.mode || def.mode;
  const maxLines = def.cableMgmt ? PRODIGY_MAXLINES_CM : PRODIGY_MAXLINES;
  const hoist = hoistById(L.hoist || def.hoist);

  // Batten bending across the widest lift-line bay (all modes).
  const nBays = Math.max(1, nLines - 1);
  let battenUtil: number | null = null;
  let allowTotal: number | null = null;
  let perLine: number | null = null;
  let lineOverWll = false;
  if (pipe && battenLen > 0) {
    const spacing = battenLen / nBays;
    const c = beamCapacity(pipe, spacing, "uniform", 1, def.df, def.defl, spacing);
    allowTotal = c.asd.gov * nBays;
    battenUtil = onBatten / allowTotal;
    perLine = onBatten / nLines;
    if (def.wll > 0 && perLine > def.wll) lineOverWll = true;
  }

  let cwLoad = 0;
  let combo = { big: 0, small: 0, loaded: 0, resid: 0 };
  let hoistUtil: number | null = null;
  const perLineLoad = battenLen > 0 ? onBatten / nLines : null;
  let perLineOverMax = false;
  let perLineUnderMin = false;
  let linesOverMax = false;
  let capUtil = battenUtil;
  let over = (battenUtil != null && battenUtil > 1) || lineOverWll;

  if (mode === "cw") {
    cwLoad = def.cwBat ? onBatten : goods + gear;
    combo = brickCombo(cwLoad);
  } else if (mode === "motor") {
    hoistUtil = onBatten > 0 ? onBatten / hoist.cap : 0;
    const pMax = hoist.perMax || PRODIGY_PERLINE_MAX;
    const pMin = hoist.perMin || PRODIGY_PERLINE_MIN;
    if (perLineLoad != null) {
      perLineOverMax = perLineLoad > pMax;
      perLineUnderMin = onBatten > 0 && perLineLoad < pMin;
    }
    linesOverMax = nLines > maxLines;
    const utils = [hoistUtil];
    if (battenUtil != null) utils.push(battenUtil);
    if (perLineLoad != null) utils.push(perLineLoad / pMax);
    capUtil = Math.max(...utils);
    over = hoistUtil > 1 || perLineOverMax || linesOverMax || (battenUtil != null && battenUtil > 1) || lineOverWll;
  }

  const hoistPw = mode === "motor" ? hoist.pw : 0;
  const setTotal = onBatten + hoistPw;
  const totalBeams = Math.max(1, def.lines);
  const beamSpacing = battenLen > 0 && totalBeams > 1 ? battenLen / (totalBeams - 1) : null;
  const beamLoad = setTotal / totalBeams;
  const beamSpacingOver = beamSpacing != null && beamSpacing > def.beamspace;
  if (mode === "motor" && beamSpacingOver) over = true;

  // F1 hard-fail (punch #64): mask every field downstream of the unresolved
  // goods figure to null instead of exposing the raw (artificially low)
  // numbers computed above. `battenWt` is NOT masked — it comes from the pipe
  // choice alone, never from fabric, so it stays a trustworthy real number
  // even on an unresolved-fabric line.
  return {
    mode, hoist, pipe, maxLines,
    goods: fabricUnresolved ? null : goods,
    gear, battenWt, battenLen,
    trackWt: fabricUnresolved ? null : trackWt,
    onBatten: fabricUnresolved ? null : onBatten,
    hoistPw,
    setTotal: fabricUnresolved ? null : setTotal,
    cwLoad: fabricUnresolved ? null : cwLoad,
    combo: fabricUnresolved ? null : combo,
    battenUtil: fabricUnresolved ? null : battenUtil,
    allowTotal,
    perLine: fabricUnresolved ? null : perLine,
    lineOverWll: fabricUnresolved ? false : lineOverWll,
    hoistUtil: fabricUnresolved ? null : hoistUtil,
    perLineLoad: fabricUnresolved ? null : perLineLoad,
    perLineOverMax: fabricUnresolved ? false : perLineOverMax,
    perLineUnderMin: fabricUnresolved ? false : perLineUnderMin,
    linesOverMax,
    totalBeams, beamSpacing,
    beamLoad: fabricUnresolved ? null : beamLoad,
    beamSpacingOver,
    capUtil: fabricUnresolved ? null : capUtil,
    over: fabricUnresolved ? false : over,
    nLines,
    fabricUnresolved,
  };
}

/** Format a number like the source's fmt(). */
export function fmt(x: number | null | undefined, d = 0): string {
  if (x == null || !isFinite(x)) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
