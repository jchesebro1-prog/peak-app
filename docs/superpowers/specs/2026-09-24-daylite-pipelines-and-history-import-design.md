# Daylite pipelines + project history import — design

- **Date:** 2026-09-24
- **Status:** design approved in conversation with Jeff; awaiting written-spec review
- **Branch / worktree:** `feat/daylite-pipelines` · `../peak-app-worktree-daylite-pipelines`
- **Numbers:** punch # and D-numbers are assigned at landing time, recomputed from
  `origin/main` immediately before the docs commit (sessions collide within the hour).
- **Source files (Jeff, Dropbox):** `Projects - all.tsv` (2,218 rows),
  `Opportunties - All.tsv` (sic, 2,042 rows), `Calendar Events.tsv` (2,288 rows, **not
  imported**). Profile: memory `reference-daylite-history-exports.md`.

## 1. Why

Jeff wants completed (and live) project history out of Daylite and into Quartzite, and
wants the app's stages to be the Daylite stages the team already works in. Two
deliverables, shipped in order:

1. **Pipelines** — configurable, Daylite-named stage lists for install projects and for
   system quotes, replacing the hardcoded 7-stage `ProjectStage` list.
2. **Daylite history import** — an Import-hub flow that lands 2,218 projects + 2,042
   opportunities as projects, repairs and quotes on those pipelines.

Part 1 ships and works alone. Part 2 depends on it.

## 2. Decisions taken with Jeff (2026-09-24)

| # | Decision |
|---|---|
| J1 | Stage model = **Daylite pipelines** (not relabelled keys, not one merged list). |
| J2 | Pipelines apply to **install projects** and **system quotes**. Repairs keep approved → scheduled → completed. |
| J3 | **Quotes stop at Won.** Post-sale steps live on the project. |
| J4 | Install pipelines retired in Daylite; the only live one is **Basic Install**. Post-sale steps become project stages ahead of it (J5). |
| J5 | Install pipeline: **Deposit/PO received → Equipment ordered → Initial contact → Scheduled → Installation → Invoice → Complete.** |
| J6 | Service calls import as **Repairs**. |
| J7 | Cancelled, Abandoned and Deferred projects are **skipped**. |
| J8 | Unknown value shows **UKN**, never $0; reports exclude it; fill later. |
| J9 | Live work (New projects, Open opportunities) **is imported** — little is in Quartzite yet. |
| J10 | Daylite "1 • Acceptance" = sold, not yet started. |

Daylite lists as Jeff screenshotted them:

- **Basic Install:** Initial contact · Scheduled · Installation · Invoice
- **Estimate/Design:** First Contact · Design · Presentation/Delivery · Acceptance · Down Payment · Equipment Ordered
- **BID SPEC:** Collect Information · Create BID · BID Sent · Awarded · Purchase Order Received · Order Product · Install · Final Invoice
  (the export numbers Create BID as "3", so a stage 1 may precede Collect Information — **open item O1**)

## 3. Part 1 — Pipelines

### 3.1 Model

A **pipeline** is an ordered list of stages. Each stage has a stable `id` (slug, never
shown), a `label` (Jeff-editable), and one fixed **tag** that the code reasons about.
Code never compares stage ids or labels; it asks the tag. This is the whole point: Jeff
can rename, add, remove or reorder stages without breaking scheduling, risk flags,
Field Work or reports.

```ts
// src/lib/pipelines.ts  (pure — no DB; spec-harness testable)
type ProjectTag = "backlog" | "scheduled" | "onsite" | "closeout" | "done";
type QuoteTag   = "draft" | "sent" | "won";          // lost stays outside pipelines
type Stage<T>   = { id: string; label: string; tag: T;
                    advanceOnDelivered?: boolean };  // project stages only (§3.3)
type Pipeline<T> = { id: string; label: string; stages: Stage<T>[] };
```

Rules enforced by the settings validator (save is refused otherwise):

- ≥ 1 stage; stage ids unique within the pipeline; ids immutable once saved (label edits only).
- Project pipelines: exactly **one** `done` stage, and it is last. At least one stage
  before it.
- Quote pipelines: at least one `draft` stage; exactly one `won` stage, last; tags
  non-decreasing (draft… → sent… → won).
- A stage in use (any record sits in it) cannot be deleted — the editor shows the count
  and offers "move those records to…" first.

### 3.2 Seeded pipelines (settings: `projectPipelines`, `quotePipelines`)

**Project — `install` (default for kind `project`)**

| id | label | tag | notes |
|---|---|---|---|
| `deposit` | Deposit/PO received | backlog | first stage — where a won quote lands |
| `equipment-ordered` | Equipment ordered | backlog | `advanceOnDelivered: true` |
| `initial-contact` | Initial contact | backlog | |
| `scheduled` | Scheduled | scheduled | |
| `installation` | Installation | onsite | |
| `invoice` | Invoice | closeout | sign-off lands here (§3.3) |
| `complete` | Complete | done | |

**Project — `order` (default for kind `order`)** — today's ORDER_STAGES, tagged:
`order-materials` Order materials (backlog) · `deliveries` Deliveries (backlog,
`advanceOnDelivered`) · `delivered` Delivered & accepted (closeout) · `complete` Complete (done).

**Quote — `estimate-design` (default for system quotes)**

| id | label | tag |
|---|---|---|
| `first-contact` | First Contact | draft |
| `design` | Design | draft |
| `presentation` | Presentation/Delivery | sent |
| `acceptance` | Acceptance | won |

**Quote — `bid-spec`**

| id | label | tag |
|---|---|---|
| `collect-info` | Collect Information | draft |
| `create-bid` | Create BID | draft |
| `bid-sent` | BID Sent | sent |
| `awarded` | Awarded | won |

Records gain `pipelineId` + keep `stage` (now a stage id). Project default pipeline by
kind; quote default `estimate-design` for `quoteType` system (or missing). Only
system quotes carry a pipeline; flame_test / inspection / repair / rental / consulting
quotes are unchanged (status only).

### 3.3 Tag-driven behaviour (replaces every hardcoded stage literal)

One helper module answers every question the ~15 call sites ask today:
`isDone(p)`, `isOnSite(p)`, `isBacklog(p)`, `isActive(p)` (scheduled|onsite|closeout),
`stageLabel(p)`, `stageColor(p)`, `progressPct(p)`, `stagesOf(p)`, `firstStage(pipeline)`,
`firstStageWithTag(pipeline, tag)`.

| Today (literal) | Becomes |
|---|---|
| `stage === "complete"` / `!== "complete"` (metrics, nav-counts, inbox, schedule, field-work, view, board-lib, companies, venue-match) | `isDone` |
| "In install" = install\|training; Field Work on-site | `isOnSite` |
| `ACTIVE_STAGES` / `BACKLOG_STAGES` (metrics.ts), `OPEN` list (venue-match.ts) | `isActive` / `isBacklog` / `!isDone` |
| no-crew risk flag in procurement\|delivery | `isBacklog` |
| 5 divergent label/colour maps (view.tsx, field-work page + controls, schedule, installs widget) | one map derived from pipeline + tag colours |
| schedule/page.tsx:1831 `SM[stage].ink` (throws on unknown) | tag colour with fallback — never throws |

**Automatic stage writes**, all routed through one `advanceTo(project, stageId, by)`
so history, checklist expansion and hooks fire uniformly (today three paths bypass
`setProjectStage`):

| Trigger | New behaviour |
|---|---|
| Won system quote → `createProjectFromQuote` | lands at `firstStage` of `install` (or `order` for no-labor) with an opening history entry |
| Page-load sweep (`syncProjectsFromQuotes`) | same as above; now also writes the opening history entry |
| Delivery received | when **all** deliveries are received and the current stage has `advanceOnDelivered`, advance to the next stage. |
| Customer sign-off (`setSignoff` / `signoffAction`) | advance to `firstStageWithTag("closeout")` if the project is earlier. **No longer completes the project** — Complete is manual (when paid), as in Daylite. |
| Reaching the `done` stage | fires what sign-off→complete fires today (the assignment in projects/actions.ts:222-228). |
| Repair/inspection-won service-linked project | created directly at `order` pipeline's `done` stage. |
| `training` → `trainingAt` stamp | **dropped** (no reader). |

**Stage checklists.** `TASK_TEMPLATE` is re-keyed from the old stage keys to stage ids on
the seeded `install`/`order` pipelines: procurement + delivery items → `equipment-ordered`;
scheduled → `scheduled`; install + training → `installation`; signoff → `invoice`. A stage
Jeff adds later has no checklist (none is invented). Existing task rows are not touched;
new coverage keys use the new stage id, so an old project re-entering a renamed stage may
re-expand once — acceptable, logged as a known edge.

### 3.4 Quote stage ⇄ status

The stage's tag **is** the status for pipeline quotes; status stays the field every other
module reads (portal, approval gate, spawn, opportunities board, renewals), so nothing
downstream changes.

- **Stage → status:** moving to a stage whose tag differs from the current status calls the
  existing `setStatus` path — approval gate, history, revision-on-send, "Install sold"
  assignment, spawn — exactly as the status buttons do today. Same allowed transitions as
  today; a refused transition leaves the stage unchanged.
- **Status → stage:** any status write from elsewhere (estimator send, renewal send, Won
  buttons, `approve*` flows) snaps the stage to `firstStageWithTag(status)` when the
  current stage's tag is lower. Lost clears nothing — the stage stays where the deal died
  (useful history); the pill shows "Lost".
- Moving between two stages with the same tag (First Contact → Design) is a plain stage
  write with a history entry — no status change.
- Lead → quote conversion creates the quote at `firstStage` of `estimate-design`.

### 3.5 Settings UI

Settings gains a **Pipelines** section (admin permission): one card per pipeline, stage
rows with label edit, drag reorder, tag select, `advanceOnDelivered` toggle (project),
add/remove (with the in-use guard), and a "records in this stage" count. Quote pipelines
also expose which is the default for new system quotes. The estimator and quote header get
a pipeline switch (Estimate/Design ⇄ BID SPEC) and a stage bar; the Projects detail stage
tracker and board columns render from the project's pipeline.

### 3.6 Migration of existing data (read-time, no SQL migration)

Projects and quotes are JSONB docs with no promoted stage/status columns, so conversion
happens in the store normalizers (`normalizeProject`, quote normalize) on every read and
is persisted on the next save. The same normalizer runs on `/api/sync/push`, so an
offline Field Work device pushing an old stage key is converted, not stored raw.

| Old project stage | kind project → | kind order → |
|---|---|---|
| procurement | `equipment-ordered` | `order-materials` |
| delivery | `equipment-ordered` | `deliveries` |
| scheduled | `scheduled` | — |
| install, training | `installation` | — |
| signoff | `invoice` | `delivered` |
| complete | `complete` | `complete` |
| missing/unknown | first stage | first stage |

Existing `stageHistory` entries keep their old keys; a frozen `LEGACY_STAGE_LABELS` map
renders them ("Order materials", "Crew scheduled"…). Customer-feed rows (which key off
history index) are unaffected.

System quotes with no `pipelineId`: `estimate-design`, stage from status — draft →
`first-contact`, sent → `presentation`, won → `acceptance`, lost → no stage.

Import types (`import/types.ts` projects enum) switch from the 7 literals to "any stage
label or id of the chosen pipeline"; export writes the label.

## 4. Part 2 — Daylite history import

### 4.1 Where and how

A **Daylite history** card in the Import hub (admin). Jeff uploads the Projects and
Opportunities TSVs (either or both). The server parses, classifies and resolves every row
into a **preview** (counts per bucket, company matches, decisions needed). Nothing is
written until **Confirm**. Runs in production under Jeff's login — no env pulls.

All classification/mapping is a pure module (`src/lib/daylite/history.ts`) so the spec
harness covers it and the dry run uses the same code.

**Idempotence.** Ids are deterministic via `scripts/daylite-ids.ts` (D180 — the single
source of truth; the hub imports it, no second copy): projects `projectId(name, company)`
(`P-dl-…`, the id the July script already used), plus new `repairId` (`RP-dl-…`, matching the store's `RP-4000` prefix) and
`quoteId` (`Q-dl-…`) helpers added to that module. A re-run finds existing ids and skips
them (reported as "already imported"). Every record carries
`source: { system: "daylite", importedAt }`.

**Supersedes** the Projects.csv / Opportunities.csv branches of
`scripts/import-daylite.ts` (opps → leads, projects → procurement). Those branches are
removed so two mappings can't drift; the script keeps identity (companies/people) only.

### 4.2 Projects file

Classification (in order):

1. **Skip** — Status Cancelled, Abandoned, Deferred (~135).
2. **Service** — Pipeline Service Call or Repair, or (Pipeline blank and Category Service
   or Component Repair). (~950)
3. **Order** — Pipeline Custom Cables (5).
4. **Install** — everything else (~1,000).

| Bucket | Lands as | Stage / status | Dates |
|---|---|---|---|
| Done install | project, `install` pipeline | `complete` | `startedAt` = Start Date (fallback End Date); history: opened at start, closed at **End Date**; `targetDate` = Due Date or End Date |
| New install | project, `install` | mapped (table below) | Start Date; `targetDate` = Due Date, else none (never "42 days from now") |
| Done service | repair job | `completed`, completed at End Date | warranty computed from End Date → expired; **no follow-up task is created** |
| New service | repair job | Initial contact complete → approved · Service Scheduled → scheduled · Service Completed / Invoice Sent → completed | Start Date |
| Done order | project kind `order` | `complete` | as Done install |

Stage map for **New** installs (current + retired Daylite pipelines):

| Daylite stage | Install stage |
|---|---|
| (blank), 1 Initial contact, 1 Acceptance, 1 Assigned, 2 Walk-thru with EC | `initial-contact` |
| 2 Scheduled, 3 Scheduled/Installation | `scheduled` |
| 2/3 Installation, 3 Punch List, 4 Punchlist/Consultant Sign-off | `installation` |
| 4 Invoice, 4/5 User Training (/Documentation), 5 Client Training, 5/6 Documentation (Delivered/Delivery), 6 Complete – Satisfaction Survey Sent, 7 Final Invoice, 8 Final Payment Received | `invoice` |

(Acceptance maps to `initial-contact`, not `deposit`: a Daylite *project* at Acceptance
already exists as a job; the deposit step belonged to the opportunity.)

### 4.3 Opportunities file

| State | Handling |
|---|---|
| Won | **Value source only.** Matched to a project on norm(name)+norm(company); the project gets `value` and `valueUnknown: false`. (303 matches.) Unmatched Won opps are not imported. |
| Open (73) | System quote `Q-dl-…`, value from Value, `pipelineId` by Pipeline (Estimate/Design → `estimate-design`, BID SPEC → `bid-spec`, blank → `estimate-design`), no line items, note "Imported from Daylite". |
| Lost, Suspended, Abandoned | Skipped. |

Open-opp stage map:

| Daylite stage | Quote stage | Also |
|---|---|---|
| First Contact / (blank) | `first-contact` | |
| 2 Design, 2 Creation | `design` | |
| Collect Information | `collect-info` | |
| Create BID | `create-bid` | |
| Presentation/Delivery | `presentation` (sent) | |
| BID Sent | `bid-sent` (sent) | |
| Acceptance, Awarded | `acceptance` / `awarded` (won) | project at `deposit` |
| Down Payment, Equipment Ordered, Purchase Order Received, Order Product | won | project at `equipment-ordered` |
| Install | won | project at `installation` |
| Final Invoice | won | project at `invoice` |

For won open opps the importer links the quote to a matching **New** project (name +
company) and moves that project to the mapped stage if it is earlier; with no match it
creates the project itself (`createProject` with `quoteId`), so exactly one project per
sold job. Imported quotes are written with `historical-import` (gate bypassed) **and with
spawn suppressed** — today `historical-import` still spawns (registry.ts:983-999); the
Daylite path must not, since it creates/links projects explicitly.

### 4.4 Matching

- **Company:** `companyId(name)` exact (2,099/2,218 projects). A cell naming several
  companies is split greedily against known names (never on bare commas — "Sound
  Devices, LLC" is one company); 33 rows resolve to 2+ companies → the preview shows a
  per-row picker, pre-filled with the first match whose company `type` is not a
  contractor/architect/engineer. 86 blank → imported with no customer, flagged.
- **People:** first listed name, split on the last space into first/last, matched via
  `contactId(first, last, company)`; no match → kept in a note.
- **Owner:** exact match to a current user's name → owner; else `legacyOwner`
  text ("Original owner: Mike Mundth") and owner left unassigned so history does not load
  anyone's current worklist.
- **Dates:** `toISO` M/D/YY (2-digit years → 20xx; the data spans 2005–2026).

### 4.5 Preview screen

Counts per bucket (done installs, live installs, done/live service, orders, open quotes,
won-and-linked, skipped by reason, already imported), valued vs UKN, unmatched and
blank companies, the multi-company pickers, and live rows listed individually (≈130) so
Jeff can eyeball them. Confirm writes; a result panel links to Projects / Repairs / Quotes
filtered to `source: daylite`.

### 4.6 Superseding the July import

A real-file preview on a copy of the dev DB showed `scripts/import-daylite.ts` (July) is
already in the data — 1,784 live `P-dl-*` projects (service calls and
Cancelled/Abandoned/Deferred rows written as "complete" projects), 1,675 `L-dl-*` leads
(one per opportunity), and stub companies for every raw Companies cell not in the book,
including combined names like "C.D. Smith Construction, Muermann Engineering". Jeff
decided (2026-09-24):

1. **Replace** the July projects with the history import's full data.
2. **Remove** the July leads made from opportunities.
3. **Retire** the junk combined-name companies, in the same import.

Rules (code: `src/lib/daylite/history-commit.ts`, `src/lib/daylite/july-cleanup.ts`):

- **July record** = a live doc with a `P-dl-`/`L-dl-` id and no `source.system ===
  "daylite"` marker (the history import always writes it; July never did).
  **Untouched** = doc `updatedAt − createdAt < 60 s`. Only untouched July records are
  replaced or removed; edited ones are left exactly as they are, listed in the preview as
  "Edited in Quartzite — left as is", and their row writes nothing (no duplicate job).
  Every removal is a soft delete (`deleted = true`) — recoverable.
- **julyId** on every plan row = the id the July script gave it: `projectId(Name, RAW
  Companies cell)` (projects/service calls), `leadId(Name, RAW cell)` (opps).
- **Splitter:** the longest known run wins unless it decomposes fully into ≥2 known
  shorter runs — then the parts win ("Sound Devices, LLC" stays one; the stubbed
  combined name splits into its real companies).
- **Per row (chunked commit, deterministic):** install/order with an untouched July
  record at its own id → one upsert over it; at a different julyId → write the new record,
  then soft-delete the July one; service call → write the repair, soft-delete the July
  project; skipped row (Cancelled/Abandoned/Deferred/duplicate) → soft-delete its July
  record (a July id a kept row owns is never in this list). A won quote whose project id
  holds an untouched July record creates its sold project over it; that id is never
  retired by the project phase. Work list order: projects → July retire rows → quotes.
- **Finalize** (once, after the last chunk; idempotent; "Retry finalize"): soft-delete
  every untouched July lead when the Opportunities file was imported, then retire each
  live company whose comma name decomposes fully into ≥2 OTHER live companies — only if
  no live contact, no venue but its own base venue, no email domain, and no live doc in
  any doc table (nor settings/blobs) references it or its base venue. Kept ones are
  listed with the reason. The reference scan is one query per table for all candidates.
- July projects no row matches are counted in the preview and never removed.

## 5. UKN values

- `valueUnknown?: boolean` on projects and repair jobs (value stays 0 in storage).
- Every value render goes through one `formatJobValue(rec)` → "UKN" when unknown.
- Reports/dashboard sums (`metrics.ts` projected profit, installs forecast, Sales/Installs
  reports, company totals) skip unknown records and show "N jobs with unknown value".
- Projects list filter **Value unknown**. Saving any value clears the flag.
- Only the Daylite importer sets the flag.

## 6. Testing

- **Spec harness** (`scripts/test-review-and-spec.ts`): pipeline validator; tag helpers;
  legacy→new stage conversion (both kinds, unknown key); quote stage⇄status both
  directions incl. refused transitions; `advanceOnDelivered` only on all-received;
  sign-off → closeout not done; Daylite classifier + every mapping table above; multi-company
  splitter; idempotent re-run; UKN exclusion in metrics. Existing assertions on the 7-stage
  order, `dueChipLabel`, `isOpenStage` are rewritten to the tag model.
- **Gates** (memory `peak-verification-gate-protocol`): tsc, test:specs, test:smoke,
  eslint vs a stash-free baseline, real numbers reported.
- **Dry run** on a scratch datadir seeded from a copy of `.data/pglite` (never the live
  dir): counts must reproduce the profile — ~1,000 installs, ~950 service, 5 orders,
  303 valued, 73 open quotes, 33 pickers, 86 blank companies.
- **Browser**: Settings pipeline editor, project board/detail tracker, Schedule, Field
  Work, estimator stage bar + pipeline switch, import preview → confirm on the scratch DB.

## 7. Rollout

1. **Part 1 (pipelines)** → main → prod. Read-time conversion touches the handful of live
   records on their next save.
2. **Part 2 (import)** → main → prod. Jeff runs it: upload, review preview, confirm.

**No preview-deploy testing on real records.** Vercel previews share the production DB
(memory `project-vercel-preview-writes-production-db`): a preview build would save new
stage ids that the live build reads as unknown (and schedule/page.tsx:1831 throws). Test
locally; ship to main.

**Parallel-session hazard.** Other sessions are active on quote spawning
(`feat/quote-spawn-hardening`) and quote intake. §3.4 and §4.3 touch `quotes.ts`
`setStatus` and `quote-spawn.ts`; rebase onto main immediately before each merge and
re-run gates.

## 8. Out of scope

- Calendar Events (recurring internal events; the linked consulting deadlines belong to
  #145 engagement milestones).
- Pipelines for repairs, flame tests, inspections, rentals, consulting.
- Line items for imported quotes; Won opportunities without a project; Lost/Suspended
  opportunities.
- Daylite API pull (`scripts/pull-daylite.ts`) — the TSV route is what Jeff has.

## 9. Open items

- **O1** — does BID SPEC have a stage before Collect Information (export numbers Create BID
  as 3)? If yes, add it as a `draft` stage in the seed; editable later regardless.
- **O2** — resolved: the July import is in the data; the history import supersedes it —
  see §4.6.
