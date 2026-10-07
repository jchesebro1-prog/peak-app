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
