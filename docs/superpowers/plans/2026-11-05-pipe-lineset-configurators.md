# Pipe and Lineset Configurators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `+ Configure pipe` and `+ Configure lineset` to the Estimator, plus an Add pipe toggle on new curtains, each producing one priced lot line like a track line.

**Architecture:** Pure quantity engines in `src/lib/rigging-config/`, two admin-mapped settings blobs (`pipe_types`, `lineset_types`), one pricing module `estimator/rigging-bom.ts`, and one new line field `SpecItem.rigging`. Code that today treats `it.track` as "tier-seeded line with parts in `components`" learns `isConfiguredLine`. Track itself does not change.

**Tech Stack:** Next.js 16 App Router, TypeScript, settings blobs via `getBlob`/`setBlob`, tsx check scripts.

**Spec:** `docs/superpowers/specs/2026-11-05-pipe-lineset-configurators-design.md`

## Global Constraints

- Work only in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/pipe-lineset` on branch `feat/373-pipe-lineset`. Never `git stash`.
- Next.js here differs from your training data. Before touching a route or server action, read the relevant guide in `node_modules/next/dist/docs/`.
- Never run `npm run dev`, a seed or any script against this worktree's `.data` while another may be alive (PGlite is one process at a time). Check `ps aux | grep tsx` first.
- Never preview-deploy this branch. Previews share the production database.
- No migration. No new environment variables. No seeded part numbers: both type lists start empty.
- Quantities: pipe `pieces = ceil(run / longest stick)`, `stick = shortest mapped stick ≥ run / pieces`, `splices = pieces − 1`, `clamps = ceil(run / spacing) + 1`, all × qty.
- Quantities: lineset `lines per set = entered, else max(1, floor(width / 10))`, `lift lines = sets × lines per set`, `cable = ceil(lift lines × (grid height + width / 2 + allowance))`, `hand line = ceil(sets × 2 × grid height)`, `terminations = lift lines × 2`, `chain wraps = lift lines`.
- Limits: sets whole 1–300; lift lines per set whole 1–20; width and grid height above 0 up to 500; allowance 0–200; pipe run above 0 up to `MAX_RUN_FT`; pipe qty within `MAX_TRACK_QTY`.
- Prices: every part `catalogAddPrice(cost, list, tierMargin)`; line sell `round2(sellAt(Σ costed, seedMarkupOf(tierMargin)) + Σ listed)`, exactly as `trackBom`.
- Use "Estimating Rules → Pipe types" and "Estimating Rules → Lineset types" in every setup message. UI copy says "lineset", one word.
- Comments follow the code around them: terse, tagged `#373`.
- Punch #373 and D1332 onward are provisional. Task 7 rechecks them against `origin/main`.

---

## File Structure

| File | Job |
|---|---|
| `src/lib/rigging-config/types.ts` | Types, limits, sanitizers, activation rules, unit check |
| `src/lib/rigging-config/pipe.ts` | `pipeQuantities` |
| `src/lib/rigging-config/lineset.ts` | `linesetQuantities`, `defaultLinesPerSet` |
| `src/lib/rigging-config/line.ts` | `isConfiguredLine` |
| `src/lib/stores/rigging-types.ts` | The two blobs: list, save, delete |
| `src/app/(app)/estimating-rules/rigging-ui.tsx` | Styles and `PartLine` shared by the two Rules screens |
| `src/app/(app)/estimating-rules/pipe-types/{page,actions,pipe-types-client}` | Pipe types screen |
| `src/app/(app)/estimating-rules/lineset-types/{page,actions,lineset-types-client}` | Lineset types screen |
| `src/app/(app)/estimator/rigging-bom.ts` | Pricing, line building, draft conversion, curtain pre-fill |
| `src/app/(app)/estimator/rigging-modal-ui.tsx` | Parts table, warnings, "no types" note |
| `src/app/(app)/estimator/pipe-modal.tsx` | `PipeFields`, `PipeModal` |
| `src/app/(app)/estimator/lineset-modal.tsx` | `LinesetModal` |
| `scripts/test-rigging-config.ts` | All checks; wired into `test:specs` |

---

### Task 1: Types and quantity engines

**Files:**
- Create: `src/lib/rigging-config/types.ts`, `src/lib/rigging-config/pipe.ts`, `src/lib/rigging-config/lineset.ts`, `src/lib/rigging-config/line.ts`, `scripts/test-rigging-config.ts`
- Modify: `scripts/test-review-and-spec.ts:11371` and `:11797`

**Interfaces:**
- Consumes: `MAX_RUN_FT`, `MAX_TRACK_QTY` from `@/lib/track-engine`
- Produces: everything exported below, used by every later task

- [ ] **Step 1: Set up the worktree**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/pipe-lineset
npm ci --no-audit --no-fund
cp /Users/sm/Downloads/peak-app/next-env.d.ts .
printf 'AUTH_SECRET=%s\nAUTH_DEV_LOGIN=true\nAUTH_TRUST_HOST=true\n' "$(openssl rand -hex 32)" > .env.local
```

Expected: `node_modules/.bin/next` exists. Do not copy the real `.env.local`.

- [ ] **Step 2: Write the failing checks**

Create `scripts/test-rigging-config.ts`:

```ts
/* #373 — pipe and lineset configurators. Pure checks run alone with
   `npx tsx scripts/test-rigging-config.ts`; riggingDbChecks runs only inside test:specs (scratch PGLITE_PATH). */
import type { Ok } from "./test-inbox-org";
import {
  isFootUnit, linesetTypeProblems, pipeTypeProblems, sanitizeLinesetType, sanitizeLinesetTypeBlob, sanitizePipeType, sanitizePipeTypeBlob,
  type LinesetType, type PipeType,
} from "../src/lib/rigging-config/types";
import { pipeQuantities } from "../src/lib/rigging-config/pipe";
import { defaultLinesPerSet, linesetQuantities } from "../src/lib/rigging-config/lineset";
import { isConfiguredLine } from "../src/lib/rigging-config/line";

const PIPE: PipeType = {
  id: "sch40", name: "1-1/2\" Sch 40", manufacturer: "", sticks: [{ lengthFt: 10, sku: "P10" }, { lengthFt: 21, sku: "P21" }],
  spliceSku: "SPL", clampSku: "CLP", hangerSpacingFt: 10, active: true,
};
const LINESET: LinesetType = {
  id: "quarter", name: "1/4\" cable", manufacturer: "",
  parts: { cable: { kind: "part", sku: "GAC" }, handLine: { kind: "part", sku: "HL" }, termination: { kind: "part", sku: "TRM" }, chainWrap: { kind: "assembly", id: "SA-1" } },
  allowanceFt: 10, active: true,
};
const qtyOf = (rows: { role: string; qty: number }[], role: string) => rows.find((r) => r.role === role)?.qty ?? 0;

function engineChecks(ok: Ok) {
  // Spec test case: 40' run, 21' sticks, 10' spacing.
  const p = pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1 }, PIPE);
  ok(!p.errors.length && qtyOf(p.rows, "stick") === 2 && qtyOf(p.rows, "splice") === 1 && qtyOf(p.rows, "clamp") === 5, "#373 pipe: 40' = 2 sticks, 1 splice, 5 clamps");
  ok(p.rows.find((r) => r.role === "stick")?.sku === "P21", "#373 pipe: 40' uses 21' sticks");
  const one = pipeQuantities({ typeId: "sch40", runFt: 15, qty: 1 }, PIPE);
  ok(qtyOf(one.rows, "stick") === 1 && qtyOf(one.rows, "splice") === 0 && one.rows.every((r) => r.qty > 0), "#373 pipe: a run that fits one stick has no splice row");
  ok(one.rows.find((r) => r.role === "stick")?.sku === "P21", "#373 pipe: 15' needs the 21' stick");
  ok(pipeQuantities({ typeId: "sch40", runFt: 8, qty: 1 }, PIPE).rows.find((r) => r.role === "stick")?.sku === "P10", "#373 pipe: 8' takes the shortest covering stick");
  const two = pipeQuantities({ typeId: "sch40", runFt: 40, qty: 2 }, PIPE);
  ok(qtyOf(two.rows, "stick") === 4 && qtyOf(two.rows, "splice") === 2 && qtyOf(two.rows, "clamp") === 10, "#373 pipe: quantity multiplies every row");
  ok(qtyOf(pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1, hangerSpacingFt: 8 }, PIPE).rows, "clamp") === 6, "#373 pipe: a typed spacing overrides the type's");
  ok(pipeQuantities({ typeId: "sch40", runFt: NaN, qty: 1 }, PIPE).errors.length === 1, "#373 pipe: blank run is an error");
  ok(pipeQuantities({ typeId: "sch40", runFt: 2000, qty: 1 }, PIPE).errors.length === 1, "#373 pipe: run over the limit is an error");
  ok(pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1.5 }, PIPE).errors.length === 1, "#373 pipe: fractional quantity is an error");
  ok(pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1 }, { ...PIPE, sticks: [] }).errors[0].includes("Estimating Rules → Pipe types"), "#373 pipe: no sticks names the Rules screen");

  // Spec test case: 6 sets, 40' wide, 40' grid, 10' allowance.
  const l = linesetQuantities({ typeId: "quarter", sets: 6, widthFt: 40, gridHeightFt: 40 }, LINESET);
  ok(!l.errors.length && l.liftLines === 24, "#373 lineset: 24 lift lines");
  ok(qtyOf(l.rows, "cable") === 1680 && qtyOf(l.rows, "handLine") === 480 && qtyOf(l.rows, "termination") === 48 && qtyOf(l.rows, "chainWrap") === 24, "#373 lineset: 1,680' cable, 480' hand line, 48 terminations, 24 chain wraps");
  ok(defaultLinesPerSet(8) === 1 && defaultLinesPerSet(40) === 4 && defaultLinesPerSet(49.9) === 4, "#373 lineset: 1 line per 10' of width, rounded down, at least 1");
  const typed = linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 40, linesPerSet: 6, allowanceFt: 0 }, LINESET);
  ok(typed.liftLines === 6 && qtyOf(typed.rows, "cable") === 360, "#373 lineset: typed lines and a 0' allowance win over the defaults");
  ok(qtyOf(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 25, gridHeightFt: 30.5 }, LINESET).rows, "cable") === 106, "#373 lineset: fractional cable rounds up (2 × 53')");
  ok(linesetQuantities({ typeId: "quarter", sets: 0, widthFt: 40, gridHeightFt: 40 }, LINESET).errors.length === 1, "#373 lineset: 0 sets is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 301, widthFt: 40, gridHeightFt: 40 }, LINESET).errors.length === 1, "#373 lineset: 301 sets is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 0, gridHeightFt: 40 }, LINESET).errors.length === 1, "#373 lineset: 0 width is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 501 }, LINESET).errors.length === 1, "#373 lineset: grid over 500' is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 40, linesPerSet: 21 }, LINESET).errors.length === 1, "#373 lineset: 21 lines per set is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 40, allowanceFt: 201 }, LINESET).errors.length === 1, "#373 lineset: allowance over 200' is an error");
}

function typeChecks(ok: Ok) {
  const clean = sanitizePipeType({ id: "BAD ID", name: "  A  pipe ", sticks: [{ lengthFt: "21", sku: " P21 " }, { lengthFt: 21, sku: "DUP" }, { lengthFt: 0, sku: "X" }, { lengthFt: 10, sku: "P10" }], clampSku: "C", hangerSpacingFt: "", active: true })!;
  ok(clean.id === "" && clean.name === "A pipe", "#373 sanitize: bad id dropped, name collapsed");
  ok(clean.sticks.map((s) => s.lengthFt).join() === "10,21" && clean.sticks[1].sku === "P21", "#373 sanitize: sticks sorted, first duplicate kept, bad rows dropped");
  ok(clean.hangerSpacingFt === 10 && clean.active === true, "#373 sanitize: blank spacing falls back to 10'; a complete type stays active");
  ok(sanitizePipeType({ name: "X", active: true })!.active === false, "#373 sanitize: an incomplete type can never be active");
  ok(pipeTypeProblems({ ...PIPE, spliceSku: undefined }).length === 0, "#373 activation: a splice isn't required");
  ok(pipeTypeProblems({ ...PIPE, clampSku: undefined }).length === 1, "#373 activation: a clamp is required");
  ok(pipeTypeProblems(PIPE, new Set(["P10", "CLP"])).length === 1, "#373 activation: a stick that left the catalog is a problem");
  ok(pipeTypeProblems(PIPE, new Set(["P10", "P21", "CLP"])).length === 0, "#373 activation: a dead splice doesn't block");

  const ls = sanitizeLinesetType({ name: "L", parts: { cable: { kind: "part", sku: " G " }, handLine: { kind: "assembly", id: "A" }, termination: { kind: "bogus" }, bogus: { kind: "part", sku: "X" } }, allowanceFt: "" })!;
  ok(ls.parts.cable?.kind === "part" && ls.parts.handLine?.kind === "assembly" && !ls.parts.termination && !("bogus" in ls.parts), "#373 sanitize: lineset sources cleaned");
  ok(ls.allowanceFt === 10, "#373 sanitize: blank allowance is 10'");
  ok(sanitizeLinesetType({ name: "L", allowanceFt: 0 })!.allowanceFt === 0, "#373 sanitize: a 0' allowance is kept");
  ok(linesetTypeProblems({ ...LINESET, parts: { cable: LINESET.parts.cable } }).length === 1, "#373 activation: all four lineset roles are required");
  ok(linesetTypeProblems(LINESET, { skus: new Set(["GAC", "HL", "TRM"]), assemblyIds: new Set(["SA-1"]) }).length === 0, "#373 activation: live lineset passes");
  ok(linesetTypeProblems(LINESET, { skus: new Set(["GAC", "HL", "TRM"]), assemblyIds: new Set() }).length === 1, "#373 activation: a non-hardware or deleted assembly is unmapped");

  const blob = sanitizePipeTypeBlob({ a: { ...PIPE }, gone: null, "BAD KEY": { ...PIPE }, unnamed: { sticks: [] } });
  ok(blob.length === 1 && blob[0].id === "a", "#373 blob: tombstones, bad keys and unnamed types are skipped; id = key");
  ok(sanitizeLinesetTypeBlob({ b: { ...LINESET } })[0].id === "b", "#373 blob: lineset id = key");

  ok(["ft", "FT", "foot", "Feet", " lf "].every(isFootUnit) && !isFootUnit("ea") && !isFootUnit("spool") && !isFootUnit(""), "#373 unit: foot spellings");
  ok(isConfiguredLine({ track: {} }) && isConfiguredLine({ rigging: {} }) && !isConfiguredLine({}), "#373 isConfiguredLine");
}

export async function riggingConfigChecks(ok: Ok) {
  engineChecks(ok);
  typeChecks(ok);
}

if (process.argv[1]?.endsWith("test-rigging-config.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  riggingConfigChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: fails with `Cannot find module` for `rigging-config/types`.

- [ ] **Step 4: Write `src/lib/rigging-config/types.ts`**

```ts
/**
 * Pipe and lineset types (#373) — the parts maps behind the two configurators.
 * Pure, client-safe. The store is src/lib/stores/rigging-types.ts (one settings
 * blob each, one key per type id, a delete leaves a null so an id is never
 * reused); nothing is seeded and nothing here carries a price.
 */

export type PipeStick = { lengthFt: number; sku: string };

export type PipeType = {
  /** Stable slug, server-allocated. */
  id: string;
  name: string;
  manufacturer: string;
  /** Ascending. Source of truth for every length the type buys. */
  sticks: PipeStick[];
  /** Only required once a run needs a splice (pricing blocks by name). */
  spliceSku?: string;
  clampSku?: string;
  hangerSpacingFt: number;
  active: boolean;
  updatedBy?: string;
  updatedAt?: number;
};

export type LinesetRole = "cable" | "handLine" | "termination" | "chainWrap";
export type LinesetSource = { kind: "part"; sku: string } | { kind: "assembly"; id: string };

export type LinesetType = {
  id: string;
  name: string;
  manufacturer: string;
  parts: Partial<Record<LinesetRole, LinesetSource>>;
  /** Extra cable per lift line, ft. 0 is a real value. */
  allowanceFt: number;
  active: boolean;
  updatedBy?: string;
  updatedAt?: number;
};

/** The inputs a pipe line stores. Blank spacing = the type's. */
export type PipeConfig = { typeId: string; runFt: number; qty: number; hangerSpacingFt?: number; label?: string };
/** The inputs a lineset line stores. Blank lines / allowance = the defaults. */
export type LinesetConfig = { typeId: string; sets: number; widthFt: number; gridHeightFt: number; linesPerSet?: number; allowanceFt?: number; label?: string };
/** `SpecItem.rigging`: which configurator reopens the line, and its inputs. */
export type RiggingConfig = ({ kind: "pipe" } & PipeConfig) | ({ kind: "lineset" } & LinesetConfig);

export const PIPE_TYPES_BLOB = "pipe_types";
export const LINESET_TYPES_BLOB = "lineset_types";
export const RIGGING_TYPE_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const DEFAULT_PIPE_SPACING_FT = 10;
export const DEFAULT_CABLE_ALLOWANCE_FT = 10;
export const PIPE_TYPES_HREF = "/estimating-rules/pipe-types";
export const LINESET_TYPES_HREF = "/estimating-rules/lineset-types";
export const PIPE_TYPES_HOME = "Estimating Rules → Pipe types";
export const LINESET_TYPES_HOME = "Estimating Rules → Lineset types";

export const RIGGING_LIMITS = {
  stickLengthFt: 60,
  sticks: 12,
  hangerSpacingFt: 40,
  allowanceFt: 200,
  name: 80,
  manufacturer: 60,
  sku: 120,
  assemblyId: 120,
} as const;

export const LINESET_ROLES: readonly LinesetRole[] = ["cable", "handLine", "termination", "chainWrap"];
export const LINESET_ROLE_NAMES: Record<LinesetRole, string> = {
  cable: "Aircraft cable",
  handLine: "Hand line",
  termination: "Terminations",
  chainWrap: "Chain wraps",
};
/** The Rules screen's role note: how the configurator counts each. */
export const LINESET_ROLE_NOTES: Record<LinesetRole, string> = {
  cable: "Priced per foot",
  handLine: "Priced per foot",
  termination: "2 per lift line",
  chainWrap: "1 per lift line",
};

/** A catalog unit that sells by the foot. Unit text varies, so callers warn and never block. */
export function isFootUnit(unit: unknown): boolean {
  return typeof unit === "string" && ["ft", "foot", "feet", "lf"].includes(unit.trim().toLowerCase());
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function cleanSticks(v: unknown): PipeStick[] {
  if (!Array.isArray(v)) return [];
  const byLength = new Map<number, PipeStick>();
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const n = num(r.lengthFt);
    const lengthFt = Number.isFinite(n) && n > 0 ? Math.min(n, RIGGING_LIMITS.stickLengthFt) : 0;
    const sku = cleanText(r.sku, RIGGING_LIMITS.sku);
    if (!(lengthFt > 0) || !sku || byLength.has(lengthFt)) continue;
    byLength.set(lengthFt, { lengthFt, sku });
  }
  return [...byLength.values()].sort((a, b) => a.lengthFt - b.lengthFt).slice(0, RIGGING_LIMITS.sticks);
}

function cleanSource(v: unknown): LinesetSource | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.kind === "part") {
    const sku = cleanText(r.sku, RIGGING_LIMITS.sku);
    return sku ? { kind: "part", sku } : null;
  }
  if (r.kind === "assembly") {
    const id = cleanText(r.id, RIGGING_LIMITS.assemblyId);
    return id ? { kind: "assembly", id } : null;
  }
  return null;
}

/** Everything that stops a pipe type being Active; `liveSkus` = the SKUs still in the catalog. Empty = can be active. */
export function pipeTypeProblems(t: Pick<PipeType, "sticks" | "clampSku" | "hangerSpacingFt">, liveSkus?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const live = (sku: string | undefined) => !!sku && (!liveSkus || liveSkus.has(sku));
  if (!t.sticks.length) problems.push("Add a stick length and map its part.");
  for (const s of t.sticks) if (!live(s.sku)) problems.push(`Stick ${s.lengthFt}' — ${s.sku} is no longer in the catalog.`);
  if (!live(t.clampSku)) problems.push("Map a part for Hanging clamps.");
  if (!(t.hangerSpacingFt > 0)) problems.push("Enter a hanger spacing.");
  return problems;
}

/** Everything that stops a lineset type being Active. `live`: the SKUs in the catalog and the live Hardware assembly ids. */
export function linesetTypeProblems(t: Pick<LinesetType, "parts">, live?: { skus: ReadonlySet<string>; assemblyIds: ReadonlySet<string> }): string[] {
  const usable = (s: LinesetSource | undefined) => !!s && (!live || (s.kind === "part" ? live.skus.has(s.sku) : live.assemblyIds.has(s.id)));
  const missing = LINESET_ROLES.filter((r) => !usable(t.parts[r])).map((r) => LINESET_ROLE_NAMES[r]);
  return missing.length ? [`Map ${missing.join(", ")}.`] : [];
}

/** Shape-clean one pipe type. `active` survives only when the structural check passes. Null for a non-object. */
export function sanitizePipeType(raw: unknown): PipeType | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const spacing = num(r.hangerSpacingFt);
  const spliceSku = cleanText(r.spliceSku, RIGGING_LIMITS.sku);
  const clampSku = cleanText(r.clampSku, RIGGING_LIMITS.sku);
  const t: PipeType = {
    id: typeof r.id === "string" && RIGGING_TYPE_ID_RE.test(r.id) ? r.id : "",
    name: cleanText(r.name, RIGGING_LIMITS.name),
    manufacturer: cleanText(r.manufacturer, RIGGING_LIMITS.manufacturer),
    sticks: cleanSticks(r.sticks),
    ...(spliceSku ? { spliceSku } : {}),
    ...(clampSku ? { clampSku } : {}),
    hangerSpacingFt: Number.isFinite(spacing) && spacing > 0 ? Math.min(spacing, RIGGING_LIMITS.hangerSpacingFt) : DEFAULT_PIPE_SPACING_FT,
    active: false,
  };
  t.active = r.active === true && pipeTypeProblems(t).length === 0;
  const by = cleanText(r.updatedBy, 120);
  const at = num(r.updatedAt);
  if (by) t.updatedBy = by;
  if (Number.isFinite(at) && at > 0) t.updatedAt = at;
  return t;
}

/** Shape-clean one lineset type. Null for a non-object. */
export function sanitizeLinesetType(raw: unknown): LinesetType | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const partsRaw = r.parts && typeof r.parts === "object" && !Array.isArray(r.parts) ? (r.parts as Record<string, unknown>) : {};
  const parts: LinesetType["parts"] = {};
  for (const role of LINESET_ROLES) {
    const s = cleanSource(partsRaw[role]);
    if (s) parts[role] = s;
  }
  const allowance = num(r.allowanceFt);
  const t: LinesetType = {
    id: typeof r.id === "string" && RIGGING_TYPE_ID_RE.test(r.id) ? r.id : "",
    name: cleanText(r.name, RIGGING_LIMITS.name),
    manufacturer: cleanText(r.manufacturer, RIGGING_LIMITS.manufacturer),
    parts,
    allowanceFt: Number.isFinite(allowance) && allowance >= 0 ? Math.min(allowance, RIGGING_LIMITS.allowanceFt) : DEFAULT_CABLE_ALLOWANCE_FT,
    active: false,
  };
  t.active = r.active === true && linesetTypeProblems(t).length === 0;
  const by = cleanText(r.updatedBy, 120);
  const at = num(r.updatedAt);
  if (by) t.updatedBy = by;
  if (Number.isFinite(at) && at > 0) t.updatedAt = at;
  return t;
}

function fromBlob<T extends { id: string; name: string }>(raw: unknown, clean: (v: unknown) => T | null): T[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!RIGGING_TYPE_ID_RE.test(key) || value == null) continue;
    const t = clean(value);
    if (!t || !t.name) continue;
    out.push({ ...t, id: key });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

export const sanitizePipeTypeBlob = (raw: unknown): PipeType[] => fromBlob(raw, sanitizePipeType);
export const sanitizeLinesetTypeBlob = (raw: unknown): LinesetType[] => fromBlob(raw, sanitizeLinesetType);

/** Every catalog SKU a pipe type names — what a page must read from the catalog. */
export function pipeTypeSkus(t: Pick<PipeType, "sticks" | "spliceSku" | "clampSku">): string[] {
  return [...new Set([...t.sticks.map((s) => s.sku), t.spliceSku, t.clampSku].filter((s): s is string => !!s))];
}

/** Every catalog SKU a lineset type names directly (assembly members come with the assembly). */
export function linesetTypeSkus(t: Pick<LinesetType, "parts">): string[] {
  return [...new Set(Object.values(t.parts).flatMap((s) => (s?.kind === "part" ? [s.sku] : [])))];
}
```

- [ ] **Step 5: Write the two engines and `line.ts`**

`src/lib/rigging-config/pipe.ts`:

```ts
import { MAX_RUN_FT, MAX_TRACK_QTY } from "@/lib/track-engine";
import { PIPE_TYPES_HOME, type PipeConfig, type PipeType } from "./types";

/** #373 — how many of each pipe role one configuration buys. Pure; pricing is estimator/rigging-bom.ts. */
export type PipeRole = "stick" | "splice" | "clamp";
export type PipeRow = { role: PipeRole; qty: number; sku?: string; lengthFt?: number };
export type PipeResult = { rows: PipeRow[]; errors: string[] };

const ceilSafe = (x: number) => Math.ceil(x - 1e-9);

export function pipeQuantities(config: PipeConfig, type: PipeType): PipeResult {
  const errors: string[] = [];
  const { runFt: run, qty } = config;
  const spacing = config.hangerSpacingFt ?? type.hangerSpacingFt;
  if (!(typeof run === "number" && Number.isFinite(run) && run > 0)) errors.push("Enter the run length.");
  else if (run > MAX_RUN_FT) errors.push(`A run is at most ${MAX_RUN_FT}'.`);
  if (!(Number.isInteger(qty) && qty >= 1 && qty <= MAX_TRACK_QTY)) errors.push(`Quantity is a whole number from 1 to ${MAX_TRACK_QTY}.`);
  if (!(typeof spacing === "number" && Number.isFinite(spacing) && spacing > 0)) errors.push("Enter the hanger spacing.");
  const sticks = [...type.sticks].sort((a, b) => a.lengthFt - b.lengthFt);
  if (!sticks.length) errors.push(`${type.name} has no stick length — set it in ${PIPE_TYPES_HOME}.`);
  if (errors.length) return { rows: [], errors };

  const pieces = ceilSafe(run / sticks[sticks.length - 1].lengthFt);
  const stick = sticks.find((s) => s.lengthFt >= run / pieces - 1e-9) ?? sticks[sticks.length - 1];
  const rows: PipeRow[] = [
    { role: "stick", qty: pieces * qty, sku: stick.sku, lengthFt: stick.lengthFt },
    { role: "splice", qty: (pieces - 1) * qty },
    { role: "clamp", qty: (ceilSafe(run / spacing) + 1) * qty },
  ];
  return { rows: rows.filter((r) => r.qty > 0), errors: [] };
}
```

`src/lib/rigging-config/lineset.ts`:

```ts
import type { LinesetConfig, LinesetRole, LinesetType } from "./types";
import { RIGGING_LIMITS } from "./types";

/**
 * #373 — what one configured lineset buys. The lines-per-set default, hand line
 * and termination counts follow Quick Design's counterweight equation
 * (design/quick/engine.ts). Cable is actual routing, not that equation's 2G + W:
 * up to the loft block, across on average half the width, plus an allowance.
 */
export type LinesetRow = { role: LinesetRole; qty: number };
export type LinesetResult = { rows: LinesetRow[]; errors: string[]; liftLines: number };

export const MAX_SETS = 300;
export const MAX_LINES_PER_SET = 20;
export const MAX_LINESET_DIM_FT = 500;

const ceilSafe = (x: number) => Math.ceil(x - 1e-9);
const inRange = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max;

export function defaultLinesPerSet(widthFt: number): number {
  return Math.max(1, Math.floor(widthFt / 10));
}

export function linesetQuantities(config: LinesetConfig, type: LinesetType): LinesetResult {
  const errors: string[] = [];
  const { sets, widthFt: w, gridHeightFt: g } = config;
  if (!(Number.isInteger(sets) && sets >= 1 && sets <= MAX_SETS)) errors.push(`Sets is a whole number from 1 to ${MAX_SETS}.`);
  if (!inRange(w, MAX_LINESET_DIM_FT)) errors.push(`Width is above 0 and at most ${MAX_LINESET_DIM_FT}'.`);
  if (!inRange(g, MAX_LINESET_DIM_FT)) errors.push(`Grid height is above 0 and at most ${MAX_LINESET_DIM_FT}'.`);
  const lines = config.linesPerSet ?? (inRange(w, MAX_LINESET_DIM_FT) ? defaultLinesPerSet(w) : 1);
  if (!(Number.isInteger(lines) && lines >= 1 && lines <= MAX_LINES_PER_SET)) errors.push(`Lift lines per set is a whole number from 1 to ${MAX_LINES_PER_SET}.`);
  const allowance = config.allowanceFt ?? type.allowanceFt;
  if (!(typeof allowance === "number" && Number.isFinite(allowance) && allowance >= 0 && allowance <= RIGGING_LIMITS.allowanceFt)) errors.push(`Cable allowance is 0 to ${RIGGING_LIMITS.allowanceFt}'.`);
  if (errors.length) return { rows: [], errors, liftLines: 0 };

  const liftLines = sets * lines;
  return {
    rows: [
      { role: "cable", qty: ceilSafe(liftLines * (g + w / 2 + allowance)) },
      { role: "handLine", qty: ceilSafe(sets * 2 * g) },
      { role: "termination", qty: liftLines * 2 },
      { role: "chainWrap", qty: liftLines },
    ],
    errors: [],
    liftLines,
  };
}
```

`src/lib/rigging-config/line.ts`:

```ts
/** #373 — a tier-seeded lot line whose parts ride in `components`: a track, pipe or lineset line. */
export function isConfiguredLine(it: { track?: unknown; rigging?: unknown } | null | undefined): boolean {
  return it?.track != null || it?.rigging != null;
}
```

- [ ] **Step 6: Run checks; wire into test:specs**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: `0 FAIL`.

In `scripts/test-review-and-spec.ts` add after line 11371 `import { curvedTrackChecks } from "./test-curved-track";`:

```ts
import { riggingConfigChecks } from "./test-rigging-config";
```

and after `.then(() => curvedTrackChecks(ok))`:

```ts
  .then(() => riggingConfigChecks(ok))
```

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rigging-config scripts/test-rigging-config.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): #373 pipe and lineset types and quantity engines"
```

---

### Task 2: Store, catalog rename and Rules screens

**Files:**
- Create: `src/lib/stores/rigging-types.ts`, `src/app/(app)/estimating-rules/rigging-ui.tsx`, `src/app/(app)/estimating-rules/pipe-types/{page.tsx,actions.ts,pipe-types-client.tsx}`, `src/app/(app)/estimating-rules/lineset-types/{page.tsx,actions.ts,lineset-types-client.tsx}`
- Modify: `src/lib/catalog-rename/rewrite.ts:355`, `src/lib/catalog-rename/apply.ts:261`, `src/app/(app)/estimating-rules/page.tsx:157`, `scripts/smoke-routes.ts:92`, `scripts/test-rigging-config.ts`, `scripts/test-review-and-spec.ts:11797`

**Interfaces:**
- Consumes: Task 1 types and sanitizers; `allocateTrackSeriesId` from `@/lib/track-series`; `listFixtures` from `@/lib/stores/fixtures`; `PartPicker` from `@/app/(app)/design/grid/settings/equipment-map/part-picker`
- Produces: `listPipeTypes(): Promise<PipeType[]>`, `listLinesetTypes(): Promise<LinesetType[]>`, used by the Estimator page in Task 5

- [ ] **Step 1: Write the failing checks**

Append to `scripts/test-rigging-config.ts` above `export async function riggingConfigChecks`, and add `import { rewriteLinesetTypes, rewritePipeTypes } from "../src/lib/catalog-rename/rewrite";` to the imports:

```ts
function renameChecks(ok: Ok) {
  const m = new Map([["P21", "Brand:P21"], ["CLP", "Brand:CLP"], ["GAC", "Brand:GAC"]]);
  const pipe = rewritePipeTypes({ a: { ...PIPE }, gone: null }, m) as Record<string, PipeType>;
  ok(pipe.a.sticks[1].sku === "Brand:P21" && pipe.a.clampSku === "Brand:CLP" && pipe.a.spliceSku === "SPL" && pipe.gone === null, "#373 rename: pipe sticks and clamp move; the rest stay");
  const ls = rewriteLinesetTypes({ b: { ...LINESET } }, m) as Record<string, LinesetType>;
  ok((ls.b.parts.cable as { sku: string }).sku === "Brand:GAC" && (ls.b.parts.chainWrap as { id: string }).id === "SA-1", "#373 rename: lineset part sources move; assembly ids don't");
  ok(rewritePipeTypes({ a: { ...PIPE } }, new Map()) === null && rewriteLinesetTypes({ b: { ...LINESET } }, new Map()) === null, "#373 rename: nothing moved is null");
}

/** Inside test:specs only — opens the scratch PGlite. */
export async function riggingDbChecks(ok: Ok) {
  const { deletePipeType, listLinesetTypes, listPipeTypes, saveLinesetType, savePipeType } = await import("../src/lib/stores/rigging-types");
  const blank = await savePipeType({ name: "" }, "t");
  ok(!blank.ok, "#373 store: a blank name is refused");
  const made = await savePipeType({ name: "Sch 40", sticks: [{ lengthFt: 21, sku: "NOT-IN-CATALOG" }], clampSku: "NOT-IN-CATALOG", hangerSpacingFt: 10, active: true }, "t");
  ok(!made.ok && made.error.includes("no longer in the catalog"), "#373 store: Active re-checks the live catalog");
  const off = await savePipeType({ name: "Sch 40", sticks: [{ lengthFt: 21, sku: "NOT-IN-CATALOG" }], hangerSpacingFt: 10 }, "t");
  ok(off.ok && off.type.id === "sch-40" && off.type.active === false, "#373 store: saved inactive with a slug id");
  const dup = await savePipeType({ name: "sch 40" }, "t");
  ok(!dup.ok, "#373 store: duplicate name refused");
  if (off.ok) {
    ok(await deletePipeType(off.type.id), "#373 store: delete");
    ok(!(await listPipeTypes()).some((t) => t.id === off.type.id), "#373 store: deleted type is gone");
    const again = await savePipeType({ name: "Sch 40" }, "t");
    ok(again.ok && again.type.id === "sch-40-2", "#373 store: a deleted id is never reused");
  }
  const ls = await saveLinesetType({ name: "1/4 cable", parts: { cable: { kind: "part", sku: "X" } }, allowanceFt: 0 }, "t");
  ok(ls.ok && (await listLinesetTypes())[0].allowanceFt === 0, "#373 store: lineset saved");
  const act = await saveLinesetType({ name: "Full", parts: { cable: { kind: "assembly", id: "NOPE" }, handLine: { kind: "part", sku: "X" }, termination: { kind: "part", sku: "X" }, chainWrap: { kind: "part", sku: "X" } }, active: true }, "t");
  ok(!act.ok, "#373 store: Active refuses a dead assembly and dead parts");
}
```

Add `renameChecks(ok);` inside `riggingConfigChecks`. In `scripts/test-review-and-spec.ts`, extend the import to `{ riggingConfigChecks, riggingDbChecks }` and the line to:

```ts
  .then(() => riggingConfigChecks(ok)).then(() => riggingDbChecks(ok))
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: fails because `rewritePipeTypes` is not exported.

- [ ] **Step 3: Write the rewrites**

In `src/lib/catalog-rename/rewrite.ts`, directly after `rewriteTrackSeries`:

```ts
/** #373 — the `pipe_types` blob: `sticks[].sku`, `spliceSku`, `clampSku`. */
export function rewritePipeTypes(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(blob)) return null;
  return mapValues(blob, (t) => {
    if (!isRec(t)) return null;
    const patch: Rec = fieldPatch(t, ["spliceSku", "clampSku"], m);
    const sticks = mapObjs(t.sticks, (s) => swapFields(s, ["sku"], m));
    if (sticks) patch.sticks = sticks;
    return overlay(t, patch);
  });
}

/** #373 — the `lineset_types` blob: `parts[role].sku` (assembly sources name no SKU). */
export function rewriteLinesetTypes(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(blob)) return null;
  return mapValues(blob, (t) => {
    if (!isRec(t) || !isRec(t.parts)) return null;
    const parts = mapValues(t.parts, (p) => (isRec(p) && p.kind === "part" ? swapFields(p, ["sku"], m) : null));
    return parts ? { ...t, parts } : null;
  });
}
```

In `src/lib/catalog-rename/apply.ts`, add `import { LINESET_TYPES_BLOB, PIPE_TYPES_BLOB } from "@/lib/rigging-config/types";` beside the `TRACK_SERIES_BLOB` import, and after the `TRACK_SERIES_BLOB` job:

```ts
    [PIPE_TYPES_BLOB, (raw) => RW.rewritePipeTypes(raw, m)],
    [LINESET_TYPES_BLOB, (raw) => RW.rewriteLinesetTypes(raw, m)],
```

- [ ] **Step 4: Write the store**

`src/lib/stores/rigging-types.ts`:

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { getMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { allocateTrackSeriesId } from "@/lib/track-series";
import {
  LINESET_TYPES_BLOB, PIPE_TYPES_BLOB, linesetTypeProblems, linesetTypeSkus, pipeTypeProblems, pipeTypeSkus,
  sanitizeLinesetType, sanitizeLinesetTypeBlob, sanitizePipeType, sanitizePipeTypeBlob,
  type LinesetType, type PipeType,
} from "@/lib/rigging-config/types";

/**
 * Pipe and lineset types (#373): one settings blob each, one key per type id,
 * written per key through setBlob's jsonb merge, the Track series idiom. A
 * delete writes `{ [id]: null }`, so a saved line never opens a different type.
 * Starts empty; survives the go-live reset, like every rate blob.
 */

const rawBlob = (name: string) => getBlob<Record<string, unknown>>(name, {});

export const listPipeTypes = async (): Promise<PipeType[]> => sanitizePipeTypeBlob(await rawBlob(PIPE_TYPES_BLOB));
export const listLinesetTypes = async (): Promise<LinesetType[]> => sanitizeLinesetTypeBlob(await rawBlob(LINESET_TYPES_BLOB));

async function liveSkus(skus: readonly string[]): Promise<Set<string>> {
  const want = [...new Set(skus.filter(Boolean))];
  return new Set(want.length ? (await getMany(want)).map((p) => p.sku) : []);
}

async function liveHardwareIds(): Promise<Set<string>> {
  return new Set((await listFixtures()).filter((f) => f.kind === "hardware").map((f) => f.id));
}

type Named = { id: string; name: string };
type Saved<T> = { ok: true; type: T } | { ok: false; error: string };

async function save<T extends Named & { active: boolean; updatedBy?: string; updatedAt?: number }>(
  blob: string,
  input: unknown,
  by: string,
  now: number,
  clean: (v: unknown) => T | null,
  list: (raw: unknown) => T[],
  problems: (t: T) => Promise<string[]>,
): Promise<Saved<T>> {
  const t = clean(input);
  if (!t) return { ok: false, error: "Nothing to save." };
  if (!t.name) return { ok: false, error: "Give the type a name." };
  const rec = input as Record<string, unknown>;
  const requestedActive = rec.active === true;
  const raw = await rawBlob(blob);
  const existing = list(raw);
  if (rec.id !== undefined && rec.id !== "" && rec.id !== null && (!t.id || !existing.some((e) => e.id === t.id))) {
    return { ok: false, error: "This type no longer exists — reload the page." };
  }
  const lower = t.name.toLowerCase();
  if (existing.some((e) => e.id !== t.id && e.name.toLowerCase() === lower)) return { ok: false, error: `There is already a type called "${t.name}".` };
  if (requestedActive) {
    const found = await problems(t);
    if (found.length) return { ok: false, error: `Can't mark it active yet: ${found.join(" ")}` };
  }
  const id = t.id || allocateTrackSeriesId(t.name, new Set(Object.keys(raw)));
  const type: T = { ...t, id, active: requestedActive, updatedBy: by, updatedAt: now };
  await setBlob(blob, { [id]: type });
  return { ok: true, type };
}

async function remove(blob: string, id: string): Promise<boolean> {
  const raw = await rawBlob(blob);
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(raw, id) || raw[id] == null) return false;
  await setBlob(blob, { [id]: null });
  return true;
}

export const savePipeType = (input: unknown, by: string, now = Date.now()) =>
  save<PipeType>(PIPE_TYPES_BLOB, input, by, now, sanitizePipeType, sanitizePipeTypeBlob, async (t) => pipeTypeProblems(t, await liveSkus(pipeTypeSkus(t))));

export const saveLinesetType = (input: unknown, by: string, now = Date.now()) =>
  save<LinesetType>(LINESET_TYPES_BLOB, input, by, now, sanitizeLinesetType, sanitizeLinesetTypeBlob, async (t) =>
    linesetTypeProblems(t, { skus: await liveSkus(linesetTypeSkus(t)), assemblyIds: await liveHardwareIds() }),
  );

export const deletePipeType = (id: string) => remove(PIPE_TYPES_BLOB, id);
export const deleteLinesetType = (id: string) => remove(LINESET_TYPES_BLOB, id);
```

- [ ] **Step 5: Run the pure checks and the store checks**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: `0 FAIL`.

Run the store checks against a scratch database:

```bash
TEST_DB=$(mktemp -d) PGLITE_PATH="$TEST_DB" npx tsx -e 'import("./scripts/test-rigging-config.ts").then(async (m) => { let f = 0; await m.riggingDbChecks((c, msg) => { if (!c) { f++; console.log("FAIL", msg); } }); console.log("fails", f); process.exit(f ? 1 : 0); })'
```

Expected: `fails 0`. Afterwards delete that temp directory.

- [ ] **Step 6: Write the shared Rules UI**

`src/app/(app)/estimating-rules/rigging-ui.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";

/** #373 — what the Pipe types and Lineset types screens share (Track series' look). */
export type PartInfo = { desc: string; cost: number; unit: string; mfr: string };

export const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff" };
export const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
export const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
export const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 };
export const ROW: CSSProperties = { border: "1px solid #eef0f3", borderRadius: 9, padding: "8px 10px" };
export const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const day = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");

export function PartLine({ sku, info }: { sku: string; info: PartInfo | undefined }) {
  if (!sku) return <span style={{ color: "#a0442b" }}>Not mapped</span>;
  if (!info)
    return (
      <span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{sku}</span>
        <span style={{ color: "#a0442b" }}> — no longer in the catalog (counts as unmapped)</span>
      </span>
    );
  return (
    <span>
      <span style={{ fontFamily: "var(--font-mono)" }}>{sku}</span> — {info.desc}
      <span style={{ color: "#737985" }}> · cost {money(info.cost)}/{info.unit}</span>
    </span>
  );
}

export function StatusChip({ active }: { active: boolean }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 8px", color: active ? "#1f7a52" : "#737985", background: active ? "#eaf6ef" : "#f1f2f5" }}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function UnitWarning({ text }: { text: string }) {
  return <div style={{ fontSize: 11, color: "#8a6d1f", marginTop: 5 }}>{text}</div>;
}
```

- [ ] **Step 7: Write the Pipe types screen**

`src/app/(app)/estimating-rules/pipe-types/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { deletePipeType, savePipeType } from "@/lib/stores/rigging-types";

/** Estimating Rules → Pipe types (#373). Admin only; the store re-sanitizes and re-checks Active against the live catalog. */
export async function savePipeTypeAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await savePipeType(input, user.name);
  if (!r.ok) return r;
  revalidatePath("/estimating-rules/pipe-types");
  return { ok: true, id: r.type.id };
}

export async function deletePipeTypeAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!(await deletePipeType(String(id ?? "")))) return { ok: false, error: "This type no longer exists." };
  revalidatePath("/estimating-rules/pipe-types");
  return { ok: true };
}
```

`src/app/(app)/estimating-rules/pipe-types/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listPipeTypes } from "@/lib/stores/rigging-types";
import { pipeTypeSkus } from "@/lib/rigging-config/types";
import type { PartInfo } from "../rigging-ui";
import PipeTypesClient from "./pipe-types-client";

export const metadata = { title: "Pipe types — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/** Estimating Rules → Pipe types (#373): the parts map behind the pipe configurator. Admin only. */
export default async function PipeTypesPage() {
  const user = await requireUser();
  const back = <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Estimating rules</Link>;
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Pipe types</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Pipe types decide which catalog parts price a pipe, so editing them is limited to admins.</div>
        </div>
      </div>
    );
  }
  const types = await listPipeTypes();
  const skus = [...new Set(types.flatMap((t) => pipeTypeSkus(t)))];
  const parts: Record<string, PartInfo> = {};
  for (const p of skus.length ? await getMany(skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginTop: 6 }}>Pipe types</div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 18px", lineHeight: 1.5 }}>
        The catalog parts for each kind of pipe. The pipe configurator works out sticks, splices and clamps; every price comes from these parts in the live catalog.
      </div>
      <PipeTypesClient types={types} parts={parts} />
    </div>
  );
}
```

`src/app/(app)/estimating-rules/pipe-types/pipe-types-client.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import { DEFAULT_PIPE_SPACING_FT, RIGGING_LIMITS, isFootUnit, pipeTypeProblems, sanitizePipeType, type PipeType } from "@/lib/rigging-config/types";
import { BTN, INPUT, LABEL, PRIMARY, PartLine, ROW, StatusChip, UnitWarning, day, type PartInfo } from "../rigging-ui";
import { deletePipeTypeAction, savePipeTypeAction } from "./actions";

type StickRow = { key: string; lengthFt: string; sku: string };
type Draft = { id: string; name: string; manufacturer: string; sticks: StickRow[]; spliceSku: string; clampSku: string; hangerSpacingFt: string; active: boolean };
type Picking = { kind: "stick"; key: string } | { kind: "splice" } | { kind: "clamp" } | null;

let seq = 0;
const stickRow = (lengthFt = "", sku = ""): StickRow => ({ key: `s${++seq}`, lengthFt, sku });

const draftOf = (t: PipeType | null): Draft =>
  t
    ? { id: t.id, name: t.name, manufacturer: t.manufacturer, sticks: t.sticks.map((s) => stickRow(String(s.lengthFt), s.sku)), spliceSku: t.spliceSku || "", clampSku: t.clampSku || "", hangerSpacingFt: String(t.hangerSpacingFt), active: t.active }
    : { id: "", name: "", manufacturer: "", sticks: [], spliceSku: "", clampSku: "", hangerSpacingFt: String(DEFAULT_PIPE_SPACING_FT), active: false };

export default function PipeTypesClient({ types, parts }: { types: PipeType[]; parts: Record<string, PartInfo> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {open !== "new" && <button type="button" style={PRIMARY} onClick={() => setOpen("new")}>+ New pipe type</button>}
      </div>
      {open === "new" && (
        <section className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>New pipe type</div>
          <Editor type={null} parts={parts} onClose={() => setOpen(null)} />
        </section>
      )}
      {types.length === 0 && open !== "new" && (
        <div className="pk-card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No pipe types yet</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Add a type (e.g. 1-1/2&quot; Sch 40 black), enter its stick lengths and map each part. Nothing is mapped for you.</div>
        </div>
      )}
      {types.map((t) => (
        <section key={t.id} className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14.5, fontWeight: 650 }}>{t.name}</span>
            {t.manufacturer && <span style={{ fontSize: 12.5, color: "#737985" }}>{t.manufacturer}</span>}
            <StatusChip active={t.active} />
            <span style={{ flex: 1 }} />
            <button type="button" style={BTN} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Close" : "Edit"}</button>
          </div>
          <div style={{ fontSize: 12, color: "#5b616e", marginTop: 5 }}>
            {t.sticks.length ? t.sticks.map((s) => `${s.lengthFt}'`).join(", ") + " sticks" : "No sticks"} · hangers every {t.hangerSpacingFt}&apos;
          </div>
          {open === t.id ? (
            <Editor type={t} parts={parts} onClose={() => setOpen(null)} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 210px) minmax(0, 1fr)", gap: "3px 12px", fontSize: 12, marginTop: 8 }}>
              {t.sticks.map((s) => (
                <div key={s.lengthFt} style={{ display: "contents" }}>
                  <div style={{ color: "#737985" }}>Pipe {s.lengthFt}&apos; stick</div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><PartLine sku={s.sku} info={parts[s.sku]} /></div>
                </div>
              ))}
              <div style={{ color: "#737985" }}>Splice sleeve</div>
              <div>{t.spliceSku ? <PartLine sku={t.spliceSku} info={parts[t.spliceSku]} /> : <span style={{ color: "#9aa0ab" }}>Not mapped</span>}</div>
              <div style={{ color: "#737985" }}>Hanging clamp</div>
              <div><PartLine sku={t.clampSku || ""} info={t.clampSku ? parts[t.clampSku] : undefined} /></div>
            </div>
          )}
          {t.updatedBy && open !== t.id && <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 8 }}>Last edited by {t.updatedBy} · {day(t.updatedAt)}</div>}
        </section>
      ))}
    </div>
  );
}

function Editor({ type, parts, onClose }: { type: PipeType | null; parts: Record<string, PartInfo>; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(type));
  const [known, setKnown] = useState<Record<string, PartInfo>>(parts);
  const [picking, setPicking] = useState<Picking>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setStick = (key: string, patch: Partial<StickRow>) => setDraft((d) => ({ ...d, sticks: d.sticks.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  const payload = {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    manufacturer: draft.manufacturer,
    sticks: draft.sticks.map(({ lengthFt, sku }) => ({ lengthFt, sku })),
    spliceSku: draft.spliceSku,
    clampSku: draft.clampSku,
    hangerSpacingFt: draft.hangerSpacingFt,
  };
  const incomplete = draft.sticks.some((s) => !(Number(s.lengthFt) > 0) || !s.sku);
  const clean = sanitizePipeType({ ...payload, active: false });
  const problems = clean ? pipeTypeProblems(clean, new Set(Object.keys(known))) : ["Nothing to save."];
  const canActivate = problems.length === 0;
  const active = draft.active && canActivate;

  const save = () =>
    start(async () => {
      setError("");
      const r = await savePipeTypeAction({ ...payload, active });
      if (!r.ok) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  const picker = (sku: string, onPick: (sku: string) => void) => (
    <div style={{ marginTop: 8 }}>
      <PartPicker
        sku={sku}
        showSku={false}
        onPick={(picked, hit) => {
          setKnown((k) => ({ ...k, [picked]: { desc: hit.desc, cost: hit.cost, unit: hit.unit, mfr: "" } }));
          onPick(picked);
          setPicking(null);
        }}
      />
    </div>
  );

  const roleRow = (label: string, need: string, kind: "splice" | "clamp", sku: string, field: "spliceSku" | "clampSku") => (
    <div style={ROW}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, minWidth: 170 }}>{label}</span>
        <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>{need}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><PartLine sku={sku} info={known[sku]} /></span>
        <button type="button" style={BTN} onClick={() => setPicking(picking?.kind === kind ? null : { kind })}>{picking?.kind === kind ? "Done" : sku ? "Change" : "Map part"}</button>
        {sku && <button type="button" style={BTN} onClick={() => set(field, "")}>Clear</button>}
      </div>
      {picking?.kind === kind && picker(sku, (s) => set(field, s))}
    </div>
  );

  return (
    <div style={{ borderTop: "1px solid #eef0f3", marginTop: 10, paddingTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Name</div>
          <input value={draft.name} maxLength={RIGGING_LIMITS.name} placeholder={'e.g. 1-1/2" Sch 40 black'} onChange={(e) => set("name", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Manufacturer</div>
          <input value={draft.manufacturer} maxLength={RIGGING_LIMITS.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Hanger spacing (ft)</div>
          <input type="number" min={0} step="any" value={draft.hangerSpacingFt} onChange={(e) => set("hangerSpacingFt", e.target.value)} style={INPUT} />
        </label>
      </div>

      <div style={{ ...LABEL, marginTop: 16 }}>Stick lengths</div>
      <div style={{ display: "grid", gap: 6 }}>
        {draft.sticks.map((st) => {
          const footed = st.sku && isFootUnit(known[st.sku]?.unit);
          return (
            <div key={st.key} style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input type="number" min={0} step="any" value={st.lengthFt} placeholder="ft" aria-label="Stick length (ft)" onChange={(e) => setStick(st.key, { lengthFt: e.target.value })} style={{ ...INPUT, width: 80 }} />
                <span style={{ fontSize: 12, color: "#8c919c" }}>ft</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><PartLine sku={st.sku} info={known[st.sku]} /></span>
                <button type="button" style={BTN} onClick={() => setPicking(picking?.kind === "stick" && picking.key === st.key ? null : { kind: "stick", key: st.key })}>
                  {picking?.kind === "stick" && picking.key === st.key ? "Done" : st.sku ? "Change" : "Map part"}
                </button>
                <button type="button" style={BTN} aria-label="Remove this length" onClick={() => setDraft((d) => ({ ...d, sticks: d.sticks.filter((x) => x.key !== st.key) }))}>×</button>
              </div>
              {footed && <UnitWarning text="This part sells by the foot, but the configurator counts whole sticks. Check the price." />}
              {picking?.kind === "stick" && picking.key === st.key && picker(st.sku, (s) => setStick(st.key, { sku: s }))}
            </div>
          );
        })}
        {draft.sticks.length < RIGGING_LIMITS.sticks && (
          <div>
            <button type="button" style={BTN} onClick={() => setDraft((d) => ({ ...d, sticks: [...d.sticks, stickRow()] }))}>+ Add length</button>
          </div>
        )}
      </div>

      <div style={{ ...LABEL, marginTop: 16 }}>Parts</div>
      <div style={{ display: "grid", gap: 6 }}>
        {roleRow("Splice sleeve", "Needed once a run takes two sticks", "splice", draft.spliceSku, "spliceSku")}
        {roleRow("Hanging clamp", "Required", "clamp", draft.clampSku, "clampSku")}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, marginTop: 14, color: canActivate ? "#16181d" : "#9aa0ab" }}>
        <input type="checkbox" checked={active} disabled={!canActivate} onChange={(e) => set("active", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Active — offered in the pipe configurator
      </label>
      {!canActivate && <div style={{ fontSize: 11.5, color: "#8a6d1f", marginTop: 4 }}>Can&apos;t be active yet: {problems.join(" ")}</div>}

      {error && <div style={{ color: "#a0442b", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending || incomplete} style={incomplete ? { ...PRIMARY, opacity: 0.5, cursor: "not-allowed" } : PRIMARY}>
          {pending ? "Saving…" : type ? "Save type" : "Add type"}
        </button>
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
        {incomplete && <span style={{ fontSize: 11.5, color: "#a0442b" }}>Finish or remove the incomplete stick length.</span>}
        <span style={{ flex: 1 }} />
        {type && (
          <ConfirmButton
            label="Delete type"
            confirmLabel="Delete this type?"
            pendingLabel="Deleting…"
            style={BTN}
            onConfirm={async () => {
              const r = await deletePipeTypeAction(type.id);
              if (!r.ok) setError(r.error);
              else {
                onClose();
                router.refresh();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Write the Lineset types screen**

`src/app/(app)/estimating-rules/lineset-types/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { deleteLinesetType, saveLinesetType } from "@/lib/stores/rigging-types";

/** Estimating Rules → Lineset types (#373). Admin only; the store re-sanitizes and re-checks Active. */
export async function saveLinesetTypeAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await saveLinesetType(input, user.name);
  if (!r.ok) return r;
  revalidatePath("/estimating-rules/lineset-types");
  return { ok: true, id: r.type.id };
}

export async function deleteLinesetTypeAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!(await deleteLinesetType(String(id ?? "")))) return { ok: false, error: "This type no longer exists." };
  revalidatePath("/estimating-rules/lineset-types");
  return { ok: true };
}
```

`src/app/(app)/estimating-rules/lineset-types/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { listLinesetTypes } from "@/lib/stores/rigging-types";
import { linesetTypeSkus } from "@/lib/rigging-config/types";
import type { PartInfo } from "../rigging-ui";
import LinesetTypesClient from "./lineset-types-client";

export const metadata = { title: "Lineset types — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/** Estimating Rules → Lineset types (#373): the parts map behind the lineset configurator. Admin only. */
export default async function LinesetTypesPage() {
  const user = await requireUser();
  const back = <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Estimating rules</Link>;
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Lineset types</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Lineset types decide which catalog parts price a lineset, so editing them is limited to admins.</div>
        </div>
      </div>
    );
  }
  const [types, fixtures] = await Promise.all([listLinesetTypes(), listFixtures()]);
  const skus = [...new Set(types.flatMap((t) => linesetTypeSkus(t)))];
  const parts: Record<string, PartInfo> = {};
  for (const p of skus.length ? await getMany(skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  const assemblies = fixtures.filter((f) => f.kind === "hardware").map((f) => ({ id: f.id, name: f.name }));
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginTop: 6 }}>Lineset types</div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 18px", lineHeight: 1.5 }}>
        The cable, hand line, terminations and chain wraps for a counterweight lineset. A role can be a catalog part or a Hardware assembly; every price comes from the live catalog.
      </div>
      <LinesetTypesClient types={types} parts={parts} assemblies={assemblies} />
    </div>
  );
}
```

`src/app/(app)/estimating-rules/lineset-types/lineset-types-client.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import {
  DEFAULT_CABLE_ALLOWANCE_FT, LINESET_ROLES, LINESET_ROLE_NAMES, LINESET_ROLE_NOTES, RIGGING_LIMITS, isFootUnit, linesetTypeProblems, sanitizeLinesetType,
  type LinesetRole, type LinesetSource, type LinesetType,
} from "@/lib/rigging-config/types";
import { BTN, INPUT, LABEL, PRIMARY, PartLine, ROW, StatusChip, UnitWarning, day, type PartInfo } from "../rigging-ui";
import { deleteLinesetTypeAction, saveLinesetTypeAction } from "./actions";

type Assembly = { id: string; name: string };
type Draft = { id: string; name: string; manufacturer: string; parts: Partial<Record<LinesetRole, LinesetSource>>; allowanceFt: string; active: boolean };

const draftOf = (t: LinesetType | null): Draft =>
  t
    ? { id: t.id, name: t.name, manufacturer: t.manufacturer, parts: { ...t.parts }, allowanceFt: String(t.allowanceFt), active: t.active }
    : { id: "", name: "", manufacturer: "", parts: {}, allowanceFt: String(DEFAULT_CABLE_ALLOWANCE_FT), active: false };

function SourceLine({ source, parts, assemblies }: { source: LinesetSource | undefined; parts: Record<string, PartInfo>; assemblies: Assembly[] }) {
  if (!source) return <span style={{ color: "#a0442b" }}>Not mapped</span>;
  if (source.kind === "part") return <PartLine sku={source.sku} info={parts[source.sku]} />;
  const a = assemblies.find((x) => x.id === source.id);
  return a ? <span>Assembly: {a.name}</span> : <span style={{ color: "#a0442b" }}>Assembly no longer exists (counts as unmapped)</span>;
}

export default function LinesetTypesClient({ types, parts, assemblies }: { types: LinesetType[]; parts: Record<string, PartInfo>; assemblies: Assembly[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {open !== "new" && <button type="button" style={PRIMARY} onClick={() => setOpen("new")}>+ New lineset type</button>}
      </div>
      {open === "new" && (
        <section className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>New lineset type</div>
          <Editor type={null} parts={parts} assemblies={assemblies} onClose={() => setOpen(null)} />
        </section>
      )}
      {types.length === 0 && open !== "new" && (
        <div className="pk-card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No lineset types yet</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Add a type (e.g. 1/4&quot; cable, 5/8&quot; hand line) and map each role. Nothing is mapped for you.</div>
        </div>
      )}
      {types.map((t) => (
        <section key={t.id} className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14.5, fontWeight: 650 }}>{t.name}</span>
            {t.manufacturer && <span style={{ fontSize: 12.5, color: "#737985" }}>{t.manufacturer}</span>}
            <StatusChip active={t.active} />
            <span style={{ flex: 1 }} />
            <button type="button" style={BTN} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Close" : "Edit"}</button>
          </div>
          <div style={{ fontSize: 12, color: "#5b616e", marginTop: 5 }}>Cable allowance {t.allowanceFt}&apos; per lift line</div>
          {open === t.id ? (
            <Editor type={t} parts={parts} assemblies={assemblies} onClose={() => setOpen(null)} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 210px) minmax(0, 1fr)", gap: "3px 12px", fontSize: 12, marginTop: 8 }}>
              {LINESET_ROLES.map((r) => (
                <div key={r} style={{ display: "contents" }}>
                  <div style={{ color: "#737985" }}>{LINESET_ROLE_NAMES[r]}</div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><SourceLine source={t.parts[r]} parts={parts} assemblies={assemblies} /></div>
                </div>
              ))}
            </div>
          )}
          {t.updatedBy && open !== t.id && <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 8 }}>Last edited by {t.updatedBy} · {day(t.updatedAt)}</div>}
        </section>
      ))}
    </div>
  );
}

function Editor({ type, parts, assemblies, onClose }: { type: LinesetType | null; parts: Record<string, PartInfo>; assemblies: Assembly[]; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(type));
  const [known, setKnown] = useState<Record<string, PartInfo>>(parts);
  const [picking, setPicking] = useState<LinesetRole | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSource = (role: LinesetRole, source: LinesetSource | null) =>
    setDraft((d) => {
      const next = { ...d.parts };
      if (source) next[role] = source;
      else delete next[role];
      return { ...d, parts: next };
    });

  const payload = { ...(draft.id ? { id: draft.id } : {}), name: draft.name, manufacturer: draft.manufacturer, parts: draft.parts, allowanceFt: draft.allowanceFt };
  const clean = sanitizeLinesetType({ ...payload, active: false });
  const problems = clean ? linesetTypeProblems(clean, { skus: new Set(Object.keys(known)), assemblyIds: new Set(assemblies.map((a) => a.id)) }) : ["Nothing to save."];
  const canActivate = problems.length === 0;
  const active = draft.active && canActivate;

  const save = () =>
    start(async () => {
      setError("");
      const r = await saveLinesetTypeAction({ ...payload, active });
      if (!r.ok) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  return (
    <div style={{ borderTop: "1px solid #eef0f3", marginTop: 10, paddingTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Name</div>
          <input value={draft.name} maxLength={RIGGING_LIMITS.name} placeholder={'e.g. 1/4" cable, 5/8" hand line'} onChange={(e) => set("name", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Manufacturer</div>
          <input value={draft.manufacturer} maxLength={RIGGING_LIMITS.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Cable allowance (ft per lift line)</div>
          <input type="number" min={0} step="any" value={draft.allowanceFt} onChange={(e) => set("allowanceFt", e.target.value)} style={INPUT} />
        </label>
      </div>

      <div style={{ ...LABEL, marginTop: 16 }}>Parts</div>
      <div style={{ display: "grid", gap: 6 }}>
        {LINESET_ROLES.map((role) => {
          const source = draft.parts[role];
          const perFoot = role === "cable" || role === "handLine";
          const badUnit = perFoot && source?.kind === "part" && known[source.sku] && !isFootUnit(known[source.sku].unit);
          return (
            <div key={role} style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 650, minWidth: 130 }}>{LINESET_ROLE_NAMES[role]}</span>
                <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>{LINESET_ROLE_NOTES[role]}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><SourceLine source={source} parts={known} assemblies={assemblies} /></span>
                <button type="button" style={BTN} onClick={() => setPicking(picking === role ? null : role)}>{picking === role ? "Done" : source ? "Change" : "Map"}</button>
                {source && <button type="button" style={BTN} onClick={() => setSource(role, null)}>Clear</button>}
              </div>
              {badUnit && <UnitWarning text={`This part sells by "${known[(source as { sku: string }).sku].unit}", but the configurator counts feet. Check the price.`} />}
              {picking === role && (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  <PartPicker
                    sku={source?.kind === "part" ? source.sku : ""}
                    showSku={false}
                    onPick={(picked, hit) => {
                      setKnown((k) => ({ ...k, [picked]: { desc: hit.desc, cost: hit.cost, unit: hit.unit, mfr: "" } }));
                      setSource(role, { kind: "part", sku: picked });
                      setPicking(null);
                    }}
                  />
                  {assemblies.length > 0 && (
                    <select
                      aria-label={`${LINESET_ROLE_NAMES[role]} Hardware assembly`}
                      value={source?.kind === "assembly" ? source.id : ""}
                      onChange={(e) => {
                        setSource(role, e.target.value ? { kind: "assembly", id: e.target.value } : null);
                        setPicking(null);
                      }}
                      style={INPUT}
                    >
                      <option value="">Or pick a Hardware assembly…</option>
                      {assemblies.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, marginTop: 14, color: canActivate ? "#16181d" : "#9aa0ab" }}>
        <input type="checkbox" checked={active} disabled={!canActivate} onChange={(e) => set("active", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Active — offered in the lineset configurator
      </label>
      {!canActivate && <div style={{ fontSize: 11.5, color: "#8a6d1f", marginTop: 4 }}>Can&apos;t be active yet: {problems.join(" ")}</div>}

      {error && <div style={{ color: "#a0442b", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending} style={PRIMARY}>{pending ? "Saving…" : type ? "Save type" : "Add type"}</button>
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
        <span style={{ flex: 1 }} />
        {type && (
          <ConfirmButton
            label="Delete type"
            confirmLabel="Delete this type?"
            pendingLabel="Deleting…"
            style={BTN}
            onConfirm={async () => {
              const r = await deleteLinesetTypeAction(type.id);
              if (!r.ok) setError(r.error);
              else {
                onClose();
                router.refresh();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Link the screens**

In `src/app/(app)/estimating-rules/page.tsx`, directly after the closing `</Link>` of the Track series card, add two cards:

```tsx
          <Link href="/estimating-rules/pipe-types" className="pk-card er-noprint" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 17px", marginBottom: 14, textDecoration: "none", color: "inherit" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Pipe types</div>
              <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 2 }}>The stick lengths, splice and clamp for each kind of pipe — what the pipe configurator prices.</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>Open →</span>
          </Link>
          <Link href="/estimating-rules/lineset-types" className="pk-card er-noprint" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 17px", marginBottom: 14, textDecoration: "none", color: "inherit" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Lineset types</div>
              <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 2 }}>The cable, hand line, terminations and chain wraps for a counterweight lineset — what the lineset configurator prices.</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>Open →</span>
          </Link>
```

In `scripts/smoke-routes.ts`, after the `"/estimating-rules/track-series"` entry:

```ts
  "/estimating-rules/pipe-types", // #373 — the pipe configurator's parts map (admin)
  "/estimating-rules/lineset-types", // #373 — the lineset configurator's parts map (admin)
```

- [ ] **Step 10: Check and commit**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npx eslint "src/app/(app)/estimating-rules" src/lib/rigging-config src/lib/stores/rigging-types.ts`
Expected: no errors.

```bash
git add src/lib/stores/rigging-types.ts src/lib/catalog-rename "src/app/(app)/estimating-rules" scripts/smoke-routes.ts scripts/test-rigging-config.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): #373 Pipe types and Lineset types in Estimating Rules"
```

---

### Task 3: Pricing and line building

**Files:**
- Create: `src/app/(app)/estimator/rigging-bom.ts`
- Modify: `src/app/(app)/estimator/types.ts:160` and `:408`, `scripts/test-rigging-config.ts`

**Interfaces:**
- Consumes: Task 1 engines; `catalogAddPrice`, `seedMarkupOf` from `./tier-reprice`; `round2` from `./pricing`; `sellAt` from `@/lib/markup`
- Produces: `riggingCatalog`, `pipeBom`, `linesetBom`, `pipeLine`, `linesetLine`, `pipeConfigFromDraft`, `pipeDraftFromConfig`, `freshPipeDraft`, `linesetConfigFromDraft`, `linesetDraftFromConfig`, `freshLinesetDraft`, `selectableTypes`, `curtainPipePrefill`, `curtainPipeDraft`, `followCurtainPipePrefill`, types `RiggingCatalog`, `RiggingBom`, `CurtainPipePrefill`; `SpecItem.rigging`, `PipeDraft`, `LinesetDraft`, in `types.ts`

- [ ] **Step 1: Add the types**

In `src/app/(app)/estimator/types.ts`, add `import type { RiggingConfig } from "@/lib/rigging-config/types";` beside the other lib type imports. After the `track?: TrackConfig;` field:

```ts
  /** #373: a configured pipe or lineset line — the inputs, kept so the line
   *  reopens its modal. One lot; priced parts ride in `components`, as a track
   *  line's do. Built by rigging-bom.ts. */
  rigging?: RiggingConfig;
```

After the `TrackPart` type:

```ts
/** #373: the pipe configurator's form (rigging-bom.ts turns it into a PipeConfig). Blank spacing = the type's. */
export type PipeDraft = { typeId: string; run: string; qty: string; hangerSpacing: string; label: string };
/** #373: the lineset configurator's form. Blank lines / allowance = the defaults. */
export type LinesetDraft = { typeId: string; sets: string; width: string; gridHeight: string; linesPerSet: string; allowance: string; label: string };
```

- [ ] **Step 2: Write the failing checks**

Add to `scripts/test-rigging-config.ts` imports:

```ts
import type { ResolvedFixtureAssembly } from "../src/lib/fixture-assemblies";
import {
  curtainPipeDraft, curtainPipePrefill, followCurtainPipePrefill, freshLinesetDraft, freshPipeDraft, linesetBom, linesetConfigFromDraft, linesetDraftFromConfig, linesetLine,
  pipeBom, pipeConfigFromDraft, pipeDraftFromConfig, pipeLine, riggingCatalog, selectableTypes,
} from "../src/app/(app)/estimator/rigging-bom";
```

Add above `riggingConfigChecks`:

```ts
const part = (sku: string, cost: number, list = 0, unit = "ea") => ({ sku, desc: sku + " desc", cost, list, unit, mfr: "" });
const PARTS = { P10: part("P10", 50), P21: part("P21", 100), SPL: part("SPL", 20), CLP: part("CLP", 10), GAC: part("GAC", 1, 0, "ft"), HL: part("HL", 2, 0, "ft"), TRM: part("TRM", 5) };
const HW = (id: string, comps: Array<[string, number, boolean?]>, kind: "hardware" | "fixture" = "hardware") =>
  ({ id, name: id, kind, components: comps.map(([sku, defaultQty, found]) => ({ sku, label: sku + " label", role: "other", defaultQty, desc: sku, unit: "ea", cost: 3, list: 9, found: found ?? true })) }) as unknown as ResolvedFixtureAssembly;
const CAT = riggingCatalog(PARTS, [HW("SA-1", [["SWG", 2], ["THB", 1], ["OPT", 0]]), HW("FX-1", [["F", 1]], "fixture"), HW("BROKEN", [["DEAD", 1, false]])]);

function pricingChecks(ok: Ok) {
  // 2 × $100 + 1 × $20 + 5 × $10 = $270 cost; at 50 % markup, $405.
  const b = pipeBom({ typeId: "sch40", runFt: 40, qty: 1 }, PIPE, CAT, 0.5);
  ok(!b.errors.length && b.cost === 270 && b.price === 405, "#373 pipe price: tier seed on the parts' cost");
  ok(b.rows.map((r) => r.label).join() === "Pipe (21' stick),Splice sleeve,Hanging clamp", "#373 pipe rows named");
  ok(b.rows[0].ext === 300 && b.rows[0].price === 150, "#373 pipe row: unit sell and extended");
  ok(pipeBom({ typeId: "sch40", runFt: 40, qty: 1 }, { ...PIPE, spliceSku: undefined }, CAT, 0.5).errors[0].includes("Estimating Rules → Pipe types"), "#373 pipe: a needed unmapped splice blocks and names the screen");
  ok(!pipeBom({ typeId: "sch40", runFt: 15, qty: 1 }, { ...PIPE, spliceSku: undefined }, CAT, 0.5).errors.length, "#373 pipe: an unneeded unmapped splice doesn't block");
  const listed = riggingCatalog({ ...PARTS, CLP: part("CLP", 0, 25) }, []);
  ok(pipeBom({ typeId: "sch40", runFt: 15, qty: 1 }, PIPE, listed, 0.5).price === 225, "#373 pipe: a part with no cost sells at list");
  ok(pipeBom({ typeId: "x", runFt: 40, qty: 1 }, null, CAT, 0.5).errors[0].includes("no longer exists"), "#373 pipe: deleted type");
  ok(pipeBom({ typeId: "sch40", runFt: 40, qty: 1 }, { ...PIPE, sticks: [{ lengthFt: 21, sku: "FOOT" }] }, riggingCatalog({ ...PARTS, FOOT: part("FOOT", 5, 0, "ft") }, []), 0.5).warnings.length === 1, "#373 pipe: a foot-priced stick warns and doesn't block");

  const l = linesetBom({ typeId: "quarter", sets: 6, widthFt: 40, gridHeightFt: 40 }, LINESET, CAT, 0.5);
  ok(!l.errors.length, "#373 lineset: prices");
  // 24 chain wraps × (SWG 2, THB 1); OPT is an add-on and left out.
  const swg = l.rows.find((r) => r.sku === "SWG");
  const thb = l.rows.find((r) => r.sku === "THB");
  ok(swg?.qty === 48 && thb?.qty === 24 && !l.rows.some((r) => r.sku === "OPT"), "#373 lineset: assembly members multiply; add-ons left out");
  ok(swg?.label === "Chain wraps: SWG label", "#373 lineset: member row names the role and the member");
  ok(swg?.price === 4.5, "#373 lineset: members price at the tier on the assembly's cost, not its sell");
  // 1680×$1 + 480×$2 + 48×$5 + 72×$3 = $3,096.
  ok(l.cost === 3096 && l.price === 4644, "#373 lineset: line total");
  const asmType = (id: string): LinesetType => ({ ...LINESET, parts: { ...LINESET.parts, chainWrap: { kind: "assembly", id } } });
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, asmType("GONE"), CAT, 0.5).errors[0].includes("Chain wraps"), "#373 lineset: a deleted assembly blocks by role");
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, asmType("FX-1"), CAT, 0.5).errors.length === 1, "#373 lineset: a non-hardware assembly blocks");
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, asmType("BROKEN"), CAT, 0.5).errors.length === 1, "#373 lineset: an assembly with a part gone from the catalog blocks");
  const spool = riggingCatalog({ ...PARTS, GAC: part("GAC", 300, 0, "spool") }, [HW("SA-1", [["SWG", 2]])]);
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, LINESET, spool, 0.5).warnings.some((w) => w.includes("Aircraft cable")), "#373 lineset: non-foot cable warns");

  const line = pipeLine({ typeId: "sch40", runFt: 40, qty: 2, label: "Main drape pipe" }, PIPE, CAT, 0.5);
  ok(line.ok && line.item.sku === "PIP-SCH40" && line.item.qty === 1 && line.item.unit === "lot", "#373 pipe line: one lot");
  ok(line.ok && line.item.desc === "Main drape pipe — 1-1/2\" Sch 40, 40' run (2 pipes)", "#373 pipe line: description");
  ok(line.ok && line.item.rigging?.kind === "pipe" && line.item.components!.length === 3, "#373 pipe line: config and parts");
  ok(line.ok && line.item.components!.find((c) => c.sku === "CLP")?.role === "mount", "#373 pipe line: clamps are mounts");
  const ll = linesetLine({ typeId: "quarter", sets: 6, widthFt: 40, gridHeightFt: 40 }, LINESET, CAT, 0.5);
  ok(ll.ok && ll.item.sku === "LNS-QUARTER" && ll.item.desc === "Lineset hardware — 1/4\" cable: 6 sets, 24 lift lines", "#373 lineset line: description");

  const pd = freshPipeDraft([{ ...PIPE, active: false }, { ...PIPE, id: "on", active: true }]);
  ok(pd.typeId === "on" && pd.qty === "1", "#373 draft: fresh pipe takes the first active type");
  ok(selectableTypes([{ ...PIPE, active: false }], "sch40").length === 1 && selectableTypes([{ ...PIPE, active: false }]).length === 0, "#373 selectable: inactive only when it's the draft's own");
  const round = pipeConfigFromDraft(pipeDraftFromConfig({ typeId: "a", runFt: 12.5, qty: 3, hangerSpacingFt: 8, label: "L" }));
  ok(round.runFt === 12.5 && round.qty === 3 && round.hangerSpacingFt === 8 && round.label === "L", "#373 draft: pipe round trip");
  const blank = pipeConfigFromDraft({ typeId: "a", run: "", qty: "", hangerSpacing: "", label: " " });
  ok(Number.isNaN(blank.runFt) && blank.qty === 1 && blank.hangerSpacingFt === undefined && blank.label === undefined, "#373 draft: blanks");
  const lr = linesetConfigFromDraft(linesetDraftFromConfig({ typeId: "a", sets: 6, widthFt: 40, gridHeightFt: 30, linesPerSet: 5, allowanceFt: 0, label: "L" }));
  ok(lr.sets === 6 && lr.linesPerSet === 5 && lr.allowanceFt === 0 && lr.label === "L", "#373 draft: lineset round trip keeps a 0' allowance");
  const lb = linesetConfigFromDraft(freshLinesetDraft([]));
  ok(lb.linesPerSet === undefined && lb.allowanceFt === undefined, "#373 draft: blank lineset fields are defaults");

  const c = { name: "Main drape", qty: "2", width: "40" };
  ok(curtainPipePrefill(c).label === "Main drape pipe" && curtainPipePrefill(c).run === "40" && curtainPipePrefill(c).qty === "2", "#373 curtain: pre-fill");
  const prev = curtainPipePrefill(c);
  const d = { ...curtainPipeDraft(c, [{ ...PIPE, active: true }]), label: "Typed" };
  const next = followCurtainPipePrefill(d, prev, curtainPipePrefill({ ...c, width: "50" }));
  ok(next.run === "50" && next.label === "Typed", "#373 curtain: untouched fields follow; typed ones stay");
}
```

Add `pricingChecks(ok);` inside `riggingConfigChecks`.

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: fails with `Cannot find module` for `rigging-bom`.

- [ ] **Step 4: Write `rigging-bom.ts`**

`src/app/(app)/estimator/rigging-bom.ts`:

```ts
import { sellAt } from "@/lib/markup";
import type { ResolvedFixtureAssembly } from "@/lib/fixture-assemblies";
import { linesetQuantities } from "@/lib/rigging-config/lineset";
import { pipeQuantities } from "@/lib/rigging-config/pipe";
import {
  LINESET_ROLES, LINESET_ROLE_NAMES, LINESET_TYPES_HOME, PIPE_TYPES_HOME, isFootUnit,
  type LinesetConfig, type LinesetRole, type LinesetSource, type LinesetType, type PipeConfig, type PipeType,
} from "@/lib/rigging-config/types";
import { round2 } from "./pricing";
import { catalogAddPrice, seedMarkupOf } from "./tier-reprice";
import type { CurtainDraft, LinesetDraft, PipeDraft, SpecItem, TrackPart } from "./types";

/**
 * #373 — pricing a configured pipe or lineset and the one estimate line it
 * becomes. Pure. The engines say how many of each role; each role resolves to a
 * catalog part or a Hardware assembly's included members, priced exactly as
 * trackBom prices a track's parts, so the line is an ordinary tier-seeded line.
 * An assembly's members use its resolved cost but sell at the tier, never at the
 * assembly's own sell, which keeps the whole line on one seed.
 */

type Member = { sku: string; label: string; qty: number; unit: string; cost: number; list: number };
export type RiggingAssembly = { name: string; members: Member[]; broken: boolean };
export type RiggingCatalog = { parts: Record<string, TrackPart>; assemblies: Record<string, RiggingAssembly> };

export type RiggingBomRow = {
  key: string;
  label: string;
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  ext: number;
  missing: boolean;
  mount: boolean;
};
export type RiggingBom = { rows: RiggingBomRow[]; errors: string[]; warnings: string[]; cost: number; price: number };

export const RIGGING_TYPE_GONE = "This type no longer exists.";

/** The client's lookup: the mapped parts plus every Hardware assembly (add-ons left out). */
export function riggingCatalog(parts: Record<string, TrackPart>, assemblies: readonly ResolvedFixtureAssembly[]): RiggingCatalog {
  const out: Record<string, RiggingAssembly> = {};
  for (const a of assemblies) {
    if (a.kind !== "hardware") continue;
    const included = a.components.filter((c) => c.defaultQty > 0);
    out[a.id] = {
      name: a.name,
      members: included.map((c) => ({ sku: c.sku, label: c.label || c.sku, qty: c.defaultQty, unit: c.unit, cost: c.cost, list: c.list })),
      broken: !included.length || included.some((c) => !c.found),
    };
  }
  return { parts, assemblies: out };
}

type Wanted = { key: string; label: string; qty: number; source: LinesetSource | null; mount?: boolean; unit?: "foot" | "notFoot" };

function own<T>(rec: Record<string, T>, k: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined;
}

function priceRows(typeName: string, home: string, wanted: readonly Wanted[], catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingBom {
  const k = seedMarkupOf(tierMargin);
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: RiggingBomRow[] = [];
  let cost = 0;
  let costed = 0;
  let listed = 0;
  const add = (key: string, label: string, sku: string, desc: string, qty: number, unit: string, unitCost: number, unitList: number, mount: boolean) => {
    const price = catalogAddPrice(unitCost, unitList, tierMargin);
    cost += unitCost * qty;
    if (unitCost > 0) costed += unitCost * qty;
    else listed += unitList * qty;
    rows.push({ key, label, sku, desc, qty, unit, cost: unitCost, price, ext: round2(price * qty), missing: false, mount });
  };
  const miss = (w: Wanted, desc: string) => {
    errors.push(`${typeName} has no part for ${w.label} — map it in ${home}.`);
    rows.push({ key: w.key, label: w.label, sku: "", desc, qty: w.qty, unit: "", cost: 0, price: 0, ext: 0, missing: true, mount: !!w.mount });
  };
  for (const w of wanted) {
    if (!w.source) {
      miss(w, "No part mapped");
    } else if (w.source.kind === "part") {
      const p = own(catalog.parts, w.source.sku);
      if (!p) {
        miss(w, `${w.source.sku} — no longer in the catalog`);
        continue;
      }
      add(w.key, w.label, p.sku, p.desc || w.label, w.qty, p.unit || "ea", Number(p.cost) || 0, Number(p.list) || 0, !!w.mount);
      if (w.unit === "foot" && !isFootUnit(p.unit)) warnings.push(`${w.label} part ${p.sku} sells by "${p.unit || "ea"}", but this counts feet. Check the price.`);
      if (w.unit === "notFoot" && isFootUnit(p.unit)) warnings.push(`${w.label} part ${p.sku} sells by the foot, but this counts whole sticks. Check the price.`);
    } else {
      const a = own(catalog.assemblies, w.source.id);
      if (!a || a.broken) {
        miss(w, a ? `${a.name} — a part is no longer in the catalog` : "Assembly no longer exists");
        continue;
      }
      a.members.forEach((m, i) => add(`${w.key}:${i}`, `${w.label}: ${m.label}`, m.sku, m.label, w.qty * m.qty, m.unit || "ea", Number(m.cost) || 0, Number(m.list) || 0, !!w.mount));
    }
  }
  const price = errors.length ? 0 : round2(sellAt(costed, k) + listed);
  if (!errors.length && !(price > 0)) errors.push(`${typeName}'s parts have no cost or price in the catalog.`);
  return { rows, errors, warnings, cost: errors.length ? 0 : cost, price };
}

const partSource = (sku: string | undefined): LinesetSource | null => (sku ? { kind: "part", sku } : null);
const empty = (error: string): RiggingBom => ({ rows: [], errors: [error], warnings: [], cost: 0, price: 0 });

export function pipeBom(config: PipeConfig, type: PipeType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingBom {
  if (!type) return empty(RIGGING_TYPE_GONE);
  const q = pipeQuantities(config, type);
  if (q.errors.length) return { rows: [], errors: q.errors, warnings: [], cost: 0, price: 0 };
  const wanted = q.rows.map((r): Wanted => {
    if (r.role === "stick") return { key: "stick", label: `Pipe (${fmtFt(r.lengthFt!)} stick)`, qty: r.qty, source: partSource(r.sku), unit: "notFoot" };
    if (r.role === "splice") return { key: "splice", label: "Splice sleeve", qty: r.qty, source: partSource(type.spliceSku) };
    return { key: "clamp", label: "Hanging clamp", qty: r.qty, source: partSource(type.clampSku), mount: true };
  });
  return priceRows(type.name, PIPE_TYPES_HOME, wanted, catalog, tierMargin);
}

export function linesetBom(config: LinesetConfig, type: LinesetType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingBom {
  if (!type) return empty(RIGGING_TYPE_GONE);
  const q = linesetQuantities(config, type);
  if (q.errors.length) return { rows: [], errors: q.errors, warnings: [], cost: 0, price: 0 };
  const qty = (role: LinesetRole) => q.rows.find((r) => r.role === role)?.qty ?? 0;
  const wanted = LINESET_ROLES.map((role): Wanted => ({
    key: role,
    label: LINESET_ROLE_NAMES[role],
    qty: qty(role),
    source: type.parts[role] ?? null,
    ...(role === "cable" || role === "handLine" ? { unit: "foot" as const } : {}),
  }));
  return priceRows(type.name, LINESET_TYPES_HOME, wanted, catalog, tierMargin);
}

/** "40'", "12.5'". */
export function fmtFt(n: number): string {
  return (Math.round(n * 100) / 100).toString() + "'";
}

export function pipeLineDesc(c: PipeConfig, type: Pick<PipeType, "name">): string {
  const label = (c.label || "").trim() || "Pipe";
  return `${label} — ${type.name}, ${fmtFt(c.runFt)} run${c.qty > 1 ? ` (${c.qty} pipes)` : ""}`;
}

export function linesetLineDesc(c: LinesetConfig, type: Pick<LinesetType, "name">, liftLines: number): string {
  const label = (c.label || "").trim() || "Lineset hardware";
  return `${label} — ${type.name}: ${c.sets} ${c.sets === 1 ? "set" : "sets"}, ${liftLines} lift ${liftLines === 1 ? "line" : "lines"}`;
}

export type RiggingLineResult = { ok: true; item: Omit<SpecItem, "id">; bom: RiggingBom } | { ok: false; errors: string[]; bom: RiggingBom };

function buildLine(sku: string, desc: string, rigging: NonNullable<SpecItem["rigging"]>, manufacturer: string, bom: RiggingBom): RiggingLineResult {
  const components: NonNullable<SpecItem["components"]> = bom.rows.map((r) => ({
    sku: r.sku,
    label: r.label,
    role: r.mount ? "mount" : "other",
    qty: r.qty,
    unit: r.unit,
    cost: r.cost,
    price: r.price,
  }));
  const item: Omit<SpecItem, "id"> = { sku, desc, qty: 1, unit: "lot", cost: bom.cost, price: bom.price, components, rigging };
  if (manufacturer) item.manufacturer = manufacturer;
  return { ok: true, item, bom };
}

export function cleanPipeConfig(c: PipeConfig): PipeConfig {
  const label = (c.label || "").trim();
  return { typeId: c.typeId, runFt: c.runFt, qty: c.qty, ...(c.hangerSpacingFt != null ? { hangerSpacingFt: c.hangerSpacingFt } : {}), ...(label ? { label } : {}) };
}

export function cleanLinesetConfig(c: LinesetConfig): LinesetConfig {
  const label = (c.label || "").trim();
  return {
    typeId: c.typeId, sets: c.sets, widthFt: c.widthFt, gridHeightFt: c.gridHeightFt,
    ...(c.linesPerSet != null ? { linesPerSet: c.linesPerSet } : {}),
    ...(c.allowanceFt != null ? { allowanceFt: c.allowanceFt } : {}),
    ...(label ? { label } : {}),
  };
}

export function pipeLine(config: PipeConfig, type: PipeType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingLineResult {
  const bom = pipeBom(config, type, catalog, tierMargin);
  if (!type || bom.errors.length) return { ok: false, errors: bom.errors, bom };
  return buildLine("PIP-" + type.id.toUpperCase(), pipeLineDesc(config, type), { kind: "pipe", ...cleanPipeConfig(config) }, type.manufacturer, bom);
}

export function linesetLine(config: LinesetConfig, type: LinesetType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingLineResult {
  const bom = linesetBom(config, type, catalog, tierMargin);
  if (!type || bom.errors.length) return { ok: false, errors: bom.errors, bom };
  const { liftLines } = linesetQuantities(config, type);
  return buildLine("LNS-" + type.id.toUpperCase(), linesetLineDesc(config, type, liftLines), { kind: "lineset", ...cleanLinesetConfig(config) }, type.manufacturer, bom);
}

/* ---------------- drafts ---------------- */

const numOf = (s: string): number => {
  const t = (s ?? "").trim();
  return t === "" ? NaN : Number(t);
};
const optionalNum = (s: string): number | undefined => {
  const t = (s ?? "").trim();
  return t === "" ? undefined : Number(t);
};
const str = (n: number | undefined) => (n != null && Number.isFinite(n) ? String(n) : "");

export function selectableTypes<T extends { id: string; active: boolean }>(all: readonly T[], keepId?: string): T[] {
  return all.filter((t) => t.active || (!!keepId && t.id === keepId));
}

export function freshPipeDraft(all: readonly PipeType[]): PipeDraft {
  return { typeId: selectableTypes(all)[0]?.id || "", run: "", qty: "1", hangerSpacing: "", label: "" };
}

export function pipeConfigFromDraft(d: PipeDraft): PipeConfig {
  const qtyText = (d.qty ?? "").trim();
  const label = (d.label || "").trim();
  const spacing = optionalNum(d.hangerSpacing);
  return { typeId: d.typeId, runFt: numOf(d.run), qty: qtyText === "" ? 1 : Number(qtyText), ...(spacing !== undefined ? { hangerSpacingFt: spacing } : {}), ...(label ? { label } : {}) };
}

export function pipeDraftFromConfig(c: PipeConfig): PipeDraft {
  return { typeId: c.typeId, run: str(c.runFt), qty: str(c.qty), hangerSpacing: str(c.hangerSpacingFt), label: c.label || "" };
}

export function freshLinesetDraft(all: readonly LinesetType[]): LinesetDraft {
  return { typeId: selectableTypes(all)[0]?.id || "", sets: "", width: "", gridHeight: "", linesPerSet: "", allowance: "", label: "" };
}

export function linesetConfigFromDraft(d: LinesetDraft): LinesetConfig {
  const label = (d.label || "").trim();
  const lines = optionalNum(d.linesPerSet);
  const allowance = optionalNum(d.allowance);
  return {
    typeId: d.typeId, sets: numOf(d.sets), widthFt: numOf(d.width), gridHeightFt: numOf(d.gridHeight),
    ...(lines !== undefined ? { linesPerSet: lines } : {}),
    ...(allowance !== undefined ? { allowanceFt: allowance } : {}),
    ...(label ? { label } : {}),
  };
}

export function linesetDraftFromConfig(c: LinesetConfig): LinesetDraft {
  return { typeId: c.typeId, sets: str(c.sets), width: str(c.widthFt), gridHeight: str(c.gridHeightFt), linesPerSet: str(c.linesPerSet), allowance: str(c.allowanceFt), label: c.label || "" };
}

/* ---------------- Add pipe from a curtain ---------------- */

export type CurtainPipePrefill = Pick<PipeDraft, "run" | "qty" | "label">;

export function curtainPipePrefill(c: Pick<CurtainDraft, "name" | "qty" | "width">): CurtainPipePrefill {
  const width = parseFloat(c.width) || 0;
  const name = (c.name || "").trim();
  return { run: width > 0 ? String(Math.round(width * 100) / 100) : "", qty: String(Math.max(1, parseInt(c.qty, 10) || 1)), label: name ? name + " pipe" : "" };
}

export function curtainPipeDraft(c: Pick<CurtainDraft, "name" | "qty" | "width">, all: readonly PipeType[]): PipeDraft {
  return { ...freshPipeDraft(all), ...curtainPipePrefill(c) };
}

/** The curtain changed: every pre-filled field the user hasn't touched follows; anything typed is kept. */
export function followCurtainPipePrefill(d: PipeDraft, prev: CurtainPipePrefill, next: CurtainPipePrefill): PipeDraft {
  const out = { ...d };
  if (d.run === prev.run) out.run = next.run;
  if (d.qty === prev.qty) out.qty = next.qty;
  if (d.label === prev.label) out.label = next.label;
  return out;
}
```

- [ ] **Step 5: Run the checks**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: `0 FAIL`. `fmtFt` is a `function` declaration, so its use above its definition is fine.

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/rigging-bom.ts" "src/app/(app)/estimator/types.ts" scripts/test-rigging-config.ts
git commit -m "feat(estimator): #373 pricing and line building for pipe and lineset"
```

---

### Task 4: Everything that reads a configured line

**Files:**
- Modify: `src/app/(app)/estimator/tier-reprice.ts:191`, `src/app/(app)/estimator/copy-system.ts:127`, `src/app/(app)/estimator/copy-pricing.ts:33`, `src/app/(app)/estimator/custom-part-edit.ts:13-15`, `src/lib/quote-line-members.ts:40-46` and `:141`, `src/lib/project-discounts/rules.ts:130`, `src/lib/estimate-output/bom-models.ts:37-49`, `scripts/test-rigging-config.ts`

**Interfaces:**
- Consumes: `isConfiguredLine` (Task 1), `pipeLine`, `linesetLine` (Task 3)
- Produces: nothing new. A `rigging` line behaves like a track line in every reader.

- [ ] **Step 1: Write the failing checks**

Add to `scripts/test-rigging-config.ts` imports:

```ts
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import { repriceForTier } from "../src/app/(app)/estimator/tier-reprice";
import { copySectionForTarget } from "../src/app/(app)/estimator/copy-system";
import { isCustomLineEditable } from "../src/app/(app)/estimator/custom-part-edit";
import { expandLine, isAssemblyLine, primaryMemberSku } from "../src/lib/quote-line-members";
import { applyProjectDiscounts, discountSkuOf } from "../src/lib/project-discounts/rules";
import { bomModelEligible } from "../src/lib/estimate-output/bom-models";
```

Add above `riggingConfigChecks`:

```ts
function readerChecks(ok: Ok) {
  const res = pipeLine({ typeId: "sch40", runFt: 40, qty: 1 }, PIPE, CAT, 0.5);
  if (!res.ok) { ok(false, "#373 readers: fixture line"); return; }
  const line = { ...res.item, id: 1 } as SpecItem;
  const sec = { id: "s", name: "S", kind: "materials", mfr: "", freightPct: 0, items: [line] } as unknown as SpecSection;

  const moved = repriceForTier([sec], 0.5, 0.25);
  const it = moved.sections[0].items[0];
  ok(moved.repriced === 1 && it.price === 337.5, "#373 tier re-price: the line moves to the new seed");
  ok(it.components!.find((c) => c.sku === "P21")?.price === 125, "#373 tier re-price: its parts follow");

  const copied = copySectionForTarget(sec, { newSectionId: "n", catalog: new Map([["P21", { sku: "P21", cost: 110, list: 0 }]]), fixtures: new Map(), sourceTierMargin: 0.5, targetTierMargin: 0.5 });
  const c = copied.section.items[0];
  ok(c.cost === 290 && c.components!.find((x) => x.sku === "P21")?.cost === 110, "#373 Copy system: parts take today's cost, not a fixture refresh");
  ok(c.price === 435 && c.rigging?.kind === "pipe", "#373 Copy system: sell follows the seed and the config travels");

  ok(!isAssemblyLine(line) && primaryMemberSku(line) === null, "#373 members: not an assembly line (no photo or paragraph alias)");
  ok(expandLine(line)?.length === 3, "#373 members: still expands for datasheets");
  ok(discountSkuOf(line) === "", "#373 discounts: the line itself isn't discountable");
  const disc = applyProjectDiscounts([sec], { P21: { pct: 10, note: "", by: "t", at: 1 } })[0].items[0];
  ok(disc.price === line.price && disc.cost === 250 && disc.components!.find((x) => x.sku === "P21")?.projectDiscountPct === 10, "#373 discounts: its parts discount inside it; sell never moves");
  ok(!bomModelEligible({ ...line, components: [] }), "#373 BOM models: never prints a model, even with no parts");
  ok(!isCustomLineEditable({ ...line, custom: true }), "#373 custom: never a custom line");

  // A track line takes the same paths as before: nothing here may move it.
  const { rigging: _r, ...plain } = line;
  void _r;
  const track = { ...plain, sku: "TRK-A", track: { seriesId: "a" } } as unknown as SpecItem;
  const trackSec = { ...sec, items: [track] };
  const t2 = repriceForTier([trackSec], 0.5, 0.25).sections[0].items[0];
  ok(t2.price === 337.5 && t2.components!.find((c) => c.sku === "P21")?.price === 125, "#373 regression: a track line re-prices as before");
  const t3 = copySectionForTarget(trackSec, { newSectionId: "n", catalog: new Map([["P21", { sku: "P21", cost: 110, list: 0 }]]), fixtures: new Map(), sourceTierMargin: 0.5, targetTierMargin: 0.5 }).section.items[0];
  ok(t3.cost === 290 && t3.price === 435, "#373 regression: a track line copies as before");
  ok(!isAssemblyLine(track) && expandLine(track)?.length === 3 && discountSkuOf(track) === "" && !bomModelEligible({ ...track, components: [] }), "#373 regression: a track line reads as before");
  ok(!isCustomLineEditable({ ...track, custom: true }), "#373 regression: a track line is never a custom line");
}
```

Add `readerChecks(ok);` inside `riggingConfigChecks`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: FAIL lines for tier re-price parts, Copy system and BOM models.

- [ ] **Step 3: Update the readers**

`tier-reprice.ts`, add `import { isConfiguredLine } from "@/lib/rigging-config/line";` and change line 191:

```ts
      // #274 / #373: a configured line's parts follow the line to the new seed.
      if (isConfiguredLine(it) && Array.isArray(it.components)) return { ...it, price: v.price, components: reseedTrackComponents(it.components, nextK) };
```

`copy-system.ts`, add the same import and change line 127:

```ts
    const track = isConfiguredLine(it) && comps.length > 0;
```

`copy-pricing.ts`, add the same import and change line 33:

```ts
      // #274 / #373: a configured line's parts are plain catalog parts — no fixture record.
      if (!isConfiguredLine(it)) fixtureIds.add(it.fixtureId || it.sku);
```

`custom-part-edit.ts`:

```ts
/** A hand-entered custom part — not labor, track, pipe, lineset, curtain, fixture, rack, vendor quote or a portal price-request. */
export function isCustomLineEditable(
  it: Pick<SpecItem, "custom" | "labor" | "track" | "rigging" | "curtain" | "fixture" | "rackId" | "vendorQuoteId" | "por" | "mob">,
): boolean {
```

and add `&& !it.rigging` right after `!it.track` in the return. Leave the rest of the expression unchanged.

`src/lib/quote-line-members.ts`: add `rigging?: unknown;` to `MemberLine` beside `track?`, and change line 141:

```ts
  if (item.track != null || item.rigging != null || str(item.sku).toUpperCase().startsWith("TRK-")) return false;
```

`src/lib/project-discounts/rules.ts:130`, add `|| it.rigging` after `it.track`.

`src/lib/estimate-output/bom-models.ts`, in `isAssemblyish`:

```ts
    it.track != null ||
    it.rigging != null ||
```

- [ ] **Step 4: Run the checks**

Run: `npx tsx scripts/test-rigging-config.ts`
Expected: `0 FAIL`.

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: no errors. If `bomModelEligible` or `isCustomLineEditable` checks fail on an existing test's narrow `Pick`, widen that test's object; do not weaken the source.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/estimator/tier-reprice.ts" "src/app/(app)/estimator/copy-system.ts" "src/app/(app)/estimator/copy-pricing.ts" "src/app/(app)/estimator/custom-part-edit.ts" src/lib/quote-line-members.ts src/lib/project-discounts/rules.ts src/lib/estimate-output/bom-models.ts scripts/test-rigging-config.ts
git commit -m "feat(estimator): #373 configured lines behave like track lines in every reader"
```

---

### Task 5: Pipe configurator in the Estimator

**Files:**
- Create: `src/app/(app)/estimator/rigging-modal-ui.tsx`, `src/app/(app)/estimator/pipe-modal.tsx`
- Modify: `src/app/(app)/estimator/page.tsx`, `src/app/(app)/estimator/types.ts:714-720`, `src/app/(app)/estimator/section-card.tsx`, `src/app/(app)/estimator/use-estimator-state.ts`, `src/app/(app)/estimator/steps/build-step.tsx`, `src/lib/estimate-steps/discard-confirm.ts`, `scripts/test-oct15-estimating.ts:615`

**Interfaces:**
- Consumes: Task 2 `listPipeTypes`, `listLinesetTypes`; Task 3 everything
- Produces: `RiggingPartsTable`, `RiggingWarnings`, `NoRiggingTypes` from `rigging-modal-ui.tsx` (Task 6 uses them); `PipeFields`, `PipeSetter` from `pipe-modal.tsx` (Task 6's curtain toggle); `pipeTypes`, `linesetTypes`, `riggingParts` props; `riggingCat`, `openRiggingEdit` in the hook; `InputKind` values `"pipe"` and `"lineset"`

- [ ] **Step 1: Pass the data in**

`src/app/(app)/estimator/types.ts`, import `LinesetType, PipeType` from `@/lib/rigging-config/types`, and in `EstimatorProps` after `trackParts`:

```ts
  /** #373: every pipe and lineset type, active or not. A deleted one is simply absent. */
  pipeTypes: PipeType[];
  linesetTypes: LinesetType[];
  /** #373: the live catalog part behind every SKU those types map directly. */
  riggingParts: Record<string, TrackPart>;
```

`src/app/(app)/estimator/page.tsx`: import `listLinesetTypes, listPipeTypes` from `@/lib/stores/rigging-types` and `linesetTypeSkus, pipeTypeSkus` from `@/lib/rigging-config/types`. Add `listPipeTypes(), listLinesetTypes(),` to the `Promise.all` array directly after `listTrackSeries(),`, and add `pipeTypes, linesetTypes,` at the same position in the destructure. Read the destructure line first: positions must match. After the `trackParts` loop:

```ts
  // #373: the same, for the pipe and lineset types' directly mapped parts.
  const riggingSkus = new Set([...pipeTypes.flatMap((t) => pipeTypeSkus(t)), ...linesetTypes.flatMap((t) => linesetTypeSkus(t))]);
  const riggingParts: Record<string, TrackPart> = {};
  for (const p of catalogRows) {
    if (!riggingSkus.has(p.sku)) continue;
    riggingParts[p.sku] = { sku: p.sku, desc: p.desc || "", cost: Number(p.cost) || 0, list: Number(p.list) || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  }
```

and after `trackParts={trackParts}`:

```tsx
      pipeTypes={pipeTypes}
      linesetTypes={linesetTypes}
      riggingParts={riggingParts}
```

- [ ] **Step 2: Write the shared modal UI**

`src/app/(app)/estimator/rigging-modal-ui.tsx`:

```tsx
"use client";

import Link from "next/link";
import { fmt } from "./pricing";
import type { RiggingBom } from "./rigging-bom";
import type { SpecItem } from "./types";

/** #373 — "No pipe types yet — set one up in Estimating Rules → Pipe types". */
export function NoRiggingTypes({ noun, home, href }: { noun: string; home: string; href: string }) {
  return (
    <div role="note" style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #efe4c4", background: "#fffdf6", color: "#8a6d1f", fontSize: 12, lineHeight: 1.45 }}>
      No {noun} types yet — set one up in{" "}
      <Link href={href} style={{ color: "var(--accent)", fontWeight: 600 }}>{home}</Link>.
    </div>
  );
}

/** A part sold in the wrong unit prices badly; say so, and let the estimator decide. */
export function RiggingWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div role="note" style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, border: "1px solid #efe4c4", background: "#fffdf6", color: "#8a6d1f", fontSize: 12, lineHeight: 1.45 }}>
      {warnings.map((w) => <div key={w}>{w}</div>)}
    </div>
  );
}

const GRID = "1.3fr 2.2fr .8fr .9fr";

/** The live BOM, or — read-only on a deleted type — the line's saved parts. */
export function RiggingPartsTable({ bom, stored }: { bom: RiggingBom; stored?: SpecItem["components"] }) {
  const rows = bom.rows.length
    ? bom.rows.map((r) => ({ key: r.key, label: r.label, part: r.missing ? r.desc : `${r.sku} · ${r.desc}`, qty: r.qty, unit: r.unit, ext: r.ext, missing: r.missing }))
    : (stored || []).map((c, i) => ({ key: c.sku + i, label: c.label, part: c.sku, qty: c.qty, unit: c.unit, ext: c.price * c.qty, missing: false }));
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 16, border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 12px", background: "#fafbfc", fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em" }}>
        <span>Role</span>
        <span>Part</span>
        <span style={{ textAlign: "right" }}>Qty</span>
        <span style={{ textAlign: "right" }}>Ext</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 12px", borderTop: "1px solid #f3f4f7", fontSize: 12, alignItems: "center" }}>
          <span style={{ fontWeight: 600, color: "#3a3f4a" }}>{r.label}</span>
          <span style={{ color: r.missing ? "#b4543a" : "#8c919c", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.part}>{r.part}</span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.qty}{r.unit && r.unit !== "ea" ? " " + r.unit : ""}</span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.missing ? "—" : fmt(r.ext)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write the pipe modal**

`src/app/(app)/estimator/pipe-modal.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import { fmt } from "./pricing";
import { PIPE_TYPES_HOME, PIPE_TYPES_HREF, type PipeType } from "@/lib/rigging-config/types";
import { RIGGING_TYPE_GONE, pipeBom, pipeConfigFromDraft, selectableTypes, type RiggingCatalog } from "./rigging-bom";
import { NoRiggingTypes, RiggingPartsTable, RiggingWarnings } from "./rigging-modal-ui";
import { TrackErrors } from "./track-modal";
import type { PipeDraft, SpecItem } from "./types";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, Stat, useSwallowOpeningDoubleClick } from "./est-ui";

/**
 * #373 — the pipe configurator: type, label, run, quantity and a hanger spacing
 * pre-filled from the type. Reopened from a line (`editing`) it replaces the line
 * in place at today's prices; a line whose type was deleted opens read-only.
 */

export type PipeSetter = (field: keyof PipeDraft, val: string) => void;

const SUBTLE: CSSProperties = { color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 };

/** The pipe inputs — shared by this modal and the curtain modal's Add pipe step (`compact`). */
export function PipeFields({ draft, types, onSet, compact = false, disabled = false }: { draft: PipeDraft; types: readonly PipeType[]; onSet: PipeSetter; compact?: boolean; disabled?: boolean }) {
  const options = selectableTypes(types, draft.typeId);
  const current = types.find((t) => t.id === draft.typeId) || null;
  const gap = compact ? 12 : 16;
  if (!options.length && !current && !disabled) return <NoRiggingTypes noun="pipe" home={PIPE_TYPES_HOME} href={PIPE_TYPES_HREF} />;
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: gap }}>
        <div>
          <label style={LBL}>Pipe type <span style={SUBTLE}>· {PIPE_TYPES_HOME}</span></label>
          <select className="est-field" value={draft.typeId} onChange={(e) => onSet("typeId", e.target.value)} aria-label="Pipe type" style={{ ...FIELD, background: "#fff", cursor: "pointer" }}>
            {!current && <option value={draft.typeId}>{disabled ? "Deleted type" : "Pick a type"}</option>}
            {options.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{!t.active ? " (inactive)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={LBL}>Label <span style={SUBTLE}>· optional</span></label>
          <input className="est-field" value={draft.label} onChange={(e) => onSet("label", e.target.value)} placeholder="e.g. Main drape pipe" aria-label="Pipe label" style={FIELD} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={LBL}>Run (ft)</label>
          <input className="est-input est-field" value={draft.run} onChange={(e) => onSet("run", e.target.value)} aria-label="Pipe run (ft)" style={NUMFIELD} />
        </div>
        <div>
          <label style={LBL}>Quantity</label>
          <input className="est-input est-field" value={draft.qty} onChange={(e) => onSet("qty", e.target.value)} aria-label="Pipe quantity" style={NUMFIELD} />
        </div>
        <div>
          <label style={LBL}>Hanger spacing (ft)</label>
          <input className="est-input est-field" value={draft.hangerSpacing} placeholder={current ? String(current.hangerSpacingFt) : ""} onChange={(e) => onSet("hangerSpacing", e.target.value)} aria-label="Hanger spacing (ft)" style={NUMFIELD} />
        </div>
      </div>
    </fieldset>
  );
}

export default function PipeModal({
  secName, draft, types, catalog, margin, editing = false, readOnly = null, onSet, onAdd, onClose, confirmClose,
}: {
  secName: string;
  draft: PipeDraft;
  types: readonly PipeType[];
  catalog: RiggingCatalog;
  margin: number | null | undefined;
  editing?: boolean;
  readOnly?: { components: SpecItem["components"]; cost: number; price: number } | null;
  onSet: PipeSetter;
  onAdd: () => void;
  onClose: () => void;
  confirmClose?: () => boolean;
}) {
  const swallowOpeningDoubleClick = useSwallowOpeningDoubleClick();
  const current = types.find((t) => t.id === draft.typeId) || null;
  const bom = pipeBom(pipeConfigFromDraft(draft), current, catalog, margin);
  const noTypes = !readOnly && !selectableTypes(types, draft.typeId).length && !current;
  const valid = !readOnly && !noTypes && !bom.errors.length && bom.price > 0;
  const cost = readOnly ? readOnly.cost : bom.cost;
  const price = readOnly ? readOnly.price : bom.price;
  const partsCount = readOnly ? (readOnly.components || []).length : bom.rows.length;
  const errors = readOnly ? [RIGGING_TYPE_GONE] : noTypes || !draft.run.trim() ? [] : bom.errors;

  return (
    <ConfigModal
      width={660}
      icon="━"
      iconSize={16}
      title={editing ? "Edit pipe" : "Configure pipe"}
      sub={editing ? <>Updates this pipe in {secName} · the line is rebuilt in place at today&rsquo;s catalog prices</> : <>Adds one pipe line to {secName} · its parts come from the catalog and appear on the Review spreadsheet</>}
      onClose={onClose}
      confirmClose={confirmClose}
      footerLeft={
        <>
          <Stat label="Parts" value={partsCount > 0 ? String(partsCount) : "—"} />
          <Stat label="Cost" value={cost > 0 ? fmt(cost) : "—"} color="#8c919c" />
          <Stat label="Price · ext" value={price > 0 ? fmt(price) : "—"} size={14} weight={700} />
        </>
      }
      footerRight={<button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>{editing ? "Update pipe" : "Add pipe"}</button>}
    >
      <div onClickCapture={swallowOpeningDoubleClick}>
        {readOnly && (
          <div role="note" style={{ marginBottom: 16, padding: "9px 12px", borderRadius: 8, border: "1px solid #f1d4cc", background: "#fdf6f4", color: "#b4543a", fontSize: 12 }}>
            {RIGGING_TYPE_GONE} This line keeps its saved parts and price; to change it, add a new pipe from another type and remove this one.
          </div>
        )}
        {noTypes ? <NoRiggingTypes noun="pipe" home={PIPE_TYPES_HOME} href={PIPE_TYPES_HREF} /> : <PipeFields draft={draft} types={types} onSet={onSet} disabled={!!readOnly} />}
        {!noTypes && <RiggingPartsTable bom={bom} stored={readOnly?.components} />}
        {!readOnly && <RiggingWarnings warnings={bom.warnings} />}
        {!readOnly && <TrackErrors errors={errors} />}
      </div>
    </ConfigModal>
  );
}
```

- [ ] **Step 4: Add the kinds**

`src/lib/estimate-steps/discard-confirm.ts`:

```ts
export const MODAL_INPUT_KINDS = ["curtain", "track", "pipe", "lineset", "fixture", "labor", "vendor"] as const;
```

and in `DISCARD_COPY.noun`, add `pipe: "pipe", lineset: "lineset",` after `track: "track",`. Change the "five configurator" comment to "the configurator pop-ups".

`scripts/test-oct15-estimating.ts:615`: expected string becomes `"curtain,track,pipe,lineset,fixture,labor,vendor"`.

`section-card.tsx:57`:

```ts
export type InputKind = "catalog" | "custom" | "curtain" | "fixture" | "labor" | "vendor" | "track" | "pipe" | "lineset";
```

- [ ] **Step 5: Wire the hook**

In `use-estimator-state.ts`:

Imports:

```ts
import { curtainPipeDraft, curtainPipePrefill, followCurtainPipePrefill, freshLinesetDraft, freshPipeDraft, linesetConfigFromDraft, linesetDraftFromConfig, linesetLine, pipeConfigFromDraft, pipeDraftFromConfig, pipeLine, riggingCatalog, type CurtainPipePrefill } from "./rigging-bom";
```

Add `LinesetDraft, PipeDraft` to the `./types` import. In the props destructure at line 238, add `pipeTypes, linesetTypes, riggingParts,` after `trackParts,`.

After `const trackFor = openFor("track");`:

```ts
  const pipeFor = openFor("pipe");
  const linesetFor = openFor("lineset");
```

After `const [trackEdit, setTrackEdit] = useState<TrackEdit | null>(null);`:

```ts
  /* #373: the pipe and lineset forms, the same close-then-seed dance as the track edit. */
  const riggingCat = useMemo(() => riggingCatalog(riggingParts, fixtureAssemblies), [riggingParts, fixtureAssemblies]);
  const [pipeDraft, setPipeDraft] = useState<PipeDraft>(() => freshPipeDraft(pipeTypes));
  const pipeEditRef = useRef<(TrackEdit & { draft: PipeDraft }) | null>(null);
  const [pipeEdit, setPipeEdit] = useState<TrackEdit | null>(null);
  const [linesetDraft, setLinesetDraft] = useState<LinesetDraft>(() => freshLinesetDraft(linesetTypes));
  const linesetEditRef = useRef<(TrackEdit & { draft: LinesetDraft }) | null>(null);
  const [linesetEdit, setLinesetEdit] = useState<TrackEdit | null>(null);
```

`modalDrafts`:

```ts
    () => ({ curtain: { draft: curtainDraft, track: curtainTrack }, track: trackDraft, pipe: pipeDraft, lineset: linesetDraft, fixture: fixtureDraft, labor: laborDraft, vendor: vendorDraft }),
    [curtainDraft, curtainTrack, trackDraft, pipeDraft, linesetDraft, fixtureDraft, laborDraft, vendorDraft]
```

`discardDraft`, after the `track` branch:

```ts
    } else if (kind === "pipe") {
      pipeEditRef.current = null;
      setPipeEdit(null);
      setPipeDraft(freshPipeDraft(pipeTypes));
    } else if (kind === "lineset") {
      linesetEditRef.current = null;
      setLinesetEdit(null);
      setLinesetDraft(freshLinesetDraft(linesetTypes));
```

`seedDraft`, after the `track` branch:

```ts
    } else if (kind === "pipe") {
      const edit = pipeEditRef.current;
      pipeEditRef.current = null;
      setPipeEdit(edit ? { lineId: edit.lineId, readOnly: edit.readOnly } : null);
      setPipeDraft(edit ? edit.draft : freshPipeDraft(pipeTypes));
    } else if (kind === "lineset") {
      const edit = linesetEditRef.current;
      linesetEditRef.current = null;
      setLinesetEdit(edit ? { lineId: edit.lineId, readOnly: edit.readOnly } : null);
      setLinesetDraft(edit ? edit.draft : freshLinesetDraft(linesetTypes));
```

After `openTrackEdit`:

```ts
  /** #373: reopen the pipe or lineset configurator on its line. A deleted type opens read-only with the saved parts. */
  const openRiggingEdit = (secId: string, lineId: number) => {
    const it = sections.find((s) => s.id === secId)?.items.find((x) => x.id === lineId);
    const cfg = it?.rigging;
    if (!it || !cfg) return;
    if (repriceLocked(status)) return; // #368: as openLaborEdit
    if (!confirmDiscardInput()) return;
    closeInput();
    const saved = { components: it.components, cost: it.cost, price: it.price };
    if (cfg.kind === "pipe") {
      pipeEditRef.current = { lineId, draft: pipeDraftFromConfig(cfg), readOnly: pipeTypes.some((t) => t.id === cfg.typeId) ? null : saved };
      openInputMethod("pipe", secId);
    } else {
      linesetEditRef.current = { lineId, draft: linesetDraftFromConfig(cfg), readOnly: linesetTypes.some((t) => t.id === cfg.typeId) ? null : saved };
      openInputMethod("lineset", secId);
    }
  };
```

After `addTrack`:

```ts
  /** #373: Add pipe / lineset pushes one line; Update replaces the line in place (replaceTrackLine keeps its notes and order). */
  const addPipe = (secId: string) => {
    if (pipeEdit?.readOnly) return;
    const config = pipeConfigFromDraft(pipeDraft);
    const res = pipeLine(config, pipeTypes.find((t) => t.id === config.typeId), riggingCat, tierMargin);
    if (!res.ok) return;
    const lineId = pipeEdit?.lineId;
    if (lineId != null) setSections((ss) => ss.map((s) => (s.id === secId ? replaceTrackLine(s, lineId, res.item) : s)));
    else pushItems(secId, [{ ...res.item, id: nextId() }]);
    closeInput();
  };
  const addLineset = (secId: string) => {
    if (linesetEdit?.readOnly) return;
    const config = linesetConfigFromDraft(linesetDraft);
    const res = linesetLine(config, linesetTypes.find((t) => t.id === config.typeId), riggingCat, tierMargin);
    if (!res.ok) return;
    const lineId = linesetEdit?.lineId;
    if (lineId != null) setSections((ss) => ss.map((s) => (s.id === secId ? replaceTrackLine(s, lineId, res.item) : s)));
    else pushItems(secId, [{ ...res.item, id: nextId() }]);
    closeInput();
  };
```

After `const trackSec = ...`:

```ts
  const pipeSec = sections.find((s) => s.id === pipeFor);
  const linesetSec = sections.find((s) => s.id === linesetFor);
```

Add to the returned object, in its alphabetical neighbourhood: `addPipe, addLineset, openRiggingEdit, pipeDraft, setPipeDraft, pipeEdit, pipeFor, pipeSec, pipeTypes, linesetDraft, setLinesetDraft, linesetEdit, linesetFor, linesetSec, linesetTypes, riggingCat,`.

- [ ] **Step 6: Wire the card and the step**

`section-card.tsx`:

After `onToggleTrack: () => void;` (line 197):

```ts
  /** #373: "+ Configure pipe" / "+ Configure lineset". */
  onTogglePipe: () => void;
  onToggleLineset: () => void;
```

After `onEditTrack?: ...` (line 216):

```ts
  /** #373: reopen a pipe or lineset line's configurator. */
  onEditRigging?: (lineId: number) => void;
```

After the `trackEditable` line (1125):

```ts
              /* #373: a pipe or lineset line reopens its configurator the same way. */
              const riggingEditable = isInternal && !p.uiRepriceLock && !!p.onEditRigging && !!it.rigging;
```

Replace `configLocked`:

```ts
              const configLocked =
                isInternal && !!p.uiRepriceLock && ((!!p.onEditLabor && isLaborLineEditable(sec, it)) || (!!p.onEditTrack && !!it.track) || (!!p.onEditRigging && !!it.rigging) || (!!p.onEditCurtain && !!it.curtain));
```

In `openTrack`, after the `trackEditable` branch:

```ts
                else if (riggingEditable) p.onEditRigging?.(it.id);
```

Line 1143:

```ts
              const lineEditable = laborEditable || trackEditable || riggingEditable || curtainEditable || customEditable;
```

In the title at line 1199, add after the `trackEditable` arm: `riggingEditable ? lineDesc + " — click to edit this " + (it.rigging?.kind === "lineset" ? "lineset" : "pipe") :`.

After the TRACK chip block (ending line 1261):

```tsx
                      {!!it.rigging && (
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", background: "var(--accent)", padding: "1px 6px", borderRadius: 4, letterSpacing: ".04em", marginLeft: 6 }}>
                          {it.rigging.kind === "lineset" ? "LINESET" : "PIPE"}
                        </span>
                      )}
```

After the `trackEditable` ✎ button (line 1598):

```tsx
                    {riggingEditable && (
                      <button type="button" className="est-action-btn" onClick={openTrack} title="Edit — reopens the configurator" aria-label={`Edit ${it.desc}`} style={ACTION_BTN}>✎</button>
                    )}
```

After line 1704:

```tsx
              {addBtn("+ Configure pipe", p.onTogglePipe, openMethod === "pipe")}
              {addBtn("+ Configure lineset", p.onToggleLineset, openMethod === "lineset")}
```

`steps/build-step.tsx`:

Add `import PipeModal from "../pipe-modal";`. Add to the hook destructure: `addPipe, openRiggingEdit, pipeDraft, setPipeDraft, pipeEdit, pipeFor, pipeSec, pipeTypes, riggingCat,`. After `onToggleTrack={...}`:

```tsx
                    onTogglePipe={() => openInputMethod("pipe", sec.id)}
                    onToggleLineset={() => openInputMethod("lineset", sec.id)}
```

After `onEditTrack={...}`:

```tsx
                    onEditRigging={(lineId) => openRiggingEdit(sec.id, lineId)}
```

After the `{trackFor && (...)}` block:

```tsx
      {pipeFor && (
        <PipeModal
          secName={pipeSec ? pipeSec.name : ""}
          draft={pipeDraft}
          types={pipeTypes}
          catalog={riggingCat}
          margin={tierMargin}
          editing={!!pipeEdit}
          readOnly={pipeEdit?.readOnly ?? null}
          onSet={(field, val) => setPipeDraft((d) => ({ ...d, [field]: val }))}
          onAdd={() => addPipe(pipeFor)}
          onClose={closeInput}
          confirmClose={confirmDiscardInput}
        />
      )}
```

- [ ] **Step 7: Check for the two known traps**

Run: `npx tsc --noEmit 2>&1 | tail -5 && npx eslint "src/app/(app)/estimator/pipe-modal.tsx" "src/app/(app)/estimator/rigging-modal-ui.tsx" "src/app/(app)/estimator/use-estimator-state.ts"`
Expected: no errors. Other callers of `SectionCard` (`onTogglePipe` is required) will fail here; pass the same props there.

`rigging-bom.ts` imports nothing server-only, but `npx next build` is the only gate that catches a client import of a store. Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds. Stop and remove `.next` afterwards so it doesn't feed stale routes to tsc: `rm -rf .next`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/estimator" src/lib/estimate-steps/discard-confirm.ts scripts/test-oct15-estimating.ts
git commit -m "feat(estimator): #373 + Configure pipe on every system"
```

---

### Task 6: Lineset modal and the curtain's Add pipe

**Files:**
- Create: `src/app/(app)/estimator/lineset-modal.tsx`
- Modify: `src/app/(app)/estimator/steps/build-step.tsx`, `src/app/(app)/estimator/curtain-modal.tsx`, `src/app/(app)/estimator/use-estimator-state.ts`

**Interfaces:**
- Consumes: Task 5 `PipeFields`, `PipeSetter`, `RiggingPartsTable`, `RiggingWarnings`, `NoRiggingTypes`, the hook's `addLineset`, `linesetDraft`, `linesetEdit`, `linesetFor`, `linesetSec`, `linesetTypes`, `riggingCat`
- Produces: the finished user flows

- [ ] **Step 1: Write the lineset modal**

`src/app/(app)/estimator/lineset-modal.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import { fmt } from "./pricing";
import { defaultLinesPerSet, linesetQuantities } from "@/lib/rigging-config/lineset";
import { LINESET_TYPES_HOME, LINESET_TYPES_HREF, type LinesetType } from "@/lib/rigging-config/types";
import { RIGGING_TYPE_GONE, linesetBom, linesetConfigFromDraft, selectableTypes, type RiggingCatalog } from "./rigging-bom";
import { NoRiggingTypes, RiggingPartsTable, RiggingWarnings } from "./rigging-modal-ui";
import { TrackErrors } from "./track-modal";
import type { LinesetDraft, SpecItem } from "./types";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, Stat, useSwallowOpeningDoubleClick } from "./est-ui";

/**
 * #373 — the lineset configurator: aircraft cable, hand line, terminations and
 * chain wraps for a counterweight lineset. Blocks, arbors, pipe and bricks stay
 * their own lines. Blank lift lines and allowance show their defaults.
 */

const SUBTLE: CSSProperties = { color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 };

export default function LinesetModal({
  secName, draft, types, catalog, margin, editing = false, readOnly = null, onSet, onAdd, onClose, confirmClose,
}: {
  secName: string;
  draft: LinesetDraft;
  types: readonly LinesetType[];
  catalog: RiggingCatalog;
  margin: number | null | undefined;
  editing?: boolean;
  readOnly?: { components: SpecItem["components"]; cost: number; price: number } | null;
  onSet: (field: keyof LinesetDraft, val: string) => void;
  onAdd: () => void;
  onClose: () => void;
  confirmClose?: () => boolean;
}) {
  const swallowOpeningDoubleClick = useSwallowOpeningDoubleClick();
  const config = linesetConfigFromDraft(draft);
  const options = selectableTypes(types, draft.typeId);
  const current = types.find((t) => t.id === draft.typeId) || null;
  const bom = linesetBom(config, current, catalog, margin);
  const noTypes = !readOnly && !options.length && !current;
  const valid = !readOnly && !noTypes && !bom.errors.length && bom.price > 0;
  const cost = readOnly ? readOnly.cost : bom.cost;
  const price = readOnly ? readOnly.price : bom.price;
  const liftLines = current ? linesetQuantities(config, current).liftLines : 0;
  const blank = !draft.sets.trim() || !draft.width.trim() || !draft.gridHeight.trim();
  const errors = readOnly ? [RIGGING_TYPE_GONE] : noTypes || blank ? [] : bom.errors;
  const widthNow = Number(draft.width);
  const linesHint = Number.isFinite(widthNow) && widthNow > 0 ? String(defaultLinesPerSet(widthNow)) : "";

  const num = (label: string, field: keyof LinesetDraft, placeholder = "") => (
    <div>
      <label style={LBL}>{label}</label>
      <input className="est-input est-field" value={draft[field]} placeholder={placeholder} onChange={(e) => onSet(field, e.target.value)} aria-label={label} style={NUMFIELD} />
    </div>
  );

  return (
    <ConfigModal
      width={660}
      icon="⇅"
      iconSize={16}
      title={editing ? "Edit lineset hardware" : "Configure lineset hardware"}
      sub={editing ? <>Updates this line in {secName} · rebuilt in place at today&rsquo;s catalog prices</> : <>Adds one line to {secName}: aircraft cable, hand line, terminations and chain wraps</>}
      onClose={onClose}
      confirmClose={confirmClose}
      footerLeft={
        <>
          <Stat label="Lift lines" value={liftLines > 0 ? String(liftLines) : "—"} />
          <Stat label="Cost" value={cost > 0 ? fmt(cost) : "—"} color="#8c919c" />
          <Stat label="Price · ext" value={price > 0 ? fmt(price) : "—"} size={14} weight={700} />
        </>
      }
      footerRight={<button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>{editing ? "Update lineset" : "Add lineset"}</button>}
    >
      <div onClickCapture={swallowOpeningDoubleClick}>
        {readOnly && (
          <div role="note" style={{ marginBottom: 16, padding: "9px 12px", borderRadius: 8, border: "1px solid #f1d4cc", background: "#fdf6f4", color: "#b4543a", fontSize: 12 }}>
            {RIGGING_TYPE_GONE} This line keeps its saved parts and price; to change it, add a new lineset from another type and remove this one.
          </div>
        )}
        {noTypes ? (
          <NoRiggingTypes noun="lineset" home={LINESET_TYPES_HOME} href={LINESET_TYPES_HREF} />
        ) : (
          <fieldset disabled={!!readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={LBL}>Lineset type <span style={SUBTLE}>· {LINESET_TYPES_HOME}</span></label>
                <select className="est-field" value={draft.typeId} onChange={(e) => onSet("typeId", e.target.value)} aria-label="Lineset type" style={{ ...FIELD, background: "#fff", cursor: "pointer" }}>
                  {!current && <option value={draft.typeId}>{readOnly ? "Deleted type" : "Pick a type"}</option>}
                  {options.map((t) => <option key={t.id} value={t.id}>{t.name}{!t.active ? " (inactive)" : ""}</option>)}
                </select>
              </div>
              <div>
                <label style={LBL}>Label <span style={SUBTLE}>· optional</span></label>
                <input className="est-field" value={draft.label} onChange={(e) => onSet("label", e.target.value)} placeholder="Lineset hardware" aria-label="Lineset label" style={FIELD} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
              {num("Sets", "sets")}
              {num("Width (ft)", "width")}
              {num("Grid height (ft)", "gridHeight")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {num("Lift lines per set", "linesPerSet", linesHint)}
              {num("Cable allowance (ft)", "allowance", current ? String(current.allowanceFt) : "")}
            </div>
          </fieldset>
        )}
        {!noTypes && <RiggingPartsTable bom={bom} stored={readOnly?.components} />}
        {!readOnly && <RiggingWarnings warnings={bom.warnings} />}
        {!readOnly && <TrackErrors errors={errors} />}
      </div>
    </ConfigModal>
  );
}
```

- [ ] **Step 2: Render it**

`steps/build-step.tsx`: add `import LinesetModal from "../lineset-modal";` and `addLineset, linesetDraft, setLinesetDraft, linesetEdit, linesetFor, linesetSec, linesetTypes,` to the destructure. After the `{pipeFor && (...)}` block:

```tsx
      {linesetFor && (
        <LinesetModal
          secName={linesetSec ? linesetSec.name : ""}
          draft={linesetDraft}
          types={linesetTypes}
          catalog={riggingCat}
          margin={tierMargin}
          editing={!!linesetEdit}
          readOnly={linesetEdit?.readOnly ?? null}
          onSet={(field, val) => setLinesetDraft((d) => ({ ...d, [field]: val }))}
          onAdd={() => addLineset(linesetFor)}
          onClose={closeInput}
          confirmClose={confirmDiscardInput}
        />
      )}
```

- [ ] **Step 3: Add the curtain's Add pipe state**

In `use-estimator-state.ts`, after `curtainTrackPrefillRef`:

```ts
  /* #373: the curtain modal's Add pipe form (null = off), new curtains only. */
  const [curtainPipe, setCurtainPipe] = useState<PipeDraft | null>(null);
  const curtainPipePrefillRef = useRef<CurtainPipePrefill>({ run: "", qty: "1", label: "" });
```

`modalDrafts`: `curtain: { draft: curtainDraft, track: curtainTrack, pipe: curtainPipe },` and add `curtainPipe` to the dependency array.

Add `setCurtainPipe(null);` directly after both existing `setCurtainTrack(null);` lines at 2596 and 2636.

Replace the body of `setCurtainField`:

```ts
  const setCurtainField = (field: keyof CurtainDraft, val: string) => {
    const next = { ...curtainDraft, [field]: val };
    setCurtainDraft(next);
    if (curtainPipe) {
      const pre = curtainPipePrefill(next);
      const prev = curtainPipePrefillRef.current;
      setCurtainPipe((p) => (p ? followCurtainPipePrefill(p, prev, pre) : p));
      curtainPipePrefillRef.current = pre;
    }
    if (!curtainTrack) return;
    const pre = curtainTrackPrefill(next);
    // Captured now: the updater runs later, after the ref has moved on.
    const prev = curtainTrackPrefillRef.current;
    setCurtainTrack((t) => (t ? followCurtainPrefill(t, prev, pre) : t));
    curtainTrackPrefillRef.current = pre;
  };
```

After `toggleCurtainTrack`:

```ts
  const toggleCurtainPipe = (on: boolean) => {
    if (!on) return setCurtainPipe(null);
    curtainPipePrefillRef.current = curtainPipePrefill(curtainDraft);
    setCurtainPipe(curtainPipeDraft(curtainDraft, pipeTypes));
  };
```

In `addCurtain`, directly after the `if (curtainTrack) { ... }` block:

```ts
    // #373: Add pipe — an ordinary line beside the curtain, no link. New curtains only; a bad pipe blocks the add.
    let pipe: SpecItem | null = null;
    if (curtainPipe && !curtainEdit) {
      const config = pipeConfigFromDraft(curtainPipe);
      const res = pipeLine(config, pipeTypes.find((t) => t.id === config.typeId), riggingCat, tierMargin);
      if (!res.ok) return;
      pipe = { ...res.item, id: 0 };
    }
```

Directly after `if (track) track.curtainTrackKey = key;`:

```ts
    if (pipe) pipe.id = nextId();
```

and in the `pushItems` array after `...(track ? [track] : []),`:

```ts
      ...(pipe ? [pipe] : []),
```

Add `curtainPipe, setCurtainPipe, toggleCurtainPipe,` to the returned object.

- [ ] **Step 4: Add the toggle to the curtain modal**

`curtain-modal.tsx`, imports:

```ts
import type { PipeType } from "@/lib/rigging-config/types";
import { pipeBom, pipeConfigFromDraft, type RiggingCatalog } from "./rigging-bom";
import { PipeFields, type PipeSetter } from "./pipe-modal";
import { RiggingWarnings } from "./rigging-modal-ui";
```

Add `PipeDraft` to the `./types` import. Add to the destructured props after `linkedTrack = null,`: `pipe = null, pipeTypes = [], riggingCat, onTogglePipe, onSetPipe,`, and to the prop types:

```ts
  /** #373: the curtain's pipe form — null while Add pipe is off. New curtains only. */
  pipe?: PipeDraft | null;
  pipeTypes?: readonly PipeType[];
  riggingCat?: RiggingCatalog;
  onTogglePipe?: (on: boolean) => void;
  onSetPipe?: PipeSetter;
```

Replace `const valid = ...` (line 95):

```ts
  const pipeTypeRow = pipe ? pipeTypes.find((t) => t.id === pipe.typeId) || null : null;
  const pb = pipe && riggingCat ? pipeBom(pipeConfigFromDraft(pipe), pipeTypeRow, riggingCat, margin) : null;
  const pipeOk = !pipe || (!!pb && !pb.errors.length && pb.price > 0);
  const valid = curtainDraftValid(draft, cc.priceEach) && trackOk && pipeOk;
```

Before the closing `</ConfigModal>`, after the Add track block:

```tsx
      {/* #373: Add pipe — new curtains only, since no link records whether a saved curtain already has one. */}
      {onTogglePipe && onSetPipe && !editing && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ececf0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#3a3f4a", cursor: "pointer" }}>
            <input type="checkbox" checked={!!pipe} onChange={(e) => onTogglePipe(e.target.checked)} />
            Add pipe
            <span style={{ fontSize: 11.5, fontWeight: 500, color: "#aab0bb" }}>· adds a pipe line beside this curtain, priced from the catalog</span>
          </label>
          {pipe && (
            <div style={{ marginTop: 12 }}>
              <PipeFields draft={pipe} types={pipeTypes} onSet={onSetPipe} compact />
              {pb && pb.rows.length > 0 && !pb.errors.length && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: "#8c919c" }}>
                  {pb.rows.length} parts · cost {fmt(pb.cost)} · price {fmt(pb.price)}
                </div>
              )}
              {pb && <RiggingWarnings warnings={pb.warnings} />}
              {pb && pipeTypeRow && pipe.run.trim() !== "" && <TrackErrors errors={pb.errors} />}
            </div>
          )}
        </div>
      )}
```

Replace the footer's Track stat and button label:

```tsx
          {tb && <Stat label="Track" value={tb.price > 0 ? fmt(tb.price) : "—"} size={14} weight={700} />}
          {pb && <Stat label="Pipe" value={pb.price > 0 ? fmt(pb.price) : "—"} size={14} weight={700} />}
```

```tsx
          {editing ? "Update curtain" : ["Add curtain", track && "track", pipe && "pipe"].filter(Boolean).join(" + ")}
```

`steps/build-step.tsx`: add `curtainPipe, setCurtainPipe, toggleCurtainPipe,` to the destructure, and in `<CurtainModal` after `onSetTrack=...`:

```tsx
          pipe={curtainPipe}
          pipeTypes={pipeTypes}
          riggingCat={riggingCat}
          onTogglePipe={toggleCurtainPipe}
          onSetPipe={(field, val) => setCurtainPipe((p) => (p ? { ...p, [field]: val } : p))}
```

- [ ] **Step 5: Check**

Run: `npx tsc --noEmit 2>&1 | tail -5 && npx eslint "src/app/(app)/estimator/lineset-modal.tsx" "src/app/(app)/estimator/curtain-modal.tsx" "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/steps/build-step.tsx"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator"
git commit -m "feat(estimator): #373 + Configure lineset and Add pipe on a curtain"
```

---

### Task 7: Verify in the browser, gates and docs

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`, `MASTER-HOWTO.md`, and `.claude/launch.json` in the main checkout if a config is needed

- [ ] **Step 1: Run the full gates**

```bash
ps aux | grep -E "tsx|next dev" | grep -v grep
npx tsc --noEmit
npx eslint
npm run test:specs
npm run test:smoke
npx next build
rm -rf .next
```

Run `test:specs` and `test:smoke` in the background; they take several minutes. Expected: 0 tsc errors, 0 eslint errors, `ALL PASSED` for both, build succeeds. Record the real numbers. A failure must first be reproduced or ruled out against `origin/main` before it is called unrelated.

- [ ] **Step 2: Browser pass on a scratch database**

`preview_start` reads the main checkout's `.claude/launch.json`, so add a config there that runs `next dev` in this worktree on a free port with `PGLITE_PATH` set to a new temp directory. Use `localhost`, never `127.0.0.1`. The dev server always loads the real Blob token if the real `.env.local` is present, so keep the minimal one from Task 1 and do not click uploads.

Sign in through the dev picker and confirm each of these, reading results with `read_page` or `javascript_tool`:

1. `/estimating-rules` shows both new cards. Each screen opens with its empty state.
2. A catalog part exists in the scratch database (`npm run db:seed` first if needed). Create a pipe type with a 21' stick, splice and clamp, and mark it Active. Create a Hardware assembly in `/design/assemblies`, then a lineset type using parts for cable, hand line and terminations, and that assembly for chain wraps. Mark it Active.
3. In a new estimate, **+ Configure pipe** with run 40 and quantity 1 shows 2 sticks, 1 splice and 5 clamps. Add it. The line shows a PIPE chip and the description.
4. **+ Configure lineset** with 6 sets, 40' wide, 40' grid shows 24 lift lines, 1,680 ft and 480 ft. Add it.
5. Click each line: **Update** reopens the values, change one, Update, and the line stays in place with its new price.
6. **+ Configure curtain**, name it, width 40, tick **Add pipe**: run and label pre-fill, change the width and the run follows. Add. Curtain and pipe lines both land. Edit that curtain: no Add pipe toggle.
7. Change the tier on the estimate: both lines re-price, and the parts in the modal agree.
8. Close a dirty pipe modal with ×: the discard prompt says "pipe".
9. Delete the pipe type in Rules, reopen the line: read-only with saved parts and the same price.
10. Print the estimate PDF: one line each, no part numbers in the customer body. The parts list shows the exploded parts. No console errors.

Screenshot the two modals and the finished lines as proof. Stop the server and confirm no process holds the port: `lsof -i :<port>`.

- [ ] **Step 3: Write the docs**

Recheck the numbers first:

```bash
git fetch origin
git log --oneline HEAD..origin/main | wc -l
git show "origin/main:PUNCHLIST.md" | grep -oE "^## [0-9]+\." | tail -1
git show "origin/main:DECISIONS.md" | grep -oE "^## D[0-9]+" | tail -1
git show "origin/main:AGENTS.md" | grep -oE "^[0-9]+\. " | tail -1
```

If main moved, merge it now and resolve `PUNCHLIST.md` / `DECISIONS.md` as a real 3-way merge. If #373 or D1332 is taken, renumber in this branch first, covering the spec, plan, code comments and check labels (`git grep -n "#373"`).

Append to `DECISIONS.md`, in that file's existing format, one entry each:

- **D1332.** Pipe and lineset lines share one `SpecItem.rigging` field, and `isConfiguredLine` joins Track at the readers that mean "tier-seeded line with parts in components". Track is untouched, so saved quotes and cut sheets can't move.
- **D1333.** Lineset cable is actual routing: lift lines × (grid + width ÷ 2 + allowance, default 10'). Quick Design keeps 2G + W, so the same job shows less cable in the Estimator. Jeff, 2026-11-05.
- **D1334.** A Hardware assembly role sells at the tier on its resolved cost, ignoring the assembly's own sell and leaving add-ons out, so the whole line stays on one seed.
- **D1335.** Unit mismatches (non-foot cable or hand line, foot-priced sticks) warn and never block, because catalog unit text varies.
- **D1336.** Add pipe appears on new curtains only, with no curtain link, and pre-fills quantity from the curtain's quantity.

Append `## 373. Pipe and lineset configurators — DONE <date> on feat/373-pipe-lineset (D1332–D1336)` to `PUNCHLIST.md`, following the last entry's shape, with the real gate numbers and the Jeff-gated setup from the spec. Add a phase entry to the end of the numbered list in `AGENTS.md`, following the entries above it. Add setup steps to `MASTER-HOWTO.md` beside the Track series instructions (`grep -n "Track series" MASTER-HOWTO.md`).

- [ ] **Step 4: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md MASTER-HOWTO.md
git commit -m "docs(estimator): #373 pipe and lineset configurators"
```

Do not push or merge. The whole-branch review and Jeff's go-ahead come next.
