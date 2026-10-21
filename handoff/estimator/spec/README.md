# Peak Estimator — handoff package

**Confidential — Peak Systems Group.** This folder holds real Peak data: costs, margins, sell prices,
customer names and staff names. It is shared with one named recipient for evaluation only. Do not
forward, upload, publish or copy it, in whole or in part, without Peak Systems Group's written
permission, and delete it when the evaluation ends. `CONFIDENTIAL.txt`, the first file in the package
folder, says the same.

## What this is

A working copy of the **Estimator** from Quartzite, Peak's business app, running entirely in your
browser over a snapshot of Peak's production data. It is the reference for rebuilding Peak's estimating
inside your own software:

- The Estimator, the Assembly Builder and Estimating Rules are Quartzite's **real** components, bundled
  unchanged. They are not a mock-up. A few surrounding screens are built for the prototype (see *The
  screens*).
- The pricing is Quartzite's **real** engine, bundled unchanged. A readable copy is in
  `app/estimating-core.js`. `pricing.md` walks through every formula and names the function that
  computes it.
- `golden/` holds, for every bundled estimate, the totals that engine produces, to the cent. A rebuild
  that reproduces these files prices like Peak.

## How to open it

1. Unzip the package anywhere. It unzips to one folder, `peak-estimator-handoff/`.
2. Double-click `index.html`. There is no install, no server and no sign-in. It is verified in
   Chrome; Edge and Safari should work but were not tested.

It runs from `file://`. The only network request it makes is for the Google Fonts it prefers; offline,
the text falls back to similar system fonts and nothing else changes.

The same folder also runs when published as a web page (Peak checks it over http too, opened with a
query string as a host would). A host that limits files per upload may need several uploads: an
Artifact publish takes 255 files and an Artifact version 511, and product photos are what grow the
count (one file each). The zip has no such limit.

The banner at the top of every screen reads *Confidential — Peak Systems Group · prototype — nothing is
sent or saved to Peak*. That is literally true: nothing leaves your browser.

## What's in the folder

```
peak-estimator-handoff/ the folder the zip unzips to; everything below is inside it
CONFIDENTIAL.txt        read this first
index.html              the prototype — open this
app/app.js              the prototype: Quartzite's Estimator UI + the engine + a local store and the ports (minified)
app/app.css             Quartzite's styles (Tailwind + Peak's pk-* components)
app/assets/             the Peak letterhead and the "no photo" placeholder images (and any other files the app imports)
app/estimating-core.js  the pricing engine, readable (also loads in Node — see pricing.md)
data/*.js               the data snapshot, as <script> files (file:// can't fetch JSON):
                          rules.js      Estimating Rules, rates, tiers, track series, curtain mounts, system categories…
                          team.js       staff names and roles
                          customers.js  the companies the bundled estimates reference, with all their venues and contacts
                          fixtures.js   fixtures, systems, hardware assemblies and racks (the Assembly Builder)
                          catalog-N.js  the catalog parts the package needs (see *What data is bundled*), in ≤ 15 MB pieces
                                        (only the fields the Estimator reads)
                          estimates.js  the bundled system estimates (with their revisions and vendor quotes)
                          photos.js     which product photo each part shows (when photos were bundled)
                          meta.js       when the snapshot was cut, the estimate window, and counts
images/<docId>.webp     product photos for parts on the bundled estimates and fixtures (when bundled): only
                        the files photos.js names
spec/README.md          this file
spec/data-model.md      every quote / system / line / group / alternate / revision field; lifecycle; numbering
spec/pricing.md         every formula in words, each naming its function in app/estimating-core.js
spec/ports.md           the seams to your own system: customers, users, numbering, email, onWon, clock
spec/golden/<id>.json   per bundled estimate: per-system sell, per-line extended sell, totals()
spec/screenshots/       the screens at 1440×900, for pixel reference (01 Estimates and 06 Catalog are
                        prototype-built screens; the Estimator steps, Assemblies and Rules are the real ones)
```

## The screens

The top bar has **Estimates · Catalog · Assemblies · Estimating Rules**, an **Acting as** picker (Peak's
roster and roles) and **Reset to production snapshot**.

- **Estimates** *(built for the prototype)*: every bundled system estimate (number, customer, status,
  total), filters, and **New estimate**. A slim stand-in for Quartzite's Quotes hub.
- **Estimator** *(the real components)*: one estimate in four steps on one page.
  - **Build**: systems and lines, catalog search, the groups rail, alternate groups, mark built, moving
    lines, assemblies, the curtain, track and labor configurators, the hidden bonus lines, and
    tiers/margins.
  - **Build package**: Narrative, BOM quote and Client package.
  - **Customer review**: the Document, Package page, BOM and Cut sheets tabs (Desktop / Phone), with
    numbered review comments. The tab strip and the document pane are **prototype copies**: in Quartzite
    they frame a server-rendered PDF and a preview route; here they draw the same real document,
    package page, BOM and cut-sheet components live from the browser store.
  - **Send & track**: the approval control (Submit for approval, Approve, Send to customer, Withdraw),
    status and pipeline, the email composer, and the Activity card (the real card; the prototype adds
    its own *Would create install project for …* note under it).
- **Catalog** *(built for the prototype)*: search and browse the parts bundled in this package (not Peak's
  whole catalog; see *What data is bundled*), plus a part editor. A slim stand-in for Quartzite's catalog
  page; search ranks exactly like the Estimator's catalog picker.
- **Assemblies** *(the real components)*: the Assembly Builder for fixtures, systems, hardware and racks,
  with the rack elevation and its submittal sheets.
- **Estimating Rules** *(the real editors)*: tier margins, rates, freight, bonuses, sewing %, track
  series, curtain mounts, system categories. The rules that price only Peak's service quotes or the
  customer portal (flame test, repair, inspection, the flights-over-drive travel allowances, the portal
  knobs) are hidden: they never touch a system estimate. Their stored values are kept, and Export still
  lists every rule.

The banner, the top bar, **Acting as** and **Reset** (the shell) are the prototype's own.

**Acting as** switches between Peak's real staff and their roles (Admin, Manager, Estimator, Reviewer).
What each role may do comes from Quartzite's own permission table (see `data-model.md`), so approvals
behave as they do at Peak. If the open estimate has unsaved changes, it asks first.

## What's real and what's faked

| Real (Quartzite's own code and data) | Faked (the prototype's stand-ins) |
|---|---|
| Every Estimator step and its components, the Assembly Builder, the Estimating Rules editors | Sign-in: the **Acting as** picker stands in for Google SSO |
| The pricing engine, to the cent (`golden/` proves it) | Storage: an IndexedDB copy in your browser stands in for Postgres |
| The data: catalog, rules, estimates, customers, staff | **Send**: nothing is emailed. The Activity card records the message as *Sent (simulated)* |
| | The Estimates list, the Catalog screen and Customer review's tab strip / document pane are built for the prototype around the real components |
| The approval gate, review limits, statuses, revisions, bonuses | **Won**: no install project is created. The prototype log notes *Would create install project for …* |
| The customer document, package page, BOM and cut sheets, rendered live | **PDF**: the browser's **Print / Save as PDF** replaces Quartzite's server-rendered PDF |
| | Estimate numbers: a local counter that starts after the highest **bundled** estimate number. Service quotes and leads share Quartzite's counter but aren't bundled, so a prototype number may repeat one Peak already used |
| | Rewards: applying a Rewards credit is off, so a reopened Won estimate restores its won version with no credit line |

The faked parts are the **ports**. `ports.md` gives each one's contract, written as the interface you
would implement in your own system. In your rebuild, quotes, customers and users would come from your
own system through those same seams.

## Your edits

- Edits are saved in this browser (IndexedDB), on top of the read-only snapshot. They survive a reload
  and stay on this computer.
- Edits belong to **this snapshot**. A package cut from a newer export opens clean, with none of them
  (each snapshot has its own browser database); open the older package again and its edits are still
  there.
- **Reset to production snapshot** discards every edit, new estimate and review comment made in this
  browser. Close any other prototype windows or tabs first. If another one is open, Reset says *Close
  other prototype windows and try again.*
- In a private window, or anywhere IndexedDB is unavailable, the prototype still works but shows
  *Changes won't be saved in this window*.
- **Two windows on the same package do not see each other's changes until reloaded, and the last save
  wins.** Estimate numbers are unique within one window only: two windows can each issue the same next
  number. Quartzite issues numbers from one database counter, and so should your numbering port.

## Good to know

- **Printing** (Customer review → Document → **Print / Save as PDF**) prints the *saved* estimate, so
  save first. It adds a small footer, *Confidential — Peak Systems Group · prototype*, to every printed
  page. Quartzite's own PDF has no such footer. The print is the document (and, when the estimate asks
  for them, the Client cut sheets); Quartzite's PDF also appends the client's drawings and a page of
  datasheet links, which the prototype can't, since neither is bundled.
- **Pop-out windows** (the ⧉ buttons) aren't available. Pressing one shows a notice.
- **Datasheets and Drawings**: those Customer review tabs show *Not included in the prototype*, and the
  client package lists no datasheets. No datasheets, manuals or drawing files are bundled.
- **Product photos** are bundled only for parts on the bundled estimates and fixtures. Every other
  part shows Quartzite's placeholder image.
- **Vendor quotes** on an estimate show what the screens print: the vendor, quote number, description,
  material lines, total and the freight flag. The attached vendor PDF, the vendor's link and the
  internal terms and notes are not bundled (Build's amber internal box shows nothing for them).
- **A bundled Won estimate** carries which version won (`wonRev`, and the revisions it points to), so
  reopening it after an edit puts the won version back, the same as an estimate won inside the prototype.
- A link to a part of Quartzite outside the Estimator (Inbox, Grid, Projects…) shows *Not part of the
  prototype*. So do actions that belong to those modules: bids, client share links, vendor quotes from
  email, Assist, Rewards. They answer *Not available in the prototype* and change nothing.
- Dates print in Chicago time (America/Chicago), as in Quartzite.

## What data is bundled

The package is a **recent sample**, not a full copy of Peak's data:

- **Estimates**: only estimates built in the Estimator that were last changed in the **four weeks** before
  the snapshot was cut (the window is in `data/meta.js`, as `window`). Older estimates, and estimates
  that came from other places (Grid or Quick Design quotes, imported Daylite history, the customer
  portal), are not bundled. Their customers, venues and contacts are not bundled either.
- **Assemblies**: all of them: every fixture, system, hardware assembly and rack, with all their parts.
- **Catalog**: only the parts the package uses, not Peak's whole catalog. That is every part on a
  bundled estimate (and its revisions), every part in any assembly, every part named by the bundled
  rules (track series sticks and parts, curtain mounting hardware, the typical items of each system
  category, the rack defaults' blank and vent panels), every fabric the curtain picker offers, and every
  labor rate. A part that was renamed keeps its old SKU, so an old SKU still finds the new part.
  **Consequence:** the Estimator's *Add part from catalog* search, the Catalog screen and the vendor
  suggestions list only these parts. A part Peak sells that is not in the package is not found, and a line
  for it is entered as a custom part. Pricing of everything that is bundled is unaffected.
- **Photos**: for the bundled parts that the estimates and assemblies use.

## Not included

The package covers **system estimates** only: the Estimator core, the Catalog and assemblies, and the
client output. It does **not** include:

- service quotes (flame test, repair, inspection, rental, consulting), which share Quartzite's quote
  table but have their own builders and pricing engines
- the customer portal
- the Grid system designer
- the Specs builder
- Gmail / Inbox
- Assist / Ask AI
- tasks, morning triage and the calendar
- install projects
- the Daylite import

The snapshot also leaves out, on purpose: mail and mailbox connections, every secret and token,
notification preferences, portal grants and carts, meetings, assessments, and every estimate the
customer portal built for itself. Of the geocoding cache, only the drive routes between the bundled
venues and Peak's offices are bundled.

**What an estimate carries.** Only the fields the Estimator reads are bundled, from an allow-list (a
field not on it can't slip in). Left out, on purpose:

- on the estimate: its client share link and who opened it, client responses from the package page,
  the Won bonus payout record and the bonus split, the email threads it was sent on, the bid and its
  bidders (and the "bidders present" stamp), the drawings attached to the package page, the saved PDF
  (and where it is stored), review comments, Assist drafts and nudges, portal fields (acceptance, firm
  quote, review, decline), the lead link, the renewal link, the findings it was built from, the date the
  customer's PO arrived, the legacy owner and legacy contact fields, the "content changed" stamp, the
  estimate's terms text, scope narrative and quote basis, the service quotes' payloads (flame test,
  repair, inspection, consulting, rental — only system estimates are bundled), and the saved `value`
  and `margin` (the prototype recomputes both on every save);
- on each revision: where its sent PDF is stored, the service quotes' payloads, and, in its frozen
  header, the drawings, the bid and its awarded bidder, and the portal's firm-quote stamp;
- on each vendor quote: the attached PDF, the vendor's link, the internal terms and notes, the email
  thread it came from, the Read the PDF result and the vendor company link.

**How text is checked.** Estimates, catalog parts and fixtures are scrubbed deep: any string shaped like
a token or key is blanked. Settings and staff are taken field by field, the rules by blob name and the
customers column by column, each from its allow-list. Then every bundled file is scanned for secrets,
and any hit stops the build.

## Where to start reading

1. `screenshots/`: what it looks like (01 and 06 are the prototype's own Estimates and Catalog screens).
2. `data-model.md`: what an estimate is.
3. `pricing.md`, next to `app/estimating-core.js`: how it is priced.
4. `golden/`: the numbers your rebuild must reproduce.
5. `ports.md`: what your system supplies.
