import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Church Contemporary background (#255 —
 * docs/venue-templates/source/church-contemporary.dwg → church-contemporary.json).
 * Drawing inches, y UP; centreline 4.151. A 10' Backstage band across the top;
 * the pointed Platform between two 45° splays; the nave widest at y −196.621,
 * narrowing on 45° walls to the back wall. Width = platform width at its back
 * wall, depth = platform depth (back wall → tip); nave width = widest inside
 * point, nave depth = tip → back wall. The back wall keeps the platform's
 * width (the drawing is symmetric top to bottom). Room names are Jeff's
 * (2026-09-28).
 */
const CX = 4.151;
const ARC_L = { cx: -121.847, cy: 734.421, r: 749.119 }; // its sweep ends at the tip and on the RIGHT splay
const ARC_R = { cx: 130.149, cy: 734.421, r: 749.119 }; // …and this one on the LEFT splay

/** Region ids in starter-Space order. */
export const CHURCH_CONTEMPORARY_SPACES = ["Platform", "Nave", "Backstage", "storage-1", "storage-2", "Green Room", "Electrical Room", "storage-3", "Control Booth", "storage-4", "Cry Room"] as const;

export const CHURCH_CONTEMPORARY_KEYS: TemplateKeys = {
  kind: "church-contemporary",
  cx: CX,
  x: {
    kind: "profile",
    // The inside face: ±255.939 at the platform's back wall and at the back wall, ±728.694 at the widest point.
    keys: [
      { y: 276.134, half: 255.939, drive: "pro" },
      { y: -196.621, half: 728.694, drive: "house" },
      { y: -669.376, half: 255.939, drive: "pro" },
    ],
    // Behind the splays: the Green Room / Electrical Room side absorbs, the B/D wall (±480.137 → 486.137) stays 6",
    // the corner Storage rooms absorb out to the widest point; the outer walls ride along.
    outside: [
      { to: 255.939, drive: "pro" },
      { to: 480.137, drive: "absorb" },
      { to: 486.137, drive: "fixed" },
      { to: 728.694, drive: "absorb" },
    ],
  },
  ySpans: [
    { from: 408.134, to: 402.134, drive: "fixed" }, // outer wall
    { from: 402.134, to: 282.134, drive: "fixed" }, // Backstage (10')
    { from: 282.134, to: 276.134, drive: "fixed" }, // the band's wall
    { from: 276.134, to: -3.999, drive: "stageDepth" }, // platform: back wall → tip
    { from: -3.999, to: -669.376, drive: "houseOpen" }, // nave: tip → back wall
    { from: -669.376, to: -675.376, drive: "fixed" }, // back wall
  ],
  origin: -3.999,
  stageDepthTo: 276.134,
  houseDepthTo: -669.376,
  regions: {
    Platform: [
      { x: -251.788, y: 276.134 }, { x: 260.09, y: 276.134 }, { x: 368.306, y: 167.914 },
      { arc: { ...ARC_L, from: 310.867, to: 279.695 } },
      { arc: { ...ARC_R, from: 260.305, to: 229.133 } },
    ],
    Nave: [
      { arc: { ...ARC_R, from: 229.133, to: 260.305 } },
      { arc: { ...ARC_L, from: 279.695, to: 310.867 } },
      { x: 732.845, y: -196.621 }, { x: 260.09, y: -669.376 }, { x: -251.788, y: -669.376 }, { x: -724.543, y: -196.621 },
    ],
    Backstage: [{ x: -727.028, y: 402.134 }, { x: 735.331, y: 402.134 }, { x: 735.331, y: 282.134 }, { x: -727.028, y: 282.134 }],
    "storage-1": [{ x: -727.028, y: 276.134 }, { x: -481.986, y: 276.134 }, { x: -481.986, y: 54.421 }, { x: -727.028, y: -190.621 }],
    "storage-2": [{ x: 490.288, y: 276.134 }, { x: 735.331, y: 276.134 }, { x: 735.331, y: -190.621 }, { x: 490.288, y: 54.421 }],
    "Green Room": [{ x: -475.986, y: 276.134 }, { x: -260.273, y: 276.134 }, { x: -475.986, y: 60.421 }],
    "Electrical Room": [{ x: 268.575, y: 276.134 }, { x: 484.288, y: 276.134 }, { x: 484.288, y: 60.421 }],
    "storage-3": [{ x: -727.028, y: -202.621 }, { x: -496.393, y: -433.256 }, { x: -727.028, y: -663.891 }],
    "Control Booth": [{ x: -492.151, y: -437.498 }, { x: -260.273, y: -669.376 }, { x: -724.028, y: -669.376 }],
    "storage-4": [{ x: 735.331, y: -202.621 }, { x: 735.331, y: -663.891 }, { x: 504.696, y: -433.256 }],
    "Cry Room": [{ x: 500.453, y: -437.498 }, { x: 732.33, y: -669.376 }, { x: 268.575, y: -669.376 }],
  },
  regionLabels: { "storage-1": "Storage", "storage-2": "Storage", "storage-3": "Storage", "storage-4": "Storage" },
  spaces: [...CHURCH_CONTEMPORARY_SPACES],
  roles: { stage: "Platform", house: "Nave", booth: "Control Booth" },
  lines: {},
  points: {
    centre: { x: CX, y: -3.999 },
    platBack: { x: CX, y: 276.134 },
    platBackL: { x: -251.788, y: 276.134 },
    platBackR: { x: 260.09, y: 276.134 },
    platFrontL: { x: -360.004, y: 167.914 },
    platFrontR: { x: 368.306, y: 167.914 },
    naveL: { x: -724.543, y: -196.621 },
    naveR: { x: 732.845, y: -196.621 },
    naveBack: { x: CX, y: -669.376 },
    handleL: { x: -724.543, y: -196.621 },
    handleR: { x: 732.845, y: -196.621 },
    handleBack: { x: CX, y: -669.376 },
    mix: { x: CX, y: -350 }, // unused while roles.booth is set: churchGeom stands the FOH mix in the Control Booth
    // Loudspeakers: in the Nave, 4' in from each splay and 3'7" below where the pointed front meets it.
    spkL: { x: -355, y: 125 },
    spkR: { x: 2 * CX + 355, y: 125 },
    aisle: { x: CX, y: -669.376 },
  },
  requiredLabels: ["Platform", "Nave", "Backstage", "Storage", "Storage", "Storage", "Storage", "Green Room", "Electrical Room", "Control Booth", "Cry Room"],
  defaults: { proWidthFt: 511.878 / 12, wingFt: 0, stageDepthFt: 280.133 / 12, houseWidthFt: 1457.388 / 12, houseDepthFt: 665.377 / 12 },
  // The pointed front stays two true arcs: radius × the platform-width ratio, ends at the tip and on the splays.
  trueArcs: [{ centres: [{ x: -121.847, y: 734.421 }, { x: 130.149, y: 734.421 }], scaleHalf: 255.939, atY: 276.134 }],
  // The 45° walls: the nave face follows the map; its room faces (and the F/G, H/I walls) are redrawn 6" off it.
  // The upper splays' refs end on the platform's back-wall line (y 276.134), not at the drawn ends 0.879" above it:
  // the profile holds its half-width beyond its top key, so a ref point above it would tilt the mapped ref off the
  // mapped nave face (up to ~0.2" at the test sizes) and the pointed front would miss the splay it ends on.
  // The F/G and H/I refs run from the outer wall's inside face (half 731.179, past the outside map's last span
  // end 728.694, where points ride along) to the lower splays' room faces; the engine draws them straight
  // between their mapped ends, so the kink at 728.694 never shows and their outer faces stay 6" off.
  walls: [
    { ref: [{ x: -724.543, y: -196.621 }, { x: -251.788, y: 276.134 }], faces: [[{ x: -733.028, y: -196.621 }, { x: -481.986, y: 54.421 }], [{ x: -475.986, y: 60.421 }, { x: -255.152, y: 281.255 }]] },
    { ref: [{ x: 260.09, y: 276.134 }, { x: 732.845, y: -196.621 }], faces: [[{ x: 263.454, y: 281.255 }, { x: 484.288, y: 60.421 }], [{ x: 490.288, y: 54.421 }, { x: 741.331, y: -196.621 }]] },
    { ref: [{ x: -724.543, y: -196.621 }, { x: -251.788, y: -669.376 }], faces: [[{ x: -727.028, y: -202.621 }, { x: -496.393, y: -433.256 }], [{ x: -492.151, y: -437.498 }, { x: -254.273, y: -675.376 }]] },
    { ref: [{ x: 260.09, y: -669.376 }, { x: 732.845, y: -196.621 }], faces: [[{ x: 262.576, y: -675.376 }, { x: 500.453, y: -437.498 }], [{ x: 504.696, y: -433.256 }, { x: 735.331, y: -202.621 }]] },
    { ref: [{ x: -727.028, y: -663.891 }, { x: -496.393, y: -433.256 }], faces: [[{ x: -733.028, y: -678.376 }, { x: -492.151, y: -437.498 }]] },
    { ref: [{ x: 504.696, y: -433.256 }, { x: 735.331, y: -663.891 }], faces: [[{ x: 500.453, y: -437.498 }, { x: 741.331, y: -678.376 }]] },
  ],
};
