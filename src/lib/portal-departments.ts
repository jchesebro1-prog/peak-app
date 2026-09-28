import type { SearchEntry } from "@/lib/portal-search";

/**
 * Portal department tree (#251, spec picks 1–7). Pure — no DB, no server
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
 * wherever else it lived, per #251 controller decision). `knownCategories`
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
      while (ids.has(candidate) || candidate === OTHER_DEPT.id) candidate = `${base}-${n++}`;
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
 *  (spec pick: "Invalid ?dept= is ignored, no error"). */
export function resolveDept(departments: readonly Department[], deptId: string | null | undefined): { id: string; name: string } | null {
  if (!deptId) return null;
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

/* ------------------------- suggested starter set ------------------------- */

type StarterRule = { id: string; name: string; re: RegExp };

/** Spec pick 4's exact starter set. Order is match precedence — a category
 *  matching more than one rule (e.g. a curtain "Track" also reading as
 *  rigging track) goes to whichever rule comes first, so a single "Start
 *  from suggestions" click never produces two departments claiming the same
 *  category (which sanitizeDepartments would then refuse to save). */
const STARTERS: readonly StarterRule[] = [
  { id: "rigging", name: "Rigging", re: /\b(hoists?|blocks?|arbors?|rope ?locks?|tracks?|pipes?|trusses?|rigging|winch(es)?|battens?|shackles?|slings?)\b/i },
  { id: "lighting", name: "Lighting", re: /\b(fixtures?|lamps?|fixture assemblies|luminaires?|dimmers?|dimming|lighting)\b/i },
  { id: "cable-connectors", name: "Cable & Connectors", re: /\b(cables?|cabling|connectors?|adapters?|wire|wiring)\b/i },
  { id: "atmospherics", name: "Atmospherics", re: /\b(fog|haze|hazers?|smoke|atmospherics?)\b/i },
  { id: "hardware", name: "Hardware", re: /\b(hardware|clamps?|mounts?|brackets?|hooks?|fasteners?)\b/i },
  { id: "drapery", name: "Drapery", re: /\b(drapes?|drapery|curtains?|scrims?|velour|masking|cycloramas?)\b/i },
];

/**
 * Matches the given catalog categories against the starter set
 * case-insensitively; a category matches at most one starter (first rule
 * wins). Unmatched categories are dropped (spec pick 4); a starter with
 * nothing matched is left out entirely, so "Start from suggestions" never
 * offers an empty department. Nothing is saved here — the caller (editor)
 * shows the result for staff review.
 */
export function suggestDepartments(categories: readonly string[]): Department[] {
  const buckets = new Map<string, string[]>();
  for (const cat of categories) {
    if (typeof cat !== "string" || !cat.trim()) continue;
    const hit = STARTERS.find((s) => s.re.test(cat));
    if (!hit) continue;
    const arr = buckets.get(hit.id) ?? [];
    arr.push(cat);
    buckets.set(hit.id, arr);
  }
  const out: Department[] = [];
  for (const s of STARTERS) {
    const cats = buckets.get(s.id);
    if (cats && cats.length) out.push({ id: s.id, name: s.name, categories: cats });
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
  const groups: Array<{ id: string; name: string }> = [...departments.map((d) => ({ id: d.id, name: d.name })), OTHER_DEPT];
  const out: DeptTileVM[] = [];
  for (const g of groups) {
    const filter = departmentFilterFor(departments, g.id);
    if (!filter) continue;
    const members = entries.filter((e) => e.browsable && matchesDeptFilter(e.category, filter));
    if (!members.length) continue;
    let best: DeptTileSource | null = null;
    for (const e of members) {
      if (e.kind !== "part") continue;
      if (!imageIdOf(e.key)) continue;
      if (!best || e.rank > best.rank) best = e;
    }
    out.push({ id: g.id, name: g.name, count: members.length, imageId: best ? imageIdOf(best.key) : null });
  }
  return out;
}
