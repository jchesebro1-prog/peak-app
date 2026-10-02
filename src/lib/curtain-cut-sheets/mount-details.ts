/**
 * Curtain cut sheets (#292) — the mounting-detail library (spec §2.5). Each
 * detail is a section through the top of the curtain in a fixed 240 × 300
 * viewBox, not to scale, with leaders to plain-language labels. Never a part
 * number: the hardware table carries those. Pure.
 */
import type { Shape, ShapeLabel } from "./shapes";
import { MOUNT_KEY_LABELS, type CurtainMountKey } from "./vocab";

export const MOUNT_DETAIL_VIEWBOX = { w: 240, h: 300 } as const;
export const TRACK_OTHER_NOTE = "Track mounting per manufacturer's instructions";
export type MountDetail = { title: string; shapes: Shape[]; labels: ShapeLabel[]; note?: string };

/** Left edge of the right-hand callout column: the longest line (≤ 14 chars at 9 px, ~0.6 em) ends inside the 240 box. */
const LABEL_X = 160;
const lab = (x: number, y: number, text: string, to: [number, number], anchor: "start" | "end" = "start"): ShapeLabel => ({ x, y, text, leaderTo: to, anchor });
const pipe = (cx: number, cy: number, r = 14): Shape => ({ kind: "circle", cx, cy, r, stroke: "heavy", fill: "none" });

/** Webbing band + grommet at `top`, three fabric folds hanging to the bottom edge. */
function curtainBelow(top: number): Shape[] {
  return [
    { kind: "rect", x: 100, y: top, w: 40, h: 18, stroke: "med", fill: "tone" },
    { kind: "circle", cx: 120, cy: top + 9, r: 5, stroke: "med", fill: "none" },
    { kind: "path", d: `M100 ${top + 18} C 90 ${top + 70}, 110 ${top + 110}, 98 290`, stroke: "med" },
    { kind: "path", d: `M120 ${top + 18} C 112 ${top + 80}, 128 ${top + 120}, 120 290`, stroke: "thin" },
    { kind: "path", d: `M140 ${top + 18} C 150 ${top + 70}, 130 ${top + 110}, 142 290`, stroke: "med" },
  ];
}

/** Track channel at `y` (open at the bottom), carrier wheels + stem, snap hook; the curtain top sits at y + 56. */
function trackBelow(y: number): Shape[] {
  return [
    { kind: "path", d: `M100 ${y} h40 v24 h-10 v-6 h-20 v6 h-10 z`, stroke: "heavy", fill: "none" },
    { kind: "circle", cx: 112, cy: y + 12, r: 4, stroke: "med", fill: "tone" },
    { kind: "circle", cx: 128, cy: y + 12, r: 4, stroke: "med", fill: "tone" },
    { kind: "rect", x: 117, y: y + 18, w: 6, h: 18, stroke: "med", fill: "tone" },
    { kind: "path", d: `M120 ${y + 36} v8 a6 6 0 1 1 -6 6`, stroke: "med" },
  ];
}

/** The labels every tracked detail shares, for a channel at `y`. */
function trackLabels(y: number): ShapeLabel[] {
  return [
    lab(72, y + 10, "Track", [100, y + 10], "end"),
    lab(72, y + 34, "Carrier", [112, y + 16], "end"),
    lab(LABEL_X, y + 44, "Snap hook", [126, y + 44]),
    lab(LABEL_X, y + 66, "Webbing +\ngrommet", [140, y + 65]),
    lab(LABEL_X, 250, "Curtain fabric", [142, 250]),
  ];
}

export function mountDetail(key: CurtainMountKey): MountDetail {
  const title = MOUNT_KEY_LABELS[key];
  switch (key) {
    case "track-batten":
      return {
        title,
        shapes: [
          pipe(120, 36),
          { kind: "path", d: "M104 36 a16 16 0 0 1 32 0", stroke: "med" },
          { kind: "rect", x: 106, y: 48, w: 28, h: 10, stroke: "med", fill: "tone" },
          { kind: "line", x1: 120, y1: 58, x2: 120, y2: 90, stroke: "med" },
          ...trackBelow(90),
          ...curtainBelow(146),
        ],
        labels: [lab(LABEL_X, 26, "Pipe batten\n(by others)", [134, 36]), lab(LABEL_X, 62, "Batten clamp", [134, 53]), ...trackLabels(90)],
      };
    case "track-ceiling":
      return {
        title,
        shapes: [
          { kind: "rect", x: 20, y: 14, w: 130, h: 18, stroke: "thin", fill: "hatch" },
          { kind: "line", x1: 20, y1: 32, x2: 150, y2: 32, stroke: "heavy" },
          { kind: "line", x1: 120, y1: 14, x2: 120, y2: 32, stroke: "thin", dash: true },
          { kind: "rect", x: 106, y: 32, w: 28, h: 10, stroke: "med", fill: "tone" },
          { kind: "line", x1: 120, y1: 42, x2: 120, y2: 90, stroke: "med" },
          ...trackBelow(90),
          ...curtainBelow(146),
        ],
        labels: [lab(LABEL_X, 10, "Ceiling\n(anchor\nby others)", [150, 24]), lab(LABEL_X, 50, "Ceiling hanger\n/ clip", [134, 38]), ...trackLabels(90)],
      };
    case "track-structure":
      return {
        title,
        shapes: [
          { kind: "rect", x: 70, y: 14, w: 100, h: 8, stroke: "heavy", fill: "tone" },
          { kind: "rect", x: 116, y: 22, w: 8, h: 24, stroke: "med", fill: "tone" },
          { kind: "rect", x: 70, y: 46, w: 100, h: 8, stroke: "heavy", fill: "tone" },
          { kind: "rect", x: 100, y: 54, w: 40, h: 10, stroke: "med", fill: "none" },
          { kind: "line", x1: 120, y1: 64, x2: 120, y2: 110, stroke: "med", dash: true },
          { kind: "text", x: 126, y: 92, text: "length varies", size: 8 },
          ...trackBelow(110),
          ...curtainBelow(166),
        ],
        labels: [lab(LABEL_X, 32, "Steel beam\n(by others)", [124, 34]), lab(LABEL_X, 62, "Beam clamp", [140, 59]), lab(72, 88, "Drop rod /\ncable", [120, 88], "end"), ...trackLabels(110)],
      };
    case "tie-batten":
      return {
        title,
        shapes: [
          pipe(120, 60),
          { kind: "path", d: "M120 159 C 152 140, 152 74, 134 62 A 14 14 0 1 0 106 64 C 90 92, 98 140, 120 159", stroke: "med" },
          { kind: "path", d: "M146 100 c 8 -6 12 2 0 4 c -12 2 -8 10 0 4", stroke: "thin" },
          ...curtainBelow(150),
        ],
        labels: [
          lab(LABEL_X, 44, "Pipe batten\n(by others)", [134, 60]),
          lab(LABEL_X, 100, "Tie line\n(bow knot)", [148, 100]),
          lab(LABEL_X, 166, "Webbing +\ngrommet", [140, 159]),
          lab(LABEL_X, 250, "Curtain fabric", [142, 250]),
        ],
      };
    case "wall-hookloop":
      return {
        title,
        shapes: [
          { kind: "rect", x: 20, y: 10, w: 28, h: 280, stroke: "med", fill: "hatch" },
          { kind: "rect", x: 48, y: 30, w: 26, h: 96, stroke: "med", fill: "tone" },
          { kind: "rect", x: 74, y: 40, w: 6, h: 76, stroke: "heavy", fill: "tone" },
          { kind: "rect", x: 80, y: 40, w: 6, h: 76, stroke: "med", fill: "none" },
          { kind: "path", d: "M86 40 C 110 90, 92 150, 104 290", stroke: "med" },
          { kind: "path", d: "M86 116 C 120 160, 100 220, 122 290", stroke: "med" },
        ],
        labels: [
          lab(LABEL_X, 20, "Wall\n(by others)", [48, 20]),
          lab(LABEL_X, 52, "Header board\n(by others)", [74, 60]),
          lab(LABEL_X, 92, "Hook strip\non header", [80, 90]),
          lab(LABEL_X, 130, "Loop strip\nsewn to the\ncurtain", [86, 110]),
          lab(LABEL_X, 230, "Curtain fabric", [110, 230]),
        ],
      };
    default:
      return {
        title,
        shapes: [...trackBelow(70), ...curtainBelow(126)],
        labels: trackLabels(70),
        note: TRACK_OTHER_NOTE,
      };
  }
}
