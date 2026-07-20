# Consulting Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Consulting module per the approved design `docs/superpowers/specs/2026-07-19-consulting-module-design.md`: a `consulting` quote type with a lightweight builder, a `ConsultingEngagement` doc-store record spawned from won consulting quotes, a top-level Consulting module (list + detail with phases/reviews/milestones/meetings/oversight/documents + own timeline), phase reviews in the Reviews queue, milestones in the Reports billing forecast, and two template generators.

**Architecture:** One new doc-store collection (`consulting_engagements`) registered in `DOC_TABLES` (NOT sync-pushable — server-authoritative like quotes). The consulting quote reuses the entire existing quote machinery (statuses, QuoteReview, D84 revisions, quotes hub) with a `consulting` payload subdoc; the projects sync excludes `consulting` exactly like `flame_test`, and a new engagements sync spawns `CE-####` records idempotently on win. Module UI mirrors the Projects module layout (`page.tsx` / `[id]/page.tsx` / `data.ts` / `view.tsx` / `actions.ts`).

**Tech Stack:** Next.js 16 App Router / TypeScript strict / Drizzle on PGlite (dev) / no test runner (repo convention: `npx tsc --noEmit` + `npm run build` + browser verification).

## Global Constraints

- **Decision number: D90** (D89 = AI removal).
- **Engagement id prefix: `CE-` (base 1000 → first id `CE-1001`), NOT the spec's `C-1001`** — `C-` is already the comm-thread prefix (`comms` collection, `C-1032`+ live ids); a second `C-` line would be ambiguous in search/letters. This deviation is recorded in D90.
- Commits LOCAL ONLY (Jeff pushes via GitHub Desktop). Commit style: `Consulting: <area> (D90)`.
- Do NOT run `npm run db:reset-local` — Jeff's dev `.data/` holds live testing records.
- After editing `src/db/doc-tables.ts`: `npm run db:generate` and commit all of `drizzle/`.
- `requireUser()` / `requirePerm()` from `@/lib/session` in every server component/action touching data; never forward raw client objects into quote patches (no self-approval — mirror `updateQuoteMetaAction`'s allowlist posture).
- Never hardcode accent colors — `var(--accent)` etc.; use `components/ui.tsx` primitives (`Card`, `StatusPill`, `Pill`, `KpiTile`, `EmptyState`).
- **Customer pricing tiers do NOT apply to consulting** — the builder never calls `resolveTier`; `pricingTier`/`tierMargin` stay unset.
- **Out of scope v1 (spec):** portal visibility, hourly billing, generated minutes/invoices, email integration for submittals/RFIs, tasks on engagements, any main-Gantt rendering.
- Epoch-ms `Date.now()` timestamps, `money()` from `@/lib/format`, id sub-records via short uid helpers matching existing store conventions.

---

### Task 1: Collection, engagement store, phase menu

**Files:**
- Modify: `src/db/doc-tables.ts` (add `consulting_engagements`)
- Create: `drizzle/0006_*.sql` + meta (generated)
- Modify: `src/lib/settings.ts` (add `consultingPhases?: string[]`)
- Create: `src/lib/stores/engagements.ts`

**Interfaces (produces — later tasks consume these exact names):**

```ts
// src/lib/stores/engagements.ts
export type EngagementPhase = {
  id: string;            // 'ph-' + 4-char rand
  name: string;          // from the phase menu (free rename allowed)
  status: "pending" | "active" | "complete";
  review: QuoteReview;   // same shape as quotes — phases gate on approved review
  attachments: EngagementDoc[];
};
export type EngagementMilestone = { id: string; name: string; targetDate: number; completedAt?: number | null; amount?: number | null };
export type EngagementDecision = { id: string; at: number; by: string; decision: string; context: string };
export type EngagementMeeting = { id: string; at: number; attendees: string; minutes: string; decisionIds: string[] };
export type EngagementSubmittal = { id: string; kind: "submittal" | "rfi"; ref: string; received: number; respondedAt?: number | null; status: "open" | "answered" | "closed"; notes: string };
export type EngagementDoc = { id: string; name: string; mime: string; size: number; dataUrl: string; addedBy: string; addedAt: number };  // CommAttachment pattern + provenance
export type EngagementPerson = { id: string; person: string; role: string };  // shared people-with-roles shape (item 16 E)
export type ConsultingEngagement = {
  id: string;            // 'CE-####'
  name: string;
  customer: string;      // denormalized display name
  companyId: string | null;   // identity-core company slug (docs call it customerId elsewhere; new record uses the D85 name)
  siteIds: string[];
  contactName: string;
  people: EngagementPerson[];        // engagement lead + contributors
  quoteId: string;                   // source consulting quote
  designIds: string[];               // optional Design Studio links
  installQuoteId: string | null;     // cross-link if Peak bids the install (reference, never a conversion)
  status: "active" | "delivered" | "bid_supported" | "oversight_complete";
  phases: EngagementPhase[];
  milestones: EngagementMilestone[];
  decisions: EngagementDecision[];
  meetings: EngagementMeeting[];
  submittals: EngagementSubmittal[];
  documents: EngagementDoc[];
  createdAt: number; updatedAt: number;
};
export const DEFAULT_CONSULTING_PHASES: string[]; // Assessment, Schematic Design, Design Development, Final Documents, Bid Support, Construction Oversight
export function mergedConsultingPhases(stored?: string[] | null): string[];
export async function allEngagements(): Promise<ConsultingEngagement[]>;
export async function getEngagement(id: string): Promise<ConsultingEngagement | null>;
export async function createFromQuote(quoteId: string): Promise<ConsultingEngagement | null>;  // guards quoteType !== "consulting"; idempotent by quoteId
export async function syncEngagementsFromQuotes(): Promise<number>;                            // won consulting quotes → engagements
export async function patchEngagement(id: string, mut: (d: ConsultingEngagement) => void): Promise<void>;
```

- [ ] **Step 1:** `src/db/doc-tables.ts` — add `export const consultingEngagements = docTable("consulting_engagements"); // ConsultingEngagement records (D90)` and a `consulting_engagements: consultingEngagements,` entry in `DOC_TABLES`. Do NOT touch `SYNCABLE_COLLECTIONS`.
- [ ] **Step 2:** `npm run db:generate` — verify a new `drizzle/0006_*.sql` creates the table with the standard doc columns.
- [ ] **Step 3:** `src/lib/settings.ts` — next to `visitReasons?`, add:
  ```ts
  /** Consulting phase-menu overrides (D90) — see DEFAULT_CONSULTING_PHASES
   *  in stores/engagements.ts; empty/absent means use the defaults. */
  consultingPhases?: string[];
  ```
- [ ] **Step 4:** Create `src/lib/stores/engagements.ts` implementing the interface above on `listDocs`/`getDoc`/`upsertDoc`/`patchDoc`/`nextPrefixedId("consulting_engagements", "CE", 1000)`, modeled file-for-file on `src/lib/stores/site-visits.ts` (store shape) + `src/lib/stores/repair-jobs.ts` (`createFromQuote` guard + `syncFromQuotes` loop). `createFromQuote` reads the quote, guards `q.quoteType !== "consulting"` → null, returns the existing engagement if one already has this `quoteId` (idempotent), seeds `phases` from the quote's `consulting.phases` selection (names → phase objects with `status:"pending"`, `review` = the all-null `none` QuoteReview) and `milestones` from the quote's milestone fee rows (`{name, amount}`, `targetDate: 0` until scheduled).
- [ ] **Step 5:** `npx tsc --noEmit` clean.
- [ ] **Step 6:** Commit: `Consulting: engagement collection + store + phase menu (D90)` (include `drizzle/`).

---

### Task 2: Quote plumbing — type, revisions, syncs, hub

**Files:**
- Modify: `src/lib/stores/quotes.ts` (payload field + `snapshotOf`)
- Modify: `src/lib/stores/projects.ts:540` (`createProjectFromQuote`), `:561-572` (`syncProjectsFromQuotes`), `:588-601` (`pendingConversions`)
- Modify: `src/app/(app)/quotes/actions.ts:36-46` (won fan-out)
- Modify: `src/app/(app)/quotes/page.tsx:135` (TYPE_KEYS), `:40-47` (TYPE_BADGE), `:50-58` (editHrefFor), `:392-399` (type rail)
- Modify: `src/app/(app)/quotes/controls.tsx` (NewQuoteMenu entry)

**Interfaces:**
- Consumes: `syncEngagementsFromQuotes` (Task 1).
- Produces: `Quote.consulting?: unknown` payload subdoc `{ scope: string; feeMode: "fixed" | "milestones"; fees: Array<{name: string; amount: number}>; terms: string; phases: string[] }` (written by Task 3's builder, read by Task 1's `createFromQuote`); quotes hub recognizes type `consulting`.

- [ ] **Step 1:** `quotes.ts` — in the `Quote` type after `inspection?: unknown;` add `/** Consulting engagement subdoc (owned by the consulting module, D90). */ consulting?: unknown;`; update the `quoteType` doc comment to include `'consulting'`; in `snapshotOf()` copy `consulting` exactly as `spec`/`flameTest`/`repair`/`inspection` are copied (D84 revisions must freeze the fee schedule).
- [ ] **Step 2:** `projects.ts` — add `q.quoteType === "consulting"` to the skip conditions in `createProjectFromQuote` and `syncProjectsFromQuotes`, and `q.quoteType !== "consulting" &&` to `pendingConversions`. Update the explanatory comment ("Repair and inspection wins…") to mention consulting spawns engagements.
- [ ] **Step 3:** `quotes/actions.ts` — in the `won` fan-out add `syncEngagementsFromQuotes()` alongside the four existing syncs.
- [ ] **Step 4:** `quotes/page.tsx` — add `"consulting"` to `TYPE_KEYS`; add `TYPE_BADGE.consulting` (label "Consulting", distinct hue — purple family, mirror the existing badge object shape); `editHrefFor`: `consulting → "/consulting/quote?id=" + id`; add `["consulting", "Consulting"]` to the visible type rail.
- [ ] **Step 5:** `quotes/controls.tsx` — add a "Consulting quote" entry to `NewQuoteMenu` (sub-line: "Fee-based design & advisory work") linking to `/consulting/quote`.
- [ ] **Step 6:** `npx tsc --noEmit` clean. Commit: `Consulting: quote type plumbed — revisions, syncs, hub filter (D90)`.

---

### Task 3: Consulting quote builder (`/consulting/quote`)

**Files:**
- Create: `src/app/(app)/consulting/quote/page.tsx`, `controls.tsx`, `actions.ts`

**Interfaces:**
- Consumes: `create`/`update` from `@/lib/stores/quotes`, `mergedConsultingPhases` (Task 1), identity-core company/contact/site pickers as used by the repairs builder.
- Produces: quotes with `quoteType: "consulting"`, `source: "consulting"`, `value` = fixed fee or Σ milestone fees, and the `consulting` subdoc `{scope, feeMode, fees, terms, phases}`. No `pricingTier`/`tierMargin` (tiers do not apply).

- [ ] **Step 1:** Model the three files on `src/app/(app)/repairs/quote/` (page loads customers/settings + optional `?id=` for edit; controls is the client form; actions has a `persist()` + save/send actions). Form fields: quote name, customer + contact + site (same pickers the repairs builder uses), **scope of work** (textarea), **fee mode** toggle (fixed fee amount OR milestone rows name+amount with add/remove), **terms** (textarea), **phase selection** (checkboxes seeded from `mergedConsultingPhases(settings.consultingPhases)`, all checked by default, free ordering as listed).
- [ ] **Step 2:** `persist()` writes the payload above; `value` computed server-side from the fee inputs. Reuse the existing quote review/status actions (`submitQuoteForReview`, `setQuoteStatus` / the estimator's review actions) — do NOT build a parallel pipeline. Never accept `review`/`status`/`value` overrides from the client object (allowlist copy).
- [ ] **Step 3:** `npx tsc --noEmit` clean. Commit: `Consulting: lightweight quote builder (D90)`.

---

### Task 4: Nav + module skeleton (list & detail)

**Files:**
- Modify: `src/components/nav/nav-data.ts` (standalone link + route key)
- Create: `src/app/(app)/consulting/page.tsx`, `[id]/page.tsx`, `data.ts`, `view.tsx`, `actions.ts`

**Interfaces:**
- Consumes: `allEngagements`/`getEngagement`/`patchEngagement` (Task 1).
- Produces: `loadConsultingData()` in `data.ts` returning `{engagements, quotesById, custById, roster, phaseMenu}`; `ConsultingView` client component with `sel: EngagementVM | null` + `tab` (tabs: `overview | phases | milestones | meetings | oversight | documents`); server actions used by Tasks 5–7 (each `requireUser()`-gated + `revalidatePath("/", "layout")`).

- [ ] **Step 1:** `nav-data.ts` — insert `{ kind: "link", key: "consulting", label: "Consulting", href: "/consulting" }` into `NAV` after the Inbox entry; add `"/consulting": "consulting"` to `activeKeyFor`.
- [ ] **Step 2:** Mirror the Projects module layout exactly (`projects/page.tsx`, `[id]/page.tsx`, `data.ts`, `view.tsx`): list route renders `ConsultingView` with `sel=null`; `[id]` route 404s on unknown id. List = engagement cards: customer, engagement name/id, `StatusPill` for status, active phase name, next milestone (name + date), fee status (Σ milestone `amount` complete vs total). Detail = header (customer, links to source quote, install quote when set) + tab bar (`?tab=` pattern, `tabDefs` array like `projects/view.tsx:709`) with the six tabs; Overview shows links (company/site/contact), the people-with-roles list, design links, decisions count, and the per-engagement timeline (Task 8 fills it).
- [ ] **Step 3:** People-with-roles: a small self-contained editor inside `view.tsx` (`people: EngagementPerson[]`, add row = person select from roster + role picklist [Engagement Lead, Contributor, PM, Project Coordinator, Estimator, Lead Sales], remove row) writing through a `setPeopleAction`. Keep the editor component export-ready (item 16 E will lift it later — note this in a comment).
- [ ] **Step 4:** `npx tsc --noEmit` clean; browser: nav shows Consulting; `/consulting` renders the empty state. Commit: `Consulting: module skeleton — nav, list, detail tabs (D90)`.

---

### Task 5: Phases & internal reviews (incl. Reviews queue)

**Files:**
- Modify: `src/app/(app)/consulting/actions.ts` + `view.tsx` (Phases tab)
- Modify: `src/app/(app)/reviews/page.tsx` (add engagement rows to `all[]`)
- Modify: `src/app/(app)/reviews/actions.ts` (extend `ReviewKind`)
- Modify: `src/app/(app)/reviews/review-list.tsx` (`KIND_META`)
- Modify: `src/lib/stores/engagements.ts` (review mutators)

**Interfaces:**
- Produces: store mutators `submitPhaseReview(engId, phaseId, by)`, `claimPhaseReview(engId, phaseId, reviewer)`, `approvePhaseReview(engId, phaseId, by)`, `requestPhaseChanges(engId, phaseId, by, note)`, `setPhaseStatus(engId, phaseId, status)` — `setPhaseStatus(..., "complete")` throws/no-ops unless `review.state === "approved"` (**the gate**). Reviews queue composite id: `"<engId>:<phaseId>"` under new `ReviewKind` `"Engagement"`.

- [ ] **Step 1:** Store mutators via `patchDoc`, mirroring `submitForReview`/`claimReview`/`approve`/`requestChanges` in `quotes.ts:383-435` but operating on `phases[].review`. The complete-gate lives in the STORE (not just UI).
- [ ] **Step 2:** Phases tab UI: phase list with status pill, activate/complete buttons (complete disabled with a "needs approved review" hint until approved), submit-for-review button, per-phase attachments (Task 6's doc uploader reused), phase add/remove/rename from the merged menu.
- [ ] **Step 3:** Reviews queue: in `reviews/page.tsx` spread engagement phases with `review.state !== "none"` into `all[]` as `{kind: "Engagement", id: eng.id + ":" + ph.id, name: eng.name + " — " + ph.name, owner: <engagement lead person or "">, value: 0, review: ph.review, ts: eng.updatedAt, openHref: "/consulting/" + eng.id + "?tab=phases"}`. In `reviews/actions.ts` add `"Engagement"` to `ReviewKind` and a branch that splits the composite id and calls the Task-5 mutators. Add `KIND_META.Engagement` (violet) in `review-list.tsx`.
- [ ] **Step 4:** Settings: add a "Consulting — phase menu" card in `settings-client.tsx` + `saveConsultingPhasesAction` in `settings/actions.ts`, cloned from the `visitReasons` textarea section (`settings-client.tsx:630-674`, `actions.ts:207-216`).
- [ ] **Step 5:** `npx tsc --noEmit`; browser: submit a phase for review → appears on `/reviews`; approve → phase completes. Commit: `Consulting: phases with internal review gate + Reviews queue (D90)`.

---

### Task 6: Milestones → billing forecast; meetings, decisions, submittals, documents

**Files:**
- Modify: `src/app/(app)/consulting/actions.ts` + `view.tsx` (Milestones / Meetings & Decisions / Documents tabs)
- Modify: `src/app/(app)/reports/page.tsx` (`InstallsView` forecast, lines ~892-922)

**Interfaces:**
- Produces: milestone/meeting/decision/submittal/document CRUD actions; Reports forecast includes engagement milestone `{targetDate, amount}` points.

- [ ] **Step 1:** Milestones tab: rows (name, target date, amount, mark-complete), sorted by date; Σ amounts vs completed shown as `KpiTile`s.
- [ ] **Step 2:** Reports: in `InstallsView`, load `allEngagements()`, flatten `milestones` with `amount` + `targetDate` into the same bucket loop (`billed` at `targetDate`, `collected` net-30) and into the `toBill`/`collected` KPIs — identical math to `p.targetDate`/`p.value`. Label note in the card copy: "installs + consulting milestones".
- [ ] **Step 3:** Meetings & Decisions tab: decision log (running list, add form: decision + context; `by` = current user, `at` = now); meetings (at/attendees/minutes + link decision ids). Oversight tab: submittal/RFI list (kind, ref, received, status, respondedAt, notes) with add/edit.
- [ ] **Step 4:** Documents tab: upload via the `CommAttachment` data-URL pattern (`comms.ts:147-152`; same size posture as logo/PDF uploads) with name/size/uploader/date list + remove. Reuse the same uploader for per-phase deliverable attachments.
- [ ] **Step 5:** `npx tsc --noEmit`; browser: milestone with amount+date appears in the Reports billing forecast. Commit: `Consulting: milestones→forecast, meetings/decisions/submittals/documents (D90)`.

---

### Task 7: Site-visit link (Oversight)

**Files:**
- Modify: `src/lib/stores/site-visits.ts` (`engagementId?` + `visitsForEngagement`)
- Modify: `src/app/(app)/inbox/site-visit-actions.ts` (`CreateSiteVisitInput.engagementId?` passthrough)
- Modify: `src/app/(app)/consulting/actions.ts` + `view.tsx` (Oversight tab)

- [ ] **Step 1:** Add `engagementId?: string` to `SiteVisit` (next to `googleEventId?`) and to `CreateSiteVisitInput` + its `createVisit({...})` passthrough; add `visitsForEngagement(id)` (one-liner mirroring `visitsForCustomer`); add a `linkVisitToEngagement(visitId, engagementId | null)` patch helper.
- [ ] **Step 2:** Oversight tab: linked visits list (date, reason, assignee) + a "link visit" picker over the engagement company's visits (`visitsForCustomer(companyId)`) with unlink. (Scheduling NEW visits stays in the Inbox flow, v1.)
- [ ] **Step 3:** `npx tsc --noEmit`. Commit: `Consulting: site visits link under Oversight (D90)`.

---

### Task 8: Timeline views

**Files:**
- Modify: `src/app/(app)/consulting/view.tsx`

- [ ] **Step 1:** Per-engagement timeline on the Overview tab: horizontal strip modeled on `TimelineTab` (`projects/view.tsx:1467+`) — domain from min/max of milestone dates + linked visit dates (pad 7d), milestone diamonds/labels (complete = green, upcoming = accent, overdue = red) and visit ticks. Nothing renders on `/schedule` (assert by not touching it).
- [ ] **Step 2:** All-engagements roll-up at the top of the list page: one row per active engagement, bar spanning first→last milestone, next-milestone marker — modeled on the Reports "Completion timeline" idiom.
- [ ] **Step 3:** `npx tsc --noEmit`. Commit: `Consulting: engagement timeline + roll-up (D90)`.

---

### Task 9: Template generators

**Files:**
- Modify: `src/lib/templates.ts` (two `TemplateDef`s)
- Create: `src/app/(app)/consulting/letter/page.tsx`

- [ ] **Step 1:** Add `TemplateDef`s: `consulting_proposal` (group "Proposal letters" — parties/scope/fee-or-milestone-schedule/standard PSA terms; fields: intro, scopeLead, feeLine, milestoneLead, termsBlock, signoff) and `consulting_spec` (group "Reports" — spec-package boilerplate: cover intro, general-conditions section, equipment-schedule lead-in, closing). Placeholders `{{company}} {{customer}} {{engagement}} {{fee}} {{date}}` etc. with sensible default wording (editable in /templates like everything else).
- [ ] **Step 2:** `consulting/letter/page.tsx` modeled on `flame-tests/letter/page.tsx`: `?id=<quoteId>&kind=proposal` renders the proposal/services agreement from the quote + engagement via `renderField(settings.templates, "consulting_proposal", …)`; `?id=<engagementId>&kind=spec` renders the spec package from engagement data + linked Design Studio designs (equipment schedules from lineset/weights where linked — pull the design docs by `designIds` and render their item tables; if none linked, print the boilerplate with an "no linked designs" schedule note). Gate: quote path validates `quoteType === "consulting"`.
- [ ] **Step 3:** Surface "Proposal / agreement" + "Spec package" buttons on the engagement detail header and the proposal button in the builder.
- [ ] **Step 4:** `npx tsc --noEmit`; browser: both letters render. Commit: `Consulting: proposal + spec-package template generators (D90)`.

---

### Task 10: Docs close-out (D90) + full verification

**Files:**
- Modify: `DECISIONS.md` (D90), `PUNCHLIST.md` (Consulting IDEA + item 13-D note → point at the spec), `AGENTS.md` (feature list note if the module list there warrants it)

- [ ] **Step 1:** DECISIONS.md — D90 entry: spec pointer, the architecture decisions (own module, quote-first, own record type, off main Gantt, generated proposal+spec only), the **`CE-` prefix deviation** (reason: `C-` = comm threads), verification summary.
- [ ] **Step 2:** PUNCHLIST.md — close the bottom "Consulting as a project type" IDEA and item 13-D's "tabled" note: both point to the spec + D90.
- [ ] **Step 3:** Full pass: `npx tsc --noEmit && npm run build`; browser spec-verification checklist: consulting quote create → review → send → won → engagement appears with chosen phases; phase cannot complete before approved review; milestone amounts in Reports forecast; NO project spawned from the won consulting quote and nothing consulting on `/schedule`; both generators render; linked site visit lists under Oversight.
- [ ] **Step 4:** Commit: `Consulting: docs closed out (D90)`.
