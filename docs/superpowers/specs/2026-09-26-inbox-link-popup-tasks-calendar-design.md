# Punch #212–#215 — Grid allowance descriptions, Catalog under Estimating, Inbox link popup, tasks from email + tasks on the calendar

Date: 2026-09-26 · Worktree: `.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`)
Decisions: D333 onward (D329–D332 are held by the spec-builder branch). Numbers re-checked against
`origin/main` immediately before the docs are written and again before push.

Jeff's words (2026-09-26):

> In the Grid, we should allow for a description of the allowance besides just an allowance, so that
> way if it is a product that just doesn't have a catalog item we can say it so it comes through.
> Catalog needs a tab under estimation.
> Linking in the inbox needs to be cleaner, right now I want to be able to select the message and pop
> up stuff to link from it. If multiple people are on the email give the option to link multiple
> people. I want a better search button so you can type in the name or venue. I would also like some
> logic built in for reading the message that is selected and finding the signature and filling that in.
> I also would like a task to be able to be created from the email with links to the contact,
> opportunity, project, or whatever else inside the app that is linkable to a contact. From there I also
> would like to add any notes and assign it to an internal person. I would also like to set a due date
> that shows up in the calendar view. Ultimately all tasks should show up in the calendar view and if
> there is no due date or the due date is passed it should float with the day until they are either
> completed or deleted.

Picks confirmed in chat: allowance description in **both** places; calendar shows **mine + an
Everyone toggle**; calendar shows **Tasks and My Queue assignments**; signature → **prefill new
contact + offer to fill blanks on a known one**; Inbox linking is a **popup** (not an upgraded
sidebar).

No DB migrations: `comms`, `tasks`, `assignments`, `grid_projects` are JSONB doc tables and the
equipment map is a settings blob. New fields are optional, so old docs read unchanged.

---

## #212 — Grid: a description on allowances, and per-design custom items

### Equipment-map allowances get a customer-facing description
- `EquipCell` allowance (`src/lib/design/equipment-map.ts`) gains `description?: string` (trimmed,
  ≤ 200 chars, empty → absent). `EquipCellInput` allowance gains the same. `mergeEquipRow` validates
  it like `note`.
- The editor (`design/grid/settings/equipment-map/equipment-map-client.tsx`) shows a "Quote
  description (optional)" input beside the internal "Why…" note, with placeholder = the row label.
- The virtual part (`grid-virtual-parts.ts`, `allow:<rowKey>:<tier>`) resolves `desc` to
  `description || def.label`. The "(allowance no longer confirmed)" dead-cell suffix still applies.
- `note` stays internal and never reaches the quote.

### Per-design custom items ("a product that just doesn't have a catalog item")
- New option-scoped field on the Grid project option (wherever placements/routes live per option in
  `src/lib/stores/grid-projects.ts`): `customItems?: GridCustomItem[]`:
  ```ts
  type GridCustomItem = {
    id: string;          // "ci-" + short random
    desc: string;        // required, trimmed, ≤ 200
    mfr?: string;        // ≤ 80
    model?: string;      // ≤ 80
    system?: string;     // optional system key (same vocabulary placements use), for grouping
    qty: number;         // integer ≥ 1, ≤ 100000
    unitCost: number;    // > 0, ≤ ALLOWANCE_MAX
  };
  ```
- Copied by option duplication and captured by revisions exactly like placements (follow whatever
  those paths already do for option-scoped arrays).
- Pure helper (new `src/lib/design/grid-custom-items.ts`): `sanitizeCustomItem(input) → item | error`,
  `customItemBomLines(items) → BomLine[]` with `allowance: true, custom: true`,
  `desc = [desc, mfr, model].filter(Boolean).join(" — ")` for mfr/model, sku `custom:<id>`.
- `buildGridQuote` (`grid-quote.ts`) appends them as priced allowance lines: sell = unitCost ÷
  (1 − the customer's tier margin), exactly the allowance path. Spec line `desc` = the text above,
  `allowance: true`. They are always "priced", so they never make an estimate "Incomplete".
- The Grid editor BOM panel (`design/grid/[id]/editor.tsx`) gets "+ Custom item" → a small inline
  form (description, mfr, model, qty, unit cost) and each custom line shows an "Allowance · custom"
  chip with edit and remove. Saved through a new server action on the design (same permission as
  the other placement edits), server-side sanitized.
- Bid-spec BOM keeps dropping allowance lines (unchanged), so custom items stay out of specs.
- Not in scope: placing a custom item on the plan sheet, add-to-catalog from a custom item.

## #213 — Catalog under Estimating
- `src/components/nav/nav-data.ts`: add `{ key: "catalog", label: "Catalog", href: "/catalog" }`
  as the last child of the `est` group; `activeKeyFor` maps `/catalog` → the Estimating group key
  (whatever key the other `est` children resolve to) instead of `"settings"`.
- The Settings → Company "Catalog" link stays (second door). No new permission gate — `/catalog`
  already works for any signed-in user and gates its admin parts itself.

## #214 — Inbox: the Link popup

### Data model (`src/lib/stores/comms.ts`)
- `CommThread` gains `linkedContactIds?: string[]` — every person linked to the thread (deduped,
  capped at 25). The existing `resolvedContactId` stays the primary contact; linking a person when
  there is no primary also sets it as primary. Unlinking the primary promotes the next linked one
  (or clears it).
- `CommMessage` gains `cc?: string` (raw header, like `to`). `parseInbound` (`src/lib/gmail/mime.ts`)
  parses Cc; `bridge.ts` stores it instead of `cc: ""`.
- `CommMessage` gains `ccFetched?: true` once a lazy Cc fetch has run (see below).

### Participants (pure, new `src/lib/inbox-participants.ts`)
- `participantsOf(message, mailboxAddresses) → { name, email, role: "from"|"to"|"cc" }[]`: parses
  From/To/Cc (RFC 5322 display-name + angle-addr, quoted names, comma lists), lowercases emails,
  dedupes by email, and drops our own mailbox addresses (the connected box + team users' emails).
- Server side, each participant is matched with `contactsByEmails` → `{ ...participant, contactId?,
  contactName?, companyId?, companyName? }`.
- Lazy Cc backfill: when the popup opens on a Gmail-imported message with no `cc` and no
  `ccFetched`, a server action fetches that one message's headers (metadata format, `Cc` only) via
  the existing Gmail client, stores `cc` + `ccFetched: true`, and returns the updated participants.
  Inert when Gmail is disabled or the message has no Gmail id (then participants are From/To only).

### Signature reader (pure, new `src/lib/inbox-signature-parse.ts`, deterministic — no AI, D89)
- `extractSignature(body: string, sender: { name?, email }) → { name?, title?, company?, phones:
  { label: "mobile"|"office"|"other", number }[], email?, website? } | null`.
- Rules: cut quoted history first (lines starting `>`, "On … wrote:", "-----Original Message-----",
  "From: … Sent: …" blocks); take the last ≤ 12 non-empty lines of the remaining text, starting
  after a sign-off (`--`, "Thanks", "Thank you", "Best", "Regards", "Sincerely", "Cheers" …) when
  present; phones by NANP-ish regex with label from a nearby "m/c/cell/mobile" or "o/office/direct/
  t/tel/p/phone" token; emails/websites by regex; name = the first line matching the sender's display
  name tokens, else the first 2–4-word capitalized line before the title; title = the line after the
  name if it contains a title keyword (Director, Manager, Coordinator, Engineer, Designer, Owner,
  President, VP, Chair, Teacher, Principal, Supervisor, Technician, Producer, Head, Lead, Officer,
  Administrator, Specialist, Assistant, Associate …) or is short and not a phone/email/URL/address;
  company = the next non-contact line, or a line matching the sender's email domain root.
  Returns `null` when nothing beyond the email is found.
- Consumers: the popup's "From the signature" card.
  - Unknown sender → "Add as contact" opens quick-add prefilled (name, title, email, phone,
    company pre-selected when the signature company or email domain matches exactly one company).
  - Known contact → "Add missing details" lists only fields the contact lacks (title, a phone
    number not already on file). One click writes only those blanks via a server action; never
    overwrites.

### Search (server action `searchLinkTargetsAction(q)`)
- One query across companies (name, city), venues/sites (name, address, city — with their
  company), and people (name, email — with their home company). ≤ 8 per group, same ranking helper
  the other typeaheads use (`src/lib/search/typeahead-rank.ts`). Leads/quotes stay in the Work
  section (scoped to the chosen company) — unchanged.
- Picking a company → link company. Picking a venue → link its company + the venue. Picking a
  person → link the person (added to `linkedContactIds`) and their home company when the thread has
  no company yet.

### The popup (`src/app/(app)/inbox/link-popup.tsx`, client)
- Opens from (a) clicking a message header's new "Link…" button in the reader, (b) the sidebar's
  "Edit links" button (opens on the thread's identity message). The selected message is the
  popup's subject ("Linking from" = that message, reusing `setIdentityMessageAction`).
- Sections, top to bottom:
  1. **People on this email** — one row per participant: checkbox (checked = in
     `linkedContactIds`), name, email, role chip (From/To/Cc), matched company, or "Add" for
     unknown addresses (quick-add prefilled from the display name + email, and from the signature
     when this participant is the sender). Checking/unchecking saves immediately.
  2. **Company & venue** — current links with change/clear, and the search box above.
  3. **Work** — the existing work-link type + record picker, scoped to the linked company.
  4. **From the signature** — as above, for the selected message's sender.
  5. Footer: **Create task** (opens #215's form) and Done.
- The link sidebar keeps showing the summary (company, venue, linked people chips, work link,
  tasks on this thread) with "Edit links"; its dropdown editors are removed. Its quick-add forms
  move into the popup. Existing server actions are reused; new ones: `setThreadContactsAction`
  (add/remove one contact id), `searchLinkTargetsAction`, `fetchMessageCcAction`,
  `fillContactBlanksAction`.

## #215 — Tasks from email; every task on the calendar

### Task links (`src/lib/stores/tasks.ts`)
- `TaskRecord` gains optional `contactIds?: string[]`, `customerId?: string | null`,
  `siteId?: string | null`, `leadId?: string | null`, `threadId?: string | null`. Existing
  `projectId`/`quoteId`/`designId`/`engagementId` unchanged. `createTask` accepts them.
- New readers: `tasksForThread(threadId)`, `tasksForCustomer(customerId)`,
  `tasksForContact(contactId)`.

### Create task from email (`src/app/(app)/inbox/task-dialog.tsx`)
- Opened from the popup footer and from each message header ("Task…").
- Fields: Title (prefilled with the subject), Links (checkbox list pre-ticked from the thread:
  linked people, company, venue, the work link — lead/quote/project/survey/inspection — plus
  "this email thread", always ticked), Notes (prefilled `From email: "<subject>" — <sender>, <date>`),
  Assign to (active users; default = me), Due date (optional date input), Save.
- Server action `createTaskFromThreadAction` (`requireUser`; writes via `createTask`; sets `section`
  = "Email", `createdBy` = me; `dueAt` = local noon of the picked date or null), revalidates the
  inbox and `/calendar`. Surveys/inspections (not a TaskRecord link today) are written into the
  notes as a reference line rather than a new link field.
- The thread sidebar lists open tasks for the thread (title, assignee initials, due) with a
  complete checkbox.

### The calendar (`/calendar`)
- Pure planner (new `src/lib/calendar-tasks.ts`, no imports beyond types):
  `placeTasks(tasks, { today: dayKey, rangeStart, rangeEnd }) → { dayKey, item, carried: boolean,
  overdueDays: number }[]`:
  - open task with `dueAt` on or after today → placed on its due day (if inside the range);
  - open task with no `dueAt` → placed on today, `carried: true`, `overdueDays: 0`;
  - open task with `dueAt` before today → placed on today, `carried: true`,
    `overdueDays = today − due` in whole days;
  - done/deleted → not placed; nothing is ever placed on a past day;
  - if today is outside the range, carried items are omitted.
  Day keys use the same `dayKeyOf` convention as `calendar-client.tsx`.
- Sources: `TaskRecord` (status ≠ done, not deleted, `assigneeUserId` set) and `assignments`
  (not done, `assignee` set, `dueDate` 0 = none), normalized to
  `{ kind: "task"|"assignment", id, title, dueAt|null, assigneeName, assigneeUserId?, href }`
  (href: the linked record — thread, project, quote, … — or `/queue` for assignments).
- Default filter: assigned to me (by user id for tasks, by name for assignments, matching how each
  store already identifies "me"). `?tasks=all` = Everyone; a toggle in the calendar toolbar
  switches it and each chip then shows the assignee's initials.
- Rendering: tasks are all-day chips at the top of the day (month cell list, and a task strip above
  the time grid in week/day). Chip: checkbox (complete → `setTaskStatus(done)` /
  assignment-done action), title (links to href), "carried" or "overdue N d" tag, × (delete →
  `removeTask` / assignment delete, with confirm). Completing or deleting refreshes the calendar.
- The Home calendar card is unchanged.

## Testing & gates
- Spec-harness assertions (tagged `#212`…`#215`) for: equipment-map description merge + virtual
  part desc; custom-item sanitize + BOM lines + quote pricing; nav-data catalog entry +
  `activeKeyFor("/catalog")`; `participantsOf` parsing (quoted names, commas, dedupe, own-address
  drop); `extractSignature` on ≥ 6 realistic bodies (reply with quoted history, "Sent from my
  iPhone", mobile + office phones, no signature → null); linked-contacts add/remove/primary
  promotion; `placeTasks` (future, undated, overdue, done, range edges).
- Four gates: `tsc`, `test:specs`, `test:smoke`, eslint vs a baseline, plus `next build` (client
  components must not import stores). Browser check on a scratch datadir.
