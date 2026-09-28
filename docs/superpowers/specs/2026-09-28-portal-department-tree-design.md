# Portal department tree — browse the catalog by department

Date: 2026-09-28 · Branch `feat/portal-depts` (off `origin/main` 46a384e8) · Punch **#251** (provisional — recompute
from `origin/main` right before docs).

Jeff (2026-09-27, #245 brainstorm): *"I think we can filter by Manufacturer then by category … We could also do the
department tree long term but for now I think the first approach will be enough."* 2026-09-28: *"go ahead with the
department tree"*. Decisions below were made without asking and are logged in DECISIONS.

## Picks

1. **Departments are a named grouping of catalog categories**, edited by staff at **Catalog → Departments**
   (`/catalog/departments`, beside Catalog → Device types). A department = `{ id, name, categories: string[] }`,
   ordered. A category belongs to at most one department. Stored as one settings blob `portal_departments`
   (`{ departments: Department[] }`), like the other small editable lists.
2. **Unassigned categories fall into an automatic "Other" department** in the portal (not stored), so nothing
   quotable disappears when a new category appears in a price book. "Other" is hidden when empty.
3. **No departments configured → the portal browses exactly as today** (search + Manufacturer/Category facets).
   The tree is additive.
4. **Suggested starter set**: the editor offers "Start from suggestions" when the list is empty — Rigging (hoists,
   blocks, arbors, rope locks, track, pipe…), Lighting (fixtures, lamps, fixture assemblies), Cable & Connectors,
   Atmospherics, Hardware, Drapery — matched case-insensitively against the categories that actually exist in the
   catalog; unmatched suggestion categories are dropped, and staff review before saving. Nothing is auto-saved.
5. **Portal landing** (no search, no filters): department tiles above the browsable grid — name, count of browsable
   items, and a thumbnail from the department's top-ranked browsable part that has an image. Clicking a tile sets
   `?dept=<id>`: results restrict to that department's categories; the Category facet lists only those categories;
   Manufacturer facets narrow as today; a breadcrumb "All departments › Rigging" clears it. Search inside a
   department searches only that department; the search box offers "Search all departments" when a department is
   active and the query has no hits there.
6. **Fixture assemblies** belong to the department that holds the "Fixture assemblies" pseudo-category (the index
   already files them under category "Fixture assemblies"); the suggestion puts it under Lighting.
7. **Staff editor**: list of departments (rename, reorder ↑/↓, delete), each with a category multi-select showing
   every catalog category with its part count and which department currently holds it; saving validates (names
   1–40 chars unique, ≤ 30 departments, a category in at most one department). Permission: the same one Catalog →
   Device types uses for editing. Saving invalidates the portal index.

## Changes

- `src/lib/portal-departments.ts` (pure): `Department`, `sanitizeDepartments(raw, knownCategories)` → `{ ok, value
  | error }`, `departmentOfCategory(depts)` → `Map<category, deptId>`, `OTHER_DEPT = { id: "other", name: "Other" }`,
  `suggestDepartments(categories: string[])` → `Department[]`, `restrictToDept(entries, deptId, map)`.
- `src/lib/stores/portal-departments.ts`: `getDepartments()` / `saveDepartments(value, by)` over the settings blob.
- Portal index (`src/lib/portal-catalog-index.ts`): expose the category → department map and per-department tiles
  (`{ id, name, count, imageId }`) computed at index build; invalidated on department save.
- `src/lib/portal-search.ts`: `SearchQuery.dept?: string` — filter `base` by department before facets (so facets
  and counts reflect the department); pure, tested.
- Portal catalog page/client (`src/app/portal/catalog/*`): parse `?dept=` (validated against known ids + "other"),
  tiles on the landing, breadcrumb, "Search all departments" affordance; preview works (read-only anyway).
- Staff: `src/app/(app)/catalog/departments/{page.tsx,editor.tsx,actions.ts}` + a link from the Catalog page header
  next to Device types.

## Tests

`sanitizeDepartments` (dup names, category in two departments, unknown category dropped, limits);
`suggestDepartments` against a sample category list; `searchCatalog` with `dept` (results, facets, Other bucket);
tiles (counts, image pick, Other hidden when empty); editor save → index invalidated; smoke `/portal/catalog?dept=x`,
`/catalog/departments`.

## Out of scope

Nested sub-departments (categories already give the second level), per-department hero images uploaded by staff,
reordering categories inside a department.
