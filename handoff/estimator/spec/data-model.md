# Data model

**Confidential — Peak Systems Group.**

This is what a Peak estimate *is*: the stored shape, every field, the lifecycle and the numbering. The
field tables below are generated from the source's own doc comments when the package is built, so they
match the code exactly. The notes keep Quartzite's internal references (`#267`, `D87`, function names)
because they point at the code that enforces each rule. Every function written as
`PeakEstimatingCore.…` is in `app/estimating-core.js`.

## One estimate, top to bottom

```
Quote                         one row of Quartzite's `quotes` table (a JSON document plus a few promoted columns)
├─ id, estNo, status, review, customer, owner, revisions, history, …   (the quote fields below)
└─ spec
   ├─ sections: SpecSection[]   the systems, in display order (ungrouped first, then each group in order)
   │  └─ items: SpecItem[]      the lines of one system
   ├─ mobs: SpecMob[]           legacy mobilization summary (labor lines carry their own `mob`)
   ├─ groups?: SystemGroup[]    named headings over the systems; a group can be an Alternate
   └─ document?                 the Build package narrative (rich text), when one was written
```

Money is in US dollars as plain numbers. Lines carry **unit** cost and **unit** sell (`cost`, `price`);
nothing is stored in cents. Timestamps are epoch milliseconds. Dates print in America/Chicago.

**Ids.** A quote's `id` (`Q-2041`) is its key everywhere: URLs, references, revisions. People see the
**estimate number** instead (see *Numbering*). A system's `id` is a short string unique within its
quote (`sys1`). A line's `id` is a number that is unique **within its system only**. Copying or moving
a system can keep line ids, so always address a line as *(system id, line id)*.

### Quartzite's `quotes` table holds more than estimates

The same table also holds Peak's **service quotes**: flame test, repair, inspection, rental and
consulting. Each has its own builder, its own pricing engine and its own sub-document (`flameTest`,
`repair`, `inspection`, `rental`, `consulting`), and is told apart by `quoteType`. This package ships only
**system estimates**: `quoteType` `"system"` (or absent), made in the app (not imported Daylite
history), with at least one line, not deleted. The fields below are the ones the package carries.

## Quote

The quote fields the package ships, in the slicer's allow-list order. A field the `Quote` type doesn't
declare is marked as such.

<!-- @fields src/lib/stores/quotes.ts Quote only=QUOTE_FIELDS -->

`value` and `margin` (the saved grand total and blended margin) are deliberately **not** shipped. The
prototype recomputes them on every save with `PeakEstimatingCore.reconcileEstimatorValue`, exactly as
Quartzite's server does, so a client can never post its own total.

## System — `SpecSection`

One card in Build, and one block on the customer document. `kind` is `"materials"` or `"labor"`.

<!-- @fields src/lib/estimating-core/types.ts SpecSection -->

## Line — `SpecItem`

One row of a system. The flags (`labor`, `curtain`, `fixture`, `option`, `allowance`, `bonus`, …)
change how a line is priced, folded or printed. `pricing.md` covers each.

<!-- @fields src/lib/estimating-core/types.ts SpecItem -->

### Key product — `KeyProduct`

<!-- @fields src/lib/estimating-core/types.ts KeyProduct -->

### Mobilization — `SpecMob`

<!-- @fields src/lib/estimating-core/types.ts SpecMob -->

## Group and alternate — `SystemGroup`

<!-- @fields src/lib/estimate-groups/groups.ts SystemGroup -->

- Groups live in `spec.groups` (at most 20). A system joins one through `SpecSection.groupId`.
- The stored order is always ungrouped systems first, then each group's systems in `spec.groups`
  order. `PeakEstimatingCore.groups.normalizeSystemOrder` enforces it on every read and save. It also
  drops a `groupId` that names no group.
- **An alternate is a group with `alternate: true`.** `normalizeSystemOrder` stamps
  `SpecSection.alternate = true` on each of its systems. That flag is *derived*: a posted value is never
  trusted. An alternate system is priced on its own and kept **out** of the grand total: `totals()`
  puts its price in `totals.alt` and nothing else (see `pricing.md` → *Alternates*). The customer
  document prints alternates in their own block, and the client can pick them on the package page.

## Review — `QuoteReview`

<!-- @fields src/lib/stores/quotes.ts QuoteReview -->

`method` says how an approval was granted:

- `"in_app"`: an approver approved it, or sent someone else's quote.
- `"self"`: an owner who holds `approve` sent or won their own quote.
- `"auto_limit"`: it fit the owner's review limit.
- `"attested"`: the owner recorded an approval given outside the app (**Attest approval…**: a phone or
  Teams review), with a required note naming who reviewed it.

A review decided before methods existed has none, and is still a valid approval.

## History — `QuoteHistoryEntry`

One entry per status move, oldest first.

<!-- @fields src/lib/stores/quotes.ts QuoteHistoryEntry -->

## Revision — `QuoteRevision`

An append-only, priced snapshot. Revisions are never rewritten; `rev` is 1-based.

<!-- @fields src/lib/stores/quotes.ts QuoteRevision -->

## Lifecycle

### Status

```
draft ──send──▶ sent ──▶ won
  ▲               │
  │               └────▶ lost
  └── revise (back to draft) / reopen (won or lost → draft or sent)
```

- **draft**: being built. Bonus lines and the $25 system round-up are (re)derived on every load and
  save.
- **sent**: went to the customer. Sending cuts a **"sent" revision**, the version with contractual
  weight. A sent quote keeps the prices it was sent at, including a bonus rate changed later in
  Estimating Rules.
- **won**: the customer accepted. Quartzite then creates the install project; the prototype only logs
  *Would create install project for …* (the `onWon` port). Won also records which revision won
  (`wonRev`) and the bonus payout. If edits saved after the win changed the quote, a snapshot is cut
  first.
- **lost**: closed. A Lost quote drops any Rewards credit line.
- Moving a sent quote back to draft is a **revise**. Reopening a won or lost quote first snapshots it
  (`reason: "manual"`) so nothing is lost.
- Every move appends to `history`, and the Daylite pipeline `stage` snaps to the status. A stage's tag
  *is* the status: picking a stage with another tag moves the status first.

### Approval (the review state)

```
none ──Submit for approval──▶ in_review ──Approve──▶ approved
  │                               │
  │                               └──Send back──▶ changes ──(edit, resubmit)──▶ in_review
  └──Attest approval… (owner, with a note)──▶ approved
```

The Estimator's next-step control offers only the moves that apply to the person and the quote
(Quartzite's `quote-next-step` rules, unchanged in the prototype). For example, an approver sees
**Send to customer →** where an estimator sees **Submit for approval**.

A quote can move to **sent** or **won** only with an approval that *holds*. The gate checks three ways
to get one, in this order:

1. **Already approved and still holding.** An approval records what it was granted against
   (`approvedAgainst`: the gross sell and a key of the priced lines,
   `PeakEstimatingCore.approvalSnapshot.approvalFingerprint`). Change the price or the priced line set
   and the approval goes stale (`PeakEstimatingCore.approvalSnapshot.approvalSnapshotMatches`,
   `PeakEstimatingCore.reviewLimits.approvalHolds`).
2. **The person moving it can approve.** Someone holding `approve` who sends or wins a quote approves
   it in the same move: method `"self"` on their own quote, `"in_app"` on anyone else's
   (`PeakEstimatingCore.reviewLimits.approverOnTransition`). An owner whose quote was sent back
   (`changes`) can't self-approve.
3. **It fits the owner's review limit.** Settings → Admin → Review limits gives each person a dollar
   limit per kind of quote. A quote under its owner's limit approves itself (`"auto_limit"`,
   `PeakEstimatingCore.reviewLimits.canAutoApprove`). The limit is checked against the base bid **plus**
   the largest Alternate group, so a customer who takes the biggest alternate can't land above the
   owner's limit (`PeakEstimatingCore.reviewLimits.reviewAmount`).

Otherwise the move is refused with *This quote needs an approval on record before it can be sent to the
customer.* (or *… marked Won.*).

### Roles

Peak's four roles and what they may do (Quartzite's `ROLE_PERMS`). A person can hold several roles.

| Role | manage_users | approve | create | send |
|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ |
| Manager | | ✓ | ✓ | ✓ |
| Estimator | | | ✓ | ✓ |
| Reviewer | | ✓ | | |

`create` lets someone build and save estimates and submit them. `approve` lets someone approve, send
back, and approve on send (above). `send` lets someone send to the customer.

### Bonuses at Won

Each eligible system carries two hidden, locked bonus lines while it is open (`pricing.md` →
*Bonuses*). When the quote is marked **won**, Quartzite writes a bonus payout record:

- the 2 % estimator bonus splits between the Lead estimator (`owner`) and Prepared by (`preparedBy`);
- the 5 % package bonus becomes the install project's performance-bonus pool.

The package does not ship the payout records of past estimates.

## Numbering

- `estNo` is a positive integer from **one shared counter** across every quote type. Quartzite assigns it
  in the database (a Postgres sequence). It never changes once set.
- The number people see is a prefix plus `estNo`. System estimates use `EST-1005`. The other prefixes
  belong to service quotes (FLM, RIG, REP, RNT, CON) and leads (OPP).
- A lead's number carries over to the quotes made from it. Extra quotes on the same opportunity add
  `estSuffix`: `EST-1005-2`, `EST-1005-3`.
- Formatting: `PeakEstimatingCore.estimateNumber.formatQuoteNumber` and
  `PeakEstimatingCore.estimateNumber.displayQuoteNumber`. A quote with no number yet shows its `id`.
- The prototype's numbering port issues one past the highest `estNo` it has seen (or past the last
  number it issued). That is unique per browser window only; see `ports.md` → `numbering`. A real
  implementation must be one atomic counter.
