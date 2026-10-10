# Krisp meeting matcher — design (#323)

Brainstormed with Jeff 2026-10-09. This is sub-project **0** of the "AI-assisted site
visit" idea: before any site-visit question loop can work, every Krisp meeting a rep
records has to reach the right record in the app. Today it doesn't — the app only knows
about audio it uploads itself (Recordings, D152), while most real meetings are recorded
by **Krisp desktop** (auto-record on virtual calls) or the Krisp phone app and never
reach the app at all.

Later sub-projects (not in this build): 1) site-visit question loop (rules-based "answer
before you leave" list + rounds answered by Krisp calls), 2) final site-visit sheet,
3) create-from step (opportunities, tasks, projects, follow-up visits, quotes, new
customers). The AI question (D89) is reopened only in sub-project 1.

## What Jeff decided (brainstorm answers)

| # | Decision |
|---|---|
| K1 | **Pull every Krisp meeting into the app** — internal ones too. The app becomes where notes live. |
| K2 | **Personal until linked.** An unlinked meeting is visible only to the rep(s) whose Krisp account lists it. Linking to an internal person shares it with that person only. Linking to anything external (company, venue, external contact, a work record) makes it visible to all Peak staff. |
| K3 | **Customer portal only on an explicit "Share with customer"** — staff edit the summary first; the transcript never reaches the portal. |
| K4 | **Always suggest, rep confirms** — nothing is linked (and so nothing is shared) without a tap; **Confirm all** confirms every row with a strong suggestion. |
| K5 | **First sync = last 90 days**; **Load older** pulls another 90 days per tap. |
| K6 | **Krisp to-dos: choose per item, smart default** — assignee is a Peak person → Task for them; assignee is the customer → "Waiting on customer"; no owner → Note on the linked record. Rep can switch any before confirming. |
| K7 | **Lives in the Inbox** as a separate **Meetings** box (never mixed into mail), default tab **To file**, built as a standalone component so it can move to its own nav page later. |
| K8 | **Data model: a new `meetings` collection**; Recordings keeps its audio pipeline and attaches to the meeting its Krisp import produced. |
| K9 | **Attendees are corrected in the app**: Krisp's list ∪ the overlapping Google Calendar event's invite list ∪ manual adds/removes, each resolved to a contact (or offered as new). Krisp's own copy cannot be edited (its API has no meeting write). |
| K10 | **Speaker mapping** (option B): the rep maps "Speaker_2 → Tom Ellis" once; the app's copy of transcript, notes and to-do owners re-renders with real names. Find-and-replace, no AI. |
| K11 | **Matching signals** in strength order: venue/district name in the title → calendar event at that time → attendee emails → speaker first names → names in the summary → the rep's scheduled site visit at that time. Jeff confirmed titles are usually the venue or district name. |
| K12 | **Recordings under 3 minutes are "noise"** — own tab, no suggestions, never in To file. |
| K13 | **No AI.** The matcher, the notes rebuild and the to-do defaults are all deterministic (D89 holds for this build). |

Decision numbers (D7xx) are assigned at merge, recomputed from origin/main — other
in-flight branches (#320, #321) are also claiming D707+.

## Evidence that shaped the matcher

Jeff's last 15 owned Krisp meetings (read via the Krisp MCP, 2026-10-09, metadata only):
9 of 15 had **no attendee list** ("Jeff Chesebro <> Speaker_2", "Mobile recording –
October 6", "Jeff <> Jenna"); one calendar-backed meeting ("Osakis – theatrical owner
scope requests") had an **empty** attendee list; three were 45 s–3 min browser noise.
Calendar-backed titles carry the venue/district ("Oshkosh North – VE Engineering
Meeting", "Montevideo – orchestra pit discussion"). Attendee emails therefore cannot be
the primary signal; the title is.

## Krisp API (verified 2026-10-09 against meeting-api-docs.krisp.ai)

New since D152's research: **`GET /meetings`** lists meetings visible to the key holder
(owned + shared). Query: `limit` (≤100, default 20), `cursor` (from `next_cursor`),
`ownership` (`all|mine|shared`), `sort_by` (`date|duration|last_modified`), `order`
(`newest|oldest`), `q`, `from`/`to` (ISO date-time on meeting date), `tags`, `fields`.
Response `{meetings, next_cursor, total}`; each meeting `id, title, started_at,
duration, status, source, tags, ownership, participants` (participants opt-in via
`fields`; each `{email, first_name, last_name, status, photo}`). Only processed meetings
are listed. Rate limit 5 req/s sustained, 25 per 5 s burst, per Krisp account.

The list response carries **no last-modified timestamp**, so sync is a rolling date
window, not a "changed since" cursor (see Sync). `GET /meetings/{id}` (already in
`src/lib/krisp/client.ts`) supplies transcript + notes; the implementer must confirm
against the live reference whether detail content is requested via `fields=` (what the
D152 client sends) or `include=` (what the current docs index mentions) and support
whichever the API honours.

## Data model

### `meetings` collection (migration `0036`, hand-written like `0021`)

A doc table (`id, doc jsonb, rev, seq, updated_at, received_at, review, deleted` +
the `bump_doc_seq` trigger), module `src/lib/stores/meetings.ts`. **Not** in
`FIELD_COLLECTIONS` (not an offline-capture collection).

```ts
type MeetingRecord = {
  id: string;                 // "km-<krispMeetingId>" — deterministic, so the same
                              // meeting seen by two reps is stored once
  krispMeetingId: string;
  seenBy: string[];           // userIds whose Krisp key lists it (owned or shared)
  ownerUserId: string;        // the rep whose key reports ownership "owned"; else first seen
  recordingId: string | null; // REC-#### when our Record button produced it
  krisp: {                    // Krisp's original — refreshed by sync, never edited
    title: string; startedAt: number | null; durationSec: number | null;
    source: string | null; status: string; tags: string[];
    participants: { email: string | null; firstName: string | null; lastName: string | null }[];
    speakers: Record<string, { name: string | null; email: string | null }>; // transcript speaker idx → participant
    segments: { speaker: string; text: string; start: number; end: number }[];
    notes: { blocks: unknown[] } | null;     // raw; derived through deriveSummary()
    fetchedAt: number; detailFetchedAt: number | null;
    removedAt: number | null;                // vanished from Krisp — app copy kept
  };
  calendar: { eventId: string; title: string;
              attendees: { email: string; name: string | null }[] } | null;
  attendees: MeetingAttendee[];            // the corrected list (K9)
  speakerMap: Record<string, MeetingPersonRef>; // speaker idx → person (K10)
  links: {
    customerId: string | null; siteId: string | null;
    contactIds: string[];                  // external contacts, ≤ 25
    work: { type: "lead" | "site_visit" | "survey" | "project" | "engagement" | "quote";
            id: string; label: string } | null;
    internalUserIds: string[];             // Peak people it is shared with
  };
  filedAt: number | null; filedBy: string | null;   // set on first confirm
  suggestions: MeetingSuggestion[];        // recomputed each sync until filed
  noise: boolean;                          // durationSec < 180, unless rep un-noised it
  noiseOverride: boolean;
  todos: MeetingTodo[];
  share: { sharedAt: number; sharedBy: string; summary: string } | null;
};

type MeetingAttendee = {
  key: string;                              // stable: lowercased email, else "name:<normalised>"
  name: string; email: string | null;
  sources: ("krisp" | "calendar" | "manual")[];
  removed: boolean;                         // manual remove hides a krisp/calendar entry
  contactId: string | null; userId: string | null;  // resolved; both null = unresolved
};
type MeetingPersonRef = { contactId?: string; userId?: string; name: string };
type MeetingSuggestion = {
  kind: "company" | "venue" | "contact" | "work" | "internal";
  id: string; label: string;
  workType?: "lead" | "site_visit" | "survey" | "project" | "engagement" | "quote";
  score: number; strength: "strong" | "weak"; reasons: string[];
};
type MeetingTodo = {
  key: string;                               // actionItemKey() from derive.ts
  title: string; assigneeLabel: string | null; dueDate: string | null; // Krisp's
  suggested: "task" | "waiting" | "note" | "dismiss";
  decision: null | { kind: "task" | "waiting" | "note" | "dismiss";
                     createdId: string | null; decidedAt: number; decidedBy: string };
};
```

### Per-rep sync state

`krisp_connections` gains nullable columns (same migration): `meetings_synced_at`
(bigint), `meetings_backfill_from` (bigint — the oldest date pulled so far),
`meetings_backfill_cursor` (text — resumable `next_cursor` for an in-progress pull),
`meetings_last_error` (text).

### Additions to existing stores

- `TaskRecord` gains optional `meetingId?: string | null` and
  `waitingOn?: { contactId: string | null; name: string } | null` (written only when
  set, the #215 convention). A task with `waitingOn` is a **Waiting on customer** item:
  `assigneeUserId` = the rep who owns the nudge, `dueAt` = the nudge date (Krisp due date
  or +7 days).
- `NoteParentKind` gains `"site"` (a venue) so notes can be filed on venues.
- Recording ↔ meeting: `RecordingRecord` gains `meetingId?: string | null`, set when sync
  sees the recording's `krisp.meetingId`.

## Visibility (one pure module)

`src/lib/meetings/visibility.ts`:

- `meetingScope(m)` → `"private" | "internal" | "peak"`:
  `peak` if `links.customerId || links.siteId || links.contactIds.length || links.work`;
  else `internal` if `links.internalUserIds.length`; else `private`.
- `canSeeMeeting(m, userId)` → `peak`: any active user; `internal`: `seenBy ∪
  internalUserIds`; `private`: `seenBy`.
- `portalCanSee(m, customerId)` → `m.share != null && m.links.customerId === customerId`.

**Every** read path — the Meetings box, the reader, record-page cards, ⌘K, the customer
feed entry, the portal list — filters through these. Unlinking all external links drops
the scope back; if `share` is set, the unlink action requires confirmation and clears
`share`.

## Sync (`src/lib/meetings/sync.ts`)

Per rep with a `krisp_connections` row:

1. **Window.** Normal sync lists `from = now − 14 days` (rolling window, because the list
   has no last-modified field) with `ownership=all`, `fields=title,started_at,duration,
   status,source,tags,ownership,participants`, `limit=100`, following `next_cursor`.
   First sync / **Load older** lists `[backfill_from − 90 d, backfill_from)` and persists
   `meetings_backfill_cursor` between batches.
2. **Upsert.** For each listed meeting: create `km-<id>` if new (add the rep to `seenBy`,
   set `ownerUserId` when `ownership === "owned"`), refresh `krisp.*` header fields.
3. **Detail.** Fetch `GET /meetings/{id}` (transcript + notes) when the meeting is new,
   or `notes` is still empty and the meeting is < 48 h old (Krisp summarises late). A
   **Refresh from Krisp** button in the reader forces a detail re-fetch for older ones.
4. **Calendar.** If the rep's personal Google connection has the Calendar scope,
   `listUpcomingEvents(personalKey(userId), {timeMinMs: start − 15 min, timeMaxMs: end +
   15 min})`, pick the event with the greatest time overlap, then `getEvent` for its
   attendees. Stored once in `m.calendar`; skipped silently when there's no scope.
5. **Recordings.** If a `recordings` doc has `krisp.meetingId === id`, set both
   `m.recordingId` and the recording's `meetingId`, and pre-fill links from the
   recording's parent (site visit / survey → work link + its customer/venue) — these
   count as confirmed (`filedAt` set) since the rep chose the parent when recording.
6. **Attendees + match.** Rebuild `attendees` (K9; manual entries and `removed` flags
   preserved), then recompute `suggestions` and `noise` for unfiled meetings.
7. **Removed.** A meeting in the window that no longer lists gets `krisp.removedAt`.

Batches are time-boxed (40 s budget) and resumable; requests are paced under Krisp's
5 req/s per account, with `429` → exponential backoff and the batch ends early.
Triggers: the Meetings box tick (every 3 min while open, like the Gmail tick), a Home-load
stale check (> 10 min since `meetings_synced_at`), **Sync now**, and a rider on the daily
`/api/gmail/sync` cron. A `401/403` writes `meetings_last_error` and shows on the
Account → Krisp card; existing meetings stay.

## Matcher (`src/lib/meetings/match.ts`, pure)

Input: the meeting (title, calendar title, summary text, attendees, speakers, start/end),
the owning rep's id, and a prebuilt index — companies (`name`, `keywords`), sites
(`name`, `locationName`, `companyId`), contacts by email and by first name per company,
`customersForDomain`, Peak users (internal emails = `peaksystemsgroup.com` + each user's
`email`/`googleEmail`, the existing `ownAddresses()` rule), the rep's site visits and
surveys whose scheduled window overlaps the meeting, and each company's open leads,
active projects and active engagements.

**Name cores.** Each company/site name (and each keyword) is normalised (lowercase,
punctuation → space) and stripped of generic words (`school(s)`, `district`, `public`,
`high`, `middle`, `elementary`, `isd`, `usd`, `community`, `college`, `university`,
`city`, `church`, `theatre/theater`, `center/centre`, `pac`, `auditorium`,
`performing arts`, `inc`, `llc`, `co`, `company`, `the`, `of`, `and`). A core shorter
than 4 characters, or empty, is not used. A text **hits** a candidate when its
normalised form contains the core as whole words.

**Points** (summed per candidate company, venues inherit their company's points plus
their own):

| Signal | Points |
|---|---|
| Krisp title hits the company or venue core | 50 |
| Calendar event title hits it | 30 |
| An attendee email resolves to a contact at the company (`contactsByEmails`) | 60 |
| An attendee email domain maps to the company (`customersForDomain`) | 40 |
| The rep has a site visit / survey for that company scheduled overlapping the meeting | 40 |
| Summary/key-points text hits the core | 20 |
| A speaker first name equals a contact's first name at the company | 10 |

**Strength.** Top candidate ≥ 80 **and** ≥ 30 ahead of the runner-up → `strong`;
≥ 40 → `weak`; below 40 → no company suggestion. Several candidates tied on a title hit
(a district that is both a company and a venue of another company) → all suggested,
`weak`.

**Derived suggestions** for the top company: the venue whose core hit (else the venue
of an overlapping site visit); resolved external attendee contacts; a work link only
when unique — overlapping site visit/survey > the company's single open lead > single
active engagement > single active project. **Internal:** when no external candidate
reaches 40 and resolved attendees/speakers include Peak users other than the owner,
suggest `internal` links to them (`strong` when ≥ 1 resolved by email).

**Noise:** `durationSec < 180` → `noise = true`, no suggestions (unless `noiseOverride`).

Reasons are human strings shown in the UI ("title says Osakis", "calendar: Osakis –
scope review", "tom@osakis.k12.mn.us is Tom Ellis").

## Notes rebuild (`src/lib/meetings/render.ts`, pure)

`renderMeeting(m)` → the app's copy:

- **Attendees block** from `attendees` (not removed), names from the resolved contact /
  user when present.
- **Speaker labels.** For each speaker idx, its original label is Krisp's participant
  name or `Speaker_<n>` / `Speaker <n>`. With a `speakerMap` entry, every whole-word
  occurrence of the original label in segments, summary, key points and to-do assignees
  is replaced with the mapped display name.
- Summary / key points / to-dos come from `deriveSummary(m.krisp.notes)` (existing,
  never throws on unknown block types).

Because rendering always starts from `krisp.*`, a Krisp refresh never loses corrections,
and a speaker-map change re-renders everywhere at read time.

## To-dos (K6)

`todos` merge by `actionItemKey` on every detail fetch (decided items untouched,
dismissed stays dismissed). Default `suggested`:
- assignee label (after speaker mapping) resolves to a **Peak user** → `task`;
- resolves to an **external contact** → `waiting`;
- otherwise → `note`.

Confirming (per item or **Confirm all to-dos**; only allowed once the meeting is filed):
- `task` → `createTask` with `assigneeUserId`, `dueAt` (Krisp due date), `customerId`,
  `siteId`, `leadId`, `contactIds`, `engagementId`/`projectId` from the work link,
  `meetingId`.
- `waiting` → `createTask` as above plus `waitingOn {contactId, name}`, assignee = the
  rep, `dueAt` = due date or +7 days.
- `note` → `addNoteRecord` on the most specific linked parent available: venue (`site`)
  > lead > project > engagement > customer.
- `dismiss` → recorded only.
`decision.createdId` makes it idempotent.

The superseded D152 write-backs for recordings that now have a meeting: the recording
page's action items and feed note defer to the meeting (no second task, no duplicate
feed note).

## Customer feed

The company feed shows **one entry per linked, visible meeting** ("Met with Tom Ellis —
Osakis PAC scope review →") that opens the reader. No summary text is copied into a
note.

## UI

### Inbox → Meetings box (`src/app/(app)/inbox/meetings/…`, standalone component)

- Box picker entry **Meetings** with the to-file count; `?view=meetings`. The existing
  **Calls & meetings** view (hand-logged comms) is unchanged.
- Tabs: **To file** (sections *This week* / *Older*), **Filed**, **Noise**.
- Row: title, date, length, source, top suggestion chip (strong solid / weak outline),
  scope icon (🔒 only you · 👥 internal · 🏢 all of Peak · 🌐 shared with customer).
- **Confirm all** — confirms every To-file row whose top suggestion is `strong`,
  applying exactly that row's strong suggestions.
- **Sync now**, last-synced time, **Load older** (also on Account → Krisp).

### Reader

Header (title, time, length, source, **Open in Krisp**, **Refresh from Krisp**);
**Attendees** (source badges, resolve / **+ New contact** at the suggested company,
add / remove); **Speakers** (`Speaker_2 → [pick attendee or search]`); summary + key
points (rendered copy); **To-dos** (suggested kind switch, target, Confirm / Confirm
all); transcript (collapsed).

### Sidebar

Suggestions with reasons and **Confirm**; manual linking reuses the Inbox link-target
search (`searchLinkTargetsAction` / `rankLinkTargets`) for company, venue, people, plus a
work picker (lead, site visit, survey, project, engagement, quote) and an internal-people
picker. **Share with customer…** (only when `links.customerId` set) opens an editable
summary; **Stop sharing** clears it.

### Elsewhere

- Home: "N meetings to file →" (count of the viewer's unfiled, non-noise meetings).
- **Meetings card** on company, venue, person, lead, site visit/survey, project and
  engagement pages (visible meetings linked there, newest first).
- ⌘K: `meetings` in `/api/search` — title + rendered summary, visibility-filtered.
- Account → Krisp card: sync status, last error, **Sync now**, **Load older**.
- Portal: **Meeting notes** list — `portalCanSee` meetings only, showing the shared
  summary, date and title (no transcript, attendees, to-dos or links).
- Company/venue pages: **Waiting on customer** list (open tasks with `waitingOn`);
  Home's to-do list groups `waitingOn` tasks under **Waiting on others**.

## Permissions

All meeting actions `requireUser()` and check `canSeeMeeting`. Linking and to-do
decisions require the viewer to be able to see the meeting; **Share with customer**
requires `create`. Portal reads go through `portalSession()`'s `customerId`.

## Error handling

- Krisp key missing/revoked → Account card warning; sync skips that rep.
- `429` → backoff, end batch, resume next trigger.
- Detail `409` (still processing) → retry next sync.
- Calendar errors → `calendar` stays null; matching proceeds without it.
- A linked record deleted later → the link renders as "(removed)"; scope recomputed
  ignoring dead links.

## Testing

- `test:specs` checks: matcher fixtures from the real shapes (title + calendar → strong;
  title only → weak; "Jeff <> Speaker_2" alone → none; mobile recording during a
  scheduled site visit → that visit; 45 s → noise; district that is both company and
  venue → both weak; email-resolved contact; internal-only recurring meeting →
  internal); name-core stripping; visibility across every link combination; render with
  speaker map + Krisp refresh keeping corrections; to-do default + idempotent confirm;
  sync against a fake Krisp transport (window, cursor paging, backfill resume, 429,
  removed, recording attach, dedupe across two reps).
- Gates: `tsc`, `test:specs`, `test:smoke` (adds `/inbox?view=meetings`), eslint vs
  baseline, `next build`; a browser pass on seeded meetings on a scratch datadir.
- Post-merge (Jeff): run against his real Krisp key on production.

## Out of scope (follow-ups)

Calling through Krisp (API has no call endpoint — likely a Krisp-app deep link only);
portal request list from Waiting-on-customer items; AI rewriting of summaries; Meetings
as its own nav page; Krisp folders/tags as matching signals; the site-visit question
loop (sub-project 1) and beyond.
