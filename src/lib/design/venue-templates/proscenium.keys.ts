import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Auditorium / PAC background (#249 —
 * docs/venue-templates/source/proscenium.dwg → proscenium.json). Drawing
 * inches, y UP: the stage is at the top (y > 0), the house below. Every value
 * is measured from the converted drawing; see
 * docs/superpowers/specs/2026-09-28-venue-templates-design.md.
 */
const CX = 414.25; // centreline — the opening runs 114.25 → 714.25; the stage-edge arc is centred here
const STAGE_EDGE = { cx: 414.25, cy: 369, r: 540.833 }; // meets the proscenium edges at y −81, lowest at y −171.833
const BACK_WALL = { cx: 415.679, cy: 69.691, r: 886.794 }; // the house back wall's inner face

/** Starter Space order for a generated proscenium base sheet. */
export const PROSCENIUM_SPACES = ["Stage", "Pit", "House", "Catwalk", "Center Aisle", "Booth", "Electrical Room", "MISC Rooms"] as const;

export const PROSCENIUM_KEYS: TemplateKeys = {
  kind: "proscenium",
  cx: CX,
  // #255: the #249 maps as span lists. Upstage (y ≥ −171.833, the stage edge's lowest point) the opening (±300") follows pro
  // width and each wing (300 → 480, the inner wall face) wing width; the back of the house (y ≤ −449.992, where the splayed
  // walls end) keeps booth + vestibules (±212.25) rigid and lets the rest follow house width. 478.605 is half the drawing's
  // inside width at the back (−62.959 → 894.25) — ~3" out of square (D436). Blended linearly between.
  x: {
    kind: "blend",
    upper: [{ to: 300, drive: "pro" }, { to: 480, drive: "wing" }],
    lower: [{ to: 212.25, drive: "fixed" }, { to: 478.605, drive: "absorb" }],
    yStart: -171.833,
    yEnd: -449.992,
  },
  ySpans: [
    { from: 375, to: 369, drive: "fixed" }, // stage back wall
    { from: 369, to: 9, drive: "stageDepth" }, // stage: back wall inner face → plaster line (30')
    { from: 9, to: -171.833, drive: "fixed" }, // proscenium wall, forestage, pit, stage edge
    { from: -171.833, to: -223.144, drive: "houseOpen" }, // seating → catwalk
    { from: -223.144, to: -279.022, drive: "fixed" }, // catwalk
    { from: -279.022, to: -620.963, drive: "houseOpen" }, // seating → cross aisle
    { from: -620.963, to: -949.107, drive: "fixed" }, // cross aisle, curved back wall, booth row
  ],
  origin: 9,
  stageDepthTo: 369,
  houseDepthTo: -817.103,
  pit: { region: "Pit", bbox: { minX: 180, maxX: 650, minY: -125, maxY: -30 }, labels: ["Pit"] },
  regions: {
    Stage: [{ x: -65.75, y: 369 }, { x: 894.25, y: 369 }, { x: 894.25, y: 9 }, { x: -65.75, y: 9 }],
    Pit: [
      { x: 186.25, y: -36 }, { x: 642.25, y: -36 }, { x: 642.25, y: -121.424 },
      { arc: { ...STAGE_EDGE, from: 294.93, to: 245.07 } },
      { x: 186.25, y: -121.424 },
    ],
    House: [
      { x: 56.522, y: -81 }, { x: 114.25, y: -81 },
      { arc: { ...STAGE_EDGE, from: 236.31, to: 303.69 } },
      { x: 714.25, y: -81 }, { x: 771.978, y: -81 }, { x: 894.25, y: -455.267 }, { x: 894.25, y: -676.883 },
      { arc: { ...BACK_WALL, from: 302.66, to: 237.34 } },
      { x: -62.959, y: -676.84 }, { x: -64.027, y: -449.992 },
    ],
    Catwalk: [{ x: -62.959, y: -223.144 }, { x: 894.25, y: -223.144 }, { x: 894.25, y: -279.022 }, { x: -62.959, y: -279.022 }],
    "Center Aisle": [{ x: -62.959, y: -620.963 }, { x: 894.25, y: -620.963 }, { x: 894.25, y: -676.84 }, { x: -62.959, y: -676.84 }],
    Booth: [{ x: 295.649, y: -815 }, { x: 535.649, y: -815 }, { x: 535.649, y: -943.107 }, { x: 295.649, y: -943.107 }],
    "Electrical Room": [{ x: 626.372, y: -797.885 }, { x: 894.25, y: -797.885 }, { x: 894.25, y: -943.107 }, { x: 626.372, y: -943.107 }],
    "MISC Rooms": [{ x: -64.691, y: -803.376 }, { x: 202.885, y: -803.376 }, { x: 202.885, y: -943.107 }, { x: -64.691, y: -943.107 }],
  },
  spaces: [...PROSCENIUM_SPACES],
  roles: { stage: "Stage", house: "House", booth: "Booth", catwalk: "Catwalk" },
  lines: {
    plaster: [{ x: 114.25, y: 9 }, { x: 714.25, y: 9 }],
    stageEdge: [{ arc: { ...STAGE_EDGE, from: 236.31, to: 303.69 } }],
    catwalk: [{ x: -62.959, y: -251.083 }, { x: 894.25, y: -251.083 }],
  },
  points: {
    top: { x: CX, y: 375 },
    centre: { x: CX, y: 9 },
    proL: { x: 114.25, y: 9 },
    proR: { x: 714.25, y: 9 },
    stageBack: { x: CX, y: 369 },
    stageOuterL: { x: -71.75, y: 200 },
    stageOuterR: { x: 900.25, y: 200 },
    wingL: { x: -65.75, y: 200 },
    wingR: { x: 894.25, y: 200 },
    backWall: { x: CX, y: -817.103 },
    houseL: { x: CX - 478.605, y: -650 },
    houseR: { x: CX + 478.605, y: -650 },
    handleL: { x: CX - 478.605, y: -535 },
    handleR: { x: CX + 478.605, y: -535 },
    mix: { x: CX, y: -450 },
  },
  requiredLabels: ["Stage", "Pit", "Catwalk", "Center Aisle", "Booth", "Electrical Room", "MISC Rooms"],
  defaults: { proWidthFt: 50, wingFt: 15, stageDepthFt: 30, houseWidthFt: (2 * 478.605) / 12, houseDepthFt: (9 + 817.103) / 12 },
};
