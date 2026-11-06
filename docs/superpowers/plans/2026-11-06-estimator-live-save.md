# Estimator Live Save + Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draft estimates save themselves as you edit, and Undo / Redo reverse line and system changes.

**Architecture:** Three pure modules hold the rules (`undo`, `scheduler`, `rules`) plus a server-only `live-key`. Two client hooks wrap them (`use-live-save`, `use-estimate-undo`). `saveQuoteAction` gains a `live` mode with a limited patch and a compare-and-write under the quote row lock. `saveNow` becomes `performSave(mode)` run through one queue.

**Tech Stack:** Next.js 16 server actions, React 19 hooks, Drizzle on Postgres / PGlite, `tsx` harness scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-estimator-live-save-design.md`

## Global Constraints

- Work only in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/live-save`, branch `feat/estimator-live-save`. Never run `git stash` (the stack is shared across worktrees).
- The worktree has no `node_modules`, `next-env.d.ts` or `.env.local`. Before Task 1 run `npm ci`. A symlinked `node_modules` is not allowed. Copy `.env.local` from the main checkout only for the browser check in Task 8.
- PGlite is one process at a time. Never leave a `tsx` script running, and check `ps aux | grep tsx` before starting the dev server. Tests and browser checks use a scratch datadir (`PGLITE_PATH=$(mktemp -d)`), never `.data/pglite`, which holds the real book.
- Live save applies to Draft only, non-portal, Estimator system quotes.
- Debounce is 1,500 ms. Retry backoff is 5, 15, 30, 60 s. Undo cap is 100 steps. Coalescing window is 1,000 ms.
- Never preview-deploy this branch unless it is rebased on main (it is, from `fffad0c2`; keep it so).
- Timestamps are epoch-ms numbers. No migration, no env var.
- Client files must import only client-safe modules. Importing `src/lib/estimate-live-save/live-key.ts` or a store's values into a client component breaks `next build` only, so run `npx next build` at the end of any task that touches a client import graph (Tasks 5–7).
- Copy is in plain sentences. Exact strings are in the tasks.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Undo stack (pure)

**Files:**
- Create: `src/lib/estimate-live-save/undo.ts`
- Create: `scripts/test-estimate-live-save.ts`
- Modify: `scripts/test-review-and-spec.ts` (import near line 11370; chain near line 11796)

**Interfaces:**
- Produces, from `undo.ts`: `UndoSnap`, `UndoHistory`, `emptyUndoHistory()`, `diffEdit(before, after)`, `recordEdit(h, before, after, now, labelOverride?)`, `takeUndo(h, current)`, `takeRedo(h, current)`, `mapSnapshots(h, fn)`, `UNDO_CAP`, `COALESCE_MS`.
- Produces, from the test script: `export async function liveSavePureChecks(ok: Ok)` and `export async function liveSaveDbChecks(ok: Ok)`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-estimate-live-save.ts`:

```ts
/* Estimator live save + Undo. `liveSavePureChecks` needs no database; `liveSaveDbChecks` needs the test DB
   (test:specs runs both). Run the pure half alone with `npx tsx scripts/test-estimate-live-save.ts`. */
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import { COALESCE_MS, diffEdit, emptyUndoHistory, mapSnapshots, recordEdit, takeRedo, takeUndo, UNDO_CAP, type UndoSnap } from "../src/lib/estimate-live-save/undo";

const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 1, unit: "ea", cost: 10, price: 20, ...extra }) as SpecItem;
const sec = (id: string, items: SpecItem[], extra: Partial<SpecSection> = {}): SpecSection =>
  ({ id, name: "Sys " + id, kind: "materials", mfr: "", freightPct: 5, items, ...extra }) as SpecSection;
const snap = (sections: SpecSection[]): UndoSnap => ({ sections, groups: [], vendorQuotes: [] });

export async function liveSavePureChecks(ok: Ok) {
  // diffEdit labels
  const a = snap([sec("A", [line(1), line(2)])]);
  ok(diffEdit(a, a) === null, "undo: no change is no step");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2)])])) === null, "undo: equal content in new objects is no step");
  ok(diffEdit(a, snap([sec("A", [line(1)])]))?.label === "line deleted", "undo: a removed line is 'line deleted'");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2), line(3)])]))?.label === "line added", "undo: an added line is 'line added'");
  const qty = diffEdit(a, snap([sec("A", [line(1, { qty: 4 }), line(2)])]));
  ok(qty?.label === "line edited" && qty?.target === "line:A:1", "undo: one changed line is 'line edited' with a target");
  ok(diffEdit(a, snap([sec("A", [line(2), line(1)])]))?.label === "lines reordered", "undo: swapped lines are 'lines reordered'");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2)], { name: "Renamed" })]))?.target === "sys:A", "undo: a system field targets the system");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2)]), sec("B", [])]))?.label === "system added", "undo: a new system is 'system added'");
  ok(diffEdit(snap([sec("A", []), sec("B", [])]), snap([sec("A", [])]))?.label === "system deleted", "undo: a removed system is 'system deleted'");
  ok(diffEdit(snap([sec("A", []), sec("B", [])]), snap([sec("B", []), sec("A", [])]))?.label === "systems reordered", "undo: reorder is 'systems reordered'");
  ok(
    diffEdit(snap([sec("A", [line(1), line(2)]), sec("B", [])]), snap([sec("A", [line(1)]), sec("B", [line(2)])]))?.label === "lines moved",
    "undo: the same line count across two changed systems is 'lines moved'"
  );
  // Automatic lines never count as an edit.
  ok(diffEdit(a, snap([sec("A", [line(1), line(2), line(9, { bonus: "package" })])])) === null, "undo: a bonus line alone is no step");
  ok(
    diffEdit({ ...a, groups: [] }, { ...a, groups: [{ id: "g1", name: "G" }] as never })?.label === "group changed",
    "undo: a group change is 'group changed'"
  );
  ok(diffEdit(a, { ...a, vendorQuotes: [{ id: "v1" }] as never })?.label === "vendor quote changed", "undo: a vendor quote change is labelled");

  // record / undo / redo
  const b = snap([sec("A", [line(1)])]);
  let h = recordEdit(emptyUndoHistory(), a, b, 1_000);
  ok(h.past.length === 1 && h.past[0].label === "line deleted", "undo: records the step");
  const u = takeUndo(h, b)!;
  ok(u.restore === a && u.next.past.length === 0 && u.next.future.length === 1, "undo: restores the snapshot before the edit");
  const r = takeRedo(u.next, a)!;
  ok(r.restore === b && r.next.past.length === 1 && r.next.future.length === 0, "undo: redo restores the edit");
  ok(takeUndo(emptyUndoHistory(), a) === null && takeRedo(emptyUndoHistory(), a) === null, "undo: empty stacks return null");
  ok(recordEdit(u.next, a, snap([sec("A", [])]), 2_000).future.length === 0, "undo: a new edit clears redo");

  // coalescing
  const q1 = snap([sec("A", [line(1, { qty: 2 }), line(2)])]);
  const q2 = snap([sec("A", [line(1, { qty: 3 }), line(2)])]);
  h = recordEdit(emptyUndoHistory(), a, q1, 1_000);
  h = recordEdit(h, q1, q2, 1_000 + COALESCE_MS - 1);
  ok(h.past.length === 1 && h.past[0].snap === a, "undo: quick edits to one line are one step");
  h = recordEdit(h, q2, snap([sec("A", [line(1, { qty: 4 }), line(2)])]), 1_000 + COALESCE_MS * 3);
  ok(h.past.length === 2, "undo: a pause starts a new step");
  let other = recordEdit(emptyUndoHistory(), a, q1, 1_000);
  other = recordEdit(other, q1, snap([sec("A", [line(1, { qty: 2 }), line(2, { qty: 2 })])]), 1_100);
  ok(other.past.length === 2, "undo: a different line starts a new step");

  // the cap
  let capped = emptyUndoHistory();
  let cur = a;
  for (let i = 0; i < UNDO_CAP + 5; i++) {
    const next = snap([sec("A", [line(1, { qty: 100 + i }), line(2)])]);
    capped = recordEdit(capped, cur, next, i * 10_000);
    cur = next;
  }
  ok(capped.past.length === UNDO_CAP, "undo: history stops at the cap");

  // label override, snapshot mapping
  ok(recordEdit(emptyUndoHistory(), a, b, 1, "re-priced").past[0].label === "re-priced", "undo: a label override wins");
  const mapped = mapSnapshots(recordEdit(emptyUndoHistory(), a, b, 1), (ss) => ss.map((s) => ({ ...s, freightPct: 9 })));
  ok(mapped.past[0].snap.sections[0].freightPct === 9, "undo: mapSnapshots reaches stored snapshots");
}

export async function liveSaveDbChecks(_ok: Ok) {
  // Filled in by Task 3.
}

if (require.main === module) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.error("FAIL:", m); } };
  const db = !!process.env.PGLITE_PATH;
  liveSavePureChecks(okf)
    .then(() => (db ? liveSaveDbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); });
}
```

In `scripts/test-review-and-spec.ts`, add beside the `lineMoveChecks` import:

```ts
import { liveSaveDbChecks, liveSavePureChecks } from "./test-estimate-live-save";
```

and after `.then(() => lineMoveChecks(ok))`:

```ts
  .then(() => liveSavePureChecks(ok))
  .then(() => liveSaveDbChecks(ok))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: FAIL, cannot find module `../src/lib/estimate-live-save/undo`.

- [ ] **Step 3: Write the module**

Create `src/lib/estimate-live-save/undo.ts`:

```ts
/**
 * Estimator Undo / Redo — the stack (pure, DB-free, client-safe), following src/lib/design/grid-undo.ts.
 * An entry stores the state BEFORE an edit. Sections are immutable, so snapshots share structure.
 */
import type { SpecItem, SpecSection, VendorQuote } from "@/app/(app)/estimator/types";
import type { SystemGroup } from "@/lib/estimate-groups/types";

export type UndoSnap = { sections: SpecSection[]; groups: SystemGroup[]; vendorQuotes: VendorQuote[] };
export type UndoEntry = { snap: UndoSnap; label: string; at: number; target: string | null };
export type UndoHistory = { past: UndoEntry[]; future: UndoEntry[] };

export const UNDO_CAP = 100;
export const COALESCE_MS = 1_000;

export const emptyUndoHistory = (): UndoHistory => ({ past: [], future: [] });

/** Automatic lines re-derive after every edit, so they never count as one. */
const editableLines = (s: SpecSection): SpecItem[] => s.items.filter((it) => !(it as { bonus?: unknown }).bonus);
const lineKey = (it: SpecItem): string => {
  const { lineOrder: _order, ...rest } = it as SpecItem & { lineOrder?: unknown };
  return JSON.stringify(rest);
};
const sectionFields = (s: SpecSection): string => {
  const { items: _items, ...rest } = s;
  return JSON.stringify(rest);
};
const sectionKey = (s: SpecSection): string => sectionFields(s) + "|" + editableLines(s).map(lineKey).join("|");

export type EditDiff = { label: string; target: string | null };

/** What changed, in the words the tooltip shows. null = nothing the user would call an edit. */
export function diffEdit(before: UndoSnap, after: UndoSnap): EditDiff | null {
  if (before.groups !== after.groups && JSON.stringify(before.groups) !== JSON.stringify(after.groups)) return { label: "group changed", target: null };
  const beforeIds = before.sections.map((s) => s.id);
  const afterIds = after.sections.map((s) => s.id);
  if (afterIds.some((id) => !beforeIds.includes(id))) return { label: "system added", target: null };
  if (beforeIds.some((id) => !afterIds.includes(id))) return { label: "system deleted", target: null };
  if (beforeIds.join("\u0000") !== afterIds.join("\u0000")) return { label: "systems reordered", target: null };

  const changed = after.sections.filter((s, i) => s !== before.sections[i] && sectionKey(s) !== sectionKey(before.sections[i]));
  if (changed.length > 1) {
    const count = (ss: SpecSection[]) => ss.reduce((n, s) => n + editableLines(s).length, 0);
    return { label: count(before.sections) === count(after.sections) ? "lines moved" : "lines edited", target: null };
  }
  if (changed.length === 1) {
    const next = changed[0];
    const prev = before.sections.find((s) => s.id === next.id) as SpecSection;
    const prevLines = editableLines(prev);
    const nextLines = editableLines(next);
    if (nextLines.some((l) => !prevLines.some((p) => p.id === l.id))) return { label: "line added", target: null };
    if (prevLines.some((p) => !nextLines.some((l) => l.id === p.id))) return { label: "line deleted", target: null };
    const edited = nextLines.filter((l) => lineKey(l) !== lineKey(prevLines.find((p) => p.id === l.id) as SpecItem));
    if (edited.length === 1) return { label: "line edited", target: `line:${next.id}:${edited[0].id}` };
    if (edited.length > 1) return { label: "lines edited", target: null };
    if (prevLines.map((p) => p.id).join() !== nextLines.map((l) => l.id).join()) return { label: "lines reordered", target: null };
    return { label: "system edited", target: `sys:${next.id}` };
  }
  if (before.vendorQuotes !== after.vendorQuotes && JSON.stringify(before.vendorQuotes) !== JSON.stringify(after.vendorQuotes)) {
    return { label: "vendor quote changed", target: null };
  }
  return null;
}

/** Add a step, merging quick repeats on one target; a new edit clears redo. No real change leaves the history as it was. */
export function recordEdit(h: UndoHistory, before: UndoSnap, after: UndoSnap, now: number, labelOverride?: string): UndoHistory {
  const diff = diffEdit(before, after);
  if (!diff) return h;
  const last = h.past[h.past.length - 1];
  if (!labelOverride && last && diff.target && last.target === diff.target && now - last.at < COALESCE_MS) {
    return { past: [...h.past.slice(0, -1), { ...last, at: now }], future: [] };
  }
  const past = [...h.past, { snap: before, label: labelOverride ?? diff.label, at: now, target: diff.target }];
  return { past: past.length > UNDO_CAP ? past.slice(past.length - UNDO_CAP) : past, future: [] };
}

export function takeUndo(h: UndoHistory, current: UndoSnap): { restore: UndoSnap; next: UndoHistory } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return { restore: entry.snap, next: { past: h.past.slice(0, -1), future: [{ ...entry, snap: current }, ...h.future] } };
}

export function takeRedo(h: UndoHistory, current: UndoSnap): { restore: UndoSnap; next: UndoHistory } | null {
  const [entry, ...future] = h.future;
  if (!entry) return null;
  return { restore: entry.snap, next: { past: [...h.past, { ...entry, snap: current }], future } };
}

/** Apply an automatic change to every stored snapshot, so Undo never reverts something the user never touched. */
export function mapSnapshots(h: UndoHistory, fn: (sections: SpecSection[]) => SpecSection[]): UndoHistory {
  const map = (e: UndoEntry): UndoEntry => ({ ...e, snap: { ...e.snap, sections: fn(e.snap.sections) } });
  return { past: h.past.map(map), future: h.future.map(map) };
}
```

Confirm the `SystemGroup` and `VendorQuote` import paths against the hook's own imports (`grep -n "SystemGroup\|VendorQuote" "src/app/(app)/estimator/use-estimator-state.ts" | head`) and correct them. Type-only imports only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: `… PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)`

- [ ] **Step 5: Commit**

```bash
git add src/lib/estimate-live-save/undo.ts scripts/test-estimate-live-save.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): the Undo stack for live save (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Save scheduler and eligibility rules (pure)

**Files:**
- Create: `src/lib/estimate-live-save/scheduler.ts`
- Create: `src/lib/estimate-live-save/rules.ts`
- Modify: `scripts/test-estimate-live-save.ts`

**Interfaces:**
- Produces, from `scheduler.ts`: `LiveSaveState`, `LiveEvent`, `LiveStatus`, `LiveGate`, `INITIAL_LIVE_STATE`, `reduceLive(state, event)`, `liveStatusOf(state)`, `canAutoSave(state, gate)`, `retryDelayMs(failures)`, `DEBOUNCE_MS`.
- Produces, from `rules.ts`: `liveSaveEligible(q)`, `liveSaveRefusal(q)`, `limitToLivePatch(patch)`, `LIVE_PATCH_FIELDS`.

- [ ] **Step 1: Write the failing test**

Add these imports to `scripts/test-estimate-live-save.ts`:

```ts
import { canAutoSave, DEBOUNCE_MS, INITIAL_LIVE_STATE, liveStatusOf, reduceLive, retryDelayMs, type LiveGate } from "../src/lib/estimate-live-save/scheduler";
import { limitToLivePatch, liveSaveEligible, liveSaveRefusal } from "../src/lib/estimate-live-save/rules";
```

Add to the end of `liveSavePureChecks`:

```ts
  // scheduler
  const gate: LiveGate = { enabled: true, hasId: true, hasLines: true, tierResolving: false, statusChanging: false };
  ok(DEBOUNCE_MS === 1_500, "live: the debounce is 1.5 s");
  ok(liveStatusOf(INITIAL_LIVE_STATE) === "saved", "live: starts saved");
  ok(!canAutoSave(INITIAL_LIVE_STATE, gate), "live: nothing to save with no edit — opening never writes");
  let st = reduceLive(INITIAL_LIVE_STATE, { type: "edit" });
  ok(liveStatusOf(st) === "dirty" && canAutoSave(st, gate), "live: an edit is dirty and can save");
  ok(!canAutoSave(st, { ...gate, enabled: false }), "live: not on a non-draft");
  ok(!canAutoSave(st, { ...gate, tierResolving: true }), "live: waits for a tier lookup");
  ok(!canAutoSave(st, { ...gate, statusChanging: true }), "live: waits for a status change");
  ok(!canAutoSave(st, { ...gate, hasId: false, hasLines: false }), "live: a new estimate waits for its first line");
  ok(canAutoSave(st, { ...gate, hasId: false, hasLines: true }), "live: a new estimate saves on its first line");
  st = reduceLive(st, { type: "start" });
  ok(liveStatusOf(st) === "saving" && !canAutoSave(st, gate), "live: one save at a time");
  const seq = st.inFlightSeq as number;
  st = reduceLive(st, { type: "edit" });
  st = reduceLive(st, { type: "saved", seq });
  ok(liveStatusOf(st) === "dirty" && canAutoSave(st, gate), "live: an edit during a save stays dirty");
  st = reduceLive(st, { type: "start" });
  st = reduceLive(st, { type: "saved", seq: st.inFlightSeq as number });
  ok(liveStatusOf(st) === "saved" && st.failures === 0, "live: the last save settles");

  // failures
  let f = reduceLive(reduceLive(INITIAL_LIVE_STATE, { type: "edit" }), { type: "start" });
  f = reduceLive(f, { type: "failed" });
  ok(liveStatusOf(f) === "failed" && f.failures === 1, "live: a failed save is failed");
  ok(!canAutoSave(f, gate), "live: a failed save waits for its retry, not the debounce");
  ok(canAutoSave(reduceLive(f, { type: "retry" }), gate), "live: a retry opens it again");
  ok(retryDelayMs(1) === 5_000 && retryDelayMs(2) === 15_000 && retryDelayMs(3) === 30_000 && retryDelayMs(4) === 60_000 && retryDelayMs(9) === 60_000, "live: retry backoff");
  ok(retryDelayMs(1, false) === null, "live: a failed create never retries by itself");

  // refused and conflict
  let rf = reduceLive(reduceLive(reduceLive(INITIAL_LIVE_STATE, { type: "edit" }), { type: "start" }), { type: "refused", message: "No labor" });
  ok(liveStatusOf(rf) === "refused" && rf.refusal === "No labor" && !canAutoSave(rf, gate), "live: refused pauses with the reason");
  rf = reduceLive(rf, { type: "edit" });
  ok(rf.refusal === null && canAutoSave(rf, gate), "live: the next edit lifts a refusal");
  let c = reduceLive(reduceLive(reduceLive(INITIAL_LIVE_STATE, { type: "edit" }), { type: "start" }), { type: "conflict", by: "Isaac", at: 5 });
  ok(liveStatusOf(c) === "conflict" && c.conflict?.by === "Isaac" && !canAutoSave(c, gate), "live: a conflict pauses");
  c = reduceLive(c, { type: "edit" });
  ok(liveStatusOf(c) === "conflict" && !canAutoSave(c, gate), "live: another edit does not lift a conflict");
  c = reduceLive(c, { type: "keepMine" });
  ok(c.conflict === null && liveStatusOf(c) === "dirty", "live: Keep mine lifts it");

  // eligibility
  ok(liveSaveEligible({ status: "draft", source: "estimator", quoteType: "system" }), "rules: an Estimator draft is live");
  ok(liveSaveEligible({ status: "draft", source: "estimator", quoteType: null }), "rules: a blank quote type is a system quote");
  for (const status of ["sent", "won", "lost"] as const) ok(!liveSaveEligible({ status, source: "estimator", quoteType: "system" }), `rules: ${status} is not live`);
  ok(!liveSaveEligible({ status: "draft", source: "portal-catalog", quoteType: "system" }), "rules: a portal quote is not live");
  ok(!liveSaveEligible({ status: "draft", source: "estimator", quoteType: "flame" }), "rules: a service quote is not live");
  ok(liveSaveRefusal({ status: "sent", source: "estimator", quoteType: "system" }) !== null, "rules: the server refuses live on a sent quote");
  ok(liveSaveRefusal({ status: "draft", source: "estimator", quoteType: "system" }) === null, "rules: the server allows live on a draft");

  // the limited patch
  const limited = limitToLivePatch({ name: "x", customer: "y", customerId: "c", spec: { sections: [] }, value: 1, margin: 2, pdfOptions: {}, paymentTerms: "p", boxSale: true, pricingTier: "t", tierMargin: 3, source: "estimator", quoteNote: "n", coverSummary: "s" } as never) as Record<string, unknown>;
  ok(!("name" in limited) && !("customer" in limited) && !("customerId" in limited) && !("quoteNote" in limited) && !("coverSummary" in limited), "rules: header fields stay with the header autosave");
  ok(["spec", "value", "margin", "pdfOptions", "paymentTerms", "boxSale", "pricingTier", "tierMargin", "source"].every((k) => k in limited), "rules: the fields only Save carries stay");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: FAIL, cannot find module `scheduler`.

- [ ] **Step 3: Write the modules**

Create `src/lib/estimate-live-save/scheduler.ts`:

```ts
/**
 * Estimator live save — when to save (pure). The hook owns the timers and the queue; this owns the decisions.
 * `editSeq` counts user edits and `savedSeq` is the highest one stored, so an edit made during a save stays unsaved.
 */
export const DEBOUNCE_MS = 1_500;
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];

export type LiveConflict = { by: string | null; at: number | null };
export type LiveSaveState = {
  editSeq: number;
  savedSeq: number;
  inFlightSeq: number | null;
  failures: number;
  /** A failed save holds off the debounce until its retry. */
  waitingRetry: boolean;
  refusal: string | null;
  conflict: LiveConflict | null;
};
export const INITIAL_LIVE_STATE: LiveSaveState = { editSeq: 0, savedSeq: 0, inFlightSeq: null, failures: 0, waitingRetry: false, refusal: null, conflict: null };

export type LiveEvent =
  | { type: "edit" }
  | { type: "start" }
  | { type: "saved"; seq: number }
  | { type: "failed" }
  | { type: "retry" }
  | { type: "refused"; message: string }
  | { type: "conflict"; by: string | null; at: number | null }
  | { type: "keepMine" };

export function reduceLive(s: LiveSaveState, e: LiveEvent): LiveSaveState {
  switch (e.type) {
    case "edit":
      return { ...s, editSeq: s.editSeq + 1, refusal: null, waitingRetry: false };
    case "start":
      return { ...s, inFlightSeq: s.editSeq };
    case "saved":
      return { ...s, inFlightSeq: null, savedSeq: Math.max(s.savedSeq, e.seq), failures: 0, waitingRetry: false, refusal: null };
    case "failed":
      return { ...s, inFlightSeq: null, failures: s.failures + 1, waitingRetry: true };
    case "retry":
      return { ...s, waitingRetry: false };
    case "refused":
      return { ...s, inFlightSeq: null, refusal: e.message, waitingRetry: false };
    case "conflict":
      return { ...s, inFlightSeq: null, conflict: { by: e.by, at: e.at }, waitingRetry: false };
    case "keepMine":
      return { ...s, conflict: null, waitingRetry: false, refusal: null };
  }
}

export type LiveStatus = "saved" | "dirty" | "saving" | "failed" | "refused" | "conflict";
export function liveStatusOf(s: LiveSaveState): LiveStatus {
  if (s.conflict) return "conflict";
  if (s.inFlightSeq !== null) return "saving";
  if (s.refusal) return "refused";
  if (s.waitingRetry) return "failed";
  return s.editSeq > s.savedSeq ? "dirty" : "saved";
}

export type LiveGate = { enabled: boolean; hasId: boolean; hasLines: boolean; tierResolving: boolean; statusChanging: boolean };
export function canAutoSave(s: LiveSaveState, g: LiveGate): boolean {
  if (!g.enabled || g.tierResolving || g.statusChanging) return false;
  if (!g.hasId && !g.hasLines) return false;
  return liveStatusOf(s) === "dirty";
}

/** How long before an automatic retry; null = never by itself (a create could mint a second quote). */
export function retryDelayMs(failures: number, hasId = true): number | null {
  if (!hasId) return null;
  return RETRY_MS[Math.min(Math.max(failures, 1), RETRY_MS.length) - 1];
}
```

Create `src/lib/estimate-live-save/rules.ts`:

```ts
/** Estimator live save — which estimates, and what a live save writes (pure, client-safe). */
type LiveQuoteFields = { status?: string | null; source?: string | null; quoteType?: string | null };

export function liveSaveEligible(q: LiveQuoteFields): boolean {
  if (q.status !== "draft") return false;
  if (q.source === "portal-catalog" || q.source === "portal-service") return false;
  return !q.quoteType || q.quoteType === "system";
}

export const LIVE_REFUSED = "This estimate no longer saves itself — press Save to keep your changes.";

/** The server's own check on the STORED quote; a non-null reason writes nothing. */
export function liveSaveRefusal(q: LiveQuoteFields): string | null {
  return liveSaveEligible(q) ? null : LIVE_REFUSED;
}

/** What a live save writes on an existing quote. The header stays with the header autosave, so a stale window can't overwrite it. */
export const LIVE_PATCH_FIELDS = ["spec", "value", "margin", "pdfOptions", "paymentTerms", "boxSale", "pricingTier", "tierMargin", "source"] as const;

export function limitToLivePatch<T extends object>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of LIVE_PATCH_FIELDS) if (k in patch) out[k] = (patch as Record<string, unknown>)[k];
  return out as Partial<T>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: `… PASS, 0 FAIL`

- [ ] **Step 5: Commit**

```bash
git add src/lib/estimate-live-save/scheduler.ts src/lib/estimate-live-save/rules.ts scripts/test-estimate-live-save.ts
git commit -m "feat(estimator): the live save scheduler and eligibility rules (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The change key and the checked write

**Files:**
- Create: `src/lib/estimate-live-save/live-key.ts`
- Modify: `src/lib/stores/quotes.ts` (`Quote` type near line 318; new function after `update()` near line 1050)
- Modify: `scripts/test-estimate-live-save.ts`

**Interfaces:**
- Produces: `liveKey(q: LiveKeyFields): string` from `live-key.ts`.
- Produces, from `quotes.ts`: `Quote.lastSavedBy?: { name: string; at: number }`, and `updateCheckingLiveKey(id, baseKey, patch): Promise<CheckedUpdate>` where `CheckedUpdate = { quote: Quote | null; conflict: { by: string | null; at: number | null } | null }`.

- [ ] **Step 1: Write the failing test**

Add these imports to `scripts/test-estimate-live-save.ts`:

```ts
import { liveKey } from "../src/lib/estimate-live-save/live-key";
```

Add to `liveSavePureChecks`:

```ts
  // the key
  const kq = { spec: { sections: [{ id: "A", a: 1, b: 2 }] }, vendorQuotes: [], pdfOptions: { pdfQty: true }, paymentTerms: "net30", boxSale: false };
  ok(liveKey(kq) === liveKey({ ...kq, spec: { sections: [{ b: 2, a: 1, id: "A" }] } }), "key: object key order does not move it (jsonb reorders keys)");
  ok(liveKey(kq) !== liveKey({ ...kq, spec: { sections: [{ id: "A", a: 1, b: 3 }] } }), "key: a spec change moves it");
  ok(liveKey(kq) !== liveKey({ ...kq, paymentTerms: "net60" }), "key: payment terms move it");
  ok(liveKey(kq) !== liveKey({ ...kq, boxSale: true }), "key: box sale moves it");
  ok(liveKey({ ...kq, boxSale: undefined }) === liveKey(kq), "key: no box sale key equals false (update() removes the key)");
  ok(liveKey({ ...kq, name: "Other", status: "sent", owner: "x", customerId: "c", quoteNote: "n", updatedAt: 9 } as never) === liveKey(kq), "key: header, status and people changes never move it");
```

Replace the body of `liveSaveDbChecks`:

```ts
export async function liveSaveDbChecks(ok: Ok) {
  const { create, get, update, updateCheckingLiveKey } = await import("../src/lib/stores/quotes");
  const id = (await create({ name: "Live save fixture", customer: "Fixture", source: "estimator", spec: { sections: [{ id: "A", name: "A", items: [] }] } } as never)).id;
  try {
    const base = liveKey((await get(id))!);
    const one = await updateCheckingLiveKey(id, base, { value: 100 } as never);
    ok(!one.conflict && one.quote?.value === 100, "checked write: a matching key writes");
    // A write that doesn't touch a key field leaves the key alone.
    ok(liveKey((await get(id))!) === base, "checked write: value alone does not move the key");

    // Round trip: what comes back from the store hashes the same as a fresh read.
    const moved = await update(id, { spec: { sections: [{ id: "A", name: "B", items: [] }] }, lastSavedBy: { name: "Isaac", at: 1234 } } as never);
    const fresh = await get(id);
    ok(!!moved && liveKey(fresh!) !== base, "checked write: a spec change moves the key");

    const stale = await updateCheckingLiveKey(id, base, { value: 200 } as never);
    ok(stale.conflict?.by === "Isaac" && stale.conflict?.at === 1234 && stale.quote === null, "checked write: a stale key writes nothing and names who saved");
    ok((await get(id))!.value === 100, "checked write: the stale write did not land");

    const unchecked = await updateCheckingLiveKey(id, undefined, { value: 300 } as never);
    ok(!unchecked.conflict && unchecked.quote?.value === 300, "checked write: no key is not checked (a tab from before this deploy)");

    const bumpedBefore = (await get(id))!.updatedAt;
    await update(id, { quoteNote: "header" } as never);
    ok(liveKey((await get(id))!) === liveKey(fresh!), "checked write: a header autosave does not move the key");
    ok((await get(id))!.updatedAt >= bumpedBefore, "checked write: sanity — header writes still bump updatedAt");
  } finally {
    const { remove } = await import("../src/lib/stores/quotes");
    await remove(id);
  }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-estimate-live-save.ts`
Expected: FAIL, cannot find module `live-key`.

- [ ] **Step 3: Write the key**

Create `src/lib/estimate-live-save/live-key.ts`:

```ts
/**
 * Estimator live save — the change key (server-only: node:crypto). A hash of the fields a live save writes, minus the
 * derived ones, so status moves, people changes, approvals and header autosaves never raise a false conflict, and any
 * writer that changes the spec is caught without auditing it. The client only ever holds the string.
 */
import { createHash } from "node:crypto";

export type LiveKeyFields = { spec?: unknown; vendorQuotes?: unknown; pdfOptions?: unknown; paymentTerms?: unknown; boxSale?: unknown };

/** JSON with sorted object keys: jsonb reorders keys, so a plain stringify would change across a round trip. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined ? "null" : stable(x))).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

export function liveKey(q: LiveKeyFields): string {
  const body = stable({ spec: q.spec ?? null, vendorQuotes: q.vendorQuotes ?? [], pdfOptions: q.pdfOptions ?? null, paymentTerms: q.paymentTerms ?? null, boxSale: q.boxSale === true });
  return createHash("sha1").update(body).digest("hex");
}
```

- [ ] **Step 4: Add the store write**

In `src/lib/stores/quotes.ts`, add to the `Quote` type beside `updatedAt`:

```ts
  /** Estimator live save: who last saved through the Estimator, for the "changed somewhere else" banner.
   *  Stamped only by saveQuoteAction; other writers leave it alone, so it can name the wrong change — the banner handles a missing one. */
  lastSavedBy?: { name: string; at: number };
```

Import `liveKey` from `@/lib/estimate-live-save/live-key` at the top, and add after `update()`:

```ts
export type CheckedUpdate = { quote: Quote | null; conflict: { by: string | null; at: number | null } | null };

/**
 * Estimator live save: the change check and the write, in one transaction under the quote row lock. A stale `baseKey`
 * writes nothing and says who last saved. No `baseKey` (a tab from before this deploy, or Keep mine) is not checked.
 */
export async function updateCheckingLiveKey(id: string, baseKey: string | undefined, patch: Partial<Quote>): Promise<CheckedUpdate> {
  if (baseKey === undefined) return { quote: await update(id, patch), conflict: null };
  return withTransaction(async () => {
    await lockQuoteRow(id);
    const cur = await get(id);
    if (cur && liveKey(cur) !== baseKey) return { quote: null, conflict: { by: cur.lastSavedBy?.name ?? null, at: cur.lastSavedBy?.at ?? null } };
    return { quote: await update(id, patch), conflict: null };
  });
}
```

`withTransaction` is re-entrant (`src/db/index.ts:133`), so `update()` joins this transaction.

- [ ] **Step 5: Run the test to verify it passes**

Run: `PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-estimate-live-save.ts`
Expected: `… PASS, 0 FAIL` with no "pure only" note.

- [ ] **Step 6: Commit**

```bash
git add src/lib/estimate-live-save/live-key.ts src/lib/stores/quotes.ts scripts/test-estimate-live-save.ts
git commit -m "feat(estimator): the live save change key and checked write

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `saveQuoteAction` live mode

**Files:**
- Modify: `src/app/(app)/estimator/actions.ts` (`SavePayload` line 168, `SaveResult` line 228, `saveQuoteAction` lines 456–800, new actions)
- Modify: `src/app/(app)/estimator/page.tsx` (`initialFrom` near lines 166 and 249)
- Modify: `src/app/(app)/estimator/types.ts` (near line 649)
- Modify: `scripts/test-estimate-live-save.ts`

**Interfaces:**
- Consumes: `liveSaveRefusal`, `limitToLivePatch` (Task 2); `liveKey`, `updateCheckingLiveKey` (Task 3).
- Produces: `SavePayload.live?`, `.renderPdf?`, `.baseKey?`. `SaveResult.conflict?`, `.notLive?`, `.liveKey?`. `currentLiveKeyAction(id): Promise<string | null>`. `revalidateAfterLiveSaveAction(): Promise<void>`. `EstimatorInitial.liveKey: string | null` (use the real name of the type in `types.ts`).

- [ ] **Step 1: Write the failing source pins**

`"use server"` files can't run in the plain harness, so pin the source. Add to `liveSavePureChecks` (with `import { readFileSync } from "node:fs"` and `import { join } from "node:path"`):

```ts
  // saveQuoteAction's live mode (a "use server" file can't run here — the store write is covered by the DB half; the browser check covers the rest).
  const actionsSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/actions.ts"), "utf8");
  const saveSrc = actionsSrc.slice(actionsSrc.indexOf("export async function saveQuoteAction"), actionsSrc.indexOf("export async function searchQuotesAction"));
  ok(saveSrc.includes("liveSaveRefusal(prior)"), "action: the server re-checks a live save against the stored quote");
  ok(saveSrc.includes("limitToLivePatch("), "action: a live save writes the limited patch");
  ok(saveSrc.includes("updateCheckingLiveKey(loadedId, payload.baseKey,"), "action: the write goes through the checked update");
  ok(saveSrc.includes("markQuotePdfStale(") && saveSrc.includes("scheduleQuotePdf("), "action: a live save marks the PDF stale, a rendering save schedules it");
  ok(/if \(!live\) refresh\(\);/.test(saveSrc), "action: a live save skips the whole-layout refresh");
  ok(/if \(q && !live\) \{\s*const decision = resolveSaveStatusChange/.test(saveSrc), "action: a live save never acts on status");
  ok(saveSrc.includes("lastSavedBy"), "action: a save stamps who saved");
  ok(!/\bdel\(/.test(actionsSrc), "action: saving never deletes a vendor quote's Blob file, so Undo can bring the attachment back");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: FAIL on the `action:` pins.

- [ ] **Step 3: Change the action**

In `actions.ts`, add imports:

```ts
import { limitToLivePatch, liveSaveRefusal } from "@/lib/estimate-live-save/rules";
import { liveKey } from "@/lib/estimate-live-save/live-key";
```

Add `updateCheckingLiveKey` to the existing `@/lib/stores/quotes` import, and `markQuotePdfStale` to the `scheduleQuotePdf` import.

Add to `SavePayload`:

```ts
  /** Estimator live save: limit the patch to what only Save carries, never act on status, skip the layout refresh. Refused unless the stored quote is an eligible draft. */
  live?: boolean;
  /** With `live`: also render the PDF (saveNow); without, a live save only marks it out of date. */
  renderPdf?: boolean;
  /** The change key this window last saw; a stale one writes nothing. Absent = not checked. */
  baseKey?: string;
```

Add to `SaveResult`:

```ts
  /** The estimate changed somewhere else — nothing was written. */
  conflict?: { by: string | null; at: number | null };
  /** `live` was refused because the stored quote isn't an eligible draft — nothing was written. */
  notLive?: boolean;
  /** The stored quote's change key after this save. */
  liveKey?: string;
```

Right after `const prior = loadedId ? await get(loadedId) : null;` add:

```ts
  const live = payload.live === true;
  const renderPdf = !live || payload.renderPdf === true;
  if (live && prior) {
    const refusal = liveSaveRefusal(prior);
    if (refusal) return { ...refusedSave(prior, refusal), notLive: true };
  }
```

Replace the tier resolve line:

```ts
  // A live save leaves the header to the header autosave, so the stamp reads the STORED customer and contact (a stale window can't move it).
  const tier = live && prior
    ? await resolveTier(prior.customerId || null, prior.contactName || "")
    : await resolveTier(payload.customerId || null, payload.contactName || "");
```

After `patch.spec = await quoteSpecFollowingRenames(patch.spec);` add:

```ts
  const savedBy = { name: user.name, at: Date.now() };
  const writePatch: QuotePatch = live && loadedId ? (limitToLivePatch(patch) as QuotePatch) : patch;
```

Replace the update branch's write and PDF lines:

```ts
    storedVendorQuotes = await storeVendorQuotes(loadedId, storedVendorQuotes);
    const written = await updateCheckingLiveKey(loadedId, payload.baseKey, { ...writePatch, vendorQuotes: storedVendorQuotes, lastSavedBy: savedBy } as QuotePatch);
    if (written.conflict) return { ...refusedSave(prior, "This estimate changed somewhere else — nothing was written."), conflict: written.conflict };
    q = written.quote;
```

and:

```ts
    if (q) pdfState = renderPdf ? await scheduleQuotePdf(loadedId) : await markQuotePdfStale(loadedId, q.contentChangedAt ?? Date.now());
```

Change `if (q) {\n      const decision = resolveSaveStatusChange(` to `if (q && !live) {\n      const decision = resolveSaveStatusChange(`.

In the create branch, add `lastSavedBy: savedBy,` to the second `update(created.id, { … })` object, and change its PDF line to:

```ts
    if (q && renderPdf) pdfState = await scheduleQuotePdf(created.id);
```

Replace `refresh();` near the end with `if (!live) refresh();`, and add to the returned object:

```ts
    // Read back from the store: the key must match what the next check will read.
    liveKey: q?.id ? liveKey((await get(q.id)) ?? q) : undefined,
```

Add two actions after `saveQuoteAction`:

```ts
/** The stored change key, re-read after a status move (a Lost move can clear the Rewards credit from the spec). */
export async function currentLiveKeyAction(id: string): Promise<string | null> {
  await requireUser();
  const q = id ? await get(id) : null;
  return q ? liveKey(q) : null;
}

/** Live saves skip the layout refresh (it re-runs a page that loads the whole catalog); leaving the Estimator runs it once. */
export async function revalidateAfterLiveSaveAction(): Promise<void> {
  await requireUser();
  refresh();
}
```

`get`, `requireUser` and `refresh` are already in scope in this file.

- [ ] **Step 4: Carry the key to the client**

In `types.ts`, beside `replaces: string;`:

```ts
  /** Estimator live save: the stored change key at load; null for a new estimate. */
  liveKey: string | null;
```

In `page.tsx`, import `liveKey` from `@/lib/estimate-live-save/live-key`. Add `liveKey: null,` to the new-estimate object beside `replaces: ""` (line 164) and `liveKey: liveKey(q),` to the loaded object beside `replaces: ""` (line 247).

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx tsx scripts/test-estimate-live-save.ts && npx tsc --noEmit`
Expected: `… PASS, 0 FAIL`, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/page.tsx" "src/app/(app)/estimator/types.ts" scripts/test-estimate-live-save.ts
git commit -m "feat(estimator): saveQuoteAction live mode with the change check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The live save hook and `performSave`

**Files:**
- Create: `src/app/(app)/estimator/use-live-save.ts`
- Modify: `src/app/(app)/estimator/use-estimator-state.ts`
- Modify: `scripts/test-estimate-live-save.ts`

**Interfaces:**
- Consumes: Task 2 scheduler; Task 4 payload and result fields.
- Produces: `useLiveSave(opts)` returning `LiveSaveApi`:

```ts
export type SaveMode = "auto" | "manual" | "force";
export type SaveOutcome =
  | { kind: "saved"; version: number }
  | { kind: "conflict"; by: string | null; at: number | null }
  | { kind: "refused"; message: string }
  | { kind: "notLive" }
  | { kind: "failed" }
  /** Nothing was attempted (a tier lookup in flight), or the page is reloading. */
  | { kind: "blocked" };
export type LiveSaveApi = {
  status: LiveStatus;
  refusal: string | null;
  conflict: LiveConflict | null;
  /** A user edit has happened in this page session. */
  edited: boolean;
  markEdit: () => void;
  flush: () => Promise<void>;
  saveManual: () => Promise<number | false>;
  enqueue: <T>(run: () => Promise<T>) => Promise<T>;
  keepMine: () => void;
  reload: () => void;
  retryNow: () => void;
};
```

- The state hook's return gains `liveMode: boolean`, `live: LiveSaveApi`, `contentUnsaved: boolean`.

- [ ] **Step 1: Write the failing source pins**

Add to `liveSavePureChecks`:

```ts
  // The hook's wiring: rules that only a browser could break, pinned at the source.
  const hookSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/use-estimator-state.ts"), "utf8");
  ok(hookSrc.includes("const performSave = async (mode: SaveMode)"), "hook: saveNow became performSave(mode)");
  ok(hookSrc.includes("const saveNow = live.saveManual"), "hook: saveNow runs through the one queue");
  ok(/if \(mode !== "auto"\) setSavedDoc\(/.test(hookSrc), "hook: a live save does not clear pdfDirty — only a save that renders does");
  ok(/updateQuoteMetaAction\(id, meta\)/.test(hookSrc) && hookSrc.includes("liveRef.current?.enqueue"), "hook: the header autosave shares the queue");
  ok(hookSrc.includes("markEdit") && /const setSections:[\s\S]{0,300}markEdit/.test(hookSrc), "hook: a user edit to the sections marks the live save");
  const applyStampSrc = hookSrc.slice(hookSrc.indexOf("const applyTierStamp"), hookSrc.indexOf("const resolveTierFor"));
  ok(/markEdit/.test(applyStampSrc), "hook: a tier re-price is an edit");
  const freightSrc = hookSrc.slice(hookSrc.indexOf("const reapplyAutoFreight"), hookSrc.indexOf("const reapplyAutoFreight") + 700);
  ok(!/markEdit/.test(freightSrc), "hook: auto freight is not an edit — opening never writes");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: FAIL on the `hook:` pins.

- [ ] **Step 3: Write the hook**

Create `src/app/(app)/estimator/use-live-save.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canAutoSave, DEBOUNCE_MS, INITIAL_LIVE_STATE, liveStatusOf, reduceLive, retryDelayMs, type LiveConflict, type LiveEvent, type LiveGate, type LiveSaveState, type LiveStatus } from "@/lib/estimate-live-save/scheduler";
import { revalidateAfterLiveSaveAction } from "./actions";

export type SaveMode = "auto" | "manual" | "force";
export type SaveOutcome =
  | { kind: "saved"; version: number }
  | { kind: "conflict"; by: string | null; at: number | null }
  | { kind: "refused"; message: string }
  | { kind: "notLive" }
  | { kind: "failed" }
  /** Nothing was attempted (a tier lookup in flight), or the page is reloading. */
  | { kind: "blocked" };

export type LiveSaveApi = {
  status: LiveStatus;
  refusal: string | null;
  conflict: LiveConflict | null;
  /** A user edit has happened in this page session. */
  edited: boolean;
  markEdit: () => void;
  flush: () => Promise<void>;
  saveManual: () => Promise<number | false>;
  enqueue: <T>(run: () => Promise<T>) => Promise<T>;
  keepMine: () => void;
  reload: () => void;
  retryNow: () => void;
};

/**
 * One queue for every write from this window (live saves, manual Saves, the header autosave), the debounce and the
 * retries. `perform` is read through a ref when its turn comes, so a queued save always sends the newest state.
 */
export function useLiveSave(opts: { gate: LiveGate; perform: (mode: SaveMode) => Promise<SaveOutcome> }): LiveSaveApi {
  const [state, setState] = useState<LiveSaveState>(INITIAL_LIVE_STATE);
  const stateRef = useRef(state);
  const apply = useCallback((e: LiveEvent) => {
    stateRef.current = reduceLive(stateRef.current, e);
    setState(stateRef.current);
  }, []);
  const gateRef = useRef(opts.gate);
  const performRef = useRef(opts.perform);
  useEffect(() => {
    gateRef.current = opts.gate;
    performRef.current = opts.perform;
  });
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    const next = chainRef.current.then(run, run);
    chainRef.current = next.catch(() => undefined);
    return next;
  }, []);
  const autoQueuedRef = useRef(false);
  const didLiveSaveRef = useRef(false);
  const unloadOkRef = useRef(false);

  const settle = useCallback((out: SaveOutcome, seq: number) => {
    if (out.kind === "saved") apply({ type: "saved", seq });
    else if (out.kind === "conflict") apply({ type: "conflict", by: out.by, at: out.at });
    else if (out.kind === "refused") apply({ type: "refused", message: out.message });
    else if (out.kind === "failed") apply({ type: "failed" });
    // notLive: the estimate left live save; the gate closes on the next render. Settle what was in flight.
    else apply({ type: "saved", seq: stateRef.current.savedSeq });
  }, [apply]);

  const runAuto = useCallback((): Promise<unknown> => {
    if (autoQueuedRef.current) return chainRef.current;
    autoQueuedRef.current = true;
    return enqueue(async () => {
      autoQueuedRef.current = false;
      if (!canAutoSave(stateRef.current, gateRef.current)) return;
      apply({ type: "start" });
      const seq = stateRef.current.inFlightSeq as number;
      let out: SaveOutcome;
      try {
        out = await performRef.current("auto");
      } catch {
        out = { kind: "failed" };
      }
      if (out.kind === "saved") didLiveSaveRef.current = true;
      settle(out, seq);
    });
  }, [apply, enqueue, settle]);

  // The debounce, and the next save when an edit landed during the last one.
  const status = liveStatusOf(state);
  const ready = canAutoSave(state, opts.gate);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void runAuto(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, state.editSeq, runAuto]);

  // Automatic retries, and straight away when the connection comes back.
  useEffect(() => {
    if (status !== "failed" || !opts.gate.enabled) return;
    const delay = retryDelayMs(state.failures, opts.gate.hasId);
    if (delay === null) return;
    const again = () => {
      apply({ type: "retry" });
      void runAuto();
    };
    const t = setTimeout(again, delay);
    window.addEventListener("online", again);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", again);
    };
  }, [status, state.failures, opts.gate.enabled, opts.gate.hasId, apply, runAuto]);

  // Closing or reloading with work unsaved warns. In-app navigation doesn't fire this, so unmount saves instead.
  const needsSave = opts.gate.enabled && status !== "saved";
  useEffect(() => {
    if (!needsSave) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (unloadOkRef.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [needsSave]);
  useEffect(
    () => () => {
      const leave = async () => {
        if (canAutoSave(stateRef.current, gateRef.current)) {
          const seq = stateRef.current.editSeq;
          await enqueue(async () => {
            const out = await performRef.current("auto").catch((): SaveOutcome => ({ kind: "failed" }));
            if (out.kind === "saved") {
              didLiveSaveRef.current = true;
              stateRef.current = reduceLive(stateRef.current, { type: "saved", seq });
            }
          });
        } else {
          await chainRef.current;
        }
        if (didLiveSaveRef.current) await revalidateAfterLiveSaveAction().catch(() => undefined);
      };
      void leave();
    },
    [enqueue]
  );

  const markEdit = useCallback(() => apply({ type: "edit" }), [apply]);
  const flush = useCallback(async () => {
    if (canAutoSave(stateRef.current, gateRef.current)) void runAuto();
    await chainRef.current;
  }, [runAuto]);
  const saveManual = useCallback(
    () =>
      enqueue(async (): Promise<number | false> => {
        const seq = stateRef.current.editSeq;
        let out: SaveOutcome;
        try {
          out = await performRef.current("manual");
        } catch {
          return false;
        }
        if (out.kind === "saved") {
          apply({ type: "saved", seq });
          return out.version;
        }
        if (out.kind === "conflict") apply({ type: "conflict", by: out.by, at: out.at });
        return false;
      }),
    [apply, enqueue]
  );
  const keepMine = useCallback(() => {
    apply({ type: "keepMine" });
    void enqueue(async () => {
      apply({ type: "start" });
      const seq = stateRef.current.inFlightSeq as number;
      const out = await performRef.current("force").catch((): SaveOutcome => ({ kind: "failed" }));
      settle(out, seq);
    });
  }, [apply, enqueue, settle]);
  const reload = useCallback(() => {
    unloadOkRef.current = true;
    window.location.reload();
  }, []);
  const retryNow = useCallback(() => {
    apply({ type: "retry" });
    void runAuto();
  }, [apply, runAuto]);

  return useMemo(
    () => ({ status, refusal: state.refusal, conflict: state.conflict, edited: state.editSeq > 0, markEdit, flush, saveManual, enqueue, keepMine, reload, retryNow }),
    [status, state.refusal, state.conflict, state.editSeq, markEdit, flush, saveManual, enqueue, keepMine, reload, retryNow]
  );
}
```

- [ ] **Step 4: Turn `saveNow` into `performSave`**

In `use-estimator-state.ts`, add imports:

```ts
import { liveSaveEligible } from "@/lib/estimate-live-save/rules";
import { useLiveSave, type LiveSaveApi, type SaveMode, type SaveOutcome } from "./use-live-save";
```

Add `currentLiveKeyAction` to the `./actions` import.

Near the top of the hook, before the `sections` state:

```ts
  /** Live save: declared here so closures above the hook call can reach it. Set in an effect after useLiveSave. */
  const liveRef = useRef<LiveSaveApi | null>(null);
  /** The change key this window last saw. A `useRef`, not read from `initial`: a LiveSync refresh must not adopt someone else's key. */
  const liveKeyRef = useRef<string | null>(initial.liveKey);
  /** The vendor quote list a save response just wrote: not an edit. */
  const serverVendorQuotesRef = useRef<VendorQuote[] | null>(null);
```

Change `setSections` (line 295) to mark the edit:

```ts
  const setSections: Dispatch<SetStateAction<SpecSection[]>> = (v) => {
    setTierReprice(null);
    liveRef.current?.markEdit();
    // Phase 2a: any edit to a built system other than `built` itself un-marks it.
    setSectionsState((prev) => unmarkUserEdits(prev, typeof v === "function" ? v(prev) : v));
  };
```

In `applyTierStamp`, inside `if (res.sections !== before)`, add `liveRef.current?.markEdit();`. In `undoTierReprice`, add `liveRef.current?.markEdit();` too. Do **not** add it to `reapplyAutoFreight` or the bonus and project-discount effects.

Change `persistMeta` (line 1198) so it shares the queue:

```ts
    startTransition(async () => {
      const run = liveRef.current?.enqueue ?? (<T,>(f: () => Promise<T>) => f());
      let r: Awaited<ReturnType<typeof updateQuoteMetaAction>> | null = null;
      try {
        r = await run(() => updateQuoteMetaAction(id, meta));
      } catch (e) {
        console.error("[estimator] header autosave failed:", e);
      }
      // A live save leaves the header alone, so nothing else would heal this: say so.
      if (!r || !r.ok) setActionError(r?.error || "That header change did not save. Check your connection and change it again.");
```

The rest of the transition body (`if (r && r.ok) { … }`) stays as it is.

Replace the head of `saveNow` (line 1445) with:

```ts
  /** The save itself, one attempt. "auto" is a live save (limited patch, no render, quiet); "manual" is every awaitable
   *  Save (on a live-save estimate: the limited patch plus a render); "force" is Keep mine (no change check). */
  const performSave = async (mode: SaveMode): Promise<SaveOutcome> => {
    const auto = mode === "auto";
    if (tierResolvingRef.current) return { kind: "blocked" };
```

Then, through the body:

1. In the document-over-cap and box-sale refusals, keep the `setAction…` calls for manual only and return a typed outcome:

```ts
    if (docNow && packageDocOverRef.current) {
      if (!auto) {
        setActionNotice(null);
        setGateRefused(false);
        setActionError(PACKAGE_DOC_TOO_LARGE);
      }
      return { kind: "refused", message: PACKAGE_DOC_TOO_LARGE };
    }
    const boxProblem = boxSaleSaveProblem(boxSale, sections);
    if (boxProblem) {
      if (!auto) {
        setActionNotice(null);
        setGateRefused(false);
        setActionError(boxProblem);
      }
      return { kind: "refused", message: boxProblem };
    }
```

2. Compute the mode's flags after `const docAtSave`:

```ts
    const isLive = liveMode;
```

3. In the `saveQuoteAction` payload, change `status` and add the live fields:

```ts
          // A live save never moves status.
          status: isLive ? baseStatus : status,
          baseStatus,
          ...(isLive ? { live: true, renderPdf: !auto } : {}),
          ...(mode !== "force" && liveKeyRef.current ? { baseKey: liveKeyRef.current } : {}),
```

4. Right after `const res = await saveQuoteAction(…)`:

```ts
        if (res.conflict) return { kind: "conflict", by: res.conflict.by, at: res.conflict.at };
        if (res.notLive) {
          if (res.status) {
            syncBonusAfterStatus(statusBeforeSave, res.status);
            setStatus(res.status);
            setBaseStatus(res.status);
          }
          setActionNotice(res.error ?? null);
          return { kind: "notLive" };
        }
        if (res.liveKey) liveKeyRef.current = res.liveKey;
```

5. Inside `if (res.id)`:

```ts
          if (mode !== "auto") setSavedDoc({ ...docAtSave, quoteNumber: res.number ?? res.id });
          if (mode !== "auto") setSavedDiscountsKey(projectDiscountsKey(discountsAtSave)); // #366
          if (res.pdf && mode !== "auto") setPdf(res.pdf);
          setQuoteId(res.number ?? res.id);
          // The server may have moved attachments into Blob storage. Merge by id so a list edited during this save survives,
          // and mark the write as the server's, not an edit.
          if (res.vendorQuotes) {
            const stored = new Map(res.vendorQuotes.map((v) => [v.id, v]));
            setVendorQuotes((cur) => {
              const merged = cur.map((v) => stored.get(v.id) ?? v);
              serverVendorQuotesRef.current = merged;
              return merged;
            });
          }
```

6. The Rewards credit block writes `setSectionsState` in auto mode, so a clamp doesn't mark another edit:

```ts
            if (rewardCreditOf(sectionsRef.current) !== stored) {
              const write = auto ? setSectionsState : setSections;
              write((ss) => withRewardCredit(ss, stored, nextId()));
            }
```

7. `window.location.reload(); return false;` in the two reopen and re-price paths become `window.location.reload(); return { kind: "blocked" };`. A live save never reaches them, because it doesn't act on status.

8. The `res.ok` block:

```ts
        if (res.ok) {
          if (!auto) {
            setActionError(null);
            setGateRefused(false);
            setActionNotice(res.notice || null);
            setJustSaved(true);
            if (savedTimer.current) clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
          } else if (res.notice) {
            setActionNotice(res.notice);
          }
          return res.id ? { kind: "saved", version: res.updatedAt } : { kind: "failed" };
        }
        if (auto) return { kind: "refused", message: res.error || "That save did not go through." };
        setActionNotice(null);
        setActionError(res.error || "That save did not go through — nothing was written.");
        setGateRefused(false);
        return { kind: "refused", message: res.error || "That save did not go through." };
```

9. The `catch`:

```ts
      } catch (e) {
        console.error("[estimator] save failed:", e);
        if (!auto) {
          setGateRefused(false);
          setActionError("That save did not go through — nothing was written. Check your connection, or remove a large vendor-quote attachment, and try again.");
        }
        return { kind: "failed" };
      }
```

10. In the `saveQuoteAction` call's success path, after `setLoadedId(res.id);`, record what a first save posted, so header edits made while it ran aren't lost (the header autosave is a no-op until there's an id, and a live save doesn't write the header):

```ts
          if (!loadedId) createdHeaderRef.current = { name: projectName, quoteNote: quoteNote || "", assumptions: assumptions || "", installTimeframe, category, coverSummary, notIncluded, contactName: contactName || "", locationId: locationId || null };
```

Declare the ref beside `liveRef`:

```ts
  /** The header fields a first save posted; compared once the id lands. */
  const createdHeaderRef = useRef<Record<string, unknown> | null>(null);
```

Then define, directly after `performSave`:

```ts
  const live = useLiveSave({
    gate: { enabled: liveMode, hasId: !!loadedId, hasLines: sections.some((s) => s.items.length > 0), tierResolving, statusChanging },
    perform: performSave,
  });
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const saveNow = live.saveManual;
```

Declare `liveMode` and the edit probe near `pdfDirty` (around line 1107), once `baseStatus` is in scope. Move `const unsavedHold`'s effect down after `live`, and base it on `contentUnsaved`:

```ts
  /** Estimator live save: Draft, non-portal, system quotes. `baseStatus` is what the server confirmed, so an optimistic status pick doesn't flip it. */
  const liveMode = liveSaveEligible({ status: baseStatus, source: initial.bonusSource, quoteType: initial.bonusQuoteType });
```

After `const saveNow`:

```ts
  /** The edits aren't stored yet. `pdfDirty` is narrower on a live-save estimate: the rendered PDF is behind the screen. */
  const contentUnsaved = liveMode ? live.status !== "saved" : pdfDirty;
  const unsavedHold = liveMode
    ? contentUnsaved || (!loadedId && sections.some((s) => s.items.length > 0))
    : pdfDirty || (!loadedId && sections.some((s) => s.items.length > 0)) || projectDiscountsKey(projectDiscounts) !== savedDiscountsKey;
  useEffect(() => {
    setUnsavedHold(unsavedHold);
    return () => setUnsavedHold(false);
  }, [unsavedHold]);

  // Everything else Save writes has no automatic writer: any change to it is a user edit.
  const editProbeRef = useRef({ groups, vendorQuotes, pdfOpts, paymentTerms, boxSale, projectDiscounts, packageDoc });
  useEffect(() => {
    const p = editProbeRef.current;
    const changed =
      p.groups !== groups ||
      (p.vendorQuotes !== vendorQuotes && vendorQuotes !== serverVendorQuotesRef.current) ||
      p.pdfOpts !== pdfOpts ||
      p.paymentTerms !== paymentTerms ||
      p.boxSale !== boxSale ||
      p.projectDiscounts !== projectDiscounts ||
      // The editor may emit on mount, so compare content: viewing the tab must not save.
      (p.packageDoc !== packageDoc && JSON.stringify(p.packageDoc) !== JSON.stringify(packageDoc));
    editProbeRef.current = { groups, vendorQuotes, pdfOpts, paymentTerms, boxSale, projectDiscounts, packageDoc };
    if (changed) live.markEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, vendorQuotes, pdfOpts, paymentTerms, boxSale, projectDiscounts, packageDoc]);

  // Header edits made while the first save ran had no id to save against: send the difference now.
  useEffect(() => {
    const posted = createdHeaderRef.current;
    if (!loadedId || !posted) return;
    createdHeaderRef.current = null;
    const now: Record<string, unknown> = { name: projectName, quoteNote: quoteNote || "", assumptions: assumptions || "", installTimeframe, category, coverSummary, notIncluded, contactName: contactName || "", locationId: locationId || null };
    const diff = Object.fromEntries(Object.entries(now).filter(([k, v]) => v !== posted[k]));
    if (Object.keys(diff).length) persistMeta(diff as Parameters<typeof updateQuoteMetaAction>[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);

  // A server-confirmed status move can rewrite the spec (a Lost move clears the Rewards credit): re-read the key.
  const keyStatusRef = useRef(baseStatus);
  useEffect(() => {
    if (keyStatusRef.current === baseStatus) return;
    keyStatusRef.current = baseStatus;
    if (!loadedId) return;
    void currentLiveKeyAction(loadedId).then((k) => {
      if (k) liveKeyRef.current = k;
    });
  }, [baseStatus, loadedId]);
```

Remove the original `unsavedHold` block at line 1112. `doSave` stays and calls `saveNow`. `changeStatus` and the stage move start with a flush, as the first statement inside their `startTransition`:

```ts
          if (liveMode) await live.flush();
```

Add `liveMode, live, contentUnsaved,` to the hook's returned object.

- [ ] **Step 5: Run the tests, typecheck, lint and build**

Run: `npx tsx scripts/test-estimate-live-save.ts && npx tsc --noEmit && npx eslint "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/use-live-save.ts" && npx next build`
Expected: `… PASS, 0 FAIL`, no type errors, no lint errors, a green build.

If the lint rule for refs or declaration order fires, follow the existing patterns in this file and don't disable rules beyond the `exhaustive-deps` line above.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/use-live-save.ts" "src/app/(app)/estimator/use-estimator-state.ts" scripts/test-estimate-live-save.ts
git commit -m "feat(estimator): drafts save themselves through one write queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Undo hook

**Files:**
- Create: `src/app/(app)/estimator/use-estimate-undo.ts`
- Modify: `src/app/(app)/estimator/use-estimator-state.ts`
- Modify: `scripts/test-estimate-live-save.ts`

**Interfaces:**
- Consumes: Task 1 stack; `liveRef`, `live` (Task 5).
- Produces: `useEstimateUndo(opts)` returning `EstimateUndoApi`:

```ts
export type EstimateUndoApi = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undo: () => void;
  redo: () => void;
  /** The next change to sections is a user edit. Optional label wins over the diff's own. */
  flagEdit: (label?: string) => void;
  /** `pendingChange`: state changes landing with this call are part of what cleared the history, so they aren't a step. */
  clearHistory: (opts?: { pendingChange?: boolean }) => void;
  /** Apply an automatic change to stored snapshots. */
  mapHistory: (fn: (sections: SpecSection[]) => SpecSection[]) => void;
};
```

- The state hook's return gains `undo: EstimateUndoApi`.

- [ ] **Step 1: Write the failing source pins**

Add to `liveSavePureChecks`:

```ts
  // Keeping history honest.
  ok(/undoRef\.current\?\.flagEdit\(\)/.test(hookSrc.slice(hookSrc.indexOf("const setSections:"), hookSrc.indexOf("const setSections:") + 400)), "undo: a user edit to the sections is flagged");
  ok(/undoRef\.current\?\.mapHistory\(/.test(hookSrc.slice(hookSrc.indexOf("const reapplyAutoFreight"), hookSrc.indexOf("const reapplyAutoFreight") + 800)), "undo: auto freight reaches stored snapshots");
  ok((hookSrc.match(/undoRef\.current\?\.clearHistory\(/g) || []).length >= 3, "undo: moving a system out, moving lines out and a status change clear history");
  ok(/flagEdit\("re-priced"\)/.test(hookSrc), "undo: a tier re-price is one labelled step");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: FAIL on the `undo:` pins.

- [ ] **Step 3: Write the hook**

Create `src/app/(app)/estimator/use-estimate-undo.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpecSection } from "./types";
import { emptyUndoHistory, mapSnapshots, recordEdit, takeRedo, takeUndo, type UndoHistory, type UndoSnap } from "@/lib/estimate-live-save/undo";

export type EstimateUndoApi = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undo: () => void;
  redo: () => void;
  /** The next change to sections is a user edit. Optional label wins over the diff's own. */
  flagEdit: (label?: string) => void;
  /** `pendingChange`: state changes landing with this call are part of what cleared the history, so they aren't a step. */
  clearHistory: (opts?: { pendingChange?: boolean }) => void;
  /** Apply an automatic change to stored snapshots. */
  mapHistory: (fn: (sections: SpecSection[]) => SpecSection[]) => void;
};

const isTextTarget = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};
const dialogOpen = () => !!document.querySelector('[role="dialog"],[aria-modal="true"]');

/**
 * Records a step when a flagged change lands. Unflagged changes (bonus lines, discounts, auto freight, $25 stamp) only
 * move the "current" snapshot, so they are never a step of their own. Groups and vendor quotes have no automatic writer
 * except a save response, passed as `serverVendorQuotes`.
 */
export function useEstimateUndo(opts: {
  snap: UndoSnap;
  serverVendorQuotes: { current: UndoSnap["vendorQuotes"] | null };
  /** Write a snapshot back to state. */
  apply: (s: UndoSnap) => void;
}): EstimateUndoApi {
  const { snap, serverVendorQuotes, apply } = opts;
  const [history, setHistory] = useState<UndoHistory>(emptyUndoHistory);
  const historyRef = useRef(history);
  const write = useCallback((h: UndoHistory) => {
    historyRef.current = h;
    setHistory(h);
  }, []);
  const currentRef = useRef(snap);
  const flagRef = useRef<{ label?: string } | null>(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    const prev = currentRef.current;
    if (prev.sections === snap.sections && prev.groups === snap.groups && prev.vendorQuotes === snap.vendorQuotes) return;
    currentRef.current = snap;
    if (applyingRef.current) {
      applyingRef.current = false;
      flagRef.current = null;
      return;
    }
    const flag = flagRef.current;
    flagRef.current = null;
    const edited = !!flag || prev.groups !== snap.groups || (prev.vendorQuotes !== snap.vendorQuotes && snap.vendorQuotes !== serverVendorQuotes.current);
    if (edited) write(recordEdit(historyRef.current, prev, snap, Date.now(), flag?.label));
  }, [snap, serverVendorQuotes, write]);

  const undo = useCallback(() => {
    const res = takeUndo(historyRef.current, currentRef.current);
    if (!res) return;
    applyingRef.current = true;
    write(res.next);
    apply(res.restore);
  }, [apply, write]);
  const redo = useCallback(() => {
    const res = takeRedo(historyRef.current, currentRef.current);
    if (!res) return;
    applyingRef.current = true;
    write(res.next);
    apply(res.restore);
  }, [apply, write]);

  // ⌘Z / ⇧⌘Z outside text fields: a text field keeps the browser's own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (isTextTarget(e.target) || dialogOpen()) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const flagEdit = useCallback((label?: string) => {
    applyingRef.current = false;
    flagRef.current = { label: label ?? flagRef.current?.label };
  }, []);
  const clearHistory = useCallback((opts?: { pendingChange?: boolean }) => {
    flagRef.current = null;
    applyingRef.current = !!opts?.pendingChange;
    write(emptyUndoHistory());
  }, [write]);
  const mapHistory = useCallback((fn: (sections: SpecSection[]) => SpecSection[]) => write(mapSnapshots(historyRef.current, fn)), [write]);

  return useMemo(
    () => ({
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      undoLabel: history.past[history.past.length - 1]?.label ?? null,
      redoLabel: history.future[0]?.label ?? null,
      undo,
      redo,
      flagEdit,
      clearHistory,
      mapHistory,
    }),
    [history, undo, redo, flagEdit, clearHistory, mapHistory]
  );
}
```

- [ ] **Step 4: Wire it**

In `use-estimator-state.ts`, import `useEstimateUndo, type EstimateUndoApi` from `./use-estimate-undo`. Beside `liveRef`:

```ts
  const undoRef = useRef<EstimateUndoApi | null>(null);
```

In `setSections`, add `undoRef.current?.flagEdit();` beside the `markEdit` call.

In `applyTierStamp`, inside `if (res.sections !== before)`, add `undoRef.current?.flagEdit("re-priced");`. In `undoTierReprice`, add `undoRef.current?.flagEdit("re-priced");`.

In `reapplyAutoFreight`, after the `setTierReprice` line:

```ts
      undoRef.current?.mapHistory((ss) => applyAutoFreight(ss, { pct: fd.pct }));
```

In the Move action, after `setMoveNotice({ ok: true, … })` (line 2018), and in `moveLinesToEstimate`, after its `setMoveNotice({ ok: true, … })` (line 2168), add:

```ts
        // It now lives on another estimate: undoing would leave it on both.
        undoRef.current?.clearHistory({ pendingChange: true });
        setActionNotice("Undo history was cleared, because that work now lives on another estimate.");
```

After the `const saveNow` block from Task 5:

```ts
  const undoSnap = useMemo(() => ({ sections, groups, vendorQuotes }), [sections, groups, vendorQuotes]);
  const undo = useEstimateUndo({
    snap: undoSnap,
    serverVendorQuotes: serverVendorQuotesRef,
    apply: (s) => {
      setTierReprice(null);
      setSectionsState(s.sections);
      setGroups(s.groups);
      setVendorQuotes(s.vendorQuotes);
      liveRef.current?.markEdit();
    },
  });
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);
  // A status change or anything that changes the lock on prices: Undo must not restore prices #368 forbids.
  const undoStatusRef = useRef(baseStatus);
  useEffect(() => {
    if (undoStatusRef.current === baseStatus) return;
    undoStatusRef.current = baseStatus;
    undoRef.current?.clearHistory();
  }, [baseStatus]);
```

`apply` is a fresh closure every render, but `useEstimateUndo`'s `undo` lists it as a dependency. Wrap it with `useCallback` over only the stable setters, with `setTierReprice`, `setSectionsState`, `setGroups`, `setVendorQuotes` and `liveRef` (all stable), so the `undo` function and the keydown listener stay stable.

The source pin needs three `clearHistory` call sites: the two moves and the status effect. Add `undo,` to the returned object.

- [ ] **Step 5: Run the tests, typecheck, lint and build**

Run: `npx tsx scripts/test-estimate-live-save.ts && npx tsc --noEmit && npx eslint "src/app/(app)/estimator/use-estimate-undo.ts" "src/app/(app)/estimator/use-estimator-state.ts" && npx next build`
Expected: `… PASS, 0 FAIL`, no errors, a green build.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/use-estimate-undo.ts" "src/app/(app)/estimator/use-estimator-state.ts" scripts/test-estimate-live-save.ts
git commit -m "feat(estimator): Undo and Redo across lines, systems and groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The chip, the buttons, the banner and the PDF steps

**Files:**
- Create: `src/app/(app)/estimator/live-save-chip.tsx`
- Create: `src/lib/estimate-live-save/copy.ts`
- Modify: `src/app/(app)/estimator/estimator-header.tsx` (Save button at lines 285–311)
- Modify: `src/app/(app)/estimator/estimator-banners.tsx`
- Modify: `src/app/(app)/estimator/estimator-client.tsx`
- Modify: `src/app/(app)/estimator/steps/package-bom-tab.tsx` (line 201)
- Modify: `src/app/(app)/estimator/steps/package-narrative-tab.tsx` (line 335)
- Modify: `scripts/test-estimate-live-save.ts`

**Interfaces:**
- Consumes: `s.liveMode`, `s.live`, `s.undo`, `s.contentUnsaved`, `s.pdfDirty`, `s.pdf`, `s.setPdf`, `s.saveNow`, `s.loadedId` from the state hook.
- Produces, from `live-save-chip.tsx`: `LiveSaveChip`, `UndoRedoButtons`, `LiveConflictBanner`. From `src/lib/estimate-live-save/copy.ts`: `chipLabel(status)`, `conflictMessage(conflict)`, `LIVE_COPY`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-estimate-live-save.ts`:

```ts
import { chipLabel, conflictMessage, LIVE_COPY } from "../src/lib/estimate-live-save/copy";
```

and to `liveSavePureChecks`:

```ts
  // copy
  ok(chipLabel("saved") === "Saved ✓" && chipLabel("saving") === "Saving…" && chipLabel("dirty") === "Saving…", "chip: saved and saving");
  ok(chipLabel("failed") === "Not saved — Retry" && chipLabel("refused") === "Not saved", "chip: failed and refused");
  ok(conflictMessage({ by: "Isaac", at: null }).includes("saved by Isaac"), "banner: names who saved");
  ok(conflictMessage({ by: null, at: null }) === LIVE_COPY.changedElsewhere, "banner: no name is the plain sentence");
  // Wiring
  const clientSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/estimator-client.tsx"), "utf8");
  ok(clientSrc.includes("s.live.flush()"), "steps: a step change flushes the live save");
  ok(clientSrc.includes("retryQuotePdfAction("), "steps: an out-of-date stored PDF renders on Customer review and Send");
  ok(clientSrc.includes("if (s.live.edited) void s.saveNow()"), "steps: stepping in only saves after a real edit — opening never writes");
  const bomSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/steps/package-bom-tab.tsx"), "utf8");
  ok(bomSrc.includes("contentUnsaved && <span"), "hints: the BOM tab's Save first reads contentUnsaved");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-estimate-live-save.ts`
Expected: FAIL, cannot find module `copy`.

- [ ] **Step 3: Write the copy and the components**

Create `src/lib/estimate-live-save/copy.ts`:

```ts
/** Estimator live save — the words (pure, client-safe). */
import type { LiveConflict, LiveStatus } from "./scheduler";

export const LIVE_COPY = {
  changedElsewhere: "This estimate changed somewhere else.",
  reload: "Reload",
  keepMine: "Keep mine",
  reloadHint: "Reload drops the changes in this window that aren't saved yet.",
  keepMineHint: "Keep mine replaces what was saved elsewhere with this window's version.",
  historyEmpty: "Nothing to undo",
  redoEmpty: "Nothing to redo",
};

export function chipLabel(status: LiveStatus): string {
  if (status === "saved") return "Saved ✓";
  if (status === "failed") return "Not saved — Retry";
  if (status === "refused" || status === "conflict") return "Not saved";
  return "Saving…";
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

export function conflictMessage(c: LiveConflict): string {
  if (!c.by) return LIVE_COPY.changedElsewhere;
  return `This estimate changed somewhere else — saved by ${c.by}${c.at ? ` at ${timeOf(c.at)}` : ""}.`;
}
```

Create `src/app/(app)/estimator/live-save-chip.tsx`:

```tsx
"use client";

import { chipLabel, conflictMessage, LIVE_COPY } from "@/lib/estimate-live-save/copy";
import type { LiveSaveApi } from "./use-live-save";
import type { EstimateUndoApi } from "./use-estimate-undo";

const CHIP = { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 8, padding: "9px 15px" } as const;

/** Replaces Save on a live-save estimate. Clicking it saves now, or retries a failed save. */
export function LiveSaveChip({ live }: { live: LiveSaveApi }) {
  const { status, refusal } = live;
  const bad = status === "failed" || status === "refused" || status === "conflict";
  const clickable = status === "dirty" || status === "failed";
  return (
    <button
      type="button"
      data-testid="live-save-chip"
      data-status={status}
      title={refusal ?? undefined}
      disabled={!clickable}
      onClick={() => (status === "failed" ? live.retryNow() : void live.flush())}
      style={{
        ...CHIP,
        cursor: clickable ? "pointer" : "default",
        ...(bad ? { background: "#3a2422", color: "#f0a59b" } : status === "saved" ? { background: "#22361f", color: "#5fd29a" } : { background: "#2b2e35", color: "#cfd3da" }),
      }}
    >
      {chipLabel(status)}
    </button>
  );
}

const ICON = { ...CHIP, padding: "9px 11px", background: "#2b2e35", color: "#cfd3da" } as const;

export function UndoRedoButtons({ undo }: { undo: EstimateUndoApi }) {
  return (
    <>
      <button
        type="button"
        data-testid="est-undo"
        aria-label="Undo"
        disabled={!undo.canUndo}
        onClick={undo.undo}
        title={undo.undoLabel ? `Undo: ${undo.undoLabel}` : LIVE_COPY.historyEmpty}
        style={{ ...ICON, opacity: undo.canUndo ? 1 : 0.45, cursor: undo.canUndo ? "pointer" : "not-allowed" }}
      >
        ↶
      </button>
      <button
        type="button"
        data-testid="est-redo"
        aria-label="Redo"
        disabled={!undo.canRedo}
        onClick={undo.redo}
        title={undo.redoLabel ? `Redo: ${undo.redoLabel}` : LIVE_COPY.redoEmpty}
        style={{ ...ICON, opacity: undo.canRedo ? 1 : 0.45, cursor: undo.canRedo ? "pointer" : "not-allowed" }}
      >
        ↷
      </button>
    </>
  );
}

export function LiveConflictBanner({ live }: { live: LiveSaveApi }) {
  if (!live.conflict) return null;
  return (
    <div role="alert" data-testid="live-conflict" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "9px 16px", background: "#fdecea", color: "#7a2e24", fontSize: 13 }}>
      <span style={{ flex: "1 1 280px" }}>{conflictMessage(live.conflict)}</span>
      <button type="button" data-testid="live-conflict-reload" title={LIVE_COPY.reloadHint} onClick={live.reload} style={{ fontWeight: 600, cursor: "pointer" }}>{LIVE_COPY.reload}</button>
      <button type="button" data-testid="live-conflict-keep" title={LIVE_COPY.keepMineHint} onClick={live.keepMine} style={{ fontWeight: 600, cursor: "pointer" }}>{LIVE_COPY.keepMine}</button>
    </div>
  );
}
```

Match the surrounding style objects if the file's existing banners use a shared one; don't add accent-colored hardcodes.

- [ ] **Step 4: Wire the header, banners and hints**

In `estimator-header.tsx`, add `liveMode, live, undo,` to the destructure and import `LiveSaveChip, UndoRedoButtons` from `./live-save-chip`. Wrap the Save `<button>` at lines 285–311:

```tsx
          <UndoRedoButtons undo={undo} />
          {liveMode ? (
            <LiveSaveChip live={live} />
          ) : (
            <button
              type="button"
              onClick={doSave}
              /* …the existing attributes, style and children, unchanged… */
            >
              {justSaved ? "Saved ✓" : "Save"}
            </button>
          )}
```

Keep the button's existing attributes exactly. The `{/* #284 … */}` next-step control stays after it.

In `estimator-banners.tsx`, import `LiveConflictBanner`, add `live` to the destructure, and render `<LiveConflictBanner live={live} />` as the first child of the banners' returned fragment. A conflict can happen on Sent, Won and Lost too, because the manual Save is checked, and this banner shows in all of them.

In `steps/package-bom-tab.tsx`, add `contentUnsaved` to the destructure (line 97) and change line 201 to:

```tsx
              {contentUnsaved && <span style={{ color: "#8a6d1f" }}>{BOM_TAB_COPY.saveFirst}</span>}
```

Leave the other `pdfDirty` uses in this file alone unless `tsc` reports the name as unused, in which case remove it from the destructure.

In `steps/package-narrative-tab.tsx`, add `contentUnsaved` to the destructure and change line 335 to `dirty={contentUnsaved}`. Line 343's `beforeGrid={pdfDirty ? saveNow : undefined}` stays: the Grid tray reads the stored quote, and a rendering save is harmless there.

- [ ] **Step 5: Wire the steps**

In `estimator-client.tsx`, import `useRef` and `retryQuotePdfAction` from `@/app/(app)/quotes/pdf-actions`. Change `goStep`:

```ts
  const goStep = (to: EstimateStep) => {
    if (to === step) return;
    void s.live.flush();
    window.history.pushState(null, "", window.location.pathname + stepSearch(window.location.search, to));
  };
```

Add, after the existing URL effect:

```ts
  // Customer review and Send & track show and send the rendered PDF. A live save only marks it out of date, so render it
  // on the way in: a save that renders when the screen is ahead of it, a plain render when it's out of date from before a reload.
  const renderAskedRef = useRef<string | null>(null);
  const needsPdf = !!s.loadedId && (step === "review" || step === "send") && s.liveMode;
  useEffect(() => {
    if (!needsPdf) {
      renderAskedRef.current = null;
      return;
    }
    if (s.pdfDirty) {
      // Only after a real edit: load-time derived changes can read as dirty too, and opening must never write (a phone opens straight on review).
      if (s.live.edited) void s.saveNow();
      return;
    }
    if (s.pdf && !s.pdf.outOfDate) return;
    // Once per visit: a failed render shows its own Retry in the preview.
    if (renderAskedRef.current === s.loadedId) return;
    renderAskedRef.current = s.loadedId;
    void retryQuotePdfAction(s.loadedId as string).then((view) => {
      if (view) s.setPdf(view);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPdf, s.pdfDirty, s.pdf, s.loadedId, s.live.edited]);
```

Check `s.setPdf` is returned by the hook (`review-tabs.tsx:51` destructures it). Confirm the `PackageStep`'s internal `?ptab=` changes don't call `goStep`, so a tab switch inside Build package doesn't need a flush; the debounce covers it.

- [ ] **Step 6: Run the tests, typecheck, lint and build**

Run: `npx tsx scripts/test-estimate-live-save.ts && npx tsc --noEmit && npx eslint "src/app/(app)/estimator" && npx next build`
Expected: `… PASS, 0 FAIL`, no errors, a green build.

- [ ] **Step 7: Commit**

```bash
git add src/lib/estimate-live-save/copy.ts "src/app/(app)/estimator" scripts/test-estimate-live-save.ts
git commit -m "feat(estimator): live save chip, Undo buttons, conflict banner and PDF on the way into review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser verification, full gate and docs

**Files:**
- Modify: `AGENTS.md`, `DECISIONS.md`, `PUNCHLIST.md`, `MASTER-HOWTO.md` (the Estimator section, if it describes Save)
- Create only if the browser check finds bugs: fixes with their own tests.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Prepare a scratch dev server**

Follow memory notes `peak-worktree-dev-server-browser-verification-traps` and `peak-preview-start-reads-main-checkout-launch-json`. Copy `.env.local` from the main checkout, and don't click any upload (`peak-dev-server-always-loads-real-blob-token`). Add a config to the **main** checkout's `.claude/launch.json` for this worktree, on a free port, with `PGLITE_PATH` pointing at a new scratch directory and `AUTH_DEV_LOGIN=true`. Run `npm run db:seed` against that same `PGLITE_PATH` first, then stop it. Check `ps aux | grep tsx` is clean. Remove the launch entry when done.

- [ ] **Step 2: Walk the checks and record real results**

Use the built-in browser. For each, record what happened. Verify state with JS rather than trusting screenshots, since the pane's screenshots can lag.

1. Open a seeded draft. Read `updatedAt` with `get` via a follow-up page load or the Quotes hub date. Wait 5 s. Confirm no save ran: the chip stays `Saved ✓`, and no `saveQuoteAction` POST appears in `read_network_requests`.
2. Change a quantity and tab out. The chip goes `Saving…` then `Saved ✓` in about 2 s. Reload with no warning. The change is there.
3. Change a quantity and reload within 1 s. The browser warns.
4. Change a quantity and click a nav link within 1 s. Come back. The change is there.
5. `/estimator` with a new estimate: add a catalog line. An id appears in the URL, an estimate number in the header, and a reload reopens it. Rename the system before adding a line on a second new estimate: no save, no id.
6. Delete a line. Undo restores it. Redo removes it again. ⌘Z and ⇧⌘Z do the same with focus on the page. With focus in the system name input, ⌘Z does not touch the lines. Press + three times quickly: one Undo reverses all three.
7. Delete a whole system with lines. Undo restores it, and the reload shows it stored.
8. Add a vendor quote line with no attachment, × it, Undo: the vendor line and its record come back and save.
9. Change the customer so the tier re-prices: one Undo step labelled "re-priced"; the banner's Undo still works.
10. Pick a venue that changes auto freight after a line edit, then Undo the line edit: freight stays at the new value.
10a. On a new estimate, type a quote note and add the first line within 500 ms of each other. After the id lands and a reload, the note is there.
11. Move a system to another estimate: Undo is disabled afterwards, and both estimates are right after reload.
12. Open the same draft in a second tab. Edit in tab A, wait for `Saved ✓`. Edit in tab B. Tab B shows the banner with the user's name and time, and no write landed. **Reload** shows A's edit. Repeat: **Keep mine** replaces it and tab B's chip returns to `Saved ✓`. Now A's next edit raises the banner in A.
13. Change a header field (the quote note) in tab A while B is open. Edit a line in B: no banner, and A's note survives.
14. Stop the dev server and edit: `Not saved — Retry`, and the edit stays on screen. Restart the server: it saves on the next retry, or on pressing the chip.
15. On a new estimate with the server stopped, add a line: `Not saved — Retry`, and no retry happens by itself. After restart, pressing it creates exactly one quote (check the Quotes hub).
16. A box sale: add a labor line through the existing path that allows it, or switch an estimate with labor to box sale. The chip reads `Not saved` with the reason as a tooltip. Remove the labor: it saves.
17. Mark a draft Sent through the existing path: the header shows **Save** and no chip. Edit a line: nothing saves until Save is pressed. Undo works on screen. History was cleared by the status move.
18. A `portal-catalog` draft (seed one or create via the portal flow): shows **Save**.
19. Step a draft with fresh edits to Customer review. `pdfDirty` clears through `saveNow`, and the preview shows a rendering state, then the document (needs Chrome; if `QUOTE_PDF_ORIGIN` or Chrome isn't available locally, record that and confirm the `failed` state shows its Retry rather than a stale "ready").
20. Reload a draft whose PDF is out of date from a live save, on Build. Step to Send & track. A render is requested once.
21. Open the BOM tab with no pending edits after a live save: no "Save first" hint. Edit and look within 1 s: the hint shows, and clears when saved.
22. A pop-out of the estimate beside the main window (⧉): `Open in main window` works when the chip reads `Saved ✓`.

Fix anything that fails, with a test where the harness can hold it, and re-run that check.

- [ ] **Step 3: Run the full gate**

Run each and record the real numbers (memory `peak-verification-gate-protocol`):

```bash
npx tsc --noEmit
```

```bash
npm run test:specs
```

```bash
npm run test:smoke
```

```bash
npx eslint
```

```bash
npx next build
```

Expected: no type errors; `ALL PASSED` from `test:specs` with the base count plus this harness's new checks; smoke green; no lint errors; a green build. Then check `df -h /private/tmp` and clear stale `tmp.*` PGlite directories per memory `peak-temp-pglite-dirs-fill-disk`, only ones this work created.

- [ ] **Step 4: Write the docs**

Recompute the numbers right before writing (memory `project-peak-two-sessions-on-main-merge-hazard`): `git fetch origin && git show origin/main:DECISIONS.md | grep -n '^## D' | tail -1`, and check `git show origin/main:PUNCHLIST.md` for the last `#` plus the open `feat/373-pipe-lineset` branch, which holds #373.

- `DECISIONS.md`: entries for live save scope and the limited patch; the change key instead of `updatedAt`; `pdfDirty`'s narrower meaning and render-on-the-way-in; no automatic retry on create; Undo's coverage and what clears history; portal quotes excluded.
- `PUNCHLIST.md`: an entry with what was built, tests, Rollback ("safe; `lastSavedBy` is optional JSON older code ignores"), and Jeff's real-use checks from the spec.
- `AGENTS.md`: a numbered phase under "Phase status", in the same style as its neighbours, naming `src/lib/estimate-live-save/`, `use-live-save.ts`, `use-estimate-undo.ts`, what remains Jeff-gated, and the punch item. The `.env.example` is unchanged.
- `MASTER-HOWTO.md`: if the Estimator section tells people to press Save on a draft, update it. Check with `grep -n "Save" MASTER-HOWTO.md | head -30`.
- The memory index is written by the controller at the end, not by a subagent.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md DECISIONS.md PUNCHLIST.md MASTER-HOWTO.md
git commit -m "docs(estimator): live save + Undo decisions, punch item, phase status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Stage any fix files from Step 2 in their own earlier commits.
