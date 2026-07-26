# CRM Plan 04 — Customer Activity Timeline + Real Notes Implementation Plan (#21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the customer page a Daylite-style **Activity** feed (#21): a read-time merged timeline over quote status history (+ PO-received / portal-acceptance annexes), comm messages, site visits, flame/repair/inspection point stamps, surveys, project stage changes and project notes — grouped under date buckets ("Today" / "Yesterday" / "This week" / "Last week" / "This month" / "June 2026") — PLUS a new **`notes` doc-collection** so the feed is a note-taking surface, not just system events. The composer writes real, attachable `NoteRecord`s (`parentKind: "customer" | "lead" | "project" | "quote"` — v1 UI only writes `"customer"`, the shape is built for the rest now). **No field-level change tracking** (spec decision C).

**Architecture:** One new doc-collection, `notes` (docTable + `DOC_TABLES` in `src/db/doc-tables.ts`, drizzle migration **0010**; **NOT** in `SYNCABLE_COLLECTIONS` / `FIELD_COLLECTIONS` — server-action writes only, the engagements/site-visits precedent) with a thin store `src/lib/stores/notes.ts` (`N-####` ids from base 7000 — prefix and base verified free). All feed logic is **pure and spec-covered**: `src/lib/customer-feed-rows.ts` (per-source `FeedRow` builders over structural arg types, ZERO store imports — the one allowed import is `VISIT_STAGE_META` from the dependency-free `@/lib/lead-thread`) and `src/lib/feed-buckets.ts` (`bucketFor`/`groupRows`, local-time Date-part math, Monday-start weeks). A server-only loader `src/lib/customer-feed.ts` fans out over the stores (`Promise.all`, JS filters — the app's full-scan idiom, fine at beta scale), precomputes the two store-owned conversions the pure layer must not know about (inspection completion via `completedAtOf`, project stage labels via `stagesFor`), merges, sorts ts-desc and **caps at 60 rows** (`FEED_CAP` — "Show more" deferred, logged as a product flag). The customer page gains a full-width Activity card (bucket headers + 26px letter-dot rows, the home-team-activity idiom) with a tiny client composer island that imports ONLY the server-action stub `addCustomerNoteAction` (added to the EXISTING `src/app/(app)/companies/actions.ts`). The Communications card stays as-is — the feed duplicates comms, accepted for v1 (product flag for Jeff). `LeadActivity` is NOT migrated (its `logActivity` carries SLA side effects — firstContactAt/lastActivityAt — that must not be bypassed).

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle + PGlite/Postgres jsonb doc-store, hand-rolled `tsx` test harness.

## Global Constraints

- **Branch:** `crm-04-timeline-notes` off `main` (plan 03 merged at `4ff96b8`).
- **Doc-store idiom:** domain records are whole-JSON docs; no DB-level foreign keys (D85); all timestamps epoch-ms `number`s (the ONLY ISO-date fields in play are `scheduledDate`/`surveyDate`/`reportDate` — and the only one the feed needs, inspection completion, converts server-side via the store's own `completedAtOf`). New-collection reads pass through `normalizeNote` (`?? null` / `?? ""` backfills). Tombstones are already excluded by `listDocs`.
- **Migration discipline:** `npm run db:generate` emits drizzle **0010** for the `notes` table (`src/db/schema.ts` already re-exports doc-tables). Dev PGlite applies migrations **on boot** — the dev server MUST be restarted after generate, BEFORE any live check that writes a note (Task 1 Step 5). Prod applies at build via `scripts/migrate.mjs` (`npm run build` runs it). **No seed file** — post-prototype collections have none; `seedIfEmpty` only touches the prototype 11.
- **Sync mirror rule:** `SYNCABLE_COLLECTIONS` (src/db/doc-tables.ts) and `FIELD_COLLECTIONS` (src/lib/sync/engine.ts) stay untouched — `notes` is server-action-writes-only (the doc-tables comment explains why non-field collections must never be push-writable). Project field notes still ride sync through the `projects` doc — the new collection is separate and does not replace them.
- **Client-bundle rule:** `"use client"` files may only `import type` from any module that reaches `src/db/doc-store.ts` — a value import pulls PGlite into the browser bundle and fails `npm run build` (not tsc). Server actions are exempt (they compile to reference stubs). `customer-feed-rows.ts` / `feed-buckets.ts` are pure with no store imports; `customer-feed.ts` is server-only and only imported by the server page.
- **All writes go through `requireUser()`-checked server actions** (`@/lib/session`). `nextPrefixedId` is a racy max-scan — the customer-page composer is single-user-ish and `upsertDoc` suffices (no `insertDocIfAbsent`; noted in D121).
- **No new nav/bell/queue surfaces** — nav-counts.ts, queue.ts, notif-prefs.ts are all untouched by this plan.
- **Never run `npm run build` while a dev server is running** (PGlite is single-process; D106). A dev server IS running on :3000 — it stays up (restarted once in Task 1 for migration 0010) for live checks in Tasks 1–4; Task 5 kills it before the build and restarts it after.
- **Tests:** append `ok(cond, "msg")` assertions to `scripts/test-review-and-spec.ts` (single-file harness, **458 PASS today**; mid-file imports are fine under tsx; assert exact literals, no DB access — importing store modules is safe as long as no DB function is called; `normalizeNote` is pure). Insert new sections immediately BEFORE the final two lines (`console.log(fail ? ...)` / `process.exit(...)`). **TZ-safety house rule** (see the `queueDueLabel` comment in the harness, ~line 503): never assert locale/timezone-dependent literals derived from raw epoch numbers — build every test timestamp from LOCAL Date parts (`new Date(2026, 6, 24).getTime()` style) so assertions hold in any runner timezone. Run: `npm run test:specs`. Typecheck: `npx tsc --noEmit`. Both gates per task. `npm run lint` baseline is **70 errors** (plus ~1618 warnings) — net-zero goal.

---

### Task 1: `notes` collection — registration, migration 0010, store, minimal specs (TDD)

**Files:**
- Modify: `src/db/doc-tables.ts` (docTable export + `DOC_TABLES` entry; SYNCABLE_COLLECTIONS untouched)
- Create: `src/lib/stores/notes.ts`
- Generate: `drizzle/0010_*.sql` (+ `drizzle/meta` journal) via `npm run db:generate`
- Test: `scripts/test-review-and-spec.ts` (append the `ACTIVITY TIMELINE (#21)` section)

**Interfaces:**
- Consumes: `listDocs`/`nextPrefixedId`/`softDeleteDoc`/`upsertDoc` from `@/db/doc-store`.
- Produces (later tasks rely on these exact names): `type NoteRecord`, `type NoteParentKind`, `normalizeNote(n)` (exported for the spec harness — the surveys `blank()` precedent), `allNotes()`, `notesForCustomer(customerId)`, `addNoteRecord(input, me)`, `removeNote(id)`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts`, immediately before the final two lines (`console.log(fail ? ...)` / `process.exit(...)`):

```ts
/* ============ ACTIVITY TIMELINE (#21) ============ */
/* notes collection — normalize-on-read defaults. normalizeNote is pure
   (no DB touched by importing the store module). */
import { normalizeNote, type NoteRecord } from "@/lib/stores/notes";

{
  const T = new Date(2026, 5, 30, 10).getTime();
  const bare = {
    id: "N-7001",
    parentKind: "customer",
    parentId: "lakefront",
    by: "Jeff Chesebro",
    at: T,
    createdAt: T,
    updatedAt: T,
  } as unknown as NoteRecord;
  const n = normalizeNote(bare);
  ok(n.customerId === null, "#21: normalizeNote backfills a missing customerId to null");
  ok(n.text === "", "#21: normalizeNote backfills missing text to ''");

  const full = normalizeNote({
    id: "N-7002",
    parentKind: "lead",
    parentId: "L-1051",
    customerId: "lakefront",
    by: "Dana Whitmer",
    at: T,
    text: "Called about the valance",
    createdAt: T,
    updatedAt: T,
  });
  ok(
    full.customerId === "lakefront" && full.text === "Called about the valance",
    "#21: normalizeNote passes populated fields through"
  );
  ok(
    full.parentKind === "lead" && full.parentId === "L-1051",
    "#21: parentKind/parentId — attachable by design (the v1 composer only writes 'customer')"
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs`
Expected: the run errors (module `@/lib/stores/notes` does not exist yet).

- [ ] **Step 3: Register the collection + write the store**

In `src/db/doc-tables.ts`:

1. After the `tasks` export line (`export const tasks = docTable("tasks"); // cross-record task rows, promoted from embedded ProjectTask[] (#17)`), add:

```ts
export const notes = docTable("notes"); // attachable note records — the customer Activity feed's note-taking surface (#21)
```

2. In `DOC_TABLES`, after the `tasks,` entry, add:

```ts
  notes,
```

(`SYNCABLE_COLLECTIONS` is NOT touched — notes are server-action writes only.)

Create `src/lib/stores/notes.ts`:

```ts
import { listDocs, nextPrefixedId, softDeleteDoc, upsertDoc } from "@/db/doc-store";

/**
 * Notes (#21) — the first REAL note record in the app (the three prior
 * "notes" are per-record fields: ProjectNote[] embedded in projects,
 * SurveyDraft.notes and SiteVisit.notes freeform strings). A NoteRecord is
 * attachable by design: `parentKind`/`parentId` name the record it hangs on,
 * and `customerId` is denormalized so the customer Activity feed reads notes
 * with one filter, no joins. The v1 composer (customer page) only writes
 * parentKind "customer" — the shape carries lead/project/quote now so later
 * surfaces need no migration.
 *
 * NOT syncable (server-action writes only — the engagements/site_visits
 * precedent; see the SYNCABLE_COLLECTIONS comment in doc-tables.ts).
 * nextPrefixedId is a racy max-scan; the single-user-ish composer makes
 * upsertDoc fine here (no insertDocIfAbsent — D121).
 */

export type NoteParentKind = "customer" | "lead" | "project" | "quote";

export type NoteRecord = {
  id: string; // 'N-####' (base 7000)
  parentKind: NoteParentKind;
  parentId: string;
  /** Denormalized customer link: customer-parent → parentId; other parents →
   *  their customerId when known, else null. The feed's one filter key. */
  customerId: string | null;
  by: string; // team-member NAME (app convention)
  at: number; // epoch-ms — the feed timestamp
  text: string;
  createdAt: number;
  updatedAt: number;
};

/** Normalize-on-read (#21). Exported for the spec harness — pure. */
export function normalizeNote(n: NoteRecord): NoteRecord {
  n.customerId = n.customerId ?? null;
  n.text = n.text ?? "";
  n.by = n.by ?? "";
  n.at = n.at ?? n.createdAt ?? 0;
  return n;
}

/** All notes, newest first. */
export async function allNotes(): Promise<NoteRecord[]> {
  const list = await listDocs<NoteRecord>("notes");
  return list.map(normalizeNote).sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** The customer feed read — denormalized customerId, one filter. */
export async function notesForCustomer(customerId: string): Promise<NoteRecord[]> {
  return (await allNotes()).filter((n) => n.customerId === customerId);
}

export async function addNoteRecord(
  input: { parentKind: NoteParentKind; parentId: string; customerId: string | null; text: string },
  me: string
): Promise<NoteRecord> {
  const id = await nextPrefixedId("notes", "N", 7000);
  const t = Date.now();
  const n: NoteRecord = {
    id,
    parentKind: input.parentKind,
    parentId: input.parentId,
    customerId: input.customerId ?? null,
    by: me,
    at: t,
    text: input.text.trim(),
    createdAt: t,
    updatedAt: t,
  };
  await upsertDoc<NoteRecord>("notes", n);
  return n;
}

/** Soft delete (doc-store tombstone). */
export async function removeNote(id: string): Promise<void> {
  await softDeleteDoc("notes", id);
}
```

- [ ] **Step 4: Generate migration 0010**

```bash
npm run db:generate
```

Expected: drizzle-kit emits `drizzle/0010_<name>.sql` creating the `notes` table (id/doc/rev/seq/updated_at/received_at/review/deleted + `notes_seq_idx`/`notes_deleted_idx` — the docTable shape). Inspect the SQL to confirm it only creates `notes`.

- [ ] **Step 5: Restart the dev server (PGlite migrates on boot)**

```bash
lsof -ti tcp:3000 | xargs -r kill
npm run dev
```

(Background it / new terminal. This MUST happen before any live check writes a note — the dev PGlite only applies 0010 at boot.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:specs` — all new `#21:` lines PASS; suite ends `ALL PASSED`.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/doc-tables.ts src/lib/stores/notes.ts drizzle scripts/test-review-and-spec.ts
git commit -m "feat: notes doc-collection — attachable NoteRecord store + migration 0010 (#21)"
```

---

### Task 2: Pure feed modules — `customer-feed-rows.ts` + `feed-buckets.ts` + the full #21 spec section (TDD)

**Files:**
- Create: `src/lib/customer-feed-rows.ts`
- Create: `src/lib/feed-buckets.ts`
- Test: `scripts/test-review-and-spec.ts` (append inside the `ACTIVITY TIMELINE (#21)` section)

**Interfaces:**
- Consumes: `VISIT_STAGE_META` from `@/lib/lead-thread` (dependency-free, pure — the ONE allowed import).
- Produces (Task 3/4 rely on these exact names): `type FeedRow`, `type FeedKind`, `FEED_META`, `quoteFeedRows`, `commFeedRows`, `visitFeedRows`, `jobFeedRows`, `surveyFeedRows`, `projectFeedRows`, `noteFeedRows`; `bucketFor(ts, now)`, `groupRows(rows, now)`.

Label-vocab note (the code argues with the brief): the builders CANNOT import `STAGE_LABEL` from quotes.ts or `STAGES` from surveys.ts — both modules value-import `@/db/doc-store`, which this pure module must never reach. The stage vocab is therefore mirrored in small local maps (`QUOTE_VERB`, `SURVEY_STAGE_LABEL`) with the spec pinning every literal, so vocabulary drift breaks the suite; project stage labels differ per kind (`stagesFor`) and are passed IN by the server loader as a `stageShort` map arg — the same keep-it-pure move the brief mandates for the inspection completion ts.

- [ ] **Step 1: Write the failing tests**

Append INSIDE the `ACTIVITY TIMELINE (#21)` region of `scripts/test-review-and-spec.ts` (directly after Task 1's closing `}`, still before the final two lines):

```ts
/* #21 — date buckets. House rule (see the queueDueLabel note above): never
   assert locale/TZ-dependent literals from raw epoch numbers — every
   timestamp below is built from LOCAL Date parts, so the assertions hold in
   any runner timezone. Weeks start Monday. */
import { bucketFor, groupRows } from "@/lib/feed-buckets";
import {
  commFeedRows,
  FEED_META,
  jobFeedRows,
  noteFeedRows,
  projectFeedRows,
  quoteFeedRows,
  surveyFeedRows,
  visitFeedRows,
} from "@/lib/customer-feed-rows";

{
  const NOW = new Date(2026, 6, 24, 12, 0, 0).getTime(); // Fri Jul 24 2026, noon local

  ok(bucketFor(new Date(2026, 6, 24, 0, 0, 0).getTime(), NOW) === "Today", "#21: local midnight today is Today");
  ok(bucketFor(new Date(2026, 6, 24, 18).getTime(), NOW) === "Today", "#21: later today (even future of now) is Today");
  ok(
    bucketFor(new Date(2026, 6, 24, 13).getTime(), NOW) === "Today",
    "#21: later today (now + 1h, same local day) is Today, not Upcoming"
  );
  ok(
    bucketFor(new Date(2026, 6, 26, 9).getTime(), NOW) === "Upcoming",
    "#21: now + 2 days (e.g. a scheduled site visit's future startAt) is Upcoming"
  );
  ok(
    bucketFor(new Date(2026, 6, 23, 23, 59, 59).getTime(), NOW) === "Yesterday",
    "#21: 23:59:59 yesterday is Yesterday — the day edge is local midnight"
  );
  ok(bucketFor(new Date(2026, 6, 23, 0).getTime(), NOW) === "Yesterday", "#21: yesterday start is Yesterday");
  ok(bucketFor(new Date(2026, 6, 22, 9).getTime(), NOW) === "This week", "#21: Wednesday of the current Mon-start week is This week");
  ok(bucketFor(new Date(2026, 6, 20, 0).getTime(), NOW) === "This week", "#21: Monday 00:00 opens This week");
  ok(bucketFor(new Date(2026, 6, 19, 23).getTime(), NOW) === "Last week", "#21: Sunday night before rolls over to Last week");
  ok(bucketFor(new Date(2026, 6, 13, 0).getTime(), NOW) === "Last week", "#21: last Monday 00:00 opens Last week");
  ok(bucketFor(new Date(2026, 6, 12, 12).getTime(), NOW) === "This month", "#21: older than last week but this month is This month");
  ok(bucketFor(new Date(2026, 6, 1, 0).getTime(), NOW) === "This month", "#21: the 1st opens This month");
  ok(bucketFor(new Date(2026, 5, 30, 12).getTime(), NOW) === "June 2026", "#21: last month labels '<Month Year>'");
  ok(bucketFor(new Date(2025, 11, 25).getTime(), NOW) === "December 2025", "#21: older years keep the month-year label");

  // groupRows — ordering + stability (rows pre-sorted ts desc)
  const rows = [
    { id: "a", ts: new Date(2026, 6, 24, 11).getTime() },
    { id: "b", ts: new Date(2026, 6, 24, 9).getTime() },
    { id: "c", ts: new Date(2026, 6, 23, 15).getTime() },
    { id: "d", ts: new Date(2026, 6, 21, 8).getTime() },
    { id: "e", ts: new Date(2026, 6, 15, 8).getTime() },
    { id: "f", ts: new Date(2026, 5, 2, 8).getTime() },
  ];
  const groups = groupRows(rows, NOW);
  ok(
    groups.map((g) => g.bucket).join("|") === "Today|Yesterday|This week|Last week|June 2026",
    "#21: groupRows walks the buckets in feed order"
  );
  ok(groups[0].rows.map((r) => r.id).join(",") === "a,b", "#21: same-bucket rows keep their pre-sorted order (stable)");
  ok(groups[3].rows.length === 1 && groups[3].rows[0].id === "e", "#21: single-row buckets survive intact");
}

/* #21 — pure row builders, exact literals. */
{
  const T1 = new Date(2026, 6, 20, 9).getTime();
  const T2 = new Date(2026, 6, 22, 14).getTime();
  const T3 = new Date(2026, 6, 23, 10).getTime();

  // quotes — one row per history entry + PO / portal-acceptance annex rows
  const q = quoteFeedRows({
    id: "Q-2041",
    name: "Riverside PAC rigging",
    history: [
      { at: T1, to: "draft" },
      { at: T2, to: "sent" },
    ],
    poReceivedAt: T3,
    portalAcceptance: { at: T3, by: "Dana Whitmer" },
  });
  ok(q.length === 4, "#21: quote history + PO + portal acceptance = 4 rows");
  ok(
    q[0].title === "Quote Q-2041 drafted" && q[1].title === "Quote Q-2041 sent",
    "#21: history rows verb the stage vocab (draft/sent/won/lost)"
  );
  ok(q[2].title === "Quote Q-2041 PO received" && q[2].ts === T3, "#21: poReceivedAt annex row (setPoReceived writes NO history)");
  ok(
    q[3].title === "Quote Q-2041 accepted in portal" && q[3].by === "Dana Whitmer",
    "#21: portal-acceptance annex row carries the actor"
  );
  ok(
    q[0].href === "/quotes?id=Q-2041" && q[0].kind === "quote" && q[0].sub === "Riverside PAC rigging",
    "#21: quote rows deep-link /quotes?id= and sub the quote name"
  );
  ok(
    quoteFeedRows({ id: "Q-2042", name: "x", history: [{ at: T1, to: "draft" }] }).length === 1,
    "#21: absent annex fields add no rows"
  );

  // comms — one row per message; draft threads and Deleted-folder threads skipped
  const c = commFeedRows({
    id: "C-1032",
    subject: "Valance quote follow-up",
    status: "waiting_us",
    messages: [
      { id: "m1-aaaa", at: T1, direction: "in", channel: "email", author: "Sarah Chen" },
      { id: "m2-bbbb", at: T2, direction: "out", channel: "call", author: "Jeff Chesebro" },
    ],
  });
  ok(c.length === 2 && c[0].title === "Valance quote follow-up", "#21: comm rows title the thread subject");
  ok(c[0].sub === "Received · email" && c[1].sub === "Sent · call", "#21: comm sub is direction · channel");
  ok(c[0].href === "/inbox?thread=C-1032" && c[1].by === "Jeff Chesebro", "#21: comm rows deep-link the inbox thread");
  ok(
    commFeedRows({
      id: "C-1",
      subject: "s",
      status: "draft",
      messages: [{ id: "m", at: T1, direction: "out", channel: "email", author: "x" }],
    }).length === 0,
    "#21: draft threads are skipped"
  );
  ok(
    commFeedRows({
      id: "C-2",
      subject: "s",
      status: "closed",
      deleted: true,
      messages: [{ id: "m", at: T1, direction: "out", channel: "email", author: "x" }],
    }).length === 0,
    "#21: Deleted-folder threads are skipped (thread flag, distinct from the row tombstone)"
  );

  // visits — ts = startAt ?? createdAt; sub = VISIT_STAGE_META label
  const v = visitFeedRows({
    id: "SV-5001",
    reason: "Site survey / measure",
    stage: "scheduled",
    startAt: T2,
    createdAt: T1,
    assignedTo: "Mike Torres",
  });
  ok(v.length === 1 && v[0].ts === T2 && v[0].title === "Site visit — Site survey / measure", "#21: visit row at startAt");
  ok(v[0].sub === "Scheduled" && v[0].href === "/field-survey" && v[0].by === "Mike Torres", "#21: visit sub is the stage label");
  const vr = visitFeedRows({ id: "SV-5002", reason: "Punch walk", stage: "requested", startAt: null, createdAt: T1, assignedTo: "" });
  ok(vr[0].ts === T1 && vr[0].sub === "Requested", "#21: unscheduled request falls back to createdAt");

  // jobs — point stamps; null completion adds no row; legacy zero requestedAt skipped
  const fj = jobFeedRows("flame", {
    id: "FT-3001",
    venue: "Auditorium",
    openedAt: T1,
    openedBy: "Jeff Chesebro",
    completedAt: T2,
    completedBy: "Mike Torres",
  });
  ok(
    fj.length === 2 && fj[0].title === "Flame test FT-3001 approved" && fj[1].title === "Flame test FT-3001 completed",
    "#21: flame approved + completed rows"
  );
  ok(
    jobFeedRows("repair", { id: "RP-4001", venue: "", openedAt: T1, openedBy: "", completedAt: null, completedBy: "" }).length === 1,
    "#21: null completedAt adds no completion row"
  );
  const ij = jobFeedRows("inspection", {
    id: "RI-2042",
    venue: "Main stage",
    openedAt: 0,
    openedBy: "",
    completedAt: T2,
    completedBy: "Dana Whitmer",
  });
  ok(ij.length === 1 && ij[0].title === "Inspection RI-2042 completed", "#21: zero requestedAt (legacy default) adds no request row");
  ok(
    jobFeedRows("inspection", { id: "RI-2043", venue: "", openedAt: T1, openedBy: "Sarah Chen", completedAt: null, completedBy: "" })[0]
      .title === "Inspection RI-2043 requested",
    "#21: the inspection open verb is 'requested'"
  );

  // surveys — one row at updatedAt with the stage label
  const s = surveyFeedRows({ id: "FS-1054", stage: "completed", venue: "Black box", updatedAt: T3 });
  ok(s.length === 1 && s[0].title === "Survey FS-1054 — Completed" && s[0].ts === T3, "#21: survey row titles id + stage label");
  ok(s[0].href === "/field-survey?id=FS-1054", "#21: survey row deep-links the survey");

  // projects — stage-history rows (loader-passed short labels) + newest-first notes handled
  const pj = projectFeedRows(
    {
      id: "P-3001",
      name: "Westfield HS auditorium",
      stageHistory: [
        { at: T1, to: "procurement", by: "Jeff Chesebro" },
        { at: T2, to: "install", by: "Mike Torres" },
      ],
      notes: [
        { id: "nt-b", at: T3, by: "Mike Torres", text: "Crew on site, linesets 1-8 done. " + "x".repeat(90) },
        { id: "nt-a", at: T1, by: "Jeff Chesebro", text: "Kickoff scheduled" },
      ],
    },
    { procurement: "Materials", install: "Install" }
  );
  ok(pj.length === 4, "#21: stage-history + project-note rows all present");
  ok(
    pj[0].title === "Project P-3001 → Materials" && pj[1].title === "Project P-3001 → Install" && pj[1].by === "Mike Torres",
    "#21: stage rows use the passed short labels + actor (D83 anchors an opening from:null entry — renders the same way)"
  );
  ok(pj[2].title.length === 80, "#21: project-note titles clamp to 80 chars");
  ok(pj[2].ts === T3 && pj[3].ts === T1, "#21: NEWEST-FIRST ProjectNote order passes through untouched — the loader sorts by ts");
  ok(pj[2].kind === "project-note" && pj[0].kind === "project-stage", "#21: project row kinds");

  // notes — the real record rows
  const nr = noteFeedRows({ id: "N-7001", at: T2, by: "Jeff Chesebro", text: "Board approved the budget" });
  ok(nr.length === 1 && nr[0].kind === "note" && nr[0].title === "Board approved the budget", "#21: note rows title the full text (the UI clamps display)");
  ok(nr[0].href === null && nr[0].by === "Jeff Chesebro", "#21: note rows have no deep link");
  ok(FEED_META.note.letter === "N" && FEED_META.quote.letter === "Q", "#21: letter-dot glyphs");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs`
Expected: the run errors (modules `@/lib/feed-buckets` / `@/lib/customer-feed-rows` do not exist yet).

- [ ] **Step 3: Write `src/lib/feed-buckets.ts`**

```ts
/**
 * #21 Daylite-style date buckets — PURE, local-time. All boundaries are
 * computed from explicit LOCAL Date parts (never `ts - N*DAY` ms math), so
 * DST shifts can't skew a day edge and the spec harness can assert exact
 * bucket literals from Date-part-constructed timestamps in any timezone.
 * Weeks start Monday. Same-day future timestamps (clock skew) still read
 * "Today"; timestamps at/after tomorrow's local midnight bucket as
 * "Upcoming" (e.g. a scheduled site visit with a future startAt) — reviewer
 * fix so future-dated rows don't sit under "Today".
 */

function dayStart(ms: number, shiftDays = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + shiftDays).getTime();
}

/** Monday 00:00 local of ms's week (optionally shifted by days). */
function weekStart(ms: number, shiftDays = 0): number {
  const d = new Date(ms);
  const mondayOffset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset + shiftDays).getTime();
}

export function bucketFor(ts: number, now: number): string {
  if (ts >= dayStart(now, 1)) return "Upcoming";
  if (ts >= dayStart(now)) return "Today";
  if (ts >= dayStart(now, -1)) return "Yesterday";
  if (ts >= weekStart(now)) return "This week";
  if (ts >= weekStart(now, -7)) return "Last week";
  const d = new Date(now);
  if (ts >= new Date(d.getFullYear(), d.getMonth(), 1).getTime()) return "This month";
  return new Date(ts).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Group PRE-SORTED (ts desc) rows under their buckets, preserving order.
 * Adjacent-run grouping: bucket assignment is a monotone step function of
 * ts, so sorted input can never split a bucket into two groups. "Upcoming"
 * is the highest-ts bucket, so when present it naturally forms the FIRST
 * group — no special-casing needed here, ts-desc order already does the
 * work.
 */
export function groupRows<T extends { ts: number }>(
  rows: T[],
  now: number
): Array<{ bucket: string; rows: T[] }> {
  const out: Array<{ bucket: string; rows: T[] }> = [];
  for (const r of rows) {
    const b = bucketFor(r.ts, now);
    const last = out[out.length - 1];
    if (last && last.bucket === b) last.rows.push(r);
    else out.push({ bucket: b, rows: [r] });
  }
  return out;
}
```

- [ ] **Step 4: Write `src/lib/customer-feed-rows.ts`**

```ts
/**
 * #21 customer Activity feed — PURE per-source row builders. Structural arg
 * types, ZERO store imports (every store module value-imports doc-store,
 * which must never reach this spec-tested / potentially-client-safe layer).
 * The ONE allowed import is VISIT_STAGE_META from @/lib/lead-thread — that
 * module is dependency-free by construction (plan 03).
 *
 * Vocab mirrors (drift-guarded by exact-literal specs, see the #21 section
 * of the harness): QUOTE_VERB mirrors quotes.STAGE_LABEL's stage set;
 * SURVEY_STAGE_LABEL mirrors surveys.STAGES labels. Project stage labels
 * vary per kind (stagesFor) and are passed IN by the server loader.
 */
import { VISIT_STAGE_META } from "@/lib/lead-thread";

export type FeedKind =
  | "note"
  | "quote"
  | "comm"
  | "visit"
  | "flame"
  | "repair"
  | "inspection"
  | "survey"
  | "project-stage"
  | "project-note";

export type FeedRow = {
  /** Unique across the whole feed — "<kind>:<recordId>:<n>" shapes. */
  id: string;
  kind: FeedKind;
  /** epoch-ms — the merge/sort key. */
  ts: number;
  title: string;
  sub: string;
  ink: string; // letter-dot ink
  soft: string; // letter-dot background
  letter: string; // letter-dot glyph
  href: string | null; // null = plain row (no navigation)
  by: string; // actor when known; "" hides the segment in the UI
};

/** Letter-dot families per kind (the app's chip color families). */
export const FEED_META: Record<FeedKind, { letter: string; ink: string; soft: string }> = {
  note: { letter: "N", ink: "#8a6d1f", soft: "#fbf3dd" },
  quote: { letter: "Q", ink: "#3155a8", soft: "#e9eefb" },
  comm: { letter: "C", ink: "#7b3f8a", soft: "#f3eaf5" },
  visit: { letter: "V", ink: "#1f7a52", soft: "#eaf6ef" },
  flame: { letter: "F", ink: "#b4543a", soft: "#f8ece7" },
  repair: { letter: "R", ink: "#b4543a", soft: "#f8ece7" },
  inspection: { letter: "I", ink: "#b4543a", soft: "#f8ece7" },
  survey: { letter: "S", ink: "#3155a8", soft: "#e9eefb" },
  "project-stage": { letter: "P", ink: "#3155a8", soft: "#e9eefb" },
  "project-note": { letter: "P", ink: "#8a6d1f", soft: "#fbf3dd" },
};

function row(
  kind: FeedKind,
  id: string,
  ts: number,
  title: string,
  sub: string,
  href: string | null,
  by: string
): FeedRow {
  const m = FEED_META[kind];
  return { id, kind, ts, title, sub, ink: m.ink, soft: m.soft, letter: m.letter, href, by };
}

/** Mirrors quotes.STAGE_LABEL's stage set as past-tense verbs ("Quote
 *  Q-2041 sent"); unknown stages fall through as the raw key. */
const QUOTE_VERB: Record<string, string> = {
  draft: "drafted",
  sent: "sent",
  won: "won",
  lost: "lost",
};

export function quoteFeedRows(q: {
  id: string;
  name: string;
  history: Array<{ at: number; to: string }>;
  /** setPoReceived writes NO history entry — this annex field is the record. */
  poReceivedAt?: number | null;
  portalAcceptance?: { at: number; by: string } | null;
}): FeedRow[] {
  const href = "/quotes?id=" + encodeURIComponent(q.id);
  const rows = (q.history || []).map((h, i) =>
    row("quote", `quote:${q.id}:${i}`, h.at, `Quote ${q.id} ${QUOTE_VERB[h.to] ?? h.to}`, q.name, href, "")
  );
  if (q.poReceivedAt != null)
    rows.push(row("quote", `quote:${q.id}:po`, q.poReceivedAt, `Quote ${q.id} PO received`, q.name, href, ""));
  if (q.portalAcceptance)
    rows.push(
      row(
        "quote",
        `quote:${q.id}:portal`,
        q.portalAcceptance.at,
        `Quote ${q.id} accepted in portal`,
        q.name,
        href,
        q.portalAcceptance.by
      )
    );
  return rows;
}

export function commFeedRows(thread: {
  id: string;
  subject: string;
  status: string;
  /** Thread-level Deleted-folder flag — distinct from the row tombstone
   *  (which listDocs already excludes). */
  deleted?: boolean;
  messages: Array<{ id: string; at: number; direction: "in" | "out"; channel: string; author: string }>;
}): FeedRow[] {
  if (thread.status === "draft" || thread.deleted) return [];
  const href = "/inbox?thread=" + encodeURIComponent(thread.id);
  return (thread.messages || []).map((m) =>
    row(
      "comm",
      `comm:${thread.id}:${m.id}`,
      m.at,
      thread.subject || "Conversation",
      `${m.direction === "in" ? "Received" : "Sent"} · ${m.channel}`,
      href,
      m.author || ""
    )
  );
}

export function visitFeedRows(v: {
  id: string;
  reason: string;
  stage: string;
  startAt: number | null;
  createdAt: number;
  assignedTo: string;
}): FeedRow[] {
  const meta = VISIT_STAGE_META[v.stage as keyof typeof VISIT_STAGE_META];
  return [
    row(
      "visit",
      `visit:${v.id}`,
      v.startAt ?? v.createdAt,
      `Site visit — ${v.reason}`,
      meta ? meta.label : v.stage,
      "/field-survey",
      v.assignedTo || ""
    ),
  ];
}

const JOB_NOUN = { flame: "Flame test", repair: "Repair", inspection: "Inspection" } as const;
const JOB_OPEN_VERB = { flame: "approved", repair: "approved", inspection: "requested" } as const;
const JOB_HREF = { flame: "/flame-tests", repair: "/repairs", inspection: "/inspections" } as const;

/**
 * Flame / repair / inspection point stamps. openedAt is approvedAt (flame,
 * repair — epoch-ms, always set) or requestedAt (inspection — epoch-ms
 * DEFAULTING TO 0 on legacy records, hence the falsy skip). completedAt is
 * epoch-ms for flame/repair; for inspections the loader precomputes it via
 * the store's completedAtOf (ISO surveyDate/reportDate → ms) — the pure
 * module never parses dates. The "scheduled" transition has NO ms stamp
 * anywhere (scheduledDate is a bare ISO day) — deliberately skipped.
 */
export function jobFeedRows(
  kind: "flame" | "repair" | "inspection",
  job: {
    id: string;
    venue: string;
    openedAt: number | null;
    openedBy: string;
    completedAt: number | null;
    completedBy: string;
  }
): FeedRow[] {
  const rows: FeedRow[] = [];
  if (job.openedAt)
    rows.push(
      row(kind, `${kind}:${job.id}:open`, job.openedAt, `${JOB_NOUN[kind]} ${job.id} ${JOB_OPEN_VERB[kind]}`, job.venue, JOB_HREF[kind], job.openedBy || "")
    );
  if (job.completedAt != null)
    rows.push(
      row(kind, `${kind}:${job.id}:done`, job.completedAt, `${JOB_NOUN[kind]} ${job.id} completed`, job.venue, JOB_HREF[kind], job.completedBy || "")
    );
  return rows;
}

/** Mirrors surveys.STAGES labels (same drift guard as QUOTE_VERB). */
const SURVEY_STAGE_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  onsite: "On-site",
  completed: "Completed",
};

/** One row per survey at updatedAt — surveys carry no completedAt. */
export function surveyFeedRows(s: { id: string; stage: string; venue: string; updatedAt: number }): FeedRow[] {
  return [
    row(
      "survey",
      `survey:${s.id}`,
      s.updatedAt,
      `Survey ${s.id} — ${SURVEY_STAGE_LABEL[s.stage] ?? s.stage}`,
      s.venue || "",
      `/field-survey?id=${encodeURIComponent(s.id)}`,
      ""
    ),
  ];
}

/**
 * Project stage history (D83 — normalized to [] on read; anchored with an
 * opening from:null entry on post-D83 records, legitimately empty on legacy
 * ones) + embedded ProjectNotes. REMEMBER: notes[] is NEWEST-FIRST (addNote
 * unshifts) — order is NOT assumed here; the loader sorts the merged feed.
 * stageShort maps stage keys → display labels (built by the loader from
 * stagesFor(p.kind) — labels differ between projects and orders).
 */
export function projectFeedRows(
  p: {
    id: string;
    name: string;
    stageHistory: Array<{ at: number; to: string; by: string }>;
    notes: Array<{ id: string; at: number; by: string; text: string }>;
  },
  stageShort: Record<string, string>
): FeedRow[] {
  const href = "/projects?id=" + encodeURIComponent(p.id);
  const rows = (p.stageHistory || []).map((h, i) =>
    row("project-stage", `project:${p.id}:stage:${i}`, h.at, `Project ${p.id} → ${stageShort[h.to] ?? h.to}`, p.name, href, h.by || "")
  );
  for (const n of p.notes || [])
    rows.push(row("project-note", `project:${p.id}:note:${n.id}`, n.at, n.text.slice(0, 80), p.name, href, n.by || ""));
  return rows;
}

/** Real NoteRecord rows — full text as title (the UI clamps display). */
export function noteFeedRows(n: { id: string; at: number; by: string; text: string }): FeedRow[] {
  return [row("note", `note:${n.id}`, n.at, n.text, "Note", null, n.by || "")];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:specs` — all `#21:` lines PASS; suite ends `ALL PASSED`.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/customer-feed-rows.ts src/lib/feed-buckets.ts scripts/test-review-and-spec.ts
git commit -m "feat: pure customer-feed row builders + Daylite date buckets, fully spec-covered (#21)"
```

---

### Task 3: Server loader `customer-feed.ts` + `addCustomerNoteAction`

**Files:**
- Create: `src/lib/customer-feed.ts`
- Modify: `src/app/(app)/companies/actions.ts` (the EXISTING companies actions file — verified; no new file)

**Interfaces:**
- Consumes: `notesForCustomer` (Task 1); all seven store reads + `completedAtOf` (inspections) + `stagesFor` (projects); the Task 2 builders; `requireUser`.
- Produces: `loadCustomerFeed(cust: { id; name })` → `Promise<FeedRow[]>` (ts-desc, capped at `FEED_CAP = 60`); server action `addCustomerNoteAction(customerId, text)` → `{ ok: true } | { ok: false; error }`.

- [ ] **Step 1: The loader**

Create `src/lib/customer-feed.ts`:

```ts
import { byCustomer as commsByCustomer } from "@/lib/stores/comms";
import { getAll as getAllFlame } from "@/lib/stores/flame-jobs";
import { completedAtOf, getAll as getAllInspections } from "@/lib/stores/inspections";
import { notesForCustomer } from "@/lib/stores/notes";
import { getAllProjects, stagesFor } from "@/lib/stores/projects";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAll as getAllRepairs } from "@/lib/stores/repair-jobs";
import { getAll as getAllSurveys } from "@/lib/stores/surveys";
import { visitsForCustomer } from "@/lib/stores/site-visits";
import {
  commFeedRows,
  jobFeedRows,
  noteFeedRows,
  projectFeedRows,
  quoteFeedRows,
  surveyFeedRows,
  visitFeedRows,
  type FeedRow,
} from "@/lib/customer-feed-rows";

/**
 * #21 customer Activity feed loader — SERVER-ONLY (fans out over the doc
 * stores; never import from a "use client" file). Read-time aggregation:
 * per-customer reads exist only on comms (byCustomer) and site-visits
 * (visitsForCustomer); everything else is getAll()+filter — the app-wide
 * full-scan idiom, fine at beta volumes (hundreds of records).
 *
 * The two store-owned conversions the pure builders must not know about
 * happen here: inspection completion via completedAtOf (ISO → ms) and
 * project stage labels via stagesFor (they differ between projects and
 * orders). Tombstones are already excluded by listDocs.
 */

/** Feed cap — "Show more" is deferred (product flag, D121). */
export const FEED_CAP = 60;

export async function loadCustomerFeed(cust: { id: string; name: string }): Promise<FeedRow[]> {
  const [notes, quotes, threads, visits, flames, repairs, inspections, surveys, projects] =
    await Promise.all([
      notesForCustomer(cust.id),
      getAllQuotes(),
      commsByCustomer(cust.id),
      visitsForCustomer(cust.id),
      getAllFlame(),
      getAllRepairs(),
      getAllInspections(),
      getAllSurveys(),
      getAllProjects(),
    ]);

  const rows: FeedRow[] = [];

  for (const n of notes) rows.push(...noteFeedRows(n));

  // The SAME rule the customer page's rollups use (companies/[id]/page.tsx):
  // canonical id link, denormalized-name fallback for unlinked quotes.
  for (const q of quotes.filter((qt) => (qt.customerId ? qt.customerId === cust.id : qt.customer === cust.name)))
    rows.push(...quoteFeedRows(q));

  for (const t of threads) rows.push(...commFeedRows(t));
  for (const v of visits) rows.push(...visitFeedRows(v));

  for (const f of flames.filter((r) => r.customerId === cust.id))
    rows.push(
      ...jobFeedRows("flame", {
        id: f.id,
        venue: f.venue,
        openedAt: f.approvedAt,
        openedBy: f.owner,
        completedAt: f.completedAt,
        completedBy: f.assignedTo || f.owner,
      })
    );

  for (const r of repairs.filter((x) => x.customerId === cust.id))
    rows.push(
      ...jobFeedRows("repair", {
        id: r.id,
        venue: r.venue,
        openedAt: r.approvedAt,
        openedBy: r.owner,
        completedAt: r.completedAt,
        completedBy: r.assignedTo || r.owner,
      })
    );

  for (const i of inspections.filter((x) => x.customerId === cust.id))
    rows.push(
      ...jobFeedRows("inspection", {
        id: i.id,
        venue: i.venue,
        openedAt: i.requestedAt || null, // legacy default 0 → no request row
        openedBy: i.requestedBy,
        completedAt: completedAtOf(i), // stage==="completed" ? msOf(surveyDate) ?? msOf(reportDate) ?? updatedAt : null
        completedBy: i.inspector || i.assignedTo,
      })
    );

  for (const s of surveys.filter((x) => x.customerId === cust.id)) rows.push(...surveyFeedRows(s));

  for (const p of projects.filter((x) => x.customerId === cust.id)) {
    const shortOf: Record<string, string> = {};
    for (const st of stagesFor(p.kind)) shortOf[st.key] = st.short;
    rows.push(...projectFeedRows(p, shortOf));
  }

  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, FEED_CAP);
}
```

- [ ] **Step 2: The note server action**

In `src/app/(app)/companies/actions.ts`:

1. Add to the imports (after the `import { remove, upsert } from "@/lib/stores/customers";` line):

```ts
import { addNoteRecord } from "@/lib/stores/notes";
```

2. Append at the end of the file:

```ts
/** #21 — the Activity card's note composer. parentKind "customer" is the
 *  only v1 composer; the NoteRecord is attachable by design (lead/project/
 *  quote surfaces come later with no migration). */
export async function addCustomerNoteAction(customerId: string, text: string) {
  const me = await requireUser();
  const t = (text || "").trim();
  if (!customerId || !t) return { ok: false as const, error: "Write a note first." };
  await addNoteRecord(
    { parentKind: "customer", parentId: customerId, customerId, text: t },
    me.name
  );
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED` (no new specs — the loader is store-glue; its pure parts were spec'd in Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/lib/customer-feed.ts src/app/\(app\)/companies/actions.ts
git commit -m "feat: customer-feed server loader (60-row cap) + addCustomerNoteAction (#21)"
```

---

### Task 4: Customer page — Activity card + composer island

**Files:**
- Create: `src/app/(app)/companies/[id]/activity-composer.tsx` (client island)
- Modify: `src/app/(app)/companies/[id]/page.tsx` (fetch + full-width Activity card between Communications and Projects & orders)

**Interfaces:**
- Consumes: `loadCustomerFeed` (Task 3), `groupRows` (Task 2), `addCustomerNoteAction` stub (Task 3), the page's local `card`/`cardHead` consts and its existing `timeAgo` import.
- Produces: the Activity card UI; no new exports.

- [ ] **Step 1: The composer island**

Create `src/app/(app)/companies/[id]/activity-composer.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCustomerNoteAction } from "../actions";

/**
 * #21 — the Activity card's note composer. Imports ONLY the server-action
 * stub (client-bundle rule: no store value-imports in "use client" files).
 * Inline error on { ok: false }; router.refresh() re-renders the server
 * page so the new note lands in the feed.
 */
export default function ActivityComposer({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const t = text.trim();
    if (!t) {
      setErr("Write a note first.");
      return;
    }
    setErr("");
    startTransition(async () => {
      const res = await addCustomerNoteAction(customerId, t);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setText("");
      router.refresh();
    });
  };

  return (
    <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", background: "#fafbfc" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note — visible to the whole team…"
        rows={2}
        style={{
          width: "100%",
          fontFamily: "var(--font-ui)",
          fontSize: 12.5,
          color: "#16181d",
          background: "#fff",
          border: "1px solid #dfe2e8",
          borderRadius: 8,
          padding: "8px 10px",
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
        <button
          onClick={submit}
          disabled={isPending}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            border: "none",
            padding: "7px 13px",
            borderRadius: 7,
            cursor: "pointer",
          }}
        >
          Add note
        </button>
        {err && <span style={{ fontSize: 11.5, color: "#b4543a", fontWeight: 600 }}>{err}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Page — imports + fetch**

In `src/app/(app)/companies/[id]/page.tsx`:

1. Add imports (after the `import { shortDate, timeAgo } from "@/lib/format";` line):

```ts
import { loadCustomerFeed } from "@/lib/customer-feed";
import { groupRows } from "@/lib/feed-buckets";
import ActivityComposer from "./activity-composer";
```

2. Replace the data fetch (`cust` is already resolved above it, so it can ride the same batch):

```ts
  const [quotes, projects, surveys, threads, offices, users] = await Promise.all([
    getAllQuotes(),
    getAllProjects(),
    getAllSurveys(),
    commsByCustomer(id),
    officesFromSettings(),
    activeUsers(),
  ]);
```

with

```ts
  const [quotes, projects, surveys, threads, offices, users, feedRows] = await Promise.all([
    getAllQuotes(),
    getAllProjects(),
    getAllSurveys(),
    commsByCustomer(id),
    officesFromSettings(),
    activeUsers(),
    loadCustomerFeed({ id: cust.id, name: cust.name }),
  ]);
```

3. After the `const commWaiting = threads.filter((t) => t.status === "waiting_us").length;` line, add:

```ts
  const feedGroups = groupRows(feedRows, Date.now());
```

- [ ] **Step 3: Page — the Activity card**

Insert between the Communications card's closing `</div>` and the `{/* projects & orders */}` comment:

```tsx
        {/* ---- activity (#21) — merged feed + real-note composer ---- */}
        <div style={card}>
          <div style={cardHead}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Activity</div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{feedRows.length}</span>
          </div>
          <ActivityComposer customerId={cust.id} />
          {feedGroups.map((g) => (
            <div key={g.bucket}>
              <div style={{ padding: "9px 18px 7px", fontSize: 10, fontWeight: 600, color: "#aab0bb", letterSpacing: ".05em", textTransform: "uppercase", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
                {g.bucket}
              </div>
              {g.rows.map((r) => {
                const rowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" };
                const inner = (
                  <>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: r.soft, color: r.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                      {r.letter}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                        {r.title}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: "#aab0bb", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {[r.sub, r.by, timeAgo(r.ts)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </>
                );
                return r.href ? (
                  <Link key={r.id} href={r.href} className="cu-d-row" style={rowStyle}>
                    {inner}
                  </Link>
                ) : (
                  <div key={r.id} style={rowStyle}>
                    {inner}
                  </div>
                );
              })}
            </div>
          ))}
          {feedRows.length === 0 && (
            <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              No activity yet — quotes, messages, visits and notes will land here.
            </div>
          )}
        </div>
```

(Note-title clamp lives here — `WebkitLineClamp: 3` — per the brief: clamp display in the UI, not the data. `href` rows wrap in `Link`, plain rows don't; the guard is the `r.href ?` ternary. The Communications card directly above stays byte-identical — the feed duplicating comms is ACCEPTED for v1, product flag in Task 5.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED`.

Live check (dev server on :3000, restarted in Task 1 so migration 0010 is applied):
- Open a seeded company (e.g. `/companies/lakefront`) → the Activity card renders between Communications and Projects & orders, with bucket headers and rows from multiple sources: quote history ("Quote Q-#### sent" style, deep-linking `/quotes?id=`), comm messages ("Received · email"), site visits incl. plan-03 lifecycle rows ("Site visit — …" with the stage label), project stage rows ("Project P-#### → …", D83 entries), surveys, flame/repair/inspection stamps.
- Buckets read correctly against today's date (seed data is mostly weeks old → "This month" / "<Month Year>" groups; anything from today's session lands in "Today").
- Type a note → Add note → the note appears at the top of "Today" with the N dot and your name; empty submit shows the inline error and writes nothing.
- Click a quote row → lands on `/quotes?id=…` expanded; a comm row → the inbox thread; a note row does not navigate.
- Row count in the card head ≤ 60 (the cap).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/companies/\[id\]
git commit -m "feat: customer-page Activity card — bucketed merged feed + note composer island (#21)"
```

---

### Task 5: Full verification, live drive, punchlist/decisions/roadmap, wrap up

**Files:**
- Modify: `PUNCHLIST.md` (item 21 → DONE + product flags)
- Modify: `DECISIONS.md` (new D entry)
- Modify: `docs/superpowers/plans/2026-07-25-00-crm-wave-roadmap.md` (plan 04 row)

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit` → clean. `npm run lint` → baseline 70 errors, net-zero. `npm run test:specs` → `ALL PASSED`.

- [ ] **Step 2: Production build — KILL THE DEV SERVER FIRST (D106)**

```bash
lsof -ti tcp:3000 | xargs -r kill
npm run build
```

Expected: green — `scripts/migrate.mjs` applies 0010, and no PGlite-in-client-bundle error (the one new client file imports only the `../actions` server-action stub; `customer-feed-rows.ts`/`feed-buckets.ts` are store-free; `customer-feed.ts` is only imported by the server page).

Restart the dev server afterwards (`npm run dev`) for the live drive.

- [ ] **Step 3: Live acceptance drive**

- **Feed correctness on a data-rich customer:** every source renders with the right letter-dot, title vocab, sub, actor and `timeAgo`; rows are ts-desc inside monotone buckets ("Today" → … → "<Month Year>"); no duplicate React keys (row ids are namespaced `<kind>:<recordId>:<n>`).
- **Notes end-to-end:** add a note → tops "Today"; refresh (server render) → still there; a second browser/user sees it (team-visible). The note record round-trips the doc-store (id `N-7001`+).
- **Quote annexes:** on a won quote, toggle PO received (`/quotes` expanded actions) → a "Quote Q-#### PO received" row appears at the toggle time.
- **Plan-03 thread rows:** a lead-requested visit shows as "Site visit — <reason>" with its lifecycle label; scheduled visits sit at their startAt — a scheduled visit with a future startAt now lands under the **Upcoming** bucket (leading the feed, ahead of Today), not under Today.
- **Drafts/deleted invisible:** an inbox draft thread and a Deleted-folder thread contribute no rows.
- **Cap:** on the busiest seed customer the card shows at most 60 rows.
- **No regressions:** Communications card unchanged above the new card; Projects & orders unchanged below; `/inbox`, `/quotes`, `/projects`, `/field-survey` untouched surfaces all load.

- [ ] **Step 4: PUNCHLIST.md**

Change the item-21 heading line to:

```md
## 21. Per-record activity timeline — DONE (customer feed v1, 2026-07-26, plan 04)
```

and insert directly under it:

```md
**DONE 2026-07-26 (plan 04, D121) — the v1 scope: the CUSTOMER-page merged feed
+ real notes.** A full-width **Activity** card on the company page merges, at
read time (no migration, no new machinery on the sources): quote status
history + the PO-received / portal-acceptance annex stamps, comm messages
(drafts and Deleted-folder threads skipped), site visits (plan-03 lifecycle
labels), flame/repair approved/completed and inspection requested/completed
point stamps (completion via `completedAtOf`; the un-stamped "scheduled"
transitions are skipped — no ms timestamp exists), surveys, project stage
history (D83) and project notes — under Daylite-style buckets (Today /
Yesterday / This week / Last week / This month / "June 2026"; local-time,
Monday-start weeks; pure + spec-covered in `feed-buckets.ts` /
`customer-feed-rows.ts`). **Notes are now a real record**: new non-syncable
`notes` collection (migration 0010), `NoteRecord` with
`parentKind: customer|lead|project|quote` + denormalized `customerId` —
attachable by design; the v1 composer (on the card) writes customer notes
via `addCustomerNoteAction`. Product flags for Jeff: (a) the feed
**duplicates the Communications card** — fold Communications into Activity
later? (b) the feed **caps at 60 rows**, "Show more" deferred. (c)
`LeadActivity` was deliberately NOT migrated (its `logActivity` drives SLA
stamps); lead notes can adopt `NoteRecord` later via `parentKind: "lead"`.
Still open from this item's original ask: per-PROJECT/record timelines,
"All Activity" filter + feed search, attachments (decision D's second half),
and field-level change tracking (decision C — explicitly out of scope).
```

Also update the item's `**Status:** OPEN — A and B are independently useful and cheap; C and D are the expensive half` line at its section end to:

```md
**Status:** DONE (plan 04) — customer feed v1 + real notes shipped; C (field-level tracking) out of scope by decision, attachments still open.
```

- [ ] **Step 5: DECISIONS.md**

Verify the next free number first (`grep -o "D1[0-9][0-9]" DECISIONS.md | sort -u | tail` — last known is **D120**, plan 03's lead-thread entry; if something landed since, take the next). Append:

```md
## D121 — Customer activity feed shape: notes collection, pure row builders, 60-row cap (2026-07-26)

Controller calls made to unblock plan 04 (#21) — **flagged for Jeff's
review**; the spec's v1 (§3 #21: customer-page merged feed + notes as a real
record, no field-level tracking) is followed, these are the seams:

- **`notes` is a real doc-collection** (`N-####` from base 7000, migration
  0010), **NOT syncable** (server-action writes only — the engagements/
  site_visits precedent; SYNCABLE_COLLECTIONS/FIELD_COLLECTIONS untouched).
  `NoteRecord.parentKind: customer|lead|project|quote` + `parentId` +
  denormalized `customerId` — attachable by design; only the customer
  composer exists in v1. `nextPrefixedId` + `upsertDoc` accepted for the
  single-user-ish composer (no insertDocIfAbsent).
- **Read-time aggregation, no source changes.** The feed renders what the
  stores already keep: quote `history[]` + the `poReceivedAt` /
  `portalAcceptance` annexes (setPoReceived writes no history — the annex
  IS the record), comm `messages[]`, visit lifecycle (plan 03), flame/
  repair `approvedAt`/`completedAt`, inspection `requestedAt` (legacy 0 →
  skipped) + `completedAtOf`, surveys at `updatedAt`, project
  `stageHistory[]` (D83) + newest-first `notes[]`. The un-stamped
  "scheduled" transitions (bare ISO day, no ms) are skipped.
- **Pure feed layer with mirrored vocab.** `customer-feed-rows.ts` /
  `feed-buckets.ts` import no stores (client-bundle + no-DB-spec rules);
  quote verbs and survey stage labels are mirrored locally with every
  literal pinned by specs (drift breaks the suite); project stage labels
  are PASSED IN by the loader (they differ per kind), as is the inspection
  completion ts.
- **Buckets are local-time, Monday-start weeks**, Date-part math (DST-safe),
  same-day future stamps (clock skew) still read "Today". Vocabulary:
  Upcoming / Today / Yesterday / This week / Last week / This month /
  "<Month Year>" (en-US, the app's locale convention).
- **Upcoming bucket added** (reviewer fix, 2026-07-26): timestamps at/after
  tomorrow's local midnight — e.g. a scheduled site visit with a future
  `startAt` — now bucket as "Upcoming" and lead the feed, instead of
  incorrectly sitting under "Today". Rows are already ts-desc sorted, so
  the highest-ts bucket naturally comes first; `groupRows` needed no code
  change, only `bucketFor` gained the new branch.
- **60-row cap** (`FEED_CAP`), "Show more" deferred — product flag.
- **Communications card kept** beside the feed (duplication accepted for
  v1) — product flag: fold it into Activity later?
- **`LeadActivity` NOT migrated** — `logActivity` carries SLA side effects
  (firstContactAt/lastActivityAt) that must not be bypassed; lead notes can
  adopt `NoteRecord` (`parentKind: "lead"`) in a later plan.
- **Job/inspection feed hrefs go to the module list pages** (`/flame-tests`,
  `/repairs`, `/inspections`) — those screens have no `?id=` selection to
  deep-link; quotes (`/quotes?id=`), comms (`/inbox?thread=`), surveys
  (`/field-survey?id=`) and projects (`/projects?id=`) deep-link for real.
```

- [ ] **Step 6: Roadmap**

In `docs/superpowers/plans/2026-07-25-00-crm-wave-roadmap.md`, change the plan-04 row to:

```md
| 04 | Customer activity timeline + real notes (`2026-07-26-04-crm-timeline-notes.md`) | #21 | **BUILT** (2026-07-26) — notes collection (migration 0010) + pure bucketed feed + customer-page Activity card w/ composer (D121) |
```

- [ ] **Step 7: Commit**

```bash
git add PUNCHLIST.md DECISIONS.md docs/superpowers/plans
git commit -m "docs: punchlist #21 done, D121 activity-feed decisions, roadmap plan-04 built"
```

---

## Self-Review (done at authoring time)

- **Spec coverage (§3 #21 + brief + PUNCHLIST 21):** notes as a real attachable record — collection registration (docTable + DOC_TABLES only; SYNCABLE untouched), `N-####`/7000 (prefix + base re-verified free against every `nextPrefixedId` call site), full `NoteRecord` shape incl. denormalized customerId ✓ (Task 1); migration 0010 via `npm run db:generate` with the dev-server restart BEFORE any live note write, no seed file ✓ (Task 1 Steps 4–5); store fns `normalizeNote` (`?? null`/`?? ""`), `allNotes`, `notesForCustomer`, `addNoteRecord`, `removeNote` (softDeleteDoc) ✓; pure builders for every source — quote history + BOTH annexes (poReceivedAt with the writes-no-history note; portalAcceptance with actor), comm per-message with draft + thread-deleted skips and the `/inbox?thread=` idiom (verified: the page's Communications card links exactly that), visit `startAt ?? createdAt` + VISIT_STAGE_META labels via the one allowed pure import, jobs approved/completed + inspection requested/completed with precomputed completion ts and the no-ms "scheduled" skip, survey single row at updatedAt with stage labels, project stageHistory (D83 semantics, per-kind labels) + NEWEST-FIRST notes passed through unsorted, note rows ✓ (Task 2); `bucketFor` today/yesterday-at-local-midnight, Mon-start this/last week, this-month, "<Month Year>" + `groupRows` stability/ordering, ALL timestamps via local Date-part constructors per the harness TZ house rule (~:503) ✓ (Task 2 specs); server loader — Promise.all over `notesForCustomer`/quotes-getAll-with-the-page's-exact-filter-rule/`commsByCustomer`/`visitsForCustomer`/flame/repair/inspections/surveys/projects getAll+customerId filters, `completedAtOf` + `stagesFor` conversions in the loader, sort ts-desc, **60-row cap logged** (FEED_CAP + PUNCHLIST flag + D121) ✓ (Task 3); `addCustomerNoteAction` — requireUser, trim guard, `revalidatePath("/", "layout")`, in the VERIFIED-existing companies actions file ✓ (Task 3); Activity card between Communications (page :312–365) and Projects & orders (:367) using local `card`/`cardHead`, bucket headers, 26px letter-dot + 12.5px title + 11px `sub · by · timeAgo` sub-line in #aab0bb, `href ?` Link guard, borderBottom #f5f6f8, empty state #9aa0ab 12.5px (the home-team-activity idiom), UI-side note clamp ✓ (Task 4); composer island — "use client", textarea + Add note, useTransition + action + router.refresh, inline error, imports ONLY the stub ✓ (Task 4); Communications card kept + product flag ✓ (Tasks 4–5); PUNCHLIST/D121/roadmap + D106 build kill/restart + live acceptance ✓ (Task 5).
- **Deviations from the brief (all deliberate):**
  - **`addCustomerNoteAction` lives in the EXISTING `src/app/(app)/companies/actions.ts`**, not a new `[id]/actions.ts` — the brief said "or the companies actions file if one exists — VERIFY"; it exists (saveCustomerAction et al.), so no new file.
  - **Quote/survey label vocab is mirrored locally in the pure module; project stage labels are loader-passed.** The brief says "STAGE_LABEL vocab" / "VISIT_STAGE_META labels" / "surveys STAGE labels" — but quotes.ts and surveys.ts value-import doc-store and CANNOT be imported by the zero-store-imports module (only lead-thread.ts is dependency-free). Mirrors are pinned literal-by-literal in specs so drift fails the suite; `stagesFor` labels differ per project kind, so they ride a `stageShort` arg (the brief's own precomputed-arg pattern).
  - **Quote history rows read "Quote Q-2041 drafted"** for the creation entry — the brief's example vocab ("Quote Q-2041 sent") is a lowercase verb sentence; the `to:"draft"` creation entry needs a verb and `QUOTE_VERB.draft = "drafted"` (not the STAGE_LABEL noun "Draft", which would render "Quote Q-2041 Draft").
  - **No ISO→ms conversion for flame/repair in the loader** — the brief's recon implied the stores' msOf helpers would be needed; in the actual code `FlameJob.completedAt`/`RepairJobRecord.completedAt` are ALREADY epoch-ms. Only the inspection completion needs conversion, and `completedAtOf` (exported, inspections.ts:1117) does exactly that — no raw msOf calls anywhere in this plan.
  - **`jobFeedRows` is ONE builder with structural `{openedAt, openedBy, completedAt, completedBy, venue}`** rather than per-kind functions — flame/repair/inspection differ only in noun + open-verb + href; the kind arg keeps it a single spec'd table.
  - **Inspection `requestedAt` guarded falsy** (`|| null` in the loader, `if (job.openedAt)` in the builder) — repo fact: it defaults to `0` on legacy/blank records, which the brief didn't flag.
  - **Job rows link to the module list pages** (`/flame-tests` etc.) — those screens have no `?id=` deep-link param (verified); the brief left job hrefs unspecified.
  - **`FEED_META` colors/letters chosen by the controller** (brief left them open): the app's existing chip families — amber notes, blue quotes/surveys/project-stages, purple comms, green visits, rust field-work.
  - **`FEED_CAP` exported from `customer-feed.ts`** (brief only said "cap at 60") — a named constant beats a magic number and D121 cites it.
- **PUNCHLIST #21 overrides applied:** item 21's "Decisions Jeff needs to make" — **B (project stage history) is Jeff-answered/DONE (2026-07-19, D83)**: `stageHistory[]` exists with `{at, from, to, by}`, is backfilled to `[]` on read, and post-D83 records carry a `from: null` opening anchor — so this plan TREATS stageHistory as guaranteed-normalized (array, possibly empty on legacy records) and renders opening entries as ordinary "→ <stage>" rows; no data-loss caveats needed. **A** (customer timeline first) matches the spec's locked v1; **C** (field-level tracking) is answered "no" by the spec itself; **D** is half-answered by the spec (notes → real records — built here; attachments — NOT in scope, left open in the PUNCHLIST close-out). No item-21 sub-decision contradicts the brief's defaults, so no default was displaced.
- **Repo facts that contradicted the brief (plan cites actual code):** PUNCHLIST item 21 actually sits at ~lines 1520–1615 (heading `## 21.` ~:1560), not 1484–1564; `companies/[id]/page.tsx` is **580** lines post-plan-03 (not 558) — Communications card :312–365, Projects & orders from :367, data Promise.all :82–89, quotes filter rule :103–105, `card`/`cardHead` :47–62, visits card :530–572; a companies actions file EXISTS (`companies/actions.ts`); `npm run lint` baseline is **70 errors + ~1618 warnings** (the brief said "baseline 70" — the errors number is the gate); flame/repair `completedAt` are epoch-ms (see deviations); inspections `requestedAt` defaults 0; everything else verified exact — 458 PASS baseline (ran it), dev server live on :3000, `byCustomer` at comms.ts:575, `visitsForCustomer` at site-visits.ts:98, `completedAtOf` at inspections.ts:1117, D120 is the last DECISIONS entry (D121 free), roadmap row 04 present, drizzle at 0009 (0010 free), `N`/`7000` unused, DOC_TABLES ends with `tasks`, schema.ts re-exports doc-tables, `/quotes?id=` deep-link idiom real (nav-counts.ts:242, quotes/page.tsx:141).
- **Name/type consistency:** `NoteRecord`/`NoteParentKind`/`normalizeNote`/`allNotes`/`notesForCustomer`/`addNoteRecord`/`removeNote` match across Tasks 1/3; `FeedRow`/`FeedKind`/`FEED_META` + the seven builders match across Tasks 2/3; `bucketFor`/`groupRows` across Tasks 2/4; `loadCustomerFeed`/`FEED_CAP` across Tasks 3/4; `addCustomerNoteAction(customerId, text)` → `{ ok } | { ok:false, error }` matches the island's handling; builder structural args are satisfied by the real store types (Quote.history ⊇ `{at, to}`, CommThread/CommMessage ⊇ the comm arg, SiteVisit ⊇ the visit arg, SurveyRecord ⊇ the survey arg, ProjectRecord ⊇ the project arg, extra fields are fine structurally).
- **Placeholder scan:** none — every code step carries complete code or an exact anchored edit; no "…" inside any code block.
- **Client-bundle audit:** the one new client file (`activity-composer.tsx`) imports React, next/navigation and the `../actions` server-action stub only; `customer-feed-rows.ts` imports only the dependency-free `lead-thread.ts`; `feed-buckets.ts` imports nothing; `customer-feed.ts` and `stores/notes.ts` are server-only and only imported by server files (page.tsx, actions.ts).
- **TZ-safe spec check:** every `#21:` timestamp is built via `new Date(y, m, d, …)` local-part constructors; the only locale-dependent output asserted ("June 2026", "December 2025") comes from `toLocaleDateString("en-US", …)` with the locale PINNED in the implementation (the app-wide en-US convention), fed by local-part timestamps — stable in any runner timezone.
