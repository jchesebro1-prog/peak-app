# Quote Intake + Estimator Entry Flow Implementation Plan (#160, #161)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "+ New quote" carry the company through a searchable intake into every builder, with an optional name, venue and contact. Add rename, a warning before editing a won quote, a drafts-only "Change type", and rapid catalog adds in the Estimator. Labor opens with one mobilization.

**Architecture:** The URL hand-off between `/quotes/new` and the six builders is centralized in two pure modules. `quotes/new/types.ts` builds the URL (`builderPath` gains an options object). A new `quotes/new/handoff.ts` reads and validates it and holds every other pure rule this feature adds: venue/contact fallback, line counts, same-builder test, confirm copy. Each builder's server `page.tsx` uses `readHandoff()` on a new quote only. Each builder's create path calls one store helper, `retireReplacedDraft()`, which soft-deletes the replaced draft. A small shared client module (`src/components/quote-flow-controls.tsx`) provides the "Change type" control and the won-quote confirm hook. #161 is a pure change in `estimator/labor-defaults.ts` plus a one-line rewire in the Estimator client.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle doc-store on PGlite (dev) / Neon (prod). Tests use the repo's own `ok()` harness in `scripts/test-review-and-spec.ts`; there is no jest or vitest. Route smoke is `scripts/smoke-routes.ts`.

**Spec:** `docs/superpowers/specs/2026-09-23-quote-intake-and-estimator-flow-design.md` · **Punch:** `PUNCHLIST.md` §160, §161 · **Decisions to log:** D205, D206, D207.

## Global Constraints

- **Port faithfully / copy is fixed.** Use these strings verbatim:
  - Won-edit confirm: `This quote is won — its project/job keeps the old <field>. Change the quote anyway?` (`<field>` ∈ `customer` | `venue` | `contact`)
  - Disabled Change-type hint: `Already sent — start a new quote instead.`
  - Replace confirm: `<id> and its <n> lines will be replaced` (singular `line` when n = 1), followed by `. Continue?`
  - Added toast: `✓ Added <qty> × <desc>`
  - Blank-name system fallback: `<Customer> — System`; custom: `<Customer> — <category>`
- **Handoff params apply to a NEW quote only.** An explicit `?id=` always wins, the same rule the existing `preCustomer` handling follows.
- **A venue id that is not on the customer, or a contact name that is not on the customer, is ignored.** The builder then falls back to what it does today: primary venue/contact for estimator, flame, repair, inspection and rental, and blank for consulting.
- **Rental has no venue.** `builderPath` never emits `venue` for `rental`.
- **No new quote status.** Change type soft-deletes the old draft through the existing `remove()` (`softDeleteDoc`). It does not mark it `lost` (D205).
- **The old draft is retired only on the replacement's FIRST save, server-side, re-checked as `status === "draft"`.**
- **Won-edit is a warning, not a block.** Name edits never warn (D206).
- **Server actions keep their existing gate** (`requireUser()` in every file touched here; rentals' approve keeps `requirePerm("send")`). No new gates, no weakened gates.
- **No schema or migration change.** Everything rides the existing quote doc.
- **Out of scope (do not touch):** the ~12 other bespoke customer `<select>`s, type change on sent quotes, syncing edits into spawned projects/jobs, `quotes/page.tsx`'s `editHrefFor`.

**Environment rules for every task**
- **PGlite is single-process.** Before any gate, run `ps aux | grep -E "tsx|next dev" | grep -v grep` and make sure nothing in *this* checkout is holding `.data/pglite`. Never run a `tsx` script or dev server at the same time as a gate. `npm run test:specs` creates its own scratch datadir (`TEST_DB=$(mktemp -d) && PGLITE_PATH=…`). The suite refuses to run without `PGLITE_PATH` and refuses to run with `DATABASE_URL` (D202). `npm run test:smoke` boots its own `next dev` on its own scratch datadir. Both are safe on their own, but never in parallel with each other or with a dev server.
- **Never `git stash`.** One stash is shared across every worktree and has destroyed other agents' work. Record lint baselines by running eslint *before* your first edit in a task.
- **Worktree trap:** a fresh worktree has no `node_modules`, `next-env.d.ts` or `.env.local`. Run `npm ci` (never symlink `node_modules`, because Turbopack panics). `npx tsc` without `node_modules` fakes a pass.
- **Baselines (re-measure before Task 1, don't quote blind):** tsc 0 errors. test:specs was **1898 PASS / 0 FAIL** after D204. test:smoke ALL PASSED. eslint repo-wide has 0 errors and about 120 warnings, so any new *error* is a regression. New assertions must PASS and FAIL must stay 0.
- Node is at `~/.local/node/bin`.

**The four gates (run at the end of every task, in this order, and report real numbers):**
```bash
npx tsc --noEmit; echo "TSC=$?"
npm run test:specs 2>&1 | tail -4
npm run test:smoke 2>&1 | tail -6
npx eslint <this task's touched files>; echo "ESLINT=$?"
```
Expected: `TSC=0`; `ALL PASSED` with the PASS count up by this task's new assertions; smoke `ALL PASSED`; eslint problem count on touched files ≤ the baseline you recorded in Step 0 of the task, with 0 errors.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/(app)/estimator/labor-defaults.ts` (modify) | #161: `MOB_DEFAULTS` becomes a per-type lookup. Adds `mobDefaultsFor`, `applyMobType`. `defaultLaborMobs` returns one blank row. |
| `src/app/(app)/quotes/new/types.ts` (modify) | `BUILDER_BASE` map. `builderPath(type, customerId, opts)` emits `category/name/venue/contact/replaces`. `IntakeSubmit` gains `name`, `replaces`. |
| `src/app/(app)/quotes/new/handoff.ts` **(new, pure)** | `readHandoff`, `pickVenueId`, `pickContactName`, `seedVenueOn`, `intakeInitial`, `quoteServiceType`, `quoteEditPath`, `quoteContactName`, `quoteLineCount`, `sameBuilder`, `canChangeType`, `replaceConfirmMessage`, `wonEditMessage`, `systemQuoteName`, `CHANGE_TYPE_DISABLED_HINT`, types `Handoff`, `IntakeInitial`, `IntakeReplacing`, `WonEditField`. No store/React imports. |
| `src/lib/stores/quotes.ts` (modify) | `retireReplacedDraft(id, replacementId)` next to `remove()` (line 695). |
| `src/app/(app)/quotes/new/page.tsx`, `intake-form.tsx`, `actions.ts` (modify) | Reads handoff/replaces. Uses `CustomerCombobox`. Adds the Quote-name input. Adds the replace confirm. Forwards name/venue/contact/replaces. |
| `src/app/(app)/companies/[id]/page.tsx:322` (modify) | "+ New quote" → `/quotes/new?customer=<id>`. |
| `src/components/customer-combobox.tsx` (modify) | Optional `canChange(id)` veto so a refused won-edit doesn't leave the input showing the new name. |
| `src/components/quote-flow-controls.tsx` **(new, client)** | `ChangeTypeControl`, `useWonEditGuard`. |
| `src/app/(app)/estimator/{page.tsx,types.ts,actions.ts,estimator-client.tsx}` (modify) | Handoff seeding + fallback name. Click-to-edit title (`updateQuoteMetaAction` gains `name`). Save uses current name and `replaces`. Won guard. Change type. |
| `src/app/(app)/{flame-tests,repairs,inspections,rentals}/quote/{page.tsx,controls.tsx,actions.ts}` (modify) | Handoff seeding. `status`/`replaces` on `BuilderInitial`. Won guard (not rental). Change type. `replaces` in `buildForm` and `persist`. |
| `src/app/(app)/design/engagements/quote/{page.tsx,controls.tsx,actions.ts}` (modify) | Same for consulting (prop `pre` replaces `preCustomerId`). |
| `src/app/(app)/estimator/{pricing.ts,catalog-picker.tsx,section-card.tsx,estimator-client.tsx}` (modify) | `parseAddQty`. Per-row qty box. Picker stays open. `✓ Added` line. `× Close`. `addPart` takes qty. |
| `scripts/test-review-and-spec.ts` (modify) | New assertions (pure at module level; store helper in a new async function chained onto `seeded()`). Update the D136 five-row assertion. |
| `scripts/smoke-routes.ts` (modify) | Hand-off GET routes for intake and all six builders. |
| `PUNCHLIST.md`, `DECISIONS.md` (modify, last task) | #160/#161 → DONE; append D205–D207. |

---

## Task 1: Labor opens with one mobilization; D136 values become per-type defaults (#161)

**Files:**
- Modify: `src/app/(app)/estimator/labor-defaults.ts` (whole file, 47 lines)
- Modify: `src/app/(app)/estimator/estimator-client.tsx:68` (import), `:1318-1326` (`setMobNameSelect`)
- Test: `scripts/test-review-and-spec.ts:197` (import) and `:250-256` (existing D136 assertions)

**Interfaces:**
- Produces: `MOB_DEFAULTS: Record<string, { people: string; days: string }>`, `mobDefaultsFor(name: string): { people: string; days: string }`, `applyMobType(m: MobDraft, name: string): MobDraft`, `defaultLaborMobs(travel: TravelLite | null): MobDraft[]` (now length 1). `laborMob` and `disciplineForSystemTitle` are unchanged.

- [ ] **Step 0: Record the lint baseline**

```bash
npx eslint "src/app/(app)/estimator/labor-defaults.ts" "src/app/(app)/estimator/estimator-client.tsx" 2>&1 | tail -2
```
Write down the problem count.

- [ ] **Step 1: Write the failing test**

In `scripts/test-review-and-spec.ts`, change line 197 to:
```ts
import { applyMobType, defaultLaborMobs, disciplineForSystemTitle, laborMob, mobDefaultsFor } from "@/app/(app)/estimator/labor-defaults";
```
Replace lines 250-256 (from `const defaultMobs = defaultLaborMobs(null);` through the `computeLabor` line) with:
```ts
const defaultMobs = defaultLaborMobs(null);
ok(defaultMobs.length === 1, "#161 labor opens with exactly one mobilization");
ok(defaultMobs[0].name === "" && defaultMobs[0].people === "1" && defaultMobs[0].days === "1", "#161 the one opening row is a blank type at 1 person x 1 day");
ok(
  ["Site Visit", "Install", "Hang", "Commissioning", "Training"].map((n) => `${n}:${mobDefaultsFor(n).people}x${mobDefaultsFor(n).days}`).join("|") ===
    "Site Visit:1x1|Install:4x5|Hang:2x3|Commissioning:2x3|Training:1x1",
  "#161 the D136 values survive as per-type crew x day defaults"
);
const pickedInstall = applyMobType(defaultMobs[0], "Install");
ok(pickedInstall.name === "Install" && pickedInstall.people === "4" && pickedInstall.days === "5", "#161 picking Install on an untouched blank row fills 4x5");
const pickedHang = applyMobType(pickedInstall, "Hang");
ok(pickedHang.people === "2" && pickedHang.days === "3", "#161 switching type on still-default numbers refills from the new type");
const touched161 = applyMobType({ ...pickedInstall, people: "6" }, "Hang");
ok(touched161.name === "Hang" && touched161.people === "6" && touched161.days === "5", "#161 numbers the user edited are never overwritten by a type pick");
const custom161 = applyMobType({ ...laborMob(null, "Rig day"), nameCustom: true }, "Install");
ok(custom161.people === "1" && custom161.days === "1", "#161 a custom-named row keeps its numbers when a type is picked");
ok(applyMobType(defaultMobs[0], "Install").nameCustom === false, "#161 picking a listed type clears the custom flag");
const installMob = laborMob(null, "Install", "4", "5");
const testRate = ((sku: string) => ({ "RIG-LBR": 50, "RIG-OT": 75, "RIG-SUP": 75, "DRF-SUB": 50 }[sku] || 0)) as any;
const day10 = computeMob({ ...installMob, hoursPerDay: "10" }, "RIG", testRate);
ok(day10.reg === 160 && day10.otHrs === 40, "hours beyond 8 per day become crew overtime");
ok(day10.supHrs === 40 && day10.regCost === 9000, "the first person is the supervisor within the crew, not an added worker");
const laborCalc = computeLabor({ discipline: "RIG", margin: "30", mobs: [installMob], pmHrs: "", pmAuto: true, shopHrs: "", drfHrs: "", drfAuto: true, misc: "" }, testRate);
```
(The two `laborCalc` assertions that follow, at the old lines 257-258, stay as they are. The computeMob/computeLabor expectations are unchanged because `installMob` is the same 4×5 row that `defaultMobs[1]` used to be.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#161|FAILED|PASSED" | head -20`
Expected: tsx compile error `applyMobType` / `mobDefaultsFor` is not exported (or FAIL on `#161 labor opens with exactly one mobilization`).

- [ ] **Step 3: Implement**

Replace lines 1-9 and 45-47 of `src/app/(app)/estimator/labor-defaults.ts` so that the file reads:
```ts
import type { MobDraft, TravelLite } from "./types";

/**
 * Crew-size × days defaults per mobilization type. D136 opened Labor with
 * these five as pre-filled rows; D207 (#161, Jeff 2026-09-23) made them what
 * they were meant to be — the numbers a type pick fills in.
 */
export const MOB_DEFAULTS: Record<string, { people: string; days: string }> = {
  "Site Visit": { people: "1", days: "1" },
  Install: { people: "4", days: "5" },
  Hang: { people: "2", days: "3" },
  Commissioning: { people: "2", days: "3" },
  Training: { people: "1", days: "1" },
};

const BLANK_MOB = { people: "1", days: "1" } as const;

const isListedType = (name: string) => Object.prototype.hasOwnProperty.call(MOB_DEFAULTS, name);

/** The defaults for a type; a blank or unknown name is 1 × 1. */
export function mobDefaultsFor(name: string): { people: string; days: string } {
  return isListedType(name) ? MOB_DEFAULTS[name] : { ...BLANK_MOB };
}
```
(keep `disciplineForSystemTitle` and `laborMob` exactly as they are) and replace `defaultLaborMobs` with:
```ts
/** Labor opens with ONE blank mobilization (D207) — "+ Add mobilization" adds more. */
export function defaultLaborMobs(travel: TravelLite | null): MobDraft[] {
  return [laborMob(travel)];
}

/**
 * Picking a type from the "Select type…" list. People/days are refilled from
 * the new type's defaults ONLY while they still equal the previous type's
 * defaults (1 × 1 for a blank row) — anything the user typed is kept. A row
 * that carried a custom name has no "previous default", so it keeps its numbers.
 */
export function applyMobType(m: MobDraft, name: string): MobDraft {
  const wasCustom = m.nameCustom || (!!m.name && !isListedType(m.name));
  const prev = wasCustom ? null : mobDefaultsFor(m.name);
  const untouched = !!prev && m.people === prev.people && m.days === prev.days;
  const next: MobDraft = { ...m, name, nameCustom: false };
  if (!untouched) return next;
  const d = mobDefaultsFor(name);
  return { ...next, people: d.people, days: d.days };
}
```

In `estimator-client.tsx` line 68 change the import to:
```ts
import { applyMobType, defaultLaborMobs, disciplineForSystemTitle, laborMob } from "./labor-defaults";
```
and replace `setMobNameSelect` (lines 1318-1326) with:
```ts
  const setMobNameSelect = (idx: number, val: string) =>
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) => {
        if (i !== idx) return m;
        if (val === "__custom__") return { ...m, nameCustom: true, name: "" };
        return applyMobType(m, val);
      }),
    }));
```
`addMob` (line 1307) already adds exactly one `laborMob(travelEstNow())`. Leave it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#161|FAIL" | head -20`
Expected: every `#161` line PASS, no FAIL.

- [ ] **Step 5: Run the four gates** (see Global Constraints). Touched files: `labor-defaults.ts`, `estimator-client.tsx`, `scripts/test-review-and-spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/labor-defaults.ts" "src/app/(app)/estimator/estimator-client.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(estimator): labor opens with one mobilization; D136 values become per-type defaults (#161)"
```

---

## Task 2: Pure hand-off helpers and `builderPath` options

**Files:**
- Modify: `src/app/(app)/quotes/new/types.ts:99-123` (`builderPath`) and `:151-170` (`IntakeSubmit`)
- Create: `src/app/(app)/quotes/new/handoff.ts`
- Modify: `src/app/(app)/quotes/new/actions.ts:97` (the one existing caller; adapt the signature only)
- Test: `scripts/test-review-and-spec.ts` (module level, new block after the Task 1 block)

**Interfaces:**
- Produces (types.ts): `BUILDER_BASE: Record<ServiceType, string>`, `type BuilderPathOpts = { category?: string; name?: string; venue?: string; contact?: string; replaces?: string }`, `builderPath(type: ServiceType, customerId: string, opts?: BuilderPathOpts): string`. `IntakeSubmit` gains `name: string; replaces: string`.
- Produces (handoff.ts): exactly the signatures in Step 3.

- [ ] **Step 0: Record the lint baseline** for `types.ts` and `actions.ts` in `quotes/new`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-review-and-spec.ts`, directly after the Task 1 block:
```ts
/* --- #160: quote intake → builder hand-off (pure) --- */
import { builderPath, SERVICE_TYPES, BUILDER_BASE } from "@/app/(app)/quotes/new/types";
import {
  readHandoff, pickVenueId, pickContactName, seedVenueOn, intakeInitial, quoteServiceType, quoteEditPath,
  quoteContactName, quoteLineCount, sameBuilder, canChangeType, replaceConfirmMessage, wonEditMessage,
  systemQuoteName, CHANGE_TYPE_DISABLED_HINT,
} from "@/app/(app)/quotes/new/handoff";
{
  const params160 = (href: string) => new URL(href, "http://x").searchParams;
  for (const t of SERVICE_TYPES.map((s) => s.key)) {
    const href = builderPath(t, "lakefront", { name: "Main Hall refit", venue: "lf2", contact: "Tom Reyes", replaces: "Q-2041", category: "Acoustics" });
    const p = params160(href);
    ok(href.startsWith(BUILDER_BASE[t] + "?"), `#160 builderPath(${t}) targets its builder`);
    ok(p.get("customer") === "lakefront" && p.get("name") === "Main Hall refit" && p.get("contact") === "Tom Reyes" && p.get("replaces") === "Q-2041", `#160 builderPath(${t}) carries customer, name, contact and replaces`);
    ok(t === "rental" ? !p.has("venue") : p.get("venue") === "lf2", `#160 builderPath(${t}) ${t === "rental" ? "drops venue (rental has none)" : "carries the venue id"}`);
    ok(t === "custom" ? p.get("category") === "Acoustics" : !p.has("category"), `#160 builderPath(${t}) sends category only for custom`);
  }
  ok(builderPath("system", "lakefront") === "/estimator?customer=lakefront", "#160 builderPath with no options is unchanged");
  ok(builderPath("repair", "") === "/repairs/quote", "#160 builderPath with no customer has no query string");
  ok(!params160(builderPath("system", "c1", { name: "   " })).has("name"), "#160 a blank quote name is not forwarded");

  const h = readHandoff({ customer: " lakefront ", name: ["Studio refit", "x"], venue: "lf2", contact: "Tom Reyes", replaces: "Q-2041", type: "repair", category: "" });
  ok(h.customerId === "lakefront" && h.name === "Studio refit" && h.venueId === "lf2" && h.contactName === "Tom Reyes" && h.replaces === "Q-2041" && h.type === "repair", "#160 readHandoff trims and takes the first of repeated params");
  ok(readHandoff({}).customerId === "" && readHandoff({}).replaces === "", "#160 readHandoff of nothing is all blanks");

  const cust160 = {
    id: "lakefront",
    locations: [{ id: "lf1", primary: true }, { id: "lf2", primary: false }],
    contacts: [{ name: "Dana Whitlock", primary: true }, { name: "Tom Reyes", primary: false }],
  };
  ok(pickVenueId(cust160, "lf2") === "lf2", "#160 a venue on the customer is honoured");
  ok(pickVenueId(cust160, "nope") === "lf1", "#160 an unknown venue id falls back to the primary");
  ok(pickVenueId(cust160, "nope", false) === "", "#160 without fallback an unknown venue id is blank");
  ok(pickVenueId({ locations: [] }, "lf1") === "", "#160 a customer with no venues yields no venue");
  ok(pickContactName(cust160, "Tom Reyes") === "Tom Reyes", "#160 a contact on the customer is honoured");
  ok(pickContactName(cust160, "Stranger") === "Dana Whitlock", "#160 an unknown contact falls back to the primary");
  ok(pickContactName(cust160, "Stranger", false) === "", "#160 without fallback an unknown contact is blank");
  const on160 = seedVenueOn(cust160.locations, "lf2");
  ok(on160.lf2 === true && on160.lf1 === false, "#160 a forwarded venue is the only venue switched on");
  const onDefault160 = seedVenueOn(cust160.locations, "");
  ok(onDefault160.lf1 === true && onDefault160.lf2 === false, "#160 with no forwarded venue the primary is on (unchanged rule)");
  const onNoPrimary160 = seedVenueOn([{ id: "a", primary: false }, { id: "b", primary: false }], "zzz");
  ok(onNoPrimary160.a === true && onNoPrimary160.b === false, "#160 no primary and an unknown venue → first venue on");

  const dir160 = [{ id: "lakefront", name: "Lakefront PAC", type: "", locations: [{ id: "lf1", label: "Main Hall", city: "", state: "", primary: true }], contacts: [{ name: "Dana Whitlock", role: "", primary: true }] }];
  const ii = intakeInitial({ type: "flame_test", category: "", customerId: "lakefront", venueId: "lf1", contactName: "Dana Whitlock", name: "Q name" }, dir160);
  ok(ii.type === "flame_test" && ii.customerId === "lakefront" && ii.locationId === "lf1" && ii.contactName === "Dana Whitlock" && ii.name === "Q name", "#160 intakeInitial keeps a valid customer, venue and contact");
  const bad = intakeInitial({ type: "bogus", category: "", customerId: "ghost", venueId: "lf1", contactName: "Dana Whitlock", name: "" }, dir160);
  ok(bad.type === "system" && bad.customerId === "" && bad.locationId === "" && bad.contactName === "", "#160 intakeInitial ignores an unknown customer id (form starts blank) and an unknown type");
  const badVenue = intakeInitial({ type: "repair", category: "", customerId: "lakefront", venueId: "zz", contactName: "Nobody", name: "" }, dir160);
  ok(badVenue.customerId === "lakefront" && badVenue.locationId === "" && badVenue.contactName === "", "#160 intakeInitial drops a venue/contact that isn't on the customer");

  ok(quoteServiceType({}) === "system" && quoteServiceType({ category: "Acoustics" }) === "custom" && quoteServiceType({ quoteType: "flame_test" }) === "flame_test", "#160 quoteServiceType maps estimator, custom and typed quotes");
  ok(quoteServiceType({ quoteType: "weird" }) === "system", "#160 an unknown quoteType is treated as a system quote");
  ok(quoteEditPath({ id: "Q-1", quoteType: "repair" }) === "/repairs/quote?id=Q-1" && quoteEditPath({ id: "Q-2" }) === "/estimator?id=Q-2", "#160 quoteEditPath opens each type in its own builder");
  ok(quoteContactName({ contactName: "A" }) === "A" && quoteContactName({ contact: { name: "B" } }) === "B" && quoteContactName({}) === "", "#160 quoteContactName reads estimator and service contact shapes");
  ok(quoteLineCount({ spec: { sections: [{ items: [1, 2] }, { items: [3] }] } }) === 3, "#160 estimator lines are counted across systems");
  ok(quoteLineCount({ flameTest: { venues: [1, 2] } }) === 2 && quoteLineCount({ repair: { items: [1], parts: [1, 2] } }) === 3 && quoteLineCount({ rental: { lines: [1] } }) === 1 && quoteLineCount({ consulting: { scopes: [1, 2] } }) === 2, "#160 service quote lines are counted from their engine subdoc");
  ok(quoteLineCount({}) === 0, "#160 a quote with no lines counts 0");
  ok(sameBuilder("system", "custom") && sameBuilder("repair", "repair") && !sameBuilder("system", "repair"), "#160 system and custom share the Estimator, so switching between them is not a replace");
  ok(canChangeType("draft") && !canChangeType("sent") && !canChangeType("won") && !canChangeType("lost"), "#160 Change type is drafts-only");
  ok(CHANGE_TYPE_DISABLED_HINT === "Already sent — start a new quote instead.", "#160 disabled Change-type hint copy");
  ok(replaceConfirmMessage("Q-2041", 12) === "Q-2041 and its 12 lines will be replaced. Continue?" && replaceConfirmMessage("Q-9", 1) === "Q-9 and its 1 line will be replaced. Continue?", "#160 replace confirm names the quote and its line count");
  ok(wonEditMessage("venue") === "This quote is won — its project/job keeps the old venue. Change the quote anyway?", "#160 won-edit confirm copy");
  ok(systemQuoteName("Lakefront PAC", "") === "Lakefront PAC — System" && systemQuoteName("Lakefront PAC", " Acoustics ") === "Lakefront PAC — Acoustics" && systemQuoteName("", "") === "New estimate", "#160 blank-name fallback for Estimator quotes");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: compile failure because `@/app/(app)/quotes/new/handoff` does not exist and `BUILDER_BASE` is not exported.

- [ ] **Step 3: Implement**

In `src/app/(app)/quotes/new/types.ts`, replace lines 99-123 (the doc comment + `builderPath`) with:
```ts
/** Where each service type's builder lives, matching NewQuoteMenu's six hrefs
 *  ("custom" is a system quote with a user-named category, #110). */
export const BUILDER_BASE: Record<ServiceType, string> = {
  system: "/estimator",
  custom: "/estimator",
  flame_test: "/flame-tests/quote",
  repair: "/repairs/quote",
  inspection: "/inspections/quote",
  consulting: "/design/engagements/quote",
  rental: "/rentals/quote",
};

export type BuilderPathOpts = {
  /** #110 — only sent for the "custom" type. */
  category?: string;
  /** #160 — optional quote name; blank → the builder's own auto-name. */
  name?: string;
  /** #160 — customer location id; never sent to rental (no venue concept). */
  venue?: string;
  /** #160 — contact NAME (contacts have no id). */
  contact?: string;
  /** #160 / D205 — the draft this new quote replaces (Change type). */
  replaces?: string;
};

/** The builder URL for a NEW quote, pre-seeded from the intake (#160). Each
 *  builder reads these back with readHandoff() and applies them to a new quote
 *  only. */
export function builderPath(type: ServiceType, customerId: string, opts: BuilderPathOpts = {}): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | undefined) => {
    const t = (v || "").trim();
    if (t) p.set(k, t);
  };
  put("customer", customerId);
  if (type === "custom") put("category", opts.category);
  put("name", opts.name);
  if (type !== "rental") put("venue", opts.venue);
  put("contact", opts.contact);
  put("replaces", opts.replaces);
  const qs = p.toString();
  return BUILDER_BASE[type] + (qs ? "?" + qs : "");
}
```
In the same file add two fields to `IntakeSubmit` (after `category?: string;`):
```ts
  /** #160 — optional quote name; "" → the builder's auto-name. */
  name: string;
  /** #160 / D205 — the draft this intake replaces ("Change type"); "" otherwise. */
  replaces: string;
```

Create `src/app/(app)/quotes/new/handoff.ts`:
```ts
/**
 * #160 — the intake → builder hand-off, as pure functions. Imported by server
 * pages, client components and the spec suite alike, so it must stay free of
 * store / React / next imports.
 */
import { BUILDER_BASE, isServiceType, type IntakeCustomer, type ServiceType } from "./types";

type SP = Record<string, string | string[] | undefined>;

export type Handoff = {
  type: string;
  category: string;
  customerId: string;
  venueId: string;
  contactName: string;
  name: string;
  replaces: string;
};

const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/** Read the hand-off query params (builderPath's output, plus intake's ?type=). */
export function readHandoff(sp: SP): Handoff {
  return {
    type: first(sp.type),
    category: first(sp.category),
    customerId: first(sp.customer),
    venueId: first(sp.venue),
    contactName: first(sp.contact),
    name: first(sp.name),
    replaces: first(sp.replaces),
  };
}

type LocLike = { id: string; primary?: boolean };
type ContactLike = { name: string; primary?: boolean };

/** The venue id to open on: the forwarded one if it is on this customer, else
 *  (with fallback) the primary/first venue — the builders' existing rule. */
export function pickVenueId(cust: { locations: LocLike[] }, venueId: string, fallback = true): string {
  const locs = cust.locations || [];
  if (venueId && locs.some((l) => l.id === venueId)) return venueId;
  if (!fallback) return "";
  return (locs.find((l) => l.primary) || locs[0])?.id || "";
}

/** Same rule for the contact (matched by name). */
export function pickContactName(cust: { contacts: ContactLike[] }, name: string, fallback = true): string {
  const cs = cust.contacts || [];
  if (name && cs.some((c) => c.name === name)) return name;
  if (!fallback) return "";
  return (cs.find((c) => c.primary) || cs[0])?.name || "";
}

/** On/off for the multi-venue builders (flame, repair, inspection): a valid
 *  forwarded venue is the only one on; otherwise the existing rule — primary
 *  (or the only venue) on, else the first. */
export function seedVenueOn(locs: LocLike[], venueId: string): Record<string, boolean> {
  const on: Record<string, boolean> = {};
  if (venueId && locs.some((l) => l.id === venueId)) {
    locs.forEach((l) => (on[l.id] = l.id === venueId));
    return on;
  }
  locs.forEach((l) => (on[l.id] = !!l.primary || locs.length === 1));
  if (locs.length && !locs.some((l) => on[l.id])) on[locs[0].id] = true;
  return on;
}

export type IntakeInitial = {
  type: ServiceType;
  category: string;
  customerId: string;
  locationId: string;
  contactName: string;
  name: string;
};

export type IntakeReplacing = { id: string; type: ServiceType; lines: number; editPath: string };

/** Validate the intake's seed against the directory: an unknown customer →
 *  blank form; a venue/contact not on the customer → "skip" (no fallback —
 *  the intake's own default is skip, not primary). */
export function intakeInitial(
  seed: { type: string; category: string; customerId: string; venueId: string; contactName: string; name: string },
  customers: IntakeCustomer[]
): IntakeInitial {
  const cust = customers.find((c) => c.id === seed.customerId) || null;
  return {
    type: isServiceType(seed.type) ? seed.type : "system",
    category: seed.category,
    customerId: cust ? cust.id : "",
    locationId: cust ? pickVenueId(cust, seed.venueId, false) : "",
    contactName: cust ? pickContactName(cust, seed.contactName, false) : "",
    name: seed.name,
  };
}

/** Which intake card a stored quote corresponds to. */
export function quoteServiceType(q: { quoteType?: string; category?: string }): ServiceType {
  const t = q.quoteType || "";
  if (t && t !== "system" && t !== "custom" && isServiceType(t)) return t;
  return (q.category || "").trim() ? "custom" : "system";
}

export function quoteEditPath(q: { id: string; quoteType?: string; category?: string }): string {
  return BUILDER_BASE[quoteServiceType(q)] + "?id=" + encodeURIComponent(q.id);
}

/** Estimator quotes keep `contactName`; service quotes keep `contact.name`. */
export function quoteContactName(q: { contactName?: string; contact?: unknown }): string {
  if (q.contactName) return q.contactName;
  const c = q.contact;
  return c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string" ? (c as { name: string }).name : "";
}

/** Line count for the replace confirm — whatever the quote's builder calls a line. */
export function quoteLineCount(q: {
  spec?: unknown;
  flameTest?: unknown;
  repair?: unknown;
  inspection?: unknown;
  consulting?: unknown;
  rental?: unknown;
}): number {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const secs = obj(q.spec).sections;
  const specLines = Array.isArray(secs) ? secs.reduce((n: number, s) => n + len(obj(s).items), 0) : 0;
  return (
    specLines +
    len(obj(q.flameTest).venues) +
    len(obj(q.repair).items) +
    len(obj(q.repair).parts) +
    len(obj(q.inspection).venues) +
    len(obj(q.consulting).scopes) +
    len(obj(q.rental).lines)
  );
}

/** system and custom both build in the Estimator (category is editable in its
 *  header), so moving between them is not a replace. */
export function sameBuilder(a: ServiceType, b: ServiceType): boolean {
  return BUILDER_BASE[a] === BUILDER_BASE[b];
}

export const CHANGE_TYPE_DISABLED_HINT = "Already sent — start a new quote instead.";

/** D205 — only a draft's type can change. */
export function canChangeType(status: string): boolean {
  return status === "draft";
}

export function replaceConfirmMessage(id: string, lines: number): string {
  return `${id} and its ${lines} line${lines === 1 ? "" : "s"} will be replaced. Continue?`;
}

export type WonEditField = "customer" | "venue" | "contact";

/** D206 — warn, don't block. */
export function wonEditMessage(field: WonEditField): string {
  return `This quote is won — its project/job keeps the old ${field}. Change the quote anyway?`;
}

/** Blank-name fallback for a new Estimator quote that has a customer. */
export function systemQuoteName(customerName: string, category: string): string {
  const c = (customerName || "").trim();
  if (!c) return "New estimate";
  return `${c} — ${(category || "").trim() || "System"}`;
}
```

In `src/app/(app)/quotes/new/actions.ts` line 97 change the call to keep it compiling (Task 4 extends it):
```ts
  redirect(builderPath(input.type, customerId, { category }));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "#160|FAIL" | head -60`
Expected: every `#160` line PASS. tsc will flag `intake-form.tsx` because it does not send `name`/`replaces`. Add them now as a stopgap in `submit()`'s payload literal: `name: "", replaces: "",`. Task 4 replaces that literal.

- [ ] **Step 5: Run the four gates.** Touched: `quotes/new/types.ts`, `quotes/new/handoff.ts`, `quotes/new/actions.ts`, `quotes/new/intake-form.tsx`, `scripts/test-review-and-spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/quotes/new" scripts/test-review-and-spec.ts
git commit -m "feat(quotes): pure intake→builder hand-off helpers; builderPath carries name/venue/contact/replaces (#160)"
```

---

## Task 3: `retireReplacedDraft` store helper

**Files:**
- Modify: `src/lib/stores/quotes.ts` (insert after `remove()`, lines 695-697)
- Test: `scripts/test-review-and-spec.ts` (new `retireDraftAsyncChecks()` + one `.then` in the `seeded()` chain at ~line 6711)

**Interfaces:**
- Consumes: `get`, `remove`, `create`, `setStatus` from the same file.
- Produces: `retireReplacedDraft(id: string, replacementId?: string | null): Promise<boolean>`. Returns `true` only if a draft was soft-deleted.

- [ ] **Step 0: Record the lint baseline** for `src/lib/stores/quotes.ts`.

- [ ] **Step 1: Write the failing test**

Add near the other `@/lib/stores/quotes` import in the test file (e.g. just after line 3303):
```ts
import { create as createQuote160, get as getQuote160, remove as removeQuote160, setStatus as setStatus160, retireReplacedDraft } from "@/lib/stores/quotes";
```
Append this function at the end of the file (function declarations are hoisted, same as `templateScheduleAsyncChecks`):
```ts
/* ====== #160 / D205: Change type retires the replaced DRAFT only ======
 * Writes only rows it creates and removes them in finally (D202). */
async function retireDraftAsyncChecks(): Promise<void> {
  const made: string[] = [];
  try {
    const draft = await createQuote160({ name: "#160 fixture draft", customer: "Spec fixture", owner: "spec" });
    made.push(draft.id);
    const replacement = await createQuote160({ name: "#160 fixture replacement", customer: "Spec fixture", owner: "spec" });
    made.push(replacement.id);
    const lost = await createQuote160({ name: "#160 fixture lost", customer: "Spec fixture", owner: "spec" });
    made.push(lost.id);
    await setStatus160(lost.id, "lost");

    ok((await retireReplacedDraft(draft.id, draft.id)) === false, "#160 retireReplacedDraft never retires the quote being saved");
    ok((await getQuote160(draft.id)) !== null, "#160 …and that quote is still there");
    ok((await retireReplacedDraft(lost.id, replacement.id)) === false, "#160 retireReplacedDraft refuses a non-draft quote");
    ok((await getQuote160(lost.id))?.status === "lost", "#160 …and the non-draft is untouched");
    ok((await retireReplacedDraft("Q-DOES-NOT-EXIST-160", replacement.id)) === false, "#160 retireReplacedDraft no-ops on a missing id");
    ok((await retireReplacedDraft("", replacement.id)) === false, "#160 retireReplacedDraft no-ops on a blank id");
    ok((await retireReplacedDraft(draft.id, replacement.id)) === true, "#160 retireReplacedDraft retires a draft");
    ok((await getQuote160(draft.id)) === null, "#160 the retired draft no longer loads (soft-deleted)");
    ok((await retireReplacedDraft(draft.id, replacement.id)) === false, "#160 retiring twice is a no-op");
  } finally {
    for (const id of made) await removeQuote160(id);
  }
}
```
Add one link to the `seeded()` chain, right after `.then(() => templateScheduleAsyncChecks())`:
```ts
  .then(() => retireDraftAsyncChecks())
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: compile error: `retireReplacedDraft` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/stores/quotes.ts`, directly after `remove()` (after line 697), add:
```ts
/**
 * #160 / D205 — "Change type" on a draft. The replacement's builder calls this
 * on its FIRST save (create path only), so backing out of the new builder
 * leaves the old draft untouched. Status is re-checked here, server-side: a
 * quote that was sent in another tab after the intake opened is never deleted.
 * Soft delete (remove()), not a `lost` mark — that would skew win-rate reports.
 */
export async function retireReplacedDraft(id: string, replacementId?: string | null): Promise<boolean> {
  const oldId = (id || "").trim();
  if (!oldId || oldId === replacementId) return false;
  const old = await get(oldId);
  if (!old || old.status !== "draft") return false;
  await remove(oldId);
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:specs 2>&1 | grep -E "retireReplacedDraft|retired|FAIL|PASSED"`
Expected: 9 new PASS lines and `ALL PASSED`.

- [ ] **Step 5: Run the four gates.** Touched: `src/lib/stores/quotes.ts`, `scripts/test-review-and-spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/quotes.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): retireReplacedDraft — Change type soft-deletes the old draft on first save (#160, D205)"
```

---

## Task 4: Intake screen — company link, searchable customer, quote name, replace flow

**Files:**
- Modify: `src/app/(app)/companies/[id]/page.tsx:322`
- Modify: `src/app/(app)/quotes/new/page.tsx` (whole, 47 lines)
- Modify: `src/app/(app)/quotes/new/intake-form.tsx` (lines 1-144 and the customer block 239-269; add a name block)
- Modify: `src/app/(app)/quotes/new/actions.ts` (lines 1-9 imports, 80-97 tail)
- Modify: `scripts/smoke-routes.ts` (`DYNAMIC_ROUTES`, near `{ route: "/estimator?id=Q-2041" }` at line 177)

**Interfaces:**
- Consumes: `readHandoff`, `intakeInitial`, `quoteServiceType`, `quoteLineCount`, `quoteEditPath`, `quoteContactName`, `sameBuilder`, `replaceConfirmMessage`, `IntakeInitial`, `IntakeReplacing` (Task 2). `builderPath(type, id, opts)` (Task 2). `get` from `@/lib/stores/quotes`. `CustomerCombobox` (unchanged here).
- Produces: `QuoteIntakeForm` props `{ customers: IntakeCustomer[]; initial: IntakeInitial; replacing: IntakeReplacing | null }`. `createQuoteIntakeAction` honours `name`/`replaces`.

- [ ] **Step 0: Record the lint baseline** for the five files above.

- [ ] **Step 1: Add the smoke routes (the failing check)**

In `scripts/smoke-routes.ts`, insert after `{ route: "/estimator?id=Q-2041" },`:
```ts
  // #160 intake hand-off: company preselected, and "Change type" on the seeded draft Q-2041.
  { route: "/quotes/new?customer=lakefront" },
  { route: "/quotes/new?customer=lakefront&venue=lf2&contact=Tom+Reyes&name=Smoke+quote&type=repair" },
  { route: "/quotes/new?replaces=Q-2041" },
  { route: "/quotes/new?customer=ghost-id" },
```
These pass today, because unknown params are ignored. They are here so a server-render crash in the new page code fails the gate.

- [ ] **Step 2: Company page link**

`src/app/(app)/companies/[id]/page.tsx` line 322: replace `href="/estimator"` with
```tsx
              href={`/quotes/new?customer=${encodeURIComponent(cust.id)}`}
```

- [ ] **Step 3: Intake page**

Replace `src/app/(app)/quotes/new/page.tsx` with:
```tsx
import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import QuoteIntakeForm from "./intake-form";
import {
  intakeInitial,
  quoteContactName,
  quoteEditPath,
  quoteLineCount,
  quoteServiceType,
  readHandoff,
  type IntakeReplacing,
} from "./handoff";
import type { IntakeCustomer } from "./types";

export const metadata = { title: "New quote — Quartzite-6" };

/**
 * Guided "new quote" intake — the landing screen behind the "+ New quote"
 * split menu (quotes/controls.tsx) and a company's "+ New quote" (#160).
 * Picks (or quick-creates) the customer, venue and contact a quote is for,
 * plus an optional name, then hands off to the right builder via builderPath.
 *
 * /quotes/new?type=<ServiceType>&customer=&venue=&contact=&name=
 * /quotes/new?replaces=<quoteId>  — "Change type" on a DRAFT (D205): pre-fills
 *   from that quote with its current type selected. A non-draft is ignored.
 */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [, sp, customerDocs] = await Promise.all([requireUser(), searchParams, allCustomers()]);
  const h = readHandoff(sp);

  const customers: IntakeCustomer[] = customerDocs
    .map((c: CustomerDoc) => ({
      id: c.id,
      name: c.name,
      type: c.type || "",
      locations: (c.locations || []).map((l) => ({
        id: l.id || "",
        label: l.label || "",
        city: l.city || "",
        state: l.state || "",
        primary: !!l.primary,
      })),
      contacts: (c.contacts || []).map((ct) => ({
        name: ct.name,
        role: ct.role || "",
        primary: !!ct.primary,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let seed = {
    type: h.type,
    category: h.category,
    customerId: h.customerId,
    venueId: h.venueId,
    contactName: h.contactName,
    name: h.name,
  };
  let replacing: IntakeReplacing | null = null;
  if (h.replaces) {
    const old = await getQuote(h.replaces);
    if (old && old.status === "draft") {
      const type = quoteServiceType(old);
      replacing = { id: old.id, type, lines: quoteLineCount(old), editPath: quoteEditPath(old) };
      seed = {
        type,
        category: old.category || "",
        customerId: old.customerId || "",
        venueId: old.locationId || "",
        contactName: quoteContactName(old),
        name: old.name || "",
      };
    }
  }

  return (
    <QuoteIntakeForm customers={customers} initial={intakeInitial(seed, customers)} replacing={replacing} />
  );
}
```

- [ ] **Step 4: Intake form**

In `src/app/(app)/quotes/new/intake-form.tsx`:

(a) Replace lines 1-144 (imports through the end of `submit()`) with:
```tsx
"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition, type CSSProperties } from "react";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import { CustomerCombobox } from "@/components/customer-combobox";
import EntityQuickAdd, { INPUT, LABEL, type QuickAddValues } from "@/components/entity-quick-add";
import { createQuoteIntakeAction } from "./actions";
import { replaceConfirmMessage, sameBuilder, type IntakeInitial, type IntakeReplacing } from "./handoff";
import { SERVICE_TYPES, type IntakeCustomer, type IntakeSubmit, type ServiceType } from "./types";

const ADD_NEW = "__add_new__";
const SKIP = "__skip__";

function locationLine(l: IntakeCustomer["locations"][number]): string {
  const where = [l.city, l.state].filter(Boolean).join(", ");
  return where ? `${l.label || "Venue"} — ${where}` : l.label || "Venue";
}

export default function QuoteIntakeForm({
  customers,
  initial,
  replacing,
}: {
  customers: IntakeCustomer[];
  initial: IntakeInitial;
  replacing: IntakeReplacing | null;
}) {
  const [type, setType] = useState<ServiceType>(initial.type);
  // #110: the user-named category behind the trailing "Custom category" card.
  const [category, setCategory] = useState(initial.category);
  // #160: optional quote name — blank lets the builder auto-name.
  const [name, setName] = useState(initial.name);

  const [customerMode, setCustomerMode] = useState<"pick" | "new">("pick");
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({
    name: "",
    type: CUSTOMER_TYPES[0] || "",
  });

  const [locationMode, setLocationMode] = useState<"pick" | "new" | "skip">(initial.locationId ? "pick" : "skip");
  const [locationId, setLocationId] = useState(initial.locationId);
  const [newLocation, setNewLocation] = useState<QuickAddValues["venue"]>({
    label: "",
    city: "",
    state: "",
  });

  const [contactMode, setContactMode] = useState<"pick" | "new" | "skip">(initial.contactName ? "pick" : "skip");
  const [contactName, setContactName] = useState(initial.contactName);
  const [newContact, setNewContact] = useState<QuickAddValues["contact"]>({
    name: "",
    role: "",
    email: "",
    phone: "",
  });

  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedCustomer = customerMode === "pick" ? customers.find((c) => c.id === customerId) || null : null;
  const locations = selectedCustomer?.locations || [];
  const contacts = selectedCustomer?.contacts || [];
  // A customer is "in play" once one is picked or a new one is being named —
  // that's when the venue/contact steps make sense to show at all.
  const hasCustomerContext = customerMode === "new" || !!customerId;

  // #160: the shared typeahead replaces the search box + closed <select>
  // pair, which filtered options nobody could see. Venue city and contact
  // names are searchable too.
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        detail:
          [c.type, c.locations.map((l) => l.label).filter(Boolean).slice(0, 3).join(" · ")].filter(Boolean).join(" — ") ||
          undefined,
        searchText: [
          ...c.locations.map((l) => `${l.label} ${l.city} ${l.state}`),
          ...c.contacts.map((ct) => ct.name),
        ].join(" "),
      })),
    [customers]
  );

  function pickCustomer(id: string) {
    if (id === ADD_NEW) {
      setCustomerMode("new");
      setCustomerId("");
    } else {
      setCustomerMode("pick");
      setCustomerId(id);
    }
    // switching customers invalidates whatever venue/contact was picked off
    // the previous one — reset back to skippable, not silently pointed at
    // the wrong record.
    setLocationMode("skip");
    setLocationId("");
    setContactMode("skip");
    setContactName("");
  }

  function pickLocation(v: string) {
    if (v === ADD_NEW) setLocationMode("new");
    else if (v === SKIP) setLocationMode("skip");
    else {
      setLocationMode("pick");
      setLocationId(v);
    }
  }

  function pickContact(v: string) {
    if (v === ADD_NEW) setContactMode("new");
    else if (v === SKIP) setContactMode("skip");
    else {
      setContactMode("pick");
      setContactName(v);
    }
  }

  const customerReady =
    (customerMode === "pick" && !!customerId) ||
    (customerMode === "new" && newCustomer.name.trim().length > 0);
  // A custom category needs its name before the builder can be seeded with it.
  const canSubmit = customerReady && (type !== "custom" || category.trim().length > 0);

  function submit() {
    if (!canSubmit || pending) return;
    // D205: a different builder means a NEW quote; the old draft goes on its
    // first save. Same builder → the server just reopens the old quote.
    if (replacing && !sameBuilder(type, replacing.type) && !window.confirm(replaceConfirmMessage(replacing.id, replacing.lines))) {
      return;
    }
    setError("");
    const payload: IntakeSubmit = {
      type,
      category: type === "custom" ? category.trim() : "",
      name: name.trim(),
      replaces: replacing?.id || "",
      customerMode,
      customerId,
      newCustomerName: newCustomer.name,
      newCustomerType: newCustomer.type,
      locationMode,
      locationId,
      newLocationLabel: newLocation.label,
      newLocationCity: newLocation.city,
      newLocationState: newLocation.state,
      contactMode,
      contactName,
      newContactName: newContact.name,
      newContactRole: newContact.role,
      newContactEmail: newContact.email,
      newContactPhone: newContact.phone,
    };
    startTransition(async () => {
      const res = await createQuoteIntakeAction(payload);
      // A successful call redirect()s server-side and never returns here.
      if (res && !res.ok) setError(res.error);
    });
  }
```

(b) Replace the heading block (old lines 148-156: the `← Quotes` link, `<h1>`, `<p>`) with:
```tsx
      <Link href={replacing ? replacing.editPath : "/quotes"} style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
        {replacing ? `← Back to ${replacing.id}` : "← Quotes"}
      </Link>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: "6px 0 3px" }}>
        {replacing ? "Change quote type" : "New quote"}
      </h1>
      <p style={{ fontSize: 13, color: "#8c919c", margin: "0 0 22px" }}>
        {replacing
          ? `Pick the new type for ${replacing.id}. It is replaced when the new quote is first saved.`
          : "Pick who this is for, then jump straight into the builder."}
      </p>
```

(c) Replace the customer block (old lines 239-269, from `{/* ---- customer ---- */}` through the closing `)}` of the `customerMode === "new"` EntityQuickAdd) with:
```tsx
      {/* ---- customer ---- */}
      <label style={LABEL}>Customer</label>
      {customerMode === "pick" ? (
        <>
          <CustomerCombobox
            options={customerOptions}
            value={customerId}
            onChange={(id) => pickCustomer(id)}
            placeholder="Search customers, venues or contacts…"
            inputStyle={INPUT}
          />
          <button type="button" onClick={() => pickCustomer(ADD_NEW)} style={{ ...inlineLinkStyle, marginTop: 7 }}>
            + Add new customer…
          </button>
        </>
      ) : (
        <EntityQuickAdd
          kind="customer"
          value={newCustomer}
          onChange={setNewCustomer}
          onCancel={() => pickCustomer("")}
        />
      )}
```
(`CustomerCombobox` already shows `No customers match "…"` for an empty result. The quick-add link sits right below it, so the "no match → quick add" path is kept.)

(d) Insert the Quote-name block immediately before `{error && (`:
```tsx
      {/* ---- quote name (optional, #160) ---- */}
      <label style={LABEL}>Quote name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Optional — leave blank to name it automatically"
        style={INPUT}
      />
```
(e) Change the submit button label expression to:
```tsx
        {pending ? "Setting up…" : replacing && sameBuilder(type, replacing.type) ? `Back to ${replacing.id} →` : "Continue to builder →"}
```

- [ ] **Step 5: Intake action**

In `src/app/(app)/quotes/new/actions.ts`:
- line 5 becomes `import { get as getCustomer } from "@/lib/stores/customers";` (unchanged) and add after it:
  ```ts
  import { get as getQuote } from "@/lib/stores/quotes";
  import { quoteEditPath, quoteServiceType, sameBuilder } from "./handoff";
  ```
- Immediately after the `#110` category check (after line 30), add:
  ```ts
  // D205 — "Change type" on a draft. Re-checked here: the quote may have been
  // sent since the intake opened.
  const replacesId = (input.replaces || "").trim();
  const old = replacesId ? await getQuote(replacesId) : null;
  if (replacesId && (!old || old.status !== "draft")) {
    return { ok: false, error: "That quote is no longer a draft — start a new quote instead." };
  }
  if (old && sameBuilder(input.type, quoteServiceType(old))) redirect(quoteEditPath(old));
  ```
- Replace lines 95-97 (`if (!customerId) …` through the `redirect`) with:
  ```ts
  if (!customerId) return { ok: false, error: "Pick or create a customer first." };

  // #160: forward the venue/contact actually chosen — the builders used to
  // drop them and fall back to primaries.
  let venueId = input.locationMode === "pick" ? (input.locationId || "").trim() : "";
  if (input.locationMode === "new") {
    const before = new Set((existing?.locations || []).map((l) => l.id));
    const after = await getCustomer(customerId);
    venueId = (after?.locations || []).find((l) => l.id && !before.has(l.id))?.id || "";
  }
  const contact =
    input.contactMode === "pick"
      ? (input.contactName || "").trim()
      : input.contactMode === "new"
        ? (input.newContactName || "").trim()
        : "";

  redirect(
    builderPath(input.type, customerId, {
      category,
      name: input.name,
      venue: venueId,
      contact,
      replaces: old ? old.id : "",
    })
  );
  ```

- [ ] **Step 6: Typecheck + smoke**

Run: `npx tsc --noEmit; echo TSC=$?` → `TSC=0`.
Run: `npm run test:smoke 2>&1 | grep -E "quotes/new|FAIL|PASSED"` → all four new routes 200, `ALL PASSED`.

- [ ] **Step 7: Run the four gates.** Touched: the five files above plus `scripts/smoke-routes.ts`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/companies/[id]/page.tsx" "src/app/(app)/quotes/new" scripts/smoke-routes.ts
git commit -m "feat(quotes): company + New quote → intake; searchable customer, quote name, venue/contact forwarded, Change-type intake (#160)"
```

---

## Task 5: Estimator — hand-off seeding, fallback name, click-to-edit title, save uses current name + `replaces`

**Files:**
- Modify: `src/app/(app)/estimator/types.ts:291-316` (`InitialQuote` += `replaces`)
- Modify: `src/app/(app)/estimator/page.tsx:87-108` (blank initial), `:133-157` (loaded initial), `:166-173` (param reads), `:254-268` (seeding)
- Modify: `src/app/(app)/estimator/actions.ts:72-90` (`SavePayload`), `:230-331` (`saveQuoteAction` create branch), `:482-530` (`updateQuoteMetaAction`)
- Modify: `src/app/(app)/estimator/estimator-client.tsx` (state near `:312`, `doSave` `:541`, title `:1607-1630`, PreviewDoc `:2830`)
- Modify: `scripts/smoke-routes.ts`

**Interfaces:**
- Consumes: `readHandoff`, `pickVenueId`, `pickContactName`, `systemQuoteName` (Task 2), `retireReplacedDraft` (Task 3).
- Produces: `InitialQuote.replaces: string`. `SavePayload.replaces?: string`. `updateQuoteMetaAction` meta accepts `name?: string`. Client state `projectName`/`setProjectName` (Task 6 relies on the header block written here).

- [ ] **Step 0: Record the lint baseline** for the four estimator files.

- [ ] **Step 1: Smoke routes (failing check for the server path)**

In `scripts/smoke-routes.ts`, after the Task 4 entries:
```ts
  { route: "/estimator?customer=lakefront&venue=lf2&contact=Tom+Reyes&name=Smoke+estimate" },
  { route: "/estimator?customer=lakefront&category=Acoustics&replaces=Q-2041" },
```

- [ ] **Step 2: Types**

In `estimator/types.ts`, add to `InitialQuote` after `vendorQuotes: VendorQuote[];`:
```ts
  /** #160 / D205 — the draft this new estimate replaces ("Change type"); "" otherwise.
   *  Sent with the FIRST save only, which retires that draft server-side. */
  replaces: string;
```

- [ ] **Step 3: Page**

In `estimator/page.tsx`:
- Add the import: `import { pickContactName, pickVenueId, readHandoff, systemQuoteName } from "@/app/(app)/quotes/new/handoff";`
- In `initialFrom`'s blank return (line 107 area) add `replaces: "",` after `vendorQuotes: [],`. In the loaded return (line 156 area) add `replaces: "",` after `vendorQuotes: vendorQuotesOf(q),`.
- Replace lines 169-173 (the `preCustomer`/`preCategory` consts and their comments) with:
  ```ts
  // Guided intake hand-off (quotes/new, #160): only applies to a fresh
  // builder — an explicit ?id= always wins.
  const handoff = rawId ? null : readHandoff(sp);
  const preCustomer = handoff?.customerId || undefined;
  // #110: the intake's "Custom category" card hands its name over the same way.
  const preCategory = handoff?.category || undefined;
  ```
- Replace lines 254-268 (the seeding block through the `preCategory` line) with:
  ```ts
  // Seed the customer/venue/contact picked in the guided intake (quotes/new).
  // A venue/contact not on the customer falls back to its primary (#160).
  if (preCustomer) {
    const cust = customers.find((c) => c.id === preCustomer);
    if (cust) {
      initial.customerId = cust.id;
      initial.custName = cust.name;
      initial.locationId = pickVenueId(cust, handoff?.venueId || "") || null;
      initial.contactName = pickContactName(cust, handoff?.contactName || "");
    }
  }
  if (preCategory && preCategory.trim()) initial.category = preCategory.trim();
  if (handoff) {
    // #160: the intake's optional name, else "<Customer> — System" (or
    // "— <category>") instead of the old static "New estimate".
    initial.projectName = handoff.name || (initial.customerId ? systemQuoteName(initial.custName, initial.category) : initial.projectName);
    initial.replaces = handoff.replaces;
  }
  ```

- [ ] **Step 4: Actions**

In `estimator/actions.ts`:
- Add `retireReplacedDraft,` to the `@/lib/stores/quotes` import list (lines 6-24).
- In `SavePayload` add after `vendorQuotes: VendorQuote[];`:
  ```ts
  /** #160 / D205 — sent on the create save only: the draft this quote replaces. */
  replaces?: string;
  ```
- In `saveQuoteAction`'s create branch, directly after `q = q || created;` (line 318), add:
  ```ts
    // D205: the replaced draft goes only once its replacement exists.
    if (payload.replaces) await retireReplacedDraft(payload.replaces, created.id);
  ```
- In `updateQuoteMetaAction`: add `name?: string;` to the `meta` type (after `category?: string;`) and, after the `category` allowlist line (line 505), add:
  ```ts
  // #160: the click-to-edit Estimator title. Blank never clears a name.
  if (typeof meta.name === "string" && meta.name.trim()) patch.name = meta.name.trim();
  ```

- [ ] **Step 5: Client — state and save**

In `estimator-client.tsx`:
- After `const [contactName, setContactName] = useState(initial.contactName);` (line 315) add:
  ```ts
  // #160: the quote name is editable in the header (click-to-edit).
  const [projectName, setProjectName] = useState(initial.projectName);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initial.projectName);
  const titleOpenRef = useRef(false);
  ```
- In `doSave` replace `name: initial.projectName,` (line 541) with:
  ```ts
          name: projectName,
          // D205: only the create save retires the replaced draft.
          replaces: loadedId ? "" : initial.replaces,
  ```
- After `persistMeta` (after line 525) add:
  ```ts
  const openTitle = () => {
    titleOpenRef.current = true;
    setTitleDraft(projectName);
    setTitleEditing(true);
  };
  /** Enter/blur save, Esc reverts. The ref makes Enter-then-blur a single save. */
  const closeTitle = (save: boolean) => {
    if (!titleOpenRef.current) return;
    titleOpenRef.current = false;
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (!save || !next || next === projectName) return;
    setProjectName(next);
    persistMeta({ name: next }); // no-op until the first save; doSave carries it then
  };
  ```
- Replace the title `<div>` at lines 1608-1619 (the `fontSize: 14` div whose child is `{initial.projectName}`) with:
  ```tsx
                {titleEditing ? (
                  <input
                    autoFocus
                    aria-label="Quote name"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => closeTitle(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        closeTitle(true);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeTitle(false);
                      }
                    }}
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      fontFamily: "var(--font-ui)",
                      color: "#fff",
                      background: "#2b2e35",
                      border: "1px solid #4a4e56",
                      borderRadius: 6,
                      padding: "2px 6px",
                      width: 340,
                      maxWidth: "100%",
                      outline: "none",
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={openTitle}
                    title="Rename this quote"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      fontFamily: "var(--font-ui)",
                      color: "#fff",
                      background: "none",
                      border: "1px dashed transparent",
                      borderRadius: 6,
                      padding: "2px 6px",
                      margin: "-3px -7px",
                      cursor: "text",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    className="est-title"
                  >
                    {projectName}
                  </button>
                )}
  ```
  and add to the `CSS` string (after the `.est-secname:hover` rule, line 101) `.est-title:hover { border-color: #4a4e56 !important; }`.
- Line 2830: `projectName={initial.projectName}` → `projectName={projectName}`.
- Search the file once more: `grep -n "initial.projectName" "src/app/(app)/estimator/estimator-client.tsx"` must return only the three `useState` initializers.

- [ ] **Step 6: Typecheck, then smoke**

`npx tsc --noEmit` → 0. `npm run test:smoke` → the two new estimator routes 200.

- [ ] **Step 7: Run the four gates.** Touched: the four estimator files and `scripts/smoke-routes.ts`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/estimator" scripts/smoke-routes.ts
git commit -m "feat(estimator): intake hand-off (venue/contact/name), click-to-edit title, first save retires a replaced draft (#160)"
```

---

## Task 6: Shared won-edit guard + Change type control; wire into the Estimator

**Files:**
- Create: `src/components/quote-flow-controls.tsx`
- Modify: `src/components/customer-combobox.tsx` (props lines 16-30, `pick` 62-66, input `onChange` 80-85)
- Modify: `src/app/(app)/estimator/estimator-client.tsx` (`pickCustomer`/`pickVenue`/`pickContact` at 687-708; the header block edited in Task 5)

**Interfaces:**
- Consumes: `canChangeType`, `CHANGE_TYPE_DISABLED_HINT`, `wonEditMessage`, `WonEditField` (Task 2).
- Produces: `ChangeTypeControl({ quoteId: string; status: string; tone?: "light" | "dark" })`, `useWonEditGuard(status: string): (field: WonEditField) => boolean` (asks once per field per page visit, and returns true when not won). `CustomerCombobox` gains optional prop `canChange?: (id: string) => boolean`.

- [ ] **Step 0: Record the lint baseline** for the three files.

- [ ] **Step 1: Create `src/components/quote-flow-controls.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import {
  CHANGE_TYPE_DISABLED_HINT,
  canChangeType,
  wonEditMessage,
  type WonEditField,
} from "@/app/(app)/quotes/new/handoff";

/**
 * #160 / D205 — "Change type" for every quote builder. A draft links to the
 * intake in replace mode; anything else renders disabled with the hint.
 */
export function ChangeTypeControl({
  quoteId,
  status,
  tone = "light",
}: {
  quoteId: string;
  status: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const base: CSSProperties = {
    display: "inline-block",
    fontSize: 11.5,
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    color: dark ? "#c9cdd4" : "#5b616e",
    background: dark ? "transparent" : "#fff",
    border: `1px solid ${dark ? "#3a3e46" : "#e4e7ec"}`,
    borderRadius: 7,
    padding: "3px 9px",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
  if (!canChangeType(status)) {
    return (
      <span aria-disabled="true" title={CHANGE_TYPE_DISABLED_HINT} style={{ ...base, opacity: 0.45, cursor: "not-allowed" }}>
        Change type
      </span>
    );
  }
  return (
    <Link href={`/quotes/new?replaces=${encodeURIComponent(quoteId)}`} style={base}>
      Change type
    </Link>
  );
}

/**
 * D206 — before changing customer, venue or contact on a WON quote, confirm
 * once per field (the spawned project/job keeps the old value). Warn, don't
 * block; not-won quotes pass straight through.
 */
export function useWonEditGuard(status: string): (field: WonEditField) => boolean {
  const acked = useRef<Set<WonEditField>>(new Set());
  return (field) => {
    if (status !== "won" || acked.current.has(field)) return true;
    const yes = window.confirm(wonEditMessage(field));
    if (yes) acked.current.add(field);
    return yes;
  };
}
```

- [ ] **Step 2: `CustomerCombobox` veto**

In `src/components/customer-combobox.tsx`:
- Add to the destructured props and their type: `canChange,` / `canChange?: (id: string) => boolean;` with the doc comment `/** Optional veto (D206 won-quote confirm). Returning false keeps the current pick and restores its name in the input. */`.
- Replace `pick` (lines 62-66) with:
  ```ts
  const pick = (o: CustomerComboboxOption) => {
    if (o.id !== value && canChange && !canChange(o.id)) {
      setQuery(selected?.name || "");
      setOpen(false);
      return;
    }
    setQuery(o.name);
    setOpen(false);
    onChange(o.id);
  };
  ```
- Replace the input's `onChange` handler (lines 80-85) with:
  ```ts
        onChange={(e) => {
          if (!e.target.value && value && canChange && !canChange("")) {
            setQuery(selected?.name || "");
            return;
          }
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          if (!e.target.value) onChange("");
        }}
  ```
  Existing callers pass no `canChange`, so their behaviour is unchanged.

- [ ] **Step 3: Estimator wiring**

In `estimator-client.tsx`:
- Import: `import { ChangeTypeControl, useWonEditGuard } from "@/components/quote-flow-controls";`
- After the `status` state (line 299): `const guardWon = useWonEditGuard(status);`
- First statement of `pickCustomer` (line 687): `if (!guardWon("customer")) return;`. First statement of `pickVenue`: `if (!guardWon("venue")) return;`. First statement of `pickContact`: `if (!guardWon("contact")) return;`. These handlers back controlled `<select>`s, so an early return leaves the old value showing.
- In the header block, replace the mono sub-line div (`{quoteId} · Rev {revNum}`, lines 1620-1629) with:
  ```tsx
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 2 }}>
                  <span style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>
                    {quoteId} · Rev {revNum}
                  </span>
                  {loadedId && <ChangeTypeControl quoteId={loadedId} status={status} tone="dark" />}
                </div>
  ```

- [ ] **Step 4: Typecheck + lint**

`npx tsc --noEmit` → 0. `npx eslint src/components/quote-flow-controls.tsx src/components/customer-combobox.tsx "src/app/(app)/estimator/estimator-client.tsx"` → no new problems vs Step 0. If `react-hooks` flags reading `acked.current` inside the returned closure, it is a false positive, because the read happens in an event handler and not during render. Suppress only that line with a comment giving that reason.

- [ ] **Step 5: Run the four gates.**

- [ ] **Step 6: Commit**

```bash
git add src/components/quote-flow-controls.tsx src/components/customer-combobox.tsx "src/app/(app)/estimator/estimator-client.tsx"
git commit -m "feat(quotes): won-quote edit confirm + drafts-only Change type; wired into the Estimator (#160, D205, D206)"
```

---

## Task 7: Flame, repair and inspection builders — hand-off, won guard, Change type, retire on create

The three builders are structural twins, so each step below shows the flame code in full and then the exact deltas for repair and inspection.

**Files (per builder `X` ∈ `flame-tests`, `repairs`, `inspections`):**
- Modify: `src/app/(app)/X/quote/page.tsx` (initial literal + `preCustomer` branch; repair also its inspection-finding branch)
- Modify: `src/app/(app)/X/quote/controls.tsx` (`BuilderInitial`, `pickCustomer`, `toggleVenue`, contact `<select>`, `buildForm`, header)
- Modify: `src/app/(app)/X/quote/actions.ts` (import + `persist`)
- Modify: `scripts/smoke-routes.ts`

**Interfaces:**
- Consumes: `readHandoff`, `seedVenueOn`, `pickContactName` (Task 2). `retireReplacedDraft` (Task 3). `ChangeTypeControl`, `useWonEditGuard`, `CustomerCombobox.canChange` (Task 6).
- Produces: every `BuilderInitial` gains `status: string; replaces: string`. Flame's also gains `nameLocked: boolean`. The form field `replaces` is posted by `buildForm()`.

- [ ] **Step 0: Record the lint baseline** for the nine files.

- [ ] **Step 1: Smoke routes (failing check)**

```ts
  { route: "/flame-tests/quote?customer=lakefront&venue=lf2&contact=Tom+Reyes&name=Smoke+flame" },
  { route: "/repairs/quote?customer=lakefront&venue=lf2&contact=Tom+Reyes&replaces=Q-2041" },
  { route: "/inspections/quote?customer=lakefront&venue=lf2&contact=Nobody&name=Smoke+inspection" },
```

- [ ] **Step 2: `BuilderInitial` fields (all three controls.tsx)**

Add to each `export type BuilderInitial` (flame `controls.tsx:51`, repair `:60`, inspection `:55`), after `savedId: string;`:
```ts
  /** Quote status — drives the won-edit confirm (D206) and Change type (D205). "draft" when new. */
  status: string;
  /** #160 / D205 — the draft this new quote replaces; posted on the create save. */
  replaces: string;
```
Flame only, also add:
```ts
  /** #160 — the intake supplied a name: don't auto-rename on venue toggles. */
  nameLocked: boolean;
```

- [ ] **Step 3: Pages**

In each `page.tsx`, import `import { pickContactName, readHandoff, seedVenueOn } from "@/app/(app)/quotes/new/handoff";`.

- In the default `let initial: BuilderInitial = { … }` literal add `status: "draft", replaces: "",` (flame also `nameLocked: false,`).
- In the edit branch literal add `status: editQuote.status, replaces: "",` (flame also `nameLocked: false,`).
- Repair's inspection-finding branch literal (`repairs/quote/page.tsx:221-248`) add `status: "draft", replaces: "",`.
- Right after `const preCustomer = one(sp.customer);` add `const handoff = readHandoff(sp);`.
- Replace the body of the `else if (preCustomer)` branch's `if (cust) { … }`.

Flame (`flame-tests/quote/page.tsx:143-166`):
```ts
    if (cust) {
      const locs = cust.locations;
      const on = seedVenueOn(locs, handoff.venueId);
      const venueSel: BuilderInitial["venueSel"] = {};
      locs.forEach((l) => {
        venueSel[l.id] = { on: !!on[l.id], curtains: "" };
      });
      const picked = locs.filter((l) => venueSel[l.id]?.on);
      const venueName = picked[0]?.label || locs[0]?.label || cust.name;
      const venueSuffix = picked.length > 1 ? ` + ${picked.length - 1} venue${picked.length === 2 ? "" : "s"}` : "";
      initial = {
        editingId: null,
        customerId: cust.id,
        quoteName: handoff.name || `${venueName}${venueSuffix} — Flame Test ${new Date().getFullYear()}`,
        venueSel,
        contactSel: pickContactName(cust, handoff.contactName),
        contactManual: "",
        saved: false,
        approved: false,
        savedId: "",
        status: "draft",
        replaces: handoff.replaces,
        nameLocked: !!handoff.name,
      };
    }
```
Repair (`repairs/quote/page.tsx:253-272`):
```ts
    if (cust) {
      const on = seedVenueOn(cust.locations, handoff.venueId);
      const venueSel: BuilderInitial["venueSel"] = {};
      cust.locations.forEach((l) => {
        venueSel[l.id] = { on: !!on[l.id] };
      });
      initial = {
        ...initial,
        customerId: cust.id,
        quoteName: handoff.name || cust.name + " — Repair",
        venueSel,
        contactSel: pickContactName(cust, handoff.contactName),
        saved: false,
        approved: false,
        replaces: handoff.replaces,
      };
    }
```
Inspection (`inspections/quote/page.tsx:155-175`): identical to repair except the venue value is `{ on: !!on[l.id], lineSets: "" }` and the fallback name is `cust.name + " — Rigging inspection"`.

- [ ] **Step 4: Controls**

In each `controls.tsx` import:
```ts
import { ChangeTypeControl, useWonEditGuard } from "@/components/quote-flow-controls";
```
After the `useState` block, add `const guardWon = useWonEditGuard(initial.status);`

1. **Customer:** first line of `pickCustomer(id)`: `if (id !== customerId && !guardWon("customer")) return;`. On the `<CustomerCombobox … onChange={pickCustomer}` (flame `:528`, repair `:631`, inspection `:540`) add the prop `canChange={() => guardWon("customer")}`. The ack is per field, so the combobox check and the `pickCustomer` check produce one dialog, not two.
2. **Venue:** first line of `toggleVenue(locId)`: `if (!guardWon("venue")) return;`.
3. **Contact:** in the contact `<select>` `onChange` (flame `:565`, repair `:715`, inspection `:616`) make the body:
   ```ts
                onChange={(e) => {
                  if (!guardWon("contact")) return;
                  setContactSel(e.target.value);
                  dirty();
                }}
   ```
4. **Flame only:** line 247 `const quoteNameManual = useRef(!!initial.editingId);` → `const quoteNameManual = useRef(!!initial.editingId || initial.nameLocked);`
5. **`buildForm()`:** after `fd.set("quoteName", quoteName);` add `fd.set("replaces", editingId ? "" : initial.replaces);`
6. **Header:** directly after the "Auto-priced" badge `</span>` that follows the title div (flame title at `:478`, repair `:565`, inspection `:490`), inside the same flex row, add:
   ```tsx
            {editingId && <ChangeTypeControl quoteId={editingId} status={initial.status} />}
   ```

- [ ] **Step 5: Actions**

In each `actions.ts`, add `retireReplacedDraft,` to the `@/lib/stores/quotes` import. In `persist()`:
- after `const quoteName = …` add `const replaces = String(formData.get("replaces") || "").trim();`
- replace the final two statements (`const q = editingId ? … : await createQuote(payload); return …`) with:
  ```ts
  const q = editingId
    ? await updateQuote(editingId, payload)
    : await createQuote(payload);
  // D205: first save of a "Change type" replacement retires the old draft.
  if (!editingId && q && replaces) await retireReplacedDraft(replaces, q.id);
  return (q && q.id) || editingId || null;
  ```
Because `persist()` backs both Save and Approve, both paths are covered.

- [ ] **Step 6: Typecheck + smoke**

`npx tsc --noEmit` → 0. `npm run test:smoke` → the three new routes 200.

- [ ] **Step 7: Run the four gates.**

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/flame-tests/quote" "src/app/(app)/repairs/quote" "src/app/(app)/inspections/quote" scripts/smoke-routes.ts
git commit -m "feat(quotes): flame/repair/inspection builders honour intake venue/contact/name, warn on won edits, Change type (#160)"
```

---

## Task 8: Consulting and rental builders

**Files:**
- Modify: `src/app/(app)/design/engagements/quote/page.tsx:43-111`, `controls.tsx:34-56` (`BuilderInitial` has `status` already), `:89-122` (props/state), the `<form>` hidden inputs `:231-238`, the two comboboxes + site select + contact input `:241-281`, the `<h1>` row `:194-217`; `actions.ts` import + `persist`.
- Modify: `src/app/(app)/rentals/quote/page.tsx` (initial literals + `preCustomer` branch), `controls.tsx` (`BuilderInitial :40-52`, `buildForm :291`, header `:359`), `actions.ts` (import line 7 + `persist`).
- Modify: `scripts/smoke-routes.ts`

**Interfaces:**
- Consumes: as Task 7.
- Produces: `ConsultingQuoteBuilder` prop `pre: { customerId: string; venueId: string; contactName: string; name: string; replaces: string }`. This replaces `preCustomerId: string`, whose only caller is `page.tsx`. Rental `BuilderInitial` gains `status`, `replaces`.

- [ ] **Step 0: Record the lint baseline** for the six files.

- [ ] **Step 1: Smoke routes**

```ts
  { route: "/design/engagements/quote?customer=lakefront&venue=lf2&contact=Tom+Reyes&name=Smoke+consulting" },
  { route: "/rentals/quote?customer=lakefront&contact=Tom+Reyes&name=Smoke+rental&replaces=Q-2041" },
```

- [ ] **Step 2: Consulting page**

Import `import { pickContactName, pickVenueId, readHandoff } from "@/app/(app)/quotes/new/handoff";`. Replace `const preCustomer = one(sp.customer);` with:
```ts
  const handoff = readHandoff(sp);
```
Before `return`, compute (new quotes only):
```ts
  // #160: intake hand-off for a NEW proposal. The customer is both the billed
  // party and the venue owner until the user splits them, so the venue id is
  // validated against it. Consulting's existing fallback is blank (no primary
  // venue/contact auto-pick), so no fallback here either.
  const preCust = !editId ? customers.find((c) => c.id === handoff.customerId) || null : null;
  const pre = {
    customerId: preCust?.id || "",
    venueId: preCust ? pickVenueId(preCust, handoff.venueId, false) : "",
    contactName: preCust ? pickContactName(preCust, handoff.contactName, false) : "",
    name: preCust ? handoff.name : "",
    replaces: preCust ? handoff.replaces : "",
  };
```
and pass `pre={pre}` instead of `preCustomerId={preCustomer}`.

- [ ] **Step 3: Consulting controls**

- Props: replace `preCustomerId,` / `preCustomerId: string;` with `pre,` / `pre: { customerId: string; venueId: string; contactName: string; name: string; replaces: string };`.
- Replace every `preCustomerId` in the `useState` initializers (lines 108-116) with `pre.customerId`.
- `quoteName` / `quoteNameEdited` / `locationId` / contact initial state (lines 117-122) become:
  ```ts
  const preContact = !initial ? customers.find((c) => c.id === pre.customerId)?.contacts.find((c) => c.name === pre.contactName) : undefined;
  const [quoteName, setQuoteName] = useState(initial?.name || pre.name || "");
  const [quoteNameEdited, setQuoteNameEdited] = useState(!!initial?.name || !!pre.name);
  const [locationId, setLocationId] = useState(initial?.locationId || pre.venueId || "");
  const [contactName, setContactName] = useState(initial?.contactName || preContact?.name || "");
  const [contactRole, setContactRole] = useState(initial?.contactRole || preContact?.role || "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail || preContact?.email || "");
  ```
- Imports: `import { ChangeTypeControl, useWonEditGuard } from "@/components/quote-flow-controls";`, then after the state block `const guardWon = useWonEditGuard(initial?.status || "draft");`.
- Billed-customer combobox (`:241`): add `canChange={() => guardWon("customer")}`. Venue combobox (`:255`): add `canChange={() => guardWon("venue")}`. Site `<select>` `onChange` (`:271`): first statement `if (!guardWon("venue")) return;`. Contact name input `onChange` (`:283`): `onChange={(e) => { if (!guardWon("contact")) return; pickContact(e.target.value); }}`.
- Hidden input, next to the others at `:232`: `{!initial && pre.replaces && <input type="hidden" name="replaces" value={pre.replaces} />}`
- `<h1>` row: after the "Fee-based" badge `</span>` add `{initial && <ChangeTypeControl quoteId={initial.id} status={initial.status} />}`.

- [ ] **Step 4: Consulting action**

Add `retireReplacedDraft,` to the quotes import (lines 7-11). In `persist()` add `const replaces = String(formData.get("replaces") || "").trim();` after `quoteName`. Directly before the final `return qid;` add:
```ts
  // D205: first save of a "Change type" replacement retires the old draft.
  if (!editingId && q && replaces) await retireReplacedDraft(replaces, q.id);
```

- [ ] **Step 5: Rental page + controls + action**

- `rentals/quote/controls.tsx` `BuilderInitial`: add `status: string;` and `replaces: string;` with the same doc comments as Task 7.
- `rentals/quote/page.tsx`: import `import { pickContactName, readHandoff } from "@/app/(app)/quotes/new/handoff";`. Add `status: "draft", replaces: "",` to the default literal and `status: editQuote.status, replaces: "",` to the edit literal. Add `const handoff = readHandoff(sp);` after `preCustomer`. Replace the `preCustomer` branch's `if (cust) { … }` with:
  ```ts
    if (cust) {
      initial = {
        ...initial,
        customerId: cust.id,
        quoteName: handoff.name || cust.name + " — Rental",
        contactSel: pickContactName(cust, handoff.contactName),
        saved: false,
        approved: false,
        replaces: handoff.replaces,
      };
    }
  ```
  (`venue` is never read; rental has no venue concept.)
- `rentals/quote/controls.tsx`: import `ChangeTypeControl`. In `buildForm()` after `fd.set("quoteName", quoteName);` add `fd.set("replaces", editingId ? "" : initial.replaces);`. After the title div at `:359` (inside the same flex row, after the badge span) add `{editingId && <ChangeTypeControl quoteId={editingId} status={initial.status} />}`. **No won guard in rental**: a won rental's Save is already locked (`isApproved` disables it, `:791`), so a customer/contact change there can never persist. See "Spec ambiguities" in the report.
- `rentals/quote/actions.ts` line 7: `import { create as createQuote, update as updateQuote, setStatus, retireReplacedDraft } from "@/lib/stores/quotes";`. In `persist()` add the `replaces` read after `quoteName` (`:59`), and replace line 123 with:
  ```ts
  const q = editingId ? await updateQuote(editingId, payload) : await createQuote(payload);
  // D205: first save of a "Change type" replacement retires the old draft.
  if (!editingId && q && replaces) await retireReplacedDraft(replaces, q.id);
  ```

- [ ] **Step 6: Typecheck + smoke**, then **Step 7: the four gates**, then:

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/design/engagements/quote" "src/app/(app)/rentals/quote" scripts/smoke-routes.ts
git commit -m "feat(quotes): consulting + rental builders honour the intake hand-off and Change type (#160)"
```

---

## Task 9: Catalog rapid-fire — qty per row, picker stays open, "✓ Added"

**Files:**
- Modify: `src/app/(app)/estimator/pricing.ts` (add `parseAddQty`)
- Modify: `src/app/(app)/estimator/catalog-picker.tsx` (whole component, 167 lines)
- Modify: `src/app/(app)/estimator/section-card.tsx:94` (prop type), `:1030` (render)
- Modify: `src/app/(app)/estimator/estimator-client.tsx:846-852` (`addPart`), `:2674` (prop)
- Test: `scripts/test-review-and-spec.ts` (the `pricing` import at line 198 + one block)

**Interfaces:**
- Produces: `parseAddQty(v: string): number` (integer ≥ 1, invalid → 1). `CatalogPicker({ onAdd: (p: SuggestPart, qty: number) => void; onClose?: () => void })`. `SectionCard` prop `onAddPart: (cat: SuggestPart, qty: number) => void`. `addPart(secId, cat, qty)`.

- [ ] **Step 0: Record the lint baseline** for the four source files.

- [ ] **Step 1: Write the failing test**

Add `parseAddQty` to the `@/app/(app)/estimator/pricing` import on line 198, then after the Task 1 block add:
```ts
/* --- #160: catalog rapid-add quantity box --- */
ok(parseAddQty("4") === 4 && parseAddQty("12") === 12, "#160 the catalog qty box adds the typed quantity");
ok(parseAddQty("") === 1 && parseAddQty("0") === 1 && parseAddQty("-3") === 1 && parseAddQty("abc") === 1, "#160 a blank, zero, negative or non-numeric qty adds 1");
ok(parseAddQty("2.7") === 2, "#160 a fractional qty is floored to a whole unit");
```

- [ ] **Step 2: Run to verify it fails**

`npm run test:specs 2>&1 | tail -3`. Expected: `parseAddQty` is not exported.

- [ ] **Step 3: `parseAddQty`**

Append to `src/app/(app)/estimator/pricing.ts`:
```ts
/** #160 — the catalog picker's per-row qty box: a whole number ≥ 1; anything else adds 1. */
export function parseAddQty(v: string): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
```

- [ ] **Step 4: Picker**

Replace lines 1-15 (imports + doc) and 30-167 (component) of `catalog-picker.tsx` (keep the `FIELD` constant) with:
```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { searchCatalog } from "./actions";
import type { CatalogHit } from "./types";
import type { SuggestPart } from "./estimator-data";
import { fmt, marginColor, parseAddQty } from "./pricing";

/**
 * Estimator "Add part from catalog" picker — searches the real catalog (10k+
 * parts) via the searchCatalog server action, debounced. Team-only tool, so
 * cost + margin are shown. #160: each row has its own qty box; adding keeps
 * the panel open, clears + refocuses the search and flashes "✓ Added" — the
 * panel closes only via its toggle or ×.
 */
```
(`FIELD` stays as is.)
```tsx
const QTY: CSSProperties = {
  width: 52,
  fontSize: 12.5,
  fontFamily: "var(--font-mono)",
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 6,
  padding: "4px 6px",
  background: "#fff",
  textAlign: "right",
  boxSizing: "border-box",
};

export default function CatalogPicker({
  onAdd,
  onClose,
}: {
  onAdd: (p: SuggestPart, qty: number) => void;
  onClose?: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [total, setTotal] = useState(0);
  // The query these results belong to. Rendering is derived from it rather
  // than the effect clearing state synchronously: results show only while
  // they still match what is typed, which also keeps the previous query's
  // hits from flashing during the next query's 220ms debounce.
  const [resultQ, setResultQ] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [added, setAdded] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchCatalog(query);
        if (my === seq.current) {
          setHits(res.hits);
          setTotal(res.total);
          setResultQ(query);
        }
      });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // Results are shown only while they still match the box (see resultQ).
  const fresh = resultQ === q.trim();
  const shownHits = fresh ? hits : [];
  const shownTotal = fresh ? total : 0;

  const add = (h: CatalogHit) => {
    const qty = parseAddQty(qtys[h.sku] ?? "1");
    onAdd({ sku: h.sku, desc: h.desc, cost: h.cost, price: h.list, unit: h.unit }, qty);
    setAdded(`✓ Added ${qty} × ${h.desc}`);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(""), 2000);
    setQtys({});
    setQ("");
    inputRef.current?.focus();
  };

  return (
    <div
      style={{
        marginTop: 11,
        background: "#fafbfc",
        border: "1px solid #eef0f3",
        borderRadius: 10,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the catalog — description, SKU, or manufacturer…"
          style={FIELD}
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close the catalog"
            aria-label="Close the catalog"
            className="est-close"
            style={{ flexShrink: 0, border: 0, background: "none", cursor: "pointer", fontSize: 14, color: "#9aa0ab", padding: "4px 6px", borderRadius: 6 }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ marginTop: 4, fontSize: 10.5, color: "#aab0bb", padding: "2px 2px" }}>
        {!q.trim()
          ? "Start typing to search the catalog."
          : pending
          ? "Searching…"
          : shownTotal === 0
          ? "No parts match."
          : shownTotal > shownHits.length
          ? `Showing ${shownHits.length} of ${shownTotal} — refine to narrow`
          : `${shownTotal} match${shownTotal === 1 ? "" : "es"}`}
      </div>
      {added && (
        <div role="status" style={{ marginTop: 2, fontSize: 11.5, fontWeight: 600, color: "#1f7a52", padding: "2px 2px" }}>
          {added}
        </div>
      )}

      {shownHits.map((h) => {
        const margin = h.list > 0 ? (h.list - h.cost) / h.list : 0;
        return (
          <div
            key={h.sku}
            className="est-sug"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "9px 11px",
              borderRadius: 8,
              boxSizing: "border-box",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: "block",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {h.desc}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                {h.sku}
                {h.mfr ? " · " + h.mfr : ""}
                {h.category ? " · " + h.category : ""}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ textAlign: "right" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#16181d", display: "block" }}>
                  {fmt(h.list)}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: marginColor(margin) }}>
                  {Math.round(margin * 100)}% · cost {fmt(h.cost)}
                </span>
              </span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label={`Quantity of ${h.desc}`}
                value={qtys[h.sku] ?? "1"}
                onChange={(e) => setQtys((m) => ({ ...m, [h.sku]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(h);
                  }
                }}
                style={QTY}
              />
              <button
                type="button"
                onClick={() => add(h)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: 0,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}
              >
                Add
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
```
(The row was a `<button>`. It is now a `<div>`, because a `<button>` cannot contain an `<input>`. Enter in the *search* box still does nothing new.)

- [ ] **Step 5: Section card + client**

- `section-card.tsx:94`: `onAddPart: (cat: SuggestPart, qty: number) => void;`
- `section-card.tsx:1030`: `<CatalogPicker onAdd={p.onAddPart} onClose={handleToggleCatalog} />`. The toggle on an open catalog calls `closeInput()` through `openInputMethod`, so × and the toggle close the panel the same way.
- `estimator-client.tsx` `addPart` (846-852) becomes:
  ```ts
  /** #160: a catalog add carries its qty and keeps the picker OPEN (rapid-fire);
   *  the panel closes only via its toggle or ×. */
  const addPart = (secId: string, cat: SuggestPart, qty = 1) => {
    const margin = tierMargin != null && tierMargin > 0 && tierMargin < 1 ? tierMargin : 0.3;
    const n = Math.max(1, Math.floor(qty) || 1);
    pushItems(secId, [
      { id: nextId(), sku: cat.sku, desc: cat.desc, qty: n, unit: cat.unit, cost: cat.cost, price: cat.cost > 0 ? round2(cat.cost / (1 - margin)) : cat.price },
    ]);
  };
  ```
- `estimator-client.tsx:2674`: `onAddPart={(cat, qty) => addPart(sec.id, cat, qty)}`
- Check no other caller: `grep -n "addPart(\|onAddPart" "src/app/(app)/estimator/"*.tsx`. Expect only those two sites plus the prop type.

- [ ] **Step 6: Run the tests**

`npm run test:specs 2>&1 | grep -E "catalog qty|qty adds|floored|FAIL"`. Expected: 3 PASS, no FAIL.

- [ ] **Step 7: Run the four gates.**

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/estimator/pricing.ts" "src/app/(app)/estimator/catalog-picker.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/estimator-client.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(estimator): catalog rapid-add — per-row qty, picker stays open, ✓ Added confirm (#160)"
```

---

## Task 10: Browser click-through on a scratch datadir (no code)

This is the spec's manual check. Run it only after every gate has passed and nothing else holds a datadir.

- [ ] **Step 1: Boot on a throwaway datadir** (never `.data/pglite`):
```bash
ps aux | grep -E "tsx|next dev" | grep -v grep   # must show nothing for this checkout
D=$(mktemp -d); echo "$D"
PGLITE_PATH="$D" npx next dev -p 3107
```
(Use the Browser pane's `preview_start` with a launch config that sets `PGLITE_PATH` if preferred. `preview_stop` can leave `next dev` running, so confirm with `ps` afterwards.)

- [ ] **Step 2: Walk the flow** as a dev-login user:
1. `/companies/lakefront` → "+ New quote". The intake opens with **Lakefront Performing Arts Center** in the combobox.
2. Clear it, type `studio` (a venue label). Lakefront is offered. Pick it. Venue: Studio Theatre. Contact: Tom Reyes. Name: `Studio refit`. Type: System → Continue.
3. The Estimator title reads **Studio refit**. The Prepared-for bar shows Studio Theatre and Tom Reyes (not the primaries).
4. Click the title → rename to `Studio refit v2` → Enter. Esc on a second edit reverts. Save. Reload `/estimator?id=<new id>`: the name persisted.
5. "+ Add part from catalog" → search, set qty 4 → Add. `✓ Added 4 × …` shows, the search clears, and the panel stays open. Repeat twice with qty 2 and Enter-in-qty. Three lines, qty 4/2/n.
6. "+ Configure labor" opens with **one** row, "Select type…", 1×1. Pick Install → 4×5. Change people to 6 then pick Hang → stays 6×5.
7. On this draft, "Change type" → intake shows "Change quote type", System preselected, same customer/venue/contact/name. Pick Repair → confirm reads `Q-#### and its 3 lines will be replaced. Continue?` → OK. The repair builder opens pre-filled. Press ← back to Quotes without saving: the old draft still exists. Repeat and Save: the old draft is gone from `/quotes`.
8. Mark any repair quote won via Approve, then change its contact. The D206 confirm appears. Cancel keeps the old contact.
9. A sent quote (`/estimator?id=Q-2038`): "Change type" is greyed with the hint on hover.

- [ ] **Step 3: Stop and clean up**: Ctrl-C the server, `ps` to confirm it is gone, `rm -rf "$D"`.

Report what passed, and file any defect as a fix to the relevant task before Task 11.

---

## Task 11: Close the punch items and log D205–D207

**Files:**
- Modify: `PUNCHLIST.md` (§160 header line 7291 + a `**Shipped …**` paragraph; §161 header line ~7312 + paragraph)
- Modify: `DECISIONS.md` (append after D204, end of file)

- [ ] **Step 1: PUNCHLIST.md**

Change the two headers, following the §148 convention (`— DONE <date> (D…)`):
```
## 160. Quote intake flow — company "+ New quote", searchable customer, name/rename, change type, catalog rapid-add — DONE 2026-09-23 (D205, D206)
```
```
## 161. Estimator Labor opens with one mobilization; the five presets become per-type defaults — DONE 2026-09-23 (D207)
```
At the end of each section (before its `---`), add a `**Shipped 2026-09-23 (<short sha of the last commit for that item>):**` paragraph. It says what landed and names the files: `quotes/new/handoff.ts`, `builderPath` options, `retireReplacedDraft`, `quote-flow-controls.tsx`, the six builders, and the catalog picker. For #161 it names `labor-defaults.ts` `applyMobType`. Report the gate numbers exactly as measured (tsc 0, test:specs N PASS / 0 FAIL, smoke ALL PASSED, eslint counts vs baseline), plus the Task 10 click-through result. Also state the two scope calls from this plan: rental has no won-edit confirm because its Save is locked once won, and system↔custom is not a replace.

- [ ] **Step 2: DECISIONS.md**, appended in the file's existing `## Dnnn. Title (#item, date)` format:
```markdown
## D205. Change type is drafts-only and deletes the old draft — no void status (#160, 2026-09-23)

A quote's type decides its builder, its engine subdoc and what winning spawns, so a type change is
a new quote, not an edit. "Change type" therefore exists only on a **draft** (sent/won/lost render it
disabled: "Already sent — start a new quote instead."). It reopens `/quotes/new?replaces=<id>`
pre-filled from that quote. Picking a different builder confirms with the old quote's id and line count,
then opens the new builder carrying `replaces`. The old draft is soft-deleted (`remove()`) by
`retireReplacedDraft()` **only on the replacement's first save**, and only after a server-side re-check that
it is still a draft. Backing out leaves it untouched, and a quote sent in another tab in the meantime survives.
System and custom both build in the Estimator (category is editable there), so moving between them
reopens the same quote rather than replacing it.

Rejected: a `void` status or marking the old quote `lost`. Either keeps a phantom row in the pipeline,
and `lost` would count against win-rate reports.

## D206. Editing customer, venue or contact on a won quote warns — it doesn't block (#160, 2026-09-23)

Winning spawns a project/job that copies the customer, venue and contact at that moment. Later quote edits
do not flow into it. Every builder now confirms first ("This quote is won — its project/job keeps the old
<field>. Change the quote anyway?"), once per field per visit, and proceeds on OK. Renaming never warns.
The rental builder is exempt because a won rental's Save is already locked. Syncing edits into spawned
records stays out of scope.

## D207. Labor opens with one mobilization; the D136 five are per-type defaults (#161, 2026-09-23)

Supersedes D136's opening rows. Labor now opens with one blank row (Select type…, 1 × 1).
Jeff: the five D136 values (Site Visit 1×1, Install 4×5, Hang 2×3, Commissioning 2×3, Training 1×1) were
always meant as crew-size × days defaults. Picking a type fills them only while the row's numbers still equal
the previous type's defaults (1 × 1 for a blank row). Numbers the user typed, and rows with a custom name,
are left alone. "+ Add mobilization" still adds exactly one row. Resolves PUNCHLIST's "Labor: single
mobilization" question.
```

- [ ] **Step 3: Gates.** These are docs only, so run `npx tsc --noEmit` as a sanity check. The other gates were run in Tasks 1-9.

- [ ] **Step 4: Commit**

```bash
git add PUNCHLIST.md DECISIONS.md
git commit -m "docs: close #160/#161, log D205–D207"
```

---

## Self-review (done while writing)

- **Spec coverage:**
  - §1 company link: T4. §1 combobox: T4. §1 name + fallback: T4 and T5 (service builders keep their own auto-names).
  - §2 `builderPath` + all six builders: T2 and T4-T8. Unknown ids ignored: T2 tests plus the smoke routes. Rental ignores venue: T2 and T8.
  - §3 rename: T5. Won warning: T6-T8.
  - §4 Change type (control, intake prefill, confirm, retire-on-first-save, same type returns): T3, T4, T6-T8.
  - §5 catalog rapid-fire: T9.
  - #161: T1.
  - Testing section: T1-T3, T9 unit/integration. T10 browser. Four gates in every task.
  - Decisions: T11.
- **Type consistency:** `readHandoff → Handoff{customerId, venueId, contactName, name, replaces, type, category}` is used identically in T4, T5, T7 and T8. `BuilderInitial.status/replaces` appears in T7/T8 pages, controls and actions. `retireReplacedDraft(id, replacementId)` is used by T5, T7 and T8. `onAddPart(cat, qty)` is used by T9 section-card and client.
