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
import { fitOutline } from "../src/lib/design/room-shape/fit";
import { SegIndex, splitByWalls, walledShare, wallAt, type Seg } from "../src/lib/design/room-shape/walls";
import { freezeFromTemplate, roomIdFor } from "../src/lib/design/room-shape/freeze";
import { gridIntakeDefaults } from "../src/lib/design/grid-intake";
import { VENUES, sizedDims, type AState } from "../src/app/(app)/design/quick/engine";

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearPt = (p: ShapePt, q: ShapePt, tol = 1e-6) => dist(p, q) <= tol;
export const rect = (x0: number, y0: number, w: number, h: number, over: Partial<ShapeRoom> = {}): ShapeRoom => ({
  id: "rm_00000001", type: "other", name: "Box", kind: "room", roles: [],
  pts: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }],
  edges: [{ kind: "line" }, { kind: "line" }, { kind: "line" }, { kind: "line" }],
  ...over,
});

/** Every template, with a venue whose kind draws it. */
export const CASES: Array<[string, string]> = [
  ["school", "proscenium@1"], ["gym", "gym-stage@1"], ["church", "church-traditional@1"], ["church", "church-contemporary@2"],
  ["blackbox", "blackbox@1"], ["concenter", "blackbox@1"], ["arena", "arena@1"],
];
export const stateFor = (key: string): AState => {
  const v = VENUES.find((x) => x.key === key)!;
  return { ...gridIntakeDefaults(), venue: v.key, sys: { ...v.sys }, ...sizedDims(v, "large") };
};

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

  // fitOutline: a densified rectangle comes back as 4 lines at its corners
  const dense: ShapePt[] = [];
  for (let x = 0; x < 20; x += 0.25) dense.push({ x, y: 0 });
  for (let y = 0; y < 10; y += 0.25) dense.push({ x: 20, y });
  for (let x = 20; x > 0; x -= 0.25) dense.push({ x, y: 10 });
  for (let y = 10; y > 0; y -= 0.25) dense.push({ x: 0, y });
  const fr = fitOutline(dense);
  ok(fr.pts.length === 4 && fr.edges.every((e) => e.kind === "line") && fr.pts.some((p) => nearPt(p, { x: 0, y: 0 }, 1e-9)) && fr.pts.some((p) => nearPt(p, { x: 20, y: 10 }, 1e-9)),
    "#370 fit: a densified 20 × 10 rectangle fits as 4 lines on its corners");
  // a D shape: a line plus a sampled semicircle → one line and one arc of radius 5
  const d: ShapePt[] = [];
  for (let k = 0; k <= 90; k++) { const t = Math.PI - (k / 90) * Math.PI; d.push({ x: 5 + 5 * Math.cos(t), y: -5 * Math.sin(t) }); }
  for (let x = 9.75; x > 0.1; x -= 0.25) d.push({ x, y: 0 });
  const fd = fitOutline(d);
  const arcE = fd.edges.findIndex((e) => e.kind === "arc");
  ok(fd.edges.length === 2 && arcE >= 0 && near(arcInfo(fd.pts[arcE], fd.pts[(arcE + 1) % 2], (fd.edges[arcE] as { bulge: number }).bulge)!.r, 5, 0.05),
    "#370 fit: a sampled semicircle + chord fits as one arc (r ≈ 5) and one line");
  // walls: a double line (face + 6" out) reads as a wall; a single line doesn't under the double rule
  const segs: Seg[] = [[{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 0, y: -0.5 }, { x: 20, y: -0.5 }], [{ x: 0, y: 10 }, { x: 20, y: 10 }]];
  const idx = new SegIndex(segs);
  ok(wallAt(idx, { x: 5, y: 0 }, { x: 0, y: -1 }, "double") && !wallAt(idx, { x: 5, y: 10 }, { x: 0, y: 1 }, "double") && wallAt(idx, { x: 5, y: 10 }, { x: 0, y: 1 }, "single"),
    "#370 walls: a face line with a parallel line 6\" outward is a wall; a lone face line is one only under the single rule");
  // splitByWalls: the top edge is walled only from x 0 → 8 → split into a walled and an open piece
  const segs2: Seg[] = [[{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 0, y: -0.5 }, { x: 8, y: -0.5 }],
    [{ x: 20, y: 0 }, { x: 20, y: 10 }], [{ x: 20.5, y: 0 }, { x: 20.5, y: 10 }], [{ x: 20, y: 10 }, { x: 0, y: 10 }], [{ x: 20, y: 10.5 }, { x: 0, y: 10.5 }],
    [{ x: 0, y: 10 }, { x: 0, y: 0 }], [{ x: -0.5, y: 10 }, { x: -0.5, y: 0 }]];
  const sp = splitByWalls(fr.pts, fr.edges, new SegIndex(segs2), "double");
  const topOpen = sp.pts.map((p, i) => ({ p, q: sp.pts[(i + 1) % sp.pts.length], e: sp.edges[i] })).filter((x) => x.p.y === 0 && x.q.y === 0);
  ok(sp.pts.length === 5 && topOpen.length === 2 && topOpen.some((x) => x.e.open && Math.min(x.p.x, x.q.x) >= 7.9 && Math.min(x.p.x, x.q.x) <= 8.1) && topOpen.some((x) => !x.e.open),
    "#370 walls: an edge walled for 8' of 20' splits at the change, the rest open");
  ok(near(walledShare({ ...sp, kind: "room" }), 48 / 60, 0.02), "#370 walls: walledShare = walled length ÷ perimeter");
  // a 1' edge with a double line along only 4" of it is not split: one flag for the whole edge
  const sq: ShapePt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 5 }, { x: 0, y: 5 }];
  const sqEdges: ShapeEdge[] = sq.map(() => ({ kind: "line" }));
  const shortSegs: Seg[] = [[{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: -0.5 }, { x: 1 / 3, y: -0.5 }]];
  const ss = splitByWalls(sq, sqEdges, new SegIndex(shortSegs), "double");
  ok(ss.pts.length === sq.length && ss.edges.length === sq.length, "#370 walls: a 1' edge walled for 4\" of it is not split (same corner count)");
  // freeze: every template
  for (const [key, tpl] of CASES) {
    const a = stateFor(key);
    const shape = freezeFromTemplate(a, tpl, { by: "T", at: 1 });
    ok(shape.rooms.some((r) => r.roles.includes("stage")) && shape.rooms.some((r) => r.roles.includes("house")), `#370 freeze ${key}/${tpl}: a room holds the stage and a room the house`);
    ok(shape.rooms.every((r) => r.pts.length >= 3 && r.pts.length === r.edges.length && !selfCrosses(r)), `#370 freeze ${key}/${tpl}: every room is a valid, non-crossing outline`);
    ok(new Set(shape.rooms.map((r) => r.id)).size === shape.rooms.length && shape.rooms.every((r) => /^rm_[0-9a-f]{8}$/.test(r.id)), `#370 freeze ${key}/${tpl}: room ids are unique rm_ + 8 hex`);
    ok(JSON.stringify(freezeFromTemplate(a, tpl, { by: "T", at: 1 })) === JSON.stringify(shape), `#370 freeze ${key}/${tpl}: deterministic`);
    ok(shape.rooms.every((r) => r.pts.length >= 3), `#370 freeze ${key}/${tpl}: every room has at least 3 corners`);
    ok(shape.rooms.every((r) => r.pts.length <= 64), `#370 freeze ${key}/${tpl}: no room over 64 corners`);
  }
  // proscenium specifics (defaults: pro 50, wing 10, depth 30)
  {
    const a = stateFor("school");
    const s = freezeFromTemplate({ ...a, width: 50, wing: 10, depth: 30 }, "proscenium@1", { by: "T", at: 1 });
    const room = (nm: string) => s.rooms.find((r) => r.name === nm)!;
    const stage = room("Stage"), house = room("House");
    const bx = (r: ShapeRoom) => { const p = outlinePoints(r); return { minX: Math.min(...p.map((q) => q.x)), maxX: Math.max(...p.map((q) => q.x)), minY: Math.min(...p.map((q) => q.y)), maxY: Math.max(...p.map((q) => q.y)) }; };
    ok(near(bx(stage).maxX - bx(stage).minX, 70, 0.1) && near(bx(stage).maxY, 0, 0.1) && near(bx(stage).minY, -30, 0.1), "#370 freeze proscenium: the Stage is pro + 2 wings (70') wide, plaster line at y 0, 30' deep");
    const openAt = (r: ShapeRoom, q: ShapePt) => r.pts.some((p, i) => r.edges[i].open && Array.from({ length: 101 }, (_, k) => edgeAt(p, r.pts[(i + 1) % r.pts.length], r.edges[i], k / 100)).some((x) => dist(x, q) < 0.6));
    ok(openAt(stage, { x: 0, y: 0 }) && !openAt(stage, { x: -35, y: -15 }), "#370 freeze proscenium: the opening is open, the side wall isn't");
    ok(house.edges.some((e) => e.kind === "arc" && e.open) && near(bx(house).minY, (9 + 81) / 12, 0.1), "#370 freeze proscenium: the stage lip arc is an open edge of the House, which starts 7'-6\" below the plaster line");
    ok(room("Catwalk").kind === "zone" && room("Center Aisle").kind === "zone" && room("Booth").kind === "room" && stage.kind === "room", "#370 freeze proscenium: Catwalk and Center Aisle are zones, Booth and Stage rooms");
    ok(stage.type === "stage" && house.type === "house" && room("Booth").type === "booth" && room("Electrical Room").type === "electrical" && room("Catwalk").type === "catwalk", "#370 freeze proscenium: types follow roles, then labels");
    ok(stage.id === roomIdFor("proscenium@1", "Stage"), "#370 freeze: a room's id comes from its template and region");
  }
  // blackbox: one room is both stage and house; conference adds a Platform zone with the stage
  {
    const bb = freezeFromTemplate(stateFor("blackbox"), "blackbox@1", { by: "T", at: 1 });
    const main = bb.rooms.find((r) => r.roles.includes("house"))!;
    ok(main.roles.includes("stage") && main.name === "Blackbox", "#370 freeze blackbox: the Blackbox room holds both stage and house");
    const cf = freezeFromTemplate(stateFor("concenter"), "blackbox@1", { by: "T", at: 1 });
    const cmain = cf.rooms.find((r) => r.roles.includes("house"))!, plat = cf.rooms.find((r) => r.name === "Platform")!;
    ok(cmain.name === "Conference Room" && !cmain.roles.includes("stage") && plat.kind === "zone" && plat.roles.join() === "stage", "#370 freeze conference: Conference Room is the house, a Platform zone holds the stage");
  }
  // arena: single-line walls; the floor and court are zones
  {
    const ar = freezeFromTemplate(stateFor("arena"), "arena@1", { by: "T", at: 1 });
    const r = (nm: string) => ar.rooms.find((x) => x.name === nm)!;
    ok(r("Arena Floor").kind === "zone" && r("Court").kind === "zone" && r("Booth").kind === "room", "#370 freeze arena: floor and court are zones, the booth a room");
  }
}

export async function roomShapeDbChecks(ok: Ok): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  // freeze: every template gives the same rooms (names, order) as today's starter Spaces
  for (const [key, tpl] of CASES) {
    const a = stateFor(key);
    const shape = freezeFromTemplate(a, tpl, { by: "T", at: 1 });
    const kind = VENUES.find((x) => x.key === key)!.kind;
    const starter = GP.starterSpaces(a, kind, "sh", tpl).map((s) => s.name);
    const names = shape.rooms.map((r) => r.name).filter((nm) => !(kind === "flat" && nm === "Platform"));
    ok(names.join("|") === starter.join("|"), `#370 freeze ${key}/${tpl}: the rooms are today's starter Spaces, in order (${names.join(", ")})`);
  }
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
