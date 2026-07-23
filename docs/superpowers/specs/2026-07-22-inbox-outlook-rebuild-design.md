# Inbox — Outlook-style rebuild (design)

Date: 2026-07-22
Status: approved (Jeff, 2026-07-22 — "start building this out")
Area: `src/app/(app)/inbox/*`, `src/lib/stores/comms.ts`

## Problem

The `/inbox` tab works (Gmail plumbing is fine) but the *experience* is wrong.
Jeff wants it to look and behave like **new Outlook / Outlook on the web**, and
to be able to **search and filter by name (or anything)** across all his mail.

Today's gaps vs. new Outlook:

- No command bar / bulk actions — you act on one thread at a time.
- Search only filters the rows already loaded in the current folder
  (`ThreadList` does `list.rows.filter(haystack.includes(ql))`). It cannot find
  a message in Sent, Archived, or another mailbox.
- No filter (Unread / Flagged / Has attachment / To me / Needs reply).
- No sort control (always date-ish).
- No flag, pin, or category.

The 3-pane frame (mailbox sidebar → message list → reading pane) already matches
Outlook and **stays**. All work is in the message list, a new command bar above
it, global search, and three small additive fields on the thread record.

## Decisions (locked)

1. **Match new Outlook / Outlook on the web** (not classic ribbon, not mobile).
2. **Behaviors to build:** multi-select + bulk actions, filter + sort dropdowns,
   flags + pins + categories. (No keyboard shortcuts this round — Jeff dropped
   them.)
3. **Search scope:** everything, everywhere — all mailboxes + all folders,
   matching sender name, email, customer, subject, body, and attachment
   filenames. A scope dropdown narrows to "This folder". Server-side.
4. **Delete = recoverable.** "Delete" moves a thread to a **Deleted** folder
   (a `deleted` flag on the thread, mirroring `archived`). Never a hard delete
   from the UI; restore brings it back. Distinct from doc-store's row-level
   soft delete, which we do **not** touch.
5. **Categories:** a small fixed palette (Outlook-style preset colors), one
   category per thread, assignable from the command bar / row menu.

## Data model (additive — no migration; threads are JSON docs)

Add to `CommThread` (`src/lib/stores/comms.ts`), all optional:

```ts
flagged?: boolean;     // follow-up flag
pinned?: boolean;      // pin to top of its list
category?: string;     // one of CATEGORY presets (key)
deleted?: boolean;     // in the Deleted folder (recoverable)
```

- `FolderId` gains `"deleted"`. `SmartView` gains `"flagged"`.
- New `CATEGORIES` preset list: `{ key, label, color }[]` (e.g. red/orange/
  yellow/green/blue/purple), exported for the VMs.

### Visibility rule

`deleted` threads are excluded from every folder and view **except** the Deleted
folder — same shape as the existing `archived` guard. Concretely, add
`&& !t.deleted` to the inbox/sent/drafts/outbox/needs/calls/flagged predicates,
and the Deleted folder is `t.deleted === true`.

### `threadsIn` gets filter + sort options

```ts
threadsIn(boxId, folder, me, {
  query?, filter?: FilterKey, sort?: SortKey
})
```

- `FilterKey`: `"unread" | "flagged" | "attachments" | "tome" | "needs"` (each
  a predicate on the base set).
- `SortKey`: `"date" | "from" | "subject"`. Default keeps today's
  waiting-first-then-date behavior for the inbox; explicit sort overrides.
- Pinned threads always sort to the top of their list, above the sort order.

## Server actions (`inbox/actions.ts`)

Single + bulk. Bulk takes `string[]` and loops the store mutator, then one
`revalidate()`:

- `flagAction(id, on)` / `bulkFlagAction(ids, on)`
- `pinAction(id, on)` / `bulkPinAction(ids, on)`
- `categoryAction(id, key)` / `bulkCategoryAction(ids, key)`
- `deleteAction(id)` / `bulkDeleteAction(ids)`  → sets `deleted = true`
- `restoreAction(id)` / `bulkRestoreAction(ids)` → clears `deleted`
- `bulkArchiveAction(ids)`, `bulkMarkReadAction(ids, read)`,
  `bulkMoveAction(ids, mailbox)` (reuse existing single mutators)

Store mutators mirror `archive()`: `patchDoc("comms", id, d => {...})` + `touch`.

## Global search

New server action `searchInboxAction(q, scope)` (scope = `all` | current box/
folder). Uses the proven `searchDocs("comms", q, CANDIDATES)` SQL-candidate
pattern (already used by `/api/search`), then a precise per-field match over
name / email / customer / subject / **body** / **attachment filenames**, mapped
to `ThreadRowVM`. Returns a flat, sorted result list the list pane renders in a
"search results" mode (shows which folder/mailbox each hit is in).

Debounced client input (~250ms); `scope=all` is the default.

## View models (`inbox/types.ts`) + `page.tsx`

- `ThreadRowVM` gains `flagged`, `pinned`, `category` (key + color), plus the
  existing haystack (kept for instant client narrowing of the loaded list).
- New `CommandBarVM` / filter+sort state resolved from the URL
  (`?filter=`, `?sort=`, `?q=`, `?scope=`), so the list stays server-driven and
  shareable/refresh-safe like the rest of the inbox.
- Sidebar VM gains the **Flagged** view and **Deleted** folder rows with counts.

## UI components

- **`command-bar.tsx` (new):** slim row above the list. Left = bulk actions that
  enable on selection (Archive, Delete, Mark read/unread, Flag, Categorize,
  Move). Right = Filter dropdown + Sort dropdown. Mirrors new Outlook.
- **`thread-list.tsx` (rework):** hover checkbox per row + header select-all;
  shift-click range select; hover quick-actions (archive / flag / pin);
  flag + pin + category color chip indicators; global-search results mode.
  Selection state lifts into `inbox-shell.tsx`.
- **`inbox-shell.tsx`:** owns selection `Set<string>`, wires bulk actions and
  the command bar; clears selection on navigation.
- **Sidebar:** add Flagged (view) and Deleted (folder) rows.

## Non-goals (YAGNI)

- Keyboard shortcuts (explicitly dropped).
- Multiple categories per thread (one is enough for Peak).
- Server-side pagination (data volumes are small — hundreds of threads).
- Touching the reading pane, compose, or Gmail bridge.

## Verification

- `npm run build` green (never with a dev server running — PGlite is
  single-process, per peak-app rule).
- Drive `/inbox` in the browser preview: select many + bulk archive, filter
  Unread/Flagged, sort by From, flag + pin a thread, category color, global
  search finds a thread from another folder, Delete → Deleted folder → Restore.
- `npm run test:specs` still green.
