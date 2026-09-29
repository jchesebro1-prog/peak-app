import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Blackbox background (#255 —
 * docs/venue-templates/source/blackbox.dwg → blackbox.json, shifted by the
 * converter so the room is centred on (0, 0)). Width/depth = the room's
 * inside width/depth; walls 6". Four 20' × 10' rooms sit outside the walls
 * and move along any wall (Jeff: "These should all be moveable"). Shared by
 * the Conference (flat) kind, which adds its platform in code. The room keeps
 * Jeff's label "Blackbox" and plays the house role through `roles`.
 */
export const BLACKBOX_SPACES = ["Blackbox", "Electrical Room", "Booth", "storage-1", "storage-2"] as const;
const ALL = ["bottom", "right", "top", "left"];

export const BLACKBOX_KEYS: TemplateKeys = {
  kind: "blackbox",
  cx: 0,
  x: { kind: "spans", spans: [{ to: 294, drive: "pro" }] },
  ySpans: [
    { from: 300, to: 294, drive: "fixed" },
    { from: 294, to: -294, drive: "houseOpen" },
    { from: -294, to: -300, drive: "fixed" },
  ],
  origin: 294,
  stageDepthTo: 294,
  houseDepthTo: -294,
  regions: {
    Blackbox: [{ x: -294, y: 294 }, { x: 294, y: 294 }, { x: 294, y: -294 }, { x: -294, y: -294 }],
    "Electrical Room": [{ x: -414, y: 114 }, { x: -300, y: 114 }, { x: -300, y: -114 }, { x: -414, y: -114 }],
    Booth: [{ x: -114, y: -300 }, { x: 114, y: -300 }, { x: 114, y: -414 }, { x: -114, y: -414 }],
    "storage-1": [{ x: -114, y: 414 }, { x: 114, y: 414 }, { x: 114, y: 300 }, { x: -114, y: 300 }],
    "storage-2": [{ x: 300, y: 114 }, { x: 414, y: 114 }, { x: 414, y: -114 }, { x: 300, y: -114 }],
  },
  regionLabels: { "storage-1": "Storage", "storage-2": "Storage" },
  spaces: [...BLACKBOX_SPACES],
  roles: { stage: "Blackbox", house: "Blackbox", booth: "Booth" },
  lines: {},
  points: { centre: { x: 0, y: 0 } },
  requiredLabels: ["Blackbox", "Electrical Room", "Booth", "Storage", "Storage"],
  defaults: { proWidthFt: 49, wingFt: 0, stageDepthFt: 0, houseWidthFt: 49, houseDepthFt: 49 },
  movableWalls: {
    bottom: { from: { x: -300, y: -300 }, to: { x: 300, y: -300 } },
    right: { from: { x: 300, y: -300 }, to: { x: 300, y: 300 } },
    top: { from: { x: 300, y: 300 }, to: { x: -300, y: 300 } },
    left: { from: { x: -300, y: 300 }, to: { x: -300, y: -300 } },
  },
  movableWallLabels: { bottom: "Bottom", right: "Right", top: "Top", left: "Left" },
  movables: [
    { id: "electrical", region: "Electrical Room", bbox: { minX: -421, maxX: -299.5, minY: -121, maxY: 121 }, home: { wall: "left", anchor: { x: -300, y: 0 } }, walls: ALL },
    { id: "booth", region: "Booth", bbox: { minX: -121, maxX: 121, minY: -421, maxY: -299.5 }, home: { wall: "bottom", anchor: { x: 0, y: -300 } }, walls: ALL },
    { id: "storage-top", region: "storage-1", bbox: { minX: -121, maxX: 121, minY: 299.5, maxY: 421 }, home: { wall: "top", anchor: { x: 0, y: 300 } }, walls: ALL },
    { id: "storage-right", region: "storage-2", bbox: { minX: 299.5, maxX: 421, minY: -121, maxY: 121 }, home: { wall: "right", anchor: { x: 300, y: 0 } }, walls: ALL },
  ],
  movableGap: 24,
};
