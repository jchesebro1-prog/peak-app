# Estimator in four steps — design

**Date:** 2026-10-07 · **Requested by:** Jeff ("one window is trying to handle too much")
**Scope:** the system Estimator (`/estimator`) only. The flame-test, repair and inspection builders are
explicitly out of scope and stay as they are (Jeff: "working great right now"). Grid and Quick Design
estimates keep landing in the Estimator and get the new steps like any other system quote.
**Mockups:** `.superpowers/brainstorm/65421-1791383824/content/` (build-layout-v2, build-package-v2,
customer-review-v2, send-track).

## 1. Problem

`estimator-client.tsx` is 4,324 lines with 83 `useState` hooks in one component, and the screen does six
jobs at once: building systems/lines, pricing, narrative, quote details + workflow, output options, and
client delivery. Output and client delivery hide in the preview sidebar. The toolbar overflows at 1024 px;
after Send the Estimator navigates to Home. Jeff confirmed every symptom: cramped building, things hard to
find, no clear flow, and different people (estimator, approver, follow-up) needing different views.

## 2. The shape: one quote, four steps

| Step | Purpose | Who lands here |
|---|---|---|
| **1 · Build** | Systems, lines, pricing, margins | Estimator |
| **2 · Build package** | Assemble everything the client receives | Estimator |
| **3 · Customer review** | See the package exactly as the client will; proof it; approve it | Estimator (self-check), approver |
| **4 · Send & track** | Email it, then follow up in the same tab | Lead estimator / sender |

- **Open tabs with a readiness checklist** (Jeff picked A): any step is reachable any time; each tab shows ✓
  or a gap count. Submit and Send warn about gaps but never block.
- **Shared header on every step:** quote name · EST number · Rev · customer chip (opens Quote details as a
  drawer) · sell + margin · status pill · Save · the next-step button. The next-step button also navigates:
  Submit → Review, Approve → Review, Send → Send & track.
- **Approval lives on step 3.** The approver's Approve / Approve & send / Send back controls are there; the
  header button sends them to it.

## 3. The six phases

Each phase gets its own plan and ships on its own, leaving the app working.

| # | Phase | Delivers |
|---|---|---|
| 1 | **The frame** | Step tabs + URLs, shared header, Quote details drawer, readiness counts; existing pieces moved into their step unchanged. Fixes the 1024 px overflow and Send → Home. **Detailed in §4.** |
| 2 | **Build step** | Systems rail: add, drag to reorder, **groups**, **Mark built & collapse**. Groups and alternates print on the PDF, cover and package. |
| 3 | **Send & track** | Gmail send from the tab, escape hatches, follow-up task, open counts, replies to that email arriving in the tab, client responses, Revise with these scopes. |
| 4 | **Customer review** | Client's-eye tabs, internal cost/margin/labor sidebar, pinned comments, Approve / Send back. |
| 5 | **Package document editor** | Word-like document (TipTap) with live chips, product-linked paragraphs, image placement, drag from BOM; the client PDF renders from it. |
| 6 | **System categories** | "+ Add system…" opens a category picker that pre-fills that category's typical BOM items as a checklist. **Content comes from Jeff** (categories + typical items). |

Phases 2–6 are described at product level in §5 and each gets its own detailed spec section or addendum
before its plan is written.

## 4. Phase 1 — the frame (detailed)

**Rule for Phase 1: the same estimator, reorganised.** No pricing, output, data-model or PDF change.

### 4.1 Routing

- One page: `/estimator?id=<quoteId>&step=build|package|review|send`. Missing/unknown `step` → `build`.
- Step changes update the URL client-side (shallow), so the browser Back button moves between steps and a
  step is linkable. Existing inbound links (`/estimator?id=…`, the hand-off params `?type&category&customer
  &venue&contact`, `?surveyId`, `?inspectionId`, `?statusError`) keep working unchanged.
- A new (unsaved) quote shows all four tabs; Package/Review/Send show a "Save the estimate first" state where
  the existing UI already requires a saved quote (client link, PDF, cut sheets).
- Phone (≤ 700 px): today phones always get the preview; they now always get **Review** (same content,
  view-only), with the approver's next-step control as today.

### 4.2 State: one shared state hook

The core refactor. Today every concern lives in `EstimatorClient`'s 83 `useState`s, and the 44 spec-harness
pins plus every handler read them by name. Phase 1 therefore **moves, not rewrites**:

- **`useEstimatorState(props)`** (`src/app/(app)/estimator/use-estimator-state.ts`) — the component body
  above `return (` moved verbatim into a hook that returns everything the JSX used
  (`type EstimatorState = ReturnType<typeof useEstimatorState>`). Owned by the shell, so switching steps
  never loses unsaved edits; Save works exactly as today (manual, same server action, same revision
  behaviour).
- **Shell** (`estimator-client.tsx`, much smaller) — header, step tabs, banners, and the active step.
- **One component per step** under `src/app/(app)/estimator/steps/` — `build-step.tsx`,
  `package-step.tsx`, `review-step.tsx`, `send-step.tsx` — each taking `{ s: EstimatorState }`.
- Existing child components (`SectionCard`, `NarrativeColumn`, panels, modals) are reused as they are.
- Splitting UI-only state (modal drafts, PDF viewer state) out of the hook into the step that owns it is
  deliberately **later** (Phase 2 touches the Build step anyway) — Phase 1 keeps the move mechanical.

### 4.3 Where today's pieces land

| Step | Phase 1 contents (moved, not redesigned) |
|---|---|
| Build | Systems sidebar (list, cost breakdown, rewards credit), system cards and all add-method modals, + Add system / + From library, Draft from survey/inspection, tier re-price banner |
| Package | Narrative column (now the main area, not a side column), Cover & package panel (overall summary, Not included, Cover PDF), Show-on-PDF options, payment terms, cut-sheets toggle, Plans & risers / Generate from Grid, package gap chips, Rebuild package |
| Review | The PDF viewer (`QuotePdfViewer`) with Save & update PDF / Download / Open, the review/approval actions, a cost + margin summary per system |
| Send & track | Status, Send (existing behaviour — marks sent), client link + revisions with open counts (`ClientLinkPanel`), client responses, tasks (`TasksCard`, `ApplyTemplateControl`), pipeline stage bar / pipeline select |

`PackageStaffPanel` is split along that line: drawings, gaps and Rebuild → Package; responses → Send & track.

### 4.4 Header

- Left: quote name (inline rename), `EST-#### · Rev N`, customer chip → **Quote details drawer** (same
  fields as today's dropdown: customer, venue, contact, category, lead estimator, prepared by, install
  timeframe, quote note, assumptions; the won-quote guard unchanged).
- Right: sell + blended margin, status pill, Save / Saved ✓, `QuoteNextStep` (toolbar variant).
- **⋯ menu** for rarer actions: Change type, Parts list (CSV), Draft from survey/inspection (when a source
  exists), Cut sheets, Delete.
- The header **wraps** rather than overflowing; verified at 1024 px and 1280 px.
- Below it, the four step tabs with their readiness line.
- The status `<select>` moves to Send & track (the pill stays in the header).

### 4.5 Next-step navigation

`QuoteNextStep` keeps its rules (`src/lib/quote-next-step.ts` untouched). The shell adds one mapping
from the action just taken to the step to show:

- submit / resubmit → `review`
- approve / approve only → `review`
- send / approve & send → `send` (and **stay** there — fixes today's navigation to Home)
- send back / withdraw → `build`

### 4.6 Readiness

A pure module `src/lib/estimate-steps/readiness.ts` → `{ build, package, review, send }`, each
`{ state: "ok" | "gaps" | "idle", count?: number, label: string }`:

- **Build:** systems with no lines; lines with no sell price. `ok` → "✓ N systems priced".
- **Package:** the client-side half of the gap list `src/lib/estimate-output/package-gaps.ts` already
  computes (key products needing a paragraph, scopes without client goals) + printed systems in Narrative
  mode with no intro text. Only computed for a saved quote; otherwise `idle`. The server-only gaps
  (datasheets, drawings) keep showing as chips inside the Package step.
- **Review:** the review state from the existing approval model ("Not submitted", "In review · <name>",
  "Changes requested", "Approved").
- **Send:** status-derived ("Ready to send", "Sent · Rev N", "Won", "Lost"). Open counts join it in Phase 3.

Readiness never blocks anything in Phase 1.

### 4.7 Testing

- `test:specs` checks for `readiness.ts` (each state, each gap kind) and for the step-param parser
  (missing/unknown → build) and the action → step mapping.
- `test:smoke` covers `/estimator?id=…&step=` for all four steps (GET).
- Browser verification on a scratch datadir: every existing feature reachable from its new step; unsaved
  edits survive a step switch; Save; Send stays on Send & track; header at 1024 px; phone width → Review.
- Standard gates: tsc, test:specs, test:smoke, eslint vs baseline, `next build`.

## 5. Phases 2–6 (product level — locked decisions from the brainstorm)

### 5.1 Phase 2 — Build step

- **Left rail** = systems list (status dot, total) with **+ Add system…** and **+ From library…**, then
  totals (cost, freight, credit, sell). Drag to reorder (rail or card header); that order is the print order.
- **Groups:** free-named headings with a subtotal; systems are dragged into/between groups. Each group has a
  switch: **Included in total** or **Alternate — priced separately** (Jeff picked "both"). Covers
  Stage/House, Phase 1/Phase 2 and Base bid/Alternate 1/Alternate 2. Per-line `option` lines keep working.
  Alternates print with their own price, stay out of the total, and feed the #301 client scope picker.
- **Main area:** every system stacked in rail order; clicking one in the rail opens + scrolls to it; any
  number open. **✓ Mark built & collapse** shrinks a system to one line and puts ✓ in the rail; editing it
  again un-marks it. Open/collapsed state remembered per quote, per person.

### 5.2 Phase 3 — Send & track

- **Before send:** an in-tab email composer through the connected Gmail (From = the sender's personal mailbox by default, To = quote contact,
  Cc = lead estimator, subject, body with the package link, Cover PDF + Estimate PDF attached, optional cut
  sheets / package zip). The panel states what Send does: freeze Rev N, email, status Sent + stage
  advance, follow-up task in 5 days (editable) for the lead estimator.
- **Escape hatches kept:** Open in Inbox, Mark sent without emailing, Copy link only.
- **After send:** activity feed — opens (with counts), downloads, client questions, scope choices with
  **Revise with these scopes →**, and **replies to the sent email**: the send is an Inbox thread linked to
  the quote, Gmail keeps replies in that thread, the existing sync imports them, and they show here with
  Reply inline (plus bell + a "1 new reply" header chip). Replies from another address or a new email
  land in the Inbox as today and can be linked.
- **Open counts** per revision (👁 N · last opened …) and the total in the header.
- Side column: revisions, link Copy/Revoke, follow-up task, Mark won / Mark lost…, pipeline.

### 5.3 Phase 4 — Customer review

- Main area: the package exactly as the client gets it — tabs Document (PDF), Package page, BOM,
  Datasheets, Cut sheets, Drawings — with a desktop/phone toggle.
- **Internal sidebar** (never client-visible): **cost, sell and margin per system** (below-tier flagged)
  with totals split material / labor / freight; a **labor table** (hours, cost, sell per labor group and
  total, crew/days/OT summary); the package checklist; **comments pinned to the document** (select text or a
  system → numbered pin); Approve & send →, Approve only, Send back with N comments. Pins show on the
  Build package document for the estimator.

### 5.4 Phase 5 — Package document editor

- **Layout:** left = gaps list, the BOM by group/system (drag a line into the document), and library pieces
  (saved paragraphs, standard Not-included list, live price table, cut sheet, page break). Products already
  in the document show ✓. Right = the client document as a page, edited like Word: headings, lists, bold,
  images left / right / full width with size, page breaks, page count.
- **Editor:** TipTap (ProseMirror) with custom nodes; document stored as JSON on the quote; each sent
  revision freezes its copy; the client PDF and package page render from it through the existing
  headless-Chrome print route.
- **Numbers stay live, words stay yours** (Jeff picked A): prices, quantities, totals and the quote number
  are live chips — movable and deletable, never typed over. Text and image placement are never overwritten.
  A paragraph about a part removed from the BOM gets an amber "no longer in BOM" flag. A new system adds a
  gap, not auto-text.
- **Product-linked paragraphs:** a dashed outline on hover/cursor with a tag ("ETC Ion Xe 20 · from
  product" / "edited here"); **Save to product** (writes the catalog part's `narrativeText` through
  `mergeUpsert`) and **Revert**; a fresh paragraph on a part with no text offers Save to product.

### 5.5 Phase 6 — System categories

"+ Add system…" opens a category picker; choosing one shows that category's typical BOM items as a
checklist (with default quantities) and adds the ticked ones as lines, naming the new system after the
category.

- **Default categories (Jeff, 2026-10-07):** Controls, Fixtures, Rigging, Video, Infrastructure, Wireless,
  Communications — seeded as an editable list (admins can rename, add, reorder).
- **Typical items per category:** Jeff supplies them; the spec addendum for Phase 6 is finalised when they
  arrive.
- To settle in the Phase 6 addendum: how these categories relate to the existing per-system Discipline
  (`lighting` / `rigging` / `curtain` / `av`, `src/lib/estimate-output/fields.ts`) — e.g. a category
  implies a discipline.

## 6. Settled after review (Jeff, 2026-10-07)

- **Older quotes are ignored by Phase 5.** The document editor applies to quotes that start a package
  document after it ships; quotes built before keep today's narrative-field output unchanged. No
  migration or seeding of old quotes.
- **Phase 3 sends from the sender's personal inbox** by default (the From picker still lists the other
  connected mailboxes).
- **Phase 6 default categories** are listed in §5.5.

## 7. Open items

- Phase 6: typical items per category (Jeff), and the category ↔ Discipline relationship.
- Phase 5: confirm TipTap's licence fits (core is MIT; avoid paid Pro extensions).
- DECISIONS numbers and the punch number are assigned when each phase's plan is written (recompute from
  `origin/main` first — two sessions write those files).

## 8. Phase 2a — Build step (detailed, 2026-10-07)

Jeff asked to "keep going until you can't" after Phase 1 shipped, so Phase 2 proceeds on the decisions locked in
§5.1 without a new brainstorm. Phase 2 is split: **2a** (this section) = rail, drag/reorder, groups as headings
with subtotals, Mark built & collapse; **2b** = the In total / Alternate switch end to end (totals and the dozen
`option`-line consumers, cover scopes, client scope picker), because an Alternate that only half-works (excluded
from the total but printed as an included band) would mislead a customer.

### 8.1 Data
- `spec.groups?: SystemGroup[]` beside `spec.sections` (so revisions and client packages carry it — `snapshotOf`
  copies `spec` whole). `SystemGroup = { id: string; name: string; alternate: boolean }`; ids `g-<base36>`;
  name ≤ 80 chars, blank → "Untitled group"; ≤ 20 groups; `alternate` is stored but always written `false` in
  2a and has no UI.
- `SpecSection.groupId?: string` and `SpecSection.built?: true`.
- **Order rule:** the stored `sections` array is always in display order — ungrouped systems first (no heading),
  then each group in `groups` order; a group's systems keep their relative order. A `groupId` naming no group is
  dropped. One pure function normalises this (`normalizeSystemOrder`) and every mutation and the save run it.
- `built` and the collapsed state are **not** customer content: `built` is stripped from the PDF doc key; collapse
  is per person, per quote, in `localStorage` (`quartzite.estimator.collapsed.v1:<quoteId>`), never saved.
- Editing a built system (any change other than `built` itself) clears `built`.

### 8.2 Build UI
- **Rail** (the Build sidebar): systems listed under group headings (name, subtotal, ↑/↓ to reorder groups,
  rename inline, delete → its systems become ungrouped). Each system row: drag handle, ✓ when built, name, total,
  and ↑/↓ buttons (keyboard path; moving past a group edge joins the neighbouring group). HTML5 drag-and-drop
  (the board's house pattern): drop on a system row → insert before it and join its group; drop on a group
  heading → append to that group; drop on the "Ungrouped" zone → ungroup. **+ Add group** in the rail.
  Drag is rail-only in 2a (card-header drag deferred).
- **Cards:** the main column stacks systems in the same order with a divider per group (name + subtotal). The
  card's controls row gains a **Group** select (No group / each group / + New group). The card footer gains
  **✓ Mark built & collapse**; a built, collapsed card shows a "built" tag in its header and the rail row a ✓.
- The Rewards credit line stays on the last system after any reorder (re-pinned as delete/move do today).
- Readiness: Build badge appends built progress when at least one system is built — "✓ 4 systems priced · 2 of
  4 built"; all built → "✓ 4 of 4 built". Gap labels unchanged.

### 8.3 Output (2a)
- Customer PDF + online view (`QuoteDocument`): when the quote has groups, a group heading row (name + group
  subtotal = Σ printed systems' sell) prints before the group's first band; ungrouped systems print first with
  no heading. Band numbering is unchanged (continuous). Totals unchanged (no alternates in 2a).
- Cover PDF, client package page, scope picker, cut sheets, parts CSV: unchanged in 2a.

### 8.4 Other writers
- Save writes `spec.groups` (sanitised) and normalised sections.
- Move system to an existing estimate keeps the TARGET's `spec.groups`; the moved system loses its `groupId`
  (the target doesn't have that group). Move to a new estimate, Copy system to another estimate, and the system
  library (save/load) strip `groupId` and `built`. Copy within this estimate keeps the source's group and
  drops `built`. Portal quote rebuilds keep writing `{ sections, mobs }` (portal carts have no groups).

## 9. Phase 2b — In total / Alternate (detailed, 2026-10-07)

### 9.1 Rule
A group's switch is **In total** (default) or **Alternate — priced separately**. Every system in an Alternate
group is out of the estimate total everywhere a per-line `option` item is out of it today, and is shown to the
customer as a separately priced alternate they can choose.

### 9.2 Data
- `SpecSection.alternate?: true` is a **derived stamp**: `normalizeSystemOrder` sets it on every section whose
  group is `alternate: true` and deletes it everywhere else. It runs on every client mutation, page load, save
  and the PDF data loader, so stored and printed sections always carry the right stamp and every consumer reads
  only `sec.alternate`. Systems leaving an estimate (`withoutGroupMeta`, `sanitizeSectionGroupMeta`) drop it.
- `QuoteTotals.alt` = Σ `systemSellTotal` of alternate systems (shown, never added to `grand`).

### 9.3 Totals and money
- `totals()`: an alternate section adds its `systemSellTotal` to `alt` and contributes nothing else (no lines,
  freight or sell adjustment to rev/cost/mat/lab/fr). A Rewards credit line inside an alternate section still
  counts (defensive). Stored `value`/`margin`, pipeline value, approval limits and the review-limit gate follow
  `totals()` unchanged.
- The Rewards credit is pinned to the **last In-total system** (fallback: last system).
- Approval fingerprint (`linesKeyOf`) includes each section's `alternate` so flipping a group re-asks approval.
- Excluded like options: review-limits labor check, dashboard equipment sold, manufacturer analytics, the
  spec BOM, the purchasing parts CSV, curtain cut sheets. Unchanged: key-product eligibility, portal pricing.

### 9.4 Build UI
- Rail group heading and card-column divider get an **In total / Alternate** toggle; an Alternate group's
  heading reads "Alternate · not in total". The sidebar Cost breakdown adds "Alternates (not in total)" when
  `t.alt > 0`. Customer review's internal cost table lists alternate systems below the Total under
  "Alternates (not in total)", so its rows still add up to its Total.

### 9.5 Customer outputs
- **Estimate PDF / online view:** body bands, numbering, group headings and the itemized appendix cover In-total
  systems only. After the bands, an **Alternates** block ("Priced separately — not included in the total")
  prints each Alternate group (heading + group subtotal) and its systems as bands numbered `A1, A2…` with
  their own lines or narrative (per the system's presentation). The header line adds "· N alternate(s)".
  Totals unchanged.
- **Cover PDF:** scopes are In-total systems only (keeps R1: Σ scopes − credit = grand); a new **Alternates**
  list (always printed when any exist) shows each Alternate group — name, price, its systems.
- **Client package page:** an Alternates card mirrors the cover list.
- **Client scope picker:** alternate systems are offered as extra choices labelled with their group, **unchecked
  by default**; the running total adds them when ticked. Server validation unchanged (ids must be offered).

## 10. Phase 3 — Send & track (detailed, 2026-10-07)

### 10.1 Send from the tab (one server action, in this order)
`sendEstimateEmailAction(quoteId, { to, cc, subject, body, attachEstimate, attachCover, followUpDays, asOf })`:
1. **Preflight** — `send` or `approve` permission; quote is a system estimate in `draft` (first send) or `sent`
   (re-send the current sent revision); the saved estimate PDF is current (the client saves first, as the next-step
   control does today); `to` holds ≥ 1 valid address; subject and body non-blank.
2. **Attachments, before anything is marked** — the Estimate PDF bytes from PDF storage (the file `setStatus`
   copies into the revision); the Cover PDF rendered on demand through the existing signed print route (≤ 45 s)
   when ticked. Any failure here aborts with nothing changed. Attachments together are capped at 15 MB raw
   (Gmail's 25 MB limit after base64); over the cap → refuse with "Too large to attach — send the link only".
3. **Mark sent** (draft only) through `sendQuoteToCustomer` with `asOf` — same approval gate as today; a refusal
   returns the gate message and nothing is emailed.
4. **Client link** — `ensureShareLink` → absolute URL from the request origin; the body's `{link}` placeholder is
   replaced (the default body contains it; if the user removed it, the link is appended on its own line).
5. **Email** — a comms thread in the **sender's personal mailbox** (`mailbox: "personal"`, `mailboxUser:` the user's
   name), `link: { type: "quote", id, label }`, To/Cc/subject/body, the attachments; sent through the existing
   draft → send path (Gmail when connected; otherwise a local outbound message, as the Inbox does today).
6. **Record** — a store-owned `Quote.estimateEmails[]` entry `{ threadId, rev, at, by, to }`.
7. **Follow-up** — a task for the Lead estimator due in `followUpDays` (default 5; `Off`, 2, 3, 5, 7, 14).
If steps 5–7 fail after step 3, the action reports "Marked sent, but the email didn't go out — open it in Inbox";
the quote stays sent (the link already works).

### 10.2 Defaults
To = the quote contact's email (else blank); Cc = the Lead estimator's email when it isn't the sender's; subject
`<project name> — estimate <EST number>`; body: greeting with the contact's first name, one line on what's
attached, the `{link}` line inviting them to view the package and choose alternates, sign-off with the sender's
name. Defaults are computed server-side (`estimateEmailDefaults`) and edited freely in the composer.

### 10.3 Escape hatches (kept)
- **Open in Inbox** — does steps 1–4 and 6 (marks sent, mints the link), then creates the same thread as a
  **draft** with the attachments and opens `/inbox?draft=<id>`; the composer warns "This marks the estimate sent
  now". Sending it from the Inbox needs no extra hook (the quote is already sent).
- **Mark sent without emailing** — the existing next-step / status control.
- **Copy link only** — the existing Client link panel.

### 10.4 Track (after send)
- `sendTrackAction(quoteId)` returns, per recorded email: subject, to, sent time, rev, Gmail delivery state
  (`gmailId` present / local only), and every message in its thread (direction, from, time, plain-text snippet),
  with unread inbound marked. Replies arrive through the existing Gmail import (same `gmailThreadId`).
- The tab shows an **Activity** card: emails with their replies (newest first), an inline **Reply** box (sends
  through the same thread with the existing `reply()`), and **Mark read**; plus the existing revisions/opens,
  client responses, tasks and pipeline cards.
- The Send tab badge shows `Sent · Rev N · 👁 <opens> · <n> new repl(y|ies)` when the track data is loaded
  (fetched on the Send step and on window focus).
- The bell: an unread reply already shows in the sender's Inbox unread count; no new bell group in Phase 3.
- Not in Phase 3: "Revise with these scopes →" (needs the revision workflow; parked).

## 11. Phase 4 — Customer review (detailed, 2026-10-07)

### 11.1 Client's-eye tabs (the saved estimate, as the client gets it)
Tabs: **Document** (the saved estimate PDF — today's pane), **Package page**, **BOM**, **Cut sheets**,
**Datasheets**, **Drawings**, with a **Desktop / Phone** toggle for the framed tabs.
- Package page, BOM and Cut sheets render from the **saved** quote (not unsaved edits) in a staff-only preview
  route outside the app layout (`/estimator-preview/[id]?tab=package|bom|cutsheets`, `requireUser`, a
  `SAMEORIGIN` frame exception like the existing ones), framed full width or at 390 px for Phone so the pages'
  own media queries apply. The package page is built from the live quote with the existing pure model
  (`packageViewModel`) — no token, no open beacon, no client actions (an inert note says where the client's
  scope choices and questions appear), datasheet/plan links pointing at staff routes.
- Datasheets: every printed part with its datasheet / spec sheet / manual state (`specPackageDocs`), each open
  link to the staff part-document route (new tab). Drawings: the quote's package files with a new staff download
  route `/api/quotes/[id]/package-files/[fileId]` (`requireUser`).
- When the editor has unsaved changes the step says "Unsaved changes — Save to refresh what the client sees."

### 11.2 Internal sidebar (never client-visible)
- Cost / sell / margin per system (existing `ReviewCostSummary`, alternates below the Total).
- **Labor**: per labor group (system name · discipline) hours, cost, sell — hours = Σ mobilization straight +
  OT + supervision hours + PM/shop/drafting hours from the configurator draft (`computeLabor`), sell = the group's
  CURRENT line sells (flag "edited" when lines were hand-changed after configuring); hand-added labor lines with
  `unit: "hr"` count their qty as hours; a crew/days/OT line (max crew, Σ days, Σ OT hours); totals row.
- **Package checklist**: the package gaps (datasheets, drawings, key-product text, client goals) + the Package
  step's readiness gaps.
- **Comments** (below).

### 11.3 Review comments
- Store-owned `Quote.reviewComments[]` `{ id, sectionId | null, body, by, at, resolvedAt?, resolvedBy? }`
  (append; ≤ 200; body ≤ 2,000 chars) — never written by the Estimator save.
- Add from the sidebar: pick a system (or "Whole estimate") and type; open comments are numbered 1…n in system
  order then time. Anyone with `create`, `send` or `approve` may comment; the author or an approver may delete an
  unresolved comment; the estimator (anyone with `create`) resolves.
- Pins: numbered markers on the system cards in Build and in the Package step's system list (count + list on
  click) so the estimator fixes things where they are.
- **Send back with N comments** — the approver's send-back uses a note built from the open comments (numbered,
  system name, text) plus any extra text; Approve / Approve & send unchanged (QuoteNextStep).

## 12. Phase 5 — Build package document editor (detailed, 2026-10-07)

### 12.1 What it is
A Word-like client document on the Build package step, edited with TipTap (MIT core only), stored as
ProseMirror JSON at `spec.document` (so each sent revision freezes its own copy). **When a quote has a document,
it replaces the per-system narrative body** of the customer PDF, the online/share/portal estimate and the client
package page's narrative; the header, totals, alternates/options blocks, terms, signature and the itemized
appendix are unchanged. **Quotes without a document print exactly as today** (Jeff: ignore older quotes — no
migration).

### 12.2 Document model (schema, validated server-side)
Blocks: `paragraph`, `heading` (levels 1–3), `bulletList`/`orderedList`/`listItem`, `pageBreak` (atom),
`priceTable` (atom, live), `productBlock` (`{ sectionId, lineKey, sku }` + photo `{ show, align: left|right|full,
width: 25–100 % }`, content = paragraphs). Inline: text with `bold`/`italic` marks, `hardBreak`, `chip` (atom,
`{ kind: systemPrice | systemName | lineQty | quoteNumber | grandTotal, ref }`). Caps: 2,000 nodes, 200 KB JSON,
text 20,000 chars per block. Anything else is dropped by the validator.

### 12.3 Numbers live, words yours
Chips render the current value at print/view time from the same props the document already uses
(`systemSellTotal`, line qty, `displayQuoteNumber`, `t.grand`). A chip whose system/line no longer exists prints
nothing in client outputs and shows amber `removed` in the editor; it is listed as a gap. Words and photo
placement are never rewritten by the app.

### 12.4 Product-linked paragraphs
A product block shows a dashed outline with a tag — `<product> · from product` when its text equals the catalog
part's `narrativeText`, `<product> · edited here` otherwise — and **Save to product** (writes the plain text through
the existing `saveProductParagraphAction`, `create` permission, stale-check) and **Revert** (replace with the library
text). A block whose line left the BOM gets an amber `No longer in BOM` flag (kept until the user deletes it).

### 12.5 Editor layout
- **Left pane:** Gaps (removed chips, products no longer in BOM, In-total systems the document never mentions, the
  package gaps), the **BOM** by group/system (drag a line → a product block with its library paragraph and photo;
  drag a system → a heading with the system name + a price chip; click-to-insert at the cursor as the keyboard
  path; ✓ on items already in the document), **Library** (saved system intros → paragraphs; the default Not-included
  list → a bullet list; Price table; Page break).
- **Right:** the document on a page-like canvas with a toolbar (Normal / Heading 1–3, Bold, Italic, bullet and
  numbered lists, Page break, + Price table; when a product block is selected: photo Left / Right / Full, size,
  hide/show photo).
- **Start the document** (no document yet) seeds it from the quote's current narrative fields: per printed
  In-total system in order — heading + price chip, intro paragraphs, product blocks for its key products — then a
  price table; Alternates follow under an "Alternates" heading. **Remove document** returns the quote to today's
  output (confirm inline).
- The document saves with the estimate (Save); the PDF goes stale when it changes.

## 13. Phase 6 — System categories (detailed, 2026-10-08)

Jeff named the default categories (Controls, Fixtures, Rigging, Video, Infrastructure, Wireless, Communications)
and will supply the typical items; Phase 6 builds the machinery so the items can be filled in by an admin at any
time (no code change needed when the content arrives).

- **Data:** settings blob `system_categories` `{ categories: Array<{ id; name; discipline?: lighting|rigging|curtain|av;
  items: Array<{ sku; qty; note? }> }> }`, seeded with the seven defaults (empty item lists) when missing; ≤ 40
  categories, ≤ 100 items each, qty 0.01–100,000, ids `cat-<base36>`.
- **Admin:** Estimating Rules → **System categories** (`manage_users`): add / rename / reorder / delete categories,
  optional discipline, typical items picked from the catalog (the existing PartPicker) with a default qty and an
  optional note; live part description, unit and cost shown; retired/missing SKUs flagged.
- **Estimator:** both "+ Add system" buttons open **Add a system**: a grid of categories (name, item count) plus
  **Blank system** (today's behaviour). Picking a category shows its typical items as a checklist (all ticked;
  qty editable; missing parts unticked and flagged); **Add system** creates a system named after the category
  (its discipline set when the category has one), joining the active system's group, with the ticked parts priced
  exactly like "+ Add part from catalog" (`catalogAddPrice` at the customer's tier margin).
