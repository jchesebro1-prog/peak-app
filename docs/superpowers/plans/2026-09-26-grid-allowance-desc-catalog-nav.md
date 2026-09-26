# #212 / #213 — Grid allowance descriptions + custom items, Catalog under Estimating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog becomes the last tab of the Estimating nav group (#213); an Equipment-map allowance gains a customer-facing description that prints on the Grid line (#212a); a Grid option can carry per-design "custom items" (no catalog row) priced exactly like an allowance (#212b).

**Architecture:** #213 is two lines in `src/components/nav/nav-data.ts`. #212a threads an optional `description` through the pure Equipment-map module (`equipment-map.ts`), its view model, the admin editor and the virtual-part resolver (`grid-virtual-parts.ts`). #212b adds one pure, client-safe module (`src/lib/design/grid-custom-items.ts`) that owns the item type, sanitizing, list edits and BOM/price lines; the items live on `GridOption.customItems`, so option copy, revision snapshot and restore carry them through the paths that already copy options; `buildGridQuote` appends them as allowance lines; two server actions and a small client BOM section edit them.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle doc-store (JSONB docs, no migration), the `tsx` spec harness `scripts/test-review-and-spec.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-26-inbox-link-popup-tasks-calendar-design.md`, sections "#212" and "#213". Do not touch #214/#215.
- No DB migrations: `grid_projects` is a JSONB doc table and the equipment map is a settings blob. Every new field is optional; old docs read unchanged.
- Allowance description: trimmed, ≤ 200 chars, empty → absent. `note` stays internal and never reaches a quote.
- Custom item: `desc` required, trimmed, ≤ 200; `mfr`/`model` ≤ 80; `qty` integer 1…100000; `unitCost` > 0 and ≤ `ALLOWANCE_MAX` (10,000,000); id `"ci-"` + 12 hex; BOM/spec sku `custom:<id>`; quote text `[desc, mfr, model].filter(Boolean).join(" — ")`.
- Custom item sell = unitCost ÷ (1 − the customer's tier margin) (`sellFromCost`), the allowance path. Always priced: never "Incomplete", never refuses a quote.
- The bid-spec BOM keeps dropping allowance lines (`gridSpecBomRows` unchanged), so custom items stay out of specs.
- Custom-item edits use the same gate as the placement edits: `requireUser()`.
- `/catalog` gets no new permission gate; the Settings → Company "Catalog" link stays.
- A `"use client"` file must never import a `@/lib/stores/*` module (only `next build` catches the postgres leak). Type-only imports from pure modules are fine; value imports only from pure modules.
- Timestamps are epoch-ms; copy the prototype's field names; no DECISIONS/PUNCHLIST edits (the controller writes docs at the end).
- Shell: prefix every command with `export PATH=$HOME/.local/node/bin:$PATH &&`. Run all commands from the worktree root `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks`. Never run the dev server or any `db:*` script; `npm run test:specs` uses its own `mktemp` datadir and is safe.
- New harness assertions are labelled with the `#212` / `#213` tag in their message, exactly like the existing `#211` ones (`ok(cond, "#212 …")`).
- Commit message style: `feat(grid): … (#212)` / `feat(nav): … (#213)`, then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Findings that shape the plan (read before starting)

1. **Where options live.** `GridOption` is defined in `src/lib/design/grid-options.ts:19-27`. Placements/routes are flat and tagged; the riser is a per-option `Record`. Custom items go ON the option (`GridOption.customItems`) because every option path already copies the option object:
   - revision snapshot `snapshotOf` copies `p.options.map((o) => ({ ...o }))` (`src/lib/stores/grid-projects.ts:1213-1217`) — we deep-copy the items there;
   - `restoreRevision` restores `target.options` wholesale, keeping only the current `quoteId` (`grid-projects.ts:1287-1291`) — items come back with no extra code; a pre-#212 snapshot restores an option with no custom items (same rule as a pre-#209 riser);
   - `removeOption` drops the option object (`grid-projects.ts:1167`) — its items go with it;
   - `addOption` with `copyFromOptionId` (`grid-projects.ts:1075-1116`) does NOT copy option fields — it builds a fresh option — so it needs an explicit copy (fresh ids).
2. **Nobody prints a Grid quote's `spec.lines` to a customer today.** A Grid quote (`source: "grid"`, `spec: { kind: "grid", lines }`) opens in the Estimator (`src/app/(app)/quotes/page.tsx:72`, fallback `editHrefFor`), and the Estimator only reads `spec.sections` (`src/app/(app)/estimator/page.tsx:144-148`); `preview-doc.tsx` renders estimator sections. The only reader of `spec.lines` is the bid-spec action (`src/app/(app)/design/engagements/spec/actions.ts:65-69`, through `gridSpecBomRows`, which drops allowance lines). So the description lands in the quote record (`spec.lines[].desc`) and in the Grid editor BOM; no renderer file needs a change for this item, and no customer document will show it until Grid quotes get a document of their own. This is a pre-existing gap, not in scope — flag it to the controller.
3. **The harness.** `ok(cond, msg)` is defined at `scripts/test-review-and-spec.ts:324`. Sync assertions are bare `{ … }` blocks at module scope (the `#211` ones start at line 17563 and the file ends with a sync block at line 18835). DB-backed checks are `async function xAsyncChecks()` declared anywhere (hoisted) and chained in the `seeded().then(…)` chain at lines 10470-10510; the last link today is `.then(() => gridSymbolLookAsyncChecks())` (line 10510). Async checks use dynamic `await import("../src/lib/…")` and `registerFixture("grid_projects", id)` for teardown (example: lines 15885-15894). `readFileSync` and `join` are imported at lines 242-243.
4. **Existing assertions Task A must update:** line 1982-1987 asserts `activeKeyFor("/catalog") === "settings"`; line 2873-2877 asserts the exact EST children `quotes,myquotes,estimator,reviews`.
5. **The editor BOM** is `src/app/(app)/design/grid/[id]/editor.tsx:1800-1957`. It prices with the `parts` PartLite list (sell = `list`). The customer tier margin is resolved in `page.tsx:170` and only sell numbers reach the client for curtains; custom lines follow that: `page.tsx` prices them server-side and passes sell-only `customLines`.
6. **`buildGridQuote`** (`src/lib/design/grid-quote.ts:72-202`) refuses an option with nothing on it ("Place a device or route a wire first.", line 84-85). A design whose only content is custom items must be quotable, so that check also counts custom items.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/components/nav/nav-data.ts` | A | Catalog child in `est`; `/catalog` → `"catalog"` |
| `src/lib/design/equipment-map.ts` | B | `description` on allowance cell/input; sanitize + merge |
| `src/lib/design/equipment-map-view.ts` | B | cell VM re-posts the description; detail shows it |
| `src/lib/design/grid-virtual-parts.ts` | B | `allow:` virtual part desc = description ‖ row label |
| `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx` | B | "Quote description (optional)" input |
| `src/lib/design/grid-custom-items.ts` (new) | C | pure: type, sanitize, list edits, BOM lines, cost |
| `src/lib/design/grid-options.ts` | C | `GridOption.customItems?` |
| `src/lib/design/grid-bom.ts` | C | `BomLine.allowance?` / `BomLine.custom?` flags |
| `src/lib/stores/grid-projects.ts` | C | `saveCustomItem` / `removeCustomItem`; option-copy; snapshot deep copy |
| `src/lib/design/grid-quote.ts` | C | price custom items as allowance lines |
| `src/app/(app)/design/grid/[id]/actions.ts` | C | `saveCustomItemAction` / `removeCustomItemAction` |
| `src/app/(app)/design/grid/[id]/page.tsx` | C | sell-only `customLines` prop |
| `src/app/(app)/design/grid/[id]/custom-items.tsx` (new) | C | client BOM section: list, "+ Custom item", edit, remove |
| `src/app/(app)/design/grid/[id]/editor.tsx` | C | mount the section, totals, empty state |
| `scripts/test-review-and-spec.ts` | A, B, C | assertions |

---

### Task A (#213): Catalog under Estimating

**Files:**
- Modify: `src/components/nav/nav-data.ts:30-49` (est group), `:162` (`/catalog` map entry)
- Test: `scripts/test-review-and-spec.ts:1982-1987`, `:2873-2877`, append at EOF

**Interfaces:**
- Consumes: nothing.
- Produces: nav child key `"catalog"` (href `/catalog`) as the last child of group `"est"`; `activeKeyFor(path)` returns `"catalog"` for every `/catalog/*` path, so `parentGroupOf(activeKeyFor("/catalog")) === "est"`.

- [ ] **Step 1: Update the two existing assertions that encode the old behaviour**

In `scripts/test-review-and-spec.ts`, replace (line 1982-1987):

```ts
ok(
  activeKeyFor("/catalog") === "settings" &&
    activeKeyFor("/templates") === "settings" &&
    activeKeyFor("/estimating-rules") === "settings" &&
    activeKeyFor("/import") === "settings",
  "catalog, templates, estimating-rules, import all light Settings",
);
```

with:

```ts
ok(
  activeKeyFor("/templates") === "settings" &&
    activeKeyFor("/estimating-rules") === "settings" &&
    activeKeyFor("/import") === "settings",
  "templates, estimating-rules, import all light Settings (catalog moved under Estimating, #213)",
);
```

and replace (line 2873-2877):

```ts
ok(
  !!(d117Est && d117Est.kind === "group" &&
    d117Est.children.map((c) => c.key).join(",") === "quotes,myquotes,estimator,reviews"),
  "EST = Quotes, My Quotes, Estimator, Reviews in order (#22)",
);
```

with:

```ts
ok(
  !!(d117Est && d117Est.kind === "group" &&
    d117Est.children.map((c) => c.key).join(",") === "quotes,myquotes,estimator,reviews,catalog"),
  "EST = Quotes, My Quotes, Estimator, Reviews, Catalog in order (#22, #213)",
);
```

- [ ] **Step 2: Append the #213 block at the end of the file**

Append after the last line of `scripts/test-review-and-spec.ts`:

```ts

/* --- #213: Catalog under Estimating --- */
{
  const est213 = NAV.find((e) => e.kind === "group" && e.key === "est");
  const kids213 = est213 && est213.kind === "group" ? est213.children : [];
  const last213 = kids213[kids213.length - 1];
  ok(!!last213 && last213.key === "catalog" && last213.label === "Catalog" && last213.href === "/catalog",
    "#213: Catalog is the last child of Estimating → /catalog");
  ok(activeKeyFor("/catalog") === "catalog" && activeKeyFor("/catalog/documents") === "catalog" && activeKeyFor("/catalog/documents/upload") === "catalog",
    "#213: every /catalog route lights the Catalog child");
  ok(parentGroupOf(activeKeyFor("/catalog")) === "est",
    "#213: /catalog lights the Estimating group pill, not Settings");
  ok(activeKeyFor("/templates") === "settings" && activeKeyFor("/import") === "settings" && activeKeyFor("/settings") === "settings",
    "#213: the other Settings doors are unchanged");
}
```

- [ ] **Step 3: Run the harness to see the new assertions fail**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > "${TMPDIR:-/tmp}/specs-213.log" 2>&1; grep -E '^FAIL' "${TMPDIR:-/tmp}/specs-213.log"`
Expected: FAIL lines for "EST = Quotes, My Quotes, Estimator, Reviews, Catalog in order (#22, #213)", "#213: Catalog is the last child…", "#213: every /catalog route…", "#213: /catalog lights the Estimating group pill…" (4 FAIL). Nothing else fails.

- [ ] **Step 4: Implement in `src/components/nav/nav-data.ts`**

Replace (line 46-47):

```ts
      { key: "estimator", label: "Estimator", href: "/estimator" },
      { key: "reviews", label: "Reviews", href: "/reviews" },
    ],
```

with:

```ts
      { key: "estimator", label: "Estimator", href: "/estimator" },
      { key: "reviews", label: "Reviews", href: "/reviews" },
      /* #213: the parts catalog is an estimating tool — last EST child. The
       * Settings → Company "Catalog" link stays as a second door; /catalog
       * gates its own admin parts, so no permission check here. */
      { key: "catalog", label: "Catalog", href: "/catalog" },
    ],
```

and replace (line 162):

```ts
    "/catalog": "settings",
```

with:

```ts
    "/catalog": "catalog", // #213 — lights the Catalog child of Estimating
```

- [ ] **Step 5: Run the gates**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit`
Expected: no output, exit 0.

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > "${TMPDIR:-/tmp}/specs-213.log" 2>&1; echo "exit $?"; grep -c '^PASS' "${TMPDIR:-/tmp}/specs-213.log"; grep -E '^FAIL|ALL PASSED|FAILED' "${TMPDIR:-/tmp}/specs-213.log"`
Expected: `exit 0`, a PASS count (report it), `ALL PASSED`, no `FAIL` line.

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/components/nav/nav-data.ts scripts/test-review-and-spec.ts`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(nav): Catalog is the last tab under Estimating (#213)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B (#212a): a customer-facing description on Equipment-map allowances

**Files:**
- Modify: `src/lib/design/equipment-map.ts:32-35` (EquipCell), `:49-53` (EquipCellInput), `:73-80` (sanitizeEquipCell), `:137-151` (mergeEquipRow)
- Modify: `src/lib/design/equipment-map-view.ts:107-112` (allowance cell VM)
- Modify: `src/lib/design/grid-virtual-parts.ts:90-106` (allowance virtual part)
- Modify: `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx:164-170`, `:200-258`
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes: nothing from Task A.
- Produces: `EquipCell` allowance `{ kind: "allowance"; amount; confirmedBy; confirmedAt; note?: string; description?: string }`; `EquipCellInput` allowance `{ kind: "allowance"; amount; note?: string; description?: string; confirmed: boolean }`; `virtualPartsFor` returns `desc = description || def.label` for a live `allow:` part.

**Decision taken here (flag for DECISIONS):** editing only the description does NOT re-stamp `confirmedBy`/`confirmedAt` — the confirmation attests to the dollar figure (amount + reason), and the description is a label. The spec says "validates it like `note`"; validation (trim, ≤ 200, empty → absent) is identical.

- [ ] **Step 1: Write the failing assertions**

Append at the end of `scripts/test-review-and-spec.ts`:

```ts

/* --- #212 (a): an Equipment-map allowance carries a customer-facing description --- */
import {
  mergeEquipRow as ci212Merge, sanitizeEquipCell as ci212SanitizeCell, type EquipmentMap as Ci212Map,
} from "@/lib/design/equipment-map";
import { equipmentMapView as ci212View } from "@/lib/design/equipment-map-view";
import { allowancePartId as ci212AllowId, virtualPartsFor as ci212Virtual } from "@/lib/design/grid-virtual-parts";
import { EQUIPMENT_ROW_BY_KEY as ci212RowByKey } from "@/lib/design/equipment-vocab";
{
  const m = ci212Merge(undefined, { tiers: { good: { kind: "allowance", amount: 500, note: "no book", description: "  Acme MC-9 motor controller  ", confirmed: true } } }, "Jeff", 10);
  const c = m.ok ? m.row.tiers.good : undefined;
  ok(c?.kind === "allowance" && c.description === "Acme MC-9 motor controller" && c.note === "no book",
    "#212: an allowance saves a trimmed quote description beside its internal note");
  const long = ci212Merge(undefined, { tiers: { good: { kind: "allowance", amount: 5, description: "x".repeat(250), confirmed: true } } }, "J", 1);
  const lc = long.ok ? long.row.tiers.good : undefined;
  ok(lc?.kind === "allowance" && lc.description?.length === 200, "#212: the description is capped at 200 characters");
  const blank = ci212Merge(undefined, { tiers: { good: { kind: "allowance", amount: 5, description: "   ", confirmed: true } } }, "J", 1);
  const bc = blank.ok ? blank.row.tiers.good : undefined;
  ok(bc?.kind === "allowance" && !("description" in bc), "#212: a blank description is absent, not an empty string");
  const m2 = ci212Merge(m.ok ? m.row : undefined, { tiers: { good: { kind: "allowance", amount: 500, note: "no book", description: "Acme MC-9 controller", confirmed: true } } }, "Chris", 20);
  const c2 = m2.ok ? m2.row.tiers.good : undefined;
  ok(c2?.kind === "allowance" && c2.description === "Acme MC-9 controller" && c2.confirmedBy === "Jeff" && c2.confirmedAt === 10,
    "#212: editing only the description keeps who confirmed the amount");
  const sc = ci212SanitizeCell({ kind: "allowance", amount: 5, confirmedBy: "J", confirmedAt: 1, description: " Stage lift " });
  ok(sc?.kind === "allowance" && sc.description === "Stage lift", "#212: the stored blob keeps a sanitized description");

  const label = ci212RowByKey.get("audio:subwoofer")!.label;
  const map: Ci212Map = {
    "audio:subwoofer": { tiers: { good: { kind: "allowance", amount: 1200, confirmedBy: "Chris", confirmedAt: 7, description: "Acme SUB-18 subwoofer" } }, sameAll: true, updatedBy: "Chris", updatedAt: 7 },
  };
  const plain: Ci212Map = {
    "audio:subwoofer": { tiers: { good: { kind: "allowance", amount: 1200, confirmedBy: "Chris", confirmedAt: 7 } }, sameAll: true, updatedBy: "Chris", updatedAt: 7 },
  };
  const ctx = { parts: new Map(), fixtures: new Map(), margin: 0.3 };
  const [withDesc] = ci212Virtual([ci212AllowId("audio:subwoofer", "good")], map, ctx);
  ok(withDesc?.desc === "Acme SUB-18 subwoofer" && withDesc.allowance === true && !withDesc.virtualDead,
    "#212: an allowance virtual part prints its description");
  const [noDesc] = ci212Virtual([ci212AllowId("audio:subwoofer", "better")], plain, ctx);
  ok(noDesc?.desc === label, "#212: with no description the virtual part keeps the row label");
  const [dead] = ci212Virtual([ci212AllowId("audio:subwoofer", "good")], {}, ctx);
  ok(dead?.desc === `${label} (allowance no longer confirmed)` && dead.virtualDead === true,
    "#212: the dead-allowance suffix still applies");

  const view = ci212View(map, ctx, {});
  const subIn = view.find((r) => r.key === "audio:subwoofer")!.cells[0].input;
  ok(subIn?.kind === "allowance" && subIn.description === "Acme SUB-18 subwoofer",
    "#212: the editor re-posts the saved description");
  const emc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx"), "utf8");
  ok(emc.includes("Quote description (optional)") && emc.includes("placeholder={label}") && emc.includes("maxLength={200}"),
    "#212: the Equipment map editor shows a Quote description input, placeholder = the row label");
}
```

- [ ] **Step 2: Run the harness to see it fail**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | head -5`
Expected: type errors in `scripts/test-review-and-spec.ts` — `description` does not exist on the allowance input/cell types.

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > "${TMPDIR:-/tmp}/specs-212a.log" 2>&1; grep -E '^FAIL' "${TMPDIR:-/tmp}/specs-212a.log"`
Expected: FAIL lines for the `#212:` assertions above (tsx does not type-check, so the run reaches them).

- [ ] **Step 3: Implement `equipment-map.ts`**

Replace line 35:

```ts
  | { kind: "allowance"; amount: number; confirmedBy: string; confirmedAt: number; note?: string };
```

with:

```ts
  /** `note` is the internal "why"; `description` (#212) is the customer-facing
   *  line text for a product with no catalog row. Both trimmed, ≤ 200, absent when empty. */
  | { kind: "allowance"; amount: number; confirmedBy: string; confirmedAt: number; note?: string; description?: string };
```

Replace line 52:

```ts
  | { kind: "allowance"; amount: number; note?: string; confirmed: boolean }
```

with:

```ts
  | { kind: "allowance"; amount: number; note?: string; description?: string; confirmed: boolean }
```

Replace lines 78-79 (inside `sanitizeEquipCell`):

```ts
    const note = String(r.note ?? "").trim().slice(0, 200);
    return { kind: "allowance", amount, confirmedBy, confirmedAt, ...(note ? { note } : {}) };
```

with:

```ts
    const note = String(r.note ?? "").trim().slice(0, 200);
    const description = String(r.description ?? "").trim().slice(0, 200);
    return { kind: "allowance", amount, confirmedBy, confirmedAt, ...(note ? { note } : {}), ...(description ? { description } : {}) };
```

Replace lines 141-150 (inside `mergeEquipRow`):

```ts
      const note = String(c.note ?? "").trim().slice(0, 200);
      const old = cellFor(prev, t);
      const unchanged = old?.kind === "allowance" && old.amount === amount && (old.note ?? "") === note;
      tiers[t] = {
        kind: "allowance",
        amount,
        confirmedBy: unchanged ? old.confirmedBy : by,
        confirmedAt: unchanged ? old.confirmedAt : now,
        ...(note ? { note } : {}),
      };
```

with:

```ts
      const note = String(c.note ?? "").trim().slice(0, 200);
      // #212: the customer-facing text. Changing it alone does not re-stamp
      // the confirmation — that attests to the amount and its reason.
      const description = String(c.description ?? "").trim().slice(0, 200);
      const old = cellFor(prev, t);
      const unchanged = old?.kind === "allowance" && old.amount === amount && (old.note ?? "") === note;
      tiers[t] = {
        kind: "allowance",
        amount,
        confirmedBy: unchanged ? old.confirmedBy : by,
        confirmedAt: unchanged ? old.confirmedAt : now,
        ...(note ? { note } : {}),
        ...(description ? { description } : {}),
      };
```

- [ ] **Step 4: Implement `equipment-map-view.ts`**

Replace lines 107-112:

```ts
  return {
    tier, kind: "allowance", title: "Allowance", detail: cell.note ?? "",
    unitCost: cell.amount, unitSell: priced?.unitSell ?? null, perSqft, problem,
    confirmedBy: cell.confirmedBy, confirmedAt: cell.confirmedAt,
    input: { kind: "allowance", amount: cell.amount, note: cell.note ?? "", confirmed: true },
  };
```

with:

```ts
  return {
    tier, kind: "allowance", title: "Allowance",
    detail: [cell.description ? `Quote: ${cell.description}` : "", cell.note ?? ""].filter(Boolean).join(" · "),
    unitCost: cell.amount, unitSell: priced?.unitSell ?? null, perSqft, problem,
    confirmedBy: cell.confirmedBy, confirmedAt: cell.confirmedAt,
    input: { kind: "allowance", amount: cell.amount, note: cell.note ?? "", description: cell.description ?? "", confirmed: true },
  };
```

- [ ] **Step 5: Implement `grid-virtual-parts.ts`**

Replace lines 90-96:

```ts
    const def = EQUIPMENT_ROW_BY_KEY.get(ref.rowKey)!;
    const cell = cellFor(map[ref.rowKey], ref.tier);
    const amount = cell?.kind === "allowance" && cell.amount > 0 ? cell.amount : 0;
    out.push({
      id,
      sku: "ALLOWANCE",
      desc: amount > 0 ? def.label : `${def.label} (allowance no longer confirmed)`,
```

with:

```ts
    const def = EQUIPMENT_ROW_BY_KEY.get(ref.rowKey)!;
    const cell = cellFor(map[ref.rowKey], ref.tier);
    const amount = cell?.kind === "allowance" && cell.amount > 0 ? cell.amount : 0;
    // #212: the allowance's customer-facing description, else the row's label.
    const label = cell?.kind === "allowance" && cell.description ? cell.description : def.label;
    out.push({
      id,
      sku: "ALLOWANCE",
      desc: amount > 0 ? label : `${label} (allowance no longer confirmed)`,
```

Also update the module doc comment — replace lines 10-11:

```ts
 * line internally (its desc is the row's plain label — customer text stays
 * normal, D315). A virtual part with nothing real behind it — a deleted
```

with:

```ts
 * line internally (its desc is the allowance's description, else the row's
 * plain label — customer text stays normal, D315, #212). A virtual part with
 * nothing real behind it — a deleted
```

- [ ] **Step 6: Implement the editor input in `equipment-map-client.tsx`**

In `RowEditor`, replace lines 164-170:

```tsx
            <CellEditor
              rowKey={row.key}
              curtain={row.curtain}
              value={cells[t.key]}
              assemblies={assemblies}
              onChange={(v) => setCells((c) => ({ ...c, [t.key]: v }))}
            />
```

with:

```tsx
            <CellEditor
              rowKey={row.key}
              label={row.label}
              curtain={row.curtain}
              value={cells[t.key]}
              assemblies={assemblies}
              onChange={(v) => setCells((c) => ({ ...c, [t.key]: v }))}
            />
```

Replace the `CellEditor` signature (lines 200-212):

```tsx
function CellEditor({
  rowKey,
  curtain,
  value,
  assemblies,
  onChange,
}: {
  rowKey: string;
  curtain: boolean;
  value: EquipCellInput;
  assemblies: AssemblyOption[];
  onChange: (v: EquipCellInput) => void;
}) {
```

with:

```tsx
function CellEditor({
  rowKey,
  label,
  curtain,
  value,
  assemblies,
  onChange,
}: {
  rowKey: string;
  /** The row's own name — the placeholder for the quote description (#212). */
  label: string;
  curtain: boolean;
  value: EquipCellInput;
  assemblies: AssemblyOption[];
  onChange: (v: EquipCellInput) => void;
}) {
```

Replace line 218:

```tsx
          : k === "allowance" ? { kind: "allowance", amount: 0, note: "", confirmed: false }
```

with:

```tsx
          : k === "allowance" ? { kind: "allowance", amount: 0, note: "", description: "", confirmed: false }
```

Replace line 251:

```tsx
          <input value={value.note ?? ""} placeholder="Why (e.g. waiting on the vendor's price book)" onChange={(e) => onChange({ ...value, note: e.target.value })} style={INPUT} />
```

with:

```tsx
          <input value={value.note ?? ""} placeholder="Why (e.g. waiting on the vendor's price book)" onChange={(e) => onChange({ ...value, note: e.target.value })} style={INPUT} />
          <div>
            <div style={LABEL}>Quote description (optional)</div>
            <input
              value={value.description ?? ""}
              maxLength={200}
              placeholder={label}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              style={INPUT}
            />
          </div>
```

- [ ] **Step 7: Run the gates**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit`
Expected: no output, exit 0.

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > "${TMPDIR:-/tmp}/specs-212a.log" 2>&1; echo "exit $?"; grep -c '^PASS' "${TMPDIR:-/tmp}/specs-212a.log"; grep -E '^FAIL|ALL PASSED|FAILED' "${TMPDIR:-/tmp}/specs-212a.log"`
Expected: `exit 0`, PASS count = Task A's count + 10 (report it), `ALL PASSED`.

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/design/equipment-map.ts src/lib/design/equipment-map-view.ts src/lib/design/grid-virtual-parts.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" scripts/test-review-and-spec.ts`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/equipment-map.ts src/lib/design/equipment-map-view.ts src/lib/design/grid-virtual-parts.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): a quote description on Equipment-map allowances (#212)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task C (#212b): per-design custom items on a Grid option

**Files:**
- Create: `src/lib/design/grid-custom-items.ts`
- Create: `src/app/(app)/design/grid/[id]/custom-items.tsx`
- Modify: `src/lib/design/grid-options.ts:17-27`
- Modify: `src/lib/design/grid-bom.ts:206-226` (BomLine)
- Modify: `src/lib/stores/grid-projects.ts:12-20` (imports), `:1086-1088` (addOption), `:1184-1186` (new store fns before revisions), `:1213-1217` (snapshotOf)
- Modify: `src/lib/design/grid-quote.ts:15-23` (imports), `:80-85`, `:170-178`, `:195`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts:7-39` (imports) and EOF (new actions)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx:31`, `:180`, `:236`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx:33`, `:89`, `:255`, `:289`, `:670`, `:1802-1806`, `:1893`, `:1955`
- Test: `scripts/test-review-and-spec.ts` (append sync block + async function at EOF; one `.then` link at line 10510)

**Interfaces:**
- Consumes: `ALLOWANCE_MAX`, `sellFromCost(cost, margin)` from `src/lib/design/equipment-map.ts`; `isGridLayer`, `type GridLayer` from `src/lib/design/grid-scopes.ts`; `type BomLine` from `src/lib/design/grid-bom.ts`.
- Produces (exact names later steps and reviewers rely on):
  - `src/lib/design/grid-custom-items.ts`:
    - `const CUSTOM_ITEM_PREFIX = "custom:"`, `CUSTOM_ITEM_DESC_MAX = 200`, `CUSTOM_ITEM_MAKER_MAX = 80`, `CUSTOM_ITEM_QTY_MAX = 100_000`, `CUSTOM_ITEMS_MAX = 200`
    - `type GridCustomItem = { id: string; desc: string; mfr?: string; model?: string; system?: GridLayer; qty: number; unitCost: number }`
    - `type GridCustomItemInput = { id?: string | null; desc: string; mfr?: string; model?: string; system?: string; qty: number; unitCost: number }`
    - `isCustomItemId(v: unknown): v is string`
    - `customItemPartId(id: string): string`
    - `sanitizeCustomItem(raw: unknown, id: string): { ok: true; item: GridCustomItem } | { ok: false; error: string }`
    - `customItemsOf(raw: unknown): GridCustomItem[]`
    - `customItemDesc(it: Pick<GridCustomItem, "desc" | "mfr" | "model">): string`
    - `customItemBomLines(items: readonly GridCustomItem[], margin: number): BomLine[]`
    - `customItemsCost(items: readonly GridCustomItem[]): number`
    - `type CustomItemSave`; `applyCustomItemSave(items: readonly GridCustomItem[], raw: unknown, makeId: () => string): CustomItemSave`
    - `withoutCustomItem(items: readonly GridCustomItem[], id: string): GridCustomItem[]`
    - `copyCustomItems(items: readonly GridCustomItem[], makeId: () => string): GridCustomItem[]`
  - `GridOption.customItems?: GridCustomItem[]`
  - `BomLine.allowance?: true`, `BomLine.custom?: true`
  - store: `saveCustomItem(projectId: string, optionId: string, raw: unknown): Promise<{ ok: true; item: GridCustomItem } | { ok: false; error: string }>`; `removeCustomItem(projectId: string, optionId: string, itemId: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - actions: `saveCustomItemAction(projectId: string, optionId: string, input: GridCustomItemInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>`; `removeCustomItemAction(projectId: string, optionId: string, itemId: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - editor prop: `customLines: BomLine[]` (sell-only, the active option's)

**Decisions taken here (flag for DECISIONS):** items live on `GridOption` (Finding 1); a copied option gets fresh `ci-` ids; `system` is kept in the type and sanitizer (a Grid layer name, unknown → dropped) but the inline form does not ask for it (spec's form lists description, mfr, model, qty, unit cost); an option whose only content is custom items can be quoted; custom lines sit after curtains and before labor in the BOM and the quote; the editor receives server-priced sell lines (the tier margin never reaches the client).

- [ ] **Step 1: Write the failing sync assertions**

Append at the end of `scripts/test-review-and-spec.ts`:

```ts

/* --- #212 (b): per-design custom items — sanitize, list edits, BOM lines, pricing, bid-spec exclusion --- */
import {
  applyCustomItemSave as ci212Save, copyCustomItems as ci212Copy, customItemBomLines as ci212Lines,
  customItemDesc as ci212Desc, customItemPartId as ci212PartId, customItemsCost as ci212Cost, customItemsOf as ci212Of,
  sanitizeCustomItem as ci212Sanitize, withoutCustomItem as ci212Without, CUSTOM_ITEMS_MAX as ci212Max,
  type GridCustomItem as Ci212Item,
} from "@/lib/design/grid-custom-items";
import { gridSpecBomRows as ci212SpecRows } from "@/lib/design/grid-virtual-parts";
import { sellFromCost as ci212Sell } from "@/lib/design/equipment-map";
{
  const ID = "ci-0123456789ab";
  const good = ci212Sanitize({ desc: "  Custom motor controller  ", mfr: " Acme ", model: "MC-9", system: "Rigging", qty: 2, unitCost: 1000.004 }, ID);
  ok(good.ok && good.item.id === ID && good.item.desc === "Custom motor controller" && good.item.mfr === "Acme" && good.item.model === "MC-9" && good.item.system === "Rigging" && good.item.qty === 2 && good.item.unitCost === 1000,
    "#212 custom: sanitize trims text, keeps a known system, rounds the cost to cents");
  ok(!ci212Sanitize({ desc: "   ", qty: 1, unitCost: 10 }, ID).ok, "#212 custom: a description is required");
  const longD = ci212Sanitize({ desc: "d".repeat(260), mfr: "m".repeat(90), model: "  ", qty: 1, unitCost: 10 }, ID);
  ok(longD.ok && longD.item.desc.length === 200 && longD.item.mfr?.length === 80 && !("model" in longD.item),
    "#212 custom: desc ≤ 200, mfr/model ≤ 80, a blank model is absent");
  ok(!ci212Sanitize({ desc: "x", qty: 0, unitCost: 10 }, ID).ok && !ci212Sanitize({ desc: "x", qty: 1.5, unitCost: 10 }, ID).ok && !ci212Sanitize({ desc: "x", qty: 100001, unitCost: 10 }, ID).ok,
    "#212 custom: qty is a whole number from 1 to 100,000");
  ok(!ci212Sanitize({ desc: "x", qty: 1, unitCost: 0 }, ID).ok && !ci212Sanitize({ desc: "x", qty: 1, unitCost: 10_000_001 }, ID).ok && !ci212Sanitize({ desc: "x", qty: 1, unitCost: "abc" }, ID).ok,
    "#212 custom: the unit cost must be above $0 and within the allowance ceiling");
  const sysless = ci212Sanitize({ desc: "x", system: "Plumbing", qty: 1, unitCost: 5 }, ID);
  ok(sysless.ok && !("system" in sysless.item), "#212 custom: an unknown system is dropped, not stored");
  ok(ci212Desc({ desc: "Controller", mfr: "Acme", model: "MC-9" }) === "Controller — Acme — MC-9" && ci212Desc({ desc: "Controller", model: "MC-9" }) === "Controller — MC-9" && ci212Desc({ desc: "Controller" }) === "Controller",
    "#212 custom: the quote text is desc — mfr — model");

  const first: Ci212Item = good.ok ? good.item : { id: ID, desc: "?", qty: 1, unitCost: 1 };
  const items: Ci212Item[] = [first, { id: "ci-bbbbbbbbbbbb", desc: "Stage lift", qty: 1, unitCost: 25000 }];
  const lines = ci212Lines(items, 0.3);
  ok(lines.length === 2 && lines.every((l) => l.allowance === true && l.custom === true && l.unit === "ea"),
    "#212 custom: every custom BOM line is flagged allowance + custom");
  ok(lines[0].partId === ci212PartId(ID) && lines[0].partId === `custom:${ID}` && lines[0].desc === "Custom motor controller — Acme — MC-9" && lines[0].qty === 2,
    "#212 custom: sku custom:<id>, desc carries maker and model");
  ok(lines[0].list === ci212Sell(1000, 0.3) && lines[0].list === 1428.57 && lines[0].ext === 2857.14 && lines[1].list === 35714.29 && lines[1].ext === 35714.29,
    "#212 custom: sell = unit cost ÷ (1 − margin), ext = qty × sell");
  ok(ci212Cost(items) === 27000, "#212 custom: the cost basis is qty × unit cost");
  ok(ci212Lines(items, 0.3).every((l) => l.list > 0 && l.ext > 0), "#212 custom: a custom line is always priced — it can never read Incomplete");

  ok(ci212Of(undefined).length === 0 && ci212Of("junk").length === 0, "#212 custom: a missing or junk list reads as none");
  const read = ci212Of([first, { id: "bad-id", desc: "x", qty: 1, unitCost: 1 }, { id: "ci-cccccccccccc", desc: "", qty: 1, unitCost: 1 }, { ...first }, 7]);
  ok(read.length === 1 && read[0].id === ID, "#212 custom: a stored list drops bad ids, invalid rows and duplicates");

  const added = ci212Save([], { desc: "A", qty: 1, unitCost: 10 }, () => "ci-dddddddddddd");
  ok(added.ok && added.items.length === 1 && added.item.id === "ci-dddddddddddd", "#212 custom: saving without an id adds a new item");
  const edited = added.ok ? ci212Save(added.items, { id: "ci-dddddddddddd", desc: "A2", qty: 3, unitCost: 10 }, () => "ci-eeeeeeeeeeee") : added;
  ok(edited.ok && edited.items.length === 1 && edited.item.id === "ci-dddddddddddd" && edited.item.desc === "A2" && edited.item.qty === 3,
    "#212 custom: saving with an existing id edits it in place");
  const gone = ci212Save([], { id: "ci-dddddddddddd", desc: "A", qty: 1, unitCost: 10 }, () => "ci-eeeeeeeeeeee");
  ok(!gone.ok && gone.reason === "no-such-item", "#212 custom: editing an item removed elsewhere is refused");
  const bad = ci212Save([], { desc: "", qty: 1, unitCost: 10 }, () => "ci-eeeeeeeeeeee");
  ok(!bad.ok && bad.reason === "invalid" && bad.error.length > 0, "#212 custom: an invalid item is refused with a message");
  const full = Array.from({ length: ci212Max }, (_, i): Ci212Item => ({ id: `ci-${String(i).padStart(12, "0")}`, desc: "x", qty: 1, unitCost: 1 }));
  const over = ci212Save(full, { desc: "y", qty: 1, unitCost: 1 }, () => "ci-ffffffffffff");
  ok(!over.ok && over.reason === "too-many", `#212 custom: an option holds at most ${ci212Max} custom items`);
  ok(ci212Without(items, ID).map((i) => i.id).join() === "ci-bbbbbbbbbbbb", "#212 custom: remove drops exactly that item");
  let n = 0;
  const copies = ci212Copy(items, () => `ci-${String(++n).padStart(12, "a")}`);
  ok(copies.length === 2 && copies.every((c, i) => c.id !== items[i].id && c.desc === items[i].desc && c.unitCost === items[i].unitCost),
    "#212 custom: a copied option gets the same items under fresh ids");

  const specRows = ci212SpecRows(
    [{ sku: `custom:${ID}`, desc: "Custom motor controller — Acme — MC-9", qty: 2, allowance: true }, { sku: "ETC-S4", desc: "Source Four", qty: 3 }],
    () => null
  );
  ok(specRows.length === 1 && specRows[0].sku === "ETC-S4", "#212 custom: the bid-spec BOM leaves custom items out");

  const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const pure = src("src/lib/design/grid-custom-items.ts");
  const pureValueImports = [...pure.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map((mm) => mm[1]).sort();
  ok(JSON.stringify(pureValueImports) === JSON.stringify(["./equipment-map", "./grid-scopes"]),
    "#212 custom: the helper module stays pure (value imports: equipment-map, grid-scopes only)");
  const gq = src("src/lib/design/grid-quote.ts");
  ok(gq.includes("customItemBomLines(customItems, tier.margin)") && gq.includes("customItemsCost(customItems)") && gq.includes("allowanceIds.has(l.partId) || l.allowance"),
    "#212 custom: buildGridQuote prices custom items at the tier margin and flags them allowance on the spec");
  ok(src("src/lib/design/grid-options.ts").includes("customItems?: GridCustomItem[]"), "#212 custom: the items live on the Grid option");
  const store = src("src/lib/stores/grid-projects.ts");
  ok(store.includes("copyCustomItems(customItemsOf(src?.customItems)") && store.includes("customItems: o.customItems.map((c) => ({ ...c }))"),
    "#212 custom: option copy and revision snapshots carry custom items");
  const panel = src("src/app/(app)/design/grid/[id]/custom-items.tsx");
  const panelImports = [...panel.matchAll(/from\s+"([^"]+)"/g)].map((mm) => mm[1]);
  ok(panel.startsWith('"use client"') && panelImports.every((s) => !s.startsWith("@/lib/stores/") && !s.startsWith("@/db")) && panel.includes("Allowance · custom") && panel.includes("+ Custom item"),
    "#212 custom: the BOM section is a client component with no store import");
  const acts = src("src/app/(app)/design/grid/[id]/actions.ts");
  const body = (name: string) => acts.slice(acts.indexOf(`export async function ${name}`), acts.indexOf("\n}\n", acts.indexOf(`export async function ${name}`)));
  ok(body("saveCustomItemAction").includes("await requireUser()") && body("saveCustomItemAction").includes("saveCustomItem(") && body("removeCustomItemAction").includes("await requireUser()"),
    "#212 custom: both actions use the placement-edit gate and the server-side store");
  const ed = src("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("<CustomItemsSection") && ed.includes("customValue") && ed.includes("disabled={busy || bomEmpty}"),
    "#212 custom: the editor BOM shows custom items, totals them and can quote a custom-only option");
}
```

- [ ] **Step 2: Write the failing async (store + quote) check**

Append at the end of `scripts/test-review-and-spec.ts`:

```ts

/* #212 (b) — custom items through the store and buildGridQuote on the scratch DB. */
async function gridCustomItemsAsyncChecks(): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  const { buildGridQuote } = await import("../src/lib/design/grid-quote");
  const { resolveTier } = await import("../src/lib/pricing-tiers");
  const { sellFromCost } = await import("../src/lib/design/equipment-map");

  const gp = await GP.createProject({ name: "CI212 test grid project", customer: "Test Customer CI212", customerId: null, by: "Test Harness" });
  registerFixture("grid_projects", gp.id);
  const base = (await GP.getProject(gp.id))!.options![0].id;

  const empty = await buildGridQuote((await GP.getProject(gp.id))!, base);
  ok(!empty.ok, "#212 store: an option with nothing on it still refuses to quote");

  const bad = await GP.saveCustomItem(gp.id, base, { desc: "", qty: 1, unitCost: 10 });
  ok(!bad.ok && /Describe/.test(bad.error), "#212 store: an invalid item is refused with the sanitizer's message");
  const noOpt = await GP.saveCustomItem(gp.id, "opt-nope", { desc: "x", qty: 1, unitCost: 10 });
  ok(!noOpt.ok, "#212 store: an unknown option is refused");

  const a = await GP.saveCustomItem(gp.id, base, { desc: "Custom motor controller", mfr: "Acme", model: "MC-9", qty: 2, unitCost: 1000 });
  const id = a.ok ? a.item.id : "";
  ok(a.ok && /^ci-[0-9a-f]{12}$/.test(id), "#212 store: a new custom item gets a ci- id");

  const tier = await resolveTier(null);
  const unit = sellFromCost(1000, tier.margin);
  const built = await buildGridQuote((await GP.getProject(gp.id))!, base);
  const line = built.ok ? built.build.spec.lines.find((l) => l.sku === `custom:${id}`) : undefined;
  ok(built.ok && built.build.value === Math.round(2 * unit * 100) / 100,
    `#212 quote: a custom-only option quotes at unit cost ÷ (1 − tier margin) × qty (${built.ok ? built.build.value : "refused"})`);
  ok(!!line && line.allowance === true && line.desc === "Custom motor controller — Acme — MC-9" && line.qty === 2 && line.price === unit,
    "#212 quote: the spec line carries the custom text, flagged allowance");
  ok(built.ok && built.build.fallbackLines.length === 0, "#212 quote: a custom line is never a tier-fallback line");

  const e = await GP.saveCustomItem(gp.id, base, { id, desc: "Custom motor controller", mfr: "Acme", model: "MC-9", qty: 3, unitCost: 1000 });
  const afterEdit = (await GP.getProject(gp.id))!.options![0].customItems || [];
  ok(e.ok && afterEdit.length === 1 && afterEdit[0].qty === 3 && afterEdit[0].id === id, "#212 store: editing keeps the id and changes the item in place");

  const alt = await GP.addOption(gp.id, { name: "Alt", copyFromOptionId: base, by: "Test Harness" });
  const altItems = alt.ok ? (await GP.getProject(gp.id))!.options!.find((o) => o.id === alt.option.id)?.customItems || [] : [];
  ok(altItems.length === 1 && altItems[0].id !== id && altItems[0].desc === "Custom motor controller" && altItems[0].qty === 3,
    "#212 store: copying an option copies its custom items under fresh ids");

  const rev = await GP.addRevision(gp.id, { by: "Test Harness", note: "with a custom item" });
  ok((rev?.options?.find((o) => o.id === base)?.customItems || []).length === 1, "#212 store: a revision snapshot holds the option's custom items");

  const r = await GP.removeCustomItem(gp.id, base, id);
  ok(r.ok && ((await GP.getProject(gp.id))!.options![0].customItems || []).length === 0, "#212 store: remove drops the item");

  const restored = rev ? await GP.restoreRevision(gp.id, rev.rev, "Test Harness") : { ok: false as const };
  const back = (await GP.getProject(gp.id))!.options!.find((o) => o.id === base)?.customItems || [];
  ok(restored.ok && back.length === 1 && back[0].id === id, "#212 store: restoring a revision brings its custom items back");
}
```

Then add the chain link: replace (line 10510)

```ts
  .then(() => gridSymbolLookAsyncChecks())
```

with:

```ts
  .then(() => gridSymbolLookAsyncChecks())
  .then(() => gridCustomItemsAsyncChecks())
```

- [ ] **Step 3: Run the harness to see it fail**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > "${TMPDIR:-/tmp}/specs-212b.log" 2>&1; echo "exit $?"; tail -5 "${TMPDIR:-/tmp}/specs-212b.log"`
Expected: non-zero exit; the run aborts at import with `Cannot find module '@/lib/design/grid-custom-items'` (or the tsx equivalent `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 4: Create the pure module `src/lib/design/grid-custom-items.ts`**

```ts
/**
 * Per-design custom items (#212) — pure and client-safe (the grid-bom.ts
 * rule): imported by the store, the quote builder, the editor page AND the
 * client BOM section.
 *
 * A custom item is "a product that just doesn't have a catalog item": a
 * described line on ONE Grid option, priced exactly like an Equipment-map
 * allowance — sell = unit cost ÷ (1 − the customer's tier margin). It is
 * always priced (never "Incomplete"), flagged `allowance` on the quote, and
 * left out of the bid spec (gridSpecBomRows drops allowance lines). It is
 * never placed on the plan sheet and never enters the catalog.
 *
 * Stored on the option itself (`GridOption.customItems`), so revision
 * snapshots, restores and option removal carry it with no second code path;
 * option copy re-ids it (copyCustomItems).
 */
import type { BomLine } from "./grid-bom";
import { ALLOWANCE_MAX, sellFromCost } from "./equipment-map";
import { isGridLayer, type GridLayer } from "./grid-scopes";

export const CUSTOM_ITEM_PREFIX = "custom:";
export const CUSTOM_ITEM_DESC_MAX = 200;
export const CUSTOM_ITEM_MAKER_MAX = 80;
export const CUSTOM_ITEM_QTY_MAX = 100_000;
/** Typo/abuse guard per option, not a policy. */
export const CUSTOM_ITEMS_MAX = 200;

export type GridCustomItem = {
  id: string; // "ci-" + 12 hex
  /** Customer-facing text — required, trimmed, ≤ 200. */
  desc: string;
  mfr?: string;
  model?: string;
  /** Optional Grid layer (Lighting, Rigging, …), for grouping later. */
  system?: GridLayer;
  /** Whole number, 1…100,000. */
  qty: number;
  /** Unit COST, > 0 and ≤ ALLOWANCE_MAX. */
  unitCost: number;
};

/** What the editor posts. `id` present = edit that item; absent = add one. */
export type GridCustomItemInput = {
  id?: string | null;
  desc: string;
  mfr?: string;
  model?: string;
  system?: string;
  qty: number;
  unitCost: number;
};

const ID_RE = /^ci-[0-9a-f]{12}$/;

export function isCustomItemId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

/** The BOM / quote-spec sku of a custom item. */
export function customItemPartId(id: string): string {
  return CUSTOM_ITEM_PREFIX + id;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function sanitizeCustomItem(
  raw: unknown,
  id: string
): { ok: true; item: GridCustomItem } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const desc = text(r.desc, CUSTOM_ITEM_DESC_MAX);
  if (!desc) return { ok: false, error: "Describe the item — that text prints on the quote." };
  const qty = Number(r.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > CUSTOM_ITEM_QTY_MAX)
    return { ok: false, error: "Quantity must be a whole number from 1 to 100,000." };
  const unitCost = round2(Number(r.unitCost));
  if (!(unitCost > 0) || unitCost > ALLOWANCE_MAX) return { ok: false, error: "A custom item needs a unit cost above $0." };
  const mfr = text(r.mfr, CUSTOM_ITEM_MAKER_MAX);
  const model = text(r.model, CUSTOM_ITEM_MAKER_MAX);
  return {
    ok: true,
    item: {
      id,
      desc,
      ...(mfr ? { mfr } : {}),
      ...(model ? { model } : {}),
      ...(isGridLayer(r.system) ? { system: r.system } : {}),
      qty,
      unitCost,
    },
  };
}

/** A stored list → clean items: valid ids and fields only, no duplicates, capped. */
export function customItemsOf(raw: unknown): GridCustomItem[] {
  if (!Array.isArray(raw)) return [];
  const out: GridCustomItem[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (out.length >= CUSTOM_ITEMS_MAX) break;
    if (!x || typeof x !== "object") continue;
    const id = (x as { id?: unknown }).id;
    if (!isCustomItemId(id) || seen.has(id)) continue;
    const s = sanitizeCustomItem(x, id);
    if (!s.ok) continue;
    seen.add(id);
    out.push(s.item);
  }
  return out;
}

/** The line text: description — manufacturer — model (blanks skipped). */
export function customItemDesc(it: Pick<GridCustomItem, "desc" | "mfr" | "model">): string {
  return [it.desc, it.mfr, it.model].filter(Boolean).join(" — ");
}

/** BOM lines in the order the person added them; sell = cost ÷ (1 − margin). */
export function customItemBomLines(items: readonly GridCustomItem[], margin: number): BomLine[] {
  return items.map((it) => {
    const list = sellFromCost(it.unitCost, margin);
    return {
      partId: customItemPartId(it.id),
      desc: customItemDesc(it),
      unit: "ea",
      qty: it.qty,
      list,
      ext: round2(it.qty * list),
      allowance: true as const,
      custom: true as const,
    };
  });
}

/** The cost basis the quote's margin is computed from. */
export function customItemsCost(items: readonly GridCustomItem[]): number {
  return round2(items.reduce((a, it) => a + it.qty * it.unitCost, 0));
}

export type CustomItemSave =
  | { ok: true; items: GridCustomItem[]; item: GridCustomItem }
  | { ok: false; reason: "no-such-item" | "invalid" | "too-many"; error: string };

/** Add (no id) or edit (existing id) one item in a list. Never mutates `items`. */
export function applyCustomItemSave(items: readonly GridCustomItem[], raw: unknown, makeId: () => string): CustomItemSave {
  const wanted = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
  const editId = typeof wanted === "string" && wanted ? wanted : null;
  if (editId !== null && !items.some((it) => it.id === editId))
    return { ok: false, reason: "no-such-item", error: "That custom item was removed — refresh the page." };
  if (editId === null && items.length >= CUSTOM_ITEMS_MAX)
    return { ok: false, reason: "too-many", error: `An option holds at most ${CUSTOM_ITEMS_MAX} custom items.` };
  const s = sanitizeCustomItem(raw, editId ?? makeId());
  if (!s.ok) return { ok: false, reason: "invalid", error: s.error };
  const next = editId !== null ? items.map((it) => (it.id === editId ? s.item : it)) : [...items, s.item];
  return { ok: true, items: next, item: s.item };
}

export function withoutCustomItem(items: readonly GridCustomItem[], id: string): GridCustomItem[] {
  return items.filter((it) => it.id !== id);
}

/** A copied option's items: same content, fresh ids. */
export function copyCustomItems(items: readonly GridCustomItem[], makeId: () => string): GridCustomItem[] {
  return items.map((it) => ({ ...it, id: makeId() }));
}
```

- [ ] **Step 5: Add the option field and the BomLine flags**

In `src/lib/design/grid-options.ts`, replace lines 17-27:

```ts
import type { TierKey } from "@/app/(app)/design/quick/engine";

export type GridOption = {
  id: string; // 'opt-' + 12 hex, or DEFAULT_OPTION_ID for a normalized legacy doc
  name: string;
  /** Set by the Auto generator (Spec 2). Absent on hand-made options. */
  tier?: TierKey;
  /** Draft quote minted from THIS option, when one exists. */
  quoteId: string | null;
  createdAt: number;
};
```

with:

```ts
import type { TierKey } from "@/app/(app)/design/quick/engine";
import type { GridCustomItem } from "./grid-custom-items";

export type GridOption = {
  id: string; // 'opt-' + 12 hex, or DEFAULT_OPTION_ID for a normalized legacy doc
  name: string;
  /** Set by the Auto generator (Spec 2). Absent on hand-made options. */
  tier?: TierKey;
  /** Draft quote minted from THIS option, when one exists. */
  quoteId: string | null;
  createdAt: number;
  /** Per-design custom items (#212) — priced as allowances, never placed.
   *  Absent on older options; always read through customItemsOf(). */
  customItems?: GridCustomItem[];
};
```

In `src/lib/design/grid-bom.ts`, replace lines 224-226 (end of `BomLine`):

```ts
  /** Curtain lines only: the name the designer typed, for a short label. */
  curtainName?: string;
};
```

with:

```ts
  /** Curtain lines only: the name the designer typed, for a short label. */
  curtainName?: string;
  /** #212: an allowance line that carries its own flag (custom items) —
   *  the quote marks its spec line `allowance`, the bid spec drops it. */
  allowance?: true;
  /** #212: a per-design custom item — `partId` is `custom:<id>`, not a catalog id. */
  custom?: true;
};
```

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | head -20`
Expected: errors only in `scripts/test-review-and-spec.ts` about `saveCustomItem` / `removeCustomItem` not existing on the store module (the remaining steps add them).

- [ ] **Step 6: Store — option copy, snapshot deep copy, save/remove**

In `src/lib/stores/grid-projects.ts`, after the `import { cleanDrawingSet, … } from "@/lib/design/grid-drawing-set";` line (line 23) add:

```ts
import {
  applyCustomItemSave,
  copyCustomItems,
  customItemsOf,
  withoutCustomItem,
  type GridCustomItem,
} from "@/lib/design/grid-custom-items";
```

In `addOption`, replace (lines 1086-1088):

```ts
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = [...doc.options, option];
```

with:

```ts
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    // Custom items (#212) are option-scoped design state: a copied option
    // carries its own copies, under fresh ids.
    if (input.copyFromOptionId) {
      const src = doc.options.find((o) => o.id === input.copyFromOptionId);
      const items = copyCustomItems(customItemsOf(src?.customItems), () => rid("ci-"));
      if (items.length) option.customItems = items;
    }
    doc.options = [...doc.options, option];
```

Insert immediately before the line `/* ----------------------------- revisions ----------------------------- */` (line 1186):

```ts
/* --------------------------- custom items (#212) --------------------------- */

/**
 * Add (no `id`) or edit (existing `id`) one custom item on an option. The raw
 * input is re-sanitized here whatever the client sent. Does not cut a
 * revision (same as a placement edit); quote/manual revisions capture it.
 */
export async function saveCustomItem(
  projectId: string,
  optionId: string,
  raw: unknown
): Promise<{ ok: true; item: GridCustomItem } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  let out: { ok: true; item: GridCustomItem } | { ok: false; error: string } = { ok: false, error: "Design not found." };
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    const opt = doc.options.find((o) => o.id === optionId);
    if (!opt) {
      out = { ok: false, error: "That option was removed — refresh the page." };
      return;
    }
    const r = applyCustomItemSave(customItemsOf(opt.customItems), raw, () => rid("ci-"));
    if (!r.ok) {
      out = { ok: false, error: r.error };
      return;
    }
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, customItems: r.items } : o));
    p.updatedAt = Date.now();
    out = { ok: true, item: r.item };
  });
  return out;
}

/** Remove one custom item. Idempotent: an id already gone is not an error. */
export async function removeCustomItem(
  projectId: string,
  optionId: string,
  itemId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) =>
      o.id === optionId ? { ...o, customItems: withoutCustomItem(customItemsOf(o.customItems), itemId) } : o
    );
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, error: "Design not found." };
}

```

In `snapshotOf`, replace (line 1214):

```ts
      options: p.options ? p.options.map((o) => ({ ...o })) : undefined,
```

with:

```ts
      // Custom items (#212) ride on the option — copied, not shared.
      options: p.options
        ? p.options.map((o) => ({ ...o, ...(o.customItems ? { customItems: o.customItems.map((c) => ({ ...c })) } : {}) }))
        : undefined,
```

(`restoreRevision` needs no change: it already restores `target.options` wholesale — Finding 1.)

- [ ] **Step 7: Quote — price custom items as allowance lines**

In `src/lib/design/grid-quote.ts`, after line 23 (`import { riserLinksOf } from "@/lib/design/grid-riser-doc";`) add:

```ts
import { customItemBomLines, customItemsCost, customItemsOf } from "@/lib/design/grid-custom-items";
```

Replace lines 82-85:

```ts
  // Typed-length riser connections (#209) price exactly like wire routes.
  const riserLinks = riserLinksOf(project.riser, optionId);
  if (!placements.length && !routes.length && !riserLinks.length)
    return { ok: false, error: "Place a device or route a wire first." };
```

with:

```ts
  // Typed-length riser connections (#209) price exactly like wire routes.
  const riserLinks = riserLinksOf(project.riser, optionId);
  // Per-design custom items (#212) — a design may be nothing but these.
  const customItems = customItemsOf(option.customItems);
  if (!placements.length && !routes.length && !riserLinks.length && !customItems.length)
    return { ok: false, error: "Place a device or route a wire first." };
```

Replace lines 170-177:

```ts
  const lines: BomLine[] = [
    ...devLines,
    ...wires.lines,
    ...curtains,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value = devTotals.value + wires.value + curtainValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost = devTotals.cost + wires.cost + curtainCostTotal + labor.reduce((a, l) => a + l.cost, 0);
```

with:

```ts
  // Custom items (#212) price exactly like an Equipment-map allowance: sell =
  // unit cost ÷ (1 − the customer's tier margin). Always priced, so they never
  // make a design "Incomplete" or refuse the quote.
  const custom = customItemBomLines(customItems, tier.margin);
  const customValue = custom.reduce((a, l) => a + l.ext, 0);
  const customCost = customItemsCost(customItems);

  const lines: BomLine[] = [
    ...devLines,
    ...wires.lines,
    ...curtains,
    ...custom,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value = devTotals.value + wires.value + curtainValue + customValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost = devTotals.cost + wires.cost + curtainCostTotal + customCost + labor.reduce((a, l) => a + l.cost, 0);
```

Replace line 195:

```ts
      ...(allowanceIds.has(l.partId) ? { allowance: true as const } : {}),
```

with:

```ts
      ...(allowanceIds.has(l.partId) || l.allowance ? { allowance: true as const } : {}),
```

- [ ] **Step 8: Server actions**

In `src/app/(app)/design/grid/[id]/actions.ts`, in the `@/lib/stores/grid-projects` import list (lines 7-36) add `removeCustomItem,` after `removeOption,` and `saveCustomItem,` after `saveGridIntake,`. After line 39 (`import { buildGridQuote } from "@/lib/design/grid-quote";`) add:

```ts
import type { GridCustomItemInput } from "@/lib/design/grid-custom-items";
```

Append at the end of the file:

```ts

/* ------------------------------ custom items (#212) ------------------------------ */

/**
 * Add or edit one per-design custom item on an option — "a product that just
 * doesn't have a catalog item" (#212). Same gate as the placement edits; the
 * store re-sanitizes whatever arrives. Revalidates the Designs dashboard too,
 * since its live budget reads this option's quote build.
 */
export async function saveCustomItemAction(
  projectId: string,
  optionId: string,
  input: GridCustomItemInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireUser();
  const r = await saveCustomItem(projectId, optionId, input);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true, id: r.item.id };
}

export async function removeCustomItemAction(
  projectId: string,
  optionId: string,
  itemId: string
): Promise<Result> {
  await requireUser();
  const r = await removeCustomItem(projectId, optionId, String(itemId ?? ""));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}
```

- [ ] **Step 9: Editor page — sell-only custom lines**

In `src/app/(app)/design/grid/[id]/page.tsx`, after line 31 (`import { virtualPartsFor } from "@/lib/design/grid-virtual-parts";`) add:

```ts
import { customItemBomLines, customItemsOf } from "@/lib/design/grid-custom-items";
```

After line 180 (`const curtainCoeffs = sellCoeffs(tier.margin);`) add:

```ts
  // #212: the active option's custom items, sell-priced at this customer's
  // tier margin exactly as buildGridQuote prices them. Sell numbers only —
  // the margin stays on the server (the curtain rule above).
  const customLines = customItemBomLines(
    customItemsOf(project.options?.find((o) => o.id === activeOptionId)?.customItems),
    tier.margin
  );
```

Replace line 236:

```tsx
      linesetDesigns={linesetDesigns.map((d) => ({ id: d.id, name: d.name }))}
```

with:

```tsx
      linesetDesigns={linesetDesigns.map((d) => ({ id: d.id, name: d.name }))}
      customLines={customLines}
```

- [ ] **Step 10: Create the client BOM section `src/app/(app)/design/grid/[id]/custom-items.tsx`**

```tsx
"use client";

import { useState, type ChangeEvent, type CSSProperties } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import type { BomLine } from "@/lib/design/grid-bom";
import {
  CUSTOM_ITEM_DESC_MAX,
  CUSTOM_ITEM_MAKER_MAX,
  customItemDesc,
  customItemPartId,
  type GridCustomItem,
} from "@/lib/design/grid-custom-items";
import { removeCustomItemAction, saveCustomItemAction } from "./actions";

/**
 * "+ Custom item" in the Grid BOM (#212): a product with no catalog row,
 * priced as an allowance on THIS option only. The priced lines (sell) come
 * from the server; the form posts cost, which the server re-sanitizes.
 */

const BTN: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const INPUT: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const LINK_BTN: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  fontSize: 10.5,
  color: "var(--accent)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const CHIP: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  color: "#8a6d1f",
  background: "#fbf3dd",
  borderRadius: 999,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

type Draft = { id: string | null; desc: string; mfr: string; model: string; qty: string; unitCost: string };
const EMPTY: Draft = { id: null, desc: "", mfr: "", model: "", qty: "1", unitCost: "" };

export default function CustomItemsSection({
  projectId,
  optionId,
  items,
  lines,
  onChanged,
}: {
  projectId: string;
  optionId: string;
  /** This option's items (for the edit form). */
  items: GridCustomItem[];
  /** The same items priced server-side (sell only), keyed by partId custom:<id>. */
  lines: BomLine[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lineOf = new Map(lines.map((l) => [l.partId, l]));

  const edit = (it: GridCustomItem) => {
    setError(null);
    setDraft({ id: it.id, desc: it.desc, mfr: it.mfr ?? "", model: it.model ?? "", qty: String(it.qty), unitCost: String(it.unitCost) });
  };
  const field = (k: Exclude<keyof Draft, "id">) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const r = await saveCustomItemAction(projectId, optionId, {
      ...(draft.id ? { id: draft.id } : {}),
      desc: draft.desc,
      mfr: draft.mfr,
      model: draft.model,
      qty: Number(draft.qty),
      unitCost: Number(draft.unitCost),
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDraft(null);
    onChanged();
  };

  return (
    <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
      {items.map((it) => {
        const l = lineOf.get(customItemPartId(it.id));
        return (
          <div key={it.id} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
            <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{it.qty}×</strong>
            <span
              style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={customItemDesc(it)}
            >
              {customItemDesc(it)}
            </span>
            <span style={CHIP}>Allowance · custom</span>
            <button type="button" style={LINK_BTN} onClick={() => edit(it)}>
              edit
            </button>
            <ConfirmButton
              label="remove"
              confirmLabel="Remove?"
              pendingLabel="Removing…"
              className=""
              style={LINK_BTN}
              onConfirm={async () => {
                const r = await removeCustomItemAction(projectId, optionId, it.id);
                if (!r.ok) setError(r.error);
                else onChanged();
              }}
            />
            <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l ? l.ext : 0)}</span>
          </div>
        );
      })}
      {draft ? (
        <div style={{ border: "1px solid #eef0f3", borderRadius: 8, padding: 8, display: "grid", gap: 6, marginTop: 2 }}>
          <input
            value={draft.desc}
            onChange={field("desc")}
            maxLength={CUSTOM_ITEM_DESC_MAX}
            placeholder="Description (prints on the quote)"
            style={INPUT}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <input value={draft.mfr} onChange={field("mfr")} maxLength={CUSTOM_ITEM_MAKER_MAX} placeholder="Manufacturer" style={INPUT} />
            <input value={draft.model} onChange={field("model")} maxLength={CUSTOM_ITEM_MAKER_MAX} placeholder="Model" style={INPUT} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={draft.qty} onChange={field("qty")} inputMode="numeric" placeholder="Qty" style={{ ...INPUT, width: 64, flex: "none" }} />
            <input value={draft.unitCost} onChange={field("unitCost")} inputMode="decimal" placeholder="Unit cost, $" style={INPUT} />
          </div>
          <div style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.4 }}>
            Priced like an allowance: unit cost ÷ (1 − this customer&apos;s tier margin). Not placed on the plan, never added to the catalog.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }}
            >
              {saving ? "Saving…" : draft.id ? "Save item" : "Add item"}
            </button>
            <button
              type="button"
              style={BTN}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={{ ...BTN, justifySelf: "start", fontSize: 11.5, padding: "3px 9px" }}
          onClick={() => {
            setError(null);
            setDraft({ ...EMPTY });
          }}
        >
          + Custom item
        </button>
      )}
      {error && <div style={{ fontSize: 11, color: "#a0442b" }}>{error}</div>}
    </div>
  );
}
```

- [ ] **Step 11: Mount it in the editor**

In `src/app/(app)/design/grid/[id]/editor.tsx`:

Replace line 33:

```ts
  type PartLite,
```

with:

```ts
  type PartLite,
  type BomLine,
```

After line 89 (`import SymbolLookPanel from "./symbol-look-panel";`) add:

```ts
import CustomItemsSection from "./custom-items";
import { customItemsOf } from "@/lib/design/grid-custom-items";
```

Replace line 255 (`  wireTypes,` in the destructure, followed by `}: {`):

```ts
  wireTypes,
}: {
```

with:

```ts
  wireTypes,
  customLines,
}: {
```

Replace lines 289-290:

```ts
  wireTypes: WireType[];
}) {
```

with:

```ts
  wireTypes: WireType[];
  /** #212: the active option's custom items, priced server-side (sell only). */
  customLines: BomLine[];
}) {
```

Replace line 670:

```ts
  const grandValue = totals.value + wires.value + laborValue + curtainValue;
```

with:

```ts
  // #212: per-design custom items — edited from the BOM, priced like allowances.
  const customItems = useMemo(() => customItemsOf(activeOption.customItems), [activeOption.customItems]);
  const customValue = customLines.reduce((a, l) => a + l.ext, 0);
  const bomEmpty = lines.length === 0 && wires.lines.length === 0 && curtains.length === 0 && customLines.length === 0;
  const customSection = (
    <CustomItemsSection
      key={activeOptionId}
      projectId={project.id}
      optionId={activeOptionId}
      items={customItems}
      lines={customLines}
      onChanged={() => router.refresh()}
    />
  );
  const grandValue = totals.value + wires.value + laborValue + curtainValue + customValue;
```

Replace lines 1802-1807:

```tsx
            {lines.length === 0 && wires.lines.length === 0 && curtains.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "#8c919c" }}>
                Paint devices onto the plan to build the BOM.
              </div>
            ) : (
```

with:

```tsx
            {bomEmpty ? (
              <>
                <div style={{ fontSize: 11.5, color: "#8c919c" }}>
                  Paint devices onto the plan to build the BOM.
                </div>
                {customSection}
              </>
            ) : (
```

Replace line 1893:

```tsx
                {laborRows.length > 0 && (
```

with:

```tsx
                {customSection}
                {laborRows.length > 0 && (
```

Replace line 1955:

```tsx
              disabled={busy || (lines.length === 0 && wires.lines.length === 0 && curtains.length === 0)}
```

with:

```tsx
              disabled={busy || bomEmpty}
```

- [ ] **Step 12: Run the gates**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit`
Expected: no output, exit 0.

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > "${TMPDIR:-/tmp}/specs-212b.log" 2>&1; echo "exit $?"; grep -c '^PASS' "${TMPDIR:-/tmp}/specs-212b.log"; grep -E '^FAIL|ALL PASSED|FAILED' "${TMPDIR:-/tmp}/specs-212b.log"`
Expected: `exit 0`, PASS count = Task B's count + 41 (29 sync + 12 async; report the real number), `ALL PASSED`, no `FAIL`.

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/design/grid-custom-items.ts src/lib/design/grid-options.ts src/lib/design/grid-bom.ts src/lib/stores/grid-projects.ts src/lib/design/grid-quote.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/custom-items.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" scripts/test-review-and-spec.ts`
Expected: 0 errors.

Run (client-bundle gate — a new client component with value imports; `next build` is the only check that catches a store leaking into it; skipping `scripts/migrate.mjs` on purpose, and `src/db/index.ts` gives build workers a throwaway datadir): `export PATH=$HOME/.local/node/bin:$PATH && npx next build 2>&1 | tail -15`
Expected: `✓ Compiled successfully` and the route table; no `Module not found` / `postgres` / `node:` errors mentioning `custom-items.tsx` or `editor.tsx`. Before running, `ps aux | grep -E "next dev|tsx" | grep -v grep` must show nothing from this worktree.

- [ ] **Step 13: Commit**

```bash
git add src/lib/design/grid-custom-items.ts src/lib/design/grid-options.ts src/lib/design/grid-bom.ts src/lib/stores/grid-projects.ts src/lib/design/grid-quote.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/custom-items.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): per-design custom items, priced as allowances (#212)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Out of scope / hand-off notes for the controller

- **No customer document prints Grid `spec.lines`** (Finding 2). The description and custom-item text reach `quote.spec.lines[].desc` and the Grid editor BOM; the Estimator (`src/app/(app)/estimator/page.tsx:144-148`) and `preview-doc.tsx` read only `spec.sections`. Making them print on a customer document means giving Grid quotes a renderer (or converting `spec.lines` into estimator sections) — a separate punch item.
- **Quick Design** labels an allowance line with the equation row's name (`src/app/(app)/design/quick/quick-design-client.tsx:513`, fed by `priceCell`'s `desc: def.label` at `equipment-map.ts:206`). The spec scopes the description to the Grid virtual part, so Quick Design is unchanged; say so in the DECISIONS entry.
- Decisions to log (D333+): description edits don't re-stamp confirmation; custom items stored on `GridOption`; fresh ids on option copy; `system` accepted but not in the form; custom-only option can quote; editor gets sell-only server-priced lines.
- Browser check on a scratch datadir (spec "Testing & gates"): open a Grid design, add/edit/remove a custom item, switch options, duplicate an option, save + restore a revision, create the draft quote; set a description on an allowance row in Grid Settings → Equipment map and re-fill an Auto scope to see it on the BOM line.
