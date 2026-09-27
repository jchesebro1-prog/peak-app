# Grid Relabels, "Not included", Hardware Assemblies (#233, #229, #228) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **#233:** Eleven Equipment-map rows get Jeff's new names. The names live in one place. Output station moves to Lighting as "Cable Package". Saved Quick Design qty overrides and stored Equipment-map entries keep working.
- **#229:** Any Equipment-map tier can be set to "Not included". It counts as resolved, prices $0, places nothing and quotes nothing.
- **#228:** Assemblies gain a third kind, **Hardware**, so a rigging row like Batten Termination can map to a "Chain Wrap" hardware assembly.

**Architecture:**
- **One label source.** `src/lib/design/equipment-vocab.ts` is the only place labels live. `compute()` in `quick/engine.ts` reads each item's label and unit by key (`eq(key, qty)`).
- **Read-time aliases.** Two alias maps in the vocabulary are applied only when stored data is read. Nothing is rewritten in the database, and the next save writes the new names/keys.
  - `EQUIPMENT_LABEL_ALIASES` is used by `cleanQtyOverrides`, which is already the one read path for Quick Design overrides on the screen and the server (D324).
  - `EQUIPMENT_KEY_ALIASES` is used by `sanitizeEquipmentMap`.
- **"Not included" as a cell kind.** It is a new `EquipCell` kind and a new `PricedStatus`, `"none"`. It flows through the one pricing step (`equipment-pricing.ts`, D304) as a $0 line with no product. Every "needs-part" count ignores it.
- **Hardware as a kind.** It is a new `FixtureKind`, shaped like a System (one parts list, no light engine) but with no scope of its own. Its virtual `asm:` part draws on the Grid layer of the Equipment-map row it is mapped on, and defaults to Rigging.

**Tech Stack:** Next.js 16 App Router, TypeScript, the `scripts/test-review-and-spec.ts` assertion harness (`npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-09-26-grid-packages-labor-wire-design.md`, sections **#233, #229, #228** only. #230, #231 and #232 are a separate plan and are out of scope here.

## Global Constraints

- **Where to work.** Only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Every shell starts with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks`.
- **Things you must not run or touch.** No dev server. No `db:*` script. Never open `.data/pglite`. `npm run test:specs` uses its own `mktemp -d` datadir and is safe.
- **Stable keys (D301).**
  - Every key stays the same except the one move `controls:outputStation` → `lighting:cablePackage`.
  - The vocabulary stays at 46 rows (controls 9 → 8, lighting 5 → 6).
- **No dollars in the vocabulary.** The #211 T1 guard rejects `$<digit>` and the word "cost" anywhere in `equipment-vocab.ts`, comments included.
- **Pricing (D303/D304).** The engine carries no dollars. `equipment-pricing.ts` is the only pricing step.
- **Imports.**
  - `equipment-vocab.ts` may import **only types** from `quick/engine.ts`. The engine now imports values from the vocabulary, so a value import back would create a runtime cycle.
  - Client components (`"use client"`) never import a value from `@/lib/stores/*`, `@/db/*`, `@/lib/design/equipment-map`, `@/lib/design/auto-estimate` or `@/lib/design/equipment-pricing`. Existing #211 guards check this. Only `next build` catches a client→store import, so every task runs it.
- **Harness conventions.**
  - Assertions are labelled `#233 …`, `#229 …`, `#228 …`.
  - New imports use `r233`/`R233`, `n229`/`N229`, `h228`/`H228` aliases.
  - New synchronous `{ … }` blocks are appended at the **end** of `scripts/test-review-and-spec.ts`. The #212 blocks there prove that top-level EOF blocks run and count.
  - `ok` (line 337), `readFileSync` (242) and `join` (243) already exist. Reuse them.
  - Another plan (#230–#232) also appends at EOF. On a merge conflict, keep both blocks.
- **Gates at the end of every task.** Report real numbers.
  - `npx tsc --noEmit` → 0 errors.
  - `npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"` → no FAIL lines. The PASS count must equal the previous task's count plus that task's new assertions.
  - `npx eslint <changed files>` → 0 errors.
  - `npx next build` → exit 0. First run `lsof -i :3000` and make sure no dev server from this worktree is running.
- **Commits.**
  - Message: `feat(grid): … (#233)` (or `(#229)` / `(#228)`), then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - `git add` only the files the task names. If a file you must commit already has another session's uncommitted changes, stop and report rather than committing them.
  - If git reports `index.lock`, wait a few seconds and retry.
- **Docs.** Do not edit DECISIONS.md, PUNCHLIST.md or AGENTS.md.
- **Baseline.** Before Task 1, record the baseline PASS count with the gate command above.

## Spec ambiguities resolved (read before starting)

1. **Cable Package gate.**
   - Keeps Output station's formula (`pick(2⌊D/7⌋, 2⌊D/4⌋, 2⌊D/3⌋)`) **and its gate**: Controls in scope and Data picked. It is pushed onto the Lighting item list after the dimmer-rack count, so rack counts don't move.
   - Result: Quick Design totals are unchanged whenever Lighting is on. When Lighting is off it drops out, because it is a Fixtures item now.
   - It never appears on Grid Auto cards, because `intakeScopeInputs` never turns Controls on. Existing Auto designs therefore gain no new needs-a-part line.
   - `place: "lot"`, so a future gate change lands it as one lot marker.
2. **One source.** `compute()` takes label **and unit** from the vocabulary. All 46 units already match, so no quantity or unit changes.
3. **Alias precedence.**
   - Qty overrides: if a config holds both the old and the new label, the new label's value wins.
   - Equipment map: the old `controls:outputStation` entry is read only while the blob has **no** `lighting:cablePackage` key at all. Once the new row is saved, or cleared (stored as `null`), the old entry is ignored. The store needs no change.
   - The legacy "was" hint moves to the new key.
4. **"Not included" status.**
   - A row whose tiers are all parts, assemblies or "Not included" reads **Mapped**. No new summary chip.
   - Curtain rows may be "Not included" too.
   - Internally `priceCell` returns `{ status: "none", ref: rowKey, desc: "Not included", unitCost: 0, unitSell: 0 }`.
   - The priced BOM line carries **no** `ref`/`refDesc`.
5. **Where "Not included" shows.** Quick Design's BOM unit price column reads "Not included". An Auto card's detail line reads "Not included in this tier", with "—" for its unit price and total. Quick Design quotes carry no lines, and Grid never places a "none" line, so no quote line exists to suppress.
6. **Hardware shape.**
   - Label + at least one part (the System parts list). **No scope**: one is never stored even if posted.
   - No light engine, no accessory graph (`fixturePairs` already returns `[]` for non-fixtures).
   - Excluded from the Estimator / Quick Design fixture pickers (`fixtureAssembliesFrom` already filters `kind === "fixture"`).
   - A saved assembly's kind stays immutable, as for fixture/system.
7. **Hardware scope on the plan.**
   - `asm:<id>` resolves its layer from the first Equipment-map row (vocabulary order, any tier) whose cell is that assembly. That row's system gives the layer: Rigging → Rigging, Curtains → Curtains, Controls/Acoustical/Pit → Unscoped.
   - An unmapped hardware assembly (swapped in on an Auto card) → Rigging.
   - Swap candidates: hardware is offered on **Rigging** rows only.
   - The Equipment-map picker does not restrict by row, as today.

---

## Task 1: #233 relabels, one label source, read-time aliases

**Files:**
- Modify: `src/lib/design/equipment-vocab.ts` (header comment, rows 61–63 / 78–85, new row after 75, alias exports)
- Modify: `src/app/(app)/design/quick/engine.ts` (import after line 14; `eq` 484–485; every `eq(` call 493–623; `addDrape` 534–544; `addFix` 555–562; controls block 582–586; `cleanQtyOverrides` 853–872)
- Modify: `src/lib/design/equipment-map.ts` (import line 24; `sanitizeEquipmentMap` 88–108)
- Modify: `src/lib/design/equipment-legacy-hints.ts` (line 70 key move)
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces (new exports):**
- `EQUIPMENT_KEY_ALIASES: ReadonlyMap<string, string>` (old row key → new row key), in `equipment-vocab.ts`
- `EQUIPMENT_LABEL_ALIASES: ReadonlyMap<string, string>` (old `"system:label"` → new `"system:label"`), in `equipment-vocab.ts`
- The engine's internal `eq(key: string, qty: number)`. It is not exported.

- [ ] **Step 1: Write the failing harness block.** Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* --- #233: relabels — one label source (the vocabulary); old Quick Design overrides and the moved Equipment-map key still resolve --- */
import {
  EQUIPMENT_ROWS as r233Rows, EQUIPMENT_ROW_BY_KEY as r233ByKey,
  EQUIPMENT_KEY_ALIASES as r233KeyAliases, EQUIPMENT_LABEL_ALIASES as r233LabelAliases,
} from "@/lib/design/equipment-vocab";
import {
  compute as r233Compute, defaultAState as r233Default, cleanQtyOverrides as r233Clean, hydrateAState as r233Hydrate,
  type AState as R233AState,
} from "@/app/(app)/design/quick/engine";
import { sanitizeEquipmentMap as r233Sanitize } from "@/lib/design/equipment-map";
import { LEGACY_HINTS as r233Hints } from "@/lib/design/equipment-legacy-hints";
{
  const L = (k: string) => r233ByKey.get(k)?.label;
  const expected: Array<[string, string]> = [
    ["rigging:aircraftCable", "Suspension Method"],
    ["rigging:chainWrap", "Batten Termination"],
    ["rigging:terminationKit", "Beginning Termination"],
    ["controls:consoleTouch", "Console Accessories"],
    ["controls:batteryBackup", "Emergency"],
    ["controls:processor", "Power Controls – Production"],
    ["controls:button", "Power Controls – Architectural"],
    ["controls:archTouch", "Architectural Controls"],
    ["controls:inputStation", "DMX Distribution"],
    ["lighting:cablePackage", "Cable Package"],
    ["controls:distro", "Labor"],
  ];
  const wrong = expected.filter(([k, l]) => L(k) !== l).map(([k]) => `${k}=${L(k)}`);
  ok(wrong.length === 0, `#233: the eleven relabels (wrong: ${wrong.join(", ") || "none"})`);
  ok(!r233ByKey.has("controls:outputStation") && r233ByKey.get("lighting:cablePackage")?.system === "lighting" && r233ByKey.get("lighting:cablePackage")?.place === "lot" && r233Rows.length === 46,
    "#233: Output station moved to Lighting as Cable Package (a lot row) — still 46 rows");

  // One source: compute() reads name AND unit from the vocabulary.
  const base = r233Default(0);
  const s: R233AState = {
    ...base, venue: "pac", size: "medium", width: 60, depth: 40, grid: 50,
    sys: { ...base.sys, lighting: true, controls: true }, ctrl: { console: true, architectural: true, data: true },
  };
  const C = r233Compute(s);
  const light = C.systems.find((x) => x.key === "lighting")!;
  const ctrl = C.systems.find((x) => x.key === "controls")!;
  const cable = light.items.find((i) => i.key === "lighting:cablePackage");
  ok(cable?.qty === 20 && cable.desc === "Cable Package" && cable.unit === "ea" && !ctrl.items.some((i) => i.key === "controls:outputStation"),
    "#233: Cable Package keeps Output station's formula (2 × ⌊40/4⌋ = 20 at medium), now on the Lighting system");
  const noCtrl = r233Compute({ ...s, sys: { ...s.sys, controls: false } });
  ok(!noCtrl.systems.find((x) => x.key === "lighting")!.items.some((i) => i.key === "lighting:cablePackage"),
    "#233: …and keeps its gate (Controls in scope, Data picked), so no existing Quick Design total moves");
  const everyItem = C.systems.flatMap((x) => x.items);
  ok(everyItem.every((i) => r233ByKey.get(i.key)?.label === i.desc && r233ByKey.get(i.key)?.unit === i.unit),
    "#233: every emitted item's name and unit are the vocabulary's");
  const engSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/quick/engine.ts"), "utf8");
  ok(engSrc.includes('from "@/lib/design/equipment-vocab"') && !/\beq\(\s*"[a-z]+:[a-zA-Z]+",\s*"/.test(engSrc) &&
      !/addFix\("[a-z]+", fx\.[a-z]+, "/.test(engSrc) && !/addDrape\([^)]*"curtains:[a-z]+", "/.test(engSrc),
    "#233: compute() carries no item-name literals — one source");
  const vocabSrc = readFileSync(join(process.cwd(), "src/lib/design/equipment-vocab.ts"), "utf8");
  ok(!/^import\s+(?!type\b)[^;]*from\s+"@\/app\/\(app\)\/design\/quick\/engine"/m.test(vocabSrc),
    "#233: the vocabulary imports only types from the engine (no runtime cycle)");

  // Quick Design qty overrides keyed by the OLD label read under the new one.
  const cleaned = r233Clean({ better: { rigging: { "Aircraft cable": 900, Pipe: 12 }, controls: { "Output station": 7, "Distro system": 1, Console: 2 } } }, true);
  ok(cleaned.better?.rigging?.["Suspension Method"] === 900 && cleaned.better?.rigging?.Pipe === 12 && !("Aircraft cable" in (cleaned.better?.rigging || {})),
    "#233: an override saved under an old label reads under the new label");
  ok(cleaned.better?.lighting?.["Cable Package"] === 7 && !("Output station" in (cleaned.better?.controls || {})) && cleaned.better?.controls?.Labor === 1 && cleaned.better?.controls?.Console === 2,
    "#233: the Output station override lands on Lighting · Cable Package; unrenamed rows are untouched");
  const both = r233Clean({ good: { rigging: { "Aircraft cable": 5, "Suspension Method": 8 } } }, true);
  ok(both.good?.rigging?.["Suspension Method"] === 8 && Object.keys(both.good?.rigging || {}).length === 1,
    "#233: when both labels were saved, the new label's value wins");
  const hyd = r233Hydrate({ config: { ...r233Default(0), qtyOverrides: { best: { rigging: { "Chain wrap, 3 ft": 3 } } }, overrideUnits: { "curtains:Scenery track": "ft" } } }, 0);
  ok(hyd.qtyOverrides.best?.rigging?.["Batten Termination"] === 3,
    "#233: a saved design hydrates its old overrides under the new labels (screen and server share this read)");
  const aliasTargetsLive = [...(r233LabelAliases?.values() ?? [])].every((to) => {
    const i = to.indexOf(":");
    return r233Rows.some((r) => r.system === to.slice(0, i) && r.label === to.slice(i + 1));
  });
  ok(r233LabelAliases?.size === 11 && aliasTargetsLive, "#233: eleven label aliases, each pointing at a live row");

  // Equipment map: the moved key reads as the new key until the new key is written.
  const cell = { kind: "part", sku: "CAB-1" };
  const oldOnly = r233Sanitize({ "controls:outputStation": { tiers: { good: cell }, updatedBy: "J", updatedAt: 1 } });
  const oc = oldOnly["lighting:cablePackage"]?.tiers.good;
  ok(oc?.kind === "part" && oc.sku === "CAB-1" && !("controls:outputStation" in oldOnly),
    "#233: a stored controls:outputStation row reads as lighting:cablePackage");
  const newWins = r233Sanitize({ "controls:outputStation": { tiers: { good: cell } }, "lighting:cablePackage": { tiers: { good: { kind: "part", sku: "CAB-2" } } } });
  const nc = newWins["lighting:cablePackage"]?.tiers.good;
  ok(nc?.kind === "part" && nc.sku === "CAB-2", "#233: once the new key is saved it wins over the old one");
  const cleared = r233Sanitize({ "controls:outputStation": { tiers: { good: cell } }, "lighting:cablePackage": null });
  ok(!("lighting:cablePackage" in cleared), "#233: clearing the new row is not undone by the old key");
  ok(r233KeyAliases?.get("controls:outputStation") === "lighting:cablePackage" && r233KeyAliases?.size === 1, "#233: exactly one key moved");
  ok(r233Hints["lighting:cablePackage"] !== undefined && !("controls:outputStation" in r233Hints), "#233: the 'was' hint moved with the row");
}
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep '^FAIL ' "$TMPDIR/specs.log"`
Expected: FAIL lines tagged `#233` (relabels, move, one source, aliases). Every pre-existing assertion still PASSes.

- [ ] **Step 3: Update the vocabulary.** In `src/lib/design/equipment-vocab.ts`:

(a) Replace the header comment lines 5–7:

```ts
 * on these, so a relabel never orphans a mapping. `label` is the equation's
 * own item name (asserted equal by the #211 T1 spec block). Pure and
 * dollar-free: client components may import it.
```

with:

```ts
 * on these, so a relabel never orphans a mapping. `label` (and `unit`) is the
 * ONE source of an item's name: compute() reads it by key (#233), so Quick
 * Design, Auto cards and the Equipment map can never disagree. Pure and
 * dollar-free: client components may import it. It imports only TYPES from
 * the engine — the engine imports values from here.
```

(b) Replace rows 61–63:

```ts
  row("rigging", "aircraftCable", "Aircraft cable", "ft", "lot", ["aircraft cable", "wire rope"]),
  row("rigging", "chainWrap", "Chain wrap, 3 ft", "ea", "lot", ["chain"]),
  row("rigging", "terminationKit", "Termination kit", "ea", "lot", ["termination", "swage", "thimble"]),
```

with:

```ts
  row("rigging", "aircraftCable", "Suspension Method", "ft", "lot", ["aircraft cable", "wire rope"]),
  row("rigging", "chainWrap", "Batten Termination", "ea", "lot", ["chain"]),
  row("rigging", "terminationKit", "Beginning Termination", "ea", "lot", ["termination", "swage", "thimble"]),
```

(c) Replace line 75:

```ts
  row("lighting", "automated", "Automated", "ea", "each", ["moving", "automated"]),
```

with:

```ts
  row("lighting", "automated", "Automated", "ea", "each", ["moving", "automated"]),
  // #233: was controls:outputStation ("Output station") — same equation, now a Fixtures item.
  row("lighting", "cablePackage", "Cable Package", "ea", "lot", ["cable", "jumper", "extension"]),
```

(d) Replace lines 78–85:

```ts
  row("controls", "consoleTouch", "Console touch screen", "ea", "none", ["touch", "monitor"]),
  row("controls", "batteryBackup", "Battery backup", "ea", "none", ["ups", "battery"]),
  row("controls", "processor", "Processor", "ea", "none", ["processor", "architectural"]),
  row("controls", "button", "Button", "ea", "none", ["button", "station"]),
  row("controls", "archTouch", "Architectural touch screen", "ea", "none", ["touch"]),
  row("controls", "inputStation", "Input station", "ea", "none", ["input", "node"]),
  row("controls", "outputStation", "Output station", "ea", "none", ["output", "node"]),
  row("controls", "distro", "Distro system", "ea", "none", ["distro", "switch", "gateway"]),
```

with:

```ts
  row("controls", "consoleTouch", "Console Accessories", "ea", "none", ["touch", "monitor"]),
  row("controls", "batteryBackup", "Emergency", "ea", "none", ["ups", "battery"]),
  row("controls", "processor", "Power Controls – Production", "ea", "none", ["processor", "architectural"]),
  row("controls", "button", "Power Controls – Architectural", "ea", "none", ["button", "station"]),
  row("controls", "archTouch", "Architectural Controls", "ea", "none", ["touch"]),
  row("controls", "inputStation", "DMX Distribution", "ea", "none", ["input", "node"]),
  row("controls", "distro", "Labor", "ea", "none", ["distro", "switch", "gateway"]),
```

(e) Append after the `EQUIP_SYSTEM_LABEL` object (end of file):

```ts

/**
 * #233 — a moved row's OLD key → its new key. Read-time only
 * (sanitizeEquipmentMap): an Equipment map entry stored under the old key
 * reads as the new row until the blob holds the new key at all (saved, or
 * cleared as null) — then the old entry is ignored. Nothing is rewritten.
 */
export const EQUIPMENT_KEY_ALIASES: ReadonlyMap<string, string> = new Map([["controls:outputStation", "lighting:cablePackage"]]);

/**
 * #233 — Quick Design qty overrides are keyed system → item NAME (D324), so a
 * relabel would orphan them. Old "system:label" → new "system:label", applied
 * where a saved config is read (cleanQtyOverrides, quick/engine.ts), which is
 * the screen's and the server's one read path. The next save writes the new
 * names; no stored record is rewritten.
 */
export const EQUIPMENT_LABEL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["rigging:Aircraft cable", "rigging:Suspension Method"],
  ["rigging:Chain wrap, 3 ft", "rigging:Batten Termination"],
  ["rigging:Termination kit", "rigging:Beginning Termination"],
  ["controls:Console touch screen", "controls:Console Accessories"],
  ["controls:Battery backup", "controls:Emergency"],
  ["controls:Processor", "controls:Power Controls – Production"],
  ["controls:Button", "controls:Power Controls – Architectural"],
  ["controls:Architectural touch screen", "controls:Architectural Controls"],
  ["controls:Input station", "controls:DMX Distribution"],
  ["controls:Output station", "lighting:Cable Package"],
  ["controls:Distro system", "controls:Labor"],
]);
```

- [ ] **Step 4: Make the engine read labels from the vocabulary.** In `src/app/(app)/design/quick/engine.ts`:

(a) After line 14 (`import { battenLenFt, venueDimsFromEstimator } from "@/lib/design/venue-dims";`) add:

```ts
import { EQUIPMENT_LABEL_ALIASES, EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
```

(b) Replace lines 484–485:

```ts
  type Eq = { key: string; desc: string; unit: string; qty: number; drape?: DrapeGeom };
  const eq = (key: string, desc: string, unit: string, qty: number): Eq => ({ key, desc, unit, qty });
```

with:

```ts
  type Eq = { key: string; desc: string; unit: string; qty: number; drape?: DrapeGeom };
  /** #233: an item's name and unit come from the vocabulary by key — ONE
   *  source for Quick Design, Auto cards, the Equipment map and the qty-
   *  override keys (D324). A key missing from the vocabulary is a bug the
   *  #211 T1 spec block catches; it falls back to the key itself. */
  const eq = (key: string, qty: number): Eq => {
    const def = EQUIPMENT_ROW_BY_KEY.get(key);
    return { key, desc: def ? def.label : key, unit: def ? def.unit : "ea", qty };
  };
```

(c) Rewrite all 41 literal-key call sites (`eq("sys:key", "Desc", "unit", qty)` → `eq("sys:key", qty)`):

```bash
perl -pi -e 's/\beq\(("[a-z]+:[a-zA-Z]+"), "[^"]*", "[a-z]+", /eq($1, /g' "src/app/(app)/design/quick/engine.ts"
grep -c 'eq("[a-z]*:[a-zA-Z]*", "' "src/app/(app)/design/quick/engine.ts"   # expect 0
grep -c 'eq("[a-z]*:[a-zA-Z]*", ' "src/app/(app)/design/quick/engine.ts"    # expect 41
```

(d) Replace the curtain helper and its four calls:

```ts
  const addDrape = (on: boolean | undefined, key: string, desc: string, count: number, fabricKey: string) => {
    if (!on || count <= 0) return;
    const type = CURTAIN_KEY_TO_TYPE[fabricKey];
    const rule = type ? drapeRule(type, gdims, "better") : null; // geometry is tier-independent
    if (!rule) return;
    curtainItems.push({ key, desc, unit: "ea", qty: count, drape: { w: rule.w, h: rule.h, fullness: rule.fullness, qty: rule.qty } });
  };
  addDrape(drape.draw, "curtains:draw", "Draw", dBlk * 1, "draw");
  addDrape(drape.legs, "curtains:legs", "Leg", dBlk * 2, "legs");
  addDrape(drape.border, "curtains:border", "Border", dBlk * 1, "border");
  addDrape(drape.fullstage, "curtains:fullstage", "Full stage", dBlk * 1, "fullstage");
```

with:

```ts
  const addDrape = (on: boolean | undefined, key: string, count: number, fabricKey: string) => {
    if (!on || count <= 0) return;
    const type = CURTAIN_KEY_TO_TYPE[fabricKey];
    const rule = type ? drapeRule(type, gdims, "better") : null; // geometry is tier-independent
    if (!rule) return;
    curtainItems.push({ ...eq(key, count), drape: { w: rule.w, h: rule.h, fullness: rule.fullness, qty: rule.qty } });
  };
  addDrape(drape.draw, "curtains:draw", dBlk * 1, "draw");
  addDrape(drape.legs, "curtains:legs", dBlk * 2, "legs");
  addDrape(drape.border, "curtains:border", dBlk * 1, "border");
  addDrape(drape.fullstage, "curtains:fullstage", dBlk * 1, "fullstage");
```

(e) Replace the fixture helper and its calls:

```ts
  const addFix = (key: string, on: boolean | undefined, desc: string, qty: number) => {
    if (on && qty > 0) lightItems.push(eq(`lighting:${key}`, desc, "ea", qty));
  };
  addFix("par", fx.par, "Par", Math.round(E * wUnit * pick(0.7, 1, 1.2)));
  addFix("front", fx.front, "Front", Math.round(wUnit * pick(2, 2.5, 3)));
  addFix("cyc", fx.cyc, "Cyc", Math.round(wUnit * pick(1, 1.25, 1.5)));
  addFix("side", fx.side, "Side light", Math.round(E * wUnit * pick(0, 0.5, 0.75)));
  const automatedQty = Math.round(E * wUnit * pick(0, 0.5, 0.9));
  addFix("automated", fx.automated, "Automated", automatedQty);
```

with:

```ts
  const addFix = (key: string, on: boolean | undefined, qty: number) => {
    if (on && qty > 0) lightItems.push(eq(`lighting:${key}`, qty));
  };
  addFix("par", fx.par, Math.round(E * wUnit * pick(0.7, 1, 1.2)));
  addFix("front", fx.front, Math.round(wUnit * pick(2, 2.5, 3)));
  addFix("cyc", fx.cyc, Math.round(wUnit * pick(1, 1.25, 1.5)));
  addFix("side", fx.side, Math.round(E * wUnit * pick(0, 0.5, 0.75)));
  const automatedQty = Math.round(E * wUnit * pick(0, 0.5, 0.9));
  addFix("automated", fx.automated, automatedQty);
```

(f) Replace the Data group after the perl pass:

```ts
  if (ctrl.data) {
    ctrlItems.push(eq("controls:inputStation", pick(1, 2, 4)));
    ctrlItems.push(eq("controls:outputStation", pick(2 * fl(D / 7), 2 * fl(D / 4), 2 * fl(D / 3))));
    ctrlItems.push(eq("controls:distro", 1));
  }
```

with:

```ts
  if (ctrl.data) {
    ctrlItems.push(eq("controls:inputStation", pick(1, 2, 4)));
    ctrlItems.push(eq("controls:distro", 1));
  }
  // #233: Output station moved to Lighting as the Cable Package — its own
  // formula AND its own gate (Controls in scope, Data picked), pushed after
  // the dimmer-rack count above, so racks and every existing Quick Design
  // total with Lighting on are unchanged. Grid Auto never turns Controls on,
  // so no Auto card gains a line.
  if (s.sys.controls && ctrl.data) lightItems.push(eq("lighting:cablePackage", pick(2 * fl(D / 7), 2 * fl(D / 4), 2 * fl(D / 3))));
```

(g) Replace the whole `cleanQtyOverrides` function (lines 853–872, from `export function cleanQtyOverrides(` through its closing `}`) with the version below. Keep the JSDoc above it and append this sentence to that JSDoc: `An override saved under a pre-#233 label reads under its new label (EQUIPMENT_LABEL_ALIASES); when both were saved, the new label's value wins.`

```ts
export function cleanQtyOverrides(raw: unknown, feet: boolean): AState["qtyOverrides"] {
  const out: AState["qtyOverrides"] = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  for (const [tier, bySys] of Object.entries(raw as Record<string, unknown>)) {
    if (!bySys || typeof bySys !== "object" || Array.isArray(bySys)) continue;
    const sysOut: Record<string, Record<string, number>> = {};
    const aliased: Array<[string, string, number]> = [];
    for (const [sysKey, byDesc] of Object.entries(bySys as Record<string, unknown>)) {
      if (!byDesc || typeof byDesc !== "object" || Array.isArray(byDesc)) continue;
      const descOut: Record<string, number> = has(sysOut, sysKey) ? sysOut[sysKey] : (sysOut[sysKey] = {});
      for (const [desc, v] of Object.entries(byDesc as Record<string, unknown>)) {
        if (!feet && `${sysKey}:${desc}` === SCENERY_TRACK_OVERRIDE) continue;
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const qty = Math.max(0, Math.trunc(v));
        const to = EQUIPMENT_LABEL_ALIASES.get(`${sysKey}:${desc}`);
        if (to) {
          const i = to.indexOf(":");
          aliased.push([to.slice(0, i), to.slice(i + 1), qty]);
        } else descOut[desc] = qty;
      }
    }
    // #233: old-label overrides land under the new label unless the new
    // label was saved too (then the new one wins).
    for (const [sysKey, desc, qty] of aliased) {
      const descOut: Record<string, number> = has(sysOut, sysKey) ? sysOut[sysKey] : (sysOut[sysKey] = {});
      if (!has(descOut, desc)) descOut[desc] = qty;
    }
    out[tier as TierKey] = sysOut;
  }
  return out;
}
```

- [ ] **Step 5: Read the moved Equipment-map key.** In `src/lib/design/equipment-map.ts`:

(a) Replace line 24:

```ts
import { EQUIPMENT_ROWS, EQUIPMENT_ROW_BY_KEY, type EquipRowDef } from "./equipment-vocab";
```

with:

```ts
import { EQUIPMENT_KEY_ALIASES, EQUIPMENT_ROWS, EQUIPMENT_ROW_BY_KEY, type EquipRowDef } from "./equipment-vocab";
```

(b) Replace `sanitizeEquipmentMap` (lines 87–108) with:

```ts
/** The stored blob → a clean map: known rows only, valid cells only, cleared (null) rows dropped.
 *  #233: a moved row's old key reads as its new key while the blob holds no
 *  entry at all under the new key (a saved or cleared new row wins). */
export function sanitizeEquipmentMap(raw: unknown): EquipmentMap {
  const out: EquipmentMap = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const [rawKey, value] of Object.entries(src)) {
    const moved = EQUIPMENT_KEY_ALIASES.get(rawKey);
    if (moved && Object.prototype.hasOwnProperty.call(src, moved)) continue;
    const key = moved ?? rawKey;
    if (!EQUIPMENT_ROW_BY_KEY.has(key) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const tiersRaw = (v.tiers && typeof v.tiers === "object" ? v.tiers : {}) as Record<string, unknown>;
    const tiers: Partial<Record<TierKey, EquipCell>> = {};
    for (const t of EQUIP_TIERS) {
      const c = sanitizeEquipCell(tiersRaw[t]);
      if (c) tiers[t] = c;
    }
    out[key] = {
      tiers,
      ...(v.sameAll ? { sameAll: true } : {}),
      updatedBy: String(v.updatedBy ?? ""),
      updatedAt: Number(v.updatedAt) || 0,
    };
  }
  return out;
}
```

- [ ] **Step 6: Move the legacy hint.** In `src/lib/design/equipment-legacy-hints.ts`:

- Delete line 70: `  "controls:outputStation": { perTier: T(90, 125, 190) },`
- Replace `  "lighting:automated": { perTier: T(2100, 3000, 4600) },` with:

```ts
  "lighting:automated": { perTier: T(2100, 3000, 4600) },
  "lighting:cablePackage": { perTier: T(90, 125, 190) }, // was controls:outputStation (#233)
```

- [ ] **Step 7: Run the gates.**

```bash
npx tsc --noEmit
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
npx eslint src/lib/design/equipment-vocab.ts "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-map.ts src/lib/design/equipment-legacy-hints.ts
lsof -i :3000; npx next build
```

Expected:
- tsc: 0 errors.
- Specs: no FAIL lines, and PASS = baseline + 17.
- eslint: 0 errors.
- Build: exit 0.
- The existing #211 T1 checks (46 rows, emitted ⇄ rows, label = desc, "was" hint on every row, dollar-free vocabulary) still pass.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/design/equipment-vocab.ts "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-map.ts src/lib/design/equipment-legacy-hints.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): relabel eleven equipment rows from one label source; old overrides and the moved key still resolve (#233)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: #229 "Not included" cell, end to end

**Files:**
- Modify: `src/lib/design/equipment-map.ts` (`EquipCell` 32–37, `EquipCellInput` 51–55, `sanitizeEquipCell` 64–85, `rowStatus` doc 115, `mergeEquipRow` error 161, `PricedStatus` 182, `priceCell` 205–206)
- Modify: `src/app/(app)/design/quick/engine.ts` (`BomItem.status`, line 61)
- Modify: `src/lib/design/equipment-pricing.ts` (`priceItem` 47–48)
- Modify: `src/lib/design/equipment-map-view.ts` (`EquipCellVM.kind` 24, `cellVM` 80–84)
- Modify: `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx` (intro 68–70, `CellSummary` 119, `CellEditor` 218–232)
- Modify: `src/app/(app)/design/grid/[id]/equipment-card.tsx` (183–184, 193–205, 219–220)
- Modify: `src/app/(app)/design/quick/quick-design-client.tsx` (line 510)
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- `EquipCell | EquipCellInput` gain `{ kind: "none" }`.
- `PricedStatus = "part" | "assembly" | "allowance" | "none"`.
- `BomItem.status` gains `"none"`.
- `export const NOT_INCLUDED = "Not included"` in `equipment-map.ts`.
- `EquipCellVM.kind` gains `"none"`.

- [ ] **Step 1: Write the failing harness block.** Append to EOF:

```ts
/* --- #229: "Not included" — a resolved Equipment-map cell: $0, never Incomplete, never placed, never quoted --- */
import {
  sanitizeEquipCell as n229Cell, sanitizeEquipmentMap as n229Map, mergeEquipRow as n229Merge, rowStatus as n229Status,
  priceCell as n229Price, buildEquipmentPriceTable as n229Table, type EquipmentMap as N229Map,
} from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY as n229ByKey } from "@/lib/design/equipment-vocab";
import { equipmentMapView as n229View, mapSummary as n229Summary } from "@/lib/design/equipment-map-view";
import { applyEquipment as n229Apply } from "@/lib/design/equipment-pricing";
import { targetsFromSystems as n229Targets, needsPartCount as n229Needs } from "@/lib/design/scope-targets";
import { autoEstimateCards as n229Cards, autoQuoteNeedsPart as n229AutoNeeds } from "@/lib/design/auto-estimate";
import { partIdForLine as n229PartId } from "@/lib/design/grid-auto-layout";
import { compute as n229Compute, defaultAState as n229Default } from "@/app/(app)/design/quick/engine";
{
  ok(JSON.stringify(n229Cell({ kind: "none", junk: 1 })) === '{"kind":"none"}', "#229: a Not included cell sanitizes to { kind: \"none\" }");
  const m = n229Merge(undefined, { tiers: { good: { kind: "none" }, better: { kind: "part", sku: "P1" }, best: { kind: "part", sku: "P1" } } }, "Jeff", 5);
  ok(m.ok && m.row.tiers.good?.kind === "none" && m.row.tiers.better?.kind === "part", "#229: the editor saves Not included for one tier");
  const same = n229Merge(undefined, { tiers: { good: { kind: "none" } }, sameAll: true }, "Jeff", 5);
  ok(same.ok && same.row.tiers.best?.kind === "none", "#229: …or for all tiers (Same for all tiers)");
  const stored = n229Map({ "rigging:varSpeedHoist": { tiers: { good: { kind: "none" } }, sameAll: true, updatedBy: "J", updatedAt: 1 } });
  ok(n229Status(stored["rigging:varSpeedHoist"]) === "mapped", "#229: a Not included row reads Mapped (resolved), never Needs a part");

  const ctx = { parts: new Map([["P1", { sku: "P1", desc: "Hoist", unit: "ea", cost: 100, list: 150 }]]), fixtures: new Map(), margin: 0.3 };
  const p = n229Price({ kind: "none" }, n229ByKey.get("rigging:varSpeedHoist")!, ctx);
  ok(p.status === "none" && p.unitCost === 0 && p.unitSell === 0 && p.desc === "Not included", "#229: Not included prices $0 with status none");
  ok(n229Price({ kind: "none" }, n229ByKey.get("curtains:border")!, ctx).status === "none", "#229: a curtain row can be Not included too");

  const map: N229Map = { "lighting:par": { tiers: { good: { kind: "none" } }, sameAll: true, updatedBy: "J", updatedAt: 1 } };
  const table = n229Table(map, ctx);
  const base = n229Default(0);
  const lightOnly = { rigging: false, curtains: false, lighting: true, controls: false, audio: false, video: false, acoustical: false, pit: false };
  const [priced] = n229Apply(n229Compute({ ...base, sys: lightOnly }).systems.filter((x) => x.key === "lighting"), "good", table);
  const par = priced.items.find((i) => i.key === "lighting:par")!;
  ok(par.status === "none" && par.price === 0 && par.cost === 0 && !par.ref, "#229: the pipeline carries a Not included line at $0 with no product behind it");
  const others = priced.items.filter((i) => i.qty > 0 && i.status === "needs-part").length;
  ok(n229Targets([priced]).lighting!.needsPart === others && n229Needs([priced]) === others, "#229: Not included is never counted as needs-a-part (the Incomplete gate ignores it)");

  const cards = n229Cards({ ...base, sys: lightOnly }, { tierByScope: { lighting: "good" }, overrides: {} }, table, {});
  const line = cards[0].lines.find((l) => l.rowKey === "lighting:par")!;
  ok(line.status === "none" && line.total === 0 && n229PartId(line, "good") === null && cards[0].lines.filter((l) => l.status === "needs-part").length === cards[0].needsPart,
    "#229: an Auto card line is Not included — $0, not needs-a-part, never placed");
  ok(n229AutoNeeds(cards, { tierByScope: { lighting: "good" } }) === cards[0].needsPart, "#229: Not included never refuses a Grid quote");

  const view = n229View(map, ctx, {});
  const row = view.find((r) => r.key === "lighting:par")!;
  ok(row.status === "mapped" && row.cells.every((c) => c.kind === "none" && c.title === "Not included" && c.problem === null && c.input?.kind === "none"),
    "#229: the Equipment map shows Not included and re-posts it");
  ok(n229Summary(view).mapped === 1, "#229: the summary counts a Not included row as Mapped");

  const emc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx"), "utf8");
  ok(emc.includes('<option value="none">Not included</option>') && emc.includes('k === "none" ? { kind: "none" }'), "#229: the cell editor offers Not included");
  const card = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/equipment-card.tsx"), "utf8");
  ok(card.includes('l.status === "none"') && card.includes("Not included in this tier"), "#229: Auto cards say Not included");
  const qd = readFileSync(join(process.cwd(), "src/app/(app)/design/quick/quick-design-client.tsx"), "utf8");
  ok(qd.includes('it.status === "none" ? "Not included"'), "#229: Quick Design's BOM says Not included");
}
```

- [ ] **Step 2: Run it and watch it fail.** Run `npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep '^FAIL ' "$TMPDIR/specs.log"`. Expected: FAIL lines tagged `#229` only.

- [ ] **Step 3: Add the cell kind and its pricing.** In `src/lib/design/equipment-map.ts`:

(a) Replace the `EquipCell` type (lines 32–37) with:

```ts
export type EquipCell =
  | { kind: "part"; sku: string }
  | { kind: "assembly"; id: string }
  /** #229: "Not included" — this tier has no solution for the item. Resolved:
   *  never Incomplete, prices $0, places nothing, emits no quote line. */
  | { kind: "none" }
  /** `note` is the internal "why"; `description` (#212) is the customer-facing
   *  line text for a product with no catalog row. Both trimmed, ≤ 200, absent when empty. */
  | { kind: "allowance"; amount: number; confirmedBy: string; confirmedAt: number; note?: string; description?: string };
```

(b) Replace `EquipCellInput` (lines 51–55) with:

```ts
export type EquipCellInput =
  | { kind: "part"; sku: string }
  | { kind: "assembly"; id: string }
  | { kind: "none" }
  | { kind: "allowance"; amount: number; note?: string; description?: string; confirmed: boolean }
  | null;
```

(c) In `sanitizeEquipCell`, after the `assembly` branch's closing `}` (line 74), insert:

```ts
  if (r.kind === "none") return { kind: "none" };
```

(d) Replace the `rowStatus` doc line (115) with:

```ts
/** Spec §3: Mapped (every tier a part, assembly or Not included, #229) · Allowance (any tier an allowance) · Needs a part (any tier empty). */
```

(e) In `mergeEquipRow`, replace line 161:

```ts
    if (!cell) return { ok: false, error: "Pick a catalog part or an assembly for every filled tier." };
```

with:

```ts
    if (!cell) return { ok: false, error: "Pick a catalog part, an assembly or Not included for every filled tier." };
```

(f) Replace line 182:

```ts
export type PricedStatus = "part" | "assembly" | "allowance";
```

with:

```ts
/** "none" (#229): Not included — resolved at $0, never placed or quoted. */
export type PricedStatus = "part" | "assembly" | "allowance" | "none";
/** What a Not included line reads everywhere it shows (#229). */
export const NOT_INCLUDED = "Not included";
```

(g) In `priceCell`, replace:

```ts
  if (!cell) return needs("Not mapped yet");
```

with:

```ts
  if (!cell) return needs("Not mapped yet");
  // #229: resolved, $0, no product — the ref is the row, never a SKU.
  if (cell.kind === "none") return { status: "none", ref: def.key, desc: NOT_INCLUDED, unit: def.unit, unitCost: 0, unitSell: 0 };
```

- [ ] **Step 4: Carry the status through the pipeline.**

(a) In `src/app/(app)/design/quick/engine.ts`, replace the `BomItem.status` line (line 61, or 62 after Task 1's import):

```ts
  status?: "part" | "assembly" | "allowance" | "needs-part";
```

with:

```ts
  status?: "part" | "assembly" | "allowance" | "none" | "needs-part";
```

(b) In `src/lib/design/equipment-pricing.ts`, replace line 48:

```ts
  if (!p || p.status === "needs-part") return { cost: 0, price: 0, status: "needs-part" };
```

with:

```ts
  if (!p || p.status === "needs-part") return { cost: 0, price: 0, status: "needs-part" };
  // #229: Not included — $0 and no product (no ref), before any drape math.
  if (p.status === "none") return { cost: 0, price: 0, status: "none" };
```

- [ ] **Step 5: Show it on the Equipment map.** In `src/lib/design/equipment-map-view.ts`:

(a) Line 24: `kind: "part" | "assembly" | "allowance" | "empty";` → `kind: "part" | "assembly" | "allowance" | "none" | "empty";`

(b) In `cellVM`, after line 83 (the `if (!cell) return { … kind: "empty" … }` line), insert:

```ts
  if (cell.kind === "none") return { tier, kind: "none", title: "Not included", detail: "", unitCost: null, unitSell: null, perSqft, problem: null, input: { kind: "none" } };
```

In `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx`:

(c) Replace the intro text lines 68–70:

```tsx
          Map every equation item to a catalog part or an assembly for each tier. Auto uses only <b>Mapped</b> and
          confirmed <b>Allowance</b> rows; <b>Needs a part</b> rows are left off Auto plans and listed on the Equipment step.
          Nothing is mapped for you — each row shows the figure the old equations assumed, for reference only.
```

with:

```tsx
          Map every equation item to a catalog part or an assembly for each tier. Auto uses only <b>Mapped</b> and
          confirmed <b>Allowance</b> rows; <b>Needs a part</b> rows are left off Auto plans and listed on the Equipment step.
          Set a tier to <b>Not included</b> when that tier has no solution for the item: it prices $0 and never blocks a quote.
          Nothing is mapped for you — each row shows the figure the old equations assumed, for reference only.
```

(d) In `CellSummary`, replace line 119:

```tsx
      {cell.kind !== "empty" && !cell.problem && (
```

with:

```tsx
      {cell.kind !== "empty" && cell.kind !== "none" && !cell.problem && (
```

(e) In `CellEditor`, replace the `pick` function and the `<select>` (lines 218–232):

```tsx
  const pick = (k: string) =>
    onChange(
      k === "part" ? { kind: "part", sku: "" }
        : k === "assembly" ? { kind: "assembly", id: "" }
          : k === "allowance" ? { kind: "allowance", amount: 0, note: "", description: "", confirmed: false }
            : null
    );
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <select value={kind} onChange={(e) => pick(e.target.value)} style={INPUT}>
        <option value="empty">Needs a part</option>
        <option value="part">{curtain ? "Catalog fabric" : "Catalog part"}</option>
        {!curtain && <option value="assembly">Assembly (fixture or system)</option>}
        <option value="allowance">Allowance</option>
      </select>
```

with:

```tsx
  const pick = (k: string) =>
    onChange(
      k === "part" ? { kind: "part", sku: "" }
        : k === "assembly" ? { kind: "assembly", id: "" }
          : k === "allowance" ? { kind: "allowance", amount: 0, note: "", description: "", confirmed: false }
            : k === "none" ? { kind: "none" }
              : null
    );
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <select value={kind} onChange={(e) => pick(e.target.value)} style={INPUT}>
        <option value="empty">Needs a part</option>
        <option value="part">{curtain ? "Catalog fabric" : "Catalog part"}</option>
        {!curtain && <option value="assembly">Assembly (fixture or system)</option>}
        <option value="allowance">Allowance</option>
        <option value="none">Not included</option>
      </select>
```

(Task 3 changes the assembly option's text.)

- [ ] **Step 6: Show it on Auto cards and in Quick Design.**

In `src/app/(app)/design/grid/[id]/equipment-card.tsx`:

(a) Replace:

```tsx
          const needs = l.status === "needs-part";
          const edited = l.swapped || l.qty !== l.eqQty;
```

with:

```tsx
          const needs = l.status === "needs-part";
          const none = l.status === "none";
          const edited = l.swapped || l.qty !== l.eqQty;
```

(b) Replace:

```tsx
                  ) : (
                    `${l.refDesc ?? l.ref ?? ""}${l.swapped ? " · swapped for this design" : ""}`
                  )}
```

with:

```tsx
                  ) : none ? (
                    "Not included in this tier"
                  ) : (
                    `${l.refDesc ?? l.ref ?? ""}${l.swapped ? " · swapped for this design" : ""}`
                  )}
```

(c) Replace:

```tsx
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#5b616e" }}>{needs ? "—" : unitMoney(l.unitSell)}</span>
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}>{needs ? "—" : money(l.total)}</span>
```

with:

```tsx
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#5b616e" }}>{needs || none ? "—" : unitMoney(l.unitSell)}</span>
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}>{needs || none ? "—" : money(l.total)}</span>
```

(d) In `src/app/(app)/design/quick/quick-design-client.tsx`, replace line 510:

```tsx
        const upLabel = it.status === "needs-part" ? "Needs a part" : up > 0 && up < 10 ? "$" + up.toFixed(2) : moneyRound(up);
```

with:

```tsx
        const upLabel = it.status === "needs-part" ? "Needs a part" : it.status === "none" ? "Not included" : up > 0 && up < 10 ? "$" + up.toFixed(2) : moneyRound(up);
```

- [ ] **Step 7: Run the gates.**

```bash
npx tsc --noEmit
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
npx eslint src/lib/design/equipment-map.ts "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-pricing.ts src/lib/design/equipment-map-view.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" "src/app/(app)/design/grid/[id]/equipment-card.tsx" "src/app/(app)/design/quick/quick-design-client.tsx"
lsof -i :3000; npx next build
```

Expected: tsc 0 errors; no FAIL lines, PASS = Task 1 count + 15; eslint 0 errors; build exit 0. If tsc flags a `switch`/`Record` over `PricedStatus` or `EquipCell["kind"]` elsewhere, add the `"none"` case there. The research found none beyond the files above.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/design/equipment-map.ts "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-pricing.ts src/lib/design/equipment-map-view.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" "src/app/(app)/design/grid/[id]/equipment-card.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(grid): Not included per row per tier — resolved, \$0, never placed or quoted (#229)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: #228 Hardware assemblies, end to end

**Files:**
- Modify: `src/lib/fixture-assemblies.ts` (`FixtureKind` 221, `FixtureRecord` docs 236–249, `fixtureLineParts` 327, `sanitizeFixtureInput` 498–513, `fixtureAssembliesFrom` doc 564–566)
- Modify: `src/lib/fixtures-convert.ts` (`normalizeFixtureRow` 148, 157)
- Modify: `src/app/(app)/design/assemblies/actions.ts` (line 65 message)
- Modify: `src/app/(app)/design/assemblies/fixture-builder.tsx` (13, 63–68, 117, 133–134, 164, 182, 192)
- Modify: `src/app/(app)/design/assemblies/fixture-form.tsx` (296–345, 367)
- Modify: `src/lib/design/equipment-map-view.ts` (import 20, `AssemblyOption` 59, `cellVM` detail 102, `assemblyOptions` 151)
- Modify: `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx` (assembly option text, picker label 239)
- Modify: `src/lib/design/auto-estimate.ts` (`assemblySwapCandidates` 214–226)
- Modify: `src/lib/design/grid-virtual-parts.ts` (header 4, imports 19–20, new `hardwareLayerFor`, `gridScope` 84)
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- `FixtureKind = "fixture" | "system" | "hardware"`.
- `export function hardwareLayerFor(fixtureId: string, map: EquipmentMap): GridLayer` in `grid-virtual-parts.ts`.
- `AssemblyOption.kind: FixtureKind`.
- `assemblySwapCandidates<F extends { kind: FixtureKind; scope?: string }>`.

- [ ] **Step 1: Write the failing harness block.** Append to EOF:

```ts
/* --- #228: Hardware assemblies — a third FixtureKind through the builder, the Equipment map and Auto --- */
import {
  sanitizeFixtureInput as h228Sanitize, fixtureLineParts as h228Lines, resolveFixture as h228Resolve, fixtureAssembliesFrom as h228From,
  type FixtureRecord as H228Rec,
} from "@/lib/fixture-assemblies";
import { normalizeFixtureRow as h228Normalize } from "@/lib/fixtures-convert";
import { assemblyOptions as h228Opts, equipmentMapView as h228View } from "@/lib/design/equipment-map-view";
import { priceCell as h228Price, type EquipmentMap as H228Map } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY as h228ByKey } from "@/lib/design/equipment-vocab";
import { assemblyPartId as h228AsmId, virtualPartsFor as h228Virtual } from "@/lib/design/grid-virtual-parts";
import { assemblySwapCandidates as h228Cand, scopeLabelOf as h228ScopeLabel } from "@/lib/design/auto-estimate";
{
  const noParts = h228Sanitize({ kind: "hardware", label: "Chain Wrap", description: "", parts: [] });
  ok(!noParts.ok && /part/i.test(noParts.error), "#228: hardware needs at least one part");
  const hw = h228Sanitize({ kind: "hardware", label: " Chain Wrap ", description: "", scope: "Audio", lightEngineSku: "IGNORED", parts: [{ sku: "CH-3", qty: 1 }, { sku: "SHK-1", qty: 2 }] });
  ok(hw.ok && hw.value.kind === "hardware" && hw.value.label === "Chain Wrap" && hw.value.lightEngineSku === "" && hw.value.lensSku === null && !("scope" in hw.value) && (hw.value.parts || []).length === 2,
    "#228: a hardware assembly keeps one parts list — no light engine, no scope of its own");
  const dup = h228Sanitize({ kind: "hardware", label: "X", description: "", parts: [{ sku: "A", qty: 1 }, { sku: "A", qty: 1 }] });
  ok(!dup.ok && /two lines/.test(dup.error), "#228: hardware refuses a SKU on two lines, like a system");

  const rec: H228Rec = {
    id: "SA-HW1", kind: "hardware", label: "Chain Wrap", description: "", lightEngineSku: "", lensSku: null,
    lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [{ sku: "CH-3", qty: 1 }, { sku: "SHK-1", qty: 2 }],
    createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const catalog = new Map([
    ["CH-3", { sku: "CH-3", desc: "Chain 3 ft", unit: "ea", cost: 10, list: 20 }],
    ["SHK-1", { sku: "SHK-1", desc: "Shackle", unit: "ea", cost: 5, list: 8 }],
  ]);
  const r = h228Resolve(rec, catalog);
  ok(h228Lines(rec).length === 2 && h228Lines(rec).every((x) => x.slot === "parts") && r.cost === 20 && r.sell === 36,
    "#228: hardware prices its parts list (cost 10 + 2×5, sell 20 + 2×8)");
  const norm = h228Normalize({ ...rec } as unknown as Record<string, unknown> & { id: string });
  ok(norm.kind === "hardware" && (norm.parts || []).length === 2, "#228: a stored hardware row normalizes as hardware, keeping its parts");
  ok(h228From([rec], catalog).length === 0, "#228: hardware never appears in the Estimator / Quick Design fixture pickers");

  const ctx = { parts: catalog, fixtures: new Map([[rec.id, rec]]), margin: 0.3 };
  const opt = h228Opts([rec], ctx)[0];
  ok(opt?.kind === "hardware" && opt.unitSell === 36 && opt.unitCost === 20, "#228: the Equipment-map picker lists hardware assemblies with live totals");
  const pc = h228Price({ kind: "assembly", id: rec.id }, h228ByKey.get("rigging:chainWrap")!, ctx);
  ok(pc.status === "assembly" && pc.desc === "Chain Wrap" && pc.unitSell === 36, "#228: Batten Termination maps to the Chain Wrap hardware assembly");
  const map: H228Map = { "rigging:chainWrap": { tiers: { good: { kind: "assembly", id: rec.id } }, sameAll: true, updatedBy: "J", updatedAt: 1 } };
  ok(h228View(map, ctx, {}).find((row) => row.key === "rigging:chainWrap")!.cells[0].detail === "Hardware", "#228: the map cell names it Hardware");

  const [vp] = h228Virtual([h228AsmId(rec.id)], map, ctx);
  ok(vp?.gridScope === "Rigging" && !vp.virtualDead && vp.list === 36, "#228: a hardware virtual part draws on its mapped row's system (Rigging), not the Lighting default");
  const onCurtains: H228Map = { "curtains:scenerytrack": { tiers: { good: { kind: "assembly", id: rec.id } }, sameAll: true, updatedBy: "J", updatedAt: 1 } };
  ok(h228Virtual([h228AsmId(rec.id)], onCurtains, ctx)[0]?.gridScope === "Curtains", "#228: …mapped on a Curtains row it draws on Curtains");
  ok(h228Virtual([h228AsmId(rec.id)], {}, ctx)[0]?.gridScope === "Rigging", "#228: an unmapped (swapped-in) hardware assembly defaults to Rigging");

  const cands = [{ kind: "hardware" as const, id: "hw" }, { kind: "fixture" as const, id: "fx" }, { kind: "system" as const, scope: "Rigging", id: "sys" }];
  ok(h228Cand(cands, h228ScopeLabel("rigging")).map((f) => f.id).join(",") === "hw,sys" && !h228Cand(cands, h228ScopeLabel("lighting")).some((f) => f.id === "hw"),
    "#228: hardware is a swap candidate on Rigging rows only");

  const fb = readFileSync(join(process.cwd(), "src/app/(app)/design/assemblies/fixture-builder.tsx"), "utf8");
  ok(fb.includes('hardware: "Hardware"') && fb.includes('start("hardware")'), "#228: the builder has a Hardware tab and a New assembly → Hardware button");
  const ff = readFileSync(join(process.cwd(), "src/app/(app)/design/assemblies/fixture-form.tsx"), "utf8");
  ok(ff.includes('const isParts = draft.kind !== "fixture"') && ff.includes("isHardware"), "#228: the form edits hardware as one parts list");
  const emc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx"), "utf8");
  ok(emc.includes('a.kind === "hardware" ? "Hardware"') && emc.includes("Assembly (fixture, system or hardware)"), "#228: the map picker labels hardware assemblies");
}
```

- [ ] **Step 2: Run it and watch it fail.** Run `npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep '^FAIL ' "$TMPDIR/specs.log"`. Expected: FAIL lines tagged `#228` only.

- [ ] **Step 3: Add the kind to the model.** In `src/lib/fixture-assemblies.ts`:

(a) Replace line 221:

```ts
export type FixtureKind = "fixture" | "system";
```

with:

```ts
/** #228: "hardware" is a parts-list assembly (like a system) with no scope of
 *  its own — e.g. a Chain Wrap batten termination. On the plan it draws on
 *  the Equipment map row it is mapped on (grid-virtual-parts hardwareLayerFor). */
export type FixtureKind = "fixture" | "system" | "hardware";
```

(b) In `FixtureRecord`, change the `parts` doc line `/** System only — its one parts list. */` to `/** System and hardware — the one parts list. */`.

(c) In `fixtureLineParts`, replace line 327:

```ts
  if (r.kind === "system") return (r.parts || []).map((line) => ({ slot: "parts" as const, line }));
```

with:

```ts
  if (r.kind !== "fixture") return (r.parts || []).map((line) => ({ slot: "parts" as const, line }));
```

(d) In `sanitizeFixtureInput`, replace:

```ts
  const kind: FixtureKind = i.kind === "system" ? "system" : "fixture";
```

with:

```ts
  const kind: FixtureKind = i.kind === "system" ? "system" : i.kind === "hardware" ? "hardware" : "fixture";
```

and replace the whole system branch:

```ts
  if (kind === "system") {
    const scope = SYSTEM_SCOPES.find((s) => s === i.scope);
    if (!scope) return { ok: false, error: "Pick a scope for the system." };
    const parts = cleanList(i.parts);
    if (!parts.length) return { ok: false, error: "Add at least one part to the system." };
    if (parts.length > FIXTURE_MAX_LINES) return { ok: false, error: tooManyLines };
    const dup = duplicateSkuError(parts);
    if (dup) return { ok: false, error: dup };
    return { ok: true, value: { kind, label, description, scope, lightEngineSku: "", lensSku: null, lines, parts } };
  }
```

with:

```ts
  if (kind === "system" || kind === "hardware") {
    // #228: hardware has the system's parts list but never a scope of its own.
    const scope = kind === "system" ? SYSTEM_SCOPES.find((s) => s === i.scope) : undefined;
    if (kind === "system" && !scope) return { ok: false, error: "Pick a scope for the system." };
    const parts = cleanList(i.parts);
    if (!parts.length) return { ok: false, error: `Add at least one part to the ${kind === "system" ? "system" : "hardware assembly"}.` };
    if (parts.length > FIXTURE_MAX_LINES) return { ok: false, error: tooManyLines };
    const dup = duplicateSkuError(parts);
    if (dup) return { ok: false, error: dup };
    return { ok: true, value: { kind, label, description, ...(scope ? { scope } : {}), lightEngineSku: "", lensSku: null, lines, parts } };
  }
```

(e) In the `fixtureAssembliesFrom` doc comment, change `Systems are left out —` to `Systems and hardware are left out —`. The code's `.filter((r) => r.kind === "fixture")` stays.

- [ ] **Step 4: Normalize stored rows and fix the action message.**

(a) In `src/lib/fixtures-convert.ts`, replace:

```ts
  const kind = r.kind === "system" ? "system" : "fixture";
```

with:

```ts
  const kind: FixtureRecord["kind"] = r.kind === "system" ? "system" : r.kind === "hardware" ? "hardware" : "fixture";
```

and replace:

```ts
    ...(kind === "system" ? { parts: Array.isArray(r.parts) ? r.parts : [] } : {}),
```

with:

```ts
    ...(kind !== "fixture" ? { parts: Array.isArray(r.parts) ? r.parts : [] } : {}),
```

(b) In `src/app/(app)/design/assemblies/actions.ts`, replace:

```ts
  if (existing && existing.kind !== clean.value.kind) return { ok: false, error: "An assembly can't change between fixture and system." };
```

with:

```ts
  if (existing && existing.kind !== clean.value.kind) return { ok: false, error: "An assembly can't change between fixture, system and hardware." };
```

- [ ] **Step 5: Builder list and form.**

In `src/app/(app)/design/assemblies/fixture-builder.tsx`:

(a) Line 13:

```ts
const FILTER_LABEL: Record<Filter, string> = { all: "All", fixture: "Fixtures", system: "Systems" };
```

→

```ts
const FILTER_LABEL: Record<Filter, string> = { all: "All", fixture: "Fixtures", system: "Systems", hardware: "Hardware" };
```

(b) Replace the counts:

```ts
    system: rows.filter((r) => r.rec.kind === "system").length,
  };
```

with:

```ts
    system: rows.filter((r) => r.rec.kind === "system").length,
    hardware: rows.filter((r) => r.rec.kind === "hardware").length,
  };
```

(c) `{(["all", "fixture", "system"] as const).map((f) => (` → `{(["all", "fixture", "system", "hardware"] as const).map((f) => (`

(d) Replace:

```tsx
            <button type="button" className="pk-btn-outline" onClick={() => start("system")}>System</button>
```

with:

```tsx
            <button type="button" className="pk-btn-outline" onClick={() => start("system")}>System</button>
            <button type="button" className="pk-btn-outline" onClick={() => start("hardware")}>Hardware</button>
```

(e) The empty state `No assemblies yet — build the first fixture or system from your catalog.` → `No assemblies yet — build the first fixture, system or hardware assembly from your catalog.`

(f) Replace:

```tsx
                        {rec.kind === "system" ? `System · ${rec.scope || "—"}` : "Fixture"}
```

with:

```tsx
                        {rec.kind === "system" ? `System · ${rec.scope || "—"}` : rec.kind === "hardware" ? "Hardware" : "Fixture"}
```

(g) Replace:

```tsx
                      {rec.kind === "system" ? `${l.parts.length} part${l.parts.length === 1 ? "" : "s"}` : head}
```

with:

```tsx
                      {rec.kind !== "fixture" ? `${l.parts.length} part${l.parts.length === 1 ? "" : "s"}` : head}
```

In `src/app/(app)/design/assemblies/fixture-form.tsx`:

(h) Replace:

```tsx
  const isSystem = draft.kind === "system";
  const noun = isSystem ? "system" : "fixture";
  const engine = draft.lightEngineSku;
  const chipFor = !isSystem && engine
```

with:

```tsx
  const isSystem = draft.kind === "system";
  const isHardware = draft.kind === "hardware";
  /** #228: a system and a hardware assembly are one parts list; only a fixture has a light engine and boxes. */
  const isParts = draft.kind !== "fixture";
  const noun = isSystem ? "system" : isHardware ? "hardware assembly" : "fixture";
  const engine = draft.lightEngineSku;
  const chipFor = !isParts && engine
```

(i) Replace:

```tsx
            {isSystem
              ? "A bundle of catalog parts under one scope — a mixer, DSP & amps; a video switcher; a distro system."
              : "Pick the light engine (and lens), then what ships with it. A quantity of 0 makes a part a compatible optional add-on."}
```

with:

```tsx
            {isSystem
              ? "A bundle of catalog parts under one scope — a mixer, DSP & amps; a video switcher; a distro system."
              : isHardware
                ? "A bundle of catalog hardware — a chain wrap, a batten or beginning termination. It has no scope of its own: on the plan it follows the Equipment map row it is mapped on (Rigging by default)."
                : "Pick the light engine (and lens), then what ships with it. A quantity of 0 makes a part a compatible optional add-on."}
```

(j) Replace the Label placeholder expression:

```tsx
placeholder={isSystem ? "e.g. Digital mixer, DSP & amplifiers" : "e.g. ETC Source Four LED Series 3"}
```

with:

```tsx
placeholder={isSystem ? "e.g. Digital mixer, DSP & amplifiers" : isHardware ? "e.g. Chain wrap" : "e.g. ETC Source Four LED Series 3"}
```

(k) Replace:

```tsx
        {isSystem ? (
          <label style={LABEL}>Scope
```

with:

```tsx
        {isHardware ? null : isSystem ? (
          <label style={LABEL}>Scope
```

(l) Replace `{!isSystem && (draft.lightEngineSku || draft.lensSku) && (` with `{!isParts && (draft.lightEngineSku || draft.lensSku) && (`.

(m) Replace:

```tsx
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: isSystem ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {isSystem ? (
```

with:

```tsx
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: isParts ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {isParts ? (
```

- [ ] **Step 6: Equipment-map picker, swap candidates, plan scope.**

In `src/lib/design/equipment-map-view.ts`:

(a) Line 20:

```ts
import { resolveFixture, type FixtureRecord } from "@/lib/fixture-assemblies";
```

→

```ts
import { resolveFixture, type FixtureKind, type FixtureRecord } from "@/lib/fixture-assemblies";
```

(b) Line 59:

```ts
export type AssemblyOption = { id: string; label: string; kind: "fixture" | "system"; scope: string; unitCost: number; unitSell: number };
```

→

```ts
export type AssemblyOption = { id: string; label: string; kind: FixtureKind; scope: string; unitCost: number; unitSell: number };
```

(c) Line 102:

```ts
      detail: f ? (f.kind === "system" ? `System · ${f.scope ?? "Other"}` : "Fixture") : "",
```

→

```ts
      detail: f ? (f.kind === "system" ? `System · ${f.scope ?? "Other"}` : f.kind === "hardware" ? "Hardware" : "Fixture") : "",
```

(d) Line 151:

```ts
      scope: f.kind === "system" ? f.scope ?? "Other" : "Lighting",
```

→

```ts
      scope: f.kind === "system" ? f.scope ?? "Other" : f.kind === "hardware" ? "" : "Lighting",
```

In `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx`:

(e) `{!curtain && <option value="assembly">Assembly (fixture or system)</option>}` → `{!curtain && <option value="assembly">Assembly (fixture, system or hardware)</option>}`

(f) Replace:

```tsx
              {a.label} · {a.kind === "system" ? `System (${a.scope})` : "Fixture"} · sell {money(a.unitSell)}
```

with:

```tsx
              {a.label} · {a.kind === "system" ? `System (${a.scope})` : a.kind === "hardware" ? "Hardware" : "Fixture"} · sell {money(a.unitSell)}
```

In `src/lib/design/auto-estimate.ts`:

(g) Add `import type { FixtureKind } from "@/lib/fixture-assemblies";` after the `import type { ScopeTargets } from "./scope-targets";` line. Then replace the `assemblySwapCandidates` doc and function (lines 214–226) with:

```ts
/**
 * Which fixtures/systems/hardware are swap candidates for a scope (M1, #228):
 * a System assembly only when its own scope matches the card's (`f.scope`,
 * the capitalized SysKey label — "Lighting", "Audio", …); a Fixture assembly
 * only on a Lighting row, the one scope where a bare light fixture is a
 * sensible swap for an equation line; a Hardware assembly only on a Rigging
 * row (terminations, chain wraps).
 */
export function assemblySwapCandidates<F extends { kind: FixtureKind; scope?: string }>(
  fixtures: ReadonlyArray<F>,
  scopeLabel: string
): F[] {
  return fixtures.filter((f) =>
    f.kind === "fixture" ? scopeLabel === "Lighting" : f.kind === "hardware" ? scopeLabel === "Rigging" : f.scope === scopeLabel
  );
}
```

In `src/lib/design/grid-virtual-parts.ts`:

(h) Header line 4: `asm:<fixtureId>          a fixture or System assembly (#210)` → `asm:<fixtureId>          a fixture, System or Hardware assembly (#210, #228)`

(i) Replace lines 19–20:

```ts
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { cellFor, isTierKey, sellFromCost, type EquipmentMap, type EquipPriceCtx } from "./equipment-map";
```

with:

```ts
import { EQUIPMENT_ROWS, EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { EQUIP_TIERS, cellFor, isTierKey, sellFromCost, type EquipmentMap, type EquipPriceCtx } from "./equipment-map";
```

(j) After the `SYSTEM_SCOPE_LAYER` object (ends line 60), insert:

```ts

/**
 * #228: a Hardware assembly has no scope of its own — it draws on the Grid
 * layer of the Equipment map row it is mapped on (the first such row in
 * vocabulary order, any tier; Controls / Acoustical / Pit → Unscoped). Not
 * mapped anywhere (swapped in on an Auto card, which offers hardware on
 * Rigging rows only) → Rigging.
 */
export function hardwareLayerFor(fixtureId: string, map: EquipmentMap): GridLayer {
  for (const def of EQUIPMENT_ROWS) {
    const row = map[def.key];
    if (!row) continue;
    for (const t of EQUIP_TIERS) {
      const c = cellFor(row, t);
      if (c?.kind === "assembly" && c.id === fixtureId) return GRID_SCOPE_OF_SYS[def.system] ?? UNSCOPED;
    }
  }
  return "Rigging";
}
```

(k) Replace line 84:

```ts
        gridScope: f?.kind === "system" ? SYSTEM_SCOPE_LAYER[f.scope || ""] ?? UNSCOPED : "Lighting",
```

with:

```ts
        gridScope: f?.kind === "system" ? SYSTEM_SCOPE_LAYER[f.scope || ""] ?? UNSCOPED : f?.kind === "hardware" ? hardwareLayerFor(f.id, map) : "Lighting",
```

- [ ] **Step 7: Run the gates.**

```bash
npx tsc --noEmit
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
npx eslint src/lib/fixture-assemblies.ts src/lib/fixtures-convert.ts "src/app/(app)/design/assemblies/actions.ts" "src/app/(app)/design/assemblies/fixture-builder.tsx" "src/app/(app)/design/assemblies/fixture-form.tsx" src/lib/design/equipment-map-view.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" src/lib/design/auto-estimate.ts src/lib/design/grid-virtual-parts.ts
lsof -i :3000; npx next build
```

Expected:
- tsc: 0 errors.
- Specs: no FAIL lines, and PASS = Task 2 count + 16.
- eslint: 0 errors.
- Build: exit 0.
- The #210 sanitize/normalize/graph checks and the #211 T3/T6/T8 picker, virtual-part and swap checks still pass.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/fixture-assemblies.ts src/lib/fixtures-convert.ts "src/app/(app)/design/assemblies/actions.ts" "src/app/(app)/design/assemblies/fixture-builder.tsx" "src/app/(app)/design/assemblies/fixture-form.tsx" src/lib/design/equipment-map-view.ts "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx" src/lib/design/auto-estimate.ts src/lib/design/grid-virtual-parts.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): Hardware assemblies — a third assembly kind for rigging rows like Batten Termination (#228)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Risks

- **Harness EOF collisions.** The #230–#232 plan also appends to `scripts/test-review-and-spec.ts`. Resolve by keeping both blocks, and verify that PASS = base + both plans' new counts.
- **Engine edit overlap.** `quick/engine.ts` is also edited by #232 (install % → per-system labor), in different regions. Rebase carefully around `compute()` and `tierTotals`.
- **Import direction.** `engine.ts` now value-imports `equipment-vocab.ts`, and the vocabulary must stay type-only toward the engine. A spec check pins this.
- **Existing Auto designs.** No change: Controls is never an Auto scope, so the Cable Package never reaches an Auto card.
- **Existing Quick designs.** Totals are unchanged when Lighting is on. A design with Lighting off but Controls/Data on loses the old Output station line from its total. That is a deliberate move of the line to Fixtures.
- **Stored data.** Nothing is rewritten. Old labels and keys resolve on read, and the next save or re-map writes the new ones.
