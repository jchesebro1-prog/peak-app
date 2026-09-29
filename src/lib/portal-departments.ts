import type { SearchEntry } from "@/lib/portal-search";

/**
 * Portal department tree (#252, spec picks 1–7). Pure — no DB, no server
 * import (same "pure, client-safe" convention as src/lib/design/device-types.ts).
 *
 * A department is a named grouping of catalog categories, edited by staff at
 * Catalog → Departments and stored as one settings blob (`portal_departments`,
 * src/lib/stores/portal-departments.ts). A category belongs to at most one
 * department; anything left over falls into the automatic "Other" bucket,
 * which is never stored and hidden whenever it would be empty.
 */

export type Department = { id: string; name: string; categories: string[] };

/** Automatic, unstored department for every category no real department
 *  claims. Its id is reserved — sanitizeDepartments refuses it as a real id. */
export const OTHER_DEPT: { id: "other"; name: "Other" } = { id: "other", name: "Other" };

export const MAX_DEPARTMENTS = 30;
const NAME_MAX = 40;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "dept";
}

/**
 * Full-replacement validation for the Departments editor's save (spec pick
 * 7): names 1–40 chars and unique (case-insensitive); at most
 * MAX_DEPARTMENTS; a category in at most one department (refused, not
 * silently dropped — the UI is expected to have already uncheckedit from
 * wherever else it lived, per #252 controller decision). `knownCategories`
 * — when given — silently drops any category the current catalog doesn't
 * have (defensive; the editor only ever offers real categories). Pass
 * `null` to skip that check (used when just reading the stored value back,
 * where a category that has since disappeared from the catalog is harmless
 * — it simply matches nothing).
 *
 * An id supplied by the caller is kept (renames keep the id — spec pick 1);
 * a row with no id (new department) gets a fresh slug of its name, deduped
 * against every id already used. "other" can never be claimed as a real id.
 */
export function sanitizeDepartments(
  raw: unknown,
  knownCategories: readonly string[] | null
): { ok: true; value: Department[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Nothing to save." };
  if (raw.length > MAX_DEPARTMENTS) return { ok: false, error: `At most ${MAX_DEPARTMENTS} departments.` };
  const known = knownCategories ? new Set(knownCategories) : null;

  // First pass (#252 fix round 1): every explicitly-supplied id, collected
  // BEFORE any slug is generated — so a new (id-less) row above an existing
  // row later in the array still avoids that row's id, regardless of order
  // (e.g. a new "Lighting" row saves as "lighting-2" when an existing
  // "lighting" row appears anywhere else in the list).
  const suppliedIds = new Set<string>();
  for (const row of raw) {
    const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    if (typeof r.id === "string" && ID_RE.test(r.id) && r.id !== OTHER_DEPT.id) suppliedIds.add(r.id);
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  const usedCategories = new Set<string>();
  const out: Department[] = [];

  for (const row of raw) {
    const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return { ok: false, error: "Every department needs a name." };
    if (name.length > NAME_MAX) return { ok: false, error: `"${name.slice(0, NAME_MAX)}…" is longer than ${NAME_MAX} characters.` };
    const lower = name.toLowerCase();
    if (names.has(lower)) return { ok: false, error: `Two departments are called "${name}".` };

    let id = typeof r.id === "string" && ID_RE.test(r.id) && r.id !== OTHER_DEPT.id ? r.id : "";
    if (!id) {
      const base = slugify(name);
      let candidate = base === OTHER_DEPT.id ? `${base}-2` : base;
      let n = 2;
      while (ids.has(candidate) || suppliedIds.has(candidate) || candidate === OTHER_DEPT.id) candidate = `${base}-${n++}`;
      id = candidate;
    }
    if (ids.has(id)) return { ok: false, error: "The same department appears twice." };

    const catsIn = Array.isArray(r.categories) ? r.categories : [];
    const cats: string[] = [];
    const seenCat = new Set<string>();
    for (const c of catsIn) {
      if (typeof c !== "string") continue;
      const t = c.trim();
      if (!t || seenCat.has(t)) continue;
      if (known && !known.has(t)) continue;
      if (usedCategories.has(t)) return { ok: false, error: `"${t}" is already in another department.` };
      seenCat.add(t);
      usedCategories.add(t);
      cats.push(t);
    }

    names.add(lower);
    ids.add(id);
    out.push({ id, name, categories: cats });
  }
  return { ok: true, value: out };
}

/** category → owning department id, for every department that has it. */
export function departmentOfCategory(depts: readonly Department[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of depts) for (const c of d.categories) m.set(c, d.id);
  return m;
}

/** `deptId` resolved against the saved list (or "other") → its id+name, or
 *  null for anything else — an unknown/invalid id is simply not a department
 *  (spec pick: "Invalid ?dept= is ignored, no error"). With NO departments
 *  configured, "other" resolves to null too (#252 fix round 1) — spec pick
 *  3 says the portal browses exactly as today when nothing is configured,
 *  and a phantom Other (matching everything, since nothing is assigned)
 *  would otherwise still turn on the department UI for a stray `?dept=other`. */
export function resolveDept(departments: readonly Department[], deptId: string | null | undefined): { id: string; name: string } | null {
  if (!deptId || !departments.length) return null;
  if (deptId === OTHER_DEPT.id) return { id: OTHER_DEPT.id, name: OTHER_DEPT.name };
  const d = departments.find((x) => x.id === deptId);
  return d ? { id: d.id, name: d.name } : null;
}

/** The resolved category filter for a department — an allow-list for a real
 *  department, or a deny-list (every assigned category) for Other. Returns
 *  null for no department / an invalid id (search runs unrestricted). */
export type DeptFilter = { mode: "include" | "exclude"; categories: Set<string> };

export function departmentFilterFor(departments: readonly Department[], deptId: string | null | undefined): DeptFilter | null {
  const resolved = resolveDept(departments, deptId);
  if (!resolved) return null;
  if (resolved.id === OTHER_DEPT.id) {
    const assigned = new Set<string>();
    for (const d of departments) for (const c of d.categories) assigned.add(c);
    return { mode: "exclude", categories: assigned };
  }
  const dept = departments.find((d) => d.id === resolved.id)!;
  return { mode: "include", categories: new Set(dept.categories) };
}

export function matchesDeptFilter(category: string, filter: DeptFilter): boolean {
  const cat = category || "—";
  return filter.mode === "include" ? filter.categories.has(cat) : !filter.categories.has(cat);
}

type DeptRestrictable = { category: string };

/** `entries` narrowed to one department (or Other); unchanged when `deptId`
 *  doesn't resolve to anything. Pure — the same rule searchCatalog's `dept`
 *  filter applies, exposed standalone for direct use/testing. */
export function restrictToDept<T extends DeptRestrictable>(entries: readonly T[], deptId: string | null | undefined, departments: readonly Department[]): T[] {
  const filter = departmentFilterFor(departments, deptId);
  if (!filter) return [...entries];
  return entries.filter((e) => matchesDeptFilter(e.category, filter));
}

/**
 * Pure: the new draft catDept map after the editor's "Move all N shown to
 * <dept>/Other" bulk action is applied to `categoryNames` (every category
 * currently matching the editor's filter — computed by the caller, not
 * here). `targetKey` is a draft department key, or "" for Other (which
 * removes the category's entry instead of pointing it at a dead key, same
 * convention the per-row select already uses).
 */
export function computeBulkMove(catDept: Readonly<Record<string, string>>, categoryNames: readonly string[], targetKey: string): Record<string, string> {
  const next = { ...catDept };
  for (const cat of categoryNames) {
    if (targetKey) next[cat] = targetKey;
    else delete next[cat];
  }
  return next;
}

/* ------------------------- suggested starter set ------------------------- */

/** Per-category input to suggestDepartments: its raw part count (unused by
 *  the classifier itself, carried for callers/tests) and a part count per
 *  manufacturer — the (k) dominant-manufacturer fallback below reads
 *  whichever key has the highest count. */
export type CategoryStat = { category: string; count: number; mfrs: Record<string, number> };

/** The ten production-shaped departments (#252 rebuild, Sep 2026 — a real
 *  prod catalog run showed 94% of parts landing in "Other" under the old
 *  keyword-only STARTERS set, and "mount" wrongly pulling projection-screen
 *  and speaker parts into a generic Hardware bucket). This is DISPLAY order
 *  — the order suggested departments come back in, and the order a fresh
 *  "Start/Re-run from suggestions" lists them — which is NOT the same as
 *  NAME_RULES' classification-priority order below. */
const DEPT_DEFS: readonly { id: string; name: string }[] = [
  { id: "projection-screens", name: "Projection Screens" },
  { id: "drapery", name: "Drapery" },
  { id: "lighting", name: "Lighting" },
  { id: "audio", name: "Audio" },
  { id: "video-displays", name: "Video & Displays" },
  { id: "control-networking", name: "Control & Networking" },
  { id: "rigging", name: "Rigging" },
  { id: "cable-connectors", name: "Cable & Connectors" },
  { id: "power", name: "Power" },
  { id: "mounts-hardware", name: "Mounts & Hardware" },
];

type NameRule = { dept: string; re: RegExp };

/**
 * Classification PRIORITY order (first match wins) — deliberately NOT the
 * same order as DEPT_DEFS' display order above. Real production categories
 * are mostly brand product-family names (Access V, Targa, ArcSystem Pro,
 * Source Four, Tesira…), so most of the actual matching weight comes from
 * those literal product names, not generic English words.
 *
 * Two deliberate reorderings vs. a naive a-through-j reading:
 *  - Cable & Connectors is raised above Video & Displays so "HDMI Cables"
 *    reads as Cable & Connectors, not Video (a name carrying both "cable"
 *    and a video term should read as the cable accessory).
 *  - The Video & Displays "projector" keyword carries a negative lookahead
 *    for a trailing "(custom) mount(s)" so "RPMX: Projector Custom Mounts
 *    Locking" and "VCM: Projector Custom Mounts" fall through to Mounts &
 *    Hardware's "mount" keyword instead — a projector *mount* is hardware,
 *    even though a bare "proj." → Projection Screens (checked earlier) and
 *    a bare "projector" → Video & Displays (this rule) both still apply.
 *  - Projection Screens' keyword list deliberately excludes "aerolift" —
 *    AeroLift is a projector LIFT (Chief/Da-Lite), not a screen; it falls
 *    through to Mounts & Hardware's "lift" keyword instead.
 */
const NAME_RULES: readonly NameRule[] = [
  { dept: "drapery", re: /drape|drapery|velour|i\.?f\.?r|dress kit|skirt|valance|soft goods|curtain/i },
  {
    dept: "projection-screens",
    re: /screen|stagescreen|focalpoint|cinefold|\bufs\b|folding screen|projection|proj\.|tecvision|clarion|acumen|paragon|targa|access (v|e|xl|m)\b|ultimate access|premier|styleline|nocturne|profile\+|edgeless|cine-studio|fast-fold|shadowbox/i,
  },
  {
    dept: "audio",
    re: /speaker|spkr|loudspeaker|subwoofer|\bsub\b|line array|point source|column|mic(s|rophone)?\b|amp(lifiers?|s)?\b|mixer|dsp|signal processor|headphone|earphone|transducer|driver|monitor|tesira|vocia|soundweb|dante|audio|sound|loop|infrared|\bir\b|digi-wave|fm ?& ?fm\+|recone|diaphragm|horn|intellivox|iconyx|varia|cdd|eon|prx|srx|vrx|jrx|irx|vtx|wavefront|stagebox|audio console|fixed installation/i,
  },
  {
    dept: "lighting",
    re: /source four|source ?4|colorsource|eos|irideon|fos\/4|arcsystem|desire|desono|lens tube|hog|\bmac\b|mac |exterior (wash|dot|linear)|luma|unison|echo\b|paradigm|sensor|mosaic|pharos|sohrana|static lights|effect lights|fixture assemblies|high end systems|city theatrical/i,
  },
  { dept: "cable-connectors", re: /cable|connect|patch|insert|wall plate|keystone|phoenix|snake|termination|faceplate|nema plate/i },
  {
    dept: "video-displays",
    re: /hdmi|hdbaset|display|signage|video|dvled|led video|projector(?! (custom )?mounts?)|switcher|extender|splitter|scaler|matrix|av over ip|networkhd|4k|8k|camera|image projection|capture/i,
  },
  {
    dept: "control-networking",
    re: /touch ?panel|keypad|control(ler| processor| system|s)?\b|remote|network|switch(es)?\b|router|access point|wifi|sfp|mxnet|bridge|teams rooms|room system|unified communication|software|license/i,
  },
  { dept: "rigging", re: /hoist|block|arbor|rope ?lock|track|pipe|batten|rigging|truss|counterweight|head ?block|loft ?block|mule|shoe/i },
  { dept: "power", re: /power|ups|sequencer|surge|distribution|psu|supply|conditioning/i },
  {
    dept: "mounts-hardware",
    re: /mount|bracket|lift|cart|stands?\b|enclosure|box(es)?\b|plate|kit|clamp|case|crank|pole|hardware|trim|flange|pocket|back box|easel|caster|eyebolt/i,
  },
];

/** A bare "led" only reads as Lighting when the category's own dominant
 *  manufacturer also reads as a lighting brand (spec: "led\b (only when
 *  mfr also suggests lighting)") — everywhere else "LED" alone is too
 *  common a token across every department to name-match on its own. */
const LED_RE = /\bled\b/i;

type MfrRule = { dept: string; re: RegExp };

/**
 * (k) Fallback when no name rule matched: the category's DOMINANT
 * manufacturer (the mfr with the most parts in it) decides the department.
 * This is what actually classifies a pure product-family category name
 * ("Access V", "Targa", "Standard", "Professional", "Community", "Prebuilt
 * system"…) that carries no readable department signal on its own —
 * production categories are mostly brand names, not descriptions.
 */
const MFR_RULES: readonly MfrRule[] = [
  { dept: "projection-screens", re: /draper|da-?lite|stewart|elite screens|screen innovations/i },
  { dept: "drapery", re: /rose brand/i },
  { dept: "lighting", re: /\betc\b|high end|martin|chauvet|city theatrical|\brobe\b|elation/i },
  {
    dept: "audio",
    re: /biamp|shure|\bqsc\b|\bjbl\b|crown|\bbss\b|\bdbx\b|soundcraft|allen ?& ?heath|community|\beaw\b|renkus|williams|listen|sennheiser|audio-technica|\bbose\b|yamaha|electro-voice|lab\.?gruppen|tannoy|atlasied|lexicon|harman(?!.*lighting)/i,
  },
  {
    dept: "video-displays",
    re: /wyrestorm|extron|crestron|\bbarco\b|\blg\b|samsung|\babsen\b|\bplanar\b|christie|\bepson\b|panasonic|\bsony\b|\bnec\b|unilumin|kramer/i,
  },
  { dept: "mounts-hardware", re: /\bchief\b|peerless|legrand|middle atlantic|\bfsr\b/i },
  { dept: "rigging", re: /j\.?r\.? clancy|\bclancy\b|\bthern\b|columbus mckinnon|\bcm\b/i },
];

function dominantMfr(mfrs: Record<string, number> | null | undefined): string | null {
  if (!mfrs) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [mfr, count] of Object.entries(mfrs)) {
    if (typeof count !== "number" || !(count > bestCount)) continue;
    best = mfr;
    bestCount = count;
  }
  return best;
}

/**
 * Classifies real catalog categories (#252 rebuild) into the ten
 * DEPT_DEFS departments: a single pass through NAME_RULES' priority order,
 * where the Lighting slot ALSO matches a bare "led" when the category's
 * dominant manufacturer reads as a lighting brand (the led+mfr combined
 * check runs AT Lighting's priority position, not after every name rule
 * has failed — otherwise a bare "led" paired with a lighting mfr could
 * never win against a later Mounts & Hardware "mount" keyword on the same
 * category, e.g. a hypothetical "LED Mounts" from an ETC-dominant
 * category). Only once nothing in that ordered pass matches does (k) the
 * dominant-manufacturer fallback run on its own, independent of "led" —
 * e.g. a bare "LED" category whose dominant mfr is Chief (a mounts/display-
 * mount brand, not a lighting one) still resolves to Mounts & Hardware
 * through the plain mfr fallback, just not through the Lighting-specific
 * led+mfr reading. A category matching neither is left out entirely
 * (Other); every suggested category appears in exactly one department, so
 * the result always saves cleanly through sanitizeDepartments with no
 * staff edits. A department with nothing matched is left out (never
 * offered empty). `count` isn't read by the classifier — only `category`
 * and `mfrs` decide — but is accepted so a caller can hand this straight
 * from a `{category, count, mfrs}` catalog roll-up.
 */
export function suggestDepartments(cats: readonly CategoryStat[]): Department[] {
  const buckets = new Map<string, string[]>();
  const assign = (dept: string, category: string) => {
    const arr = buckets.get(dept) ?? [];
    arr.push(category);
    buckets.set(dept, arr);
  };
  const lightingMfrRe = MFR_RULES.find((r) => r.dept === "lighting")!.re;

  for (const c of cats) {
    if (!c || typeof c.category !== "string" || !c.category.trim()) continue;
    const cat = c.category;
    const dominant = dominantMfr(c.mfrs);
    const dominantIsLighting = dominant ? lightingMfrRe.test(dominant) : false;

    let matchedDept: string | null = null;
    for (const rule of NAME_RULES) {
      if (rule.re.test(cat)) {
        matchedDept = rule.dept;
        break;
      }
      if (rule.dept === "lighting" && LED_RE.test(cat) && dominantIsLighting) {
        matchedDept = "lighting";
        break;
      }
    }
    if (matchedDept) {
      assign(matchedDept, cat);
      continue;
    }

    if (dominant) {
      const mfrHit = MFR_RULES.find((r) => r.re.test(dominant));
      if (mfrHit) {
        assign(mfrHit.dept, cat);
        continue;
      }
    }
    // no name rule (incl. the led+mfr combined check), no (or unresolved)
    // dominant manufacturer → Other
  }

  const out: Department[] = [];
  for (const d of DEPT_DEFS) {
    const members = buckets.get(d.id);
    if (members && members.length) out.push({ id: d.id, name: d.name, categories: members });
  }
  return out;
}

/* ------------------------------- tiles ------------------------------- */

export type DeptTileSource = Pick<SearchEntry, "key" | "kind" | "category" | "browsable" | "rank">;
export type DeptTileVM = { id: string; name: string; count: number; imageId: string | null };

/**
 * Portal landing tiles (spec pick 5): one per configured department, plus
 * Other when it would be non-empty, in department order with Other last.
 * `count` is every browsable entry (part or fixture) in the department;
 * the thumbnail is the highest-ranked browsable PART with an image (spec's
 * own wording — fixtures never contribute a department thumbnail).
 * `[]` when no departments are configured (spec pick 3 — the tree is
 * additive) or when a department (Other included) has no browsable members.
 */
export function departmentTiles(departments: readonly Department[], entries: readonly DeptTileSource[], imageIdOf: (key: string) => string | null): DeptTileVM[] {
  if (!departments.length) return [];

  // #252 fix round 1: one pass over `entries` (was one filter pass PER
  // department, department count times) — build the category → department
  // map once, then bucket every browsable entry directly by its owning
  // department (or Other) as we scan. Same output, same tie-break (highest
  // rank browsable PART with an image; Other/an empty department omitted).
  const catMap = departmentOfCategory(departments);
  type Bucket = { id: string; name: string; count: number; best: DeptTileSource | null };
  const buckets = new Map<string, Bucket>();
  for (const d of departments) buckets.set(d.id, { id: d.id, name: d.name, count: 0, best: null });
  buckets.set(OTHER_DEPT.id, { id: OTHER_DEPT.id, name: OTHER_DEPT.name, count: 0, best: null });

  for (const e of entries) {
    if (!e.browsable) continue;
    const deptId = catMap.get(e.category) ?? OTHER_DEPT.id;
    const bucket = buckets.get(deptId)!;
    bucket.count++;
    if (e.kind === "part" && imageIdOf(e.key) && (!bucket.best || e.rank > bucket.best.rank)) bucket.best = e;
  }

  const out: DeptTileVM[] = [];
  for (const d of departments) {
    const b = buckets.get(d.id)!;
    if (b.count) out.push({ id: b.id, name: b.name, count: b.count, imageId: b.best ? imageIdOf(b.best.key) : null });
  }
  const other = buckets.get(OTHER_DEPT.id)!;
  if (other.count) out.push({ id: other.id, name: other.name, count: other.count, imageId: other.best ? imageIdOf(other.best.key) : null });
  return out;
}
