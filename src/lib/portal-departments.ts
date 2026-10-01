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

/** #289: the built-in Packages & Assemblies section — every portal fixture
 *  assembly, grouped by its own `portalCategory`. Never stored and never a
 *  configured department; resolves whether or not any departments exist.
 *  Its id is reserved like "other". Departments hold parts only. */
export const PACKAGES_DEPT: { id: "packages"; name: "Packages & Assemblies" } = { id: "packages", name: "Packages & Assemblies" };

/** #289: the index category of a fixture with no `portalCategory`. */
export const OTHER_PACKAGES_CATEGORY = "Other packages";

const RESERVED_IDS = new Set<string>([OTHER_DEPT.id, PACKAGES_DEPT.id]);

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
 * against every id already used. "other" and "packages" (#289) can never be
 * claimed as a real id.
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
    if (typeof r.id === "string" && ID_RE.test(r.id) && !RESERVED_IDS.has(r.id)) suppliedIds.add(r.id);
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

    let id = typeof r.id === "string" && ID_RE.test(r.id) && !RESERVED_IDS.has(r.id) ? r.id : "";
    if (!id) {
      const base = slugify(name);
      let candidate = RESERVED_IDS.has(base) ? `${base}-2` : base;
      let n = 2;
      while (ids.has(candidate) || suppliedIds.has(candidate) || RESERVED_IDS.has(candidate)) candidate = `${base}-${n++}`;
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
  // #289: Packages & Assemblies is built in — it resolves with or without
  // configured departments.
  if (deptId === PACKAGES_DEPT.id) return { id: PACKAGES_DEPT.id, name: PACKAGES_DEPT.name };
  if (!deptId || !departments.length) return null;
  if (deptId === OTHER_DEPT.id) return { id: OTHER_DEPT.id, name: OTHER_DEPT.name };
  const d = departments.find((x) => x.id === deptId);
  return d ? { id: d.id, name: d.name } : null;
}

/** The resolved filter for a department — an allow-list of categories for a
 *  real department, a deny-list (every assigned category) for Other, or
 *  "packages" (#289: fixtures only, any category). Returns null for no
 *  department / an invalid id (search runs unrestricted). */
export type DeptFilter = { mode: "include" | "exclude"; categories: Set<string> } | { mode: "packages" };

export function departmentFilterFor(departments: readonly Department[], deptId: string | null | undefined): DeptFilter | null {
  const resolved = resolveDept(departments, deptId);
  if (!resolved) return null;
  if (resolved.id === PACKAGES_DEPT.id) return { mode: "packages" };
  if (resolved.id === OTHER_DEPT.id) {
    const assigned = new Set<string>();
    for (const d of departments) for (const c of d.categories) assigned.add(c);
    return { mode: "exclude", categories: assigned };
  }
  const dept = departments.find((d) => d.id === resolved.id)!;
  return { mode: "include", categories: new Set(dept.categories) };
}

/** The category half of a department filter. A bare category never matches
 *  "packages" — that filter is decided by kind (`entryMatchesDept`). */
export function matchesDeptFilter(category: string, filter: DeptFilter): boolean {
  if (filter.mode === "packages") return false;
  const cat = category || "—";
  return filter.mode === "include" ? filter.categories.has(cat) : !filter.categories.has(cat);
}

/** A row's kind (absent = a part, the #252 shape) and category. */
type DeptRestrictable = { kind?: "part" | "fixture"; category: string };

/** #289: departments hold parts only. "packages" keeps fixtures (any
 *  category); a configured department or Other keeps parts by category and
 *  never a fixture — so a saved department still listing the old "Fixture
 *  assemblies" category is harmless, it matches nothing. */
export function entryMatchesDept(e: DeptRestrictable, filter: DeptFilter): boolean {
  if (filter.mode === "packages") return e.kind === "fixture";
  return e.kind !== "fixture" && matchesDeptFilter(e.category, filter);
}

/** `entries` narrowed to one department (or Other, or packages); unchanged
 *  when `deptId` doesn't resolve to anything. Pure — the same rule
 *  searchCatalog's `dept` filter applies, exposed standalone for direct
 *  use/testing. */
export function restrictToDept<T extends DeptRestrictable>(entries: readonly T[], deptId: string | null | undefined, departments: readonly Department[]): T[] {
  const filter = departmentFilterFor(departments, deptId);
  if (!filter) return [...entries];
  return entries.filter((e) => entryMatchesDept(e, filter));
}

/** #289: the Departments editor's category list and its save's known
 *  categories — part entries only (a fixture's category is its portal
 *  category, which belongs to Packages & Assemblies, never a department).
 *  Per category: its part count and a part count per manufacturer (the
 *  suggestions' dominant-manufacturer fallback); biggest first. */
export function partCategoryStats(entries: readonly Pick<SearchEntry, "kind" | "category" | "mfr">[]): CategoryStat[] {
  const stats = new Map<string, { count: number; mfrs: Record<string, number> }>();
  for (const e of entries) {
    if (e.kind !== "part") continue;
    const cat = e.category || "—";
    const s = stats.get(cat) ?? { count: 0, mfrs: {} };
    s.count++;
    const mfr = e.mfr || "—";
    s.mfrs[mfr] = (s.mfrs[mfr] ?? 0) + 1;
    stats.set(cat, s);
  }
  return [...stats.entries()]
    .map(([category, s]) => ({ category, count: s.count, mfrs: s.mfrs }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
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
 * Every keyword below is `\b`-bounded (whole word/phrase only) UNLESS it's
 * a punctuation-terminated token (`proj.`, `profile\+`, `fos\/4`, `i\.?f\.?r`)
 * where `\b` misbehaves right after the punctuation, or a deliberately
 * unbounded stem (`source ?4`, to still catch "Source 4WRD" with no space
 * before the trailing letters) or a still-unique multi-word phrase (`dress
 * kit`, `back box`…) that's already specific enough not to need it. This
 * matters because production category names are often ONE compound word: a
 * bare "eon" wrongly read "Irideon" as Audio (an ETC lighting fixture, not
 * an "eon" JBL loudspeaker) and a bare "bridge" wrongly read "Cambridge" (an
 * unrelated Community loudspeaker category, no relation to a video bridge)
 * as Control & Networking — both are real prod-category names this rebuild
 * is built against (#252 fix round 2). The one deliberate exception is
 * "aerolift" in Mounts & Hardware: it's a genuine compound brand word
 * (Aero+Lift, no space) that SHOULD still match the same "lift" concept, so
 * it gets its own explicit bounded keyword rather than relying on a bare,
 * unbounded "lift" substring (which would reopen the same Irideon/Cambridge
 * class of bug for every other word that happens to contain "lift").
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
 */
const NAME_RULES: readonly NameRule[] = [
  {
    dept: "drapery",
    re: /\bdrapes?\b|\bdrapery\b|\bvelour\b|\bi\.?f\.?r\.?\b|dress kit|\bskirts?\b|\bvalance\b|soft goods|\bcurtains?\b/i,
  },
  {
    dept: "projection-screens",
    re: /\bscreens?\b|\bstagescreen\b|\bfocalpoint\b|\bcinefold\b|\bufs\b|folding screen|\bprojection\b|proj\.|\btecvision\b|\bclarion\b|\bacumen\b|\bparagon\b|\btarga\b|\baccess (v|e|xl|m)\b|ultimate access|\bpremier\b|\bstyleline\b|\bnocturne\b|profile\+|\bedgeless\b|cine-studio|fast-fold|\bshadowbox\b/i,
  },
  {
    dept: "audio",
    re: /\bspeakers?\b|\bspkr\b|\bloudspeakers?\b|\bsubwoofers?\b|\bsub\b|line array|point source|\bcolumn\b|\bmics?\b|\bmicrophones?\b|\bamp(lifiers?|s)?\b|\bmixers?\b|\bdsp\b|signal processor|\bheadphones?\b|\bearphones?\b|\btransducers?\b|\bdrivers?\b|\bmonitors?\b|\btesira\b|\bvocia\b|\bsoundweb\b|\bdante\b|\baudio\b|\bsound\b|\bloop\b|\binfrared\b|\bir\b|\bdigi-wave\b|fm ?& ?fm\+|\brecone\b|\bdiaphragms?\b|\bhorns?\b|\bintellivox\b|\biconyx\b|\bvaria\b|\bcdd\b|\beon\b|\bprx\b|\bsrx\b|\bvrx\b|\bjrx\b|\birx\b|\bvtx\b|\bwavefront\b|\bstagebox\b|audio console|fixed installation/i,
  },
  {
    dept: "lighting",
    re: /source four|source ?4|\bcolorsource\b|\beos\b|\birideon\b|fos\/4|\barcsystem\b|\bdesire\b|\bdesono\b|\blens tubes?\b|\bhog\b|\bmac\b|\bexterior (wash|dot|linear)\b|\bluma\b|\bunison\b|\becho\b|\bparadigm\b|\bsensor\b|\bmosaic\b|\bpharos\b|\bsohrana\b|\bstatic lights?\b|\beffect lights?\b|\bhigh end systems\b|\bcity theatrical\b/i,
  },
  {
    dept: "cable-connectors",
    re: /\bcables?\b|\bconnectors?\b|\bpatch\b|\binserts?\b|wall plate|\bkeystone\b|\bphoenix\b|\bsnake\b|\btermination\b|\bfaceplate\b|nema plate/i,
  },
  {
    dept: "video-displays",
    re: /\bhdmi\b|\bhdbaset\b|\bdisplays?\b|\bsignage\b|\bvideo\b|\bdvled\b|led video|\bprojector(?! (custom )?mounts?)\b|\bswitchers?\b|\bextenders?\b|\bsplitters?\b|\bscalers?\b|\bmatrix\b|av over ip|\bnetworkhd\b|\b4k\b|\b8k\b|\bcameras?\b|image projection|\bcapture\b/i,
  },
  {
    dept: "control-networking",
    re: /touch ?panels?|\bkeypads?\b|\bcontrol(ler| processor| system|s)?\b|\bremote\b|\bnetwork(ed)?\b|\bswitch(es)?\b|\brouters?\b|access points?|\bwifi\b|\bsfp\b|\bmxnet\b|\bbridge\b|teams rooms?|room systems?|unified communications?|\bsoftware\b|\blicenses?\b/i,
  },
  {
    dept: "rigging",
    re: /\bhoists?\b|\bblocks?\b|\barbors?\b|rope ?locks?|\btracks?\b|\bpipes?\b|\bbattens?\b|\brigging\b|\btruss(es)?\b|\bcounterweights?\b|head ?blocks?|loft ?blocks?|\bmules?\b|\bshoes?\b/i,
  },
  { dept: "power", re: /\bpower\b|\bups\b|\bsequencers?\b|\bsurge\b|\bdistribution\b|\bpsu\b|\bsupply\b|\bconditioning\b/i },
  {
    dept: "mounts-hardware",
    re: /\bmounts?\b|\bbrackets?\b|\blifts?\b|\baerolift\b|\bcarts?\b|\bstands?\b|\benclosures?\b|\bbox(es)?\b|\bplates?\b|\bkits?\b|\bclamps?\b|\bcases?\b|\bcranks?\b|\bpoles?\b|\bhardware\b|\btrim\b|\bflange\b|\bpockets?\b|back box|\beasels?\b|\bcasters?\b|\beyebolts?\b/i,
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
  { dept: "projection-screens", re: /\bdraper\b|da-?lite|\bstewart\b|elite screens|screen innovations/i },
  { dept: "drapery", re: /rose brand/i },
  { dept: "lighting", re: /\betc\b|high end|\bmartin\b|\bchauvet\b|city theatrical|\brobe\b|\belation\b/i },
  {
    dept: "audio",
    re: /\bbiamp\b|\bshure\b|\bqsc\b|\bjbl\b|\bcrown\b|\bbss\b|\bdbx\b|\bsoundcraft\b|allen ?& ?heath|\bcommunity\b|\beaw\b|\brenkus\b|\bwilliams\b|\blisten\b|\bsennheiser\b|audio-technica|\bbose\b|\byamaha\b|electro-voice|lab\.?gruppen|\btannoy\b|\batlasied\b|\blexicon\b|\bharman\b(?!.*lighting)/i,
  },
  {
    dept: "video-displays",
    re: /\bwyrestorm\b|\bextron\b|\bcrestron\b|\bbarco\b|\blg\b|\bsamsung\b|\babsen\b|\bplanar\b|\bchristie\b|\bepson\b|\bpanasonic\b|\bsony\b|\bnec\b|\bunilumin\b|\bkramer\b/i,
  },
  { dept: "mounts-hardware", re: /\bchief\b|\bpeerless\b|\blegrand\b|middle atlantic|\bfsr\b/i },
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
 * #289: the landing's Packages & Assemblies tile — null when no fixture is
 * browsable. `count` is every browsable fixture; the thumbnail is the image
 * of the top-ranked fixture that has one, in the order the packages page
 * lists them (rank, then title). The caller's `imageIdOf` maps a
 * `fixture:<id>` key to its light engine's image.
 */
export function packagesTile(
  entries: readonly Pick<SearchEntry, "key" | "kind" | "browsable" | "rank" | "title">[],
  imageIdOf: (key: string) => string | null
): DeptTileVM | null {
  const fixtures = entries.filter((e) => e.kind === "fixture" && e.browsable);
  if (!fixtures.length) return null;
  const ordered = [...fixtures].sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title));
  let imageId: string | null = null;
  for (const e of ordered) {
    imageId = imageIdOf(e.key);
    if (imageId) break;
  }
  return { id: PACKAGES_DEPT.id, name: PACKAGES_DEPT.name, count: fixtures.length, imageId };
}

/**
 * Portal landing tiles (spec pick 5): one per configured department, plus
 * Other when it would be non-empty, in department order with Other last.
 * `count` is every browsable PART in the department — #289: departments
 * hold parts only, so a fixture never counts toward a department or Other
 * (it lives under Packages & Assemblies, `packagesTile`); the thumbnail is
 * the highest-ranked browsable part with an image.
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
    if (!e.browsable || e.kind !== "part") continue;
    const deptId = catMap.get(e.category) ?? OTHER_DEPT.id;
    const bucket = buckets.get(deptId)!;
    bucket.count++;
    if (imageIdOf(e.key) && (!bucket.best || e.rank > bucket.best.rank)) bucket.best = e;
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
