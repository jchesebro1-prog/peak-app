/**
 * #357 — move estimator lines between systems. Pure: no React, no server.
 *
 * planLineMove expands the selection with its partners (curtain ↔ track as
 * the cut sheets resolve them; a whole labor group) and lists every side
 * effect; applyLineMove carries the lines byte-for-byte (never re-priced) to
 * the end of the target, moving their labor-group drafts and key-product
 * stars with them and clearing the typed system sell on every system that
 * lost or gained a line. An emptied source is kept.
 *
 * Item ids are unique per SECTION only (Copy/Move system into an existing
 * estimate keeps them — types.ts KeyProduct), so a line is addressed by
 * (sectionId, id) — a LineRef — never by id alone. A moved line keeps its id
 * unless that id is already taken in the target (or by an earlier moving line
 * from another source): then it is re-minted (`opts.mintItemId`) and its
 * key-product star follows (remapKeyProducts).
 */
import type { KeyProduct, LaborGroupRecord, SpecItem, SpecSection } from "@/lib/estimating-core/types";
import { clearSellOverride } from "@/lib/estimating-core/pricing";
import { MAX_KEY_PRODUCTS, isLineToken, remapKeyProducts, withKeyProducts } from "@/lib/estimating-core/narrative";
import { newLaborGroupId, pruneLaborGroups } from "@/lib/estimating-core/labor-group";
import { linkCurtainTracks, newCurtainTrackKey } from "@/lib/curtain-cut-sheets/track-link";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";

/** One line of one system. Ids repeat across systems, so both parts are needed. */
export type LineRef = { sectionId: string; id: number };
/** A LineRef as one string (a Set key): "<sectionId>:<id>". */
export const lineRefKey = (r: LineRef): string => `${r.sectionId}:${r.id}`;
/** The inverse of lineRefKey (the id is after the LAST colon); null when malformed. */
export function parseLineRefKey(key: string): LineRef | null {
  const at = key.lastIndexOf(":");
  if (at <= 0) return null;
  const id = Number(key.slice(at + 1));
  return Number.isFinite(id) ? { sectionId: key.slice(0, at), id } : null;
}

export type LineMoveTarget =
  | { kind: "system"; sectionId: string }
  | { kind: "new"; id: string; name: string }
  | { kind: "estimate" };
export type LineMovePartner = LineRef & { why: "track" | "curtain" | "labor" };
/** A star that will not land: `sectionId`/`id` name its line where it is now. */
export type DroppedStar = LineRef & { why: "full" | "dupSku" };
export type LineMovePlan = {
  lines: LineRef[];
  added: LineMovePartner[];
  sources: string[];
  clearedSell: string[];
  droppedStars: DroppedStar[]; // kinds "system" and "new"
  emptied: string[];
  noop: boolean;
};

/** A line that landed: where it was, and its final system + id (the id changes only on a re-mint). */
export type MovedLine = { from: LineRef; to: LineRef };

export type LineMoveOpts = {
  mintLaborGroupId?: () => string;
  /** A fresh line id (the Estimator's nextId). Default: above every id in `sections`. */
  mintItemId?: () => number;
  /** A fresh curtain ↔ track key for a legacy key-less pair that moves together. */
  mintCurtainTrackKey?: (curtainLineId: number) => string;
};

export function isMovableLine(it: SpecItem): boolean {
  return !isBonusItem(it) && !isRewardCreditItem(it);
}

const keyOf = (sectionId: string, id: number) => lineRefKey({ sectionId, id });

type MovingStar = { kp: KeyProduct; from: LineRef };

/** Target stars after appending `moving` blocks: duplicates (same lineKey or
 *  same non-token sku) and overflow past MAX_KEY_PRODUCTS are dropped. */
function mergeStars(target: KeyProduct[], moving: MovingStar[]): { kept: KeyProduct[]; dropped: DroppedStar[] } {
  const kept = [...target];
  const dropped: DroppedStar[] = [];
  for (const { kp, from } of moving) {
    const dup = kept.some((k) => k.lineKey === kp.lineKey || (!isLineToken(kp.sku) && k.sku === kp.sku));
    if (dup) dropped.push({ ...from, why: "dupSku" });
    else if (kept.length >= MAX_KEY_PRODUCTS) dropped.push({ ...from, why: "full" });
    else kept.push(kp);
  }
  return { kept, dropped };
}

/** A re-mint loop gives up after this many tries — a minter that keeps returning taken ids must never hang the page. */
const MAX_REMINT = 1000;
function remint<T>(taken: ReadonlySet<T>, mint: () => T, what: string): T {
  for (let i = 0; i < MAX_REMINT; i++) {
    const id = mint();
    if (!taken.has(id)) return id;
  }
  throw new Error(`estimate-line-move: could not mint a free ${what} in ${MAX_REMINT} tries`);
}

const renumber = (items: SpecItem[]) => items.map((it, i) => ({ ...it, lineOrder: i }));

/** Above every numeric line id in `sections` (the pure fallback for mintItemId). */
function defaultItemMinter(sections: readonly SpecSection[]): () => number {
  let n = 0;
  for (const s of sections) for (const it of s.items || []) if (typeof it.id === "number" && Number.isFinite(it.id)) n = Math.max(n, Math.floor(it.id));
  return () => ++n;
}

/** Legacy (pre-#292) key-less curtain → track pairs, by object (the cut-sheet resolver's adjacency fallback). */
function legacyPairs(sections: readonly SpecSection[]): Map<SpecItem, SpecItem> {
  const out = new Map<SpecItem, SpecItem>();
  linkCurtainTracks(sections).links.forEach((track, curtain) => {
    if (!curtain.curtainTrackKey && !track.curtainTrackKey) out.set(curtain, track);
  });
  return out;
}

/**
 * Carries the picked lines out of their sources (system order, then line
 * order) as they will land beside `targetItems`:
 * - labor-group ids are tracked per source section (copy-system keeps ids
 *   verbatim, so two sources can both hold "lg1" with different drafts): an id
 *   already taken in the target — a record key OR a target line's laborGroup —
 *   or by an earlier source is re-minted, on that source's moved lines only;
 * - a line id already taken in the target, or by an earlier moving line, is
 *   re-minted; its star follows;
 * - a legacy key-less curtain/track pair gets one fresh shared key, so it
 *   can't re-pair by adjacency where it lands.
 */
function carryLines(
  sections: readonly SpecSection[],
  picked: ReadonlySet<string>,
  target: { items: readonly SpecItem[]; laborGroups: Record<string, LaborGroupRecord> },
  opts: LineMoveOpts
): { items: SpecItem[]; groups: Record<string, LaborGroupRecord>; stars: MovingStar[]; landed: { from: LineRef; id: number }[] } {
  const mintGroup = opts.mintLaborGroupId || (() => newLaborGroupId());
  const mintItem = opts.mintItemId || defaultItemMinter(sections);
  const mintKey = opts.mintCurtainTrackKey || ((id: number) => newCurtainTrackKey(id));
  const groups: Record<string, LaborGroupRecord> = { ...target.laborGroups };
  const takenGroups = new Set(Object.keys(groups));
  for (const it of target.items) if (it.laborGroup) takenGroups.add(it.laborGroup);
  const takenIds = new Set(target.items.map((it) => it.id));
  const pairs = legacyPairs(sections);
  const pairedTrack = new Map<SpecItem, SpecItem>(); // track → curtain, both moving
  const items: SpecItem[] = [];
  const out = new Map<SpecItem, SpecItem>(); // source object → carried object
  const stars: MovingStar[] = [];
  const landed: { from: LineRef; id: number }[] = [];
  for (const s of sections) {
    const mine = s.items.filter((x) => picked.has(keyOf(s.id, x.id)));
    if (!mine.length) continue;
    const rename = new Map<string, string>();
    for (const g of new Set(mine.map((x) => x.laborGroup).filter((g): g is string => !!g))) {
      let id = g;
      if (takenGroups.has(id)) id = remint(takenGroups, mintGroup, "labor group id");
      takenGroups.add(id);
      if (id !== g) rename.set(g, id);
      const rec = s.laborGroups?.[g];
      if (rec) groups[id] = rec;
    }
    const idMap = new Map<number, number>();
    for (const x of mine) {
      let id = x.id;
      if (takenIds.has(id)) id = remint(takenIds, mintItem, "line id");
      takenIds.add(id);
      idMap.set(x.id, id);
      let next: SpecItem = x;
      if (id !== x.id) next = { ...next, id };
      if (x.laborGroup && rename.has(x.laborGroup)) next = { ...next, laborGroup: rename.get(x.laborGroup) };
      out.set(x, next);
      items.push(next);
      landed.push({ from: { sectionId: s.id, id: x.id }, id });
      const track = pairs.get(x);
      if (track && picked.has(keyOf(s.id, track.id))) pairedTrack.set(track, x);
    }
    const remapped = remapKeyProducts(s.keyProducts, idMap) || [];
    const originals = (s.keyProducts || []).filter((k) => idMap.has(Number(k.lineKey)));
    remapped.forEach((kp, i) => stars.push({ kp, from: { sectionId: s.id, id: Number(originals[i].lineKey) } }));
  }
  // Legacy pairs that moved together: one fresh key on both (named after the curtain's landing id).
  if (pairedTrack.size) {
    const stamp = new Map<SpecItem, string>();
    pairedTrack.forEach((curtain, track) => {
      const c = out.get(curtain)!, t = out.get(track)!;
      const key = mintKey(c.id);
      stamp.set(c, key);
      stamp.set(t, key);
    });
    for (let i = 0; i < items.length; i++) {
      const key = stamp.get(items[i]);
      if (key) items[i] = { ...items[i], curtainTrackKey: key };
    }
  }
  return { items, groups, stars, landed };
}

export function planLineMove(sections: readonly SpecSection[], selected: Iterable<LineRef>, target: LineMoveTarget): LineMovePlan {
  const targetId = target.kind === "system" ? target.sectionId : null;
  const emptyPlan: LineMovePlan = { lines: [], added: [], sources: [], clearedSell: [], droppedStars: [], emptied: [], noop: true };
  // A target that does not exist (or a "new" id already taken) would drop the lines on the floor.
  if (target.kind === "system" && !sections.some((x) => x.id === target.sectionId)) return emptyPlan;
  if (target.kind === "new" && sections.some((x) => x.id === target.id)) return emptyPlan;
  const where = new Map<string, { si: number; item: SpecItem }>();
  const refOf = new Map<SpecItem, LineRef>();
  sections.forEach((s, si) =>
    s.items.forEach((item) => {
      where.set(keyOf(s.id, item.id), { si, item });
      refOf.set(item, { sectionId: s.id, id: item.id });
    })
  );

  // Partner map from the cut-sheet resolver (both directions), by object → LineRef.
  const { links } = linkCurtainTracks(sections);
  const partnerOf = new Map<string, LineMovePartner>();
  links.forEach((track, curtain) => {
    const c = refOf.get(curtain), t = refOf.get(track);
    if (!c || !t) return;
    partnerOf.set(lineRefKey(c), { ...t, why: "track" });
    partnerOf.set(lineRefKey(t), { ...c, why: "curtain" });
  });

  const picked = new Set<string>();
  const added: LineMovePartner[] = [];
  const queue: string[] = [];
  const eligible = (k: string) => {
    const w = where.get(k);
    return !!w && isMovableLine(w.item) && !(targetId && sections[w.si].id === targetId);
  };
  for (const ref of selected) {
    const k = lineRefKey(ref);
    if (!eligible(k) || picked.has(k)) continue;
    picked.add(k);
    queue.push(k);
  }
  const pull = (p: LineMovePartner) => {
    const k = lineRefKey(p);
    if (picked.has(k) || !eligible(k)) return;
    picked.add(k);
    added.push(p);
    queue.push(k);
  };
  while (queue.length) {
    const k = queue.shift() as string;
    const { si, item } = where.get(k)!;
    const partner = partnerOf.get(k);
    if (partner) pull(partner);
    // Labor partners stay within the same section.
    if (item.laborGroup) for (const x of sections[si].items) if (x.laborGroup === item.laborGroup) pull({ sectionId: sections[si].id, id: x.id, why: "labor" });
  }

  const lines: LineRef[] = [];
  const sources: string[] = [];
  sections.forEach((s) => {
    const mine = s.items.filter((x) => picked.has(keyOf(s.id, x.id))).map((x) => ({ sectionId: s.id, id: x.id }));
    if (mine.length) { lines.push(...mine); sources.push(s.id); }
  });
  const noop = lines.length === 0;

  const touched = new Set(sources);
  if (targetId && !noop) touched.add(targetId);
  const clearedSell = sections.filter((s) => touched.has(s.id) && "sellOverride" in s).map((s) => s.id);

  let droppedStars: DroppedStar[] = [];
  if (target.kind !== "estimate" && !noop) {
    const tgt = targetId ? sections.find((s) => s.id === targetId) : undefined;
    // The same landing applyLineMove does. Preview minters only need to be fresh, not final — but each must be
    // UNIQUE per call (a constant would spin the re-mint loop: two colliding groups both want a new id).
    let g = 0;
    const { stars } = carryLines(sections, picked, { items: tgt?.items || [], laborGroups: tgt?.laborGroups || {} }, {
      mintLaborGroupId: () => "\u0000preview" + ++g,
      // default item minter: above every id in `sections`, counting up
      mintCurtainTrackKey: () => "", // not re-minted in a loop; the preview never reads the key
    });
    droppedStars = mergeStars(tgt?.keyProducts || [], stars).dropped;
  }

  const emptied = sources.filter((sid) => {
    const s = sections.find((x) => x.id === sid)!;
    return !s.items.some((x) => !picked.has(keyOf(s.id, x.id)) && isMovableLine(x));
  });

  return { lines, added, sources, clearedSell, droppedStars, emptied, noop };
}

/** The source side of a move: the lines leave, their drafts and stars go with
 *  them, the typed sell clears, lineOrder renumbers. Untouched sections are
 *  returned as the same objects. */
export function removeLinesFromSources(sections: readonly SpecSection[], lines: readonly LineRef[]): SpecSection[] {
  const gone = new Map<string, Set<number>>();
  for (const r of lines) {
    const set = gone.get(r.sectionId) || new Set<number>();
    set.add(r.id);
    gone.set(r.sectionId, set);
  }
  return sections.map((s) => {
    const mine = gone.get(s.id);
    if (!mine || !s.items.some((x) => mine.has(x.id))) return s;
    let next: SpecSection = clearSellOverride({ ...s, items: renumber(s.items.filter((x) => !mine.has(x.id))) });
    next = pruneLaborGroups(next);
    next = withKeyProducts(next, (s.keyProducts || []).filter((k) => !mine.has(Number(k.lineKey))));
    return next;
  });
}

/** Moves the lines to the end of the target (an existing system or a new one
 *  inserted right after the first source). Returns the new list, the plan it
 *  applied and every landed line's from → to (for reanchorPackageDoc). A
 *  no-op plan returns `sections` unchanged. */
export function applyLineMove(
  sections: readonly SpecSection[],
  selected: Iterable<LineRef>,
  target: Exclude<LineMoveTarget, { kind: "estimate" }>,
  opts: LineMoveOpts = {}
): { sections: SpecSection[]; plan: LineMovePlan; moved: MovedLine[] } {
  const plan = planLineMove(sections, selected, target);
  if (plan.noop) return { sections: sections.slice(), plan, moved: [] };
  const picked = new Set(plan.lines.map(lineRefKey));
  const mintItemId = opts.mintItemId || defaultItemMinter(sections);

  let list = removeLinesFromSources(sections, plan.lines);

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

  const moved: MovedLine[] = [];
  list = list.map((s) => {
    if (s.id !== targetId) return s;
    const { items, groups, stars, landed } = carryLines(sections, picked, { items: s.items, laborGroups: s.laborGroups || {} }, { ...opts, mintItemId });
    for (const l of landed) moved.push({ from: l.from, to: { sectionId: targetId, id: l.id } });
    let next: SpecSection = clearSellOverride({ ...s, items: renumber([...s.items, ...items]) });
    if (Object.keys(groups).length) next = { ...next, laborGroups: groups };
    next = withKeyProducts(next, mergeStars(s.keyProducts || [], stars).kept);
    return next;
  });
  return { sections: list, plan, moved };
}

/** The lines of an estimate-bound plan as ONE section shaped like the first
 *  source (for moveSystemToEstimateAction, which names it "<name> (moved)"
 *  and re-ids any line that collides in an existing target). Ids repeated
 *  across sources are de-duplicated here (opts.mintItemId). No typed sell,
 *  group, built, alternate, goals or cover. */
export function extractLinesAsSection(sections: readonly SpecSection[], plan: LineMovePlan, opts: LineMoveOpts = {}): SpecSection {
  const picked = new Set(plan.lines.map(lineRefKey));
  const first = sections.find((s) => s.id === plan.sources[0]) || sections[0];
  const carried = carryLines(sections, picked, { items: [], laborGroups: {} }, opts);
  const items = renumber(carried.items);
  const groups = carried.groups;
  const stars = mergeStars([], carried.stars).kept;
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
