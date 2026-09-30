# Estimator — narrative column + Quote details in the top bar (#281)

Approved by Jeff 2026-09-29.

## Problem

- A system's customer narrative (`SpecSection.narrative`) is edited in a
  one-line `<input>` in each system card's grey control strip
  (`section-card.tsx`, "Brief system explanation for the quote letter"). Real
  narratives are paragraphs; the box is too small to write in.
- The printed narrative (`quote-document.tsx`, narrative-mode systems only)
  renders as one run of text — line breaks typed by the estimator collapse.
- Quote details (prepared for / venue / attn / category, quote note,
  assumptions, install timeframe) occupy a permanent 300px right column
  (#163/#164) that is only touched occasionally.

## Decisions (Jeff)

1. The narrative is written in the **right column**, which Quote details
   vacates.
2. The narrative prints **only in Narrative mode** — today's rule, unchanged.
   An itemized system's narrative is kept but not printed.
3. Formatting is **plain text**: a blank line starts a paragraph, a line
   starting with `- ` prints as a bullet, single line breaks are kept. No
   toolbar, no markup stored.

## Design

### 1. Quote details → top-bar dropdown

- The right-column `<aside aria-label="Quote details">` and its 36px collapsed
  tab are removed, along with `metaOpen` / `toggleMeta` / `META_OPEN_KEY`
  (the stored preference is simply no longer read).
- A **Quote details chip** sits on the top bar's second line, after
  `Q-#### · Rev N` and the change-type control. Label: the customer name
  (`customers[customerId].name`, else `custName`), then ` · <venue label>`
  when a venue is picked, then ` · attn <contact>` when a contact is picked;
  `Add quote details` when all are empty; always followed by `▾`/`▴`.
  Truncates with an ellipsis. `aria-expanded`, `aria-controls`.
- Clicking the chip toggles a **dropdown panel** anchored under the sticky top
  bar (absolute, full top-bar width, capped height with its own scroll, above
  the stage bar and cards). Dark, matching the top bar and the old column.
  Three-column grid (collapses to one column under 860px):
  1. Prepared for · at (venue) · attn (contact) · category · won-quote guard
     banner · Suggested install timeframe
  2. Quote note (+ "Shows on the PDF header")
  3. Assumptions checklist + textarea
  Fields, handlers, and save behaviour are moved verbatim — nothing about how
  they persist changes.
- The panel closes on: the chip again, a **Done** button, Esc, or a pointer
  press outside both the chip and the panel. Closing clears a pending
  won-quote guard (`setWonMetaGuard(null)`) — closing is a cancel.
- Starts closed on every load; not remembered.

### 2. Right column → System narrative editor

- New right column `aside.est-narr` (`aria-label="System narrative"`), ~360px,
  **light** (white, `#ececf0` left border) — it is a writing surface.
- Follows the **active system** (`activeId`, falling back to the first
  section). A pointer press anywhere in a system card now makes it active
  (new `onActivate` prop, sets `activeId` without scrolling), in addition to
  the left Systems list.
- Contents, top to bottom:
  - Header: `NARRATIVE` label, the system name, `Hide ›` toggle.
  - The Customer: itemized / narrative `<select>` (same state as the card's).
  - When itemized: hint "Prints on the quote only in Narrative mode."
  - A large `<textarea>` filling the remaining column height (min ~240px),
    `resize: none`, bound to `sec.narrative` via `setSystemNarrative`.
  - Hint: "Blank line = new paragraph · start a line with “- ” for a bullet".
  - Empty state when there are no systems: "Add a system to write its
    narrative."
- Collapses to a 36px light tab labelled `Narrative` (same pattern as the
  Systems rail), remembered per browser under
  `quartzite.estimator.narrOpen` with the existing hydration-safe pattern.
- Under 860px it goes full width above the cards (the old `.est-meta` rules,
  re-pointed at `.est-narr`).

### 3. System card

- The one-line narrative `<input>` becomes a read-only **snippet button**: the
  narrative's first non-blank line, truncated, or placeholder-styled
  `Add narrative…`. Clicking it (a) makes that system active, (b) opens the
  narrative column if collapsed, (c) focuses the textarea (cursor at end).
  New prop `onEditNarrative`; `onSetNarrative` leaves the card.
- The presentation `<select>` and the Room input stay in the card.

### 4. Printing

- New pure module `src/app/(app)/estimator/narrative.ts`:
  `narrativeBlocks(text) → Array<{ kind: "p"; lines: string[] } | { kind: "ul"; items: string[] }>`.
  Rules: normalize `\r\n`; split into groups on blank lines (whitespace-only
  lines count as blank); inside a group, consecutive lines starting with `- `
  (after leading whitespace) form one `ul` block (marker stripped, item
  trimmed); other consecutive lines form one `p` block whose lines are kept
  (trimmed at the end). Empty input → `[]`.
- `quote-document.tsx`'s narrative-mode block renders these blocks — `<p>` with
  `<br/>` between lines, `<ul>` with `<li>` — styled like the current block.
  Empty narrative keeps today's fallback sentence. This one component serves
  the staff preview, the headless-Chrome PDF (`/print/quote/[id]`) and the
  portal, so all three change together.

## Out of scope

- Printing narratives on itemized systems (decision 2).
- Rich text, markdown beyond `- ` bullets.
- Changes to the quote-note field, assumptions library, or any persistence.
- Service-quote builders (they don't use this screen).

## Data

No schema or migration. `SpecSection.narrative` is already a stored string,
snapshotted per revision; it is still stored raw.

## Testing

- `test:specs` harness block `#281`: `narrativeBlocks` — empty/whitespace →
  `[]`; single line; two paragraphs split by a blank line (incl. a
  whitespace-only line and `\r\n`); single line breaks kept inside a
  paragraph; a `- ` run → one `ul`; mixed paragraph then bullets in one group
  → `p` then `ul`; `-` without a space stays text.
- Gates: tsc, test:specs, test:smoke, eslint vs a baseline; `next build`.
- Browser: chip label; open/close via chip, Done, Esc, outside press; a field
  edited in the panel persists after reload; the narrative column follows the
  left list and a card click; typing saves; the snippet focuses the textarea;
  the preview prints paragraphs + bullets in narrative mode; 375px width.
