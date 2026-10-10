# Morning Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each rep opens Home and sees one ranked "Start here" list (top 10, "See more" → `/triage`) built from seven feeds, every row showing its source, its reason, and — for a call to-do — the transcript line it came from.

**Architecture:** Pure modules under `src/lib/triage/` (clock, text, keys, rank, transcript match, dedupe, view rules, liveness rules) plus one module per feed under `src/lib/triage/feeds/` (a pure `select*` function and a thin `load`). A per-user, per-slot snapshot (`triage_snapshots`) is built by the existing daily Gmail cron (morning), a new `/api/triage/build` cron (midday) and lazily on the first Home view; per-user Done / Snooze / Dismiss marks live in `triage_marks`. Specs 1–3 (drive time, visit attendees, auto task calendar) are optional inputs read through one hooks object and defensive field reads, so this builds and works without them.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle doc-store on Postgres/PGlite, the `scripts/test-review-and-spec.ts` spec harness.

**Spec:** `docs/superpowers/specs/2026-10-09-morning-triage-design.md`

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app-triage` (branch `feat/morning-triage`). Never touch `/Users/sm/Downloads/peak-app` or any `.data/` directory. Never run a `tsx` db/seed script or a dev server; `npm run test:specs`, `npm run test:smoke` and `npm run build` are the only things that open a database, and each uses its own scratch datadir.
- Before any gate, confirm `node_modules` is real: `test -x node_modules/.bin/tsc && test -x node_modules/.bin/next || echo "run npm ci first"` (a missing `node_modules` makes `npx tsc` a fake that exits 0). If `npm ci` is still running, wait for it.
- `npm run test:specs` leaves a `tmp.*` datadir in `$TMPDIR`; if `df -h $TMPDIR` shows < 5 GB free, delete old `tmp.*` dirs there before running again.
- Gates per task: `npx tsc --noEmit` (0 errors), `env -u DATABASE_URL npm run test:specs` (ends `ALL PASSED`), `npx eslint --ignore-pattern scripts/test-review-and-spec.ts <changed files>` (0 errors). Tasks 9, 10 and 11 also run `env -u DATABASE_URL npm run build`; Task 11 also runs `npm run test:smoke`.
- Deterministic — no AI (D89). No Anthropic key, no model calls.
- Business days = Mon–Fri, `America/Chicago`. Timestamps are epoch-ms numbers.
- "Waiting" email = unanswered customer message ≥ 1 business day (weekends excluded); younger ones still appear, ranked lower.
- Slots: `morning` (7:00 Central) and `midday` (12:00 Central); snapshot key `<userId>:<YYYY-MM-DD>:<slot>`; marks key `<userId>:<itemKey>`.
- Candidate keys: `email:<threadId>`, `call:<recordingId>:<itemKey>`, `task:<id>`, `asg:<id>`, `lead:<id>`, `visit:<id>`, `quote:<id>`, `renewal:<kind>:<id>`.
- Home list shows the top **10**; "See more" opens `/triage`.
- Failure copy, verbatim: `<Feed> couldn't be read — list may be incomplete`; unmatched call line: `Source line not found — open the meeting`; collapsed duplicate: `Also mentioned in <meeting> (<date>)`.
- Specs 1–3 are NOT on this branch: read `attendees` only as `v.attendees ?? []`, a visit's lead is `assignedTo`, a task's tier only if `priority` is present, and at-risk / visit flags only through `TRIAGE_HOOKS` (default: none).
- The Krisp #323 "meetings" collection is NOT on main: the calls feed reads `src/lib/stores/recordings.ts` behind a `CallTodoSource` interface.
- `'use client'` files may import only types, or values from pure modules (`@/lib/triage/types`, `@/lib/triage/transcript-match`, `@/lib/triage/text`). Never a store, `@/db`, `service.ts`, `store.ts`, `liveness.ts`, `build.ts` or a feed.
- `requireUser()` first in every server action and server page. Admin (may view a teammate's list) = `manage_users` permission (`can("manage_users", roles)`).
- Do not assign Decision (D) or punch (#) numbers until Task 11.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

---

## File Structure

**Pure (client-safe, no store/db imports):**
- `src/lib/triage/types.ts` — shared shapes, `SOURCE_LABEL`, `FEED_LABEL`, `feedErrorMessage`.
- `src/lib/triage/keys.ts` — candidate key builders + `parseTriageKey`.
- `src/lib/triage/clock.ts` — Chicago day/slot math, business time, labels.
- `src/lib/triage/text.ts` — stopwords, `tokens`, `normalizedTitle`.
- `src/lib/triage/rank.ts` — points table, fact labels, score, reason, ordering.
- `src/lib/triage/transcript-match.ts` — best transcript segment for a to-do.
- `src/lib/triage/dedupe.ts` — collapse duplicate call to-dos.
- `src/lib/triage/view.ts` — which snapshot rows a mark hides.
- `src/lib/triage/hooks.ts` — optional at-risk / visit-flag providers (specs 1–3 seam).
- `src/lib/triage/cron.ts` — cron auth + slot param.
- `src/lib/triage/actions-plan.ts` — what "Done" does per key.
- `src/lib/recording-deep-link.ts` — `?tab=&seg=` parsing for `/recordings/[id]`.

**Server:**
- `src/lib/triage/feeds/context.ts` — `FeedCtx`, `FeedResult`, `TriageFeed`.
- `src/lib/triage/feeds/{email,tasks,leads,visits,quotes,renewals,calls}.ts` — one per source.
- `src/lib/triage/feeds/index.ts` — `FEEDS`.
- `src/lib/triage/build.ts` — gather (fail-soft) → dedupe → rank → rows.
- `src/lib/triage/liveness.ts` — rows whose source is now done.
- `src/lib/triage/store.ts` — snapshot + mark persistence.
- `src/lib/triage/service.ts` — lazy build, cron build, the view.
- `src/app/api/triage/build/route.ts` — midday cron.
- `src/app/(app)/triage/actions.ts`, `src/app/(app)/triage/page.tsx`.
- `src/components/triage/triage-rows.tsx` (`'use client'`), `src/components/triage/start-here-card.tsx` (server).

**Modified:** `src/db/doc-tables.ts`, `drizzle/0036_triage.sql` (+ meta), `src/lib/queue.ts` (export `assignmentHref`), `src/app/api/gmail/sync/route.ts`, `vercel.json`, `src/middleware.ts`, `src/components/nav/nav-data.ts`, `scripts/smoke-routes.ts`, `src/app/(app)/page.tsx`, `src/app/(app)/recordings/[id]/page.tsx`, `src/app/(app)/recordings/[id]/detail-client.tsx`, `scripts/test-review-and-spec.ts` (import + chain lines only).

**Tests:** `scripts/test-morning-triage.ts` (new module; each export takes the harness's `ok`), chained from `scripts/test-review-and-spec.ts`.

---

### Task 1: Foundation — collections, migration, clock, text, keys, types

**Files:**
- Create: `src/lib/triage/types.ts`, `src/lib/triage/keys.ts`, `src/lib/triage/clock.ts`, `src/lib/triage/text.ts`, `drizzle/0036_triage.sql` (generated, then hardened), `scripts/test-morning-triage.ts`
- Modify: `src/db/doc-tables.ts` (two `docTable` lines + two `DOC_TABLES` entries), `drizzle/meta/_journal.json` + `drizzle/meta/0036_snapshot.json` (generated), `scripts/test-review-and-spec.ts` (one import line above `seeded()`, one `.then` line)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts`: `TRIAGE_SOURCES`, `type TriageSource = "email"|"call"|"task"|"assignment"|"lead"|"visit"|"quote"|"renewal"`, `SOURCE_LABEL: Record<TriageSource,string>`, `FEED_LABEL`, `feedErrorMessage(source): string`, `type TriageFact` (union below), `type CallLine`, `type TriageCandidate`, `type RankedCandidate`, `type SnapshotRow`, `type Slot = "morning"|"midday"`, `type FeedError`, `type TriageSnapshot`, `type MarkKind`, `type TriageMark`, `type TriageUser = { id; name; canApprove }`.
  - `keys.ts`: `triageKey.{email,call,task,assignment,lead,visit,quote,renewal}`, `RENEWAL_KINDS`, `type ParsedTriageKey = { source; id; part? }`, `parseTriageKey(key): ParsedTriageKey | null`.
  - `clock.ts`: `TRIAGE_TZ`, `chicagoParts(ms)`, `dayKey(ms)`, `chicagoMidnight(ms)`, `nextDayKey(day)`, `dayDiff(a,b)`, `businessMsBetween(from,to)`, `businessDaysBetween(from,to)`, `MIDDAY_HOUR`, `slotAt(ms): { day; slot }`, `slotLabel(slot)`, `snapshotId(userId, day, slot)`, `slotOrdinal(day, slot)`, `nextMorning(day)`, `chicagoTime(ms)`, `chicagoShortDate(ms)`.
  - `text.ts`: `STOPWORDS`, `tokens(s): string[]`, `normalizedTitle(s): string`.
  - Collections `"triage_snapshots"`, `"triage_marks"` in `CollectionName`.
  - Test module exports `type Ok`, constants `ME`, `H`, `D`, `MON_10`, `MON_12`, `TUE_8`, `THU_9`, `FRI_9`, `FRI_15`, `SAT_12`, and `triageFoundationChecks(ok)`.

- [ ] **Step 1: Write the failing test module**

Create `scripts/test-morning-triage.ts`:

```ts
/**
 * Morning triage — spec checks (docs/superpowers/specs/2026-10-09-morning-triage-design.md).
 *
 * Chained from scripts/test-review-and-spec.ts; every export takes the
 * harness's `ok` so PASS/FAIL counting stays in one place. It only ever runs
 * inside `npm run test:specs` (a scratch PGlite datadir) — never import it
 * from anywhere else. DB rows it writes use fixtureId("TRIAGE", …) ids and are
 * registered for the harness teardown.
 */
import { readFileSync, readdirSync } from "node:fs";
import { DOC_TABLES, SYNCABLE_COLLECTIONS } from "@/db/doc-tables";
import { CONFIG_COLLECTIONS, DEMO_COLLECTIONS } from "@/db/seed-data";
import {
  businessDaysBetween,
  businessMsBetween,
  chicagoMidnight,
  chicagoShortDate,
  chicagoTime,
  dayDiff,
  dayKey,
  nextDayKey,
  nextMorning,
  slotAt,
  slotOrdinal,
  snapshotId,
} from "@/lib/triage/clock";
import { normalizedTitle, tokens } from "@/lib/triage/text";
import { parseTriageKey, triageKey } from "@/lib/triage/keys";
import { feedErrorMessage } from "@/lib/triage/types";

export type Ok = (cond: boolean, msg: string) => void;

export const H = 3_600_000;
export const D = 86_400_000;
/** Mon 12 Oct 2026 10:00 CDT (UTC−5). */
export const MON_10 = Date.UTC(2026, 9, 12, 15, 0);
/** Mon 12 Oct 2026 12:00 CDT — the midday boundary. */
export const MON_12 = Date.UTC(2026, 9, 12, 17, 0);
/** Tue 13 Oct 2026 08:00 CDT. */
export const TUE_8 = Date.UTC(2026, 9, 13, 13, 0);
/** Thu 8 Oct 09:00, Fri 9 Oct 09:00 / 15:00, Sat 10 Oct 12:00 — all CDT. */
export const THU_9 = Date.UTC(2026, 9, 8, 14, 0);
export const FRI_9 = Date.UTC(2026, 9, 9, 14, 0);
export const FRI_15 = Date.UTC(2026, 9, 9, 20, 0);
export const SAT_12 = Date.UTC(2026, 9, 10, 17, 0);

export const ME = { id: "u-tri", name: "Dana Tester", canApprove: false };

export async function triageFoundationChecks(ok: Ok): Promise<void> {
  /* ---- wiring ---- */
  ok("triage_snapshots" in DOC_TABLES && "triage_marks" in DOC_TABLES, "triage wiring: both collections are registered doc tables");
  ok(
    !SYNCABLE_COLLECTIONS.includes("triage_snapshots" as never) && !SYNCABLE_COLLECTIONS.includes("triage_marks" as never),
    "triage wiring: neither collection is writable through /api/sync/push"
  );
  ok(
    DEMO_COLLECTIONS.includes("triage_snapshots" as never) &&
      DEMO_COLLECTIONS.includes("triage_marks" as never) &&
      !CONFIG_COLLECTIONS.includes("triage_marks" as never),
    "triage wiring: the go-live reset wipes both (derived, per-user state)"
  );
  const migFile = readdirSync("drizzle").find((f) => /^\d{4}_triage\.sql$/.test(f));
  const mig = migFile ? readFileSync(`drizzle/${migFile}`, "utf8") : "";
  for (const t of ["triage_snapshots", "triage_marks"]) {
    ok(
      new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`).test(mig) &&
        mig.includes(`${t}_seq_bump`) &&
        mig.includes(`CREATE INDEX IF NOT EXISTS "${t}_seq_idx"`),
      `triage wiring: the migration creates ${t} idempotently with its seq-bump trigger`
    );
  }
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  ok(!!migFile && journal.entries.some((e) => e.tag === migFile.replace(/\.sql$/, "")), "triage wiring: the journal lists the triage migration");

  /* ---- clock ---- */
  ok(dayKey(MON_10) === "2026-10-12" && dayKey(Date.UTC(2026, 9, 13, 4, 30)) === "2026-10-12", "clock: dayKey is the Chicago calendar day (23:30 CDT stays Monday)");
  ok(nextDayKey("2026-10-31") === "2026-11-01" && nextDayKey("2026-12-31") === "2027-01-01", "clock: nextDayKey rolls months and years");
  ok(dayDiff("2026-10-09", "2026-10-12") === 3 && dayDiff("2026-10-12", "2026-10-12") === 0, "clock: dayDiff counts calendar days");
  ok(
    chicagoMidnight(MON_10) === Date.UTC(2026, 9, 12, 5) &&
      chicagoMidnight(Date.UTC(2026, 10, 2, 18)) === Date.UTC(2026, 10, 2, 6) &&
      chicagoMidnight(Date.UTC(2026, 10, 1, 20)) === Date.UTC(2026, 10, 1, 5),
    "clock: chicagoMidnight is right on CDT, CST and the fall-back day"
  );

  /* ---- business time ---- */
  ok(businessMsBetween(FRI_15, MON_10) === 19 * H && businessDaysBetween(FRI_15, MON_10) === 0, "business time: Fri 3 pm → Mon 10 am is 19 business hours — under one business day (weekend excluded)");
  ok(businessDaysBetween(FRI_9, MON_10) === 1, "business time: Fri 9 am → Mon 10 am is 1 business day");
  ok(businessDaysBetween(THU_9, MON_10) === 2, "business time: Thu 9 am → Mon 10 am is 2 business days");
  ok(businessMsBetween(SAT_12, MON_10) === 10 * H, "business time: a Saturday message only starts counting Monday");
  ok(businessMsBetween(Date.UTC(2026, 9, 30, 5), Date.UTC(2026, 10, 2, 6)) === 24 * H, "business time: Fri → Mon across the DST fall-back counts exactly Friday");
  ok(businessMsBetween(MON_10, FRI_9) === 0, "business time: a reversed range is zero");

  /* ---- slots ---- */
  const lateMon = Date.UTC(2026, 9, 13, 4, 30);
  ok(
    slotAt(MON_10).slot === "morning" && slotAt(MON_12).slot === "midday" && slotAt(lateMon).slot === "midday" && slotAt(lateMon).day === "2026-10-12",
    "slots: before noon Chicago is the morning list, noon on is midday"
  );
  ok(snapshotId("u3", "2026-10-12", "midday") === "u3:2026-10-12:midday", "slots: snapshot key is <userId>:<YYYY-MM-DD>:<slot>");
  ok(
    slotOrdinal("2026-10-12", "morning") < slotOrdinal("2026-10-12", "midday") && slotOrdinal("2026-10-12", "midday") < slotOrdinal("2026-10-13", "morning"),
    "slots: ordinals sort morning < midday < next morning"
  );
  ok(nextMorning("2026-10-12").day === "2026-10-13" && nextMorning("2026-10-12").slot === "morning", "slots: nextMorning is the next calendar day's morning");
  ok(chicagoTime(Date.UTC(2026, 9, 12, 12, 2)) === "7:02 AM" && chicagoShortDate(MON_10) === "Oct 12", "clock: Chicago time and date labels");

  /* ---- text + keys + types ---- */
  ok(tokens("Send the revised drawings to Bob!").join(" ") === "send revised drawings bob", "text: tokens lowercase, drop punctuation and stopwords");
  ok(
    normalizedTitle("Send Bob the drawings.") === normalizedTitle("drawings — send to bob") && normalizedTitle("the a to") === "",
    "text: normalizedTitle ignores order, punctuation and stopwords; all-stopword → empty"
  );
  ok(
    triageKey.call("TESTX:rec1", "k9") === "call:TESTX:rec1:k9" &&
      JSON.stringify(parseTriageKey("call:TESTX:rec1:k9")) === JSON.stringify({ source: "call", id: "TESTX:rec1", part: "k9" }),
    "keys: a call key splits on its LAST colon (recording ids may hold colons)"
  );
  ok(
    parseTriageKey("asg:as-1")?.source === "assignment" && parseTriageKey("renewal:flame:FT-1")?.part === "flame" && parseTriageKey("renewal:flame:FT-1")?.id === "FT-1",
    "keys: assignment and renewal keys parse"
  );
  ok(
    parseTriageKey("nope:1") === null && parseTriageKey("task:") === null && parseTriageKey("x".repeat(400)) === null && parseTriageKey("renewal:boat:1") === null,
    "keys: unknown prefix, empty id, oversize or bad renewal kind → null"
  );
  ok(
    feedErrorMessage("email") === "Email couldn't be read — list may be incomplete" && feedErrorMessage("assignment") === "Tasks couldn't be read — list may be incomplete",
    "types: the per-feed failure note"
  );
}
```

Wire it into the harness. In `scripts/test-review-and-spec.ts`, immediately above the line that is exactly `seeded()` (≈ line 11316), add:

```ts
import { triageFoundationChecks } from "./test-morning-triage";
```

and immediately after the line `  .then(() => square322Pins())` add:

```ts
  .then(() => triageFoundationChecks(ok))
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `cd /Users/sm/Downloads/peak-app-triage && env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: the run aborts with `Cannot find module '@/lib/triage/clock'` (or similar for another new module).

- [ ] **Step 3: Write `src/lib/triage/types.ts`**

```ts
/**
 * Morning triage (spec docs/superpowers/specs/2026-10-09-morning-triage-design.md)
 * — shared shapes. Pure and CLIENT-SAFE: no store, db or session imports, so
 * the "use client" row list can import SOURCE_LABEL as a value.
 */

export const TRIAGE_SOURCES = ["email", "call", "task", "assignment", "lead", "visit", "quote", "renewal"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

/** The chip on each row. */
export const SOURCE_LABEL: Record<TriageSource, string> = {
  email: "Email",
  call: "Call",
  task: "Task",
  assignment: "Assigned",
  lead: "Lead",
  visit: "Site visit",
  quote: "Quote",
  renewal: "Renewal",
};

/** The feed's name in "<Feed> couldn't be read" (tasks + assignments are one feed). */
export const FEED_LABEL: Record<TriageSource, string> = {
  email: "Email",
  call: "Calls",
  task: "Tasks",
  assignment: "Tasks",
  lead: "Leads",
  visit: "Site visits",
  quote: "Quotes",
  renewal: "Renewals",
};

export function feedErrorMessage(source: TriageSource): string {
  return `${FEED_LABEL[source]} couldn't be read — list may be incomplete`;
}

/** One reason a row is on the list. Points live in rank.ts. */
export type TriageFact =
  | { kind: "lead_sla_breached" }
  | { kind: "visit_today"; startAt: number }
  | { kind: "task_overdue"; days: number }
  | { kind: "customer_waiting"; businessDays: number }
  | { kind: "quote_awaiting_approval" }
  | { kind: "lead_sla_due_soon"; minutes: number }
  | { kind: "task_due_today" }
  | { kind: "call_todo" }
  | { kind: "portal_quote_review" }
  | { kind: "quote_sent_back" }
  | { kind: "renewal_past_due"; days: number }
  | { kind: "lead_next_action_overdue" }
  | { kind: "task_at_risk" }
  | { kind: "linked_open_deal"; label: string }
  | { kind: "call_names_me" }
  | { kind: "visit_flag"; label: string }
  | { kind: "task_tier"; tier: "high" | "low" }
  | { kind: "renewal_window"; days: number }
  | { kind: "task_due_tomorrow" }
  | { kind: "customer_message_new"; hours: number }
  | { kind: "lead_stale"; days: number };

/** The transcript line shown under a call to-do (`found: false` = "Source line not found — open the meeting"). */
export type CallLine =
  | { found: true; speaker: string; text: string; start: number; href: string }
  | { found: false; href: string };

export type TriageCandidate = {
  key: string;
  source: TriageSource;
  title: string;
  sub: string;
  href: string;
  /** epoch-ms the item became actionable — the "older first" tie-break; 0 = unknown (sorts after known ages). */
  since: number;
  facts: TriageFact[];
  callLine?: CallLine;
  /** Call to-dos only: "<meeting title> (<date>)" — used by the duplicate collapse. */
  mention?: string;
  /** "Also mentioned in …" lines folded in from collapsed call to-dos. */
  also?: string[];
};

export type RankedCandidate = TriageCandidate & { score: number; reason: string };

/** One frozen row of a snapshot — everything the list needs to render. */
export type SnapshotRow = {
  key: string;
  source: TriageSource;
  title: string;
  sub: string;
  href: string;
  score: number;
  reason: string;
  callLine: CallLine | null;
  also: string[];
};

export type Slot = "morning" | "midday";

export type FeedError = { source: TriageSource; message: string };

export type TriageSnapshot = {
  id: string; // `<userId>:<YYYY-MM-DD>:<slot>`
  userId: string;
  userName: string;
  day: string;
  slot: Slot;
  builtAt: number;
  builtBy: "cron" | "lazy" | "live";
  rows: SnapshotRow[];
  errors: FeedError[];
};

export type MarkKind = "done" | "snooze" | "dismiss";

export type TriageMark = {
  id: string; // `<userId>:<itemKey>`
  userId: string;
  key: string;
  kind: MarkKind;
  at: number;
  /** done: the snapshot it was marked in (hidden only there). */
  snapshotId: string | null;
  /** snooze: slotOrdinal it comes back at. */
  until: string | null;
};

/** Whose list — a team member NAME is the app's ownership convention. */
export type TriageUser = { id: string; name: string; canApprove: boolean };
```

- [ ] **Step 4: Write `src/lib/triage/keys.ts`**

```ts
import type { TriageSource } from "./types";

/** Stable candidate keys (spec "Feeds"). Pure, client-safe. */
export const triageKey = {
  email: (threadId: string) => `email:${threadId}`,
  call: (meetingId: string, itemKey: string) => `call:${meetingId}:${itemKey}`,
  task: (id: string) => `task:${id}`,
  assignment: (id: string) => `asg:${id}`,
  lead: (id: string) => `lead:${id}`,
  visit: (id: string) => `visit:${id}`,
  quote: (id: string) => `quote:${id}`,
  renewal: (kind: RenewalKind, id: string) => `renewal:${kind}:${id}`,
};

export const RENEWAL_KINDS = ["flame", "inspection"] as const;
export type RenewalKind = (typeof RENEWAL_KINDS)[number];

const PREFIX: Record<string, TriageSource> = {
  email: "email",
  call: "call",
  task: "task",
  asg: "assignment",
  lead: "lead",
  visit: "visit",
  quote: "quote",
  renewal: "renewal",
};

export type ParsedTriageKey = { source: TriageSource; id: string; part?: string };

/**
 * Inverse of triageKey. A call key splits on its LAST colon (item keys are
 * hashes; recording ids — fixture ids especially — may contain colons); a
 * renewal key's first segment is its kind. Anything else → null.
 */
export function parseTriageKey(key: string): ParsedTriageKey | null {
  if (typeof key !== "string" || !key || key.length > 300) return null;
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const prefix = key.slice(0, i);
  const source = Object.hasOwn(PREFIX, prefix) ? PREFIX[prefix] : undefined;
  const rest = key.slice(i + 1);
  if (!source || !rest) return null;
  if (source === "call") {
    const j = rest.lastIndexOf(":");
    if (j <= 0 || j === rest.length - 1) return null;
    return { source, id: rest.slice(0, j), part: rest.slice(j + 1) };
  }
  if (source === "renewal") {
    const j = rest.indexOf(":");
    const kind = j > 0 ? rest.slice(0, j) : "";
    if (!(RENEWAL_KINDS as readonly string[]).includes(kind) || j === rest.length - 1) return null;
    return { source, id: rest.slice(j + 1), part: kind };
  }
  return { source, id: rest };
}
```

- [ ] **Step 5: Write `src/lib/triage/clock.ts`**

```ts
import type { Slot } from "./types";

/**
 * Chicago calendar math for the triage list. Pure (Intl only), client-safe.
 * Business time = elapsed time on Chicago Mon–Fri days; weekends count zero.
 */

export const TRIAGE_TZ = "America/Chicago";
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TRIAGE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

export type ChicagoParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function chicagoParts(ms: number): ChicagoParts {
  const p: Record<string, string> = {};
  for (const x of PARTS_FMT.formatToParts(ms)) p[x.type] = x.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAY[p.weekday] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" — the Chicago calendar day `ms` falls on. */
export function dayKey(ms: number): string {
  const p = chicagoParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function utcOfDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function nextDayKey(day: string): string {
  return new Date(utcOfDay(day) + DAY).toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (both "YYYY-MM-DD"). */
export function dayDiff(a: string, b: string): number {
  return Math.round((utcOfDay(b) - utcOfDay(a)) / DAY);
}

/** epoch-ms of 00:00 Chicago on the day `ms` falls on. Chicago is UTC−5 or −6, and midnight never sits in a DST gap. */
export function chicagoMidnight(ms: number): number {
  const p = chicagoParts(ms);
  const base = Date.UTC(p.year, p.month - 1, p.day);
  for (const off of [5, 6]) {
    const g = base + off * HOUR;
    const q = chicagoParts(g);
    if (q.day === p.day && q.hour === 0 && q.minute === 0) return g;
  }
  return base + 6 * HOUR;
}

/** Milliseconds of [from, to) that fall on a Chicago Monday–Friday. Looks back at most 400 days. */
export function businessMsBetween(from: number, to: number): number {
  if (!(to > from)) return 0;
  let cursor = Math.max(from, to - 400 * DAY);
  let total = 0;
  while (cursor < to) {
    const start = chicagoMidnight(cursor);
    const next = chicagoMidnight(start + 26 * HOUR); // 23/24/25-hour days all land in the next day
    const end = Math.min(to, next);
    const wd = chicagoParts(cursor).weekday;
    if (wd >= 1 && wd <= 5) total += end - cursor;
    cursor = end;
  }
  return total;
}

export function businessDaysBetween(from: number, to: number): number {
  return Math.floor(businessMsBetween(from, to) / DAY);
}

/** Noon Chicago splits the morning list from the midday list. */
export const MIDDAY_HOUR = 12;

export function slotAt(ms: number): { day: string; slot: Slot } {
  return { day: dayKey(ms), slot: chicagoParts(ms).hour >= MIDDAY_HOUR ? "midday" : "morning" };
}

export function slotLabel(slot: Slot): string {
  return slot === "morning" ? "Morning list" : "Midday list";
}

export function snapshotId(userId: string, day: string, slot: Slot): string {
  return `${userId}:${day}:${slot}`;
}

/** Sortable position of a slot: "YYYY-MM-DD:0" (morning) < "YYYY-MM-DD:1" (midday) < next day. */
export function slotOrdinal(day: string, slot: Slot): string {
  return `${day}:${slot === "morning" ? 0 : 1}`;
}

export function nextMorning(day: string): { day: string; slot: Slot } {
  return { day: nextDayKey(day), slot: "morning" };
}

const plainSpace = (s: string) => s.replace(/[  ]/g, " ");

/** "7:02 AM" in Chicago. */
export function chicagoTime(ms: number): string {
  return plainSpace(new Date(ms).toLocaleTimeString("en-US", { timeZone: TRIAGE_TZ, hour: "numeric", minute: "2-digit" }));
}

/** "Oct 7" in Chicago. */
export function chicagoShortDate(ms: number): string {
  return plainSpace(new Date(ms).toLocaleDateString("en-US", { timeZone: TRIAGE_TZ, month: "short", day: "numeric" }));
}
```

- [ ] **Step 6: Write `src/lib/triage/text.ts`**

```ts
/** Word-level normalization shared by the transcript match and the duplicate collapse. Pure, client-safe. */

export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "for", "on", "in", "at", "by", "with", "from",
  "is", "are", "was", "be", "been", "it", "its", "this", "that", "these", "those",
  "i", "we", "you", "he", "she", "they", "me", "us", "him", "her", "them", "my", "our", "your", "their",
  "will", "would", "should", "can", "could", "need", "needs", "please", "just", "so", "up", "out", "about",
  "do", "get", "go", "let", "lets", "ok", "okay", "yeah",
]);

/** Lowercased word tokens, apostrophes dropped ("I'll" → "ill"), punctuation split, stopwords removed. */
export function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "" && !STOPWORDS.has(w));
}

/** Order-independent comparable form of a title: unique tokens, sorted. "" when nothing meaningful is left. */
export function normalizedTitle(s: string): string {
  return [...new Set(tokens(s))].sort().join(" ");
}
```

- [ ] **Step 7: Register the collections**

In `src/db/doc-tables.ts`, after the `export const manufacturers = docTable("manufacturers"); …` line add:

```ts
export const triageSnapshots = docTable("triage_snapshots"); // Morning triage — one frozen ranked list per user per slot, id `<userId>:<YYYY-MM-DD>:<slot>` (spec 2026-10-09-morning-triage-design.md); migration 0036_triage
export const triageMarks = docTable("triage_marks"); // Morning triage — Done / Snooze / Dismiss per user per item, id `<userId>:<itemKey>`; migration 0036_triage
```

and in `DOC_TABLES`, after `manufacturers,` add:

```ts
  triage_snapshots: triageSnapshots,
  triage_marks: triageMarks,
```

Do NOT add either to `SYNCABLE_COLLECTIONS` or `CONFIG_COLLECTIONS`.

- [ ] **Step 8: Generate and harden the migration**

Run: `cd /Users/sm/Downloads/peak-app-triage && env -u DATABASE_URL npx drizzle-kit generate --name triage`
Expected: `drizzle/0036_triage.sql`, `drizzle/meta/0036_snapshot.json`, and a new `0036_triage` entry in `drizzle/meta/_journal.json`. (`generate` diffs schema snapshots offline; if a `.data/` directory appears in the worktree anyway, delete it — it is not the dev DB.)

Replace the whole content of `drizzle/0036_triage.sql` with:

```sql
-- Morning triage (spec docs/superpowers/specs/2026-10-09-morning-triage-design.md)
-- — triage_snapshots: one frozen ranked list per user per slot
-- (`<userId>:<YYYY-MM-DD>:<morning|midday>`); triage_marks: one Done /
-- Snooze / Dismiss mark per user per item (`<userId>:<itemKey>`).
--
-- Generated by drizzle-kit, then hardened so it is idempotent per D141 (the
-- shared Neon database is migrated by more than one branch's build).
-- Column-for-column docTable(); the _seq_bump trigger keeps pull-sync's
-- `WHERE seq > cursor` honest.
CREATE TABLE IF NOT EXISTS "triage_marks" (
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
CREATE TABLE IF NOT EXISTS "triage_snapshots" (
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
CREATE INDEX IF NOT EXISTS "triage_marks_seq_idx" ON "triage_marks" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "triage_marks_deleted_idx" ON "triage_marks" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "triage_snapshots_seq_idx" ON "triage_snapshots" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "triage_snapshots_deleted_idx" ON "triage_snapshots" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER triage_marks_seq_bump BEFORE UPDATE ON "triage_marks" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE OR REPLACE TRIGGER triage_snapshots_seq_bump BEFORE UPDATE ON "triage_snapshots" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```

If drizzle-kit numbered it anything other than `0036`, keep its number in the filename and update the two `migration 0036_triage` comments in `doc-tables.ts` to match.

- [ ] **Step 9: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: no tsc output; `ALL PASSED` (every `triage wiring:` / `clock:` / `business time:` / `slots:` / `text:` / `keys:` / `types:` line is PASS).
Run: `npx eslint src/lib/triage src/db/doc-tables.ts scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/triage drizzle/0036_triage.sql drizzle/meta src/db/doc-tables.ts scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): collections, migration, Chicago clock, text and key helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ranking — points table, reasons, ordering

**Files:**
- Create: `src/lib/triage/rank.ts`
- Modify: `scripts/test-morning-triage.ts` (add `triageRankChecks`), `scripts/test-review-and-spec.ts` (import name + `.then` line)

**Interfaces:**
- Consumes: `TriageFact`, `TriageCandidate`, `RankedCandidate` (types.ts); `chicagoTime` (clock.ts).
- Produces: `pointsFor(f: TriageFact): number`, `factLabel(f: TriageFact): string`, `scoreOf(facts): number`, `reasonOf(facts): string`, `rankCandidates(cands: readonly TriageCandidate[]): RankedCandidate[]`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (and add `factLabel, pointsFor, rankCandidates, reasonOf, scoreOf` from `@/lib/triage/rank` and `type TriageCandidate, type TriageFact` from `@/lib/triage/types` to its imports):

```ts
export function cand(key: string, source: TriageCandidate["source"], facts: TriageFact[], since = 1, extra: Partial<TriageCandidate> = {}): TriageCandidate {
  return { key, source, title: key, sub: "", href: "/", since, facts, ...extra };
}

export async function triageRankChecks(ok: Ok): Promise<void> {
  const table: Array<[TriageFact, number]> = [
    [{ kind: "lead_sla_breached" }, 60],
    [{ kind: "visit_today", startAt: MON_10 }, 50],
    [{ kind: "task_overdue", days: 1 }, 45],
    [{ kind: "customer_waiting", businessDays: 1 }, 40],
    [{ kind: "quote_awaiting_approval" }, 35],
    [{ kind: "lead_sla_due_soon", minutes: 90 }, 35],
    [{ kind: "task_due_today" }, 30],
    [{ kind: "call_todo" }, 30],
    [{ kind: "portal_quote_review" }, 30],
    [{ kind: "quote_sent_back" }, 30],
    [{ kind: "renewal_past_due", days: 4 }, 30],
    [{ kind: "lead_next_action_overdue" }, 25],
    [{ kind: "task_at_risk" }, 15],
    [{ kind: "linked_open_deal", label: "open quote $1" }, 10],
    [{ kind: "call_names_me" }, 10],
    [{ kind: "visit_flag", label: "Unverified address" }, 10],
    [{ kind: "task_tier", tier: "high" }, 15],
    [{ kind: "task_tier", tier: "low" }, -10],
    [{ kind: "renewal_window", days: 20 }, 15],
    [{ kind: "task_due_tomorrow" }, 15],
    [{ kind: "customer_message_new", hours: 5 }, 10],
    [{ kind: "lead_stale", days: 6 }, 10],
  ];
  for (const [f, p] of table) ok(pointsFor(f) === p, `rank: ${f.kind}${f.kind === "task_tier" ? `/${f.tier}` : ""} = ${p} points`);
  ok(
    pointsFor({ kind: "task_overdue", days: 3 }) === 55 && pointsFor({ kind: "task_overdue", days: 6 }) === 70 && pointsFor({ kind: "task_overdue", days: 40 }) === 70,
    "rank: an overdue task gains +5/day, capped at +30"
  );
  ok(
    pointsFor({ kind: "customer_waiting", businessDays: 2 }) === 50 &&
      pointsFor({ kind: "customer_waiting", businessDays: 4 }) === 70 &&
      pointsFor({ kind: "customer_waiting", businessDays: 12 }) === 70,
    "rank: a waiting customer gains +10 per extra business day, capped at +30"
  );
  ok(scoreOf([{ kind: "task_due_today" }, { kind: "task_tier", tier: "low" }]) === 20, "rank: a row's score is the sum of its facts (Low tier subtracts)");
  ok(
    reasonOf([{ kind: "linked_open_deal", label: "open quote $18,400" }, { kind: "customer_waiting", businessDays: 2 }]) === "Customer waiting 2 business days · open quote $18,400",
    "rank: the reason is the top two facts in words, biggest first"
  );
  ok(reasonOf([{ kind: "task_due_today" }, { kind: "task_tier", tier: "low" }]) === "Due today", "rank: a negative fact never shows as a reason");
  ok(
    factLabel({ kind: "customer_waiting", businessDays: 1 }) === "Customer waiting 1 business day" &&
      factLabel({ kind: "lead_sla_due_soon", minutes: 45 }) === "First response due in 45 min" &&
      factLabel({ kind: "lead_sla_due_soon", minutes: 180 }) === "First response due in 3h" &&
      factLabel({ kind: "visit_today", startAt: MON_10 }) === "Site visit today 10:00 AM",
    "rank: fact labels read plainly"
  );
  const ranked = rankCandidates([
    cand("b", "task", [{ kind: "task_due_today" }], 5),
    cand("a", "task", [{ kind: "task_due_today" }], 5),
    cand("old", "task", [{ kind: "task_due_today" }], 1),
    cand("undated", "task", [{ kind: "task_due_today" }], 0),
    cand("top", "lead", [{ kind: "lead_sla_breached" }], 9),
  ]);
  ok(ranked.map((r) => r.key).join(",") === "top,old,a,b,undated", "rank: score desc → older first → key; an unknown age sorts after known ones");
  ok(ranked[0].score === 60 && ranked[0].reason === "First response overdue", "rank: ranked rows carry their score and reason");
}
```

In the harness, extend the import to `{ triageFoundationChecks, triageRankChecks }` and add `  .then(() => triageRankChecks(ok))` after the `triageFoundationChecks` line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: aborts with `Cannot find module '@/lib/triage/rank'`.

- [ ] **Step 3: Write `src/lib/triage/rank.ts`**

```ts
import { chicagoTime } from "./clock";
import type { RankedCandidate, TriageCandidate, TriageFact } from "./types";

/**
 * Spec "Ranking" — points per fact, a row's score is the sum, ties → older
 * first → key. The reason is the top two POSITIVE facts in words. Pure.
 */
export function pointsFor(f: TriageFact): number {
  switch (f.kind) {
    case "lead_sla_breached":
      return 60;
    case "visit_today":
      return 50;
    case "task_overdue":
      return 40 + Math.min(30, 5 * Math.max(0, f.days));
    case "customer_waiting":
      return 40 + Math.min(30, 10 * Math.max(0, f.businessDays - 1));
    case "quote_awaiting_approval":
    case "lead_sla_due_soon":
      return 35;
    case "task_due_today":
    case "call_todo":
    case "portal_quote_review":
    case "quote_sent_back":
    case "renewal_past_due":
      return 30;
    case "lead_next_action_overdue":
      return 25;
    case "task_at_risk":
    case "renewal_window":
    case "task_due_tomorrow":
      return 15;
    case "task_tier":
      return f.tier === "high" ? 15 : -10;
    case "linked_open_deal":
    case "call_names_me":
    case "visit_flag":
    case "customer_message_new":
    case "lead_stale":
      return 10;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function factLabel(f: TriageFact): string {
  switch (f.kind) {
    case "lead_sla_breached":
      return "First response overdue";
    case "visit_today":
      return `Site visit today ${chicagoTime(f.startAt)}`;
    case "task_overdue":
      return `Overdue ${plural(f.days, "day")}`;
    case "customer_waiting":
      return `Customer waiting ${plural(f.businessDays, "business day")}`;
    case "quote_awaiting_approval":
      return "Waiting on your approval";
    case "lead_sla_due_soon":
      return `First response due in ${f.minutes < 60 ? `${f.minutes} min` : `${Math.round(f.minutes / 60)}h`}`;
    case "task_due_today":
      return "Due today";
    case "call_todo":
      return "To-do from a call";
    case "portal_quote_review":
      return "Portal quote to review";
    case "quote_sent_back":
      return "Sent back to you";
    case "renewal_past_due":
      return `Renewal ${plural(f.days, "day")} past due`;
    case "lead_next_action_overdue":
      return "Follow-up overdue";
    case "task_at_risk":
      return "At risk";
    case "linked_open_deal":
      return f.label;
    case "call_names_me":
      return "Names you";
    case "visit_flag":
      return f.label;
    case "task_tier":
      return f.tier === "high" ? "High priority" : "Low priority";
    case "renewal_window":
      return `Renewal due in ${plural(f.days, "day")}`;
    case "task_due_tomorrow":
      return "Due tomorrow";
    case "customer_message_new":
      return `Customer message ${f.hours}h old`;
    case "lead_stale":
      return `No contact in ${plural(f.days, "day")}`;
  }
}

export function scoreOf(facts: readonly TriageFact[]): number {
  return facts.reduce((n, f) => n + pointsFor(f), 0);
}

export function reasonOf(facts: readonly TriageFact[]): string {
  return facts
    .map((f, i) => ({ f, i, p: pointsFor(f) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .slice(0, 2)
    .map((x) => factLabel(x.f))
    .join(" · ");
}

const ageOf = (c: TriageCandidate) => (c.since > 0 ? c.since : Number.MAX_SAFE_INTEGER);

export function rankCandidates(cands: readonly TriageCandidate[]): RankedCandidate[] {
  return cands
    .map((c) => ({ ...c, score: scoreOf(c.facts), reason: reasonOf(c.facts) }))
    .sort((a, b) => b.score - a.score || ageOf(a) - ageOf(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
```

- [ ] **Step 4: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint src/lib/triage/rank.ts scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/triage/rank.ts scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): points table, plain-words reason and deterministic ordering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Transcript line match + duplicate collapse

**Files:**
- Create: `src/lib/triage/transcript-match.ts`, `src/lib/triage/dedupe.ts`
- Modify: `scripts/test-morning-triage.ts` (add `triageMatchChecks`), harness (import + `.then`)

**Interfaces:**
- Consumes: `tokens`, `normalizedTitle` (text.ts); `TriageCandidate` (types.ts).
- Produces:
  - `transcript-match.ts`: `type TranscriptSegment = { speaker: number; text: string; start: number; end: number }`, `type LineMatch = { index; speaker; text; start; share; matched }`, `MATCH_MIN_SHARE = 0.5`, `MATCH_MIN_TOKENS = 2`, `matchTranscriptLine(title, segments): LineMatch | null`, `formatTimestamp(sec): string`, `clipLine(text, max = 140): string`.
  - `dedupe.ts`: `type OpenWork = { key: string; title: string }`, `collapseDuplicates(cands, openWork): TriageCandidate[]`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (imports: `clipLine, formatTimestamp, matchTranscriptLine` from `@/lib/triage/transcript-match`; `collapseDuplicates` from `@/lib/triage/dedupe`):

```ts
export async function triageMatchChecks(ok: Ok): Promise<void> {
  const segs = [
    { speaker: 0, text: "Thanks everyone for coming out today.", start: 0, end: 4 },
    { speaker: 1, text: "I'll send the revised rigging drawings to the architect by Friday.", start: 754, end: 760 },
    { speaker: 0, text: "Drawings look good.", start: 800, end: 802 },
  ];
  const hit = matchTranscriptLine("Send revised rigging drawings to architect", segs);
  ok(!!hit && hit.index === 1 && hit.start === 754 && hit.matched === 5 && hit.share === 1, "transcript: the best segment by word overlap wins");
  ok(matchTranscriptLine("Order new motor controller for the fly system", segs) === null, "transcript: below the 0.5 share → no match");
  ok(matchTranscriptLine("Drawings", segs) === null, "transcript: a one-word to-do never matches (≥ 2-token floor)");
  ok(matchTranscriptLine("Review drawings with the team and the owner", segs) === null, "transcript: 1 matched token of 4 → miss");
  const sw = matchTranscriptLine("the THE to send architect", [{ speaker: 2, text: "send it to the architect", start: 5, end: 6 }]);
  ok(!!sw && sw.matched === 2 && sw.share === 1, "transcript: stopwords and case are ignored");
  ok(matchTranscriptLine("Send architect drawings", []) === null, "transcript: no transcript → no match");
  ok(formatTimestamp(754) === "12:34" && formatTimestamp(3725) === "1:02:05" && formatTimestamp(-3) === "0:00", "transcript: timestamps read m:ss / h:mm:ss");
  ok(clipLine("a".repeat(200)).length === 140 && clipLine("a".repeat(200)).endsWith("…") && clipLine("  x   y ") === "x y", "transcript: lines are clipped and whitespace-collapsed");

  const out = collapseDuplicates(
    [
      cand("task:T1", "task", [], 5, { title: "Send drawings to Bob" }),
      cand("call:R1:k1", "call", [], 10, { title: "send Bob the drawings", mention: "Walkthrough (Oct 7)" }),
      cand("call:R2:k1", "call", [], 20, { title: "Order motor", mention: "Call A (Oct 8)" }),
      cand("call:R3:k2", "call", [], 30, { title: "order the motor!", mention: "Call B (Oct 9)" }),
      cand("call:R4:k3", "call", [], 40, { title: "Book lift", mention: "Call C (Oct 9)" }),
    ],
    [
      { key: "task:T1", title: "Send drawings to Bob" },
      { key: "asg:A9", title: "Book lift" },
    ]
  );
  ok(out.map((c) => c.key).join(",") === "task:T1,call:R2:k1", "dedupe: to-dos matching open work or an earlier to-do collapse away");
  ok((out[0].also ?? []).join("|") === "Also mentioned in Walkthrough (Oct 7)", "dedupe: a to-do matching an open task shows on that task's row");
  ok((out[1].also ?? []).join("|") === "Also mentioned in Call B (Oct 9)", "dedupe: a later duplicate to-do folds into the earliest one");
  ok(!out.some((c) => c.key === "call:R4:k3"), "dedupe: a to-do already tracked as open work off the list is not repeated");
  const blank = collapseDuplicates(
    [cand("call:R5:k", "call", [], 1, { title: "the to", mention: "X" }), cand("call:R6:k", "call", [], 2, { title: "a the", mention: "Y" })],
    []
  );
  ok(blank.length === 2, "dedupe: an all-stopword title never collapses");
}
```

Harness: add `triageMatchChecks` to the import and `  .then(() => triageMatchChecks(ok))` after the rank line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/triage/transcript-match'`.

- [ ] **Step 3: Write `src/lib/triage/transcript-match.ts`**

```ts
import { tokens } from "./text";

/**
 * Spec "Transcript line match" — score each segment by the share of the
 * to-do's (unique, stopword-free) tokens it contains. Best segment with
 * share ≥ 0.5 AND ≥ 2 matched tokens wins; ties → more matched tokens →
 * earlier segment. Pure, client-safe.
 */
export type TranscriptSegment = { speaker: number; text: string; start: number; end: number };
export type LineMatch = { index: number; speaker: number; text: string; start: number; share: number; matched: number };

export const MATCH_MIN_SHARE = 0.5;
export const MATCH_MIN_TOKENS = 2;

export function matchTranscriptLine(title: string, segments: readonly TranscriptSegment[]): LineMatch | null {
  const want = new Set(tokens(title));
  if (want.size < MATCH_MIN_TOKENS) return null;
  let best: LineMatch | null = null;
  for (let index = 0; index < segments.length; index++) {
    const s = segments[index];
    const have = new Set(tokens(String(s?.text ?? "")));
    let matched = 0;
    for (const w of want) if (have.has(w)) matched++;
    const share = matched / want.size;
    if (!best || share > best.share || (share === best.share && matched > best.matched)) {
      best = { index, speaker: Number(s.speaker) || 0, text: String(s.text ?? ""), start: Number(s.start) || 0, share, matched };
    }
  }
  return best && best.share >= MATCH_MIN_SHARE && best.matched >= MATCH_MIN_TOKENS ? best : null;
}

/** Seconds → "12:34" or "1:02:05". */
export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function clipLine(text: string, max = 140): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
```

- [ ] **Step 4: Write `src/lib/triage/dedupe.ts`**

```ts
import { normalizedTitle } from "./text";
import type { TriageCandidate } from "./types";

/** An open task/assignment of the user, on the list or not. Keys match the tasks feed's candidate keys. */
export type OpenWork = { key: string; title: string };

/**
 * Spec "Duplicates". Call to-dos whose normalized title matches one of the
 * user's open tasks/assignments, or an earlier call to-do, collapse into one
 * row with "Also mentioned in <meeting> (<date>)". A to-do matching open work
 * that is NOT on today's list is dropped — the work is already tracked.
 * Earliest to-do (since, then key) keeps the row. Order of survivors is kept.
 */
export function collapseDuplicates(cands: readonly TriageCandidate[], openWork: readonly OpenWork[]): TriageCandidate[] {
  const out = cands.map((c) => ({ ...c, also: [...(c.also ?? [])] }));
  const byKey = new Map(out.map((c) => [c.key, c]));
  const workByTitle = new Map<string, string>();
  for (const w of openWork) {
    const n = normalizedTitle(w.title);
    if (n && !workByTitle.has(n)) workByTitle.set(n, w.key);
  }
  const age = (c: TriageCandidate) => (c.since > 0 ? c.since : Number.MAX_SAFE_INTEGER);
  const calls = out
    .filter((c) => c.source === "call")
    .sort((a, b) => age(a) - age(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const drop = new Set<string>();
  const firstCall = new Map<string, (typeof out)[number]>();
  for (const c of calls) {
    const n = normalizedTitle(c.title);
    if (!n) continue;
    const line = `Also mentioned in ${c.mention || "a meeting"}`;
    const workKey = workByTitle.get(n);
    if (workKey) {
      drop.add(c.key);
      byKey.get(workKey)?.also.push(line);
      continue;
    }
    const prior = firstCall.get(n);
    if (prior) {
      drop.add(c.key);
      prior.also.push(line);
      continue;
    }
    firstCall.set(n, c);
  }
  return out.filter((c) => !drop.has(c.key));
}
```

- [ ] **Step 5: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint src/lib/triage/transcript-match.ts src/lib/triage/dedupe.ts scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/triage/transcript-match.ts src/lib/triage/dedupe.ts scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): transcript line match and call to-do duplicate collapse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Feed seam + email, tasks/assignments and leads feeds

**Files:**
- Create: `src/lib/triage/hooks.ts`, `src/lib/triage/feeds/context.ts`, `src/lib/triage/feeds/email.ts`, `src/lib/triage/feeds/tasks.ts`, `src/lib/triage/feeds/leads.ts`
- Modify: `src/lib/queue.ts` (export `assignmentHref` — change `function assignmentHref(` to `export function assignmentHref(`), `scripts/test-morning-triage.ts` (add `triageFeedChecksA`), harness

**Interfaces:**
- Consumes: clock (`businessMsBetween`, `dayKey`, `nextDayKey`, `dayDiff`), keys (`triageKey`), types, dedupe (`OpenWork`); stores `comms` (`getAll`, `waitingSince`, `CommThread`), `quotes` (`getAll`), `leads` (`getAll`, `isOpen`, `slaDeadline`, `STALE_DAYS`, `LeadRecord`), `tasks` (`allTasks`, `TaskRecord`), `assignments` (`allAssignments`, `Assignment`); `sameName` (quote-approval-rules), `money` (format), `displayLeadNumber` (estimate-number), `assignmentHref` (queue).
- Produces:
  - `hooks.ts`: `type AtRiskProvider = (me: TriageUser, now: number) => Promise<ReadonlySet<string>>` (keys `task:<id>` / `asg:<id>`), `type VisitFlagProvider = (visitIds: readonly string[], now: number) => Promise<ReadonlyMap<string, readonly string[]>>`, `type TriageHooks = { atRisk; visitFlags }`, `NO_HOOKS`, `TRIAGE_HOOKS`.
  - `feeds/context.ts`: `type FeedCtx = { me: TriageUser; now: number; users: readonly { id: string; name: string }[]; hooks: TriageHooks }`, `type FeedResult = { candidates: TriageCandidate[]; openWork?: OpenWork[] }`, `type TriageFeed = { source: TriageSource; load: (ctx: FeedCtx) => Promise<FeedResult> }`.
  - `feeds/email.ts`: `type DealIndex`, `linkedDealLabel(t, deals)`, `selectEmail(threads, deals, ctx: Pick<FeedCtx,"me"|"now">)`, `emailFeed`.
  - `feeds/tasks.ts`: `tierOf(rec: unknown): "high"|"low"|null`, `taskDueFacts(due, now): TriageFact[]`, `taskHref(t)`, `selectTasks({ tasks, assignments, atRisk }, ctx): FeedResult`, `tasksFeed` (source `"task"`).
  - `feeds/leads.ts`: `SLA_SOON_MS`, `leadFacts(l, now): { facts; since }`, `selectLeads(leads, ctx)`, `leadsFeed`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (imports: `selectEmail, type DealIndex` from `@/lib/triage/feeds/email`; `selectTasks, tierOf` from `@/lib/triage/feeds/tasks`; `selectLeads` from `@/lib/triage/feeds/leads`; `type CommThread` from `@/lib/stores/comms`; `normalizeTask, type TaskRecord` from `@/lib/stores/tasks`; `type Assignment` from `@/lib/stores/assignments`; `type LeadRecord` from `@/lib/stores/leads`):

```ts
export async function triageFeedChecksA(ok: Ok): Promise<void> {
  /* ---- email ---- */
  const thread = (id: string, since: number, extra: Record<string, unknown> = {}) =>
    ({
      id, mailbox: "personal", mailboxUser: ME.name, unread: true, customerId: null, customer: "Acme Theatre",
      contactName: "Pat", contactEmail: "pat@acme.test", subject: "Rigging quote?", channel: "email",
      status: "waiting_us", assignedTo: ME.name, link: null,
      messages: [{ id: "m1", at: since, direction: "in", channel: "email", author: "Pat", body: "Hi" }],
      createdAt: since, updatedAt: since, ...extra,
    }) as unknown as CommThread;
  const deals: DealIndex = {
    quotes: new Map([["Q-1", { status: "sent", value: 18400 }], ["Q-2", { status: "won", value: 900 }]]),
    leads: new Map([["L-1", { open: true, value: 5000 }]]),
  };
  const em = selectEmail(
    [
      thread("C-1", THU_9, { link: { type: "quote", id: "Q-1" } }),
      thread("C-2", FRI_15),
      thread("C-3", FRI_9, { link: { type: "quote", id: "Q-2" } }),
      thread("C-4", THU_9, { assignedTo: "Someone Else" }),
      thread("C-5", THU_9, { status: "waiting_them" }),
      thread("C-6", THU_9, { archived: true }),
      thread("C-7", THU_9, { gmailInboxed: false }),
      thread("C-8", THU_9, { link: { type: "lead", id: "L-1" } }),
    ],
    deals,
    { me: ME, now: MON_10 }
  );
  ok(em.map((c) => c.key).join(",") === "email:C-1,email:C-2,email:C-3,email:C-8", "email feed: only my waiting, inboxed, unarchived threads");
  ok(
    JSON.stringify(em[0].facts) === JSON.stringify([{ kind: "customer_waiting", businessDays: 2 }, { kind: "linked_open_deal", label: "open quote $18,400" }]),
    "email feed: 2 business days waiting + the linked open quote"
  );
  ok(JSON.stringify(em[1].facts) === JSON.stringify([{ kind: "customer_message_new", hours: 19 }]), "email feed: under one business day ranks lower and shows business hours");
  ok(em[2].facts.length === 1 && em[2].facts[0].kind === "customer_waiting", "email feed: a won quote is not an open deal");
  ok(JSON.stringify(em[3].facts[1]) === JSON.stringify({ kind: "linked_open_deal", label: "open lead $5,000" }), "email feed: a linked open lead counts");
  ok(em[0].href === "/inbox?thread=C-1" && em[0].since === THU_9 && em[0].title === "Acme Theatre" && em[0].sub === "Rigging quote?", "email feed: the row opens the thread; its age is 'waiting since'");

  /* ---- tasks + assignments ---- */
  const FRI_NOON = Date.UTC(2026, 9, 9, 17);
  const MON_18 = Date.UTC(2026, 9, 12, 23);
  const TUE_NOON = Date.UTC(2026, 9, 13, 17);
  const NEXT_WEEK = Date.UTC(2026, 9, 20, 17);
  const tk = (id: string, dueAt: number | null, extra: Partial<TaskRecord> & { priority?: string } = {}) => {
    const { priority, ...rest } = extra;
    const t = normalizeTask({ id, title: `Task ${id}`, assigneeName: ME.name, dueAt, status: "open", createdAt: 1, ...rest });
    return priority ? ({ ...t, priority } as TaskRecord) : t; // spec 3's field — normalizeTask doesn't carry it yet
  };
  const asg = (id: string, dueDate: number, extra: Partial<Assignment> = {}): Assignment => ({
    id, title: `Ask ${id}`, assignee: ME.name, createdBy: "Jeff Chesebro", createdAt: 2, dueDate, link: null,
    done: false, doneAt: null, doneVia: null, source: "", ...extra,
  });
  const tr = selectTasks(
    {
      tasks: [
        tk("T1", FRI_NOON), tk("T2", MON_18, { priority: "high" }), tk("T3", TUE_NOON, { priority: "low" }), tk("T4", NEXT_WEEK),
        tk("T5", null), tk("T6", FRI_NOON, { status: "done" }), tk("T7", FRI_NOON, { assigneeName: "Someone Else" }), tk("T8", NEXT_WEEK, { projectId: "P-1" }),
      ],
      assignments: [asg("A1", MON_18), asg("A2", 0, { done: true }), asg("A3", MON_18, { assignee: "Someone Else" })],
      atRisk: new Set(["task:T5"]),
    },
    { me: ME, now: MON_10 }
  );
  ok(tr.candidates.map((c) => c.key).join(",") === "task:T1,task:T2,task:T3,task:T5,asg:A1", "tasks feed: my open overdue / today / tomorrow / at-risk items only");
  ok(JSON.stringify(tr.candidates[0].facts) === JSON.stringify([{ kind: "task_overdue", days: 3 }]), "tasks feed: days overdue are Chicago calendar days");
  ok(tr.candidates[1].facts.map((f) => f.kind).join(",") === "task_due_today,task_tier", "tasks feed: due today + High tier (when spec 3's priority is present)");
  ok(JSON.stringify(tr.candidates[2].facts) === JSON.stringify([{ kind: "task_due_tomorrow" }, { kind: "task_tier", tier: "low" }]), "tasks feed: due tomorrow + Low tier");
  ok(JSON.stringify(tr.candidates[3].facts) === JSON.stringify([{ kind: "task_at_risk" }]), "tasks feed: the optional at-risk hook adds a fact");
  ok((tr.openWork ?? []).map((w) => w.key).join(",") === "task:T1,task:T2,task:T3,task:T4,task:T5,task:T8,asg:A1", "tasks feed: every open item of mine is open work for the duplicate collapse");
  ok(tr.candidates[4].href === "/queue" && tr.candidates[4].sub === "from Jeff Chesebro" && tr.candidates[0].href === "/calendar", "tasks feed: rows open the queue / calendar like My Queue does");
  ok(tierOf({ priority: "high" }) === "high" && tierOf({ priority: "normal" }) === null && tierOf({}) === null && tierOf(null) === null, "tasks feed: tier is read only when present");
  ok(selectTasks({ tasks: [tk("T9", null)], assignments: [], atRisk: new Set() }, { me: ME, now: MON_10 }).candidates.length === 0, "tasks feed: without the hook an undated task stays off (pre-spec-3 form)");

  /* ---- leads ---- */
  const lead = (id: string, extra: Record<string, unknown> = {}) =>
    ({
      id, org: `Org ${id}`, contact: "", stage: "new", owner: ME.name, value: 0, interest: "", slaHours: 24,
      firstContactAt: null, nextActionAt: null, createdAt: MON_10 - 2 * H, lastActivityAt: MON_10 - 2 * H, ...extra,
    }) as unknown as LeadRecord;
  const lr = selectLeads(
    [
      lead("L1", { createdAt: MON_10 - 30 * H }),
      lead("L2", { createdAt: MON_10 - 21 * H }),
      lead("L3", { stage: "contacted", firstContactAt: 1, nextActionAt: MON_10 - D }),
      lead("L4", { stage: "qualified", firstContactAt: 1, lastActivityAt: MON_10 - 6 * D }),
      lead("L5", { stage: "contacted", firstContactAt: 1 }),
      lead("L6", { createdAt: MON_10 - 30 * H, owner: "Someone Else" }),
      lead("L7", { createdAt: MON_10 - 30 * H, owner: "" }),
      lead("L8", { createdAt: MON_10 - 30 * H, stage: "lost" }),
    ],
    { me: ME, now: MON_10 }
  );
  ok(lr.map((c) => c.key).join(",") === "lead:L1,lead:L2,lead:L3,lead:L4,lead:L7", "leads feed: my open leads (and unassigned ones, like the bell) that need follow-up");
  ok(
    JSON.stringify(lr.map((c) => c.facts)) ===
      JSON.stringify([[{ kind: "lead_sla_breached" }], [{ kind: "lead_sla_due_soon", minutes: 180 }], [{ kind: "lead_next_action_overdue" }], [{ kind: "lead_stale", days: 6 }], [{ kind: "lead_sla_breached" }]]),
    "leads feed: SLA breached, SLA due within 4 h, next action overdue, stale"
  );
  ok(lr[4].sub.includes("unassigned") && lr[0].href === "/leads?lead=L1", "leads feed: unassigned is said; the row opens the lead");
}
```

Harness: add `triageFeedChecksA` to the import and `  .then(() => triageFeedChecksA(ok))` after the match line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/triage/feeds/email'`.

- [ ] **Step 3: Write `src/lib/triage/hooks.ts`**

```ts
import type { TriageUser } from "./types";

/**
 * Optional inputs from specs 1–3 (drive time, visit scheduling, auto task
 * calendar), which are built on another branch. Each feed reads its input
 * through these providers, so with NO_HOOKS every feed is its pre-spec form.
 * At those specs' merge, each replaces ONE field of TRIAGE_HOOKS below.
 */
/** Keys (`task:<id>` / `asg:<id>`) spec 3's planner flags At risk for this person. */
export type AtRiskProvider = (me: TriageUser, now: number) => Promise<ReadonlySet<string>>;
/** Visit id → flag labels (spec 1 unverified address, spec 2 conflicts). */
export type VisitFlagProvider = (visitIds: readonly string[], now: number) => Promise<ReadonlyMap<string, readonly string[]>>;

export type TriageHooks = { atRisk: AtRiskProvider; visitFlags: VisitFlagProvider };

export const NO_HOOKS: TriageHooks = {
  atRisk: async () => new Set<string>(),
  visitFlags: async () => new Map<string, readonly string[]>(),
};

/** The hooks the app runs with. */
export const TRIAGE_HOOKS: TriageHooks = NO_HOOKS;
```

- [ ] **Step 4: Write `src/lib/triage/feeds/context.ts`**

```ts
import type { OpenWork } from "../dedupe";
import type { TriageHooks } from "../hooks";
import type { TriageCandidate, TriageSource, TriageUser } from "../types";

/** What every feed is given: whose list, one clock, the active roster, the optional hooks. */
export type FeedCtx = {
  me: TriageUser;
  now: number;
  users: readonly { id: string; name: string }[];
  hooks: TriageHooks;
};

export type FeedResult = { candidates: TriageCandidate[]; openWork?: OpenWork[] };

/** One source. `load` may throw — the builder notes it and keeps the others. */
export type TriageFeed = { source: TriageSource; load: (ctx: FeedCtx) => Promise<FeedResult> };
```

- [ ] **Step 5: Write `src/lib/triage/feeds/email.ts`**

```ts
import { getAll as allThreads, waitingSince, type CommThread } from "@/lib/stores/comms";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { getAll as allLeads, isOpen as leadIsOpen } from "@/lib/stores/leads";
import { sameName } from "@/lib/quote-approval-rules";
import { money } from "@/lib/format";
import { businessMsBetween } from "../clock";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Open quotes / leads by id, for "+10 linked to an open quote or lead". */
export type DealIndex = {
  quotes: ReadonlyMap<string, { status: string; value: number }>;
  leads: ReadonlyMap<string, { open: boolean; value: number }>;
};

export function linkedDealLabel(t: Pick<CommThread, "link">, deals: DealIndex): string | null {
  const l = t.link;
  if (!l?.id) return null;
  if (l.type === "quote") {
    const q = deals.quotes.get(l.id);
    if (q && (q.status === "draft" || q.status === "sent")) return `open quote ${money(q.value)}`;
  }
  if (l.type === "lead") {
    const d = deals.leads.get(l.id);
    if (d?.open) return `open lead ${money(d.value)}`;
  }
  return null;
}

/**
 * Threads assigned to me that are waiting on us — the bell's own rule
 * (nav-counts.ts "Customers waiting on a reply"): status waiting_us,
 * assignedTo me, not archived (Peak or Gmail side), not in Deleted.
 * ≥ 1 business day → "customer waiting"; younger → "customer message".
 */
export function selectEmail(threads: readonly CommThread[], deals: DealIndex, ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const out: TriageCandidate[] = [];
  for (const t of threads) {
    if (t.status !== "waiting_us" || !sameName(t.assignedTo, ctx.me.name)) continue;
    if (t.archived || t.deleted || t.gmailInboxed === false) continue;
    const since = waitingSince(t) ?? t.updatedAt ?? 0;
    const biz = since ? businessMsBetween(since, ctx.now) : 0;
    const days = Math.floor(biz / DAY);
    const facts: TriageFact[] = [
      days >= 1 ? { kind: "customer_waiting", businessDays: days } : { kind: "customer_message_new", hours: Math.floor(biz / HOUR) },
    ];
    const deal = linkedDealLabel(t, deals);
    if (deal) facts.push({ kind: "linked_open_deal", label: deal });
    out.push({
      key: triageKey.email(t.id),
      source: "email",
      title: t.customer || t.contactName || t.contactEmail || t.subject || "Customer",
      sub: t.subject || "(no subject)",
      href: `/inbox?thread=${encodeURIComponent(t.id)}`,
      since,
      facts,
    });
  }
  return out;
}

export const emailFeed: TriageFeed = {
  source: "email",
  async load(ctx) {
    const [threads, quotes, leads] = await Promise.all([allThreads(), allQuotes(), allLeads()]);
    const deals: DealIndex = {
      quotes: new Map(quotes.map((q) => [q.id, { status: q.status, value: Number(q.value) || 0 }])),
      leads: new Map(leads.map((l) => [l.id, { open: leadIsOpen(l), value: Number(l.value) || 0 }])),
    };
    return { candidates: selectEmail(threads, deals, ctx) };
  },
};
```

- [ ] **Step 6: Export `assignmentHref` from `src/lib/queue.ts`**

Change the line `function assignmentHref(link: AssignmentLink, source: string): string {` to:

```ts
export function assignmentHref(link: AssignmentLink, source: string): string {
```

- [ ] **Step 7: Write `src/lib/triage/feeds/tasks.ts`**

```ts
import { allTasks, type TaskRecord } from "@/lib/stores/tasks";
import { allAssignments, type Assignment } from "@/lib/stores/assignments";
import { assignmentHref } from "@/lib/queue";
import { sameName } from "@/lib/quote-approval-rules";
import { dayDiff, dayKey, nextDayKey } from "../clock";
import type { OpenWork } from "../dedupe";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact, TriageSource } from "../types";
import type { FeedCtx, FeedResult, TriageFeed } from "./context";

/** Spec 3 adds `priority` (high|normal|low) to tasks and assignments; read it only when present. */
export function tierOf(rec: unknown): "high" | "low" | null {
  const p = (rec as { priority?: unknown } | null | undefined)?.priority;
  return p === "high" || p === "low" ? p : null;
}

/** Overdue / due today / due tomorrow by Chicago calendar day. 0 = undated → none. */
export function taskDueFacts(due: number, now: number): TriageFact[] {
  if (!due) return [];
  const today = dayKey(now);
  const d = dayKey(due);
  if (d < today) return [{ kind: "task_overdue", days: dayDiff(d, today) }];
  if (d === today) return [{ kind: "task_due_today" }];
  if (d === nextDayKey(today)) return [{ kind: "task_due_tomorrow" }];
  return [];
}

export function taskHref(t: Pick<TaskRecord, "projectId" | "threadId" | "leadId">): string {
  if (t.projectId) return `/projects/${encodeURIComponent(t.projectId)}`;
  if (t.threadId) return `/inbox?thread=${encodeURIComponent(t.threadId)}`;
  if (t.leadId) return `/leads?lead=${encodeURIComponent(t.leadId)}`;
  return "/calendar";
}

/**
 * Open tasks and Queue assignments assigned to me: overdue, due today, due
 * tomorrow, or at risk (spec 3, through the hook). Every open item — on the
 * list or not — is returned as open work for the duplicate collapse.
 */
export function selectTasks(
  input: { tasks: readonly TaskRecord[]; assignments: readonly Assignment[]; atRisk: ReadonlySet<string> },
  ctx: Pick<FeedCtx, "me" | "now">
): FeedResult {
  const candidates: TriageCandidate[] = [];
  const openWork: OpenWork[] = [];
  const add = (key: string, source: TriageSource, title: string, sub: string, href: string, due: number, createdAt: number, rec: unknown) => {
    openWork.push({ key, title });
    const facts = taskDueFacts(due, ctx.now);
    if (input.atRisk.has(key)) facts.push({ kind: "task_at_risk" });
    if (!facts.length) return;
    const tier = tierOf(rec);
    if (tier) facts.push({ kind: "task_tier", tier });
    candidates.push({ key, source, title, sub, href, since: due || createdAt || 0, facts });
  };
  for (const t of input.tasks) {
    if (t.status === "done" || !sameName(t.assigneeName, ctx.me.name)) continue;
    add(triageKey.task(t.id), "task", t.title, t.projectId ? t.section || "" : "", taskHref(t), t.dueAt ?? 0, t.createdAt, t);
  }
  for (const a of input.assignments) {
    if (a.done || !sameName(a.assignee, ctx.me.name)) continue;
    const sub = a.link?.label || (sameName(a.createdBy, ctx.me.name) ? "Self" : `from ${a.createdBy}`);
    add(triageKey.assignment(a.id), "assignment", a.title, sub, assignmentHref(a.link, a.source || ""), a.dueDate || 0, a.createdAt, a);
  }
  return { candidates, openWork };
}

export const tasksFeed: TriageFeed = {
  source: "task",
  async load(ctx) {
    const [tasks, assignments, atRisk] = await Promise.all([allTasks(), allAssignments(), ctx.hooks.atRisk(ctx.me, ctx.now)]);
    return selectTasks({ tasks, assignments, atRisk }, ctx);
  },
};
```

- [ ] **Step 8: Write `src/lib/triage/feeds/leads.ts`**

```ts
import { getAll as allLeads, isOpen, slaDeadline, STALE_DAYS, type LeadRecord } from "@/lib/stores/leads";
import { sameName } from "@/lib/quote-approval-rules";
import { displayLeadNumber } from "@/lib/estimate-number";
import { money } from "@/lib/format";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

const DAY = 86_400_000;
export const SLA_SOON_MS = 4 * 3_600_000;

/**
 * followUpInfo()'s precedence (stores/leads.ts) re-done against an explicit
 * `now` (the store reads Date.now()): SLA breached wins outright; else SLA
 * due within 4 h and/or next action overdue; stale only when nothing else.
 */
export function leadFacts(l: LeadRecord, now: number): { facts: TriageFact[]; since: number } {
  const facts: TriageFact[] = [];
  let since = l.createdAt || 0;
  if (!l.firstContactAt && l.stage === "new") {
    const ms = slaDeadline(l) - now;
    if (ms < 0) return { facts: [{ kind: "lead_sla_breached" }], since };
    if (ms <= SLA_SOON_MS) facts.push({ kind: "lead_sla_due_soon", minutes: Math.max(1, Math.ceil(ms / 60_000)) });
  }
  if (l.nextActionAt && l.nextActionAt < now) {
    facts.push({ kind: "lead_next_action_overdue" });
    since = l.nextActionAt;
  }
  if (!facts.length) {
    const last = l.lastActivityAt || l.createdAt || now;
    const days = Math.floor((now - last) / DAY);
    if (days >= STALE_DAYS) {
      facts.push({ kind: "lead_stale", days });
      since = last;
    }
  }
  return { facts, since };
}

/** Open leads I own, plus unowned ones — the bell's `unownedOrMine` rule. */
export function selectLeads(leads: readonly LeadRecord[], ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const out: TriageCandidate[] = [];
  for (const l of leads) {
    if (!isOpen(l)) continue;
    if (l.owner && !sameName(l.owner, ctx.me.name)) continue;
    const { facts, since } = leadFacts(l, ctx.now);
    if (!facts.length) continue;
    out.push({
      key: triageKey.lead(l.id),
      source: "lead",
      title: l.org || l.contact || displayLeadNumber(l),
      sub: [l.interest, l.value ? money(l.value) : "", l.owner ? "" : "unassigned"].filter(Boolean).join(" · "),
      href: `/leads?lead=${encodeURIComponent(l.id)}`,
      since,
      facts,
    });
  }
  return out;
}

export const leadsFeed: TriageFeed = {
  source: "lead",
  async load(ctx) {
    return { candidates: selectLeads(await allLeads(), ctx) };
  },
};
```

- [ ] **Step 9: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint src/lib/triage src/lib/queue.ts scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/triage src/lib/queue.ts scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): feed seam with optional spec 1–3 hooks; email, task and lead feeds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Site visit, quote and renewal feeds

**Files:**
- Create: `src/lib/triage/feeds/visits.ts`, `src/lib/triage/feeds/quotes.ts`, `src/lib/triage/feeds/renewals.ts`
- Modify: `scripts/test-morning-triage.ts` (add `triageFeedChecksB`), harness

**Interfaces:**
- Consumes: `FeedCtx`, `TriageFeed` (Task 4); `triageKey`, `dayKey`; stores `site-visits` (`allVisits`, `SiteVisit`), `quotes` (`getAll`, `Quote`), `flame-jobs` (`renewals`), `inspections` (`renewals`); `quoteAwaitsApprovalBy`, `quoteBackFromReview`, `sameName` (quote-approval-rules); `portalBellGroups` (portal-bell); `quoteBuilderHref`; `displayQuoteNumber`; `firstName`.
- Produces:
  - `visits.ts`: `visitAttendees(v): string[]`, `todaysVisitsFor(visits, me: string, now): SiteVisit[]`, `selectVisits(visits, flags, ctx)`, `visitsFeed`.
  - `quotes.ts`: `selectQuotes(quotes, ctx)`, `quotesFeed`.
  - `renewals.ts`: `type RenewalRow = { kind: RenewalKind; id; customer; venue; owner; contacted: boolean; renewal: { state: string; days: number; dueAt: number | null } }`, `selectRenewals(rows, ctx)`, `renewalsFeed`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (imports: `selectVisits, todaysVisitsFor, visitAttendees` from `@/lib/triage/feeds/visits`; `selectQuotes` from `@/lib/triage/feeds/quotes`; `selectRenewals` from `@/lib/triage/feeds/renewals`; `type SiteVisit` from `@/lib/stores/site-visits`; `type Quote` from `@/lib/stores/quotes`):

```ts
export async function triageFeedChecksB(ok: Ok): Promise<void> {
  /* ---- site visits ---- */
  const MON_14 = Date.UTC(2026, 9, 12, 19);
  const TUE_NOON = Date.UTC(2026, 9, 13, 17);
  const visit = (id: string, startAt: number | null, extra: Record<string, unknown> = {}) =>
    ({
      id, customer: `Cust ${id}`, venue: "Main Stage", address: "1 Main St", reason: "Site survey / measure",
      startAt, endAt: startAt ? startAt + H : null, assignedTo: ME.name, stage: "scheduled", ...extra,
    }) as unknown as SiteVisit;
  const vs = [
    visit("V1", MON_14),
    visit("V2", MON_14, { assignedTo: "Someone Else", attendees: ["dana tester"] }),
    visit("V3", MON_14, { assignedTo: "Someone Else" }),
    visit("V4", TUE_NOON),
    visit("V5", MON_14, { stage: "done" }),
    visit("V6", null, { stage: "open" }),
  ];
  const mine = todaysVisitsFor(vs, ME.name, MON_10);
  ok(mine.map((v) => v.id).join(",") === "V1,V2", "visits feed: today's, not done, where I'm the lead or an attendee");
  ok(visitAttendees(vs[0]).length === 0 && visitAttendees(vs[1]).join() === "dana tester", "visits feed: attendees are read only when present (pre-spec-2 visits have none)");
  const vc = selectVisits(mine, new Map([["V2", ["Unverified address", "Overlaps SV-9"]]]), { me: ME, now: MON_10 });
  ok(
    JSON.stringify(vc[0].facts) === JSON.stringify([{ kind: "visit_today", startAt: MON_14 }]) &&
      JSON.stringify(vc[1].facts[1]) === JSON.stringify({ kind: "visit_flag", label: "Unverified address · Overlaps SV-9" }),
    "visits feed: one +10 flag fact only when a flag provider reports flags"
  );
  ok(vc[0].href === "/calendar?view=day" && vc[0].title === "Cust V1 — Main Stage" && vc[0].sub === "Site survey / measure · 1 Main St", "visits feed: the row opens today's calendar");

  /* ---- quotes ---- */
  const q = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, name: `Quote ${id}`, customer: "Acme", owner: "Someone Else", status: "draft", value: 1000, sections: [], updatedAt: MON_10 - H, ...extra }) as unknown as Quote;
  const qs = [
    q("Q1", { review: { state: "in_review", submittedAt: MON_10 - 3 * H, submittedBy: "Someone Else" } }),
    q("Q2", { owner: ME.name, review: { state: "changes", decidedBy: "Jeff Chesebro", note: "fix" } }),
    q("Q3", { owner: ME.name, source: "portal-catalog", portalReview: { at: 1 } }),
    q("Q4", { owner: ME.name, review: { state: "in_review", submittedAt: 1 } }),
    q("Q5"),
  ];
  const approver = { ...ME, canApprove: true };
  const qr = selectQuotes(qs, { me: approver, now: MON_10 });
  ok(qr.map((c) => c.key).join(",") === "quote:Q1,quote:Q2,quote:Q3", "quotes feed: awaiting my approval, sent back to me, portal quote to review");
  ok(qr[0].facts[0].kind === "quote_awaiting_approval" && qr[0].since === MON_10 - 3 * H && qr[0].href === "/estimator?id=Q1", "quotes feed: approval rows open the quote's own builder; age = submitted");
  ok(qr[1].facts[0].kind === "quote_sent_back" && qr[2].facts[0].kind === "portal_quote_review" && qr[2].href.startsWith("/quotes/portal"), "quotes feed: sent-back and portal-review rows");
  ok(!selectQuotes(qs, { me: ME, now: MON_10 }).some((c) => c.key === "quote:Q1"), "quotes feed: a non-approver doesn't see another's review unless assigned to them");

  /* ---- renewals ---- */
  const rr = selectRenewals(
    [
      { kind: "flame", id: "FT-1", customer: "Acme", venue: "Main", owner: ME.name, contacted: false, renewal: { state: "overdue", days: 4, dueAt: MON_10 - 4 * D } },
      { kind: "inspection", id: "INS-1", customer: "Beta", venue: "Gym", owner: ME.name, contacted: false, renewal: { state: "due_soon", days: 20, dueAt: MON_10 + 20 * D } },
      { kind: "flame", id: "FT-2", customer: "C", venue: "", owner: ME.name, contacted: true, renewal: { state: "overdue", days: 2, dueAt: 1 } },
      { kind: "flame", id: "FT-3", customer: "D", venue: "", owner: "Someone Else", contacted: false, renewal: { state: "overdue", days: 2, dueAt: 1 } },
      { kind: "flame", id: "FT-4", customer: "E", venue: "", owner: ME.name, contacted: false, renewal: { state: "upcoming", days: 90, dueAt: 1 } },
    ],
    { me: ME, now: MON_10 }
  );
  ok(rr.map((c) => c.key).join(",") === "renewal:flame:FT-1,renewal:inspection:INS-1", "renewals feed: my un-contacted renewals in the outreach window or past due");
  ok(
    JSON.stringify(rr.map((c) => c.facts)) === JSON.stringify([[{ kind: "renewal_past_due", days: 4 }], [{ kind: "renewal_window", days: 20 }]]) &&
      rr[0].href === "/flame-tests?rv=contact" && rr[1].href === "/inspections?rv=contact",
    "renewals feed: past due vs in window; rows open the #37 to-contact worklist"
  );
}
```

Harness: add `triageFeedChecksB` to the import and `  .then(() => triageFeedChecksB(ok))` after the `triageFeedChecksA` line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/triage/feeds/visits'`.

- [ ] **Step 3: Write `src/lib/triage/feeds/visits.ts`**

```ts
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { sameName } from "@/lib/quote-approval-rules";
import { dayKey } from "../clock";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

/** Spec 2 adds `attendees: string[]` (names); until then a visit has only its lead, `assignedTo`. */
export function visitAttendees(v: SiteVisit): string[] {
  const a = (v as SiteVisit & { attendees?: unknown }).attendees;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
}

/** Today's (Chicago) visits not yet done where `me` is the lead or an attendee. */
export function todaysVisitsFor(visits: readonly SiteVisit[], me: string, now: number): SiteVisit[] {
  const today = dayKey(now);
  return visits.filter(
    (v) =>
      !!v.startAt &&
      dayKey(v.startAt) === today &&
      v.stage !== "done" &&
      (sameName(v.assignedTo, me) || visitAttendees(v).some((n) => sameName(n, me)))
  );
}

export function selectVisits(
  visits: readonly SiteVisit[],
  flags: ReadonlyMap<string, readonly string[]>,
  _ctx: Pick<FeedCtx, "me" | "now">
): TriageCandidate[] {
  return visits.map((v) => {
    const facts: TriageFact[] = [{ kind: "visit_today", startAt: v.startAt || 0 }];
    const f = flags.get(v.id) ?? [];
    if (f.length) facts.push({ kind: "visit_flag", label: f.join(" · ") });
    return {
      key: triageKey.visit(v.id),
      source: "visit",
      title: `${v.customer || v.id}${v.venue ? ` — ${v.venue}` : ""}`,
      sub: [v.reason, v.address].filter(Boolean).join(" · "),
      href: "/calendar?view=day",
      since: v.startAt || 0,
      facts,
    };
  });
}

export const visitsFeed: TriageFeed = {
  source: "visit",
  async load(ctx) {
    const mine = todaysVisitsFor(await allVisits(), ctx.me.name, ctx.now);
    const flags = mine.length ? await ctx.hooks.visitFlags(mine.map((v) => v.id), ctx.now) : new Map<string, readonly string[]>();
    return { candidates: selectVisits(mine, flags, ctx) };
  },
};
```

If eslint flags the unused `_ctx` parameter, remove the parameter from `selectVisits` and from both of its call sites (the feed above and the test).

- [ ] **Step 4: Write `src/lib/triage/feeds/quotes.ts`**

```ts
import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { quoteAwaitsApprovalBy, quoteBackFromReview } from "@/lib/quote-approval-rules";
import { portalBellGroups } from "@/lib/portal-bell";
import { quoteBuilderHref } from "@/lib/quote-links";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { firstName } from "@/lib/team";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

/**
 * The approval bell's own rules (#284 quote-approval-rules.ts) and the
 * portal bell's review group (#245 portal-bell.ts, mine or unassigned):
 * awaiting my approval, sent back to me as owner, portal quote to review.
 * One row per quote; a quote matching two rules carries both facts.
 */
export function selectQuotes(quotes: readonly Quote[], ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const me = ctx.me.name;
  const byKey = new Map<string, TriageCandidate>();
  const add = (q: Quote, fact: TriageFact, href: string, since: number, sub: string) => {
    const key = triageKey.quote(q.id);
    const cur = byKey.get(key);
    if (cur) {
      cur.facts.push(fact);
      return;
    }
    byKey.set(key, { key, source: "quote", title: q.name || displayQuoteNumber(q), sub, href, since, facts: [fact] });
  };
  for (const q of quotes) {
    if (quoteAwaitsApprovalBy(q, me, ctx.me.canApprove)) {
      add(q, { kind: "quote_awaiting_approval" }, quoteBuilderHref(q), q.review?.submittedAt || q.updatedAt || 0,
        `${displayQuoteNumber(q)} · ${q.customer || ""} · from ${firstName(q.review?.submittedBy || q.owner || "")}`);
    }
    if (quoteBackFromReview(q, me) === "changes") {
      add(q, { kind: "quote_sent_back" }, quoteBuilderHref(q), q.updatedAt || 0,
        `${displayQuoteNumber(q)} · sent back by ${firstName(q.review?.decidedBy || "")}`);
    }
  }
  const review = new Map(portalBellGroups([...quotes], me, ctx.now).review.map((i) => [i.id, i.href]));
  for (const q of quotes) {
    const href = review.get(q.id);
    if (href) add(q, { kind: "portal_quote_review" }, href, q.updatedAt || 0, `${q.customer || ""} · waiting on a Peak price`);
  }
  return [...byKey.values()];
}

export const quotesFeed: TriageFeed = {
  source: "quote",
  async load(ctx) {
    return { candidates: selectQuotes(await allQuotes(), ctx) };
  },
};
```

If tsc reports `review.decidedBy` / `review.submittedBy` / `review.submittedAt` missing on `Quote["review"]`, read them as `(q.review as { decidedBy?: string } | null | undefined)?.decidedBy` (nav-counts.ts reads the same fields).

- [ ] **Step 5: Write `src/lib/triage/feeds/renewals.ts`**

```ts
import { renewals as flameRenewals } from "@/lib/stores/flame-jobs";
import { renewals as inspectionRenewals } from "@/lib/stores/inspections";
import { sameName } from "@/lib/quote-approval-rules";
import { triageKey, type RenewalKind } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

export type RenewalRow = {
  kind: RenewalKind;
  id: string;
  customer: string;
  venue: string;
  owner: string;
  /** #37 outreach already stamped this cycle → it's in "Awaiting reply", not "To contact". */
  contacted: boolean;
  renewal: { state: string; days: number; dueAt: number | null };
};

/** The #37 "To contact" worklists, mine by job owner: past due (overdue) or in the outreach window (due_soon). */
export function selectRenewals(rows: readonly RenewalRow[], ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const out: TriageCandidate[] = [];
  for (const r of rows) {
    if (r.contacted || !sameName(r.owner, ctx.me.name)) continue;
    const fact: TriageFact | null =
      r.renewal.state === "overdue"
        ? { kind: "renewal_past_due", days: r.renewal.days }
        : r.renewal.state === "due_soon"
          ? { kind: "renewal_window", days: r.renewal.days }
          : null;
    if (!fact) continue;
    out.push({
      key: triageKey.renewal(r.kind, r.id),
      source: "renewal",
      title: `${r.kind === "flame" ? "Flame test" : "Inspection"} renewal: ${r.customer || r.id}`,
      sub: r.venue || "",
      href: r.kind === "flame" ? "/flame-tests?rv=contact" : "/inspections?rv=contact",
      since: r.renewal.dueAt || 0,
      facts: [fact],
    });
  }
  return out;
}

export const renewalsFeed: TriageFeed = {
  source: "renewal",
  async load(ctx) {
    const [flames, inspections] = await Promise.all([flameRenewals({ dueOnly: true }), inspectionRenewals({ dueOnly: true })]);
    const rows: RenewalRow[] = [
      ...flames.map((j) => ({ kind: "flame" as const, id: j.id, customer: j.customer, venue: j.venue, owner: j.owner, contacted: !!j.renewalOutreach, renewal: j._renewal })),
      ...inspections.map((r) => ({ kind: "inspection" as const, id: r.id, customer: r.customer, venue: r.venue, owner: r.owner, contacted: !!r.renewalOutreach, renewal: r._renewal })),
    ];
    return { candidates: selectRenewals(rows, ctx) };
  },
};
```

- [ ] **Step 6: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint src/lib/triage/feeds scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/triage/feeds scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): site visit, quote and renewal feeds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Calls feed (CallTodoSource over Recordings) + feed registry

**Files:**
- Create: `src/lib/triage/feeds/calls.ts`, `src/lib/triage/feeds/index.ts`
- Modify: `scripts/test-morning-triage.ts` (add `triageCallChecks`), harness

**Interfaces:**
- Consumes: `matchTranscriptLine`, `clipLine`, `TranscriptSegment` (Task 3); `chicagoShortDate`; `triageKey`; `FeedCtx`, `TriageFeed`; `allRecordings`, `RecordingRecord` (stores/recordings); `matchAssignee` (krisp/derive); every feed from Tasks 4–5.
- Produces:
  - `calls.ts`: `type CallTodo = { meetingId; itemKey; title; dueDate: string | null; assigneeIsMe: boolean; meetingTitle; meetingAt: number; segments: readonly TranscriptSegment[]; speakerNames: Readonly<Record<string,string>>; meetingHref: string; segmentHref: (index: number) => string }`, `interface CallTodoSource { id: string; load(ctx: FeedCtx): Promise<CallTodo[]> }`, `CALL_WINDOW_MS`, `speakerNamesOf(rec)`, `recordingTodos(recs, ctx)`, `selectCalls(todos)`, `recordingsCallSource`, `CALL_SOURCES`, `callsFeed`.
  - `index.ts`: `FEEDS: readonly TriageFeed[]` in order email, call, task, lead, visit, quote, renewal.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (imports: `CALL_WINDOW_MS, recordingTodos, selectCalls` from `@/lib/triage/feeds/calls`; `FEEDS` from `@/lib/triage/feeds`; `normalizeRecording, type RecordingRecord` from `@/lib/stores/recordings`):

```ts
export async function triageCallChecks(ok: Ok): Promise<void> {
  const USERS = [{ id: ME.id, name: ME.name }, { id: "u-jeff", name: "Jeff Chesebro" }];
  const item = (key: string, title: string, assigneeName: string | null, disposition = "pending") => ({ key, title, assigneeName, dueDate: null, disposition, assignmentId: null });
  const rec = (id: string, startedAt: number, by: string, items: ReturnType<typeof item>[], segments: { speaker: number; text: string; start: number; end: number }[] = []) =>
    normalizeRecording({
      id, title: `Walkthrough ${id}`, startedAt, createdAt: startedAt, recordedByUserId: by,
      recordedByName: by === ME.id ? ME.name : "Jeff Chesebro", actionItems: items,
      transcript: { language: "en", speakers: { "1": { name: "Pat Owner" } }, segments },
    } as unknown as Partial<RecordingRecord> & { id: string });
  const recs = [
    rec("REC-1", MON_10 - 2 * D, ME.id,
      [item("k1", "Send revised rigging drawings to architect", null), item("k2", "Order motor", "Jeff"), item("k3", "Book lift", null, "accepted"), item("k4", "Call the fire marshal", null, "dismissed")],
      [{ speaker: 1, text: "I'll send the revised rigging drawings to the architect by Friday.", start: 754, end: 760 }]),
    rec("REC-2", MON_10 - 3 * D, "u-jeff", [item("k5", "Confirm trim heights with the venue", "Dana"), item("k6", "Quote spare cable", "Jeff")]),
    rec("REC-3", MON_10 - 8 * D, ME.id, [item("k7", "Old thing to do", null)]),
  ];
  const todos = recordingTodos(recs, { me: ME, now: MON_10, users: USERS });
  ok(todos.map((t) => `${t.meetingId}:${t.itemKey}`).join(",") === "REC-1:k1,REC-2:k5", "calls feed: pending items only, on my recordings or naming me, last 7 days — accepted / dismissed / teammates' items stay off");
  ok(!todos[0].assigneeIsMe && todos[1].assigneeIsMe, "calls feed: knows when a to-do names me");
  const cc = selectCalls(todos);
  const l0 = cc[0].callLine;
  ok(
    cc[0].key === "call:REC-1:k1" && !!l0 && l0.found && l0.speaker === "Pat Owner" && l0.start === 754 && l0.href === "/recordings/REC-1?tab=transcript&seg=0" && cc[0].href === l0.href,
    "calls feed: the matched transcript line links to that moment in the recording"
  );
  const l1 = cc[1].callLine;
  ok(!!l1 && !l1.found && l1.href === "/recordings/REC-2?tab=actions" && cc[1].href === "/recordings/REC-2?tab=actions", "calls feed: no matching line → 'Source line not found — open the meeting'");
  ok(cc[0].facts.map((f) => f.kind).join(",") === "call_todo" && cc[1].facts.map((f) => f.kind).join(",") === "call_todo,call_names_me", "calls feed: +10 when the to-do names me");
  ok(cc[0].mention === `Walkthrough REC-1 (${chicagoShortDate(MON_10 - 2 * D)})`, "calls feed: the meeting + date used by 'Also mentioned in'");
  ok(CALL_WINDOW_MS === 7 * D, "calls feed: the window is 7 days");
  ok(FEEDS.map((f) => f.source).join(",") === "email,call,task,lead,visit,quote,renewal", "feeds: all seven sources are registered, one module each");
}
```

Harness: add `triageCallChecks` to the import and `  .then(() => triageCallChecks(ok))` after the `triageFeedChecksB` line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/triage/feeds/calls'`.

- [ ] **Step 3: Write `src/lib/triage/feeds/calls.ts`**

```ts
import { allRecordings, type RecordingRecord } from "@/lib/stores/recordings";
import { matchAssignee } from "@/lib/krisp/derive";
import { sameName } from "@/lib/quote-approval-rules";
import { chicagoShortDate } from "../clock";
import { triageKey } from "../keys";
import { clipLine, matchTranscriptLine, type TranscriptSegment } from "../transcript-match";
import type { CallLine, TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

const DAY = 86_400_000;
export const CALL_WINDOW_MS = 7 * DAY;

/** One undecided call to-do, whatever system it came from. */
export type CallTodo = {
  meetingId: string;
  itemKey: string;
  title: string;
  dueDate: string | null;
  assigneeIsMe: boolean;
  meetingTitle: string;
  meetingAt: number;
  segments: readonly TranscriptSegment[];
  speakerNames: Readonly<Record<string, string>>;
  meetingHref: string;
  segmentHref: (index: number) => string;
};

/**
 * A source of call to-dos. Recordings (`src/lib/stores/recordings.ts`) is
 * the one on main; when Krisp #323 meetings land, a second source reading
 * `MeetingTodo`s with no decision is added to CALL_SOURCES with this shape.
 */
export interface CallTodoSource {
  id: string;
  load(ctx: FeedCtx): Promise<CallTodo[]>;
}

export function speakerNamesOf(rec: RecordingRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, p] of Object.entries(rec.transcript?.speakers ?? {})) {
    const n = (p?.name && String(p.name).trim()) || (p?.email && String(p.email)) || "";
    if (n) out[k] = n;
  }
  return out;
}

/**
 * Pending action items from recordings in the last 7 days that are mine:
 * the item names me (matchAssignee — the same matcher Accept uses), or I
 * recorded the meeting and the item names nobody on the team.
 */
export function recordingTodos(recs: readonly RecordingRecord[], ctx: Pick<FeedCtx, "me" | "now" | "users">): CallTodo[] {
  const out: CallTodo[] = [];
  for (const rec of recs) {
    const at = rec.startedAt || rec.createdAt || 0;
    if (!at || ctx.now - at > CALL_WINDOW_MS || at > ctx.now + DAY) continue;
    const recordedByMe = rec.recordedByUserId === ctx.me.id || sameName(rec.recordedByName, ctx.me.name);
    const segments = Array.isArray(rec.transcript?.segments) ? rec.transcript.segments : [];
    const enc = encodeURIComponent(rec.id);
    for (const item of rec.actionItems) {
      if (item.disposition !== "pending") continue;
      const who = matchAssignee(item.assigneeName, ctx.users);
      const assigneeIsMe = who?.id === ctx.me.id;
      if (!assigneeIsMe && !(recordedByMe && !who)) continue;
      out.push({
        meetingId: rec.id,
        itemKey: item.key,
        title: item.title,
        dueDate: item.dueDate,
        assigneeIsMe,
        meetingTitle: rec.title || rec.customer || rec.id,
        meetingAt: at,
        segments,
        speakerNames: speakerNamesOf(rec),
        meetingHref: `/recordings/${enc}?tab=actions`,
        segmentHref: (i) => `/recordings/${enc}?tab=transcript&seg=${i}`,
      });
    }
  }
  return out;
}

export function selectCalls(todos: readonly CallTodo[]): TriageCandidate[] {
  return todos.map((t) => {
    const facts: TriageFact[] = [{ kind: "call_todo" }];
    if (t.assigneeIsMe) facts.push({ kind: "call_names_me" });
    const m = matchTranscriptLine(t.title, t.segments);
    const callLine: CallLine = m
      ? { found: true, speaker: t.speakerNames[String(m.speaker)] || `Speaker ${m.speaker + 1}`, text: clipLine(m.text), start: m.start, href: t.segmentHref(m.index) }
      : { found: false, href: t.meetingHref };
    return {
      key: triageKey.call(t.meetingId, t.itemKey),
      source: "call",
      title: t.title,
      sub: [`From ${t.meetingTitle}`, t.dueDate ? `due ${t.dueDate}` : ""].filter(Boolean).join(" · "),
      href: callLine.href,
      since: t.meetingAt,
      facts,
      callLine,
      mention: `${t.meetingTitle} (${chicagoShortDate(t.meetingAt)})`,
    };
  });
}

export const recordingsCallSource: CallTodoSource = {
  id: "recordings",
  async load(ctx) {
    return recordingTodos(await allRecordings(), ctx);
  },
};

export const CALL_SOURCES: readonly CallTodoSource[] = [recordingsCallSource];

export const callsFeed: TriageFeed = {
  source: "call",
  async load(ctx) {
    const lists = await Promise.all(CALL_SOURCES.map((s) => s.load(ctx)));
    return { candidates: selectCalls(lists.flat()) };
  },
};
```

- [ ] **Step 4: Write `src/lib/triage/feeds/index.ts`**

```ts
import type { TriageFeed } from "./context";
import { emailFeed } from "./email";
import { callsFeed } from "./calls";
import { tasksFeed } from "./tasks";
import { leadsFeed } from "./leads";
import { visitsFeed } from "./visits";
import { quotesFeed } from "./quotes";
import { renewalsFeed } from "./renewals";

/** Every source the triage list reads, one module each (spec "Feeds"). Server-only. */
export const FEEDS: readonly TriageFeed[] = [emailFeed, callsFeed, tasksFeed, leadsFeed, visitsFeed, quotesFeed, renewalsFeed];
```

- [ ] **Step 5: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint src/lib/triage/feeds scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/triage/feeds scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): calls feed over Recordings behind CallTodoSource; feed registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Build, snapshots, marks, liveness and the view (lazy build + fallback)

**Files:**
- Create: `src/lib/triage/build.ts`, `src/lib/triage/store.ts`, `src/lib/triage/view.ts`, `src/lib/triage/liveness.ts`, `src/lib/triage/service.ts`
- Modify: `scripts/test-morning-triage.ts` (add `triageSnapshotChecks`), harness

**Interfaces:**
- Consumes: everything above; doc-store (`getDoc`, `upsertDoc`, `listDocsByField`, `getDocRows`); `activeUsers`, `userCan` (lib/users); `can` (team); `normalizeRecording`; `portalBellGroups`; `quoteAwaitsApprovalBy`, `quoteBackFromReview`, `sameName`.
- Produces:
  - `build.ts`: `gatherCandidates(ctx, feeds): Promise<{ candidates; openWork; errors: FeedError[] }>`, `toSnapshotRows(candidates, openWork): SnapshotRow[]`, `buildRows(ctx, feeds = FEEDS): Promise<{ rows; errors }>`.
  - `store.ts`: `getSnapshot(id)`, `saveSnapshot(s)`, `markId(userId, key)`, `marksFor(userId)`, `setMark(m: Omit<TriageMark,"id">): Promise<TriageMark>` (never downgrades a dismiss).
  - `view.ts`: `type SlotRef = { snapshotId; day; slot }`, `HOME_LIMIT = 10`, `snoozeUntil(day): string`, `markHides(mark, cur): boolean`, `visibleRows(rows, marks, closed, cur): SnapshotRow[]`.
  - `liveness.ts`: `type LiveDocs`, `closedKeys(rows, docs, me, now): Set<string>`, `loadClosedKeys(rows, me, now): Promise<Set<string>>`.
  - `service.ts`: `LIVE_NOTE`, `triageNow()`, `triageUserFromSession(u)`, `computeSnapshot(me, at, now, builtBy, opts?)`, `buildSlotForAll(slot, now, opts?)`, `type TriageView = { snapshot; rows; note }`, `loadTriageView(me, now, opts?: { feeds?; save? })`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (imports: `createFixture, fixtureId, registerFixture` from `./test-fixtures`; `setTaskStatus` from `@/lib/stores/tasks` (add to the existing tasks import); `getSnapshot, markId, setMark` from `@/lib/triage/store`; `buildSlotForAll, LIVE_NOTE, loadTriageView, type TriageView` from `@/lib/triage/service`; `closedKeys` from `@/lib/triage/liveness`; `markHides, snoozeUntil, visibleRows` from `@/lib/triage/view`; `gatherCandidates, toSnapshotRows` from `@/lib/triage/build`; `NO_HOOKS` from `@/lib/triage/hooks`; `type TriageFeed` from `@/lib/triage/feeds/context`; `type SnapshotRow` from `@/lib/triage/types`):

```ts
export async function triageSnapshotChecks(ok: Ok): Promise<void> {
  /* ---- pure: marks ---- */
  const cur = { snapshotId: "u:2026-10-12:morning", day: "2026-10-12", slot: "morning" as const };
  const noonRef = { snapshotId: "u:2026-10-12:midday", day: "2026-10-12", slot: "midday" as const };
  ok(markHides({ kind: "dismiss", snapshotId: null, until: null }, cur), "marks: dismiss hides for good");
  ok(markHides({ kind: "done", snapshotId: cur.snapshotId, until: null }, cur) && !markHides({ kind: "done", snapshotId: cur.snapshotId, until: null }, noonRef), "marks: done-for-today hides only in the snapshot it was marked in");
  ok(
    snoozeUntil("2026-10-12") === "2026-10-13:0" &&
      markHides({ kind: "snooze", snapshotId: null, until: "2026-10-13:0" }, noonRef) &&
      !markHides({ kind: "snooze", snapshotId: null, until: "2026-10-13:0" }, { snapshotId: "x", day: "2026-10-13", slot: "morning" }),
    "marks: a snooze holds through midday and returns the next morning"
  );
  const row = (key: string): SnapshotRow => ({ key, source: parseTriageKey(key)!.source, title: key, sub: "", href: "/", score: 1, reason: "", callLine: null, also: [] });
  ok(
    visibleRows([row("lead:a"), row("lead:b"), row("task:c")], [{ id: "m", userId: "u", key: "lead:a", kind: "dismiss", at: 1, snapshotId: null, until: null }], new Set(["task:c"]), cur).map((r) => r.key).join() === "lead:b",
    "view: marked and closed rows are filtered out"
  );

  /* ---- pure: build ---- */
  const g = await gatherCandidates({ me: ME, now: MON_10, users: [], hooks: NO_HOOKS }, [
    { source: "lead", load: async () => ({ candidates: [cand("lead:a", "lead", [{ kind: "lead_stale", days: 6 }])] }) },
    { source: "email", load: async () => { throw new Error("boom"); } },
    { source: "visit", load: (() => { throw new Error("sync boom"); }) as TriageFeed["load"] },
  ]);
  ok(
    g.candidates.length === 1 &&
      g.errors.map((e) => e.message).join("|") === "Email couldn't be read — list may be incomplete|Site visits couldn't be read — list may be incomplete",
    "build: a failing feed (async or sync throw) doesn't fail the list"
  );
  const rows = toSnapshotRows(
    [cand("lead:a", "lead", [{ kind: "lead_stale", days: 6 }]), cand("lead:a", "lead", [{ kind: "lead_sla_breached" }]), cand("task:t", "task", [{ kind: "task_due_today" }])],
    []
  );
  ok(rows.map((r) => r.key).join(",") === "lead:a,task:t" && rows[0].score === 60 && rows[0].reason === "First response overdue" && Array.isArray(rows[0].also), "build: rows are ranked, one per key, with score and reason");

  /* ---- pure: liveness ---- */
  const lrows = ["task:T1", "task:T2", "asg:A1", "email:C1", "email:C2", "call:R1:k1", "call:R1:k2", "quote:Q1", "lead:L1"].map(row);
  const closed = closedKeys(
    lrows,
    {
      tasks: new Map([["T1", { status: "done" as const }], ["T2", { status: "open" as const }]]),
      assignments: new Map([["A1", { done: false }]]),
      threads: new Map([
        ["C1", { status: "replied" as const, archived: false, assignedTo: ME.name }],
        ["C2", { status: "waiting_us" as const, archived: false, assignedTo: ME.name }],
      ]),
      recordings: new Map([["R1", { actionItems: [{ key: "k1", disposition: "accepted" }, { key: "k2", disposition: "pending" }] }]]),
      quotes: new Map([["Q1", { id: "Q1", owner: "Someone Else", status: "draft", review: { state: "approved" } } as unknown as Quote]]),
    },
    ME,
    MON_10
  );
  ok([...closed].sort().join(",") === "call:R1:k1,email:C1,quote:Q1,task:T1", "liveness: a done task, replied thread, decided to-do and approved quote are hidden; open ones and leads stay");

  /* ---- DB: lazy build, freeze, done-source, marks ---- */
  const U = { id: fixtureId("TRIAGE", "u1"), name: "Triage Tester", canApprove: false };
  const TASK = fixtureId("TRIAGE", "t1");
  const L = (s: string) => `lead:${fixtureId("TRIAGE", s)}`;
  await createFixture("tasks", normalizeTask({ id: TASK, title: "Send drawings", assigneeName: U.name, dueAt: MON_10 - 3 * D, status: "open", createdAt: 1 }));
  const feeds: TriageFeed[] = [
    { source: "lead", load: async () => ({ candidates: ["l1", "l2", "l3"].map((s, i) => cand(L(s), "lead", [{ kind: "lead_stale", days: 6 + i }])) }) },
    { source: "task", load: async () => ({ candidates: [cand(`task:${TASK}`, "task", [{ kind: "task_overdue", days: 3 }])], openWork: [{ key: `task:${TASK}`, title: "Send drawings" }] }) },
    { source: "email", load: async () => { throw new Error("boom"); } },
  ];
  const ids = {
    mon: snapshotId(U.id, "2026-10-12", "morning"),
    noon: snapshotId(U.id, "2026-10-12", "midday"),
    tue: snapshotId(U.id, "2026-10-13", "morning"),
    fri: snapshotId(U.id, "2026-10-16", "morning"),
  };
  for (const id of Object.values(ids)) registerFixture("triage_snapshots", id);
  for (const s of ["l1", "l2", "l3"]) registerFixture("triage_marks", markId(U.id, L(s)));
  const keysOf = (v: TriageView) => v.rows.map((r) => r.key);

  const v1 = await loadTriageView(U, MON_10, { feeds });
  const saved = await getSnapshot(ids.mon);
  ok(!!saved && saved.builtBy === "lazy" && saved.rows.length === 4 && v1.rows.length === 4, "snapshot: the first view after a slot boundary builds and saves the slot lazily");
  ok(v1.snapshot.errors.length === 1 && v1.snapshot.errors[0].message === "Email couldn't be read — list may be incomplete", "snapshot: a failing feed is noted and the rest still build");
  const v2 = await loadTriageView(U, MON_10 + H, { feeds: [] });
  ok(v2.snapshot.builtAt === MON_10 && v2.rows.length === 4, "snapshot: between runs the list is frozen");
  await setTaskStatus(TASK, "done");
  const v3 = await loadTriageView(U, MON_10 + H, { feeds: [] });
  ok(!keysOf(v3).includes(`task:${TASK}`) && v3.rows.length === 3, "snapshot: a row whose source is now done is hidden on render");

  await setMark({ userId: U.id, key: L("l1"), kind: "snooze", at: MON_10, snapshotId: ids.mon, until: snoozeUntil("2026-10-12") });
  await setMark({ userId: U.id, key: L("l2"), kind: "dismiss", at: MON_10, snapshotId: ids.mon, until: null });
  await setMark({ userId: U.id, key: L("l3"), kind: "done", at: MON_10, snapshotId: ids.mon, until: null });
  const am = keysOf(await loadTriageView(U, MON_10 + H, { feeds: [] }));
  ok(!am.includes(L("l1")) && !am.includes(L("l2")) && !am.includes(L("l3")), "marks: snoozed, dismissed and done-for-today rows hide in this snapshot");
  const noon = keysOf(await loadTriageView(U, MON_12, { feeds }));
  ok(!noon.includes(L("l1")) && !noon.includes(L("l2")) && noon.includes(L("l3")), "marks: at midday the snooze and dismiss hold; done-for-today returns in the new snapshot");
  const tue = keysOf(await loadTriageView(U, TUE_8, { feeds }));
  ok(tue.includes(L("l1")) && !tue.includes(L("l2")), "marks: a snooze returns the next morning; a dismiss is permanent");
  await setMark({ userId: U.id, key: L("l2"), kind: "snooze", at: TUE_8, snapshotId: ids.tue, until: "2026-10-14:0" });
  ok(!keysOf(await loadTriageView(U, TUE_8 + 3 * D, { feeds })).includes(L("l2")), "marks: a later mark never revives a dismissed row");

  /* ---- DB: live fallback ---- */
  const U2 = { id: fixtureId("TRIAGE", "u2"), name: "Triage Two", canApprove: false };
  const live = await loadTriageView(U2, MON_10, { feeds, save: async () => { throw new Error("db down"); } });
  ok(
    live.note === LIVE_NOTE && live.snapshot.builtBy === "live" && live.rows.length > 0 && !(await getSnapshot(snapshotId(U2.id, "2026-10-12", "morning"))),
    "snapshot: when the lazy build can't be saved the list is computed live, with a note"
  );

  /* ---- DB: cron build ---- */
  const U3 = { id: fixtureId("TRIAGE", "u3"), name: "Triage Three", canApprove: false };
  const s3 = snapshotId(U3.id, "2026-10-12", "midday");
  registerFixture("triage_snapshots", s3);
  const res = await buildSlotForAll("midday", MON_12, { users: [U3], feeds });
  const got = await getSnapshot(s3);
  ok(res.built === 1 && res.failed.length === 0 && got?.builtBy === "cron" && got.slot === "midday", "cron: buildSlotForAll writes each user's slot snapshot");
}
```

Harness: add `triageSnapshotChecks` to the import and `  .then(() => triageSnapshotChecks(ok))` after the calls line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/triage/store'` (or another new module).

- [ ] **Step 3: Write `src/lib/triage/build.ts`**

```ts
import { collapseDuplicates, type OpenWork } from "./dedupe";
import { rankCandidates } from "./rank";
import { feedErrorMessage, type FeedError, type SnapshotRow, type TriageCandidate } from "./types";
import type { FeedCtx, TriageFeed } from "./feeds/context";
import { FEEDS } from "./feeds";

/** Run every feed; a feed that throws (sync or async) becomes a FeedError, never a failed list. */
export async function gatherCandidates(
  ctx: FeedCtx,
  feeds: readonly TriageFeed[]
): Promise<{ candidates: TriageCandidate[]; openWork: OpenWork[]; errors: FeedError[] }> {
  const settled = await Promise.allSettled(feeds.map((f) => Promise.resolve().then(() => f.load(ctx))));
  const candidates: TriageCandidate[] = [];
  const openWork: OpenWork[] = [];
  const errors: FeedError[] = [];
  settled.forEach((s, i) => {
    const f = feeds[i];
    if (s.status === "fulfilled") {
      candidates.push(...s.value.candidates);
      openWork.push(...(s.value.openWork ?? []));
    } else {
      console.error(`[triage] ${f.source} feed failed`, s.reason);
      errors.push({ source: f.source, message: feedErrorMessage(f.source) });
    }
  });
  return { candidates, openWork, errors };
}

/** Collapse duplicate call to-dos → rank → one row per key (the highest-ranked wins). */
export function toSnapshotRows(candidates: readonly TriageCandidate[], openWork: readonly OpenWork[]): SnapshotRow[] {
  const seen = new Set<string>();
  const rows: SnapshotRow[] = [];
  for (const c of rankCandidates(collapseDuplicates(candidates, openWork))) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    rows.push({ key: c.key, source: c.source, title: c.title, sub: c.sub, href: c.href, score: c.score, reason: c.reason, callLine: c.callLine ?? null, also: c.also ?? [] });
  }
  return rows;
}

export async function buildRows(ctx: FeedCtx, feeds: readonly TriageFeed[] = FEEDS): Promise<{ rows: SnapshotRow[]; errors: FeedError[] }> {
  const g = await gatherCandidates(ctx, feeds);
  return { rows: toSnapshotRows(g.candidates, g.openWork), errors: g.errors };
}
```

- [ ] **Step 4: Write `src/lib/triage/store.ts`**

```ts
import { getDoc, listDocsByField, upsertDoc } from "@/db/doc-store";
import type { TriageMark, TriageSnapshot } from "./types";

/** Persistence for the two triage collections. Server-only. */

export async function getSnapshot(id: string): Promise<TriageSnapshot | null> {
  return getDoc<TriageSnapshot>("triage_snapshots", id);
}

export async function saveSnapshot(s: TriageSnapshot): Promise<void> {
  await upsertDoc<TriageSnapshot>("triage_snapshots", s);
}

export function markId(userId: string, key: string): string {
  return `${userId}:${key}`;
}

export async function marksFor(userId: string): Promise<TriageMark[]> {
  return listDocsByField<TriageMark>("triage_marks", "userId", [userId]);
}

/** One mark per user per item; the latest wins — except a dismiss, which is permanent. */
export async function setMark(m: Omit<TriageMark, "id">): Promise<TriageMark> {
  const id = markId(m.userId, m.key);
  const existing = await getDoc<TriageMark>("triage_marks", id);
  if (existing?.kind === "dismiss") return existing;
  const doc: TriageMark = { ...m, id };
  await upsertDoc<TriageMark>("triage_marks", doc);
  return doc;
}
```

- [ ] **Step 5: Write `src/lib/triage/view.ts`**

```ts
import { nextMorning, slotOrdinal } from "./clock";
import type { SnapshotRow, Slot, TriageMark } from "./types";

/** Which snapshot is on screen. Pure. */
export type SlotRef = { snapshotId: string; day: string; slot: Slot };

/** Rows on the Home card; "See more" shows the rest. */
export const HOME_LIMIT = 10;

/** "Snooze till tomorrow" → hidden until the next morning snapshot. */
export function snoozeUntil(day: string): string {
  const n = nextMorning(day);
  return slotOrdinal(n.day, n.slot);
}

export function markHides(m: Pick<TriageMark, "kind" | "snapshotId" | "until">, cur: SlotRef): boolean {
  if (m.kind === "dismiss") return true;
  if (m.kind === "done") return m.snapshotId === cur.snapshotId;
  return !!m.until && slotOrdinal(cur.day, cur.slot) < m.until;
}

export function visibleRows(
  rows: readonly SnapshotRow[],
  marks: readonly Pick<TriageMark, "key" | "kind" | "snapshotId" | "until">[],
  closed: ReadonlySet<string>,
  cur: SlotRef
): SnapshotRow[] {
  const byKey = new Map(marks.map((m) => [m.key, m]));
  return rows.filter((r) => {
    if (closed.has(r.key)) return false;
    const m = byKey.get(r.key);
    return !(m && markHides(m, cur));
  });
}
```

- [ ] **Step 6: Write `src/lib/triage/liveness.ts`**

```ts
import { getDocRows } from "@/db/doc-store";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";
import type { CommThread } from "@/lib/stores/comms";
import { normalizeRecording, type RecordingRecord } from "@/lib/stores/recordings";
import type { Quote } from "@/lib/stores/quotes";
import { quoteAwaitsApprovalBy, quoteBackFromReview, sameName } from "@/lib/quote-approval-rules";
import { portalBellGroups } from "@/lib/portal-bell";
import { parseTriageKey } from "./keys";
import type { SnapshotRow, TriageSource, TriageUser } from "./types";

/** The current state of the sources a frozen row points at. Missing = deleted. */
export type LiveDocs = {
  tasks: ReadonlyMap<string, Pick<TaskRecord, "status">>;
  assignments: ReadonlyMap<string, Pick<Assignment, "done">>;
  threads: ReadonlyMap<string, Pick<CommThread, "status" | "archived" | "assignedTo" | "deleted">>;
  recordings: ReadonlyMap<string, { actionItems: readonly { key: string; disposition: string }[] }>;
  quotes: ReadonlyMap<string, Quote>;
};

/**
 * Spec "Snapshots and refresh": between runs the list is frozen, except rows
 * whose source is now done — task/assignment done, thread no longer waiting
 * on us (or archived / reassigned), call to-do decided, quote no longer
 * waiting on me — are hidden on render. Lead / visit / renewal rows stay
 * until their marks or the next snapshot. Pure.
 */
export function closedKeys(rows: readonly SnapshotRow[], docs: LiveDocs, me: TriageUser, now: number): Set<string> {
  const closed = new Set<string>();
  const portalReview = new Set(portalBellGroups([...docs.quotes.values()], me.name, now).review.map((i) => i.id));
  for (const r of rows) {
    const k = parseTriageKey(r.key);
    if (!k) continue;
    switch (k.source) {
      case "task": {
        const t = docs.tasks.get(k.id);
        if (!t || t.status === "done") closed.add(r.key);
        break;
      }
      case "assignment": {
        const a = docs.assignments.get(k.id);
        if (!a || a.done) closed.add(r.key);
        break;
      }
      case "email": {
        const t = docs.threads.get(k.id);
        if (!t || t.status !== "waiting_us" || t.archived || t.deleted || !sameName(t.assignedTo, me.name)) closed.add(r.key);
        break;
      }
      case "call": {
        const item = docs.recordings.get(k.id)?.actionItems.find((a) => a.key === k.part);
        if (!item || item.disposition !== "pending") closed.add(r.key);
        break;
      }
      case "quote": {
        const q = docs.quotes.get(k.id);
        const stillMine = !!q && (quoteAwaitsApprovalBy(q, me.name, me.canApprove) || quoteBackFromReview(q, me.name) === "changes" || portalReview.has(q.id));
        if (!stillMine) closed.add(r.key);
        break;
      }
      default:
        break;
    }
  }
  return closed;
}

/** One batched read per collection for just the ids on the list. */
export async function loadClosedKeys(rows: readonly SnapshotRow[], me: TriageUser, now: number): Promise<Set<string>> {
  const idsOf = (src: TriageSource) =>
    rows.flatMap((r) => {
      const k = parseTriageKey(r.key);
      return k && k.source === src ? [k.id] : [];
    });
  const liveMap = <T>(list: Array<{ id: string; deleted: boolean; doc: T }>) => new Map(list.filter((x) => !x.deleted).map((x) => [x.id, x.doc]));
  const [tasks, assignments, threads, recs, quotes] = await Promise.all([
    getDocRows<TaskRecord>("tasks", idsOf("task")),
    getDocRows<Assignment>("assignments", idsOf("assignment")),
    getDocRows<CommThread>("comms", idsOf("email")),
    getDocRows<RecordingRecord>("recordings", idsOf("call")),
    getDocRows<Quote>("quotes", idsOf("quote")),
  ]);
  const recordings = new Map([...liveMap(recs)].map(([id, d]) => [id, normalizeRecording(d)]));
  return closedKeys(rows, { tasks: liveMap(tasks), assignments: liveMap(assignments), threads: liveMap(threads), recordings, quotes: liveMap(quotes) }, me, now);
}
```

- [ ] **Step 7: Write `src/lib/triage/service.ts`**

```ts
import { activeUsers, userCan } from "@/lib/users";
import { can } from "@/lib/team";
import { buildRows } from "./build";
import { dayKey, slotAt, snapshotId } from "./clock";
import { FEEDS } from "./feeds";
import type { FeedCtx, TriageFeed } from "./feeds/context";
import { TRIAGE_HOOKS } from "./hooks";
import { loadClosedKeys } from "./liveness";
import { getSnapshot, marksFor, saveSnapshot } from "./store";
import type { SnapshotRow, Slot, TriageSnapshot, TriageUser } from "./types";
import { visibleRows } from "./view";

/**
 * The triage list's server entry points (spec "Snapshots and refresh",
 * "Failures"): the cron builds every active user's slot; the first view of a
 * slot with no snapshot builds it lazily; if that can't be saved, the list is
 * computed live with a note. Rendering applies liveness + marks to the
 * frozen rows.
 */
export const LIVE_NOTE = "Showing a live list — today's saved list couldn't be built.";

/** One clock read outside component render (the queueNow() precedent). */
export function triageNow(): number {
  return Date.now();
}

export function triageUserFromSession(u: { id: string; name: string; roles: string[] }): TriageUser {
  return { id: u.id, name: u.name, canApprove: can("approve", u.roles) };
}

type Roster = readonly { id: string; name: string }[];

async function rosterNow(): Promise<Roster> {
  return (await activeUsers()).map((u) => ({ id: u.id, name: u.name }));
}

export async function computeSnapshot(
  me: TriageUser,
  at: { day: string; slot: Slot },
  now: number,
  builtBy: TriageSnapshot["builtBy"],
  opts: { feeds?: readonly TriageFeed[]; users?: Roster } = {}
): Promise<TriageSnapshot> {
  const ctx: FeedCtx = { me, now, users: opts.users ?? (await rosterNow()), hooks: TRIAGE_HOOKS };
  const { rows, errors } = await buildRows(ctx, opts.feeds ?? FEEDS);
  return { id: snapshotId(me.id, at.day, at.slot), userId: me.id, userName: me.name, day: at.day, slot: at.slot, builtAt: now, builtBy, rows, errors };
}

/** Cron: (re)build `slot` for today (Chicago) for every active user — or `opts.users`. One user failing never stops the rest. */
export async function buildSlotForAll(
  slot: Slot,
  now: number,
  opts: { users?: TriageUser[]; feeds?: readonly TriageFeed[] } = {}
): Promise<{ built: number; failed: string[] }> {
  const day = dayKey(now);
  const rows = await activeUsers();
  const users = opts.users ?? rows.map((u) => ({ id: u.id, name: u.name, canApprove: userCan(u, "approve") }));
  const roster: Roster = rows.map((u) => ({ id: u.id, name: u.name }));
  let built = 0;
  const failed: string[] = [];
  for (const u of users) {
    try {
      await saveSnapshot(await computeSnapshot(u, { day, slot }, now, "cron", { feeds: opts.feeds, users: roster }));
      built++;
    } catch (err) {
      console.error(`[triage] ${slot} build failed for ${u.name}`, err);
      failed.push(u.name);
    }
  }
  return { built, failed };
}

export type TriageView = { snapshot: TriageSnapshot; rows: SnapshotRow[]; note: string | null };

export async function loadTriageView(
  me: TriageUser,
  now: number,
  opts: { feeds?: readonly TriageFeed[]; save?: (s: TriageSnapshot) => Promise<void> } = {}
): Promise<TriageView> {
  const { day, slot } = slotAt(now);
  const id = snapshotId(me.id, day, slot);
  let snapshot = await getSnapshot(id).catch(() => null);
  let note: string | null = null;
  if (!snapshot) {
    snapshot = await computeSnapshot(me, { day, slot }, now, "lazy", { feeds: opts.feeds });
    try {
      await (opts.save ?? saveSnapshot)(snapshot);
    } catch (err) {
      console.error("[triage] lazy snapshot save failed", err);
      snapshot = { ...snapshot, builtBy: "live" };
      note = LIVE_NOTE;
    }
  }
  const [marks, closed] = await Promise.all([
    marksFor(me.id).catch(() => []),
    loadClosedKeys(snapshot.rows, me, now).catch(() => new Set<string>()),
  ]);
  return { snapshot, rows: visibleRows(snapshot.rows, marks, closed, { snapshotId: id, day, slot }), note };
}
```

- [ ] **Step 8: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint src/lib/triage scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/triage scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): snapshots, marks, liveness and the lazy-built view with live fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Crons — morning rider on the Gmail cron, midday route

**Files:**
- Create: `src/lib/triage/cron.ts`, `src/app/api/triage/build/route.ts`
- Modify: `src/app/api/gmail/sync/route.ts`, `vercel.json`, `src/middleware.ts`, `scripts/test-morning-triage.ts` (add `triageCronChecks`), harness

**Interfaces:**
- Consumes: `buildSlotForAll` (Task 7), `Slot`.
- Produces: `cronAuthFailure(header: string | null, secret: string | undefined): { status: 401 | 503; error: string } | null`, `parseSlotParam(v: string | null): Slot | null`; route `GET /api/triage/build?slot=midday|morning` (default `midday`).

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (import `cronAuthFailure, parseSlotParam` from `@/lib/triage/cron`):

```ts
export async function triageCronChecks(ok: Ok): Promise<void> {
  ok(JSON.stringify(cronAuthFailure("Bearer x", undefined)) === JSON.stringify({ status: 503, error: "cron not configured" }), "cron: disabled (503) until CRON_SECRET is set");
  ok(cronAuthFailure(null, "s")?.status === 401 && cronAuthFailure("Bearer t", "s")?.status === 401 && cronAuthFailure("Bearer s", "s") === null, "cron: only the matching bearer secret passes");
  ok(parseSlotParam("midday") === "midday" && parseSlotParam("morning") === "morning" && parseSlotParam("noon") === null && parseSlotParam(null) === null, "cron: slot param");

  const route = readFileSync("src/app/api/triage/build/route.ts", "utf8");
  ok(/cronAuthFailure\(/.test(route) && /buildSlotForAll\(slot, /.test(route) && /\?\? "midday"/.test(route) && /maxDuration = 60/.test(route), "cron: /api/triage/build authenticates, defaults to the midday slot, builds every user");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  ok(
    vercel.crons.some((c) => c.path === "/api/triage/build?slot=midday" && c.schedule === "0 17 * * *") && vercel.crons.some((c) => c.path === "/api/gmail/sync" && c.schedule === "0 12 * * *") && vercel.crons.length === 2,
    "cron: two once-a-day entries (Hobby-safe) — Gmail sync at 12:00 UTC, triage midday at 17:00 UTC"
  );
  const gmail = readFileSync("src/app/api/gmail/sync/route.ts", "utf8");
  ok(/buildSlotForAll\("morning", /.test(gmail) && gmail.indexOf('buildSlotForAll("morning"') < gmail.indexOf("syncDrivePhotos(budget)") && /triage = \{ error:/.test(gmail), "cron: the morning list rides the daily Gmail cron, own try/catch, before the photo budget");
  const mw = readFileSync("src/middleware.ts", "utf8");
  const m = mw.match(/matcher:\s*\[\s*"([^"]+)"/);
  const re = new RegExp("^" + (m ? m[1].replace(/\\\\/g, "\\") : "$^") + "$");
  ok(!!m && !re.test("/api/triage/build") && re.test("/triage") && re.test("/"), "cron: /api/triage/build skips the login gate (secret is its auth); /triage does not");
}
```

Harness: add `triageCronChecks` to the import and `  .then(() => triageCronChecks(ok))` after the snapshot line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/triage/cron'`.

- [ ] **Step 3: Write `src/lib/triage/cron.ts`**

```ts
import type { Slot } from "./types";

/** Same contract as /api/gmail/sync (D74): disabled until CRON_SECRET exists; Vercel Cron sends `Bearer <secret>`. */
export function cronAuthFailure(header: string | null, secret: string | undefined): { status: 401 | 503; error: string } | null {
  if (!secret) return { status: 503, error: "cron not configured" };
  if (header !== "Bearer " + secret) return { status: 401, error: "unauthorized" };
  return null;
}

export function parseSlotParam(v: string | null): Slot | null {
  return v === "morning" || v === "midday" ? v : null;
}
```

- [ ] **Step 4: Write `src/app/api/triage/build/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cronAuthFailure, parseSlotParam } from "@/lib/triage/cron";
import { buildSlotForAll } from "@/lib/triage/service";

export const maxDuration = 60;

/**
 * Morning triage — the midday list (spec "Snapshots and refresh"). Vercel
 * Cron calls `/api/triage/build?slot=midday` once a day at 17:00 UTC (noon
 * CDT, 11:00 CST — still "midday" for today's Chicago date). The morning
 * list rides the daily Gmail cron instead. `?slot=morning` rebuilds the
 * morning list by hand. Middleware exempts this path from the session gate,
 * so CRON_SECRET is the only auth.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const fail = cronAuthFailure(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });
  const slot = parseSlotParam(new URL(req.url).searchParams.get("slot")) ?? "midday";
  const result = await buildSlotForAll(slot, Date.now());
  return NextResponse.json({ slot, ...result });
}
```

- [ ] **Step 5: Add the morning rider to `src/app/api/gmail/sync/route.ts`**

Add the import `import { buildSlotForAll } from "@/lib/triage/service";` with the other imports. Insert this block immediately BEFORE the `// #283 — Peak Product Photos:` comment:

```ts
  // Morning triage (spec 2026-10-09-morning-triage-design.md) — today's
  // morning list for every active user. 12:00 UTC is 7:00 CDT (6:00 CST);
  // either way it builds today's Chicago "morning" slot. Before the photo
  // sync so the photo budget below absorbs whatever this used. Own
  // try/catch like the other riders.
  let triage: Awaited<ReturnType<typeof buildSlotForAll>> | { error: string };
  try {
    triage = await buildSlotForAll("morning", Date.now());
  } catch (err) {
    triage = { error: (err as Error).message };
  }
```

and change the final return to:

```ts
  return NextResponse.json({ ...r, googleTasks, recordings, recordingsArchive, vendors, triage, drivePhotos });
```

Also append to the route's header comment block, after ` * #283 adds the Peak Product Photos sync the same way.`:

```ts
 *
 * Morning triage adds the morning snapshot build the same way (its midday
 * build is /api/triage/build, the second daily cron).
```

- [ ] **Step 6: Add the cron entry to `vercel.json`**

Replace the file with:

```json
{
  "crons": [
    {
      "path": "/api/gmail/sync",
      "schedule": "0 12 * * *"
    },
    {
      "path": "/api/triage/build?slot=midday",
      "schedule": "0 17 * * *"
    }
  ]
}
```

- [ ] **Step 7: Exempt the route in `src/middleware.ts`**

In the matcher string, change `api/gmail/sync|` to `api/gmail/sync|api/triage/build|`. In the header comment, after the sentence about `/api/gmail/sync` being the cron endpoint, add: `/api/triage/build (morning triage's midday cron) is exempt for the same reason.`

- [ ] **Step 8: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED` (including the existing `#245 middleware:` checks).
Run: `npx eslint src/lib/triage/cron.ts src/app/api/triage/build/route.ts src/app/api/gmail/sync/route.ts src/middleware.ts scripts/test-morning-triage.ts`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/triage/cron.ts src/app/api/triage src/app/api/gmail/sync/route.ts vercel.json src/middleware.ts scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): morning build rides the Gmail cron; midday cron route at 17:00 UTC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Row actions, the row list and `/triage`

**Files:**
- Create: `src/lib/triage/actions-plan.ts`, `src/app/(app)/triage/actions.ts`, `src/components/triage/triage-rows.tsx`, `src/app/(app)/triage/page.tsx`
- Modify: `src/components/nav/nav-data.ts` (route map), `scripts/smoke-routes.ts` (ROUTES), `scripts/test-morning-triage.ts` (add `triageActionChecks`), harness

**Interfaces:**
- Consumes: `parseTriageKey`, `slotAt`, `snapshotId`, `chicagoTime`, `slotLabel`, `snoozeUntil`, `setMark`, `loadTriageView`, `triageNow`, `triageUserFromSession`, `SOURCE_LABEL`, `SnapshotRow`, `formatTimestamp`; stores `tasks.setTaskStatus`, `assignments.setAssignmentDone`, `comms.setStatus` / `comms.assign`, `recordings.getRecording`; `dismissActionItem` (krisp/write-back); `activeUsers`, `userCan`; `requireUser`; `can`.
- Produces:
  - `actions-plan.ts`: `type DonePlan = { kind: "task"; id } | { kind: "assignment"; id } | { kind: "thread"; id } | { kind: "open"; href } | { kind: "mark" }`, `donePlan(key): DonePlan | null`.
  - Server actions: `triageDoneAction(key)`, `triageSnoozeAction(key)`, `triageDismissAction(key)`, `triageReassignAction(key, assignee)` → `{ ok: true; open?: string } | { ok: false; error: string }`.
  - `TriageRows` default export: `({ rows: SnapshotRow[]; readOnly: boolean; teammates: string[] })`.
  - Page `/triage` (`?user=<id>` for admins).

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (import `donePlan` from `@/lib/triage/actions-plan`):

```ts
export async function triageActionChecks(ok: Ok): Promise<void> {
  ok(JSON.stringify(donePlan("task:T-1")) === JSON.stringify({ kind: "task", id: "T-1" }) && donePlan("asg:as-1")?.kind === "assignment", "actions: Done on a task / assignment marks it done");
  ok(JSON.stringify(donePlan("email:C-9")) === JSON.stringify({ kind: "thread", id: "C-9" }), "actions: Done on an email closes the thread");
  ok(JSON.stringify(donePlan("call:REC-1:k1")) === JSON.stringify({ kind: "open", href: "/recordings/REC-1?tab=actions" }), "actions: Done on a call to-do opens the meeting's to-do decision instead of guessing");
  ok(["lead:L-1", "quote:Q-1", "visit:SV-1", "renewal:flame:FT-1"].every((k) => donePlan(k)?.kind === "mark") && donePlan("bogus") === null, "actions: lead / quote / visit / renewal rows are 'Done for today'; junk keys are refused");

  const actions = readFileSync("src/app/(app)/triage/actions.ts", "utf8");
  const exportsN = (actions.match(/export async function /g) || []).length;
  ok(actions.startsWith('"use server";') && exportsN === 4 && (actions.match(/await requireUser\(\)/g) || []).length === exportsN, "actions: a server-action file; every action calls requireUser() first");
  ok(/dismissActionItem\(/.test(actions) && /assignThread\(/.test(actions) && /sameName\(u\.name, /.test(actions), "actions: dismissing a call to-do dismisses it on its recording; reassign only to an active teammate");
  const rowsSrc = readFileSync("src/components/triage/triage-rows.tsx", "utf8");
  const importLines = rowsSrc.split("\n").filter((l) => l.startsWith("import "));
  ok(
    rowsSrc.startsWith('"use client";') && !importLines.some((l) => /@\/lib\/stores|@\/db|triage\/(service|store|liveness|build|feeds)/.test(l)),
    "rows: the client list imports no store, db or server triage module"
  );
  ok(rowsSrc.includes("Source line not found — open the meeting") && rowsSrc.includes("Snooze till tomorrow") && rowsSrc.includes("Not mine"), "rows: unmatched-line copy and the three actions");
  const page = readFileSync("src/app/(app)/triage/page.tsx", "utf8");
  ok(/requireUser\(\)/.test(page) && /can\("manage_users", user\.roles\)/.test(page) && /readOnly=\{!viewingSelf\}/.test(page), "page: admins can view a teammate's list, read-only");
  ok(readFileSync("src/components/nav/nav-data.ts", "utf8").includes('"/triage": "dashboard"') && readFileSync("scripts/smoke-routes.ts", "utf8").includes('"/triage"'), "page: /triage lights Dashboard and is smoke-tested");
}
```

Harness: add `triageActionChecks` to the import and `  .then(() => triageActionChecks(ok))` after the cron line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/triage/actions-plan'`.

- [ ] **Step 3: Write `src/lib/triage/actions-plan.ts`**

```ts
import { parseTriageKey } from "./keys";

/**
 * Spec "Row actions" → Done. Task/assignment → done; thread → closed; call
 * to-do → open the meeting's to-do decision (accept as task / dismiss)
 * rather than guessing; lead/quote/visit/renewal → "Done for today" (a mark
 * that hides it in this snapshot only). Pure.
 */
export type DonePlan =
  | { kind: "task"; id: string }
  | { kind: "assignment"; id: string }
  | { kind: "thread"; id: string }
  | { kind: "open"; href: string }
  | { kind: "mark" };

export function donePlan(key: string): DonePlan | null {
  const k = parseTriageKey(key);
  if (!k) return null;
  switch (k.source) {
    case "task":
      return { kind: "task", id: k.id };
    case "assignment":
      return { kind: "assignment", id: k.id };
    case "email":
      return { kind: "thread", id: k.id };
    case "call":
      return { kind: "open", href: `/recordings/${encodeURIComponent(k.id)}?tab=actions` };
    default:
      return { kind: "mark" };
  }
}
```

- [ ] **Step 4: Write `src/app/(app)/triage/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setTaskStatus } from "@/lib/stores/tasks";
import { setAssignmentDone } from "@/lib/stores/assignments";
import { assign as assignThread, setStatus as setThreadStatus } from "@/lib/stores/comms";
import { getRecording } from "@/lib/stores/recordings";
import { dismissActionItem } from "@/lib/krisp/write-back";
import { activeUsers } from "@/lib/users";
import { sameName } from "@/lib/quote-approval-rules";
import { parseTriageKey } from "@/lib/triage/keys";
import { donePlan } from "@/lib/triage/actions-plan";
import { slotAt, snapshotId } from "@/lib/triage/clock";
import { snoozeUntil } from "@/lib/triage/view";
import { setMark } from "@/lib/triage/store";

/**
 * Morning triage row actions (spec "Row actions"). Marks are always the
 * signed-in user's own; an admin viewing a teammate's list sees it
 * read-only, so nothing here takes a user id.
 */

type Result = { ok: true; open?: string } | { ok: false; error: string };

function currentSlot(userId: string) {
  const now = Date.now();
  const { day, slot } = slotAt(now);
  return { now, day, snapshotId: snapshotId(userId, day, slot) };
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/triage");
}

export async function triageDoneAction(key: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  const plan = donePlan(k);
  if (!plan) return { ok: false, error: "That item isn't on your list." };
  if (plan.kind === "open") return { ok: true, open: plan.href };
  const cur = currentSlot(user.id);
  try {
    if (plan.kind === "task") await setTaskStatus(plan.id, "done");
    else if (plan.kind === "assignment") await setAssignmentDone(plan.id, true, "app");
    else if (plan.kind === "thread") await setThreadStatus(plan.id, "closed");
    await setMark({ userId: user.id, key: k, kind: "done", at: cur.now, snapshotId: cur.snapshotId, until: null });
  } catch (error) {
    console.error("triageDoneAction failed", error);
    return { ok: false, error: "Couldn’t mark that done — please try again." };
  }
  refresh();
  return { ok: true };
}

export async function triageSnoozeAction(key: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  if (!parseTriageKey(k)) return { ok: false, error: "That item isn't on your list." };
  const cur = currentSlot(user.id);
  try {
    await setMark({ userId: user.id, key: k, kind: "snooze", at: cur.now, snapshotId: cur.snapshotId, until: snoozeUntil(cur.day) });
  } catch (error) {
    console.error("triageSnoozeAction failed", error);
    return { ok: false, error: "Couldn’t snooze that — please try again." };
  }
  refresh();
  return { ok: true };
}

export async function triageDismissAction(key: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  const parsed = parseTriageKey(k);
  if (!parsed) return { ok: false, error: "That item isn't on your list." };
  const cur = currentSlot(user.id);
  try {
    if (parsed.source === "call" && parsed.part) {
      const rec = await getRecording(parsed.id);
      if (rec) await dismissActionItem(rec, parsed.part);
    }
    await setMark({ userId: user.id, key: k, kind: "dismiss", at: cur.now, snapshotId: null, until: null });
  } catch (error) {
    console.error("triageDismissAction failed", error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Couldn’t dismiss that — please try again." };
  }
  refresh();
  return { ok: true };
}

export async function triageReassignAction(key: string, assignee: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  const parsed = parseTriageKey(k);
  if (!parsed || parsed.source !== "email") return { ok: false, error: "Only an email can be reassigned." };
  const target = (await activeUsers()).find((u) => sameName(u.name, String(assignee || "")));
  if (!target) return { ok: false, error: "Pick a teammate." };
  const cur = currentSlot(user.id);
  try {
    await assignThread(parsed.id, target.name);
    await setMark({ userId: user.id, key: k, kind: "done", at: cur.now, snapshotId: cur.snapshotId, until: null });
  } catch (error) {
    console.error("triageReassignAction failed", error);
    return { ok: false, error: "Couldn’t reassign that — please try again." };
  }
  refresh();
  return { ok: true };
}
```

- [ ] **Step 5: Write `src/components/triage/triage-rows.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { SOURCE_LABEL, type SnapshotRow } from "@/lib/triage/types";
import { formatTimestamp } from "@/lib/triage/transcript-match";
import {
  triageDismissAction,
  triageDoneAction,
  triageReassignAction,
  triageSnoozeAction,
} from "@/app/(app)/triage/actions";

/**
 * The ranked rows — shared by the Home "Start here" card (top 10) and
 * /triage (all). Rows arrive fully resolved from the server; this only
 * runs the three actions and refreshes.
 */

type Result = { ok: true; open?: string } | { ok: false; error: string };

const ROW: CSSProperties = { display: "flex", gap: 12, alignItems: "flex-start", padding: "11px 0", borderTop: "1px solid #f0f1f4" };
const RANK: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab", width: 20, textAlign: "right", paddingTop: 2, flexShrink: 0 };
const CHIP: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em", textTransform: "uppercase", color: "#5b616e", background: "#f1f2f5", borderRadius: 5, padding: "1px 6px", flexShrink: 0 };
const TITLE: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: "#16181d", textDecoration: "none" };
const SUB: CSSProperties = { fontSize: 12, color: "#8c919c", marginTop: 2 };
const REASON: CSSProperties = { fontSize: 12, color: "color-mix(in srgb, var(--accent) 70%, #000)", marginTop: 3 };
const LINE: CSSProperties = { display: "block", fontSize: 12, color: "#3a3f4a", marginTop: 4, textDecoration: "none", borderLeft: "2px solid #e4e7ec", paddingLeft: 8 };
const LINE_MISS: CSSProperties = { ...LINE, color: "#a0442b" };
const ALSO: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 3 };
const BTN: CSSProperties = { border: "1px solid #e4e7ec", background: "#fff", borderRadius: 7, padding: "4px 9px", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", cursor: "pointer", whiteSpace: "nowrap" };

function Reassign({ rowKey, teammates, onRun, onCancel, busy }: { rowKey: string; teammates: string[]; onRun: (fn: () => Promise<Result>) => void; onCancel: () => void; busy: boolean }) {
  const [who, setWho] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
      <select value={who} onChange={(e) => setWho(e.target.value)} style={{ ...BTN, fontWeight: 500 }} aria-label="Reassign to">
        <option value="">Reassign to…</option>
        {teammates.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <button style={BTN} disabled={busy || !who} onClick={() => onRun(() => triageReassignAction(rowKey, who))}>Reassign</button>
      <button style={BTN} disabled={busy} onClick={() => onRun(() => triageDismissAction(rowKey))}>Just hide</button>
      <button style={{ ...BTN, border: "none" }} onClick={onCancel}>Cancel</button>
    </div>
  );
}

export default function TriageRows({ rows, readOnly, teammates }: { rows: SnapshotRow[]; readOnly: boolean; teammates: string[] }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reassignKey, setReassignKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const run = (key: string, fn: () => Promise<Result>) => {
    setBusyKey(key);
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      setBusyKey(null);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (r.open) {
        router.push(r.open);
        return;
      }
      setReassignKey(null);
      router.refresh();
    });
  };

  if (!rows.length) return <div style={{ fontSize: 12.5, color: "#8c919c", padding: "12px 0" }}>Nothing to triage right now.</div>;

  return (
    <>
      {err && <div style={{ fontSize: 12, color: "#a0442b", padding: "6px 0" }}>{err}</div>}
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((r, i) => (
          <li key={r.key} style={ROW}>
            <span style={RANK}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={CHIP}>{SOURCE_LABEL[r.source]}</span>
                <Link href={r.href} style={TITLE}>{r.title}</Link>
              </div>
              {r.sub && <div style={SUB}>{r.sub}</div>}
              {r.reason && <div style={REASON}>{r.reason}</div>}
              {r.callLine &&
                (r.callLine.found ? (
                  <Link href={r.callLine.href} style={LINE}>
                    {r.callLine.speaker} — “{r.callLine.text}” ({formatTimestamp(r.callLine.start)})
                  </Link>
                ) : (
                  <Link href={r.callLine.href} style={LINE_MISS}>Source line not found — open the meeting</Link>
                ))}
              {r.also.map((a) => (
                <div key={a} style={ALSO}>{a}</div>
              ))}
              {!readOnly && reassignKey === r.key && (
                <Reassign rowKey={r.key} teammates={teammates} busy={busyKey === r.key} onRun={(fn) => run(r.key, fn)} onCancel={() => setReassignKey(null)} />
              )}
            </div>
            {!readOnly && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button style={BTN} disabled={busyKey === r.key} onClick={() => run(r.key, () => triageDoneAction(r.key))}>
                  Done
                </button>
                <button style={BTN} disabled={busyKey === r.key} title="Snooze till tomorrow" onClick={() => run(r.key, () => triageSnoozeAction(r.key))}>
                  Snooze
                </button>
                <button
                  style={BTN}
                  disabled={busyKey === r.key}
                  title={r.source === "email" ? "Reassign or hide" : "Not mine / dismiss"}
                  onClick={() => (r.source === "email" ? setReassignKey(r.key) : run(r.key, () => triageDismissAction(r.key)))}
                >
                  Not mine
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
```

- [ ] **Step 6: Write `src/app/(app)/triage/page.tsx`**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { activeUsers, userCan } from "@/lib/users";
import { chicagoTime, slotLabel } from "@/lib/triage/clock";
import { loadTriageView, triageNow, triageUserFromSession } from "@/lib/triage/service";
import TriageRows from "@/components/triage/triage-rows";
import HomeTabs from "../home-tabs";

export const metadata = { title: "Start here — Quartzite-6" };

/**
 * Morning triage — the full ranked list ("See more" from Home's Start here
 * card). Admins (manage_users) can switch to a teammate's list, read-only.
 */
export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = can("manage_users", user.roles);
  const roster = await activeUsers();
  const wanted = typeof sp.user === "string" ? sp.user : "";
  const other = isAdmin && wanted && wanted !== user.id ? roster.find((u) => u.id === wanted) ?? null : null;
  const target = other ? { id: other.id, name: other.name, canApprove: userCan(other, "approve") } : triageUserFromSession(user);
  const viewingSelf = target.id === user.id;
  const view = await loadTriageView(target, triageNow());
  const teammates = roster.map((u) => u.name).filter((n) => n !== user.name);

  return (
    <HomeTabs active="dashboard">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16181d", margin: 0 }}>Start here</h1>
        <span style={{ fontSize: 12.5, color: "#8c919c" }}>
          {viewingSelf ? "Your" : `${target.name}’s`} {slotLabel(view.snapshot.slot).toLowerCase()} · built {chicagoTime(view.snapshot.builtAt)} · {view.rows.length} items
        </span>
      </div>
      {isAdmin && (
        <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 12px" }} aria-label="Person">
          {roster.map((u) => {
            const on = u.id === target.id;
            return (
              <Link
                key={u.id}
                href={u.id === user.id ? "/triage" : `/triage?user=${encodeURIComponent(u.id)}`}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 7, textDecoration: "none",
                  color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#5b616e",
                  background: on ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "#f1f2f5",
                }}
              >
                {u.name}
              </Link>
            );
          })}
        </nav>
      )}
      {view.note && <div style={{ fontSize: 12, color: "#8a6d1f", margin: "6px 0" }}>{view.note}</div>}
      {view.snapshot.errors.map((e) => (
        <div key={e.source} style={{ fontSize: 12, color: "#8a6d1f", margin: "6px 0" }}>{e.message}</div>
      ))}
      <section className="pk-card" style={{ padding: "4px 18px 8px" }}>
        <TriageRows rows={view.rows} readOnly={!viewingSelf} teammates={teammates} />
      </section>
    </HomeTabs>
  );
}
```

- [ ] **Step 7: Nav route map + smoke route**

In `src/components/nav/nav-data.ts`, inside the `const map: Record<string, string> = {` object, after `"/queue": "queue",` add:

```ts
    "/triage": "dashboard", // Morning triage — "See more" from Home's Start here card
```

In `scripts/smoke-routes.ts`, inside `ROUTES`, after the `"/queue",` entry add:

```ts
  "/triage", // Morning triage — the full ranked list (lazily builds the slot on the scratch db)
```

- [ ] **Step 8: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint "src/app/(app)/triage" src/components/triage src/lib/triage/actions-plan.ts src/components/nav/nav-data.ts scripts/smoke-routes.ts scripts/test-morning-triage.ts`
Expected: no errors.
Run: `env -u DATABASE_URL npm run build 2>&1 | tail -15`
Expected: build succeeds (no "You're importing a component that needs …" / `postgres` / `@electric-sql/pglite` client-bundle error); `/triage` appears in the route list.

- [ ] **Step 9: Commit**

```bash
git add src/lib/triage/actions-plan.ts "src/app/(app)/triage" src/components/triage src/components/nav/nav-data.ts scripts/smoke-routes.ts scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): Done / Snooze / Not mine actions, ranked rows and the /triage page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: "Start here" on Home + recording deep link to the transcript moment

**Files:**
- Create: `src/components/triage/start-here-card.tsx`, `src/lib/recording-deep-link.ts`
- Modify: `src/app/(app)/page.tsx`, `src/app/(app)/recordings/[id]/page.tsx`, `src/app/(app)/recordings/[id]/detail-client.tsx`, `scripts/test-morning-triage.ts` (add `triageHomeChecks`), harness

**Interfaces:**
- Consumes: `loadTriageView`, `triageNow`, `triageUserFromSession` (Task 7); `HOME_LIMIT` (view.ts); `chicagoTime`, `slotLabel`; `TriageRows` (Task 9); `activeUsers`; `SessionUser`.
- Produces: `StartHereCard` default export `({ user: SessionUser })` (async server component); `RECORDING_TABS`, `type RecordingTab`, `parseRecordingDeepLink(sp): { tab: RecordingTab; seg: number | null }`; `DetailClient` gains optional props `initialTab?: RecordingTab` and `focusSeg?: number | null`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-morning-triage.ts` (import `parseRecordingDeepLink` from `@/lib/recording-deep-link`):

```ts
export async function triageHomeChecks(ok: Ok): Promise<void> {
  ok(JSON.stringify(parseRecordingDeepLink({ tab: "transcript", seg: "12" })) === JSON.stringify({ tab: "transcript", seg: 12 }), "deep link: ?tab=transcript&seg=12 opens that segment");
  ok(JSON.stringify(parseRecordingDeepLink({ seg: "3" })) === JSON.stringify({ tab: "transcript", seg: 3 }), "deep link: a segment implies the Transcript tab");
  ok(JSON.stringify(parseRecordingDeepLink({ tab: "actions" })) === JSON.stringify({ tab: "actions", seg: null }), "deep link: ?tab=actions opens Action items");
  ok(JSON.stringify(parseRecordingDeepLink({ tab: "nope", seg: "-1" })) === JSON.stringify({ tab: "summary", seg: null }) && parseRecordingDeepLink({ seg: ["4", "5"] }).seg === 4, "deep link: junk falls back to Summary; arrays take the first value");

  const home = readFileSync("src/app/(app)/page.tsx", "utf8");
  ok(/<StartHereCard user=\{user\} \/>/.test(home) && home.indexOf("<StartHereCard") < home.indexOf("<WidgetHost") && /<Suspense/.test(home), "home: the Start here card sits at the top of Home, above the widgets, behind Suspense");
  const card = readFileSync("src/components/triage/start-here-card.tsx", "utf8");
  ok(/HOME_LIMIT/.test(card) && /href="\/triage"/.test(card) && /See more/.test(card) && /built \{chicagoTime\(/.test(card) && /catch/.test(card), "home: top 10, slot label with build time, See more → /triage; a load failure never breaks Home");
  const recPage = readFileSync("src/app/(app)/recordings/[id]/page.tsx", "utf8");
  const detail = readFileSync("src/app/(app)/recordings/[id]/detail-client.tsx", "utf8");
  ok(/parseRecordingDeepLink\(/.test(recPage) && /initialTab=\{link\.tab\}/.test(recPage) && /focusSeg=\{link\.seg\}/.test(recPage), "deep link: the recording page passes the tab + segment through");
  ok(/useState<Tab>\(initialTab \?\? "summary"\)/.test(detail) && /id=\{`seg-\$\{i\}`\}/.test(detail) && /scrollIntoView/.test(detail), "deep link: the transcript scrolls to and highlights the segment");
}
```

Harness: add `triageHomeChecks` to the import and `  .then(() => triageHomeChecks(ok))` after the actions line.

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/recording-deep-link'`.

- [ ] **Step 3: Write `src/lib/recording-deep-link.ts`**

```ts
/**
 * `/recordings/[id]?tab=…&seg=…` — the morning-triage call line links to the
 * exact transcript segment a to-do came from. Pure, client-safe.
 */
export const RECORDING_TABS = ["summary", "actions", "transcript", "audio"] as const;
export type RecordingTab = (typeof RECORDING_TABS)[number];

export function parseRecordingDeepLink(sp: Record<string, string | string[] | undefined>): { tab: RecordingTab; seg: number | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const rawSeg = one(sp.seg);
  const seg = rawSeg != null && /^\d{1,6}$/.test(rawSeg) ? Number(rawSeg) : null;
  const t = one(sp.tab) || "";
  const tab: RecordingTab = seg != null ? "transcript" : (RECORDING_TABS as readonly string[]).includes(t) ? (t as RecordingTab) : "summary";
  return { tab, seg };
}
```

- [ ] **Step 4: Wire the deep link into the recording page**

In `src/app/(app)/recordings/[id]/page.tsx`:
- add `import { parseRecordingDeepLink } from "@/lib/recording-deep-link";`
- change the component signature and first line to:

```tsx
export default async function RecordingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, { id }, sp] = await Promise.all([requireUser(), params, searchParams]);
  const link = parseRecordingDeepLink(sp);
```

- add two props to the `<DetailClient … />` element, after `parentHref={detail.parentHref}`:

```tsx
        initialTab={link.tab}
        focusSeg={link.seg}
```

In `src/app/(app)/recordings/[id]/detail-client.tsx`:
- in the `DetailClient` props destructuring add `initialTab,` and `focusSeg,` after `parentHref,`, and in its type add:

```ts
  initialTab?: Tab;
  focusSeg?: number | null;
```

- change `const [tab, setTab] = useState<Tab>("summary");` to:

```ts
  const [tab, setTab] = useState<Tab>(initialTab ?? "summary");
```

- change `{tab === "transcript" && <TranscriptTab rec={rec} chip={chip} />}` to:

```tsx
      {tab === "transcript" && <TranscriptTab rec={rec} chip={chip} focusSeg={focusSeg ?? null} />}
```

- replace the head of `TranscriptTab` (signature through `const [shown, setShown] = useState(TRANSCRIPT_PAGE);`) with:

```tsx
function TranscriptTab({ rec, chip, focusSeg }: { rec: RecordingRecord; chip: RecordingStatusChip; focusSeg: number | null }) {
  const [shown, setShown] = useState(() => Math.max(TRANSCRIPT_PAGE, (focusSeg ?? -1) + 1));
  // Morning triage's call line links here (?tab=transcript&seg=N): bring that segment into view.
  useEffect(() => {
    if (focusSeg == null) return;
    document.getElementById(`seg-${focusSeg}`)?.scrollIntoView({ block: "center" });
  }, [focusSeg]);
```

- in the segment row `<div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", paddingTop: newSpeaker && i > 0 ? 8 : 0 }}>` change it to:

```tsx
            <div
              key={i}
              id={`seg-${i}`}
              style={{
                display: "flex", gap: 10, alignItems: "baseline", paddingTop: newSpeaker && i > 0 ? 8 : 0,
                background: i === focusSeg ? "color-mix(in srgb, var(--accent) 10%, #fff)" : undefined, borderRadius: 6,
              }}
            >
```

(`Tab` in detail-client.tsx is the same union as `RecordingTab`; leave the local type as is.)

- [ ] **Step 5: Write `src/components/triage/start-here-card.tsx`**

```tsx
import Link from "next/link";
import type { SessionUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { chicagoTime, slotLabel } from "@/lib/triage/clock";
import { loadTriageView, triageNow, triageUserFromSession, type TriageView } from "@/lib/triage/service";
import { HOME_LIMIT } from "@/lib/triage/view";
import TriageRows from "./triage-rows";

/**
 * Morning triage — the "Start here" card at the top of Home (spec "Home
 * card"): the top 10 rows of this slot's frozen list, its label and build
 * time, and See more → /triage. A failure here never breaks Home.
 */
export default async function StartHereCard({ user }: { user: SessionUser }) {
  let view: TriageView | null = null;
  let teammates: string[] = [];
  try {
    view = await loadTriageView(triageUserFromSession(user), triageNow());
    teammates = (await activeUsers()).map((u) => u.name).filter((n) => n !== user.name);
  } catch (err) {
    console.error("[triage] Start here card failed", err);
  }
  if (!view) {
    return (
      <section className="pk-card" style={{ marginBottom: 22, padding: "14px 17px", fontSize: 12.5, color: "#8a6d1f" }}>
        Start here couldn’t load your list — <Link href="/triage" style={{ color: "var(--accent)" }}>try the full list</Link>.
      </section>
    );
  }
  const top = view.rows.slice(0, HOME_LIMIT);
  return (
    <section className="pk-card" style={{ marginBottom: 22, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "14px 17px 6px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: "#16181d" }}>Start here</span>
          <span style={{ fontSize: 12, color: "#8c919c" }}>
            {slotLabel(view.snapshot.slot)} · built {chicagoTime(view.snapshot.builtAt)}
          </span>
        </div>
        <Link href="/triage" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
          See more{view.rows.length > top.length ? ` (${view.rows.length})` : ""} →
        </Link>
      </div>
      {view.note && <div style={{ fontSize: 12, color: "#8a6d1f", padding: "0 17px" }}>{view.note}</div>}
      {view.snapshot.errors.map((e) => (
        <div key={e.source} style={{ fontSize: 12, color: "#8a6d1f", padding: "0 17px" }}>{e.message}</div>
      ))}
      <div style={{ padding: "0 17px 8px" }}>
        <TriageRows rows={top} readOnly={false} teammates={teammates} />
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Put the card on Home**

In `src/app/(app)/page.tsx`:
- add imports:

```tsx
import { Suspense } from "react";
import StartHereCard from "@/components/triage/start-here-card";
```

- between `<HomeGreeting … />` and `<WidgetHost … />` add:

```tsx
      <Suspense fallback={<div className="pk-card" style={{ marginBottom: 22, padding: "14px 17px", fontSize: 12.5, color: "#8c919c" }}>Building your Start here list…</div>}>
        <StartHereCard user={user} />
      </Suspense>
```

- [ ] **Step 7: Run the gates**

Run: `npx tsc --noEmit && env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20`
Expected: `ALL PASSED`.
Run: `npx eslint "src/app/(app)/page.tsx" "src/app/(app)/recordings/[id]/page.tsx" "src/app/(app)/recordings/[id]/detail-client.tsx" src/components/triage src/lib/recording-deep-link.ts scripts/test-morning-triage.ts`
Expected: no errors.
Run: `env -u DATABASE_URL npm run build 2>&1 | tail -15`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/components/triage src/lib/recording-deep-link.ts "src/app/(app)/page.tsx" "src/app/(app)/recordings/[id]" scripts/test-morning-triage.ts scripts/test-review-and-spec.ts
git commit -m "feat(triage): Start here card on Home; call lines deep-link to the transcript moment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs, numbers and the full gate

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase list)

**Interfaces:**
- Consumes: the finished feature.
- Produces: Decision entries, a punch item, an AGENTS.md phase entry; a green full gate.

- [ ] **Step 1: Compute numbers from origin/main at this moment**

Run:
```bash
cd /Users/sm/Downloads/peak-app-triage && git fetch origin && \
git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | sed 's/## D//' | sort -n | tail -1 && \
git show origin/main:PUNCHLIST.md | grep -oE "^## [0-9]+" | sed 's/## //' | sort -n | tail -1 && \
git branch -a --format='%(refname:short)' | grep -oE "[0-9]{3}" | sort -n | uniq | tail -5 && \
git show origin/main:drizzle/meta/_journal.json | grep -oE '"tag": "[0-9]{4}_[a-z_]+"' | tail -2
```
Let `DN` = highest D on origin/main + 1 and `PN` = highest punch on origin/main + 1; if `PN` is already used by an in-flight branch or plan (e.g. #321 conduit riser, #323 Krisp meetings, or specs 1–3 if they took numbers), skip to the next free one. If origin/main's journal already has a `0036_…` migration, regenerate ours: delete `drizzle/0036_triage.sql` and `drizzle/meta/0036_snapshot.json`, remove the `0036_triage` journal entry, merge origin/main, rerun `env -u DATABASE_URL npx drizzle-kit generate --name triage`, re-apply the Task 1 Step 8 hardened SQL under the new number, and update the two `migration 00NN_triage` comments in `src/db/doc-tables.ts`.

- [ ] **Step 2: Append Decision entries to `DECISIONS.md`**

Append five entries, numbered `DN` … `DN+4`, each headed `## D<n>. <title> (#<PN>, 2026-10-09)` (use the real date if later), with this content:

1. **Morning triage: who each feed belongs to.** Email = the bell's rule (status `waiting_us`, `assignedTo` me, not archived on either side, not in Deleted). Leads and portal quotes to review = mine **or unassigned**, matching the bell's `unownedOrMine` / `mineOrUnassigned` (so an unassigned lead with a breached SLA shows on everyone's list until someone takes it). Quotes = the #284 approval rules plus "sent back for changes" (an approved-and-holding draft is not on the list). Renewals = the #37 "To contact" worklists by job `owner`, past due or in the 60-day window, already-contacted excluded. Calls = pending action items from Recordings in the last 7 days that name me (matchAssignee), or that name no teammate on a recording I made. Visits = today's not-done visits where I'm `assignedTo` or in `attendees` (spec 2's field, read as `?? []`).
2. **Ranking interpretation.** "Task overdue 40 + 5/day" counts from day 1 by Chicago calendar day (1 day = 45, capped at 70); a task due any time today is "due today", not overdue. "Customer waiting 40 + 10/extra business day" (1 day = 40, 4+ days = 70). Business time = elapsed time on Chicago Mon–Fri days (Fri 3 pm → Mon 10 am = 19 h = under one business day). A task's High/Low tier is read from spec 3's `priority` only when present — until spec 3 extends `normalizeTask` to carry it, tier contributes nothing. Ties: older first, then key; an unknown age sorts after known ones.
3. **Slots and refresh.** Before noon Chicago reads the morning list, noon on reads midday. The morning build rides the daily Gmail cron (12:00 UTC = 7:00 CDT / 6:00 CST — still "today's morning" either way); the midday build is `/api/triage/build?slot=midday` at 17:00 UTC (noon CDT / 11:00 CST), defaulting to midday. Two once-a-day crons, Hobby-safe. A cron build overwrites its slot; a lazy build happens only when the slot has no snapshot; if a lazy build can't be saved the list is computed live with a note. Between runs the list is frozen except rows whose source is done — task/assignment done, thread no longer waiting on me (replied, closed, archived, reassigned), call to-do decided, quote no longer waiting on me. Lead / visit / renewal rows stay until marked or the next snapshot.
4. **Duplicates and row actions.** A call to-do matching one of my open tasks/assignments folds into that row ("Also mentioned in …") if it is on the list, and is dropped if the open work is off today's list (it's already tracked). Done writes the source for tasks, assignments (via `app`) and threads (→ closed), and also records a done mark; on a call to-do it opens the recording's Action items to accept/dismiss; elsewhere it is "Done for today" (hidden in this snapshot only). Snooze → back at the next morning snapshot. Not mine → permanent; on a call to-do it also dismisses the item on its recording; on an email it offers Reassign (active teammates only) or Just hide. A dismiss is never downgraded by a later mark.
5. **Access, storage and seams.** Admins (`manage_users`) can view a teammate's list at `/triage?user=<id>`, read-only; marks are always the signed-in user's own. Two new doc collections, `triage_snapshots` and `triage_marks` (migration 00NN_triage), not syncable, wiped by the go-live reset (derived state), readable through `/api/sync/pull` like every collection. Specs 1–3 plug in through `TRIAGE_HOOKS` (`src/lib/triage/hooks.ts`: an at-risk provider and a visit-flag provider, both empty today) — one line each at their merge. Krisp #323 meetings plug in as a second `CallTodoSource` in `src/lib/triage/feeds/calls.ts`. `/recordings/[id]` accepts `?tab=` and `?seg=` so a call line opens at its transcript moment. No snapshot pruning yet (≈ 2 small rows per person per day).

- [ ] **Step 3: Add the punch item to `PUNCHLIST.md`**

Append (with the real numbers):

```markdown
## <PN>. Morning triage — "Start here" on Home — DONE 2026-10-09 (D<DN>–D<DN+4>)

Spec: docs/superpowers/specs/2026-10-09-morning-triage-design.md · Plan: docs/superpowers/plans/2026-10-09-morning-triage.md

Each person's ranked list at the top of Home (top 10, See more → /triage), built from seven feeds — email waiting on a reply, Recordings call to-dos (with the transcript line), tasks + Queue assignments, lead SLA / follow-ups, today's site visits, quotes awaiting you, renewals due — scored by a visible points table with a plain-words reason. Snapshots at 7:00 (Gmail cron rider) and 12:00 (new /api/triage/build cron) Central, lazily on first view, frozen between; Done / Snooze till tomorrow / Not mine per row; admins can view a teammate's list. Deterministic, no AI.

Open: wire spec 3's at-risk provider and specs 1–2's visit flags into `TRIAGE_HOOKS` when those merge (and have spec 3's `normalizeTask` carry `priority`); add a #323 meetings `CallTodoSource` when that lands; check on production that the 17:00 UTC cron fires (`CRON_SECRET` is already set for the Gmail cron).
```

- [ ] **Step 4: Add the AGENTS.md phase entry**

In `AGENTS.md`, after the last numbered item of "## Phase status" (currently item 42, "Estimator in four steps"), add:

```markdown
43. ✅ **Morning triage** (#<PN>, D<DN>–D<DN+4>) — a "Start here" card at the top of Home: each person's top 10 of one ranked list (See more → `/triage`; admins switch person, read-only) built from seven feeds under `src/lib/triage/feeds/` (email waiting ≥ 1 business day ranks higher, Recordings call to-dos behind a `CallTodoSource` with the matched transcript line linking to `/recordings/<id>?tab=transcript&seg=N`, tasks + assignments, lead SLA, today's visits, quotes awaiting you, renewals). Pure points table + reason (`rank.ts`), duplicate collapse, Chicago business-day clock. Per-user snapshots (`triage_snapshots`, `<userId>:<day>:<slot>`) built by the Gmail cron (morning) and `/api/triage/build` (midday, 17:00 UTC) and lazily on first view, frozen between except done sources; Done / Snooze / Not mine marks (`triage_marks`). Specs 1–3 plug in through `TRIAGE_HOOKS`; Krisp #323 through a second `CallTodoSource`.
```

- [ ] **Step 5: Run the full gate**

Run, in order (stop at the first failure and fix it):

```bash
cd /Users/sm/Downloads/peak-app-triage
npx tsc --noEmit
env -u DATABASE_URL npm run test:specs 2>&1 | grep -E "^FAIL|ALL PASSED|FAILED$" | head -20
npx eslint --ignore-pattern scripts/test-review-and-spec.ts $(git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx' | grep -v '^drizzle/')
env -u DATABASE_URL npm run build 2>&1 | tail -20
npm run test:smoke 2>&1 | tail -20
```

Expected: tsc clean; `ALL PASSED`; eslint 0 errors; build succeeds with `/triage` and `/api/triage/build` in the route list; smoke passes with `/triage` returning 200 (make sure no dev server holds port 3000 first: `lsof -i :3000`).

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md drizzle src/db/doc-tables.ts
git commit -m "docs: morning triage (#<PN>, D<DN>–D<DN+4>)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- One ranked list, ~10 + See more → Tasks 7, 9, 10 (`HOME_LIMIT`, `/triage`).
- Source + why on every row → `SOURCE_LABEL` chip, `reasonOf` (Tasks 2, 9).
- Call item shows its transcript line / "Source line not found" → Tasks 3, 6, 9, 10 (deep link).
- Deterministic, no AI → Global Constraints; no model code anywhere.
- Each person their own; admins view a teammate's → Task 9 page (`manage_users`, read-only).
- Waiting ≥ 1 business day; younger ranked lower → Task 1 clock, Task 4 email feed, Task 2 points.
- Morning + midday snapshots, frozen between, lazy build → Tasks 7, 8.
- Top of Home card → Task 10.
- Seven feeds, one module each, stable keys → Tasks 4–6, `FEEDS` check.
- Points table incl. caps, ties, reason → Task 2.
- Duplicates (to-do vs task, to-do vs to-do, accepted excluded) → Task 3 + Task 6 (pending-only check).
- Transcript match (≥ 0.5 share, ≥ 2 tokens, stopwords) → Task 3.
- Snapshot key per slot, cron + lazy, done-source hidden, snooze/dismiss hidden → Task 7.
- Row actions (Open, Done variants, Snooze, Not mine incl. call dismiss + email Reassign), marks per user → Task 9.
- Failures: per-feed note; live fallback with note → Task 7 (`gatherCandidates`, `LIVE_NOTE`), shown in Tasks 9–10.
- Testing list → Tasks 1, 2, 3, 4, 6, 7 checks.
- Specs 1–3 optional; Recordings instead of #323 → `hooks.ts`, `visitAttendees`, `tierOf`, `CallTodoSource`.

**Placeholder scan:** the only deferred values are Decision/punch/migration numbers in Task 11, which the brief requires be computed at that time; Step 1 gives the exact commands and rule.

**Type consistency:** `TriageFeed.load(ctx: FeedCtx)`, `FeedResult.openWork?: OpenWork[]`, `selectX(..., ctx: Pick<FeedCtx,"me"|"now">)`, `recordingTodos(recs, Pick<FeedCtx,"me"|"now"|"users">)`, `selectCalls(todos)`, `loadTriageView(me, now, { feeds?, save? })`, `buildSlotForAll(slot, now, { users?, feeds? })`, `setMark(Omit<TriageMark,"id">)`, `markHides(Pick<TriageMark,"kind"|"snapshotId"|"until">, SlotRef)`, `visibleRows(rows, marks, closed, cur)`, `closedKeys(rows, LiveDocs, TriageUser, now)` are used with the same names and shapes in every task and test.
