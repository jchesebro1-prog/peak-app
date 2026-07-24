# The Grid — D113 Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute Jeff's decided backlog (DECISIONS.md D113 items 3, 5, 6, 7, 9, 10, 11) in his priority order: per-space schedule document → labor auto-suggest → venue link + tier stamping → riser print → repairs on Schedule → today-sheet team toggle → delivered-stays-open sweep.

**Architecture:** Documents ride the letters' `.pk-doc-page` + PrintButton foundation. Labor suggestions are data-driven off the catalog's `role`/`discipline` fields with hours from the pricing-rules blob (`frac()`), computed by a pure lib shared client/server. Tier stamping reuses `lib/pricing-tiers.resolveTier` (D87). Everything else is wiring inside existing modules.

**Tech Stack:** existing app; no new collections; branch `grid-backlog` off merged main.

## Global Constraints

- D107–D113 conventions hold (normalized geometry, server-action writes, no prompt(), decision-log entries).
- Documents show NO prices unless stated — the schedule is a field document.
- Commit per item; D114+ decision entries where behavior is chosen; verify each live before moving on.

---

### Task 1: Per-space equipment schedule document (D113.3)

**Files:** Create `src/app/(app)/design/grid/[id]/schedule/page.tsx`; Modify `editor.tsx` (header link "Schedule →").

**Behavior:** Print-styled document (`.pk-doc-page`, PrintButton, letterhead-free simple header): project name · customer · date · sheet count. For each space (project order): heading (name + sheet), table of qty / SKU / description; then "Unassigned" if any; then "Wire runs" section (part, from → to space, measured length — from riserGraph edges); footer totals (device count, wire footage per part). **No prices.** Empty state when nothing painted.

- [ ] Page + link; verify in browser (GRD-5002 shows Stage/House tables + both wire runs); print CSS sane (via read_page/screenshot).
- [ ] Commit.

### Task 2: Labor auto-suggest from painted devices (D113.5)

**Files:** Create `src/lib/design/grid-labor.ts` (+ tests in `scripts/test-review-and-spec.ts`); Modify `[id]/actions.ts` (quote action accepts labor lines), `editor.tsx` (BOM panel "Labor (suggested)" section), `[id]/page.tsx` (pass labor parts + hours rule).

**Produces (pure):**
```ts
export type LaborSuggestion = { partId: string; desc: string; rate: number; hours: number; discipline: string };
export function suggestLabor(
  placements: Array<{ partId: string }>,
  parts: PartLite[],                       // full catalog incl. labor rows (role/discipline via LaborPart shape below)
  laborParts: Array<PartLite & { discipline?: string; role?: string }>,
  hoursPerDevice: number                   // pricing-rules frac("grid.laborHoursPerDevice", 0.5)
): LaborSuggestion[];
// device categories → discipline by keyword (light→LIG, audio→AUD, video→VID, else RIG);
// labor part = role "labor" matching discipline, else any role "labor"; hours = deviceQty × hoursPerDevice
// (rounded up to the half hour); wire, labor, and fabric rows excluded from the device count.
```
**Quote integration:** editor collects included suggestions (checkbox, editable hours) → `createDraftQuoteAction(projectId, laborLines?: Array<{partId, hours}>)`; server validates part exists + role "labor", prices `hours × list`, appends `{sku, desc, qty: hours, unit: "hr", …}` lines to spec + totals. Suggestions default-included.

- [ ] Tests → FAIL → implement → PASS.
- [ ] Wire UI + action; verify live (suggestions appear for GRD-5002's lifts+supers → quote updates with labor lines).
- [ ] Commit + decision note (D114): heuristic discipline mapping + single hours-per-device rule, refine when real data demands.

### Task 3: Venue link + tier stamping on Grid quotes (D113.6)

**Files:** Modify `stores/grid-projects.ts` (`siteId?`, `siteName?` on GridProject + `setVenue`), `grid/actions.ts` + `grid/page.tsx` (venue select on create form — sites of the chosen company), `[id]/page.tsx`/`editor.tsx` (venue shown in header; picker if unset), `[id]/actions.ts` (quote mint: `locationId` from site, `pricingTier`/`tierMargin` via `resolveTier(customerId)`).

- [ ] Implement; verify live: new project with venue → quote carries locationId + tier stamp (inspect quote doc via /quotes drawer or store probe).
- [ ] Commit.

### Task 4: Riser print output (D113.7)

**Files:** Modify `[id]/riser/page.tsx` — wrap in `.pk-doc-page` print styling + PrintButton + document header (project/customer/date).

- [ ] Implement; verify screen + print media render; commit.

### Task 5: Repairs on the Schedule board (D113.9)

**Files:** recon `src/lib/operations-work.ts` first — if repair jobs are already a work type, this is enabling/wiring; else add repair visits alongside flame visits (mirror the flame path). Modify Schedule aggregation + board rendering as the recon dictates.

- [ ] Recon; implement minimal parity (repair scheduled visits appear as blocks with their type badge); test:specs (operations-work has tests); verify live on /schedule; commit.

### Task 6: /flame-tests/today team toggle (D113.10)

**Files:** Modify the today page — default personal; `?scope=team` renders everyone's day grouped by tech; toggle control in the header.

- [ ] Implement; verify both modes; commit.

### Task 7: Delivered-stays-open sweep (D113.11)

**Files:** grep engagement `status === "active"` filters (design overview, consulting dashboards, nav counts); open = `status !== "oversight_complete"` (helper `isOpenEngagement` in stores/engagements to prevent drift). Keep labels showing the real status.

- [ ] Sweep + helper; test:specs; verify Consulting dashboard counts; commit.

### Task 8: Close out

- [ ] Full test:specs + build; merge `grid-backlog` → main; D-log entries final; memory capture.
