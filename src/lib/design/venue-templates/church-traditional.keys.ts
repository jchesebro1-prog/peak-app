import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Church Traditional background (#255 —
 * docs/venue-templates/source/church-traditional.dwg → church-traditional.json).
 * Drawing inches, y UP: the apse and chancel at the top, the nave below, the
 * back rooms and entry at the bottom. Width = platform (chancel inside) width,
 * depth = platform depth (front edge → back wall); the nave uses the house
 * fields. See docs/superpowers/specs/2026-09-28-church-template-design.md.
 */
const CX = 4.151;
const APSE_IN = { cx: 4.151, cy: 224.076, r: 172.195 };

/** Region ids in starter-Space order (the ids are the display labels). */
export const CHURCH_TRADITIONAL_SPACES = ["Platform", "Apse", "Nave", "Entry", "Choir Room", "Electrical Room", "Cry Room", "Storage"] as const;

export const CHURCH_TRADITIONAL_KEYS: TemplateKeys = {
  kind: "church-traditional",
  cx: CX,
  x: {
    kind: "blend",
    // Above the back-room wall: the chancel (±308.365) follows platform width; the chancel wall, the front step's
    // overhang and the notch wall (→ ±365.839) keep their size; the side rooms absorb the rest out to the nave's
    // inside face (±479.849).
    upper: [{ to: 308.365, drive: "pro" }, { to: 365.839, drive: "fixed" }, { to: 479.849, drive: "absorb" }],
    // The back-room wall and below: the Entry and its walls (±121.248) keep their size; Cry Room / Storage absorb.
    lower: [{ to: 121.248, drive: "fixed" }, { to: 479.849, drive: "absorb" }],
    yStart: -666.376,
    yEnd: -666.376,
  },
  ySpans: [
    { from: 318.496, to: 312.496, drive: "fixed" }, // chancel back wall
    { from: 312.496, to: 86, drive: "stageDepth" }, // chancel back part (the side rooms follow)
    { from: 86, to: -4, drive: "fixed" }, // notch wall, side-room wall, the 7' front step
    { from: -4, to: -666.376, drive: "houseOpen" }, // nave: platform front → back-room wall
    { from: -666.376, to: -818.107, drive: "fixed" }, // back-room wall, back rooms, outer wall
  ],
  origin: -4,
  stageDepthTo: 312.496,
  houseDepthTo: -666.376,
  regions: {
    Platform: [
      { x: -355.688, y: -4 }, { x: 363.99, y: -4 }, { x: 363.99, y: 80 }, { x: 312.516, y: 80 },
      { x: 312.516, y: 312.496 }, { x: -304.214, y: 312.496 }, { x: -304.214, y: 80 }, { x: -355.688, y: 80 },
    ],
    Apse: [{ arc: { ...APSE_IN, from: 30.896, to: 149.104 } }],
    Nave: [
      { x: -475.63, y: 44 }, { x: -355.688, y: 44 }, { x: -355.688, y: -4 }, { x: 363.99, y: -4 }, { x: 363.99, y: 44 },
      { x: 484, y: 44 }, { x: 484, y: -666.376 }, { x: -475.062, y: -666.376 },
    ],
    Entry: [{ x: -108.601, y: -666.376 }, { x: 119.399, y: -666.376 }, { x: 119.399, y: -812.107 }, { x: -108.601, y: -812.107 }],
    "Choir Room": [
      { x: -475.85, y: 312.496 }, { x: -310.214, y: 312.496 }, { x: -310.214, y: 86 }, { x: -361.688, y: 86 },
      { x: -361.688, y: 50 }, { x: -475.635, y: 50 },
    ],
    "Electrical Room": [
      { x: 318.516, y: 312.496 }, { x: 484, y: 312.496 }, { x: 484, y: 50 }, { x: 369.99, y: 50 },
      { x: 369.99, y: 86 }, { x: 318.516, y: 86 },
    ],
    "Cry Room": [{ x: -475.057, y: -672.376 }, { x: -114.601, y: -672.376 }, { x: -114.601, y: -812.107 }, { x: -474.946, y: -812.107 }],
    Storage: [{ x: 125.399, y: -672.376 }, { x: 484, y: -672.376 }, { x: 484, y: -812.107 }, { x: 125.399, y: -812.107 }],
  },
  spaces: [...CHURCH_TRADITIONAL_SPACES],
  // No booth in this drawing: the plan's FOH mix position stands in for it (today's church rule).
  roles: { stage: "Platform", house: "Nave" },
  lines: { platformFront: [{ x: -355.688, y: -4 }, { x: 363.99, y: -4 }] },
  points: {
    centre: { x: CX, y: -4 },
    platBack: { x: CX, y: 312.496 },
    platBackL: { x: -304.214, y: 312.496 },
    platBackR: { x: 312.516, y: 312.496 },
    platFrontL: { x: -355.688, y: -4 },
    platFrontR: { x: 363.99, y: -4 },
    naveL: { x: CX - 479.849, y: -330 },
    naveR: { x: CX + 479.849, y: -330 },
    naveBack: { x: CX, y: -666.376 },
    handleL: { x: CX - 479.849, y: -330 },
    handleR: { x: CX + 479.849, y: -330 },
    handleBack: { x: CX, y: -666.376 },
    mix: { x: CX, y: -414.673 }, // 62% of the nave's depth, today's church rule
    aisle: { x: 5.399, y: -666.376 }, // the Entry's centre — the pews' centre aisle lines up with it
  },
  requiredLabels: [...CHURCH_TRADITIONAL_SPACES],
  defaults: { proWidthFt: 616.73 / 12, wingFt: 0, stageDepthFt: 316.496 / 12, houseWidthFt: (2 * 479.849) / 12, houseDepthFt: 662.376 / 12 },
  // The apse stays a true arc: radius and chord × the platform-width ratio, its chord on the chancel back wall.
  trueArcs: [{ centres: [{ x: 4.151, y: 224.076 }], scaleHalf: 308.365, atY: 312.496, zoneMinY: 318.496 }],
};
