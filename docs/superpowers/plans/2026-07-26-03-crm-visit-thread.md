# CRM Plan 03 — Lead → Visit → Survey → Estimate Thread Implementation Plan (#34)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the three disconnected hops of the sales pipeline into one thread (#34): a "Request site visit" button on the lead that creates a claimable `SiteVisit` (lifecycle `requested / open / claimed / scheduled / done` + `leadId`) AND auto-creates the linked Survey at stage `requested`; a claim/schedule flow on the LEAD claim model (any `requireUser`, no approver gate) that dispatches the existing D77 invite/calendar machinery on schedule; open-visit queue surfaces (`/field-survey` "Visit requests" section, My Queue source, nav bell group); the lead drawer surfacing visit + survey status; and a SERVER-SIDE convert gate — lead→customer conversion refuses until the linked survey is completed, unless explicitly skipped (with the skip logged).

**Architecture:** No new collection and no migration — the existing `site_visits` doc store (NOT syncable; server-action writes only — stays that way) gains lifecycle fields normalized on read: `deriveVisitStage` (pure, spec-covered) backfills legacy stage-less docs from their times, and stored `"scheduled"` past its `endAt ?? startAt` reads as `"done"`. The record loosens — `startAt`/`endAt` `number | null` (null until scheduled), `customerId` `string | null` (lead-borne requests may pre-date the customer), `assignedTo` may be `""` until claimed — so every consumer of those fields goes null-safe in the same task as the type change (per-task `tsc` gates force it). All pure logic (`VISIT_STAGES`, `deriveVisitStage`, `requestStageFor`, `canConvertLead`, stage chip colors) lives in a dependency-free `src/lib/lead-thread.ts` so the client drawer, the server stores and the spec harness consume the same module. Surveys gain `leadId`/`visitId` through the `blank()` whitelist (fields not in the def object are SILENTLY DROPPED — all three sites edited: `SurveyDraft`, `blank()` def, `SurveyPatch`). The D77 Google-Calendar-else-ICS invite block is EXTRACTED behavior-preserving from `createSiteVisitAction` into `src/lib/visit-invite.ts` so the new `scheduleVisitAction` and the inbox creator share one path. The convert gate lives in `convertLeadAction` (least ripple — `convert()` in leads.ts is untouched and keeps its null contract); the action resolves the linked survey via the lead's active visit's `surveyId` and returns `{ ok: false, reason }`, which `doConvert` now reads (today it discards the result — fixed).

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle + PGlite/Postgres jsonb doc-store + relational identity core, hand-rolled `tsx` test harness.

## Global Constraints

- **Branch:** `crm-03-visit-thread` off `main` (plan 02 merged at `b4edc11`).
- **Doc-store idiom:** domain records are whole-JSON docs; no DB-level foreign keys (D85); all timestamps are epoch-ms `number`s. Existing docs won't carry new fields — `site_visits` reads pass through `normalizeVisit` (backfills stage + nulls), survey link fields are **read with `?? null`**. No backfill migration.
- **Client-bundle rule:** `"use client"` files may only `import type` from any module that reaches `src/db/doc-store.ts` — a value import pulls PGlite into the browser bundle and fails `npm run build` (not tsc). Server actions are exempt (they compile to reference stubs) and are passable as client-component props. `src/lib/lead-thread.ts` is dependency-free and client-safe by construction.
- **All writes go through `requireUser()`-checked server actions** (`@/lib/session`). Visit claim follows the LEAD model (`claimLeadAction` — assign-to-self, NO permission gate; the review-claim `requireApprover` pattern is deliberately NOT used: field techs claim visits). No `claimedAt` timestamp exists anywhere in the app — do not invent one; stage + `updatedAt` suffice.
- **The convert gate is server-side.** The drawer's disabled button is UX only; `convertLeadAction` re-checks `canConvertLead` on every call.
- **URL-as-state** for every list filter (no new params added by this plan; existing `/field-survey` params untouched).
- **nav-counts.ts single-batch rule:** the file forbids extra scans — this plan adds exactly ONE parallel fetch (`allVisits()`) to the existing `Promise.all` and NO new `NavCounts` key (no badge; bell group only).
- **Never run `npm run build` while a dev server is running** (PGlite is single-process; D106). A dev server IS running on :3000 — it stays up for live checks in Tasks 2–5; Task 6 kills it before the build and restarts it after.
- **Tests:** append `ok(cond, "msg")` assertions to `scripts/test-review-and-spec.ts` (single-file harness, **438 PASS today**; mid-file imports are fine under tsx; assert exact literals, no DB access — `blank()` from surveys is pure and safe to import). Insert new sections immediately BEFORE the final two lines (`console.log(fail ? ...)` / `process.exit(...)`). Run: `npm run test:specs`. Typecheck: `npx tsc --noEmit`. Both gates per task. `npm run lint` baseline is 70 warnings — net-zero goal.
- **Sync mirror rule:** `SYNCABLE_COLLECTIONS` (src/db/doc-tables.ts) and `FIELD_COLLECTIONS` (src/lib/sync/engine.ts) stay untouched — `site_visits` remains non-syncable (server-action writes only); survey editor mutations keep riding `saveThroughOutbox` (don't touch that path).

---

### Task 1: Pure thread model `src/lib/lead-thread.ts` + #34 spec section (TDD)

**Files:**
- Create: `src/lib/lead-thread.ts`
- Test: `scripts/test-review-and-spec.ts` (append the `LEAD THREAD (#34)` section)

**Interfaces:**
- Consumes: nothing — zero imports; client-safe on either side of the boundary.
- Produces (later tasks rely on these exact names):
  - `VISIT_STAGES` (5 literals), `type VisitStage`, `VISIT_STAGE_META` (label + ink/soft/bd per stage)
  - `deriveVisitStage(v, nowMs)` — normalize-on-read for the store
  - `requestStageFor(assignee)` — the assign-or-open stage choice
  - `canConvertLead(survey, skip)` + `type ConvertGate` — the convert gate, all four branches

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts`, immediately before the final two lines (`console.log(fail ? ...)` / `process.exit(...)`):

```ts
/* ============ LEAD THREAD (#34) — visit lifecycle + convert gate ============ */
import {
  VISIT_STAGES, VISIT_STAGE_META, deriveVisitStage, requestStageFor, canConvertLead,
} from "@/lib/lead-thread";

{
  const NOW = 1_800_000_000_000;
  const DAY = 86400000;

  ok(
    VISIT_STAGES.join(",") === "requested,open,claimed,scheduled,done",
    "#34: visit lifecycle is the locked five-stage set"
  );
  ok(
    VISIT_STAGE_META.requested.label === "Requested" &&
      VISIT_STAGE_META.open.label === "Open — unclaimed" &&
      VISIT_STAGE_META.claimed.label === "Claimed" &&
      VISIT_STAGE_META.scheduled.label === "Scheduled" &&
      VISIT_STAGE_META.done.label === "Done",
    "#34: visit stage labels"
  );

  // deriveVisitStage — legacy stage-less records read from their times
  ok(
    deriveVisitStage({ startAt: NOW - 2 * DAY, endAt: NOW - 2 * DAY + 3600000 }, NOW) === "done",
    "#34: legacy stage-less past visit reads done"
  );
  ok(
    deriveVisitStage({ startAt: NOW + DAY, endAt: NOW + DAY + 3600000 }, NOW) === "scheduled",
    "#34: legacy stage-less future visit reads scheduled"
  );
  // stored "scheduled" past its (endAt ?? startAt) reads done
  ok(
    deriveVisitStage({ stage: "scheduled", startAt: NOW - DAY, endAt: NOW - DAY + 3600000 }, NOW) === "done",
    "#34: stored scheduled with a past end reads done"
  );
  ok(
    deriveVisitStage({ stage: "scheduled", startAt: NOW - DAY, endAt: null }, NOW) === "done",
    "#34: endAt ?? startAt — null end falls back to start"
  );
  ok(
    deriveVisitStage({ stage: "scheduled", startAt: NOW + DAY, endAt: NOW + 2 * DAY }, NOW) === "scheduled",
    "#34: stored scheduled in the future stays scheduled"
  );
  // stored requested/open/claimed/done pass through untouched
  ok(deriveVisitStage({ stage: "requested", startAt: null, endAt: null }, NOW) === "requested", "#34: requested passes through");
  ok(deriveVisitStage({ stage: "open", startAt: null, endAt: null }, NOW) === "open", "#34: open passes through");
  ok(deriveVisitStage({ stage: "claimed", startAt: null, endAt: null }, NOW) === "claimed", "#34: claimed passes through");
  ok(deriveVisitStage({ stage: "done", startAt: NOW + DAY, endAt: null }, NOW) === "done", "#34: stored done never resurrects");

  // assign-or-open stage choice
  ok(requestStageFor("Sam Rivera") === "claimed", "#34: request with an assignee lands claimed");
  ok(requestStageFor("") === "requested" && requestStageFor("   ") === "requested", "#34: open — anyone can claim lands requested");

  // convert gate — all four branches
  const missing = canConvertLead(null, false);
  ok(!missing.ok && missing.reason === "survey-missing", "#34: no linked survey blocks convert");
  const openGate = canConvertLead({ stage: "onsite" }, false);
  ok(!openGate.ok && openGate.reason === "survey-open", "#34: un-completed survey blocks convert");
  ok(canConvertLead({ stage: "completed" }, false).ok, "#34: completed survey passes the gate");
  ok(canConvertLead(null, true).ok && canConvertLead({ stage: "requested" }, true).ok, "#34: explicit skip always passes");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs`
Expected: the run errors (module `@/lib/lead-thread` does not exist yet).

- [ ] **Step 3: Write the model**

Create `src/lib/lead-thread.ts`:

```ts
/**
 * Lead → visit → survey → estimate thread (#34) — PURE helpers, zero imports.
 * The design-spec answer (specs/2026-07-25-remaining-items-decisions-design.md
 * §3 #34): SiteVisit gains a lifecycle + leadId, requesting a visit auto-
 * creates the linked Survey, and lead→customer convert is gated on that
 * survey. This module is dependency-free so the "use client" drawer, the
 * server stores and the spec harness all consume the same logic.
 *
 * Lifecycle semantics:
 *   requested — born from a lead's visit request with assign "Open — anyone"
 *   open      — an existing visit explicitly released back to the pool
 *   claimed   — assignedTo set, no schedule yet (request-with-assignee lands here)
 *   scheduled — has startAt/endAt (the inbox create path lands here)
 *   done      — derived/stored past
 */

export const VISIT_STAGES = ["requested", "open", "claimed", "scheduled", "done"] as const;
export type VisitStage = (typeof VISIT_STAGES)[number];

export interface VisitStageMeta {
  label: string;
  ink: string;
  soft: string;
  bd: string;
}

/** Chip colors follow the survey STAGE_META families (amber/blue/purple/green)
 *  so the two thread chips read as one system in the drawer. */
export const VISIT_STAGE_META: Record<VisitStage, VisitStageMeta> = {
  requested: { label: "Requested", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  open: { label: "Open — unclaimed", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" },
  claimed: { label: "Claimed", ink: "#7b3f8a", soft: "#f3eaf5", bd: "#e6d3ea" },
  scheduled: { label: "Scheduled", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  done: { label: "Done", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};

/**
 * Normalize-on-read for site-visit docs. Stored requested/open/claimed/done
 * pass through; stored "scheduled" whose (endAt ?? startAt) is past reads as
 * "done"; legacy stage-less docs (every pre-#34 record — they always carry
 * times) derive done/scheduled from the same rule.
 */
export function deriveVisitStage(
  v: { stage?: string | null; startAt: number | null; endAt: number | null },
  nowMs: number
): VisitStage {
  const s = v.stage;
  if (s === "requested" || s === "open" || s === "claimed" || s === "done") return s;
  const t = v.endAt ?? v.startAt;
  if (t != null && t < nowMs) return "done";
  return "scheduled";
}

/** Assign-or-open: a request with an assignee is born claimed; an open one
 *  is born requested (anyone can claim it from the pool). */
export function requestStageFor(assignee: string): "claimed" | "requested" {
  return assignee.trim() ? "claimed" : "requested";
}

export type ConvertGate =
  | { ok: true }
  | { ok: false; reason: "survey-missing" | "survey-open" };

/**
 * The convert gate (#34, decision D): lead → customer refuses until the
 * linked survey is COMPLETED, unless explicitly skipped. Tolerance note:
 * survey stage pills allow jumping backwards; this reads the CURRENT stage
 * at convert time — that's fine, the gate is a snapshot check.
 */
export function canConvertLead(
  survey: { stage: string } | null,
  skip: boolean
): ConvertGate {
  if (skip) return { ok: true };
  if (!survey) return { ok: false, reason: "survey-missing" };
  if (survey.stage !== "completed") return { ok: false, reason: "survey-open" };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:specs` — all new `#34:` lines PASS; suite ends `ALL PASSED`.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lead-thread.ts scripts/test-review-and-spec.ts
git commit -m "feat: pure lead-thread model — visit lifecycle, assign-or-open, convert gate (#34)"
```

---

### Task 2: SiteVisit lifecycle in the store + null-safety sweep across every consumer

**Files:**
- Modify: `src/lib/stores/site-visits.ts` (type, normalize-on-read, new reads + mutators)
- Modify: `src/app/(app)/inbox/site-visit-actions.ts` (stamp the new fields — inputs unchanged)
- Modify: `src/lib/agenda.ts` (skip null startAt; null-safe href)
- Modify: `src/lib/venue-history-server.ts` (bump site + history rows)
- Modify: `src/app/(app)/companies/[id]/page.tsx` (visit card: stage chip; null start renders the stage/timing instead of a date)
- Modify: `src/app/(app)/design/engagements/data.ts` (exclude unscheduled visits from `VisitLite`)

**Interfaces:**
- Consumes: `deriveVisitStage`, `type VisitStage` from Task 1.
- Produces: widened `SiteVisit` (`stage: VisitStage`, `leadId/surveyId: string | null`, `preferredTiming: string`, `startAt/endAt: number | null`, `customerId: string | null`); `getVisit(id)`, `visitsForLead(leadId)`, `activeVisitForLead(leadId)`; `claimVisit(id, me)`, `releaseVisit(id)`, `scheduleVisit(id, startAt, endAt)`.

Note: the per-task `tsc` gate is why the type change and the consumer sweep are ONE task — loosening `startAt: number | null` breaks `agenda.ts`, `venue-history-server.ts`, `engagements/data.ts` and the companies card the moment the type lands. The recon-verified consumer list is complete: those four plus the inbox action (the ONLY create path today).

- [ ] **Step 1: The store**

In `src/lib/stores/site-visits.ts`:

1. Change the import block at the top to:

```ts
import { getDoc, listDocs, nextPrefixedId, patchDoc, upsertDoc } from "@/db/doc-store";
import { deriveVisitStage, requestStageFor, type VisitStage } from "@/lib/lead-thread";
```

(`requestStageFor` is consumed by Task 3's `requestVisitForLead`; importing it now is harmless — if the linter flags it as unused at this gate, add it in Task 3 instead.)

2. Replace the whole `export type SiteVisit = { … };` block (lines 21–44) with:

```ts
export type SiteVisit = {
  id: string; // 'SV-####'
  /** null while the visit is a lead-borne request that pre-dates the
   *  customer record (#34). Pre-#34 docs always carry one. */
  customerId: string | null;
  customer: string; // denormalized name (lead requests: the lead's org)
  locationId: string | null;
  venue: string; // denormalized venue label
  address: string; // street + city/state at time of scheduling
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  reason: string; // one of the Settings picklist values
  /** epoch-ms; null until scheduled (#34). Pre-#34 docs always carry both. */
  startAt: number | null;
  endAt: number | null;
  notes: string;
  /** team-member NAME (app convention); "" until claimed (#34). */
  assignedTo: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  invite?: SiteVisitInvite | null;
  googleEventId?: string; // phase 2
  /** Optional consulting-engagement link (D90) — oversight visits list
   *  under the engagement's Oversight tab. */
  engagementId?: string | null;
  /** #34 lifecycle — requested/open/claimed/scheduled/done. Backfilled on
   *  read (normalizeVisit → deriveVisitStage) for pre-#34 docs, and a
   *  stored "scheduled" past its end reads as "done". */
  stage: VisitStage;
  /** The lead this visit was requested from (#34); null for inbox-born visits. */
  leadId: string | null;
  /** The auto-created linked Survey (#34); null for inbox-born visits. */
  surveyId: string | null;
  /** Free-text preferred timing captured on the lead's request form (#34). */
  preferredTiming: string;
};
```

3. Immediately after `mergedVisitReasons` (below its closing brace), add:

```ts
/** Normalize-on-read (#34): backfill the lifecycle fields on pre-#34 docs
 *  and derive stage (a stored "scheduled" past its end reads "done"). */
function normalizeVisit(v: SiteVisit): SiteVisit {
  v.startAt = v.startAt ?? null;
  v.endAt = v.endAt ?? null;
  v.customerId = v.customerId ?? null;
  v.stage = deriveVisitStage(v, Date.now());
  v.leadId = v.leadId ?? null;
  v.surveyId = v.surveyId ?? null;
  v.preferredTiming = v.preferredTiming ?? "";
  return v;
}
```

4. Replace `allVisits` with (null startAt sorts to the bottom via `|| 0` — unscheduled requests trail the dated list, which every existing consumer sorts through):

```ts
export async function allVisits(): Promise<SiteVisit[]> {
  const list = await listDocs<SiteVisit>("site_visits");
  return list.map(normalizeVisit).sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
}
```

5. After `visitsForEngagement` (below its closing brace), add:

```ts
export async function getVisit(id: string): Promise<SiteVisit | null> {
  const v = await getDoc<SiteVisit>("site_visits", id);
  return v ? normalizeVisit(v) : null;
}

export async function visitsForLead(leadId: string): Promise<SiteVisit[]> {
  return (await allVisits()).filter((v) => v.leadId === leadId);
}

/** The lead's one ACTIVE visit (stage not "done") — the request-dedupe and
 *  drawer-thread read. */
export async function activeVisitForLead(leadId: string): Promise<SiteVisit | null> {
  return (await visitsForLead(leadId)).find((v) => v.stage !== "done") ?? null;
}
```

6. At the end of the file (after `stampGoogleEvent`), add the lifecycle mutators:

```ts
/* ---- #34 lifecycle mutations (the LEAD claim model — no approver gate) ---- */

/** Claim: assign-to-self. No claimedAt anywhere in the app — stage +
 *  updatedAt suffice (house rule). */
export async function claimVisit(id: string, me: string): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.assignedTo = me;
    d.stage = "claimed";
    d.updatedAt = Date.now();
  });
}

/** Release an existing visit back to the pool — stage "open" (distinct from
 *  "requested" = born open, per the lifecycle semantics). */
export async function releaseVisit(id: string): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.assignedTo = "";
    d.stage = "open";
    d.updatedAt = Date.now();
  });
}

export async function scheduleVisit(id: string, startAt: number, endAt: number): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.startAt = startAt;
    d.endAt = endAt;
    d.stage = "scheduled";
    d.updatedAt = Date.now();
  });
}
```

- [ ] **Step 2: Inbox create path stamps the new fields (inputs unchanged)**

In `src/app/(app)/inbox/site-visit-actions.ts`, the `createVisit({ … })` call (lines 78–94) still requires times (validation at 62–65 unchanged). Add four lines after `engagementId: input.engagementId || null,`:

```ts
    engagementId: input.engagementId || null,
    stage: "scheduled",
    leadId: null,
    surveyId: null,
    preferredTiming: "",
```

(The inbox path keeps landing at "scheduled" — its validation guarantees times.)

- [ ] **Step 3: agenda.ts (lines 74–89) — skip unscheduled, null-safe href**

In `src/lib/agenda.ts`, replace the `for (const v of await allVisits()) { … }` loop with:

```ts
  for (const v of await allVisits()) {
    if (v.assignedTo !== me) continue;
    // #34: unscheduled requests (null startAt) have no agenda slot yet.
    if (v.startAt == null) continue;
    const endMs = v.endAt ?? v.startAt;
    if (endMs < minMs || v.startAt > maxMs) continue;
    if (v.googleEventId && fetchedIds.has(v.googleEventId)) continue;
    if (fetchedIcal.has("sv-" + v.id + "@peak-app")) continue;
    items.push({
      key: "v-" + v.id,
      title: (v.venue || v.customer) + " — " + v.reason,
      startMs: v.startAt,
      endMs,
      allDay: false,
      location: v.address,
      href: v.customerId ? "/companies/" + encodeURIComponent(v.customerId) : "",
      source: "visit",
    });
  }
```

(`href: ""` = not clickable, per the `AgendaItem` contract at the top of the file.)

- [ ] **Step 4: venue-history-server.ts — the bump site (:74) and the history rows (:169–176)**

In `src/lib/venue-history-server.ts`, replace the visits bump line (line 74, keeping its comment at 71–73):

```ts
  for (const v of visits) {
    // #34: lead-borne requests may carry no customer / no schedule yet.
    if (v.customerId == null || v.startAt == null) continue;
    bump(v.customerId, v.locationId, Math.min(v.startAt, dirNow));
  }
```

And in `loadVenueHistory`, replace the visits loop (the `const now = Date.now();` line stays; lines 170–176) with:

```ts
  for (const v of visits.filter((r) => docMatchesVenue(r, companyId, locId))) {
    // #34: unscheduled requests sort by creation and read open via their stage.
    rows.push({
      id: v.id, kind: "visit", title: v.reason || v.venue || v.id, subtitle: "Site visit",
      ts: v.startAt ?? v.createdAt,
      status: v.startAt == null ? v.stage : v.startAt >= now ? "upcoming" : "past",
      open: v.startAt == null ? v.stage !== "done" : v.startAt >= now,
      href: v.engagementId ? "/design/engagements/" + encodeURIComponent(v.engagementId) : "/calendar",
    });
  }
```

(`docMatchesVenue` takes `{ customerId?: string | null; locationId?: string | null }` — a null customerId simply never matches; no signature change needed.)

- [ ] **Step 5: Companies page visit card (lines 529–550) — stage chip + null-safe date**

In `src/app/(app)/companies/[id]/page.tsx`:

1. Add to the imports (after the line `import { visitsForCustomer } from "@/lib/stores/site-visits";`):

```ts
import { VISIT_STAGE_META } from "@/lib/lead-thread";
```

2. Replace the card's row map (the `{visits.slice(0, 6).map((v) => (` … `))}` block inside the `{/* ---- site visits (D76) — scheduled from the Inbox ---- */}` card) with:

```tsx
                {visits.slice(0, 6).map((v) => {
                  const sm = VISIT_STAGE_META[v.stage];
                  return (
                    <div key={v.id} style={{ padding: "8px 0", borderTop: "1px solid #f3f4f7" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, minWidth: 0 }}>
                          {v.reason}
                          {v.venue ? " · " + v.venue : ""}
                        </div>
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: sm.ink,
                            background: sm.soft,
                            border: `1px solid ${sm.bd}`,
                            padding: "1px 7px",
                            borderRadius: 20,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {sm.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>
                        {v.startAt != null
                          ? new Date(v.startAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                          : v.preferredTiming || "Not scheduled yet"}
                        {v.assignedTo ? " · " + v.assignedTo : " · unclaimed"}
                        {v.invite?.sentAt ? " · invite sent" : ""}
                      </div>
                    </div>
                  );
                })}
```

3. Update the section comment two lines above the card from `{/* ---- site visits (D76) — scheduled from the Inbox ---- */}` to `{/* ---- site visits (D76/#34) — Inbox-scheduled + lead-requested ---- */}`.

- [ ] **Step 6: Consulting `VisitLite` — exclude unscheduled visits**

In `src/app/(app)/design/engagements/data.ts`, replace the `visitLites` builder (lines 73–83) with:

```ts
  const visitLites: VisitLite[] = visits
    // #34: unscheduled lead requests (null startAt) don't ride the consulting
    // Oversight timeline until scheduled — VisitLite stays non-nullable.
    .filter(
      (v: SiteVisit) =>
        v.startAt != null && (v.engagementId || (v.customerId != null && companyIds.has(v.customerId)))
    )
    .map((v: SiteVisit) => ({
      id: v.id,
      customerId: v.customerId || "",
      reason: v.reason,
      venue: v.venue,
      startAt: v.startAt ?? 0,
      assignedTo: v.assignedTo,
      engagementId: v.engagementId || null,
    }));
```

(`VisitLite`'s type and every consumer in `view.tsx` — the timeline math at :527/:549, the Oversight rows at :1221/:1232, the link candidates at :1166 — stay byte-identical. Filtering here is deliberately narrower than making `startAt` nullable; see the plan's deviations note.)

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED` (438 + Task 1's lines).

Live check (dev server on :3000): Inbox → schedule a site visit from a thread (existing modal) → succeeds; the company page card shows the visit with a "Scheduled" chip; Home agenda still shows it; nothing else changed.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/site-visits.ts src/app/\(app\)/inbox/site-visit-actions.ts src/lib/agenda.ts src/lib/venue-history-server.ts src/app/\(app\)/companies src/app/\(app\)/design/engagements/data.ts
git commit -m "feat: SiteVisit lifecycle fields + normalize-on-read + null-safe consumer sweep (#34)"
```

---

### Task 3: Survey linkage + request orchestration + invite extraction + claim/schedule actions

**Files:**
- Modify: `src/lib/stores/surveys.ts` (`leadId`/`visitId` through `SurveyDraft` + `blank()` def; `surveysForLead`)
- Modify: `src/app/(app)/field-survey/[id]/actions.ts` (`SurveyPatch` whitelist)
- Modify: `src/lib/stores/site-visits.ts` (`requestVisitForLead` orchestration)
- Create: `src/lib/visit-invite.ts` (`dispatchVisitInvite` — extracted D77 block)
- Modify: `src/app/(app)/inbox/site-visit-actions.ts` (delegate to the extraction — behavior-preserving)
- Create: `src/app/(app)/field-survey/visit-actions.ts` (claim / release / schedule server actions)
- Modify: `src/app/(app)/leads/actions.ts` (`requestSiteVisitAction`)
- Test: `scripts/test-review-and-spec.ts` (append to the `LEAD THREAD (#34)` section)

**Interfaces:**
- Consumes: `requestStageFor` (Task 1); `claimVisit`/`releaseVisit`/`scheduleVisit`/`getVisit`/`allVisits`/`createVisit` (Task 2); `create` + `blank` from surveys; `logActivity`/`get` from leads; `requireUser`.
- Produces: `SurveyDraft.leadId/visitId: string | null`; `surveysForLead(leadId)`; `requestVisitForLead(lead, opts, me)` → `{ ok: true, visitId, surveyId } | { ok: false, reason: "exists", visitId }`; `dispatchVisitInvite(rec, me)` → `InviteStatus`; server actions `claimVisitAction(id)`, `releaseVisitAction(id)`, `scheduleVisitAction(id, { startAt, endAt })`, `requestSiteVisitAction(id, { reason, timing, assignee })`.

Bell note (no code): the auto-created survey is born at stage `"requested"`, so it AUTOMATICALLY rides the existing `counts.field` badge and the "Survey requests to schedule" bell group (nav-counts.ts:93–95 counts `stage === "requested"`). That is intended — the survey side of the thread surfaces through the machinery that already exists.

- [ ] **Step 1: Failing specs for the survey link fields**

Append INSIDE the `LEAD THREAD (#34)` region of `scripts/test-review-and-spec.ts` (directly after Task 1's closing `}`, still before the final two lines):

```ts
/* #34 — the auto-created survey's link fields ride blank()'s whitelist
   (fields not in the def object are SILENTLY DROPPED — this proves the def
   carries them). blank() is pure — no DB touched. */
import { blank as surveyBlank } from "@/lib/stores/surveys";

{
  const b = surveyBlank();
  ok(b.leadId === null && b.visitId === null, "#34: blank survey defaults null lead/visit links");
  ok(b.stage === "requested", "#34: blank survey is born requested");
  const linked = surveyBlank({ leadId: "L-1050", visitId: "SV-5001" });
  ok(linked.leadId === "L-1050" && linked.visitId === "SV-5001", "#34: blank() whitelist passes leadId/visitId through");
}
```

Run: `npm run test:specs` — the two new `blank` assertions FAIL (fields dropped by the whitelist).

- [ ] **Step 2: Surveys store — the three whitelist sites + `surveysForLead`**

In `src/lib/stores/surveys.ts`:

1. In `interface SurveyDraft`, after the `intakeReady: boolean; // explicit "ready for quote" flag` member, add:

```ts
  // ---- Lead thread (#34): the visit request that spawned this survey ----
  leadId: string | null;
  visitId: string | null;
```

2. In `blank()`'s internal `def` object, after `intakeReady: false,` add:

```ts
    leadId: null,
    visitId: null,
```

3. After `pending()` (below its closing brace, still in the reads section), add:

```ts
/** Surveys linked to a lead (#34) — newest first (getAll is updatedAt-desc). */
export async function surveysForLead(leadId: string): Promise<SurveyRecord[]> {
  return (await getAll()).filter((s) => (s.leadId ?? null) === leadId);
}
```

In `src/app/(app)/field-survey/[id]/actions.ts`, add two members to the `SurveyPatch` Pick union, after `| "intakeReady"`:

```ts
    | "leadId"
    | "visitId"
```

Run: `npm run test:specs` — the `blank` assertions now PASS.

- [ ] **Step 3: `requestVisitForLead` orchestration in the store**

In `src/lib/stores/site-visits.ts`, append at the end of the file:

```ts
/* ---- #34 request orchestration (lead drawer's "Request site visit") ---- */

export type VisitRequestOpts = { reason: string; timing: string; assignee: string };

export type VisitRequestResult =
  | { ok: true; visitId: string; surveyId: string }
  | { ok: false; reason: "exists"; visitId: string };

/**
 * Create the visit request + the auto-linked Survey (#34, decision C).
 * Dedupe FIRST: one active (non-done) visit per lead. The visit is born
 * claimed or requested per assign-or-open; the Survey is born "requested"
 * (it rides the existing field badge + "Survey requests to schedule" bell
 * group automatically). Surveys are dynamic-imported — the leads.ts
 * cross-store idiom — so the store layer stays acyclic.
 */
export async function requestVisitForLead(
  lead: {
    id: string;
    org: string;
    contact: string;
    email: string;
    phone: string;
    city: string;
    state: string;
    customerId: string | null;
  },
  opts: VisitRequestOpts,
  me: string
): Promise<VisitRequestResult> {
  const existing = (await allVisits()).find((v) => v.leadId === lead.id && v.stage !== "done");
  if (existing) return { ok: false, reason: "exists", visitId: existing.id };

  const rec = await createVisit({
    customerId: lead.customerId ?? null,
    customer: lead.org,
    locationId: null,
    venue: "",
    address: [lead.city, lead.state].filter(Boolean).join(", "),
    contactName: lead.contact,
    contactEmail: lead.email,
    contactPhone: lead.phone,
    reason: opts.reason,
    startAt: null,
    endAt: null,
    notes: "",
    assignedTo: opts.assignee.trim(),
    createdBy: me,
    engagementId: null,
    stage: requestStageFor(opts.assignee),
    leadId: lead.id,
    surveyId: null,
    preferredTiming: opts.timing.trim(),
  });

  const { create: createSurvey } = await import("./surveys");
  const survey = await createSurvey(
    {
      customer: lead.org,
      customerId: lead.customerId ?? null,
      contact: lead.contact,
      contactPhone: lead.phone,
      contactEmail: lead.email,
      reason: opts.reason,
      stage: "requested",
      leadId: lead.id,
      visitId: rec.id,
    },
    me
  );

  await patchDoc<SiteVisit>("site_visits", rec.id, (d) => {
    d.surveyId = survey.id;
    d.updatedAt = Date.now();
  });
  return { ok: true, visitId: rec.id, surveyId: survey.id };
}
```

(If Task 2 deferred the `requestStageFor` import, add it to the `@/lib/lead-thread` import now.)

- [ ] **Step 4: Extract `dispatchVisitInvite` (behavior-preserving)**

Create `src/lib/visit-invite.ts` — this is `createSiteVisitAction`'s invite block (inbox/site-visit-actions.ts:96–183) extracted so the inbox creator and the new scheduler share one path. Same status set, same stamps, same fall-backs; the fn never throws, preserving "the visit exists even when the invite fails":

```ts
import { buildIcs } from "@/lib/ics";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { invitesOn } from "@/lib/stores/notif-prefs";
import { stampGoogleEvent, stampInvite, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";

/**
 * D77 invite/calendar dispatch for a SCHEDULED site visit — extracted
 * verbatim from createSiteVisitAction (#34) so the inbox creator and the
 * lead-thread scheduler (scheduleVisitAction) share one path. The recipient
 * is the ASSIGNEE (never the customer — D76 decisions B/E), honoring their
 * Account invite toggle. Behavior-preserving: same statuses, same stamps,
 * same "visit exists even when the invite fails" guarantee (never throws).
 */

export type InviteStatus =
  | "calendar" // D77 — event written straight to the assignee's Google Calendar
  | "sent"
  | "invites-off"
  | "gmail-off"
  | "no-mailbox"
  | "no-email"
  | "failed";

export async function dispatchVisitInvite(
  rec: SiteVisit,
  me: { id: string; name: string }
): Promise<InviteStatus> {
  if (rec.startAt == null || rec.endAt == null) return "failed";
  const assignee = (await allUsers()).find((u) => u.name === rec.assignedTo) || null;
  const toAddr = assignee?.email || "";
  if (!gmailEnabled()) return "gmail-off";
  if (!toAddr) return "no-email";
  if (!(await invitesOn(rec.assignedTo))) return "invites-off";

  // Event title = venue + reason (the punch-list formatter).
  const title = `${rec.venue || rec.customer} — ${rec.reason}`;
  const body = [
    `Site visit: ${rec.reason}`,
    `Customer: ${rec.customer}`,
    rec.venue ? `Venue: ${rec.venue}` : "",
    rec.address ? `Address: ${rec.address}` : "",
    rec.contactName
      ? `Contact: ${rec.contactName}` +
        (rec.contactPhone ? ` · ${rec.contactPhone}` : "") +
        (rec.contactEmail ? ` · ${rec.contactEmail}` : "")
      : "",
    rec.notes ? `Notes: ${rec.notes}` : "",
    `Scheduled by ${me.name} in Peak (${rec.id}).`,
  ]
    .filter(Boolean)
    .join("\n");
  const location = rec.address || [rec.venue, rec.customer].filter(Boolean).join(", ");

  // D77 — when the assignee's own mailbox has the Calendar grant, write the
  // event straight onto their primary calendar: it just appears, no email
  // step. Falls back to the .ics email otherwise (or if the write fails).
  if (assignee) {
    const akey = personalKey(assignee.id);
    const info = await getConnectionInfo(akey);
    if (info && hasCalendarScope(info.scope)) {
      try {
        const { insertEvent } = await import("@/lib/google/calendar");
        const ev = await insertEvent(akey, {
          title,
          startMs: rec.startAt,
          endMs: rec.endAt,
          description: body,
          location,
        });
        await stampGoogleEvent(rec.id, ev.id);
        return "calendar";
      } catch (err) {
        console.error("[site-visit] calendar write failed:", err);
      }
    }
  }

  const ics = buildIcs({
    uid: "sv-" + rec.id + "@peak-app",
    title,
    description: body,
    location,
    start: rec.startAt,
    end: rec.endAt,
    stampAt: Date.now(),
  });
  try {
    const { sendSiteVisitInvite } = await import("@/lib/gmail/bridge");
    const sent = await sendSiteVisitInvite({
      siteVisitId: rec.id,
      schedulerUserId: me.id,
      toAddr,
      subject: title,
      body,
      icsText: ics,
    });
    if (sent) {
      await stampInvite(rec.id, {
        sentAt: Date.now(),
        to: toAddr,
        fromMailbox: sent.fromMailbox,
        gmailId: sent.gmailId,
        gmailThreadId: sent.gmailThreadId,
      });
      return "sent";
    }
    return "no-mailbox";
  } catch (err) {
    console.error("[site-visit] invite send failed:", err);
    return "failed";
  }
}
```

Then in `src/app/(app)/inbox/site-visit-actions.ts`:

1. Replace the import block (lines 1–15) with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { createVisit } from "@/lib/stores/site-visits";
import { update as updateThread } from "@/lib/stores/comms";
import { dispatchVisitInvite } from "@/lib/visit-invite";
```

2. Replace the `export type InviteStatus = …;` union (lines 46–53) with a type re-export so `site-visit-modal.tsx`'s `import { …, type InviteStatus } from "./site-visit-actions"` keeps working (type-only exports are erased and legal in "use server" files — this file already exports types):

```ts
export type { InviteStatus } from "@/lib/visit-invite";
```

The `Promise<…>` return annotation on `createSiteVisitAction` references `InviteStatus` — add a local type import for it:

```ts
import type { InviteStatus } from "@/lib/visit-invite";
```

3. Delete the `const assignee = …` lookup (lines 76–77) and replace everything from `let inviteStatus: InviteStatus;` (line 96) through the end of the invite `else` block (line 183) with:

```ts
  const inviteStatus: InviteStatus = await dispatchVisitInvite(rec, {
    id: me.id,
    name: me.name,
  });
```

(`revalidatePath("/", "layout");` and the `return { ok: true, id: rec.id, inviteStatus };` lines below stay as they are.)

- [ ] **Step 5: Claim / release / schedule server actions**

Create `src/app/(app)/field-survey/visit-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { claimVisit, getVisit, releaseVisit, scheduleVisit } from "@/lib/stores/site-visits";
import { dispatchVisitInvite, type InviteStatus } from "@/lib/visit-invite";

/**
 * #34 visit-queue mutations — the LEAD claim model (claimLeadAction:
 * assign-to-self behind any requireUser, NO approver gate — field techs
 * claim visits). scheduleVisitAction stamps the times then dispatches the
 * D77 invite/calendar machinery; like the inbox path, the schedule sticks
 * even when the invite fails.
 */

export async function claimVisitAction(id: string) {
  const me = await requireUser();
  const v = await getVisit(id);
  if (!v || v.stage === "done") return { ok: false as const };
  await claimVisit(id, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function releaseVisitAction(id: string) {
  await requireUser();
  const v = await getVisit(id);
  if (!v) return { ok: false as const };
  await releaseVisit(id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function scheduleVisitAction(
  id: string,
  input: { startAt: number; endAt: number }
): Promise<{ ok: true; inviteStatus: InviteStatus } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!(input.startAt > 0) || !(input.endAt > input.startAt))
    return { ok: false, error: "Bad time range" };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "Visit not found" };
  if (!v.assignedTo) return { ok: false, error: "Claim the visit first" };
  await scheduleVisit(id, input.startAt, input.endAt);
  const fresh = await getVisit(id);
  const inviteStatus: InviteStatus = fresh
    ? await dispatchVisitInvite(fresh, { id: me.id, name: me.name })
    : "failed";
  revalidatePath("/", "layout");
  return { ok: true, inviteStatus };
}
```

- [ ] **Step 6: `requestSiteVisitAction` on the lead**

In `src/app/(app)/leads/actions.ts`:

1. Add to the imports (after the `@/lib/stores/leads` import block):

```ts
import { requestVisitForLead } from "@/lib/stores/site-visits";
```

(Static import is safe here: actions.ts is a "use server" module and `site-visits` never imports `leads` — no cycle. The store-layer cycle rule applies inside `requestVisitForLead`, which dynamic-imports surveys.)

2. Append at the end of the file:

```ts
/** #34: "Request site visit" from the lead drawer. Dedupe + visit + auto-
    linked Survey live in the store orchestration (requestVisitForLead);
    this wraps it with the session user and the lead activity entry. */
export async function requestSiteVisitAction(
  id: string,
  input: { reason: string; timing: string; assignee: string }
) {
  const me = await requireUser();
  const l = await get(id);
  if (!l) return { ok: false as const, reason: "not-found" as const, visitId: "" };
  const res = await requestVisitForLead(
    {
      id: l.id,
      org: l.org,
      contact: l.contact,
      email: l.email,
      phone: l.phone,
      city: l.city,
      state: l.state,
      customerId: l.customerId ?? null,
    },
    input,
    me.name
  );
  if (!res.ok) return { ok: false as const, reason: "exists" as const, visitId: res.visitId };
  await logActivity(
    id,
    { type: "system", note: "Requested site visit — " + input.reason, by: me.name },
    me.name
  );
  revalidatePath("/", "layout");
  return { ok: true as const, visitId: res.visitId, surveyId: res.surveyId };
}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED`.

Live check (dev server on :3000): the inbox site-visit modal still schedules a visit end-to-end and reports the same invite status line as before the extraction (behavior-preserving check — same stamps, calendar-else-ics order unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/surveys.ts src/lib/stores/site-visits.ts src/lib/visit-invite.ts src/app/\(app\)/inbox/site-visit-actions.ts src/app/\(app\)/field-survey src/app/\(app\)/leads/actions.ts scripts/test-review-and-spec.ts
git commit -m "feat: survey leadId/visitId + requestVisitForLead orchestration + dispatchVisitInvite extraction + claim/schedule actions (#34)"
```

---

### Task 4: Queue surfaces — /field-survey "Visit requests" section, My Queue source, nav bell group

**Files:**
- Create: `src/app/(app)/field-survey/visit-requests.tsx` (client rows)
- Modify: `src/app/(app)/field-survey/page.tsx` (fetch + section above the survey cards)
- Modify: `src/lib/queue-types.ts` (`QueueSource` union + `SOURCE_LABEL` — edit THERE, it's the dependency-free client-safe home)
- Modify: `src/lib/queue.ts` (`loadQueue` new source)
- Modify: `src/lib/stores/notif-prefs.ts` (bell category)
- Modify: `src/lib/nav-counts.ts` (one parallel fetch + bell group; NO new counts key)

**Interfaces:**
- Consumes: `allVisits` (Task 2), `claimVisitAction`/`releaseVisitAction`/`scheduleVisitAction` (Task 3), `VISIT_STAGE_META` (Task 1), `timeAgo` (surveys — already imported by the page).
- Produces: `VisitRequestVM`; `QueueSource` gains `"site-visit"`; notif-prefs category `visits`; bell group "Site visit requests".

- [ ] **Step 1: Client rows component**

Create `src/app/(app)/field-survey/visit-requests.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { claimVisitAction, releaseVisitAction, scheduleVisitAction } from "./visit-actions";

/**
 * #34 — the open-visit queue rows above the survey cards. Unclaimed rows
 * (requested/open) show Claim for EVERYONE; rows claimed by me show the
 * inline scheduler (two datetime-local inputs → "Schedule + invite") plus
 * Release. Server-built serializable VMs; buttons are inline chips (the
 * worklist chip pattern — no row navigation here, visits have no detail
 * page, so no stopPropagation wrapper is needed).
 */

export type VisitRequestVM = {
  id: string;
  customer: string;
  reason: string;
  preferredTiming: string;
  requestedLine: string; // "Requested by Jeff · 2d ago"
  stageLabel: string;
  stageInk: string;
  stageSoft: string;
  stageBd: string;
  surveyId: string | null;
  leadId: string | null;
  /** claimed by the signed-in user → inline scheduler + Release */
  mine: boolean;
};

const chipBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#5b616e",
  background: "#f1f2f5",
  border: "1px solid #e4e7ec",
  padding: "6px 10px",
  borderRadius: 7,
  cursor: "pointer",
};

const primaryChip: CSSProperties = {
  ...chipBtn,
  color: "#fff",
  background: "var(--accent)",
  border: "none",
};

const dtInput: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
};

const linkStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "color-mix(in srgb, var(--accent) 70%, #000)",
  textDecoration: "none",
};

function VisitRequestRow({ row }: { row: VisitRequestVM }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState("");

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const doSchedule = () => {
    const s = start ? new Date(start).getTime() : 0;
    const e = end ? new Date(end).getTime() : 0;
    if (!(s > 0) || !(e > s)) {
      setErr("Pick a start and an end after it.");
      return;
    }
    setErr("");
    startTransition(async () => {
      const res = await scheduleVisitAction(row.id, { startAt: s, endAt: e });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #f4f5f8" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", rowGap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d" }}>{row.customer}</span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: row.stageInk,
                background: row.stageSoft,
                border: `1px solid ${row.stageBd}`,
                padding: "2px 8px",
                borderRadius: 20,
                whiteSpace: "nowrap",
              }}
            >
              {row.stageLabel}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3 }}>
            {row.reason}
            {row.preferredTiming ? ` · prefers ${row.preferredTiming}` : ""}
            {" · "}
            {row.requestedLine}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {row.surveyId && (
              <Link href={`/field-survey?id=${encodeURIComponent(row.surveyId)}`} style={linkStyle}>
                Survey {row.surveyId} →
              </Link>
            )}
            {row.leadId && (
              <Link href={`/leads?lead=${encodeURIComponent(row.leadId)}`} style={linkStyle}>
                Lead {row.leadId} →
              </Link>
            )}
          </div>
        </div>
        {!row.mine && (
          <button onClick={() => run(() => claimVisitAction(row.id))} disabled={isPending} style={primaryChip}>
            Claim
          </button>
        )}
        {row.mine && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={dtInput}
            />
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={dtInput}
            />
            <button onClick={doSchedule} disabled={isPending} style={primaryChip}>
              Schedule + invite
            </button>
            <button onClick={() => run(() => releaseVisitAction(row.id))} disabled={isPending} style={chipBtn}>
              Release
            </button>
          </div>
        )}
      </div>
      {err && <div style={{ fontSize: 11.5, color: "#b4543a", fontWeight: 600, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

export default function VisitRequests({ rows }: { rows: VisitRequestVM[] }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#9aa0ab",
          letterSpacing: ".05em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Visit requests
      </div>
      <div
        style={{
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          overflow: "hidden",
        }}
      >
        {rows.map((r) => (
          <VisitRequestRow key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Page integration**

In `src/app/(app)/field-survey/page.tsx`:

1. Add imports (after the `./actions` import):

```ts
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { VISIT_STAGE_META } from "@/lib/lead-thread";
import VisitRequests, { type VisitRequestVM } from "./visit-requests";
```

2. Replace the fetch line

```ts
  const [user, sp, all] = await Promise.all([requireUser(), searchParams, getAll()]);
```

with

```ts
  const [user, sp, all, visits] = await Promise.all([requireUser(), searchParams, getAll(), allVisits()]);
```

3. After the line `const me = user.name;`, add:

```ts
  // #34 — the open-visit queue: unclaimed requests for EVERYONE, plus my
  // claimed-but-unscheduled visits (inline scheduler). Unclaimed first,
  // oldest request first within each group.
  const queueVisits = visits
    .filter(
      (v: SiteVisit) =>
        v.stage === "requested" || v.stage === "open" || (v.stage === "claimed" && v.assignedTo === me)
    )
    .sort(
      (a, b) =>
        (a.stage === "claimed" ? 1 : 0) - (b.stage === "claimed" ? 1 : 0) ||
        (a.createdAt || 0) - (b.createdAt || 0)
    );
  const visitRows: VisitRequestVM[] = queueVisits.map((v) => {
    const sm = VISIT_STAGE_META[v.stage];
    return {
      id: v.id,
      customer: v.customer || v.id,
      reason: v.reason,
      preferredTiming: v.preferredTiming,
      requestedLine: "Requested by " + (v.createdBy || "—") + " · " + timeAgo(v.createdAt),
      stageLabel: sm.label,
      stageInk: sm.ink,
      stageSoft: sm.soft,
      stageBd: sm.bd,
      surveyId: v.surveyId,
      leadId: v.leadId,
      mine: v.stage === "claimed",
    };
  });
```

4. In the JSX, directly after the closing `</div>` of the `{/* stage segmented + assigned-to-me */}` block and before the `{/* empty state */}` comment, add:

```tsx
      {/* #34 — open-visit queue, ABOVE the survey cards */}
      <VisitRequests rows={visitRows} />
```

- [ ] **Step 3: Queue types + loadQueue**

In `src/lib/queue-types.ts`:

1. Add to the `QueueSource` union, after `| "project-task"`:

```ts
  | "site-visit"
```

2. Add to `SOURCE_LABEL`, after `"project-task": "Project task",`:

```ts
  "site-visit": "Site visit",
```

In `src/lib/queue.ts`:

1. Add the import (after the `@/lib/stores/quotes` import):

```ts
import { allVisits } from "@/lib/stores/site-visits";
```

2. Extend the `Promise.all` destructure:

```ts
  const [assignments, engagements, projects, quotes, flames, inspections, visits] =
    await Promise.all([
      allAssignments(),
      allEngagements(),
      getAllProjects(),
      getAllQuotes(),
      flameRenewals({ dueOnly: true }),
      inspectionRenewals({ dueOnly: true }),
      allVisits(),
    ]);
```

3. After the quote-reviews loop (below its closing `}`), add:

```ts
  /* --- open site-visit requests (#34): unclaimed for EVERYONE (the
     unclaimed-quote-review precedent above), claimed-but-unscheduled for
     the claimer. Due = requested + 3 days — the pool shouldn't sit. --- */
  for (const v of visits) {
    if (v.stage === "requested" || v.stage === "open") {
      items.push({
        key: `site-visit:${v.id}`,
        source: "site-visit",
        title: `Open site visit: ${v.customer || v.id}`,
        context: v.reason,
        due: (v.createdAt || 0) + 3 * DAY,
        href: "/field-survey",
        writable: false,
      });
    } else if (v.stage === "claimed" && v.assignedTo === me) {
      items.push({
        key: `site-visit:${v.id}`,
        source: "site-visit",
        title: `Schedule site visit: ${v.customer || v.id}`,
        context: v.reason,
        due: (v.createdAt || 0) + 3 * DAY,
        href: "/field-survey",
        writable: false,
      });
    }
  }
```

(Keys are `site-visit:<id>` — stable across runs for the Reminders-sync dedupe, and a visit is only ever ONE of unclaimed/claimed, so the key can't collide with itself.)

- [ ] **Step 4: Bell — category + group (NO nav-counts key)**

In `src/lib/stores/notif-prefs.ts`, add to `CATEGORIES` after the `surveys` line:

```ts
  { key: "visits",      label: "Site visit requests",          desc: "Open site-visit requests to claim, plus your claimed visits waiting on a schedule." },
```

In `src/lib/nav-counts.ts`:

1. Add the import (after the surveys import line):

```ts
import { allVisits } from "@/lib/stores/site-visits";
```

2. Extend the single `Promise.all` batch — add `visits,` to the destructure after `comms,` and `allVisits(),` to the array after `allComms(),` (this is the ONE sanctioned parallel-fetch addition):

```ts
    comms,
    visits,
    leadFollowUps,
```

```ts
    allComms(),
    allVisits(),
    followUps({ unownedOrMine: true, me }),
```

3. In the derived block (after `const requestedSurveys = …;`), add:

```ts
  const openVisits = visits.filter((v) => v.stage === "requested" || v.stage === "open");
  const myVisitsToSchedule = visits.filter((v) => v.stage === "claimed" && v.assignedTo === me);
```

4. After the `push("surveys", …)` call (below its closing `);`), add:

```ts
  push(
    "visits",
    "Site visit requests",
    [...openVisits, ...myVisitsToSchedule].map((v) => ({
      id: v.id,
      title: v.customer || v.id,
      sub:
        v.stage === "claimed"
          ? `${v.reason} · claimed — pick a time`
          : `${v.reason} · open — claim it`,
      href: "/field-survey",
      letter: "V",
      color: "#7b3f8a",
    }))
  );
```

(`counts` is untouched — no badge; the brief and the nav-counts single-batch comment both forbid a new key.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED`.

Live check (dev server on :3000): `/field-survey` renders with no "Visit requests" section (none exist yet — the section is hidden when empty); `/queue` loads; the bell renders; Account → notification prefs shows the new "Site visit requests" toggle.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/field-survey src/lib/queue-types.ts src/lib/queue.ts src/lib/stores/notif-prefs.ts src/lib/nav-counts.ts
git commit -m "feat: open-visit queue surfaces — field-survey section, My Queue source, bell group (#34)"
```

---

### Task 5: Lead drawer — thread chips, request-visit view, convert gate end-to-end

**Files:**
- Modify: `src/app/(app)/leads/types.ts` (`LeadThreadVM`)
- Modify: `src/app/(app)/leads/page.tsx` (drawer-scoped thread fetch + new props)
- Modify: `src/app/(app)/leads/actions.ts` (`convertLeadAction` gains the server-side gate)
- Modify: `src/app/(app)/leads/lead-drawer.tsx` (thread row, `"visit"` view, gated convert, `doConvert` reads the result)

**Interfaces:**
- Consumes: `activeVisitForLead`/`mergedVisitReasons` (site-visits), `surveysForLead`/`stageMeta` (surveys), `VISIT_STAGE_META`/`canConvertLead` (lead-thread), `requestSiteVisitAction` (Task 3), `getSettings` (`@/lib/settings`).
- Produces: `LeadThreadVM`; `convertLeadAction(id, { venueLabel, type, skipSurvey?, skipReason? })` → `{ ok: true, quoteId, customerId } | { ok: false, reason: "survey-missing" | "survey-open" | "not-found", quoteId: "", customerId: "" }`.

Decision (the brief left it open): the gate lives in **`convertLeadAction`**, NOT inside `convert()` — least ripple. `convert()` (leads.ts:677) keeps its exact signature and null contract; no other `convert()` caller exists to protect, and the action is the single server chokepoint the drawer calls. `buildDrawerVM` is untouched (takes only `LeadRecord`); the thread rides a SEPARATE serializable prop.

- [ ] **Step 1: The thread VM type**

In `src/app/(app)/leads/types.ts`, append at the end of the file:

```ts
/** #34 — the lead's visit/survey thread, server-built with chip colors
    precomputed (the client drawer must not value-import the stores).
    visit is the lead's ACTIVE visit (activeVisitForLead already excludes
    "done"), so visit !== null ⇒ hide the Request button. */
export type LeadThreadVM = {
  visit: {
    id: string;
    stage: string;
    label: string;
    ink: string;
    soft: string;
    bd: string;
    assignedTo: string;
    startAt: number | null;
  } | null;
  survey: {
    id: string;
    stage: string;
    label: string;
    ink: string;
    soft: string;
    bd: string;
  } | null;
};
```

- [ ] **Step 2: Server-side gate in `convertLeadAction`**

In `src/app/(app)/leads/actions.ts`:

1. Add imports (after the `requestVisitForLead` import from Task 3):

```ts
import { surveysForLead } from "@/lib/stores/surveys";
import { canConvertLead } from "@/lib/lead-thread";
```

(NOT `activeVisitForLead().surveyId` — see the resolution comment in the code
below and the deviations note: a past visit derives "done" and drops out of
"active", which would dead-end the canonical happy path.)

2. Replace the whole `convertLeadAction` (currently lines 75–82, the version that DISCARDS nothing but returns only ok/quoteId/customerId) with:

```ts
/** Convert → Customer + draft Quote; returns the quote id for the success UI.
 *  #34: the SERVER-SIDE survey gate lives here (the drawer's disabled button
 *  is not the gate). The linked survey resolves via surveysForLead (newest
 *  first) — the SAME path the drawer's gate preview uses, so gate and
 *  preview can never disagree. Deliberately NOT the active visit's surveyId:
 *  a "scheduled" visit whose end time has passed derives to "done" on read
 *  and drops out of activeVisitForLead, so the canonical flow (visit
 *  happened → survey completed → convert) has no active visit while the
 *  completed survey still exists (see deviations note / D120). Skipping
 *  requires an explicit opts.skipSurvey and logs the bypass on the lead.
 *  Tolerance: the gate reads the survey's CURRENT stage — backwards pill
 *  jumps before convert are respected by design. */
export async function convertLeadAction(
  id: string,
  opts: { venueLabel: string; type: string; skipSurvey?: boolean; skipReason?: string }
) {
  const me = await requireUser();

  const linked = await surveysForLead(id); // newest first (getAll is updatedAt-desc)
  const survey: { stage: string } | null = linked[0]
    ? { stage: (linked[0].stage || "requested") as string }
    : null;
  const gate = canConvertLead(survey, !!opts.skipSurvey);
  if (!gate.ok)
    return { ok: false as const, reason: gate.reason, quoteId: "", customerId: "" };

  const res = await convert(id, { venueLabel: opts.venueLabel, type: opts.type }, me.name);
  if (res && opts.skipSurvey) {
    await logActivity(
      id,
      {
        type: "system",
        note:
          "Converted without completed survey — " +
          (opts.skipReason?.trim() || "no reason given"),
        by: me.name,
      },
      me.name
    );
  }
  revalidatePath("/", "layout");
  if (!res)
    return { ok: false as const, reason: "not-found" as const, quoteId: "", customerId: "" };
  return { ok: true as const, quoteId: res.quoteId || "", customerId: res.customerId || "" };
}
```

- [ ] **Step 3: Page — drawer-scoped thread fetch + props**

In `src/app/(app)/leads/page.tsx`:

1. Add imports (after the `./actions` import):

```ts
import { getSettings } from "@/lib/settings";
import { activeVisitForLead, mergedVisitReasons } from "@/lib/stores/site-visits";
import { stageMeta as surveyStageMeta, surveysForLead } from "@/lib/stores/surveys";
import { VISIT_STAGE_META, type VisitStage } from "@/lib/lead-thread";
```

and extend the types import: `import type { AvatarVM, ChipVM, LeadThreadVM, WorklistRowVM } from "./types";`

2. Extend the main fetch (lines 189–195):

```ts
  const [all, m, users, fuList, unassignedList, settings] = await Promise.all([
    getAll(),
    metrics(),
    activeUsers(),
    followUps(),
    unassigned(),
    getSettings(),
  ]);
```

3. Directly after the `const sourceOptions = …;` line in the `/* ---------- drawer ---------- */` block, add:

```ts
  // #34 thread — drawer-scoped: two targeted store calls for the ONE open
  // lead only, never a per-row scan.
  const thread: LeadThreadVM = { visit: null, survey: null };
  if (leadRec) {
    const [visit, linkedSurveys] = await Promise.all([
      activeVisitForLead(leadRec.id),
      surveysForLead(leadRec.id),
    ]);
    if (visit) {
      const vmMeta = VISIT_STAGE_META[visit.stage as VisitStage];
      thread.visit = {
        id: visit.id,
        stage: visit.stage,
        label: vmMeta.label,
        ink: vmMeta.ink,
        soft: vmMeta.soft,
        bd: vmMeta.bd,
        assignedTo: visit.assignedTo,
        startAt: visit.startAt,
      };
    }
    const survey = linkedSurveys[0] || null; // newest linked survey (updatedAt-desc)
    if (survey) {
      const sMeta = surveyStageMeta((survey.stage || "requested") as string);
      thread.survey = {
        id: survey.id,
        stage: (survey.stage || "requested") as string,
        label: sMeta.label,
        ink: sMeta.ink,
        soft: sMeta.soft,
        bd: sMeta.bd,
      };
    }
  }
```

4. Add the two new props to the `<LeadDrawer …>` render (after `sourceOptions={sourceOptions}`):

```tsx
          thread={thread}
          visitReasons={mergedVisitReasons(settings.visitReasons)}
```

- [ ] **Step 4: The drawer**

In `src/app/(app)/leads/lead-drawer.tsx`:

1. Imports — add `requestSiteVisitAction` to the `./actions` import list, and extend the types import to:

```ts
import type { DrawerDetailVM, LeadThreadVM, SourceOptionVM } from "./types";
```

2. Props — add to the destructure and the prop type (after `sourceOptions`):

```ts
  thread,
  visitReasons,
```

```ts
  thread: LeadThreadVM;
  visitReasons: string[];
```

3. Below the style constants (after `cvBadge`), add the thread-chip style helper:

```ts
const threadChip = (c: { ink: string; soft: string; bd: string }): CSSProperties => ({
  display: "inline-block",
  fontSize: 10.5,
  fontWeight: 600,
  color: c.ink,
  background: c.soft,
  border: `1px solid ${c.bd}`,
  padding: "3px 10px",
  borderRadius: 20,
  textDecoration: "none",
  whiteSpace: "nowrap",
});
```

4. View state — replace

```ts
  const [view, setView] = useState<"main" | "convert" | "lost">("main");
```

with

```ts
  const [view, setView] = useState<"main" | "convert" | "lost" | "visit">("main");
```

5. After the `const [nfErr, setNfErr] = useState("");` line, add the new state:

```ts
  // #34 — request-visit form + convert gate
  const [reqReason, setReqReason] = useState(() => visitReasons[0] || "Site survey / measure");
  const [reqTiming, setReqTiming] = useState("");
  const [reqAssignee, setReqAssignee] = useState("");
  const [reqErr, setReqErr] = useState("");
  const [skipSurvey, setSkipSurvey] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [cvErr, setCvErr] = useState("");
  // Gate preview (server re-checks regardless): blocked unless the linked
  // survey is completed. thread.survey is surveysForLead(leadId)[0] — the
  // SAME resolution convertLeadAction's gate uses, so preview and server
  // can never disagree (a past "done" visit doesn't hide the survey).
  const gateBlocked = !thread.survey || thread.survey.stage !== "completed";
```

6. Replace `doConvert` (currently the four-line `startTransition` that DISCARDS the action result) with:

```ts
  const doConvert = () => {
    if (!vm) return;
    startTransition(async () => {
      const res = await convertLeadAction(vm.id, {
        venueLabel: cvVenue.trim() || "Main venue",
        type: cvType,
        skipSurvey,
        skipReason: skipReason.trim(),
      });
      if (!res.ok) {
        setCvErr(
          res.reason === "survey-missing"
            ? "No completed site survey is linked to this lead — tick “Skip survey” to convert anyway."
            : res.reason === "survey-open"
              ? "The linked survey isn't completed yet — finish it, or tick “Skip survey”."
              : "Convert failed — lead not found."
        );
        return;
      }
      setView("main");
      router.refresh();
    });
  };
```

7. After `doConvert`, add:

```ts
  const doRequestVisit = () => {
    if (!vm) return;
    startTransition(async () => {
      const res = await requestSiteVisitAction(vm.id, {
        reason: reqReason,
        timing: reqTiming.trim(),
        assignee: reqAssignee,
      });
      if (!res.ok) {
        setReqErr(
          res.reason === "exists"
            ? "This lead already has an active site visit (" + res.visitId + ")."
            : "Lead not found."
        );
        return;
      }
      setView("main");
      router.refresh();
    });
  };
```

8. MAIN view — insert the thread row directly after the forecast-date block's closing `</div>` (the block commented `{/* forecast close date (#18 opportunity board) */}`), before `{/* log a touch */}`:

```tsx
                    {/* #34 — site-visit / survey thread */}
                    <div style={secLbl}>Site visit</div>
                    {thread.visit ? (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <Link href="/field-survey" style={threadChip(thread.visit)}>
                          Visit · {thread.visit.label}
                        </Link>
                        {thread.survey && (
                          <Link
                            href={`/field-survey?id=${encodeURIComponent(thread.survey.id)}`}
                            style={threadChip(thread.survey)}
                          >
                            Survey · {thread.survey.label}
                          </Link>
                        )}
                        <span style={{ fontSize: 11.5, color: "#8c919c" }}>
                          {thread.visit.assignedTo || "Unclaimed"}
                          {thread.visit.startAt != null
                            ? " · " +
                              new Date(thread.visit.startAt).toLocaleString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : ""}
                        </span>
                      </div>
                    ) : vm.converted ? (
                      <div style={{ fontSize: 12, color: "#9aa0ab" }}>No site visit was requested.</div>
                    ) : (
                      <button
                        onClick={() => {
                          setView("visit");
                          setReqTiming("");
                          setReqAssignee("");
                          setReqErr("");
                        }}
                        style={smallGhost}
                      >
                        Request site visit
                      </button>
                    )}
```

9. CONVERT view — two edits:

a. Between the venue/type grid's closing `</div>` and the Cancel/Convert button row (`<div style={{ display: "flex", gap: 10, marginTop: 20 }}>`), insert:

```tsx
                  {/* #34 — survey gate (server re-checks in convertLeadAction) */}
                  <div
                    style={{
                      marginTop: 16,
                      padding: "11px 13px",
                      borderRadius: 11,
                      background: gateBlocked ? "#fbf3dd" : "#eaf6ef",
                      border: `1px solid ${gateBlocked ? "#f0e2bd" : "#cce9da"}`,
                      fontSize: 12.5,
                      color: gateBlocked ? "#8a6d1f" : "#1f7a52",
                      lineHeight: 1.5,
                    }}
                  >
                    {thread.survey
                      ? `Site survey ${thread.survey.id} — ${thread.survey.label}.`
                      : "No site survey is linked to this lead."}
                    {gateBlocked && " Converting normally waits for a completed survey."}
                  </div>
                  {gateBlocked && (
                    <div style={{ marginTop: 12 }}>
                      <label
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      >
                        <input
                          type="checkbox"
                          checked={skipSurvey}
                          onChange={(e) => setSkipSurvey(e.target.checked)}
                        />
                        Skip survey and convert anyway
                      </label>
                      {skipSurvey && (
                        <input
                          className="ldw-in"
                          value={skipReason}
                          onChange={(e) => setSkipReason(e.target.value)}
                          placeholder="Why skip? (optional — logged on the lead)"
                          style={{ ...inStyle, marginTop: 9 }}
                        />
                      )}
                    </div>
                  )}
                  {cvErr && (
                    <div style={{ fontSize: 12, color: "#b4543a", fontWeight: 600, marginTop: 12 }}>{cvErr}</div>
                  )}
```

b. Change the Convert button line from

```tsx
                    <button onClick={doConvert} disabled={busy} style={primaryBtn}>
```

to

```tsx
                    <button onClick={doConvert} disabled={busy || (gateBlocked && !skipSurvey)} style={primaryBtn}>
```

10. Footer — reset the gate state when opening the convert view: in the footer's `onClick={() => { setView("convert"); setCvVenue(""); setCvType(""); }}` handler, extend to:

```tsx
                          onClick={() => {
                            setView("convert");
                            setCvVenue("");
                            setCvType("");
                            setSkipSurvey(false);
                            setSkipReason("");
                            setCvErr("");
                          }}
```

11. REQUEST VISIT view — insert between the MAIN view's closing `)}` and the `{/* ===== CONVERT view ===== */}` comment:

```tsx
              {/* ===== REQUEST VISIT view (#34) ===== */}
              {view === "visit" && (
                <div style={{ padding: "18px 22px 22px" }}>
                  <button onClick={() => setView("main")} style={backBtn}>
                    ← Back
                  </button>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em" }}>Request a site visit</div>
                  <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.55, marginTop: 6 }}>
                    Creates an open visit request and a linked survey brief. Assign someone, or leave
                    it open for anyone to claim from Field Survey.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
                    <div>
                      <div style={lbl}>Reason</div>
                      <select
                        className="ldw-in"
                        value={reqReason}
                        onChange={(e) => setReqReason(e.target.value)}
                        style={selStyle}
                      >
                        {visitReasons.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={lbl}>Preferred timing</div>
                      <input
                        className="ldw-in"
                        value={reqTiming}
                        onChange={(e) => setReqTiming(e.target.value)}
                        placeholder="e.g. Week of Aug 10, mornings"
                        style={inStyle}
                      />
                    </div>
                    <div>
                      <div style={lbl}>Assign to</div>
                      <select
                        className="ldw-in"
                        value={reqAssignee}
                        onChange={(e) => setReqAssignee(e.target.value)}
                        style={selStyle}
                      >
                        <option value="">Open — anyone can claim</option>
                        {rosterNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {reqErr && (
                    <div style={{ fontSize: 12, color: "#b4543a", fontWeight: 600, marginTop: 12 }}>{reqErr}</div>
                  )}
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setView("main")} style={ghostBtn}>
                      Cancel
                    </button>
                    <button onClick={doRequestVisit} disabled={busy} style={primaryBtn}>
                      Request visit
                    </button>
                  </div>
                </div>
              )}
```

(The drawer remounts per lead via `key={leadParam}` — page.tsx:662 — so the new per-lead state needs no reset effects. The `reqReason` default is `visitReasons[0]` = "Site survey / measure" unless Settings overrides the picklist.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED` (the gate logic is Task 1's `canConvertLead` section; no new specs here).

Live check (dev server on :3000):
- Open a lead → "Site visit" section shows "Request site visit"; open the view, defaults read (reason = "Site survey / measure", assign = "Open — anyone can claim"); submit → drawer returns to main with a "Visit · Requested" chip + "Survey · Requested" chip; the lead's activity log shows "Requested site visit — …".
- Press Request again on the same lead (via a second tab) → inline "already has an active site visit" error.
- Convert view on a lead with the un-completed survey → amber status line, Convert disabled until "Skip survey" ticked; converting with skip logs "Converted without completed survey — …".
- Forecast-date input (plan 02) still present and functional directly above the new section.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/leads
git commit -m "feat: lead drawer thread chips, request-visit view, server-side survey convert gate (#34)"
```

---

### Task 6: Full verification, live drive, punchlist/decisions/roadmap, wrap up

**Files:**
- Modify: `PUNCHLIST.md` (item 34 → DONE)
- Modify: `DECISIONS.md` (new D entry)
- Modify: `docs/superpowers/plans/2026-07-25-00-crm-wave-roadmap.md` (plan 03 row)

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit` → clean. `npm run lint` → baseline 70, net-zero. `npm run test:specs` → `ALL PASSED`.

- [ ] **Step 2: Production build — KILL THE DEV SERVER FIRST (D106)**

```bash
lsof -ti tcp:3000 | xargs -r kill
npm run build
```

Expected: green — in particular no PGlite-in-client-bundle error (the two new client files import only `./visit-actions` / `./actions` server-action stubs and pure types; `lead-thread.ts` is dependency-free).

Restart the dev server afterwards (`npm run dev`) for the live drive.

- [ ] **Step 3: Live acceptance drive (the full thread)**

- **Request:** open a lead → Request site visit (leave open) → visit chip "Requested"; survey auto-created at Requested; the survey rides the existing Field badge + "Survey requests to schedule" bell group; the NEW "Site visit requests" bell group and `/queue` both show "Open site visit: <org>"; `/field-survey` shows the row under "Visit requests" with survey + lead links that round-trip.
- **Claim:** as any user, Claim → row flips to the inline scheduler (assigned to me); queue item retitles "Schedule site visit: <org>"; Release → back to the pool at stage "Open — unclaimed".
- **Schedule + invite:** pick start/end (end after start) → visit goes Scheduled; the D77 machinery fires (calendar write or .ics email or a clean fallback status); the visit appears on the Home agenda for the assignee and the company page card shows the date + "Scheduled" chip.
- **Request-with-assignee:** second lead → request assigned to a teammate → born "Claimed", appears in THEIR queue as "Schedule site visit".
- **Convert gate:** with the linked survey not completed → drawer convert shows the amber gate, button disabled until Skip ticked; complete the survey in `/field-survey/[id]` → gate turns green, Convert proceeds normally; skip path logs "Converted without completed survey — <reason>".
- **Convert gate, past visit (the canonical happy path):** edit the scheduled visit's `endAt` into the past (or schedule one that has already ended) so the visit reads **Done**, complete the linked survey → the drawer gate is green AND Convert **passes without Skip** — the server resolves the survey by lead link (`surveysForLead`), not through the now-inactive visit. This is the regression guard for the gate/preview lockstep (D120).
- **Dedupe:** a second request on a lead with an active visit → `{ reason: "exists" }` inline error; after the visit reads "done" a new request is allowed.
- **Inbox path unchanged:** schedule a visit from an inbox thread → same modal, same invite statuses, lands stage "scheduled", no leadId/surveyId.
- **Legacy reads:** pre-#34 visits (created before this branch) show stage Scheduled/Done correctly everywhere (company card, venue history, agenda).

- [ ] **Step 4: PUNCHLIST.md**

Change the item-34 heading line to:

```md
## 34. Leads → site visit → survey → estimate: wire the pipeline + a request/claim flow — DONE (2026-07-26, plan 03)
```

and insert directly under it:

```md
**DONE 2026-07-26 (plan 03, D120).** The thread is wired. `SiteVisit` gained the
lifecycle `requested / open / claimed / scheduled / done` + `leadId` /
`surveyId` / `preferredTiming` (decision A: extended, not a second model),
normalized on read (`deriveVisitStage` — legacy docs and past "scheduled"
records read correctly; no migration). The lead drawer's **Request site
visit** view (decision E) captures reason (default "Site survey / measure"),
preferred timing, and assign-or-open; it dedupes to one active visit per lead
and **auto-creates the linked Survey at stage `requested`** (decision C),
which rides the existing Field badge/bell. The claim flow reuses the LEAD
claim model (decision B): claim/release/schedule server actions, a "Visit
requests" section on `/field-survey` (Claim for everyone; inline scheduler +
Release for the claimer), a `site-visit` My Queue source (due = requested +
3d), and a "Site visit requests" bell group (new notif-prefs category, no nav
badge). Scheduling dispatches the D77 invite/calendar machinery via
`dispatchVisitInvite`, extracted behavior-preserving from the inbox path
(which is unchanged and still lands "scheduled"). Convert is **gated
server-side** (decision D) in `convertLeadAction` via `canConvertLead`: no
completed linked survey ⇒ `{ ok:false, reason }` unless explicitly skipped,
and skips are logged on the lead ("Converted without completed survey — …").
Lead stage itself was NOT changed by visit progress (the thread chips surface
status instead) — flag for Jeff if he wants stage coupling later.
```

Also update the item's `**Status:** OPEN …` line at its section end to `**Status:** DONE (plan 03).`

- [ ] **Step 5: DECISIONS.md**

Verify the next free number first (`grep -o "D1[0-9][0-9]" DECISIONS.md | sort -u | tail` — last known is **D119**, plan 02's opportunity-shape entry; if something landed since, take the next). Append:

```md
## D120 — Lead-thread shape: visit lifecycle, claim model, survey-gated convert (2026-07-26)

Controller calls made to unblock plan 03 (#34) — **flagged for Jeff's
review**; the spec's shape (§3 #34) is followed, these are the seams:

- **Lifecycle semantics.** `requested` = born open from a lead request;
  `open` = explicitly released back to the pool; `claimed` = assignee, no
  times; `scheduled` = has times (the inbox path lands here, unchanged);
  `done` = past. Normalize-on-read (`deriveVisitStage`, pure): legacy
  stage-less docs derive from times; stored "scheduled" past `endAt ??
  startAt` reads done. **No migration; site_visits stays non-syncable.**
- **Claim = the LEAD model** (any `requireUser`, no approver gate, no
  `claimedAt` — stage + updatedAt). Release ≠ un-request: released visits
  read "Open — unclaimed".
- **The convert gate lives in `convertLeadAction`**, not `convert()` —
  least ripple; `convert()` keeps its signature/null contract. Gate:
  `canConvertLead(survey, skip)` on the survey resolved via the lead's
  linked surveys (`surveysForLead`, newest first) — deliberately NOT the
  active visit's `surveyId` (the brief's wording): a past visit derives
  "done" and drops out of "active", which would fail the canonical
  visit-happened → survey-completed → convert path as "survey-missing"
  while the drawer preview showed green. Gate and preview share the one
  resolution path. Skip is explicit (checkbox + optional reason) and
  logged as lead activity. A lead with NO visit/survey at all also
  blocks (survey-missing) — every convert now passes the gate or ticks
  skip; that's the spec's "gated on the survey, not bypassing it".
- **The auto-created survey** carries `leadId`/`visitId` (through blank()'s
  whitelist + SurveyPatch) and is born `requested`, so it surfaces through
  the EXISTING field badge + "Survey requests to schedule" bell — no new
  survey plumbing.
- **Queue/bell:** My Queue source `site-visit` (unclaimed for everyone —
  the unclaimed-review precedent; claimed-unscheduled for the claimer;
  due = requested + 3 days). Bell category `visits` ("Site visit
  requests"); **no nav badge** (nav-counts single-batch rule — one added
  parallel fetch only).
- **Consulting `VisitLite` filters out unscheduled visits** instead of
  going nullable — the Oversight timeline math stays untouched; a lead
  request joins the consulting surfaces once scheduled.
- **`dispatchVisitInvite`** extracted from the inbox action, behavior-
  preserving (same statuses/stamps/fallbacks, recipient = assignee only);
  both schedulers share it.
- **Lead stage is NOT coupled to visit progress** (spec left it open) —
  the drawer chips surface the thread; product flag for Jeff.
```

- [ ] **Step 6: Roadmap**

In `docs/superpowers/plans/2026-07-25-00-crm-wave-roadmap.md`, change the plan-03 row to:

```md
| 03 | Lead → visit → survey → estimate thread (`2026-07-26-03-crm-visit-thread.md`) | #34 | **BUILT** (2026-07-26) — SiteVisit lifecycle + leadId, request/claim/schedule + invite, auto-linked survey, queue/bell surfaces, survey-gated convert (D120) |
```

- [ ] **Step 7: Commit**

```bash
git add PUNCHLIST.md DECISIONS.md docs/superpowers/plans
git commit -m "docs: punchlist #34 done, D120 lead-thread decisions, roadmap plan-03 built"
```

---

## Self-Review (done at authoring time)

- **Spec coverage (§3 #34 + brief + PUNCHLIST 34):** lifecycle literals + semantics incl. requested-vs-open distinction ✓ (Tasks 1–2, literal-asserted); leadId/surveyId/preferredTiming + loosened startAt/endAt/customerId/assignedTo ✓ (Task 2); normalize-on-read with legacy + scheduled-past-reads-done + pass-through branches all spec'd ✓ (Task 1); complete null-safety sweep — agenda (skip null start, null-safe href), venue-history bump + rows, companies card (stage chip, timing-instead-of-date), VisitLite, inbox action stamps ✓ (Task 2, recon list covered item-for-item); request button = in-drawer view swap with reason picklist (mergedVisitReasons, default index 0)/timing/assign-or-open ✓ (Task 5); `requestSiteVisitAction` dedupe-FIRST → `{ok:false,reason:"exists",visitId}` ✓; orchestration in a testable store fn with denorm from the lead, createdBy me, survey auto-create + cross-link + lead activity + revalidate ✓ (Task 3); surveys `leadId/visitId` through all THREE whitelist sites (SurveyDraft, blank def, SurveyPatch) + `?? null` reads + blank() spec ✓ (Task 3); bell note (survey rides counts.field automatically — no code) ✓ (Task 3 note); claim flow = lead model, `claimVisit/releaseVisit/scheduleVisit` store fns + actions, endAt>startAt validation, D77 dispatch via extraction ✓ (Tasks 2–3); extraction behavior-preserving (same statuses/stamps/order, never throws, visit-persists guarantee, modal's `InviteStatus` import kept via type re-export) ✓; /field-survey section ABOVE the cards with claim-for-everyone + inline scheduler + Release + survey/lead links ✓ (Task 4); queue source in dependency-free queue-types + loadQueue with stable keys, unclaimed-for-everyone precedent, due=+3d, "Open site visit:"/"Schedule site visit:" titles ✓ (Task 4); bell category `visits` + navData group with exactly ONE added parallel fetch and NO counts key ✓ (Task 4); lead thread surfaced via two targeted drawer-scoped calls + separate serializable `thread` prop (buildDrawerVM untouched), survey chip in survey STAGE_META colors, request button hidden while an active visit exists ✓ (Task 5); server-side gate + skip checkbox/reason + doConvert reads the result and renders inline errors (recon fix) + backwards-pill tolerance noted ✓ (Tasks 1/5); specs: VISIT_STAGES literals, deriveVisitStage branches, canConvertLead ×4, requestStageFor, blank defaults — all before the harness tail, no DB ✓ (Tasks 1/3); PUNCHLIST/DECISIONS/roadmap + build with dev-server kill/restart + full-thread live drive incl. inbox-unchanged and legacy-read checks ✓ (Task 6).
- **Deviations from the brief (all deliberate):**
  - **Task regrouping (6 tasks kept, boundaries moved):** the brief's task 3 (null-safety sweep) is merged into the store task — the per-task `tsc` gate makes the type change and its consumers inseparable; the claim/schedule server actions moved into Task 3 beside the extraction they depend on; Task 4 is the pure-surfaces task. The brief invited this ("adjust if the code argues").
  - **`VisitLite.startAt` stays `number`** — the loader filters unscheduled visits out instead (brief suggested making it nullable). Nullable would ripple through the Oversight timeline math and rows at view.tsx:527/546/549/1221/1232 for zero user value (an unscheduled lead request has no place on a consulting timeline). Noted in D120.
  - **Gate location decided: `convertLeadAction`**, `convert()` untouched — the brief offered both and asked for least ripple; the action is the only caller-facing chokepoint and already owned the `{ok,…}` result shape. Skip-activity logs after a successful convert (not before), so a failed convert leaves no misleading log entry.
  - **Gate survey resolution: `surveysForLead(id)` (newest), NOT the brief's "the lead's active visit's surveyId"** — the brief's wording conflicts with its own derived-done semantics (code argues): a stored "scheduled" visit past `endAt ?? startAt` reads "done" (`deriveVisitStage`) and drops out of `activeVisitForLead`, so on the canonical #34 happy path (visit occurred → survey completed → convert) the active-visit resolution finds no survey and blocks with "survey-missing" — while the drawer preview (which reads `surveysForLead(leadId)[0]`) shows green, hides the Skip checkbox, and leaves the user a dead-end. Server gate and drawer preview now share the one resolution path (`surveysForLead`, newest first); Task 6's live drive gains the past-visit + completed-survey → convert-passes regression check. Noted in D120.
  - **`requestSiteVisitAction` / `convertLeadAction` use static store imports** in actions.ts (a "use server" module; `site-visits` never imports `leads`, so no cycle) — the dynamic-import idiom is kept where the brief mandates it, inside `requestVisitForLead` for the store-layer surveys dependency.
  - **No stopPropagation wrapper on visit-request rows** — the worklist pattern was cited for claim chips, but visits have no detail page, so the rows don't navigate and plain buttons suffice (noted in the component docstring).
  - **No queue-item builder extraction** — the site-visit items are built inline in `loadQueue` exactly like every other source; extracting a pure builder for two `items.push` calls would be a one-off. Consequently the "queue-item builders if extracted pure" spec line has no target (the brief made it conditional).
  - **`VISIT_STAGE_META` added to lead-thread.ts** (not in the brief's list) — the drawer/companies/field-survey chips need client-safe colors, and the pure module is the only legal shared home under the client-bundle rule.
  - **`getVisit(id)` added** (brief didn't name it) — the claim/schedule actions need a normalized single-record read; `allVisits()`-scan for one id would be wasteful.
- **PUNCHLIST #34 overrides applied: none.** Item 34 (lines 2246–2310) contains NO Jeff-answered sub-decisions — its "Decisions Jeff needs to make" A–E are answered by the design spec §3 #34, which the brief's controller defaults already encode verbatim (A extend SiteVisit ✓, B claimable queue reusing the claim pattern ✓, C auto-seed the survey ✓, D convert gated on the survey ✓, E button on the lead with reason/timing/assign-or-open ✓). Defaults stand unmodified.
- **Repo facts that contradicted the brief (plan cites actual code):** brief's lead-drawer line refs drifted post-plan-02 — view state is at :264 (not :263), doConvert at :367–374 (not :356–363), convert view at :958–1031 (not :926–999), footer at :894–953 (not :898–907); `convert()` starts at leads.ts:677 (not :673); the inbox Google-Calendar block starts at :122 (comment) / :126 (code); everything else in the recon block verified exact (site-visits type :21–44, DEFAULT_VISIT_REASONS[0], surveys blank whitelist :429–434, nav-counts :93–95, queue precedent :87, agenda :74–89, venue-history :74/:170–176, companies card :529–550, drawer remount key at page.tsx:662).
- **Name/type consistency:** `VisitStage`/`VISIT_STAGES`/`VISIT_STAGE_META`/`deriveVisitStage`/`requestStageFor`/`canConvertLead` match across Tasks 1/2/3/4/5; `claimVisit/releaseVisit/scheduleVisit` (store) vs `claimVisitAction/releaseVisitAction/scheduleVisitAction` (actions) consistent across Tasks 2/3/4; `requestVisitForLead` result shape matches `requestSiteVisitAction`'s handling; `InviteStatus` single source in visit-invite.ts with a type re-export keeping the modal import path; `LeadThreadVM` field-for-field identical between types.ts, page builder and drawer usage; `VisitRequestVM` identical between component and page builder; the `"site-visit"` queue key literal matches queue-types and loadQueue.
- **Placeholder scan:** none — every code step carries complete code or an exact anchored edit; no "…" inside any code block except JSX/TS the step explicitly leaves byte-identical (none needed marking in this plan — all edits are shown in full).
- **Client-bundle audit:** new client files — `field-survey/visit-requests.tsx` (imports `./visit-actions` stubs only) and the extended `lead-drawer.tsx` (gains `requestSiteVisitAction` stub + pure `./types`) — carry no store value-imports; `lead-thread.ts` has zero imports; `visit-invite.ts` is server-only and only ever imported by "use server" files.
