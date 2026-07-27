# Consulting Plan 06 — Six-Stage Lifecycle + Proposal Builder Rebuild Implementation Plan (#35/#25)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Consulting module around the spec §1 redefinition (Peak as a **specifier**: paid to design and write the spec, the job goes out to bid, Peak may bid its own spec, the engagement ends when construction admin ends). **Lifecycle:** the 4-status vocabulary (`active/delivered/bid_supported/oversight_complete`) becomes six explicit stages — **Proposal sent → Awarded → Design → Out to bid → Construction admin → Closed** — with **lazy migration** (stored legacy literals map on read, upgrade on next write, nothing rewritten in bulk) and ONE open-definition (`isOpenEngagement` = any stage before Closed, the D113 item-11 carry-over) replacing today's three divergent copies. **Spawn model:** engagements are born when a consulting quote is **SENT** (at `proposal_sent`), advance to `awarded` on won, and close (with a "Proposal lost" decision entry) when a still-proposal_sent quote is lost — replacing today's won-only spawn. **Proposal builder (#35):** structured **scopes** (title + description + fee; total assembles from scope fees), a Settings-editable **assumptions checklist** (visitReasons pattern; ticked texts frozen per proposal; DRAFT seed pending Jeff's real letter), **auto-lead with dedupe** on proposal create (new `"consulting"` LeadSource), a **minimal architect** reference on the engagement, install-quote **link validation + live status chips both ways** (engagement ↔ quote), and the `consulting_proposal` letter rendering per-scope lines + assumption bullets (new additive `assumptionsLead` template field). **#25:** sweep the remaining user-facing "Engagement(s)" module-name strings to "Consulting" (nav already reads "Consulting" since the D117 rebrand — verified `nav-data.ts:71`); URLs and internal keys unchanged. Spec authority: `docs/superpowers/specs/2026-07-25-remaining-items-decisions-design.md` §1 + PUNCHLIST #35/#25 (Jeff: "just the name change" on #25; all #35 sub-decisions A–E answered by spec §1). The 2026-07-19 consulting spec/plan predate the §1 redefinition — historical background only.

**Architecture:** One new **dependency-free value module** `src/lib/consulting-stages.ts` (the tabs.ts / consulting-review.ts client-safety lesson: ZERO imports, so the "use client" view, the server store, and the spec harness can all VALUE-import it): ordered stage defs `{key, label, tone}` (tone = MONDAY_TONE key for the house `StatusPill`), `LEGACY_STATUS_MAP` (complete over all four old literals), `normalizeEngagementStatus` (unknown → `"design"`), `isOpenEngagement`, the pure spawn-rule `engagementSyncAction(quoteStatus, currentStage)`, the pure proposal helpers (`ConsultingScope`, `scopesTotal`, `milestoneSeeds`), and the assumptions library (`DEFAULT_CONSULTING_ASSUMPTIONS` + `mergedConsultingAssumptions`, the mergedVisitReasons idiom). The store keeps its shape: `EngagementStatus` becomes an alias of the six-literal `EngagementStage`, `ENGAGEMENT_STATUS_LABEL` is **re-exported under its old name** so consumers (`design/page.tsx:78`, venues humanizer) survive untouched; every store read path normalizes, `patchEngagement` upgrades the stored literal on the doc's next write. `venue-match.ts` stays **zero-import** by design — its `OPEN_STAGES.engagement` array is updated by hand and the spec harness pins the two modules in agreement. The spawn model funnels through `syncEngagementsFromQuotes` (rebuilt over `engagementSyncAction`, still the fifth idempotent sync in the on-win fan-out) plus a new `ensureEngagementForQuote(quoteId, minStage)` hooked into `setQuoteStatus` on sent; `loadConsultingData` runs the sweep as the safety net (the `projects/data.ts:23` idiom — estimator/inbox status paths never run syncs). `ConsultingQuotePayload` grows additive optional fields (`scopes`, `assumptions`, `leadId`); legacy `scope`/`feeMode`/`fees` stay on the type so pre-rebuild quotes render read-only. Reports billing forecast reads milestones only (`reports/page.tsx:900-921`) and filters `targetDate > 0` — scope-seeded milestones land with `targetDate 0`, so the forecast is **unaffected by construction**.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle + PGlite/Postgres (jsonb doc-store — engagements are `consulting_engagements` docs, CE-#### base 1000, NOT in `SYNCABLE_COLLECTIONS`, stays that way), hand-rolled `tsx` test harness.

## Global Constraints

- **Branch:** `consulting-rebuild` off `main` (wave ① merged at `3d24890`).
- **No migrations, no schema changes:** everything lives in existing jsonb docs (`consulting_engagements`, `quotes`, `leads`, `app_settings`). Status relifecycle is **lazy**: reads normalize via `LEGACY_STATUS_MAP`, `patchEngagement` rewrites the literal on a doc's next write — there is NO bulk rewrite pass.
- **Client-bundle rule:** `consulting-stages.ts` has **ZERO imports of any kind** — it is client-bundled (view.tsx, controls.tsx value-import it), server-trusted (store + actions import it), and harness-imported (no DB). `view.tsx`/`controls.tsx` are `"use client"` and may value-import ONLY `consulting-stages`, `consulting-review` (pure), and UI components — never the store. `venue-match.ts` keeps its documented zero-import constraint: the engagement open-stage list is duplicated there **on purpose** and pinned by a spec test.
- **Server actions:** every mutation behind `requireUser()`; the settings save behind `requirePerm("manage_users")` (the saveVisitReasonsAction idiom). `setEngagementStatusAction` gains a stage-key **allowlist** (it was unvalidated — hardening while touching, brief instruction).
- **Additive template fields only:** the new `assumptionsLead` field is added to `TEMPLATES` **first** — `saveTemplateAction` discards unknown field ids, and field ids are override keys (adding is safe, renaming orphans stored overrides).
- **Export-name compatibility:** `ENGAGEMENT_STATUS_LABEL` keeps its name (re-exported from the new module through `stores/engagements.ts`); `EngagementStatus` remains exported as a type alias of `EngagementStage`; `isOpenEngagement` remains importable from `@/lib/consulting-review` (re-export). Zero forced consumer churn outside the files this plan edits.
- **Tests:** append to `scripts/test-review-and-spec.ts` (single-file harness, **540 PASS baseline — verified by running it**), new sections inserted immediately BEFORE the final two lines (`console.log(fail ? …)` / `process.exit(…)`). Exact-literal, no DB (pure-module imports only). **Stale-literal grep done at authoring time:** the ONLY engagement-STATUS literals pinned in the harness are lines **942-946** (the D113.11 `isOpenEngagement` block — updated exact-literal in Task 1; they keep passing through normalization, and the messages are rewritten to say so). Line 67's `status: "active"` is an **EngagementPhase** status (different vocabulary, untouched); line 267 pins a nav key, not a status. The suite count goes UP, never down. Run: `npm run test:specs`. Typecheck: `npx tsc --noEmit`. Both gates per task.
- **Lint:** `npm run lint` baseline is **73 errors + 1618 warnings (verified by running it)** — net-zero goal, any delta explained in the final report.
- **Never run `npm run build` while a dev server is running** (PGlite is single-process, D106). Tasks 1–5 may keep the dev server on :3000 up for live checks; Task 6 kills it before the build and restarts after.
- **URLs unchanged:** `/design/engagements/**` routes, nav `key: "engagements"`, and the `consulting_engagements` collection name all stay (#25 is display text only).
- **NOT in scope** (later waves / Jeff homework): remapping `consulting_proposal` to Peak's REAL letter (spec §1 Homework 1 — the DRAFT assumptions seed and existing template wording are placeholders Jeff replaces; flagged in the PUNCHLIST close-out); the estimator's shared assumptions/exceptions model (spec §4, wave ③ — `consultingAssumptions` + `mergedConsultingAssumptions` is the seam it will consume); migrating architect into item 20's people/roles model (the field is deliberately dumb `{company, contact}` strings); quote attachments (#36-C); any PDF path (letters stay HTML + `window.print`); phases/reviews machinery (`setPhaseStatus` gate at `engagements.ts:802-825` untouched).

---

### Task 1: `src/lib/consulting-stages.ts` + store relifecycle + ONE open-definition + all literal consumers (TDD)

**Files:**
- Create: `src/lib/consulting-stages.ts`
- Modify: `src/lib/stores/engagements.ts` (type swap, normalize-on-read, upgrade-on-write, label re-export), `src/lib/consulting-review.ts` (delegate `isOpenEngagement`), `src/lib/venue-match.ts` (OPEN_STAGES.engagement), `src/app/(app)/design/engagements/view.tsx` (dup maps → imports, 6-stage select), `src/app/(app)/design/grid/[id]/page.tsx` (inline check → import), `src/app/(app)/design/engagements/actions.ts` (status allowlist)
- Test: `scripts/test-review-and-spec.ts` (update the stale D113.11 block + append the `CONSULTING REBUILD` section)

**Interfaces (later tasks rely on these exact names):** `type EngagementStage`, `type EngagementStageDef`, `ENGAGEMENT_STAGES`, `ENGAGEMENT_STAGE_KEYS`, `OPEN_ENGAGEMENT_STAGES`, `ENGAGEMENT_STATUS_LABEL`, `ENGAGEMENT_STAGE_TONE`, `LEGACY_STATUS_MAP`, `normalizeEngagementStatus(raw)`, `stageIndex(k)`, `isOpenEngagement(e)`.

- [ ] **Step 1: Write the failing tests**

FIRST, update the stale exact-literal block at `scripts/test-review-and-spec.ts:942-946` in place (the old literals keep passing through normalization — the messages now say what they actually test):

```ts
/* --- engagements stay open until Closed (D113.11 carried into the
   six-stage lifecycle, spec §1). The legacy literals below exercise
   normalizeEngagementStatus through isOpenEngagement. --- */
import { isOpenEngagement } from "@/lib/consulting-review";
ok(isOpenEngagement({ status: "active" }) && isOpenEngagement({ status: "delivered" }) && isOpenEngagement({ status: "bid_supported" }),
  "legacy active/delivered/bid_supported map to open stages");
ok(!isOpenEngagement({ status: "oversight_complete" }), "legacy oversight_complete maps to closed");
```

THEN append the new section immediately before the final two lines (`console.log(fail ? …)` / `process.exit(…)`). NOTE: `isOpenEngagement` (line 943) and `isOpenStage` (line 467) are already imported earlier in this module-scoped file — do NOT re-import them:

```ts
/* ============ CONSULTING REBUILD (#35/#25 — spec §1, D123) ============ */
/* Six-stage lifecycle. Pure module, exact literals, no DB. */
import {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_KEYS,
  ENGAGEMENT_STATUS_LABEL as CONSULTING_STAGE_LABEL,
  LEGACY_STATUS_MAP,
  normalizeEngagementStatus,
  OPEN_ENGAGEMENT_STAGES,
  stageIndex,
} from "@/lib/consulting-stages";

{
  ok(
    ENGAGEMENT_STAGE_KEYS.join(",") ===
      "proposal_sent,awarded,design,out_to_bid,construction_admin,closed",
    "#35: six stages, in lifecycle order (spec §1)"
  );
  ok(
    ENGAGEMENT_STAGES.map((s) => CONSULTING_STAGE_LABEL[s.key]).join(" → ") ===
      "Proposal sent → Awarded → Design → Out to bid → Construction admin → Closed",
    "#35: stage labels match the spec ladder verbatim"
  );
  ok(stageIndex("awarded") === 1, "#35: stageIndex pins ladder position (ordering only, never a gate)");

  // Legacy mapping — COMPLETE over the old 4-status vocabulary
  ok(normalizeEngagementStatus("active") === "design", "#35: legacy active → design");
  ok(normalizeEngagementStatus("delivered") === "out_to_bid", "#35: legacy delivered → out_to_bid");
  ok(
    normalizeEngagementStatus("bid_supported") === "construction_admin",
    "#35: legacy bid_supported → construction_admin"
  );
  ok(
    normalizeEngagementStatus("oversight_complete") === "closed",
    "#35: legacy oversight_complete → closed"
  );
  ok(
    Object.keys(LEGACY_STATUS_MAP).sort().join(",") ===
      "active,bid_supported,delivered,oversight_complete",
    "#35: the legacy map covers exactly the four old literals — no more, no fewer"
  );
  ok(
    ENGAGEMENT_STAGE_KEYS.every((k) => normalizeEngagementStatus(k) === k),
    "#35: new stage keys pass through normalization untouched"
  );
  ok(
    normalizeEngagementStatus("???") === "design",
    "#35: unknown statuses land on design (safe middle of the ladder)"
  );

  // D113 item-11 carry-over: every pre-closed stage counts as open
  ok(
    OPEN_ENGAGEMENT_STAGES.length === 5 &&
      OPEN_ENGAGEMENT_STAGES.every((s) => isOpenEngagement({ status: s })),
    "#35: all five pre-closed stages count as open (D113.11 carries over)"
  );
  ok(!isOpenEngagement({ status: "closed" }), "#35: closed is the only closed stage");

  // venue-match duplicates the open list on purpose (zero-import module) —
  // pin the two modules in agreement so they can never drift apart.
  ok(
    OPEN_ENGAGEMENT_STAGES.every((s) => isOpenStage("engagement", s)) &&
      !isOpenStage("engagement", "closed") &&
      !isOpenStage("engagement", "active"),
    "#35: venue-match OPEN_STAGES.engagement agrees with the stage module (and dropped the legacy literals)"
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs`
Expected: the run errors (module `@/lib/consulting-stages` does not exist yet).

- [ ] **Step 3: Create `src/lib/consulting-stages.ts`**

```ts
/**
 * Consulting lifecycle stages (spec §1 2026-07-25, D123) — the six-stage
 * ladder that replaced the 4-status vocabulary when Consulting was redefined
 * as a SPECIFIER role: Peak is paid to design and write the spec, the job
 * goes out to bid, Peak may bid its own spec, and the engagement ends when
 * construction admin ends.
 *
 * ZERO imports of any kind (the tabs.ts / consulting-review.ts lesson): this
 * module is client-bundled ("use client" views render the pills and the
 * stage <select>), server-trusted (the store normalizes and the actions
 * allowlist through it), and spec-tested (the harness imports it with no DB).
 *
 * Lazy migration: stored docs may still carry the old literals — every store
 * read path calls normalizeEngagementStatus, and patchEngagement upgrades
 * the stored value on the doc's next write. Nothing is bulk-rewritten.
 */

export type EngagementStage =
  | "proposal_sent"
  | "awarded"
  | "design"
  | "out_to_bid"
  | "construction_admin"
  | "closed";

/** tone is a MONDAY_TONE key — feeds the house StatusPill directly. */
export type EngagementStageDef = {
  key: EngagementStage;
  label: string;
  tone: string;
};

export const ENGAGEMENT_STAGES: readonly EngagementStageDef[] = [
  { key: "proposal_sent", label: "Proposal sent", tone: "orange" },
  { key: "awarded", label: "Awarded", tone: "purple" },
  { key: "design", label: "Design", tone: "blue" },
  { key: "out_to_bid", label: "Out to bid", tone: "darkblue" },
  { key: "construction_admin", label: "Construction admin", tone: "green" },
  { key: "closed", label: "Closed", tone: "gray" },
] as const;

export const ENGAGEMENT_STAGE_KEYS: readonly EngagementStage[] =
  ENGAGEMENT_STAGES.map((s) => s.key);

/** Every stage before Closed — the D113 item-11 rule's carrier. */
export const OPEN_ENGAGEMENT_STAGES: readonly EngagementStage[] =
  ENGAGEMENT_STAGE_KEYS.filter((k) => k !== "closed");

/** Keeps the pre-rebuild export name — consumers (design/page.tsx, venues
 *  humanizer fallbacks) import this exact identifier via stores/engagements. */
export const ENGAGEMENT_STATUS_LABEL: Record<EngagementStage, string> =
  Object.fromEntries(ENGAGEMENT_STAGES.map((s) => [s.key, s.label])) as Record<
    EngagementStage,
    string
  >;

export const ENGAGEMENT_STAGE_TONE: Record<EngagementStage, string> =
  Object.fromEntries(ENGAGEMENT_STAGES.map((s) => [s.key, s.tone])) as Record<
    EngagementStage,
    string
  >;

/** The old 4-status vocabulary, mapped onto the new ladder (spec §1:
 *  "Existing engagements map onto the new ladder"). COMPLETE by construction
 *  — the spec harness pins exactly these four keys. */
export const LEGACY_STATUS_MAP: Record<string, EngagementStage> = {
  active: "design",
  delivered: "out_to_bid",
  bid_supported: "construction_admin",
  oversight_complete: "closed",
};

/** New keys pass through; legacy keys map; anything else lands on "design"
 *  (the safe middle — visibly open, visibly mid-lifecycle). */
export function normalizeEngagementStatus(raw: string): EngagementStage {
  if ((ENGAGEMENT_STAGE_KEYS as readonly string[]).includes(raw)) {
    return raw as EngagementStage;
  }
  return LEGACY_STATUS_MAP[raw] ?? "design";
}

/** Position on the ladder (normalizes first) — ordering, never gating:
 *  stage transitions stay free-form via the header <select> (house style). */
export function stageIndex(k: string): number {
  return ENGAGEMENT_STAGE_KEYS.indexOf(normalizeEngagementStatus(k));
}

/**
 * THE open-engagement rule (D113 item 11 carried into the six-stage ladder,
 * spec §1): every stage before Closed counts as live work. Accepts raw
 * status strings so legacy docs and history rows work unchanged. The single
 * definition — consulting-review.ts re-exports it, venue-match's duplicate
 * list is spec-pinned in agreement, nothing else may restate the rule.
 */
export function isOpenEngagement(e: { status: string }): boolean {
  return normalizeEngagementStatus(e.status) !== "closed";
}
```

- [ ] **Step 4: Relifecycle the store — `src/lib/stores/engagements.ts`**

Replace the status block at lines 193-208 (`export type EngagementStatus = …` union + `ENGAGEMENT_STATUS_LABEL` const + the comment about consulting-review) with imports/re-exports:

```ts
import {
  normalizeEngagementStatus,
  type EngagementStage,
} from "@/lib/consulting-stages";

/* Six-stage lifecycle (spec §1, D123). Stored docs may still carry the old
 * 4-status vocabulary — every read below normalizes via LEGACY_STATUS_MAP
 * (lazy migration), and patchEngagement upgrades the literal on the doc's
 * next write. The label map keeps its historical export name so consumers
 * (design/page.tsx, venues) survive unchanged. The open-until-Closed rule
 * (D113 item 11) lives in lib/consulting-stages with the other pure stage
 * helpers — client components import it without dragging in the doc-store. */
export type EngagementStatus = EngagementStage;
export {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_KEYS,
  ENGAGEMENT_STAGE_TONE,
  ENGAGEMENT_STATUS_LABEL,
  LEGACY_STATUS_MAP,
  normalizeEngagementStatus,
} from "@/lib/consulting-stages";
export type { EngagementStage } from "@/lib/consulting-stages";
```

(Put the `import` beside the existing imports at the top of the file; the `export`/`export type` re-export lines replace the deleted block so `ConsultingEngagement.status: EngagementStatus` keeps compiling.)

Add the normalize helper and thread it through every read path:

```ts
/** Lazy migration (spec §1): stored legacy statuses surface as their mapped
 *  stage on every read; the doc itself upgrades on its next write. */
function normalizeEngagement(e: ConsultingEngagement): ConsultingEngagement {
  const s = normalizeEngagementStatus(String(e.status));
  return s === e.status ? e : { ...e, status: s };
}

export async function allEngagements(): Promise<ConsultingEngagement[]> {
  const list = await listDocs<ConsultingEngagement>("consulting_engagements");
  return list
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(normalizeEngagement);
}

export async function getEngagement(
  id: string
): Promise<ConsultingEngagement | null> {
  const e = await getDoc<ConsultingEngagement>("consulting_engagements", id);
  return e ? normalizeEngagement(e) : null;
}
```

`getEngagementByQuote` (line 422) normalizes its hit the same way:

```ts
export async function getEngagementByQuote(
  quoteId: string
): Promise<ConsultingEngagement | null> {
  const all = await listDocs<ConsultingEngagement>("consulting_engagements");
  const hit = all.find((e) => e.quoteId === quoteId) || null;
  return hit ? normalizeEngagement(hit) : null;
}
```

`patchEngagement` upgrades the stored literal on write (before the mutator runs, so a mutator that sets `d.status` itself wins):

```ts
export async function patchEngagement(
  id: string,
  mut: (d: ConsultingEngagement) => void
): Promise<void> {
  await patchDoc<ConsultingEngagement>("consulting_engagements", id, (d) => {
    // Lazy-migration write half: any write to a legacy-status doc upgrades
    // the stored literal to the mapped stage (reads already normalize).
    d.status = normalizeEngagementStatus(String(d.status));
    mut(d);
    d.updatedAt = Date.now();
  });
}
```

- [ ] **Step 5: ONE open-definition + the remaining literal consumers**

**`src/lib/consulting-review.ts`** — delete the `isOpenEngagement` function body (lines 40-49) and the now-unused `EngagementStatus` from the type-import list; re-export the single rule so every existing `@/lib/consulting-review` import keeps working:

```ts
/** The open-until-Closed rule (D113 item 11 carried into the six-stage
 *  lifecycle, spec §1) now lives in consulting-stages with the other pure
 *  stage helpers — re-exported here so existing imports keep working. */
export { isOpenEngagement } from "@/lib/consulting-stages";
```

**`src/lib/venue-match.ts:78-86`** — the `OPEN_STAGES.engagement` row currently reads `["active", "bid_supported"]` (it CONTRADICTS D113 today — this fixes it). This module is deliberately zero-import, so the list is duplicated by hand and the Task 1 spec test pins the agreement:

```ts
  // Six-stage consulting lifecycle (spec §1, D123) — every stage but
  // "closed" is open (D113.11). Duplicated from lib/consulting-stages ON
  // PURPOSE (this module's zero-import constraint, see header); the spec
  // harness pins the two lists in agreement.
  engagement: ["proposal_sent", "awarded", "design", "out_to_bid", "construction_admin"],
```

**`src/app/(app)/design/engagements/view.tsx`** — delete the duplicated `STATUS_TONE`/`STATUS_LABEL` maps (lines 60-71) and import the canonical ones (pure module — legal in this `"use client"` file):

```ts
import {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_TONE,
  ENGAGEMENT_STATUS_LABEL,
} from "@/lib/consulting-stages";
```

Both pill call sites (list card line 218, detail header line 322) become:

```tsx
<StatusPill tone={ENGAGEMENT_STAGE_TONE[e.status]}>{ENGAGEMENT_STATUS_LABEL[e.status]}</StatusPill>
```

(`eng.status` at the detail call site.) The header `<select>` (lines 323-334) stays free-form house-style, now over six stages:

```tsx
<select
  value={eng.status}
  onChange={async (ev) => {
    await setEngagementStatusAction(eng.id, ev.target.value as ConsultingEngagement["status"]);
    router.refresh();
  }}
  style={{ ...INPUT, padding: "5px 8px", fontSize: 12 }}
>
  {ENGAGEMENT_STAGES.map((s) => (
    <option key={s.key} value={s.key}>{s.label}</option>
  ))}
</select>
```

**`src/app/(app)/design/grid/[id]/page.tsx:57-61`** — the third divergent open-definition. Add `import { isOpenEngagement } from "@/lib/consulting-review";` and replace the inline check:

```ts
  const eng = project.customerId
    ? engagements.find(
        (e) => e.companyId === project.customerId && isOpenEngagement(e)
      )
    : undefined;
```

**`src/app/(app)/design/engagements/actions.ts:53-62`** — `setEngagementStatusAction` was unvalidated; add the allowlist (import `ENGAGEMENT_STAGE_KEYS` from `@/lib/consulting-stages`):

```ts
export async function setEngagementStatusAction(
  engId: string,
  status: EngagementStatus
) {
  await requireUser();
  // Hardening while touching (#35): the select only renders legal stages,
  // but server actions are public endpoints — allowlist the posted key.
  if (!(ENGAGEMENT_STAGE_KEYS as readonly string[]).includes(status)) {
    return { ok: false as const, error: "Unknown stage." };
  }
  await patchEngagement(engId, (d) => {
    d.status = status;
  });
  return done();
}
```

**Verified-no-change consumers** (the re-export keeps them compiling byte-identically — confirm, don't edit): `design/page.tsx:5,78` (`ENGAGEMENT_STATUS_LABEL[e.status] ?? e.status`); `venues/[id]/page.tsx:55-61` `humanizeStatus` is generic snake→sentence (renders "Proposal sent", "Out to bid" etc. correctly for the new keys — engagements arrive normalized from `allEngagements`); `venue-history-server.ts:138-142` builds engagement rows from `allEngagements()` + `isOpenStage("engagement", e.status)` — both halves updated above.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsc --noEmit && npm run test:specs`
Expected: clean typecheck; **ALL PASSED** with the suite count UP from 540.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: six-stage consulting lifecycle + one open-definition (#35 task 1, spec §1)"
```

---

### Task 2: Spawn model — sent → proposal_sent, won → awarded, lost → closed (TDD)

**Files:**
- Modify: `src/lib/consulting-stages.ts` (pure `engagementSyncAction`), `src/lib/stores/engagements.ts` (`fromQuote` stage param, `ensureEngagementForQuote`, sweep rebuild), `src/app/(app)/quotes/actions.ts` (sent/lost hooks), `src/app/(app)/design/engagements/data.ts` (safety-net sweep)
- Test: `scripts/test-review-and-spec.ts` (append to the CONSULTING REBUILD section)

**Interfaces:** `type EngagementSyncAction`, `engagementSyncAction(quoteStatus, currentStage)`, `ensureEngagementForQuote(quoteId, minStage)`; `createFromQuote` is DELETED (grep-verified: zero external callers — the only `createFromQuote` imports in the repo are the flame/inspection stores' own functions).

- [ ] **Step 1: Write the failing tests**

Append inside the CONSULTING REBUILD section (before the harness's final two lines):

```ts
/* --- #35 spawn model: the pure sweep rules (spec §1) --- */
import { engagementSyncAction } from "@/lib/consulting-stages";
{
  const j = (x: unknown) => JSON.stringify(x);
  ok(
    j(engagementSyncAction("sent", null)) === j({ kind: "create", stage: "proposal_sent" }),
    "#35: sent consulting quote with no engagement → create at proposal_sent"
  );
  ok(
    j(engagementSyncAction("won", null)) === j({ kind: "create", stage: "awarded" }),
    "#35: won with no engagement → create straight at awarded"
  );
  ok(
    j(engagementSyncAction("won", "proposal_sent")) === j({ kind: "advance", stage: "awarded" }),
    "#35: won advances proposal_sent → awarded"
  );
  ok(
    engagementSyncAction("won", "design") === null &&
      engagementSyncAction("won", "closed") === null,
    "#35: won never moves a stage a human already advanced past proposal_sent"
  );
  ok(
    j(engagementSyncAction("lost", "proposal_sent")) === j({ kind: "close", stage: "closed" }),
    "#35: lost while still proposal_sent → closed"
  );
  ok(
    j(engagementSyncAction("sent", "closed")) === j({ kind: "reopen", stage: "proposal_sent" }),
    "#35: re-sending a proposal after Proposal lost reopens the engagement to proposal_sent (deliberate reopen rule)"
  );
  ok(
    engagementSyncAction("lost", "design") === null,
    "#35: losing a later-stage engagement is a human call, never the sweep's"
  );
  ok(
    engagementSyncAction("draft", null) === null &&
      engagementSyncAction("sent", "design") === null &&
      engagementSyncAction("lost", null) === null,
    "#35: drafts spawn nothing; sent/lost are no-ops without work to do (idempotence)"
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs` — errors (`engagementSyncAction` not exported yet).

- [ ] **Step 3: The pure rule — append to `src/lib/consulting-stages.ts`**

Also encodes a deliberate reopen path: a lost proposal that's later re-sent (quote status back to `sent` while its engagement is still `closed`) reopens the engagement to `proposal_sent` instead of leaving it dead.

```ts
/* ---------- spawn model (spec §1) ---------- */

export type EngagementSyncAction =
  | { kind: "create"; stage: "proposal_sent" | "awarded" }
  | { kind: "advance"; stage: "awarded" }
  | { kind: "close"; stage: "closed" }
  | { kind: "reopen"; stage: "proposal_sent" }
  | null;

/**
 * What the quotes→engagements sweep should do for ONE consulting quote
 * (spec §1 spawn model), given the quote's status and the engagement's
 * current stage (null = no engagement yet):
 *   sent  → the engagement exists, at proposal_sent
 *   won   → the engagement exists; a proposal_sent record advances to
 *           awarded (a stage a human moved further is never touched)
 *   lost  → an engagement still at proposal_sent closes ("Proposal lost")
 *   sent (again), engagement closed → REOPEN to proposal_sent: a re-sent
 *           lost proposal picks the lifecycle back up rather than staying
 *           dead (the deliberate reopen rule)
 * Pure and total: every other combination is a no-op, so the sweep is
 * idempotent by construction — each branch converges on a fixed point.
 */
export function engagementSyncAction(
  quoteStatus: string,
  current: EngagementStage | null
): EngagementSyncAction {
  if (current === null) {
    if (quoteStatus === "sent") return { kind: "create", stage: "proposal_sent" };
    if (quoteStatus === "won") return { kind: "create", stage: "awarded" };
    return null;
  }
  if (quoteStatus === "won" && current === "proposal_sent") {
    return { kind: "advance", stage: "awarded" };
  }
  if (quoteStatus === "lost" && current === "proposal_sent") {
    return { kind: "close", stage: "closed" };
  }
  if (quoteStatus === "sent" && current === "closed") {
    // Deliberate reopen: a re-sent proposal that was previously lost picks
    // the lifecycle back up at proposal_sent instead of staying closed.
    return { kind: "reopen", stage: "proposal_sent" };
  }
  return null;
}
```

- [ ] **Step 4: Store side — `src/lib/stores/engagements.ts`**

Extend the module import from `@/lib/consulting-stages` with `engagementSyncAction`. Then:

**(a)** `fromQuote` (line 379) takes the birth stage — the hardcoded `status: "active"` at line 410 dies:

```ts
function fromQuote(
  q: QuoteLike,
  status: EngagementStage
): Omit<ConsultingEngagement, "id"> {
```

…and in the returned object, `status: "active",` becomes `status,`. Everything else in the function is untouched this task (milestone seeding is rebuilt in Task 3).

**(b)** Replace `createFromQuote` (lines 429-443) — zero external callers, superseded by the min-stage variant:

```ts
/** Idempotently make sure a consulting quote has its engagement, born at
 *  least at `minStage` (spec §1 spawn model): sent → proposal_sent, won →
 *  awarded. An existing engagement only ever ADVANCES proposal_sent →
 *  awarded — a stage a human moved past proposal_sent is never touched.
 *  (Same idempotence contract as the old createFromQuote it replaces.) */
export async function ensureEngagementForQuote(
  quoteId: string,
  minStage: "proposal_sent" | "awarded"
): Promise<ConsultingEngagement | null> {
  const existing = await getEngagementByQuote(quoteId);
  if (existing) {
    if (minStage === "awarded" && existing.status === "proposal_sent") {
      await patchEngagement(existing.id, (d) => {
        d.status = "awarded";
      });
      return getEngagement(existing.id);
    }
    return existing;
  }
  const q = await getDoc<QuoteLike>("quotes", quoteId);
  if (!q || q.quoteType !== "consulting") return null;
  const body = fromQuote(q, minStage);
  const id = await nextPrefixedId("consulting_engagements", "CE", 1000);
  const rec: ConsultingEngagement = { ...body, id };
  await upsertDoc<ConsultingEngagement>("consulting_engagements", rec);
  return rec;
}
```

**(c)** Rebuild the sweep (lines 445-467) over the pure rule — no longer won-only:

```ts
/** Consulting quotes → engagements (fifth sync in the on-win fan-out, AND
 *  the loadConsultingData safety net — estimator/inbox status paths never
 *  run syncs, mirroring syncProjectsFromQuotes-on-load). Applies the pure
 *  engagementSyncAction rules per quote: sent/won create (proposal_sent /
 *  awarded), won advances a proposal_sent record to awarded, lost closes a
 *  still-proposal_sent record with a "Proposal lost" decision entry.
 *  Idempotent throughout. Returns the number of records touched. */
export async function syncEngagementsFromQuotes(): Promise<number> {
  const engagements = await listDocs<ConsultingEngagement>(
    "consulting_engagements"
  );
  const byQuote = new Map<string, ConsultingEngagement>();
  for (const e of engagements) byQuote.set(e.quoteId, e);
  const quotes = await listDocs<QuoteLike>("quotes");
  let changed = 0;
  for (const q of quotes) {
    if (q.quoteType !== "consulting") continue;
    const existing = byQuote.get(q.id) || null;
    const stage = existing
      ? normalizeEngagementStatus(String(existing.status))
      : null;
    const action = engagementSyncAction(String(q.status || ""), stage);
    if (!action) continue;
    if (action.kind === "create") {
      const body = fromQuote(q, action.stage);
      const id = await nextPrefixedId("consulting_engagements", "CE", 1000);
      const rec: ConsultingEngagement = { ...body, id };
      await upsertDoc<ConsultingEngagement>("consulting_engagements", rec);
      byQuote.set(q.id, rec);
    } else if (action.kind === "advance" || action.kind === "reopen") {
      // "advance" (→ awarded) and "reopen" (→ proposal_sent) are both a
      // plain stage overwrite; only "close" below needs the decision entry.
      await patchEngagement(existing!.id, (d) => {
        d.status = action.stage;
      });
    } else {
      await patchEngagement(existing!.id, (d) => {
        d.status = "closed";
        d.decisions.unshift({
          id: uid("dc-"),
          at: Date.now(),
          by: "System",
          decision: "Proposal lost",
          context: `Consulting quote ${q.id} was marked lost while this engagement was still at Proposal sent.`,
        });
      });
    }
    changed++;
  }
  return changed;
}
```

- [ ] **Step 5: The hooks — `src/app/(app)/quotes/actions.ts`**

Extend the engagements import (line 18) and hook `setQuoteStatus` (lines 28-51). `setStatus` returns the quote, so `q.quoteType` is in hand:

```ts
import {
  ensureEngagementForQuote,
  syncEngagementsFromQuotes,
} from "@/lib/stores/engagements";
```

```ts
export async function setQuoteStatus(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  if (!id || !(STAGES as readonly string[]).includes(status)) return;
  // The actor is passed through so the automatic on-send revision is
  // attributed to whoever sent it (item 24).
  const q = await setStatus(id, status as QuoteStatus, user.name);
  if (!q) return;
  if (status === "sent" && q.quoteType === "consulting") {
    // Spec §1 spawn model: SENDING a consulting proposal opens the
    // engagement at Proposal sent — winning later advances it to Awarded.
    // Idempotent: re-sending finds the existing record.
    await ensureEngagementForQuote(id, "proposal_sent");
  }
  if (status === "lost" && q.quoteType === "consulting") {
    // A proposal lost while still at Proposal sent closes its engagement
    // with a "Proposal lost" decision — the sweep owns that rule.
    await syncEngagementsFromQuotes();
  }
  if (status === "won") {
    // Acceptance auto-spawns downstream work exactly like the prototype:
    // won flame-test quotes become FT jobs, won repair quotes become repair
    // jobs, won inspection quotes become requested inspections, won system
    // quotes become Installs projects, and won consulting quotes ensure /
    // advance ConsultingEngagements (spec §1: proposal_sent → awarded).
    // Each sync filters to its own quoteType and is idempotent, so calling
    // all five is safe.
    await syncFromQuotes();
    await syncRepairsFromQuotes();
    await syncInspectionsFromQuotes();
    await syncProjectsFromQuotes();
    await syncEngagementsFromQuotes();
  }
  revalidatePath("/", "layout");
}
```

- [ ] **Step 6: Safety net — `src/app/(app)/design/engagements/data.ts`**

Add `syncEngagementsFromQuotes` to the store import (line 1) and sweep at the top of `loadConsultingData` (line 41), the `projects/data.ts` idiom:

```ts
export async function loadConsultingData(): Promise<ConsultingData> {
  // #35 safety net (the projects data.ts idiom): estimator/inbox/home status
  // paths never run the quote→engagement syncs, so every consulting load
  // sweeps first — sent proposals appear, wins advance, lost proposals close.
  await syncEngagementsFromQuotes();
  const [engagements, quotes, designs, users, settings, visits] = await Promise.all([
```

(The rest of the function is unchanged.)

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run test:specs` — clean, ALL PASSED, count up.
Live sanity (dev server may stay up): mark a consulting quote **sent** from the Quotes hub → `/design/engagements` shows the new record at **Proposal sent**.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: consulting spawn model — sent→proposal_sent, won→awarded, lost→closed (#35 task 2)"
```

---

### Task 3: Payload + record extensions — scopes, assumptions, leadId, architect, milestone seeding (TDD)

**Files:**
- Modify: `src/lib/consulting-stages.ts` (`ConsultingScope`, `scopesTotal`, `milestoneSeeds`), `src/lib/stores/engagements.ts` (payload + record fields, `fromQuote` seeding, `getEngagementForQuoteRef`)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:** `type ConsultingScope`, `scopesTotal(scopes?)`, `milestoneSeeds(pay)`, `ConsultingQuotePayload.{scopes,assumptions,leadId}`, `ConsultingEngagement.architect`, `getEngagementForQuoteRef(quoteId)`.

- [ ] **Step 1: Write the failing tests**

Append inside the CONSULTING REBUILD section:

```ts
/* --- #35 structured scopes: totals + milestone seeding --- */
import {
  milestoneSeeds,
  scopesTotal,
  type ConsultingScope,
} from "@/lib/consulting-stages";
{
  const scopes: ConsultingScope[] = [
    { id: "sc-a", title: "Theatrical rigging design", description: "Drawings + specifications", fee: 8500 },
    { id: "sc-b", title: "Bid support", description: "", fee: 2000 },
  ];
  ok(scopesTotal(scopes) === 10500, "#35: the proposal total assembles from scope fees");
  ok(scopesTotal([]) === 0 && scopesTotal(undefined) === 0 && scopesTotal(null) === 0,
    "#35: no scopes → zero, tolerant of absent payloads");

  const seeded = milestoneSeeds({ scopes, feeMode: "milestones", fees: [{ name: "legacy", amount: 1 }] });
  ok(
    seeded.map((m) => `${m.name}:${m.amount}`).join("|") ===
      "Theatrical rigging design:8500|Bid support:2000",
    "#35: scopes seed milestones (name=title, amount=fee) and beat legacy fees"
  );
  ok(
    milestoneSeeds({ feeMode: "milestones", fees: [{ name: "SD complete", amount: 4000 }, { amount: 500 }] })
      .map((m) => `${m.name}:${m.amount}`).join("|") === "SD complete:4000|Milestone:500",
    "#35: legacy milestone quotes still seed from fees (nameless rows fall back)"
  );
  ok(
    milestoneSeeds({ feeMode: "fixed", fees: [{ name: "Fixed fee", amount: 9000 }] }).length === 0,
    "#35: legacy fixed-fee quotes seed no milestones (pre-rebuild behavior preserved)"
  );
  ok(
    milestoneSeeds({ scopes: [{ id: "sc-x", title: "", description: "d", fee: 0 }] })
      .map((m) => `${m.name}:${m.amount}`).join("|") === "Scope:0",
    "#35: a titleless scope still seeds, named 'Scope'"
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs` — errors (`scopesTotal` not exported yet).

- [ ] **Step 3: Pure helpers — append to `src/lib/consulting-stages.ts`**

```ts
/* ---------- structured proposal content (#35) ---------- */

/** One scope-of-work line item — title + description + fee (spec §1:
 *  "the proposal total assembles from scope fees"). id: uid("sc-"),
 *  minted server-side in quote/actions.ts. */
export type ConsultingScope = {
  id: string;
  title: string;
  description: string;
  fee: number;
};

export function scopesTotal(
  scopes?: readonly ConsultingScope[] | null
): number {
  return (scopes || []).reduce((a, s) => a + (s.fee || 0), 0);
}

/**
 * What an engagement's milestones seed from at spawn (pure half of
 * fromQuote): structured scopes when the proposal has them (name = title,
 * amount = fee), else the legacy milestone fee schedule, else nothing —
 * exactly the pre-rebuild behavior for pre-rebuild quotes. targetDate is
 * always 0 (unscheduled), so the Reports billing forecast — which filters
 * targetDate > 0 — is unaffected until someone dates the milestone.
 */
export function milestoneSeeds(pay: {
  scopes?: readonly ConsultingScope[] | null;
  feeMode?: string;
  fees?: ReadonlyArray<{ name?: string; amount?: number }> | null;
}): Array<{ name: string; amount: number }> {
  if (pay.scopes?.length) {
    return pay.scopes.map((s) => ({
      name: s.title || "Scope",
      amount: s.fee || 0,
    }));
  }
  if (pay.feeMode === "milestones") {
    return (pay.fees || []).map((f) => ({
      name: f.name || "Milestone",
      amount: f.amount || 0,
    }));
  }
  return [];
}
```

- [ ] **Step 4: Record + payload — `src/lib/stores/engagements.ts`**

Extend the consulting-stages import with `milestoneSeeds` and `type ConsultingScope`, and re-export the type for payload consumers: add `ConsultingScope` to the `export type { … } from "@/lib/consulting-stages";` line.

**(a)** `ConsultingQuotePayload` (lines 357-365) — additive optional fields, legacy fields stay:

```ts
/** The consulting payload a consulting-quote builder writes onto the quote
 *  (quotes.ts `consulting?: unknown` — this module owns the shape).
 *  #35 rebuild: new saves write `scopes` (structured line items, total =
 *  scope fees) + `assumptions` (the TICKED library texts, frozen at save) +
 *  `leadId` (auto-lead traceability). `scope`/`feeMode`/`fees` are the
 *  pre-rebuild shape — kept so old quotes render read-only; read all three
 *  new fields with `?? []` / `?? null`. */
export type ConsultingQuotePayload = {
  scope: string;
  feeMode: "fixed" | "milestones";
  /** feeMode 'fixed' → one row; 'milestones' → the fee schedule. */
  fees: Array<{ name: string; amount: number }>;
  terms: string;
  /** Phase names chosen at quote time — seeds the engagement's phases. */
  phases: string[];
  /** #35 structured scopes — id: uid('sc-'). */
  scopes?: ConsultingScope[];
  /** #35 ticked assumption texts, frozen at save. */
  assumptions?: string[];
  /** #35 auto-lead: the open lead this proposal logged against / created. */
  leadId?: string | null;
};
```

**(b)** `ConsultingEngagement` (after `installQuoteId`, lines 224-226) gains the minimal architect reference:

```ts
  /** #35 minimal architect link — dumb {company, contact} strings by design,
   *  slated to migrate into item 20's people/roles model. Read `?? null`
   *  (absent on every pre-#35 doc). */
  architect?: { company: string; contact: string } | null;
```

**(c)** `fromQuote` — milestone seeding goes through the pure helper (replaces the `pay?.feeMode === "milestones"` expression at lines 386-395), and the new record births `architect: null`:

```ts
  const milestones: EngagementMilestone[] = milestoneSeeds(pay || {}).map(
    (m) => ({
      id: uid("ms-"),
      name: m.name,
      targetDate: 0,
      completedAt: null,
      amount: m.amount,
    })
  );
```

…and in the returned object, after `installQuoteId: null,` add `architect: null,`.

**(d)** New lookup beside `getEngagementByQuote` — the quote-side chip's data source (consumed in Task 5; SELECTED quote only, never per-row):

```ts
/** The engagement referencing this quote either as its source (quoteId) or
 *  as Peak's own bid on the spec (installQuoteId). Selected-quote lookups
 *  ONLY — full scan, same cost class as getEngagementByQuote; never call
 *  per row. */
export async function getEngagementForQuoteRef(
  quoteId: string
): Promise<ConsultingEngagement | null> {
  const all = await listDocs<ConsultingEngagement>("consulting_engagements");
  const hit =
    all.find((e) => e.quoteId === quoteId) ||
    all.find((e) => e.installQuoteId === quoteId) ||
    null;
  return hit ? normalizeEngagement(hit) : null;
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run test:specs` — clean, ALL PASSED, count up.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: consulting payload scopes/assumptions/leadId + architect + scope-seeded milestones (#35 task 3)"
```

---

### Task 4: Assumptions library (Settings) + letter rendering (scopes + assumptions) + template field (TDD)

**Files:**
- Modify: `src/lib/consulting-stages.ts` (DEFAULT seed + merged), `src/lib/settings.ts` (key), `src/lib/templates.ts` (`assumptionsLead` field — FIRST, per the override-key rule), `src/app/(app)/settings/actions.ts` (save action), `src/app/(app)/settings/settings-client.tsx` (card), `src/app/(app)/settings/page.tsx` (prop), `src/app/(app)/design/engagements/letter/page.tsx` (scope lines + assumption bullets)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:** `DEFAULT_CONSULTING_ASSUMPTIONS`, `mergedConsultingAssumptions(stored?)`, `AppSettingsData.consultingAssumptions`, `saveConsultingAssumptionsAction(assumptions)`.

- [ ] **Step 1: Write the failing tests**

Append inside the CONSULTING REBUILD section (`getTemplateDef` — `templates.ts` is import-free, verified — is a legal harness import):

```ts
/* --- #35 assumptions library + the additive template field --- */
import {
  DEFAULT_CONSULTING_ASSUMPTIONS,
  mergedConsultingAssumptions,
} from "@/lib/consulting-stages";
import { getTemplateDef } from "@/lib/templates";
{
  ok(
    DEFAULT_CONSULTING_ASSUMPTIONS.length >= 8 && DEFAULT_CONSULTING_ASSUMPTIONS.length <= 12,
    "#35: the DRAFT assumption seed stays 8-12 lines (Jeff replaces from the real letter)"
  );
  ok(
    mergedConsultingAssumptions(undefined).join("|") === DEFAULT_CONSULTING_ASSUMPTIONS.join("|"),
    "#35: absent settings → the default library"
  );
  ok(
    mergedConsultingAssumptions([]).join("|") === DEFAULT_CONSULTING_ASSUMPTIONS.join("|"),
    "#35: an EMPTY stored list falls back to defaults (the visitReasons idiom)"
  );
  ok(
    mergedConsultingAssumptions(["  Owner provides access.  ", "", "Backgrounds by others."]).join("|") ===
      "Owner provides access.|Backgrounds by others.",
    "#35: a stored list wins whole, trimmed and de-blanked"
  );
  const cp = getTemplateDef("consulting_proposal");
  ok(
    !!cp && cp.fields.some((f) => f.id === "assumptionsLead"),
    "#35: consulting_proposal carries the assumptionsLead field (additive — ids are override keys)"
  );
  ok(
    cp!.fields.map((f) => f.id).join(",") ===
      "intro,scopeLead,feeLineFixed,feeLineMilestones,termsBlock,assumptionsLead,signoff,taxNote",
    "#35: no pre-existing field id was renamed (renames orphan stored overrides)"
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs` — errors (`DEFAULT_CONSULTING_ASSUMPTIONS` not exported yet).

- [ ] **Step 3: Library — append to `src/lib/consulting-stages.ts`**

```ts
/* ---------- assumptions library (#35) ---------- */

/** DRAFT seed — replace from Peak's real consulting letter (Jeff homework,
 *  spec §1 Homework 1). Standard consulting-letter assumptions; admins edit
 *  the live list in Settings (AppSettingsData.consultingAssumptions), and
 *  each proposal freezes the texts TICKED at save. Shared seam for the
 *  estimator's assumptions/exceptions model (spec §4, wave ③). */
export const DEFAULT_CONSULTING_ASSUMPTIONS: string[] = [
  "Architectural backgrounds are provided by others in AutoCAD .dwg format; Revit modeling is not included.",
  "The owner provides timely access to the facility for field verification.",
  "Existing structure is assumed adequate for the loads shown; structural engineering is by others.",
  "Electrical service, conduit, and rough-in are provided by the electrical contractor.",
  "Permitting, plan-review, and other agency fees are excluded and billed separately when required.",
  "Up to two (2) design review meetings are included; additional meetings are billed hourly.",
  "One (1) revision cycle per drawing set is included.",
  "Construction administration covers the winning contractor's submittals and RFIs only.",
  "Reimbursable travel expenses are billed at cost.",
  "Fees are independent of any future construction or installation pricing.",
];

/** Stored list if non-empty, else the defaults (the mergedVisitReasons /
 *  mergedConsultingPhases idiom — a whole-list override, not a merge). */
export function mergedConsultingAssumptions(
  stored?: string[] | null
): string[] {
  const list = (stored || []).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CONSULTING_ASSUMPTIONS;
}
```

- [ ] **Step 4: Settings key + save action + admin card**

**`src/lib/settings.ts`** — after `consultingPhases` (line 41):

```ts
  /** Consulting proposal assumptions library (#35) — see
   *  DEFAULT_CONSULTING_ASSUMPTIONS in lib/consulting-stages.ts;
   *  empty/absent means use the (DRAFT-seed) defaults. The estimator's
   *  shared assumptions model (spec §4, wave ③) will consume this key. */
  consultingAssumptions?: string[];
```

**`src/app/(app)/settings/actions.ts`** — after `saveConsultingPhasesAction` (line 235):

```ts
/** Consulting assumptions library (#35 — DEFAULT_CONSULTING_ASSUMPTIONS
 *  overrides). Trimmed, de-blanked, capped; an empty list falls back to the
 *  defaults (mergedConsultingAssumptions). */
export async function saveConsultingAssumptionsAction(assumptions: string[]) {
  await requirePerm("manage_users");
  const clean = (Array.isArray(assumptions) ? assumptions : [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 40);
  await setSettings({ consultingAssumptions: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

**`src/app/(app)/settings/settings-client.tsx`** — clone the phases-card wiring end to end. Add `saveConsultingAssumptionsAction` to the actions import (line 21 block); add the prop `consultingAssumptions: string[]` to `SettingsClient`'s parameter list AND its props type (beside `consultingPhases`); add the state block after the phases block (~line 250):

```ts
  /* ---- consulting assumptions library (#35, one per line) ---- */
  const [assumpDraft, setAssumpDraft] = useState(consultingAssumptions.join("\n"));
  const [assumpDirty, setAssumpDirty] = useState(false);
  const [assumpSaved, setAssumpSaved] = useState(false);
  const saveAssumptions = () =>
    run(async () => {
      const res = await saveConsultingAssumptionsAction(
        assumpDraft
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (res.ok) {
        setAssumpDirty(false);
        setAssumpSaved(true);
      }
      return res;
    });
```

…and the card, immediately AFTER the "Consulting phase menu (D90)" section (line ~765, before "Locations") so the two consulting cards sit together:

```tsx
      {/* ---- Consulting assumptions library (#35) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Consulting — assumptions library</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The standard assumptions offered as a checklist when building a
              consulting proposal. One per line; the lines TICKED on a
              proposal print on its letter. Draft seed — replace with the
              lines from Peak&rsquo;s real consulting letter.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {assumpSaved && !assumpDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={saveAssumptions}
              disabled={!assumpDirty}
              style={{ opacity: assumpDirty ? 1 : 0.5, cursor: assumpDirty ? "pointer" : "default" }}
            >
              Save assumptions
            </button>
          </div>
        </div>
        <textarea
          value={assumpDraft}
          onChange={(e) => {
            setAssumpDraft(e.target.value);
            setAssumpDirty(true);
            setAssumpSaved(false);
          }}
          spellCheck={false}
          style={{
            ...inputStyle,
            marginTop: 14,
            minHeight: 170,
            maxWidth: 640,
            resize: "vertical",
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
          }}
        />
      </section>
```

**`src/app/(app)/settings/page.tsx`** — add `import { mergedConsultingAssumptions } from "@/lib/consulting-stages";` and pass the prop beside `consultingPhases` (line ~141):

```tsx
          consultingAssumptions={mergedConsultingAssumptions(settings.consultingAssumptions)}
```

- [ ] **Step 5: Template field FIRST — `src/lib/templates.ts`**

In the `consulting_proposal` def, insert between `termsBlock` (ends line 204) and `signoff` (line 205) — additive id, nothing renamed:

```ts
      {
        id: "assumptionsLead",
        label: "Assumptions lead-in",
        multiline: true,
        help: "Introduces the ticked assumptions checklist (#35). The bullet lines themselves come from the proposal, frozen at save time.",
        default: "This proposal assumes:",
      },
```

- [ ] **Step 6: Letter rendering — `src/app/(app)/design/engagements/letter/page.tsx`**

Add `import { scopesTotal } from "@/lib/consulting-stages";`. After the `pay` fallback (lines 112-118), derive the structured content and make the total scope-aware (replaces the `total` expression at lines 125-128):

```ts
  const scopes = pay.scopes || [];
  const assumptions = pay.assumptions || [];
  const total = scopes.length
    ? scopesTotal(scopes)
    : pay.feeMode === "milestones"
      ? pay.fees.reduce((a, f) => a + (f.amount || 0), 0)
      : pay.fees[0]?.amount || quote?.value || 0;
```

**Scope of services** (proposal branch, lines 185-194) — per-scope lines (title — description — fee) when scopes exist, the single legacy paragraph otherwise:

```tsx
            <div style={{ ...H2, color: accent }}>Scope of services</div>
            <p style={BODY}>{renderField(t, "consulting_proposal", "scopeLead", vars)}</p>
            {scopes.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: SANS, fontSize: 12.5, margin: "4px 0 12px" }}>
                <tbody>
                  {scopes.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #eef0f3", verticalAlign: "top" }}>
                      <td style={{ padding: "7px 4px" }}>
                        <b>{s.title || "Scope"}</b>
                        {s.description && (
                          <div style={{ color: "#5b616e", marginTop: 2, whiteSpace: "pre-wrap" }}>{s.description}</div>
                        )}
                      </td>
                      <td style={{ padding: "7px 4px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {money(s.fee)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "9px 4px", fontWeight: 700 }}>Total professional fee</td>
                    <td style={{ padding: "9px 4px", textAlign: "right", fontWeight: 700 }}>{money(total)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p style={{ ...BODY, background: "#f9fafb", border: "1px solid #eef0f3", borderRadius: 8, padding: "12px 14px" }}>
                {pay.scope || "Scope to be defined."}
              </p>
            )}
```

**Professional fee** — when scopes exist, suppress the `feeLineFixed` paragraph entirely, not just the legacy milestone table: the scope table above already itemizes and totals the fees, so nothing needs to restate the total. `feeLineFixed`'s default copy ends "...split by discipline **as shown below**" (`templates.ts`) — with scopes replacing the fixed-fee block, nothing follows it, so that copy would read wrong. Rewording the default doesn't fix this cleanly (field ids are override keys, and a reworded default still renders on top of any quote that already saved a custom override), so suppress render-side instead. Change the condition at line 197 from `pay.feeMode === "milestones" && pay.fees.length > 0` to a three-way check that renders nothing — neither the milestone table nor the fixed-fee paragraph — once scopes are present:

```tsx
            {scopes.length ? null : pay.feeMode === "milestones" && pay.fees.length > 0 ? (
```

**Assumptions** — new section between Terms and Acceptance (after line 224's `{pay.terms && …}`):

```tsx
            {assumptions.length > 0 && (
              <>
                <div style={{ ...H2, color: accent }}>Assumptions</div>
                <p style={BODY}>{renderField(t, "consulting_proposal", "assumptionsLead", vars)}</p>
                <ul style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.65, margin: "0 0 10px", paddingLeft: 22 }}>
                  {assumptions.map((a, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>{a}</li>
                  ))}
                </ul>
              </>
            )}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run test:specs` — clean, ALL PASSED, count up.
Live: Settings → the new card shows the 10 draft lines; `/templates` → Consulting Proposal shows the "Assumptions lead-in" field; an old consulting quote's letter renders exactly as before (legacy branch).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: consulting assumptions library + scope/assumption letter rendering (#35 task 4)"
```

---

### Task 5: Builder rebuild + auto-lead dedupe + Overview upgrades + quote chip + #25 sweep

**Files:**
- Modify: `src/lib/stores/leads.ts` (`"consulting"` LeadSource), `src/app/(app)/design/engagements/quote/page.tsx` (loader), `src/app/(app)/design/engagements/quote/controls.tsx` (builder rebuild), `src/app/(app)/design/engagements/quote/actions.ts` (persist + auto-lead), `src/app/(app)/design/engagements/actions.ts` (`linkInstallQuoteAction` validation, `setArchitectAction`), `src/app/(app)/design/engagements/view.tsx` (Overview cards + #25 strings), `src/app/(app)/quotes/page.tsx` (engagement chip), `src/lib/venue-history-server.ts` (subtitle)

**Interfaces:** `setArchitectAction(engId, {company, contact})`; `SOURCES` gains `"consulting"`; `BuilderInitial` reshaped (scopes/assumptions/legacy*).

- [ ] **Step 1: LeadSource vocabulary — `src/lib/stores/leads.ts`**

`LeadSource` is a CLOSED union derived from `SOURCES` (line 100), and `create()`/`mkLead()` **coerce unknown sources to `"manual"`** (lines 251-254, 488-491) — without the literal, the auto-lead would silently save as "manual". Add the literal + meta (the `Record<LeadSource, LeadSourceMeta>` type forces the meta entry):

```ts
export const SOURCES = [
  "website",
  "referral",
  "phone",
  "manual",
  "event",
  "existing",
  "consulting",
] as const;
```

…and in `SOURCE_META` (line 111), after `existing`:

```ts
  consulting: { label: "Consulting proposal", short: "Consulting", verb: "came from a consulting proposal", sla: 48, color: "#6b4fa1" },
```

(Purple `#6b4fa1` = the consulting badge ink used across the app. `leads/page.tsx:311` builds its source filter from `SOURCES.map(…)`, so the new source appears there with zero edits.)

- [ ] **Step 2: Loader — `src/app/(app)/design/engagements/quote/page.tsx`**

Add `import { mergedConsultingAssumptions } from "@/lib/consulting-stages";`, resolve the menu beside `phaseMenu` (line 61):

```ts
  const phaseMenu = mergedConsultingPhases(settings.consultingPhases);
  const assumptionsMenu = mergedConsultingAssumptions(settings.consultingAssumptions);
```

Reshape `initial` (lines 72-86) — structured fields first-class, legacy payload carried for the read-only panel:

```ts
      initial = {
        id: q.id,
        name: q.name,
        customerId: q.customerId || "",
        locationId: q.locationId || "",
        contactName: contact?.name || "",
        contactRole: contact?.role || "",
        contactEmail: contact?.email || "",
        scopes: (pay?.scopes || []).map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          fee: s.fee,
        })),
        assumptions: pay?.assumptions || [],
        legacyScope: pay?.scope || "",
        legacyFeeMode: pay?.feeMode === "milestones" ? "milestones" : "fixed",
        legacyFees: pay?.fees || [],
        terms: pay?.terms || "",
        phases: pay?.phases || [],
        status: q.status,
      };
```

…and pass the menu through:

```tsx
    <ConsultingQuoteBuilder
      customers={customers}
      phaseMenu={phaseMenu}
      assumptionsMenu={assumptionsMenu}
      initial={initial}
      preCustomerId={preCustomer}
      justSaved={saved}
    />
```

- [ ] **Step 3: Builder rebuild — `src/app/(app)/design/engagements/quote/controls.tsx`**

Full replacement (the fee-mode toggle and milestone fee rows leave the form — fees now come from scopes; legacy content renders read-only). `LBL`/`INPUT` style consts and the customer/site/contact section are byte-identical to today's file:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { saveConsultingQuote } from "./actions";
import { money } from "@/lib/format";

/**
 * Consulting proposal builder (#35 rebuild, spec §1). Structured scopes
 * (title + description + fee — the proposal total assembles from scope
 * fees), a tickable assumptions checklist seeded from the Settings-editable
 * library (ticked texts freeze onto the proposal at save), terms, and the
 * phase selection that seeds the engagement when the proposal is SENT
 * (spec §1 spawn model — no longer on win). Still deliberately fee-based:
 * no engine, no travel, and NO pricing tiers (pricingTier/tierMargin stay
 * unset).
 *
 * Pre-rebuild quotes (free-text scope + fixed/milestone fees) show their
 * old content read-only below the scope rows; saving always writes
 * structured scopes, so editing a legacy quote means carrying its content
 * into the rows (the revision trail keeps the original).
 */

export type BuilderCustomer = {
  id: string;
  name: string;
  locations: Array<{ id: string; label: string }>;
  contacts: Array<{ name: string; role: string; email: string; primary: boolean }>;
};

export type BuilderScope = { id: string; title: string; description: string; fee: number };

export type BuilderInitial = {
  id: string;
  name: string;
  customerId: string;
  locationId: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  /** #35 structured content (empty arrays on pre-rebuild quotes). */
  scopes: BuilderScope[];
  assumptions: string[];
  /** Pre-rebuild payload — rendered read-only when scopes is empty. */
  legacyScope: string;
  legacyFeeMode: "fixed" | "milestones";
  legacyFees: Array<{ name: string; amount: number }>;
  terms: string;
  phases: string[];
  status: string;
};

type ScopeRow = { id: string; title: string; description: string; fee: string };

const LBL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  margin: "16px 0 6px",
};

const INPUT: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  background: "#fff",
  outline: "none",
};

export function ConsultingQuoteBuilder({
  customers,
  phaseMenu,
  assumptionsMenu,
  initial,
  preCustomerId,
  justSaved,
}: {
  customers: BuilderCustomer[];
  phaseMenu: string[];
  /** Merged assumptions library (Settings-editable, DRAFT default seed). */
  assumptionsMenu: string[];
  initial: BuilderInitial | null;
  preCustomerId: string;
  justSaved: boolean;
}) {
  const [customerId, setCustomerId] = useState(
    initial?.customerId || preCustomerId || ""
  );
  const cust = customers.find((c) => c.id === customerId) || null;

  const [quoteName, setQuoteName] = useState(initial?.name || "");
  const [locationId, setLocationId] = useState(initial?.locationId || "");
  const [contactName, setContactName] = useState(initial?.contactName || "");
  const [contactRole, setContactRole] = useState(initial?.contactRole || "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail || "");
  const [terms, setTerms] = useState(initial?.terms || "");

  /* ---- structured scopes (#35) ---- */
  const [scopeRows, setScopeRows] = useState<ScopeRow[]>(
    initial?.scopes.length
      ? initial.scopes.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          fee: s.fee ? String(s.fee) : "",
        }))
      : [{ id: "", title: "", description: "", fee: "" }]
  );
  const setRow = (i: number, patch: Partial<ScopeRow>) =>
    setScopeRows(scopeRows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /* ---- assumptions checklist (#35): menu = library + any ticked texts an
     older save carried that the library no longer lists + one-off adds ---- */
  const [customAdds, setCustomAdds] = useState<string[]>([]);
  const menu = useMemo(() => {
    const extra = (initial?.assumptions || []).filter((a) => !assumptionsMenu.includes(a));
    const custom = customAdds.filter((a) => !assumptionsMenu.includes(a) && !extra.includes(a));
    return [...assumptionsMenu, ...extra, ...custom];
  }, [assumptionsMenu, initial, customAdds]);
  const [ticked, setTicked] = useState<string[]>(initial ? initial.assumptions : []);
  const [newAssumption, setNewAssumption] = useState("");
  const toggle = (a: string) =>
    setTicked(ticked.includes(a) ? ticked.filter((x) => x !== a) : [...ticked, a]);

  // Phase menu + any custom phases already on the edited quote.
  const phaseOptions = useMemo(() => {
    const extra = (initial?.phases || []).filter((p) => !phaseMenu.includes(p));
    return [...phaseMenu, ...extra];
  }, [phaseMenu, initial]);
  const [phases, setPhases] = useState<string[]>(
    initial ? initial.phases : phaseMenu.slice()
  );

  const pickContact = (name: string) => {
    const ct = cust?.contacts.find((c) => c.name === name);
    setContactName(name);
    if (ct) {
      setContactRole(ct.role || "");
      setContactEmail(ct.email || "");
    }
  };

  const scopes = scopeRows
    .map((r) => ({
      id: r.id,
      title: r.title.trim(),
      description: r.description.trim(),
      fee: Math.round(Number(r.fee) || 0),
    }))
    .filter((s) => s.title || s.description || s.fee > 0);
  const total = scopes.reduce((a, s) => a + s.fee, 0);
  /** The ticked texts, in menu order — frozen onto the proposal at save. */
  const assumptions = menu.filter((a) => ticked.includes(a));
  const canSave = !!customerId && total > 0;
  const legacy =
    initial && !initial.scopes.length && (initial.legacyScope || initial.legacyFees.length)
      ? initial
      : null;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: 0 }}>
          {initial ? `Consulting proposal ${initial.id}` : "New consulting proposal"}
        </h1>
        <span
          style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
            color: "#6b4fa1", background: "#f0ebf9", border: "1px solid #ddd2f0",
            padding: "2px 8px", borderRadius: 5,
          }}
        >
          Fee-based
        </span>
        {initial && (
          <Link href="/quotes" style={{ fontSize: 12.5, color: "var(--accent)" }}>
            Manage status &amp; review in Quotes →
          </Link>
        )}
      </div>
      {justSaved && (
        <div
          style={{
            marginTop: 12, background: "#eaf6ef", border: "1px solid #cce9da",
            borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#1f7a52",
          }}
        >
          Saved. Review and send from the Quotes hub — sending opens the engagement at Proposal sent; winning advances it to Awarded.
        </div>
      )}

      <form action={saveConsultingQuote}>
        {initial && <input type="hidden" name="editingId" value={initial.id} />}
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="scopes" value={JSON.stringify(scopes)} />
        <input type="hidden" name="assumptions" value={JSON.stringify(assumptions)} />
        <input type="hidden" name="phases" value={JSON.stringify(phases)} />

        <label style={LBL}>Customer</label>
        <select
          value={customerId}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setLocationId("");
          }}
          style={INPUT}
        >
          <option value="">Choose a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {cust && cust.locations.length > 0 && (
          <>
            <label style={LBL}>Site</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={INPUT}>
              <option value="">— none —</option>
              {cust.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </>
        )}

        <label style={LBL}>Quote name</label>
        <input
          name="quoteName"
          value={quoteName}
          onChange={(e) => setQuoteName(e.target.value)}
          placeholder={cust ? cust.name + " — Consulting" : "Consulting engagement"}
          style={INPUT}
        />

        <label style={LBL}>Contact</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <input
            name="contactName"
            value={contactName}
            onChange={(e) => pickContact(e.target.value)}
            placeholder="Name"
            list="consulting-contacts"
            style={INPUT}
          />
          <datalist id="consulting-contacts">
            {(cust?.contacts || []).map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <input name="contactRole" value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="Role" style={INPUT} />
          <input name="contactEmail" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" style={INPUT} />
        </div>

        <label style={LBL}>Scopes of work (title · description · fee)</label>
        {scopeRows.map((r, i) => (
          <div key={i} style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: "#fbfbfc" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 34px", gap: 8 }}>
              <input
                value={r.title}
                onChange={(e) => setRow(i, { title: e.target.value })}
                placeholder={`Scope ${i + 1} (e.g. Theatrical rigging design)`}
                style={INPUT}
              />
              <input
                value={r.fee}
                onChange={(e) => setRow(i, { fee: e.target.value.replace(/[^\d]/g, "") })}
                placeholder="Fee ($)"
                inputMode="numeric"
                style={INPUT}
              />
              <button
                type="button"
                onClick={() => setScopeRows(scopeRows.filter((_, j) => j !== i))}
                title="Remove scope"
                style={{ border: "1px solid #e4e7ec", borderRadius: 8, background: "#fff", color: "#8c919c", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <textarea
              value={r.description}
              onChange={(e) => setRow(i, { description: e.target.value })}
              rows={2}
              placeholder="What this scope covers — drawings, specifications, meetings, site visits…"
              style={{ ...INPUT, marginTop: 8, resize: "vertical", lineHeight: 1.6 }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setScopeRows([...scopeRows, { id: "", title: "", description: "", fee: "" }])}
          style={{
            fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "none",
            border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-ui)",
          }}
        >
          + Add scope
        </button>

        {legacy && (
          <div style={{ marginTop: 14, background: "#fdf8ee", border: "1px solid #f0e2bd", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: "#8a6d1f" }}>
            <b>Pre-rebuild proposal content (read-only).</b> Carry what still
            applies into the scope rows above — saving writes structured
            scopes (the revision trail keeps this original).
            {legacy.legacyScope && (
              <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "#5b616e" }}>{legacy.legacyScope}</div>
            )}
            {legacy.legacyFees.length > 0 && (
              <div style={{ marginTop: 6, color: "#5b616e" }}>
                {legacy.legacyFeeMode === "fixed" ? "Fixed fee: " : "Milestones: "}
                {legacy.legacyFees.map((f) => `${f.name || "Fee"} ${money(f.amount)}`).join(" · ")}
              </div>
            )}
          </div>
        )}

        <label style={LBL}>Assumptions (ticked lines print on the proposal)</label>
        <div style={{ display: "grid", gap: 5 }}>
          {menu.map((a) => (
            <label key={a} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
              <input type="checkbox" checked={ticked.includes(a)} onChange={() => toggle(a)} style={{ marginTop: 2 }} />
              <span>{a}</span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 560 }}>
          <input
            value={newAssumption}
            onChange={(e) => setNewAssumption(e.target.value)}
            placeholder="Add a one-off assumption…"
            style={{ ...INPUT, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => {
              const a = newAssumption.trim();
              if (!a) return;
              if (!menu.includes(a)) setCustomAdds([...customAdds, a]);
              if (!ticked.includes(a)) setTicked([...ticked, a]);
              setNewAssumption("");
            }}
            style={{
              fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "#fff",
              border: "1px solid #e4e7ec", borderRadius: 8, padding: "0 12px",
              cursor: "pointer", fontFamily: "var(--font-ui)",
            }}
          >
            Add
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 4 }}>
          Standard lines are managed in Settings → Consulting — assumptions library.
        </div>

        <label style={LBL}>Engagement phases (seed the engagement when the proposal is sent)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {phaseOptions.map((p) => {
            const on = phases.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() =>
                  setPhases(on ? phases.filter((x) => x !== p) : [...phases, p])
                }
                style={{
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-ui)",
                  padding: "6px 11px", borderRadius: 8, cursor: "pointer",
                  border: on ? "1px solid color-mix(in srgb, var(--accent) 35%, #fff)" : "1px solid #e4e7ec",
                  background: on ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "#fff",
                  color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>

        <label style={LBL}>Terms</label>
        <textarea
          name="terms"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          rows={4}
          placeholder="Payment terms, exclusions… (assumptions live in the checklist above)"
          style={{ ...INPUT, resize: "vertical", lineHeight: 1.6 }}
        />

        <div
          style={{
            marginTop: 22, display: "flex", alignItems: "center", gap: 14,
            borderTop: "1px solid #eef0f3", paddingTop: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "#16181d" }}>
            Total {money(total)}
          </div>
          <button
            type="submit"
            disabled={!canSave}
            className="pk-btn-accent"
            style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "default" }}
          >
            {initial ? "Save changes" : "Save proposal"}
          </button>
          {initial && (
            <Link
              href={`/design/engagements/letter?id=${encodeURIComponent(initial.id)}&kind=proposal`}
              style={{ fontSize: 12.5, color: "var(--accent)" }}
            >
              Proposal / agreement →
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Persist + auto-lead — `src/app/(app)/design/engagements/quote/actions.ts`**

Full replacement:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { nameFor } from "@/lib/stores/customers";
import {
  create as createQuote,
  get as getQuote,
  update as updateQuote,
} from "@/lib/stores/quotes";
import {
  create as createLead,
  logActivity as logLeadActivity,
  open as openLeads,
} from "@/lib/stores/leads";
import type { ConsultingQuotePayload } from "@/lib/stores/engagements";
import { scopesTotal, type ConsultingScope } from "@/lib/consulting-stages";

/**
 * Consulting proposal mutations (#35 rebuild over the D90 lightweight
 * builder). Structured scopes (the total = scope fees), the ticked
 * assumption texts frozen at save, terms, and the phase selection that
 * seeds the engagement when the proposal is SENT (spec §1). Still no
 * engine, no travel, and NO pricing tiers (fee-based, not margin-derived —
 * pricingTier/tierMargin stay unset). Everything downstream (review gate,
 * status pipeline, D84 revisions, letters) is the ordinary quote machinery
 * driven from the Quotes hub.
 *
 * Auto-lead with dedupe (spec §1): the CREATE path (never edits) links the
 * proposal to the company's open lead when one exists (a system activity
 * notes the proposal), else creates a source-"consulting" lead. Either way
 * the payload stamps leadId for traceability.
 *
 * Client input is field-allowlisted here — review/status/owner never come
 * from the form (same self-approval guardrail as updateQuoteMetaAction).
 */

function uid(p?: string): string {
  return (p || "x") + Math.random().toString(36).slice(2, 8);
}

type PostedScope = { id?: string; title?: string; description?: string; fee?: number };

async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const customerId = String(formData.get("customerId") || "");
  const locationId = String(formData.get("locationId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const contactRole = String(formData.get("contactRole") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const terms = String(formData.get("terms") || "").trim();

  let postedScopes: PostedScope[] = [];
  try {
    postedScopes = JSON.parse(String(formData.get("scopes") || "[]"));
  } catch {
    postedScopes = [];
  }
  let postedAssumptions: unknown[] = [];
  try {
    postedAssumptions = JSON.parse(String(formData.get("assumptions") || "[]"));
  } catch {
    postedAssumptions = [];
  }
  let phases: string[] = [];
  try {
    phases = JSON.parse(String(formData.get("phases") || "[]"));
  } catch {
    phases = [];
  }

  if (!customerId) return null;

  const scopes: ConsultingScope[] = (Array.isArray(postedScopes) ? postedScopes : [])
    .map((s) => ({
      id: typeof s?.id === "string" && s.id.startsWith("sc-") ? s.id : uid("sc-"),
      title: String(s?.title || "").trim().slice(0, 120),
      description: String(s?.description || "").trim().slice(0, 2000),
      fee: Math.max(0, Math.round(Number(s?.fee) || 0)),
    }))
    .filter((s) => s.title || s.description || s.fee > 0)
    .slice(0, 40);
  const assumptions = (Array.isArray(postedAssumptions) ? postedAssumptions : [])
    .map((a) => String(a || "").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 40);
  const cleanPhases = (Array.isArray(phases) ? phases : [])
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  const value = scopesTotal(scopes);

  const custName = (await nameFor(customerId)) || "";
  const contact = contactName
    ? { name: contactName, role: contactRole, email: contactEmail }
    : null;

  // Pre-rebuild content survives an edit read-only: the legacy scope string
  // rides along; fees are superseded by scopes (revisions hold the history).
  const prior = editingId ? await getQuote(editingId) : null;
  const priorPay = (prior?.consulting || null) as ConsultingQuotePayload | null;

  const consulting: ConsultingQuotePayload = {
    scope: priorPay?.scope || "",
    feeMode: "fixed",
    fees: [],
    terms,
    phases: cleanPhases,
    scopes,
    assumptions,
    leadId: priorPay?.leadId ?? null,
  };

  const payload = {
    name: quoteName || (custName ? custName + " — Consulting" : "Consulting"),
    customer: custName,
    customerId: customerId || null,
    locationId: locationId || null,
    value,
    margin: 0,
    source: "consulting",
    quoteType: "consulting",
    owner: user.name,
    contact,
    consulting,
  };

  const q = editingId
    ? await updateQuote(editingId, payload)
    : await createQuote(payload);
  const qid = (q && q.id) || editingId || null;

  /* ---- #35 auto-lead with dedupe — CREATE path only, never edits ---- */
  if (!editingId && q) {
    const existing = (await openLeads()).find((l) => l.customerId === customerId);
    let leadId: string;
    if (existing) {
      await logLeadActivity(
        existing.id,
        { type: "system", note: `Consulting proposal ${q.id} created` },
        user.name
      );
      leadId = existing.id;
    } else {
      const lead = await createLead(
        {
          org: custName,
          source: "consulting",
          owner: user.name,
          customerId,
          interest: "Consulting — " + payload.name,
          value,
        },
        user.name
      );
      leadId = lead.id;
    }
    await updateQuote(q.id, { consulting: { ...consulting, leadId } });
  }
  return qid;
}

export async function saveConsultingQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  revalidatePath("/", "layout");
  if (id)
    redirect("/design/engagements/quote?id=" + encodeURIComponent(id) + "&saved=1");
}
```

(`create()` in leads.ts forces `stage: "new"` and validates the source against `SOURCES` — with Step 1's literal, `"consulting"` survives instead of coercing to `"manual"`. `logActivity` type `"system"` is in `ACTIVITY_TYPES` — verified.)

- [ ] **Step 5: Engagement-side actions — `src/app/(app)/design/engagements/actions.ts`**

Add `import { get as getQuote } from "@/lib/stores/quotes";`. Replace `linkInstallQuoteAction` (lines 83-92) — the input was a free-text trust-me field; now the quote must EXIST and not be consulting (brief upgrade a):

```ts
export async function linkInstallQuoteAction(
  engId: string,
  quoteId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const clean = quoteId ? String(quoteId).trim() : null;
  if (clean) {
    // #35: validate the reference — the field used to accept any string.
    const q = await getQuote(clean);
    if (!q) return { ok: false, error: `No quote ${clean} exists.` };
    if (q.quoteType === "consulting")
      return {
        ok: false,
        error: "That's a consulting quote — link the install (system) quote Peak bid on the spec.",
      };
  }
  await patchEngagement(engId, (d) => {
    d.installQuoteId = clean;
  });
  return done();
}
```

New action beside it (the architect card's writer):

```ts
/** #35 minimal architect link — {company, contact} strings by design (item
 *  20's people/roles model absorbs this later). Both blank clears the link. */
export async function setArchitectAction(
  engId: string,
  input: { company: string; contact: string }
) {
  await requireUser();
  const company = String(input?.company || "").trim().slice(0, 120);
  const contact = String(input?.contact || "").trim().slice(0, 120);
  await patchEngagement(engId, (d) => {
    d.architect = company || contact ? { company, contact } : null;
  });
  return done();
}
```

- [ ] **Step 6: Overview upgrades + #25 sweep — `src/app/(app)/design/engagements/view.tsx`**

Add `setArchitectAction` to the actions import (lines 15-38).

**(a) Install-quote row** (OverviewTab, lines 386-427) — inline validation error + the linked quote's live status chip (`data.quotesById` already carries `installQuoteId` quotes — `data.ts:51-60`). Replace `OverviewTab`'s opening and the Links-card install row:

```tsx
const QUOTE_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
};
const QUOTE_TONE: Record<string, string> = {
  draft: "orange",
  sent: "blue",
  won: "green",
  lost: "gray",
};

function OverviewTab({ data, eng }: { data: ConsultingData; eng: ConsultingEngagement }) {
  const router = useRouter();
  const [installQuote, setInstallQuote] = useState(eng.installQuoteId || "");
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const visits = data.visits.filter((v) => v.engagementId === eng.id);
  const iq = eng.installQuoteId ? data.quotesById[eng.installQuoteId] : undefined;
```

(Module-level consts beside `REVIEW_TONE` — `stores/quotes` values are client-forbidden here, so the 4-key label/tone maps are restated locally.) The install-quote block becomes:

```tsx
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>Install quote:</span>
              <input
                value={installQuote}
                onChange={(e) => setInstallQuote(e.target.value)}
                placeholder="Q-…"
                style={{ ...INPUT, width: 110, padding: "4px 8px", fontSize: 12 }}
              />
              <button
                style={SMALL_BTN}
                onClick={async () => {
                  setLinkErr(null);
                  const r = await linkInstallQuoteAction(eng.id, installQuote.trim() || null);
                  if (r && "error" in r && r.error) {
                    setLinkErr(r.error);
                    return;
                  }
                  router.refresh();
                }}
              >
                {eng.installQuoteId ? "Update" : "Link"}
              </button>
              {iq && (
                <Link href={`/quotes?id=${encodeURIComponent(iq.id)}`} style={{ textDecoration: "none" }}>
                  <StatusPill tone={QUOTE_TONE[iq.status] || "gray"} minWidth={54}>
                    {QUOTE_LABEL[iq.status] || iq.status}
                  </StatusPill>
                </Link>
              )}
              {eng.installQuoteId && (
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>Peak's bid on this spec — a reference, never a conversion</span>
              )}
            </div>
            {linkErr && <div style={{ fontSize: 11.5, color: "#a0442b" }}>{linkErr}</div>}
```

**(b) Architect card** — new component after `PeopleCard` (line ~521), and rendered in the Overview auto-fit grid beside it (`<PeopleCard eng={eng} roster={data.roster} />` line 430 gains a sibling `<ArchitectCard eng={eng} />`):

```tsx
/** #35 minimal architect reference — two dumb strings, slated to migrate
 *  into item 20's people/roles model. */
function ArchitectCard({ eng }: { eng: ConsultingEngagement }) {
  const router = useRouter();
  const [company, setCompany] = useState(eng.architect?.company || "");
  const [contact, setContact] = useState(eng.architect?.contact || "");
  const [dirty, setDirty] = useState(false);
  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
        Architect
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        <input
          value={company}
          onChange={(e) => { setCompany(e.target.value); setDirty(true); }}
          placeholder="Architecture firm"
          style={INPUT}
        />
        <input
          value={contact}
          onChange={(e) => { setContact(e.target.value); setDirty(true); }}
          placeholder="Contact (name / email)"
          style={INPUT}
        />
        {dirty && (
          <button
            className="pk-btn-accent"
            style={{ justifySelf: "start" }}
            onClick={async () => {
              await setArchitectAction(eng.id, { company, contact });
              setDirty(false);
              router.refresh();
            }}
          >
            Save
          </button>
        )}
      </div>
    </Card>
  );
}
```

**(c) #25 label sweep** — module-name strings become "Consulting"; prose that names the RECORD keeps "engagement" (Jeff: plain relabel; spec: judgment). Exact edits:

| view.tsx line | before | after |
|---|---|---|
| 184 | `sub="Paid design & advisory engagements — quoted first; winning the quote opens the engagement."` | `sub="Consulting — Peak as the paid specifier. Sending the proposal opens the record at Proposal sent; any stage before Closed counts as active."` |
| 187 | `label="Active engagements"` | `label="Active consulting"` |
| 188 | `sub="all engagements"` | `sub="all consulting"` |
| 197 | `title="No engagements yet"` | `title="No consulting yet"` |
| 200-202 (EmptyState sub) | `…customer acceptance is the paid commitment, and the won quote opens the engagement here.` | `…sending the proposal opens the engagement here at Proposal sent; winning advances it to Awarded.` |
| 256 | `Engagement timeline` | `Consulting timeline` |
| 317 | `← All engagements` | `← All consulting` |

Deliberately KEPT (record-name prose): "Engagement paperwork" (Documents tab, 1251), "Engagement Lead" role (87), "Engagement not found." errors, the spec generator's "← Engagement" breadcrumb, the letter header's "Engagement:" id line. Also edit **`src/lib/venue-history-server.ts:140`**: `subtitle: "Engagement"` → `subtitle: "Consulting"`. Nav (`nav-data.ts:71`) already reads "Consulting" (D117) and every `design/engagements` page `metadata.title` already reads "Consulting — Quartzite-6" — verified, no edits.

- [ ] **Step 7: Quote-side chip — `src/app/(app)/quotes/page.tsx`**

Add to the imports: `import { getEngagementForQuoteRef, ENGAGEMENT_STATUS_LABEL } from "@/lib/stores/engagements";` (server component — store import is legal here). Resolve for the SELECTED quote only (after `const selectedId = one(sp.id);`, line 141 — never per-row):

```ts
  // #35 one-click both ways: the engagement referencing the selected quote
  // (as its source proposal OR as Peak's install bid). Selected row only.
  const selEng = selectedId ? await getEngagementForQuoteRef(selectedId) : null;
```

Thread it into the panel (line 645-653):

```tsx
              {selected && (
                <SelectedPanel
                  q={q}
                  me={me}
                  engagement={
                    selEng
                      ? { id: selEng.id, stage: ENGAGEMENT_STATUS_LABEL[selEng.status] }
                      : null
                  }
                  reviewerNames={reviewerRows
                    .filter((u) => u.name !== me && u.name !== q.owner)
                    .map((u) => u.name)}
                />
              )}
```

`SelectedPanel` (line 689) gains the prop and renders the chip in the meta row, right after `<QuoteRevisions …/>` (line 853-864):

```tsx
function SelectedPanel({
  q,
  me,
  engagement,
  reviewerNames,
}: {
  q: Quote;
  me: string;
  engagement: { id: string; stage: string } | null;
  reviewerNames: string[];
}) {
```

```tsx
        {engagement && (
          <Link
            href={`/design/engagements/${encodeURIComponent(engagement.id)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".03em",
              color: "#6b4fa1",
              background: "#f0ebf9",
              border: "1px solid #ddd2f0",
              padding: "3px 9px",
              borderRadius: 20,
              textDecoration: "none",
            }}
          >
            Engagement {engagement.id} · {engagement.stage}
          </Link>
        )}
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run test:specs` — clean, ALL PASSED (no count change this task).
Live spot-check: build a proposal with two scopes + ticked assumptions → save → total = scope sum; the company's open lead gained a system activity (or a new source-Consulting lead exists); quote detail in `/quotes` shows the engagement chip once sent.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: proposal builder rebuild — scopes, assumptions, auto-lead, architect, quote chips + #25 sweep (#35 task 5)"
```

---

### Task 6: Full verification, live drive, PUNCHLIST/DECISIONS, wrap up

**Files:**
- Modify: `PUNCHLIST.md` (#35, #25), `DECISIONS.md` (D123)

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit && npm run test:specs && npm run lint`
Expected: clean typecheck; ALL PASSED (count > 540 — record the new number); lint at the 73-error baseline (any delta explained in the report).

- [ ] **Step 2: Production build — KILL THE DEV SERVER FIRST (D106)**

Kill anything on :3000, then `npm run build`. Expected: clean. Restart the dev server after.

- [ ] **Step 3: Live acceptance drive**

1. **Legacy mapping:** `/design/engagements` — pre-rebuild engagements show mapped stages (an old `active` reads **Design**, `delivered` reads **Out to bid**, `bid_supported` reads **Construction admin**, `oversight_complete` reads **Closed**); KPI "Active consulting" counts every pre-Closed record.
2. **Proposal create + auto-lead dedupe:** build a proposal (2 scopes, ticked assumptions) for a company WITH an open lead → no new lead; the lead's timeline shows "Consulting proposal Q-#### created". Repeat for a company WITHOUT one → new L-#### with source "Consulting proposal", owner = you, value = scope total.
3. **Sent → Proposal sent:** submit for review → approve (second user via Reviews) → Send to customer → the engagement exists at **Proposal sent**; its milestones mirror the scopes (undated); the quote detail shows the "Engagement CE-####" chip.
4. **Won → Awarded → stage walk:** mark won → the engagement reads **Awarded**; walk the header select through Design → Out to bid → Construction admin → Closed; confirm the venue history row, `/design` Overview card, and a Grid project's spec-link agree with open/closed at each end state.
5. **Lost path:** second proposal → sent → lost → its engagement reads **Closed** with the "Proposal lost" decision on Overview/Meetings & Decisions.
6. **Letter:** `letter?kind=proposal` renders per-scope lines (title — description — fee), the scope-fee total, and the assumptions bullet list under "This proposal assumes:"; a PRE-rebuild quote's letter still renders its old single-paragraph scope + milestone table.
7. **Settings loop:** edit the assumptions library → the builder checklist reflects it; an already-saved proposal's letter still shows its frozen texts.
8. **Architect + install link:** save an architect on Overview; link a bogus quote id (inline error), a consulting quote id (inline error), then a real system Q- id (status chip appears; the quote's detail now chips back to the engagement).

- [ ] **Step 4: PUNCHLIST.md**

Update the two headings + append close-outs. #25 heading → `## 25. Rename the "Engagements" nav item to "Consulting" — DONE (2026-07-26, plan 06)`, appending:

```markdown
**CLOSED 2026-07-26 (plan 06).** The nav label itself had already read "Consulting"
since the D117 Q-6 rebrand (`nav-data.ts:71`); this plan swept the remaining
user-facing module-name strings — the Consulting list header/sub, KPI tiles,
roll-up title, "← All consulting" breadcrumb, builder banner copy, and the venue
history row subtitle. Prose naming the RECORD keeps "engagement" (paperwork card,
roles, error messages) per the spec's judgment note. URLs, nav keys, and the
`consulting_engagements` collection unchanged.
```

#35 heading → `## 35. Consulting proposal builder — structured scopes, checked assumptions, auto lead+estimate, architect + venue links — DONE (2026-07-26, plan 06; letter remap awaits Jeff's real letter)`, appending:

```markdown
**CLOSED 2026-07-26 (plan 06, D123) — with two Jeff-homework residuals.** Shipped:
six-stage lifecycle (Proposal sent → Awarded → Design → Out to bid → Construction
admin → Closed) with lazy legacy mapping and ONE open-definition; spawn on SENT
(proposal_sent), advance on won (awarded), close on lost-at-proposal_sent with a
"Proposal lost" decision; structured scopes (title/description/fee, total = scope
fees, milestones seed from scopes); Settings-editable assumptions checklist
(ticked texts frozen per proposal; letter renders them under the new
`assumptionsLead` field); auto-lead with open-lead dedupe (new "consulting"
LeadSource, payload stamps leadId); minimal architect {company, contact} on the
engagement (migrates into item 20 later); install-quote link validation + live
status chips engagement↔quote. **Residuals:** (1) `consulting_proposal` is still
the D90 boilerplate — remap to Peak's REAL letter when Jeff supplies it (spec §1
Homework 1); (2) `DEFAULT_CONSULTING_ASSUMPTIONS` is a DRAFT seed marked in-code
for the same replacement. The estimator's shared assumptions model (spec §4,
wave ③) consumes `consultingAssumptions`/`mergedConsultingAssumptions` as-is.
```

- [ ] **Step 5: DECISIONS.md**

Append:

```markdown
## D123 — Consulting rebuilt: six stages, sent-spawn, structured proposals (2026-07-26)

Implements spec §1 (2026-07-25 remaining-items sheet), closing 13-D and punch
items 35 + 25. Shapes and seams:

- **Six-stage lifecycle** `proposal_sent → awarded → design → out_to_bid →
  construction_admin → closed` in the dependency-free `lib/consulting-stages.ts`
  (client-bundled + server-trusted + harness-imported). `EngagementStatus` is
  now an alias of `EngagementStage`; `ENGAGEMENT_STATUS_LABEL` kept its export
  name so consumers survived unchanged.
- **Lazy migration:** `LEGACY_STATUS_MAP` = active→design, delivered→out_to_bid,
  bid_supported→construction_admin, oversight_complete→closed. Store reads
  normalize; `patchEngagement` upgrades the stored literal on the doc's next
  write; unknown strings land on "design". No bulk rewrite.
- **ONE open-definition** (D113.11 carry-over: everything before Closed is
  open): `isOpenEngagement` lives in consulting-stages, re-exported through
  consulting-review; venue-match's zero-import duplicate list is spec-pinned in
  agreement; the grid page's inline check now imports the rule. This also FIXED
  venue-match, which still said `["active","bid_supported"]` against D113.
- **Spawn model:** engagements are born when the consulting quote is SENT (at
  proposal_sent, `ensureEngagementForQuote` hooked in setQuoteStatus), advance
  to awarded on won (only from proposal_sent — a human-moved stage is never
  touched), and close on lost-at-proposal_sent with a "Proposal lost" decision
  entry. All routes through the idempotent `syncEngagementsFromQuotes` (rebuilt
  over the pure `engagementSyncAction`; still the fifth on-win sync), which
  `loadConsultingData` also runs as the safety net (the projects idiom) because
  estimator/inbox status paths never call syncs. `createFromQuote` deleted
  (zero callers).
- **Proposal payload (additive):** `scopes[]` ({id "sc-", title, description,
  fee}; quote value = scope total; engagement milestones seed name=title,
  amount=fee, targetDate 0 — the Reports billing forecast filters
  targetDate>0, so it is unaffected), `assumptions[]` (ticked library texts
  frozen at save), `leadId`. Legacy scope/feeMode/fees stay on the type;
  pre-rebuild quotes render read-only in the builder and keep their old letter
  layout.
- **Assumptions library:** `AppSettingsData.consultingAssumptions` +
  `mergedConsultingAssumptions` (visitReasons idiom), admin card in Settings,
  DRAFT 10-line seed pending Peak's real letter. Template gained the additive
  `assumptionsLead` field ("This proposal assumes:"). This is the seam the
  estimator's §4 assumptions model consumes in wave ③.
- **Auto-lead with dedupe:** proposal CREATE links the company's open lead
  (system activity "Consulting proposal Q-#### created") or creates one —
  new closed-union LeadSource literal `"consulting"` (without it, create()
  silently coerces to "manual").
- **Architect:** minimal `{company, contact} | null` on the engagement, dumb by
  design — migrates into item 20's people/roles model.
- **Peak as bidder:** `installQuoteId` kept; the link now validates existence +
  non-consulting, and status chips run both directions (Overview shows the
  install quote's stage; the Quotes detail chips the engagement via
  `getEngagementForQuoteRef`, selected row only).
- **#25:** display-string sweep only; nav already said "Consulting" (D117).
  URLs/keys/collection names unchanged.
```

- [ ] **Step 6: Commit and merge**

```bash
git add -A && git commit -m "docs: punchlist #35/#25 done + D123 — consulting rebuild complete"
```

Then merge `consulting-rebuild` → `main` per the finishing-a-development-branch skill (Jeff's standing single-dev flow).

---

## Self-Review (done at authoring time)

- **Spec §1 coverage:** lifecycle ladder + labels verbatim (Task 1); "existing engagements map onto the new ladder" = lazy `LEGACY_STATUS_MAP` (Task 1); D113.11 carry-over as the single open rule incl. the venue-match contradiction fix (Task 1); Peak-as-bidder formal link + one-click both ways (Tasks 3/5); #35 A scopes (Tasks 3/5), B assumptions checklist w/ settings pattern (Tasks 4/5), C document = extend existing template, NOT the real-letter remap (Task 4 + residual flagged in PUNCHLIST close-out), D auto-lead deduped (Task 5), E minimal architect (Tasks 3/5); #25 relabel, URLs unchanged, changes enumerated (Task 5 Step 6c). Spawn model (sent/won/lost) per the brief's controller decisions (Task 2). Reports forecast noted unaffected (targetDate-0 seeds).
- **Legacy-mapping completeness:** all four old literals mapped and spec-pinned (`Object.keys(LEGACY_STATUS_MAP)` assertion). Repo-wide grep for `active|delivered|bid_supported|oversight_complete` in engagement context found exactly: store union+labels (rebuilt), view.tsx dup maps (deleted), venue-match list (updated), grid inline check (replaced), harness 942-946 (updated exact-literal), venues humanizer (generic snake→sentence — verified compatible, untouched). `"delivered"` elsewhere in the repo is the projects vocabulary (`delivery`), not engagements.
- **Harness stale-literal grep:** engagement-status literals appear ONLY at lines 942-946 (updated in Task 1 Step 1 — exact-literal, never weakened); line 67's `"active"` is an EngagementPhase status (distinct vocabulary, untouched); line 267 is a nav key. Baselines verified by running: **540 PASS**, lint **73 errors/1618 warnings**.
- **Cross-task names:** `consulting-stages` exports consumed under the same identifiers everywhere (`ENGAGEMENT_STAGE_KEYS` in the actions allowlist, `engagementSyncAction` in the sweep, `milestoneSeeds`/`scopesTotal` in store/letter/actions, `mergedConsultingAssumptions` in quote/page + settings/page); `assumptionsMenu` prop matches loader↔builder; `setArchitectAction`/`getEngagementForQuoteRef`/`ensureEngagementForQuote` defined before use; `BuilderInitial` reshape matched between page.tsx and controls.tsx.
- **Client-bundle audit:** view.tsx/controls.tsx new value-imports are consulting-stages (zero-import) and existing UI/action modules only; quotes/page.tsx + settings/page.tsx store imports are server components; the quote-status label/tone maps are restated locally in view.tsx because `stores/quotes` values are client-forbidden.
- **Idempotence audit:** `engagementSyncAction` is pure/total with no-op fixed points (spec-tested); `ensureEngagementForQuote` re-entry safe; the lost path can't double-log "Proposal lost" (the first pass moves the stage off proposal_sent).
- **Placeholder scan:** no TODO/TBD/placeholder code paths; the two deliberate DRAFT items (assumptions seed, template wording) are marked in-code and in the PUNCHLIST residuals as Jeff homework, per the brief's instruction not to remap the letter.
- **Known accepted costs** (logged, not bugs): editing a PRE-rebuild proposal requires re-entering its content as structured scopes (read-only panel shows the original; revisions keep history); `getEngagementForQuoteRef` is a full scan but runs for the selected quote only; the sent-quote hook also fires for consulting quotes sent via the Quotes hub only — estimator/inbox paths are covered by the loadConsultingData sweep (the deliberate safety-net design).
