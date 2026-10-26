// scripts/test-room-shape.ts
/* Grid room shape (#370) — harness checks. `roomShapePureChecks` is pure; `roomShapeDbChecks` needs the test DB.
   Run alone with `npx tsx scripts/test-room-shape.ts` (pure checks only). */
import type { Ok } from "./test-inbox-org";
import { parseFeet, fmtFeet } from "../src/lib/design/room-shape/units";
import {
  arcInfo, edgeAt, edgeLength, edgeMid, sampleEdge, outlinePoints, signedArea, selfCrosses, bulgeForRadius,
  bulgeForArcLength, bulgeThrough, splitEdge, wallBands, dist,
} from "../src/lib/design/room-shape/geometry";
import type { ShapeEdge, ShapePt, ShapeRoom } from "../src/lib/design/room-shape/types";

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearPt = (p: ShapePt, q: ShapePt, tol = 1e-6) => dist(p, q) <= tol;
export const rect = (x0: number, y0: number, w: number, h: number, over: Partial<ShapeRoom> = {}): ShapeRoom => ({
  id: "rm_00000001", type: "other", name: "Box", kind: "room", roles: [],
  pts: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }],
  edges: [{ kind: "line" }, { kind: "line" }, { kind: "line" }, { kind: "line" }],
  ...over,
});

export async function roomShapePureChecks(ok: Ok): Promise<void> {
  // units
  ok(parseFeet("42'-6\"") === 42.5 && parseFeet("42' 6\"") === 42.5 && parseFeet("42") === 42 && parseFeet("42.5") === 42.5 && parseFeet("6\"") === 0.5 && parseFeet("42'") === 42,
    "#370 units: parseFeet reads 42'-6\", 42' 6\", 42, 42.5, 6\" and 42'");
  ok(parseFeet("") === null && parseFeet("abc") === null && parseFeet("0") === null && parseFeet("-3") === null, "#370 units: parseFeet refuses blank, text, 0 and negatives");
  ok(fmtFeet(42.5) === "42'-6\"" && fmtFeet(0.5) === "0'-6\"" && fmtFeet(10) === "10'-0\"", "#370 units: fmtFeet prints whole inches");

  // arcs: a semicircle (bulge 1) over a 10' chord has r 5, sweep π, length 5π; its midpoint is 5' off the chord on the left normal
  const A = { x: 0, y: 0 }, B = { x: 10, y: 0 };
  const semi = arcInfo(A, B, 1)!;
  ok(near(semi.r, 5) && near(Math.abs(semi.sweep), Math.PI) && near(semi.length, 5 * Math.PI) && nearPt(semi.centre, { x: 5, y: 0 }),
    "#370 geometry: bulge 1 = a semicircle (r = chord / 2, sweep π, centre on the chord)");
  ok(nearPt(edgeMid(A, B, { kind: "arc", bulge: 1 }), { x: 5, y: 5 }) && nearPt(edgeMid(A, B, { kind: "arc", bulge: -1 }), { x: 5, y: -5 }),
    "#370 geometry: a positive bulge bows along the left normal (−dy, dx), a negative one the other way");
  ok(nearPt(edgeAt(A, B, { kind: "arc", bulge: 0.4 }, 0), A) && nearPt(edgeAt(A, B, { kind: "arc", bulge: 0.4 }, 1), B),
    "#370 geometry: an arc runs from a to b");
  ok(near(edgeLength(A, B, { kind: "line" }), 10) && sampleEdge(A, B, { kind: "line" }).length === 1, "#370 geometry: a line is its chord, sampled as its start");
  // radius / arc length round trips
  const bR = bulgeForRadius(10, 8, 0.3)!;
  ok(near(arcInfo(A, B, bR)!.r, 8, 1e-9) && bR > 0 && bulgeForRadius(10, 4, 0.3) === null, "#370 geometry: bulgeForRadius hits the radius, keeps the side, refuses r < chord / 2");
  ok(Math.abs(bulgeForRadius(10, 8, 2)!) > 1, "#370 geometry: bulgeForRadius keeps a major arc major");
  const bS = bulgeForArcLength(10, 12, -0.2)!;
  ok(near(arcInfo(A, B, bS)!.length, 12, 1e-6) && bS < 0 && bulgeForArcLength(10, 9, 0.2) === null, "#370 geometry: bulgeForArcLength hits the length, keeps the side, refuses s ≤ chord");
  ok(near(bulgeThrough(A, B, { x: 5, y: 2.5 }), 0.5) && near(bulgeThrough(A, B, { x: 5, y: -1 }), -0.2), "#370 geometry: bulgeThrough = 2 × offset ÷ chord");
  // split keeps the curve
  for (const e of [{ kind: "arc", bulge: 0.6 }, { kind: "curve", c1: { x: 2, y: 6 }, c2: { x: 8, y: -3 } }, { kind: "line", open: true }] as ShapeEdge[]) {
    const s = splitEdge(A, B, e, 0.3);
    const onFirst = edgeAt(A, s.at, s.first, 0.5), onSecond = edgeAt(s.at, B, s.second, 0.5);
    const full = (q: ShapePt) => Math.min(...Array.from({ length: 2001 }, (_, i) => dist(edgeAt(A, B, e, i / 2000), q)));
    ok(full(onFirst) < 1e-2 && full(onSecond) < 1e-2 && !!s.first.open === !!e.open && !!s.second.open === !!e.open,
      `#370 geometry: splitting a ${e.kind} keeps both halves on the original and carries open`);
  }
  // area, self-crossing
  const box = rect(0, 0, 10, 6);
  ok(near(Math.abs(signedArea(outlinePoints(box))), 60), "#370 geometry: a 10 × 6 box has area 60");
  const bow = { ...box, pts: [{ x: 0, y: 0 }, { x: 10, y: 6 }, { x: 10, y: 0 }, { x: 0, y: 6 }] };
  ok(selfCrosses(bow) && !selfCrosses(box), "#370 geometry: a bow-tie crosses itself, a box doesn't");
  // wall bands: one per walled edge, 6" thick, outward
  const bands = wallBands(box);
  ok(bands.length === 4 && near(Math.abs(signedArea(bands[0])), 10 * 0.5 + 0.25 * 0.5 * 2, 1e-6), "#370 geometry: a box has four 6\" wall bands, mitred");
  ok(wallBands({ ...box, edges: [{ kind: "line", open: true }, { kind: "line" }, { kind: "line" }, { kind: "line" }] }).length === 3 && wallBands({ ...box, kind: "zone" }).length === 0,
    "#370 geometry: an open edge has no wall, a zone has none");
  ok(bands[0].every((p) => p.y <= 1e-9) || bands[0].every((p) => p.y >= -1e-9), "#370 geometry: the top wall sits on one side of its face");
  ok(bands[0].some((p) => p.y < -0.49), "#370 geometry: the top wall of a box is outside it (y < 0)");
}

export async function roomShapeDbChecks(ok: Ok): Promise<void> {
  void ok;
}

if (process.argv[1] && /test-room-shape\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  (async () => {
    await roomShapePureChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall room-shape checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
