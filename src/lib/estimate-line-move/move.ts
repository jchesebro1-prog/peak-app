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
