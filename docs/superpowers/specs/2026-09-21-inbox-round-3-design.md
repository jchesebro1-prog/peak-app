# Inbox round 3: link-to-work first, venue link, message picker, resizable panes, signatures, last-responder rows

Status: approved by Jeff (brainstorming 2026-09-21). Punch #123–#128. Branch `punch-2026-09-21-round-2`.
Builds on #96 (D140 linking, D142 labels) as re-landed on `main` (#120).

## Context

The reader link sidebar (`src/app/(app)/inbox/link-sidebar.tsx`) renders the customer card first
(linked / suggested / ambiguous / unknown, `link-sidebar.tsx:250-514`) and nests the work-link
picker — the `+ Link to work` control that lives in `thread-reader.tsx:670-847` — inside or after it.
Threads carry `customerId` and one `link: CommLink` (`comms.ts:186-193, 235-277`); they have no
venue, and linking is whole-thread only (`setLinkAction`, `actions.ts:284-297`). The three panes are
fixed widths (`inbox-shell.tsx:567` rail 238px, `thread-list.tsx:95` list 392px, reader `flex:1`);
there is no splitter component anywhere in `src/`. The composer starts Reply with an empty body
(`thread-reader.tsx:430-452`) and `buildRaw()` (`gmail/mime.ts:58-104`) sends `text/plain` verbatim —
no signature concept exists. The list row shows `participants || name` (`page.tsx:399-419`,
`thread-list.tsx:615`).

Jeff's asks (2026-09-21): link-to-work above the customer picker + quick-add quote (#123); venue
linkable via the customer (#124); a per-message dropdown to link from a specific message, in or out
(#125 — decided: **identity source**, not message-level links); resizable list/reader + collapsible
menu (#126 — decided: **the Inbox folder rail**); signatures auto-added (#127); the row name is the
last person who responded, Gmail-style, ignoring me, badge unchanged (#128).

## 1. Data model (`src/lib/stores/comms.ts`)

Three optional fields on `CommThread`, all inside the JSON document (no hot column, same call as
D140 for `resolution`):

- `siteId: string | null` — the linked venue (a `sites` row / `CustomerLocation.id` of the linked
  customer). Cleared whenever `customerId` changes to a different customer.
- `identityMessageId: string | null` — the message whose addresses drive resolution and quick-add.
  `null` = today's behaviour (thread counterpart).
- `LINK_TYPES` gains `"lead"` (the interpreter already writes `type:"lead"`,
  `label-interpret.ts:194`); `LINK_TYPE_OPTIONS` in `thread-reader.tsx:24-29` lists it.

Per-user preference (no migration): `signature: string` lives in the existing per-user prefs
document that already holds `crmMode` (`inbox-shell.tsx:129-142` → notif-prefs store). Pane widths
and rail collapse are per device → `localStorage` keys `pk.inbox.layout.v1` (`{rail: number|0,
list: number}`).

## 2. Resolver honours the identity message (`src/lib/gmail/linking.ts`)

`resolveForThread(t)` picks the address to resolve from:
1. if `t.identityMessageId` names an existing message: inbound → that message's `from` address;
   outbound → its first external recipient (`to`, falling back to `t.contactEmail` when the
   outbound message stores no recipients);
2. else today's counterpart logic.
`identityAddressFor(t): { email, name, messageId } | null` is the pure helper (tested). Re-sweeps
(`resweepThreads`) call the same function, so a picked message survives the next sync. The sidebar
shows "Linking from: ‹name›, ‹in/out›, ‹date›" whenever the identity message is set.

## 3. Sidebar (`link-sidebar.tsx`, `link-actions.ts`)

New top-to-bottom order inside `<aside>`:

1. **Work** — the existing picker moved out of `thread-reader.tsx:670-847` into a `WorkLinkCard`
   (same `setLinkAction`), plus **"+ New quote"**: `router.push("/quotes/new?customer=…&contact=…
   &site=…&thread=<id>")`. `/quotes/new` already reads `customer=` (`quotes/new/page.tsx:12`); it
   gains `contact=`, `site=` and `thread=`; the intake's save action, when `thread` is present,
   calls `linkThread`-style `setLink({type:"quote", id, label})` on that thread and returns to
   `/inbox?thread=<id>`.
2. **Customer** — unchanged cards. Linking a different customer clears `siteId`.
3. **Venue** (only when linked): `<select>` over `sitesForCompany(customerId)` + "+ New venue"
   (`EntityQuickAdd kind="venue"`, reusing `quickAddVenueAction`) → `setThreadSiteAction(threadId,
   siteId | null)`. Work links created from the sidebar carry `site=` where the target supports it
   (quote intake now; survey/inspection when their create flows accept it — out of scope to add).
4. **Linking from** — a `<select>` of the thread's messages ("‹author› · in/out · ‹date›", newest
   first, default "Thread contact") → `setIdentityMessageAction(threadId, messageId | null)`, which
   re-runs `resolveForThread` + `applyResolution` for that one thread and re-renders the cards.
5. **Quick add** — unchanged.

Actions (`link-actions.ts`): `setThreadSiteAction`, `setIdentityMessageAction`; both `requireUser`,
check the thread is visible to the caller (existing `visibleTo` rule), `revalidatePath("/inbox")`.
`quickAddVenueAction` is fixed to pass `locationName` through (the #96 review's open follow-up).

## 4. Panes and rail (`inbox-shell.tsx`, `thread-list.tsx`, new `src/components/split-handle.tsx`)

- `SplitHandle` — a 6px vertical hit area with `cursor: col-resize`; pointer events (capture
  pointer, `onPointerMove` deltas, release on up/cancel) call `onResize(px)`. Keyboard: focusable,
  arrows move 16px, `aria-orientation="vertical"` `role="separator"`. No dependency.
- `inbox-shell.tsx` owns `layout` state `{rail: 238 | 0, list: 392}` read once from `localStorage`
  (try/catch, defaults on failure), written on every change (debounced 150ms). Clamp: rail 180–320
  or 0 (collapsed); list 300–640; the reader keeps `flex:1`. `thread-list.tsx:95` takes `width` as a
  prop instead of hardcoding 392.
- Rail collapse: a chevron button at the top of the rail toggles `rail: 0`; collapsed shows a
  48px icon column (folder/view icons with `title` tooltips, the unread badge preserved) so nothing
  is unreachable. The state persists with the widths.
- `clampLayout(layout)` is the pure helper that applies the min/max rules (tested). Below 860px
  (the nav's own `narrow` breakpoint) the handles are hidden and the stored widths are ignored;
  whatever the Inbox does at that width today is unchanged — no new responsive work.

## 5. Signatures (`account/page.tsx`, `account/actions.ts`, `thread-reader.tsx`, `compose-modal.tsx`)

- Account → "Email signature": a textarea (plain text, max 2,000 chars) saved via
  `saveSignatureAction(text)` into the per-user prefs doc; preview shows exactly what will be sent.
- Composer: `openMode()` seeds the body as `"\n\n-- \n" + signature` for Reply / Reply-all / New
  when a signature exists (the cursor stays at the top); Forward keeps its `----------
  Forwarded ----------` block and puts the signature above it. A "Signature" toggle in the composer
  strips or re-inserts the block (matched on the `\n-- \n` separator so the user's edits above it
  are untouched). `doSend()` is unchanged — the signature is just body text — so `buildRaw()`,
  `deliverThreadOutbound` and the Gmail MIME path need nothing.
- Scope: per user. Every live thread is `mailbox:"personal"` per user today (`comms.ts:306`
  `SHARED_BOXES = []`), so per-user and per-mailbox are equivalent; a shared-mailbox signature is a
  follow-up if shared boxes return.

## 6. List row name (`src/lib/inbox-rows.ts` new, `page.tsx`, `thread-list.tsx`)

Pure `rowName(t, meName): { primary: string; secondary: string }`:
- `primary` = author of the newest message whose `author !== meName` (compare the display name the
  store already writes; drafts keep `"To: …"`); if every message is mine, the counterpart
  (`t.contactName || t.customer || "Customer"`).
- `secondary` = Gmail-style chain: distinct authors in first-seen order with mine rendered as
  "me", then `(n)` when `messages.length > 1` — "Brenda, me (3)".
`ThreadRowVM` gains `primaryName` / `chain`; `thread-list.tsx:615` renders `primaryName` where
`participants || name` was, `chain` in the muted line under it. `showStatus` / `showWait` /
`statusMeta` are untouched — the "waiting" badge keeps working exactly as #96 §6 derives it.

## 7. Testing

- `test:specs`: `identityAddressFor` (inbound → from; outbound → first external recipient;
  missing id → null); `rowName` (last non-me author; all-mine → counterpart; chain string; draft
  row); layout clamp helper (`clampLayout`).
- `test:review:regressions`: `setThreadSiteAction` stamps `siteId` and a customer change clears
  it; `setIdentityMessageAction` re-resolves and a re-sweep keeps the picked message; the quote
  intake with `thread=` links the thread to the new quote; `saveSignatureAction` round-trips and the
  composer seed contains the `-- ` separator; `quickAddVenueAction` keeps `locationName`.
- `test:smoke`: `/inbox`, `/inbox?view=unmatched`, `/account` still 200.
- Browser pass: reorder visible; "+ New quote" lands on the intake pre-filled and links back; venue
  select + quick-add; "Linking from" changes the suggestion on a multi-party thread; drag both
  handles, collapse the rail, reload — layout persists; signature appears on Reply and the toggle
  removes it; a thread where Jeff replied last shows the other party's name with "waiting on them".

## Out of scope

- Message-level links (each message its own customer/work) — decided against 2026-09-21.
- App-wide nav compact mode (#126 is the Inbox rail only).
- HTML signatures / images; per-mailbox signatures for shared boxes.
- Label colour coding (#109) — separate item.
