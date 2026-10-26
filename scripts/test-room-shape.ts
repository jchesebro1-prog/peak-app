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
import { sanitizeRoomShape, SHAPE_SAMPLE_BUDGET } from "../src/lib/design/room-shape/sanitize";
import { SHAPE_STALE, SHAPE_NEEDS_STAGE_HOUSE, SHAPE_UNREADABLE } from "../src/lib/design/room-shape/copy";
import { applyEdit } from "../src/lib/design/room-shape/edit";
import { snapCorner } from "../src/lib/design/room-shape/snap";
import type { RoomShape } from "../src/lib/design/room-shape/types";
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

/** The pre-fix brute-force pair scan, kept here only to prove the broad phase gives identical answers. */
function bruteSelfCrosses(room: Pick<ShapeRoom, "pts" | "edges">): boolean {
  const EPS = 1e-9;
  const o = (a: ShapePt, b: ShapePt, c: ShapePt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const cross = (p1: ShapePt, p2: ShapePt, p3: ShapePt, p4: ShapePt) => {
    const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
    return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
  };
  const p = outlinePoints(room, 0.5, 32);
  const n = p.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (cross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  return false;
}

/** n corners on a circle of radius R, every edge an arc with the given bulge (alternating sign when `alt`). */
function arcRing(n: number, R: number, bulge: number, alt: boolean, id = "rm_00000001", over: Partial<ShapeRoom> = {}): ShapeRoom {
  const pts = Array.from({ length: n }, (_, k) => ({ x: R * Math.cos((2 * Math.PI * k) / n), y: R * Math.sin((2 * Math.PI * k) / n) }));
  const edges: ShapeEdge[] = pts.map((_, k) => ({ kind: "arc", bulge: alt && k % 2 ? -bulge : bulge }));
  return { id, type: "other", name: "Ring", kind: "room", roles: [], pts, edges, ...over };
}

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
  // sanitize
  {
    const good = freezeFromTemplate(stateFor("school"), "proscenium@1", { by: "client", at: 5 });
    const r = sanitizeRoomShape(JSON.parse(JSON.stringify(good)), "proscenium@1", "Server", 99)!;
    ok(r.ok && r.shape.rooms.length === good.rooms.length && r.shape.by === "Server" && r.shape.frozenAt === 99 && r.notes.length === 0,
      "#370 sanitize: a good shape passes whole, by / frozenAt stamped by the server");
    ok(sanitizeRoomShape(null, "proscenium@1", "S", 1) === null && sanitizeRoomShape(undefined, "proscenium@1", "S", 1) === null, "#370 sanitize: no shape → null");
    const stale = sanitizeRoomShape(good, "blackbox@1", "S", 1)!;
    ok(!stale.ok && stale.error === SHAPE_STALE, "#370 sanitize: a shape frozen from another template is refused");
    ok(!sanitizeRoomShape({ v: 2 }, "proscenium@1", "S", 1)!.ok && (sanitizeRoomShape("x", "proscenium@1", "S", 1) as { error: string }).error === SHAPE_UNREADABLE, "#370 sanitize: junk is refused as unreadable");
    const bad = JSON.parse(JSON.stringify(good));
    const victim = good.rooms.findIndex((x) => !x.roles.length);
    bad.rooms[victim].pts[0].x = Number.NaN;
    bad.rooms.push({ ...bad.rooms[0] }); // a duplicate id (room 0 is the Stage, never the victim)
    bad.rooms.push({ ...rect(0, 0, 4, 4), id: "rm_0000abcd", type: "nope" });
    bad.rooms.push({ ...rect(0, 0, 4, 4), id: "rm_0000abce", pts: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }] });
    const rb = sanitizeRoomShape(bad, "proscenium@1", "S", 1)!;
    ok(rb.ok && rb.notes.length === 4 && rb.shape.rooms.length === good.rooms.length - 1 + 0, "#370 sanitize: a NaN, a duplicate id, an unknown type and a crossing room are each dropped with a note");
    const noStage = JSON.parse(JSON.stringify(good));
    noStage.rooms = noStage.rooms.filter((x: ShapeRoom) => !x.roles.includes("stage"));
    const rs = sanitizeRoomShape(noStage, "proscenium@1", "S", 1)!;
    ok(!rs.ok && rs.error === SHAPE_NEEDS_STAGE_HOUSE, "#370 sanitize: no Stage → refused");
    const twoBooths = JSON.parse(JSON.stringify(good));
    twoBooths.rooms.push({ ...rect(100, 100, 10, 10), id: "rm_0000abcf", roles: ["booth"], type: "booth" });
    const rt = sanitizeRoomShape(twoBooths, "proscenium@1", "S", 1)!;
    ok(rt.ok && rt.shape.rooms.filter((x) => x.roles.includes("booth")).length === 1 && rt.notes.length === 1, "#370 sanitize: a second Booth role is dropped with a note");
    const many = JSON.parse(JSON.stringify(good));
    for (let k = 0; k < 50; k++) many.rooms.push({ ...rect(200 + k * 20, 0, 10, 10), id: `rm_${(0x1000 + k).toString(16).padStart(8, "0")}` });
    const rm = sanitizeRoomShape(many, "proscenium@1", "S", 1)!;
    ok(rm.ok && rm.shape.rooms.length === 40, "#370 sanitize: at most 40 rooms");
    const longName = JSON.parse(JSON.stringify(good));
    longName.rooms[0].name = "x".repeat(200);
    longName.rooms[0].kind = "weird";
    longName.rooms[0].edges[0] = { kind: "arc", bulge: 0, open: "yes" };
    const rl = sanitizeRoomShape(longName, "proscenium@1", "S", 1)!;
    ok(rl.ok && rl.shape.rooms[0].name.length === 60 && rl.shape.rooms[0].kind === "room" && rl.shape.rooms[0].edges[0].kind === "line" && !rl.shape.rooms[0].edges[0].open,
      "#370 sanitize: names cap at 60, a bad kind takes the type's, a zero bulge is a line, open only when exactly true");
    ok(rm.ok && rm.notes.length === 1 && rm.notes[0] === `Left out ${many.rooms.length - 40} more rooms: a plan holds at most 40.`, "#370 sanitize: rooms past the 40 cap are counted in one note");
  }
  // broad-phase self-crossing = the old brute-force scan
  {
    const bow = rect(0, 0, 4, 4, { pts: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }] });
    const L = rect(0, 0, 10, 10, { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }], edges: Array.from({ length: 6 }, () => ({ kind: "line" as const })) });
    const house = freezeFromTemplate(stateFor("school"), "proscenium@1", { by: "T", at: 1 }).rooms.find((r) => r.name === "House")!;
    const set: Array<[string, ShapeRoom]> = [
      ["box", rect(0, 0, 10, 6)], ["bow-tie", bow], ["concave L", L], ["64-arc scallop", arcRing(64, 30, -0.4, false)],
      ["64-arc star", arcRing(64, 30, 0.4, true)], ["64-arc big bulge", arcRing(64, 30, 3, false)], ["proscenium House", house],
    ];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let k = 0; k < 150; k++) {
      const n = 3 + Math.floor(rnd() * 10);
      const pts = Array.from({ length: n }, () => ({ x: Math.round(rnd() * 400) / 10, y: Math.round(rnd() * 400) / 10 }));
      const edges: ShapeEdge[] = pts.map(() => (rnd() < 0.5 ? { kind: "line" as const } : { kind: "arc" as const, bulge: (rnd() - 0.5) * 2 }));
      set.push([`random ${k}`, rect(0, 0, 1, 1, { pts, edges })]);
    }
    const bad = set.filter(([, r]) => selfCrosses(r) !== bruteSelfCrosses(r)).map(([nm]) => nm);
    ok(bad.length === 0, `#370 geometry: the grid broad phase gives the brute-force answer on ${set.length} rooms${bad.length ? " (differs: " + bad.slice(0, 5).join(", ") + ")" : ""}`);
    ok(selfCrosses(bow) && selfCrosses(arcRing(64, 30, 3, false)) === bruteSelfCrosses(arcRing(64, 30, 3, false)) && !selfCrosses(L) && !selfCrosses(arcRing(64, 30, -0.4, false)) && !selfCrosses(house),
      "#370 geometry: bow-tie crosses; concave L, the 64-arc scallop and the House don't");
    ok(set.slice(7).some(([, r]) => selfCrosses(r)) && set.slice(7).some(([, r]) => !selfCrosses(r)), "#370 geometry: the random rooms cover both crossing and non-crossing outlines");
  }
  // hostile payloads and cost
  {
    const mk = (n: number, extra = 0) => {
      const rooms: ShapeRoom[] = [];
      for (let k = 0; k < 40; k++) rooms.push(arcRing(64, 20 + k, -0.4, false, `rm_${(0x2000 + k).toString(16).padStart(8, "0")}`, { name: "R" + k, ...(k === 0 ? { roles: ["stage" as const] } : k === 1 ? { roles: ["house" as const] } : {}) }));
      for (let k = 0; k < extra; k++) rooms.push(arcRing(64, 20, 0.4, true, `rm_${(0x3000 + k).toString(16).padStart(8, "0")}`));
      return { v: 1, fromTemplate: "proscenium@1", rooms: rooms.slice(0, n + extra) };
    };
    ok(!selfCrosses(arcRing(64, 20, -0.4, false)), "#370 sanitize cost: the worst-case ring is a valid, non-crossing outline");
    const worst = mk(40, 200);
    const t0 = performance.now();
    const rw = sanitizeRoomShape(JSON.parse(JSON.stringify(worst)), "proscenium@1", "S", 1)!;
    const ms = performance.now() - t0;
    console.log(`     worst-case sanitize: ${ms.toFixed(0)} ms (${rw.ok ? rw.shape.rooms.length : 0} rooms kept, ${rw.ok ? rw.notes.length : 0} notes)`);
    ok(ms < 1500 && rw.ok && rw.shape.rooms.length <= 40 && rw.shape.rooms.length >= 2, `#370 sanitize cost: 40 rooms x 64 arcs + 200 junk rooms returns in ${ms.toFixed(0)} ms (< 1,500)`);
    ok(rw.ok && rw.notes.some((n) => /^Left out "R\d+": the plan is too detailed\.$/.test(n)) && rw.notes.some((n) => /^Left out \d+ more rooms: the plan is too detailed\.$/.test(n)) && SHAPE_SAMPLE_BUDGET === 8192,
      "#370 sanitize cost: past the detail budget a room is left out by name and the rest are counted");

    const base = freezeFromTemplate(stateFor("school"), "proscenium@1", { by: "T", at: 1 });
    const clone = () => JSON.parse(JSON.stringify(base));
    const polluted = JSON.parse(`{"v":1,"fromTemplate":"proscenium@1","__proto__":{"polluted":1},"rooms":[]}`);
    const rooms = clone().rooms.map((r: ShapeRoom) => ({ ...r }));
    const protoRoom = JSON.parse(JSON.stringify(rooms[0]).replace(/^\{/, '{"__proto__":{"polluted":2},"extra":1,'));
    polluted.rooms = [protoRoom, ...rooms.slice(1)];
    const rp = sanitizeRoomShape(polluted, "proscenium@1", "S", 1)!;
    const known = new Set(["id", "type", "name", "kind", "roles", "pts", "edges"]);
    ok(({} as Record<string, unknown>).polluted === undefined && rp.ok && Object.keys(rp.shape).sort().join() === "by,fromTemplate,frozenAt,rooms,v" && rp.shape.rooms.every((r) => Object.keys(r).every((k) => known.has(k))),
      "#370 sanitize hostile: __proto__ keys pollute nothing and unknown fields never reach the output");
    const with1 = (f: (b: { rooms: Array<Record<string, unknown>> }) => void) => { const b = clone(); f(b); return sanitizeRoomShape(b, "proscenium@1", "S", 1)!; };
    const victimIdx = base.rooms.findIndex((x) => !x.roles.length);
    const r65 = with1((b) => { const v = b.rooms[victimIdx] as unknown as ShapeRoom; for (let k = 0; k < 62; k++) { v.pts.push({ x: 1000 + k, y: 1000 }); v.edges.push({ kind: "line" }); } });
    ok(r65.ok && r65.shape.rooms.length === base.rooms.length - 1 && r65.notes.length === 1 && /needs 3–64 corners/.test(r65.notes[0]), "#370 sanitize hostile: a 65-corner room is left out");
    const rArr = with1((b) => { b.rooms[victimIdx].pts = "nope"; });
    ok(rArr.ok && rArr.shape.rooms.length === base.rooms.length - 1 && rArr.notes.length === 1, "#370 sanitize hostile: pts that isn't an array is left out");
    const rCoord = with1((b) => { ((b.rooms[victimIdx].pts as ShapePt[])[0]).x = 2001; });
    ok(rCoord.ok && rCoord.shape.rooms.length === base.rooms.length - 1, "#370 sanitize hostile: a coordinate past 2,000 ft is left out");
    const rBulge = with1((b) => { (b.rooms[victimIdx].edges as ShapeEdge[])[0] = { kind: "arc", bulge: 11 }; });
    ok(rBulge.ok && rBulge.shape.rooms.length === base.rooms.length - 1, "#370 sanitize hostile: a bulge past 10 is left out");
    const rNull = sanitizeRoomShape(clone(), null, "S", 1)!;
    ok(!rNull.ok && rNull.error === SHAPE_STALE, "#370 sanitize hostile: no template (tpl null) → the stale refusal");
    const rNotes = with1((b) => { for (let k = 0; k < 30; k++) b.rooms.push({ id: "bad", type: "nope", name: "J" + k }); });
    ok(rNotes.ok && rNotes.notes.length === 10 && rNotes.notes[9] === "…and 21 more.", `#370 sanitize hostile: notes cap at 10, the last reading "…and N more." (${rNotes.ok ? rNotes.notes[9] : ""})`);
    const rName = with1((b) => { b.rooms[victimIdx].name = "  Sa\nfe\u0007ty\u007f Room\t "; });
    ok(rName.ok && rName.shape.rooms.some((r) => r.name === "Safety Room"), "#370 sanitize hostile: control characters are stripped from names");
    const rDupFirst = with1((b) => { b.rooms.push({ ...b.rooms[0], pts: "junk" }); });
    ok(rDupFirst.ok && rDupFirst.notes.length === 1 && /repeats another room/.test(rDupFirst.notes[0]), "#370 sanitize: a repeated id is caught before its geometry is read");
  }
  {
    const S = (rooms: ShapeRoom[]): RoomShape => ({ v: 1, fromTemplate: "proscenium@1", rooms, frozenAt: 0, by: "" });
    const house = rect(0, 0, 20, 10, { id: "rm_00000001", roles: ["house", "stage"], type: "house", name: "House" });
    const booth = rect(20, 0, 5, 5, { id: "rm_00000002", name: "Booth", type: "booth" }); // shares the corner (20, 0)
    const base = S([house, booth]);
    const get = (r: { ok: boolean }) => (r as unknown as { shape: RoomShape }).shape;
    const mv = applyEdit(base, { op: "move", room: house.id, i: 1, to: { x: 22, y: 0 }, glue: true });
    ok(mv.ok && get(mv).rooms[1].pts[0].x === 22 && get(mv).rooms[0].pts[1].x === 22 && base.rooms[0].pts[1].x === 20, "#370 edit: a moved corner drags a glued corner of another room; the input is untouched");
    const mv2 = applyEdit(base, { op: "move", room: house.id, i: 1, to: { x: 22, y: 0 }, glue: false });
    ok(mv2.ok && get(mv2).rooms[1].pts[0].x === 20, "#370 edit: without glue only the one corner moves");
    const cross = applyEdit(base, { op: "move", room: house.id, i: 0, to: { x: 30, y: 5 }, glue: false }); // (0,10)→(30,5) crosses x = 20
    ok(!cross.ok && /cross itself/.test((cross as { reason: string }).reason), "#370 edit: a move that makes the outline cross itself is refused");
    const ap = applyEdit(base, { op: "addPoint", room: house.id, edge: 0 });
    ok(ap.ok && get(ap).rooms[0].pts.length === 5 && nearPt(get(ap).rooms[0].pts[1], { x: 10, y: 0 }), "#370 edit: Add point splits the wall at its middle");
    const cv = applyEdit(base, { op: "setBulge", room: house.id, edge: 0, bulge: -0.3 });
    ok(cv.ok && get(cv).rooms[0].edges[0].kind === "arc", "#370 edit: Curve makes the wall an arc");
    ok(get(applyEdit(get(cv), { op: "setBulge", room: house.id, edge: 0, bulge: 0 })).rooms[0].edges[0].kind === "line", "#370 edit: a zero bow is a straight wall again");
    const rr = applyEdit(get(cv), { op: "setRadius", room: house.id, edge: 0, ft: 30 });
    ok(rr.ok && near(arcInfo({ x: 0, y: 0 }, { x: 20, y: 0 }, (get(rr).rooms[0].edges[0] as { bulge: number }).bulge)!.r, 30, 1e-6), "#370 edit: typing a radius sets it");
    ok(!applyEdit(get(cv), { op: "setRadius", room: house.id, edge: 0, ft: 5 }).ok, "#370 edit: a radius under half the chord is refused");
    const al = applyEdit(get(cv), { op: "setArcLength", room: house.id, edge: 0, ft: 22 });
    ok(al.ok && near(arcInfo({ x: 0, y: 0 }, { x: 20, y: 0 }, (get(al).rooms[0].edges[0] as { bulge: number }).bulge)!.length, 22, 1e-4), "#370 edit: typing an arc length sets it");
    const ff = applyEdit(base, { op: "toFreeform", room: house.id, edge: 0 });
    ok(ff.ok && get(ff).rooms[0].edges[0].kind === "curve", "#370 edit: Free-form makes a Bezier");
    ok(get(applyEdit(get(ff), { op: "straighten", room: house.id, edge: 0 })).rooms[0].edges[0].kind === "line", "#370 edit: Straighten");
    const op = applyEdit(base, { op: "setOpen", room: house.id, edge: 2, open: true });
    ok(op.ok && get(op).rooms[0].edges[2].open === true && get(applyEdit(get(op), { op: "setOpen", room: house.id, edge: 2, open: false })).rooms[0].edges[2].open === undefined, "#370 edit: Wall / Open toggles");
    // 23', not 25': at 25 the glued Booth corner would land on the Booth's own (25, 0) corner and be refused
    const ln = applyEdit(base, { op: "setLength", room: house.id, edge: 0, ft: 23, from: "far" });
    ok(ln.ok && get(ln).rooms[0].pts[1].x === 23 && get(ln).rooms[1].pts[0].x === 23, "#370 edit: typing a length moves the far corner (glued corners follow)");
    const lnN = applyEdit(base, { op: "setLength", room: house.id, edge: 0, ft: 25, from: "near" });
    ok(lnN.ok && get(lnN).rooms[0].pts[0].x === -5, "#370 edit: Alt moves the near corner");
    const dp = applyEdit(get(ap), { op: "deletePoint", room: house.id, i: 1 });
    ok(dp.ok && get(dp).rooms[0].pts.length === 4 && !applyEdit(S([rect(0, 0, 3, 3, { pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }], edges: [{ kind: "line" }, { kind: "line" }, { kind: "line" }] })]), { op: "deletePoint", room: "rm_00000001", i: 0 }).ok,
      "#370 edit: Delete point, refused below 3 corners");
    const rn = applyEdit(base, { op: "rename", room: booth.id, name: "  Control  " });
    ok(rn.ok && get(rn).rooms[1].name === "Control" && get(applyEdit(base, { op: "rename", room: booth.id, name: "" })).rooms[1].name === "Booth", "#370 edit: rename trims; blank = the type's label");
    ok(!applyEdit(base, { op: "deleteRoom", room: house.id }).ok && get(applyEdit(base, { op: "deleteRoom", room: booth.id })).rooms.length === 1, "#370 edit: the Stage / House room can't be deleted; others can");
    ok(get(applyEdit(base, { op: "retype", room: booth.id, type: "green" })).rooms[1].type === "green", "#370 edit: retype");
    ok(!applyEdit(base, { op: "move", room: "rm_ffffffff", i: 0, to: { x: 0, y: 0 }, glue: true }).ok, "#370 edit: an unknown room is refused, not thrown");
    // a curve's handles travel with a moved corner
    const ffMoved = applyEdit(get(ff), { op: "move", room: house.id, i: 0, to: { x: -2, y: 0 }, glue: false });
    const c0 = get(ff).rooms[0].edges[0] as { c1: ShapePt }, c1m = get(ffMoved).rooms[0].edges[0] as { c1: ShapePt };
    ok(ffMoved.ok && near(c1m.c1.x, c0.c1.x - 2), "#370 edit: a Bezier handle moves with its corner");
    // snapping
    const sn = snapCorner({ x: 10.1, y: 0.3 }, [{ at: { x: 0, y: 0 }, wallDir: null }], { gridFt: 0.5, angles: true });
    ok(near(sn.pt.y, 0) && near(sn.pt.x, 10) && !!sn.guide, "#370 snap: near-horizontal from a neighbour snaps onto the line, length to the 6\" grid");
    const s45 = snapCorner({ x: 7.2, y: 6.9 }, [{ at: { x: 0, y: 0 }, wallDir: null }], { gridFt: 0.5, angles: true });
    ok(near(s45.pt.x, s45.pt.y, 1e-9), "#370 snap: 45° snaps");
    const sg = snapCorner({ x: 3.3, y: 7.8 }, [{ at: { x: 0, y: 0 }, wallDir: null }], { gridFt: 1, angles: true });
    ok(sg.pt.x === 3 && sg.pt.y === 8 && sg.guide === null, "#370 snap: off every direction, the point rounds to the grid (1' with Shift)");
    const rel = snapCorner({ x: 10, y: 10.4 }, [{ at: { x: 10, y: 0 }, wallDir: { x: Math.cos(0.3), y: Math.sin(0.3) } }], { gridFt: 0.5, angles: true });
    ok(rel.guide !== null, "#370 snap: 90° relative to the neighbour's own wall counts");
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
