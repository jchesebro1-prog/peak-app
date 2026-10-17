/* Pure ink model (#344 C1) — Apple-Pencil sketch pads and photo markup.
   No DOM globals at import time; `renderInk` takes a canvas-like context typed structurally.
   Docs are immutable: every edit returns a new doc (or the same doc when nothing changed). */

export type Stroke = { id: string; tool: "pen"; color: string; width: number; /** flat [x, y, p, …] */ pts: number[] };
export type InkLabel = { id: string; x: number; y: number; text: string; color: string; size: number };
export type InkDoc = { v: 1; w: number; h: number; strokes: Stroke[]; labels: InkLabel[] };

export const INK_COLORS = ["#16181d", "#c0392b", "#1f5f9a"] as const;
export const INK_CAPS = { strokes: 5000, numbers: 400_000, labels: 200, labelChars: 120 } as const;

export const INK_LIMITS = { size: [1, 16384], width: [0.5, 64], labelSize: [4, 200] } as const;

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Short base-36 id; works in the browser and Node. */
export function inkId(): string {
  const a = new Uint32Array(2);
  globalThis.crypto.getRandomValues(a);
  return (a[0].toString(36) + a[1].toString(36)).padStart(8, "0").slice(0, 10);
}

const r05 = (v: number) => Math.round(v * 2) / 2;
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Clamp into [lo, hi] and round to 2 decimals; a non-number or non-finite value gives `def`. */
function clampNum(v: unknown, lo: number, hi: number, def: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return def;
  return r2(v < lo ? lo : v > hi ? hi : v);
}
/** First 120 code points (never splits a surrogate pair). The pre-slice only bounds the work. */
function clipLabel(text: string): string {
  return Array.from(text.slice(0, INK_CAPS.labelChars * 2)).slice(0, INK_CAPS.labelChars).join("");
}

export function emptyInk(w: number, h: number): InkDoc {
  const [lo, hi] = INK_LIMITS.size;
  return { v: 1, w: clampNum(w, lo, hi, 1024), h: clampNum(h, lo, hi, 1024), strokes: [], labels: [] };
}

/** Quantise a flat [x, y, p…] array: x/y to 0.5, p to 2 decimals in [0,1]. Null when malformed. */
function normPts(pts: unknown): number[] | null {
  if (!Array.isArray(pts) || pts.length < 3 || pts.length % 3 !== 0) return null;
  const out: number[] = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], p = pts[i + 2];
    if (typeof x !== "number" || typeof y !== "number" || typeof p !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p)) return null;
    out[i] = r05(x);
    out[i + 1] = r05(y);
    out[i + 2] = r2(clamp01(p));
  }
  return out;
}

function numbersIn(doc: InkDoc): number {
  let n = 0;
  for (const s of doc.strokes) n += s.pts.length;
  return n;
}

/** Ramer–Douglas–Peucker over x/y; keeps endpoints and each kept point's pressure. */
export function simplify(pts: number[], tolerance = 0.4): number[] {
  const n = Math.floor(pts.length / 3);
  if (n <= 2) return pts.slice(0, n * 3);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b <= a + 1) continue;
    const ax = pts[a * 3], ay = pts[a * 3 + 1], bx = pts[b * 3], by = pts[b * 3 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 3], py = pts[i * 3 + 1];
      let d: number;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(len2);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  return out;
}

export function addStroke(doc: InkDoc, stroke: Stroke): InkDoc {
  const pts = normPts(stroke.pts);
  if (!pts) return doc;
  if (doc.strokes.length >= INK_CAPS.strokes) return doc;
  if (numbersIn(doc) + pts.length > INK_CAPS.numbers) return doc;
  const color = HEX_COLOR.test(stroke.color) ? stroke.color : INK_COLORS[0];
  return { ...doc, strokes: [...doc.strokes, { id: stroke.id, tool: "pen", color, width: clampNum(stroke.width, INK_LIMITS.width[0], INK_LIMITS.width[1], 2), pts }] };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function strokeHit(s: Stroke, x: number, y: number, radius: number): boolean {
  const p = s.pts;
  if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= radius;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= radius) return true;
  }
  return false;
}

/** Remove strokes with any segment within `radius` of (x, y). Same doc back when nothing is hit. */
export function eraseAt(doc: InkDoc, x: number, y: number, radius: number): InkDoc {
  const kept = doc.strokes.filter((s) => !strokeHit(s, x, y, radius));
  return kept.length === doc.strokes.length ? doc : { ...doc, strokes: kept };
}

export function addLabel(doc: InkDoc, label: InkLabel): InkDoc {
  const text = clipLabel(String(label.text ?? ""));
  if (!text.trim() || doc.labels.length >= INK_CAPS.labels) return doc;
  if (![label.x, label.y].every((n) => Number.isFinite(n))) return doc;
  const color = HEX_COLOR.test(label.color) ? label.color : INK_COLORS[0];
  return { ...doc, labels: [...doc.labels, { id: label.id, x: r05(label.x), y: r05(label.y), text, color, size: clampNum(label.size, INK_LIMITS.labelSize[0], INK_LIMITS.labelSize[1], 16) }] };
}

export function moveLabel(doc: InkDoc, id: string, x: number, y: number): InkDoc {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return doc;
  const i = doc.labels.findIndex((l) => l.id === id);
  if (i < 0) return doc;
  const nx = r05(x), ny = r05(y);
  if (doc.labels[i].x === nx && doc.labels[i].y === ny) return doc;
  const labels = doc.labels.slice();
  labels[i] = { ...labels[i], x: nx, y: ny };
  return { ...doc, labels };
}

export function removeLabel(doc: InkDoc, id: string): InkDoc {
  const labels = doc.labels.filter((l) => l.id !== id);
  return labels.length === doc.labels.length ? doc : { ...doc, labels };
}

export function clearInk(doc: InkDoc): InkDoc {
  return doc.strokes.length || doc.labels.length ? { ...doc, strokes: [], labels: [] } : doc;
}

/** Which cap refuses the next stroke (`pts` numbers) or label, or null when it fits. */
export function inkCapHit(doc: InkDoc, add: { pts?: number; label?: boolean }): "strokes" | "numbers" | "labels" | null {
  if (add.label) return doc.labels.length >= INK_CAPS.labels ? "labels" : null;
  if (doc.strokes.length >= INK_CAPS.strokes) return "strokes";
  return numbersIn(doc) + (add.pts ?? 0) > INK_CAPS.numbers ? "numbers" : null;
}

/** Rescale a doc saved at other dims onto a w × h background: each axis apart, widths and
    label sizes by the geometric mean. Same doc back when the (clamped) dims already match. */
export function fitInkTo(doc: InkDoc, w: number, h: number): InkDoc {
  const t = emptyInk(w, h);
  if (doc.w === t.w && doc.h === t.h) return doc;
  const kx = doc.w > 0 ? t.w / doc.w : 1, ky = doc.h > 0 ? t.h / doc.h : 1, k = Math.sqrt(kx * ky);
  const strokes = doc.strokes.map((s) => {
    const pts = s.pts.slice();
    for (let i = 0; i + 1 < pts.length; i += 3) { pts[i] = r05(pts[i] * kx); pts[i + 1] = r05(pts[i + 1] * ky); }
    return { ...s, pts, width: clampNum(s.width * k, INK_LIMITS.width[0], INK_LIMITS.width[1], 2) };
  });
  const labels = doc.labels.map((l) => ({ ...l, x: r05(l.x * kx), y: r05(l.y * ky), size: clampNum(l.size * k, INK_LIMITS.labelSize[0], INK_LIMITS.labelSize[1], 16) }));
  return { ...t, strokes, labels };
}

export type InkOp =
  | { t: "stroke"; stroke: Stroke }
  | { t: "erase"; x: number; y: number; radius: number }
  | { t: "label"; label: InkLabel }
  | { t: "move"; id: string; x: number; y: number }
  | { t: "unlabel"; id: string }
  | { t: "clear" }
  /** Swap in a whole doc derived from the current one (e.g. a drag-erase) — one undo step. */
  | { t: "replace"; doc: InkDoc };

export function applyOp(doc: InkDoc, op: InkOp): InkDoc {
  switch (op.t) {
    case "stroke": return addStroke(doc, op.stroke);
    case "erase": return eraseAt(doc, op.x, op.y, op.radius);
    case "label": return addLabel(doc, op.label);
    case "move": return moveLabel(doc, op.id, op.x, op.y);
    case "unlabel": return removeLabel(doc, op.id);
    case "clear": return clearInk(doc);
    case "replace": return op.doc;
  }
}

export type InkHistory = {
  readonly current: InkDoc;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Apply an op; a no-op (same doc back) leaves history untouched. Returns the current doc. */
  do(op: InkOp): InkDoc;
  undo(): InkDoc;
  redo(): InkDoc;
};

/** Snapshot-based undo/redo (docs are immutable, so snapshots share structure). */
export function createHistory(doc: InkDoc, cap = 200): InkHistory {
  cap = Number.isFinite(cap) ? Math.max(1, Math.floor(cap)) : 200;
  let cur = doc;
  let past: InkDoc[] = [];
  let future: InkDoc[] = [];
  return {
    get current() { return cur; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    do(op) {
      const next = applyOp(cur, op);
      if (next === cur) return cur;
      past.push(cur);
      if (past.length > cap) past = past.slice(past.length - cap);
      future = [];
      cur = next;
      return cur;
    },
    undo() {
      const prev = past.pop();
      if (prev) { future.push(cur); cur = prev; }
      return cur;
    },
    redo() {
      const next = future.pop();
      if (next) { past.push(cur); cur = next; }
      return cur;
    },
  };
}

export function serializeInk(doc: InkDoc): string {
  return JSON.stringify(doc);
}

/** Validate shape and caps; drops bad strokes/labels. Null for a non-object, non-JSON or size-less doc. */
export function parseInk(json: unknown): InkDoc | null {
  let raw: unknown = json;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== undefined && o.v !== 1) return null;
  const rw = o.w, rh = o.h;
  if (typeof rw !== "number" || typeof rh !== "number" || !(rw > 0) || !(rh > 0) || !Number.isFinite(rw) || !Number.isFinite(rh)) return null;
  const w = clampNum(rw, INK_LIMITS.size[0], INK_LIMITS.size[1], 1024);
  const h = clampNum(rh, INK_LIMITS.size[0], INK_LIMITS.size[1], 1024);
  const strokeIds = new Set<string>();
  const labelIds = new Set<string>();
  const strokes: Stroke[] = [];
  let numbers = 0;
  if (Array.isArray(o.strokes)) {
    for (const s of o.strokes) {
      if (strokes.length >= INK_CAPS.strokes) break;
      if (!s || typeof s !== "object") continue;
      const r = s as Record<string, unknown>;
      if (Array.isArray(r.pts) && r.pts.length > INK_CAPS.numbers - numbers) continue;
      const pts = normPts(r.pts);
      if (!pts || typeof r.id !== "string" || !r.id || strokeIds.has(r.id)) continue;
      if (typeof r.width !== "number") continue;
      strokeIds.add(r.id);
      numbers += pts.length;
      const color = typeof r.color === "string" && HEX_COLOR.test(r.color) ? r.color : INK_COLORS[0];
      strokes.push({ id: r.id, tool: "pen", color, width: clampNum(r.width, INK_LIMITS.width[0], INK_LIMITS.width[1], 2), pts });
    }
  }
  const labels: InkLabel[] = [];
  if (Array.isArray(o.labels)) {
    for (const l of o.labels) {
      if (labels.length >= INK_CAPS.labels) break;
      if (!l || typeof l !== "object") continue;
      const r = l as Record<string, unknown>;
      if (typeof r.id !== "string" || !r.id || labelIds.has(r.id) || typeof r.text !== "string") continue;
      if (typeof r.x !== "number" || typeof r.y !== "number" || typeof r.size !== "number") continue;
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
      const text = clipLabel(r.text);
      if (!text.trim()) continue;
      labelIds.add(r.id);
      const color = typeof r.color === "string" && HEX_COLOR.test(r.color) ? r.color : INK_COLORS[0];
      labels.push({ id: r.id, x: r05(r.x), y: r05(r.y), text, color, size: clampNum(r.size, INK_LIMITS.labelSize[0], INK_LIMITS.labelSize[1], 16) });
    }
  }
  return { v: 1, w, h, strokes, labels };
}

/** The slice of CanvasRenderingContext2D that `renderInk` uses (a fake works in tests). */
export type InkContext = {
  strokeStyle: unknown;
  fillStyle: unknown;
  lineWidth: number;
  lineCap: unknown;
  lineJoin: unknown;
  font: string;
  textBaseline: unknown;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
};

/** Draw strokes as quadratic-smoothed segments (width × scale × (0.5 + pressure)), then labels. */
export function renderInk(ctx: InkContext, doc: InkDoc, scale: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of doc.strokes) {
    const p = s.pts;
    const n = p.length / 3;
    ctx.strokeStyle = s.color;
    const X = (i: number) => p[i * 3] * scale;
    const Y = (i: number) => p[i * 3 + 1] * scale;
    const W = (a: number, b: number) => s.width * scale * (0.5 + (p[a * 3 + 2] + p[b * 3 + 2]) / 2);
    if (n === 1) {
      ctx.lineWidth = W(0, 0);
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(X(0), Y(0));
      ctx.stroke();
      continue;
    }
    if (n === 2) {
      ctx.lineWidth = W(0, 1);
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(X(1), Y(1));
      ctx.stroke();
      continue;
    }
    // Midpoint-quadratic smoothing: each interior point is a control point between neighbouring midpoints.
    let sx = X(0), sy = Y(0);
    for (let i = 1; i < n; i++) {
      const last = i === n - 1;
      const ex = last ? X(i) : (X(i) + X(i + 1)) / 2;
      const ey = last ? Y(i) : (Y(i) + Y(i + 1)) / 2;
      ctx.lineWidth = W(i - 1, i);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      if (last) ctx.lineTo(ex, ey);
      else ctx.quadraticCurveTo(X(i), Y(i), ex, ey);
      ctx.stroke();
      sx = ex;
      sy = ey;
    }
  }
  for (const l of doc.labels) {
    ctx.fillStyle = l.color;
    ctx.font = `${l.size * scale}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(l.text, l.x * scale, l.y * scale);
  }
}
