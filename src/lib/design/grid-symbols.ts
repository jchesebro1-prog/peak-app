/* ------------------------------------------------------------------ *
 * The Grid — device symbols (#131, D154). Pure and dependency-free like
 * its siblings (grid-bom, grid-scopes): the editor, the riser page, the
 * Settings card and the spec harness all import it, and nothing here may
 * touch the doc-store.
 *
 * Resolution: an entry's own `shape` wins, then the admin's per-category
 * default (settings.gridCategoryShapes — a FULL-REPLACEMENT map, the
 * wireTypes idiom: absent = the seed below, present = exactly what is
 * stored), then "rect". Category names match trimmed and case-insensitive
 * because CatalogPart.category is free text.
 * ------------------------------------------------------------------ */

export const GRID_SHAPES = [
  "rect",
  "circle",
  "triangle",
  "diamond",
  "hexagon",
  "speaker",
  "light",
  "camera",
] as const;
export type GridShape = (typeof GRID_SHAPES)[number];

export const GRID_SHAPE_LABEL: Record<GridShape, string> = {
  rect: "Rectangle",
  circle: "Circle",
  triangle: "Triangle",
  diamond: "Diamond",
  hexagon: "Hexagon",
  speaker: "Speaker",
  light: "Light",
  camera: "Camera",
};

/** The seed (spec #131): what a fresh install draws per category. Everything
 *  else is a rectangle. Edited in Settings → Admin → Grid symbols. */
export const DEFAULT_GRID_CATEGORY_SHAPES: Record<string, GridShape> = {
  Speakers: "speaker",
  Lighting: "light",
  Cameras: "camera",
  Rigging: "diamond",
  Control: "hexagon",
};

export function isGridShape(v: unknown): v is GridShape {
  return typeof v === "string" && (GRID_SHAPES as readonly string[]).includes(v);
}

/** Stored map (even an empty one) is the whole truth; absent → a fresh copy
 *  of the seed. Unknown shape values are dropped rather than drawn wrong. */
export function resolveCategoryShapes(
  stored?: Record<string, string> | null
): Record<string, GridShape> {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_GRID_CATEGORY_SHAPES };
  const out: Record<string, GridShape> = {};
  for (const [category, shape] of Object.entries(stored)) {
    if (isGridShape(shape)) out[category] = shape;
  }
  return out;
}

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/** `part.shape ?? default[category] ?? "rect"`. */
export function shapeFor(
  part: { category?: string | null; shape?: string | null } | null | undefined,
  settings: { gridCategoryShapes?: Record<string, string> | null } | null | undefined
): GridShape {
  if (part && isGridShape(part.shape)) return part.shape;
  const wanted = norm(part?.category);
  if (wanted) {
    const map = resolveCategoryShapes(settings?.gridCategoryShapes);
    for (const [category, shape] of Object.entries(map)) {
      if (norm(category) === wanted) return shape;
    }
  }
  return "rect";
}

/** The "clean or null" step for a legacy `gridCategoryShapes` save: trim
 *  and cap category keys, drop unknown shapes and blank categories, cap at
 *  60 entries — and collapse an empty result to `null` rather than `{}`,
 *  since a stored `{}` is itself a whole-truth map (every category falls
 *  back to "rect") while `null` is "absent" and resolves through
 *  resolveCategoryShapes to a fresh copy of the seed. No admin action posts
 *  through here any more (stock symbols, spec 2026-09-25, replaced the
 *  D154 shapes card with Category icons/Symbol colours) — kept pure and
 *  session-free because the regression harness still pins it directly. */
export function cleanGridCategoryShapes(
  map: Record<string, string> | null | undefined
): Record<string, GridShape> | null {
  const clean: Record<string, GridShape> = {};
  for (const [k, v] of Object.entries(map || {})) {
    const category = String(k ?? "").trim().slice(0, 60);
    if (!category || !isGridShape(v)) continue;
    clean[category] = v;
    if (Object.keys(clean).length >= 60) break;
  }
  return Object.keys(clean).length ? clean : null;
}

/* ---------------------------- geometry ---------------------------- */

export type SymbolOutline =
  | { kind: "rect"; w: number; h: number; rx: number }
  | { kind: "circle"; r: number }
  | { kind: "polygon"; points: string };

/** Everything centered on (0,0); the renderer translates to the marker. */
export type SymbolGeometry = { outline: SymbolOutline; glyph: string | null };

const r2 = (v: number) => Math.round(v * 100) / 100;

function rectOutline(w: number, h: number): SymbolOutline {
  return { kind: "rect", w: r2(w), h: r2(h), rx: r2(Math.min(4, Math.min(w, h) / 4)) };
}

/** Glyphs are authored on a 30-unit box and scaled to the short side, so a
 *  12px palette icon and a 48px plan marker draw the same picture. */
function glyphFor(shape: GridShape, w: number, h: number): string | null {
  const s = Math.min(w, h) / 30;
  const p = (x: number, y: number) => `${r2(x * s)} ${r2(y * s)}`;
  switch (shape) {
    case "speaker": // cone + one sound arc
      return `M ${p(-8, -4)} L ${p(-3, -4)} L ${p(4, -9)} L ${p(4, 9)} L ${p(-3, 4)} L ${p(-8, 4)} Z M ${p(7, -4)} Q ${p(11, 0)} ${p(7, 4)}`;
    case "light": { // bulb + base
      const rr = r2(6 * s);
      return `M ${p(-6, -3)} a ${rr} ${rr} 0 1 1 ${p(12, 0)} a ${rr} ${rr} 0 1 1 ${p(-12, 0)} M ${p(-3, 6)} L ${p(3, 6)} M ${p(-2, 9)} L ${p(2, 9)}`;
    }
    case "camera": // body + lens wedge
      return `M ${p(-9, -5)} L ${p(3, -5)} L ${p(3, 5)} L ${p(-9, 5)} Z M ${p(3, -1)} L ${p(9, -4)} L ${p(9, 4)} L ${p(3, 1)} Z`;
    default:
      return null;
  }
}

export function symbolGeometry(shape: GridShape, w: number, h: number): SymbolGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const pts = (list: Array<[number, number]>) => list.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ");
  switch (shape) {
    case "circle":
      return { outline: { kind: "circle", r: r2(Math.min(w, h) / 2) }, glyph: null };
    case "triangle":
      return { outline: { kind: "polygon", points: pts([[0, -hh], [hw, hh], [-hw, hh]]) }, glyph: null };
    case "diamond":
      return { outline: { kind: "polygon", points: pts([[0, -hh], [hw, 0], [0, hh], [-hw, 0]]) }, glyph: null };
    case "hexagon":
      return {
        outline: { kind: "polygon", points: pts([[-hw / 2, -hh], [hw / 2, -hh], [hw, 0], [hw / 2, hh], [-hw / 2, hh], [-hw, 0]]) },
        glyph: null,
      };
    case "speaker":
    case "light":
    case "camera":
      return { outline: rectOutline(w, h), glyph: glyphFor(shape, w, h) };
    default:
      return { outline: rectOutline(w, h), glyph: null };
  }
}

/* ---------------------------- colour ------------------------------ */

/** Stable marker color per category — device markers read as families on a
 *  plan. Moved here from the editor (#131) so the riser and the Settings
 *  card colour a category exactly the way the plan does. */
const MARK_COLORS = ["#3155a8", "#2e9e6b", "#d5342a", "#6b4fa1", "#e08b1f", "#0e7f8c", "#b0367c"];
export function markerColor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) | 0;
  return MARK_COLORS[Math.abs(h) % MARK_COLORS.length];
}
