# One Fixture Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Assembly Builder's two tabs into one builder. It uses the Subassemblies form and the Assemblies pricing logic, and one record type (Fixture or System) serves the Estimator, Quick Design, Grid and the part-documents accessory graph.

**Architecture:** One record type (`FixtureRecord`) lives in the existing `subassemblies` doc table, and the old collection keeps its name. A pure module (`src/lib/fixture-assemblies.ts`) holds the types, the live resolver (`resolveFixture`), the input sanitizer and an adapter (`fixtureAssembliesFrom`). The adapter turns records back into today's `ResolvedFixtureAssembly` shape, so the Estimator, Quick Design and Grid code paths stay the same and the totals match exactly. A one-time conversion does three things. It copies `settings.fixtureAssemblies` into records and rewrites legacy subassembly rows in place, keeping every id. It then moves the accessory graph to a single `fixture:<id>` scope. It runs on first read and from `scripts/fixtures-convert.ts`, and a blob flag gates it.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle doc-store over Postgres/PGlite, tsx test harnesses (`scripts/test-review-and-spec.ts` pure, `scripts/test-review-regressions.ts` DB-backed).

**Spec:** `docs/superpowers/specs/2026-09-25-fixture-builder-merge-design.md` (approved by Jeff 2026-09-25, incl. decision 7).

## Global Constraints

- The result is "one record type, one form, one list ("Assemblies": fixtures + systems), used everywhere assemblies are used today."
- "Form = the Subassemblies form, extended: label, description, light engine, lens, lamp/wattage, default hang position, default circuit, and four boxes (Data / Power / Mounting / Accessories)."
- "Logic = Assemblies: live pricing from the catalog, cost and sell separately, per-line cost override; consumed by Estimator, Quick Design and Grid."
- "Box lines carry a default qty. Qty ≥ 1 = included when the fixture is placed; qty 0 = compatible optional add-on, offered (off by default) in the Estimator / Quick Design / Grid."
- "Required: label + light engine (fixture); label + scope + at least one part (system). Lens optional. A catalog part that no longer exists shows a warning and prices as missing but does not block save."
- "Permission: anyone signed in (`requireUser()`); every save stamps `updatedAt` / `updatedBy`."
- "Storage: one doc-store collection; existing records convert keeping their ids (`fa-…` and `SA-…`)." Keep "the existing `subassemblies` doc table (already registered, soft-delete, `_seq_bump`) — no new table, no SQL migration."
- "New fixtures: `SA-<TS36>` via the existing collision-safe `insertDocIfAbsent`. Converted assemblies keep `fa-…` verbatim so Estimator BOM lines (`sku: assembly.id`) and Grid `fixtureAssemblies` maps keep resolving."
- The conversion is idempotent and one-time. It runs "on first read and via `scripts/fixtures-convert.ts`". "After conversion `settings.fixtureAssemblies` is no longer read (left in place, untouched, as a backup)."
- System scopes: "Lighting, Controls, Audio, Video, Rigging, Curtains, Acoustical, Pit, Other".
- "Accessory graph (fixtures only …): scope `fixture:<id>`; parent = light engine SKU; accessories = lens + every box line (included or optional) … The part-documents branch's `assembly:<id>` / `subassembly:<id>` scopes are re-synced to the single scope and their old rows soft-deleted", keeping any `ownDatasheet` flag on the same pairs. Systems never feed the graph.
- Converted assemblies must produce identical Estimator BOM line totals, Quick Design picks and Grid picks as before.
- `'use client'` files never import a VALUE from `@/lib/stores/*` or `@/db/*`. Type-only imports are fine.
- Destructive UI goes through `ConfirmButton`. Accent-coloured UI uses `var(--accent)` and is never hardcoded.
- Production has ~37,400 catalog parts. Load the catalog once per request and never make one query per part (no N+1).
- Timestamps are epoch-ms numbers (AGENTS.md).
- Punch and decision numbers are placeholders: `#FXB` and `D-FXB-n`. The lead renumbers them at merge.
- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/fixture-builder`. Never `cd` to `/Users/sm/Downloads/peak-app`. Never open a real `.data/pglite`, never `git stash`, and never start a dev server by hand (`test:smoke` boots its own on a scratch datadir).

## Worktree setup (once, before Task 1)

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/fixture-builder
export PATH=$HOME/.local/node/bin:$PATH
ls node_modules >/dev/null 2>&1 || npm ci --no-audit --no-fund      # never symlink node_modules
[ -f next-env.d.ts ] || printf '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n' > next-env.d.ts
[ -f .env.local ] || printf 'AUTH_SECRET=%s\nAUTH_DEV_LOGIN=true\nAUTH_TRUST_HOST=true\n' "$(openssl rand -base64 32)" > .env.local
```

`next-env.d.ts` and `.env.local` are gitignored and must never be committed. Baseline on `d6959f32` (measured): `npx tsc --noEmit` is clean, and `npx eslint` reports `✖ 110 problems (0 errors, 110 warnings)`.

Gate commands used below:

| Gate | Command | Pass |
|---|---|---|
| types | `npx tsc --noEmit` | no output, exit 0 |
| lint | `npx eslint` | 0 errors, ≤ 110 warnings |
| pure specs | `npm run test:specs` | last line `ALL PASSED` |
| DB regressions | `env -u DATABASE_URL npm run test:review:regressions` | `review regression checks passed` |
| routes | `npm run test:smoke` | every route OK |
| build | `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build` then `rm -rf .next` | build succeeds |

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/fixture-assemblies.ts` | modify | Pure. The existing assembly API stays unchanged. Adds the `FixtureRecord` types, box and scope constants, `resolveFixture`, `fixtureDescription`, `fixtureSkus`, `sanitizeFixtureInput`, the `fixtureAssembliesFrom` adapter, and `toSkuMap`. |
| `src/lib/fixtures-convert.ts` | create | Pure. Maps the legacy shapes to records: `assemblyToFixture`, `subassemblyToFixture`, `isLegacySubassembly`, `normalizeFixtureRow`, `planFixtureConversion`. |
| `src/lib/part-docs/assembly-graph.ts` | modify | Pure. Adds `fixturePairs`, `fixtureRef`, `FIXTURE_REF_PREFIX`, `LEGACY_ASSEMBLY_REF_PREFIXES`. `subassemblyPairs` is retyped to `LegacySubassembly`. |
| `src/lib/stores/part-accessory-links.ts` | modify | Adds `retireAccessoryScopes`. |
| `src/lib/part-docs/assembly-sync.ts` | rewrite | `syncAllAssemblyGraphs` writes the `fixture:<id>` scopes add-only, then retires the legacy scopes. The old flag and `ensure*` exports are removed. |
| `src/lib/fixtures-migrate.ts` | create | Server. `convertFixtures`, `fixturesConverted`, `ensureFixturesConverted`, `resetFixturesConversion`, and the blob flag. |
| `scripts/fixtures-convert.ts` + `package.json` | create/modify | CLI: report by default, writes with `--commit`. |
| `src/app/(app)/catalog/documents/page.tsx`, `scripts/part-docs-backfill.ts` | modify | Call the conversion instead of the old one-time graph sync. |
| `src/lib/stores/fixtures.ts` | create | Server store: `listFixtures` (converts on first read), `getFixture`, `createFixture`, `updateFixture`, `removeFixture`. |
| `src/app/(app)/settings/actions.ts` | modify | The go-live reset re-arms the conversion. |
| `src/lib/settings.ts` | modify | Comment on `fixtureAssemblies`: it is now a backup only. |
| `src/app/(app)/estimator/fixture-bom.ts` | create | Pure. The BOM line math (`fixtureBomLine`) and `optionalToggleQty`. |
| `src/app/(app)/estimator/{page.tsx,estimator-client.tsx,fixture-modal.tsx}` | modify | Read fixtures, add an optional add-on switch, and prefill the default position and circuit. |
| `src/app/(app)/design/quick/page.tsx` | modify | Read fixtures. |
| `src/app/(app)/design/assemblies/{page.tsx,actions.ts}` | rewrite | One list plus form; the fixture save, delete and own-datasheet actions. |
| `src/app/(app)/design/assemblies/fixture-builder.tsx` | create | Client: filter, new Fixture/System, saved list. |
| `src/app/(app)/design/assemblies/fixture-form.tsx` | create | Client: the form, line boxes, part picker and live footer. |
| `src/app/(app)/design/assemblies/{assembly-builder.tsx,tabs.tsx}`, `src/app/(app)/design/subassemblies/{subassemblies-client.tsx,actions.ts}` | delete | Replaced by the new builder. |
| `src/lib/stores/subassemblies.ts` | rewrite | Deprecated alias shim. |
| `src/lib/design-routes.ts`, `scripts/smoke-routes.ts` | modify | `/design/subassemblies` redirects to `/design/assemblies`. |
| `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts` | modify | Tests. |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | modify | Docs (Task 7). |

---

### Task 1: The pure fixture model and pricing

**Files:**
- Modify: `src/lib/fixture-assemblies.ts` (line 2 import; `ResolvedFixtureAssembly`; `pricesAsOf`; append the #FXB block)
- Test: `scripts/test-review-and-spec.ts` (append block at EOF)

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `@/lib/fixture-assemblies`):
  - `FIXTURE_BOXES: readonly ["data","power","mounting","accessories"]`, `type FixtureBox`, `FIXTURE_BOX_LABEL: Record<FixtureBox,string>`
  - `SYSTEM_SCOPES` (9 names), `type SystemScope`, `type FixtureKind = "fixture" | "system"`
  - `type FixtureLine = { sku: string; label?: string; qty: number; costOverride?: number }`
  - `type HeadLine = { label?: string; qty?: number; costOverride?: number }`
  - `type FixtureRecord` (see code), `type FixtureOptionCategory = FixtureBox`
  - `type FixtureSlot = "lightEngine" | "lens" | FixtureBox | "parts"`
  - `type FixtureCatalogPart`, `type SkuLookup<P>`, `toSkuMap(catalog): ReadonlyMap<string,P>`
  - `type FixtureResolvable`, `type ResolvedFixturePart`, `type ResolvedFixture`
  - `fixtureLineParts(r): Array<{ slot: FixtureSlot; line: FixtureLine }>`
  - `fixtureSkus(r): string[]`
  - `resolveFixture(r: FixtureResolvable, catalog: SkuLookup<FixtureCatalogPart>, settings?: PriceDateSettings): ResolvedFixture`
  - `fixtureDescription(r: ResolvedFixture): string`
  - `type FixtureInput`, `type CleanFixture`, `sanitizeFixtureInput(input: unknown): { ok: true; value: CleanFixture } | { ok: false; error: string }`
  - `fixtureAssembliesFrom(records: readonly FixtureRecord[], catalog: SkuLookup<FixtureCatalogPart>, settings?: PriceDateSettings): ResolvedFixtureAssembly[]`
  - `ResolvedFixtureAssembly` gains optional `position?: string; circuit?: string`.
  - `pricesAsOf` now also accepts a `ReadonlyMap`.

- [ ] **Step 1: Write the failing test** (append at the very end of `scripts/test-review-and-spec.ts`)

```ts
/* ======================================================================
   #FXB — one fixture builder: resolveFixture / sanitizeFixtureInput /
   fixtureAssembliesFrom. Pure.
   ====================================================================== */
import {
  resolveFixture, fixtureDescription, fixtureSkus, sanitizeFixtureInput, fixtureAssembliesFrom,
  type FixtureRecord as FxbRecord,
} from "@/lib/fixture-assemblies";
{
  const cat = [
    { sku: "FX-ENG", desc: "Engine", unit: "ea", cost: 1000, list: 1500 },
    { sku: "FX-LENS", desc: "Lens 26°", unit: "ea", cost: 200, list: 300 },
    { sku: "FX-CBL", desc: "Power cable", unit: "ea", cost: 40, list: 60 },
    { sku: "FX-CLAMP", desc: "C-clamp", unit: "ea", cost: 10, list: 20 },
  ];
  const rec: FxbRecord = {
    id: "SA-T1", kind: "fixture", label: "S4 LED", description: "",
    lightEngineSku: "FX-ENG", lensSku: "FX-LENS",
    lines: {
      data: [],
      power: [{ sku: "FX-CBL", qty: 1, costOverride: 25 }],
      mounting: [{ sku: "FX-CLAMP", qty: 0 }],
      accessories: [{ sku: "FX-GONE", label: "Iris", qty: 1 }],
    },
    createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const r = resolveFixture(rec, cat);
  ok(r.parts.map((p) => `${p.slot}:${p.sku}`).join(",") === "lightEngine:FX-ENG,lens:FX-LENS,power:FX-CBL,mounting:FX-CLAMP,accessories:FX-GONE", "#FXB resolveFixture: engine, lens, then the boxes in Data/Power/Mounting/Accessories order");
  ok(r.parts[2].cost === 25 && r.parts[2].sell === 60, "#FXB resolveFixture: a cost override beats the catalog cost; sell stays the catalog list");
  ok(r.cost === 1000 + 200 + 25 && r.sell === 1500 + 300 + 60, "#FXB resolveFixture: included totals skip qty-0 optional lines and missing parts");
  const clamp = r.parts.find((p) => p.sku === "FX-CLAMP")!;
  ok(!clamp.included && clamp.cost === 10 && clamp.sell === 20, "#FXB resolveFixture: an optional (qty 0) line lists its unit cost/sell but adds nothing");
  const gone = r.parts.find((p) => p.sku === "FX-GONE")!;
  ok(!gone.found && gone.cost === 0 && gone.sell === 0 && r.missing.join(",") === "FX-GONE" && gone.label === "Iris", "#FXB resolveFixture: a missing part is found:false, priced 0, listed in missing");
  ok(fixtureDescription(r) === "S4 LED — Engine; Lens 26°; Power cable; Iris", "#FXB fixtureDescription: 'Label — part; part' over included parts");
  ok(fixtureSkus(rec).join(",") === "FX-ENG,FX-LENS,FX-CBL,FX-CLAMP,FX-GONE", "#FXB fixtureSkus: every SKU the record prices, once, in form order");

  const sys: FxbRecord = {
    id: "SA-T2", kind: "system", label: "Audio rack", description: "", scope: "Audio",
    lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] },
    parts: [{ sku: "FX-CBL", qty: 2 }, { sku: "FX-CLAMP", qty: 0 }],
    createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const s = resolveFixture(sys, cat);
  ok(s.parts.length === 2 && s.parts.every((p) => p.slot === "parts") && s.cost === 80 && s.sell === 120, "#FXB resolveFixture: a system prices its one parts list with the same line logic");

  const noLabel = sanitizeFixtureInput({ kind: "fixture", label: "  ", description: "" });
  ok(!noLabel.ok && noLabel.error.includes("label"), "#FXB sanitizeFixtureInput: a label is required");
  const noEngine = sanitizeFixtureInput({ kind: "fixture", label: "X", description: "", lightEngineSku: "" });
  ok(!noEngine.ok && /light engine/i.test(noEngine.error), "#FXB sanitizeFixtureInput: a fixture needs a light engine");
  const good = sanitizeFixtureInput({ kind: "fixture", label: " X ", description: "", lightEngineSku: "FX-GONE", lensSku: "", lines: { power: [{ sku: " FX-CBL ", qty: -3 }, { sku: "", qty: 1 }] } });
  ok(good.ok && good.value.label === "X" && good.value.lensSku === null && good.value.lightEngineSku === "FX-GONE" && good.value.lines.power.length === 1 && good.value.lines.power[0].sku === "FX-CBL" && good.value.lines.power[0].qty === 0 && good.value.lines.data.length === 0, "#FXB sanitizeFixtureInput: lens optional, a part missing from the catalog does not block, qty clamps at 0, blank lines drop");
  const badScope = sanitizeFixtureInput({ kind: "system", label: "S", description: "", scope: "Plumbing", parts: [{ sku: "A", qty: 1 }] });
  ok(!badScope.ok && /scope/i.test(badScope.error), "#FXB sanitizeFixtureInput: a system needs one of the nine scopes");
  const noParts = sanitizeFixtureInput({ kind: "system", label: "S", description: "", scope: "Audio", parts: [] });
  ok(!noParts.ok && /part/i.test(noParts.error), "#FXB sanitizeFixtureInput: a system needs at least one part");
  const sysOk = sanitizeFixtureInput({ kind: "system", label: "S", description: "", scope: "Audio", parts: [{ sku: "A", qty: 0 }], lightEngineSku: "IGNORED" });
  ok(sysOk.ok && sysOk.value.scope === "Audio" && sysOk.value.lightEngineSku === "" && sysOk.value.lensSku === null && (sysOk.value.parts || []).length === 1, "#FXB sanitizeFixtureInput: a system keeps scope + parts and no light engine");

  const fa = fixtureAssembliesFrom([rec, sys], cat);
  ok(fa.length === 1 && fa[0].id === "SA-T1" && fa[0].name === "S4 LED", "#FXB fixtureAssembliesFrom: fixtures only, id and label carried");
  ok(fa[0].components.map((c) => `${c.role}:${c.defaultQty}`).join(",") === "fixture:1,lens:1,power:1,mount:0,accessory:1", "#FXB fixtureAssembliesFrom: slots map back to Estimator roles and default quantities");
  ok(fa[0].components[2].cost === 25 && fa[0].components[2].list === 60 && fa[0].components[2].costOverride === 25, "#FXB fixtureAssembliesFrom: the override rides through as the component cost");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run aborts with a module error saying `@/lib/fixture-assemblies` does not provide an export named `resolveFixture`.

- [ ] **Step 3: Implement** in `src/lib/fixture-assemblies.ts`

3a. Replace line 2:

```ts
import type { FixtureOptionCategory } from "@/lib/stores/subassemblies";
```

with nothing. (`FixtureOptionCategory` is now defined locally in 3d. `@/lib/stores/subassemblies` still exports its own identical alias until Task 6.)

3b. Replace the `ResolvedFixtureAssembly` type with:

```ts
export type ResolvedFixtureAssembly = Omit<FixtureAssembly, "components"> & {
  components: ResolvedAssemblyComponent[];
  /** #FXB — the fixture's default hang position / circuit (Estimator pre-fill). */
  position?: string;
  circuit?: string;
};
```

3c. Replace the whole `pricesAsOf` function (signature through closing brace) with:

```ts
/** A catalog as an array or an already-built SKU map (#FXB — the builder
 *  resolves many records against ~37k parts; build the map once). */
export type SkuLookup<P extends { sku: string }> = ReadonlyArray<P> | ReadonlyMap<string, P>;

export function toSkuMap<P extends { sku: string }>(catalog: SkuLookup<P>): ReadonlyMap<string, P> {
  if (catalog instanceof Map) return catalog as ReadonlyMap<string, P>;
  return new Map((catalog as ReadonlyArray<P>).map((p) => [p.sku, p] as const));
}

/** "Prices as of": the NEWEST effective price date among the given SKUs
 *  (own pricedAt or the manufacturer's book date), null when none is dated. */
export function pricesAsOf(
  skus: string[],
  catalog: SkuLookup<{ sku: string; mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {}
): number | null {
  const bySku = toSkuMap(catalog);
  let newest: number | null = null;
  for (const sku of skus) {
    const part = bySku.get(sku);
    if (!part) continue;
    const at = effectivePriceDate(part, settings);
    if (at != null && (newest == null || at > newest)) newest = at;
  }
  return newest;
}
```

3d. Append at the end of the file:

```ts
/* ======================================================================
   #FXB — one fixture builder (spec 2026-09-25-fixture-builder-merge-design.md).
   One record type for fixtures and systems, stored in the `subassemblies`
   doc table (src/lib/stores/fixtures.ts). Pure: client components import
   the constants, the resolver and the input sanitizer.
   ====================================================================== */

export const FIXTURE_BOXES = ["data", "power", "mounting", "accessories"] as const;
export type FixtureBox = (typeof FIXTURE_BOXES)[number];
/** Pre-#FXB name for the four boxes (the Subassemblies option categories). */
export type FixtureOptionCategory = FixtureBox;
export const FIXTURE_BOX_LABEL: Record<FixtureBox, string> = {
  data: "Data",
  power: "Power",
  mounting: "Mounting",
  accessories: "Accessories",
};

export const SYSTEM_SCOPES = ["Lighting", "Controls", "Audio", "Video", "Rigging", "Curtains", "Acoustical", "Pit", "Other"] as const;
export type SystemScope = (typeof SYSTEM_SCOPES)[number];

export type FixtureKind = "fixture" | "system";

/** One part line. qty ≥ 0; 0 = a compatible optional add-on (off by default). */
export type FixtureLine = { sku: string; label?: string; qty: number; costOverride?: number };

/** The light engine / lens row's optional extras. qty defaults to 1. Kept so
 *  a converted Assemblies-tab fixture member keeps its exact label, quantity
 *  and override (identical Estimator totals). */
export type HeadLine = { label?: string; qty?: number; costOverride?: number };

export type FixtureRecord = {
  id: string;
  kind: FixtureKind;
  label: string;
  description: string;
  /** System only. */
  scope?: SystemScope;
  /** Fixture: required. System: "". */
  lightEngineSku: string;
  lensSku: string | null;
  lightEngineLine?: HeadLine;
  lensLine?: HeadLine;
  lamp?: string;
  position?: string;
  circuit?: string;
  /** Fixture boxes (all four always present; empty for a system). */
  lines: Record<FixtureBox, FixtureLine[]>;
  /** System only — its one parts list. */
  parts?: FixtureLine[];
  /** Build-time numbers for the "was $X" badge (price = included sell). */
  snapshot?: { cost: number; price: number; pricedAt: number | null };
  /** Converted from an assembly with no fixture-role member (spec §3). */
  needsReview?: boolean;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  /** Provenance of a converted row; `names` = the old stored names, shown
   *  only as fallback display for a part missing from the catalog. */
  legacy?: { from: "assembly" | "subassembly"; names?: Record<string, string> };
};

export type FixtureSlot = "lightEngine" | "lens" | FixtureBox | "parts";

export type FixtureCatalogPart = { sku: string; desc: string; unit?: string; cost: number; list: number; mfr?: string; pricedAt?: number };

export type FixtureResolvable = Pick<FixtureRecord, "id" | "kind" | "label" | "lightEngineSku" | "lensSku" | "lines"> &
  Partial<Pick<FixtureRecord, "lightEngineLine" | "lensLine" | "parts" | "legacy" | "position" | "circuit">>;

export type ResolvedFixturePart = {
  slot: FixtureSlot;
  sku: string;
  /** line label → catalog desc → stored legacy name → SKU. */
  label: string;
  desc: string;
  unit: string;
  qty: number;
  /** Unit cost: costOverride ?? catalog cost (a missing part: override ?? 0). */
  cost: number;
  /** Unit sell: catalog list (a missing part: 0). */
  sell: number;
  found: boolean;
  /** qty > 0 — counted in the totals. */
  included: boolean;
  costOverride?: number;
};

export type ResolvedFixture = {
  id: string;
  kind: FixtureKind;
  label: string;
  position?: string;
  circuit?: string;
  parts: ResolvedFixturePart[];
  /** Σ over included parts of qty × unit cost / sell. */
  cost: number;
  sell: number;
  missing: string[];
  pricesAsOf: number | null;
};

function headToLine(sku: string, head?: HeadLine): FixtureLine {
  const qty = Number(head?.qty);
  return {
    sku,
    ...(head?.label ? { label: head.label } : {}),
    qty: Number.isFinite(qty) ? Math.max(0, qty) : 1,
    ...(head?.costOverride !== undefined ? { costOverride: head.costOverride } : {}),
  };
}

/** Every priced line in form order: light engine, lens, then the four boxes
 *  (fixture) — or the one parts list (system). */
export function fixtureLineParts(
  r: Pick<FixtureResolvable, "kind" | "lightEngineSku" | "lensSku" | "lines" | "lightEngineLine" | "lensLine" | "parts">
): Array<{ slot: FixtureSlot; line: FixtureLine }> {
  if (r.kind === "system") return (r.parts || []).map((line) => ({ slot: "parts" as const, line }));
  const out: Array<{ slot: FixtureSlot; line: FixtureLine }> = [];
  if (r.lightEngineSku) out.push({ slot: "lightEngine", line: headToLine(r.lightEngineSku, r.lightEngineLine) });
  if (r.lensSku) out.push({ slot: "lens", line: headToLine(r.lensSku, r.lensLine) });
  for (const box of FIXTURE_BOXES) for (const line of r.lines?.[box] || []) out.push({ slot: box, line });
  return out;
}

/** Every SKU a record prices, once — the save action's targeted catalog read. */
export function fixtureSkus(r: Parameters<typeof fixtureLineParts>[0]): string[] {
  return [...new Set(fixtureLineParts(r).map((x) => x.line.sku).filter(Boolean))];
}

/**
 * Price a fixture or system from the CURRENT catalog (spec §4) — the
 * Assemblies rule: cost = costOverride ?? catalog cost, sell = catalog list.
 * Only qty ≥ 1 lines count; a qty-0 optional line lists its unit numbers.
 * A missing part is found:false, sells at 0 and costs its override or 0
 * (the same as resolveFixtureAssemblies, so converted totals are identical).
 */
export function resolveFixture(
  r: FixtureResolvable,
  catalog: SkuLookup<FixtureCatalogPart>,
  settings: PriceDateSettings = {}
): ResolvedFixture {
  const bySku = toSkuMap(catalog);
  const names = r.legacy?.names || {};
  const missing: string[] = [];
  const parts = fixtureLineParts(r).map(({ slot, line }): ResolvedFixturePart => {
    const p = bySku.get(line.sku);
    if (!p && line.sku && !missing.includes(line.sku)) missing.push(line.sku);
    const override =
      typeof line.costOverride === "number" && Number.isFinite(line.costOverride) && line.costOverride >= 0 ? line.costOverride : undefined;
    const qty = Math.max(0, Number(line.qty) || 0);
    return {
      slot,
      sku: line.sku,
      label: line.label || p?.desc || names[line.sku] || line.sku,
      desc: p?.desc || names[line.sku] || "Catalog part not found",
      unit: p?.unit || "ea",
      qty,
      cost: override ?? (Number(p?.cost) || 0),
      sell: Number(p?.list) || 0,
      found: !!p,
      included: qty > 0,
      ...(override !== undefined ? { costOverride: override } : {}),
    };
  });
  let cost = 0;
  let sell = 0;
  for (const part of parts) {
    if (!part.included) continue;
    cost += part.cost * part.qty;
    sell += part.sell * part.qty;
  }
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    ...(r.position ? { position: r.position } : {}),
    ...(r.circuit ? { circuit: r.circuit } : {}),
    parts,
    cost,
    sell,
    missing,
    pricesAsOf: pricesAsOf(parts.map((p) => p.sku), bySku, settings),
  };
}

/** assemblyDescription's "Name — label×qty; …" format over included parts. */
export function fixtureDescription(r: ResolvedFixture): string {
  const included = r.parts.filter((p) => p.included).map((p) => (p.qty === 1 ? p.label : `${p.label} ×${p.qty}`));
  return included.length ? `${r.label} — ${included.join("; ")}` : r.label;
}

export type FixtureInput = {
  id?: string | null;
  kind?: string;
  label?: string;
  description?: string;
  scope?: string;
  lightEngineSku?: string;
  lensSku?: string | null;
  lightEngineLine?: HeadLine;
  lensLine?: HeadLine;
  lamp?: string;
  position?: string;
  circuit?: string;
  lines?: Partial<Record<FixtureBox, FixtureLine[]>>;
  parts?: FixtureLine[];
};

/** A sanitized record body — the store adds id, stamps, snapshot. */
export type CleanFixture = Omit<FixtureRecord, "id" | "snapshot" | "needsReview" | "legacy" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">;

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function cleanLine(raw: unknown): FixtureLine | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Partial<FixtureLine>;
  const sku = text(l.sku, 160);
  if (!sku) return null;
  const qty = Number(l.qty);
  const label = text(l.label, 160);
  const override = l.costOverride == null ? NaN : Number(l.costOverride);
  return {
    sku,
    ...(label ? { label } : {}),
    qty: Number.isFinite(qty) ? Math.max(0, Math.round(qty * 100) / 100) : 0,
    ...(Number.isFinite(override) && override >= 0 ? { costOverride: override } : {}),
  };
}

function cleanHead(raw: unknown): HeadLine | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const h = raw as HeadLine;
  const label = text(h.label, 160);
  const qty = Number(h.qty);
  const override = h.costOverride == null ? NaN : Number(h.costOverride);
  const out: HeadLine = {
    ...(label ? { label } : {}),
    ...(h.qty != null && Number.isFinite(qty) ? { qty: Math.max(0, Math.round(qty * 100) / 100) } : {}),
    ...(Number.isFinite(override) && override >= 0 ? { costOverride: override } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/**
 * The save rules (spec §2.4): label + light engine (fixture); label + scope +
 * at least one part (system). Lens optional. A SKU missing from the catalog
 * is NOT an error here — it prices as missing and shows a warning.
 */
export function sanitizeFixtureInput(input: unknown): { ok: true; value: CleanFixture } | { ok: false; error: string } {
  const i = (input && typeof input === "object" ? input : {}) as FixtureInput;
  const kind: FixtureKind = i.kind === "system" ? "system" : "fixture";
  const label = text(i.label, 160);
  if (!label) return { ok: false, error: "Add a label." };
  const description = text(i.description, 2000);
  const lines: Record<FixtureBox, FixtureLine[]> = { data: [], power: [], mounting: [], accessories: [] };
  const cleanList = (raw: unknown) => (Array.isArray(raw) ? raw : []).map(cleanLine).filter((l): l is FixtureLine => !!l);
  if (kind === "system") {
    const scope = SYSTEM_SCOPES.find((s) => s === i.scope);
    if (!scope) return { ok: false, error: "Pick a scope for the system." };
    const parts = cleanList(i.parts);
    if (!parts.length) return { ok: false, error: "Add at least one part to the system." };
    return { ok: true, value: { kind, label, description, scope, lightEngineSku: "", lensSku: null, lines, parts } };
  }
  const lightEngineSku = text(i.lightEngineSku, 160);
  if (!lightEngineSku) return { ok: false, error: "Pick a light engine from the catalog." };
  const lensSku = text(i.lensSku, 160) || null;
  for (const box of FIXTURE_BOXES) lines[box] = cleanList(i.lines?.[box]);
  const lightEngineLine = cleanHead(i.lightEngineLine);
  const lensLine = lensSku ? cleanHead(i.lensLine) : undefined;
  const lamp = text(i.lamp, 120);
  const position = text(i.position, 120);
  const circuit = text(i.circuit, 120);
  return {
    ok: true,
    value: {
      kind,
      label,
      description,
      lightEngineSku,
      lensSku,
      ...(lightEngineLine ? { lightEngineLine } : {}),
      ...(lensLine ? { lensLine } : {}),
      ...(lamp ? { lamp } : {}),
      ...(position ? { position } : {}),
      ...(circuit ? { circuit } : {}),
      lines,
    },
  };
}

const SLOT_ROLE: Record<FixtureSlot, AssemblyRole> = {
  lightEngine: "fixture",
  lens: "lens",
  data: "data",
  power: "power",
  mounting: "mount",
  accessories: "accessory",
  parts: "other",
};

/**
 * Fixture records → the Estimator/Quick Design shape (ResolvedFixtureAssembly),
 * so those consumers keep one code path: id → id, label → name, every priced
 * line → a component (qty → defaultQty, sell → list). Systems are left out —
 * the pickers list fixtures (spec §5).
 */
export function fixtureAssembliesFrom(
  records: readonly FixtureRecord[],
  catalog: SkuLookup<FixtureCatalogPart>,
  settings: PriceDateSettings = {}
): ResolvedFixtureAssembly[] {
  const bySku = toSkuMap(catalog);
  return records
    .filter((r) => r.kind === "fixture")
    .map((r) => {
      const x = resolveFixture(r, bySku, settings);
      return {
        id: x.id,
        name: x.label,
        ...(x.position ? { position: x.position } : {}),
        ...(x.circuit ? { circuit: x.circuit } : {}),
        components: x.parts.map((p) => ({
          sku: p.sku,
          label: p.label,
          role: SLOT_ROLE[p.slot],
          defaultQty: p.qty,
          ...(p.costOverride !== undefined ? { costOverride: p.costOverride } : {}),
          desc: p.desc,
          unit: p.unit,
          cost: p.cost,
          list: p.sell,
          found: p.found,
        })),
      };
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "FAIL|#FXB|ALL PASSED|FAILED" | tail -30`
Expected: every `#FXB` line is `PASS`, the existing `#129 pricesAsOf` lines still pass, and the run ends with `ALL PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fixture-assemblies.ts scripts/test-review-and-spec.ts
git commit -m "feat(fixtures): pure fixture model, live resolver and save rules (#FXB)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure conversion and graph pairs

**Files:**
- Create: `src/lib/fixtures-convert.ts`
- Modify: `src/lib/part-docs/assembly-graph.ts` (imports, `subassemblyPairs` param type, append fixture helpers)
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes (Task 1): `FixtureRecord`, `FixtureLine`, `HeadLine`, `FixtureBox`, `FIXTURE_BOXES`, `sanitizeFixtureAssemblies`, `FixtureAssembly`, `FixtureAssemblyComponent`, `AssemblyRole`, `resolveFixture`, `fixtureAssembliesFrom`, `resolveFixtureAssemblies`, `assemblyUnitTotals`.
- Produces:
  - `@/lib/fixtures-convert`: `type LegacyOption`, `type LegacySubassembly`, `type RawFixtureRow = Record<string, unknown> & { id: string }`, `CONVERTED_BY`, `assemblyToFixture(a: FixtureAssembly, at: number): FixtureRecord`, `isLegacySubassembly(row: Record<string, unknown>): boolean`, `subassemblyToFixture(s: LegacySubassembly): FixtureRecord`, `normalizeFixtureRow(row: RawFixtureRow): FixtureRecord`, `planFixtureConversion(settingsAssemblies: unknown, rows: readonly RawFixtureRow[], at: number): { inserts: FixtureRecord[]; rewrites: FixtureRecord[] }`
  - `@/lib/part-docs/assembly-graph`: `FIXTURE_REF_PREFIX = "fixture:"`, `fixtureRef(id): string`, `LEGACY_ASSEMBLY_REF_PREFIXES = ["assembly:", "subassembly:"] as const`, `fixturePairs(r): AccessoryPair[]`

- [ ] **Step 1: Write the failing test** (append at EOF of `scripts/test-review-and-spec.ts`)

```ts
/* ======================================================================
   #FXB — conversion (role mapping, ids kept, idempotent), converted-assembly
   parity, and the fixture: graph scope. Pure.
   ====================================================================== */
import { assemblyToFixture, subassemblyToFixture, isLegacySubassembly, planFixtureConversion, normalizeFixtureRow } from "@/lib/fixtures-convert";
import { fixturePairs, fixtureRef, FIXTURE_REF_PREFIX, LEGACY_ASSEMBLY_REF_PREFIXES } from "@/lib/part-docs/assembly-graph";
{
  const asm = {
    id: "fa-conv", name: "House S4", components: [
      { sku: "C-LENS", label: "Lens", role: "lens" as const, defaultQty: 1 },
      { sku: "C-ENG", label: "Engine", role: "fixture" as const, defaultQty: 1 },
      { sku: "C-ENG2", label: "Second body", role: "fixture" as const, defaultQty: 0 },
      { sku: "C-LENS2", label: "Alt lens", role: "lens" as const, defaultQty: 0 },
      { sku: "C-DATA", label: "DMX", role: "data" as const, defaultQty: 2 },
      { sku: "C-PWR", label: "Power", role: "power" as const, defaultQty: 1, costOverride: 12 },
      { sku: "C-MNT", label: "Clamp", role: "mount" as const, defaultQty: 1 },
      { sku: "C-ACC", label: "Iris", role: "accessory" as const, defaultQty: 0 },
      { sku: "C-CBL", label: "Safety", role: "cable" as const, defaultQty: 1 },
      { sku: "C-LAMP", label: "Lamp", role: "lamp" as const, defaultQty: 1 },
      { sku: "C-OTH", label: "Misc", role: "other" as const, defaultQty: 1 },
    ],
  };
  const f = assemblyToFixture(asm, 1000);
  ok(f.id === "fa-conv" && f.kind === "fixture" && f.label === "House S4" && f.legacy?.from === "assembly" && f.createdAt === 1000, "#FXB convert: an assembly keeps its fa- id and name");
  ok(f.lightEngineSku === "C-ENG" && f.lightEngineLine?.label === "Engine" && f.lightEngineLine?.qty === 1 && f.lensSku === "C-LENS" && f.lensLine?.label === "Lens", "#FXB convert: first fixture → light engine, first lens → lens (label and qty kept)");
  ok(f.lines.data.map((l) => `${l.sku}x${l.qty}`).join() === "C-DATAx2" && f.lines.power[0].costOverride === 12 && f.lines.mounting.map((l) => l.sku).join() === "C-MNT", "#FXB convert: data/power/mount → Data/Power/Mounting, qty and override carried");
  ok(f.lines.accessories.map((l) => l.sku).join(",") === "C-ENG2,C-LENS2,C-ACC,C-CBL,C-LAMP,C-OTH", "#FXB convert: extra fixture/lens members + accessory/cable/lamp/other → Accessories, order kept");
  ok(!f.needsReview, "#FXB convert: an assembly with a fixture member needs no review");
  const kit = assemblyToFixture({ id: "fa-ne", name: "Cable kit", components: [{ sku: "K1", label: "Cable", role: "cable", defaultQty: 3 }, { sku: "K2", label: "Clamp", role: "mount", defaultQty: 1 }] }, 1000);
  ok(kit.lightEngineSku === "K1" && kit.lightEngineLine?.qty === 3 && kit.needsReview === true && kit.lines.mounting[0].sku === "K2" && kit.lines.accessories.length === 0, "#FXB convert: no fixture member → the first component becomes the light engine, flagged needsReview");

  // Parity: the converted record yields the same Estimator / Quick Design numbers.
  const cat = [
    { sku: "C-ENG", desc: "Engine", unit: "ea", cost: 1000, list: 1500 },
    { sku: "C-ENG2", desc: "Body 2", unit: "ea", cost: 900, list: 1400 },
    { sku: "C-LENS", desc: "Lens", unit: "ea", cost: 200, list: 300 },
    { sku: "C-LENS2", desc: "Lens 2", unit: "ea", cost: 250, list: 350 },
    { sku: "C-DATA", desc: "DMX", unit: "ea", cost: 5, list: 9 },
    { sku: "C-PWR", desc: "Power", unit: "ea", cost: 40, list: 60 },
    { sku: "C-MNT", desc: "Clamp", unit: "ea", cost: 10, list: 20 },
    { sku: "C-ACC", desc: "Iris", unit: "ea", cost: 30, list: 45 },
    { sku: "C-CBL", desc: "Safety", unit: "ea", cost: 8, list: 12 },
    { sku: "C-LAMP", desc: "Lamp", unit: "ea", cost: 50, list: 80 },
    { sku: "C-OTH", desc: "Misc", unit: "ea", cost: 3, list: 5 },
  ];
  const before = resolveFixtureAssemblies([asm], cat)[0];
  const after = fixtureAssembliesFrom([f], cat)[0];
  const bt = assemblyUnitTotals(before);
  const at = assemblyUnitTotals(after);
  ok(after.id === before.id && after.name === before.name && bt.cost === at.cost && bt.sell === at.sell && bt.cost === 1293 && bt.sell === 1995, "#FXB parity: a converted assembly keeps its id, name and unit cost/sell");
  const key = (c: { sku: string; label: string; defaultQty: number; cost: number; list: number; found: boolean }) => `${c.sku}|${c.label}|${c.defaultQty}|${c.cost}|${c.list}|${c.found}`;
  ok(JSON.stringify(before.components.map(key).sort()) === JSON.stringify(after.components.map(key).sort()), "#FXB parity: the same component set (sku, label, qty, cost, sell)");
  const pick = (a: typeof before) => ({ name: a.name, cost: assemblyUnitTotals(a).cost });
  ok(JSON.stringify(pick(before)) === JSON.stringify(pick(after)), "#FXB parity: the Quick Design / Grid pick under this id prices the same");

  // Legacy subassembly rows.
  const legacy = {
    id: "SA-OLD", kind: "fixture" as const, label: "Old", description: "d",
    lightEngineSku: "C-ENG", lightEngineName: "Engine (old)", lightEngineCost: 900,
    lensSku: "C-LENS", lensName: "Lens (old)", lensCost: 150,
    lamp: "LED", position: "FOH", circuit: "12",
    options: { data: [{ sku: "C-DATA", name: "DMX (old)", cost: 5, qty: 2 }], power: [], mounting: [], accessories: [{ sku: "C-GONE", name: "Gone part", cost: 3, qty: 1 }] },
    cost: 1065, price: 1065, snapshot: { cost: 1065, price: 1065, pricedAt: null }, createdAt: 5, updatedAt: 6,
  };
  ok(isLegacySubassembly(legacy), "#FXB convert: a pre-#FXB subassembly row is recognised");
  const s = subassemblyToFixture(legacy);
  ok(s.id === "SA-OLD" && s.lensSku === "C-LENS" && s.lines.data[0].qty === 2 && s.lines.accessories[0].sku === "C-GONE" && s.lamp === "LED" && s.position === "FOH" && s.circuit === "12" && s.createdAt === 5 && s.updatedAt === 6 && s.legacy?.from === "subassembly", "#FXB convert: a subassembly is rewritten to the new shape, id and fields kept");
  ok(!isLegacySubassembly(s as unknown as Record<string, unknown>) && !("options" in s) && !("lightEngineName" in s), "#FXB convert: a converted row is no longer legacy and drops the stored-name fields");
  const gone = resolveFixture(s, cat).parts.find((p) => p.sku === "C-GONE")!;
  ok(!gone.found && gone.label === "Gone part", "#FXB convert: a converted row's old stored name is the fallback display for a missing part");
  ok(normalizeFixtureRow(legacy as unknown as Record<string, unknown> & { id: string }).lines.data[0].sku === "C-DATA", "#FXB normalizeFixtureRow: a legacy row reads as the new shape in memory");

  const rows = [legacy as unknown as Record<string, unknown> & { id: string }];
  const p1 = planFixtureConversion([asm], rows, 1000);
  ok(p1.inserts.map((r) => r.id).join() === "fa-conv" && p1.rewrites.map((r) => r.id).join() === "SA-OLD", "#FXB plan: settings assemblies insert, legacy rows rewrite");
  const applied = [...p1.rewrites, ...p1.inserts] as unknown as Array<Record<string, unknown> & { id: string }>;
  const p2 = planFixtureConversion([asm], applied, 2000);
  ok(p2.inserts.length === 0 && p2.rewrites.length === 0, "#FXB plan: running the conversion twice changes nothing");

  // The accessory graph: one fixture: scope; systems feed nothing.
  const pairs = fixturePairs({ kind: "fixture", lightEngineSku: "G-ENG", lensSku: "G-LENS", lines: { data: [{ sku: "G-DMX", qty: 2 }], power: [], mounting: [{ sku: "G-CLAMP", qty: 0 }], accessories: [{ sku: "G-ENG", qty: 1 }] } });
  ok(pairs.map((p) => `${p.parentSku}>${p.accessorySku}:${p.included ? p.maxQty : "opt"}`).join(",") === "G-ENG>G-LENS:1,G-ENG>G-DMX:2,G-ENG>G-CLAMP:opt", "#FXB graph: lens + every box line (optional ones un-included) under the light engine; the engine itself skipped");
  ok(fixturePairs({ kind: "system", lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] } }).length === 0, "#FXB graph: systems don't feed the graph");
  ok(fixtureRef("fa-1") === "fixture:fa-1" && FIXTURE_REF_PREFIX === "fixture:" && LEGACY_ASSEMBLY_REF_PREFIXES.join() === "assembly:,subassembly:", "#FXB graph: one fixture:<id> scope; the two legacy prefixes are named for retirement");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: aborts with `Cannot find module '@/lib/fixtures-convert'`.

- [ ] **Step 3a: Create `src/lib/fixtures-convert.ts`**

```ts
import {
  FIXTURE_BOXES,
  sanitizeFixtureAssemblies,
  type AssemblyRole,
  type FixtureAssembly,
  type FixtureAssemblyComponent,
  type FixtureBox,
  type FixtureLine,
  type FixtureRecord,
  type HeadLine,
} from "./fixture-assemblies";

/**
 * #FXB conversion — pure. The Assemblies tab's `settings.fixtureAssemblies`
 * entries and the Subassemblies tab's rows become one FixtureRecord shape,
 * keeping their ids (spec §3). The server runner is src/lib/fixtures-migrate.ts.
 */

/** The Subassemblies tab's stored option (pre-#FXB, #129). */
export type LegacyOption = { sku: string; name: string; cost: number; qty: number };

/** The Subassemblies tab's stored row (pre-#FXB). */
export type LegacySubassembly = {
  id: string;
  kind: "fixture";
  label: string;
  description: string;
  lightEngineSku: string;
  lightEngineName: string;
  lightEngineCost: number;
  lensSku: string;
  lensName: string;
  lensCost: number;
  lamp?: string;
  position?: string;
  circuit?: string;
  options: Record<FixtureBox, LegacyOption[]>;
  cost: number;
  price: number;
  snapshot?: { cost: number; price: number; pricedAt: number | null };
  createdAt: number;
  updatedAt: number;
};

export type RawFixtureRow = Record<string, unknown> & { id: string };

export const CONVERTED_BY = "Fixture builder conversion";

const ROLE_BOX: Partial<Record<AssemblyRole, FixtureBox>> = { data: "data", power: "power", mount: "mounting" };
const emptyBoxes = (): Record<FixtureBox, FixtureLine[]> => ({ data: [], power: [], mounting: [], accessories: [] });
const toLine = (c: FixtureAssemblyComponent): FixtureLine => ({
  sku: c.sku,
  label: c.label,
  qty: c.defaultQty,
  ...(c.costOverride !== undefined ? { costOverride: c.costOverride } : {}),
});
const toHead = (c: FixtureAssemblyComponent): HeadLine => ({
  label: c.label,
  qty: c.defaultQty,
  ...(c.costOverride !== undefined ? { costOverride: c.costOverride } : {}),
});

/**
 * One Assemblies-tab entry → a fixture (spec §3 role mapping): first
 * `fixture` → light engine; first `lens` → lens; data/power → those boxes;
 * mount → Mounting; accessory, cable, lamp, other and any extra fixture/lens
 * members → Accessories, component order kept. With no fixture member the
 * first component is the light engine and the record is `needsReview`.
 */
export function assemblyToFixture(a: FixtureAssembly, at: number): FixtureRecord {
  const comps = a.components || [];
  const engineIdx = comps.findIndex((c) => c.role === "fixture");
  const needsReview = engineIdx < 0;
  const headIdx = needsReview ? 0 : engineIdx;
  const lensIdx = comps.findIndex((c, i) => c.role === "lens" && i !== headIdx);
  const lines = emptyBoxes();
  comps.forEach((c, i) => {
    if (i === headIdx || i === lensIdx) return;
    lines[ROLE_BOX[c.role] ?? "accessories"].push(toLine(c));
  });
  const head = comps[headIdx];
  const lens = lensIdx >= 0 ? comps[lensIdx] : undefined;
  return {
    id: a.id,
    kind: "fixture",
    label: a.name,
    description: "",
    lightEngineSku: head?.sku || "",
    ...(head ? { lightEngineLine: toHead(head) } : {}),
    lensSku: lens?.sku || null,
    ...(lens ? { lensLine: toHead(lens) } : {}),
    lines,
    ...(needsReview ? { needsReview: true } : {}),
    createdAt: at,
    createdBy: CONVERTED_BY,
    updatedAt: at,
    updatedBy: CONVERTED_BY,
    legacy: { from: "assembly" },
  };
}

/** A row in the pre-#FXB shape (no `lines` object). */
export function isLegacySubassembly(row: Record<string, unknown>): boolean {
  const lines = row.lines;
  return !(lines && typeof lines === "object");
}

/** A Subassemblies-tab row → a fixture, rewritten in place (same id). The
 *  stored names survive only as `legacy.names` (fallback display). */
export function subassemblyToFixture(s: LegacySubassembly): FixtureRecord {
  const names: Record<string, string> = {};
  if (s.lightEngineSku && s.lightEngineName) names[s.lightEngineSku] = s.lightEngineName;
  if (s.lensSku && s.lensName) names[s.lensSku] = s.lensName;
  const lines = emptyBoxes();
  for (const box of FIXTURE_BOXES) {
    for (const o of s.options?.[box] || []) {
      if (!o?.sku) continue;
      lines[box].push({ sku: o.sku, qty: Math.max(1, Math.round(Number(o.qty) || 1)) });
      if (o.name) names[o.sku] = o.name;
    }
  }
  return {
    id: s.id,
    kind: "fixture",
    label: String(s.label || s.id),
    description: String(s.description || ""),
    lightEngineSku: s.lightEngineSku || "",
    lensSku: s.lensSku || null,
    ...(s.lamp ? { lamp: s.lamp } : {}),
    ...(s.position ? { position: s.position } : {}),
    ...(s.circuit ? { circuit: s.circuit } : {}),
    lines,
    ...(s.snapshot ? { snapshot: s.snapshot } : {}),
    createdAt: Number(s.createdAt) || 0,
    createdBy: CONVERTED_BY,
    updatedAt: Number(s.updatedAt) || 0,
    updatedBy: CONVERTED_BY,
    legacy: { from: "subassembly", ...(Object.keys(names).length ? { names } : {}) },
  };
}

/** Any stored row → a FixtureRecord (legacy rows convert in memory). */
export function normalizeFixtureRow(row: RawFixtureRow): FixtureRecord {
  if (isLegacySubassembly(row)) return subassemblyToFixture(row as unknown as LegacySubassembly);
  const r = row as unknown as FixtureRecord;
  const lines = emptyBoxes();
  for (const box of FIXTURE_BOXES) if (Array.isArray(r.lines?.[box])) lines[box] = r.lines[box];
  const kind = r.kind === "system" ? "system" : "fixture";
  return {
    ...r,
    kind,
    label: String(r.label || r.id),
    description: String(r.description || ""),
    lightEngineSku: String(r.lightEngineSku || ""),
    lensSku: r.lensSku || null,
    lines,
    ...(kind === "system" ? { parts: Array.isArray(r.parts) ? r.parts : [] } : {}),
  };
}

/**
 * What a conversion pass must write: every settings assembly with no live
 * row of that id (insert-if-absent, so a soft-deleted one stays deleted), and
 * every live row still in the legacy shape (rewrite in place). Running it
 * again over the result plans nothing.
 */
export function planFixtureConversion(
  settingsAssemblies: unknown,
  rows: readonly RawFixtureRow[],
  at: number
): { inserts: FixtureRecord[]; rewrites: FixtureRecord[] } {
  const live = new Set(rows.map((r) => r.id));
  const inserts = sanitizeFixtureAssemblies(settingsAssemblies)
    .filter((a) => !live.has(a.id))
    .map((a) => assemblyToFixture(a, at));
  const rewrites = rows.filter((r) => isLegacySubassembly(r)).map((r) => subassemblyToFixture(r as unknown as LegacySubassembly));
  return { inserts, rewrites };
}
```

- [ ] **Step 3b: Modify `src/lib/part-docs/assembly-graph.ts`**

Replace the first two import lines:

```ts
import type { FixtureAssembly } from "@/lib/fixture-assemblies";
import type { FixtureSubassembly } from "@/lib/stores/subassemblies";
```

with:

```ts
import { FIXTURE_BOXES, type FixtureAssembly, type FixtureRecord, type HeadLine } from "@/lib/fixture-assemblies";
import type { LegacySubassembly } from "@/lib/fixtures-convert";
```

In `subassemblyPairs`, change the parameter type from `Pick<FixtureSubassembly, "lightEngineSku" | "lensSku" | "options">` to `Pick<LegacySubassembly, "lightEngineSku" | "lensSku" | "options">`. Leave the body unchanged.

Append at the end of the file:

```ts
/* ---- #FXB — one fixture builder, one scope ---------------------------- */

/** The merged builder's scope. The two part-documents scopes above are
 *  retired (soft-deleted) once the fixture: scope is written. */
export const FIXTURE_REF_PREFIX = "fixture:";
export const fixtureRef = (id: string) => `${FIXTURE_REF_PREFIX}${id}`;
export const LEGACY_ASSEMBLY_REF_PREFIXES = [ASSEMBLY_REF_PREFIX, SUBASSEMBLY_REF_PREFIX] as const;

/**
 * A fixture record's accessory pairs (spec §5): parent = light engine;
 * accessories = lens + every box line, included (qty ≥ 1, maxQty = qty) or
 * optional (qty 0, un-included link). Systems feed nothing.
 */
export function fixturePairs(r: Pick<FixtureRecord, "kind" | "lightEngineSku" | "lensSku" | "lines"> & { lensLine?: HeadLine }): AccessoryPair[] {
  if (r.kind !== "fixture" || !r.lightEngineSku) return [];
  const parentSku = r.lightEngineSku;
  const out: AccessoryPair[] = [];
  const push = (sku: string, qty: number) => {
    if (!sku || sku === parentSku) return;
    out.push({ parentSku, accessorySku: sku, ...(qty > 0 ? { maxQty: qty, included: true } : {}) });
  };
  if (r.lensSku) push(r.lensSku, r.lensLine?.qty ?? 1);
  for (const box of FIXTURE_BOXES) for (const l of r.lines?.[box] || []) push(l.sku, Number(l.qty) || 0);
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "FAIL|#FXB|part docs assemblies|ALL PASSED|FAILED" | tail -40`
Expected: all `#FXB` lines and the existing `part docs assemblies:` lines are `PASS`, ending with `ALL PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fixtures-convert.ts src/lib/part-docs/assembly-graph.ts scripts/test-review-and-spec.ts
git commit -m "feat(fixtures): pure conversion keeping ids, fixture: graph pairs (#FXB)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The one-time conversion runner and the graph move

**Files:**
- Modify: `src/lib/stores/part-accessory-links.ts` (append `retireAccessoryScopes`)
- Rewrite: `src/lib/part-docs/assembly-sync.ts`
- Create: `src/lib/fixtures-migrate.ts`, `scripts/fixtures-convert.ts`
- Modify: `package.json` (script), `src/app/(app)/catalog/documents/page.tsx`, `scripts/part-docs-backfill.ts`
- Test: `scripts/test-review-regressions.ts` (rewrite I2 region + I5 tail)

**Interfaces:**
- Consumes (Task 2): `normalizeFixtureRow`, `planFixtureConversion`, `RawFixtureRow`, `fixturePairs`, `fixtureRef`, `LEGACY_ASSEMBLY_REF_PREFIXES`; existing `syncAccessoryScopeSet`, `softDeleteDocs`, `getSettingsStrict`, `getBlob`/`setBlob`.
- Produces:
  - `@/lib/stores/part-accessory-links`: `retireAccessoryScopes(source: AccessoryLinkSource, prefixes: readonly string[], opts?: DocBatchOpts): Promise<{ removed: number; complete: boolean }>`
  - `@/lib/part-docs/assembly-sync`: `type AssemblyGraphSyncResult = { fixtures: number; written: number; removed: number; complete: boolean }`, `syncAllAssemblyGraphs(opts?: { shouldStop?: () => boolean })`. Removed exports: `GRAPH_SYNC_BLOB_ID`, `GRAPH_SYNC_BUDGET_MS`, `assemblyGraphSynced`, `ensureAssemblyGraphSynced`.
  - `@/lib/fixtures-migrate`: `FIXTURES_CONVERT_BLOB_ID = "fixtures_convert"`, `FIXTURES_CONVERT_BUDGET_MS = 15_000`, `type FixtureConvertResult = { inserted; rewritten; graphWritten; graphRemoved; complete }`, `convertFixtures(opts?: { shouldStop?: () => boolean; now?: number }): Promise<FixtureConvertResult>`, `fixturesConverted(): Promise<boolean>`, `ensureFixturesConverted(budgetMs?: number, now?: () => number): Promise<boolean>` (never throws; true once converted), `resetFixturesConversion(): Promise<void>`.

- [ ] **Step 1: Write the failing test.** Edit `scripts/test-review-regressions.ts`.

1a. Replace every line from `    // I2: the one-time Assembly Builder → graph sync.` through `    await setSettings({ fixtureAssemblies: priorAssemblies });` (inclusive; the `  }` that follows stays) with:

```ts
    // I2 → #FXB: the one-time fixture conversion — settings assemblies and
    // legacy subassemblies become fixture records (ids kept), and the graph
    // moves from assembly:/subassembly: to one fixture:<id> scope.
    const { setSettings } = await import("@/lib/settings");
    const { insertDocIfAbsent } = DS;
    const Mig = await import("@/lib/fixtures-migrate");
    const { getDb } = await import("@/db");
    const { blobs } = await import("@/db/doc-tables");
    const { eq } = await import("drizzle-orm");
    const { getSettings } = await import("@/lib/settings");
    await (await getDb()).delete(blobs).where(eq(blobs.id, Mig.FIXTURES_CONVERT_BLOB_ID));
    const priorAssemblies = ((await getSettings()).fixtureAssemblies ?? []) as unknown[];
    assert.equal(priorAssemblies.length, 0, "#FXB: the test database starts with no fixture assemblies");
    const fwAssemblies = [
      { id: "fw-asm", name: "FW assembly", components: [
        { sku: "FW-S4", label: "Engine", role: "fixture", defaultQty: 1 },
        { sku: "FW-LENS", label: "Lens", role: "lens", defaultQty: 1 },
        { sku: "FW-CLAMP", label: "Clamp", role: "mount", defaultQty: 0 },
      ] },
    ];
    await setSettings({ fixtureAssemblies: fwAssemblies });
    await insertDocIfAbsent("subassemblies", {
      id: "SA-FW", kind: "fixture", label: "FW sub", description: "", lightEngineSku: "FW-S4", lightEngineName: "", lightEngineCost: 0,
      lensSku: "FW-LENS2", lensName: "", lensCost: 0, options: { data: [{ sku: "FW-DATA", name: "", cost: 0, qty: 2 }], power: [], mounting: [], accessories: [] },
      cost: 0, price: 0, createdAt: 1, updatedAt: 1,
    });
    // The part-documents build's scopes as a database that ran its one-time
    // sync holds them, a deleted assembly's leftovers, DaVinci's scope, and a
    // human's own-datasheet flag on one pair.
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "assembly:fw-asm" }, [{ parentSku: "FW-S4", accessorySku: "FW-LENS", maxQty: 1, included: true }, { parentSku: "FW-S4", accessorySku: "FW-CLAMP" }]);
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "subassembly:SA-FW" }, [{ parentSku: "FW-S4", accessorySku: "FW-LENS2", maxQty: 1, included: true }, { parentSku: "FW-S4", accessorySku: "FW-DATA", maxQty: 2, included: true }]);
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "assembly:fw-gone" }, [{ parentSku: "FW-OLD", accessorySku: "FW-OLDACC" }]);
    await Acc.syncAccessoryLinks({ source: "davinci", sourceRef: "TY-FWX" }, [{ parentSku: "FW-S4", accessorySku: "FW-LENS" }]);
    await Acc.setOwnDatasheet("FW-S4", "FW-LENS", true);
    assert.equal(await Mig.fixturesConverted(), false, "#FXB: a fresh database has not converted");
    const r1 = await Mig.convertFixtures();
    assert(r1.complete && r1.inserted === 1 && r1.rewritten === 1 && r1.graphWritten === 4 && r1.graphRemoved >= 5, `#FXB: the first run converts one assembly + one subassembly and moves the graph (got ${JSON.stringify(r1)})`);
    assert.equal(await Mig.fixturesConverted(), true, "#FXB: a completed conversion sets the flag");
    const fw = (await DS.getDoc<Record<string, unknown> & { id: string }>("subassemblies", "fw-asm"))!;
    const fwLines = fw.lines as Record<string, Array<{ sku: string; qty: number }>>;
    assert(fw && fw.lightEngineSku === "FW-S4" && fw.lensSku === "FW-LENS" && fwLines.mounting[0]?.sku === "FW-CLAMP" && fwLines.mounting[0]?.qty === 0, "#FXB: the settings assembly converted by role, keeping its fa-style id");
    const sa = (await DS.getDoc<Record<string, unknown> & { id: string }>("subassemblies", "SA-FW"))!;
    assert(!!sa.lines && sa.options === undefined, "#FXB: the legacy subassembly row is rewritten in place under its SA- id");
    assert.equal(((await getSettings()).fixtureAssemblies ?? []).length, 1, "#FXB: settings.fixtureAssemblies is left untouched as a backup");
    const live = await Acc.allAccessoryLinks();
    const has = (ref: string, parent: string, acc: string) => live.some((l) => l.source === "assembly" && l.sourceRef === ref && l.parentSku === parent && l.accessorySku === acc);
    assert(has("fixture:fw-asm", "FW-S4", "FW-LENS") && has("fixture:fw-asm", "FW-S4", "FW-CLAMP") && has("fixture:SA-FW", "FW-S4", "FW-LENS2") && has("fixture:SA-FW", "FW-S4", "FW-DATA"), "#FXB: every fixture's pairs live under one fixture:<id> scope");
    assert(!live.some((l) => l.source === "assembly" && /^(assembly|subassembly):/.test(l.sourceRef ?? "")), "#FXB: the old assembly:/subassembly: rows are soft-deleted, a deleted assembly's leftovers included");
    assert.equal(live.find((l) => l.sourceRef === "fixture:fw-asm" && l.accessorySku === "FW-LENS")?.ownDatasheet, true, "#FXB: the pair's own-datasheet flag carries onto the fixture: row");
    assert(live.some((l) => l.source === "davinci" && l.sourceRef === "TY-FWX"), "#FXB: DaVinci's scope is never touched");
    assert.equal(await Mig.ensureFixturesConverted(), true, "#FXB: every later read is a no-op (one flag read)");
    const again = await Mig.convertFixtures();
    assert(again.complete && again.inserted === 0 && again.rewritten === 0 && again.graphWritten === 0 && again.graphRemoved === 0, `#FXB: an explicit re-run changes nothing (got ${JSON.stringify(again)})`);
    // A run cut short by its budget leaves the flag unset; the next read finishes.
    await (await getDb()).delete(blobs).where(eq(blobs.id, Mig.FIXTURES_CONVERT_BLOB_ID));
    await setSettings({ fixtureAssemblies: [...fwAssemblies, { id: "fw-asm2", name: "FW two", components: [{ sku: "FW-S5", label: "E", role: "fixture", defaultQty: 1 }, { sku: "FW-IRIS", label: "I", role: "accessory", defaultQty: 1 }] }] });
    assert.equal(await Mig.ensureFixturesConverted(0, () => 0), false, "#FXB: a conversion out of budget reports incomplete");
    assert.equal(await Mig.fixturesConverted(), false, "#FXB: …and leaves the flag unset");
    assert.equal(await Mig.ensureFixturesConverted(), true, "#FXB: the next read finishes the job");
    assert(!!(await DS.getDoc("subassemblies", "fw-asm2")) && (await Acc.allAccessoryLinks()).some((l) => l.sourceRef === "fixture:fw-asm2" && l.accessorySku === "FW-IRIS"), "#FXB: …writing the rest, graph included");
    await setSettings({ fixtureAssemblies: priorAssemblies });
```

1b. In the I5 block, replace every line from `    // End to end: the one-time assembly-graph sync itself now propagates a` through `    assert.equal(await assemblyGraphSynced(), false, "final fix I5: …and the completion flag stays unset after the throw");` (inclusive) with:

```ts
    // End to end: the fixture conversion (which now owns the one-time graph
    // sync, #FXB) propagates a settings-read failure instead of converting
    // the subassemblies only and marking itself complete.
    const Mig = await import("@/lib/fixtures-migrate");
    await (await getDb()).delete(blobs).where(eq(blobs.id, Mig.FIXTURES_CONVERT_BLOB_ID));
    assert.equal(await Mig.fixturesConverted(), false, "final fix I5 setup: the flag starts unset");
    await assert.rejects(
      withTransaction(async () => {
        const db = await getDb();
        await db.execute(sql`DROP TABLE app_settings`);
        await Mig.convertFixtures();
      }),
      "final fix I5: a settings-read failure during the one-time conversion propagates — it must not silently convert subassemblies only",
    );
    assert.equal(await Mig.fixturesConverted(), false, "final fix I5: …and the completion flag stays unset after the throw");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -5`
Expected: FAIL with `Cannot find module '@/lib/fixtures-migrate'`.

- [ ] **Step 3a: Append to `src/lib/stores/part-accessory-links.ts`**

```ts
/**
 * Soft-delete every live link of `source` whose sourceRef starts with one of
 * `prefixes` — the fixture builder's retirement of the part-documents build's
 * `assembly:` / `subassembly:` scopes (#FXB). Run it AFTER the replacement
 * scopes are written: syncScopes carries "has its own datasheet" from any
 * live link of the same pair, so writing first keeps the flag.
 */
export async function retireAccessoryScopes(
  source: AccessoryLinkSource,
  prefixes: readonly string[],
  opts: DocBatchOpts = {}
): Promise<{ removed: number; complete: boolean }> {
  const stale = (await allAccessoryLinks())
    .filter((l) => l.source === source && prefixes.some((p) => (l.sourceRef ?? "").startsWith(p)))
    .map((l) => l.id);
  if (!stale.length) return { removed: 0, complete: true };
  const r = await softDeleteDocs("part_accessory_links", stale, opts);
  return { removed: r.ids.length, complete: r.complete };
}
```

- [ ] **Step 3b: Replace `src/lib/part-docs/assembly-sync.ts` entirely**

```ts
import { listDocs } from "@/db/doc-store";
import { normalizeFixtureRow, type RawFixtureRow } from "@/lib/fixtures-convert";
import { retireAccessoryScopes, syncAccessoryScopeSet } from "@/lib/stores/part-accessory-links";
import { fixturePairs, fixtureRef, LEGACY_ASSEMBLY_REF_PREFIXES } from "./assembly-graph";

/**
 * Fixture builder → accessory graph, one pass (#207 final fix wave I2,
 * reshaped by #FXB). Server-only.
 *
 * Every fixture record (systems feed nothing) gets its `fixture:<id>` scope,
 * written ADD-ONLY through `syncAccessoryScopeSet`: a row that is already
 * live, and its own-datasheet flag, is never touched, so a concurrent
 * builder save can't be overwritten by this stale snapshot. New rows carry
 * the flag from any live link of the same pair — which is why the legacy
 * `assembly:` / `subassembly:` rows are retired only AFTER the fixture:
 * rows exist. Nothing writes those legacy scopes any more, so retiring all
 * of them is safe. Idempotent; the gate and budget live in
 * src/lib/fixtures-migrate.ts.
 */

export type AssemblyGraphSyncResult = {
  fixtures: number;
  written: number;
  removed: number;
  complete: boolean;
};

export async function syncAllAssemblyGraphs(opts: { shouldStop?: () => boolean } = {}): Promise<AssemblyGraphSyncResult> {
  const fixtures = (await listDocs<RawFixtureRow>("subassemblies")).map(normalizeFixtureRow).filter((f) => f.kind === "fixture");
  const scopes = fixtures.map((f) => ({ sourceRef: fixtureRef(f.id), pairs: fixturePairs(f) }));
  const w = await syncAccessoryScopeSet("assembly", scopes, { shouldStop: opts.shouldStop });
  if (!w.complete) return { fixtures: fixtures.length, written: w.written, removed: 0, complete: false };
  const r = await retireAccessoryScopes("assembly", LEGACY_ASSEMBLY_REF_PREFIXES, { shouldStop: opts.shouldStop });
  return { fixtures: fixtures.length, written: w.written, removed: r.removed, complete: r.complete };
}
```

- [ ] **Step 3c: Create `src/lib/fixtures-migrate.ts`**

```ts
import { getBlob, insertDocIfAbsent, listDocs, setBlob, upsertDoc } from "@/db/doc-store";
import { getSettingsStrict } from "@/lib/settings";
import { planFixtureConversion, type RawFixtureRow } from "@/lib/fixtures-convert";
import { syncAllAssemblyGraphs } from "@/lib/part-docs/assembly-sync";

/**
 * The fixture builder's one-time conversion (#FXB, spec §3 and §5).
 * Server-only.
 *
 * 1. Each `settings.fixtureAssemblies` entry becomes a fixture row with the
 *    same id (insert-if-absent, so one a user has since deleted stays
 *    deleted). Settings are read STRICTLY: a transient DB error throws and
 *    leaves the flag unset instead of reading as "no assemblies".
 * 2. Each legacy-shaped `subassemblies` row is rewritten in place.
 * 3. The accessory graph moves to `fixture:<id>` (assembly-sync.ts).
 *
 * The settings array is never written — it stays as a backup. A blob flag
 * (`fixtures_convert.convertedAt`), set only once all three steps have
 * finished, makes every later read one single-row check. A run cut short by
 * its budget resumes on the next read. Runs from the first
 * `listFixtures()`, the Datasheets page, `npm run fixtures:convert` and
 * `npm run part-docs:backfill`.
 */

export const FIXTURES_CONVERT_BLOB_ID = "fixtures_convert";
/** A page read's budget — well inside a 60 s function. */
export const FIXTURES_CONVERT_BUDGET_MS = 15_000;
type ConvertFlag = { convertedAt: number };

export type FixtureConvertResult = {
  inserted: number;
  rewritten: number;
  graphWritten: number;
  graphRemoved: number;
  complete: boolean;
};

export async function convertFixtures(opts: { shouldStop?: () => boolean; now?: number } = {}): Promise<FixtureConvertResult> {
  const [settings, rows] = await Promise.all([getSettingsStrict(), listDocs<RawFixtureRow>("subassemblies")]);
  const plan = planFixtureConversion(settings.fixtureAssemblies, rows, opts.now ?? Date.now());
  const out: FixtureConvertResult = { inserted: 0, rewritten: 0, graphWritten: 0, graphRemoved: 0, complete: false };
  for (const rec of plan.inserts) {
    if (opts.shouldStop?.()) return out;
    if (await insertDocIfAbsent("subassemblies", rec)) out.inserted++;
  }
  for (const rec of plan.rewrites) {
    if (opts.shouldStop?.()) return out;
    await upsertDoc("subassemblies", rec);
    out.rewritten++;
  }
  const g = await syncAllAssemblyGraphs({ shouldStop: opts.shouldStop });
  out.graphWritten = g.written;
  out.graphRemoved = g.removed;
  out.complete = g.complete;
  if (g.complete) await setBlob(FIXTURES_CONVERT_BLOB_ID, { convertedAt: Date.now() });
  return out;
}

/** Has the conversion completed on this database? One single-row read. */
export async function fixturesConverted(): Promise<boolean> {
  return (await getBlob<ConvertFlag>(FIXTURES_CONVERT_BLOB_ID, { convertedAt: 0 })).convertedAt > 0;
}

/**
 * The first-read hook: true once converted (one flag read), otherwise runs
 * the conversion under `budgetMs` and says whether it completed. Never
 * throws — a failure is logged and callers fall back (listFixtures serves the
 * settings-backed assemblies in memory).
 */
export async function ensureFixturesConverted(budgetMs = FIXTURES_CONVERT_BUDGET_MS, now: () => number = Date.now): Promise<boolean> {
  try {
    if (await fixturesConverted()) return true;
    const deadline = now() + budgetMs;
    return (await convertFixtures({ shouldStop: () => now() >= deadline })).complete;
  } catch (e) {
    console.error("[fixtures] conversion failed", e);
    return false;
  }
}

/** Re-arm the conversion (the go-live reset wipes the doc table but keeps
 *  settings, so the settings-backed assemblies come back on the next read). */
export async function resetFixturesConversion(): Promise<void> {
  await setBlob(FIXTURES_CONVERT_BLOB_ID, { convertedAt: 0 });
}
```

- [ ] **Step 3d: Create `scripts/fixtures-convert.ts`** and add `"fixtures:convert": "tsx scripts/fixtures-convert.ts",` to `package.json` `scripts` directly after the `"part-docs:davinci"` line.

```ts
/**
 * Fixture builder conversion (#FXB, spec 2026-09-25-fixture-builder-merge-design.md §3):
 * settings.fixtureAssemblies + legacy subassembly rows → fixture records
 * (ids kept), and the accessory graph moved to one `fixture:<id>` scope.
 * Idempotent; the app runs the same step on its first read.
 *
 *   npm run fixtures:convert              → report, writes nothing
 *   npm run fixtures:convert -- --commit  → write (hosted also needs --yes)
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { listDocs } from "../src/db/doc-store";
import { getSettingsStrict } from "../src/lib/settings";
import { planFixtureConversion } from "../src/lib/fixtures-convert";
import { convertFixtures, fixturesConverted } from "../src/lib/fixtures-migrate";

const args = process.argv.slice(2);
const commit = args.includes("--commit");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "fixtures:convert (WRITE)" : "fixtures:convert (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);
  const [settings, rows] = await Promise.all([getSettingsStrict(), listDocs("subassemblies")]);
  const plan = planFixtureConversion(settings.fixtureAssemblies, rows, Date.now());
  console.log(`\n  rows in subassemblies            ${rows.length}`);
  console.log(`  assemblies to convert            ${plan.inserts.length}`);
  console.log(`  legacy subassemblies to rewrite  ${plan.rewrites.length}`);
  console.log(`  will need review                 ${plan.inserts.filter((r) => r.needsReview).length}`);
  console.log(`  conversion complete              ${(await fixturesConverted()) ? "yes" : "not yet"}\n`);
  if (!commit) {
    console.log("  Report only. To write: npm run fixtures:convert -- --commit\n");
    return;
  }
  const r = await convertFixtures();
  console.log(
    `  INSERTED ${r.inserted}, REWROTE ${r.rewritten}; graph: ${r.graphWritten} fixture: link(s) written, ` +
      `${r.graphRemoved} legacy link(s) retired — ${r.complete ? "complete" : "INCOMPLETE, run again"}.\n`
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
```

- [ ] **Step 3e: Datasheets page and backfill script**

In `src/app/(app)/catalog/documents/page.tsx` replace

```ts
import { ensureAssemblyGraphSynced } from "@/lib/part-docs/assembly-sync";
```

with

```ts
import { ensureFixturesConverted } from "@/lib/fixtures-migrate";
```

In the `Promise.all` there, replace `    ensureAssemblyGraphSynced(),` with `    ensureFixturesConverted(),`. In the comment above it, change "The one-time Assembly Builder → graph sync (final fix wave, I2)" to "The one-time fixture conversion + graph move (#FXB; was the I2 graph sync)".

In `scripts/part-docs-backfill.ts`:
- Replace `import { assemblyGraphSynced, syncAllAssemblyGraphs } from "../src/lib/part-docs/assembly-sync";` with `import { convertFixtures, fixturesConverted } from "../src/lib/fixtures-migrate";`.
- Replace `  console.log(\`  assembly graph synced          ${(await assemblyGraphSynced()) ? "yes" : "not yet"}\n\`);` with `  console.log(\`  fixtures converted + graph     ${(await fixturesConverted()) ? "yes" : "not yet"}\n\`);`.
- Replace the `const g = await syncAllAssemblyGraphs();` line and the `console.log(` statement after it (through its closing `);`) with:

```ts
  const g = await convertFixtures();
  console.log(
    `  CONVERTED ${g.inserted} assembl${g.inserted === 1 ? "y" : "ies"} + ${g.rewritten} subassembl${g.rewritten === 1 ? "y" : "ies"} → ` +
      `${g.graphWritten} accessory link(s) written, ${g.graphRemoved} legacy link(s) retired.\n`
  );
```

- Update the header comment's second paragraph so it reads: "Also runs the fixture builder's one-time conversion (#FXB): assemblies and subassemblies become fixture records and the graph moves to `fixture:<id>`."

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx tsc --noEmit
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -3
env -u DATABASE_URL PGLITE_PATH="$(mktemp -d)" npm run fixtures:convert 2>&1 | tail -8   # scratch datadir only — never .data/pglite
```

Expected: tsc is clean. The regressions end with `review regression checks passed`. The CLI prints the report with `0` rows and "Report only".

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/part-accessory-links.ts src/lib/part-docs/assembly-sync.ts src/lib/fixtures-migrate.ts scripts/fixtures-convert.ts package.json "src/app/(app)/catalog/documents/page.tsx" scripts/part-docs-backfill.ts scripts/test-review-regressions.ts
git commit -m "feat(fixtures): one-time conversion keeping ids; graph moves to fixture:<id> (#FXB)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The fixtures store

**Files:**
- Create: `src/lib/stores/fixtures.ts`
- Modify: `src/app/(app)/settings/actions.ts` (`clearDemoDataAction`), `src/lib/settings.ts` (comment on `fixtureAssemblies`)
- Test: `scripts/test-review-regressions.ts` (append block before `  console.log("review regression checks passed");`)

**Interfaces:**
- Consumes: Task 1 `CleanFixture`, `FixtureRecord`, `sanitizeFixtureAssemblies`; Task 2 `assemblyToFixture`, `normalizeFixtureRow`, `RawFixtureRow`; Task 3 `ensureFixturesConverted`, `resetFixturesConversion`.
- Produces (`@/lib/stores/fixtures`):
  - `type FixtureSnapshot = NonNullable<FixtureRecord["snapshot"]>`, plus type re-exports of `CleanFixture, FixtureBox, FixtureKind, FixtureLine, FixtureRecord, HeadLine, SystemScope`.
  - `listFixtures(): Promise<FixtureRecord[]>`: converts on first read, sorted by label then id.
  - `getFixture(id): Promise<FixtureRecord | null>`
  - `createFixture(value: CleanFixture, by: string, snapshot: FixtureSnapshot, now?: number): Promise<FixtureRecord>`: id `SA-<TS36>`, collision-safe.
  - `updateFixture(existing: FixtureRecord, value: CleanFixture, by: string, snapshot: FixtureSnapshot, now?: number): Promise<FixtureRecord>`: keeps the id, kind, created stamps and `legacy`; clears `needsReview`.
  - `removeFixture(id): Promise<void>` (soft delete).

- [ ] **Step 1: Write the failing test.** Insert before `  console.log("review regression checks passed");`:

```ts
  /* --- #FXB fixture builder: the store — first-read conversion, create /
         update / delete, save rules, who/when stamps --- */
  {
    const Fx = await import("@/lib/stores/fixtures");
    const Mig = await import("@/lib/fixtures-migrate");
    const DS = await import("@/db/doc-store");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const { assemblyToFixture } = await import("@/lib/fixtures-convert");

    await Mig.resetFixturesConversion();
    assert.equal(await Mig.fixturesConverted(), false, "#FXB store: resetFixturesConversion re-arms the conversion (the go-live reset path)");
    await setSettings({ fixtureAssemblies: [{ id: "fa-fxb-store", name: "Store probe", components: [{ sku: "FXB-E", label: "E", role: "fixture", defaultQty: 1 }] }] });
    const first = await Fx.listFixtures();
    assert(first.some((f) => f.id === "fa-fxb-store"), "#FXB store: listFixtures converts on its first read");
    assert.equal(await Mig.fixturesConverted(), true, "#FXB store: …and marks the conversion complete");
    const labels = first.map((f) => f.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)), "#FXB store: the list is sorted by label");
    await setSettings({ fixtureAssemblies: [] });

    const clean = sanitizeFixtureInput({ kind: "fixture", label: "FXB Store", description: "", lightEngineSku: "FXB-NOT-IN-CATALOG", lines: { power: [{ sku: "FXB-CBL", qty: 1 }] } });
    assert(clean.ok, "#FXB store: a light engine missing from the catalog does not block a save");
    if (!clean.ok) throw new Error("unreachable");
    const snap = { cost: 0, price: 0, pricedAt: null };
    const made = await Fx.createFixture(clean.value, "Jeff", snap, 1_700_000_000_000);
    assert.match(made.id, /^SA-[0-9A-Z]+$/, "#FXB store: new records get an SA-<TS36> id");
    assert(made.createdBy === "Jeff" && made.updatedBy === "Jeff" && made.createdAt === 1_700_000_000_000 && made.updatedAt === 1_700_000_000_000, "#FXB store: create stamps who/when");
    const twin = await Fx.createFixture(clean.value, "Jeff", snap, 1_700_000_000_000);
    assert.notEqual(twin.id, made.id, "#FXB store: a same-millisecond create never overwrites (collision-safe id)");
    const edited = sanitizeFixtureInput({ kind: "fixture", label: "FXB Store v2", description: "", lightEngineSku: "FXB-ENG" });
    if (!edited.ok) throw new Error("unreachable");
    const upd = await Fx.updateFixture(made, edited.value, "Sam", snap, 1_700_000_100_000);
    assert(upd.id === made.id && upd.label === "FXB Store v2" && upd.createdBy === "Jeff" && upd.createdAt === made.createdAt && upd.updatedBy === "Sam" && upd.updatedAt === 1_700_000_100_000, "#FXB store: update keeps id + created*, stamps updated*");
    assert.equal((await Fx.getFixture(made.id))?.label, "FXB Store v2", "#FXB store: the update is read back");
    await Fx.removeFixture(made.id);
    assert.equal(await Fx.getFixture(made.id), null, "#FXB store: delete is a soft delete the reader no longer sees");
    assert(!(await Fx.listFixtures()).some((f) => f.id === made.id), "#FXB store: …and the list drops it");

    const flagged = assemblyToFixture({ id: "fa-fxb-nr", name: "Kit", components: [{ sku: "K1", label: "Cable", role: "cable", defaultQty: 1 }] }, 1);
    await DS.insertDocIfAbsent("subassemblies", flagged);
    const nr = (await Fx.getFixture("fa-fxb-nr"))!;
    assert.equal(nr.needsReview, true, "#FXB store: a converted assembly with no fixture member reads as needs-review");
    const reviewed = sanitizeFixtureInput({ kind: "fixture", label: "Kit", description: "", lightEngineSku: "K1" });
    if (!reviewed.ok) throw new Error("unreachable");
    const cleared = await Fx.updateFixture(nr, reviewed.value, "Jeff", snap);
    assert(cleared.needsReview === undefined && cleared.legacy?.from === "assembly" && cleared.id === "fa-fxb-nr", "#FXB store: a human save clears needs-review and keeps the id + provenance");
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -5`
Expected: FAIL with `Cannot find module '@/lib/stores/fixtures'`.

- [ ] **Step 3a: Create `src/lib/stores/fixtures.ts`**

```ts
import { getDoc, insertDocIfAbsent, listDocs, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies, type CleanFixture, type FixtureRecord } from "@/lib/fixture-assemblies";
import { assemblyToFixture, normalizeFixtureRow, type RawFixtureRow } from "@/lib/fixtures-convert";
import { ensureFixturesConverted } from "@/lib/fixtures-migrate";

/**
 * Fixtures and systems (#FXB, spec §3) — one record type in the existing
 * `subassemblies` doc table (no new table, no SQL migration). Converted
 * Assemblies-tab records keep their `fa-…` ids, Subassemblies their `SA-…`
 * ids; new records get `SA-<TS36>`. Pure shapes/pricing live in
 * src/lib/fixture-assemblies.ts (client components import those, never this).
 */

export type { CleanFixture, FixtureBox, FixtureKind, FixtureLine, FixtureRecord, HeadLine, SystemScope } from "@/lib/fixture-assemblies";
export type FixtureSnapshot = NonNullable<FixtureRecord["snapshot"]>;

const COLL = "subassemblies" as const;
const byLabel = (a: FixtureRecord, b: FixtureRecord) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

/** Every live fixture and system. The first read on a database runs the
 *  one-time conversion; if that could not complete (error or budget), the
 *  settings-backed assemblies are served in memory so the Estimator, Quick
 *  Design and Grid keep resolving their ids. */
export async function listFixtures(): Promise<FixtureRecord[]> {
  const converted = await ensureFixturesConverted();
  const rows = (await listDocs<RawFixtureRow>(COLL)).map(normalizeFixtureRow);
  if (!converted) {
    const have = new Set(rows.map((r) => r.id));
    for (const a of sanitizeFixtureAssemblies((await getSettings()).fixtureAssemblies)) {
      if (!have.has(a.id)) rows.push(assemblyToFixture(a, 0));
    }
  }
  return rows.sort(byLabel);
}

export async function getFixture(id: string): Promise<FixtureRecord | null> {
  const row = await getDoc<RawFixtureRow>(COLL, id);
  return row ? normalizeFixtureRow(row) : null;
}

/** Mint `SA-<TS36>` through insertDocIfAbsent; a same-millisecond collision
 *  takes `-2`, `-3`, … instead of overwriting. */
export async function createFixture(value: CleanFixture, by: string, snapshot: FixtureSnapshot, now = Date.now()): Promise<FixtureRecord> {
  const base = `SA-${now.toString(36).toUpperCase()}`;
  for (let n = 0; n < 50; n++) {
    const rec: FixtureRecord = { ...value, id: n ? `${base}-${n + 1}` : base, snapshot, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
    if (await insertDocIfAbsent(COLL, rec)) return rec;
  }
  throw new Error(`Could not mint a free fixture id after ${base}`);
}

/** Replace the record body; keep id, kind, created stamps and provenance.
 *  A human save clears `needsReview`. */
export async function updateFixture(
  existing: FixtureRecord,
  value: CleanFixture,
  by: string,
  snapshot: FixtureSnapshot,
  now = Date.now()
): Promise<FixtureRecord> {
  const rec: FixtureRecord = {
    ...value,
    id: existing.id,
    kind: existing.kind,
    snapshot,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: now,
    updatedBy: by,
    ...(existing.legacy ? { legacy: existing.legacy } : {}),
  };
  return upsertDoc(COLL, rec);
}

export async function removeFixture(id: string): Promise<void> {
  await softDeleteDoc(COLL, id);
}
```

- [ ] **Step 3b: Go-live reset.** In `src/app/(app)/settings/actions.ts` → `clearDemoDataAction`, directly after `const cleared = await clearDemoData();` insert:

```ts
  // #FXB: fixtures live in a doc table the reset just wiped; re-arm the
  // one-time conversion so the settings-backed assemblies (configuration,
  // which this reset keeps) come back on the next read, as they did when
  // they lived in settings.
  const { resetFixturesConversion } = await import("@/lib/fixtures-migrate");
  await resetFixturesConversion();
```

- [ ] **Step 3c: Settings comment.** In `src/lib/settings.ts` replace

```ts
  /** User-authored catalog-backed fixture assemblies. Full replacement. */
```

with

```ts
  /** Pre-#FXB Assemblies-tab records. Since the fixture builder they are
   *  converted into `subassemblies` fixture rows (src/lib/fixtures-migrate.ts)
   *  and this array is a read-only backup — never written by the app. */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -3`
Expected: tsc is clean, and the run ends with `review regression checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/fixtures.ts "src/app/(app)/settings/actions.ts" src/lib/settings.ts scripts/test-review-regressions.ts
git commit -m "feat(fixtures): fixtures store — first-read conversion, stamps, collision-safe ids (#FXB)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Consumers — the Estimator configurator and Quick Design

**Files:**
- Create: `src/app/(app)/estimator/fixture-bom.ts`
- Modify: `src/app/(app)/estimator/page.tsx` (import line 5, `Promise.all` ~216, prop ~333), `src/app/(app)/estimator/estimator-client.tsx` (import line 78, fixture open ~1362, `setFixtureAssembly` ~1649, `addFixture` ~1659), `src/app/(app)/estimator/fixture-modal.tsx` (component rows), `src/app/(app)/design/quick/page.tsx`
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes: Task 1 `fixtureAssembliesFrom`, `ResolvedFixtureAssembly` (with `position`/`circuit`), `assemblyDescription`; Task 2 `assemblyToFixture`; Task 4 `listFixtures`.
- Produces (`@/app/(app)/estimator/fixture-bom`): `type FixtureBomLine = { desc: string; cost: number; price: number; components: NonNullable<SpecItem["components"]> }`, `fixtureBomLine(assembly: ResolvedFixtureAssembly, d: Pick<FixtureDraft, "componentQty" | "position" | "circuit">): FixtureBomLine | null`, `optionalToggleQty(on: boolean): string`.
- The Grid needs no code change. Its scope panel has no fixture picker today, and its intake (`manualScopeInputs`) copies the `fixtureAssemblies` id map, which still resolves because ids are kept.

- [ ] **Step 1: Write the failing test** (append at EOF of `scripts/test-review-and-spec.ts`)

```ts
/* --- #FXB — the Estimator BOM line over a converted assembly is unchanged;
       an optional add-on switched on adds qty 1. Pure. --- */
import { fixtureBomLine, optionalToggleQty } from "@/app/(app)/estimator/fixture-bom";
{
  const asm = { id: "fa-bom", name: "Wash", components: [
    { sku: "B-ENG", label: "Engine", role: "fixture" as const, defaultQty: 1 },
    { sku: "B-CBL", label: "Cable", role: "power" as const, defaultQty: 2, costOverride: 7 },
    { sku: "B-BARN", label: "Barn door", role: "accessory" as const, defaultQty: 0 },
  ] };
  const cat = [
    { sku: "B-ENG", desc: "Wash engine", unit: "ea", cost: 800, list: 1200 },
    { sku: "B-CBL", desc: "Cable", unit: "ea", cost: 10, list: 15 },
    { sku: "B-BARN", desc: "Barn door", unit: "ea", cost: 60, list: 90 },
  ];
  const before = resolveFixtureAssemblies([asm], cat)[0];
  const after = fixtureAssembliesFrom([assemblyToFixture(asm, 1)], cat)[0];
  const draft = { componentQty: {}, position: "FOH", circuit: "4" };
  const b = fixtureBomLine(before, draft)!;
  const a = fixtureBomLine(after, draft)!;
  ok(!!b && !!a && b.cost === a.cost && b.price === a.price && a.cost === 814 && a.price === 1230, "#FXB Estimator: a converted assembly's BOM line totals are identical");
  ok(a.desc === "Wash — Engine; Cable ×2 (Pos FOH / Ckt 4)" && a.components.length === 3, "#FXB Estimator: description and components[] keep today's shape");
  const on = fixtureBomLine(after, { ...draft, componentQty: { "B-BARN": optionalToggleQty(true) } })!;
  ok(on.price === a.price + 90 && on.cost === a.cost + 60 && on.components.find((c) => c.sku === "B-BARN")!.qty === 1, "#FXB Estimator: switching an optional add-on on adds it at qty 1");
  ok(optionalToggleQty(false) === "0", "#FXB Estimator: switching it off returns it to 0");
  ok(fixtureBomLine(after, { ...draft, componentQty: { "B-ENG": "0", "B-CBL": "0" } }) === null, "#FXB Estimator: a line with no sell is refused, as before");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: aborts with `Cannot find module '@/app/(app)/estimator/fixture-bom'`.

- [ ] **Step 3a: Create `src/app/(app)/estimator/fixture-bom.ts`**

```ts
import { assemblyDescription, type ResolvedFixtureAssembly } from "@/lib/fixture-assemblies";
import type { FixtureDraft, SpecItem } from "./types";

/** The fixture configurator's BOM line (#FXB) — moved out of
 *  estimator-client.tsx unchanged so it is testable: included components at
 *  the draft's quantities, aggregate unit cost/sell, "Name — part; part"
 *  plus "(Pos … / Ckt …)". Pure. */
export type FixtureBomLine = {
  desc: string;
  cost: number;
  price: number;
  components: NonNullable<SpecItem["components"]>;
};

/** An optional (default qty 0) add-on's switch: on = qty 1, off = 0. */
export function optionalToggleQty(on: boolean): string {
  return on ? "1" : "0";
}

export function fixtureBomLine(
  assembly: ResolvedFixtureAssembly,
  d: Pick<FixtureDraft, "componentQty" | "position" | "circuit">
): FixtureBomLine | null {
  const qtyOf = (sku: string, fallback: number) => Math.max(0, Number(d.componentQty[sku] ?? fallback) || 0);
  const components = assembly.components.map((part) => ({
    sku: part.sku,
    label: part.label,
    role: part.role,
    qty: qtyOf(part.sku, part.defaultQty),
    unit: part.unit,
    cost: part.cost,
    price: part.list,
  }));
  const included = components.filter((part) => part.qty > 0);
  const cost = included.reduce((sum, part) => sum + part.cost * part.qty, 0);
  const price = included.reduce((sum, part) => sum + part.price * part.qty, 0);
  if (price <= 0) return null;
  const pc: string[] = [];
  if ((d.position || "").trim()) pc.push("Pos " + d.position.trim());
  if ((d.circuit || "").trim()) pc.push("Ckt " + d.circuit.trim());
  let desc = assemblyDescription({
    ...assembly,
    components: assembly.components.map((part) => ({ ...part, defaultQty: qtyOf(part.sku, part.defaultQty) })),
  });
  if (pc.length) desc += " (" + pc.join(" / ") + ")";
  return { desc, cost, price, components };
}
```

- [ ] **Step 3b: `estimator-client.tsx`**

Replace line 78 `import { assemblyDescription } from "@/lib/fixture-assemblies";` with `import { fixtureBomLine } from "./fixture-bom";`.

In the `kind === "fixture"` open branch, replace

```ts
        componentQty: Object.fromEntries((first?.components || []).map((part) => [part.sku, String(part.defaultQty)])),
      });
```

with

```ts
        componentQty: Object.fromEntries((first?.components || []).map((part) => [part.sku, String(part.defaultQty)])),
        // #FXB: the fixture's default hang position / circuit.
        position: first?.position || "",
        circuit: first?.circuit || "",
      });
```

Replace the whole `setFixtureAssembly` function with:

```ts
  const setFixtureAssembly = (assemblyId: string) => {
    const assembly = fixtureAssemblies.find((item) => item.id === assemblyId);
    setFixtureDraft((draft) => ({
      ...draft,
      assemblyId,
      componentQty: Object.fromEntries((assembly?.components || []).map((part) => [part.sku, String(part.defaultQty)])),
      // #FXB: a fixture's default position / circuit fills an empty field only.
      position: draft.position || assembly?.position || "",
      circuit: draft.circuit || assembly?.circuit || "",
    }));
  };
```

Replace the whole `addFixture` function (from `  const addFixture = (secId: string) => {` through its closing `  };`) with:

```ts
  const addFixture = (secId: string) => {
    const d = fixtureDraft;
    const assembly = fixtureAssemblies.find((item) => item.id === d.assemblyId);
    if (!assembly) return;
    // #FXB: the BOM math lives in fixture-bom.ts (pure, parity-tested);
    // the line's shape is unchanged.
    const line = fixtureBomLine(assembly, d);
    if (!line) return;
    const qty = Math.max(1, Number.parseInt(d.qty, 10) || 1);
    pushItems(secId, [
      { id: nextId(), sku: assembly.id, desc: line.desc, qty, unit: "ea", cost: line.cost, price: line.price, fixture: true, components: line.components },
    ]);
    closeInput();
  };
```

- [ ] **Step 3c: `fixture-modal.tsx`: the optional add-on switch.** Add `import { optionalToggleQty } from "./fixture-bom";` after the `./types` import. Replace the inner `<div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>{assembly.components.map((part) => … )}</div>` expression, the one that renders each component row, with:

```tsx
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>{assembly.components.map((part) => {
            const optional = part.defaultQty === 0;
            const current = draft.componentQty[part.sku] ?? String(part.defaultQty);
            const on = Number(current) > 0;
            return (
              <div key={part.sku} style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 12, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #f0f1f4", background: optional && !on ? "#fbfbfc" : "#fff" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 650 }}>{part.label}{optional && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#8c919c" }}>optional add-on</span>}</div>
                  <div style={{ fontSize: 11.5, color: part.found ? "#8c919c" : "#b4543a" }}>{part.sku} · {part.role} · {part.desc}{!part.found ? " — missing from catalog" : ""}</div>
                </div>
                {optional && !on ? (
                  <label style={{ display: "inline-flex", gap: 5, alignItems: "center", justifySelf: "end", fontSize: 12, color: "#5b616e", cursor: "pointer" }}>
                    <input type="checkbox" aria-label={`Add ${part.label}`} checked={false} onChange={() => onComponentQty(part.sku, optionalToggleQty(true))} />
                    Add
                  </label>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {optional && <input type="checkbox" aria-label={`Remove ${part.label}`} checked onChange={() => onComponentQty(part.sku, optionalToggleQty(false))} />}
                    <input aria-label={`${part.label} quantity`} type="number" min="0" step="1" value={current} onChange={(event) => onComponentQty(part.sku, event.target.value)} style={{ ...NUMFIELD, width: "100%" }} />
                  </div>
                )}
              </div>
            );
          })}</div>
```

Also change the label hint `· set optional items from 0 when needed` to `· tick an optional add-on to include it`.

- [ ] **Step 3d: `estimator/page.tsx`.** Replace `import { resolveFixtureAssemblies } from "@/lib/fixture-assemblies";` with:

```ts
import { fixtureAssembliesFrom } from "@/lib/fixture-assemblies";
import { listFixtures } from "@/lib/stores/fixtures";
```

Replace

```ts
  const [fabricRows, laborRows, customerDocs, reviewerRows, settings, fixtureRates, roster, catalogRows, pipelines] =
```

with

```ts
  const [fabricRows, laborRows, customerDocs, reviewerRows, settings, fixtureRates, roster, catalogRows, pipelines, fixtures] =
```

and add `      listFixtures(),` after `      loadPipelines(),` in that `Promise.all`. Replace `      fixtureAssemblies={resolveFixtureAssemblies(settings.fixtureAssemblies, catalogRows)}` with `      fixtureAssemblies={fixtureAssembliesFrom(fixtures, catalogRows)}`. This reuses the catalog rows already loaded.

- [ ] **Step 3e: `design/quick/page.tsx`.** Replace `import { getSettings } from "@/lib/settings";` and `import { assemblyUnitTotals, resolveFixtureAssemblies } from "@/lib/fixture-assemblies";` with:

```ts
import { assemblyUnitTotals, fixtureAssembliesFrom } from "@/lib/fixture-assemblies";
import { listFixtures } from "@/lib/stores/fixtures";
```

In the destructure, rename `settings` to `fixtureRecords` and replace `      getSettings(),` with `      listFixtures(),`. Replace

```ts
  const fixtureAssemblies = resolveFixtureAssemblies(settings.fixtureAssemblies, catalogRows).map((assembly) => ({
```

with

```ts
  // #FXB: fixtures (not systems) under their kept ids — included parts only.
  const fixtureAssemblies = fixtureAssembliesFrom(fixtureRecords, catalogRows).map((assembly) => ({
```

- [ ] **Step 4: Run the gates**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | grep -E "FAIL|#FXB Estimator|ALL PASSED|FAILED"
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next
```

Expected: tsc is clean. The `#FXB Estimator` lines are `PASS`, followed by `ALL PASSED`. The build succeeds; a client file pulling a store would only show up here.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/estimator/fixture-bom.ts" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/fixture-modal.tsx" "src/app/(app)/estimator/page.tsx" "src/app/(app)/design/quick/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(estimator,quick): read fixtures; optional add-on switch; default position/circuit (#FXB)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: One Assembly Builder — form, list and actions

**Files:**
- Rewrite: `src/app/(app)/design/assemblies/page.tsx`, `src/app/(app)/design/assemblies/actions.ts`, `src/lib/stores/subassemblies.ts`
- Create: `src/app/(app)/design/assemblies/fixture-form.tsx`, `src/app/(app)/design/assemblies/fixture-builder.tsx`
- Delete: `src/app/(app)/design/assemblies/assembly-builder.tsx`, `src/app/(app)/design/assemblies/tabs.tsx`, `src/app/(app)/design/subassemblies/subassemblies-client.tsx`, `src/app/(app)/design/subassemblies/actions.ts`
- Modify: `src/lib/design-routes.ts:55-56`, `scripts/smoke-routes.ts:115-116`, `scripts/test-review-and-spec.ts:1773-1774`
- Keep unchanged: `src/app/(app)/design/assemblies/member-coverage.tsx`, `src/app/(app)/design/subassemblies/page.tsx`

**Interfaces:**
- Consumes: Task 1 (`FIXTURE_BOXES`, `FIXTURE_BOX_LABEL`, `SYSTEM_SCOPES`, `resolveFixture`, `toSkuMap`, `sanitizeFixtureInput`, `fixtureSkus`, the types); Task 2 (`fixturePairs`, `fixtureRef`, `pairKey`, `memberCoverageFor`); Task 4 (store); existing `setOwnDatasheet`, `syncAccessoryLinks`, `listDocsByField`, `loadPartDocsState`, `ConfirmButton`, `Typeahead`.
- Produces:
  - `actions.ts`: `saveFixtureAction(input: FixtureInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>`, `deleteFixtureAction(id: string): Promise<{ ok: true }>`, `setOwnDatasheetAction` (unchanged).
  - `fixture-form.tsx`: `type PartHit`, `type Draft`, `emptyDraft`, `draftFromRecord`, `draftToInput`, `draftResolvable`, `money`, `pricesNote`, and the default `FixtureForm`.
  - `fixture-builder.tsx`: default `FixtureBuilder({ initial, parts, priceListEffective, coverage })`.

- [ ] **Step 1: Update the redirect test first.** In `scripts/test-review-and-spec.ts` replace

```ts
ok(designRedirect("/design/subassemblies", {}) === "/design/assemblies?tab=subassemblies",
  "#130 /design/subassemblies redirects to the Subassemblies tab of the Assembly Builder");
```

with

```ts
ok(designRedirect("/design/subassemblies", {}) === "/design/assemblies",
  "#130/#FXB /design/subassemblies redirects to the one Assembly Builder list");
```

Run: `npm run test:specs 2>&1 | grep -E "FAIL"`
Expected: `FAIL #130/#FXB /design/subassemblies redirects to the one Assembly Builder list`.

- [ ] **Step 2: Redirects.** In `src/lib/design-routes.ts` replace

```ts
  // Subassemblies became a tab of the Assembly Builder (#130).
  if (pathname === "/design/subassemblies") return "/design/assemblies?tab=subassemblies";
```

with

```ts
  // Subassemblies became a tab of the Assembly Builder (#130), then merged
  // into its one list (#FXB).
  if (pathname === "/design/subassemblies") return "/design/assemblies";
```

In `scripts/smoke-routes.ts` replace

```ts
  "/design/assemblies?tab=subassemblies",
  "/design/subassemblies", // #130 — redirect to the tab above; must stay 3xx
```

with

```ts
  "/design/assemblies?tab=subassemblies", // #FXB — the retired tab link redirects to the one list
  "/design/subassemblies", // #130/#FXB — redirect to /design/assemblies; must stay 3xx
```

- [ ] **Step 3: Replace `src/app/(app)/design/assemblies/actions.ts` entirely**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { listDocsByField } from "@/db/doc-store";
import type { CatalogPart } from "@/lib/stores/catalog";
import { fixtureSkus, resolveFixture, sanitizeFixtureInput, type FixtureInput } from "@/lib/fixture-assemblies";
import { createFixture, getFixture, removeFixture, updateFixture } from "@/lib/stores/fixtures";
import { fixturePairs, fixtureRef } from "@/lib/part-docs/assembly-graph";
import { setOwnDatasheet, syncAccessoryLinks } from "@/lib/stores/part-accessory-links";

const revalidateConsumers = () => {
  for (const path of ["/design/assemblies", "/estimator", "/design/quick", "/catalog/documents"]) revalidatePath(path);
};

/**
 * Save a fixture or system (#FXB). Anyone signed in (spec §2.5); every save
 * stamps who/when. The snapshot ("was $X when built") prices from the live
 * catalog, read for THIS record's SKUs only — never the whole ~37k book. A
 * part missing from the catalog does not block the save. A fixture's lens
 * and box lines become its light engine's accessory links (scope
 * `fixture:<id>`); a system's scope is emptied.
 */
export async function saveFixtureAction(input: FixtureInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const clean = sanitizeFixtureInput(input);
  if (!clean.ok) return clean;
  const id = input?.id ? String(input.id) : null;
  const existing = id ? await getFixture(id) : null;
  if (id && !existing) return { ok: false, error: "This assembly was deleted — reload the page." };
  if (existing && existing.kind !== clean.value.kind) return { ok: false, error: "An assembly can't change between fixture and system." };
  const [parts, settings] = await Promise.all([
    listDocsByField<CatalogPart>("catalog_parts", "sku", fixtureSkus(clean.value)),
    getSettings(),
  ]);
  const live = resolveFixture({ ...clean.value, id: id || "new" }, parts, settings);
  const snapshot = { cost: live.cost, price: live.sell, pricedAt: live.pricesAsOf };
  const saved = existing
    ? await updateFixture(existing, clean.value, user.name, snapshot)
    : await createFixture(clean.value, user.name, snapshot);
  await syncAccessoryLinks({ source: "assembly", sourceRef: fixtureRef(saved.id) }, fixturePairs(saved));
  revalidateConsumers();
  return { ok: true, id: saved.id };
}

export async function deleteFixtureAction(id: string): Promise<{ ok: true }> {
  await requireUser();
  await removeFixture(String(id || ""));
  await syncAccessoryLinks({ source: "assembly", sourceRef: fixtureRef(String(id || "")) }, []);
  revalidateConsumers();
  return { ok: true };
}

/** A line's "has its own datasheet" toggle (#207, spec §3/§4): the pair
 *  stops (or resumes) counting the fixture's datasheet as the part's. */
export async function setOwnDatasheetAction(parentSku: string, accessorySku: string, own: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const { linked } = await setOwnDatasheet(String(parentSku || ""), String(accessorySku || ""), !!own);
  // Only a pair missing from the graph is an error; setting the flag to the
  // value it already has is a no-op success (final fix wave, M1).
  if (!linked) return { ok: false, error: "Save the assembly first — this part isn't linked to the fixture yet." };
  revalidatePath("/design/assemblies");
  revalidatePath("/catalog/documents");
  return { ok: true };
}
```

- [ ] **Step 4: Create `src/app/(app)/design/assemblies/fixture-form.tsx`**

```tsx
"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  FIXTURE_BOXES,
  FIXTURE_BOX_LABEL,
  SYSTEM_SCOPES,
  type FixtureBox,
  type FixtureInput,
  type FixtureKind,
  type FixtureLine,
  type FixtureRecord,
  type FixtureResolvable,
  type HeadLine,
  type ResolvedFixture,
  type SystemScope,
} from "@/lib/fixture-assemblies";
import { dateYear } from "@/lib/format";
import { Typeahead } from "@/components/search/typeahead";
import { catalogFilter, catalogRank } from "@/lib/search/typeahead-rank";
import { pairKey, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import MemberCoverageChip from "./member-coverage";

/** The catalog slice the builder searches and prices from (#FXB). Cost is
 *  included: the footer shows the live included cost, as Subassemblies did. */
export type PartHit = { sku: string; desc: string; category: string; mfr: string; unit: string; list: number; cost: number; pricedAt?: number };

export type Draft = {
  id: string | null;
  kind: FixtureKind;
  label: string;
  description: string;
  scope: SystemScope | "";
  lightEngineSku: string;
  lightEngineLine: HeadLine;
  lensSku: string;
  lensLine: HeadLine;
  lamp: string;
  position: string;
  circuit: string;
  lines: Record<FixtureBox, FixtureLine[]>;
  parts: FixtureLine[];
  /** A converted record's stored names — fallback display for a missing part. */
  legacy?: FixtureRecord["legacy"];
};

export function emptyDraft(kind: FixtureKind): Draft {
  return {
    id: null, kind, label: "", description: "", scope: "",
    lightEngineSku: "", lightEngineLine: {}, lensSku: "", lensLine: {},
    lamp: "", position: "", circuit: "",
    lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [],
  };
}

export function draftFromRecord(r: FixtureRecord): Draft {
  return {
    id: r.id, kind: r.kind, label: r.label, description: r.description || "", scope: r.scope || "",
    lightEngineSku: r.lightEngineSku || "", lightEngineLine: r.lightEngineLine || {},
    lensSku: r.lensSku || "", lensLine: r.lensLine || {},
    lamp: r.lamp || "", position: r.position || "", circuit: r.circuit || "",
    lines: {
      data: [...(r.lines?.data || [])],
      power: [...(r.lines?.power || [])],
      mounting: [...(r.lines?.mounting || [])],
      accessories: [...(r.lines?.accessories || [])],
    },
    parts: [...(r.parts || [])],
    ...(r.legacy ? { legacy: r.legacy } : {}),
  };
}

export function draftToInput(d: Draft): FixtureInput {
  return {
    id: d.id, kind: d.kind, label: d.label, description: d.description, scope: d.scope || undefined,
    lightEngineSku: d.lightEngineSku, lensSku: d.lensSku || null, lightEngineLine: d.lightEngineLine, lensLine: d.lensLine,
    lamp: d.lamp, position: d.position, circuit: d.circuit, lines: d.lines, parts: d.parts,
  };
}

export function draftResolvable(d: Draft): FixtureResolvable {
  return {
    id: d.id || "draft", kind: d.kind, label: d.label,
    lightEngineSku: d.lightEngineSku, lensSku: d.lensSku || null,
    lightEngineLine: d.lightEngineLine, lensLine: d.lensLine, lines: d.lines, parts: d.parts,
    ...(d.legacy ? { legacy: d.legacy } : {}),
  };
}

export const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
export const pricesNote = (at: number | null) => (at == null ? "prices as of: unknown" : `prices as of ${dateYear(at)}`);

const FIELD: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #dfe2e8", borderRadius: 8, padding: "9px 10px", font: "inherit", fontSize: 13, color: "#16181d", background: "#fff" };
const LABEL: CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#737985", marginBottom: 5 };
const SMALL_BTN: CSSProperties = { padding: "3px 8px", fontSize: 12, lineHeight: 1.2 };
const partKey = (p: PartHit) => p.sku;
const partLabel = (p: PartHit) => `${p.desc} · ${p.sku}`;

const headAsLine = (sku: string, h: HeadLine): FixtureLine => ({
  sku,
  ...(h.label ? { label: h.label } : {}),
  qty: h.qty ?? 1,
  ...(h.costOverride !== undefined ? { costOverride: h.costOverride } : {}),
});
const lineAsHead = (l: FixtureLine): HeadLine => ({
  ...(l.label ? { label: l.label } : {}),
  qty: l.qty,
  ...(l.costOverride !== undefined ? { costOverride: l.costOverride } : {}),
});

/** One results row — SKU · description · manufacturer · list price (#121). */
function PartRow({ part }: { part: PartHit }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", flexShrink: 0 }}>{part.sku}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{part.desc}</span>
      <span style={{ fontSize: 11.5, color: "#8c919c", flexShrink: 0 }}>{part.mfr || "—"} · {money(part.list)}</span>
    </span>
  );
}

/** Catalog part picker (#121): results list inline while you type.
 *  `clearOnPick` is the add-another mode the line boxes use. */
function PartPicker({ label, parts, value, onChange, clearOnPick = false }: { label: string; parts: PartHit[]; value: string; onChange: (sku: string) => void; clearOnPick?: boolean }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      <Typeahead
        items={parts}
        keyOf={partKey}
        filter={catalogFilter}
        rank={catalogRank}
        render={(p) => <PartRow part={p} />}
        onPick={(p) => onChange(p.sku)}
        labelOf={clearOnPick ? undefined : partLabel}
        selectedKey={clearOnPick ? null : value}
        placeholder="Search name, manufacturer, or part #"
        ariaLabel={label}
        inputStyle={FIELD}
      />
    </div>
  );
}

/** One part line: part, label, qty (0 = optional), cost override, ↑ ↓ ×, and
 *  the datasheet coverage chip/toggle. */
function LineRow({ line, part, fallbackName, onChange, onUp, onDown, onRemove, chip }: {
  line: FixtureLine;
  part?: PartHit;
  fallbackName?: string;
  onChange: (next: FixtureLine) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
  chip?: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) 64px 104px auto", gap: 6, alignItems: "start", padding: "7px 0", borderTop: "1px solid #f2f3f6" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#5b616e" }}>{line.sku}</div>
        <div style={{ fontSize: 11.5, color: part ? "#737985" : "#a0442b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {part ? part.desc : `${fallbackName ? `${fallbackName} — ` : ""}not in the catalog (prices as $0)`}
        </div>
        {chip}
      </div>
      <input aria-label={`Label for ${line.sku}`} title="Name used in the Estimator and BOM (blank = catalog description)" value={line.label ?? ""} placeholder={part?.desc || "catalog description"} onChange={(e) => onChange({ ...line, label: e.target.value || undefined })} style={{ ...FIELD, padding: "6px 8px", fontSize: 12 }} />
      <div>
        <input aria-label={`Quantity for ${line.sku}`} type="number" min={0} step={1} value={line.qty} onChange={(e) => onChange({ ...line, qty: Math.max(0, Number(e.target.value) || 0) })} style={{ ...FIELD, padding: "6px 6px", fontSize: 12 }} />
        {line.qty === 0 && <div style={{ fontSize: 10, color: "#8c919c", marginTop: 2 }}>optional</div>}
      </div>
      <input aria-label={`Cost override for ${line.sku}`} type="number" min={0} step="0.01" placeholder={part ? `cost ${money(part.cost)}` : "cost override"} value={line.costOverride ?? ""} onChange={(e) => onChange({ ...line, costOverride: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })} style={{ ...FIELD, padding: "6px 6px", fontSize: 12 }} />
      <div style={{ display: "flex", gap: 3 }}>
        {(onUp || onDown) && <button type="button" aria-label={`Move ${line.sku} up`} className="pk-btn-outline" style={SMALL_BTN} disabled={!onUp} onClick={onUp}>↑</button>}
        {(onUp || onDown) && <button type="button" aria-label={`Move ${line.sku} down`} className="pk-btn-outline" style={SMALL_BTN} disabled={!onDown} onClick={onDown}>↓</button>}
        {onRemove && <button type="button" aria-label={`Remove ${line.sku}`} className="pk-btn-outline" style={SMALL_BTN} onClick={onRemove}>×</button>}
      </div>
    </div>
  );
}

function LineBox({ title, lines, onLines, parts, bySku, names, chipFor }: {
  title: string;
  lines: FixtureLine[];
  onLines: (next: FixtureLine[]) => void;
  parts: PartHit[];
  bySku: ReadonlyMap<string, PartHit>;
  names: Record<string, string>;
  chipFor?: (sku: string) => ReactNode;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const next = [...lines];
    const j = i + dir;
    [next[i], next[j]] = [next[j], next[i]];
    onLines(next);
  };
  return (
    <div style={{ border: "1px solid #eef0f3", borderRadius: 9, padding: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {lines.map((line, i) => (
        <LineRow
          key={`${line.sku}-${i}`}
          line={line}
          part={bySku.get(line.sku)}
          fallbackName={names[line.sku]}
          onChange={(next) => onLines(lines.map((l, k) => (k === i ? next : l)))}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < lines.length - 1 ? () => move(i, 1) : undefined}
          onRemove={() => onLines(lines.filter((_, k) => k !== i))}
          chip={chipFor?.(line.sku)}
        />
      ))}
      <div style={{ marginTop: 8 }}>
        <PartPicker label="Add a part" parts={parts} value="" clearOnPick onChange={(sku) => onLines([...lines, { sku, qty: 1 }])} />
      </div>
    </div>
  );
}

export default function FixtureForm({ draft, onChange, parts, bySku, live, coverage, busy, error, onSave, onCancel }: {
  draft: Draft;
  onChange: (next: Draft) => void;
  parts: PartHit[];
  bySku: ReadonlyMap<string, PartHit>;
  live: ResolvedFixture;
  coverage: Record<string, MemberCoverage>;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const names = draft.legacy?.names || {};
  const isSystem = draft.kind === "system";
  const noun = isSystem ? "system" : "fixture";
  const engine = draft.lightEngineSku;
  const chipFor = !isSystem && engine
    ? (sku: string) => (sku === engine ? null : <MemberCoverageChip parentSku={engine} accessorySku={sku} coverage={coverage[pairKey(engine, sku)]} />)
    : undefined;
  const optional = live.parts.filter((p) => !p.included).length;
  return (
    <section className="pk-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 17, margin: 0 }}>{draft.id ? `Edit ${noun}` : `New ${noun}`}</h2>
          <p style={{ margin: "5px 0 18px", color: "#737985", fontSize: 12.5 }}>
            {isSystem
              ? "A bundle of catalog parts under one scope — a mixer, DSP & amps; a video switcher; a distro system."
              : "Pick the light engine (and lens), then what ships with it. A quantity of 0 makes a part a compatible optional add-on."}
          </p>
        </div>
        <button type="button" onClick={onCancel} style={{ border: 0, background: "transparent", color: "#737985", cursor: "pointer", fontSize: 12 }}>Cancel</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        <label style={LABEL}>Label<input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder={isSystem ? "e.g. Digital mixer, DSP & amplifiers" : "e.g. ETC Source Four LED Series 3"} style={{ ...FIELD, marginTop: 5 }} /></label>
        <label style={LABEL}>Description<textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Customer-facing description" rows={2} style={{ ...FIELD, marginTop: 5, resize: "vertical" }} /></label>
        {isSystem ? (
          <label style={LABEL}>Scope
            <select value={draft.scope} onChange={(e) => set({ scope: e.target.value as SystemScope | "" })} style={{ ...FIELD, marginTop: 5 }}>
              <option value="">— Pick a scope —</option>
              {SYSTEM_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        ) : (
          <>
            <PartPicker label="Light engine" parts={parts} value={draft.lightEngineSku} onChange={(sku) => set({ lightEngineSku: sku })} />
            <PartPicker label="Lens (optional)" parts={parts} value={draft.lensSku} onChange={(sku) => set({ lensSku: sku })} />
            <label style={LABEL}>Lamp / wattage<input value={draft.lamp} onChange={(e) => set({ lamp: e.target.value })} placeholder="e.g. LED" style={{ ...FIELD, marginTop: 5 }} /></label>
            <label style={LABEL}>Default hang position<input value={draft.position} onChange={(e) => set({ position: e.target.value })} placeholder="e.g. FOH truss 1" style={{ ...FIELD, marginTop: 5 }} /></label>
            <label style={LABEL}>Default circuit<input value={draft.circuit} onChange={(e) => set({ circuit: e.target.value })} placeholder="e.g. 12" style={{ ...FIELD, marginTop: 5 }} /></label>
          </>
        )}
      </div>
      {!isSystem && (draft.lightEngineSku || draft.lensSku) && (
        <div style={{ marginTop: 16, border: "1px solid #eef0f3", borderRadius: 9, padding: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Light engine &amp; lens</div>
          {draft.lightEngineSku && (
            <LineRow
              line={headAsLine(draft.lightEngineSku, draft.lightEngineLine)}
              part={bySku.get(draft.lightEngineSku)}
              fallbackName={names[draft.lightEngineSku]}
              onChange={(l) => set({ lightEngineLine: lineAsHead(l) })}
              chip={<div style={{ fontSize: 11, color: "#999fa9" }}>Fixture — its datasheet covers the parts below</div>}
            />
          )}
          {draft.lensSku && (
            <LineRow
              line={headAsLine(draft.lensSku, draft.lensLine)}
              part={bySku.get(draft.lensSku)}
              fallbackName={names[draft.lensSku]}
              onChange={(l) => set({ lensLine: lineAsHead(l) })}
              onRemove={() => set({ lensSku: "", lensLine: {} })}
              chip={chipFor?.(draft.lensSku)}
            />
          )}
        </div>
      )}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: isSystem ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {isSystem ? (
          <LineBox title="Parts" lines={draft.parts} onLines={(next) => set({ parts: next })} parts={parts} bySku={bySku} names={names} />
        ) : (
          FIXTURE_BOXES.map((box) => (
            <LineBox
              key={box}
              title={FIXTURE_BOX_LABEL[box]}
              lines={draft.lines[box]}
              onLines={(next) => set({ lines: { ...draft.lines, [box]: next } })}
              parts={parts}
              bySku={bySku}
              names={names}
              chipFor={chipFor}
            />
          ))
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef0f3", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "#5b616e" }}>
          Included: cost <strong>{money(live.cost)}</strong> · sell <strong>{money(live.sell)}</strong>
          <span style={{ marginLeft: 8, color: "#9aa0ab", fontSize: 11.5 }}>{pricesNote(live.pricesAsOf)}</span>
          {optional > 0 && <div style={{ color: "#8c919c", fontSize: 11.5, marginTop: 3 }}>{optional} optional add-on{optional === 1 ? "" : "s"} — offered, off by default</div>}
          {live.missing.length > 0 && <div style={{ color: "#a0442b", fontSize: 11.5, marginTop: 3 }}>Not in the catalog (priced as $0): {live.missing.join(", ")}</div>}
        </div>
        <button type="button" onClick={onSave} disabled={busy} style={{ border: 0, borderRadius: 8, padding: "9px 15px", background: busy ? "#c7cad1" : "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Saving…" : draft.id ? `Save ${noun}` : `Build ${noun}`}
        </button>
      </div>
      {error && <div role="alert" style={{ marginTop: 10, color: "#a0442b", fontSize: 12 }}>{error}</div>}
    </section>
  );
}
```

- [ ] **Step 5: Create `src/app/(app)/design/assemblies/fixture-builder.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dateYear } from "@/lib/format";
import { resolveFixture, toSkuMap, type FixtureKind, type FixtureRecord } from "@/lib/fixture-assemblies";
import type { MemberCoverage } from "@/lib/part-docs/assembly-graph";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteFixtureAction, saveFixtureAction } from "./actions";
import FixtureForm, { draftFromRecord, draftResolvable, draftToInput, emptyDraft, money, pricesNote, type Draft, type PartHit } from "./fixture-form";

type Filter = "all" | FixtureKind;
const FILTER_LABEL: Record<Filter, string> = { all: "All", fixture: "Fixtures", system: "Systems" };

/** #FXB — the one Assemblies list (fixtures + systems) and its form. */
export default function FixtureBuilder({ initial, parts, priceListEffective, coverage }: {
  initial: FixtureRecord[];
  parts: PartHit[];
  priceListEffective: Record<string, number>;
  /** #207 — each saved line's datasheet coverage, keyed by pairKey(). */
  coverage: Record<string, MemberCoverage>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bySku = useMemo(() => toSkuMap(parts), [parts]);
  const settings = useMemo(() => ({ priceListEffective }), [priceListEffective]);
  const rows = useMemo(() => initial.map((rec) => ({ rec, live: resolveFixture(rec, bySku, settings) })), [initial, bySku, settings]);
  const counts: Record<Filter, number> = {
    all: rows.length,
    fixture: rows.filter((r) => r.rec.kind === "fixture").length,
    system: rows.filter((r) => r.rec.kind === "system").length,
  };
  const shown = rows.filter((r) => filter === "all" || r.rec.kind === filter);
  const live = draft ? resolveFixture(draftResolvable(draft), bySku, settings) : null;

  const start = (kind: FixtureKind) => { setChoosing(false); setError(null); setDraft(emptyDraft(kind)); };
  const edit = (rec: FixtureRecord) => {
    setChoosing(false);
    setError(null);
    setDraft(draftFromRecord(rec));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveFixtureAction(draftToInput(draft));
      if (!result.ok) { setError(result.error); return; }
      setDraft(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (rec: FixtureRecord) => {
    await deleteFixtureAction(rec.id);
    if (draft?.id === rec.id) setDraft(null);
    router.refresh();
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div role="tablist" aria-label="Show" style={{ display: "inline-flex", background: "#f1f2f5", borderRadius: 9, padding: 3 }}>
          {(["all", "fixture", "system"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              style={{ border: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 7, background: filter === f ? "#fff" : "transparent", color: filter === f ? "#16181d" : "#8c919c", boxShadow: filter === f ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}
            >
              {FILTER_LABEL[f]} <span style={{ color: "#9aa0ab", fontWeight: 500 }}>{counts[f]}</span>
            </button>
          ))}
        </div>
        {!draft && (choosing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: "#737985" }}>New assembly:</span>
            <button type="button" className="pk-btn-outline" onClick={() => start("fixture")}>Fixture</button>
            <button type="button" className="pk-btn-outline" onClick={() => start("system")}>System</button>
            <button type="button" onClick={() => setChoosing(false)} style={{ border: 0, background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 12 }}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="pk-btn-accent" onClick={() => setChoosing(true)}>+ New assembly</button>
        ))}
      </div>

      {draft && live && (
        <FixtureForm
          draft={draft}
          onChange={setDraft}
          parts={parts}
          bySku={bySku}
          live={live}
          coverage={coverage}
          busy={busy}
          error={error}
          onSave={save}
          onCancel={() => { setDraft(null); setError(null); }}
        />
      )}

      <section className="pk-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Assemblies</h2>
          <span style={{ color: "#9aa0ab", fontSize: 12 }}>{shown.length} shown</span>
        </div>
        {shown.length === 0 ? (
          <p style={{ color: "#8c919c", fontSize: 13 }}>No assemblies yet — build the first fixture or system from your catalog.</p>
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            {shown.map(({ rec, live: l }) => {
              const was = rec.snapshot?.cost;
              const drift = was != null && Math.abs(was - l.cost) >= 0.005;
              const head = l.parts.filter((p) => p.slot === "lightEngine" || p.slot === "lens").map((p) => p.label).join(" + ");
              const optional = l.parts.filter((p) => !p.included).length;
              return (
                <div key={rec.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 14, alignItems: "center", padding: "12px 0", borderTop: "1px solid #eef0f3" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{rec.label}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#737985", background: "#f2f4f7", borderRadius: 999, padding: "2px 8px" }}>
                        {rec.kind === "system" ? `System · ${rec.scope || "—"}` : "Fixture"}
                      </span>
                      {rec.needsReview && (
                        <span title="Converted from an assembly with no fixture-role part — its first part became the light engine. Check it and save." style={{ fontSize: 10.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dc", borderRadius: 999, padding: "2px 8px" }}>
                          needs review
                        </span>
                      )}
                    </div>
                    {rec.description && <div style={{ color: "#737985", fontSize: 12, marginTop: 4 }}>{rec.description}</div>}
                    <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 4 }}>
                      {rec.kind === "system" ? `${l.parts.length} part${l.parts.length === 1 ? "" : "s"}` : head}
                      {optional ? ` · ${optional} optional add-on${optional === 1 ? "" : "s"}` : ""}
                      {` · updated ${dateYear(rec.updatedAt)} by ${rec.updatedBy || "—"}`}
                    </div>
                    {l.missing.length > 0 && (
                      <div style={{ color: "#a0442b", fontSize: 11.5, marginTop: 4 }}>
                        {l.missing.length} part{l.missing.length === 1 ? "" : "s"} no longer in the catalog: {l.missing.join(", ")}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>{money(l.sell)}</div>
                    <div style={{ color: "#9aa0ab", fontSize: 10.5 }}>sell · cost {money(l.cost)} · {pricesNote(l.pricesAsOf)}</div>
                    {drift && <div style={{ color: "#8a6d1f", fontSize: 10.5 }}>cost was {money(was ?? 0)} when built ({dateYear(rec.updatedAt)})</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => edit(rec)} style={{ border: "1px solid #dfe2e8", borderRadius: 7, padding: "6px 9px", background: "#fff", color: "#3d424e", cursor: "pointer", fontSize: 11.5 }}>Edit</button>
                    <ConfirmButton label="Delete" confirmLabel={`Delete ${rec.label}?`} style={{ fontSize: 11.5, padding: "6px 9px" }} onConfirm={() => remove(rec)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 6: Replace `src/app/(app)/design/assemblies/page.tsx` entirely**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { fixturePairs, memberCoverageFor } from "@/lib/part-docs/assembly-graph";
import FixtureBuilder from "./fixture-builder";
import type { PartHit } from "./fixture-form";

export const metadata = { title: "Assembly Builder — Quartzite-6" };
export const dynamic = "force-dynamic";

/** #FXB — one builder for fixtures and systems (spec
 *  2026-09-25-fixture-builder-merge-design.md). The #130 `?tab=` switch is
 *  gone; a stale `?tab=` link lands on the one list. Everything prices from
 *  the live catalog, loaded once here. */
export default async function AssemblyBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  if (sp.tab !== undefined) redirect("/design/assemblies");
  const [settings, parts, fixtures] = await Promise.all([getSettings(), listCatalog(), listFixtures()]);
  // Part documents (#207): each saved line's datasheet coverage.
  const { index } = await loadPartDocsState(parts);
  const coverage = memberCoverageFor(index, fixtures.flatMap(fixturePairs));
  const hits: PartHit[] = parts.map((p) => ({
    sku: p.sku,
    desc: p.desc,
    category: p.category,
    mfr: p.mfr || "",
    unit: p.unit || "ea",
    list: Number(p.list) || 0,
    cost: Number(p.cost) || 0,
    ...(p.pricedAt ? { pricedAt: p.pricedAt } : {}),
  }));

  return (
    <div className="pk-content" style={{ maxWidth: 1080 }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Design</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Assembly Builder</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 700 }}>
        Fixtures and systems in one list. Everything prices from the live catalog — a price-list import re-prices them at once.
      </p>
      <FixtureBuilder initial={fixtures} parts={hits} priceListEffective={settings.priceListEffective || {}} coverage={coverage} />
    </div>
  );
}
```

- [ ] **Step 7: Delete the old builders and shim the old store**

```bash
git rm "src/app/(app)/design/assemblies/assembly-builder.tsx" "src/app/(app)/design/assemblies/tabs.tsx" "src/app/(app)/design/subassemblies/subassemblies-client.tsx" "src/app/(app)/design/subassemblies/actions.ts"
```

Replace `src/lib/stores/subassemblies.ts` entirely with:

```ts
/**
 * @deprecated #FXB — fixtures and systems live in src/lib/stores/fixtures.ts
 * (same `subassemblies` doc table). These names stay as aliases so an older
 * reader still compiles; the pre-#FXB row shape is `LegacySubassembly` in
 * src/lib/fixtures-convert.ts.
 */
export type { FixtureRecord as FixtureSubassembly, FixtureRecord as Subassembly, FixtureOptionCategory } from "@/lib/fixture-assemblies";
export type { LegacyOption as FixtureCompatibleOption } from "@/lib/fixtures-convert";
export { listFixtures as list, getFixture as get, removeFixture as remove } from "./fixtures";
```

Then confirm that nothing imports the deleted files or a value from a store in a client file:

```bash
grep -rn "assembly-builder\|assemblies/tabs\|subassemblies-client\|subassemblies/actions" src scripts
grep -ln '"use client"' "src/app/(app)/design/assemblies/"*.tsx | xargs grep -n 'from "@/lib/stores\|from "@/db' | grep -v "import type"
```

Expected: both commands print nothing.

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | grep -E "FAIL|ALL PASSED|FAILED"
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next
npm run test:smoke 2>&1 | grep -E "assemblies|FAIL|passed|failed" | head
```

Expected: tsc is clean and specs end `ALL PASSED`. Regressions end `review regression checks passed`. The build succeeds. Smoke shows `/design/assemblies`, `/design/assemblies?tab=subassemblies` and `/design/subassemblies` all OK, with every route passing.

- [ ] **Step 9: Commit**

```bash
git add -A "src/app/(app)/design/assemblies" "src/app/(app)/design/subassemblies" src/lib/stores/subassemblies.ts src/lib/design-routes.ts scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "feat(assemblies): one builder — Fixture/System form, one list, live pricing (#FXB)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and the full gates

**Files:**
- Modify: `DECISIONS.md` (append), `PUNCHLIST.md` (append), `AGENTS.md` (phase entry 15)

**Interfaces:** none (docs only).

- [ ] **Step 1: Append to `DECISIONS.md`**

```markdown

## D-FXB-1. Fixtures and systems are one record type in the `subassemblies` table, ids kept (#FXB, 2026-09-25)

`FixtureRecord` (`src/lib/fixture-assemblies.ts`, store `src/lib/stores/fixtures.ts`) replaces both builders' records
in the existing `subassemblies` doc table — no new table, no SQL migration. A one-time, idempotent conversion
(`src/lib/fixtures-migrate.ts`) inserts each `settings.fixtureAssemblies` entry under its `fa-…` id (insert-if-absent,
so a deleted one stays deleted) and rewrites each legacy subassembly row in place under its `SA-…` id; the settings
array is left untouched as a backup and no longer read. It runs on the first `listFixtures()`, on the Datasheets page,
from `npm run fixtures:convert -- --commit` and `npm run part-docs:backfill -- --commit`, under a 15 s page budget; a
blob flag (`fixtures_convert.convertedAt`) set only on completion makes later reads one single-row check. While it has
not completed, `listFixtures()` serves the settings-backed assemblies in memory so Estimator/Quick Design/Grid ids keep
resolving. The go-live reset wipes the table but keeps settings, so it re-arms the flag and the assemblies return as
they did when they lived in settings. New records mint `SA-<TS36>` with `-2`, `-3`… on a same-millisecond collision.

## D-FXB-2. Pricing is the Assemblies rule; a missing part keeps its cost override (#FXB, 2026-09-25)

Unit cost = line cost override ?? catalog cost, unit sell = catalog list; only qty ≥ 1 lines count, qty 0 lines are
optional add-ons listed with their unit numbers. A part missing from the catalog is `found: false`, sells at 0 and costs
its override or 0 — the spec says "contributes 0", but the Assemblies resolver already applied an override to a missing
part and converted totals must not move. The list's "was $X when built" badge compares **cost**: converted
subassemblies' snapshot `price` was their cost (the old price = cost rule), so a sell comparison would flag every one.

## D-FXB-3. Light engine and lens carry optional label / qty / override (#FXB, 2026-09-25)

The spec stores `lightEngineSku` / `lensSku`; a converted Assemblies-tab fixture member can have its own label, a
quantity other than 1, or an override, and dropping those would change Estimator descriptions and totals. They live in
optional `lightEngineLine` / `lensLine` (qty defaults to 1). Parts price in form order — engine, lens, Data, Power,
Mounting, Accessories — so a converted assembly's BOM description can list parts in a different order than before;
totals, components and ids are identical (parity-tested). Converted cable/lamp/other members land in Accessories and
their Estimator component role reads `accessory`. Old stored names survive only as `legacy.names`, fallback display for a
missing part.

## D-FXB-4. The accessory graph moves to one `fixture:<id>` scope (#FXB, 2026-09-25)

Fixtures only: parent = light engine; lens and every box line (qty 0 = un-included link) are accessories. The
conversion writes the `fixture:` scopes add-only (a live row and its flag are never rewritten), then soft-deletes every
`assembly:` / `subassembly:` row — after, so the "has its own datasheet" flag carries from the old row of the same pair.
This replaces D276's two scopes and its `part_docs_graph_sync` flag (production had already set that one, so the move
needed its own flag). Saves reconcile `fixture:<id>`; deletes empty it. Systems never feed the graph.

## D-FXB-5. Consumers read fixtures; systems wait for the Grid Equipment map (#FXB, 2026-09-25)

The Estimator configurator and Quick Design list fixture records through `fixtureAssembliesFrom()`, which returns
today's `ResolvedFixtureAssembly` shape, so their code paths are unchanged. Systems are not offered there (spec §5 lists
fixtures); the Grid Equipment map is their first consumer. The Grid scope panel has no fixture picker today and its
intake carries the id map, which keeps resolving because ids are kept — no Grid code change. The Estimator shows an
optional add-on as an off switch (on = qty 1) and pre-fills a fixture's default hang position / circuit into an empty
field. The fixture BOM line moved to `estimator/fixture-bom.ts`, unchanged.

## D-FXB-6. Anyone signed in edits; kind is fixed; a human save clears needs-review (#FXB, 2026-09-25)

`requireUser()` on save / delete / the datasheet toggle (the Subassemblies tab needed `manage_users`). Every save stamps
`updatedAt` / `updatedBy`, and create also stamps `createdAt` / `createdBy`. A record cannot switch between fixture and system.
Converted assemblies with no fixture-role member are flagged "needs review" (their first part became the light engine)
until someone saves them. The save action reads only the record's SKUs from the catalog (`listDocsByField`), never the
whole book. `/design/assemblies?tab=…` and `/design/subassemblies` redirect to the one list.
```

- [ ] **Step 2: Append to `PUNCHLIST.md`**

```markdown

## #FXB. One fixture builder — the Subassemblies form with the Assemblies logic — DONE 2026-09-25 (D-FXB-1…D-FXB-6)

**Spec:** `docs/superpowers/specs/2026-09-25-fixture-builder-merge-design.md` · **Plan:**
`docs/superpowers/plans/2026-09-25-fixture-builder-merge.md` · **Follows:** #129, #130, #207.

**Shipped.** `/design/assemblies` is one **Assemblies** list of fixtures and systems (All / Fixtures / Systems filter)
with one form: **New assembly** asks Fixture or System. A fixture is label, description, light engine, optional lens,
lamp, default hang position and circuit, and four boxes (Data / Power / Mounting / Accessories). A system is label,
description, scope (Lighting … Other) and one parts list. Each line has qty (0 = optional add-on), cost override, ↑/↓, ×
and the datasheet coverage toggle; the footer shows live included cost and sell and "prices as of"; the list shows
drift ("cost was $X when built"), missing parts and "needs review". Anyone signed in may edit, with who/when stamps.
Existing assemblies (`fa-…`) and subassemblies (`SA-…`) convert once, keeping their ids (`npm run fixtures:convert`,
or automatically on first read); `settings.fixtureAssemblies` stays as an untouched backup. The Estimator and Quick
Design read fixtures with identical totals for converted records; the Estimator offers optional add-ons as a switch.
The accessory graph moved to one `fixture:<id>` scope, the old `assembly:` / `subassembly:` rows retired with their
own-datasheet flags carried.

**Still open (Jeff-gated).** Run `npm run fixtures:convert` (report) then `-- --commit --yes` on production, or just
open the Assembly Builder once; review any "needs review" fixtures. Systems get their first consumer with the Grid
Equipment map.
```

- [ ] **Step 3: Add the AGENTS.md phase entry.** In `AGENTS.md` replace

```markdown
    D270–D280; punch item #207.

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
```

with

```markdown
    D270–D280; punch item #207.
15. ✅ **One fixture builder** (#FXB, D-FXB-1…D-FXB-6) — the Assembly
    Builder's two tabs merged: one `FixtureRecord` type (Fixture or
    System) in the existing `subassemblies` doc table
    (`src/lib/stores/fixtures.ts`; pure model, `resolveFixture` and save
    rules in `src/lib/fixture-assemblies.ts`), one list + form at
    `/design/assemblies`, Assemblies pricing (live cost + sell, per-line
    override, qty 0 = optional add-on). A one-time, idempotent conversion
    (`src/lib/fixtures-migrate.ts`, `npm run fixtures:convert`) keeps
    `fa-…`/`SA-…` ids, leaves `settings.fixtureAssemblies` as a backup,
    and moves the accessory graph to one `fixture:<id>` scope. Estimator
    and Quick Design read fixtures through `fixtureAssembliesFrom()` with
    identical totals. Remaining is Jeff-gated: run the conversion on
    production and review any "needs review" fixtures.

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
```

- [ ] **Step 4: Run every gate and record the real numbers**

```bash
npx tsc --noEmit; echo "tsc exit $?"
npx eslint 2>&1 | tail -2
npm run test:specs 2>&1 | tail -2
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
npm run test:smoke 2>&1 | tail -4
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -4; rm -rf .next
git status --short   # must not list next-env.d.ts or .env.local
```

Expected results:
- `tsc exit 0`
- eslint reports `0 errors` and no more than `110 warnings`
- specs end `ALL PASSED`
- regressions end `review regression checks passed`
- smoke reports every route OK
- the build succeeds
- only the three docs show as modified

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs: one fixture builder (#FXB), D-FXB-1…D-FXB-6" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| §2.1 form | Task 6 |
| §2.2 Assemblies logic | Task 1 |
| §2.3 qty 0 optional | Tasks 1, 5, 6 |
| §2.4 required fields, missing part allowed | Task 1 (+ store test, Task 4) |
| §2.5 `requireUser` plus who/when stamps | Tasks 4, 6 |
| §2.6 one collection, ids kept | Tasks 2–4 |
| §2.7 Fixture/System | Tasks 1, 6 |
| §3 record shape, conversion, backup | Tasks 2–3 |
| §4 `resolveFixture`, `fixtureDescription` | Task 1 |
| §5 Estimator | Task 5 |
| §5 Quick Design | Task 5 |
| §5 Grid (ids kept, no picker today) | Task 5, D-FXB-5 |
| §5 Grid Equipment map | future work; systems stored, ready |
| §5 accessory graph | Tasks 2–3 |
| §6 UI | Task 6 |
| §7 tests | Tasks 1–6 |

**Placeholder scan.** `#FXB` and `D-FXB-n` are deliberate lead-renumbered placeholders. No TBDs are left, and every code step carries code.

**Type consistency.** `FixtureRecord`, `CleanFixture`, `FixtureResolvable`, `RawFixtureRow`, `FixtureSnapshot`, `fixturePairs`, `fixtureRef`, `convertFixtures`, `ensureFixturesConverted` (returns `Promise<boolean>`), `fixturesConverted`, `resetFixturesConversion`, `listFixtures`, `getFixture`, `createFixture(value, by, snapshot, now?)`, `updateFixture(existing, value, by, snapshot, now?)`, `removeFixture`, `fixtureBomLine` and `optionalToggleQty` are used with the same names and signatures in every task.
