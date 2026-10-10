/**
 * Conduit riser (#321) — deterministic auto-layout of one detail, Bray's
 * look: level bands top to bottom, the head end leftmost on its level with
 * its home runs leaving as a bundle of parallel vertical lanes, everything
 * else in hop order from the head end left to right, chains side by side.
 * Pinned tags/stubs keep their stored positions; auto items step around
 * them. Same input → same output, always. Sheet inches, y down. Pure.
 */

import { UNLEVELLED_ID, type ViewDetail, type ViewEnd } from "./derive";
import type { ConduitRiserDoc, Pt } from "./model";

export const TAG_W = 1.0;
export const TAG_HEAD = 0.16;
export const TAG_MID = 0.15;
export const TAG_FOOT = 0.14;
export const TAG_H = TAG_HEAD + TAG_MID + TAG_FOOT;
export const STUB_W = 0.7;
export const STUB_H = 0.2;
const GAP_X = 0.4;
const ROW_GAP = 0.5;
const PAD_TOP = 0.55;
const PAD_BOTTOM = 0.3;
export const MARGIN = 0.4;
const LANE = 0.07;
const TRUNK = 0.3;
/** Target edge → its first bus: room for the bubbles and size label. */
const BUS_GAP = 0.38;
/** Widest a band row grows before wrapping, inches. */
const MAX_ROW_W = 18;

export type Rect = { x: number; y: number; w: number; h: number };
export type LaidItem = { kind: "tag" | "stub" | "ref"; key: string; id: string; rect: Rect; pinned: boolean; label?: string };
export type LaidRun = {
  runId: string;
  path: Pt[];
  dashed: boolean;
  size: string;
  sizeAt: Pt;
  /** Straight hops centre their size label; drops write it beside the line. */
  sizeAnchor: "start" | "middle";
  bubbles: { c: Pt; symbol: string }[];
  empty: boolean;
};
export type LaidLevel = { id: string; label: string; elevation?: string; y: number; x1: number; x2: number };
export type DetailLayout = { detailId: string; w: number; h: number; items: LaidItem[]; runs: LaidRun[]; levels: LaidLevel[] };

const r4 = (v: number) => Math.round(v * 10000) / 10000;
export const endKey = (e: ViewEnd) => (e.kind === "tag" ? `tag:${e.id}` : e.kind === "stub" ? `stub:${e.id}` : `ref:${e.key}`);
const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const overlaps = (a: Rect, b: Rect, pad = 0.05) =>
  a.x < right(b) + pad && right(a) + pad > b.x && a.y < bottom(b) + pad && bottom(a) + pad > b.y;
/** The y a run meets an item at: a tag's location row, a stub's middle. */
export const runY = (it: LaidItem) => (it.kind === "tag" ? it.rect.y + TAG_HEAD + TAG_MID / 2 : it.rect.y + it.rect.h / 2);

type Pending = { kind: LaidItem["kind"]; key: string; id: string; label: string; w: number; h: number; level: string; pinned?: Rect };

export function layoutDetail(d: ViewDetail, doc: ConduitRiserDoc): DetailLayout {
  const detailId = d.detail.id;
  const levelIds = new Set(d.levels.map((l) => l.id));

  // 1. Items with their level.
  const pending = new Map<string, Pending>();
  for (const t of d.tags) {
    const pos = doc.tags[t.device.id];
    const pinned = pos && pos.detailId === detailId ? { x: pos.x, y: pos.y, w: TAG_W, h: TAG_H } : undefined;
    const level = t.device.levelId && levelIds.has(t.device.levelId) ? t.device.levelId : UNLEVELLED_ID;
    pending.set(`tag:${t.device.id}`, { kind: "tag", key: `tag:${t.device.id}`, id: t.device.id, label: t.device.label, w: TAG_W, h: TAG_H, level, pinned });
  }
  for (const s of d.stubs) {
    const pinned = s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y, w: STUB_W, h: STUB_H } : undefined;
    pending.set(`stub:${s.id}`, { kind: "stub", key: `stub:${s.id}`, id: s.id, label: s.label, w: STUB_W, h: STUB_H, level: UNLEVELLED_ID, pinned });
  }
  for (const r of d.runs) {
    for (const e of [r.a, r.b]) {
      if (e.kind !== "ref") continue;
      const k = endKey(e);
      if (!pending.has(k)) pending.set(k, { kind: "ref", key: k, id: e.key, label: e.label, w: STUB_W, h: STUB_H, level: UNLEVELLED_ID });
    }
  }
  // Stubs and refs sit on the level of the tag at their run's other end.
  for (const r of d.runs) {
    const [x, y] = [pending.get(endKey(r.a)), pending.get(endKey(r.b))];
    if (!x || !y) continue;
    if (x.kind !== "tag" && x.level === UNLEVELLED_ID && y.kind === "tag") x.level = y.level;
    if (y.kind !== "tag" && y.level === UNLEVELLED_ID && x.kind === "tag") y.level = x.level;
  }

  // 2. Hop order from the head end (BFS, neighbours by label), then the rest.
  const adj = new Map<string, string[]>();
  for (const r of d.runs) {
    const [a, b] = [endKey(r.a), endKey(r.b)];
    adj.set(a, [...(adj.get(a) || []), b]);
    adj.set(b, [...(adj.get(b) || []), a]);
  }
  const labelOf = (k: string) => pending.get(k)?.label ?? k;
  const cmp = (a: string, b: string) => labelOf(a).localeCompare(labelOf(b), "en", { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
  const order = new Map<string, number>();
  const headKey = d.headEndId ? `tag:${d.headEndId}` : null;
  const visit = (start: string) => {
    if (order.has(start)) return;
    order.set(start, order.size);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of [...(adj.get(cur) || [])].sort(cmp)) {
        if (order.has(n)) continue;
        order.set(n, order.size);
        queue.push(n);
      }
    }
  };
  if (headKey && pending.has(headKey)) visit(headKey);
  for (const k of [...pending.keys()].sort(cmp)) visit(k);

  // 3. Bands top to bottom.
  const bands = [...d.levels.map((l) => l.id)];
  if ([...pending.values()].some((p) => p.level === UNLEVELLED_ID)) bands.push(UNLEVELLED_ID);
  const headRuns = headKey ? d.runs.filter((r) => endKey(r.a) === headKey) : [];
  const trunkReserve = headKey ? TAG_W + TRUNK + headRuns.length * LANE + 0.3 : 0;
  const pinnedRects = [...pending.values()].filter((p) => p.pinned).map((p) => p.pinned!);
  // Room for the buses that turn beside a band's rows: one lane per run that
  // ends in the band (an upper bound), so a bus never runs through a tag.
  const into = new Map<string, number>();
  for (const r of d.runs) {
    const b = pending.get(endKey(r.b));
    if (b) into.set(b.level, (into.get(b.level) || 0) + 1);
  }
  const clearance = (band: string) => BUS_GAP + (into.get(band) || 0) * LANE + 0.15;
  const placed = new Map<string, LaidItem>();
  const levels: LaidLevel[] = [];
  let cursor = MARGIN;
  for (const band of bands) {
    const items = [...pending.values()].filter((p) => p.level === band && !p.pinned).sort((a, b) => order.get(a.key)! - order.get(b.key)!);
    // Lay rows relative to the band top (0), then shift once the line is known.
    const rel: { p: Pending; x: number; row: number }[] = [];
    let row = 0;
    let x = MARGIN;
    if (headKey && items[0]?.key === headKey) {
      rel.push({ p: items.shift()!, x: MARGIN, row: 0 });
      x = MARGIN + trunkReserve;
    } else if (headKey) x = MARGIN + trunkReserve;
    const rowStart = x;
    for (const p of items) {
      if (x + p.w > rowStart + MAX_ROW_W && x > rowStart) {
        row++;
        x = rowStart;
      }
      rel.push({ p, x, row });
      x += p.w + GAP_X;
    }
    const rows = rel.length ? Math.max(...rel.map((r) => r.row)) + 1 : 1;
    const c = clearance(band);
    const padTop = Math.max(PAD_TOP, c);
    const rowGap = Math.max(ROW_GAP, c);
    const bandH = padTop + rows * TAG_H + (rows - 1) * rowGap + Math.max(PAD_BOTTOM, c);
    const stored = band !== UNLEVELLED_ID ? doc.levelY[detailId]?.[band] : undefined;
    const lineY = stored ?? cursor + bandH;
    const top = lineY - bandH;
    for (const { p, x: rx, row: rr } of rel) {
      const rowY = top + padTop + rr * (TAG_H + rowGap);
      // A stub's middle lines up with a tag's location row, so a hop between them is level.
      let rect: Rect = { x: rx, y: p.kind === "tag" ? rowY : rowY + TAG_HEAD + TAG_MID / 2 - p.h / 2, w: p.w, h: p.h };
      // Step around pinned items (and anything already placed).
      let guard = 0;
      while ((pinnedRects.some((q) => overlaps(rect, q)) || [...placed.values()].some((q) => overlaps(rect, q.rect))) && guard++ < 500) {
        rect = { ...rect, x: rect.x + TAG_W + GAP_X };
      }
      placed.set(p.key, { kind: p.kind, key: p.key, id: p.id, rect: { x: r4(rect.x), y: r4(rect.y), w: p.w, h: p.h }, pinned: false, label: p.kind === "tag" ? undefined : p.label });
    }
    if (band !== UNLEVELLED_ID) {
      const lv = d.levels.find((l) => l.id === band)!;
      levels.push({ id: band, label: lv.label, elevation: lv.elevation, y: r4(lineY), x1: 0, x2: 0 });
    }
    cursor = Math.max(cursor, lineY);
  }
  for (const p of pending.values()) {
    if (p.pinned) placed.set(p.key, { kind: p.kind, key: p.key, id: p.id, rect: { ...p.pinned }, pinned: true, label: p.kind === "tag" ? undefined : p.label });
  }

  // 4. Runs, orthogonal — Bray's look. A run to the next item in the same
  //    row is a straight hop; every other run leaves along a vertical lane
  //    (the head end's lanes form a bundle beside it), turns along a short
  //    bus beside the target's row and drops square into the target. Lanes
  //    and buses are ordered so a bundle's lines don't cross each other.
  const all = [...placed.values()];
  const between = (A: LaidItem, B: LaidItem) => {
    const y = runY(A);
    const [lo, hi] = A.rect.x < B.rect.x ? [right(A.rect), B.rect.x] : [right(B.rect), A.rect.x];
    return all.some((it) => it !== A && it !== B && Math.abs(runY(it) - y) < 0.02 && it.rect.x < hi && right(it.rect) > lo);
  };
  type Plan = { r: ViewDetail["runs"][number]; A: LaidItem; B: LaidItem; straight: boolean; up: boolean };
  const plans: Plan[] = [];
  for (const r of d.runs) {
    const A = placed.get(endKey(r.a));
    const B = placed.get(endKey(r.b));
    if (!A || !B) continue;
    const sameRow = Math.abs(runY(A) - runY(B)) < 0.02;
    plans.push({ r, A, B, straight: sameRow && !between(A, B) && r.run.laneX === undefined, up: runY(B) < runY(A) - 0.02 });
  }
  // Bus slot per target row: the nearest target gets the bus closest to the row.
  const rowKey = (p: Plan) => `${p.up ? "u" : "d"}:${Math.round(runY(p.B) * 100)}`;
  const groups = new Map<string, Plan[]>();
  for (const p of plans) if (!p.straight) groups.set(rowKey(p), [...(groups.get(rowKey(p)) || []), p]);
  const busSlot = new Map<string, number>();
  for (const g of groups.values()) {
    g.sort((x, y) => Math.abs(x.B.rect.x - x.A.rect.x) - Math.abs(y.B.rect.x - y.A.rect.x) || x.r.run.id.localeCompare(y.r.run.id));
    g.forEach((p, i) => busSlot.set(p.r.run.id, i));
  }
  // Head-end lanes, left to right: the farthest rows first, nearest target first within a row.
  const rank = (p: Plan) => (p.up ? runY(p.B) : 1e6 - runY(p.B));
  const laneIndex = new Map(
    plans
      .filter((p) => !p.straight && p.A.key === headKey)
      .sort((x, y) => rank(x) - rank(y) || busSlot.get(x.r.run.id)! - busSlot.get(y.r.run.id)! || x.r.run.id.localeCompare(y.r.run.id))
      .map((p, i) => [p.r.run.id, i] as const)
  );
  const runs: LaidRun[] = [];
  for (const { r, A, B, straight, up } of plans) {
    const ya = runY(A);
    // Bubbles off (A/V default): none drawn, "?" included.
    const symbols = doc.showSignals === false ? [] : [...r.signals.map((s) => s.symbol), ...(r.unknownCables.length ? ["?"] : [])];
    let path: Pt[];
    let sizeAt: Pt;
    let sizeAnchor: "start" | "middle" = "start";
    let bubbles: { c: Pt; symbol: string }[];
    if (straight) {
      const rightward = B.rect.x >= A.rect.x;
      const end = rightward ? B.rect.x : right(B.rect);
      path = rightward ? [{ x: right(A.rect), y: ya }, { x: end, y: ya }] : [{ x: A.rect.x, y: ya }, { x: end, y: ya }];
      // Centred over the open part of the hop — past the head end's lane
      // bundle — and lifted above the tags when the bubbles don't fit.
      const lanesEnd = A.key === headKey && rightward ? right(A.rect) + TRUNK * 0.5 + laneIndex.size * LANE + 0.05 : path[0].x;
      const from = rightward ? Math.max(path[0].x, Math.min(lanesEnd, end - 0.2)) : path[0].x;
      const mid = (from + end) / 2;
      sizeAt = { x: mid, y: ya + 0.08 };
      sizeAnchor = "middle";
      const fits = symbols.length * 0.17 <= Math.abs(end - from) - 0.06;
      const by = fits ? ya - 0.13 : Math.min(A.rect.y, B.rect.y) - 0.1;
      bubbles = symbols.map((symbol, i) => ({ c: { x: mid - (symbols.length - 1) * 0.085 + i * 0.17, y: by }, symbol }));
    } else {
      const slot = busSlot.get(r.run.id) || 0;
      const dropX = B.rect.x + B.rect.w / 2;
      let lane: number;
      if (r.run.laneX !== undefined) lane = r.run.laneX;
      else if (laneIndex.has(r.run.id)) lane = right(A.rect) + TRUNK * 0.5 + laneIndex.get(r.run.id)! * LANE;
      else if (dropX >= A.rect.x + A.rect.w / 2) lane = right(A.rect) + 0.2;
      else lane = A.rect.x - 0.2;
      const start: Pt =
        lane >= right(A.rect) ? { x: right(A.rect), y: ya } : lane <= A.rect.x ? { x: A.rect.x, y: ya } : { x: lane, y: up ? A.rect.y : bottom(A.rect) };
      const busY = up ? bottom(B.rect) + BUS_GAP + slot * LANE : B.rect.y - BUS_GAP - slot * LANE;
      const end: Pt = { x: dropX, y: up ? bottom(B.rect) : B.rect.y };
      path = [start, { x: lane, y: start.y }, { x: lane, y: busY }, { x: dropX, y: busY }, end];
      // In the gap between the target and its buses: size right of the drop,
      // signal bubbles left of it.
      const gapY = up ? bottom(B.rect) + 0.15 : B.rect.y - 0.15;
      sizeAt = { x: dropX + 0.05, y: gapY };
      bubbles = symbols.map((symbol, i) => ({ c: { x: dropX - 0.13 - i * 0.17, y: gapY }, symbol }));
    }
    path = path
      .map((p) => ({ x: r4(p.x), y: r4(p.y) }))
      .filter((p, i, list) => i === 0 || p.x !== list[i - 1].x || p.y !== list[i - 1].y);
    if (path.length < 2) path = [path[0], { x: r4(path[0].x + 0.01), y: path[0].y }];
    runs.push({
      runId: r.run.id,
      path,
      dashed: r.run.style === "cableMgmt",
      size: r.run.size,
      sizeAt: { x: r4(sizeAt.x), y: r4(sizeAt.y) },
      sizeAnchor,
      bubbles: bubbles.map((b) => ({ c: { x: r4(b.c.x), y: r4(b.c.y) }, symbol: b.symbol })),
      empty: r.empty,
    });
  }

  // 5. Extents.
  const rects = [...placed.values()].map((p) => p.rect);
  const pts = runs.flatMap((r) => r.path);
  const maxX = Math.max(MARGIN + TAG_W, ...rects.map(right), ...pts.map((p) => p.x));
  const maxY = Math.max(cursor, ...rects.map(bottom), ...pts.map((p) => p.y), ...levels.map((l) => l.y));
  const w = r4(maxX + MARGIN);
  for (const l of levels) {
    l.x1 = r4(MARGIN * 0.25);
    l.x2 = r4(w - MARGIN * 0.25);
  }
  const items = [...placed.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { detailId, w, h: r4(maxY + MARGIN), items, runs, levels };
}
