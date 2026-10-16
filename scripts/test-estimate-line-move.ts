/* #356 — move estimator lines between systems. Pure checks; run alone with
   `npx tsx scripts/test-estimate-line-move.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import {
  applyLineMove, describeLineMove, extractLinesAsSection, isMovableLine, planLineMove, removeLinesFromSources,
} from "../src/lib/estimate-line-move/move";
import { MAX_KEY_PRODUCTS } from "../src/app/(app)/estimator/narrative";

const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 1, unit: "ea", cost: 10 * id, price: 20 * id, ...extra }) as SpecItem;
const sec = (id: string, items: SpecItem[], extra: Partial<SpecSection> = {}): SpecSection =>
  ({ id, name: "Sys " + id, kind: "materials", mfr: "", freightPct: 5, items, ...extra }) as SpecSection;
const ids = (s: SpecSection | undefined) => (s ? s.items.map((x) => x.id) : []);
const find = (ss: SpecSection[], id: string) => ss.find((s) => s.id === id);

export async function lineMoveChecks(ok: Ok) {
  // movable
  ok(isMovableLine(line(1)), "line-move: a plain line is movable");
  ok(!isMovableLine(line(2, { bonus: "package" })), "line-move: a bonus line is not movable");
  ok(!isMovableLine(line(3, { rewardCredit: true })), "line-move: the Rewards credit is not movable");

  // simple move, prices untouched, appended in order, lineOrder renumbered
  {
    const a = sec("A", [line(1), line(2), line(3)]);
    const b = sec("B", [line(4)]);
    const { sections, plan } = applyLineMove([a, b], [3, 1], { kind: "system", sectionId: "B" });
    ok(plan.ids.join() === "1,3" && plan.sources.join() === "A", "line-move: plan ids in system/line order, one source");
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
    const { sections, plan } = applyLineMove([a, b], [1, 2, 3], { kind: "system", sectionId: "B" });
    ok(plan.ids.join() === "1" && ids(find(sections, "A")).join() === "2,3", "line-move: bonus and credit lines stay put");
  }

  // already in the target → noop; target holding every selected line
  {
    const a = sec("A", [line(1)]);
    const p = planLineMove([a], [1], { kind: "system", sectionId: "A" });
    ok(p.noop && p.ids.length === 0, "line-move: moving into its own system is a no-op");
    const unknown = planLineMove([a], [99], { kind: "system", sectionId: "A" });
    ok(unknown.noop, "line-move: an unknown id is a no-op");
  }

  // curtain ↔ track (keyed) partners
  {
    const a = sec("A", [line(1, { curtain: true, curtainTrackKey: "ct-1-x" }), line(2), line(3, { track: { series: "x" } as never, curtainTrackKey: "ct-1-x" })]);
    const b = sec("B", []);
    const p = planLineMove([a, b], [1], { kind: "system", sectionId: "B" });
    ok(p.ids.join() === "1,3" && p.added.length === 1 && p.added[0].id === 3 && p.added[0].why === "track", "line-move: a keyed curtain brings its track");
    const q = planLineMove([a, b], [3], { kind: "system", sectionId: "B" });
    ok(q.ids.join() === "1,3" && q.added[0].why === "curtain", "line-move: a keyed track brings its curtain");
  }

  // curtain ↔ track (legacy adjacency) partners land adjacent
  {
    const a = sec("A", [line(1, { curtain: true }), line(2, { track: { series: "x" } as never }), line(3)]);
    const b = sec("B", [line(4)]);
    const { sections, plan } = applyLineMove([a, b], [1], { kind: "system", sectionId: "B" });
    ok(plan.ids.join() === "1,2", "line-move: an adjacency-paired curtain brings its track");
    ok(ids(find(sections, "B")).join() === "4,1,2", "line-move: the adjacency pair stays adjacent in the target");
  }

  // labor group partners + record travels
  {
    const draft = { mobs: [], margin: "30" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" }), line(2, { labor: true, laborGroup: "lg1" }), line(3)], {
      laborGroups: { lg1: { draft, lines: 2 } },
    });
    const b = sec("B", []);
    const { sections, plan } = applyLineMove([a, b], [2], { kind: "system", sectionId: "B" });
    ok(plan.ids.join() === "1,2" && plan.added.some((x) => x.id === 1 && x.why === "labor"), "line-move: a labor line brings its whole group");
    ok(!find(sections, "A")!.laborGroups && !!find(sections, "B")!.laborGroups?.lg1, "line-move: the group's draft moves to the target");
  }

  // labor group id collision → re-minted on lines and record
  {
    const draft = { mobs: [], margin: "30" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft, lines: 1 } } });
    const b = sec("B", [line(2, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft, lines: 1 } } });
    const { sections } = applyLineMove([a, b], [1], { kind: "system", sectionId: "B" }, { mintLaborGroupId: () => "lgNEW" });
    const tb = find(sections, "B")!;
    ok(tb.items.find((x) => x.id === 1)!.laborGroup === "lgNEW" && tb.items.find((x) => x.id === 2)!.laborGroup === "lg1", "line-move: a colliding labor group id is re-minted on the moved lines");
    ok(!!tb.laborGroups?.lg1 && !!tb.laborGroups?.lgNEW, "line-move: both group records survive the collision");
  }

  // typed sell cleared on source and target only
  {
    const a = sec("A", [line(1), line(2)], { sellOverride: 500 });
    const b = sec("B", [line(3)], { sellOverride: 900 });
    const c = sec("C", [line(4)], { sellOverride: 100 });
    const { sections, plan } = applyLineMove([a, b, c], [1], { kind: "system", sectionId: "B" });
    ok(plan.clearedSell.join() === "A,B", "line-move: plan lists the typed sells it clears");
    ok(!("sellOverride" in find(sections, "A")!) && !("sellOverride" in find(sections, "B")!) && find(sections, "C")!.sellOverride === 100, "line-move: typed sell cleared on source + target, untouched elsewhere");
  }

  // key-product stars: carry, dupSku drop, full drop
  {
    const kp = (id: number, sku = "SKU-" + id) => ({ lineKey: String(id), sku, text: "p" + id, photo: true });
    const a = sec("A", [line(1), line(2)], { keyProducts: [kp(1), kp(2)] });
    const b = sec("B", [line(3, { sku: "SKU-2" })], { keyProducts: [kp(3, "SKU-2")] });
    const { sections, plan } = applyLineMove([a, b], [1, 2], { kind: "system", sectionId: "B" });
    ok(!find(sections, "A")!.keyProducts, "line-move: the source loses the moved stars");
    ok(find(sections, "B")!.keyProducts!.map((k) => k.lineKey).join() === "3,1", "line-move: a star follows its line; a duplicate-part star is dropped");
    ok(plan.droppedStars.length === 1 && plan.droppedStars[0].id === 2 && plan.droppedStars[0].why === "dupSku", "line-move: the plan names the dropped duplicate star");

    const full = Array.from({ length: MAX_KEY_PRODUCTS }, (_, i) => line(100 + i));
    const t = sec("T", full, { keyProducts: full.map((x) => kp(x.id)) });
    const s = sec("S", [line(9)], { keyProducts: [kp(9)] });
    const r = applyLineMove([s, t], [9], { kind: "system", sectionId: "T" });
    ok(r.plan.droppedStars[0]?.why === "full" && find(r.sections, "T")!.keyProducts!.length === MAX_KEY_PRODUCTS, "line-move: a star is dropped when the target is full");
  }

  // new system target: inserted after the first source, inherits group/freight/rounding
  {
    const a = sec("A", [line(1)], { groupId: "g-1", freightPct: 7, priceRound: 25 });
    const b = sec("B", [line(2)]);
    const { sections, plan } = applyLineMove([a, b], [1, 2], { kind: "new", id: "sysN", name: "Sound" });
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
    const plan = planLineMove([a], [1], { kind: "estimate" });
    const out = extractLinesAsSection([a], plan);
    ok(ids(out).join() === "1" && out.name === "Sys A" && out.discipline === "lighting", "line-move: the outgoing section carries the lines and the source's name/discipline");
    ok(!("sellOverride" in out) && !("groupId" in out) && !("built" in out) && !("clientGoals" in out) && !("coverText" in out), "line-move: the outgoing section drops typed sell, group, built, goals and cover");
    ok(!!out.laborGroups?.lg1 && out.keyProducts?.length === 1, "line-move: the outgoing section carries its labor drafts and stars");
    const rest = removeLinesFromSources([a], plan.ids);
    ok(ids(rest[0]).join() === "2" && !rest[0].laborGroups && !rest[0].keyProducts && !("sellOverride" in rest[0]), "line-move: removing from the source prunes drafts and stars and clears the typed sell");
    ok(plan.clearedSell.join() === "A", "line-move: an estimate move clears only the sources' typed sells");
  }

  // unknown target / taken new id → no-op, nothing lost
  {
    const a = sec("A", [line(1), line(2)]);
    const r = applyLineMove([a], [1], { kind: "system", sectionId: "ZZ" });
    ok(r.plan.noop && ids(find(r.sections, "A")).join() === "1,2", "line-move: an unknown target system is a no-op and loses no lines");
    const r2 = applyLineMove([a, sec("B", [])], [1], { kind: "new", id: "B", name: "X" });
    ok(r2.plan.noop && ids(find(r2.sections, "A")).join() === "1,2" && r2.sections.length === 2, "line-move: a new-system id that already exists is a no-op");
  }

  // a partner already in the target is neither moved nor listed
  {
    const a = sec("A", [line(1, { curtain: true, curtainTrackKey: "ct-1-x" })]);
    const b = sec("B", [line(3, { track: { series: "x" } as never, curtainTrackKey: "ct-1-x" })]);
    const p = planLineMove([a, b], [1], { kind: "system", sectionId: "B" });
    ok(p.ids.join() === "1" && p.added.length === 0, "line-move: a partner already in the target is not moved or listed");
  }

  // two sources sharing a labor group id → no draft is overwritten
  {
    const d1 = { mobs: [], margin: "30" } as never;
    const d2 = { mobs: [], margin: "40" } as never;
    const a = sec("A", [line(1, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft: d1, lines: 1 } } });
    const b = sec("B", [line(2, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft: d2, lines: 1 } } });
    const c = sec("C", []);
    let n = 0;
    const { sections } = applyLineMove([a, b, c], [1, 2], { kind: "system", sectionId: "C" }, { mintLaborGroupId: () => "lgM" + ++n });
    const tc = find(sections, "C")!;
    const g1 = tc.items.find((x) => x.id === 1)!.laborGroup, g2 = tc.items.find((x) => x.id === 2)!.laborGroup;
    ok(g1 === "lg1" && g2 === "lgM1", "line-move: the second source's colliding labor group id is re-minted on its lines only");
    ok(tc.laborGroups?.lg1?.draft === d1 && tc.laborGroups?.lgM1?.draft === d2, "line-move: each source keeps its own labor draft in the target");
    // minted id that is itself taken is skipped
    const e = sec("E", [line(5, { labor: true, laborGroup: "lg1" })], { laborGroups: { lg1: { draft: d2, lines: 1 } } });
    const f = sec("F", [], { laborGroups: { lg1: { draft: d1, lines: 0 }, lgM1: { draft: d1, lines: 0 } } });
    let m = 0;
    const r = applyLineMove([e, f], [5], { kind: "system", sectionId: "F" }, { mintLaborGroupId: () => "lgM" + ++m });
    ok(find(r.sections, "F")!.items[0].laborGroup === "lgM2", "line-move: a minted labor group id that is already taken is re-minted again");
    // extract: same per-source rule
    const plan = planLineMove([a, b], [1, 2], { kind: "estimate" });
    let k = 0;
    const out = extractLinesAsSection([a, b], plan, { mintLaborGroupId: () => "lgX" + ++k });
    ok(out.items.map((x) => x.laborGroup).join() === "lg1,lgX1" && out.laborGroups?.lg1?.draft === d1 && out.laborGroups?.lgX1?.draft === d2, "line-move: the outgoing section re-mints a colliding labor group id per source");
  }

  // stars dropped for a new system too; extract dedupes stars
  {
    const kp = (id: number, sku: string) => ({ lineKey: String(id), sku, text: "p" + id, photo: true });
    const a = sec("A", [line(1, { sku: "SAME" })], { keyProducts: [kp(1, "SAME")] });
    const b = sec("B", [line(2, { sku: "SAME" })], { keyProducts: [kp(2, "SAME")] });
    const { sections, plan } = applyLineMove([a, b], [1, 2], { kind: "new", id: "N", name: "N" });
    ok(plan.droppedStars.length === 1 && plan.droppedStars[0].id === 2 && find(sections, "N")!.keyProducts!.length === 1, "line-move: a new system drops a duplicate-part star across sources");
    const out = extractLinesAsSection([a, b], planLineMove([a, b], [1, 2], { kind: "estimate" }));
    ok(out.keyProducts?.length === 1, "line-move: the outgoing section dedupes stars");
  }

  // describe
  {
    const a = sec("A", [line(1, { curtain: true }), line(2, { track: { series: "x" } as never })], { sellOverride: 10 });
    const b = sec("B", [], { name: "Rigging" } as never);
    const plan = planLineMove([a, b], [1], { kind: "system", sectionId: "B" });
    const lines = describeLineMove(plan, [a, b], "Rigging");
    ok(lines.includes("+1 linked track will move too"), "line-move: describe names the linked track");
    ok(lines.includes("Typed price cleared on Sys A"), "line-move: describe names the cleared typed price");
    ok(lines.includes("Sys A will be empty"), "line-move: describe names an emptied system");
  }

  lineMoveUiChecks(ok);
}

/** #356 — source checks on the Build UI (staff gate, movable gate, the bar's failure path). */
export function lineMoveUiChecks(ok: Ok) {
  const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const build = src("src/app/(app)/estimator/steps/build-step.tsx");
  const card = src("src/app/(app)/estimator/section-card.tsx");
  const bar = src("src/app/(app)/estimator/move-lines-bar.tsx");

  ok(build.includes("selectedLines={isInternal ? selectedLines : undefined}") &&
     build.includes("onToggleLineSelected={isInternal ? toggleLine : undefined}") &&
     build.includes("onMoveLine={isInternal ? setRowMove : undefined}"),
    "line-move UI: build-step passes the three SectionCard props only behind isInternal");
  ok(build.includes("lineSelectDisabled={movingLines}"), "line-move UI: an estimate move in flight disables ticking / ⇄ (kept in place, no row shift)");
  ok(/checked=\{!!p\.selectedLines\?\.has\(it\.id\)\}\s*disabled=\{p\.lineSelectDisabled\}/.test(card) &&
     /onClick=\{\(\) => p\.onMoveLine\?\.\(it\.id\)\} disabled=\{p\.lineSelectDisabled\}/.test(card),
    "line-move UI: section-card disables (never hides) the checkbox and ⇄ while a move runs");
  ok(/\{isInternal && barIds\.length > 0 && \(\s*<MoveLinesBar/.test(build), "line-move UI: the Move bar renders for staff only");

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
