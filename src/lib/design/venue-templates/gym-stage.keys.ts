import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Gym Stage background (#255 —
 * docs/venue-templates/source/gym-stage.dwg → gym-stage.json). Drawing
 * inches, y UP; centreline 4.151. Proscenium fields: width = the opening,
 * wing = return wall → stage side wall, depth = stage depth; the house fields
 * are the gym floor. Rooms A (Storage) and B (Electrical Room) absorb
 * (floor − stage) / 2; the Booth (C) keeps its size and moves along the gym's
 * back and side walls (Task 11 lets a design move it; its home is the back
 * wall, centred, as drawn). Names are Jeff's (2026-09-28).
 */
const CX = 4.151;

export const GYM_STAGE_SPACES = ["Stage", "Gym Floor", "Storage", "Electrical Room", "Booth"] as const;

export const GYM_STAGE_KEYS: TemplateKeys = {
  kind: "gym-stage",
  cx: CX,
  x: {
    kind: "blend",
    // Stage zone (above the return walls' house face): opening, wings, the 6" stage side wall, then rooms A/B absorb out to the floor's inside face.
    upper: [{ to: 240, drive: "pro" }, { to: 360, drive: "wing" }, { to: 366, drive: "fixed" }, { to: 720, drive: "absorb" }],
    // Gym floor: the whole floor follows floor width (the Booth is lifted out and re-placed).
    lower: [{ to: 720, drive: "absorb" }],
    yStart: 30,
    yEnd: 30,
  },
  ySpans: [
    { from: 282.134, to: 276.134, drive: "fixed" }, // stage back wall
    { from: 276.134, to: 36.134, drive: "stageDepth" }, // stage
    { from: 36.134, to: 30.134, drive: "fixed" }, // return walls / rooms' front wall
    { from: 30.134, to: -557.866, drive: "houseOpen" }, // gym floor
    { from: -557.866, to: -563.866, drive: "fixed" }, // back wall
  ],
  origin: 36.134,
  stageDepthTo: 276.134,
  houseDepthTo: -557.866,
  regions: {
    Stage: [{ x: -355.849, y: 276.134 }, { x: 364.151, y: 276.134 }, { x: 364.151, y: 36.134 }, { x: -355.849, y: 36.134 }],
    "Gym Floor": [{ x: -715.849, y: 30.134 }, { x: 724.151, y: 30.134 }, { x: 724.151, y: -557.866 }, { x: -715.849, y: -557.866 }],
    Storage: [{ x: -715.849, y: 276.134 }, { x: -361.849, y: 276.134 }, { x: -361.849, y: 36.134 }, { x: -715.849, y: 36.134 }],
    "Electrical Room": [{ x: 370.151, y: 276.134 }, { x: 724.151, y: 276.134 }, { x: 724.151, y: 36.134 }, { x: 370.151, y: 36.134 }],
    Booth: [{ x: -115.849, y: -563.866 }, { x: 124.151, y: -563.866 }, { x: 124.151, y: -683.866 }, { x: -115.849, y: -683.866 }],
  },
  spaces: [...GYM_STAGE_SPACES],
  roles: { stage: "Stage", house: "Gym Floor", booth: "Booth" },
  lines: { plaster: [{ x: -235.849, y: 36.134 }, { x: 244.151, y: 36.134 }] },
  points: {
    top: { x: CX, y: 282.134 },
    centre: { x: CX, y: 36.134 },
    proL: { x: -235.849, y: 36.134 },
    proR: { x: 244.151, y: 36.134 },
    stageBack: { x: CX, y: 276.134 },
    stageOuterL: { x: -361.849, y: 150 },
    stageOuterR: { x: 370.151, y: 150 },
    wingL: { x: -355.849, y: 150 },
    wingR: { x: 364.151, y: 150 },
    backWall: { x: CX, y: -557.866 },
    houseL: { x: -715.849, y: -300 },
    houseR: { x: 724.151, y: -300 },
    handleL: { x: -715.849, y: -260 },
    handleR: { x: 724.151, y: -260 },
    mix: { x: CX, y: -330 },
  },
  requiredLabels: [...GYM_STAGE_SPACES],
  defaults: { proWidthFt: 40, wingFt: 10, stageDepthFt: 20, houseWidthFt: 120, houseDepthFt: 49.5 },
  // The Booth: lifted out of the stretch and placed against the back wall's outer face (or a side wall's, below the rooms).
  movableWalls: {
    back: { from: { x: -721.849, y: -563.866 }, to: { x: 730.151, y: -563.866 } },
    right: { from: { x: 730.151, y: -563.866 }, to: { x: 730.151, y: 30.134 } },
    left: { from: { x: -721.849, y: 30.134 }, to: { x: -721.849, y: -563.866 } },
  },
  movableWallLabels: { back: "Back", right: "Right", left: "Left" },
  movables: [{ id: "booth", region: "Booth", bbox: { minX: -122, maxX: 131, minY: -690, maxY: -563.5 }, home: { wall: "back", anchor: { x: CX, y: -563.866 } }, walls: ["back", "left", "right"] }],
};
