# Data model

**Confidential — Peak Systems Group.**

This is what a Peak estimate *is*: the stored shape, every field, the lifecycle and the numbering. The
field tables below are generated from the source's own doc comments when the package is built, so they
match the code exactly. The notes keep the function and file names they cite, because those point at the
code that enforces each rule; internal tracking references are left out. Every function written as
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
**system estimates**: `quoteType` `"system"` (or absent), built in the Estimator (`source` `"estimator"`, or
none; not imported Daylite history, not a Grid, Quick Design or portal quote), with at least one line, not
deleted, and last changed (`updatedAt`, else `createdAt`) within the four weeks before the snapshot was cut.
It is a recent sample, not every estimate Peak has. The parts catalog is trimmed the same way: the parts
those estimates and every assembly use, plus the rules' parts, the curtain fabrics and the labor rates.
The fields below are the ones the package carries.

## Quote

The quote fields the package ships, in the slicer's allow-list order. A field the `Quote` type doesn't
declare is marked as such.

<!-- @fields src/lib/stores/quotes.ts Quote only=QUOTE_FIELDS -->

`value` and `margin` (the saved grand total and blended margin) are deliberately **not** shipped. The
prototype recomputes them on every save with `PeakEstimatingCore.reconcileEstimatorValue`, exactly as
Quartzite's server does, so a client can never post its own total.

### Box goods sale — `boxSale`

An estimate that sells equipment and freight only, with no install. It is one flag on an ordinary system
estimate, not a separate quote type: `boxSale` is stored only as `true` (absent means a normal
estimate; turning it off removes the key), and only on an Estimator system estimate, never on a
portal-catalog quote. The customer gets the itemized BOM, so:

- **Save refuses labor.** Any line with `labor`, `laborOverhead` or `laborTravel` set (mobilization and
  travel count), or any `kind: "labor"` system, refuses the whole save with *A box goods sale can't
  include labor — remove the labor lines or turn off Box goods sale.* The error carries no id, so
  nothing is partly saved. Send refuses the same way (labor can still arrive through a restored
  revision), and Move / Copy of a system with labor into an existing box sale is refused. The 2 %
  estimator bonus stays; the 5 % package bonus needs labor, so a box sale has none.
- **The document is the BOM view.** The Document tab, the print and the package page show the itemized
  list in the BOM layout: no title page, narrative, cover, cut sheets or datasheet links. Build package
  is the BOM quote tab alone, and Customer review offers Document and BOM only.
- **Frozen in a sent revision.** `docFields.boxSale` is present (`true`) only when the estimate was one
  when it was sent; a revision cut before the field, or of a normal estimate, has no key.
- **Where it starts.** *New box goods sale* on the Estimates list opens a new estimate with the switch
  on (the app's `?box=1`); an existing estimate has the switch in Quote details. Move / Copy a system
  into a *new* estimate copies the stored source's flag; into an existing one leaves the target's alone.

### Project discounts — `spec.projectDiscounts`

A vendor's project pricing for one job, recorded on the estimate as an extra **percent off our cost** for a
catalog SKU. `spec.projectDiscounts` maps the trimmed real SKU to `{ pct, note, by, at }` (0 < pct < 100,
two decimals; note up to 200 characters; at most 200 entries; `by` and `at` are stamped by the save, never
trusted from the client). It exists only when the estimate has any. Every matching line, and every part
inside an assembly line, carries a stamped copy: `catalogCost` (its normal cost), `projectDiscountPct`, and
`cost` = normal × (1 − pct/100), rounded to the cent. An assembly line gets `catalogCost` and a lower `cost`
by its discounted parts, never a pct of its own. Custom lines, vendor-quote lines, allowances, curtains, labor,
bonus lines and the Rewards credit are never discounted. The server re-applies the map on every save, move and
copy, so a stale payload cannot store a cost that disagrees with it, and renaming a catalog SKU moves the key.
Revisions freeze the stamped lines and the map with the rest of `spec`.

`catalogCost`, `projectDiscountPct`, the map and its notes are **internal**, like `cost`. The customer document,
online page and package page never print them; they print `price` only. They ship in the bundle because the
estimate's `spec` ships whole. The won project's *Project pricing to request* list is Quartzite's project
side and is not in the prototype.

### What the BOM view prints — Show on BOM and model numbers

`pdfOptions` also carries the four **Show on BOM** switches (`bomLinePrices`, `bomMaterials`, `bomLabor`,
`bomFreight`; all on by default and for an older estimate that lacks them). They apply to the BOM view
only: the BOM tab, the BOM print and the package page's BOM toggle. The estimate document itself never
reads them. Line prices still yield to the estimate-wide *Prices* switch. System prices, tax, the
Rewards credit and the Total always print.

In the BOM view a plain catalog line prints as **Model — Description**. The model is the line's own
frozen `manufacturerModelNumber`, else the catalog part's, else the line's MFR P/N; custom, allowance,
curtain, labor, bonus, vendor-quote and assembly / rack / track lines print their description alone.
The catalog fields it reads (`manufacturerModelNumber`, `manufacturerPartNumber`, `formerSkus`) are
bundled for the parts on the bundled estimates.

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

An append-only, priced snapshot. Revisions are never rewritten; `rev` is 1-based. The package ships the
fields below (the slicer's `REVISION_FIELDS`); Quartzite's revisions also carry the stored PDF's private
Blob pathname (`pdfBlobPath`, `pdfSavedAt`) and the service quotes' payloads (`flameTest`, `repair`,
`inspection`, `consulting`, `rental`), which never ship.

<!-- @fields src/lib/stores/quotes.ts QuoteRevision only=REVISION_FIELDS -->

### Revision header — `QuoteRevisionDocFields`

`docFields` freezes what the customer document's header printed when the revision was cut, so an old
revision prints as it was sent. Shipped fields (`DOC_FIELDS`, including `boxSale`; `pdfOptions` and `packageSelection` are
allow-listed again one level down). Not shipped: the drawings attached to the package page
(`packageFiles`, private Blob pathnames), the bid and its awarded bidder (`bid`, `awardedPartyId` —
bidders are not in the prototype) and the portal's firm-quote stamp (`portalFirm`).

<!-- @fields src/lib/stores/quotes.ts QuoteRevisionDocFields only=DOC_FIELDS -->

## Vendor quote — `VendorQuote`

A vendor's quote imported into an estimate, kept top-level on the quote (`vendorQuotes`, and frozen in
each revision). One priced line per vendor quote carries the money (`SpecItem.vendorQuoteId`); the
record supplies what that line prints. The package ships only what the screens and the customer
document **render** (`VENDOR_QUOTE_FIELDS`, `VENDOR_LINE_FIELDS`). Not shipped: the attached PDF (its
bytes or private Blob pathname), the vendor's link, the internal terms and notes (Build's amber
internal box shows them in Quartzite; the customer document never does), the email thread it came
from, the Read the PDF result and the vendor company link (the vendor company is not in the package —
the Vendors card groups by the vendor's name).

<!-- @fields src/app/(app)/estimator/types.ts VendorQuote only=VENDOR_QUOTE_FIELDS -->

Each of `lines`:

<!-- @fields src/app/(app)/estimator/types.ts VendorQuoteLine only=VENDOR_LINE_FIELDS -->

## Lifecycle

### Status

```
draft ──send──▶ sent ──▶ won
  │               │
  │               └────▶ lost
  ├──────────────────────────▶ won    (a draft can be marked won …
  └──────────────────────────▶ lost    … or lost without a send)

revise:  sent / won / lost ──▶ draft
re-send: won / lost ──▶ sent
leaving won (→ draft or sent) can restore the version that won — see below
```

The status select offers all four statuses, so any status can move to any other; the approval gate
(below) applies to every move into **sent** or **won**.

- **draft**: being built. Bonus lines and the $25 system round-up are (re)derived on every load and
  save.
- **sent**: went to the customer. Every move into sent — including a re-send from won or lost — cuts
  a **"sent" revision**, the version with contractual weight. A sent quote keeps the prices it was
  sent at, including a bonus rate changed later in Estimating Rules.
- **won**: the customer accepted. Quartzite then creates the install project; the prototype only logs
  *Would create install project for …* (the `onWon` port). Won records which version won in
  `wonRev`:
  - when the live quote still matches the **latest sent revision** (compared at today's SKUs, so a
    catalog rename alone is not a change), `wonRev` is that revision's `rev` and nothing new is cut;
  - otherwise — for example won from a draft recalled after its last send, or never sent at all — a
    `reason: "manual"` snapshot noted *"Won — the version that won"* (`WON_SNAPSHOT_NOTE`) is cut
    and `wonRev` points at it.

  `wonRev`, and the restore below, apply only to **Estimator system estimates that are not Daylite
  history** (`tracksWonVersion`, `src/lib/quote-won-version.ts`: no `quoteType` or `"system"`, and
  `source` is not `"daylite"`); any other quote records no `wonRev` and a Won move clears an older one.

  Won also writes the bonus payout (`bonusRecord`), but only when the quote is bonus-eligible and its
  systems carry bonus lines; leaving Won clears it. (The snapshot ships no `bonusRecord` — it is staff
  pay — so a prototype Won computes one fresh.)
- **lost**: closed. A Lost quote drops any Rewards credit line. No snapshot is cut, and moving a lost
  quote back to draft or sent cuts none either (beyond the "sent" revision a move to sent always
  cuts).
- **Leaving Won** for draft (a revise) or sent puts the version that won back on the live quote, but
  only when edits saved after the win changed it:
  1. the live quote, post-win edits included, is snapshotted first — a `reason: "manual"` revision
     noted *"Auto-saved before reopening at the version that won"* (`REOPEN_AUTOSAVE_NOTE`) — so the
     edits are never lost;
  2. then the `wonRev` revision's priced fields — name, margin, tier, spec, the service blocks and the
     **vendor quotes** (merged by id, the revision's rows winning) — are **restored** onto the live
     quote, and `value` is the restored gross less any Rewards credit, with the credit line put back;
     the header (customer, contact, owner, …) stays.

  When nothing changed since the win, neither happens. Won → lost is not a reopen: no snapshot, no
  restore. (Quartzite's `isReopen` / `reopenTarget` in `src/lib/quote-won-version.ts`, and `reopenPlanFor` / `applyReopen` in its quote store.)
- Moving any quote back to **draft** from sent, won or lost is a **revise**; the next send prints the
  next Rev.
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
