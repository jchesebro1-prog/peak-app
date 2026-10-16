# Estimator — Move Lines Between Systems (#356) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Estimator's Build step, tick one or more lines (or use a per-line Move to…) and move them to another system on this estimate, to a new system, or to another estimate.

**Architecture:** All rules live in one pure module, `src/lib/estimate-line-move/move.ts` (plan → apply), unit-tested in the spec harness. The estimator state hook gains `moveLinesHere` (client-only, saved by the next Save) and `moveLinesToEstimate` (reuses the existing `moveSystemToEstimateAction` by bundling the lines into one section). The UI is a checkbox + ⇄ button per line in `section-card.tsx` and a new sticky `move-lines-bar.tsx` owned by `steps/build-step.tsx`.

**Tech Stack:** Next.js 16 App Router, React client components, TypeScript, tsx spec harness (`npm run test:specs`).

Spec: `docs/superpowers/specs/2026-10-16-estimator-move-lines-design.md` (read it first).

## Global Constraints

- A moved line keeps every field byte-for-byte (cost, price, sellOverride, extSellOverride, option, flags, id). Nothing re-prices.
- Never movable: bonus lines (`isBonusItem`) and the Rewards credit (`isRewardCreditItem`).
- Partners always travel: curtain ↔ track as resolved by `linkCurtainTracks` (`src/lib/curtain-cut-sheets/track-link.ts`), and every line of the same `laborGroup` in the same system.
- A typed system sell (`SpecSection.sellOverride`) is cleared on every system that lost or gained a line.
- An emptied source system is kept, never deleted.
- No drag and drop, no copy, no server action of our own, no migration, no AI.
- Copy is plain English in the app's voice; user-visible strings are exactly as written below.
- Build gates (per `peak-verification-gate-protocol` memory): `npx tsc --noEmit`, `npm run test:specs`, `npm run test:smoke`, `npx eslint <touched files>`, `npx next build`. Report real numbers.
- Worktree: `/Users/sm/Downloads/peak-app/.claude/worktrees/move-lines` (branch `feat/356-move-lines`). If `node_modules` is missing run `npm ci` (never symlink). Never start a second process on `.data/pglite`.

---

### Task 1: Pure rules module + harness checks

**Files:**
- Create: `src/lib/estimate-line-move/move.ts`
- Create: `scripts/test-estimate-line-move.ts`
- Modify: `scripts/test-review-and-spec.ts` (one import + one `.then(...)` in the main chain, next to `bidChecks`)

**Interfaces — Produces:**
```ts
export type LineMoveTarget =
  | { kind: "system"; sectionId: string }
  | { kind: "new"; id: string; name: string }
  | { kind: "estimate" };
export type LineMovePartner = { id: number; why: "track" | "curtain" | "labor" };
export type DroppedStar = { id: number; why: "full" | "dupSku" };
export type LineMovePlan = {
  ids: number[];               // every line that moves, system order then line order
  added: LineMovePartner[];    // partners pulled in (not ticked by the user)
  sources: string[];           // section ids that lose lines, in system order
  clearedSell: string[];       // section ids whose typed sell clears
  droppedStars: DroppedStar[]; // only for kind "system"
  emptied: string[];           // sources left with no movable line
  noop: boolean;               // nothing would move
};
export function isMovableLine(it: SpecItem): boolean;
export function planLineMove(sections: readonly SpecSection[], selected: Iterable<number>, target: LineMoveTarget): LineMovePlan;
export function removeLinesFromSources(sections: readonly SpecSection[], ids: readonly number[]): SpecSection[];
export function applyLineMove(
  sections: readonly SpecSection[],
  selected: Iterable<number>,
  target: Exclude<LineMoveTarget, { kind: "estimate" }>,
  opts?: { mintLaborGroupId?: () => string }
): { sections: SpecSection[]; plan: LineMovePlan };
export function extractLinesAsSection(sections: readonly SpecSection[], plan: LineMovePlan): SpecSection;
export function describeLineMove(plan: LineMovePlan, sections: readonly SpecSection[], targetName: string): string[];
```

- [ ] **Step 1: Confirm the helper imports are tsx-safe.** Run:

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/move-lines && head -5 "src/app/(app)/estimator/pricing.ts" "src/app/(app)/estimator/narrative.ts" "src/app/(app)/estimator/labor-group.ts" | grep -n "use client\|server-only" || echo "all pure"
```
Expected: `all pure`. If any file is `"use client"` or `server-only`, copy the one helper you need (`clearSellOverride` is 6 lines, `pruneLaborGroups` 12) into `move.ts` instead of importing, with a comment naming the original.

- [ ] **Step 2: Write the failing checks** — `scripts/test-estimate-line-move.ts`:

```ts
/* #356 — move estimator lines between systems. Pure checks; run alone with
   `npx tsx scripts/test-estimate-line-move.ts`. */
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
}

if (process.argv[1]?.endsWith("test-estimate-line-move.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  lineMoveChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
```

- [ ] **Step 3: Run to see it fail.**

Run: `npx tsx scripts/test-estimate-line-move.ts`
Expected: fails to resolve `../src/lib/estimate-line-move/move`.

- [ ] **Step 4: Write the module** — `src/lib/estimate-line-move/move.ts`:

```ts
/**
 * #356 — move estimator lines between systems. Pure: no React, no server.
 *
 * planLineMove expands the selection with its partners (curtain ↔ track as
 * the cut sheets resolve them; a whole labor group) and lists every side
 * effect; applyLineMove carries the lines byte-for-byte (never re-priced) to
 * the end of the target, moving their labor-group drafts and key-product
 * stars with them and clearing the typed system sell on every system that
 * lost or gained a line. An emptied source is kept.
 */
import type { KeyProduct, LaborGroupRecord, SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { clearSellOverride } from "@/app/(app)/estimator/pricing";
import { MAX_KEY_PRODUCTS, withKeyProducts } from "@/app/(app)/estimator/narrative";
import { newLaborGroupId, pruneLaborGroups } from "@/app/(app)/estimator/labor-group";
import { linkCurtainTracks } from "@/lib/curtain-cut-sheets/track-link";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";

export type LineMoveTarget =
  | { kind: "system"; sectionId: string }
  | { kind: "new"; id: string; name: string }
  | { kind: "estimate" };
export type LineMovePartner = { id: number; why: "track" | "curtain" | "labor" };
export type DroppedStar = { id: number; why: "full" | "dupSku" };
export type LineMovePlan = {
  ids: number[];
  added: LineMovePartner[];
  sources: string[];
  clearedSell: string[];
  droppedStars: DroppedStar[];
  emptied: string[];
  noop: boolean;
};

export function isMovableLine(it: SpecItem): boolean {
  return !isBonusItem(it) && !isRewardCreditItem(it);
}

const isLineToken = (sku: string) => sku.startsWith("line:");

/** Target stars after appending `moving` blocks: duplicates (same lineKey or
 *  same non-token sku) and overflow past MAX_KEY_PRODUCTS are dropped. */
function mergeStars(target: KeyProduct[], moving: KeyProduct[]): { kept: KeyProduct[]; dropped: DroppedStar[] } {
  const kept = [...target];
  const dropped: DroppedStar[] = [];
  for (const kp of moving) {
    const dup = kept.some((k) => k.lineKey === kp.lineKey || (!isLineToken(kp.sku) && k.sku === kp.sku));
    if (dup) dropped.push({ id: Number(kp.lineKey), why: "dupSku" });
    else if (kept.length >= MAX_KEY_PRODUCTS) dropped.push({ id: Number(kp.lineKey), why: "full" });
    else kept.push(kp);
  }
  return { kept, dropped };
}

const renumber = (items: SpecItem[]) => items.map((it, i) => ({ ...it, lineOrder: i }));

export function planLineMove(sections: readonly SpecSection[], selected: Iterable<number>, target: LineMoveTarget): LineMovePlan {
  const targetId = target.kind === "system" ? target.sectionId : null;
  const where = new Map<number, { si: number; item: SpecItem }>();
  sections.forEach((s, si) => s.items.forEach((item) => where.set(item.id, { si, item })));

  // Partner map from the cut-sheet resolver (both directions).
  const { links } = linkCurtainTracks(sections);
  const partnerOf = new Map<number, LineMovePartner>();
  links.forEach((track, curtain) => {
    partnerOf.set(curtain.id, { id: track.id, why: "track" });
    partnerOf.set(track.id, { id: curtain.id, why: "curtain" });
  });

  const picked = new Set<number>();
  const ticked = new Set<number>();
  const added: LineMovePartner[] = [];
  const queue: number[] = [];
  for (const id of selected) {
    const w = where.get(id);
    if (!w || !isMovableLine(w.item) || (targetId && sections[w.si].id === targetId)) continue;
    if (!picked.has(id)) { picked.add(id); ticked.add(id); queue.push(id); }
  }
  const pull = (p: LineMovePartner) => {
    const w = where.get(p.id);
    if (!w || picked.has(p.id) || !isMovableLine(w.item) || (targetId && sections[w.si].id === targetId)) return;
    picked.add(p.id);
    added.push(p);
    queue.push(p.id);
  };
  while (queue.length) {
    const id = queue.shift() as number;
    const { si, item } = where.get(id)!;
    const partner = partnerOf.get(id);
    if (partner) pull(partner);
    if (item.laborGroup) for (const x of sections[si].items) if (x.laborGroup === item.laborGroup) pull({ id: x.id, why: "labor" });
  }

  const ids: number[] = [];
  const sources: string[] = [];
  sections.forEach((s) => {
    const mine = s.items.filter((x) => picked.has(x.id)).map((x) => x.id);
    if (mine.length) { ids.push(...mine); sources.push(s.id); }
  });
  const noop = ids.length === 0;

  const touched = new Set(sources);
  if (targetId && !noop) touched.add(targetId);
  const clearedSell = sections.filter((s) => touched.has(s.id) && "sellOverride" in s).map((s) => s.id);

  let droppedStars: DroppedStar[] = [];
  if (target.kind === "system" && !noop) {
    const tgt = sections.find((s) => s.id === targetId);
    const moving = sections.flatMap((s) => (s.keyProducts || []).filter((k) => picked.has(Number(k.lineKey))));
    droppedStars = mergeStars(tgt?.keyProducts || [], moving).dropped;
  }

  const emptied = sources.filter((sid) => {
    const s = sections.find((x) => x.id === sid)!;
    return !s.items.some((x) => !picked.has(x.id) && isMovableLine(x));
  });

  return { ids, added: added.filter((a) => !ticked.has(a.id)), sources, clearedSell, droppedStars, emptied, noop };
}

/** The source side of a move: the lines leave, their drafts and stars go with
 *  them, the typed sell clears, lineOrder renumbers. Untouched sections are
 *  returned as the same objects. */
export function removeLinesFromSources(sections: readonly SpecSection[], ids: readonly number[]): SpecSection[] {
  const gone = new Set(ids);
  return sections.map((s) => {
    if (!s.items.some((x) => gone.has(x.id))) return s;
    let next: SpecSection = clearSellOverride({ ...s, items: renumber(s.items.filter((x) => !gone.has(x.id))) });
    next = pruneLaborGroups(next);
    next = withKeyProducts(next, (s.keyProducts || []).filter((k) => !gone.has(Number(k.lineKey))));
    return next;
  });
}

/** Moves the lines to the end of the target (an existing system or a new one
 *  inserted right after the first source). Returns the new list + the plan it
 *  applied. A no-op plan returns `sections` unchanged. */
export function applyLineMove(
  sections: readonly SpecSection[],
  selected: Iterable<number>,
  target: Exclude<LineMoveTarget, { kind: "estimate" }>,
  opts: { mintLaborGroupId?: () => string } = {}
): { sections: SpecSection[]; plan: LineMovePlan } {
  const plan = planLineMove(sections, selected, target);
  if (plan.noop) return { sections: sections.slice(), plan };
  const mint = opts.mintLaborGroupId || (() => newLaborGroupId());
  const picked = new Set(plan.ids);

  const movingItems = sections.flatMap((s) => s.items.filter((x) => picked.has(x.id)));
  const movingStars = sections.flatMap((s) => (s.keyProducts || []).filter((k) => picked.has(Number(k.lineKey))));
  const movingGroups: Record<string, LaborGroupRecord> = {};
  for (const s of sections) for (const [g, rec] of Object.entries(s.laborGroups || {})) if (movingItems.some((x) => x.laborGroup === g)) movingGroups[g] = rec;

  let list = removeLinesFromSources(sections, plan.ids);

  const firstSource = sections.find((s) => s.id === plan.sources[0])!;
  if (target.kind === "new") {
    const fresh: SpecSection = {
      id: target.id,
      name: target.name,
      kind: "materials",
      mfr: "",
      freightPct: firstSource.freightPct,
      items: [],
      ...(firstSource.freightAuto ? { freightAuto: true } : {}),
      ...(typeof firstSource.priceRound === "number" ? { priceRound: firstSource.priceRound } : {}),
      ...(firstSource.groupId ? { groupId: firstSource.groupId } : {}),
    };
    const at = list.findIndex((s) => s.id === firstSource.id);
    list = [...list.slice(0, at + 1), fresh, ...list.slice(at + 1)];
  }
  const targetId = target.kind === "system" ? target.sectionId : target.id;

  list = list.map((s) => {
    if (s.id !== targetId) return s;
    // Labor group ids: re-mint any that already exist on the target.
    const rename = new Map<string, string>();
    const groups: Record<string, LaborGroupRecord> = { ...(s.laborGroups || {}) };
    for (const [g, rec] of Object.entries(movingGroups)) {
      const id = g in groups ? mint() : g;
      if (id !== g) rename.set(g, id);
      groups[id] = rec;
    }
    const items = movingItems.map((x) => (x.laborGroup && rename.has(x.laborGroup) ? { ...x, laborGroup: rename.get(x.laborGroup) } : x));
    let next: SpecSection = clearSellOverride({ ...s, items: renumber([...s.items, ...items]) });
    if (Object.keys(groups).length) next = { ...next, laborGroups: groups };
    next = withKeyProducts(next, mergeStars(s.keyProducts || [], movingStars).kept);
    return next;
  });
  return { sections: list, plan };
}

/** The lines of an estimate-bound plan as ONE section shaped like the first
 *  source (for moveSystemToEstimateAction, which re-ids and names it
 *  "<name> (moved)"). No typed sell, group, built, alternate, goals or cover. */
export function extractLinesAsSection(sections: readonly SpecSection[], plan: LineMovePlan): SpecSection {
  const picked = new Set(plan.ids);
  const first = sections.find((s) => s.id === plan.sources[0]) || sections[0];
  const items = renumber(sections.flatMap((s) => s.items.filter((x) => picked.has(x.id))));
  const groups: Record<string, LaborGroupRecord> = {};
  for (const s of sections) for (const [g, rec] of Object.entries(s.laborGroups || {})) if (items.some((x) => x.laborGroup === g)) groups[g] = rec;
  const stars = sections.flatMap((s) => (s.keyProducts || []).filter((k) => picked.has(Number(k.lineKey)))).slice(0, MAX_KEY_PRODUCTS);
  const out: SpecSection = {
    id: first.id,
    name: first.name,
    kind: first.kind,
    mfr: first.mfr,
    freightPct: first.freightPct,
    items,
    ...(first.freightAuto ? { freightAuto: true } : {}),
    ...(typeof first.priceRound === "number" ? { priceRound: first.priceRound } : {}),
    ...(first.discipline ? { discipline: first.discipline } : {}),
    ...(first.presentation ? { presentation: first.presentation } : {}),
    ...(Object.keys(groups).length ? { laborGroups: groups } : {}),
  };
  return withKeyProducts(out, stars);
}

/** The preview lines the Move bar shows before anything moves. */
export function describeLineMove(plan: LineMovePlan, sections: readonly SpecSection[], targetName: string): string[] {
  const name = (id: string) => sections.find((s) => s.id === id)?.name || "a system";
  const out: string[] = [];
  const n = (k: LineMovePartner["why"]) => plan.added.filter((a) => a.why === k).length;
  const tracks = n("track"), curtains = n("curtain"), labor = n("labor");
  if (tracks) out.push(`+${tracks} linked track${tracks === 1 ? "" : "s"} will move too`);
  if (curtains) out.push(`+${curtains} linked curtain${curtains === 1 ? "" : "s"} will move too`);
  if (labor) out.push(`+${labor} line${labor === 1 ? "" : "s"} in the same labor group will move too`);
  if (plan.clearedSell.length) out.push(`Typed price cleared on ${plan.clearedSell.map(name).join(", ")}`);
  const full = plan.droppedStars.filter((d) => d.why === "full").length;
  const dup = plan.droppedStars.filter((d) => d.why === "dupSku").length;
  if (full) out.push(`${full} key-product star${full === 1 ? "" : "s"} dropped — ${targetName} already has ${MAX_KEY_PRODUCTS}`);
  if (dup) out.push(`${dup} key-product star${dup === 1 ? "" : "s"} dropped — that part is already a key product in ${targetName}`);
  for (const sid of plan.emptied) out.push(`${name(sid)} will be empty`);
  return out;
}
```

- [ ] **Step 5: Run the checks; fix until green.**

Run: `npx tsx scripts/test-estimate-line-move.ts`
Expected: `N PASS, 0 FAIL` (N ≈ 35). If a check is wrong rather than the code (e.g. a fixture shape `linkCurtainTracks` needs), fix the fixture and say so in the report.

- [ ] **Step 6: Wire into the harness.** In `scripts/test-review-and-spec.ts` add next to the `./test-bids` import:

```ts
import { lineMoveChecks } from "./test-estimate-line-move";
```
and append `.then(() => lineMoveChecks(ok))` to the end of the chain on the line that starts `.then(() => bidChecks(ok))` (before its terminating punctuation, keeping the chain intact).

- [ ] **Step 7: Typecheck and commit.**

```bash
npx tsc --noEmit -p . && npx eslint src/lib/estimate-line-move/move.ts scripts/test-estimate-line-move.ts
git add src/lib/estimate-line-move scripts/test-estimate-line-move.ts scripts/test-review-and-spec.ts
git commit -m "feat(356): pure line-move rules — partners, typed sell, stars, labor drafts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Estimator state — `moveLinesHere` and `moveLinesToEstimate`

**Files:**
- Modify: `src/app/(app)/estimator/use-estimator-state.ts` (near `moveSystem`, ~line 1847; the `moveNotice` state ~line 471; the returned object ~line 3450)
- Modify: `src/app/(app)/estimator/estimator-banners.tsx` (~line 171, the notice text)

**Interfaces:**
- Consumes (Task 1): `applyLineMove`, `planLineMove`, `extractLinesAsSection`, `removeLinesFromSources`, `type LineMoveTarget`.
- Produces (returned from the hook):
```ts
moveLinesHere: (selected: number[], target: { kind: "system"; sectionId: string } | { kind: "new"; name: string }) => void;
moveLinesToEstimate: (selected: number[], dest: MoveSystemTarget) => void;
movingLines: boolean;
```

- [ ] **Step 1: Notice verb.** In the `moveNotice` state type add `"Lines"` to `verb?: "Moved" | "Copied" | "Loaded"`. In `estimator-banners.tsx` change `moveNotice.ok && moveNotice.verb === "Loaded"` to `moveNotice.ok && (moveNotice.verb === "Loaded" || moveNotice.verb === "Lines")` (detail-only text).

- [ ] **Step 2: Add the two functions** right after `copySystem` in `use-estimator-state.ts` (import the Task 1 functions at the top with the other `@/lib` imports):

```ts
  /** #356: move ticked lines (and their partners) to another system here or a
   *  new one. Client-only — kept by the next Save, like ↑/↓. */
  const moveLinesHere = (selected: number[], target: { kind: "system"; sectionId: string } | { kind: "new"; name: string }) => {
    const resolved = target.kind === "new" ? { kind: "new" as const, id: "sys" + nextId(), name: target.name.trim() || "New System" } : target;
    const { sections: next, plan } = applyLineMove(sections, selected, resolved);
    if (plan.noop) return;
    const targetId = resolved.kind === "new" ? resolved.id : resolved.sectionId;
    const targetName = resolved.kind === "new" ? resolved.name : sections.find((s) => s.id === targetId)?.name || "that system";
    setSections(normalizeSystemOrder(next, groups));
    const n = plan.ids.length;
    setMoveNotice({ ok: true, targetId: "", targetName: "", targetNumber: "", verb: "Lines", detail: `Moved ${n} line${n === 1 ? "" : "s"} to ${targetName}` });
    requestAnimationFrame(() => requestAnimationFrame(() => selectSystem(targetId)));
  };

  /** #356: move ticked lines to another estimate — bundled as one section and
   *  sent through Move system's own server path; they leave this estimate only
   *  once the server confirms. */
  const [movingLines, setMovingLines] = useState(false);
  const moveLinesToEstimate = (selected: number[], dest: MoveSystemTarget) => {
    const plan = planLineMove(sections, selected, { kind: "estimate" });
    if (plan.noop || movingLines) return;
    const outgoing = extractLinesAsSection(sections, plan);
    const usedVqIds = new Set(outgoing.items.map((it) => it.vendorQuoteId).filter((id): id is string => !!id));
    const usedVq = vendorQuotes.filter((v) => usedVqIds.has(v.id));
    const cname = customerId ? customers.find((c) => c.id === customerId)?.name || custName : custName;
    setMoveNotice(null);
    setMovingLines(true);
    startTransition(async () => {
      try {
        const res = await moveSystemToEstimateAction(
          outgoing,
          dest,
          { customerId: customerId || null, locationId: locationId || null, customer: cname, contactName: contactName || "" },
          usedVq,
          loadedId || null
        );
        if (!res.ok) {
          setMoveNotice({ ok: false, error: res.error || "Could not move those lines." });
          return;
        }
        postChanged("quote", res.targetId);
        const gone = new Set(plan.ids);
        const stillUsed = new Set(
          sections.flatMap((s) => s.items).filter((it) => !gone.has(it.id)).map((it) => it.vendorQuoteId).filter((id): id is string => !!id)
        );
        setSections((ss) => removeLinesFromSources(ss, plan.ids));
        if (usedVq.length) setVendorQuotes((vs) => vs.filter((v) => !usedVqIds.has(v.id) || stillUsed.has(v.id)));
        setMoveNotice({ ok: true, targetId: res.targetId, targetName: res.targetName, targetNumber: res.targetNumber });
      } finally {
        setMovingLines(false);
      }
    });
  };
```
If `useState` cannot be declared at this point (hooks must be unconditional and top-level — they are here, but keep with house style), move the `movingLines` state up beside `moveNotice`. Check that `MoveSystemTarget`, `normalizeSystemOrder`, `groups`, `selectSystem`, `startTransition`, `postChanged` are already in scope (they are used by `moveSystem` / `copySystem`); `selectSystem` is declared after `copySystem` — it is a const arrow used inside rAF callbacks at call time, which is fine.

- [ ] **Step 3: Return them.** Add `moveLinesHere, moveLinesToEstimate, movingLines,` to the hook's returned object beside `moveItem`.

- [ ] **Step 4: Gates + commit.**

```bash
npx tsc --noEmit -p . && npx eslint "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/estimator-banners.tsx"
git add -A "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/estimator-banners.tsx"
git commit -m "feat(356): estimator state — move lines here or to another estimate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: UI — per-line checkbox + ⇄, and the Move bar

**Files:**
- Create: `src/app/(app)/estimator/move-lines-bar.tsx`
- Modify: `src/app/(app)/estimator/section-card.tsx` (props ~line 168; line row ~lines 1088–1100 and the action buttons ~1486)
- Modify: `src/app/(app)/estimator/steps/build-step.tsx` (selection state; SectionCard props ~line 529; render the bar inside the scroll container after the systems list)

**Interfaces:**
- Consumes (Task 1): `isMovableLine`, `planLineMove`, `describeLineMove`, `type LineMovePlan`. (Task 2): `moveLinesHere`, `moveLinesToEstimate`, `movingLines`, plus existing `sections`, `groups`, `searchQuotes`.
- New SectionCard props (all optional; rows render as today when absent):
```ts
selectedLines?: ReadonlySet<number>;
onToggleLineSelected?: (itemId: number) => void;
onMoveLine?: (itemId: number) => void;
```
- `MoveLinesBar` props:
```ts
type MoveLinesBarProps = {
  sections: SpecSection[];
  groups: SystemGroup[];
  lineIds: number[];            // what the bar acts on (the ticks, or one row's line)
  single: boolean;              // opened from one row's ⇄ (label shows that line)
  openMenu: boolean;            // start with the menu open (row ⇄)
  moving: boolean;
  onClear: () => void;          // clears ticks (or ends single mode)
  onMoveHere: (target: { kind: "system"; sectionId: string } | { kind: "new"; name: string }) => void;
  onMoveToEstimate: (dest: MoveSystemTarget) => void;
  searchQuotes: (q: string) => Promise<QuoteLite[]>;
};
```

- [ ] **Step 1: SectionCard row.** Add the three optional props to the props type. In the line row, wrap the first cell's current contents so a checkbox sits at its left:

```tsx
<div style={{ minWidth: 0, display: "flex", gap: 8, alignItems: "flex-start" }}>
  {p.onToggleLineSelected && isMovableLine(it) && (
    <input
      type="checkbox"
      checked={!!p.selectedLines?.has(it.id)}
      onChange={() => p.onToggleLineSelected?.(it.id)}
      aria-label={`Select ${it.desc}`}
      title="Select to move"
      style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--accent)" }}
    />
  )}
  <div style={{ minWidth: 0, flex: 1 }}>
    {/* …the cell's existing children, unchanged… */}
  </div>
</div>
```
Beside the ↑ ↓ buttons add (before ↑):

```tsx
{p.onMoveLine && isMovableLine(it) && (
  <button type="button" className="est-action-btn" onClick={() => p.onMoveLine?.(it.id)} title="Move to another system…" aria-label={`Move ${it.desc} to another system`} style={ACTION_BTN}>⇄</button>
)}
```
Import `isMovableLine` from `@/lib/estimate-line-move/move`.

- [ ] **Step 2: `move-lines-bar.tsx`.** A `"use client"` component, sticky at the bottom of the Build scroll area (`position: "sticky", bottom: 12, zIndex: 20`), white card, 1px `#e3e6ec` border, radius 12, shadow, Public Sans 13px — match `est-*` styles in this folder (look at `estimator-styles.ts` / `ACTION_BTN` for the button look; never hardcode the accent, use `var(--accent)`).

States: `"idle" | "menu" | "name" | "estimate" | "confirm"`.
- **idle** (only when `!single`): `"{n} selected"` · button **Move to ▾** · button **Clear**.
- **menu**: a list built from `sections` in their current order, with a small uppercase group heading whenever `groupId` changes (`groups.find(g => g.id === sec.groupId)?.name`, `" · Alternate"` suffix when `alternate`); each system is a button showing its name; disabled (with `title="Already there"`) when every line in `lineIds` is in that system. Then a divider, **New system…** (→ `name`), **Another estimate…** (→ `estimate`), and **Cancel**.
- **name**: text input (autofocus, default `"New System"`, max 120) + **Next** (→ confirm with target `{ kind: "new", name }`) + **Back**.
- **estimate**: search input + debounced (260 ms) `searchQuotes(query)` with a sequence guard, exactly like `section-card.tsx`'s Move picker (lines ~236–261); a **New estimate** button first, then hits as `"{number} · {customer/name}"` buttons; picking one → confirm with dest `{ kind: "new" }` or `{ kind: "existing", quoteId }`. **Back**.
- **confirm**: title — `Move {n} line(s) to {target}?` where target is the system name, `a new system "{name}"`, `a new estimate`, or `{number} · {name}`; under it the strings from `describeLineMove(plan, sections, targetLabel)` as a list (n counts `plan.ids.length`, which includes partners); buttons **Move** (disabled while `moving`, label `Moving…`) and **Cancel**. For a here-move compute `plan = planLineMove(sections, lineIds, {kind:"system", sectionId})` or `{kind:"new", id:"preview", name}`; for an estimate `{kind:"estimate"}`. On **Move**: call `onMoveHere(...)` / `onMoveToEstimate(...)`, then `onClear()` (for an estimate move, clear only after `moving` goes back to false — keep the bar on screen showing `Moving…`).
- Esc closes back to idle (or calls `onClear` in single mode).

- [ ] **Step 3: build-step wiring.**

```tsx
const [selectedLines, setSelectedLines] = useState<Set<number>>(() => new Set());
const [rowMove, setRowMove] = useState<number | null>(null);
const movableIds = useMemo(() => new Set(sections.flatMap((s) => s.items.filter(isMovableLine).map((x) => x.id))), [sections]);
const liveSelected = useMemo(() => [...selectedLines].filter((id) => movableIds.has(id)), [selectedLines, movableIds]);
const toggleLine = (id: number) => setSelectedLines((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
const barIds = rowMove != null && movableIds.has(rowMove) ? [rowMove] : liveSelected;
```
Pass to each `SectionCard`: `selectedLines={selectedLines}`, `onToggleLineSelected={isInternal ? toggleLine : undefined}`, `onMoveLine={isInternal ? setRowMove : undefined}`. (Only staff — `isInternal` — see Build; keep the gate so any non-internal render stays unchanged.)

Render, inside the scrolling column after the "+ Add system" buttons:

```tsx
{barIds.length > 0 && (
  <MoveLinesBar
    key={rowMove != null ? "row-" + rowMove : "ticks"}
    sections={sections}
    groups={groups}
    lineIds={barIds}
    single={rowMove != null}
    openMenu={rowMove != null}
    moving={movingLines}
    onClear={() => { if (rowMove != null) setRowMove(null); else setSelectedLines(new Set()); }}
    onMoveHere={(t) => moveLinesHere(barIds, t)}
    onMoveToEstimate={(d) => moveLinesToEstimate(barIds, d)}
    searchQuotes={searchQuotes}
  />
)}
```
Destructure `moveLinesHere`, `moveLinesToEstimate`, `movingLines`, `groups` from the hook alongside `moveItem`. If `BuildStep` stays mounted when another step tab shows, clear both pieces of selection state in an effect on the current step (check how `steps/` decides what's mounted; if Build unmounts, do nothing).

- [ ] **Step 4: Gates + commit.**

```bash
npx tsc --noEmit -p . && npx eslint "src/app/(app)/estimator/move-lines-bar.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/steps/build-step.tsx"
git add -A "src/app/(app)/estimator"
git commit -m "feat(356): Build — tick lines or ⇄ a line, Move to another system, a new system or another estimate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Full gates, browser pass, docs

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase list)

- [ ] **Step 1: Full gates.** `npx tsc --noEmit -p .`, `npm run test:specs`, `npm run test:smoke`, `npx eslint` on every touched file, `npx next build`. Record pass/fail counts.

- [ ] **Step 2: Browser pass** on a scratch-datadir dev server for this worktree (memories `peak-worktree-dev-server-browser-verification-traps`, `peak-preview-start-reads-main-checkout-launch-json`, `peak-preview-stop-leaves-next-dev-running`): open an estimate with ≥ 3 systems, one with a curtain+track and a typed sell → tick a line in two systems → Move to → existing system: preview lists the linked track + typed price; Move; lines land at the end; Save; reload shows it. Then ⇄ on one line → New system… "Sound" → lands after its source. Then tick → Another estimate… → New estimate → banner "Moved to …" and the lines are gone here. Screenshot each.

- [ ] **Step 3: Docs.** Right before writing, recompute the next free D-number and punch number across `origin/main` and live branches (`git show <ref>:DECISIONS.md | grep -o 'D1[0-9]\{3\}' | sort -u | tail -1`; other sessions held D1187–D1199 and #355 on Oct 16). Add:
  - DECISIONS: one entry per default taken — partners always travel; typed sell cleared on both sides; stars dropped on dup/full; labor-group id re-mint on collision; another-estimate lands as one "(moved)" system through `moveSystemToEstimateAction`; emptied systems kept; selection is staff-only and Build-only.
  - PUNCHLIST: #356 done, with "Remaining: try it on a real estimate in production".
  - AGENTS.md: a short phase-list entry after the last one.

- [ ] **Step 4: Commit.**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs(356): move lines between systems — decisions, punch, phase entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
