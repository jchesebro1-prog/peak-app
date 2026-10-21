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

- The screens are Quartzite's **real** Estimator components, bundled unchanged. They are not a mock-up.
- The pricing is Quartzite's **real** engine, bundled unchanged. A readable copy is in
  `app/estimating-core.js`. `pricing.md` walks through every formula and names the function that
  computes it.
- `golden/` holds, for every bundled estimate, the totals that engine produces, to the cent. A rebuild
  that reproduces these files prices like Peak.

## How to open it

1. Unzip the package anywhere. It unzips to one folder, `peak-estimator-handoff/`.
2. Double-click `index.html`. Chrome, Edge and Safari all work. There is no install, no server and no
   sign-in.

It runs from `file://`. The only network request it makes is for the Google Fonts it prefers; offline,
the text falls back to similar system fonts and nothing else changes.

The banner at the top of every screen reads *Confidential — Peak Systems Group · prototype — nothing is
sent or saved to Peak*. That is literally true: nothing leaves your browser.

## What's in the folder

```
peak-estimator-handoff/ the folder the zip unzips to; everything below is inside it
CONFIDENTIAL.txt        read this first
index.html              the prototype — open this
app/app.js              the prototype: Quartzite's Estimator UI + the engine + a local store and the ports (minified)
app/app.css             Quartzite's styles (Tailwind + Peak's pk-* components)
app/assets/             the Peak letterhead and the "no photo" placeholder images
app/estimating-core.js  the pricing engine, readable (also loads in Node — see pricing.md)
data/*.js               the data snapshot, as <script> files (file:// can't fetch JSON):
                          rules.js      Estimating Rules, rates, tiers, track series, curtain mounts, system categories…
                          team.js       staff names and roles
                          customers.js  only the companies, venues and contacts the bundled estimates reference
                          fixtures.js   fixtures, systems, hardware assemblies and racks (the Assembly Builder)
                          catalog-N.js  the full parts catalog, in ≤ 15 MB pieces (only the fields the Estimator reads)
                          estimates.js  the bundled system estimates
                          photos.js     which product photo each part shows (when photos were bundled)
                          meta.js       when the snapshot was cut, and counts
images/                 product photos for parts on the bundled estimates and fixtures (when bundled)
spec/README.md          this file
spec/data-model.md      every quote / system / line / group / alternate / revision field; lifecycle; numbering
spec/pricing.md         every formula in words, each naming its function in app/estimating-core.js
spec/ports.md           the seams to your own system: customers, users, numbering, email, onWon, clock
spec/golden/<id>.json   per bundled estimate: per-system sell, per-line extended sell, totals()
spec/screenshots/       the real screens at 1440×900, for pixel reference
```

## The screens

The top bar has **Estimates · Catalog · Assemblies · Estimating Rules**, an **Acting as** picker (Peak's
roster and roles) and **Reset to production snapshot**.

- **Estimates**: every bundled system estimate (number, customer, status, total), filters, and **New
  estimate**.
- **Estimator**: one estimate in four steps on one page.
  - **Build**: systems and lines, catalog search, the groups rail, alternate groups, mark built, moving
    lines, assemblies, the curtain, track and labor configurators, the hidden bonus lines, and
    tiers/margins.
  - **Build package**: Narrative, BOM quote and Client package.
  - **Customer review**: the Document, Package page, BOM and Cut sheets tabs (Desktop / Phone), with
    numbered review comments.
  - **Send & track**: the approval control (Submit for approval, Approve, Send to customer, Withdraw),
    status and pipeline, the email composer, and the Activity card.
- **Catalog**: search and browse the whole catalog, plus the part editor.
- **Assemblies**: the Assembly Builder for fixtures, systems, hardware and racks, with the rack elevation
  and its submittal sheets.
- **Estimating Rules**: tier margins, rates, freight, bonuses, sewing %, track series, curtain mounts,
  system categories.

**Acting as** switches between Peak's real staff and their roles (Admin, Manager, Estimator, Reviewer).
What each role may do comes from Quartzite's own permission table (see `data-model.md`), so approvals
behave as they do at Peak.

## What's real and what's faked

| Real (Quartzite's own code and data) | Faked (the prototype's stand-ins) |
|---|---|
| Every Estimator screen and component | Sign-in: the **Acting as** picker stands in for Google SSO |
| The pricing engine, to the cent (`golden/` proves it) | Storage: an IndexedDB copy in your browser stands in for Postgres |
| The data: catalog, rules, estimates, customers, staff | **Send**: nothing is emailed. The Activity card records the message as *Sent (simulated)* |
| The approval gate, review limits, statuses, revisions, bonuses | **Won**: no install project is created. The prototype log notes *Would create install project for …* |
| The customer document, package page, BOM and cut sheets, rendered live | **PDF**: the browser's **Print / Save as PDF** replaces Quartzite's server-rendered PDF |
| | Estimate numbers: a local counter that starts after the highest **bundled** estimate number. Service quotes and leads share Quartzite's counter but aren't bundled, so a prototype number may repeat one Peak already used |

The faked parts are the **ports**. `ports.md` gives each one's contract, written as the interface you
would implement in your own system. In your rebuild, quotes, customers and users would come from your
own system through those same seams.

## Your edits

- Edits are saved in this browser (IndexedDB), on top of the read-only snapshot. They survive a reload
  and stay on this computer.
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
  page. Quartzite's own PDF has no such footer.
- **Pop-out windows** (the ⧉ buttons) aren't available. Pressing one shows a notice.
- **Datasheets and Drawings**: those Customer review tabs show *Not included in the prototype*, and the
  client package lists no datasheets. No datasheets, manuals or drawing files are bundled.
- **Product photos** are bundled only for parts on the bundled estimates and fixtures. Every other
  part shows Quartzite's placeholder image.
- A link to a part of Quartzite outside the Estimator (Inbox, Grid, Projects…) shows *Not part of the
  prototype*. So do actions that belong to those modules: bids, client share links, vendor quotes from
  email, Assist, Rewards. They answer *Not available in the prototype* and change nothing.
- Dates print in Chicago time (America/Chicago), as in Quartzite.

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
notification preferences, portal grants and carts, meetings, assessments, the geocoding cache, and
three per-estimate records that only matter inside Peak (client responses, the Won bonus payout record,
and the bonus split). The slicer works from an allow-list, so nothing else can slip in.

## Where to start reading

1. `screenshots/`: what it looks like.
2. `data-model.md`: what an estimate is.
3. `pricing.md`, next to `app/estimating-core.js`: how it is priced.
4. `golden/`: the numbers your rebuild must reproduce.
5. `ports.md`: what your system supplies.
