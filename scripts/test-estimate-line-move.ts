/* #357 — move estimator lines between systems. Pure checks; run alone with
   `npx tsx scripts/test-estimate-line-move.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import {
  applyLineMove, describeLineMove, extractLinesAsSection, isMovableLine, lineRefKey, parseLineRefKey, planLineMove, removeLinesFromSources,
  type LineRef,
} from "../src/lib/estimate-line-move/move";
import { MAX_KEY_PRODUCTS } from "../src/app/(app)/estimator/narrative";
import { reIdIncomingSection } from "../src/lib/estimate-line-move/reid";

const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 1, unit: "ea", cost: 10 * id, price: 20 * id, ...extra }) as SpecItem;
const sec = (id: string, items: SpecItem[], extra: Partial<SpecSection> = {}): SpecSection =>
  ({ id, name: "Sys " + id, kind: "materials", mfr: "", freightPct: 5, items, ...extra }) as SpecSection;
const ids = (s: SpecSection | undefined) => (s ? s.items.map((x) => x.id) : []);
const find = (ss: SpecSection[], id: string) => ss.find((s) => s.id === id);
/** LineRefs in one system. */
const R = (sectionId: string, ...lineIds: number[]): LineRef[] => lineIds.map((id) => ({ sectionId, id }));
/** A plan's lines as "A:1,B:2". */
const refs = (xs: readonly LineRef[]) => xs.map(lineRefKey).join();

export async function lineMoveChecks(ok: Ok) {
  // movable
  ok(isMovableLine(line(1)), "line-move: a plain line is movable");
  ok(!isMovableLine(line(2, { bonus: "package" })), "line-move: a bonus line is not movable");
  ok(!isMovableLine(line(3, { rewardCredit: true })), "line-move: the Rewards credit is not movable");

  // simple move, prices untouched, appended in order, lineOrder renumbered
  {
    const a = sec("A", [line(1), line(2), line(3)]);
    const b = sec("B", [line(4)]);
    const { sections, plan } = applyLineMove([a, b], R("A", 3, 1), { kind: "system", sectionId: "B" });
    ok(refs(plan.lines) === "A:1,A:3" && plan.sources.join() === "A", "line-move: plan ids in system/line order, one source");
    ok(ids(find(sections, "A")).join() === "2" && ids(find(sections, "B")).join() === "4,1,3", "line-move: moved lines append to the target in original order");
    const moved = find(sections, "B")!.items.find((x) => x.id === 3)!;
    ok(moved.cost === 30 && moved.price === 60, "line-move: price and cost are untouched");
    ok(find(sections, "B")!.items.map((x) => x.lineOrder).join() === "0,1,2", "line-move: target lineOrder renumbered");
    ok(find(sections, "A")!.items[0].lineOrder === 0, "line-move: source lineOrder renumbered");
  }

  // bonus + credit never move even if selected
  {
    const a = sec("A", [line(1), line(2, { bonus: "estimator" }), line(3, { rewardCredit: true })]);
    const b = sec("B", []);
    const { sections, plan } = applyLineMove([a, b], R("A", 1, 2, 3), { kind: "system", sectionId: "B" });
    ok(refs(plan.lines) === "A:1" && ids(find(sections, "A")).join() === "2,3", "line-move: bonus and credit lines stay put");
  }

  // already in the target → noop; target holding every selected line
  {
    const a = sec("A", [line(1)]);
    const p = planLineMove([a], R("A", 1), { kind: "system", sectionId: "A" });
    ok(p.noop && p.lines.length === 0, "line-move: moving into its own system is a no-op");
    const unknown = planLineMove([a], R("A", 99), { kind: "system", sectionId: "A" });
    ok(unknown.noop, "line-move: an unknown id is a no-op");
  }

  // curtain ↔ track (keyed) partners
  {
    const a = sec("A", [line(1, { curtain: true, curtainTrackKey: "ct-1-x" }), line(2), line(3, { track: { series: "x" } as never, curtainTrackKey: "ct-1-x" })]);
    const b = sec("B", []);
    const p = planLineMove([a, b], R("A", 1), { kind: "system", sectionId: "B" });
    ok(refs(p.lines) === "A:1,A:3" && p.added.length === 1 && p.added[0].id === 3 && p.added[0].sectionId === "A" && p.added[0].why === "track", "line-move: a keyed curtain brings its track");
    const q = planLineMove([a, b], R("A", 3), { kind: "system", sectionId: "B" });
    ok(refs(q.lines) === "A:1,A:3" && q.added[0].why === "curtain", "line-move: a keyed track brings its curtain");
  }

  // curtain ↔ track (legacy adjacency) partners land adjacent
  {
    const a = sec("A", [line(1, { curtain: true }), line(2, { track: { series: "x" } as never }), line(3)]);
    const b = sec("B", [line(4)]);
    const { sections, plan } = applyLineMove([a, b], R("A", 1), { kind: "system", sectionId: "B" });
    ok(refs(plan.lines) === "A:1,A:2", "line-move: an adjacency-paired curtain brings its track");
    ok(ids(find(sections, "B")).join() === "4,1,2", "line-move: the adjacency pair stays adjacent in the target");
  }

  // labor group partners + record travels
  {
    const draft = { mobs: [], margin: "30" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" }), line(2, { labor: true, laborGroup: "lg1" }), line(3)], {
      laborGroups: { lg1: { draft, lines: 2 } },
    });
    const b = sec("B", []);
    const { sections, plan } = applyLineMove([a, b], R("A", 2), { kind: "system", sectionId: "B" });
    ok(refs(plan.lines) === "A:1,A:2" && plan.added.some((x) => x.id === 1 && x.why === "labor"), "line-move: a labor line brings its whole group");
    ok(!find(sections, "A")!.laborGroups && !!find(sections, "B")!.laborGroups?.lg1, "line-move: the group's draft moves to the target");
  }

  // labor group id collision → re-minted on lines and record
  {
    const draft = { mobs: [], margin: "30" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft, lines: 1 } } });
    const b = sec("B", [line(2, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft, lines: 1 } } });
    const { sections } = applyLineMove([a, b], R("A", 1), { kind: "system", sectionId: "B" }, { mintLaborGroupId: () => "lgNEW" });
    const tb = find(sections, "B")!;
    ok(tb.items.find((x) => x.id === 1)!.laborGroup === "lgNEW" && tb.items.find((x) => x.id === 2)!.laborGroup === "lg1", "line-move: a colliding labor group id is re-minted on the moved lines");
    ok(!!tb.laborGroups?.lg1 && !!tb.laborGroups?.lgNEW, "line-move: both group records survive the collision");
  }

  // typed sell cleared on source and target only
  {
    const a = sec("A", [line(1), line(2)], { sellOverride: 500 });
    const b = sec("B", [line(3)], { sellOverride: 900 });
    const c = sec("C", [line(4)], { sellOverride: 100 });
    const { sections, plan } = applyLineMove([a, b, c], R("A", 1), { kind: "system", sectionId: "B" });
    ok(plan.clearedSell.join() === "A,B", "line-move: plan lists the typed sells it clears");
    ok(!("sellOverride" in find(sections, "A")!) && !("sellOverride" in find(sections, "B")!) && find(sections, "C")!.sellOverride === 100, "line-move: typed sell cleared on source + target, untouched elsewhere");
  }

  // key-product stars: carry, dupSku drop, full drop
  {
    const kp = (id: number, sku = "SKU-" + id) => ({ lineKey: String(id), sku, text: "p" + id, photo: true });
    const a = sec("A", [line(1), line(2)], { keyProducts: [kp(1), kp(2)] });
    const b = sec("B", [line(3, { sku: "SKU-2" })], { keyProducts: [kp(3, "SKU-2")] });
    const { sections, plan } = applyLineMove([a, b], R("A", 1, 2), { kind: "system", sectionId: "B" });
    ok(!find(sections, "A")!.keyProducts, "line-move: the source loses the moved stars");
    ok(find(sections, "B")!.keyProducts!.map((k) => k.lineKey).join() === "3,1", "line-move: a star follows its line; a duplicate-part star is dropped");
    ok(plan.droppedStars.length === 1 && plan.droppedStars[0].id === 2 && plan.droppedStars[0].why === "dupSku", "line-move: the plan names the dropped duplicate star");

    const full = Array.from({ length: MAX_KEY_PRODUCTS }, (_, i) => line(100 + i));
    const t = sec("T", full, { keyProducts: full.map((x) => kp(x.id)) });
    const s = sec("S", [line(9)], { keyProducts: [kp(9)] });
    const r = applyLineMove([s, t], R("S", 9), { kind: "system", sectionId: "T" });
    ok(r.plan.droppedStars[0]?.why === "full" && find(r.sections, "T")!.keyProducts!.length === MAX_KEY_PRODUCTS, "line-move: a star is dropped when the target is full");
  }

  // new system target: inserted after the first source, inherits group/freight/rounding
  {
    const a = sec("A", [line(1)], { groupId: "g-1", freightPct: 7, priceRound: 25 });
    const b = sec("B", [line(2)]);
    const { sections, plan } = applyLineMove([a, b], [...R("A", 1), ...R("B", 2)], { kind: "new", id: "sysN", name: "Sound" });
    ok(sections.map((s) => s.id).join() === "A,sysN,B", "line-move: a new system is inserted right after the first source");
    const n = find(sections, "sysN")!;
    ok(n.name === "Sound" && n.groupId === "g-1" && n.freightPct === 7 && n.priceRound === 25 && ids(n).join() === "1,2", "line-move: the new system inherits group, freight and rounding and holds the lines");
    ok(plan.emptied.join() === "A,B" && ids(find(sections, "A")).length === 0, "line-move: emptied sources are kept and listed");
  }

  // another estimate: extract + remove
  {
    const draft = { mobs: [], margin: "30" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" }), line(2)], {
      sellOverride: 300, groupId: "g-1", built: true, clientGoals: "x", coverText: "y", discipline: "lighting",
      laborGroups: { lg1: { draft, lines: 1 } }, keyProducts: [{ lineKey: "1", sku: "SKU-1", text: "t", photo: true }],
    });
    const plan = planLineMove([a], R("A", 1), { kind: "estimate" });
    const out = extractLinesAsSection([a], plan);
    ok(ids(out).join() === "1" && out.name === "Sys A" && out.discipline === "lighting", "line-move: the outgoing section carries the lines and the source's name/discipline");
    ok(!("sellOverride" in out) && !("groupId" in out) && !("built" in out) && !("clientGoals" in out) && !("coverText" in out), "line-move: the outgoing section drops typed sell, group, built, goals and cover");
    ok(!!out.laborGroups?.lg1 && out.keyProducts?.length === 1, "line-move: the outgoing section carries its labor drafts and stars");
    const rest = removeLinesFromSources([a], plan.lines);
    ok(ids(rest[0]).join() === "2" && !rest[0].laborGroups && !rest[0].keyProducts && !("sellOverride" in rest[0]), "line-move: removing from the source prunes drafts and stars and clears the typed sell");
    ok(plan.clearedSell.join() === "A", "line-move: an estimate move clears only the sources' typed sells");
  }

  // unknown target / taken new id → no-op, nothing lost
  {
    const a = sec("A", [line(1), line(2)]);
    const r = applyLineMove([a], R("A", 1), { kind: "system", sectionId: "ZZ" });
    ok(r.plan.noop && ids(find(r.sections, "A")).join() === "1,2", "line-move: an unknown target system is a no-op and loses no lines");
    const r2 = applyLineMove([a, sec("B", [])], R("A", 1), { kind: "new", id: "B", name: "X" });
    ok(r2.plan.noop && ids(find(r2.sections, "A")).join() === "1,2" && r2.sections.length === 2, "line-move: a new-system id that already exists is a no-op");
  }

  // a partner already in the target is neither moved nor listed
  {
    const a = sec("A", [line(1, { curtain: true, curtainTrackKey: "ct-1-x" })]);
    const b = sec("B", [line(3, { track: { series: "x" } as never, curtainTrackKey: "ct-1-x" })]);
    const p = planLineMove([a, b], R("A", 1), { kind: "system", sectionId: "B" });
    ok(refs(p.lines) === "A:1" && p.added.length === 0, "line-move: a partner already in the target is not moved or listed");
  }

  // two sources sharing a labor group id → no draft is overwritten
  {
    const d1 = { mobs: [], margin: "30" } as never;
    const d2 = { mobs: [], margin: "40" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft: d1, lines: 1 } } });
    const b = sec("B", [line(2, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft: d2, lines: 1 } } });
    const c = sec("C", []);
    let n = 0;
    const { sections } = applyLineMove([a, b, c], [...R("A", 1), ...R("B", 2)], { kind: "system", sectionId: "C" }, { mintLaborGroupId: () => "lgM" + ++n });
    const tc = find(sections, "C")!;
    const g1 = tc.items.find((x) => x.id === 1)!.laborGroup, g2 = tc.items.find((x) => x.id === 2)!.laborGroup;
    ok(g1 === "lg1" && g2 === "lgM1", "line-move: the second source's colliding labor group id is re-minted on its lines only");
    ok(tc.laborGroups?.lg1?.draft === d1 && tc.laborGroups?.lgM1?.draft === d2, "line-move: each source keeps its own labor draft in the target");
    // minted id that is itself taken is skipped
    const e = sec("E", [line(5, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft: d2, lines: 1 } } });
    const f = sec("F", [], { laborGroups: { lg1: { draft: d1, lines: 0 }, lgM1: { draft: d1, lines: 0 } } });
    let m = 0;
    const r = applyLineMove([e, f], R("E", 5), { kind: "system", sectionId: "F" }, { mintLaborGroupId: () => "lgM" + ++m });
    ok(find(r.sections, "F")!.items[0].laborGroup === "lgM2", "line-move: a minted labor group id that is already taken is re-minted again");
    // extract: same per-source rule
    const plan = planLineMove([a, b], [...R("A", 1), ...R("B", 2)], { kind: "estimate" });
    let k = 0;
    const out = extractLinesAsSection([a, b], plan, { mintLaborGroupId: () => "lgX" + ++k });
    ok(out.items.map((x) => x.laborGroup).join() === "lg1,lgX1" && out.laborGroups?.lg1?.draft === d1 && out.laborGroups?.lgX1?.draft === d2, "line-move: the outgoing section re-mints a colliding labor group id per source");
  }

  // stars dropped for a new system too; extract dedupes stars
  {
    const kp = (id: number, sku: string) => ({ lineKey: String(id), sku, text: "p" + id, photo: true });
    const a = sec("A", [line(1, { sku: "SAME" })], { keyProducts: [kp(1, "SAME")] });
    const b = sec("B", [line(2, { sku: "SAME" })], { keyProducts: [kp(2, "SAME")] });
    const { sections, plan } = applyLineMove([a, b], [...R("A", 1), ...R("B", 2)], { kind: "new", id: "N", name: "N" });
    ok(plan.droppedStars.length === 1 && plan.droppedStars[0].id === 2 && find(sections, "N")!.keyProducts!.length === 1, "line-move: a new system drops a duplicate-part star across sources");
    const out = extractLinesAsSection([a, b], planLineMove([a, b], [...R("A", 1), ...R("B", 2)], { kind: "estimate" }));
    ok(out.keyProducts?.length === 1, "line-move: the outgoing section dedupes stars");
  }

  // ids are unique per SYSTEM only (Copy/Move system into an existing estimate keeps them): A:105, C:105, B:107
  {
    const kp = (id: number, sku = "SKU-" + id) => ({ lineKey: String(id), sku, text: "p" + id, photo: true });
    const a = sec("A", [line(105, { sku: "A-105" })], { keyProducts: [kp(105, "A-105")] });
    const b = sec("B", [line(107)]);
    const c = sec("C", [line(105, { sku: "C-105" }), line(106)], { keyProducts: [kp(105, "C-105")] });
    const all = [a, b, c];
    let n = 900;
    const mint = () => ++n;
    // 1. A:105 → B moves only A's 105.
    const r1 = applyLineMove(all, R("A", 105), { kind: "system", sectionId: "B" }, { mintItemId: mint });
    ok(refs(r1.plan.lines) === "A:105", "line-move dup ids: ticking A:105 plans only A's line");
    ok(ids(find(r1.sections, "B")).join() === "107,105" && ids(find(r1.sections, "C")).join() === "105,106" && ids(find(r1.sections, "A")).length === 0,
      "line-move dup ids: moving A:105 to B leaves C's 105 alone");
    // 2. A:105 → C moves (not "Nothing to move") and lands re-minted, its star following.
    n = 900;
    const p2 = planLineMove(all, R("A", 105), { kind: "system", sectionId: "C" });
    ok(!p2.noop && refs(p2.lines) === "A:105", "line-move dup ids: A:105 → C is a real move, not a no-op");
    const r2 = applyLineMove(all, R("A", 105), { kind: "system", sectionId: "C" }, { mintItemId: mint });
    const tc = find(r2.sections, "C")!;
    ok(ids(tc).join() === "105,106,901" && tc.items[2].sku === "A-105" && tc.items[0].sku === "C-105", "line-move dup ids: the landing line takes a fresh id; the target's own 105 keeps its id");
    ok(tc.keyProducts!.map((k) => k.lineKey + "=" + k.sku).join() === "105=C-105,901=A-105", "line-move dup ids: the re-minted line's star follows it (remapKeyProducts)");
    ok(new Set(ids(tc)).size === tc.items.length, "line-move dup ids: no two lines in the target share an id");
    // 3. C:105 → A: one 105 in A, never two.
    n = 900;
    const r3 = applyLineMove(all, R("C", 105), { kind: "system", sectionId: "A" }, { mintItemId: mint });
    const ta = find(r3.sections, "A")!;
    ok(ids(ta).join() === "105,901" && ta.items[0].sku === "A-105" && ta.items[1].sku === "C-105", "line-move dup ids: C:105 → A lands as a new id beside A's 105");
    ok(ids(find(r3.sections, "C")).join() === "106", "line-move dup ids: only C's 105 leaves C");
    // A line token star follows the re-id too.
    n = 900;
    const tok = sec("T", [line(105, { sku: "" })], { keyProducts: [{ lineKey: "105", sku: "line:105", text: "allowance", photo: false }] });
    const r4 = applyLineMove([tok, a], R("T", 105), { kind: "system", sectionId: "A" }, { mintItemId: mint });
    ok(find(r4.sections, "A")!.keyProducts!.some((k) => k.lineKey === "901" && k.sku === "line:901"), "line-move dup ids: a line:<id> token star follows the re-minted id");
    // Two moving lines from different sources sharing an id: the second is re-minted.
    n = 900;
    const r5 = applyLineMove(all, [...R("A", 105), ...R("C", 105)], { kind: "system", sectionId: "B" }, { mintItemId: mint });
    const tb = find(r5.sections, "B")!;
    ok(ids(tb).join() === "107,105,901" && tb.items[1].sku === "A-105" && tb.items[2].sku === "C-105", "line-move dup ids: two moving 105s from different systems land as 105 and a fresh id");
    ok(tb.keyProducts!.map((k) => k.lineKey + "=" + k.sku).join() === "105=A-105,901=C-105", "line-move dup ids: each moving star follows its own line");
    // Extract de-duplicates ids across sources the same way.
    n = 900;
    const plan = planLineMove(all, [...R("A", 105), ...R("C", 105)], { kind: "estimate" });
    const out = extractLinesAsSection(all, plan, { mintItemId: mint });
    ok(ids(out).join() === "105,901" && out.items[1].sku === "C-105", "line-move dup ids: the outgoing section de-duplicates ids across sources");
    ok(out.keyProducts!.map((k) => k.lineKey + "=" + k.sku).join() === "105=A-105,901=C-105", "line-move dup ids: the outgoing section's stars follow the de-duplicated ids");
    const rest = removeLinesFromSources(all, plan.lines);
    ok(ids(find(rest, "A")).length === 0 && ids(find(rest, "C")).join() === "106" && ids(find(rest, "B")).join() === "107", "line-move dup ids: removing by LineRef takes exactly the picked lines");
    // Labor partners stay within their own section even when ids/groups repeat elsewhere.
    const la = sec("LA", [line(1, { labor: true, laborGroup: "lg1" }), line(2, { labor: true, laborGroup: "lg1" })]);
    const lb = sec("LB", [line(1, { labor: true, laborGroup: "lg1" })]);
    const lp = planLineMove([la, lb, sec("LC", [])], R("LA", 1), { kind: "system", sectionId: "LC" });
    ok(refs(lp.lines) === "LA:1,LA:2", "line-move dup ids: a labor group's partners come from its own system only");
    ok(lineRefKey({ sectionId: "sys:x", id: 7 }) === "sys:x:7" && parseLineRefKey("sys:x:7")?.sectionId === "sys:x" && parseLineRefKey("sys:x:7")?.id === 7 && parseLineRefKey("bad") === null,
      "line-move: lineRefKey / parseLineRefKey round-trip (the id is after the last colon)");
  }

  // orphan labor-group ids: a target line carrying "lg1" with no record still blocks "lg1"
  {
    const draft = { mobs: [], margin: "30" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft, lines: 1 } } });
    const b = sec("B", [line(2, { labor: true, laborGroup: "lg1" })]); // no laborGroups record
    const { sections } = applyLineMove([a, b], R("A", 1), { kind: "system", sectionId: "B" }, { mintLaborGroupId: () => "lgNEW" });
    const tb = find(sections, "B")!;
    ok(tb.items.find((x) => x.id === 1)!.laborGroup === "lgNEW" && tb.items.find((x) => x.id === 2)!.laborGroup === "lg1" && !!tb.laborGroups?.lgNEW && !tb.laborGroups?.lg1,
      "line-move: a target line's record-less labor group id is taken — the moving group is re-minted, never merged");
  }

  // two colliding labor groups: the preview and the move both return (no constant preview minter spinning the re-mint loop)
  {
    const draft = { mobs: [], margin: "30" } as never;
    const grp = () => ({ draft, lines: 1 });
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" }), line(2, { labor: true, laborGroup: "lg2" })], { laborGroups: { lg1: grp(), lg2: grp() } });
    const b = sec("B", [line(3, { labor: true, laborGroup: "lg1" }), line(4, { labor: true, laborGroup: "lg2" })], { laborGroups: { lg1: grp(), lg2: grp() } });
    const p = planLineMove([a, b], R("A", 1, 2), { kind: "system", sectionId: "B" });
    ok(!p.noop && refs(p.lines) === "A:1,A:2", "line-move: two colliding labor groups — planLineMove (no opts) returns");
    const r = applyLineMove([a, b], R("A", 1, 2), { kind: "system", sectionId: "B" });
    const tb = find(r.sections, "B")!;
    const moved = tb.items.filter((x) => x.id === 1 || x.id === 2).map((x) => x.laborGroup!);
    ok(moved.length === 2 && new Set([...moved, "lg1", "lg2"]).size === 4 && moved.every((g) => !!tb.laborGroups?.[g]),
      "line-move: two colliding labor groups — applyLineMove (no opts) returns with two fresh group ids and their records");
    let threw = "";
    try {
      applyLineMove([a, b], R("A", 1, 2), { kind: "system", sectionId: "B" }, { mintLaborGroupId: () => "lg1" });
    } catch (e) {
      threw = (e as Error).message;
    }
    ok(/could not mint a free labor group id/.test(threw), "line-move: a minter that only returns taken ids throws a clear error instead of hanging");
  }

  // legacy (key-less) curtain/track pairs that move together get one fresh key
  {
    const a = sec("A", [line(1, { curtain: true }), line(2, { track: { series: "x" } as never }), line(3)]);
    const b = sec("B", [line(4, { curtain: true }), line(5, { track: { series: "y" } as never })]);
    const { sections } = applyLineMove([a, b], R("A", 1), { kind: "system", sectionId: "B" }, { mintCurtainTrackKey: (id) => "ct-" + id + "-T" });
    const tb = find(sections, "B")!;
    const c = tb.items.find((x) => x.id === 1)!, t = tb.items.find((x) => x.id === 2)!;
    ok(c.curtainTrackKey === "ct-1-T" && t.curtainTrackKey === "ct-1-T", "line-move: a legacy curtain/track pair that moves together is stamped with one fresh key");
    ok(!tb.items.find((x) => x.id === 4)!.curtainTrackKey && !tb.items.find((x) => x.id === 5)!.curtainTrackKey, "line-move: the target's own legacy pair is left alone");
    const plain = applyLineMove([sec("P", [line(7), line(8)]), sec("Q", [])], R("P", 7), { kind: "system", sectionId: "Q" });
    ok(!("curtainTrackKey" in find(plain.sections, "Q")!.items[0]), "line-move: a line with no curtain/track pair gets no key");
  }

  // server: a system landing in an EXISTING estimate re-ids only what collides (Move/Copy system #266 and Move lines alike)
  {
    const kp = (id: number, sku: string) => ({ lineKey: String(id), sku, text: "p" + id, photo: true });
    const target = [sec("X", [line(105), line(120)]), sec("Y", [line(130)])];
    const incoming = sec("IN", [line(105, { sku: "IN-105", curtainTrackKey: "ct-105-z" }), line(106, { sku: "IN-106" }), line(107, { sku: "" })], {
      keyProducts: [kp(105, "IN-105"), kp(106, "IN-106"), { lineKey: "107", sku: "line:107", text: "a", photo: false }, kp(999, "GONE")],
    });
    const out = reIdIncomingSection(incoming, target, 0);
    ok(ids(out).join() === "131,106,107", "line-move server re-id: only the colliding line is re-minted, above every target id (max + 1)");
    ok(out.items[0].sku === "IN-105" && out.items[0].curtainTrackKey === "ct-105-z" && out.items[0].cost === incoming.items[0].cost && out.items[1] === incoming.items[1],
      "line-move server re-id: everything else is kept byte-for-byte (non-colliding lines are the same objects)");
    ok(out.keyProducts!.map((k) => k.lineKey + "=" + k.sku).join() === "131=IN-105,106=IN-106,107=line:107,999=GONE", "line-move server re-id: the re-minted line's star follows; other blocks are kept as they came");
    ok(ids(reIdIncomingSection(incoming, target, 500)).join() === "501,106,107", "line-move server re-id: the target document's id floor (docIdFloor) is respected");
    const clean = sec("OK", [line(1), line(2)]);
    ok(reIdIncomingSection(clean, target, 0) === clean, "line-move server re-id: a section with no collision is returned unchanged (same object)");
    const tok = sec("T", [line(130, { sku: "" })], { keyProducts: [{ lineKey: "130", sku: "line:130", text: "a", photo: false }] });
    const t2 = reIdIncomingSection(tok, target, 0);
    ok(ids(t2).join() === "131" && t2.keyProducts![0].sku === "line:131" && t2.keyProducts![0].lineKey === "131", "line-move server re-id: a line:<id> token star follows the new id");
    // A minted id never lands on a later incoming line.
    const crowd = reIdIncomingSection(sec("C", [line(130), line(131)]), target, 0);
    ok(ids(crowd).join() === "132,131", "line-move server re-id: a minted id skips ids the incoming section itself holds");
    const acts = readFileSync(join(process.cwd(), "src/app/(app)/estimator/actions.ts"), "utf8");
    const place = acts.slice(acts.indexOf("async function placeSystemInEstimate("));
    const existingBranch = place.slice(place.indexOf('if (target.kind === "existing") {'), place.indexOf("const newSections = canonicalBonusSections("));
    ok(/reIdIncomingSection\(stripBonusLines\(withoutGroupMeta\(placed\)\), existingSpec\?\.sections \|\| \[\], docIdFloor\(existingDoc\)\)/.test(existingBranch) &&
       existingBranch.indexOf("reIdIncomingSection(") < existingBranch.indexOf("const appendedRaw"),
      "line-move server re-id: placeSystemInEstimate's existing-target branch re-ids the incoming system before appending it");
  }

  // describe
  {
    const a = sec("A", [line(1, { curtain: true }), line(2, { track: { series: "x" } as never })], { sellOverride: 10 });
    const b = sec("B", [], { name: "Rigging" } as never);
    const plan = planLineMove([a, b], R("A", 1), { kind: "system", sectionId: "B" });
    const lines = describeLineMove(plan, [a, b], "Rigging");
    ok(lines.includes("+1 linked track will move too"), "line-move: describe names the linked track");
    ok(lines.includes("Typed price cleared on Sys A"), "line-move: describe names the cleared typed price");
    ok(lines.includes("Sys A will be empty"), "line-move: describe names an emptied system");
  }

  lineMoveUiChecks(ok);
}

/** #357 — source checks on the Build UI (staff gate, movable gate, the bar's failure path). */
export function lineMoveUiChecks(ok: Ok) {
  const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const build = src("src/app/(app)/estimator/steps/build-step.tsx");
  const card = src("src/app/(app)/estimator/section-card.tsx");
  const bar = src("src/app/(app)/estimator/move-lines-bar.tsx");

  ok(build.includes("selectedLines={isInternal ? selectedBySection.get(sec.id) : undefined}") &&
     build.includes("onToggleLineSelected={isInternal ? (itemId) => toggleLine({ sectionId: sec.id, id: itemId }) : undefined}") &&
     build.includes("onMoveLine={isInternal ? (itemId) => setRowMove({ sectionId: sec.id, id: itemId }) : undefined}"),
    "line-move UI: build-step passes the three SectionCard props only behind isInternal, each scoped to its own system");
  ok(build.includes("useState<Set<string>>") && build.includes("useState<LineRef | null>") && /lineRefKey\(\{ sectionId: x\.id, id: it\.id \}\)/.test(build),
    "line-move UI: a tick and a ⇄ are keyed by system + id (ids repeat across systems)");
  ok(/sections\.filter\(\(x\) => x\.built !== true\)/.test(build), "line-move UI: ticks on a built (collapsed) system drop out of the live selection");
  ok(bar.includes("lines.every((r) => r.sectionId === secId)"), "line-move UI: the Move menu's \"already there\" check compares the system, not a bare id");
  ok(/p\.onToggleLineSelected && !isMovableLine\(it\) && <span aria-hidden="true" data-line-check-pad=""/.test(card) &&
     /\.\.\.\(p\.onToggleLineSelected \? \{ paddingLeft: LINE_CHECK_PAD \} : null\)/.test(card),
    "line-move UI: rows without a checkbox (bonus, Rewards credit) keep the checkbox's room so descriptions line up");
  ok(src("src/app/(app)/estimator/estimator-styles.ts").includes(".est-action-btn:hover:not(:disabled)"), "line-move UI: a disabled ⇄ doesn't shade on hover");
  const hook = src("src/app/(app)/estimator/use-estimator-state.ts");
  ok(hook.includes("applyLineMove(sections, selected, resolved, { mintItemId: nextId })") && hook.includes("extractLinesAsSection(sections, plan, { mintItemId: nextId })") &&
     hook.includes("removeLinesFromSources(ss, plan.lines)"),
    "line-move UI: the hook re-mints colliding ids with nextId and removes by LineRef");
  ok(build.includes("lineSelectDisabled={movingLines}"), "line-move UI: an estimate move in flight disables ticking / ⇄ (kept in place, no row shift)");
  ok(/checked=\{!!p\.selectedLines\?\.has\(it\.id\)\}\s*disabled=\{p\.lineSelectDisabled\}/.test(card) &&
     /onClick=\{\(\) => p\.onMoveLine\?\.\(it\.id\)\} disabled=\{p\.lineSelectDisabled\}/.test(card),
    "line-move UI: section-card disables (never hides) the checkbox and ⇄ while a move runs");
  ok(/\{isInternal && barLines\.length > 0 && \(\s*<MoveLinesBar/.test(build), "line-move UI: the Move bar renders for staff only");

  ok(/\{p\.onToggleLineSelected && isMovableLine\(it\) && \(\s*<input\s+type="checkbox"/.test(card), "line-move UI: the select checkbox is gated on isMovableLine");
  ok(/\{p\.onMoveLine && isMovableLine\(it\) && \(\s*<button[^>]*onClick=\{\(\) => p\.onMoveLine\?\.\(it\.id\)\}[^>]*>⇄<\/button>/.test(card), "line-move UI: ⇄ is gated on isMovableLine");

  // Each effect body runs to its close: "});" (no deps) or "]);" (deps), whichever comes first.
  const effects = bar.split("useEffect(").slice(1).map((b) => {
    const ends = [b.indexOf("});"), b.indexOf("]);")].filter((i) => i >= 0);
    return b.slice(0, Math.min(...ends) + 3);
  });
  ok(effects.length > 0 && !effects.some((b) => /moving/.test(b) && /onClear/.test(b)), "line-move UI: no MoveLinesBar effect clears on moving → false");
  const at = bar.indexOf("else if (waiting && !p.moving) {");
  const ending = at >= 0 ? bar.slice(at, bar.indexOf("}", at) + 1) : "";
  ok(ending.includes("setWaiting(false)") && ending.includes("setFailure(") && !ending.includes("onClear"),
    "line-move UI: a failed estimate move keeps the ticks (no onClear) and keeps its error");
  ok(bar.includes("{failure && (") && bar.includes('color: "#9a2f22"'), "line-move UI: the bar shows the failed move's error");
}

if (process.argv[1]?.endsWith("test-estimate-line-move.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  lineMoveChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
