# Krisp Meeting Matcher Implementation Plan (#323)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync every rep's Krisp meetings into the app, suggest where each belongs (company, venue, contacts, work record, internal people), let the rep confirm, keep meetings private until linked, and file Krisp to-dos as tasks / waiting-on-customer items / notes.

**Architecture:** A new `meetings` doc collection (`km-<krispId>`, deterministic so two reps' copies dedupe). Four pure modules carry every rule — `match.ts` (scoring), `visibility.ts` (who sees what), `render.ts` (attendee merge + speaker relabel), `todos.ts` (to-do defaults + merge) — and `sync.ts` drives them from the Krisp list/detail API with injectable deps. Server actions in `src/lib/meetings/actions-core.ts` (testable, session-free) are wrapped by thin `"use server"` actions. UI is a standalone Meetings box under `/inbox?view=meetings` plus cards on record pages.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite doc tables, existing Krisp REST client, Google Calendar helpers. No AI (D89 holds).

**Spec:** `docs/superpowers/specs/2026-10-09-krisp-meeting-matcher-design.md` — read it first; this plan implements it.

## Global Constraints

- Read `node_modules/next/dist/docs/` for any Next.js API you touch (AGENTS.md: "This is NOT the Next.js you know").
- `requireUser()` from `src/lib/session.ts` in every server action / server component that touches meetings; every meeting read filters through `canSeeMeeting`.
- Timestamps are epoch-ms numbers. Meeting ids are `km-<krispMeetingId>`.
- No model calls, no `ANTHROPIC_API_KEY` (D89).
- Never hardcode accent colours — use `var(--accent)` / `pk-*` classes from `src/app/globals.css`.
- `NOISE_MAX_SEC = 180`; first sync / Load older step = 90 days; rolling window = 14 days; batch budget = 40 000 ms; Krisp pacing ≤ 5 req/s; stale threshold for Home = 10 min; Inbox tick = 3 min.
- Strength rule: top company score ≥ 80 **and** ≥ 30 ahead of the runner-up → `strong`; ≥ 40 → `weak`; < 40 → no company suggestion.
- Points: title 50 (+10 when the hit came through a venue core), calendar title 30, attendee email → contact 60, attendee email domain → company 40 (only when no email→contact hit for that company), overlapping scheduled visit/survey of the owner 40, summary 20, speaker first name 10.
- Never `git stash` (shared across worktrees). Commit instead.
- PGlite is single-process: never leave a `tsx` script running; stop any dev server before `test:specs`/`test:smoke` per AGENTS.md.
- Node is at `~/.local/node/bin` — prefix commands with `export PATH=$HOME/.local/node/bin:$PATH;`.
- Tests: new checks live in `scripts/test-meetings-323.ts` (exported async functions taking `ok`), chained into `scripts/test-review-and-spec.ts` just before `.finally(() => teardownFixtures())`. Run with `npm run test:specs 2>&1 | grep -E "#323|FAILED|ALL PASSED"`.
- Decision numbers are NOT assigned in this branch — docs say "D-TBD (#323 K1…K13)"; they get numbered at merge from origin/main.

## File Structure

| File | Responsibility |
|---|---|
| `drizzle/0036_krisp_meetings.sql` (+ `meta/_journal.json`, `meta/0036_snapshot.json`) | `meetings` doc table + trigger; 4 columns on `krisp_connections` |
| `src/db/doc-tables.ts` | register `meetings` |
| `src/db/schema.ts` | the 4 new `krisp_connections` columns |
| `src/lib/meetings/types.ts` | all meeting types + constants + `emptyLinks()` |
| `src/lib/meetings/names.ts` | `normalizeText`, `nameCore`, `hitsCore`, `personName` |
| `src/lib/meetings/visibility.ts` | `meetingScope`, `canSeeMeeting`, `portalCanSee`, `hasExternalLink` |
| `src/lib/meetings/match.ts` | `matchMeeting(input, index)` pure scorer |
| `src/lib/meetings/render.ts` | `mergeAttendees`, `speakerLabel`, `relabel`, `renderMeeting` |
| `src/lib/meetings/todos.ts` | `suggestTodoKind`, `mergeTodos`, `noteParentFor` |
| `src/lib/stores/meetings.ts` | doc-store CRUD: `getMeeting`, `saveMeeting`, `patchMeeting`, `allMeetings`, `meetingsVisibleTo`, `meetingsLinkedTo` |
| `src/lib/meetings/index-build.ts` | server: builds a `MatchIndex` from companies/sites/contacts/users/visits/surveys/leads/projects/engagements |
| `src/lib/meetings/sync.ts` | `syncRepMeetings` (deps-injected), `runMeetingsSync`, `syncMeetingsIfStale`, `syncAllMeetings` |
| `src/lib/meetings/sync-state.ts` | read/write the `krisp_connections` sync columns |
| `src/lib/meetings/actions-core.ts` | session-free mutations: confirm, link/unlink, confirmAll, setSpeaker, attendee add/remove, decideTodo(s), share/unshare, setNoise, refreshFromKrisp |
| `src/lib/krisp/client.ts` | + `listMeetings()`; `KRISP_MEETING_FIELDS` gains `source,tags,ownership` |
| `src/lib/stores/tasks.ts` | `TaskRecord.meetingId?`, `TaskRecord.waitingOn?` |
| `src/lib/stores/notes.ts` | `NoteParentKind` gains `"site"` |
| `src/lib/stores/recordings.ts` | `RecordingRecord.meetingId?` |
| `src/app/(app)/inbox/meetings/actions.ts` | `"use server"` wrappers |
| `src/app/(app)/inbox/meetings/meetings-box.tsx` | list + tabs + Confirm all + Sync now (client) |
| `src/app/(app)/inbox/meetings/meeting-reader.tsx` | reader + sidebar (client) |
| `src/app/(app)/inbox/meetings/load.ts` | server loader → view models |
| `src/components/meetings/meetings-card.tsx` | per-record card (server) |
| `src/app/portal/meetings/page.tsx` | portal Meeting notes |
| `scripts/test-meetings-323.ts` | all #323 checks |

---

### Task 1: Data layer — table, types, store, field additions

**Files:**
- Create: `drizzle/0036_krisp_meetings.sql`, `src/lib/meetings/types.ts`, `src/lib/stores/meetings.ts`, `scripts/test-meetings-323.ts`
- Modify: `src/db/doc-tables.ts` (add `meetings` next to `recordings`, in `DOC_TABLES`), `src/db/schema.ts:192-202` (krispConnections), `src/lib/stores/tasks.ts:36-73`, `src/lib/stores/notes.ts:23`, `src/lib/stores/recordings.ts` (RecordingRecord), `drizzle/meta/_journal.json`, `scripts/test-review-and-spec.ts` (chain)

**Interfaces:**
- Produces: every type in `types.ts` (below, verbatim); store functions:
  - `getMeeting(id: string): Promise<MeetingRecord | null>`
  - `saveMeeting(m: MeetingRecord): Promise<MeetingRecord>` (upsert)
  - `patchMeeting(id: string, fn: (m: MeetingRecord) => MeetingRecord): Promise<MeetingRecord | null>` (read-modify-write via `patchDoc`)
  - `allMeetings(): Promise<MeetingRecord[]>` (newest `krisp.startedAt` first)
  - `meetingsVisibleTo(userId: string): Promise<MeetingRecord[]>`
  - `meetingsLinkedTo(kind: "company"|"venue"|"contact"|"work", id: string, viewerId: string): Promise<MeetingRecord[]>`
  - `normalizeMeeting(d: Partial<MeetingRecord> & { id: string }): MeetingRecord`

- [ ] **Step 1: Write `src/lib/meetings/types.ts`**

```ts
/** #323 Krisp meeting matcher — shared types (spec 2026-10-09-krisp-meeting-matcher-design.md). */

export const NOISE_MAX_SEC = 180;
export const MAX_CONTACT_LINKS = 25;
export const BACKFILL_STEP_MS = 90 * 24 * 60 * 60 * 1000;
export const ROLLING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const DETAIL_RETRY_MS = 48 * 60 * 60 * 1000;
export const SYNC_BUDGET_MS = 40_000;
export const HOME_STALE_MS = 10 * 60 * 1000;

export type WorkType = "lead" | "site_visit" | "survey" | "project" | "engagement" | "quote";
export const WORK_TYPES: WorkType[] = ["lead", "site_visit", "survey", "project", "engagement", "quote"];

export type MeetingWork = { type: WorkType; id: string; label: string };

export type MeetingLinks = {
  customerId: string | null;
  siteId: string | null;
  contactIds: string[];
  work: MeetingWork | null;
  internalUserIds: string[];
};

export type KrispPerson = { email: string | null; firstName: string | null; lastName: string | null };

export type MeetingSegment = { speaker: string; text: string; start: number; end: number };

export type MeetingKrisp = {
  title: string;
  startedAt: number | null;
  durationSec: number | null;
  source: string | null;
  status: string;
  tags: string[];
  participants: KrispPerson[];
  /** transcript speaker idx (as string) → identified participant; unidentified idx are absent */
  speakers: Record<string, KrispPerson>;
  segments: MeetingSegment[];
  /** raw Krisp notes; read through deriveSummary() */
  notes: { blocks: unknown[] } | null;
  fetchedAt: number;
  detailFetchedAt: number | null;
  removedAt: number | null;
};

export type AttendeeSource = "krisp" | "calendar" | "manual";

export type MeetingAttendee = {
  /** lowercased email, else "name:<normalizeText(name)>" */
  key: string;
  name: string;
  email: string | null;
  sources: AttendeeSource[];
  removed: boolean;
  contactId: string | null;
  userId: string | null;
};

export type MeetingPersonRef = { contactId?: string; userId?: string; name: string };

export type SuggestionKind = "company" | "venue" | "contact" | "work" | "internal";
export type Strength = "strong" | "weak";

export type MeetingSuggestion = {
  kind: SuggestionKind;
  id: string;
  label: string;
  workType?: WorkType;
  score: number;
  strength: Strength;
  reasons: string[];
};

export type TodoKind = "task" | "waiting" | "note" | "dismiss";

export type MeetingTodo = {
  key: string;
  title: string;
  assigneeLabel: string | null;
  dueDate: string | null;
  suggested: TodoKind;
  decision: null | { kind: TodoKind; createdId: string | null; decidedAt: number; decidedBy: string };
};

export type MeetingCalendar = { eventId: string; title: string; attendees: { email: string; name: string | null }[] };

export type MeetingShare = { sharedAt: number; sharedBy: string; summary: string };

export type MeetingRecord = {
  id: string;
  krispMeetingId: string;
  seenBy: string[];
  ownerUserId: string;
  recordingId: string | null;
  krisp: MeetingKrisp;
  calendar: MeetingCalendar | null;
  attendees: MeetingAttendee[];
  speakerMap: Record<string, MeetingPersonRef>;
  links: MeetingLinks;
  filedAt: number | null;
  filedBy: string | null;
  suggestions: MeetingSuggestion[];
  noise: boolean;
  noiseOverride: boolean;
  todos: MeetingTodo[];
  share: MeetingShare | null;
  createdAt: number;
  updatedAt: number;
};

export function meetingIdFor(krispMeetingId: string): string {
  return "km-" + krispMeetingId;
}

export function emptyLinks(): MeetingLinks {
  return { customerId: null, siteId: null, contactIds: [], work: null, internalUserIds: [] };
}
```

- [ ] **Step 2: Write the failing store test** — create `scripts/test-meetings-323.ts`:

```ts
/* #323 Krisp meeting matcher — spec checks. Chained from test-review-and-spec.ts. */
import { registerFixture } from "./test-fixtures";
import type { MeetingRecord } from "@/lib/meetings/types";
import { emptyLinks, meetingIdFor } from "@/lib/meetings/types";
import * as MS from "@/lib/stores/meetings";

type Ok = (c: boolean, m: string) => void;

export function meetingFixture323(over: Partial<MeetingRecord> & { krispMeetingId: string }): MeetingRecord {
  const now = 1_790_000_000_000;
  return {
    id: meetingIdFor(over.krispMeetingId),
    seenBy: ["u1"], ownerUserId: "u1", recordingId: null,
    krisp: { title: "", startedAt: now, durationSec: 1200, source: null, status: "completed", tags: [],
      participants: [], speakers: {}, segments: [], notes: null, fetchedAt: now, detailFetchedAt: null, removedAt: null },
    calendar: null, attendees: [], speakerMap: {}, links: emptyLinks(), filedAt: null, filedBy: null,
    suggestions: [], noise: false, noiseOverride: false, todos: [], share: null, createdAt: now, updatedAt: now,
    ...over,
  } as MeetingRecord;
}

export async function meetings323StoreChecks(ok: Ok): Promise<void> {
  const kid = "TEST323" + "a".repeat(25);
  const m = meetingFixture323({ krispMeetingId: kid, krisp: { ...meetingFixture323({ krispMeetingId: kid }).krisp, title: "Osakis – scope" } });
  registerFixture("meetings", m.id);
  await MS.saveMeeting(m);
  const back = await MS.getMeeting(m.id);
  ok(!!back && back.id === "km-" + kid && back.krisp.title === "Osakis – scope", "#323 a meeting round-trips through the meetings doc table under km-<krispId>");
  const patched = await MS.patchMeeting(m.id, (x) => ({ ...x, links: { ...x.links, customerId: "TEST323-co" } }));
  ok(patched?.links.customerId === "TEST323-co", "#323 patchMeeting is read-modify-write");
  const norm = MS.normalizeMeeting({ id: "km-x" } as MeetingRecord);
  ok(Array.isArray(norm.seenBy) && norm.links.contactIds.length === 0 && norm.todos.length === 0 && norm.share === null,
    "#323 normalizeMeeting fills every array/object default for a sparse doc");
  ok((await MS.meetingsVisibleTo("u-nobody")).some((x) => x.id === m.id), "#323 a company-linked meeting is visible to any Peak user");
  await MS.patchMeeting(m.id, (x) => ({ ...x, links: { ...x.links, customerId: null } }));
  ok(!(await MS.meetingsVisibleTo("u-nobody")).some((x) => x.id === m.id) && (await MS.meetingsVisibleTo("u1")).some((x) => x.id === m.id),
    "#323 unlinked again → only the rep in seenBy sees it");
}
```

(`meetingsVisibleTo` needs `visibility.ts` — write it now with the Task 2 Step 3 content; Task 2 adds its own tests.)

Chain it: in `scripts/test-review-and-spec.ts`, add near the other `./test-fixtures` imports:

```ts
import { meetings323StoreChecks } from "./test-meetings-323";
```

and before `.finally(() => teardownFixtures())`:

```ts
  .then(() => meetings323StoreChecks(ok))
```

- [ ] **Step 3: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH; npm run test:specs 2>&1 | grep -E "#323|Cannot find|error" | head`
Expected: module-not-found for `@/lib/stores/meetings` (or `"meetings"` not a CollectionName).

- [ ] **Step 4: Register the table + schema columns**

`src/db/doc-tables.ts` — after `export const recordings = docTable("recordings"); …` add:

```ts
export const meetings = docTable("meetings"); // #323 Krisp meetings synced per rep (docs/superpowers/specs/2026-10-09-krisp-meeting-matcher-design.md; migration 0036)
```

and add `meetings,` to `DOC_TABLES` after `manufacturers,`. Do **not** add it to `SYNCABLE_COLLECTIONS` or `FIELD_COLLECTIONS`.

`src/db/schema.ts` — in `krispConnections`, after `importClaimedAt`, add:

```ts
  /** #323 — meeting sync state (src/lib/meetings/sync-state.ts). */
  meetingsSyncedAt: bigint("meetings_synced_at", { mode: "number" }),
  meetingsBackfillFrom: bigint("meetings_backfill_from", { mode: "number" }),
  meetingsBackfillCursor: text("meetings_backfill_cursor"),
  meetingsLastError: text("meetings_last_error"),
```

- [ ] **Step 5: Generate + harden the migration**

Run: `export PATH=$HOME/.local/node/bin:$PATH; npx drizzle-kit generate --name krisp_meetings`
Expected: `drizzle/0036_krisp_meetings.sql` + `meta/0036_snapshot.json` + journal entry. (drizzle-kit generate diffs snapshots; it does not open the dev DB. If it errors trying to connect, stop and report — do not hand-edit the snapshot.)

Then edit `drizzle/0036_krisp_meetings.sql` so it is idempotent (D141) and carries the seq trigger — final content:

```sql
-- #323 Krisp meeting matcher (docs/superpowers/specs/2026-10-09-krisp-meeting-matcher-design.md).
-- Generated by drizzle-kit, then hardened so it is idempotent per D141 (the shared Neon
-- database is migrated by more than one branch's build). Column-for-column docTable();
-- the _seq_bump trigger keeps pull-sync's `WHERE seq > cursor` honest.
CREATE TABLE IF NOT EXISTS "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "krisp_connections" ADD COLUMN IF NOT EXISTS "meetings_synced_at" bigint;--> statement-breakpoint
ALTER TABLE "krisp_connections" ADD COLUMN IF NOT EXISTS "meetings_backfill_from" bigint;--> statement-breakpoint
ALTER TABLE "krisp_connections" ADD COLUMN IF NOT EXISTS "meetings_backfill_cursor" text;--> statement-breakpoint
ALTER TABLE "krisp_connections" ADD COLUMN IF NOT EXISTS "meetings_last_error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_seq_idx" ON "meetings" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_deleted_idx" ON "meetings" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER meetings_seq_bump BEFORE UPDATE ON "meetings" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```

- [ ] **Step 6: Field additions on existing stores**

`src/lib/stores/tasks.ts` — inside `TaskRecord`, after `threadId?: string | null;`:

```ts
  /** #323 — the Krisp meeting this task was filed from (src/lib/meetings/). */
  meetingId?: string | null;
  /** #323 — set on a "Waiting on customer" item: the customer owes this.
   *  assigneeUserId is the Peak rep who owns the nudge; dueAt is the nudge date. */
  waitingOn?: { contactId: string | null; name: string } | null;
```

Check `createTask`/`normalizeTask` in the same file: if it whitelists optional keys (look for how `threadId` is copied), copy `meetingId` and `waitingOn` the same way — written only when set.

`src/lib/stores/notes.ts:23` →

```ts
export type NoteParentKind = "customer" | "lead" | "project" | "quote" | "engagement" | "site";
```

Then `grep -rn "NoteParentKind\|parentKind ===" src` and make any exhaustive switch/Record over it compile (a `site` note shows on its venue; label "Venue").

`src/lib/stores/recordings.ts` — in `RecordingRecord` add `meetingId?: string | null; // #323 — the meetings doc its Krisp import became`.

- [ ] **Step 7: Write `src/lib/stores/meetings.ts`**

```ts
import { getDoc, listDocs, patchDoc, upsertDoc } from "@/db/doc-store";
import type { MeetingRecord } from "@/lib/meetings/types";
import { emptyLinks } from "@/lib/meetings/types";
import { canSeeMeeting } from "@/lib/meetings/visibility";

const COLL = "meetings" as const;

export function normalizeMeeting(d: Partial<MeetingRecord> & { id: string }): MeetingRecord {
  const k = (d.krisp || {}) as Partial<MeetingRecord["krisp"]>;
  const l = (d.links || {}) as Partial<MeetingRecord["links"]>;
  return {
    id: d.id,
    krispMeetingId: d.krispMeetingId || d.id.replace(/^km-/, ""),
    seenBy: Array.isArray(d.seenBy) ? d.seenBy : [],
    ownerUserId: d.ownerUserId || "",
    recordingId: d.recordingId ?? null,
    krisp: {
      title: k.title || "", startedAt: k.startedAt ?? null, durationSec: k.durationSec ?? null,
      source: k.source ?? null, status: k.status || "", tags: Array.isArray(k.tags) ? k.tags : [],
      participants: Array.isArray(k.participants) ? k.participants : [],
      speakers: k.speakers && typeof k.speakers === "object" ? k.speakers : {},
      segments: Array.isArray(k.segments) ? k.segments : [],
      notes: k.notes ?? null, fetchedAt: k.fetchedAt ?? 0, detailFetchedAt: k.detailFetchedAt ?? null,
      removedAt: k.removedAt ?? null,
    },
    calendar: d.calendar ?? null,
    attendees: Array.isArray(d.attendees) ? d.attendees : [],
    speakerMap: d.speakerMap && typeof d.speakerMap === "object" ? d.speakerMap : {},
    links: {
      ...emptyLinks(),
      customerId: l.customerId ?? null, siteId: l.siteId ?? null,
      contactIds: Array.isArray(l.contactIds) ? l.contactIds : [],
      work: l.work ?? null,
      internalUserIds: Array.isArray(l.internalUserIds) ? l.internalUserIds : [],
    },
    filedAt: d.filedAt ?? null, filedBy: d.filedBy ?? null,
    suggestions: Array.isArray(d.suggestions) ? d.suggestions : [],
    noise: !!d.noise, noiseOverride: !!d.noiseOverride,
    todos: Array.isArray(d.todos) ? d.todos : [],
    share: d.share ?? null,
    createdAt: d.createdAt ?? 0, updatedAt: d.updatedAt ?? 0,
  };
}

export async function getMeeting(id: string): Promise<MeetingRecord | null> {
  const d = await getDoc<MeetingRecord>(COLL, id);
  return d ? normalizeMeeting(d) : null;
}

export async function saveMeeting(m: MeetingRecord): Promise<MeetingRecord> {
  const next = normalizeMeeting({ ...m, updatedAt: Date.now(), createdAt: m.createdAt || Date.now() });
  await upsertDoc(COLL, next);
  return next;
}

export async function patchMeeting(id: string, fn: (m: MeetingRecord) => MeetingRecord): Promise<MeetingRecord | null> {
  let out: MeetingRecord | null = null;
  await patchDoc<MeetingRecord>(COLL, id, (cur) => {
    if (!cur) return null;
    out = normalizeMeeting({ ...fn(normalizeMeeting(cur)), updatedAt: Date.now() });
    return out;
  });
  return out;
}

export async function allMeetings(): Promise<MeetingRecord[]> {
  const rows = await listDocs<MeetingRecord>(COLL);
  return rows.map(normalizeMeeting).sort((a, b) => (b.krisp.startedAt ?? 0) - (a.krisp.startedAt ?? 0));
}

export async function meetingsVisibleTo(userId: string): Promise<MeetingRecord[]> {
  return (await allMeetings()).filter((m) => canSeeMeeting(m, userId));
}

export async function meetingsLinkedTo(
  kind: "company" | "venue" | "contact" | "work", id: string, viewerId: string,
): Promise<MeetingRecord[]> {
  return (await meetingsVisibleTo(viewerId)).filter((m) =>
    kind === "company" ? m.links.customerId === id
    : kind === "venue" ? m.links.siteId === id
    : kind === "contact" ? m.links.contactIds.includes(id)
    : m.links.work?.id === id);
}
```

**Before writing:** open `src/db/doc-store.ts:465` and confirm `patchDoc`'s exact signature (its updater may receive the doc and return a partial, or the whole doc, or may not support returning `null`). Adapt `patchMeeting` to it while keeping the exported signature above. Task 2 creates `visibility.ts`; until then create it with the Task 2 content (Task 2 Step 3) so this compiles — Tasks 1 and 2 are committed together if needed.

- [ ] **Step 8: Run the checks + tsc**

Run: `export PATH=$HOME/.local/node/bin:$PATH; npx tsc --noEmit -p . 2>&1 | tail -5; npm run test:specs 2>&1 | grep -E "#323|FAILED|ALL PASSED"`
Expected: tsc clean; 4 `PASS #323 …` lines; `ALL PASSED`.

- [ ] **Step 9: Commit**

```bash
git add drizzle src/db src/lib/meetings src/lib/stores scripts/test-meetings-323.ts scripts/test-review-and-spec.ts
git commit -m "feat(meetings): #323 meetings doc table, types, store; task/note/recording field additions"
```

---

### Task 2: Pure rules — names, visibility, matcher

**Files:**
- Create: `src/lib/meetings/names.ts`, `src/lib/meetings/visibility.ts`, `src/lib/meetings/match.ts`
- Test: `scripts/test-meetings-323.ts` (add `meetings323MatchChecks`, `meetings323VisibilityChecks`)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `normalizeText(s: string): string`, `nameCore(name: string): string | null`, `hitsCore(text: string, core: string): boolean`, `personName(p: KrispPerson): string`
  - `meetingScope(m: Pick<MeetingRecord, "links">): MeetingScope` (`"private"|"internal"|"peak"`), `hasExternalLink(l: MeetingLinks): boolean`, `canSeeMeeting(m: Pick<MeetingRecord,"links"|"seenBy">, userId: string): boolean`, `portalCanSee(m: Pick<MeetingRecord,"links"|"share">, customerId: string): boolean`
  - `matchMeeting(input: MatchInput, index: MatchIndex): MatchResult` with the types below.

- [ ] **Step 1: Write the failing tests** — append to `scripts/test-meetings-323.ts`:

```ts
import { nameCore, hitsCore, normalizeText } from "@/lib/meetings/names";
import { canSeeMeeting, meetingScope, portalCanSee } from "@/lib/meetings/visibility";
import { matchMeeting, type MatchIndex, type MatchInput } from "@/lib/meetings/match";

const T0 = Date.UTC(2026, 9, 6, 15, 0); // 2026-10-06 10:00 Chicago

function index323(over: Partial<MatchIndex> = {}): MatchIndex {
  return {
    companies: [
      { id: "osakis", name: "Osakis Public Schools", keywords: [] },
      { id: "oshkosh", name: "Oshkosh Area School District", keywords: [] },
      { id: "oshct", name: "Oshkosh Community Theatre", keywords: [] },
      { id: "monte", name: "Montevideo Public Schools", keywords: ["Monte PAC"] },
    ],
    sites: [
      { id: "st-osakis-1", companyId: "osakis", name: "Osakis High School Auditorium", locationName: null },
      { id: "st-oshkosh-1", companyId: "oshkosh", name: "Oshkosh North High School", locationName: null },
      { id: "st-oshkosh-2", companyId: "oshkosh", name: "Oshkosh West High School", locationName: null },
    ],
    contacts: [
      { id: "c-tom", companyId: "osakis", firstName: "Tom", lastName: "Ellis", emails: ["tom@osakis.k12.mn.us"] },
      { id: "c-seth", companyId: "monte", firstName: "Seth", lastName: "Berg", emails: [] },
    ],
    users: [
      { id: "u1", name: "Jeff Chesebro", emails: ["jeff@peaksystemsgroup.com"] },
      { id: "u2", name: "Jason Keagy", emails: ["jason@peaksystemsgroup.com"] },
    ],
    internalDomains: ["peaksystemsgroup.com"],
    domainCompanies: { "osakis.k12.mn.us": ["osakis"] },
    visits: [],
    openWork: [],
    ...over,
  };
}
function input323(over: Partial<MatchInput>): MatchInput {
  return { title: "", calendarTitle: null, summaryText: "", attendees: [], speakerNames: [],
    startMs: T0, endMs: T0 + 30 * 60_000, durationSec: 1800, ownerUserId: "u1", ...over };
}

export async function meetings323MatchChecks(ok: Ok): Promise<void> {
  ok(normalizeText("Osakis – Theatrical Owner's Scope!") === "osakis theatrical owner s scope", "#323 normalizeText lowercases and turns punctuation into spaces");
  ok(nameCore("Osakis Public Schools") === "osakis" && nameCore("Oshkosh North High School") === "oshkosh north" &&
     nameCore("Oshkosh Community Theatre") === "oshkosh" && nameCore("The Center") === null,
    "#323 nameCore strips generic words and refuses an empty / < 4-char core");
  ok(hitsCore("Oshkosh North - VE Engineering Meeting", "oshkosh north") && !hitsCore("Oshkoshville kickoff", "oshkosh"),
    "#323 hitsCore matches whole words only");

  const idx = index323();
  // title + calendar title → strong
  const a = matchMeeting(input323({ title: "Osakis – theatrical owner scope requests", calendarTitle: "Osakis scope review" }), idx);
  const aCo = a.suggestions.find((s) => s.kind === "company");
  ok(!a.noise && aCo?.id === "osakis" && aCo.strength === "strong" && aCo.score === 80, "#323 title + calendar title → strong company suggestion (80)");
  ok(a.suggestions.some((s) => s.kind === "venue" && s.id === "st-osakis-1") === false,
    "#323 no venue suggested when no venue core hit and no visit (Osakis HS Auditorium core 'osakis' equals the company core — counted once, not as a venue hit)");
  // title only → weak
  const b = matchMeeting(input323({ title: "Montevideo - orchestra pit discussion" }), idx);
  ok(b.suggestions.find((s) => s.kind === "company")?.strength === "weak", "#323 title only → weak");
  // keyword hit counts as title
  const kw = matchMeeting(input323({ title: "Monte PAC rigging walk" }), idx);
  ok(kw.suggestions.find((s) => s.kind === "company")?.id === "monte", "#323 a company keyword is matched like its name");
  // no signal
  const c = matchMeeting(input323({ title: "Jeff Chesebro <> Speaker_2" }), idx);
  ok(c.suggestions.length === 0 && !c.noise, "#323 'Jeff <> Speaker_2' alone → no suggestion");
  // noise
  const d = matchMeeting(input323({ title: "Osakis quick", durationSec: 45 }), idx);
  ok(d.noise && d.suggestions.length === 0, "#323 < 3 minutes → noise, no suggestions");
  // venue-core hit beats a same-name company, but within 30 → both weak, venue suggested for top
  const e = matchMeeting(input323({ title: "Oshkosh North - VE Engineering Meeting" }), idx);
  const eCos = e.suggestions.filter((s) => s.kind === "company");
  ok(eCos[0]?.id === "oshkosh" && eCos[0].score === 60 && eCos.some((s) => s.id === "oshct") && eCos.every((s) => s.strength === "weak"),
    "#323 district venue hit (60) vs same-word theatre (50): both suggested, weak, district first");
  ok(e.suggestions.some((s) => s.kind === "venue" && s.id === "st-oshkosh-1") && !e.suggestions.some((s) => s.id === "st-oshkosh-2"),
    "#323 the venue whose core hit is suggested; its sibling is not");
  // email → contact
  const f = matchMeeting(input323({ title: "Scope call", attendees: [{ name: "Tom Ellis", email: "tom@osakis.k12.mn.us" }] }), idx);
  ok(f.suggestions.find((s) => s.kind === "company")?.score === 60 && f.suggestions.some((s) => s.kind === "contact" && s.id === "c-tom"),
    "#323 attendee email → contact (60) and the contact is suggested");
  // mobile recording during an owner's scheduled visit → that visit
  const g = matchMeeting(input323({ title: "Mobile recording - October 6, 2026 9:48 AM" }), index323({
    visits: [{ kind: "site_visit", id: "SV-1001", label: "Osakis walkthrough", companyId: "osakis", siteId: "st-osakis-1",
      startMs: T0 - 15 * 60_000, endMs: T0 + 60 * 60_000, assigneeUserId: "u1" }],
  }));
  ok(g.suggestions.some((s) => s.kind === "work" && s.id === "SV-1001" && s.workType === "site_visit") &&
     g.suggestions.some((s) => s.kind === "venue" && s.id === "st-osakis-1") &&
     g.suggestions.find((s) => s.kind === "company")?.score === 40,
    "#323 a recording during the owner's scheduled site visit suggests that visit, its venue and company (40, weak)");
  // someone else's visit doesn't count
  const g2 = matchMeeting(input323({ title: "Mobile recording" }), index323({
    visits: [{ kind: "site_visit", id: "SV-1002", label: "x", companyId: "osakis", siteId: null, startMs: T0, endMs: T0 + 1, assigneeUserId: "u2" }],
  }));
  ok(g2.suggestions.length === 0, "#323 another rep's visit is not a signal for this owner");
  // unique open lead becomes the work suggestion
  const h = matchMeeting(input323({ title: "Osakis scope", calendarTitle: "Osakis" }), index323({
    openWork: [{ type: "lead", id: "L-1", label: "Osakis rigging", companyId: "osakis" }],
  }));
  ok(h.suggestions.some((s) => s.kind === "work" && s.id === "L-1" && s.strength === "strong"), "#323 the company's single open lead is the work suggestion");
  const h2 = matchMeeting(input323({ title: "Osakis scope", calendarTitle: "Osakis" }), index323({
    openWork: [{ type: "lead", id: "L-1", label: "a", companyId: "osakis" }, { type: "lead", id: "L-2", label: "b", companyId: "osakis" }],
  }));
  ok(!h2.suggestions.some((s) => s.kind === "work"), "#323 two open leads → no work suggestion (never guessed)");
  // internal
  const i = matchMeeting(input323({ title: "Weekly Design Meeting", attendees: [
    { name: "Jeff Chesebro", email: "jeff@peaksystemsgroup.com" }, { name: "Jason Keagy", email: "jason@peaksystemsgroup.com" }] }), idx);
  ok(i.suggestions.length === 1 && i.suggestions[0].kind === "internal" && i.suggestions[0].id === "u2" && i.suggestions[0].strength === "strong",
    "#323 internal-only meeting → internal link to the other Peak attendee (not the owner), strong by email");
  // speaker first name breaks nothing alone
  const j = matchMeeting(input323({ title: "Mobile recording", speakerNames: ["Seth"] }), idx);
  ok(j.suggestions.length === 0, "#323 a speaker first name alone (10) is below the bar");
  // summary text
  const k = matchMeeting(input323({ title: "Mobile recording", summaryText: "Walked the Montevideo pit with Seth", speakerNames: ["Seth"] }), idx);
  ok(k.suggestions.length === 0, "#323 summary hit (20) + speaker first name at that company (10) = 30 → below the bar, nothing suggested");
  ok(a.suggestions.find((s) => s.kind === "company")!.reasons.some((r) => r.includes("title")), "#323 suggestions carry human reasons");
}

export async function meetings323VisibilityChecks(ok: Ok): Promise<void> {
  const base = meetingFixture323({ krispMeetingId: "v1", seenBy: ["u1", "u3"] });
  ok(meetingScope(base) === "private" && canSeeMeeting(base, "u1") && canSeeMeeting(base, "u3") && !canSeeMeeting(base, "u2"),
    "#323 unlinked → private to every rep whose Krisp lists it");
  const internal = { ...base, links: { ...base.links, internalUserIds: ["u2"] } };
  ok(meetingScope(internal) === "internal" && canSeeMeeting(internal, "u2") && !canSeeMeeting(internal, "u4"),
    "#323 internal link shares with that person only");
  for (const [label, links] of [
    ["company", { customerId: "osakis" }], ["venue", { siteId: "st-1" }], ["contact", { contactIds: ["c-1"] }],
    ["work", { work: { type: "lead" as const, id: "L-1", label: "x" } }],
  ] as const) {
    const m = { ...base, links: { ...base.links, ...links } };
    ok(meetingScope(m) === "peak" && canSeeMeeting(m, "u9"), `#323 any external link (${label}) → all of Peak`);
  }
  const linked = { ...base, links: { ...base.links, customerId: "osakis" } };
  ok(!portalCanSee(linked, "osakis"), "#323 linked but not shared → portal sees nothing");
  const shared = { ...linked, share: { sharedAt: 1, sharedBy: "Jeff", summary: "s" } };
  ok(portalCanSee(shared, "osakis") && !portalCanSee(shared, "other"), "#323 shared → only that customer's portal");
}
```

Chain both in `test-review-and-spec.ts` after `meetings323StoreChecks`.

- [ ] **Step 2: Run — expect module-not-found for names/visibility/match.**

- [ ] **Step 3: Write `src/lib/meetings/names.ts` and `visibility.ts`**

```ts
// src/lib/meetings/names.ts
import type { KrispPerson } from "./types";

/** Words that never identify a customer on their own (spec §Matcher "Name cores"). */
const GENERIC = new Set([
  "school", "schools", "district", "dist", "public", "high", "middle", "elementary", "junior", "senior",
  "isd", "usd", "sd", "hs", "ms", "area", "unified", "independent", "community", "college", "university",
  "city", "church", "theatre", "theater", "center", "centre", "pac", "auditorium", "performing", "arts",
  "inc", "llc", "co", "company", "corp", "the", "of", "and",
]);

export function normalizeText(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameCore(name: string | null | undefined): string | null {
  const core = normalizeText(name).split(" ").filter((w) => w && !GENERIC.has(w)).join(" ");
  return core.length >= 4 ? core : null;
}

export function hitsCore(text: string | null | undefined, core: string): boolean {
  return (" " + normalizeText(text) + " ").includes(" " + core + " ");
}

export function personName(p: { firstName?: string | null; lastName?: string | null; name?: string | null } | KrispPerson): string {
  const anyP = p as { firstName?: string | null; lastName?: string | null; name?: string | null };
  const full = [anyP.firstName, anyP.lastName].filter(Boolean).join(" ").trim();
  return full || (anyP.name || "").trim();
}
```

```ts
// src/lib/meetings/visibility.ts
import type { MeetingLinks, MeetingRecord } from "./types";

export type MeetingScope = "private" | "internal" | "peak";

export function hasExternalLink(l: MeetingLinks): boolean {
  return !!(l.customerId || l.siteId || l.contactIds.length || l.work);
}

export function meetingScope(m: Pick<MeetingRecord, "links">): MeetingScope {
  if (hasExternalLink(m.links)) return "peak";
  return m.links.internalUserIds.length ? "internal" : "private";
}

export function canSeeMeeting(m: Pick<MeetingRecord, "links" | "seenBy">, userId: string): boolean {
  const scope = meetingScope(m);
  if (scope === "peak") return true;
  if (m.seenBy.includes(userId)) return true;
  return scope === "internal" && m.links.internalUserIds.includes(userId);
}

export function portalCanSee(m: Pick<MeetingRecord, "links" | "share">, customerId: string): boolean {
  return m.share != null && !!customerId && m.links.customerId === customerId;
}
```

(`canSeeMeeting` for `peak` returns true for any signed-in user; inactive users can't sign in, so no extra check.)

- [ ] **Step 4: Write `src/lib/meetings/match.ts`**

```ts
import { hitsCore, nameCore, normalizeText } from "./names";
import type { MeetingSuggestion, Strength, WorkType } from "./types";
import { NOISE_MAX_SEC } from "./types";

export type MatchCompany = { id: string; name: string; keywords: string[] };
export type MatchSite = { id: string; companyId: string; name: string; locationName: string | null };
export type MatchContact = { id: string; companyId: string | null; firstName: string; lastName: string; emails: string[] };
export type MatchUser = { id: string; name: string; emails: string[] };
export type MatchVisit = {
  kind: "site_visit" | "survey"; id: string; label: string;
  companyId: string | null; siteId: string | null; startMs: number; endMs: number; assigneeUserId: string | null;
};
export type MatchWork = { type: "lead" | "project" | "engagement"; id: string; label: string; companyId: string };

export type MatchIndex = {
  companies: MatchCompany[];
  sites: MatchSite[];
  contacts: MatchContact[];
  users: MatchUser[];
  internalDomains: string[];
  /** lowercased email domain → company ids (customersForDomain) */
  domainCompanies: Record<string, string[]>;
  visits: MatchVisit[];
  openWork: MatchWork[];
};

export type MatchInput = {
  title: string;
  calendarTitle: string | null;
  summaryText: string;
  attendees: { name: string; email: string | null }[];
  speakerNames: string[];
  startMs: number | null;
  endMs: number | null;
  durationSec: number | null;
  ownerUserId: string;
};

export type MatchResult = { noise: boolean; suggestions: MeetingSuggestion[] };

const P = { title: 50, venueBonus: 10, calendar: 30, emailContact: 60, emailDomain: 40, visit: 40, summary: 20, speaker: 10 };
const STRONG_MIN = 80, STRONG_LEAD = 30, WEAK_MIN = 40;

type Cand = { id: string; label: string; score: number; reasons: string[]; venueId: string | null; visit: MatchVisit | null };

function domainOf(email: string): string { return email.slice(email.lastIndexOf("@") + 1).toLowerCase(); }

/** The best (longest) core of a company or its venues that `text` hits. */
function coreHit(text: string, company: MatchCompany, sites: MatchSite[]): { venueId: string | null; core: string } | null {
  let best: { venueId: string | null; core: string } | null = null;
  const consider = (core: string | null, venueId: string | null) => {
    if (!core || !hitsCore(text, core)) return;
    if (!best || core.length > best.core.length) best = { venueId, core };
  };
  consider(nameCore(company.name), null);
  for (const k of company.keywords) consider(nameCore(k), null);
  const companyCore = nameCore(company.name);
  for (const s of sites) {
    for (const nm of [s.name, s.locationName]) {
      const c = nameCore(nm);
      if (c && c !== companyCore) consider(c, s.id); // a venue core equal to the company core is not more specific
    }
  }
  return best;
}

function overlaps(v: MatchVisit, start: number, end: number): boolean {
  return v.startMs < end && start < v.endMs;
}

export function matchMeeting(input: MatchInput, index: MatchIndex): MatchResult {
  if (input.durationSec != null && input.durationSec < NOISE_MAX_SEC) return { noise: true, suggestions: [] };

  const sitesBy = new Map<string, MatchSite[]>();
  for (const s of index.sites) sitesBy.set(s.companyId, [...(sitesBy.get(s.companyId) || []), s]);
  const internalEmails = new Set(index.users.flatMap((u) => u.emails.map((e) => e.toLowerCase())));
  const isInternal = (email: string) => internalEmails.has(email.toLowerCase()) || index.internalDomains.includes(domainOf(email));
  const contactByEmail = new Map<string, MatchContact>();
  for (const c of index.contacts) for (const e of c.emails) contactByEmail.set(e.toLowerCase(), c);

  const start = input.startMs ?? 0;
  const end = input.endMs ?? (start + (input.durationSec ?? 0) * 1000);
  const ownerVisits = input.startMs == null ? [] :
    index.visits.filter((v) => v.assigneeUserId === input.ownerUserId && overlaps(v, start, end));

  const externalEmails = input.attendees.map((a) => a.email?.toLowerCase() || "").filter((e) => e && !isInternal(e));
  const firstNames = new Set(input.speakerNames.map((n) => normalizeText(n).split(" ")[0]).filter(Boolean));

  const cands: Cand[] = [];
  for (const co of index.companies) {
    const sites = sitesBy.get(co.id) || [];
    let score = 0; const reasons: string[] = []; let venueId: string | null = null; let visit: MatchVisit | null = null;
    const t = coreHit(input.title, co, sites);
    if (t) {
      score += P.title + (t.venueId ? P.venueBonus : 0); venueId = t.venueId;
      reasons.push(`title says “${t.core}”`);
    }
    if (input.calendarTitle) {
      const c = coreHit(input.calendarTitle, co, sites);
      if (c) { score += P.calendar; venueId = venueId || c.venueId; reasons.push(`calendar: “${input.calendarTitle}”`); }
    }
    const contactHits = externalEmails.map((e) => contactByEmail.get(e)).filter((c): c is MatchContact => !!c && c.companyId === co.id);
    if (contactHits.length) {
      score += P.emailContact;
      reasons.push(`${contactHits[0].emails[0]} is ${contactHits[0].firstName} ${contactHits[0].lastName}`.trim());
    } else if (externalEmails.some((e) => (index.domainCompanies[domainOf(e)] || []).includes(co.id))) {
      score += P.emailDomain; reasons.push("attendee email domain");
    }
    const v = ownerVisits.find((x) => x.companyId === co.id);
    if (v) { score += P.visit; visit = v; venueId = venueId || v.siteId; reasons.push(`during ${v.label}`); }
    if (input.summaryText && coreHit(input.summaryText, co, sites)) { score += P.summary; reasons.push("named in the notes"); }
    if (firstNames.size && index.contacts.some((c) => c.companyId === co.id && firstNames.has(normalizeText(c.firstName)))) {
      score += P.speaker; reasons.push("a speaker's first name matches a contact");
    }
    if (score > 0) cands.push({ id: co.id, label: co.name, score, reasons, venueId, visit });
  }
  cands.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const out: MeetingSuggestion[] = [];
  const top = cands[0];
  if (top && top.score >= WEAK_MIN) {
    const second = cands[1]?.score ?? 0;
    const strength: Strength = top.score >= STRONG_MIN && top.score - second >= STRONG_LEAD ? "strong" : "weak";
    out.push({ kind: "company", id: top.id, label: top.label, score: top.score, strength, reasons: top.reasons });
    if (strength === "weak") {
      for (const c of cands.slice(1)) {
        if (c.score < WEAK_MIN || top.score - c.score >= STRONG_LEAD) break;
        out.push({ kind: "company", id: c.id, label: c.label, score: c.score, strength: "weak", reasons: c.reasons });
      }
    }
    if (top.venueId) {
      const s = index.sites.find((x) => x.id === top.venueId);
      if (s) out.push({ kind: "venue", id: s.id, label: s.name, score: top.score, strength, reasons: top.reasons });
    }
    for (const e of externalEmails) {
      const c = contactByEmail.get(e);
      if (c && (c.companyId === top.id || c.companyId === null) && !out.some((x) => x.kind === "contact" && x.id === c.id)) {
        out.push({ kind: "contact", id: c.id, label: `${c.firstName} ${c.lastName}`.trim(), score: top.score, strength, reasons: [`attendee ${e}`] });
      }
    }
    const work = workFor(top, index.openWork);
    if (work) out.push({ kind: "work", id: work.id, label: work.label, workType: work.type, score: top.score, strength, reasons: work.reasons });
    return { noise: false, suggestions: out };
  }

  // Internal: no external candidate reached the bar.
  const internal = new Map<string, { label: string; byEmail: boolean }>();
  for (const a of input.attendees) {
    const u = a.email ? index.users.find((x) => x.emails.some((e) => e.toLowerCase() === a.email!.toLowerCase())) : null;
    if (u && u.id !== input.ownerUserId) internal.set(u.id, { label: u.name, byEmail: true });
  }
  for (const n of input.speakerNames) {
    const u = index.users.find((x) => normalizeText(x.name) === normalizeText(n));
    if (u && u.id !== input.ownerUserId && !internal.has(u.id)) internal.set(u.id, { label: u.name, byEmail: false });
  }
  for (const [id, v] of internal) {
    out.push({ kind: "internal", id, label: v.label, score: 0, strength: v.byEmail ? "strong" : "weak",
      reasons: [v.byEmail ? "Peak attendee" : "Peak speaker"] });
  }
  return { noise: false, suggestions: out };
}

function workFor(top: Cand, openWork: MatchWork[]): { type: WorkType; id: string; label: string; reasons: string[] } | null {
  if (top.visit) return { type: top.visit.kind, id: top.visit.id, label: top.visit.label, reasons: [`during ${top.visit.label}`] };
  for (const type of ["lead", "engagement", "project"] as const) {
    const mine = openWork.filter((w) => w.companyId === top.id && w.type === type);
    if (mine.length === 1) return { type, id: mine[0].id, label: mine[0].label, reasons: [`the only open ${type}`] };
    if (mine.length > 1) return null; // ambiguous at the most specific level → never guess
  }
  return null;
}
```

Note the spec's priority order for a work link (visit > lead > engagement > project) — `workFor` stops at the first type with any open record: one → suggest, several → nothing.

- [ ] **Step 5: Run** — `npm run test:specs 2>&1 | grep -E "#323|FAILED|ALL PASSED"`. Expected all `#323` PASS. If a scoring expectation fails, fix the code to match the Global Constraints numbers — not the test.

- [ ] **Step 6: Commit** — `git add src/lib/meetings scripts/test-meetings-323.ts scripts/test-review-and-spec.ts && git commit -m "feat(meetings): #323 name cores, visibility rule, pure matcher"`

---

### Task 3: Pure rules — attendee merge, speaker relabel, render, to-dos

**Files:**
- Create: `src/lib/meetings/render.ts`, `src/lib/meetings/todos.ts`
- Test: `scripts/test-meetings-323.ts` (`meetings323RenderChecks`)

**Interfaces:**
- Consumes: Task 1 types, `personName`/`normalizeText` (Task 2), `deriveSummary`, `type DerivedActionItem`, `type KrispNoteBlock` (`src/lib/krisp/derive.ts`, `src/lib/stores/recordings.ts`).
- Produces:
  - `attendeeKey(name: string, email: string | null): string`
  - `mergeAttendees(prev: MeetingAttendee[], krisp: KrispPerson[], calendar: MeetingCalendar | null): MeetingAttendee[]`
  - `resolveAttendees(atts: MeetingAttendee[], byEmail: Map<string, { contactId?: string; userId?: string }>): MeetingAttendee[]`
  - `speakerLabel(m: Pick<MeetingRecord,"krisp">, idx: string): string`
  - `speakerIndexes(m: Pick<MeetingRecord,"krisp">): string[]`
  - `relabel(text: string, pairs: [from: string, to: string][]): string`
  - `renderMeeting(m: MeetingRecord, names: RenderNames): RenderedMeeting`
  - `suggestTodoKind(assignee: string | null, people: { users: { id: string; name: string }[]; contacts: { id: string; name: string }[] }): TodoKind`
  - `mergeTodos(prev: MeetingTodo[], derived: DerivedActionItem[], suggest: (assignee: string | null) => TodoKind): MeetingTodo[]`
  - `noteParentFor(links: MeetingLinks): { parentKind: NoteParentKind; parentId: string } | null`

- [ ] **Step 1: Failing tests** — append:

```ts
import { mergeAttendees, relabel, renderMeeting, resolveAttendees, speakerLabel } from "@/lib/meetings/render";
import { mergeTodos, noteParentFor, suggestTodoKind } from "@/lib/meetings/todos";

export async function meetings323RenderChecks(ok: Ok): Promise<void> {
  // K9 attendee merge
  const a1 = mergeAttendees([], [{ email: "Tom@Osakis.k12.mn.us", firstName: "Tom", lastName: "Ellis" }],
    { eventId: "e1", title: "Osakis", attendees: [{ email: "tom@osakis.k12.mn.us", name: "Tom Ellis" }, { email: "amy@osakis.k12.mn.us", name: null }] });
  ok(a1.length === 2 && a1[0].key === "tom@osakis.k12.mn.us" && a1[0].sources.join() === "krisp,calendar" && a1[1].name === "amy@osakis.k12.mn.us",
    "#323 attendees: Krisp ∪ calendar, deduped by lowercased email, sources unioned, nameless calendar guest named by email");
  const manualRemoved = a1.map((x) => (x.key === "amy@osakis.k12.mn.us" ? { ...x, removed: true } : x))
    .concat([{ key: "name:seth", name: "Seth", email: null, sources: ["manual"], removed: false, contactId: "c-seth", userId: null }]);
  const a2 = mergeAttendees(manualRemoved, [], { eventId: "e1", title: "Osakis", attendees: [{ email: "amy@osakis.k12.mn.us", name: "Amy" }] });
  ok(a2.find((x) => x.key === "amy@osakis.k12.mn.us")?.removed === true && a2.some((x) => x.key === "name:seth" && x.contactId === "c-seth") &&
     a2.find((x) => x.key === "tom@osakis.k12.mn.us")?.sources.join() === "krisp,calendar",
    "#323 a re-merge keeps manual entries, removed flags and resolutions; drops nothing");
  const r = resolveAttendees(a1, new Map([["tom@osakis.k12.mn.us", { contactId: "c-tom" }]]));
  ok(r[0].contactId === "c-tom" && r[1].contactId === null, "#323 resolveAttendees fills contact ids by email, never by name");

  // K10 speaker relabel
  const m = meetingFixture323({ krispMeetingId: "r1" });
  m.krisp.speakers = { "0": { email: "jeff@peaksystemsgroup.com", firstName: "Jeff", lastName: "Chesebro" } };
  m.krisp.segments = [{ speaker: "0", text: "Hi", start: 0, end: 1 }, { speaker: "2", text: "Speaker 2 here, I'll send drawings", start: 1, end: 3 }];
  m.krisp.notes = { blocks: [{ type: "action_item", text: "Send the venue drawings", assignee: "Speaker_2" }] };
  ok(speakerLabel(m, "0") === "Jeff Chesebro" && speakerLabel(m, "2") === "Speaker 2", "#323 speaker label: Krisp's name, else 'Speaker <idx>'");
  ok(relabel("Speaker_2 and Speaker 2 said; Speaker 22 didn't", [["Speaker 2", "Tom Ellis"]]) === "Tom Ellis and Tom Ellis said; Speaker 22 didn't",
    "#323 relabel replaces both spellings, whole-word only");
  m.speakerMap = { "2": { contactId: "c-tom", name: "Tom Ellis" } };
  const view = renderMeeting(m, { contact: (id) => (id === "c-tom" ? "Tom Ellis" : null), user: () => null });
  ok(view.segments[1].speakerName === "Tom Ellis" && view.segments[1].text.startsWith("Tom Ellis here"),
    "#323 render: mapped speaker names the segment and replaces the label in its text");
  ok(view.todos.length === 0 || view.todos[0].assigneeDisplay === "Tom Ellis", "#323 render: to-do owner follows the speaker map");
  const refreshed = { ...m, krisp: { ...m.krisp, title: "Renamed in Krisp" } };
  ok(renderMeeting(refreshed, { contact: () => "Tom Ellis", user: () => null }).segments[1].speakerName === "Tom Ellis",
    "#323 a Krisp refresh never loses the speaker map (render starts from krisp.* every time)");

  // K6 to-do defaults
  const people = { users: [{ id: "u1", name: "Jeff Chesebro" }], contacts: [{ id: "c-tom", name: "Tom Ellis" }] };
  ok(suggestTodoKind("Jeff Chesebro", people) === "task" && suggestTodoKind("Jeff", people) === "task", "#323 to-do for a Peak person → task (full or first name)");
  ok(suggestTodoKind("Tom Ellis", people) === "waiting", "#323 to-do for the customer → waiting");
  ok(suggestTodoKind(null, people) === "note" && suggestTodoKind("Someone Else", people) === "note", "#323 to-do with no known owner → note");
  const derived = [{ key: "k1", title: "Send drawings", assigneeName: "Tom Ellis", dueDate: null }, { key: "k2", title: "Price track", assigneeName: "Jeff", dueDate: "2026-10-20" }];
  const t1 = mergeTodos([], derived, (x) => suggestTodoKind(x, people));
  ok(t1.length === 2 && t1[0].suggested === "waiting" && t1[1].suggested === "task" && t1.every((t) => t.decision === null), "#323 mergeTodos seeds suggestions");
  const decided = t1.map((t) => (t.key === "k1" ? { ...t, decision: { kind: "dismiss" as const, createdId: null, decidedAt: 1, decidedBy: "Jeff" } } : t));
  const t2 = mergeTodos(decided, [{ ...derived[0], title: "Send the drawings (edited)" }, derived[1]], () => "note");
  ok(t2.find((t) => t.key === "k1")?.decision?.kind === "dismiss" && t2.find((t) => t.key === "k2")?.suggested === "note",
    "#323 a decided to-do is untouched by re-sync (dismissed stays dismissed); undecided ones re-suggest");
  ok(mergeTodos(decided, [], () => "note").length === 2, "#323 a to-do Krisp dropped is kept once it exists in the app");

  // note parent priority venue > lead > project > engagement > customer
  const L = { customerId: "osakis", siteId: "st-1", contactIds: [], work: { type: "lead" as const, id: "L-1", label: "x" }, internalUserIds: [] };
  ok(noteParentFor(L)?.parentKind === "site" && noteParentFor({ ...L, siteId: null })?.parentKind === "lead" &&
     noteParentFor({ ...L, siteId: null, work: { type: "survey", id: "FS-1", label: "x" } })?.parentKind === "customer" &&
     noteParentFor({ customerId: null, siteId: null, contactIds: [], work: null, internalUserIds: [] }) === null,
    "#323 note parent: venue > lead > project > engagement > customer; survey/site-visit work falls back to the customer");
}
```

Chain `meetings323RenderChecks(ok)`.

- [ ] **Step 2: Run — expect module-not-found.**

- [ ] **Step 3: Write `src/lib/meetings/render.ts`**

```ts
import { deriveSummary } from "@/lib/krisp/derive";
import type { KrispNoteBlock } from "@/lib/stores/recordings";
import { normalizeText, personName } from "./names";
import type { KrispPerson, MeetingAttendee, MeetingCalendar, MeetingRecord, MeetingTodo } from "./types";

export function attendeeKey(name: string, email: string | null): string {
  return email ? email.trim().toLowerCase() : "name:" + normalizeText(name);
}

export function mergeAttendees(prev: MeetingAttendee[], krisp: KrispPerson[], calendar: MeetingCalendar | null): MeetingAttendee[] {
  const out = prev.map((a) => ({ ...a, sources: [...a.sources] }));
  const add = (name: string, email: string | null, source: "krisp" | "calendar") => {
    const key = attendeeKey(name || email || "", email);
    if (key === "name:") return;
    const hit = out.find((a) => a.key === key);
    if (hit) {
      if (!hit.sources.includes(source)) hit.sources.push(source);
      if (!hit.name && name) hit.name = name;
      return;
    }
    out.push({ key, name: name || email || "", email: email ? email.trim().toLowerCase() : null, sources: [source],
      removed: false, contactId: null, userId: null });
  };
  for (const p of krisp) add(personName(p), p.email, "krisp");
  for (const a of calendar?.attendees || []) add(a.name || "", a.email, "calendar");
  const order = (s: MeetingAttendee) => (s.sources.includes("krisp") ? 0 : s.sources.includes("calendar") ? 1 : 2);
  return out.sort((x, y) => order(x) - order(y));
}

export function resolveAttendees(atts: MeetingAttendee[], byEmail: Map<string, { contactId?: string; userId?: string }>): MeetingAttendee[] {
  return atts.map((a) => {
    if (!a.email || a.contactId || a.userId) return a;
    const r = byEmail.get(a.email);
    return r ? { ...a, contactId: r.contactId ?? null, userId: r.userId ?? null } : a;
  });
}

export function speakerIndexes(m: Pick<MeetingRecord, "krisp">): string[] {
  const set = new Set<string>([...Object.keys(m.krisp.speakers), ...m.krisp.segments.map((s) => String(s.speaker))]);
  return [...set].sort((a, b) => Number(a) - Number(b));
}

export function speakerLabel(m: Pick<MeetingRecord, "krisp">, idx: string): string {
  const p = m.krisp.speakers[idx];
  return (p && personName(p)) || `Speaker ${idx}`;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Whole-word replace; a "Speaker N" label also matches its "Speaker_N" spelling. */
export function relabel(text: string, pairs: [string, string][]): string {
  let out = text;
  for (const [from, to] of pairs) {
    if (!from || from === to) continue;
    const pattern = escapeRe(from).replace(/\\? /g, "[ _]");
    out = out.replace(new RegExp(`(?<![\\w])${pattern}(?![\\w])`, "g"), to);
  }
  return out;
}

export type RenderNames = { contact: (id: string) => string | null; user: (id: string) => string | null };

export type RenderedMeeting = {
  attendees: (MeetingAttendee & { display: string })[];
  speakers: { idx: string; label: string; mapped: string | null }[];
  segments: { speakerIdx: string; speakerName: string; text: string; start: number; end: number }[];
  summary: { title: string; description: string }[];
  keyPoints: string[];
  todos: (MeetingTodo & { assigneeDisplay: string | null })[];
};

export function renderMeeting(m: MeetingRecord, names: RenderNames): RenderedMeeting {
  const mappedName = (idx: string): string | null => {
    const ref = m.speakerMap[idx];
    if (!ref) return null;
    return (ref.contactId && names.contact(ref.contactId)) || (ref.userId && names.user(ref.userId)) || ref.name || null;
  };
  const speakers = speakerIndexes(m).map((idx) => ({ idx, label: speakerLabel(m, idx), mapped: mappedName(idx) }));
  const pairs: [string, string][] = speakers.filter((s) => s.mapped).map((s) => [s.label, s.mapped!]);
  const fix = (s: string) => relabel(s, pairs);
  const derived = deriveSummary(m.krisp.notes as { blocks: KrispNoteBlock[] } | null);
  return {
    attendees: m.attendees.filter((a) => !a.removed).map((a) => ({
      ...a, display: (a.contactId && names.contact(a.contactId)) || (a.userId && names.user(a.userId)) || a.name,
    })),
    speakers,
    segments: m.krisp.segments.map((s) => {
      const idx = String(s.speaker);
      return { speakerIdx: idx, speakerName: mappedName(idx) || speakerLabel(m, idx), text: fix(s.text), start: s.start, end: s.end };
    }),
    summary: derived.summary.map((x) => ({ title: fix(x.title), description: fix(x.description) })),
    keyPoints: derived.keyPoints.map(fix),
    todos: m.todos.map((t) => ({ ...t, title: fix(t.title), assigneeDisplay: t.assigneeLabel ? fix(t.assigneeLabel) : null })),
  };
}
```

- [ ] **Step 4: Write `src/lib/meetings/todos.ts`**

```ts
import type { DerivedActionItem } from "@/lib/krisp/derive";
import type { NoteParentKind } from "@/lib/stores/notes";
import { normalizeText } from "./names";
import type { MeetingLinks, MeetingTodo, TodoKind } from "./types";

type Named = { id: string; name: string };

function nameMatches(label: string, full: string): boolean {
  const l = normalizeText(label), f = normalizeText(full);
  return !!l && (l === f || f.split(" ")[0] === l);
}

export function suggestTodoKind(assignee: string | null, people: { users: Named[]; contacts: Named[] }): TodoKind {
  if (!assignee) return "note";
  if (people.users.some((u) => nameMatches(assignee, u.name))) return "task";
  if (people.contacts.some((c) => nameMatches(assignee, c.name))) return "waiting";
  return "note";
}

export function mergeTodos(prev: MeetingTodo[], derived: DerivedActionItem[], suggest: (assignee: string | null) => TodoKind): MeetingTodo[] {
  const byKey = new Map(prev.map((t) => [t.key, t]));
  const out: MeetingTodo[] = [];
  for (const d of derived) {
    const old = byKey.get(d.key);
    byKey.delete(d.key);
    if (old?.decision) { out.push(old); continue; }
    out.push({ key: d.key, title: d.title, assigneeLabel: d.assigneeName, dueDate: d.dueDate,
      suggested: suggest(d.assigneeName), decision: null });
  }
  for (const rest of byKey.values()) out.push(rest); // never drop a to-do the app already holds
  return out;
}

export function noteParentFor(links: MeetingLinks): { parentKind: NoteParentKind; parentId: string } | null {
  if (links.siteId) return { parentKind: "site", parentId: links.siteId };
  const w = links.work;
  if (w && (w.type === "lead" || w.type === "project" || w.type === "engagement")) return { parentKind: w.type, parentId: w.id };
  if (links.customerId) return { parentKind: "customer", parentId: links.customerId };
  return null;
}
```

(`mergeTodos` takes `suggest` with the *mapped* assignee — the sync passes `(a) => suggestTodoKind(relabel(a ?? "", pairs) || null, people)`.)

- [ ] **Step 5: Run** — all `#323` PASS. If the `relabel` lookbehind regex is rejected by the TS target, check `tsconfig.json` `target` (ES2018+ supports lookbehind; Node supports it regardless).

- [ ] **Step 6: Commit** — `git add src/lib/meetings scripts/test-meetings-323.ts scripts/test-review-and-spec.ts && git commit -m "feat(meetings): #323 attendee merge, speaker relabel, render, to-do defaults"`

---

### Task 4: Krisp list API + sync engine

**Files:**
- Modify: `src/lib/krisp/client.ts` (add `listMeetings`, extend `KRISP_MEETING_FIELDS` usage), `src/app/(app)/page.tsx:72` (Home stale check), `src/app/api/gmail/sync/route.ts` (cron rider)
- Create: `src/lib/meetings/sync-state.ts`, `src/lib/meetings/index-build.ts`, `src/lib/meetings/sync.ts`
- Test: `scripts/test-meetings-323.ts` (`meetings323SyncChecks`)

**Interfaces:**
- Consumes: Tasks 1–3; `getKrispConnection`, `listKrispConnections` (`src/lib/krisp/connections.ts`); `KrispRateLimitError`, `KrispNotReadyError`, `KrispAuthError`, `KrispForbiddenError` (`src/lib/krisp/errors.ts`); `listUpcomingEvents`, `getEvent` (`src/lib/google/calendar.ts`); `personalKey`, `hasCalendarScope` (`src/lib/gmail/config.ts`); `getConnectionInfo` (`src/lib/gmail/connections.ts`); `contactsByEmails` (`src/lib/identity/lookup.ts`); `allRecordings` (`src/lib/stores/recordings.ts`).
- Produces:
  - client: `listMeetings(q: KrispListQuery): Promise<KrispMeetingPage>` with
    ```ts
    export type KrispListQuery = { from?: string; to?: string; cursor?: string | null; limit?: number; ownership?: "all" | "mine" | "shared" };
    export type KrispListedMeeting = { id: string; title: string; startedAt: number | null; durationSec: number | null; status: string; source: string | null; tags: string[]; ownership: "owned" | "shared" | null; participants: KrispPerson[] };
    export type KrispMeetingPage = { meetings: KrispListedMeeting[]; nextCursor: string | null };
    ```
  - `getSyncState(userId): Promise<SyncState | null>`, `setSyncState(userId, patch: Partial<SyncState>): Promise<void>` where `SyncState = { syncedAt: number | null; backfillFrom: number | null; backfillCursor: string | null; lastError: string | null }`
  - `buildMatchIndex(): Promise<MatchIndex>`
  - `syncRepMeetings(userId: string, mode: "recent" | "backfill", deps: SyncDeps): Promise<SyncResult>`
  - `runMeetingsSync(userId: string, mode?: "recent" | "backfill"): Promise<SyncResult>` (real deps)
  - `syncMeetingsIfStale(userId: string): Promise<SyncResult | null>`
  - `syncAllMeetings(): Promise<Record<string, SyncResult>>`
  - `rematchMeeting(m: MeetingRecord, index: MatchIndex): MeetingRecord` (pure; used by actions too)
  - `type SyncResult = { listed: number; created: number; detailed: number; complete: boolean; error: string | null }`

- [ ] **Step 1: Add `listMeetings` to the client.** In `src/lib/krisp/client.ts`, inside the object returned by `createKrispClient`, after `meeting(...)`:

```ts
    /** `GET /meetings` (#323) — paginated list of meetings visible to the key holder. No
     *  last-modified field is returned, so callers sync by date window. */
    async listMeetings(q: KrispListQuery = {}): Promise<KrispMeetingPage> {
      const p = new URLSearchParams();
      p.set("limit", String(Math.min(100, Math.max(1, q.limit ?? 100))));
      p.set("ownership", q.ownership ?? "all");
      p.set("sort_by", "date");
      p.set("order", "newest");
      p.set("fields", "title,started_at,duration,status,source,tags,ownership,participants");
      if (q.from) p.set("from", q.from);
      if (q.to) p.set("to", q.to);
      if (q.cursor) p.set("cursor", q.cursor);
      const d = (await call("GET", `/meetings?${p.toString()}`)) as { meetings?: unknown[]; next_cursor?: string | null } | null;
      return {
        meetings: (d?.meetings || []).map((raw) => toListed(raw as Record<string, unknown>)).filter((m): m is KrispListedMeeting => !!m),
        nextCursor: (d?.next_cursor as string | null) ?? null,
      };
    },
```

Above `createKrispClient`, add the exported types from the Interfaces block and:

```ts
function toPerson(p: Record<string, unknown>): KrispPerson {
  const s = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string).trim() : null);
  const first = s("first_name"), last = s("last_name"), name = s("name");
  return { email: s("email")?.toLowerCase() ?? null, firstName: first ?? (name ? name.split(" ")[0] : null), lastName: last ?? (name && name.includes(" ") ? name.slice(name.indexOf(" ") + 1) : null) };
}
function toListed(r: Record<string, unknown>): KrispListedMeeting | null {
  if (typeof r.id !== "string" || !r.id) return null;
  const started = typeof r.started_at === "string" ? Date.parse(r.started_at) : NaN;
  const parts = Array.isArray(r.participants) ? r.participants : [];
  return {
    id: r.id, title: typeof r.title === "string" ? r.title : "",
    startedAt: Number.isFinite(started) ? started : null,
    durationSec: typeof r.duration === "number" ? r.duration : null,
    status: typeof r.status === "string" ? r.status : "",
    source: typeof r.source === "string" ? r.source : null,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
    ownership: r.ownership === "owned" || r.ownership === "shared" ? r.ownership : null,
    participants: parts.filter((p): p is Record<string, unknown> => !!p && typeof p === "object").map(toPerson),
  };
}
export { toPerson as krispPersonFrom };
```

Import `KrispPerson` from `@/lib/meetings/types`. **Check** how the existing `call()` unwraps a `{data: …}` envelope (`unwrap(...)` in `meeting()`); if responses are wrapped, unwrap the list the same way (the test's fake transport in Step 3 must mirror the real envelope — read `meeting()` and copy its pattern).

- [ ] **Step 2: `sync-state.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { krispConnections } from "@/db/schema";

export type SyncState = { syncedAt: number | null; backfillFrom: number | null; backfillCursor: string | null; lastError: string | null };

export async function getSyncState(userId: string): Promise<SyncState | null> {
  const [r] = await db.select().from(krispConnections).where(eq(krispConnections.userId, userId)).limit(1);
  return r ? { syncedAt: r.meetingsSyncedAt ?? null, backfillFrom: r.meetingsBackfillFrom ?? null,
    backfillCursor: r.meetingsBackfillCursor ?? null, lastError: r.meetingsLastError ?? null } : null;
}

export async function setSyncState(userId: string, patch: Partial<SyncState>): Promise<void> {
  const set: Record<string, unknown> = {};
  if ("syncedAt" in patch) set.meetingsSyncedAt = patch.syncedAt;
  if ("backfillFrom" in patch) set.meetingsBackfillFrom = patch.backfillFrom;
  if ("backfillCursor" in patch) set.meetingsBackfillCursor = patch.backfillCursor;
  if ("lastError" in patch) set.meetingsLastError = patch.lastError;
  if (Object.keys(set).length) await db.update(krispConnections).set(set).where(eq(krispConnections.userId, userId));
}
```

(Confirm the `db` import path by reading `src/lib/krisp/connections.ts`'s imports and copy them.)

- [ ] **Step 3: Failing sync tests** — append. The fake client implements `listMeetings` and `meeting`; deps are injected so no network, no Calendar:

```ts
import { rematchMeeting, syncRepMeetings, type SyncDeps } from "@/lib/meetings/sync";

export async function meetings323SyncChecks(ok: Ok): Promise<void> {
  const NOW = Date.UTC(2026, 9, 9, 18, 0);
  const ids = { a: "TEST323" + "1".repeat(25), b: "TEST323" + "2".repeat(25), c: "TEST323" + "3".repeat(25) };
  Object.values(ids).forEach((k) => registerFixture("meetings", "km-" + k));
  const listed = (id: string, title: string, startedAt: number, dur = 1200, ownership: "owned" | "shared" = "owned") =>
    ({ id, title, startedAt, durationSec: dur, status: "completed", source: "zoom", tags: [], ownership, participants: [] });
  const pages: Record<string, { meetings: ReturnType<typeof listed>[]; nextCursor: string | null }> = {
    "": { meetings: [listed(ids.a, "Osakis – scope", NOW - 3600_000), listed(ids.b, "avconferenced", NOW - 7200_000, 45)], nextCursor: "p2" },
    p2: { meetings: [listed(ids.c, "Jeff <> Speaker_2", NOW - 86_400_000)], nextCursor: null },
  };
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const deps = (userId: string): SyncDeps => ({
    now: () => NOW,
    client: {
      listMeetings: async (q) => { calls.push("list:" + (q.cursor || "")); return pages[q.cursor || ""]; },
      meeting: async (id) => { calls.push("detail:" + id); return { id, title: null, startedAt: null, duration: null, status: "completed", participants: null,
        transcript: { language: "en", speakers: {}, segments: [{ speaker: 1, text: "hello", start: 0, end: 1 }] },
        notes: { blocks: [{ type: "action_item", text: "Send drawings", assignee: "Jeff" }] } }; },
    },
    calendar: async () => null,
    buildIndex: async () => index323(),
    lookupEmails: async () => new Map(),
    getState: async () => (state[userId] as never) ?? { syncedAt: null, backfillFrom: null, backfillCursor: null, lastError: null },
    setState: async (patch) => { state[userId] = { ...(state[userId] as object), ...patch }; },
    recordings: async () => [],
    onRecordingAttached: async () => {},
    pause: async () => {},
    budgetMs: 40_000,
  });
  const r1 = await syncRepMeetings("u1", "recent", deps("u1"));
  const a = await MS.getMeeting("km-" + ids.a);
  ok(r1.complete && r1.listed === 3 && r1.created === 3 && calls.filter((c) => c.startsWith("list")).length === 2,
    "#323 sync follows next_cursor through every page");
  ok(!!a && a.seenBy.join() === "u1" && a.ownerUserId === "u1" && a.krisp.segments.length === 1 && a.todos.length === 1,
    "#323 a new meeting is created with detail (segments, to-dos) under km-<id>");
  ok(a?.suggestions.find((s) => s.kind === "company")?.id === "osakis", "#323 sync runs the matcher on unfiled meetings");
  ok((await MS.getMeeting("km-" + ids.b))?.noise === true, "#323 a 45 s meeting lands as noise");
  ok(!calls.includes("detail:" + ids.b), "#323 noise meetings skip the detail fetch");
  calls.length = 0;
  await syncRepMeetings("u1", "recent", deps("u1"));
  ok(!calls.some((c) => c.startsWith("detail:")), "#323 a re-sync does not re-fetch detail for meetings that already have notes");
  // a second rep sees the same meeting (shared) → stored once, both in seenBy
  await syncRepMeetings("u2", "recent", { ...deps("u2"), client: { ...deps("u2").client,
    listMeetings: async () => ({ meetings: [listed(ids.a, "Osakis – scope", NOW - 3600_000, 1200, "shared")], nextCursor: null }) } });
  const a2 = await MS.getMeeting("km-" + ids.a);
  ok(a2?.seenBy.sort().join() === "u1,u2" && a2.ownerUserId === "u1", "#323 the same meeting from two reps is one doc; owner stays the owning rep");
  // filed meetings keep links; suggestions frozen
  await MS.patchMeeting("km-" + ids.a, (x) => ({ ...x, filedAt: NOW, links: { ...x.links, customerId: "monte" } }));
  await syncRepMeetings("u1", "recent", deps("u1"));
  ok((await MS.getMeeting("km-" + ids.a))?.links.customerId === "monte", "#323 sync never touches a filed meeting's links");
  // removed from Krisp
  await syncRepMeetings("u1", "recent", { ...deps("u1"), client: { ...deps("u1").client,
    listMeetings: async () => ({ meetings: [listed(ids.a, "Osakis – scope", NOW - 3600_000)], nextCursor: null }) } });
  ok((await MS.getMeeting("km-" + ids.c))?.krisp.removedAt === NOW && !!(await MS.getMeeting("km-" + ids.c)),
    "#323 a meeting gone from Krisp's window is flagged removed, never deleted");
  // 429 ends the batch early, not complete, no throw
  const r429 = await syncRepMeetings("u1", "recent", { ...deps("u1"), client: { ...deps("u1").client,
    listMeetings: async () => { const { KrispRateLimitError } = await import("@/lib/krisp/errors"); throw new KrispRateLimitError("slow down"); } } });
  ok(!r429.complete && r429.error === null, "#323 a 429 ends the batch quietly; next trigger resumes");
  // revoked key
  const r401 = await syncRepMeetings("u1", "recent", { ...deps("u1"), client: { ...deps("u1").client,
    listMeetings: async () => { const { KrispAuthError } = await import("@/lib/krisp/errors"); throw new KrispAuthError("bad key"); } } });
  ok(!!r401.error && (state.u1 as { lastError: string }).lastError === r401.error, "#323 a 401 records meetings_last_error");
  // backfill resumes from the saved cursor
  state.u1 = { syncedAt: NOW, backfillFrom: NOW - 90 * 86_400_000, backfillCursor: "p2", lastError: null };
  calls.length = 0;
  await syncRepMeetings("u1", "backfill", deps("u1"));
  ok(calls[0] === "list:p2" && (state.u1 as { backfillCursor: string | null; backfillFrom: number }).backfillCursor === null &&
     (state.u1 as { backfillFrom: number }).backfillFrom === NOW - 180 * 86_400_000,
    "#323 Load older resumes at the saved cursor, then moves backfillFrom back another 90 days");
  // rematch is pure and leaves filed meetings alone
  const filed = { ...(await MS.getMeeting("km-" + ids.a))! };
  ok(rematchMeeting(filed, index323()).suggestions === filed.suggestions, "#323 rematchMeeting leaves a filed meeting's suggestions as they were");
}
```

Chain `meetings323SyncChecks(ok)`.

- [ ] **Step 4: Run — expect module-not-found for `@/lib/meetings/sync`.**

- [ ] **Step 5: Write `src/lib/meetings/sync.ts`**

```ts
import { deriveSummary } from "@/lib/krisp/derive";
import { KrispAuthError, KrispForbiddenError, KrispNotReadyError, KrispRateLimitError } from "@/lib/krisp/errors";
import type { KrispClient, KrispListQuery, KrispMeetingPage, KrispListedMeeting } from "@/lib/krisp/client";
import { krispPersonFrom } from "@/lib/krisp/client";
import type { KrispNoteBlock, RecordingRecord } from "@/lib/stores/recordings";
import * as MS from "@/lib/stores/meetings";
import { matchMeeting, type MatchIndex } from "./match";
import { mergeAttendees, relabel, resolveAttendees, speakerLabel } from "./render";
import { mergeTodos, suggestTodoKind } from "./todos";
import type { SyncState } from "./sync-state";
import type { MeetingCalendar, MeetingRecord, KrispPerson } from "./types";
import { BACKFILL_STEP_MS, DETAIL_RETRY_MS, ROLLING_WINDOW_MS, SYNC_BUDGET_MS, emptyLinks, meetingIdFor } from "./types";

export type SyncDeps = {
  now: () => number;
  client: Pick<KrispClient, "meeting"> & { listMeetings: (q: KrispListQuery) => Promise<KrispMeetingPage> };
  calendar: (startMs: number, endMs: number) => Promise<MeetingCalendar | null>;
  buildIndex: () => Promise<MatchIndex>;
  lookupEmails: (emails: string[]) => Promise<Map<string, { contactId?: string; userId?: string }>>;
  getState: () => Promise<SyncState>;
  setState: (patch: Partial<SyncState>) => Promise<void>;
  recordings: () => Promise<RecordingRecord[]>;
  onRecordingAttached: (recordingId: string, meetingId: string) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  budgetMs: number;
};

export type SyncResult = { listed: number; created: number; detailed: number; complete: boolean; error: string | null };

const PACE_MS = 220; // ≤ 5 req/s per Krisp account

export function rematchMeeting(m: MeetingRecord, index: MatchIndex): MeetingRecord {
  if (m.filedAt) return m;
  const summaryText = (() => {
    const d = deriveSummary(m.krisp.notes as { blocks: KrispNoteBlock[] } | null);
    return [...d.summary.map((s) => `${s.title} ${s.description}`), ...d.keyPoints].join(" ");
  })();
  const r = matchMeeting({
    title: m.krisp.title, calendarTitle: m.calendar?.title ?? null, summaryText,
    attendees: m.attendees.filter((a) => !a.removed).map((a) => ({ name: a.name, email: a.email })),
    speakerNames: Object.keys(m.krisp.speakers).map((i) => speakerLabel(m, i)),
    startMs: m.krisp.startedAt, endMs: m.krisp.startedAt != null && m.krisp.durationSec != null ? m.krisp.startedAt + m.krisp.durationSec * 1000 : null,
    durationSec: m.krisp.durationSec, ownerUserId: m.ownerUserId,
  }, index);
  return { ...m, suggestions: r.suggestions, noise: m.noiseOverride ? false : r.noise };
}

function blankMeeting(l: KrispListedMeeting, userId: string, now: number): MeetingRecord {
  return {
    id: meetingIdFor(l.id), krispMeetingId: l.id, seenBy: [userId], ownerUserId: userId, recordingId: null,
    krisp: { title: l.title, startedAt: l.startedAt, durationSec: l.durationSec, source: l.source, status: l.status, tags: l.tags,
      participants: l.participants, speakers: {}, segments: [], notes: null, fetchedAt: now, detailFetchedAt: null, removedAt: null },
    calendar: null, attendees: [], speakerMap: {}, links: emptyLinks(), filedAt: null, filedBy: null, suggestions: [],
    noise: false, noiseOverride: false, todos: [], share: null, createdAt: now, updatedAt: now,
  };
}

export async function syncRepMeetings(userId: string, mode: "recent" | "backfill", deps: SyncDeps): Promise<SyncResult> {
  const started = deps.now();
  const res: SyncResult = { listed: 0, created: 0, detailed: 0, complete: false, error: null };
  const st = await deps.getState();
  const now = deps.now();
  const backfillFrom = st.backfillFrom ?? now - BACKFILL_STEP_MS;
  const window = mode === "recent"
    ? { from: now - (st.syncedAt == null ? BACKFILL_STEP_MS : ROLLING_WINDOW_MS), to: null as number | null, cursor: null as string | null }
    : { from: backfillFrom - BACKFILL_STEP_MS, to: backfillFrom, cursor: st.backfillCursor };
  const index = await deps.buildIndex();
  const recs = await deps.recordings();
  const seen = new Set<string>();
  let cursor = window.cursor;
  try {
    for (;;) {
      if (deps.now() - started > deps.budgetMs) {
        if (mode === "backfill") await deps.setState({ backfillCursor: cursor });
        return res;
      }
      const page = await deps.client.listMeetings({ from: new Date(window.from).toISOString(),
        to: window.to ? new Date(window.to).toISOString() : undefined, cursor, limit: 100 });
      await deps.pause(PACE_MS);
      for (const l of page.meetings) {
        res.listed++; seen.add(l.id);
        const id = meetingIdFor(l.id);
        const existing = await MS.getMeeting(id);
        let m: MeetingRecord = existing
          ? { ...existing, krisp: { ...existing.krisp, title: l.title, startedAt: l.startedAt, durationSec: l.durationSec,
              source: l.source, status: l.status, tags: l.tags, participants: l.participants, fetchedAt: now, removedAt: null },
              seenBy: existing.seenBy.includes(userId) ? existing.seenBy : [...existing.seenBy, userId],
              ownerUserId: l.ownership === "owned" && !existing.seenBy.includes(existing.ownerUserId) ? userId : existing.ownerUserId }
          : blankMeeting(l, userId, now);
        if (!existing) res.created++;
        const tooShort = (l.durationSec ?? Infinity) < 180;
        const notesEmpty = !m.krisp.notes || !(m.krisp.notes.blocks || []).length;
        const young = (l.startedAt ?? 0) > now - DETAIL_RETRY_MS;
        if (!tooShort && (!m.krisp.detailFetchedAt || (notesEmpty && young))) {
          try {
            const d = await deps.client.meeting(l.id, ["title", "started_at", "duration", "status", "participants", "transcript", "notes"]);
            await deps.pause(PACE_MS);
            const speakers: Record<string, KrispPerson> = {};
            for (const [k, v] of Object.entries(d.transcript?.speakers || {})) speakers[k] = krispPersonFrom(v as Record<string, unknown>);
            m = { ...m, krisp: { ...m.krisp, speakers,
              segments: (d.transcript?.segments || []).map((s) => ({ speaker: String(s.speaker), text: s.text, start: s.start, end: s.end })),
              notes: (d.notes as { blocks: unknown[] } | null) ?? null, detailFetchedAt: now } };
            res.detailed++;
          } catch (e) {
            if (!(e instanceof KrispNotReadyError)) throw e; // 409 → retry next sync
          }
        }
        if (!m.calendar && m.krisp.startedAt != null && !existing) {
          m.calendar = await deps.calendar(m.krisp.startedAt, m.krisp.startedAt + (m.krisp.durationSec ?? 1800) * 1000);
        }
        const rec = recs.find((r) => r.krisp?.meetingId === l.id);
        if (rec && !m.recordingId) { m = attachRecording(m, rec, now); await deps.onRecordingAttached(rec.id, m.id); }
        m.attendees = resolveAttendees(mergeAttendees(m.attendees, m.krisp.participants, m.calendar),
          await deps.lookupEmails(m.krisp.participants.map((p) => p.email).concat((m.calendar?.attendees || []).map((a) => a.email)).filter((e): e is string => !!e)));
        const pairs: [string, string][] = Object.entries(m.speakerMap).map(([idx, ref]) => [speakerLabel(m, idx), ref.name]);
        const people = { users: index.users.map((u) => ({ id: u.id, name: u.name })),
          contacts: index.contacts.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() })) };
        m.todos = mergeTodos(m.todos, deriveSummary(m.krisp.notes as { blocks: KrispNoteBlock[] } | null).actionItems,
          (a) => suggestTodoKind(a ? relabel(a, pairs) : null, people));
        m = rematchMeeting(m, index);
        await MS.saveMeeting(m);
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch (e) {
    if (e instanceof KrispRateLimitError) {
      if (mode === "backfill") await deps.setState({ backfillCursor: cursor });
      return res;
    }
    if (e instanceof KrispAuthError || e instanceof KrispForbiddenError) {
      res.error = (e as Error).message || "Krisp key rejected";
      await deps.setState({ lastError: res.error });
      return res;
    }
    throw e;
  }
  if (mode === "recent") {
    // flag meetings in this rep's window that Krisp no longer lists
    for (const m of await MS.allMeetings()) {
      if (m.seenBy.includes(userId) && !seen.has(m.krispMeetingId) && (m.krisp.startedAt ?? 0) >= window.from && !m.krisp.removedAt) {
        await MS.patchMeeting(m.id, (x) => ({ ...x, krisp: { ...x.krisp, removedAt: now } }));
      }
    }
    await deps.setState({ syncedAt: now, lastError: null, ...(st.backfillFrom == null ? { backfillFrom: window.from } : {}) });
  } else {
    await deps.setState({ backfillFrom: window.from, backfillCursor: null, lastError: null });
  }
  res.complete = true;
  return res;
}

function attachRecording(m: MeetingRecord, rec: RecordingRecord, now: number): MeetingRecord {
  const links = { ...m.links };
  if (rec.customerId) links.customerId = rec.customerId;
  if (rec.locationId) links.siteId = rec.locationId;
  if (rec.parentKind === "site_visit" || rec.parentKind === "survey" || rec.parentKind === "project" || rec.parentKind === "engagement") {
    links.work = { type: rec.parentKind, id: rec.parentId, label: rec.title || rec.parentId };
  }
  return { ...m, recordingId: rec.id, links, filedAt: m.filedAt ?? now, filedBy: m.filedBy ?? "Recording" };
}
```

Then add the real-deps wrappers at the bottom of the same file:

```ts
import { getKrispConnection, listKrispConnections } from "@/lib/krisp/connections";
import { createKrispClient } from "@/lib/krisp/client";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getEvent, listUpcomingEvents } from "@/lib/google/calendar";
import { contactsByEmails } from "@/lib/identity/lookup";
import { activeUsers } from "@/lib/users";
import { allRecordings, setRecordingMeeting } from "@/lib/stores/recordings";
import { buildMatchIndex } from "./index-build";
import { getSyncState, setSyncState } from "./sync-state";
import { HOME_STALE_MS } from "./types";

async function calendarFor(userId: string, startMs: number, endMs: number): Promise<MeetingCalendar | null> {
  try {
    const key = personalKey(userId);
    const info = await getConnectionInfo(key);
    if (!info || !hasCalendarScope(info.scope)) return null;
    const evs = (await listUpcomingEvents(key, { timeMinMs: startMs - 15 * 60_000, timeMaxMs: endMs + 15 * 60_000, maxResults: 10 }))
      .filter((e) => !e.allDay);
    const overlap = (e: { startMs: number; endMs: number }) => Math.max(0, Math.min(e.endMs, endMs) - Math.max(e.startMs, startMs));
    const best = evs.sort((a, b) => overlap(b) - overlap(a))[0];
    if (!best || overlap(best) <= 0) return null;
    const det = await getEvent(key, best.id);
    return { eventId: best.id, title: det.title || best.title,
      attendees: det.attendees.filter((a) => a.email).map((a) => ({ email: a.email.toLowerCase(), name: a.name || null })) };
  } catch { return null; }
}

async function lookupEmails(emails: string[]): Promise<Map<string, { contactId?: string; userId?: string }>> {
  const out = new Map<string, { contactId?: string; userId?: string }>();
  const lower = [...new Set(emails.map((e) => e.toLowerCase()))];
  const users = await activeUsers();
  for (const e of lower) {
    const u = users.find((x) => x.email.toLowerCase() === e || (x.googleEmail || "").toLowerCase() === e);
    if (u) out.set(e, { userId: u.id });
  }
  const contacts = await contactsByEmails(lower.filter((e) => !out.has(e)));
  for (const [e, r] of contacts) if (r && "contactId" in r) out.set(e.toLowerCase(), { contactId: r.contactId });
  return out;
}

export async function runMeetingsSync(userId: string, mode: "recent" | "backfill" = "recent"): Promise<SyncResult> {
  const conn = await getKrispConnection(userId);
  if (!conn) return { listed: 0, created: 0, detailed: 0, complete: true, error: "Krisp isn't connected" };
  const client = createKrispClient(conn.apiKey);
  const res = await syncRepMeetings(userId, mode, {
    now: Date.now, client, calendar: (s, e) => calendarFor(userId, s, e), buildIndex: buildMatchIndex, lookupEmails,
    getState: async () => (await getSyncState(userId)) ?? { syncedAt: null, backfillFrom: null, backfillCursor: null, lastError: null },
    setState: (p) => setSyncState(userId, p), recordings: allRecordings,
    // keep the recording → meeting back-pointer (spec §Sync step 5)
    onRecordingAttached: (recId, meetingId) => setRecordingMeeting(recId, meetingId),
    pause: (ms) => new Promise((r) => setTimeout(r, ms)), budgetMs: SYNC_BUDGET_MS,
  });
  return res;
}

const lastRun = new Map<string, number>();
export async function syncMeetingsIfStale(userId: string): Promise<SyncResult | null> {
  const st = await getSyncState(userId);
  if (!st) return null;
  const at = Date.now();
  if ((st.syncedAt && at - st.syncedAt < HOME_STALE_MS) || at - (lastRun.get(userId) ?? 0) < HOME_STALE_MS) return null;
  lastRun.set(userId, at);
  return runMeetingsSync(userId, "recent").catch(() => null);
}

export async function syncAllMeetings(): Promise<Record<string, SyncResult>> {
  const out: Record<string, SyncResult> = {};
  for (const c of await listKrispConnections()) {
    out[c.userId] = await runMeetingsSync(c.userId, "recent").catch((e) => ({ listed: 0, created: 0, detailed: 0, complete: false, error: String(e?.message || e) }));
  }
  return out;
}
```

**Check before writing:** (a) add `export async function setRecordingMeeting(id: string, meetingId: string): Promise<void>` to `src/lib/stores/recordings.ts`, implemented with that store's existing patch helper (`patchDoc("recordings", …)` setting only `meetingId`). (b) `RecordingRecord` field names for `customerId`, `locationId`, `parentKind`, `parentId`, `title` — read the type and adapt `attachRecording`. (c) `UserRow.email` — confirm the field name in `src/lib/users.ts`. (d) the error classes' constructor signatures in `src/lib/krisp/errors.ts` — adapt the test's `new KrispRateLimitError(...)` / `new KrispAuthError(...)` calls to them. (e) `deriveSummary` must turn the fixture's `{ type: "action_item", text, assignee }` block into one action item — if `derive.ts` expects a container (`action_items` with `action_item` children), wrap the fixture block that way, per the Krisp docs ("Containers such as `action_items` hold children like `action_item`").

- [ ] **Step 6: Write `src/lib/meetings/index-build.ts`**

```ts
import "server-only";
import { allCompanies } from "@/lib/identity/companies";
import { getAllSites } from "@/lib/identity/sites";
import { allContacts, emailsFor } from "@/lib/identity/contacts";
import { activeUsers } from "@/lib/users";
import { allVisits } from "@/lib/stores/site-visits";
import { getAll as allSurveys } from "@/lib/stores/surveys";
import { open as openLeads } from "@/lib/stores/leads";
import { getAllProjects } from "@/lib/stores/projects";
import { isActive } from "@/lib/pipelines";
import { allEngagements } from "@/lib/stores/engagements";
import { OPEN_ENGAGEMENT_STAGES } from "@/lib/consulting-stages";
import type { MatchIndex, MatchVisit, MatchWork } from "./match";

const INTERNAL_DOMAINS = ["peaksystemsgroup.com"]; // same rule as inbox-identity.ts INTERNAL_DOMAIN

export async function buildMatchIndex(): Promise<MatchIndex> {
  const [companies, sites, contacts, users, visits, surveys, leads, projects, engagements] = await Promise.all([
    allCompanies(), getAllSites(), allContacts(), activeUsers(), allVisits(), allSurveys(), openLeads(), getAllProjects(), allEngagements(),
  ]);
  const userIdByName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u.id]));
  const chicagoDay = (iso: string): [number, number] => {
    const start = new Date(new Date(`${iso}T00:00:00`).toLocaleString("en-US", { timeZone: "America/Chicago" })).getTime();
    return [start, start + 24 * 3600_000];
  };
  const mv: MatchVisit[] = [
    ...visits.filter((v) => v.startAt != null).map((v) => ({
      kind: "site_visit" as const, id: v.id, label: `Site visit ${v.id}`, companyId: v.customerId, siteId: v.locationId,
      startMs: v.startAt!, endMs: v.endAt ?? v.startAt! + 2 * 3600_000, assigneeUserId: userIdByName.get((v.assignedTo || "").trim().toLowerCase()) ?? null })),
    ...surveys.filter((s) => s.scheduledDate).map((s) => {
      const [a, b] = chicagoDay(s.scheduledDate);
      return { kind: "survey" as const, id: s.id, label: `Survey ${s.id}`, companyId: s.customerId, siteId: s.locationId,
        startMs: a, endMs: b, assigneeUserId: userIdByName.get((s.assignedTo || "").trim().toLowerCase()) ?? null };
    }),
  ];
  const work: MatchWork[] = [
    ...leads.filter((l) => l.customerId).map((l) => ({ type: "lead" as const, id: l.id, label: l.title || l.id, companyId: l.customerId! })),
    ...projects.filter((p) => p.customerId && isActive(p)).map((p) => ({ type: "project" as const, id: p.id, label: p.name || p.id, companyId: p.customerId! })),
    ...engagements.filter((e) => e.customerId && OPEN_ENGAGEMENT_STAGES.includes(e.stage)).map((e) => ({ type: "engagement" as const, id: e.id, label: e.name || e.id, companyId: e.customerId! })),
  ];
  const emailMap = await emailsFor(contacts.map((c) => c.id));
  return {
    companies: companies.filter((c) => !c.deleted).map((c) => ({ id: c.id, name: c.name, keywords: c.keywords || [] })),
    sites: sites.filter((s) => !s.deleted).map((s) => ({ id: s.id, companyId: s.companyId, name: s.name, locationName: s.locationName })),
    contacts: contacts.filter((c) => !c.deleted).map((c) => ({ id: c.id, companyId: c.homeCompanyId, firstName: c.firstName || "", lastName: c.lastName || "", emails: emailMap.get(c.id) || [] })),
    users: users.map((u) => ({ id: u.id, name: u.name, emails: [u.email, u.googleEmail].filter((e): e is string => !!e) })),
    internalDomains: INTERNAL_DOMAINS,
    domainCompanies: {}, // filled lazily below
    visits: mv, openWork: work,
  };
}
```

**Check and adapt every field name** (this is the one place that touches eight stores): `SiteVisit.locationId` is a `CustomerLocation.id` — confirm it equals `SiteRow.id` (sites `st-<companyId>-<n>`); if it's a legacy loc id use `getSiteByDocLocId`/`docLocId` to convert. Lead `title`, project `name`/`customerId`, engagement `name`/`customerId`/`stage` field names — read each type. `emailsFor`'s real signature (single id vs. many) — if single, build the map from the `contact_emails` table in one query instead of N calls. `domainCompanies`: build from the `customer_domains` table in one select (`src/db/schema.ts:322`), `{ [domain]: companyIds[] }`, instead of the placeholder `{}` — **do not leave it empty**.

- [ ] **Step 7: Triggers**
  - `src/app/(app)/page.tsx` next to `void reconcileRecordingsIfStale().catch(() => {});` (line ~72): `void syncMeetingsIfStale(user.id).catch(() => {});` (use the page's existing user variable).
  - `src/app/api/gmail/sync/route.ts`: after the `archiveRecordings()` try/catch, add the same shape:
    ```ts
    let meetings: unknown = null;
    try { meetings = await syncAllMeetings(); } catch (e) { meetings = { error: String((e as Error)?.message || e) }; }
    ```
    and include `meetings` in the JSON response.

- [ ] **Step 8: Run tests + tsc**, fix to green. Expected: all `#323` PASS, `ALL PASSED`.

- [ ] **Step 9: Commit** — `git add -A src scripts && git commit -m "feat(meetings): #323 Krisp list API, sync engine, match index, Home + cron triggers"`

---

### Task 5: Mutations — confirm, link, speakers, attendees, to-dos, share

**Files:**
- Create: `src/lib/meetings/actions-core.ts`, `src/app/(app)/inbox/meetings/actions.ts`
- Test: `scripts/test-meetings-323.ts` (`meetings323ActionChecks`)

**Interfaces:**
- Consumes: store (Task 1), visibility (Task 2), render/todos (Task 3), `rematchMeeting`, `buildMatchIndex`, `runMeetingsSync` (Task 4), `createTask` (`src/lib/stores/tasks.ts:370`), `addNoteRecord` (`src/lib/stores/notes.ts:81`), `saveContact` (`src/lib/identity/contacts.ts` — read its signature).
- Produces (all `(…, me: { id: string; name: string })`, all throw `MeetingAccessError` when `!canSeeMeeting`, all return the updated `MeetingRecord`):
  - `confirmSuggestions(id, picks: { kind: SuggestionKind; id: string }[] | "strong", me)` — applies picked suggestions to `links`, sets `filedAt/filedBy`.
  - `confirmAllStrong(ids: string[] | "all-visible", me): Promise<{ filed: number }>`
  - `setLinks(id, patch: Partial<MeetingLinks>, me, opts?: { confirmUnshare?: boolean })` — validates `contactIds.length ≤ 25`; dropping the last external link while `share` is set throws `MeetingShareGuardError` unless `confirmUnshare`, then clears `share`; first external/internal link sets `filedAt`.
  - `setSpeaker(id, idx: string, ref: MeetingPersonRef | null, me)`
  - `addAttendee(id, a: { name: string; email: string | null; contactId?: string; userId?: string }, me)`, `removeAttendee(id, key: string, me)`
  - `decideTodo(id, key: string, kind: TodoKind, opts: { assigneeUserId?: string; dueAt?: number | null }, me)` — requires `filedAt`; idempotent on `decision.createdId`.
  - `decideAllTodos(id, me)` — applies each undecided to-do's `suggested`.
  - `shareWithCustomer(id, summary: string, me)` (requires `links.customerId`; trims, ≤ 8000 chars), `stopSharing(id, me)`
  - `setNoise(id, noise: boolean, me)` — `noiseOverride = !noise`; reruns match.
  - `refreshFromKrisp(id, me)` — clears `krisp.detailFetchedAt` then `runMeetingsSync(me.id, "recent")`.
  - `export class MeetingAccessError extends Error {}`, `export class MeetingShareGuardError extends Error {}`

- [ ] **Step 1: Failing tests** — append `meetings323ActionChecks(ok)` covering, each with a fixture meeting (`registerFixture("meetings", …)`, and `registerFixture("tasks", id)` / `registerFixture("notes", id)` for created records):
  1. `confirmSuggestions(id, "strong", me)` applies only strong suggestions and sets `filedAt`; a weak-only meeting is unchanged by `confirmAllStrong`.
  2. Outsider (`me.id` not in `seenBy`) calling any action on a private meeting → `MeetingAccessError`.
  3. `setLinks` with 26 contact ids → throws; with an internal user only → scope `internal`.
  4. Share guard: link company → `shareWithCustomer` → `setLinks(id, { customerId: null })` throws `MeetingShareGuardError`; with `{ confirmUnshare: true }` succeeds and `share === null`.
  5. `shareWithCustomer` on a meeting with no `customerId` throws.
  6. `decideTodo(…, "task")` creates one task with `meetingId`, `customerId`, `siteId`, `leadId` (from a lead work link), `assigneeUserId`; calling it again returns the same `createdId` and creates no second task (`allTasks` count unchanged — use `src/lib/stores/tasks.ts`'s list function).
  7. `decideTodo(…, "waiting")` → task with `waitingOn.name === "Tom Ellis"`, `assigneeUserId === me.id`, `dueAt` = due date or `now + 7 days`.
  8. `decideTodo(…, "note")` on a venue-linked meeting → note `parentKind === "site"`.
  9. `decideTodo` on an unfiled meeting → throws.
  10. `setSpeaker(id, "2", { contactId: "c-tom", name: "Tom Ellis" })` → `renderMeeting` shows "Tom Ellis"; `setSpeaker(id, "2", null)` clears it.
  11. `removeAttendee` sets `removed: true` (doesn't delete); a later sync merge keeps it removed (call `mergeAttendees` on the result).

Write each as a concrete `ok(...)` like Tasks 2–4 (fixture `me = { id: "u1", name: "Jeff Chesebro" }`).

- [ ] **Step 2: Run — expect module-not-found.**

- [ ] **Step 3: Implement `actions-core.ts`.** Core helper:

```ts
async function mutate(id: string, me: { id: string; name: string }, fn: (m: MeetingRecord) => MeetingRecord | Promise<MeetingRecord>): Promise<MeetingRecord> {
  const cur = await MS.getMeeting(id);
  if (!cur || !canSeeMeeting(cur, me.id)) throw new MeetingAccessError("Meeting not found");
  const next = await fn(cur);
  return MS.saveMeeting({ ...next, updatedAt: Date.now() });
}
```

`confirmSuggestions` maps picks → links: `company` → `customerId`; `venue` → `siteId`; `contact` → push to `contactIds` (dedupe, cap 25); `work` → `{ type: s.workType!, id, label }`; `internal` → push to `internalUserIds`. When a picked company differs from an already-set `customerId`, replace it and clear `siteId`/`work` that belonged to the old company. Set `filedAt ??= now`, `filedBy ??= me.name`.

`decideTodo`:
```ts
const todo = m.todos.find((t) => t.key === key);
if (!todo) throw new Error("To-do not found");
if (todo.decision?.createdId) return m; // idempotent
if (!m.filedAt) throw new Error("File the meeting before its to-dos");
let createdId: string | null = null;
const base = { customerId: m.links.customerId, siteId: m.links.siteId, contactIds: m.links.contactIds,
  leadId: m.links.work?.type === "lead" ? m.links.work.id : null,
  projectId: m.links.work?.type === "project" ? m.links.work.id : null,
  engagementId: m.links.work?.type === "engagement" ? m.links.work.id : null, meetingId: m.id };
const due = opts.dueAt !== undefined ? opts.dueAt : todo.dueDate ? Date.parse(todo.dueDate + "T17:00:00") : null;
if (kind === "task") {
  const t = await createTask({ title: todo.title, ...base, assigneeUserId: opts.assigneeUserId ?? null,
    assigneeName: opts.assigneeUserId ? (await userName(opts.assigneeUserId)) : "", dueAt: due, notes: `From meeting: ${m.krisp.title}` }, me);
  createdId = t.id;
} else if (kind === "waiting") {
  const t = await createTask({ title: todo.title, ...base, assigneeUserId: me.id, assigneeName: me.name,
    dueAt: due ?? Date.now() + 7 * 86_400_000, waitingOn: { contactId: waitingContactId(m, todo), name: todo.assigneeLabel || "Customer" },
    notes: `Waiting on customer — from meeting: ${m.krisp.title}` }, me);
  createdId = t.id;
} else if (kind === "note") {
  const parent = noteParentFor(m.links);
  if (!parent) throw new Error("Link the meeting to a company or venue first");
  const n = await addNoteRecord({ ...parent, customerId: m.links.customerId, text: `${todo.title}\n\nFrom meeting: ${m.krisp.title}` }, me.name);
  createdId = n.id;
}
return { ...m, todos: m.todos.map((t) => t.key === key ? { ...t, decision: { kind, createdId, decidedAt: Date.now(), decidedBy: me.name } } : t) };
```

`assigneeUserId` default when the caller passes none for `task`: resolve `todo.assigneeLabel` (after the speaker map) with `matchAssignee` from `src/lib/krisp/derive.ts` against `activeUsers()`. `waitingContactId`: the attendee/speaker-mapped contact whose name matches the label, else `null`.

- [ ] **Step 4: `"use server"` wrappers** — `src/app/(app)/inbox/meetings/actions.ts`: one exported async function per core function, each `const me = await requireUser();` → call core with `{ id: me.id, name: me.name }` → `revalidatePath("/inbox")` (and the linked record paths: `/companies/${customerId}`, `/venues/${siteId}`) → return `{ ok: true } | { ok: false, error: string }` (catch errors to strings; the share-guard error returns `{ ok: false, needsConfirm: true }`). Plus:
  - `syncNowAction()` → `runMeetingsSync(me.id, "recent")`
  - `loadOlderAction()` → `runMeetingsSync(me.id, "backfill")`
  - `meetingsTickAction()` → `syncMeetingsIfStale(me.id)`, returns `{ changed: boolean }` (`created > 0 || detailed > 0`).
  - `newContactFromAttendeeAction(meetingId, key, companyId)` → create a contact (read `saveContact`'s signature in `src/lib/identity/contacts.ts`; also write its email via the existing `setEmails`), then set the attendee's `contactId`. Requires `create` permission (`can("create", me.roles)` from `src/lib/team.ts`).
  - `shareWithCustomerAction` requires `create`.

- [ ] **Step 5: Run tests + tsc**, fix to green.

- [ ] **Step 6: Commit** — `git commit -m "feat(meetings): #323 confirm/link/speaker/attendee/to-do/share mutations"`

---

### Task 6: Inbox Meetings box + reader

**Files:**
- Create: `src/app/(app)/inbox/meetings/load.ts`, `meetings-box.tsx`, `meeting-reader.tsx`
- Modify: `src/app/(app)/inbox/inbox-shell.tsx:60-67` (BOX_SEL_OPTIONS) and its 3-min tick (~625-662), `src/app/(app)/inbox/page.tsx` (view parsing ~229-236, views array ~431-468, list title ~564-576, render branch)
- Test: `scripts/test-meetings-323.ts` (`meetings323UiPins` — source pins), `scripts/smoke-routes.ts` (add `/inbox?view=meetings`)

**Interfaces:**
- Consumes: Task 5 actions; `meetingsVisibleTo`, `renderMeeting`, `meetingScope`; `searchLinkTargetsAction` (`src/app/(app)/inbox/link-popup-actions.ts:268`) for manual linking.
- Produces: `loadMeetingsBox(me, tab: "to-file" | "filed" | "noise"): Promise<MeetingsBoxVM>`, `loadMeetingReader(me, id): Promise<MeetingReaderVM | null>`, `toFileCount(userId): Promise<number>` (exported from `load.ts`; Home uses it in Task 7).

- [ ] **Step 1: Pins first** (source assertions, the house pattern for UI): append `meetings323UiPins(ok)` reading files with `fs.readFileSync` and asserting:
  - `inbox-shell.tsx` has `{ value: "meetings", label: "Meetings" }` in `BOX_SEL_OPTIONS`;
  - `page.tsx` accepts `"meetings"` as a view and renders `<MeetingsBox` for it, never mixing meetings into `threadsIn`;
  - `meetings-box.tsx` contains the tab labels `To file`, `Filed`, `Noise`, the sections `This week` / `Older`, buttons `Confirm all`, `Sync now`, `Load older`;
  - `meeting-reader.tsx` contains `Open in Krisp`, `Refresh from Krisp`, `Attendees`, `Speakers`, `+ New contact`, `To-dos`, `Transcript`, `Share with customer`, `Stop sharing`;
  - `load.ts` imports `canSeeMeeting` or `meetingsVisibleTo` (every read is visibility-filtered);
  - the tick calls `meetingsTickAction` only when `view === "meetings"`.

- [ ] **Step 2: `load.ts`** (`import "server-only"`):
  - `toFileCount(userId)` = visible meetings where `!filedAt && !noise && seenBy.includes(userId)`.
  - `loadMeetingsBox` → rows `{ id, title, startedAt, durationSec, source, scope: MeetingScope, top: MeetingSuggestion | null, strongCount, removed: boolean }`; To file = `!filedAt && !noise`, split into `thisWeek` (startedAt ≥ now − 7 d) / `older`; Filed = `filedAt` (newest first, cap 200); Noise = `noise && !filedAt`. Plus `sync: { syncedAt, lastError, backfillFrom, connected }` from `getSyncState` + `getKrispConnectionInfo`.
  - `loadMeetingReader` → `renderMeeting(m, names)` where `names.contact`/`names.user` come from one `allContacts()`/`activeUsers()` read; link labels resolved (company name, venue name, contact names, work label, internal user names) with `"(removed)"` for dead ids; `krispUrl = krispMeetingUrl(m.krispMeetingId)` (`src/lib/krisp/client.ts:280`); `canShare` = `can("create", me.roles) && !!m.links.customerId`.

- [ ] **Step 3: `meetings-box.tsx`** (`"use client"`): props `{ vm: MeetingsBoxVM; selectedId: string | null; tab }`. Tabs as links `/inbox?view=meetings&tab=…`; row click → `?view=meetings&tab=…&m=<id>`. Scope icon text: 🔒 `Only you` · 👥 `Internal` · 🏢 `All of Peak` · 🌐 `Shared with customer` (title attribute = the words). Suggestion chip: strong = solid `pk-chip` with `var(--accent)` border, weak = outline. **Confirm all** calls `confirmAllStrongAction("to-file")` then `router.refresh()`; disabled when no row has a strong suggestion. Header shows `Synced 4 min ago` / last error, **Sync now**, **Load older**. Reuse existing inbox list styles (`inbox-shell.tsx` list classes) so it looks native — read the existing list markup and copy its class names.

- [ ] **Step 4: `meeting-reader.tsx`** (`"use client"`): props `{ vm: MeetingReaderVM }`. Sections in order: header (title, date/time, length, source, **Open in Krisp** `target="_blank" rel="noreferrer"`, **Refresh from Krisp**); **Attendees** (name, email, source badges `Krisp`/`Calendar`/`Added`, resolved name or **+ New contact** (company picker defaulting to the linked/suggested company), ✕ remove, "+ Add attendee" with name/email); **Speakers** (`Speaker 2 → [select: attendees + "Search…"]`); **Summary** + **Key points**; **To-dos** (per row: title, owner, due, kind select Task/Waiting on customer/Note/Dismiss defaulting to `suggested`, Task shows an assignee select of active users, **Confirm**; header **Confirm all to-dos**; disabled with hint "File the meeting first" until filed; decided rows show what they became with a link); **Transcript** (`<details>` collapsed, `speakerName: text`).
  Sidebar (right column, same layout as the email reader sidebar — read `inbox/reader-sidebar*.tsx` or the #240 sidebar and mirror its structure): **Suggested** list (chip + reasons + **Confirm**; "Confirm suggestions" applies all), **Linked** (company, venue, people, work, internal — each with ✕), **+ Link** search using `searchLinkTargetsAction` (company/venue/person), a work picker (type select + id search over that company's leads / site visits / surveys / projects / engagements / quotes — load the options server-side in `loadMeetingReader` for the linked company), internal people multi-select, **Mark as noise / Not noise**, and **Share with customer…** (modal with a textarea prefilled from the rendered summary + key points; **Share**) / **Stop sharing**. Unlinking the last external link when shared → `confirm("This stops sharing it with the customer. Continue?")` then retry with `confirmUnshare`.

- [ ] **Step 5: Wire the page.** `page.tsx`: add `"meetings"` to the accepted views; in the views array add `{ key: "meetings", label: "Meetings", active: view === "meetings", count: await toFileCount(me.id), href: viewHref("meetings"), icon: "calls" }` (pick an existing icon key); when `view === "meetings"` skip thread loading and render `<MeetingsBox …/>` in the list column and `<MeetingReader …/>` in the reader column (or an empty-state "Pick a meeting" panel). `inbox-shell.tsx`: add the `BOX_SEL_OPTIONS` entry; in the tick, call `meetingsTickAction()` instead of `autoSyncAction()` while the meetings view is open.

- [ ] **Step 6: Smoke route** — add `/inbox?view=meetings` to `scripts/smoke-routes.ts` next to the other inbox routes.

- [ ] **Step 7: Run gates** — tsc, test:specs, and `npm run lint 2>&1 | tail -3` (compare to the baseline count on origin/main — per memory, `npm run lint` may crash on the harness file; if so run `npx eslint src/app/\(app\)/inbox/meetings src/lib/meetings src/components/meetings`).

- [ ] **Step 8: Browser check** on a scratch datadir (never `.data/pglite`): seed three meetings via a short tsx script **that exits**, start the dev server with `PGLITE_PATH=<scratch>`, open `/inbox?view=meetings`, confirm one, map a speaker, decide a to-do; screenshot. Stop the dev server after.

- [ ] **Step 9: Commit** — `git commit -m "feat(meetings): #323 Inbox Meetings box, reader and link sidebar"`

---

### Task 7: Everywhere else — Home, record cards, ⌘K, Account, feed, waiting-on-customer, portal

**Files:**
- Create: `src/components/meetings/meetings-card.tsx`, `src/app/portal/meetings/page.tsx`
- Modify: `src/app/(app)/page.tsx` (Home to-file count), `src/app/(app)/companies/[id]/page.tsx` (card ~874; feed rows ~127/259), `src/app/(app)/venues/[id]/page.tsx` (~353), `src/app/(app)/people/[id]/page.tsx` (~234), the lead drawer / site-visit / survey (`src/app/(app)/venue-assessments/[id]/`), project and engagement pages (wherever `RecordingsCard` mounts), `src/app/api/search/route.ts` (~237), `src/app/(app)/account/krisp-card.tsx` + `account/page.tsx:67-74`, `src/lib/customer-feed.ts:38`, `src/app/portal/nav.ts`, Home to-do list grouping (find where Home renders open tasks: `grep -rn "assigneeUserId" src/app/\(app\)/page.tsx src/components/home`)
- Test: `meetings323EverywherePins` + one DB check for the portal filter

**Interfaces:**
- Consumes: `meetingsLinkedTo`, `toFileCount`, `portalCanSee`, `renderMeeting`.
- Produces: `<MeetingsCard kind="company"|"venue"|"contact"|"work" id={…} viewerId={…} title?="Meetings" />` (server component); `portalMeetings(customerId): Promise<{ id; title; startedAt; summary }[]>` in `src/lib/meetings/portal.ts`.

- [ ] **Step 1: Pins + portal check (failing).** Pins: Home page imports `toFileCount` and links `/inbox?view=meetings`; `MeetingsCard` is mounted on companies, venues, people, site-visit/survey, project, engagement pages; `search/route.ts` has a `"Meetings"` group filtered with `canSeeMeeting`; `krisp-card.tsx` shows `Sync now` and `Load older`; `portal/nav.ts` has `Meeting notes`; `portal/meetings/page.tsx` calls `portalSession()` and `portalMeetings` and never renders `segments`/`attendees`/`todos`. DB check: two fixture meetings linked to `TEST323-co`, one shared → `portalMeetings("TEST323-co")` returns exactly the shared one with `summary === share.summary`; `portalMeetings("other")` → `[]`.

- [ ] **Step 2: `MeetingsCard`** — server component: `meetingsLinkedTo(kind, id, viewerId)` (cap 8, newest first), rows "date · title · length", link `/inbox?view=meetings&tab=filed&m=<id>`; renders nothing when empty. Use the same card chrome as `CustomerRecordingsCard` (`src/components/recordings/recordings-card.tsx:131`) — copy its wrapper markup.

- [ ] **Step 3: Mount it** on each page listed above (company: right column under the Recordings card; venue: after `DocumentsCard`; person: before the Record card; survey/site visit: beside its `RecordingsCard`; project + engagement: beside `RecordingsCard`). Each page already has the signed-in user — pass `viewerId={user.id}`.

- [ ] **Step 4: Customer feed.** In `src/lib/customer-feed.ts` `loadCustomerFeed`, add rows for `meetingsLinkedTo("company", id, viewerId)` — this needs the viewer: add an optional `viewerId` param to `loadCustomerFeed` and pass it from the company page. Row shape = the feed's existing row type, text `Met with <first two attendee display names> — <title>`, href to the reader, kind/icon of the existing "meeting" channel (`comms.ts:109` `verb: "Met with"`). No summary text copied.

- [ ] **Step 5: ⌘K.** In `src/app/api/search/route.ts`, load `allMeetings()` once (it's small), filter `canSeeMeeting(m, me.id)` and `matches(q, m.krisp.title, renderedSummaryText)` (render with a no-op names resolver for speed: `{ contact: () => null, user: () => null }`), add group `"Meetings"` with `href: /inbox?view=meetings&m=<id>`, `letter: "M"`, `color: "#6b4fa1"`. Read how the route gets the current user and reuse it.

- [ ] **Step 6: Account card.** Extend `KrispCardInfo` with `meetings: { syncedAt: number | null; lastError: string | null; backfillFrom: number | null }`; render "Meetings synced <relative time>" or the last error, **Sync now** (`syncNowAction`), **Load older** (`loadOlderAction`, label shows "Pulled back to <date>"). Populate in `account/page.tsx` from `getSyncState(user.id)`.

- [ ] **Step 7: Waiting on customer.** Company and venue pages: a "Waiting on customer" list = open tasks with `waitingOn` and matching `customerId` / `siteId` (title, who owes it, nudge date, link to the meeting). Home to-do list: tasks with `waitingOn` render in a separate **Waiting on others** group, not mixed with the rep's own to-dos.

- [ ] **Step 8: Portal.** `src/lib/meetings/portal.ts`:
  ```ts
  import "server-only";
  import { allMeetings } from "@/lib/stores/meetings";
  import { portalCanSee } from "./visibility";
  export async function portalMeetings(customerId: string) {
    return (await allMeetings()).filter((m) => portalCanSee(m, customerId))
      .map((m) => ({ id: m.id, title: m.krisp.title, startedAt: m.krisp.startedAt, summary: m.share!.summary }));
  }
  ```
  `src/app/portal/meetings/page.tsx`: `const s = await portalSession(); if (!s) redirect("/portal/login")` (copy the redirect used by `src/app/portal/my-quotes/page.tsx`), list title/date/summary (summary as preformatted paragraphs). Add `{ href: "/portal/meetings" + pv, label: "Meeting notes", active: active === "meetings" }` to `portalNav` (widen the `active` union) — show it only when there's at least one shared meeting is NOT required; always show it.

- [ ] **Step 9: Home count.** `src/app/(app)/page.tsx`: `const meetingsToFile = await toFileCount(user.id);` and render `"N meetings to file →"` linking `/inbox?view=meetings` when N > 0, in the same area as the existing Home queue/agenda counters (read the page and mirror an existing counter's markup).

- [ ] **Step 10: Gates** — tsc, test:specs, smoke (stop any dev server first), eslint on touched paths, `npx next build` (catches client components importing server stores — memory: tsc+specs pass while a `"use client"` file pulls postgres). Commit: `git commit -m "feat(meetings): #323 Home count, record cards, search, Account sync, feed, waiting-on-customer, portal notes"`

---

### Task 8: Docs + final gates

**Files:**
- Modify: `DECISIONS.md` (append a "#323 Krisp meeting matcher" entry block with K1–K13 as `D-TBD`), `PUNCHLIST.md` (add `#323` with shipped summary + Jeff-gated follow-ups), `AGENTS.md` phase status (new item 43 summarising #323), `QUESTIONS.md` (open questions below), `DEPLOY.md` (none needed — no new env vars; state that explicitly in the PUNCHLIST entry)

- [ ] **Step 1: DECISIONS.md** — one entry per K1–K13 from the spec's decision table, each 2–4 lines, headed `- **D-TBD (#323 K<n>). <title>**`, plus the implementation defaults taken during the build (rolling 14-day window because the list has no last-modified; name-core generic word list; scoring numbers; work-link priority; note-parent priority; Krisp refresh never touches filed links; dead links never re-privatise).

- [ ] **Step 2: PUNCHLIST.md** — `#323 Krisp meeting matcher` ✅ with Jeff-gated: (1) after merge, open `/inbox?view=meetings` on production with his Krisp key connected and press **Sync now**; (2) check that Krisp desktop auto-recorded meetings list with participants (the docs don't say); (3) review the first week of suggestions and send mis-matches; (4) follow-ups: Krisp calling, portal request list from Waiting-on-customer, Meetings as its own nav page, Krisp folders/tags as signals, sub-project 1 (site-visit question loop).

- [ ] **Step 3: QUESTIONS.md** — "Should a meeting shared with the customer also show to other grants at that customer (all their portal users) — currently yes, any grant for that customerId." and "Is 3 minutes the right noise cut-off?"

- [ ] **Step 4: Final gates with real numbers** (memory: Jeff expects tsc, test:specs, test:smoke, eslint vs a baseline, reported with counts). Run each, record PASS counts (`grep -c "^PASS"`), FAIL count, smoke result, eslint error count vs `origin/main`, `next build` exit code.

- [ ] **Step 5: Commit** — `git commit -m "docs: #323 Krisp meeting matcher — decisions, punchlist, phase status"`
