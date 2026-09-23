# Catalog Port Rules Engine Implementation Plan (#159)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propose `ports[]` for catalog parts by matching their manufacturer, category and description against an ordered, reviewable rule list — so Peak's catalog goes from 55 wireable parts toward ~1,170 without hand-writing an entry per part.

**Architecture:** Three pure modules and one CLI. `catalog-port-shapes.ts` holds the port shapes (moved out of `draft-starter-set.ts`, plus three new ones). `catalog-port-rules.ts` holds an ordered rule list and a first-match-wins matcher. `scripts/port-rules.ts` reports what each rule would do, and applies only the rules named on the command line. Nothing is written without explicit per-rule approval, and any part with existing ports is skipped.

**Tech Stack:** TypeScript, Drizzle/PGlite doc store, the repo's own `ok()` harness in `scripts/test-review-and-spec.ts` (there is no jest/vitest), `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-09-23-catalog-port-rules-engine-design.md`

## Global Constraints

- **Connection types are a closed vocabulary.** Every `connectionType` any shape emits MUST be a member of `CONNECTION_TYPES` (`src/lib/catalog-connect.ts`, 22 entries). A typo there silently unwires every part the shape touches. (D189, carried from #158)
- **Hand-edited ports always win.** A part with a non-empty `ports[]` is never modified by this engine — it only fills blanks. (D196)
- **Nothing applies by default.** Only rule ids named in `--rules` are applied. There is no "apply all". (D196)
- **The engine writes `ports` and nothing else** — never prices, categories, descriptions or any other field.
- **The engine never invents a port shape.** It selects among the shapes that exist. A part needing a shape that does not exist is reported as unmatched. (spec §5)
- **Do not modify** `src/lib/catalog-connect.ts`, `src/lib/catalog-ports.ts`, `src/app/(app)/catalog/*`, the Grid, or the wiring engine. All shipped and working.
- **No schema or migration change.** `CatalogPart.ports?: Port[]` already exists.
- Every task ends green on `npx tsc --noEmit`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/catalog-port-shapes.ts` **(new)** | The port shapes. Moved verbatim from `draft-starter-set.ts`, plus the three new ones from D197. Pure — no DB, no React. |
| `scripts/draft-starter-set.ts` **(modify)** | Deletes its local shape definitions and imports them from the shared module. Behaviour must not change. |
| `src/lib/catalog-port-rules.ts` **(new)** | The `PortRule` type, the ordered `PORT_RULES` list, and the pure matcher. |
| `src/lib/catalog-port-apply.ts` **(new)** | The DB-touching half: scan the catalog, aggregate per rule, and apply named rules. Importable by tests without running a CLI. |
| `scripts/port-rules.ts` **(new)** | Thin CLI wrapper — argument parsing, the printed report, the hosted-write gates. |
| `package.json` **(modify)** | Adds the `ports:rules` script. |
| `scripts/test-review-and-spec.ts` **(modify)** | Unit + integration assertions. |

**Environment notes that apply to every task:**
- **Never run anything against `.data/pglite`** — PGlite is single-process and a concurrent open corrupts it. Always `D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx …; rm -rf "$D"`.
- **Do not use `git stash`** — this repo shares one stash across many worktrees and stashing has destroyed other agents' uncommitted work. Use `git diff` / `git show`.
- Suite baseline is **1775 PASS / 5 FAIL**; the 5 are known fresh-datadir seed races (3× `equipment-items`, `seeded surveys exist to migrate`, `FS-1053 is present in the seed`). New assertions must PASS and FAIL must stay at 5.
- Node is at `~/.local/node/bin` (already on PATH).

---

## Task 1: Extract the port shapes into a shared module

**Files:**
- Create: `src/lib/catalog-port-shapes.ts`
- Modify: `scripts/draft-starter-set.ts` (delete the local shape definitions at lines ~113-201; import instead)
- Test: `scripts/test-review-and-spec.ts` (module-level, beside the existing `ports:` assertions)

**Interfaces:**
- Consumes: `CONNECTION_TYPES`, `Port`, `PortDirection` from `@/lib/catalog-connect`.
- Produces — every one of these is exported:
  `consolePorts()`, `wingPorts()`, `dimmerRackPorts(outCount: number)`, `conventionalFixturePorts()`, `ledFixturePorts()`, `ptzCameraPorts(video: "HDMI" | "SDI/BNC")`, `encoderDecoderPorts()`, `sdiCardPorts(n: number)`, `captureOnlyPorts()`, `matrixPorts(inN: number, outN: number, io?: "HDMI" | "HDBaseT (Cat6a)")`, `hdbasetMatrixPorts(inN: number, outN: number)`, `extenderKitPorts()`, `splitterPorts(outN: number)`, `passiveSpeakerPorts()`, `seventyVSpeakerPorts()`, `poweredSpeakerPorts()`, `mixerAllInOnePorts()`, `mixSurfacePorts()`, `mixRackPorts(inN: number, outN: number)`, `mechanicalPorts()`, `motorHoistPorts()`, and `ALL_SHAPES: Record<string, () => Port[]>` (each entry called with representative arguments, used only by the vocabulary guard test).

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-review-and-spec.ts`, module level, immediately after the existing `ports:` assertion block:

```ts
/* --- #159 Task 1: shared port shapes --- */
import * as Shapes from "@/lib/catalog-port-shapes";

ok(Shapes.passiveSpeakerPorts()[0].connectionType === "speakON NL2", "shapes: a passive speaker takes one speakON NL2 in");
ok(Shapes.passiveSpeakerPorts()[0].direction === "in", "shapes: a passive speaker's audio port is an input");
ok(Shapes.dimmerRackPorts(12)[2].count === 12, "shapes: dimmerRackPorts carries its output count");
ok(Shapes.matrixPorts(4, 4)[1].connectionType === "HDBaseT (Cat6a)", "shapes: matrixPorts defaults its output to HDBaseT");
ok(Shapes.matrixPorts(4, 4, "HDMI")[1].connectionType === "HDMI", "shapes: matrixPorts honours an HDMI output override");
ok(Shapes.mechanicalPorts().length === 0, "shapes: a mechanical part has no ports");

// The guard that matters: a shape emitting a connectionType outside the
// vocabulary would make every part it touches silently unwireable.
const connSet = new Set(CONNECTION_TYPES);
const badShape = Object.entries(Shapes.ALL_SHAPES).find(([, make]) =>
  make().some((prt) => !connSet.has(prt.connectionType))
);
ok(!badShape, `shapes: every shape emits only known connection types${badShape ? ` (offender: ${badShape[0]})` : ""}`);
```

`CONNECTION_TYPES` is already imported at the top of the test file — do not import it twice.

- [ ] **Step 2: Run it to verify it fails**

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts 2>&1 | head -12; rm -rf "$D"
```

Expected: the run aborts with `Cannot find module '@/lib/catalog-port-shapes'`.

- [ ] **Step 3: Create the shared module**

Create `src/lib/catalog-port-shapes.ts`. Move the definitions from `scripts/draft-starter-set.ts` (currently lines ~113-201) **verbatim** — same port names, directions, connection types and counts — adding `export` to each, and add the three new shapes from D197:

```ts
import { type Port, type PortDirection } from "@/lib/catalog-connect";

/**
 * Port shapes — what a class of device plugs into (#159, D194).
 *
 * These were private to scripts/draft-starter-set.ts. A human read real
 * datasheets to write them, which makes them the domain knowledge this whole
 * feature rests on; the rules engine only decides WHICH shape applies to a
 * part, it never invents one. Two drifting copies would produce a run that
 * looks clean and is quietly wrong, so there is exactly one — same reasoning
 * as scripts/daylite-ids.ts.
 *
 * Every connectionType below MUST be a member of CONNECTION_TYPES
 * (lib/catalog-connect). validateDeviceWire() resolves against that
 * vocabulary, so a typo here does not look wrong — it makes every part using
 * this shape unwireable against everything, silently. A test asserts this.
 */

const p = (name: string, direction: PortDirection, connectionType: string, count?: number): Port =>
  count !== undefined ? { name, direction, connectionType, count } : { name, direction, connectionType };

export const consolePorts = (): Port[] => [
  p("DMX Out", "out", "DMX512 (5-pin XLR)", 2),
  p("Network (sACN/Art-Net)", "io", "sACN/Art-Net (etherCON/Cat6)"),
];

export const wingPorts = (): Port[] => [
  p("Console Link (sACN/Art-Net)", "io", "sACN/Art-Net (etherCON/Cat6)"),
];

export const dimmerRackPorts = (outCount: number): Port[] => [
  p("DMX In", "in", "DMX512 (5-pin XLR)"),
  p("RDM", "io", "RDM"),
  p("Dimmed Power Out", "out", "stage pin", outCount),
];

export const conventionalFixturePorts = (): Port[] => [p("Power In", "in", "Edison")];

export const ledFixturePorts = (): Port[] => [
  p("DMX In", "in", "DMX512 (5-pin XLR)"),
  p("DMX Thru", "out", "DMX512 (5-pin XLR)"),
  p("Power In", "in", "powerCON/True1"),
];

export const ptzCameraPorts = (video: "HDMI" | "SDI/BNC"): Port[] => [p("Video Out", "out", video)];

export const encoderDecoderPorts = (): Port[] => [p("HDMI", "io", "HDMI")];

export const sdiCardPorts = (n: number): Port[] => [p("SDI In", "in", "SDI/BNC", n)];

export const captureOnlyPorts = (): Port[] => [p("HDMI In", "in", "HDMI")];

export const matrixPorts = (inN: number, outN: number, io: "HDMI" | "HDBaseT (Cat6a)" = "HDBaseT (Cat6a)"): Port[] => [
  p("HDMI In", "in", "HDMI", inN),
  p(io === "HDMI" ? "HDMI Out" : "HDBaseT Out", "out", io, outN),
];

export const hdbasetMatrixPorts = (inN: number, outN: number): Port[] => [
  p("HDBaseT In", "in", "HDBaseT (Cat6a)", inN),
  p("HDBaseT Out", "out", "HDBaseT (Cat6a)", outN),
];

export const extenderKitPorts = (): Port[] => [
  p("HDMI In (TX)", "in", "HDMI"),
  p("HDBaseT Out (RX)", "out", "HDBaseT (Cat6a)"),
];

export const splitterPorts = (outN: number): Port[] => [
  p("HDMI In", "in", "HDMI"),
  p("HDMI Out", "out", "HDMI", outN),
];

export const passiveSpeakerPorts = (): Port[] => [p("Audio In", "in", "speakON NL2")];

export const seventyVSpeakerPorts = (): Port[] => [p("Audio In (70V)", "in", "70V pair")];

export const poweredSpeakerPorts = (): Port[] => [
  p("Audio In", "in", "XLR line/mic"),
  p("Power In", "in", "powerCON/True1"),
];

export const mixerAllInOnePorts = (): Port[] => [
  p("XLR In", "in", "XLR line/mic"),
  p("XLR Out", "out", "XLR line/mic"),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

export const mixSurfacePorts = (): Port[] => [p("Network to MixRack (Dante/AES67)", "io", "Dante/AES67 (Cat6)")];

export const mixRackPorts = (inN: number, outN: number): Port[] => [
  p("XLR In", "in", "XLR line/mic", inN),
  p("XLR Out", "out", "XLR line/mic", outN),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

export const mechanicalPorts = (): Port[] => [];

export const motorHoistPorts = (): Port[] => [
  p("Motor Power In", "in", "motor power"),
  p("Pendant Control In", "in", "low-voltage pendant control"),
];

/* ---- new shapes (D197) ----
   Added deliberately, not derived by the engine. Each covers a device class
   that is classifiable from descriptions but had nowhere to land: 267 wireless
   receivers, 97 amplifiers, 27 DSPs across the in-scope brands. Reviewed
   alongside the rules that use them. */

/** Install amplifier: line-level in, speaker-level out, network for control. */
export const amplifierPorts = (outCount: number): Port[] => [
  p("Line In", "in", "XLR line/mic"),
  p("Speaker Out", "out", "speakON NL4", outCount),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

/** Wireless mic receiver: antennas are not modelled; the audio out is. */
export const wirelessReceiverPorts = (outCount: number): Port[] => [
  p("Audio Out", "out", "XLR line/mic", outCount),
  p("Network", "io", "Dante/AES67 (Cat6)"),
];

/** Fixed-architecture DSP / processor. */
export const dspPorts = (inN: number, outN: number): Port[] => [
  p("Analog In", "in", "XLR line/mic", inN),
  p("Analog Out", "out", "XLR line/mic", outN),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

/** Every shape, called with representative arguments. Used only by the
 *  vocabulary guard test — it is the one place that can prove no shape emits
 *  a connection type outside CONNECTION_TYPES. */
export const ALL_SHAPES: Record<string, () => Port[]> = {
  consolePorts, wingPorts,
  dimmerRackPorts: () => dimmerRackPorts(12),
  conventionalFixturePorts, ledFixturePorts,
  ptzCameraPorts: () => ptzCameraPorts("SDI/BNC"),
  encoderDecoderPorts,
  sdiCardPorts: () => sdiCardPorts(4),
  captureOnlyPorts,
  matrixPorts: () => matrixPorts(4, 4),
  hdbasetMatrixPorts: () => hdbasetMatrixPorts(4, 4),
  extenderKitPorts,
  splitterPorts: () => splitterPorts(4),
  passiveSpeakerPorts, seventyVSpeakerPorts, poweredSpeakerPorts,
  mixerAllInOnePorts, mixSurfacePorts,
  mixRackPorts: () => mixRackPorts(16, 8),
  mechanicalPorts, motorHoistPorts,
  amplifierPorts: () => amplifierPorts(4),
  wirelessReceiverPorts: () => wirelessReceiverPorts(2),
  dspPorts: () => dspPorts(8, 8),
};
```

- [ ] **Step 4: Make `draft-starter-set.ts` import them**

In `scripts/draft-starter-set.ts`, delete the local `const p = …` and every local shape definition (lines ~113-201), and add to the imports at the top (beside the existing `../src/lib/catalog-connect` import):

```ts
import {
  consolePorts, wingPorts, dimmerRackPorts, conventionalFixturePorts, ledFixturePorts,
  ptzCameraPorts, encoderDecoderPorts, sdiCardPorts, captureOnlyPorts, matrixPorts,
  hdbasetMatrixPorts, extenderKitPorts, splitterPorts, passiveSpeakerPorts,
  seventyVSpeakerPorts, poweredSpeakerPorts, mixerAllInOnePorts, mixSurfacePorts,
  mixRackPorts, mechanicalPorts, motorHoistPorts,
} from "../src/lib/catalog-port-shapes";
```

Keep the explanatory comment block that sat above the definitions — move it or leave it in place; it explains the picks.

If `PortDirection` is now unused in that file, remove it from its import to avoid a new eslint warning. Leave `CONNECTION_TYPES` and `Port` if still used.

- [ ] **Step 5: Prove the extraction changed nothing**

The script writes `scripts/starter-import-data.json`. Capture it before and after to prove the move is behaviour-preserving:

```bash
git show HEAD:scripts/starter-import-data.json > /tmp/starter-before.json
npx tsx scripts/draft-starter-set.ts
diff <(python3 -m json.tool /tmp/starter-before.json) <(python3 -m json.tool scripts/starter-import-data.json) && echo "IDENTICAL — extraction is behaviour-preserving"
```

Expected: `IDENTICAL`. If it differs, a shape was altered during the move — fix it rather than accepting the new output. Then restore any incidental churn: `git checkout -- scripts/starter-import-data.json docs/catalog/` if those files were rewritten with only timestamp changes.

- [ ] **Step 6: Run the tests and the gates**

```bash
npx tsc --noEmit && echo TSC-OK
npx eslint src/lib/catalog-port-shapes.ts scripts/draft-starter-set.ts; echo "ESLINT=$?"
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts > /tmp/t.log 2>&1; rm -rf "$D"
echo "PASS=$(grep -c '^PASS' /tmp/t.log) FAIL=$(grep -c '^FAIL' /tmp/t.log)"
grep -E "^(PASS|FAIL) shapes:" /tmp/t.log
```

Expected: `TSC-OK`, `ESLINT=0` with no errors, 7 `PASS shapes:` lines, FAIL still 5.

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog-port-shapes.ts scripts/draft-starter-set.ts scripts/test-review-and-spec.ts
git commit -m "refactor(catalog): extract port shapes to one shared module (#159, D194, D197)"
```

---

## Task 2: The rule type and the matcher

**Files:**
- Create: `src/lib/catalog-port-rules.ts`
- Test: `scripts/test-review-and-spec.ts` (module level, after the Task 1 block)

**Interfaces:**
- Consumes: the shape helpers from Task 1; `Port` from `@/lib/catalog-connect`.
- Produces:
  - `type RulePart = { sku: string; desc: string; category: string; mfr?: string }`
  - `type PortRule = { id: string; mfr?: string; category?: RegExp; desc: RegExp; exclude?: RegExp; shape: (part: RulePart) => Port[]; accessory?: true; note: string }`
  - `matchRule(part: RulePart, rules?: readonly PortRule[]): PortRule | null`
  - `proposeForPart(part: RulePart, rules?: readonly PortRule[]): { rule: PortRule; ports: Port[] } | null` — returns `null` for no match AND for an accessory match (an accessory yields no ports by definition); callers distinguish the two with `matchRule`.
  - `PORT_RULES: readonly PortRule[]` — populated in Task 3; an empty array here is expected.

Note `shape` takes the part. Most rules ignore it, but counts like "4 Channel amplifier" are read off the description, so the signature must allow it from the start rather than being widened later.

- [ ] **Step 1: Write the failing test**

```ts
/* --- #159 Task 2: the rule matcher --- */
import { matchRule, proposeForPart, type PortRule, type RulePart } from "@/lib/catalog-port-rules";

const rpart = (desc: string, extra: Partial<RulePart> = {}): RulePart =>
  ({ sku: "X:1", desc, category: "Audio", mfr: "EAW", ...extra });

const testRules: PortRule[] = [
  { id: "acc", desc: /\b(bracket|cover)\b/i, accessory: true, shape: () => [], note: "accessory" },
  { id: "passive", mfr: "EAW", desc: /passive.*(sub|speaker)/i, shape: () => Shapes.passiveSpeakerPorts(), note: "passive box" },
  { id: "any-speaker", desc: /speaker/i, shape: () => Shapes.poweredSpeakerPorts(), note: "fallback" },
];

ok(matchRule(rpart("Passive 18\" Subwoofer"), testRules)?.id === "passive", "rules: the first matching rule wins");
ok(matchRule(rpart("Powered speaker"), testRules)?.id === "any-speaker", "rules: a later rule matches when earlier ones do not");
ok(matchRule(rpart("Mounting bracket for speaker"), testRules)?.id === "acc", "rules: the accessory layer beats a device rule");
ok(matchRule(rpart("Passive 18\" Subwoofer", { mfr: "RCF" }), testRules)?.id === "any-speaker", "rules: an mfr-scoped rule does not match another brand");
ok(matchRule(rpart("Widget"), testRules) === null, "rules: an unmatched part yields null, never a guess");

const acc = proposeForPart(rpart("Mounting bracket for speaker"), testRules);
ok(acc === null, "rules: an accessory proposes no ports");
const prop = proposeForPart(rpart("Passive 18\" Subwoofer"), testRules);
ok(prop?.ports[0].connectionType === "speakON NL2", "rules: a device match proposes its shape's ports");
ok(prop?.rule.id === "passive", "rules: the proposal names the rule that produced it, for the report");

const excl: PortRule[] = [
  { id: "sub-only", desc: /subwoofer/i, exclude: /passive/i, shape: () => Shapes.poweredSpeakerPorts(), note: "powered subs" },
];
ok(matchRule(rpart("Passive 18\" Subwoofer"), excl) === null, "rules: exclude suppresses an otherwise-matching rule");
ok(matchRule(rpart("Powered 18\" Subwoofer"), excl)?.id === "sub-only", "rules: exclude does not suppress a non-matching description");

const catRule: PortRule[] = [
  { id: "sb", category: /^SB$/, desc: /./, shape: () => Shapes.passiveSpeakerPorts(), note: "EAW SB line" },
];
ok(matchRule(rpart("anything", { category: "SB" }), catRule)?.id === "sb", "rules: a category pattern matches");
ok(matchRule(rpart("anything", { category: "Audio" }), catRule) === null, "rules: a category pattern that misses blocks the rule");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts 2>&1 | head -12; rm -rf "$D"
```

Expected: `Cannot find module '@/lib/catalog-port-rules'`.

- [ ] **Step 3: Write the module**

Create `src/lib/catalog-port-rules.ts`:

```ts
import { type Port } from "@/lib/catalog-connect";

/**
 * Port rules (#159, D193) — an ordered list matched first-wins against a
 * catalog part to decide WHICH port shape applies.
 *
 * The list is the reviewable artifact: Jeff approves, edits or rejects a RULE,
 * and that verdict covers every part it matched. Review effort therefore
 * scales with rules (~30) rather than parts (thousands), and a rule is
 * checkable from experience in a way an individual row is not.
 *
 * First match wins, deliberately. A scored best-match would make "why did this
 * part get these ports?" unanswerable, and answering that is the entire point
 * of reviewing rules.
 */

/** The part fields a rule may look at. Deliberately narrow. */
export type RulePart = { sku: string; desc: string; category: string; mfr?: string };

export type PortRule = {
  /** Stable id — this is what gets named in `--rules` to approve it. */
  id: string;
  /** Exact manufacturer, when the rule is brand-specific. */
  mfr?: string;
  category?: RegExp;
  desc: RegExp;
  /** Description patterns this rule must NOT match. */
  exclude?: RegExp;
  shape: (part: RulePart) => Port[];
  /** Match means "no ports, deliberately" — an accessory, not a miss (D195). */
  accessory?: true;
  /** Why this rule is correct. Read during review; keep it a real reason. */
  note: string;
};

/** Populated in Task 3. */
export const PORT_RULES: readonly PortRule[] = [];

export function matchRule(
  part: RulePart,
  rules: readonly PortRule[] = PORT_RULES
): PortRule | null {
  for (const rule of rules) {
    if (rule.mfr && rule.mfr !== (part.mfr || "")) continue;
    if (rule.category && !rule.category.test(part.category || "")) continue;
    if (!rule.desc.test(part.desc || "")) continue;
    if (rule.exclude && rule.exclude.test(part.desc || "")) continue;
    return rule;
  }
  return null;
}

/**
 * The ports a rule proposes for a part, or null when nothing applies.
 *
 * An ACCESSORY match also returns null — it has no ports by definition. That
 * is a success, not a miss, and the two must not be conflated in the report or
 * 907 correctly-ignored brackets would hide the real coverage gaps (D195).
 * Callers that need the distinction use matchRule() and check `.accessory`.
 */
export function proposeForPart(
  part: RulePart,
  rules: readonly PortRule[] = PORT_RULES
): { rule: PortRule; ports: Port[] } | null {
  const rule = matchRule(part, rules);
  if (!rule || rule.accessory) return null;
  return { rule, ports: rule.shape(part) };
}
```

- [ ] **Step 4: Run the tests**

```bash
npx tsc --noEmit && D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts > /tmp/t.log 2>&1; rm -rf "$D"
grep -cE "^PASS rules:" /tmp/t.log; grep -E "^FAIL rules:" /tmp/t.log || echo "no rules failures"
echo "FAIL total=$(grep -c '^FAIL' /tmp/t.log)"
```

Expected: 11 `PASS rules:` lines, no `FAIL rules:`, FAIL total 5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-port-rules.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): port-rule type and first-match-wins matcher (#159, D193, D195)"
```

---

## Task 3: The rule set

**Files:**
- Modify: `src/lib/catalog-port-rules.ts` (populate `PORT_RULES`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `PortRule` and the shape helpers.
- Produces: a populated `PORT_RULES`.

**This task is domain judgement, not mechanics.** Every rule needs a `note` that states why it is correct, because the note is what gets reviewed. Write the accessory layer FIRST in the list — order is the disambiguation mechanism.

- [ ] **Step 1: Write the failing test**

```ts
/* --- #159 Task 3: the shipped rule set --- */
import { PORT_RULES } from "@/lib/catalog-port-rules";

ok(PORT_RULES.length > 0, "ruleset: rules are defined");
ok(PORT_RULES.filter((r) => r.accessory).length > 0, "ruleset: an accessory layer exists");
ok(PORT_RULES.findIndex((r) => r.accessory) < PORT_RULES.findIndex((r) => !r.accessory),
  "ruleset: the accessory layer is ordered BEFORE device rules, so a bracket never gets device ports");
ok(new Set(PORT_RULES.map((r) => r.id)).size === PORT_RULES.length, "ruleset: rule ids are unique");
ok(PORT_RULES.every((r) => r.note.trim().length > 10), "ruleset: every rule carries a real note for review");

// The vocabulary guard again, at the rule level this time.
const rConn = new Set(CONNECTION_TYPES);
const badRule = PORT_RULES.filter((r) => !r.accessory).find((r) =>
  r.shape({ sku: "T:1", desc: "4 Channel", category: "Audio", mfr: r.mfr }).some((prt) => !rConn.has(prt.connectionType))
);
ok(!badRule, `ruleset: every rule emits only known connection types${badRule ? ` (offender: ${badRule.id})` : ""}`);

// A bracket must never reach a device rule.
ok(matchRule({ sku: "RCF:X", desc: "Horizontal Bracket for MR50", category: "Audio", mfr: "RCF" })?.accessory === true,
  "ruleset: a real bracket description matches the accessory layer");
ok(matchRule({ sku: "EAW:SB1002", desc: 'Passive 18" Installation Subwoofer. Black', category: "SB", mfr: "EAW" })?.accessory !== true,
  "ruleset: a real passive subwoofer description does NOT match the accessory layer");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts > /tmp/t.log 2>&1; rm -rf "$D"
grep -E "^FAIL ruleset:" /tmp/t.log
```

Expected: `FAIL ruleset: rules are defined` and several others — `PORT_RULES` is still empty.

- [ ] **Step 3: Populate `PORT_RULES`**

Replace `export const PORT_RULES: readonly PortRule[] = [];` with the list below. **Read the real descriptions before finalising** — run this first to see what you are matching against:

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx -e '
import { getDb } from "./src/db"; import { catalogParts } from "./src/db/doc-tables";
(async () => { const db = await getDb();
  for (const r of await db.select().from(catalogParts)) {
    const d = r.doc as Record<string, unknown>;
    if (["EAW","RCF","QSC","Shure","AVPro Edge","Chauvet Professional"].includes(String(d.mfr||"")))
      console.log(`${d.mfr}\t${d.category}\t${String(d.desc).slice(0,80)}`);
  } process.exit(0); })();
' > /tmp/descs.tsv 2>/dev/null; rm -rf "$D"; shuf -n 60 /tmp/descs.tsv
```

```ts
export const PORT_RULES: readonly PortRule[] = [
  /* ---- accessory layer: FIRST, always (D195) ----
     907 of 5,657 in-scope parts are accessories. Without this layer a
     "Horizontal Bracket for MR50" falls through to a speaker rule and is given
     speaker ports. A match here is a deliberate success, not a miss. */
  {
    id: "accessory",
    desc: /\b(cover|bracket|mount(ing)?|rack ?ear|bag|case|cable|cord|adapter plate|barndoor|barn door|gel frame|clamp|yoke|spare|pole|stand|grille|grill|filter|lamp|bulb|screw|washer|blank|carry|pouch|strap|wheel|caster|handle|dust|lens tube)\b/i,
    accessory: true,
    shape: () => [],
    note: "Physical accessories have no electrical ports. Ordered first so a device rule can never claim a bracket.",
  },

  /* ---- speakers (658 in-scope parts) ---- */
  {
    id: "speaker-passive",
    desc: /\bpassive\b/i,
    exclude: /\b(amplifier|amp|dsp|processor)\b/i,
    shape: () => passiveSpeakerPorts(),
    note: "A passive box has no amplifier and no power inlet — a single speakON NL2 input is the install standard.",
  },
  {
    id: "speaker-70v",
    desc: /\b(70 ?v|100 ?v|constant voltage|transformer)\b/i,
    shape: () => seventyVSpeakerPorts(),
    note: "70V/100V distributed lines take a transformer-tapped pair, not speakON.",
  },
  {
    id: "speaker-powered",
    desc: /\b(powered|active|self-?powered)\b.*\b(speaker|monitor|subwoofer|sub|array|column)\b|\b(speaker|monitor|subwoofer|sub|array|column)\b.*\b(powered|active)\b/i,
    shape: () => poweredSpeakerPorts(),
    note: "A powered box carries its own amp: line input plus a mains inlet.",
  },

  /* ---- amplifiers (97) — new shape, D197 ---- */
  {
    id: "amplifier",
    desc: /\bamp(lifier)?\b/i,
    exclude: /\b(bracket|cover|card|module|accessory)\b/i,
    shape: (part) => amplifierPorts(channelCount(part.desc, 4)),
    note: "Install amps take line in, speaker-level out, and a control network. Channel count is read from the description, defaulting to 4.",
  },

  /* ---- wireless mic systems (267) — new shape, D197 ---- */
  {
    id: "wireless-receiver",
    desc: /\breceiver\b/i,
    exclude: /\b(bracket|antenna|cover|kit bag)\b/i,
    shape: (part) => wirelessReceiverPorts(channelCount(part.desc, 1)),
    note: "A wireless receiver's audio output is what gets wired; antennas are RF and deliberately not modelled.",
  },

  /* ---- DSP (27) — new shape, D197 ---- */
  {
    id: "dsp",
    desc: /\b(dsp|processor|tesira|q-?sys core)\b/i,
    exclude: /\b(card|module|expander|bracket)\b/i,
    shape: () => dspPorts(8, 8),
    note: "Fixed-architecture DSP: analog in/out plus the audio network. 8x8 is the common install size; a specific model that differs gets corrected in the editor.",
  },

  /* ---- AV distribution (78) ---- */
  {
    id: "av-matrix",
    desc: /\bmatrix\b/i,
    shape: (part) => matrixPorts(portCount(part.desc, "in", 4), portCount(part.desc, "out", 4)),
    note: "An HDMI/HDBaseT matrix: input and output counts are read from an NxM in the description, defaulting to 4x4.",
  },
  {
    id: "av-extender",
    desc: /\bextender|extension kit|\btx\/rx\b/i,
    shape: () => extenderKitPorts(),
    note: "An extender kit is one HDMI input at the transmitter and one HDBaseT run to the receiver.",
  },
  {
    id: "av-splitter",
    desc: /\bsplitter|distribution amplifier\b/i,
    shape: (part) => splitterPorts(portCount(part.desc, "out", 4)),
    note: "A splitter takes one HDMI in and fans out; the output count is read from the description.",
  },

  /* ---- cameras (2) ---- */
  {
    id: "camera-ptz",
    desc: /\bptz\b|\bcamera\b/i,
    exclude: /\bbracket|mount|cover\b/i,
    shape: (part) => ptzCameraPorts(/\bsdi\b/i.test(part.desc) ? "SDI/BNC" : "HDMI"),
    note: "A PTZ camera's wired output is SDI when the description says so, otherwise HDMI.",
  },

  /* ---- lighting fixtures (23) ---- */
  {
    id: "fixture-led",
    desc: /\b(led|colordash|colorado|ovation|rogue|maverick)\b/i,
    exclude: /\b(bracket|barndoor|lens|gel|accessory)\b/i,
    shape: () => ledFixturePorts(),
    note: "An LED fixture is DMX in, DMX thru, and a powerCON mains inlet.",
  },

  /* ---- mixers (18) ---- */
  {
    id: "mixer",
    desc: /\bmixer|mixing console\b/i,
    exclude: /\b(bracket|cover|bag)\b/i,
    shape: () => mixerAllInOnePorts(),
    note: "An all-in-one mixer: XLR in and out plus the audio network.",
  },
];
```

Add these two helpers above `PORT_RULES` in the same file:

```ts
/** "4 Channel amplifier" -> 4. Falls back when the description says nothing. */
function channelCount(desc: string, fallback: number): number {
  const m = /(\d{1,2})\s*[-\s]?(?:channel|ch\b)/i.exec(desc || "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : fallback;
}

/** "8x8 matrix" / "1x4 splitter" -> the requested side. */
function portCount(desc: string, side: "in" | "out", fallback: number): number {
  const m = /(\d{1,2})\s*[x×]\s*(\d{1,2})/i.exec(desc || "");
  if (!m) return fallback;
  const n = Number(side === "in" ? m[1] : m[2]);
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : fallback;
}
```

Import the shape helpers at the top of `catalog-port-rules.ts`:

```ts
import {
  passiveSpeakerPorts, seventyVSpeakerPorts, poweredSpeakerPorts, amplifierPorts,
  wirelessReceiverPorts, dspPorts, matrixPorts, extenderKitPorts, splitterPorts,
  ptzCameraPorts, ledFixturePorts, mixerAllInOnePorts,
} from "@/lib/catalog-port-shapes";
```

- [ ] **Step 4: Run the tests and add count-helper assertions**

Add these beside the Task 3 assertions:

```ts
ok(matchRule({ sku: "QSC:X", desc: "RU 4 Channel ENERGY STAR amplifier", category: "Audio", mfr: "QSC" })?.id === "amplifier",
  "ruleset: a real QSC amplifier description matches the amplifier rule");
const ampProp = proposeForPart({ sku: "QSC:X", desc: "RU 4 Channel ENERGY STAR amplifier", category: "Audio", mfr: "QSC" });
ok(ampProp?.ports.find((prt) => prt.name === "Speaker Out")?.count === 4,
  "ruleset: the amplifier rule reads its channel count from the description");
const mtx = proposeForPart({ sku: "AV:X", desc: "8x8 HDBaseT Matrix Switcher", category: "AV Distribution", mfr: "AVPro Edge" });
ok(mtx?.ports[0].count === 8 && mtx?.ports[1].count === 8, "ruleset: a matrix reads NxM from the description");
```

```bash
npx tsc --noEmit && D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts > /tmp/t.log 2>&1; rm -rf "$D"
grep -cE "^PASS ruleset:" /tmp/t.log; grep -E "^FAIL ruleset:" /tmp/t.log || echo "no ruleset failures"
```

Expected: 11 `PASS ruleset:` lines, none failing, FAIL total still 5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-port-rules.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): the shipped port-rule set, accessory layer first (#159)"
```

---

## Task 4: The report CLI

**Files:**
- Create: `scripts/port-rules.ts`
- Modify: `package.json` (add the `ports:rules` script)

**Interfaces:**
- Consumes: `PORT_RULES`, `matchRule`, `proposeForPart`, `RulePart`; `resolveDbTarget` from `./db-target`.
- Produces: a read-only report. No writes in this task.

- [ ] **Step 1: Write the CLI**

Create `scripts/port-rules.ts`:

```ts
/**
 * Port rules — report what each rule would do (#159).
 *
 *   npm run ports:rules                      → the report, writes nothing
 *   npm run ports:rules -- --mfr=EAW         → one manufacturer
 *
 * The report IS the review artifact (D193): Jeff reads the rules, not the
 * parts, and replies with the ids to apply. Task 5 adds the apply path.
 */
import { resolveDbTarget } from "./db-target";
import { PORT_RULES, matchRule, proposeForPart, type RulePart } from "../src/lib/catalog-port-rules";

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--mfr=")) || "").slice(6);
/** Brands whose descriptions are bare part numbers — reported, never guessed (D192). */
const NO_DESC_BRANDS = ["Biamp", "JBL"];
/** A description that is really a model/part number, not prose. */
function isModelish(desc: string, sku: string): boolean {
  const d = (desc || "").trim();
  if (!d) return true;
  if (!/\s/.test(d)) return true;
  if (/^[\d.\-]+$/.test(d)) return true;
  const bare = sku.includes(":") ? sku.slice(sku.indexOf(":") + 1) : sku;
  return d.replace(/[^a-z0-9]/gi, "").toUpperCase() === bare.replace(/[^a-z0-9]/gi, "").toUpperCase();
}
const n = (x: number) => x.toLocaleString("en-US");

async function main() {
  resolveDbTarget("port rules report");
  const { getDb } = await import("../src/db");
  const { catalogParts } = await import("../src/db/doc-tables");
  const db = await getDb();
  const rows = await db.select().from(catalogParts);

  type Row = RulePart & { hasPorts: boolean };
  const parts: Row[] = [];
  for (const r of rows) {
    if ((r as { deleted?: boolean }).deleted) continue;
    const d = r.doc as Record<string, unknown>;
    const mfr = String(d.mfr || "");
    if (only && mfr !== only) continue;
    const ports = d.ports as unknown[] | undefined;
    parts.push({
      sku: String(d.sku || ""), desc: String(d.desc || ""),
      category: String(d.category || ""), mfr,
      hasPorts: Array.isArray(ports) && ports.length > 0,
    });
  }

  const matchedBy = new Map<string, Row[]>();
  const unmatched: Row[] = [];
  let accessories = 0, alreadyPorted = 0, noDesc = 0;

  for (const part of parts) {
    if (part.hasPorts) { alreadyPorted++; continue; }
    if (isModelish(part.desc, part.sku)) { noDesc++; continue; }
    const rule = matchRule(part);
    if (!rule) { unmatched.push(part); continue; }
    if (rule.accessory) { accessories++; continue; }
    const list = matchedBy.get(rule.id) || [];
    list.push(part);
    matchedBy.set(rule.id, list);
  }

  // Denominator for the over-broad guard: inferable parts per manufacturer —
  // excluding accessories and description-less rows, so the ratio measures
  // what it sounds like.
  const inferablePerMfr = new Map<string, number>();
  for (const part of parts) {
    if (part.hasPorts || isModelish(part.desc, part.sku)) continue;
    const rule = matchRule(part);
    if (rule?.accessory) continue;
    inferablePerMfr.set(part.mfr, (inferablePerMfr.get(part.mfr) || 0) + 1);
  }

  console.log("\nPort rules — proposal report (nothing is written)");
  console.log("=".repeat(72));

  for (const rule of PORT_RULES) {
    if (rule.accessory) continue;
    const hits = matchedBy.get(rule.id) || [];
    if (!hits.length) { console.log(`\n${rule.id}\n  matches nothing`); continue; }
    const sample = hits[0];
    const ports = proposeForPart(sample)?.ports || [];
    console.log(`\n${rule.id}${rule.mfr ? `  ·  ${rule.mfr}` : ""}`);
    console.log(`  proposes: ${ports.map((p) => `${p.name} [${p.direction}${p.count ? ` ×${p.count}` : ""}: ${p.connectionType}]`).join("; ") || "(none)"}`);
    console.log(`  note: ${rule.note}`);
    console.log(`  matches ${n(hits.length)} parts, e.g.`);
    for (const h of hits.slice(0, 4)) console.log(`    ${h.sku.padEnd(26)} ${h.desc.slice(0, 60)}`);

    // Over-broad guard: one greedy regex quietly mislabelling hundreds of
    // parts is this engine's worst failure mode, and a match count is the
    // cheapest detector. A warning, not a refusal.
    for (const [mfr, total] of inferablePerMfr) {
      const share = hits.filter((h) => h.mfr === mfr).length / total;
      if (total >= 20 && share > 0.4)
        console.log(`  ⚠ OVER-BROAD: matches ${Math.round(share * 100)}% of ${mfr}'s inferable parts — check the pattern`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(`  parts considered            ${n(parts.length)}`);
  console.log(`  already have ports (skipped) ${n(alreadyPorted)}`);
  console.log(`  no usable description        ${n(noDesc)}   <- ${NO_DESC_BRANDS.join(" / ")} and similar (D192)`);
  console.log(`  accessories (no ports, ok)   ${n(accessories)}`);
  console.log(`  matched by a rule            ${n([...matchedBy.values()].reduce((a, l) => a + l.length, 0))}`);
  console.log(`  matched by NOTHING           ${n(unmatched.length)}`);
  console.log(`\n  To apply: npm run ports:rules -- --apply --rules <id,id> --yes`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `package.json`, beside the other `tsx` scripts:

```json
"ports:rules": "tsx scripts/port-rules.ts",
```

- [ ] **Step 3: Run the report**

```bash
npx tsc --noEmit && echo TSC-OK
npm run ports:rules 2>&1 | tail -40
```

Expected: `TSC-OK`, then a report listing each rule with match counts and samples, ending in the totals block. It **writes nothing** — verify with `git status --short` (only `package.json` and the new script should appear).

Read the output critically. If a rule shows `⚠ OVER-BROAD`, or its samples are obviously the wrong kind of device, fix the pattern in `catalog-port-rules.ts` and re-run before committing. That is the point of this task.

- [ ] **Step 4: Commit**

```bash
git add scripts/port-rules.ts package.json
git commit -m "feat(catalog): port-rules report — review rules, not rows (#159, D193)"
```

---

## Task 5: The apply path

**Files:**
- Create: `src/lib/catalog-port-apply.ts`
- Modify: `scripts/port-rules.ts` (import `applyRules`, add the `--apply` branch)
- Test: `scripts/test-review-and-spec.ts` (inside `asyncChecks()`, after the existing `#158` blocks, before its closing brace)

**Interfaces:**
- Consumes: `PORT_RULES`, `proposeForPart`, `RulePart` from `@/lib/catalog-port-rules`; `mergeUpsert` from `@/lib/stores/catalog`; `requireHostedConfirmation` from `./db-target`.
- Produces: `applyRules(ruleIds: readonly string[], opts: { commit: boolean }): Promise<ApplyResult>` where `ApplyResult = { applied: number; skippedHasPorts: number; byRule: Record<string, number> }`, exported from **`src/lib/catalog-port-apply.ts`**.

**Why a lib module and not the script:** every script in this repo calls
`main()` at module scope, so importing `scripts/port-rules.ts` from a test
would execute the CLI. The DB-touching logic therefore lives in
`src/lib/catalog-port-apply.ts` and the CLI stays a thin wrapper — the same
split as #158's `src/lib/geo-backfill.ts` + `scripts/enrich-addresses.ts`.

**Do NOT put a bare `return` inside `asyncChecks()`** — it silently skips every assertion after it in the shared suite. Use a conditional block. Follow the neighbouring `#158` blocks' `try { … } finally { … }` + `softDeleteDoc` teardown convention for fixtures.

- [ ] **Step 1: Write the failing test**

Add inside `asyncChecks()`:

```ts
  /* --- #159 Task 5: applying named rules --- */
  {
    const { mergeUpsert, get: getPart } = await import("@/lib/stores/catalog");
    const { softDeleteDoc } = await import("@/db/doc-store");
    const { applyRules } = await import("@/lib/catalog-port-apply");
    try {
      await mergeUpsert("TEST:RULE-SPK", { desc: 'Passive 18" Installation Subwoofer. Black', category: "SB", unit: "ea", list: 1, cost: 1, mfr: "EAW" });
      await mergeUpsert("TEST:RULE-AMP", { desc: "RU 4 Channel ENERGY STAR amplifier", category: "Audio", unit: "ea", list: 1, cost: 1, mfr: "QSC" });
      await mergeUpsert("TEST:RULE-HAND", { desc: 'Passive 15" Installation Subwoofer. Black', category: "SB", unit: "ea", list: 1, cost: 1, mfr: "EAW",
        ports: [{ name: "Hand edited", direction: "in", connectionType: "speakON NL4" }] });

      const res = await applyRules(["speaker-passive"], { commit: true });

      const spk = await getPart("TEST:RULE-SPK");
      ok((spk?.ports || []).length === 1 && spk?.ports?.[0].connectionType === "speakON NL2",
        "apply: a named rule ports the parts it matched");

      const amp = await getPart("TEST:RULE-AMP");
      ok((amp?.ports || []).length === 0, "apply: a rule that was NOT named leaves its parts alone");

      const hand = await getPart("TEST:RULE-HAND");
      ok(hand?.ports?.[0].name === "Hand edited", "apply: a hand-edited part is never overwritten (D196)");
      ok(res.skippedHasPorts >= 1, "apply: the result counts parts skipped for having ports");

      const again = await applyRules(["speaker-passive"], { commit: true });
      ok(again.applied === 0, "apply: a second run is a no-op — idempotent");

      const dry = await applyRules(["amplifier"], { commit: false });
      ok(dry.applied > 0, "apply: a dry run reports what it would do");
      const ampStill = await getPart("TEST:RULE-AMP");
      ok((ampStill?.ports || []).length === 0, "apply: a dry run writes nothing");
    } finally {
      await softDeleteDoc("catalog_parts", "TEST:RULE-SPK");
      await softDeleteDoc("catalog_parts", "TEST:RULE-AMP");
      await softDeleteDoc("catalog_parts", "TEST:RULE-HAND");
    }
  }
```

- [ ] **Step 2: Run it to verify it fails**

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts > /tmp/t.log 2>&1; rm -rf "$D"
grep -E "^(FAIL|PASS) apply:" /tmp/t.log; grep -c "applyRules" /tmp/t.log
```

Expected: failure — `applyRules` is not exported from `scripts/port-rules.ts`.

- [ ] **Step 3: Create `src/lib/catalog-port-apply.ts`**

```ts
import { PORT_RULES, proposeForPart, type RulePart } from "@/lib/catalog-port-rules";

/**
 * Applying port rules (#159, D196) — the DB-touching half, kept out of the
 * CLI so tests can import it without executing a script's main().
 */

export type ApplyResult = { applied: number; skippedHasPorts: number; byRule: Record<string, number> };

/**
 * Apply ONLY the named rules. Nothing runs without being named (D196) — there
 * is deliberately no "apply all".
 *
 * A part that already has ports is skipped unconditionally: hand edits beat
 * the engine, always. That makes re-running safe and idempotent, so improving
 * a rule and re-running costs nothing.
 *
 * Writes `ports` and nothing else.
 */
export async function applyRules(
  ruleIds: readonly string[],
  opts: { commit: boolean }
): Promise<ApplyResult> {
  const { getDb } = await import("@/db");
  const { catalogParts } = await import("@/db/doc-tables");
  const { mergeUpsert } = await import("@/lib/stores/catalog");
  const wanted = new Set(ruleIds);
  const db = await getDb();
  const rows = await db.select().from(catalogParts);
  const res: ApplyResult = { applied: 0, skippedHasPorts: 0, byRule: {} };

  for (const r of rows) {
    if ((r as { deleted?: boolean }).deleted) continue;
    const d = r.doc as Record<string, unknown>;
    const part: RulePart = {
      sku: String(d.sku || ""), desc: String(d.desc || ""),
      category: String(d.category || ""), mfr: String(d.mfr || ""),
    };
    if (!part.sku) continue;
    const existing = d.ports as unknown[] | undefined;
    const proposal = proposeForPart(part);
    if (!proposal || !wanted.has(proposal.rule.id)) continue;
    if (Array.isArray(existing) && existing.length > 0) { res.skippedHasPorts++; continue; }
    if (opts.commit) await mergeUpsert(part.sku, { ports: proposal.ports });
    res.applied++;
    res.byRule[proposal.rule.id] = (res.byRule[proposal.rule.id] || 0) + 1;
  }
  return res;
}
```

`PORT_RULES` is imported for the id-validation the CLI does; if the linter flags it as unused here, drop it from this module's import and validate ids in the CLI instead.

Then in `scripts/port-rules.ts`, import it and add the `--apply` branch in `main()` before the report block:

```ts
import { applyRules } from "../src/lib/catalog-port-apply";
```


```ts
  if (args.includes("--apply")) {
    const idsArg = (args.find((a) => a.startsWith("--rules=")) || "").slice(8)
      || args[args.indexOf("--rules") + 1] || "";
    const ids = idsArg.split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) {
      console.error("--apply needs --rules <id,id>. Nothing applies by default.");
      process.exit(1);
    }
    const unknown = ids.filter((id) => !PORT_RULES.some((r) => r.id === id));
    if (unknown.length) {
      console.error(`Unknown rule id(s): ${unknown.join(", ")}`);
      process.exit(1);
    }
    const commit = args.includes("--yes");
    const { hosted } = resolveDbTarget("port rules apply");
    if (commit) requireHostedConfirmation(hosted, args);
    const out = await applyRules(ids, { commit });
    console.log(`\n${commit ? "APPLIED" : "DRY RUN"} — rules: ${ids.join(", ")}`);
    for (const [id, count] of Object.entries(out.byRule)) console.log(`  ${String(count).padStart(6)}  ${id}`);
    console.log(`  ${String(out.applied).padStart(6)}  total ${commit ? "written" : "would be written"}`);
    console.log(`  ${String(out.skippedHasPorts).padStart(6)}  skipped — already have ports (hand edits win)`);
    if (!commit) console.log("\n  DRY RUN — nothing written. Add --yes to apply.");
    process.exit(0);
  }
```

Import `requireHostedConfirmation` alongside `resolveDbTarget`. Move the existing `resolveDbTarget("port rules report")` call so it is not made twice.

- [ ] **Step 4: Run the tests and the gates**

```bash
npx tsc --noEmit && echo TSC-OK
npx eslint scripts/port-rules.ts src/lib/catalog-port-rules.ts src/lib/catalog-port-shapes.ts; echo "ESLINT=$?"
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts > /tmp/t.log 2>&1; rm -rf "$D"
echo "PASS=$(grep -c '^PASS' /tmp/t.log) FAIL=$(grep -c '^FAIL' /tmp/t.log)"
grep -E "^(PASS|FAIL) apply:" /tmp/t.log
npx tsx scripts/smoke-routes.ts 2>&1 | tail -2
```

Expected: `TSC-OK`, `ESLINT=0`, 7 `PASS apply:` lines, FAIL still 5, `ALL PASSED` from smoke.

- [ ] **Step 5: Verify the dry run against the real catalog**

```bash
npm run ports:rules -- --apply --rules speaker-passive 2>&1 | tail -8
git status --short
```

Expected: a `DRY RUN` block with a count, and a clean `git status` — no `.data` changes, nothing written.

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-port-apply.ts scripts/port-rules.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): apply named port rules, hand edits always win (#159, D196)"
```

---

## Task 6: Bookkeeping

**Files:**
- Modify: `PUNCHLIST.md`, `DECISIONS.md`

- [ ] **Step 1: Verify the numbers are still free**

```bash
git fetch origin
git show origin/main:PUNCHLIST.md | grep -cE "^## 159\."
git show origin/main:DECISIONS.md | grep -cE "^## D19[2-7]\."
```

Both must print `0`. If either is non-zero, another session took them — renumber to the next free values, update every reference in the spec, this plan and the code comments, and say clearly what you used instead.

- [ ] **Step 2: Write the entries**

Add `## 159.` to `PUNCHLIST.md` in numeric position, matching the file's existing format (read neighbouring entries — title line with a status, then **Reported:** / **Shipped:** / **Files:** sections). Mark it against what actually happened, including:

- the 55-of-14,725 starting point and the coverage the report shows after
- that the reviewable unit is the rule, not the part, and why (July's 68-row worksheet went unreviewed for two months)
- that Biamp (1,148) and JBL (822) are unreachable — descriptions are bare part numbers
- the honest classifiability finding: ~780 parts coverable by the pre-existing 21 shapes, ~1,170 with the three added in D197, NOT the 2,479 that "has a usable description" suggested
- the final gate numbers

Append `## D192.` through `## D197.` to `DECISIONS.md` in the format `## D192. <title> (#159, 2026-09-23)`, taking wording from the spec's decision blocks.

- [ ] **Step 3: Commit and push**

```bash
git add PUNCHLIST.md DECISIONS.md
git commit -m "docs: log #159 and D192-D197 (catalog port rules engine)"
git push origin HEAD:main
```

---

## Self-Review

**Spec coverage:** §1.2 the 21 shapes → Task 1. §2/§2.1 measurement and D192/D197 → Tasks 1 (new shapes), 4 (report surfaces the counts), 6 (recorded). §3/D193 rule-level review → Tasks 2, 3, 4. §4.1/D194 shared shapes module → Task 1. §4.2 rule type + first-match matcher → Task 2. §4.3/D195 accessory layer → Tasks 2 (support), 3 (the rule, ordered first, asserted). §4.4 report + over-broad guard → Task 4. §4.5/D196 apply, hand edits win, idempotent, hosted gates → Task 5. §5 scope → enforced by the rules' `mfr` fields and the report's skip counts. §6 testing → Tasks 1–5. §7 open items → Task 6.

**Placeholder scan:** none — every code step carries complete code, every command carries expected output.

**Type consistency:** `RulePart`, `PortRule`, `matchRule`, `proposeForPart`, `PORT_RULES`, `applyRules`, `ApplyResult` are spelled identically in Tasks 2–5. `shape` takes `(part: RulePart)` in the type (Task 2) and every rule in Task 3 conforms — the zero-arg ones are written `() => …`, which is assignable. Shape helper names in Task 3's import match Task 1's exports exactly.

**Known risks, stated rather than hidden:**
1. **Task 3 is judgement, not transcription.** The patterns are a starting point derived from sampled descriptions; the implementer must read real data (Step 3 gives the command) and adjust. The tests assert structure and the two real-description cases, not that every pattern is well-tuned — only Jeff's review of the report can establish that.
2. **The three new shapes (D197) encode assumptions** — an amplifier's speakON NL4 out, a receiver's XLR out, an 8×8 DSP. They are stated in each shape's comment and each rule's note precisely so review can catch them. A specific model that differs gets corrected in the #158 editor, which always wins.
3. **Task 4's report and Task 5's `applyRules` each walk the catalog separately.** That is two full scans where one would do. It is deliberate: the report is read-only and the apply path must re-read anyway to be safe against a catalog that changed between review and apply. At 14,725 rows both are fast, and sharing a scan would couple a read-only reviewer's tool to a writer.
